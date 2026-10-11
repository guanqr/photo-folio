# -*- coding: utf-8 -*-
"""项目入口 — 在项目根目录执行 python run.py"""
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "src"))

from main import run

if __name__ == "__main__":
    run()
