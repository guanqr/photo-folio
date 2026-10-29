# -*- coding: utf-8 -*-
"""水印生成与图片处理"""
import os
from io import BytesIO
from PIL import Image, ImageDraw, ImageFont


def get_region_brightness(img, box):
    """计算指定区域（水印文字实际渲染 bbox）的平均亮度 0~255"""
    left, top, right, bottom = box
    left = max(0, int(left))
    top = max(0, int(top))
    right = min(img.width, int(right))
    bottom = min(img.height, int(bottom))
    # 防御：bbox 退化时退回全图平均（正常文字 bbox 不会为空）
    crop_img = (img.crop((left, top, right, bottom)) if right > left and bottom > top else img).convert("L")
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

    # 只取水印文字实际渲染区域判断明暗：整条底部平均会被左右暗部拉低，
    # 水印所在中间偏亮时误选白字（2026-10-29）
    try:
        region = draw.textbbox((x, y), final_text, font=font)
    except AttributeError:
        region = (x, y, x + w, y + h)
    bright = get_region_brightness(img, region)
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
        while quality >= 10:
            buf = BytesIO()
            img_watermark.save(buf, "JPEG", quality=quality, optimize=True)
            if buf.tell() / 1024 <= max_size_kb:
                break
            quality -= 5

        # 终检：质量 10 仍超限时告警（此前循环在 15 处提前退出、无任何提示，
        # 输出静默超过 400KB 上限，2026-10-18）
        if buf.tell() / 1024 > max_size_kb:
            print(f"⚠️  {os.path.basename(input_path)} 质量已降至 10 仍 "
                  f"{buf.tell() / 1024:.0f}KB > {max_size_kb}KB 上限")

        # 原子写：中断/磁盘满不留下截断的 JPEG——源图未变时增量检测会跳过
        # 已存在的输出，坏文件会一直被当作最新结果（2026-10-29）
        tmp_path = output_path + ".tmp"
        try:
            with open(tmp_path, "wb") as f:
                f.write(buf.getvalue())
            os.replace(tmp_path, output_path)
        except Exception:
            try:
                os.remove(tmp_path)
            except OSError:
                pass
            raise
