# -*- coding: utf-8 -*-
"""
回填 photo.toml 的 width / height 字段，并剥离已废弃的 orientation 行（零第三方依赖，Python 3.11+）。

注意：常规流程中 width/height 已由预处理管线（tools/photo-pipeline/，上传照片时）生成，
构图方向由站点模板从宽高推导（宽 ≥ 高 = landscape）——orientation 字段已废弃；
本脚本仅在「历史数据未覆盖/预处理管线未生成」时兜底补全宽高。

管线：解析 data/photo.toml（复用 tools/photo-pipeline/src/toml_utils.py）
     → 对缺 width/height 的条目请求 OSS 图片信息接口（?x-oss-process=image/info，
       返回 ImageWidth/ImageHeight，无需下载图片本体）
     → 写回 width/height（write_toml 全量重写，orientation 自然剥离；可重复运行）。

用法：python tools/backfill/backfill-dimensions.py
"""
import json
import re
import sys
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent  # tools/backfill/ → 仓库根（对照 generate-maps.py 同法；少一级会解析到不存在的 tools/hugo.toml 与 tools/data）
PHOTO_PATH = ROOT / "data" / "photo.toml"
TIMEOUT_SEC = 15

sys.path.insert(0, str(ROOT / "tools" / "photo-pipeline" / "src"))
from toml_utils import parse_toml_entries, write_toml  # noqa: E402


def read_cdn_base():
    """读取 hugo.toml 的 imageCDN"""
    cfg = (ROOT / "hugo.toml").read_text(encoding="utf-8")
    m = re.search(r"^[ \t]*imageCDN\s*=\s*\"([^\"]+)\"", cfg, re.M)
    if not m:
        raise RuntimeError("hugo.toml 中未找到 imageCDN")
    return m.group(1).rstrip("/")


def fetch_image_info(cdn_base, src):
    """单条回填：请求 OSS image/info → (width, height)"""
    url = urllib.parse.urljoin(cdn_base + "/", src.lstrip("/"))
    sep = "&" if "?" in url else "?"
    url += f"{sep}x-oss-process=image/info"
    with urllib.request.urlopen(url, timeout=TIMEOUT_SEC) as resp:
        info = json.loads(resp.read().decode("utf-8"))
    w = info.get("ImageWidth", {}).get("value")
    h = info.get("ImageHeight", {}).get("value")
    w, h = int(w), int(h)
    if not (w > 0 and h > 0):
        raise RuntimeError("missing ImageWidth/ImageHeight")
    return str(w), str(h)


def main():
    cdn_base = read_cdn_base()
    entries = parse_toml_entries(str(PHOTO_PATH))
    todo = [e for e in entries if not (e.get("width") and e.get("height"))]
    print(f"共 {len(entries)} 条记录，待回填 {len(todo)} 条")

    done = failed = 0
    for e in todo:
        try:
            e["width"], e["height"] = fetch_image_info(cdn_base, e["src"])
            done += 1
            print(f"✓ {e['src']}  {e['width']}x{e['height']}")
        except Exception as err:
            failed += 1
            print(f"✗ {e['src']}  {err}")

    if done:
        write_toml(str(PHOTO_PATH), entries)
    print(f"完成：成功 {done}，失败 {failed}，已写回 data/photo.toml")


if __name__ == "__main__":
    main()
