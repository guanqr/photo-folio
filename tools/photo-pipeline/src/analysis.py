# -*- coding: utf-8 -*-
"""照片图像分析 — 预计算统计，灯箱加载结果直渲（不再在线采样）

统计口径与灯箱渲染端完全一致（原 JS 逐像素统计整体迁入本模块，灯箱只保留
曲线派生与渲染；数值口径迁移对齐 2026-10-19 方案确认）：
- 明度 = Rec.709 加权（0.2126·R + 0.7152·G + 0.0722·B）
- 影调定性 = 亮度中位数 P50 相对中间灰（18% 灰 ≈ sRGB 118）；長/中/短調
  按灰階跨度（P5–P95 在 11 级等距灰階上的跨區數——短 ≤4、中 5–7、長 ≥8，
  攝影標準的「直方圖灰階跨度」口径）
- 動態範圍 = P5–P95 的线性光亮度跨度换算为真「档」——sRGB 值先经 IEC
  61966-2-1 标准传递函数解码到线性光，log2 直方图取百分位；纯黑像素按
  16 位精度下限 2^-16 计，死黑照片不产生无穷大——独立数值展示，不参与
  長短判定（灰階跨度與線性光動態範圍衡量对象不同）
- 剪裁 = ≥2% 像素落在 0–5（陰影）/ 250–255（高光）
- 區域系統 = 安塞尔·亚当斯 11 级灰阶（P1–P99 映射占據區域）
- 飽和度 = HSV 饱和度（(max−min)/max）0–100% 分布与均值；低/中/高按
  像素占比最大的一档判定（分段 <18% / 18–45% / ≥45%）；均值 <5% 判黑白
- 色相 = HSV 色相 36 段（每段 10°），按饱和度加权（灰色无相不参与）
- 色卡 = 16 级量化 + 贪心种子 + k-means 细化，6 主色（不足拆分补足）

输入：全分辨率 RGB 原图（管线处理链上、加水印之前的原图口径——分析对象
是照片本身而非压缩产物，也不含水印文字污染）。
输出：static/analysis/{文件名}.json（schema 版本由 v 字段标识，当前 v4——
算法改动时递增 ANALYSIS_VERSION，旧结果由 main.py 的惰性判定自动重算）。
"""
import json
import math
import os

from PIL import Image

ANALYSIS_VERSION = 4  # v4：饱和度判定改按分段像素占比（<18 / 18–45 / ≥45），
                      # 结果增 satFracs/satBounds（2026-10-25）——v3 JSON 由
                      # 惰性判定自动判过期、下次运行全量重算（或由一次性回填
                      # 脚本直写）

# ===== 影调/色彩阈值（与灯箱渲染口径一致） =====
TONAL_ZONE_SHADOW = 85   # 18% 灰（118）向下精确 1 档曝光：0.18/2 经 sRGB 标准
                         # 传递函数（IEC 61966-2-1）编码 ≈ 85——原 √2 近似（83）
                         # 对应约 1.1 档，已按标准定义修正（2026-10-19）
TONAL_ZONE_HIGH = 162    # 18% 灰向上精确 1 档曝光：0.18×2 编码 ≈ 162（同上）
TONAL_KEY_LOW = 95       # P50 低于中间灰约 1/5 → 低調
TONAL_KEY_HIGH = 150     # P50 高于中间灰约 1/4 → 高調
TONAL_SPAN_SHORT_MAX = 4 # 灰階跨度（11 級等距灰階的跨區數）：≤4 短調
TONAL_SPAN_MID_MAX = 7   # 5–7 中調；≥8 長調——按攝影標準的直方圖灰階跨度
                         # （原為線性光真档 P5–P95 的 7.7/14.3 档阈值，
                         # 14.3 档超出 11 級區域系統約 10 档的跨度，实际
                         # 几乎判不出長調，2026-10-25 修正）
