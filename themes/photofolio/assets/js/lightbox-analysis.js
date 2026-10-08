/**
 * 灯箱图片分析（直方图 + 色卡）
 *
 * 管线：探测加载 w_1024 缩略图（crossOrigin=anonymous，OSS 未开 CORS 时失败优雅降级；
 * 离屏 canvas 采样 → 统计三通道 256 桶直方图（窗口 5 平滑、对数纵轴）与
 * 6 个主色色卡（16 级量化 + 贪心种子 + k-means 细化，占比之和 ≈ 100%）。
 * 结果按 src 缓存——切换/回看作品时无需重新探测下载。
 * 直方图渲染为 SVG（矢量：高 DPI / 缩放 / 窄屏下始终清晰，不随像素密度发糊）。
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

    return centers
        .filter((c) => c.count > 0)
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

/* 把统计结果渲染为 SVG（Camera Raw 风格：256 亮度桶、对数纵轴、窗口 5 平滑曲线）：
   viewBox 0 0 256 96——每桶恰为一个单位宽，随容器拉伸缩放仍保持矢量清晰。
   加法混合不用 mix-blend-mode（手机浏览器/webview 对 SVG 元素支持参差，忽略后重叠区
   会被最后绘制的通道盖成其本色）——按列把三通道高度排序分成三段（单通道/双通道叠加/
   三通道叠加），每段直接填「底色 + 0.55×通道色之和」的不透明色，与 canvas lighter 完全等价 */
const HIST_H = 96;
const CHANNEL_ALPHA = 0.55; // 与 canvas 版 rgba 透明度一致

function paintHistogram(buckets, logMax, histogramSvg) {
    if (!histogramSvg) return;
    const BINS = buckets[0].length;
    const channelColors = [[224, 90, 90], [110, 200, 140], [110, 150, 230]];
    // 底色（加法混合基准）从元素计算样式读取，主题变量变化时自动跟随
    const bgCss = getComputedStyle(histogramSvg).backgroundColor;
    const bgMatch = bgCss && bgCss.match(/rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)/);
    const bg = bgMatch ? [parseFloat(bgMatch[1]), parseFloat(bgMatch[2]), parseFloat(bgMatch[3])] : [24, 26, 32];
    // 某段区域（活跃通道集合）的填色 = 底色 + 0.55×通道色之和（钳制）
    const fillFor = (indices) => {
        const sum = [bg[0], bg[1], bg[2]];
        indices.forEach((idx) => {
            for (let k = 0; k < 3; k++) sum[k] += channelColors[idx][k] * CHANNEL_ALPHA;
        });
        return `rgb(${Math.min(255, Math.round(sum[0]))},${Math.min(255, Math.round(sum[1]))},${Math.min(255, Math.round(sum[2]))})`;
    };
    // 桶间线性细分（每桶 4 段）——列式填色的阶梯边缘缩到肉眼不可辨，曲线平滑；
    // 按每个采样点三通道高度排序（最小 y = 最高），拆成三段，按填色归组输出 path
    const SAMPLE = 4;
    const SEG_COUNT = (BINS - 1) * SAMPLE;
    const byFill = new Map();
    const ys = [[], [], []];
    for (let c = 0; c < 3; c++) {
        const src = buckets[c];
        for (let i = 0; i <= SEG_COUNT; i++) {
            const x = i / SAMPLE;
            const lo = Math.floor(x);
            const hi = Math.min(lo + 1, BINS - 1);
            const t = x - lo;
            const v = (1 - t) * Math.log1p(src[lo]) + t * Math.log1p(src[hi]);
            ys[c].push(HIST_H - (v / logMax) * (HIST_H - 1));
        }
    }
    for (let i = 0; i < SEG_COUNT; i++) {
        const order = [0, 1, 2].sort((a, b) => ys[a][i] - ys[b][i]);
        const a = ys[order[0]][i];
        const b = ys[order[1]][i];
        const c = ys[order[2]][i];
        const x0 = i / SAMPLE;
        const x1 = (i + 1) / SAMPLE;
        const segments = [];
        if (b - a > 0.5) segments.push([a, b, [order[0]]]);
        if (c - b > 0.5) segments.push([b, c, [order[0], order[1]]]);
        if (HIST_H - c > 0.5) segments.push([c, HIST_H, [0, 1, 2]]);
        segments.forEach(([top, bot, indices]) => {
            const fill = fillFor(indices);
            const seg = `M${x0.toFixed(2)},${top.toFixed(2)} L${x0.toFixed(2)},${bot.toFixed(2)} L${x1.toFixed(2)},${bot.toFixed(2)} L${x1.toFixed(2)},${top.toFixed(2)} Z`;
            byFill.set(fill, (byFill.get(fill) || '') + seg);
        });
    }
    histogramSvg.innerHTML = Array.from(byFill.entries())
        .map(([fill, d]) => `<path d="${d}" fill="${fill}"></path>`)
        .join('');
}

