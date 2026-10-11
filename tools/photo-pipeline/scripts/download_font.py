# -*- coding: utf-8 -*-
"""从 Google Fonts 自动下载 NotoSans-Bold.ttf 字体文件"""
import os
import sys
import urllib.request
import zipfile
from io import BytesIO

FONTS_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "fonts")
FONT_FILE = "NotoSans-Bold.ttf"


def download():
    os.makedirs(FONTS_DIR, exist_ok=True)
    font_path = os.path.join(FONTS_DIR, FONT_FILE)

    if os.path.exists(font_path):
        print(f"✓ 字体已存在: fonts/{FONT_FILE}")
        return

    print("正在下载 Noto Sans Bold 字体...")
    url = "https://fonts.google.com/download?family=Noto+Sans"

    try:
        req = urllib.request.Request(
            url,
            headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"},
        )
        with urllib.request.urlopen(req, timeout=30) as resp:
            zip_data = resp.read()

        with zipfile.ZipFile(BytesIO(zip_data)) as zf:
            for name in zf.namelist():
                lower = name.lower()
                if lower.endswith(".ttf") and "bold" in lower and "notosans" in lower:
                    with zf.open(name) as src:
                        with open(font_path, "wb") as dst:
                            dst.write(src.read())
                    print(f"✓ 下载完成: fonts/{FONT_FILE}")
                    return

            # 没找到精确匹配，列出 ZIP 内容帮助排查
            print("✗ 未在压缩包中找到 Bold 字体，ZIP 内包含以下文件:")
            for name in zf.namelist()[:30]:
                print(f"  {name}")
            sys.exit(1)

    except Exception as e:
        print(f"✗ 自动下载失败: {e}")
        print()
        print("请手动下载字体:")
        print("  1. 打开 https://fonts.google.com/specimen/Noto+Sans")
        print('  2. 点击右上角 "Download family"')
        print('  3. 解压后将 NotoSans-Bold.ttf 放入 fonts/ 文件夹')
        sys.exit(1)


if __name__ == "__main__":
    download()
