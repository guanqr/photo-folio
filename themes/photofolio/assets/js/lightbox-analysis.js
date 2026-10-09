/**
 * 灯箱图片分析（直方图 + 色卡 + 影调与色彩）
 *
 * 管线：探测加载 w_1024 缩略图（crossOrigin=anonymous，OSS 未开 CORS 时失败优雅降级；
 * 离屏 canvas 采样 → 统计三通道 256 桶直方图（窗口 5 平滑、对数纵轴）与
 * 6 个主色色卡（16 级量化 + 贪心种子 + k-means 细化，占比之和 ≈ 100%）。
 * 结果按 src 缓存——切换/回看作品时无需重新探测下载。
 * 直方图渲染为 SVG（矢量：高 DPI / 缩放 / 窄屏下始终清晰，不随像素密度发糊）。
 *
 * 影调与色彩分析采用摄影界标准口径（无外部算法）：
 * 明度 = Rec.709 加权亮度；影调定性 = 亮度中位数 P50 相对中间灰（18% 灰 ≈ sRGB 118）；
 * 對比度 = 動態範圍（P5–P95 换算为档）；剪裁 = ≥2% 像素落在两端（高光/陰影剪裁）；
 * 區域系統 = 安塞尔·亚当斯 11 级灰阶；飽和度/色相 = HSV 分布（色相按饱和度加权）。
 */

/* RGB → HSL 文本（如 H210 S12 L70） */
function rgbToHsl(r, g, b) {
    r /= 255;
    g /= 255;
    b /= 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const l = (max + min) / 2;
    let h = 0;
    let s = 0;
    if (max !== min) {
        const d = max - min;
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        if (max === r) {
            h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
        } else if (max === g) {
            h = ((b - r) / d + 2) / 6;
        } else {
            h = ((r - g) / d + 4) / 6;
        }
    }
    return 'H' + Math.round(h * 360) + ' S' + Math.round(s * 100) + ' L' + Math.round(l * 100);
}

/* 主色提取：像素量化（每通道 16 级）→ 频次统计 → 贪心种子 + k-means 细化。
   返回 [{ hex, hsl, ratio }]：k-means 把**所有**像素桶分配到最近中心（无阈值、
   按桶像素数加权迭代收敛），保证占比之和 ≈ 100%，大面积主导色不会被拆散低估 */
