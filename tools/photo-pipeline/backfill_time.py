# -*- coding: utf-8 -*-
"""一次性回填：从原始照片读取 EXIF 拍摄时刻，写入 photo.toml 的 time 字段。
用法：python backfill_time.py <original_photos目录> <photo.toml> [更多 toml...]
只读 EXIF、只改 toml（复用 toml_utils 的读写管线），不做图片处理/OSS 上传/
分析重算。无法读出时刻的条目保持原值——time 是站点排序与展示的必需字段，
写空会让构建期 time.Format 报错（与 backfill_camera_lens 的留空口径不同）。"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "src"))
from exif_utils import get_exif_info
from toml_utils import parse_toml_entries, write_toml


def main():
    if len(sys.argv) < 3:
        print("用法: python backfill_time.py <original_photos目录> <photo.toml> [更多 toml...]")
        sys.exit(1)
    photos_dir = sys.argv[1]
    toml_paths = sys.argv[2:]

    for toml_path in toml_paths:
        entries = parse_toml_entries(toml_path)
        updated = 0
        kept = 0
        missing_file = 0
        for e in entries:
            name = os.path.basename(e.get("src", ""))
            img_path = os.path.join(photos_dir, name)
            if not name or not os.path.exists(img_path):
                missing_file += 1
                kept += 1
                continue
            t = get_exif_info(img_path).get("time", "")
            if t and t != e.get("time"):
                e["time"] = t
                updated += 1
            else:
                kept += 1
        write_toml(toml_path, entries)
        print(f"{toml_path}: 回填拍摄时刻 {updated} 条 / 共 {len(entries)} 条"
              f"（无时刻或无变化 {kept} 条，原始图缺失 {missing_file} 条）")


if __name__ == "__main__":
    main()
