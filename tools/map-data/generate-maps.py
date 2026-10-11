# -*- coding: utf-8 -*-
"""
一次性生成「地图足迹」所需的静态几何数据（零第三方依赖，Python 3.11+）。

管线（陆地 / 省级边界两条）：
  下载源 GeoJSON（优先 jsDelivr CDN 镜像；缓存于本目录 vendor/，不入库）
  → Douglas-Peucker 简化（容差逐级加强直到体积达标）
  → 量化成整数对（陆地 0.05° = ×20；省界 0.005° = ×200，
    口径写入文件头 {quant, data} 由渲染端还原）→ 删除连续重复点 → 输出静态 JSON。

用法：python tools/map-data/generate-maps.py
输出（提交入库）：
  themes/photofolio/static/maps/land-10m.json   —— 世界陆地（Natural Earth 10m，精细海岸线）
  themes/photofolio/static/maps/provinces.json  —— 中国省级边界线（含港澳台，剔除十段线等非省界要素）
"""
import json
import math
import os
import urllib.request
from pathlib import Path

SOURCES = {
    "land": {
        "urls": [
            "https://cdn.jsdelivr.net/gh/nvkelso/natural-earth-vector@master/geojson/ne_10m_land.geojson",
            "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_land.geojson",
        ],
        "cache": "ne_10m_land.geojson",
        "out": "land-10m.json",
        "quant": 20,
        "max_bytes": 350 * 1024,
        "tolerances": [0.01, 0.015, 0.02, 0.03, 0.05, 0.08, 0.12, 0.18, 0.25],
    },
    "provinces": {
        "urls": ["https://geo.datav.aliyun.com/areas_v3/bound/100000_full.json"],
        "cache": "china-provinces.geojson",
        "out": "provinces.json",
        "quant": 200,  # 0.005° 量化：省界须平滑，0.05° 折线棱角明显
        "max_bytes": 500 * 1024,
        "tolerances": [0.005, 0.008, 0.01, 0.015, 0.02],
    },
}

ROOT = Path(__file__).resolve().parent.parent
VENDOR_DIR = Path(__file__).resolve().parent / "vendor"
OUT_DIR = ROOT / "themes" / "photofolio" / "static" / "maps"
MIN_RING_POINTS = 4  # 量化后点数不足的碎屑环丢弃（微小岛礁等）


def keep_feature(f):
    """省界：只保留省级单位——剔除无 adcode 的十段线/南海诸岛插图要素（adcode 100000_JD）"""
    props = f.get("properties") or {}
    adcode = props.get("adcode")
    return bool(adcode) and adcode != "100000_JD"


def load_source(cfg):
    cache_file = VENDOR_DIR / cfg["cache"]
    if cache_file.exists():
        return json.loads(cache_file.read_text(encoding="utf-8"))
    last_err = None
    for url in cfg["urls"]:
        try:
            print(f"downloading {url} ...")
            req = urllib.request.Request(url, headers={"User-Agent": "mimorree-map-gen/1.0"})
            with urllib.request.urlopen(req, timeout=60) as resp:
                text = resp.read().decode("utf-8")
            VENDOR_DIR.mkdir(parents=True, exist_ok=True)
            cache_file.write_text(text, encoding="utf-8")
            return json.loads(text)
        except Exception as e:
            last_err = e
            print(f"  failed: {e}")
    raise last_err or RuntimeError("download failed")


def dp_simplify(points, tolerance_deg):
    tol2 = tolerance_deg * tolerance_deg
    n = len(points)
    if n <= 2:
        return points
    keep = bytearray(n)
    keep[0] = keep[n - 1] = 1

    stack = [(0, n - 1)]
    while stack:
        a, b = stack.pop()
        ax, ay = points[a]
        bx, by = points[b]
        dx, dy = bx - ax, by - ay
        base = dx * dx + dy * dy
        max_d, max_i = 0.0, -1
        for i in range(a + 1, b):
            if base == 0:
                px, py = points[i][0] - ax, points[i][1] - ay
                d = px * px + py * py
            else:
                # 点到线段距离：|cross| / |base|，比较时用 cross^2 / base 即可
                cx, cy = points[i][0] - ax, points[i][1] - ay
                cross = cx * dy - cy * dx
                d = (cross * cross) / base
            if d > max_d:
                max_d, max_i = d, i
        if max_d > tol2 and max_i > 0:
            stack.append((a, max_i))
            stack.append((max_i, b))
            keep[max_i] = 1
    return [p for i, p in enumerate(points) if keep[i]]