function computePalette(pixels) {
    const LEVELS = 16;
    const step = 256 / LEVELS;
    const counts = new Map();
    for (let i = 0; i < pixels.length; i += 4) {
        const r = Math.min(LEVELS - 1, pixels[i] / step | 0);
        const g = Math.min(LEVELS - 1, pixels[i + 1] / step | 0);
        const b = Math.min(LEVELS - 1, pixels[i + 2] / step | 0);
        const key = (r << 16) | (g << 8) | b;
        let e = counts.get(key);
        if (!e) {
            e = { r: 0, g: 0, b: 0, count: 0 };
            counts.set(key, e);
        }
        e.r += pixels[i];
        e.g += pixels[i + 1];
        e.b += pixels[i + 2];
        e.count++;
    }
    const totalPixels = pixels.length / 4;
    const buckets = Array.from(counts.values())
        .map((e) => ({ r: e.r / e.count, g: e.g / e.count, b: e.b / e.count, count: e.count }))
        .sort((a, b) => b.count - a.count);

    const dist2 = (a, b) => {
        const dr = a.r - b.r;
        const dg = a.g - b.g;
        const db = a.b - b.b;
        return dr * dr + dg * dg + db * db;
    };

    // 种子：贪心取频次最高且互不靠近的桶（最多 6 个——中屏两列 3×2 恰好整行）
    const MIN_DIST2 = 60 * 60;
    const centers = [];
    for (const c of buckets) {
        if (centers.length >= 6) break;
        if (centers.every((p) => dist2(c, p) >= MIN_DIST2)) {
            centers.push({ r: c.r, g: c.g, b: c.b, count: c.count });
        }
    }

    // k-means 细化：全部桶分配到最近中心（像素数加权），迭代收敛
    for (let iter = 0; iter < 5; iter++) {
        const sums = centers.map(() => ({ r: 0, g: 0, b: 0, count: 0 }));
        for (const c of buckets) {
            let best = 0;
            let bestD = Infinity;
            for (let i = 0; i < centers.length; i++) {
                const d = dist2(c, centers[i]);
                if (d < bestD) {
                    bestD = d;
                    best = i;
                }
            }
            sums[best].r += c.r * c.count;
            sums[best].g += c.g * c.count;
            sums[best].b += c.b * c.count;
            sums[best].count += c.count;
        }
        for (let i = 0; i < centers.length; i++) {
            const s = sums[i];
            if (s.count > 0) {
                centers[i] = { r: s.r / s.count, g: s.g / s.count, b: s.b / s.count, count: s.count };
            }
        }
    }

    // 主色不足 6 个时拆分补足：把占比最大的颜色拆成「原色 + 明度变体」，
    // 变体的混合比例按轮次递进（40% 白 → 40% 黑 → 65% 白 → 65% 黑 → 20% 白）——
    // 固定比例会反复拆出同一个变体（重复色），递进轮次保证各变体互不相同；
    // 两者各占一半，色卡恒为 6 行、占比之和保持 ≈100%
    const PALETTE_TARGET = 6;
    const SPLIT_MIXES = [0.4, -0.4, 0.65, -0.65, 0.2]; // 正值 = 向白混合比例，负值 = 向黑
    const result = centers.filter((c) => c.count > 0).sort((a, b) => b.count - a.count);
    let splitRound = 0;
    while (result.length < PALETTE_TARGET && splitRound < SPLIT_MIXES.length) {
        let splitIdx = 0;
        result.forEach((c, i) => { if (c.count > result[splitIdx].count) splitIdx = i; });
        const src = result[splitIdx];
        const t = SPLIT_MIXES[splitRound++];
        const mix = t >= 0 ? 255 : 0;
        const k = Math.abs(t);
        result.splice(splitIdx, 1,
            { ...src, count: src.count / 2 },
            {
                r: src.r + (mix - src.r) * k,
                g: src.g + (mix - src.g) * k,
                b: src.b + (mix - src.b) * k,
                count: src.count / 2,
            });
    }
    return result
        .sort((a, b) => b.count - a.count)
        .map((c) => ({
            hex: '#' + [c.r, c.g, c.b]
                .map((v) => Math.round(v).toString(16).padStart(2, '0'))
                .join('')
                .toUpperCase(),
            hsl: rgbToHsl(c.r, c.g, c.b),
            ratio: c.count / totalPixels
        }));
}

/* 渲染色卡：每行 = 色块 + (hex / HSL 两行) + 占比 */
function renderPalette(colors, paletteWrap, paletteEl) {
    if (!paletteWrap || !paletteEl) return;
    if (!colors || colors.length === 0) {
        paletteWrap.style.display = 'none';
        return;
    }
    paletteWrap.style.display = '';
    paletteEl.innerHTML = '';
    colors.forEach(({ hex, hsl, ratio }) => {
        const row = document.createElement('div');
        row.className = 'lightbox-palette-row';

        const swatch = document.createElement('span');
        swatch.className = 'lightbox-palette-swatch';
        swatch.style.background = hex;

        const info = document.createElement('div');
        info.className = 'lightbox-palette-info';

        const hexEl = document.createElement('span');
        hexEl.className = 'lightbox-palette-hex';
        hexEl.textContent = hex;

        const hslEl = document.createElement('span');
        hslEl.className = 'lightbox-palette-hsl';
        hslEl.textContent = hsl;

        const pctEl = document.createElement('span');
        pctEl.className = 'lightbox-palette-pct';
        // ≥1% 取整数；<1% 只显示「<1%」（不显示具体小数）
        const pct100 = ratio * 100;
        pctEl.textContent = pct100 >= 1 ? Math.round(pct100) + '%' : '<1%';

        info.append(hexEl, hslEl);
        row.append(swatch, info, pctEl);
        paletteEl.appendChild(row);
    });
}

/* 合并直方图（纯曲线 + 影调注释，连续形变过渡）：
   R/G/B 三通道曲线 + 金色明度曲线——全部为无填充曲线（每通道 256 点
   固定结构，天然平滑、无锯齿无竖条纹，且可形变）+ 陰影/中間調/高光
   三分区底色 + P50 虚线标记（带 x 过渡）+ 两端剪裁三角。
   数据变化时旧曲线与新曲线之间线性插值（0.4s），像曝光灰階括号一样
   连续变形而非跳变 */
const HIST_H = 96;
const HIST_SAMPLES = 256; // 每通道曲线采样点数：d 形变要求点数恒定
const LUM_CURVE_COLOR = 'rgb(245, 197, 66)'; // 明度曲线：金色——与通道曲线区分

