# -*- coding: utf-8 -*-
"""摄影作品批量处理 — 入口与调度"""
import os
import sys
from datetime import datetime

from compat import setup_windows_stdout
setup_windows_stdout()

from PIL import Image

from exif_utils import get_exif_info
from hash_utils import file_md5
from toml_utils import (
    detect_split_year, parse_photo_dir, repartition_shards, write_photo_dir)
from watermark import process_image
from analysis import is_analysis_stale, analyze_and_store, write_js_meta
from oss_utils import create_bucket_from_config, sync_new_photos

# 同名换图（source_hash 变化）时随 EXIF 一起更新的自动字段；手动字段
# （alt/category/place/address/location/description/series/species/is_cover/featured）
# 不在此列，保持用户编辑。lat/lng 单独处理：新图自带 GPS 才覆盖，
# 无 GPS 不得抹掉 address 地理编码得到的坐标（2026-11-19）
AUTO_EXIF_FIELDS = ("focus", "iso", "aperture", "shutter", "time", "camera", "lens")


def _get_image_size(path):
    """读取图片像素宽高（字符串），失败返回空字符串"""
    try:
        with Image.open(path) as img:
            return str(img.size[0]), str(img.size[1])
    except Exception:
        return "", ""


def batch_process(input_dir, output_dir, photos_dir=None, split_year=2024,
                  analysis_dir=None, force=False):
    if not os.path.exists(output_dir):
        os.makedirs(output_dir)

    # 发布时间：新建条目时写入一次（同一趟处理共用同一时间戳 = 一次发布批次），
    # 重跑/--force/同名换图都不改——RSS 按此排序，补发旧拍摄日期的作品也能
    # 成为新条目（2026-11-12）
    published_now = datetime.now().astimezone().isoformat(timespec="seconds")

    # 分析常量单源：Python 常量 -> 主题 JS module（灯箱 import）。
    # 以分片目录所在仓库根定位主题资源；路径不存在时告警不中断。
    if photos_dir:
        repo_root = os.path.dirname(os.path.dirname(os.path.abspath(photos_dir)))
        js_meta = os.path.join(repo_root, "themes", "photofolio", "assets", "js", "analysis-meta.js")
        if os.path.isdir(os.path.dirname(js_meta)):
            try:
                write_js_meta(js_meta)
            except OSError as e:
                print(f"⚠️  分析常量写入失败：{e}")

    shards = []  # [(分片名, 条目)]，分片内即展示顺序（新→旧）
    src_to_entry = {}
    original_times = {}  # 既有条目的 time；变化时重新定位
    if photos_dir:
        shards = parse_photo_dir(photos_dir)
        # 拆分阈值以现有 pre-YYYY 分片名为准，避免配置与数据布局不一致
        split_year = detect_split_year([name for name, _ in shards], split_year)
        for _name, entries in shards:
            for entry in entries:
                if entry["src"] in src_to_entry:
                    raise ValueError(
                        f"照片分片存在重复 src（拒绝重写，否则条目会被覆盖）：{entry['src']}")
                src_to_entry[entry["src"]] = entry
                original_times[entry["src"]] = entry.get("time", "")
    skipped = 0
    processed = 0
    analyzed = 0
    processed_files = []  # 记录本次实际处理的文件名
    new_entries = []  # 本次新增的条目（需手填 alt/category 等元数据）
    for f in sorted(os.listdir(input_dir)):
        if not f.lower().endswith((".jpg", ".jpeg")):
            continue

        input_path = os.path.join(input_dir, f)
        output_path = os.path.join(output_dir, f)
        src = f"/images/photos/{f}" if photos_dir else None
        entry = src_to_entry.get(src) if src else None
        is_new = src is not None and src not in src_to_entry
        # 输入图内容哈希（全 32 位）：同名换图保留旧 mtime 也能发现（2026-10-28）
        input_hash = file_md5(input_path) if photos_dir else None

        needs_reprocess = True
        source_changed = True
        if os.path.exists(output_path):
            if entry is not None:
                # source_hash 缺失（旧数据）按变化处理；可先用
                # backfill_source_hash.py 一次性回填以跳过首轮全量重处理
                source_changed = entry.get("source_hash") != input_hash
            else:
                # 无分片条目/未启用数据写入：退回 mtime 判定
                source_changed = os.path.getmtime(output_path) < os.path.getmtime(input_path)
        # force 只强制重出全部图；图像分析仍按源图变化/缺失/版本惰性判定，
        # 避免仅重出水印时无谓重算全分辨率分析（2026-10-29）
        needs_reprocess = force or source_changed or not os.path.exists(output_path)

        # EXIF 只在需要处读取：已存在且未变化的照片跳过时不再逐张打开原图
        # （此前每次运行都为全部跳过照片做无效 I/O）；新条目即使输出已存在
        # 也需 EXIF 填字段
        exif_info = None
        if needs_reprocess or is_new:
            exif_info = get_exif_info(input_path)

        processed_ok = not needs_reprocess
        if needs_reprocess:
            try:
                process_image(input_path, output_path, exif_info)
                processed_ok = True
                photo_year = exif_info.get("time", "")[:4]
                print(f"✅ 处理完成：{f}  {photo_year if photo_year else ''}")
                processed += 1
                processed_files.append(f)
            except Exception as e:
                print(f"❌ 处理失败：{f}  {e}")
        else:
            skipped += 1

        # 只有处理成功/跳过（输出图与输入一致）才记录源哈希；失败保留旧值，下次重试
        if entry is not None and processed_ok and os.path.exists(output_path):
            entry["source_hash"] = input_hash
            # 同名换图：源图内容真正变化并成功重出后，EXIF/time/camera/lens
            # 一并更新；--force 重出同一张不覆盖手动修正过的 EXIF
            if source_changed and exif_info is not None:
                for key in AUTO_EXIF_FIELDS:
                    entry[key] = exif_info.get(key, "")
                # 坐标优先取 EXIF GPS：新图带了就覆盖（含地理编码旧值），
                # 没带则保留原值——address 地理编码结果不能被空值冲掉
                for key in ("lat", "lng"):
                    if exif_info.get(key):
                        entry[key] = exif_info[key]

        # 图像分析：源图变化成功重处理时强制重算；force 仅重出图 / 跳过时按
        # 结果缺失/算法版本惰性判定；处理失败不重算（避免分析结果与旧输出图版本错配）
        if analysis_dir:
            analysis_path = os.path.join(analysis_dir, os.path.splitext(f)[0] + ".json")
            if processed_ok and (
                (source_changed and needs_reprocess)
                or (not source_changed and is_analysis_stale(analysis_path))
            ):
                try:
                    # 分析 JSON 生成是独立于图像处理的耗时步骤（全分辨率逐像素）：
                    # 开始/完成各输出一行，避免处理完成后长时间静默、无法判断进度
                    print(f"🔍 图像分析中：{f}")
                    analyze_and_store(input_path, analysis_path)
                    analyzed += 1
                    print(f"✅ 图像分析完成：{f}")
                except Exception as e:
                    print(f"❌ 分析失败：{f}  {e}")

        if photos_dir:
            # 处理失败不落新条目：否则 width/height 为空、无 hash/source_hash、
            # src 指向从未生成/上传的 CDN 文件，站点出现 404 卡片且每次运行
            # 重复报分析失败。输出存在且处理成功（或本就跳过）才建条目
            if is_new and processed_ok and os.path.exists(output_path):
                new_entry = {
                    "src": src,
                    "alt": "",
                    "category": "",
                    "focus": exif_info["focus"],
                    "iso": exif_info["iso"],
                    "aperture": exif_info["aperture"],
                    "shutter": exif_info["shutter"],
                    "time": exif_info["time"],
                    "place": "",
                    "lat": exif_info.get("lat", ""),
                    "lng": exif_info.get("lng", ""),
                    "location": "",
                    "camera": exif_info.get("camera", ""),
                    "lens": exif_info.get("lens", ""),
                    "source_hash": input_hash,
                    "published": published_now,
                }
                src_to_entry[src] = new_entry
                new_entries.append(f)
                print(f"🆕 新条目：{f}（请填写 alt/category/place/location 等手填字段）")

    if photos_dir:
        # 处理完成后按输出图统一刷新宽高与哈希：重新处理/跳过/新条目一次覆盖，
        # 避免处理前预读旧输出图、同名换图改比例时把旧宽高写回（2026-11-05）；
        # 缺失输出文件的条目保留既有值，下次有文件时再补。
        # 哈希取输出图实际字节，避免增量运行留下过期版本号
        for src, entry in src_to_entry.items():
            img_path = os.path.join(output_dir, os.path.basename(src))
            if os.path.exists(img_path):
                entry["width"], entry["height"] = _get_image_size(img_path)
                try:
                    entry["hash"] = file_md5(img_path, 8)
                except OSError as e:
                    print(f"⚠️  哈希计算失败：{os.path.basename(src)}  {e}")
        # 分析结果完整性检查：全部分片条目（含本次新增）都应有对应 JSON——
        # src 与管线输入文件名不一致的照片（人工条目/历史改名）没有生成路径，站点
        # 侧会永久显示失败提示卡；此处告警定位（2026-10-21 审查修复 #5）
        if analysis_dir:
            try:
                missing = [
                    os.path.basename(e["src"])
                    for e in src_to_entry.values()
                    if not os.path.exists(os.path.join(
                        analysis_dir, os.path.splitext(os.path.basename(e["src"]))[0] + ".json"))
                ]
                if missing:
                    print(f"⚠️  以下照片缺少图像分析结果（src 与输入文件名不一致？请核对）：")
                    for m in missing[:10]:
                        print(f"    - {m}")
                    if len(missing) > 10:
                        print(f"    …共 {len(missing)} 张")
            except Exception:
                pass

    # 写出分片：其余条目保持原分片与原顺序（手动调序优先），新增条目与
    # time 变化的条目按展示顺序插入目标年份分片；此处只算布局，真正写盘
    # 在 OSS 上传成功之后（见 run）
    if photos_dir:
        moved = [
            e for src, e in src_to_entry.items()
            if src in original_times and e.get("time", "") != original_times[src]
        ]
        extra = [e for src, e in src_to_entry.items() if src not in original_times]
        planned = repartition_shards(shards, split_year, moved=moved, extra=extra)
    else:
        planned = []

    summary = f"📊 本次处理 {processed} 张，跳过 {skipped} 张（未变化），分析 {analyzed} 张"
    if new_entries:
        summary += f"，新增 {len(new_entries)} 条（需补手填字段）"
    print(summary)
    return processed_files, src_to_entry, planned