def round_half_away(v):
    """四舍五入（.5 进位）——与 JS Math.round 一致；Python 内置 round 是银行家舍入（.5 取偶），
    坐标量化会差 1"""
    return math.floor(v + 0.5) if v >= 0 else math.ceil(v - 0.5)


def encode_ring(ring, quant):
    out = []
    prev = None
    for lon, lat in ring:
        x, y = round_half_away(lon * quant), round_half_away(lat * quant)
        if prev is None or prev[0] != x or prev[1] != y:
            out.append([x, y])
            prev = (x, y)
    # 闭合环：首尾一致时去掉末点
    if len(out) > 2 and out[0][0] == out[-1][0] and out[0][1] == out[-1][1]:
        out.pop()
    return out


def encode(features, tolerance, quant):
    polys = []
    for f in features:
        geom = f.get("geometry")
        if not geom or geom["type"] not in ("Polygon", "MultiPolygon"):
            continue
        # Polygon 的坐标是环数组、MultiPolygon 是多边形（各为环数组）数组——统一成「多边形列表」
        poly_list = [geom["coordinates"]] if geom["type"] == "Polygon" else geom["coordinates"]
        for poly in poly_list:
            rings = [encode_ring(dp_simplify(ring, tolerance), quant) for ring in poly]
            rings = [r for r in rings if len(r) >= MIN_RING_POINTS]
            if rings:
                polys.append(rings)
    return polys


def encode_provinces(features, tolerance, quant):
    """省界专用：按省名输出 {省名: 环数组}，主地图取全部省合并绘制"""
    by_province = {}
    for f in features:
        geom = f.get("geometry")
        if not geom or geom["type"] not in ("Polygon", "MultiPolygon"):
            continue
        poly_list = [geom["coordinates"]] if geom["type"] == "Polygon" else geom["coordinates"]
        rings = []
        for poly in poly_list:
            r = [encode_ring(dp_simplify(ring, tolerance), quant) for ring in poly]
            r = [x for x in r if len(x) >= MIN_RING_POINTS]
            if r:
                rings.append(r)
        if rings:
            by_province[f["properties"]["name"]] = rings
    return by_province


def main():
    for name, cfg in SOURCES.items():
        src = load_source(cfg)
        print(f"\n[{name}] source features: {len(src['features'])}")

        features = src["features"]
        if name == "provinces":
            features = [f for f in features if keep_feature(f)]
            lines = [
                f"{f['properties'].get('name', '?')}({f['properties'].get('adcode', '?')})"
                for f in features
            ]
            print(f"province features: {'、'.join(lines)}")

        best = None
        for tol in cfg["tolerances"]:
            out = encode_provinces(features, tol, cfg["quant"]) if name == "provinces" \
                else encode(features, tol, cfg["quant"])
            data = out if name != "provinces" else {"quant": cfg["quant"], "data": out}
            payload = json.dumps(data, separators=(",", ":"), ensure_ascii=False)
            nbytes = len(payload.encode("utf-8"))
            count = len(out) if name != "provinces" else len(out)
            print(f"tol={tol}  polys={count}  bytes={nbytes}")
            best = (payload, nbytes)
            if nbytes <= cfg["max_bytes"]:
                break

        if best[1] > cfg["max_bytes"]:
            raise RuntimeError(f"[{name}] cannot reach {cfg['max_bytes']} bytes even at max tolerance")

        OUT_DIR.mkdir(parents=True, exist_ok=True)
        out_file = OUT_DIR / cfg["out"]
        out_file.write_text(best[0], encoding="utf-8")
        print(f"written: {out_file} ({best[1]} bytes)")


if __name__ == "__main__":
    main()