/* 通道曲线目标 y 数组（对数纵轴、同 logMax；通道桶已平滑） */
function channelCurveYs(buckets, logMax) {
    return buckets.map((arr) => Array.from({ length: HIST_SAMPLES }, (_, x) => {
        const lo = Math.floor((x / (HIST_SAMPLES - 1)) * 255);
        return HIST_H - (Math.log1p(arr[Math.min(255, lo)]) / logMax) * (HIST_H - 1);
    }));
}

/* 明度曲线目标 y 数组（窗口 5 平滑 + 对数纵轴、同 logMax） */
function lumCurveYs(lumHist, logMax) {
    const smooth = lumHist.slice();
    for (let i = 0; i < 256; i++) {
        let sum = 0;
        let n = 0;
        for (let k = i - 2; k <= i + 2; k++) {
            if (k >= 0 && k < 256) { sum += lumHist[k]; n++; }
        }
        smooth[i] = sum / n;
    }
    return Array.from({ length: HIST_SAMPLES }, (_, i) => {
        const x = (i / (HIST_SAMPLES - 1)) * 255;
        const lo = Math.floor(x);
        const hi = Math.min(lo + 1, 255);
        const t = x - lo;
        const v = (1 - t) * Math.log1p(smooth[lo]) + t * Math.log1p(smooth[hi]);
        return HIST_H - (v / logMax) * (HIST_H - 1);
    });
}

/* 曲线路径（固定点数不闭合） */
function histLineD(ys) {
    let d = '';
    for (let i = 0; i < HIST_SAMPLES; i++) {
        d += (i === 0 ? 'M' : 'L') + (i / (HIST_SAMPLES - 1) * 255).toFixed(2) + ',' + ys[i].toFixed(2);
    }
    return d;
}

function paintHistogram(buckets, logMax, histogramSvg, tone, lumHist) {
    if (!histogramSvg) return;
    const channelColors = [[224, 90, 90], [110, 200, 140], [110, 150, 230]];
    // 骨架（一次性构建）：R/G/B 通道曲线 + 明度曲线 + 影调注释层
    if (!histogramSvg._built) {
        histogramSvg.innerHTML = channelColors.map(([r, g, b], i) =>
            `<path class="hist-ch ch${i}" fill="none" stroke="rgb(${r},${g},${b})" stroke-width="1.5" vector-effect="non-scaling-stroke"></path>`).join('')
            + `<path class="hist-lum" fill="none" stroke="${LUM_CURVE_COLOR}" stroke-width="1.5" vector-effect="non-scaling-stroke"></path>`;
        if (tone) {
            const zones = [
                [0, TONAL_ZONE_SHADOW, 'var(--color-zone-shadow-bg)'],
                [TONAL_ZONE_SHADOW + 1, TONAL_ZONE_HIGH, 'var(--color-zone-mid-bg)'],
                [TONAL_ZONE_HIGH + 1, 255, 'var(--color-zone-high-bg)'],
            ];
            histogramSvg.insertAdjacentHTML('afterbegin', zones.map(([x0, x1, fill]) =>
                `<rect x="${x0}" y="0" width="${x1 - x0 + 1}" height="${HIST_H}" fill="${fill}"></rect>`).join(''));
            histogramSvg.insertAdjacentHTML('beforeend',
                `<line class="hist-p50" y1="4" y2="${HIST_H - 4}" stroke="var(--color-accent)" stroke-width="1" stroke-dasharray="3 3" vector-effect="non-scaling-stroke"></line>`
                + `<path class="hist-mark-shadow" fill="var(--color-clip)"></path>`
                + `<path class="hist-mark-high" fill="var(--color-clip)"></path>`);
        }
        histogramSvg._built = true;
    }
    const target = channelCurveYs(buckets, logMax);
    const lumYs = lumHist ? lumCurveYs(lumHist, logMax) : null;
    const p50 = tone ? tone.p50 : 0;
    const apply = (arrs) => {
        histogramSvg.querySelectorAll('.hist-ch').forEach((p, i) => p.setAttribute('d', histLineD(arrs[i])));
        const lum = histogramSvg.querySelector('.hist-lum');
        if (lum) lum.setAttribute('d', histLineD(arrs[3]));
        const p50Line = histogramSvg.querySelector('.hist-p50');
        if (p50Line) {
            p50Line.setAttribute('x1', arrs[4][0]);
            p50Line.setAttribute('x2', arrs[4][0]);
        }
    };
    const toArrs = target.concat([lumYs || target[0], [p50]]);
    if (histogramSvg._prevYs) {
        tweenMulti(histogramSvg, histogramSvg._prevYs, toArrs, apply);
    } else {
        apply(toArrs);
    }
    histogramSvg._prevYs = toArrs;
    // 剪裁标记按警告开关（固定位置，即时切换）
    if (tone) {
        histogramSvg.querySelector('.hist-mark-shadow').setAttribute('d',
            tone.warnings.includes('shadow') ? `M${TONAL_CLIP_DARK},1 l4,0 l-2,6 z` : '');
        histogramSvg.querySelector('.hist-mark-high').setAttribute('d',
            tone.warnings.includes('high') ? `M${TONAL_CLIP_BRIGHT},1 l-4,0 l2,6 z` : '');
    }
}