def _load_config():
    """读取 pipeline_config.json（本管线目录）。照片原图/输出图体积大、不在仓库内，
    输入/输出目录必须由用户配置（未配置则退出并提示）；photos_dir 缺省直写站点
    数据源 data/photos/（按拍摄年份分片）。"""
    import json

    BASE_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
    DEFAULTS = {
        "input_dir": "",
        "output_dir": "",
        "photos_dir": os.path.abspath(os.path.join(BASE_DIR, "..", "..", "data", "photos")),
        # 拆分阈值：早于该年份的照片统一写入 pre-<年份>.toml；须与现有分片名一致
        "photos_split_from_year": 2024,
        # 图像分析结果输出目录：缺省直写站点 static/analysis/（入库随部署发布，
        # 灯箱按 slug 拉取）；配置为空串时同样回退缺省值
        "analysis_dir": os.path.abspath(os.path.join(BASE_DIR, "..", "..", "static", "analysis")),
    }

    config_path = os.path.join(BASE_DIR, "pipeline_config.json")
    config = {}
    if os.path.exists(config_path):
        try:
            with open(config_path, "r", encoding="utf-8") as f:
                config = json.load(f)
        except Exception as e:
            print(f"⚠️  pipeline_config.json 解析失败: {e}")
    else:
        print("⚠️  未找到 pipeline_config.json")
        print("   请复制 pipeline_config.example.json 为 pipeline_config.json 并填写照片目录")

    if config.get("toml_path") and not config.get("photos_dir"):
        print("❌ 配置格式已更新：toml_path 已改为分片目录 photos_dir，请更新 pipeline_config.json")
        return None

    for key, default in DEFAULTS.items():
        if not config.get(key):
            config[key] = default

    try:
        config["photos_split_from_year"] = int(config["photos_split_from_year"])
    except (TypeError, ValueError):
        print(f"❌ photos_split_from_year 非法：{config['photos_split_from_year']!r}")
        return None

    if not config["input_dir"] or not config["output_dir"]:
        print("❌ 未配置照片输入/输出目录，请填写 pipeline_config.json 后重试")
        return None

    print(f"   输入目录: {config['input_dir']}")
    print(f"   输出目录: {config['output_dir']}")
    print(f"   照片数据: {config['photos_dir']}（早于 {config['photos_split_from_year']} 年并入 pre 分片）")
    print(f"   分析目录: {config['analysis_dir']}")
    return config