/* ===== 影调分析（高/中/低 × 长/中/短 九格 + 全长调） =====
   亮度 = Rec.709 权重（通道顺序与参考网站实测对齐，见采样循环注释）。
   均值定高/中/低：≤85 低调 ｜ 85–170 中间调 ｜ ≥170 高调（±4 视为边界，提示置信有限）；
   跨度（P0.5–P99.5）定长/中/短：<85 短调 ｜ 85–190 中调 ｜ >190 长调（阈值与参考网站
   18 张实测对齐）。
   σ 只作展示不参与判定——高 ISO 纹理不会把跨度不长的照片误判成「长调」。
   全长调（第 10 格）：深暗（≤40）与明亮（≥215）各 ≥15%、中间带（90–165）≤30% 的
   双峰分布（剪影/暗调风光），九格装不下时单独命名。
   剪切（亮度 <1 或 >254 的像素 ≥0.5%）：跨度为表观值。 */
const TONAL_KEY_LOW = 85;
const TONAL_KEY_HIGH = 170;
const TONAL_BOUNDARY = 4;
const TONAL_SPAN_SHORT = 85;
const TONAL_SPAN_LONG = 190; // 与参考网站实测对齐：P0.5–P99.5 口径下 190 为最优分界（18 张失配最少）
const TONAL_DARK_LUM = 40;
const TONAL_BRIGHT_LUM = 215;
const TONAL_MID_LO = 90;
const TONAL_MID_HI = 165;
const TONAL_BIMODAL_MIN = 0.15;
const TONAL_VALLEY_MAX = 0.3;
const TONAL_MASS_MIN = 0.4;
const TONAL_CLIP_FRAC = 0.005;

/* 亮度统计：均值/σ/跨度（P0.5–P99.5，与参考网站实测同口径）/剪切占比/双峰与分区占比 */
function analyzeLuminance(lumHist, lumSum, lumSq, clipped, total) {
    const mean = lumSum / total;
    const sigma = Math.sqrt(Math.max(0, lumSq / total - mean * mean));
    let cum = 0;
    let p1 = null;
    let p99 = null;
    let dark = 0, bright = 0, valley = 0, low = 0, mid = 0, high = 0;
    for (let b = 0; b < 256; b++) {
        const n = lumHist[b];
        cum += n;
        if (p1 === null && cum >= total * 0.005) p1 = b;
        if (p99 === null && cum >= total * 0.995) p99 = b;
        if (b <= TONAL_DARK_LUM) dark += n;
        if (b >= TONAL_BRIGHT_LUM) bright += n;
        if (b >= TONAL_MID_LO && b <= TONAL_MID_HI) valley += n;
        if (b <= TONAL_KEY_LOW) low += n;
        else if (b < TONAL_KEY_HIGH) mid += n;
        else high += n;
    }
    if (p1 === null) p1 = 0;
    if (p99 === null) p99 = 255;
    return {
        mean,
        sigma,
        p1,
        p99,
        span: p99 - p1,
        darkFrac: dark / total,
        brightFrac: bright / total,
        valleyFrac: valley / total,
        lowFrac: low / total,
        midFrac: mid / total,
        highFrac: high / total,
        clippedFrac: clipped / total,
    };
}

