# -*- coding: utf-8 -*-
"""生成 data/solar_terms.toml：二十四节气日期表（日期当天 → i18n key）。

灯箱节气标识按「日期当天」匹配，不看交节时刻：同一天上午拍摄的照片仍归
当天节气（2026-11-23 裁定）。日期来自 Meeus 太阳视黄经算法（低精度公式，
日期级误差为 0；2026 小雪算得 11-22 15:23，与公开历表一致）。

用法：python tools/solar-terms/generate.py [--start 2010] [--end 2040]
重跑后提交生成结果；节气名文案见 i18n 的 solar_term_* 键。
"""
import argparse
import datetime as dt
import math
from pathlib import Path

TERMS = [
    ("xiaohan", 285), ("dahan", 300), ("lichun", 315), ("yushui", 330),
    ("jingzhe", 345), ("chunfen", 0), ("qingming", 15), ("guyu", 30),
    ("lixia", 45), ("xiaoman", 60), ("mangzhong", 75), ("xiazhi", 90),
    ("xiaoshu", 105), ("dashu", 120), ("liqiu", 135), ("chushu", 150),
    ("bailu", 165), ("qiufen", 180), ("hanlu", 195), ("shuangjiang", 210),
    ("lidong", 225), ("xiaoxue", 240), ("daxue", 255), ("dongzhi", 270),
]

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "data" / "solar_terms.toml"


def _jd_from_dt(t):
    y, m = t.year, t.month
    d = t.day + (t.hour + t.minute / 60 + t.second / 3600) / 24
    if m <= 2:
        y -= 1
        m += 12
    a = y // 100
    b = 2 - a + a // 4
    return int(365.25 * (y + 4716)) + int(30.6001 * (m + 1)) + d + b - 1524.5


def _dt_from_jd(jd):
    jd += 0.5
    z = int(jd)
    f = jd - z
    if z < 2299161:
        a = z
    else:
        alpha = int((z - 1867216.25) / 36524.25)
        a = z + 1 + alpha - alpha // 4
    b = a + 1524
    c = int((b - 122.1) / 365.25)
    d = int(365.25 * c)
    e = int((b - d) / 30.6001)
    day = b - d - int(30.6001 * e) + f
    month = e - 1 if e < 14 else e - 13
    year = c - 4716 if month > 2 else c - 4715
    dd = int(day)
    return dt.datetime(year, month, dd) + dt.timedelta(days=day - dd)


def _sun_lon(jd):
    t = (jd - 2451545.0) / 36525.0
    l0 = 280.46646 + 36000.76983 * t + 0.0003032 * t * t
    m = math.radians((357.52911 + 35999.05029 * t - 0.0001537 * t * t) % 360)
    c = ((1.914602 - 0.004817 * t - 0.000014 * t * t) * math.sin(m)
         + (0.019993 - 0.000101 * t) * math.sin(2 * m)
         + 0.000289 * math.sin(3 * m))
    omega = math.radians(125.04 - 1934.136 * t)
    return (l0 + c - 0.00569 - 0.00478 * math.sin(omega)) % 360


def _term_moment(year, index, target):
    """太阳视黄经到达 target 的北京时间（UTC+8）。"""
    approx = dt.datetime(year, 1, 5) + dt.timedelta(days=index * 15.2184)
    lo = _jd_from_dt(approx - dt.timedelta(days=8))
    hi = _jd_from_dt(approx + dt.timedelta(days=8))

    def diff(jd):
        d = (_sun_lon(jd) - target) % 360
        return d - 360 if d > 180 else d

    for _ in range(60):
        mid = (lo + hi) / 2
        if diff(mid) < 0:
            lo = mid
        else:
            hi = mid
    return _dt_from_jd((lo + hi) / 2) + dt.timedelta(hours=8)


def build(start, end):
    rows = []
    for year in range(start, end + 1):
        for index, (key, target) in enumerate(TERMS):
            rows.append((_term_moment(year, index, target).date().isoformat(), key))
    rows.sort()
    dates = [r[0] for r in rows]
    if len(dates) != len(set(dates)):
        raise RuntimeError("同一日期出现多个节气，算法异常")
    return rows


def render(rows, start, end):
    lines = [
        f"# 二十四节气日期表（{start}–{end}）",
        "# 由 tools/solar-terms/generate.py 生成，勿手改；节气名文案见 i18n 的 solar_term_* 键。",
        "# 只按日期当天匹配：交节时刻在同一天内的早晚不影响归属（2026-11-23 口径）。",
        "[dates]",
    ]
    lines += [f'"{date}" = "{key}"' for date, key in rows]
    return "\n".join(lines) + "\n"


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--start", type=int, default=2010)
    parser.add_argument("--end", type=int, default=2040)
    args = parser.parse_args()
    rows = build(args.start, args.end)
    OUT.write_text(render(rows, args.start, args.end), encoding="utf-8", newline="\n")
    print(f"写入 {OUT}：{len(rows)} 条（{args.start}–{args.end}）")


if __name__ == "__main__":
    main()
