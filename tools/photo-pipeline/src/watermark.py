# -*- coding: utf-8 -*-
"""水印生成与图片处理"""
import os
from io import BytesIO
from PIL import Image, ImageDraw, ImageFont


def get_region_brightness(img, region_h=100):
    """截取图片底部区域，计算平均亮度 0~255"""
    w, h = img.size
    crop_box = (0, h - region_h, w, h)
    crop_img = img.crop(crop_box).convert("L")
    try:
        pixels = list(crop_img.get_flattened_data())
    except AttributeError:
        pixels = list(crop_img.getdata())
    return sum(pixels) / len(pixels)


def add_watermark(img, text="Guanqr Photography", opacity=0.6, photo_year=""):
    """底部居中加水印，自动按明暗选黑白"""
    img = img.convert("RGBA")

    watermark_layer = Image.new("RGBA", img.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(watermark_layer)

    font_size = 24

    font_path = os.path.join(os.path.dirname(__file__), "..", "fonts", "NotoSans-Bold.ttf")
    try:
        font = ImageFont.truetype(font_path, font_size)
    except Exception:
        font = ImageFont.load_default()

    if photo_year and len(photo_year) == 4:
        final_text = f"{text} @ {photo_year}"
    else:
        final_text = text

    try:
        _, _, w, h = draw.textbbox((0, 0), final_text, font=font)
    except AttributeError:
        w, h = draw.textsize(final_text, font=font)

    x = (img.width - w) // 2
    y = img.height - h - 25

    bright = get_region_brightness(img, region_h=100)
    alpha = int(255 * opacity)
    fill = (0, 0, 0, alpha) if bright > 127 else (255, 255, 255, alpha)

    draw.text((x, y), final_text, font=font, fill=fill)
    img = Image.alpha_composite(img, watermark_layer)
    return img.convert("RGB")


def process_image(input_path, output_path, exif_info, target_long_side=1920, max_size_kb=400):
    """单张处理：缩放 → 水印 → 压缩"""
    from exif_utils import get_year

    photo_year = get_year(exif_info)

    with Image.open(input_path) as img:
        img = img.convert("RGB")
        original_w, original_h = img.size

        if original_w >= original_h:
            new_w = target_long_side
            new_h = int(target_long_side * original_h / original_w)
        else:
            new_h = target_long_side
            new_w = int(target_long_side * original_w / original_h)

        img_resized = img.resize((new_w, new_h), Image.LANCZOS)
        img_watermark = add_watermark(img_resized, photo_year=photo_year)

        quality = 95
        while quality > 10:
            buf = BytesIO()
            img_watermark.save(buf, "JPEG", quality=quality, optimize=True)
            if buf.tell() / 1024 <= max_size_kb:
                break
            quality -= 5

        with open(output_path, "wb") as f:
            f.write(buf.getvalue())
