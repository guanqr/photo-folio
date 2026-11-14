#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""样式标尺自检：SCSS 的间距与字号必须走 token。

用法：
    python tools/style-lint/check_style.py [scss目录]
    缺省检查 themes/photofolio/assets/scss。

规则：
- 间距属性（margin/padding/gap 及方向变体）的值里不得出现 em/rem 字面量；
  只允许 0、auto、var(...)；确需例外的行加 `style-lint-ignore` 注释
- font-size 只允许 var(--size-*) / var(--base-font-size ...)；
  展示级 3em / 6em（空状态图标、404 大字）为例外
- 注释里的数值不参与检查；`var(...)` 内部的默认值也不算字面量
"""
import os
import re
import sys

DEFAULT_DIR = os.path.join(
    os.path.dirname(os.path.abspath(__file__)), "..", "..",
    "themes", "photofolio", "assets", "scss")

SPACING_PROPS = {
    "margin", "margin-top", "margin-bottom", "margin-left", "margin-right",
    "padding", "padding-top", "padding-bottom", "padding-left", "padding-right",
    "gap", "row-gap", "column-gap",
}
# 展示级字号白名单（与 CLAUDE.md 的「字号唯一标尺」例外一致）
DISPLAY_FONT_SIZES = {"3em", "6em"}
MARKER = "style-lint-ignore"

# 匹配一行内的每个声明（支持单行多声明；伪类选择器会匹配出非属性名，后续被忽略）
DECL_RE = re.compile(r"(?:^|[;{])\s*([a-zA-Z-]+)\s*:\s*([^;}]+)")
VAR_RE = re.compile(r"var\([^()]*\)")
UNIT_RE = re.compile(r"-?\d+(?:\.\d+)?(?:em|rem)\b")
BLOCK_COMMENT_RE = re.compile(r"/\*.*?\*/")


def strip_comments(line):
    """去掉行内注释，避免注释里的数值（如「0.5em 边距」）误报"""
    return re.sub(r"//.*$", "", BLOCK_COMMENT_RE.sub("", line))


def check_file(path, errors):
    with open(path, "r", encoding="utf-8") as f:
        lines = f.read().splitlines()
    for idx, raw in enumerate(lines, 1):
        code = strip_comments(raw)
        for m in DECL_RE.finditer(code):
            prop, value = m.group(1), m.group(2).strip()
            if prop in SPACING_PROPS:
                # var(...) 内部的默认值不计入；剩余部分再找 em/rem 字面量
                if UNIT_RE.search(VAR_RE.sub("", value)) and MARKER not in raw:
                    errors.append((path, idx, prop, value))
            elif prop == "font-size":
                if "var(" in value:
                    continue
                if (UNIT_RE.search(value) and value not in DISPLAY_FONT_SIZES
                        and MARKER not in raw):
                    errors.append((path, idx, prop, value))


def main():
    target = os.path.abspath(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_DIR
    if not os.path.isdir(target):
        print(f"目录不存在：{target}")
        return 2

    errors = []
    files = 0
    for root, _dirs, names in os.walk(target):
        for name in sorted(names):
            if name.endswith(".scss"):
                files += 1
                check_file(os.path.join(root, name), errors)

    if not errors:
        print(f"样式标尺检查通过：{files} 个 SCSS 文件")
        return 0

    for path, line, prop, value in errors:
        rel = os.path.relpath(path, target)
        print(f"{rel}:{line}: {prop}: {value}"
              f"（请改用 --space-* / --size-* token；确属例外加 {MARKER} 注释）")
    print(f"\n共 {len(errors)} 处间距/字号字面量，检查未通过")
    return 1


if __name__ == "__main__":
    sys.exit(main())
