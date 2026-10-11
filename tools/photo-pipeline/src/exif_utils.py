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
        for tag_id, value in exif_data.items():
            tag = TAGS.get(tag_id, tag_id)
            try:
                if tag == "FocalLength":
                    info["focus"] = str(round(float(value)))
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
                        frac = Fraction(v).limit_denominator(4000)
                        info["shutter"] = f"{frac.numerator}/{frac.denominator}"
                elif tag == "DateTimeOriginal":
                    if value and len(str(value)) >= 10:
                        info["time"] = str(value)[:10].replace(":", "-")
                elif tag == "DateTime" and not info["time"]:
                    if value and len(str(value)) >= 10:
                        info["time"] = str(value)[:10].replace(":", "-")
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
    except Exception:
        pass
    return info


def get_year(exif_info):
    """从 exif_info 的 time 字段提取年份"""
    t = exif_info.get("time", "")
    return t[:4] if len(t) >= 4 else ""