/* ===== 影调与色彩分析（摄影界标准口径） =====
   明度 = Rec.709 加权亮度（0.2126·R + 0.7152·G + 0.0722·B）。
   影调定性（高調/中間調/低調）：亮度中位数 P50 相对中间灰（18% 灰 ≈ sRGB 118）
   的位置——中位数不受高光反光/深阴影等极端像素拉动。
   對比度（高對比/中對比/低對比）：動態範圍 = P5–P95 的亮度跨度换算为「档」
   （档是摄影界衡量动态范围的标准单位；P5/P95 去掉两端各 5% 的极端像素，
   避免个别死白/死黑把跨度吹大）。
   剪裁：≥2% 像素落在 0–5 → 陰影剪裁；≥2% 落在 250–255 → 高光剪裁
   （与修图软件的高光/陰影剪裁警告同口径）。
   區域系統：安塞尔·亚当斯 11 级灰阶（0–X），照片的 P1–P99 映射为占據區域。
   飽和度：HSV 饱和度 0–100% 分布，均值定性低飽和/適中/高飽和。
   色相：HSV 色相 0–360° 分布，按饱和度加权（灰色无相，不参与判定），
   主色相取 8 个标准色名（紅/橙/黃/綠/青/藍/紫/品紅）。 */

const TONAL_ZONE_SHADOW = 83; // 18% 灰（118）向下 1 档曝光：118/√2 ≈ 83
const TONAL_ZONE_HIGH = 167; // 18% 灰向上 1 档曝光：118×√2 ≈ 167
const TONAL_KEY_LOW = 95; // P50 低于中间灰约 1/5 → 低調
const TONAL_KEY_HIGH = 150; // P50 高于中间灰约 1/4 → 高調
const TONAL_DR_LOW = 3.5; // 動態範圍（档）：<3.5 低對比
const TONAL_DR_HIGH = 6.5; // >6.5 高對比
const TONAL_CLIP_FRAC = 0.02; // 剪裁判定：≥2% 像素
const TONAL_CLIP_DARK = 5; // 陰影剪裁上界
const TONAL_CLIP_BRIGHT = 250; // 高光剪裁下界
const TONAL_SAT_LOW = 0.18; // 饱和度均值定性
const TONAL_SAT_HIGH = 0.45;

const ZONE_COUNT = 11; // 區域系統 0–X
const HUE_SEG_COUNT = 36; // 色相直方图 36 段（每段 10°）
const HUE_NAMES = ['紅', '橙', '黃', '綠', '青', '藍', '紫', '品紅']; // 8 个标准色相名（每段 45°）

/* 直方图百分位：累计分布达到 p 时的 bin 值 */
function percentileOf(hist, total, p) {
    const target = total * p;
    let cum = 0;
    for (let b = 0; b < 256; b++) {
        cum += hist[b];
        if (cum >= target) return b;
    }
    return 255;
}

/* 區域系統：亮度值 → 0–X 级 */
function zoneOf(v) {
    return Math.min(ZONE_COUNT - 1, Math.max(0, Math.round((v / 255) * (ZONE_COUNT - 1))));
}