TONAL_CLIP_FRAC = 0.02   # 剪裁判定：≥2% 像素
TONAL_CLIP_DARK = 5      # 陰影剪裁上界
TONAL_CLIP_BRIGHT = 250  # 高光剪裁下界
TONAL_SAT_LOW = 0.18     # 饱和度分段：<18% 低、18–45% 中、≥45% 高——
TONAL_SAT_HIGH = 0.45    # 按像素占比最大的分段判档，均值只作虚线展示
SAT_LOW_BIN = int(round(TONAL_SAT_LOW * 100))   # 18：直方图 0–99 桶边界
SAT_HIGH_BIN = int(round(TONAL_SAT_HIGH * 100)) # 45
TONAL_ACHROMATIC = 0.05  # 黑白照判定：平均饱和度低于此视为无彩色
HUE_WEIGHT_MIN = 0.02    # 色相加权下限：饱和度低于此的灰色像素不参与色相统计
ZONE_COUNT = 11          # 區域系統 0–X
HUE_SEG_COUNT = 36       # 色相直方图 36 段（每段 10°）

# ===== 色卡（与原 JS computePalette 同口径） =====
PALETTE_LEVELS = 16      # 每通道量化级数（16³ = 4096 桶）
PALETTE_TARGET = 6       # 色卡恒为 6 行（中屏两列 3×2 恰好整行）
PALETTE_MIN_DIST2 = 60 * 60  # 种子互斥最小距离平方
PALETTE_SPLIT_MIXES = [0.4, -0.4, 0.65, -0.65, 0.2]  # 拆分补足混合比例（正值向白、负值向黑，轮次递进保证变体互异）

# ===== 動態範圍（线性光域真档）=====
DR_FLOOR = 16.0      # 纯黑下限：2^-16（16 位整数精度）以下视为纯黑——死黑照片
                     # 的 DR 不产生无穷大（原 gamma 域 +1 守卫的同义替换）
DR_BINS = 4096       # log2 亮度直方图：1/256 档分辨率 × [−16, 0] 档区间


def _srgb_lin_lut():
    """sRGB → 线性光查找表（IEC 61966-2-1 标准 EOTF，256 项）——逐像素解码用，
    避免 24MP × 3 次 pow 的开方成本；明度系数用 Rec.709（sRGB 规范同源）"""
    lut = []
    for v in range(256):
        c = v / 255.0
        if c <= 0.04045:
            lut.append(c / 12.92)
        else:
            lut.append(((c + 0.055) / 1.055) ** 2.4)
    return lut


_SRGB_LIN = _srgb_lin_lut()


def _percentile_bin(hist, p):
    """直方图百分位：累计分布达到 p 时的 bin 下标（log2 亮度域）"""
    total = sum(hist)
    target = total * p
    cum = 0
    for b in range(len(hist)):
        cum += hist[b]
        if cum >= target:
            return b
    return len(hist) - 1


def _analyze_dr(dr_hist):
    """動態範圍（真档）：P5/P95 在线性光亮度的 log2 直方图上取百分位——
    bin 步长 1/256 档、两百分位 bin 之差即真档（bin 中心项相消，误差
    < 1/256 档）；纯黑像素累计在最暗 bin（DR_FLOOR 下限）"""
    return (_percentile_bin(dr_hist, 0.95) - _percentile_bin(dr_hist, 0.05)) / 256.0


def _js_round(x):
    """对齐 JS Math.round 的半入舍入——Python round() 是银行家舍入（round-half-even），
    JS Math.round(0.5)=1 而 Python round(0.5)=0，逐个调用点逐一换成 floor(x+0.5)"""
    return int(x + 0.5)


def _percentile_of(hist, total, p):
    """直方图百分位：累计分布达到 p 时的 bin 值"""
    target = total * p
    cum = 0
    for b in range(256):
        cum += hist[b]
        if cum >= target:
            return b
    return 255


def _zone_of(v):
    """區域系統：亮度值 → 0–X 级"""
    return min(ZONE_COUNT - 1, max(0, _js_round((v / 255) * (ZONE_COUNT - 1))))


def _rgb_to_hsl(r, g, b):
    """RGB → HSL 文本（如 H210 S12 L70），与灯箱色卡显示格式一致"""
    r /= 255.0
    g /= 255.0
    b /= 255.0
    mx = max(r, g, b)
    mn = min(r, g, b)
    l = (mx + mn) / 2
    h = 0.0
    s = 0.0
    if mx != mn:
        d = mx - mn
        s = d / (2 - mx - mn) if l > 0.5 else d / (mx + mn)
        if mx == r:
            h = ((g - b) / d + (6 if g < b else 0)) / 6
        elif mx == g:
            h = ((b - r) / d + 2) / 6
        else:
            h = ((r - g) / d + 4) / 6
    return "H%d S%d L%d" % (_js_round(h * 360), _js_round(s * 100), _js_round(l * 100))


