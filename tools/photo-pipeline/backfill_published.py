# -*- coding: utf-8 -*-
"""一次性回填：按 git 提交历史把每个作品首次出现的提交时间写入 published。
用法：python backfill_published.py <photo.toml>
已有 published 不覆盖；早于 photo.toml 首次提交、无法溯源的条目保留空值
（站点 RSS 回退拍摄时间）。只读 git 历史、只改 toml，不做图片处理/上传/分析。"""
import os
import subprocess
import sys
import tomllib

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "src"))
from compat import setup_windows_stdout
setup_windows_stdout()
from toml_utils import parse_toml_entries, write_toml


def _git(args, cwd):
    return subprocess.run(
        ["git", "-C", cwd, *args], check=True,
        capture_output=True, text=True, encoding="utf-8").stdout


def main():
    if len(sys.argv) < 2:
        print("用法: python backfill_published.py <photo.toml>")
        sys.exit(1)
    toml_path = os.path.abspath(sys.argv[1])
    toml_dir = os.path.dirname(toml_path)
    repo_root = _git(["rev-parse", "--show-toplevel"], toml_dir).strip()
    rel_path = os.path.relpath(toml_path, repo_root).replace(os.sep, "/")

    # 按时间正序取所有触及该文件的提交：src 首次出现即发布时刻
    # （%cI = 严格 ISO 8601 提交时间，与管线写入的 published 同格式）
    log = _git(["log", "--reverse", "--format=%H%x1f%cI", "--", rel_path], repo_root)
    commits = [line.split("\x1f", 1) for line in log.splitlines() if "\x1f" in line]

    first_seen = {}
    for commit, iso in commits:
        try:
            content = _git(["show", f"{commit}:{rel_path}"], repo_root)
        except subprocess.CalledProcessError:
            continue  # 该提交删除了文件，跳过
        # 历史版本含行内注释/旧字段，用 tomllib 读（当前严格解析器只服务重写）
        for entry in tomllib.loads(content).get("photo", []):
            first_seen.setdefault(entry["src"], iso)

    entries = parse_toml_entries(toml_path)
    filled = kept = missing = 0
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

    write_toml(toml_path, entries)
    print(f"{toml_path}: 回填 published {filled} 条 / 共 {len(entries)} 条"
          f"（已有 {kept} 条保留，无法溯源 {missing} 条）")


if __name__ == "__main__":
    main()