/* 影调统计与定性 */
function analyzeTone(lumHist, total) {
    const p1 = percentileOf(lumHist, total, 0.01);
    const p5 = percentileOf(lumHist, total, 0.05);
    const p50 = percentileOf(lumHist, total, 0.5);
    const p95 = percentileOf(lumHist, total, 0.95);
    const p99 = percentileOf(lumHist, total, 0.99);
    let shadow = 0;
    let mid = 0;
    let high = 0;
    let clipShadow = 0;
    let clipHigh = 0;
    for (let b = 0; b < 256; b++) {
        const n = lumHist[b];
        if (b <= TONAL_ZONE_SHADOW) shadow += n;
        else if (b <= TONAL_ZONE_HIGH) mid += n;
        else high += n;
        if (b <= TONAL_CLIP_DARK) clipShadow += n;
        if (b >= TONAL_CLIP_BRIGHT) clipHigh += n;
    }
    const key = p50 < TONAL_KEY_LOW ? 0 : (p50 <= TONAL_KEY_HIGH ? 1 : 2);
    const drStops = p5 > 0 ? Math.log2((p95 + 1) / (p5 + 1)) : 0;
    const range = drStops < TONAL_DR_LOW ? 0 : (drStops <= TONAL_DR_HIGH ? 1 : 2);
    const warnings = [];
    if (clipShadow / total >= TONAL_CLIP_FRAC) warnings.push('shadow');
    if (clipHigh / total >= TONAL_CLIP_FRAC) warnings.push('high');
    return {
        key,
        range,
        p50,
        drStops: Math.round(drStops * 10) / 10,
        warnings,
        zoneFrom: zoneOf(p1),
        zoneTo: zoneOf(p99),
        fracs: [Math.round((shadow / total) * 100), Math.round((mid / total) * 100), Math.round((high / total) * 100)],
    };
}

/* 饱和度/色相统计：饱和度直方图（100 段）+ 均值；色相直方图（36 段，按饱和度加权）。
   黑白照判定：平均饱和度 < 5%（接近无彩色）→ 无色相结论（显示「黑白」）、
   色相图以灰色柱呈现——否则全零直方图会把主色相默认落在第一段（红） */
function analyzeSatHue(satHist, satSum, hueHist, total) {
    const satMean = satSum / total;
    const achromatic = satMean < 0.05;
    let hueMax = 0;
    let hueMaxSeg = 0;
    hueHist.forEach((w, i) => {
        if (w > hueMax) {
            hueMax = w;
            hueMaxSeg = i;
        }
    });
    const sat = satMean < TONAL_SAT_LOW ? 0 : (satMean < TONAL_SAT_HIGH ? 1 : 2);
    return {
        sat,
        satMean: Math.round(satMean * 100),
        achromatic,
        hueName: achromatic
            ? null
            : HUE_NAMES[Math.round(hueMaxSeg / (HUE_SEG_COUNT / HUE_NAMES.length)) % HUE_NAMES.length],
        hueSeg: hueMaxSeg,
    };
}

/* ===== 图表渲染 ===== */

/* 图表连续过渡：旧数据与新数据之间线性插值（rAF 驱动 0.4s easeOutCubic），
   与曝光灰階括号/占比条同款节奏——曲线连续形变而非跳变；新过渡到来时
   中断上一次未完成的过渡继续变形 */
function tweenMulti(el, fromArrs, toArrs, apply) {
    if (el._raf) cancelAnimationFrame(el._raf);
    const t0 = performance.now();
    const step = (now) => {
        const t = Math.min(1, (now - t0) / 400);
        const k = 1 - Math.pow(1 - t, 3);
        const mid = fromArrs.map((arr, a) => arr.map((v, i) => v + (toArrs[a][i] - v) * k));
        apply(t < 1 ? mid : toArrs);
        el._raf = t < 1 ? requestAnimationFrame(step) : null;
    };
    el._raf = requestAnimationFrame(step);
}

/* 直方图图例：R/G/B 通道色与明度曲线色（一次性构建） */
function renderHistLegend(legendEl, labels) {
    if (!legendEl || legendEl._built) return;
    const colors = ['rgb(224, 90, 90)', 'rgb(110, 200, 140)', 'rgb(110, 150, 230)', LUM_CURVE_COLOR];
    const names = (labels || 'R|G|B|明度').split('|');
    legendEl.textContent = '';
    names.forEach((name, i) => {
        const item = document.createElement('span');
        const dot = document.createElement('i');
        dot.style.background = colors[i];
        const text = document.createElement('span');
        text.textContent = name;
        item.append(dot, text);
        legendEl.appendChild(item);
    });
    legendEl._built = true;
}