def _analyze_tone(lum_hist, total, dr_stops):
    """影调统计与定性（九调判定、剪裁警告、区域系统、三区占比）。

    長短判定按灰階跨度：P5–P95 在 11 級等距灰階上的跨區數（≤4 短、5–7 中、
    ≥8 長）；動態範圍 dr_stops 由调用方在线性光域计算传入，只作独立数值
    展示，不参与長短判定。區域括號同步使用 P5–P95（原 P1–P99 会被极少数
    极端像素拉宽，與標籤口径不一致）。"""
    p5 = _percentile_of(lum_hist, total, 0.05)
    p50 = _percentile_of(lum_hist, total, 0.5)
    p95 = _percentile_of(lum_hist, total, 0.95)
    shadow = 0
    mid = 0
    high = 0
    clip_shadow = 0
    clip_high = 0
    for b in range(256):
        n = lum_hist[b]
        if b <= TONAL_ZONE_SHADOW:
            shadow += n
        elif b <= TONAL_ZONE_HIGH:
            mid += n
        else:
            high += n
        if b <= TONAL_CLIP_DARK:
            clip_shadow += n
        if b >= TONAL_CLIP_BRIGHT:
            clip_high += n
    key = 0 if p50 < TONAL_KEY_LOW else (1 if p50 <= TONAL_KEY_HIGH else 2)
    zone_from = _zone_of(p5)
    zone_to = _zone_of(p95)
    span = zone_to - zone_from
    range_tier = 0 if span <= TONAL_SPAN_SHORT_MAX else (
        1 if span <= TONAL_SPAN_MID_MAX else 2)
    warnings = []
    if clip_shadow / total >= TONAL_CLIP_FRAC:
        warnings.append("shadow")
    if clip_high / total >= TONAL_CLIP_FRAC:
        warnings.append("high")
    return {
        "key": key,
        "range": range_tier,
        "p50": p50,
        "drStops": _js_round(dr_stops * 10) / 10,
        "warnings": warnings,
        "zoneFrom": zone_from,
        "zoneTo": zone_to,
        "fracs": [_js_round(shadow / total * 100), _js_round(mid / total * 100),
                  _js_round(high / total * 100)],
    }


def _analyze_sat(sat_hist, total):
    """饱和度分档与三段占比：按低/中/高像素占比最大的一档判定（并列取较低档）。
    直方图桶 = int(satv×100)：低 0..17、中 18..44、高 45..99"""
    sat_low = sum(sat_hist[:SAT_LOW_BIN])
    sat_mid = sum(sat_hist[SAT_LOW_BIN:SAT_HIGH_BIN])
    sat_high = sum(sat_hist[SAT_HIGH_BIN:])
    tier = 0 if (sat_low >= sat_mid and sat_low >= sat_high) else (
        1 if sat_mid >= sat_high else 2)
    fracs = [_js_round(sat_low / total * 100), _js_round(sat_mid / total * 100),
             _js_round(sat_high / total * 100)]
    # 取整余数并入最大档，保证三段显示合计恒为 100%（判定仍用原始计数）
    residual = 100 - sum(fracs)
    if residual:
        fracs[fracs.index(max(fracs))] += residual
    return tier, fracs