/* 判定：全长调（双峰）优先 → 均值档 × 跨度档 → 边界/重心/剪切提示 */
function judgeTonal(s, labels) {
    const bimodal = s.darkFrac >= TONAL_BIMODAL_MIN
        && s.brightFrac >= TONAL_BIMODAL_MIN
        && s.valleyFrac <= TONAL_VALLEY_MAX
        && s.span >= TONAL_SPAN_LONG;
    if (bimodal) {
        return {
            name: labels.fullLong,
            hint: s.clippedFrac >= TONAL_CLIP_FRAC ? labels.spanApparent : '',
            mean: Math.round(s.mean),
            sigma: Math.round(s.sigma),
            span: s.span,
        };
    }
    const key = s.mean <= TONAL_KEY_LOW ? 0 : (s.mean < TONAL_KEY_HIGH ? 1 : 2);
    const range = s.span < TONAL_SPAN_SHORT ? 0 : (s.span <= TONAL_SPAN_LONG ? 1 : 2);
    const keyName = labels.key[key];
    const rangeName = labels.range[range];
    const hints = [];
    // 均值贴近 85/170（±4）：边界提示
    if (Math.abs(s.mean - TONAL_KEY_LOW) <= TONAL_BOUNDARY) {
        hints.push(labels.near + labels.key[key === 0 ? 1 : 0]);
    } else if (Math.abs(s.mean - TONAL_KEY_HIGH) <= TONAL_BOUNDARY) {
        hints.push(labels.near + labels.key[key === 2 ? 1 : 2]);
    }
    // 分区亮度重心打架：像素占比最大的档与均值档不一致且 ≥40% → 置信有限
    const zoneFracs = [s.lowFrac, s.midFrac, s.highFrac];
    let mass = 0;
    for (let i = 1; i < 3; i++) if (zoneFracs[i] > zoneFracs[mass]) mass = i;
    const massHint = labels.near + labels.key[mass];
    if (mass !== key && zoneFracs[mass] >= TONAL_MASS_MIN && !hints.includes(massHint)) {
        hints.push(massHint);
    }
    // 剪切：跨度仅为表观值
    if (s.clippedFrac >= TONAL_CLIP_FRAC) {
        hints.push(labels.spanApparent);
    }
    return {
        // 组合名：低调 + 中调 → 低中调（共用「調」后缀）
        name: keyName.slice(0, -1) + rangeName,
        hint: hints.join(' · '),
        mean: Math.round(s.mean),
        sigma: Math.round(s.sigma),
        span: s.span,
    };
}

/* 平均色温（McCamy 近似）：sRGB → XYZ(D65) → xy 色度 → CCT。
   色度出界（结果超 1500–40000K）即不展示；
   色谱标记位置用倒数温标（mired）：与冷暖渐变的视觉距离线性对应 */
const TONAL_CCT_MIN = 1500;
const TONAL_CCT_MAX = 40000;
/* 标记定位：倒数温标（mired）分段映射——10000K（冷端）=0、5500K（摄影日光中性）=0.5、
   2500K（暖端）=1。单一线性 mired 会把中性 6500K 挤到条带左 1/5（中性照显得偏冷），
   分段锚定日光中性点后冷暖各占半条，位置与色温直觉对应 */
const TONAL_MIRED_COLD = 100; // 10000K → 0
const TONAL_MIRED_NEUTRAL = 181.8; // 5500K → 0.5
const TONAL_MIRED_WARM = 400; // 2500K → 1

function avgColorTemp(rSum, gSum, bSum, total) {
    const srgb = (v) => {
        const c = v / total / 255;
        return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    };
    const r = srgb(rSum);
    const g = srgb(gSum);
    const b = srgb(bSum);
    const X = 0.4124 * r + 0.3576 * g + 0.1805 * b;
    const Y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    const Z = 0.0193 * r + 0.1192 * g + 0.9505 * b;
    const s = X + Y + Z;
    // 退化/色度出界：返回与正常路径同构的对象（cct=null 显示「不適用」），
    // 绝不返回裸 null——renderTonal 无条件解引用 temp.pos
    if (s <= 0) return { cct: null, pos: 0.5 };
    const cy = Y / s;
    // 色度出界（强绿色场等远离黑体轨迹的均值）——色温无意义，不展示
    if (cy > 0.5) return { cct: null, pos: 0.5 };
    const d = cy - 0.1858;
    if (Math.abs(d) < 1e-6) return { cct: null, pos: 0.5 };
    const n = (X / s - 0.332) / d;
    const cct = -449 * n * n * n + 3525 * n * n - 6823.3 * n + 5520.33;
    // 数值超界时 cct 置 null（显示「不適用」），标记位置仍按钳制后的 CCT 定位——
    // 冷暖倾向色谱每张都显示
    const valid = cct >= TONAL_CCT_MIN && cct <= TONAL_CCT_MAX;
    const clamped = Math.max(TONAL_CCT_MIN, Math.min(TONAL_CCT_MAX, cct));
    const mired = 1e6 / clamped;
    let pos;
    if (mired <= TONAL_MIRED_NEUTRAL) {
        pos = 0.5 * (mired - TONAL_MIRED_COLD) / (TONAL_MIRED_NEUTRAL - TONAL_MIRED_COLD);
    } else {
        pos = 0.5 + 0.5 * (mired - TONAL_MIRED_NEUTRAL) / (TONAL_MIRED_WARM - TONAL_MIRED_NEUTRAL);
    }
    pos = Math.max(0, Math.min(1, pos));
    return { cct: valid ? Math.round(cct) : null, pos };
}

