# -*- coding: utf-8 -*-
"""只读核对：列出 OSS images/photos/ 下未被 photo.toml 引用的对象。

用法：python list_orphan_photos.py [photo.toml]

照片改名或从 photo.toml 移除后，旧对象不会再被站点引用，但管线不会自动
清理；本脚本只拉取清单并打印，不执行任何删除。注意：本地删除图片但保留
photo.toml 条目时，对象仍算被引用，不会出现在清单里（2026-11-08）。
"""
import json
import os
import sys
from datetime import datetime

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "src"))

from compat import setup_windows_stdout
setup_windows_stdout()

from oss_utils import create_bucket_from_config
from toml_utils import parse_toml_entries

BASE_DIR = os.path.abspath(os.path.dirname(__file__))
OSS_PREFIX = "images/photos/"


def _format_modified(value):
    """OSS 的 last_modified 可能是时间戳或 ISO 字符串，统一成可读格式"""
    if isinstance(value, (int, float)):
        try:
            return datetime.fromtimestamp(value).strftime("%Y-%m-%d %H:%M:%S")
        except (OSError, ValueError):
            return str(value)
    return str(value)


def _toml_path(cli_arg=""):
    """命令行参数优先；否则读 pipeline_config.json，缺省仓库 data/photo.toml"""
    if cli_arg:
        return os.path.abspath(cli_arg)
    config_path = os.path.join(BASE_DIR, "pipeline_config.json")
    config = {}
    if os.path.exists(config_path):
        try:
            with open(config_path, "r", encoding="utf-8") as f:
                config = json.load(f)
        except Exception as e:
            print(f"⚠️  pipeline_config.json 解析失败：{e}")
    return config.get("toml_path") or os.path.abspath(
        os.path.join(BASE_DIR, "..", "..", "data", "photo.toml"))


def main():
    toml_path = _toml_path(sys.argv[1] if len(sys.argv) > 1 else "")
    if not os.path.exists(toml_path):
        print(f"❌ photo.toml 不存在：{toml_path}")
        return
    try:
        entries = parse_toml_entries(toml_path)
    except Exception as e:
        print(f"❌ photo.toml 解析失败：{e}")
        return

    referenced = {
        os.path.basename(entry.get("src", ""))
        for entry in entries
    }
    referenced.discard("")

    bucket = create_bucket_from_config()
    if not bucket:
        return

    objects = {}
    next_marker = ""
    try:
        while True:
            result = bucket.list_objects(prefix=OSS_PREFIX, marker=next_marker)
            for obj in result.object_list:
                # 只核对照片对象：桶里可能有目录占位对象（key 以 / 结尾）
                # 或其他非图片对象，不应计入孤儿清单
                name = obj.key[len(OSS_PREFIX):] if obj.key.startswith(OSS_PREFIX) else ""
                if name.lower().endswith((".jpg", ".jpeg")):
                    objects[obj.key] = obj
            if result.is_truncated and result.next_marker:
                next_marker = result.next_marker
            else:
                break
    except Exception as e:
        print(f"❌ OSS 对象列表获取失败：{e}")
        return

    orphans = [
        key for key in sorted(objects)
        if key[len(OSS_PREFIX):] not in referenced
    ]
    print(f"☁️  OSS {OSS_PREFIX} 图片对象 {len(objects)} 个，photo.toml 引用 {len(referenced)} 个")
    if not orphans:
        print("✅ 未发现未引用的对象")
        return

    print(f"⚠️  未被 photo.toml 引用的对象 {len(orphans)} 个（只列出，不删除）：")
    for key in orphans:
        obj = objects[key]
        size_kb = (obj.size or 0) / 1024
        print(f"    - {key}  {size_kb:.1f} KB  {_format_modified(obj.last_modified)}")


if __name__ == "__main__":
    main()
