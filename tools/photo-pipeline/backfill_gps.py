# -*- coding: utf-8 -*-
"""一次性回填：从原始照片读取 EXIF GPS 坐标，写入 data/photos/ 分片的 lat/lng。
用法：python backfill_gps.py <original_photos目录> <photos目录> [更多目录...]
只读 EXIF、只改分片（复用 toml_utils 的读写管线），不做图片处理/OSS 上传。
自带 GPS 的坐标覆盖已有值（EXIF 实测位置优先于 address 地理编码）；
读不到坐标的条目保持原值，不抹掉地理编码结果。"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "src"))
from compat import setup_windows_stdout
setup_windows_stdout()
from exif_utils import get_exif_info
from toml_utils import parse_photo_dir, write_photo_dir


def main():
    if len(sys.argv) < 3:
        print("用法: python backfill_gps.py <original_photos目录> <photos目录> [更多目录...]")
        sys.exit(1)
    originals_dir = sys.argv[1]
    photo_dirs = sys.argv[2:]

    for photos_dir in photo_dirs:
        shards = parse_photo_dir(photos_dir)
        total = sum(len(entries) for _, entries in shards)
        updated = 0
        kept = 0
        missing_file = 0
        for _name, entries in shards:
            for e in entries:
                name = os.path.basename(e.get("src", ""))
                img_path = os.path.join(originals_dir, name)
                if not name or not os.path.exists(img_path):
                    missing_file += 1
                    kept += 1
                    continue
                info = get_exif_info(img_path)
                lat, lng = info.get("lat", ""), info.get("lng", "")
                if lat and lng and (lat != e.get("lat") or lng != e.get("lng")):
                    e["lat"], e["lng"] = lat, lng
                    updated += 1
                    print(f"✓ {name} → {lat}, {lng}")
                else:
                    kept += 1
        write_photo_dir(photos_dir, shards)
        print(f"{photos_dir}: 回填 GPS 坐标 {updated} 条 / 共 {total} 条"
              f"（无坐标或无变化 {kept} 条，原始图缺失 {missing_file} 条）")


if __name__ == "__main__":
    main()
