# -*- coding: utf-8 -*-
"""photo.toml 读写与排序"""
import os
import re

_CONTROL_RE = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")
# 字符串行正则：支持 \" 与 \\ 转义（写侧 _tostr 只产生这两种转义）
_STR_RE = re.compile(r'^(\w+)\s*=\s*"((?:[^"\\]|\\.)*)"')


def _clean(value):
    """写 TOML 前去除字符串中的控制字符（EXIF 可能携带末尾 NUL 等，否则 TOML 解析失败）"""
    return _CONTROL_RE.sub("", value)


def _tostr(value):
    """写 TOML 前的统一清洗：去控制字符 + 转义反斜杠与双引号（TOML 基本字符串）。
    此前原样拼接会让值含引号/反斜杠时生成非法 TOML、全量重写损坏字段（2026-10-18）"""
    return _clean(value).replace("\\", "\\\\").replace('"', '\\"')


def _fromstr(value):
    """_tostr 的逆操作：先还原转义引号、再还原转义反斜杠——顺序不可颠倒，
    反了会把 `\\\"`（转义反斜杠 + 转义引号）吞掉一层反斜杠"""
    return value.replace('\\"', '"').replace("\\\\", "\\")


def parse_toml_entries(toml_path):
    """解析 TOML，返回条目列表 [{src, alt, category, ...}]"""
    entries = []
    if not os.path.exists(toml_path):
        return entries

    with open(toml_path, "r", encoding="utf-8") as f:
        content = f.read()

    for block in content.split("[[photo]]"):
        block = block.strip()
        if not block:
            continue
        entry = {}
        for line in block.split("\n"):
            m = _STR_RE.match(line)
            if m:
                entry[m.group(1)] = _fromstr(m.group(2))
            else:
                # 匹配非引号值：布尔值（true/false）或数字
                m = re.match(r'^(\w+)\s*=\s*(true|false|\d+(?:\.\d+)?)', line)
                if m:
                    entry[m.group(1)] = m.group(2)
        if entry:
            entries.append(entry)

    return entries


def write_toml(toml_path, entries):
    """按 time 升序写入所有条目，无时间排最后"""
    def sort_key(e):
        t = e.get("time", "")
        return t if t else "z"

    entries.sort(key=sort_key)

    # 注意：address/lat/lng 是站点新增字段（详细地址与地理编码坐标，由
    # tools/geocode/geocode-photos.py 生成）、hash 是站点图片 URL 的缓存版本号、
    # source_hash 是输入图内容哈希（换图检测，站点不消费，均由 main.py 生成）
    # ——必须列入白名单，否则管线重写会抹掉它们
    # （featured 字段曾被丢过一次，同一类坑）
    FIELDS = [
        "src", "alt", "category", "focus", "iso",
        "aperture", "shutter", "time", "place", "address", "lat", "lng",
        "location", "width", "height",
        "camera", "lens", "hash", "source_hash",
    ]

    lines = []
    for i, entry in enumerate(entries):
        if i > 0:
            lines.append("")
        lines.append("[[photo]]")
        for f in FIELDS:
            lines.append(f'{f} = "{_tostr(entry.get(f, ""))}"')
        if entry.get("description"):
            lines.append(f'description = "{_tostr(entry["description"])}"')
        if entry.get("series"):
            lines.append(f'series = "{_tostr(entry["series"])}"')
        if entry.get("is_cover") == "true":
            lines.append(f'is_cover = {entry["is_cover"]}')
        if entry.get("featured") == "true":
            lines.append('featured = true')

    lines.append("")

    # 原子写 + 固定 LF：photo.toml 是站点唯一数据源，中断不能留下截断文件；
    # Windows 文本模式默认 CRLF 会让每次重写产生仅行尾差异（2026-10-29）
    tmp_path = toml_path + ".tmp"
    try:
        with open(tmp_path, "w", encoding="utf-8", newline="\n") as f:
            f.write("\n".join(lines))
        os.replace(tmp_path, toml_path)
    except Exception:
        try:
            os.remove(tmp_path)
        except OSError:
            pass
        raise
