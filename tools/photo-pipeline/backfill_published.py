# -*- coding: utf-8 -*-
"""一次性回填：按 git 提交历史把每个作品首次出现的提交时间写入 published。
用法：python backfill_published.py <photos目录>
已有 published 不覆盖；无法溯源的条目保留空值（站点 RSS 回退拍摄时间）。
历史数据源兼容迁移前的 data/photo.toml 与迁移后的 data/photos/*.toml。
只读 git 历史、只改分片，不做图片处理/上传/分析。"""
import os
import subprocess
import sys
import tomllib

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "src"))
from compat import setup_windows_stdout
setup_windows_stdout()
from toml_utils import parse_photo_dir, write_photo_dir

LEGACY_PATH = "data/photo.toml"  # 分片迁移前的单一数据源（历史溯源用）


def _git(args, cwd):
    return subprocess.run(
        ["git", "-C", cwd, *args], check=True,
        capture_output=True, text=True, encoding="utf-8").stdout


def _commit_entries(commit, path, repo_root):
    """读取某提交下某个 TOML 文件的 photo 条目；文件不存在/已删除返回空。"""
    try:
        content = _git(["show", f"{commit}:{path}"], repo_root)
    except subprocess.CalledProcessError:
        return []
    # 历史版本含行内注释/旧字段，用 tomllib 读（当前严格解析器只服务重写）
    return tomllib.loads(content).get("photo", [])


def main():
    if len(sys.argv) < 2:
        print("用法: python backfill_published.py <photos目录>")
        sys.exit(1)
    photos_dir = os.path.abspath(sys.argv[1])
    repo_root = _git(["rev-parse", "--show-toplevel"], os.path.dirname(photos_dir)).strip()
    rel_dir = os.path.relpath(photos_dir, repo_root).replace(os.sep, "/")

    # 按时间正序取所有触及分片目录或旧数据文件的提交：src 首次出现即发布时刻
    # （%cI = 严格 ISO 8601 提交时间，与管线写入的 published 同格式）
    log = _git(
        ["log", "--reverse", "--format=%H%x1f%cI", "--", rel_dir, LEGACY_PATH],
        repo_root)
    commits = [line.split("\x1f", 1) for line in log.splitlines() if "\x1f" in line]

    first_seen = {}
    for commit, iso in commits:
        paths = _git(
            ["ls-tree", "-r", "--name-only", commit, "--", rel_dir, LEGACY_PATH],
            repo_root)
        for path in (p for p in paths.splitlines() if p.endswith(".toml")):
            for entry in _commit_entries(commit, path, repo_root):
                first_seen.setdefault(entry["src"], iso)

    shards = parse_photo_dir(photos_dir)
    total = sum(len(entries) for _, entries in shards)
    filled = kept = missing = 0
    for _name, entries in shards:
        for entry in entries:
            if entry.get("published"):
                kept += 1
                continue
            iso = first_seen.get(entry["src"])
            if iso:
                entry["published"] = iso
                filled += 1
            else:
                missing += 1
                print(f"⚠️  无法溯源：{entry['src']}（保留空值，RSS 回退拍摄时间）")

    write_photo_dir(photos_dir, shards)
    print(f"{photos_dir}: 回填 published {filled} 条 / 共 {total} 条"
          f"（已有 {kept} 条保留，无法溯源 {missing} 条）")


if __name__ == "__main__":
    main()