/* 直方图百分位：累计分布达到 p 时的 bin 值（白平衡白点提取用，需原始未平滑直方图） */
function percentileOf(hist, total, p) {
    const target = total * p;
    let cum = 0;
    for (let b = 0; b < 256; b++) {
        cum += hist[b];
        if (cum >= target) return b;
    }
    return 255;
}

/* 平均色温（白平衡反推口径）：取各通道 90 分位作「白点」，灰世界反推光源色 =
   (G/B, 1, G/R)，再求其 CCT。高位分位避开暗部噪声与局部色块，比算术平均更贴近
   人眼对画面冷暖的整体感知（与参考网站分析工具 18 张实测对齐，平均偏差 ≈800K；
   注意光源色取倒数为本站显示约定，与常见灰世界写法 (G/R, 1, G/B) 相反——
   实测方向与参考网站一致，勿按常规「修正」）；
   黑白（白点三通道近似无彩度）返回 cct=null（显示「不適用」、标记居中），
   色度出界（极端偏色）时 cct=null 但标记按钳制后的 CCT 定位——色谱每张都显示 */
function estimateTemp(p90R, p90G, p90B) {
    if (Math.max(p90R, p90G, p90B) - Math.min(p90R, p90G, p90B) < 3) {
        return { cct: null, pos: 0.5 };
    }
    // 光源色 = (G/B, 1, G/R)：bb 用 R、rr 用 B（勿与注释对调，方向经 18 张实测标定）
    const rr = p90B > 0 ? p90G / p90B : 1;
    const bb = p90R > 0 ? p90G / p90R : 1;
    return avgColorTemp(rr * 255, 255, bb * 255, 1);
}

/* 渲染影调结论：结论名 + 提示 + 分析过程（明度均值/明度/明度宽度）+
   冷暖色谱与平均色温——色谱每张都显示（标记按钳制后 CCT 定位），
   色温数值无效时显示「不適用」 */
function renderTonal(result, temp, els, labels) {
    if (!els.wrap) return;
    els.wrap.style.display = '';
    els.name.textContent = result.name;
    els.hint.textContent = result.hint;
    els.hint.style.display = result.hint ? '' : 'none';
    els.mean.textContent = result.mean;
    els.sigma.textContent = result.sigma;
    els.span.textContent = result.span;
    if (els.temp) {
        els.temp.style.display = '';
        els.tempMarker.style.left = (temp.pos * 100).toFixed(1) + '%';
        els.tempNum.textContent = temp.cct !== null ? temp.cct + 'K' : labels.na;
        // 冷暖结论：标记只要不在正中即给方向——<0.5 偏冷 ｜ =0.5 中性 ｜ >0.5 偏暖
        els.tendency.textContent = temp.pos < 0.5 ? labels.cold : (temp.pos > 0.5 ? labels.warm : labels.neutral);
    }
}

