# -*- coding: utf-8 -*-
"""一次性回填：输入图内容哈希写入 data/photos/ 分片的 source_hash 字段。
用法：python backfill_source_hash.py <original_photos目录> <photos目录> [更多目录...]
只读输入图、只改分片（复用 toml_utils 的读写管线），不做图片处理/OSS 上传/
分析重算；用于接入 source_hash 换图检测前跳过首轮全量重处理。"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "src"))
from hash_utils import file_md5
from toml_utils import parse_photo_dir, write_photo_dir


def main():
    if len(sys.argv) < 3:
        print("用法: python backfill_source_hash.py <original_photos目录> <photos目录> [更多目录...]")
        sys.exit(1)
    originals_dir = sys.argv[1]
    photo_dirs = sys.argv[2:]

    for photos_dir in photo_dirs:
        shards = parse_photo_dir(photos_dir)
        total = sum(len(entries) for _, entries in shards)
        filled = 0
        missing_file = 0
        for _name, entries in shards:
            for e in entries:
                name = os.path.basename(e.get("src", ""))
                img_path = os.path.join(originals_dir, name)
                if not name or not os.path.exists(img_path):
                    missing_file += 1
                    continue
                e["source_hash"] = file_md5(img_path)
                filled += 1
        write_photo_dir(photos_dir, shards)
        print(f"{photos_dir}: 回填 source_hash {filled} 条 / 共 {total} 条（输入图缺失 {missing_file} 条）")


if __name__ == "__main__":
    main()
