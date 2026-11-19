# -*- coding: utf-8 -*-
"""跨脚本复用的小工具：Windows stdout UTF-8、原子写、JS 取整。

管线/回填/地图脚本各自曾复制这几段逻辑；集中在这里，避免只修一处
（2026-10-31）。各脚本仍可按自身 sys.path 直接 import。
"""
import io
import os
import sys


def setup_windows_stdout():
    """Windows 控制台/管道默认编码无法输出 ✓/✗ 等符号：把 stdout 重包 UTF-8。

    必须保留行缓冲：旧实现 detach + codecs.StreamWriter 丢掉了 TextIOWrapper
    的 line_buffering，print 攒满 8KB 才刷出，处理期间看不到进度、结束后才
    一次性输出（2026-11-19 实测）。reconfigure 失败（IDE 替换过 stdout 等）
    时退回显式行缓冲的 TextIOWrapper，write_through 避免再叠一层缓冲。"""
    if not sys.platform.startswith("win"):
        return
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace", line_buffering=True)
    except Exception:
        try:
            sys.stdout = io.TextIOWrapper(
                sys.stdout.detach(), encoding="utf-8", errors="replace",
                line_buffering=True, write_through=True)
        except Exception:
            pass


def _atomic_write(path, writer):
    tmp = path + ".tmp"
    try:
        writer(tmp)
        os.replace(tmp, path)
    except Exception:
        try:
            os.remove(tmp)
        except OSError:
            pass
        raise


def atomic_write_bytes(path, data):
    def writer(tmp):
        with open(tmp, "wb") as f:
            f.write(data)
    _atomic_write(path, writer)


def atomic_write_text(path, text, newline="\n"):
    def writer(tmp):
        with open(tmp, "w", encoding="utf-8", newline=newline) as f:
            f.write(text)
    _atomic_write(path, writer)


def js_round(x):
    """对齐 JS Math.round 的半入舍入（Python round 是银行家舍入）。"""
    return int(x + 0.5)