export function initPhotoAnalysis({ histogramWrap, histogramEl, paletteWrap, paletteEl, tonal }) {
    const tonalEls = tonal || {};
    const tonalLabels = tonalEls.wrap ? {
        key: (tonalEls.wrap.dataset.keyNames || '').split('|'),
        range: (tonalEls.wrap.dataset.rangeNames || '').split('|'),
        fullLong: tonalEls.wrap.dataset.fullLong || '',
        near: tonalEls.wrap.dataset.near || '',
        spanApparent: tonalEls.wrap.dataset.spanApparent || '',
        na: tonalEls.wrap.dataset.na || '不適用',
        cold: tonalEls.wrap.dataset.cold || '偏冷',
        warm: tonalEls.wrap.dataset.warm || '偏暖',
        neutral: tonalEls.wrap.dataset.neutral || '中性',
    } : null;

    const cache = new Map(); // src → { buckets, logMax, palette, tonal, temp }

    function hideAll() {
        if (histogramWrap) histogramWrap.style.display = 'none';
        if (paletteWrap) paletteWrap.style.display = 'none';
        if (tonalEls.wrap) tonalEls.wrap.style.display = 'none';
    }

    /* 分析指定作品：缓存命中直接重绘；否则探测加载 w_1024 缩略图统计。
       直方图/色卡/影调区块都被配置关闭时跳过探测（不发请求）。
       请求代次（analyzeSeq）：快速切图时慢探测乱序完成，代次不符不渲染过期结果 */
    let analyzeSeq = 0;
    function analyze(src) {
        if (!histogramEl && !paletteEl && !tonalEls.wrap) return;
        const mySeq = ++analyzeSeq;
        const cached = cache.get(src);
        if (cached) {
            if (histogramEl) {
                paintHistogram(cached.buckets, cached.logMax, histogramEl);
                histogramWrap.style.display = '';
            }
            if (paletteEl) renderPalette(cached.palette, paletteWrap, paletteEl);
            if (tonalEls.wrap) renderTonal(cached.tonal, cached.temp, tonalEls, tonalLabels);
            return;
        }
        const probeSrc = src.replace(/w_\d+/, 'w_1024'); // 与参考网站的 ≤1024px 采样同级，跨度/色温口径对齐
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

                const BINS = 256;
                const buckets = [new Array(BINS).fill(0), new Array(BINS).fill(0), new Array(BINS).fill(0)];
                const lumHist = new Array(BINS).fill(0); // 影调统计用（未平滑）
                let lumSum = 0;
                let lumSq = 0;
                let clipped = 0;
                for (let i = 0; i < data.length; i += 4) {
                    // bin 下标 = 像素值本身（0-255，BINS=256）
                    buckets[0][data[i]]++;
                    buckets[1][data[i + 1]]++;
                    buckets[2][data[i + 2]]++;
                    // 亮度 = Rec.709 权重（影调判定与 σ 均基于此）。通道顺序与参考网站
                    // 实测对齐（其「明度均值」同为 0.2126·B + 0.7152·G + 0.0722·R，
                    // 对照 18 张均值吻合；按标准 R/B 顺序反而与其差 3–4 分——勿按常规修正）
                    const lum = 0.2126 * data[i + 2] + 0.7152 * data[i + 1] + 0.0722 * data[i];
                    lumHist[Math.min(255, lum | 0)]++;
                    lumSum += lum;
                    lumSq += lum * lum;
                    if (lum < 1 || lum > 254) clipped++;
                }
                // 白平衡白点：各通道 90 分位（须在显示用平滑之前提取——百分位需要原始分布）
                let p90R = 255, p90G = 255, p90B = 255;
                if (tonalEls.wrap) {
                    const p90Total = data.length / 4;
                    p90R = percentileOf(buckets[0], p90Total, 0.9); // buckets[0] = R
                    p90G = percentileOf(buckets[1], p90Total, 0.9);
                    p90B = percentileOf(buckets[2], p90Total, 0.9); // buckets[2] = B
                }
                // 轻量滑动平均（窗口 5），曲线更接近 Camera Raw 的平滑形态
                buckets.forEach((b) => {
                    const srcBuf = b.slice();
                    for (let i = 0; i < BINS; i++) {
                        let sum = 0;
                        let n = 0;
                        for (let k = i - 2; k <= i + 2; k++) {
                            if (k >= 0 && k < BINS) { sum += srcBuf[k]; n++; }
                        }
                        b[i] = sum / n;
                    }
                });
                let max = 1;
                buckets.forEach(b => b.forEach(v => { if (v > max) max = v; }));
                const logMax = Math.log1p(max);
                const palette = computePalette(data);
                let tonal = null;
                let temp = null;
                if (tonalEls.wrap) {
                    const total = data.length / 4;
                    tonal = judgeTonal(analyzeLuminance(lumHist, lumSum, lumSq, clipped, total), tonalLabels);
                    temp = estimateTemp(p90R, p90G, p90B);
                }
                cache.set(src, { buckets, logMax, palette, tonal, temp });
                if (mySeq !== analyzeSeq) return; // 已切到别的作品：结果入缓存但不渲染过期内容
                if (histogramEl) {
                    paintHistogram(buckets, logMax, histogramEl);
                    histogramWrap.style.display = '';
                }
                if (paletteEl) renderPalette(palette, paletteWrap, paletteEl);
                if (tonalEls.wrap) renderTonal(tonal, temp, tonalEls, tonalLabels);
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
