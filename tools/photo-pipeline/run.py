# -*- coding: utf-8 -*-
"""项目入口：python run.py [--force]（管线目录或仓库根目录执行均可）"""
import argparse
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "src"))

from main import run

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="照片水印/缩放/压缩与分析管线")
    parser.add_argument("--force", action="store_true", help="忽略增量检测，重新处理全部照片")
    args = parser.parse_args()
    run(force=args.force)
