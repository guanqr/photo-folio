# -*- coding: utf-8 -*-
"""照片 TOML 读写：单文件解析/写回 + data/photos/ 分片目录（按拍摄年份）"""
import os
import re

_CONTROL_RE = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")
# 支持 \" 与 \\ 转义（写侧 _tostr 只产生这两种转义）；严格匹配整行，
# 单引号/数组/多行字符串等不支持语法直接报错，避免静默丢字段
_STR_RE = re.compile(r'^\s*(\w+)\s*=\s*"((?:[^"\\]|\\.)*)"\s*$')
_VALUE_RE = re.compile(r'^\s*(\w+)\s*=\s*(true|false|\d+(?:\.\d+)?)\s*$')

# 站点扩展字段白名单（写入顺序）
FIELDS = [
    "src", "alt", "category", "focus", "iso",
    "aperture", "shutter", "time", "place", "address", "lat", "lng",
    "location", "width", "height",
    "camera", "lens", "hash", "source_hash",
]
# 有值才写的字段
# published = 条目首次写入时的时间戳（main.py 生成，RSS 按此排序；重跑/换图不变），
# 旧条目没有该字段时站点回退拍摄时间（2026-11-12）
CONDITIONAL_FIELDS = ("description", "published", "series", "species", "is_cover", "featured")
KNOWN_FIELDS = set(FIELDS) | set(CONDITIONAL_FIELDS)


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
        for line in block.splitlines():
            s = line.strip()
            if not s or s.startswith("#"):
                continue
            m = _STR_RE.match(line)
            if m:
                entry[m.group(1)] = _fromstr(m.group(2))
                continue
            m = _VALUE_RE.match(line)
            if m:
                entry[m.group(1)] = m.group(2)
                continue
            raise ValueError(
                "照片数据存在无法解析的行（仅支持双引号字符串/布尔/数字）："
                f"{line.strip()!r}")
        if entry:
            if "src" not in entry:
                raise ValueError("照片数据条目缺少 src")
            entries.append(entry)

    return entries


def write_toml(toml_path, entries):
    """按传入顺序写入所有条目（不再按 time 重排）。

    分片内的条目顺序即站点展示顺序（新→旧）：手动调整的前后顺序必须原样
    保留；新条目/换图后 time 变化的条目由 main.py 按拍摄时间插入，回填脚本
    本就按文件顺序传入，重写不会打乱手动排序（2026-11-20）。"""

    # 注意：address/lat/lng 是站点新增字段（详细地址与地理编码坐标，由
    # tools/geocode/geocode-photos.py 生成）、hash 是站点图片 URL 的缓存版本号、
    # source_hash 是输入图内容哈希（换图检测，站点不消费，均由 main.py 生成）
    # ——必须列入白名单，否则管线重写会抹掉它们
    # （featured 字段曾被丢过一次，同一类坑）
    # 未知字段 fail-fast：手工新增字段但未登记白名单时拒绝全量重写，
    # 避免静默丢数据；需先在 FIELDS/CONDITIONAL_FIELDS 注册
    for entry in entries:
        unknown = sorted(set(entry) - KNOWN_FIELDS)
        if unknown:
            raise ValueError(
                f"照片数据条目 {entry.get('src', '?')!r} 含未支持字段 {unknown}；"
                "请先在 toml_utils.FIELDS/CONDITIONAL_FIELDS 注册，拒绝全量重写")

    lines = []
    for i, entry in enumerate(entries):
        if i > 0:
            lines.append("")
        lines.append("[[photo]]")
        for f in FIELDS:
            lines.append(f'{f} = "{_tostr(entry.get(f, ""))}"')
        if entry.get("description"):
            lines.append(f'description = "{_tostr(entry["description"])}"')
        if entry.get("published"):
            lines.append(f'published = "{_tostr(entry["published"])}"')
        if entry.get("series"):
            lines.append(f'series = "{_tostr(entry["series"])}"')
        if entry.get("species"):
            lines.append(f'species = "{_tostr(entry["species"])}"')
        if entry.get("is_cover") == "true":
            lines.append(f'is_cover = {entry["is_cover"]}')
        if entry.get("featured") == "true":
            lines.append('featured = true')

    lines.append("")

    # 原子写 + 固定 LF：照片分片是站点唯一数据源，中断不能留下截断文件；
    # Windows 文本模式默认 CRLF 会让每次重写产生仅行尾差异（2026-10-29）
    from compat import atomic_write_text
    atomic_write_text(toml_path, "\n".join(lines))


# ===== 分片目录（data/photos/）：按拍摄年份拆分，文件内即展示顺序 =====

_YEAR_RE = re.compile(r"^\d{4}$")
_PRE_RE = re.compile(r"^pre-(\d{4})$")


def shard_display_order(names):
    """分片拼接顺序：4 位年份分片降序，其余（pre-YYYY）排最后按名称升序。"""
    years = sorted((n for n in names if _YEAR_RE.match(n)), reverse=True)
    others = sorted(n for n in names if not _YEAR_RE.match(n))
    return years + others


def parse_photo_dir(photos_dir):
    """读取分片目录 → [(name, entries)]，按展示分片顺序（年份降序、其余最后）。"""
    names = []
    if os.path.isdir(photos_dir):
        for fn in os.listdir(photos_dir):
            if fn.lower().endswith(".toml"):
                names.append(fn[:-5])
    shards = {n: parse_toml_entries(os.path.join(photos_dir, n + ".toml")) for n in names}
    return [(n, shards[n]) for n in shard_display_order(names)]


def write_photo_dir(photos_dir, shards):
    """按 [(name, entries)] 写回分片；空分片删除对应文件。"""
    os.makedirs(photos_dir, exist_ok=True)
    for name, entries in shards:
        path = os.path.join(photos_dir, name + ".toml")
        if entries:
            write_toml(path, entries)
        elif os.path.exists(path):
            os.remove(path)


def detect_split_year(names, default=2024):
    """从 pre-YYYY 分片名推断拆分阈值；没有该分片时用默认值。"""
    for n in names:
        m = _PRE_RE.match(n)
        if m:
            return int(m.group(1))
    return default


def assign_shard(entry, split_year):
    """条目 → 分片名：拍摄年份达到阈值进年份分片，否则进 pre-<阈值>（含无时间）。"""
    year = (entry.get("time") or "")[:4]
    if year.isdigit() and int(year) >= split_year:
        return year
    return f"pre-{split_year}"


def insert_by_time_desc(entries, entry):
    """按展示顺序（新→旧）插入：放在第一个更早的条目之前，同刻排在已有之后。"""
    t = entry.get("time") or ""
    pos = len(entries)
    for i, e in enumerate(entries):
        if (e.get("time") or "") < t:
            pos = i
            break
    entries.insert(pos, entry)


def repartition_shards(shards, split_year, moved=(), extra=()):
    """按拍摄年份重新归档分片，保持其余条目的分片内相对顺序。

    shards：解析出的 [(name, entries)]；moved：分片内但 time 已变化、需重新
    定位的条目；extra：本次新增条目。moved/extra 按展示顺序插入目标分片。
    返回按展示分片顺序排列、已去除空分片的结果（2026-11-20）。"""
    moved_srcs = {e["src"] for e in moved}
    by_name = {}
    for name, entries in shards:
        kept = [e for e in entries if e["src"] not in moved_srcs]
        if kept:
            by_name[name] = kept
    for e in list(moved) + list(extra):
        name = assign_shard(e, split_year)
        insert_by_time_desc(by_name.setdefault(name, []), e)
    return [(n, by_name[n]) for n in shard_display_order(by_name)]