def _compute_palette(counts, total):
    """主色提取：量化桶（主循环累积）→ 贪心种子 + k-means 细化 → 拆分补足 6 色。
    k-means 把**所有**像素桶分配到最近中心（无阈值、按桶像素数加权迭代收敛），
    保证占比之和 ≈ 100%，大面积主导色不会被拆散低估"""
    buckets = sorted(
        ({"r": rs / cnt, "g": gs / cnt, "b": bs / cnt, "count": cnt}
         for rs, gs, bs, cnt in counts.values()),
        key=lambda e: e["count"],
        reverse=True,
    )

    def dist2(a, b):
        dr = a["r"] - b["r"]
        dg = a["g"] - b["g"]
        db = a["b"] - b["b"]
        return dr * dr + dg * dg + db * db

    centers = []
    for c in buckets:
        if len(centers) >= PALETTE_TARGET:
            break
        if all(dist2(c, p) >= PALETTE_MIN_DIST2 for p in centers):
            centers.append(dict(c))

    for _ in range(5):
        sums = [{"r": 0.0, "g": 0.0, "b": 0.0, "count": 0} for _ in centers]
        for c in buckets:
            best = min(range(len(centers)), key=lambda i: dist2(c, centers[i]))
            s = sums[best]
            s["r"] += c["r"] * c["count"]
            s["g"] += c["g"] * c["count"]
            s["b"] += c["b"] * c["count"]
            s["count"] += c["count"]
        for i, s in enumerate(sums):
            if s["count"] > 0:
                centers[i] = {"r": s["r"] / s["count"], "g": s["g"] / s["count"],
                              "b": s["b"] / s["count"], "count": s["count"]}

    result = [c for c in centers if c["count"] > 0]
    result.sort(key=lambda e: e["count"], reverse=True)
    split_round = 0
    while len(result) < PALETTE_TARGET and split_round < len(PALETTE_SPLIT_MIXES):
        split_idx = max(range(len(result)), key=lambda i: result[i]["count"])
        src = result[split_idx]
        t = PALETTE_SPLIT_MIXES[split_round]
        split_round += 1
        mix = 255 if t >= 0 else 0
        k = abs(t)
        result[split_idx:split_idx + 1] = [
            dict(src, count=src["count"] / 2),
            {"r": src["r"] + (mix - src["r"]) * k,
             "g": src["g"] + (mix - src["g"]) * k,
             "b": src["b"] + (mix - src["b"]) * k,
             "count": src["count"] / 2},
        ]
    result.sort(key=lambda e: e["count"], reverse=True)
    return [{
        "hex": "#" + "".join("%02X" % _js_round(c[k]) for k in ("r", "g", "b")),
        "hsl": _rgb_to_hsl(c["r"], c["g"], c["b"]),
        "ratio": c["count"] / total,
    } for c in result]


def analyze_image(img):
    """对全分辨率 RGB 原图做单趟统计，返回 v1 结果对象（schema 见灯箱端）"""
    w, h = img.size
    total = w * h

    # C 速：RGB 256 桶直方图（Pillow histogram 返回 R/G/B 各 256 值、共 768）
    hist768 = img.histogram()
    rgb = [list(hist768[0:256]), list(hist768[256:512]), list(hist768[512:768])]

    # 单趟逐像素（全分辨率一次遍历，四项统计融合——多趟扫描的耗时成本
    # 集中于色卡量化与色相加权，融合后每张只付一次；24MP 约数十秒，
    # 由 main.py 的惰性判定保证仅新增/过期照片付费）
    lum_hist = [0] * 256
    sat_hist = [0] * 100
    hue_hist = [0.0] * HUE_SEG_COUNT
    sat_sum = 0.0
    dr_hist = [0] * DR_BINS  # 线性光亮度的 log2 直方图（真档動態範圍用）
    counts = {}  # 量化桶 key → [rsum, gsum, bsum, count]
    step = 256 / PALETTE_LEVELS
    lin = _SRGB_LIN
    _log2 = math.log2
    data = img.tobytes()
    for i in range(0, len(data), 3):
        r = data[i]
        g = data[i + 1]
        b = data[i + 2]
        # 明度 = Rec.709 加权（摄影界通用明度口径，gamma 域——显示域直方图/三区/九调用）
        lum = 0.2126 * r + 0.7152 * g + 0.0722 * b
        lum_hist[min(255, int(lum))] += 1
        # 线性光域亮度（sRGB 解码后同系数加权）→ log2 直方图：動態範圍真档用
        y_lin = 0.2126 * lin[r] + 0.7152 * lin[g] + 0.0722 * lin[b]
        if y_lin > 0:
            b_lin = int((_log2(y_lin) + DR_FLOOR) * 256)
            dr_hist[0 if b_lin < 0 else (DR_BINS - 1 if b_lin >= DR_BINS else b_lin)] += 1
        else:
            dr_hist[0] += 1
        # HSV 饱和度与色相：灰色无相（饱和度极低时色相无意义，不参与）
        mx = r if r >= g and r >= b else (g if g >= b else b)
        mn = r if r <= g and r <= b else (g if g <= b else b)
        satv = (mx - mn) / mx if mx > 0 else 0.0
        sat_hist[min(99, int(satv * 100))] += 1
        sat_sum += satv
        if satv > HUE_WEIGHT_MIN:
            d = mx - mn
            if d == 0:
                hue = 0.0
            elif mx == r:
                hue = ((g - b) / d) % 6
            elif mx == g:
                hue = (b - r) / d + 2
            else:
                hue = (r - g) / d + 4
            if hue < 0:
                hue += 6
            hue_hist[int(hue * 60 / 10)] += satv  # 按饱和度加权
        # 色卡量化（每通道 16 级）
        qr = min(PALETTE_LEVELS - 1, int(r / step))
        qg = min(PALETTE_LEVELS - 1, int(g / step))
        qb = min(PALETTE_LEVELS - 1, int(b / step))
        key = (qr << 16) | (qg << 8) | qb
        e = counts.get(key)
        if e is None:
            e = [0, 0, 0, 0]
            counts[key] = e
        e[0] += r
        e[1] += g
        e[2] += b
        e[3] += 1

    tone = _analyze_tone(lum_hist, total, _analyze_dr(dr_hist))
    sat_mean = sat_sum / total
    achromatic = sat_mean < TONAL_ACHROMATIC
    hue_seg = max(range(HUE_SEG_COUNT), key=lambda i: hue_hist[i])
    # 饱和度分档：三段像素占比最大的一档（均值只作展示）
    sat_tier, sat_fracs = _analyze_sat(sat_hist, total)

    return {
        "v": ANALYSIS_VERSION,
        "total": total,
        "rgb": rgb,
        "lum": lum_hist,
        "sat": sat_hist,
        "hue": [round(x, 3) for x in hue_hist],  # 权重为像素级浮点累积，3 位小数足够图表渲染
        "tone": tone,
        "color": {"sat": sat_tier, "satMean": _js_round(sat_mean * 100),
                  "satFracs": sat_fracs, "satBounds": [SAT_LOW_BIN, SAT_HIGH_BIN],
                  "achromatic": achromatic, "hueSeg": hue_seg},
        "palette": _compute_palette(counts, total),
    }


