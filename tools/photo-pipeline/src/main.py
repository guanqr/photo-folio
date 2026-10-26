# -*- coding: utf-8 -*-
"""摄影作品批量处理 — 入口与调度"""
import hashlib
import sys
import os

# 修复 Windows 控制台乱码
if sys.platform.startswith("win"):
    try:
        import codecs
        sys.stdout = codecs.getwriter("utf-8")(sys.stdout.detach())
    except Exception:
        pass

from PIL import Image

from exif_utils import get_exif_info
from toml_utils import parse_toml_entries, write_toml
from watermark import process_image
from analysis import is_analysis_stale, analyze_and_store
from oss_utils import create_bucket_from_config, sync_new_photos


def _get_image_size(path):
    """读取图片像素宽高（字符串），失败返回空字符串"""
    try:
        with Image.open(path) as img:
            return str(img.size[0]), str(img.size[1])
    except Exception:
        return "", ""


def _file_hash(path):
    """输出图内容哈希（MD5 前 8 位）：站点用它给图片 URL 拼 ?v= 缓存版本号。
    同名换图后 src 不变、字节变，URL 随哈希变化即可绕过浏览器/缓存旧图（2026-10-26）"""
    h = hashlib.md5()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()[:8]


def batch_process(input_dir, output_dir, toml_path=None, analysis_dir=None):
    if not os.path.exists(output_dir):
        os.makedirs(output_dir)

    src_to_entry = {}
    if toml_path:
        for entry in parse_toml_entries(toml_path):
            src_to_entry[entry["src"]] = entry
        # 宽高始终以处理后的输出图为准（覆盖历史记录中可能存在的原始尺寸）
        for src, entry in src_to_entry.items():
            img_path = os.path.join(output_dir, os.path.basename(src))
            if os.path.exists(img_path):
                entry["width"], entry["height"] = _get_image_size(img_path)

    skipped = 0
    processed = 0
    analyzed = 0
    processed_files = []  # 记录本次实际处理的文件名
    for f in sorted(os.listdir(input_dir)):
        if not f.lower().endswith((".jpg", ".jpeg")):
            continue

        input_path = os.path.join(input_dir, f)
        output_path = os.path.join(output_dir, f)

        needs_reprocess = True
        if os.path.exists(output_path):
            if os.path.getmtime(output_path) >= os.path.getmtime(input_path):
                needs_reprocess = False

        exif_info = get_exif_info(input_path)

        if needs_reprocess:
            try:
                process_image(input_path, output_path, exif_info)
                photo_year = exif_info.get("time", "")[:4]
                print(f"✅ 处理完成：{f}  {photo_year if photo_year else ''}")
                processed += 1
                processed_files.append(f)
            except Exception as e:
                print(f"❌ 处理失败：{f}  {e}")
        else:
            skipped += 1

        # 图像分析：独立于重处理判定的惰性步骤——结果缺失、算法版本过期或
        # 结果早于源图修改（同名换图）才加载原图分析（首次接入自动全量回填、
        # 日常增量只付新增照片的成本，不重传图片）；分析对象为处理链上加水印
        # 前的原图口径（见 analysis.py）
        if analysis_dir:
            analysis_path = os.path.join(analysis_dir, os.path.splitext(f)[0] + ".json")
            if is_analysis_stale(analysis_path, os.path.getmtime(input_path)):
                try:
                    # 分析 JSON 生成是独立于图像处理的耗时步骤（全分辨率逐像素）：
                    # 开始/完成各输出一行，避免处理完成后长时间静默、无法判断进度
                    print(f"🔍 图像分析中：{f}")
                    analyze_and_store(input_path, analysis_path)
                    analyzed += 1
                    print(f"✅ 图像分析完成：{f}")
                except Exception as e:
                    print(f"❌ 分析失败：{f}  {e}")

        if toml_path:
            src = f"/images/photos/{f}"
            if src not in src_to_entry:
                # 宽高取处理后输出图的尺寸；处理失败输出不存在时留空，下次运行由回填逻辑补上
                width, height = "", ""
                if os.path.exists(output_path):
                    width, height = _get_image_size(output_path)
                src_to_entry[src] = {
                    "src": src,
                    "alt": "",
                    "category": "",
                    "focus": exif_info["focus"],
                    "iso": exif_info["iso"],
                    "aperture": exif_info["aperture"],
                    "shutter": exif_info["shutter"],
                    "time": exif_info["time"],
                    "place": "",
                    "location": "",
                    "width": width,
                    "height": height,
                    "camera": exif_info.get("camera", ""),
                    "lens": exif_info.get("lens", ""),
                }

    if toml_path:
        # 每次按输出图实际字节重算哈希：处理/跳过/新条目统一覆盖，避免增量运行
        # 留下过期版本号（缺失输出文件的条目保留既有值，下次有文件时再补）
        for src, entry in src_to_entry.items():
            img_path = os.path.join(output_dir, os.path.basename(src))
            if os.path.exists(img_path):
                try:
                    entry["hash"] = _file_hash(img_path)
                except OSError as e:
                    print(f"⚠️  哈希计算失败：{os.path.basename(src)}  {e}")
        write_toml(toml_path, list(src_to_entry.values()))
        # 分析结果完整性检查：photo.toml 全部条目都应有对应 JSON——src 与
        # 管线输入文件名不一致的照片（人工条目/历史改名）没有生成路径，站点
        # 侧会永久显示失败提示卡；此处告警定位（2026-10-21 审查修复 #5）
        if analysis_dir:
            try:
                missing = [
                    os.path.basename(e["src"])
                    for e in parse_toml_entries(toml_path)
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

    print(f"📊 本次处理 {processed} 张，跳过 {skipped} 张（未变化），分析 {analyzed} 张")
    return processed_files


def _load_config():
    """读取 pipeline_config.json（本管线目录）。照片原图/输出图体积大、不在仓库内，
    输入/输出目录必须由用户配置（未配置则退出并提示）；toml_path 缺省直写站点
    数据源 data/photo.toml。"""
    import json

    BASE_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
    DEFAULTS = {
        "input_dir": "",
        "output_dir": "",
        "toml_path": os.path.abspath(os.path.join(BASE_DIR, "..", "..", "data", "photo.toml")),
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

    for key, default in DEFAULTS.items():
        if not config.get(key):
            config[key] = default

    if not config["input_dir"] or not config["output_dir"]:
        print("❌ 未配置照片输入/输出目录，请填写 pipeline_config.json 后重试")
        return None

    print(f"   输入目录: {config['input_dir']}")
    print(f"   输出目录: {config['output_dir']}")
    print(f"   TOML 路径: {config['toml_path']}")
    print(f"   分析目录: {config['analysis_dir']}")
    return config


def run():
    config = _load_config()
    if not config:
        return
    INPUT_FOLDER = config["input_dir"]
    OUTPUT_FOLDER = config["output_dir"]
    TOML_PATH = config["toml_path"]
    ANALYSIS_DIR = config["analysis_dir"]

    if not os.path.isdir(INPUT_FOLDER):
        print(f"❌ 输入目录不存在：{INPUT_FOLDER}")
        print("   请检查 pipeline_config.json 的 input_dir（原图目录）后重试")
        return

    print("===== 开始处理 =====")
    processed_files = batch_process(INPUT_FOLDER, OUTPUT_FOLDER, toml_path=TOML_PATH,
                                    analysis_dir=ANALYSIS_DIR)
    print("===== 全部完成 =====")

    # 同步新图片到 OSS
    bucket = create_bucket_from_config()
    if bucket:
        print("===== 开始上传 OSS =====")
        sync_new_photos(OUTPUT_FOLDER, bucket, force_files=processed_files)
        print("===== OSS 上传完成 =====")


if __name__ == "__main__":
    run()
