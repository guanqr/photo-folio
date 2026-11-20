# -*- coding: utf-8 -*-
"""一次性回填：从原始照片读取 EXIF 相机/镜头信息，写入 data/photos/ 分片。
用法：python backfill_camera_lens.py <original_photos目录> <photos目录> [更多目录...]
只读 EXIF、只改分片（复用 toml_utils 的读写管线），不做图片处理/OSS 上传；
读不到相机/镜头的照片字段留空（站点灯箱以删除线样式展示）。"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "src"))
from exif_utils import get_exif_info
from toml_utils import parse_photo_dir, write_photo_dir


def main():
    if len(sys.argv) < 3:
        print("用法: python backfill_camera_lens.py <original_photos目录> <photos目录> [更多目录...]")
        sys.exit(1)
    originals_dir = sys.argv[1]
    photo_dirs = sys.argv[2:]

    for photos_dir in photo_dirs:
        shards = parse_photo_dir(photos_dir)
        total = sum(len(entries) for _, entries in shards)
        updated = 0
        missing_file = 0
        for _name, entries in shards:
            for e in entries:
                name = os.path.basename(e.get("src", ""))
                img_path = os.path.join(originals_dir, name)
                if not os.path.exists(img_path):
                    missing_file += 1
                    continue
                info = get_exif_info(img_path)
                if e.get("camera") != info["camera"] or e.get("lens") != info["lens"]:
                    e["camera"] = info["camera"]
                    e["lens"] = info["lens"]
                    updated += 1
        write_photo_dir(photos_dir, shards)
        print(f"{photos_dir}: 更新 {updated} 条 / 共 {total} 条（原始图缺失 {missing_file} 条）")


if __name__ == "__main__":
    main()
