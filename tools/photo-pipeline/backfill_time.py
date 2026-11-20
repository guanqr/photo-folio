# -*- coding: utf-8 -*-
"""一次性回填：从原始照片读取 EXIF 拍摄时刻，写入 data/photos/ 分片的 time 字段。
用法：python backfill_time.py <original_photos目录> <photos目录> [更多目录...]
只读 EXIF、只改分片（复用 toml_utils 的读写管线），不做图片处理/OSS 上传/
分析重算。无法读出时刻的条目保持原值——time 是站点排序与展示的必需字段，
写空会让构建期 time.Format 报错（与 backfill_camera_lens 的留空口径不同）。
time 变化后按拍摄年份重新归档分片，并在分片内按展示顺序重新定位。"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "src"))
from exif_utils import get_exif_info
from toml_utils import (
    detect_split_year, parse_photo_dir, repartition_shards, write_photo_dir)


def main():
    if len(sys.argv) < 3:
        print("用法: python backfill_time.py <original_photos目录> <photos目录> [更多目录...]")
        sys.exit(1)
    originals_dir = sys.argv[1]
    photo_dirs = sys.argv[2:]

    for photos_dir in photo_dirs:
        shards = parse_photo_dir(photos_dir)
        split_year = detect_split_year([name for name, _ in shards])
        total = sum(len(entries) for _, entries in shards)
        updated = kept = missing_file = 0
        changed = []
        for _name, entries in shards:
            for e in entries:
                name = os.path.basename(e.get("src", ""))
                img_path = os.path.join(originals_dir, name)
                if not name or not os.path.exists(img_path):
                    missing_file += 1
                    kept += 1
                    continue
                t = get_exif_info(img_path).get("time", "")
                if t and t != e.get("time"):
                    e["time"] = t
                    changed.append(e)
                    updated += 1
                else:
                    kept += 1
        shards = repartition_shards(shards, split_year, moved=changed)
        write_photo_dir(photos_dir, shards)
        print(f"{photos_dir}: 回填拍摄时刻 {updated} 条 / 共 {total} 条"
              f"（无时刻或无变化 {kept} 条，原始图缺失 {missing_file} 条）")


if __name__ == "__main__":
    main()