def is_analysis_stale(analysis_path):
    """结果缺失或算法版本过期（JSON 的 v 与当前版本不符）才需重算。
    源图内容变化由 main.py 的 source_hash 判定并强制本次重算——不再用
    mtime 比较（同名换图保留旧 mtime 时会漏判，2026-10-28 B6b）"""
    if not os.path.exists(analysis_path):
        return True
    try:
        with open(analysis_path, "r", encoding="utf-8") as f:
            return json.load(f).get("v") != ANALYSIS_VERSION
    except Exception:
        return True


def write_js_meta(js_path):
    """把灯箱渲染共用的分析常量写成 ES module（单一源头：本文件）。
    main.py 在管线启动时调用；原子替换，避免站点构建读到半截文件。"""
    lines = [
        "// 由 tools/photo-pipeline/src/analysis.py 生成，请勿手改。",
        "// 单一源头：分析算法常量在 Python；灯箱渲染从本文件 import。",
        f"export const ANALYSIS_VERSION = {ANALYSIS_VERSION};",
        f"export const TONAL_ZONE_SHADOW = {TONAL_ZONE_SHADOW};",
        f"export const TONAL_ZONE_HIGH = {TONAL_ZONE_HIGH};",
        f"export const TONAL_CLIP_DARK = {TONAL_CLIP_DARK};",
        f"export const TONAL_CLIP_BRIGHT = {TONAL_CLIP_BRIGHT};",
        f"export const ZONE_COUNT = {ZONE_COUNT};",
        f"export const HUE_SEG_COUNT = {HUE_SEG_COUNT};",
        "",
    ]
    parent = os.path.dirname(js_path)
    if parent:
        os.makedirs(parent, exist_ok=True)
    tmp_path = js_path + ".tmp"
    with open(tmp_path, "w", encoding="utf-8") as f:
        f.write("\n".join(lines))
    os.replace(tmp_path, js_path)


def analyze_and_store(input_path, analysis_path):
    """加载原图做分析并写结果 JSON（临时文件 + 原子替换——中断/磁盘满不
    留截断文件，站点侧不会拉到半截 JSON；2026-10-21 审查修复 #7）；
    失败抛异常由调用方告警（不中断主流程，下次运行自动重试）"""
    with Image.open(input_path) as img:
        result = analyze_image(img.convert("RGB"))
    os.makedirs(os.path.dirname(analysis_path), exist_ok=True)
    tmp_path = analysis_path + ".tmp"
    with open(tmp_path, "w", encoding="utf-8") as f:
        json.dump(result, f, separators=(",", ":"))
    os.replace(tmp_path, analysis_path)
