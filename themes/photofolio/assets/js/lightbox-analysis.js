/**
 * 灯箱图片分析（直方图 + 色卡）
 *
 * 管线：探测加载 w_200 缩略图（crossOrigin=anonymous，OSS 未开 CORS 时失败优雅降级）→
 * 离屏 canvas 采样 → 统计三通道 256 桶直方图（窗口 5 平滑、对数纵轴）与
 * 7 个主色色卡（16 级量化 + 贪心种子 + k-means 细化，占比之和 ≈ 100%）。
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

    // 种子：贪心取频次最高且互不靠近的桶（最多 7 个）
    const MIN_DIST2 = 60 * 60;
    const centers = [];
    for (const c of buckets) {
        if (centers.length >= 7) break;
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
const HIST_W = 256;
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

export function initPhotoAnalysis({ histogramWrap, histogramEl, paletteWrap, paletteEl }) {
    const cache = new Map(); // src → { buckets, logMax, palette }

    function hideAll() {
        if (histogramWrap) histogramWrap.style.display = 'none';
        if (paletteWrap) paletteWrap.style.display = 'none';
    }

    /* 分析指定作品：缓存命中直接重绘；否则探测加载 w_200 缩略图统计。
       直方图与色卡区块都被配置关闭时跳过探测（不发请求） */
    function analyze(src) {
        if (!histogramEl && !paletteEl) return;
        const cached = cache.get(src);
        if (cached) {
            if (histogramEl) {
                paintHistogram(cached.buckets, cached.logMax, histogramEl);
                histogramWrap.style.display = '';
            }
            if (paletteEl) renderPalette(cached.palette, paletteWrap, paletteEl);
            return;
        }
        const probeSrc = src.replace(/w_\d+/, 'w_200');
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
                for (let i = 0; i < data.length; i += 4) {
                    // bin 下标 = 像素值本身（0-255，BINS=256）
                    buckets[0][data[i]]++;
                    buckets[1][data[i + 1]]++;
                    buckets[2][data[i + 2]]++;
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
                cache.set(src, { buckets, logMax, palette });
                if (histogramEl) {
                    paintHistogram(buckets, logMax, histogramEl);
                    histogramWrap.style.display = '';
                }
                if (paletteEl) renderPalette(palette, paletteWrap, paletteEl);
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
