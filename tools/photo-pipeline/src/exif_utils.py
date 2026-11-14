# -*- coding: utf-8 -*-
"""EXIF 信息提取"""
import re
from PIL import Image
from PIL.ExifTags import TAGS
from fractions import Fraction

_CONTROL_RE = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")


def _clean(value):
    """去除 EXIF 字符串中可能携带的控制字符（如末尾 NUL），保证写入 TOML 合法"""
    return _CONTROL_RE.sub("", str(value)).strip()


def _normalize_time(value):
    """EXIF 日期时间 → "YYYY-MM-DD HH:MM:SS"（保留拍摄时刻，2026-11-14）。

    此前只取前 10 位、时刻被丢弃，同日作品只能按 photo.toml 数组顺序排。
    只替换日期段的前两个冒号；不足 19 位（仅日期）时退回日期串。
    注意不能写成 "YYYY-MM-DD HH:MM"：Hugo 的 time 解析只认带秒的
    "2006-01-02 15:04:05" 与纯日期，"15:04" 会直接报错（实测 0.169）。"""
    s = _clean(value)
    if len(s) < 10:
        return ""
    date = s[:10].replace(":", "-")
    rest = s[10:19]
    if len(rest) == 9 and rest[0] in (" ", "T") and rest[3] == ":":
        return date + rest
    return date


def get_exif_info(image_path):
    """从 EXIF 中提取：focus, iso, aperture, shutter, time, camera, lens（宽高由 main.py 从处理后输出图读取）"""
    info = {
        "focus": "",
        "iso": "",
        "aperture": "",
        "shutter": "",
        "time": "",
        "camera": "",
        "lens": "",
    }
    try:
        img = Image.open(image_path)
        exif_data = img._getexif()
        if not exif_data:
            return info

        make = ""
        focal_raw = None
        focal_35mm = None
        for tag_id, value in exif_data.items():
            tag = TAGS.get(tag_id, tag_id)
            try:
                if tag == "FocalLength":
                    focal_raw = float(value)
                elif tag == "FocalLengthIn35mmFilm" or tag_id == 41989:
                    focal_35mm = float(value)
                elif tag == "ISOSpeedRatings":
                    info["iso"] = str(int(value))
                elif tag == "FNumber":
                    v = float(value)
                    if v == int(v):
                        info["aperture"] = str(int(v))
                    else:
                        info["aperture"] = f"{v:.1f}"
                elif tag == "ExposureTime":
                    v = float(value)
                    if v >= 1:
                        info["shutter"] = str(int(v)) if v == int(v) else f"{v:.1f}"
                    else:
                        # 分母上限须覆盖电子快门：1/8000、1/12800 等；原上限
                        # 4000 会把 1/8000 压成 1/4000、1/12800 退化成 0/1
                        # （2026-10-25 实测）——放到 1,000,000 可保留常见快门
                        frac = Fraction(v).limit_denominator(1000000)
                        info["shutter"] = f"{frac.numerator}/{frac.denominator}"
                elif tag == "DateTimeOriginal":
                    t = _normalize_time(value)
                    if t:
                        info["time"] = t
                elif tag == "DateTime" and not info["time"]:
                    t = _normalize_time(value)
                    if t:
                        info["time"] = t
                elif tag == "Make":
                    make = _clean(value)
                elif tag == "Model":
                    model = _clean(value)
                    # 相机：优先用 Model（通常已含品牌）；Model 缺品牌时补 Make
                    if model:
                        info["camera"] = model if make and make.split()[0].lower() in model.lower() else f"{make} {model}".strip()
                elif tag_id in (42036,):  # LensModel（PIL 旧版本 TAGS 未收录）
                    info["lens"] = _clean(value)
                elif tag == "LensMake" and not info["lens"]:
                    info["lens"] = _clean(value)
            except Exception:
                pass

        # 焦距优先取 35mm 等效（FocalLengthIn35mmFilm，41989）：手机物理焦距
        # 仅 4–15mm，与全画幅镜头不可比；缺失、为 0 或非法时回退物理焦距
        # （FocalLength，37386）。两者都无效保持空串（2026-11-04）
        focal = focal_35mm if focal_35mm and focal_35mm > 0 else focal_raw
        if focal is not None and focal > 0:
            info["focus"] = str(round(focal))
    except Exception:
        pass
    return info


def get_year(exif_info):
    """从 exif_info 的 time 字段提取年份"""
    t = exif_info.get("time", "")
    return t[:4] if len(t) >= 4 else ""
