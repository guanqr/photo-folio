/**
 * 灯箱图片分析（直方图 + 色卡）
 *
 * 管线：探测加载 w_200 缩略图（crossOrigin=anonymous，OSS 未开 CORS 时失败优雅降级）→
 * 离屏 canvas 采样 → 统计三通道 256 桶直方图（窗口 5 平滑、对数纵轴）与
 * 7 个主色色卡（16 级量化 + 贪心种子 + k-means 细化，占比之和 ≈ 100%）。
 * 结果按 src 缓存——切换/回看照片时无需重新探测下载。
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
   viewBox 0 0 256 96——每桶恰为一个单位宽，随容器拉伸缩放仍保持矢量清晰；
   每通道一个 path，mix-blend-mode: plus-lighter 做加法混合（与 canvas lighter 完全一致），
   通道重叠处自然呈现黄/青/品/白 */
const HIST_W = 256;
const HIST_H = 96;

function paintHistogram(buckets, logMax, histogramSvg) {
    if (!histogramSvg) return;
    const BINS = buckets[0].length;
    const channelColors = ['rgb(224, 90, 90)', 'rgb(110, 200, 140)', 'rgb(110, 150, 230)'];
    histogramSvg.innerHTML = buckets.map((bins, c) => {
        let d = `M0 ${HIST_H}`;
        for (let i = 0; i < BINS; i++) {
            const x = (i / (BINS - 1)) * HIST_W;
            const y = HIST_H - (Math.log1p(bins[i]) / logMax) * (HIST_H - 1);
            d += ` L${x.toFixed(2)} ${y.toFixed(2)}`;
        }
        d += ` L${HIST_W} ${HIST_H} Z`;
        return `<path d="${d}" fill="${channelColors[c]}" fill-opacity="0.55" style="mix-blend-mode:plus-lighter"></path>`;
    }).join('');
}

export function initPhotoAnalysis({ histogramWrap, histogramEl, paletteWrap, paletteEl }) {
    const cache = new Map(); // src → { buckets, logMax, palette }

    function hideAll() {
        if (histogramWrap) histogramWrap.style.display = 'none';
        if (paletteWrap) paletteWrap.style.display = 'none';
    }

    /* 分析指定照片：缓存命中直接重绘；否则探测加载 w_200 缩略图统计。
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