/* 區域系統标尺：11 级灰阶（0 纯黑 → X 纯白，感知均匀），括号标出照片占據區域 */
function renderZoneStrip(tone, stripEl, bracketEl) {
    if (!stripEl) return;
    if (!stripEl._built) {
        stripEl.innerHTML = Array.from({ length: ZONE_COUNT }, (_, n) => {
            const v = Math.round(255 * Math.pow(n / 10, 2.2));
            return `<span style="background:rgb(${v},${v},${v})"></span>`;
        }).join('');
        // innerHTML 重建会销毁原有的括号子元素：重新挂回再更新位置
        if (bracketEl) stripEl.appendChild(bracketEl);
        stripEl._built = true;
    }
    if (bracketEl) {
        bracketEl.style.left = (tone.zoneFrom / (ZONE_COUNT - 1)) * 100 + '%';
        bracketEl.style.width = ((tone.zoneTo - tone.zoneFrom) / (ZONE_COUNT - 1)) * 100 + '%';
    }
}

/* 饱和度直方图：0–100% 分布曲线（100 点固定结构，连续形变过渡）+ 均值标记（带 x 过渡） */
function paintSatHistogram(satHist, sat, svg) {
    if (!svg) return;
    const W = 100;
    const H = 48;
    let max = 1;
    satHist.forEach((v) => { if (v > max) max = v; });
    const toYs = satHist.map((v) => H - (v / max) * (H - 2) - 1);
    if (!svg._built) {
        svg.innerHTML = `<path class="sat-curve" fill="none" stroke="var(--color-sat-curve)" stroke-width="1.5" vector-effect="non-scaling-stroke"></path>`
            + `<line class="sat-mean" y1="2" y2="${H - 2}" stroke="var(--color-accent)" stroke-width="1" stroke-dasharray="3 3" vector-effect="non-scaling-stroke"></line>`;
        svg._built = true;
    }
    const apply = (arrs) => {
        const ys = arrs[0];
        let d = '';
        for (let x = 0; x < W; x++) d += (x === 0 ? 'M' : 'L') + x + ',' + ys[x].toFixed(2);
        svg.querySelector('.sat-curve').setAttribute('d', d);
        const mean = svg.querySelector('.sat-mean');
        mean.setAttribute('x1', arrs[1][0]);
        mean.setAttribute('x2', arrs[1][0]);
    };
    const toArrs = [toYs, [sat.satMean]];
    if (svg._prevYs) tweenMulti(svg, svg._prevYs, toArrs, apply);
    else apply(toArrs);
    svg._prevYs = toArrs;
}

/* 色相直方图：36 段（每段 10°），每段填其色相本色，主色相段高亮描边；
   黑白照以灰色柱呈现（无色相）；柱高连续形变过渡 */
function paintHueHistogram(hueHist, hue, svg) {
    if (!svg) return;
    const H = 48;
    let max = 1;
    hueHist.forEach((v) => { if (v > max) max = v; });
    const toYs = hueHist.map((v) => H - (v / max) * (H - 2) - 1);
    if (!svg._built) {
        svg.innerHTML = Array.from({ length: HUE_SEG_COUNT }, () => '<rect></rect>').join('');
        svg._built = true;
    }
    const apply = (ys) => {
        Array.from(svg.children).forEach((rect, i) => {
            const y = ys[i];
            const fill = hue.achromatic ? 'hsl(0, 0%, 60%)' : `hsl(${i * 10 + 5}, 70%, 55%)`;
            const dominant = !hue.achromatic && i === hue.hueSeg;
            rect.setAttribute('x', i * 10 + 1);
            rect.setAttribute('width', 8);
            rect.setAttribute('y', y.toFixed(2));
            rect.setAttribute('height', (H - 1 - y).toFixed(2));
            rect.setAttribute('fill', fill);
            rect.setAttribute('opacity', dominant ? '1' : '0.55');
            rect.setAttribute('stroke', dominant ? 'var(--color-text)' : 'none');
            rect.setAttribute('stroke-width', '0.5');
        });
    };
    if (svg._prevYs) tweenMulti(svg, [svg._prevYs], [toYs], (arrs) => apply(arrs[0]));
    else apply(toYs);
    svg._prevYs = toYs;
}

/* 渲染影调结论与图表：结论（九调标准命名：高/中/低調 × 長/中/短調，如「低長調」，
   中调键取「中」前缀）+ 剪裁警告、合并直方图（RGB 通道 + 明度曲线 + 三分区/P50/剪裁注释）、
   區域系統、三区占比条、数据行（動態範圍/亮度中位數） */
