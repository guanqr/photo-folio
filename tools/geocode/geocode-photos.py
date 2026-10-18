# -*- coding: utf-8 -*-
"""
照片地理编码：把 photo.toml 中用户填写的详细地址（address 字段）转成 lat/lng 坐标
（零第三方依赖，Python 3.11+；相机无 GPS，坐标由地址解析而来）。

前置：申请高德开放平台「Web 服务」key（个人开发者免费额度），两种提供方式任选：
  1) 本目录 config.json（已加入 .gitignore，不会入库；复制 config.example.json 填写）：
     { "amap_key": "你的key" }
  2) 环境变量 AMAP_KEY

管线：解析 data/photo.toml（复用预处理管线 tools/photo-pipeline/src/toml_utils.py）
     → 对「有 address 且缺 lat/lng」的条目请求高德地理编码（350ms 间隔防限速；
       海外地址高德不覆盖时自动经 OSM Nominatim 兜底，兜底网络不可达则跳过）
     → 写回 lat/lng（6 位小数；write_toml 全量重写，字段白名单含 address/lat/lng）

用法：python tools/geocode/geocode-photos.py
"""
import json
import os
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
PHOTO_PATH = ROOT / "data" / "photo.toml"
CONFIG_PATH = HERE / "config.json"
API_URL = "https://restapi.amap.com/v3/geocode/geo"
INTERVAL_SEC = 0.35   # 高德个人 key 并发限制 3 QPS，串行 + 间隔最稳妥
TIMEOUT_SEC = 15

# 复用预处理管线的 TOML 读写（单一实现，避免字段白名单分叉）
sys.path.insert(0, str(ROOT / "tools" / "photo-pipeline" / "src"))
from toml_utils import parse_toml_entries, write_toml  # noqa: E402


def load_key():
    key = os.environ.get("AMAP_KEY", "").strip()
    if key:
        return key
    if CONFIG_PATH.exists():
        try:
            cfg = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
            key = (cfg.get("amap_key") or "").strip()
        except Exception:
            key = ""
        if key:
            return key
    return ""


def http_get_json(url, headers=None):
    req = urllib.request.Request(url, headers=headers or {})
    with urllib.request.urlopen(req, timeout=TIMEOUT_SEC) as resp:
        return json.loads(resp.read().decode("utf-8"))


class AmapKeyError(RuntimeError):
    """高德 key/配额/权限类错误：对后续全部请求同样成立，不得落 Nominatim 兜底"""


def geocode_amap(address, key):
    url = f"{API_URL}?{urllib.parse.urlencode({'address': address, 'key': key})}"
    data = http_get_json(url)
    if data.get("status") != "1":
        info = data.get("info", "")
        infocode = str(data.get("infocode", ""))
        # infocode 10001 key 无效 / 10003 配额耗尽 / 10004 限流等（1000 前缀）——
        # 此类错误与地址无关、对后续全部请求同样成立，落 Nominatim 会把境内
        # 中文地址交给境外服务、错误坐标静默写入（2026-10-18）
        if infocode.startswith("1000"):
            raise AmapKeyError(f"amap {infocode}: {info}")
        raise RuntimeError(f"amap status {data.get('status')}: {info}")
    loc = (data.get("geocodes") or [{}])[0].get("location")
    if not loc:
        raise RuntimeError("no geocode result")
    lng, lat = (float(v) for v in loc.split(","))
    return round(lat, 6), round(lng, 6)


def geocode_nominatim(address):
    """海外地址兜底：高德不覆盖境外（如日本），用 OSM Nominatim（免费无 key、
    限速 1 次/秒，官方策略要求带 User-Agent 标识）"""
    url = "https://nominatim.openstreetmap.org/search?" + urllib.parse.urlencode(
        {"q": address, "format": "jsonv2", "limit": "1"}
    )
    data = http_get_json(url, headers={"User-Agent": "photo-toml-geocoder/1.0"})
    if not data:
        raise RuntimeError("no geocode result")
    return round(float(data[0]["lat"]), 6), round(float(data[0]["lon"]), 6)


def geocode(address, key):
    try:
        return geocode_amap(address, key)
    except AmapKeyError:
        raise  # key/配额类：不落 Nominatim，由 main 捕获中止
    except Exception as e:
        try:
            lat, lng = geocode_nominatim(address)
            print(f"  ↳ 高德失败（{e}），已由 Nominatim 兜底")
            return lat, lng
        except Exception as e2:
            raise RuntimeError(f"amap: {e}; nominatim: {e2}") from e2


def main():
    key = load_key()
    if not key:
        print("缺少高德 key：设置环境变量 AMAP_KEY，或复制 tools/geocode/config.example.json 为 config.json 并填写 amap_key")
        sys.exit(1)

    entries = parse_toml_entries(str(PHOTO_PATH))
    todo = [e for e in entries if e.get("address") and not (e.get("lat") and e.get("lng"))]
    print(f"共 {len(entries)} 条记录，待编码 {len(todo)} 条")

    done = failed = 0
    for e in todo:
        try:
            lat, lng = geocode(e["address"], key)
            e["lat"] = str(lat)
            e["lng"] = str(lng)
            done += 1
            print(f"✓ {e.get('src')}  {e.get('address')} → {lat}, {lng}")
        except AmapKeyError as err:
            # key/配额类错误：剩余条目不落 Nominatim（境外服务解析境内中文地址
            # 不可靠），中止循环——已成功的条目照常写回
            print(f"⛔ 高德凭证/配额错误（{err}）：剩余 {len(todo) - done - failed} 条不兜底、中止")
            break
        except Exception as err:
            failed += 1
            print(f"✗ {e.get('src')}  {e.get('address')}  {err}")
        time.sleep(INTERVAL_SEC)

    if done:
        write_toml(str(PHOTO_PATH), entries)
    print(f"完成：成功 {done}，失败 {failed}，已写回 data/photo.toml")


if __name__ == "__main__":
    main()