def run(force=False):
    config = _load_config()
    if not config:
        return
    INPUT_FOLDER = config["input_dir"]
    OUTPUT_FOLDER = config["output_dir"]
    PHOTOS_DIR = config["photos_dir"]
    SPLIT_YEAR = config["photos_split_from_year"]
    ANALYSIS_DIR = config["analysis_dir"]

    if not os.path.isdir(INPUT_FOLDER):
        print(f"❌ 输入目录不存在：{INPUT_FOLDER}")
        print("   请检查 pipeline_config.json 的 input_dir（原图目录）后重试")
        return

    print("===== 开始处理 =====")
    processed_files, src_to_entry, planned_shards = batch_process(
        INPUT_FOLDER, OUTPUT_FOLDER, photos_dir=PHOTOS_DIR, split_year=SPLIT_YEAR,
        analysis_dir=ANALYSIS_DIR, force=force)
    print("===== 全部完成 =====")

    # 先传 OSS，成功后才写分片：上传失败时站点数据保持旧版本，
    # 不会出现新 hash 指向未上传对象（2026-10-29）
    bucket = create_bucket_from_config()
    if bucket:
        print("===== 开始上传 OSS =====")
        try:
            sync_new_photos(OUTPUT_FOLDER, bucket, force_files=processed_files)
        except Exception as e:
            print(f"❌ OSS 上传失败：{e}")
            print("   照片数据未写入；请修复网络/凭证后重新运行"
                  "（建议 --force，确保云端全部为新版本）")
            return
        print("===== OSS 上传完成 =====")

    if PHOTOS_DIR and src_to_entry:
        write_photo_dir(PHOTOS_DIR, planned_shards)


if __name__ == "__main__":
    run()