function renderTone(tone, buckets, logMax, lumHist, labels, els) {
    if (!els.wrap) return;
    els.wrap.style.display = '';
    // 经典九调组合名：低调 + 长调 → 低長調（共用「調」后缀；中调键前缀取「中」）
    const keyPrefix = tone.key === 1 ? '中' : labels.key[tone.key].slice(0, -1);
    const parts = [keyPrefix + labels.range[tone.range]];
    tone.warnings.forEach((w) => {
        parts.push(w === 'shadow' ? labels.clipShadow : labels.clipHigh);
    });
    els.name.textContent = parts.join(' · ');
    els.dr.textContent = tone.drStops + ' ' + labels.drUnit;
    els.p50.textContent = tone.p50;
    els.fracs[0].style.width = tone.fracs[0] + '%';
    els.fracs[1].style.width = tone.fracs[1] + '%';
    els.fracs[2].style.width = tone.fracs[2] + '%';
    els.fracText.textContent =
        `${labels.zoneNames[0]} ${tone.fracs[0]}% · ${labels.zoneNames[1]} ${tone.fracs[1]}% · ${labels.zoneNames[2]} ${tone.fracs[2]}%`;
    paintHistogram(buckets, logMax, els.histEl, tone, lumHist);
    renderHistLegend(els.legendEl, labels.histLegend);
    renderZoneStrip(tone, els.zoneStripEl, els.zoneBracketEl);
}

function renderSat(sat, satHist, labels, els) {
    if (!els.wrap) return;
    els.wrap.style.display = '';
    els.name.textContent = labels.sat[sat.sat];
    paintSatHistogram(satHist, sat, els.histEl);
}

function renderHue(hue, hueHist, labels, els) {
    if (!els.wrap) return;
    els.wrap.style.display = '';
    els.name.textContent = hue.achromatic ? (labels.gray || '黑白') : hue.hueName;
    // 色相轴标注：8 个标准色名沿横向均布（一次性构建；黑白照时以灰点提示无色相）
    if (els.axisEl && !els.axisEl._built) {
        els.axisEl.textContent = '';
        labels.hue.forEach((name) => {
            const span = document.createElement('span');
            span.textContent = name;
            els.axisEl.appendChild(span);
        });
        els.axisEl._built = true;
    }
    paintHueHistogram(hueHist, hue, els.histEl);
}

export function initPhotoAnalysis({ paletteWrap, paletteEl, tone, sat, hue }) {
    const toneEls = tone || {};
    const satEls = sat || {};
    const hueEls = hue || {};
    const toneLabels = toneEls.wrap ? {
        key: (toneEls.wrap.dataset.keyNames || '').split('|'),
        range: (toneEls.wrap.dataset.rangeNames || '').split('|'),
        zoneNames: (toneEls.wrap.dataset.zoneNames || '').split('|'),
        clipShadow: toneEls.wrap.dataset.clipShadow || '',
        clipHigh: toneEls.wrap.dataset.clipHigh || '',
        drUnit: toneEls.wrap.dataset.drUnit || '檔',
        histLegend: toneEls.wrap.dataset.histLegend || 'R|G|B|明度',
    } : null;
    const satLabels = satEls.wrap ? {
        sat: (satEls.wrap.dataset.satNames || '').split('|'),
    } : null;
    const hueLabels = hueEls.wrap ? {
        hue: (hueEls.wrap.dataset.hueNames || '').split('|'),
        gray: hueEls.wrap.dataset.hueGray || '黑白',
    } : null;

    const cache = new Map(); // src → { buckets, logMax, palette, tone, sat, hue, satHist, hueHist }

    function hideAll() {
        if (paletteWrap) paletteWrap.style.display = 'none';
        if (toneEls.wrap) toneEls.wrap.style.display = 'none';
        if (satEls.wrap) satEls.wrap.style.display = 'none';
        if (hueEls.wrap) hueEls.wrap.style.display = 'none';
    }

    /* 分析指定作品：缓存命中直接重绘；否则探测加载 w_1024 缩略图统计。
       所有分析区块都被配置关闭时跳过探测（不发请求）。
       请求代次（analyzeSeq）：快速切图时慢探测乱序完成，代次不符不渲染过期结果 */
    let analyzeSeq = 0;
    function analyze(src) {
        if (!paletteEl && !toneEls.wrap && !satEls.wrap && !hueEls.wrap) return;
        const mySeq = ++analyzeSeq;
        const cached = cache.get(src);
        if (cached) {
            if (paletteEl) renderPalette(cached.palette, paletteWrap, paletteEl);
            if (toneEls.wrap) renderTone(cached.tone, cached.buckets, cached.logMax, cached.lumHist, toneLabels, toneEls);
            if (satEls.wrap) renderSat(cached.sat, cached.satHist, satLabels, satEls);
            if (hueEls.wrap) renderHue(cached.hue, cached.hueHist, hueLabels, hueEls);
            return;
        }
        const probeSrc = src.replace(/w_\d+/, 'w_1024'); // 采样探测：≤1024px 缩略图
        const probe = new Image();
        probe.crossOrigin = 'anonymous';
        probe.onload = () => {
            try {
                const off = document.createElement('canvas');
                off.width = probe.naturalWidth;
                off.height = probe.naturalHeight;
                const ctx = off.getContext('2d', { willReadFrequently: true });
                ctx.drawImage(probe, 0, 0);
                const data = ctx.getImageData(0, 0, off.width, off.height).data;
                const total = data.length / 4;

                const BINS = 256;
                const buckets = [new Array(BINS).fill(0), new Array(BINS).fill(0), new Array(BINS).fill(0)];
                const lumHist = new Array(BINS).fill(0); // 影调统计用（未平滑）
                const satHist = new Array(100).fill(0);
                const hueHist = new Array(HUE_SEG_COUNT).fill(0);
                let satSum = 0;
                for (let i = 0; i < data.length; i += 4) {
                    const r = data[i];
                    const g = data[i + 1];
                    const b = data[i + 2];
                    // bin 下标 = 像素值本身（0-255，BINS=256）
                    buckets[0][r]++;
                    buckets[1][g]++;
                    buckets[2][b]++;
                    // 明度 = Rec.709 加权（摄影界通用明度口径）
                    const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
                    lumHist[Math.min(255, lum | 0)]++;
                    // HSV 饱和度与色相：灰色无相（饱和度极低时色相无意义，不参与）
                    const mx = Math.max(r, g, b);
                    const mn = Math.min(r, g, b);
                    const satv = mx > 0 ? (mx - mn) / mx : 0;
                    satHist[Math.min(99, satv * 100 | 0)]++;
                    satSum += satv;
                    if (satv > 0.02) {
                        const d = mx - mn;
                        let h;
                        if (d === 0) h = 0;
                        else if (mx === r) h = ((g - b) / d) % 6;
                        else if (mx === g) h = (b - r) / d + 2;
                        else h = (r - g) / d + 4;
                        if (h < 0) h += 6;
                        hueHist[(h * 60 / 10) | 0] += satv; // 按饱和度加权
                    }
                }
                // 轻量滑动平均（窗口 5），曲线更接近 Camera Raw 的平滑形态
                buckets.forEach((arr) => {
                    const srcBuf = arr.slice();
                    for (let i = 0; i < BINS; i++) {
                        let sum = 0;
                        let n = 0;
                        for (let k = i - 2; k <= i + 2; k++) {
                            if (k >= 0 && k < BINS) { sum += srcBuf[k]; n++; }
                        }
                        arr[i] = sum / n;
                    }
                });
                let max = 1;
                buckets.forEach((arr) => arr.forEach((v) => { if (v > max) max = v; }));
                const logMax = Math.log1p(max);
                const palette = computePalette(data);
                const tone = toneEls.wrap ? analyzeTone(lumHist, total) : null;
                const sat = satEls.wrap ? analyzeSatHue(satHist, satSum, hueHist, total) : null;
                const hue = hueEls.wrap ? analyzeSatHue(satHist, satSum, hueHist, total) : null;
                cache.set(src, { buckets, logMax, palette, tone, sat, hue, lumHist, satHist, hueHist });
                if (mySeq !== analyzeSeq) return; // 已切到别的作品：结果入缓存但不渲染过期内容
                if (paletteEl) renderPalette(palette, paletteWrap, paletteEl);
                if (toneEls.wrap) renderTone(tone, buckets, logMax, lumHist, toneLabels, toneEls);
                if (satEls.wrap) renderSat(sat, satHist, satLabels, satEls);
                if (hueEls.wrap) renderHue(hue, hueHist, hueLabels, hueEls);
            } catch (err) {
                console.warn('[lightbox] 直方图绘制失败:', err);
                hideAll();
            }
        };
        probe.onerror = () => {
            console.warn('[lightbox] 直方图探测加载失败（OSS CORS 未生效）:', probeSrc);
            hideAll();
        };
        probe.src = probeSrc;
    }

    return { analyze };
}
