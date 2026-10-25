/**
 * 灯箱图片分析（直方图 + 色卡 + 影调与色彩——只渲染，统计在管线预计算）
 *
 * 管线：拉取 /analysis/{slug}.json（管线在照片生成时以全分辨率原图预计算，
 * 同源 fetch、SW 运行时缓存离线可回退；单张约 8KB、压缩后约 3.6KB，零逐像素
 * 客户端成本）；统计口径（Rec.709 明度/九调/剪裁/HSV 饱和度/色相加权/色卡
 * k-means）见 tools/photo-pipeline/src/analysis.py（唯一实现）。灯箱打开/切图
 * 即预取当前照片与左右各一位（prefetch，只填缓存不渲染），展开时直接渲染——
 * 避免展开后才发请求、空等一次网络往返；同 slug 在途请求去重，结果按 slug
 * 缓存，切换/回看作品时无需重复拉取。
 *
 * 本端职责：直方图窗口 5 平滑、线性纵轴与目标 y 数组的纯数学派生（每通道
 * 256 点固定结构可形变），以及全部图表渲染（SVG 矢量：高 DPI / 缩放 / 窄屏
 * 下始终清晰，不随像素密度发糊）与切图形变动画（新旧曲线线性插值）。
 */
import { prefersReducedMotion, easeOutCubic } from './utils.js';

/* 合并直方图（纯曲线 + 影调注释，连续形变过渡）：
   R/G/B 三通道曲线 + 金色明度曲线——全部为无填充曲线（每通道 256 点
   固定结构，天然平滑、无锯齿无竖条纹，且可形变）+ 陰影/中間調/高光
   三分区底色 + P50 虚线标记（带 x 过渡）+ 两端剪裁三角。
   数据变化时旧曲线与新曲线之间线性插值（0.4s），像曝光灰階括号一样
   连续变形而非跳变 */
const HIST_H = 96;
const HIST_SAMPLES = 256; // 每通道曲线采样点数：d 形变要求点数恒定
// 明度曲线金色：2026-10-18 收编为 CSS 变量 --dark-lum-curve（样式表设定
// .hist-lum stroke 与图例 .is-lum 圆点背景），JS 不再持有颜色字面量

/* 通道曲线目标 y 数组（线性纵轴、同 max；通道桶已平滑） */
function channelCurveYs(buckets, max) {
    return buckets.map((arr) => Array.from({ length: HIST_SAMPLES }, (_, x) => {
        const lo = Math.floor((x / (HIST_SAMPLES - 1)) * 255);
        return HIST_H - (arr[Math.min(255, lo)] / max) * (HIST_H - 1);
    }));
}

/* 明度曲线目标 y 数组（线性纵轴、同 max；入参已窗口 5 平滑） */
function lumCurveYs(smoothLum, max) {
    return Array.from({ length: HIST_SAMPLES }, (_, i) => {
        const x = (i / (HIST_SAMPLES - 1)) * 255;
        const lo = Math.floor(x);
        const hi = Math.min(lo + 1, 255);
        const t = x - lo;
        const v = (1 - t) * smoothLum[lo] + t * smoothLum[hi];
        return HIST_H - (v / max) * (HIST_H - 1);
    });
}

/* 曲线路径（固定点数不闭合）；x 坐标前缀跨帧不变，预计算一次 */
const HIST_X = Array.from({ length: HIST_SAMPLES }, (_, i) => ((i / (HIST_SAMPLES - 1)) * 255).toFixed(2));
function histLineD(ys) {
    let d = '';
    for (let i = 0; i < HIST_SAMPLES; i++) {
        d += (i === 0 ? 'M' : 'L') + HIST_X[i] + ',' + ys[i].toFixed(2);
    }
    return d;
}

/* 饱和度/色相柱的目标 y 数组（按峰缩放，拉取后一次算好入缓存） */
function satYArray(satHist) {
    const H = 48;
    let max = 1;
    satHist.forEach((v) => { if (v > max) max = v; });
    return satHist.map((v) => H - (v / max) * (H - 2) - 1);
}
function hueYArray(hueHist) {
    return satYArray(hueHist);
}

/* 渲染色卡：每行 = 色块 + (hex / HSL 两行) + 占比（数据来自管线预计算的 palette） */
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

function paintHistogram(histYs, lumYs, histogramSvg, tone) {
    if (!histogramSvg) return;
    const channelColors = [[224, 90, 90], [110, 200, 140], [110, 150, 230]];
    // 骨架（一次性构建）：R/G/B 通道曲线 + 明度曲线 + 影调注释层，元素引用
    // 一并缓存——过渡期间每帧直接用引用，不做 DOM 查询
    if (!histogramSvg._built) {
        histogramSvg.innerHTML = channelColors.map(([r, g, b], i) =>
            `<path class="hist-ch ch${i}" fill="none" stroke="rgb(${r},${g},${b})" stroke-width="1.5" vector-effect="non-scaling-stroke"></path>`).join('')
            + `<path class="hist-lum" fill="none" stroke-width="1.5" vector-effect="non-scaling-stroke"></path>`;
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
        histogramSvg._els = {
            chs: Array.from(histogramSvg.querySelectorAll('.hist-ch')),
            lum: histogramSvg.querySelector('.hist-lum'),
            p50: histogramSvg.querySelector('.hist-p50'),
            markShadow: histogramSvg.querySelector('.hist-mark-shadow'),
            markHigh: histogramSvg.querySelector('.hist-mark-high'),
        };
        histogramSvg._built = true;
    }
    const p50 = tone ? tone.p50 : 0;
    const apply = (arrs) => {
        histogramSvg._els.chs.forEach((p, i) => p.setAttribute('d', histLineD(arrs[i])));
        histogramSvg._els.lum.setAttribute('d', histLineD(arrs[3]));
        histogramSvg._els.p50.setAttribute('x1', arrs[4][0]);
        histogramSvg._els.p50.setAttribute('x2', arrs[4][0]);
    };
    const toArrs = histYs.concat([lumYs || histYs[0], [p50]]);
    if (histogramSvg._prevYs) {
        tweenMulti(histogramSvg, histogramSvg._prevYs, toArrs, apply);
    } else {
        apply(toArrs);
    }
    histogramSvg._prevYs = toArrs;
    // 剪裁标记按警告开关（固定位置，即时切换）
    if (tone) {
        histogramSvg._els.markShadow.setAttribute('d',
            tone.warnings.includes('shadow') ? `M${TONAL_CLIP_DARK},1 l4,0 l-2,6 z` : '');
        histogramSvg._els.markHigh.setAttribute('d',
            tone.warnings.includes('high') ? `M${TONAL_CLIP_BRIGHT},1 l-4,0 l2,6 z` : '');
    }
}

/* 影调注释几何常量（分区界与剪裁三角位置；判定阈值本体在管线 analysis.py） */
const TONAL_ZONE_SHADOW = 85; // 18% 灰（118）向下精确 1 档曝光：0.18/2 经 sRGB
                              // 标准传递函数（IEC 61966-2-1）编码 ≈ 85（原 √2 近似 83 为约 1.1 档）
const TONAL_ZONE_HIGH = 162; // 18% 灰向上精确 1 档曝光：0.18×2 编码 ≈ 162
const TONAL_CLIP_DARK = 5; // 陰影剪裁上界
const TONAL_CLIP_BRIGHT = 250; // 高光剪裁下界

const ZONE_COUNT = 11; // 區域系統 0–X
const HUE_SEG_COUNT = 36; // 色相直方图 36 段（每段 10°）

/* 窗口 5 滑动平均（明度曲线平滑共用） */
function smooth5(arr) {
    const out = arr.slice();
    for (let i = 0; i < arr.length; i++) {
        let sum = 0;
        let n = 0;
        for (let k = i - 2; k <= i + 2; k++) {
            if (k >= 0 && k < arr.length) { sum += arr[k]; n++; }
        }
        out[i] = sum / n;
    }
    return out;
}

/* ===== 图表渲染 ===== */

/* 图表连续过渡：旧数据与新数据之间线性插值（rAF 驱动，时长与缓动取自
   CSS 变量 --transition-chart——与曝光灰階括号/占比条的 CSS 过渡同源同节奏）；
   曲线连续形变而非跳变；新过渡到来时中断上一次未完成的过渡，从**当前已
   显示的中间帧**继续变形（而不是从上一次的目标值回跳）；
   prefers-reduced-motion 时跳过过渡直接呈现 */
const TWEEN_MS = (() => {
    const v = getComputedStyle(document.documentElement).getPropertyValue('--transition-chart');
    const m = v.match(/([\d.]+)s/);
    return m ? Math.round(parseFloat(m[1]) * 1000) : 400;
})();

function tweenMulti(el, fromArrs, toArrs, apply) {
    if (el._raf) {
        cancelAnimationFrame(el._raf);
        el._raf = null;
        // 中断：以上一帧已应用的中途状态为新起点（若中途状态不存在——如
        // 上一过渡已完成——则退回调用方提供的 fromArrs）
        if (el._lastMid) fromArrs = el._lastMid;
    }
    if (prefersReducedMotion()) {
        el._lastMid = null;
        apply(toArrs);
        return;
    }
    const t0 = performance.now();
    const step = (now) => {
        const t = Math.min(1, (now - t0) / TWEEN_MS);
        const k = easeOutCubic(t);
        const mid = fromArrs.map((arr, a) => arr.map((v, i) => v + (toArrs[a][i] - v) * k));
        apply(t < 1 ? mid : toArrs);
        if (t < 1) {
            el._lastMid = mid;
            el._raf = requestAnimationFrame(step);
        } else {
            el._lastMid = null;
            el._raf = null;
        }
    };
    el._raf = requestAnimationFrame(step);
}

/* 直方图图例：R/G/B 通道色与明度曲线色（一次性构建，名称来自模板的 i18n 数据属性）；
   R/G/B 为通道身份色（数据可视化、rgb 计算值），明度曲线金色走 CSS 变量 */
function renderHistLegend(legendEl, labels) {
    if (!legendEl || legendEl._built) return;
    const colors = ['rgb(224, 90, 90)', 'rgb(110, 200, 140)', 'rgb(110, 150, 230)'];
    const names = labels.split('|');
    legendEl.textContent = '';
    names.forEach((name, i) => {
        const item = document.createElement('span');
        const dot = document.createElement('i');
        if (i < colors.length) {
            dot.style.background = colors[i];
        } else {
            dot.className = 'is-lum'; // 明度曲线色：样式表设定（--dark-lum-curve）
        }
        const text = document.createElement('span');
        text.textContent = name;
        item.append(dot, text);
        legendEl.appendChild(item);
    });
    legendEl._built = true;
}

/* 區域系統标尺：11 级等距灰阶（0 纯黑 → X 纯白；与管线 zoneOf 的
   v/255×10 线性映射一致，色块灰度即该区对应的明度值），括号标出照片
   P5–P95 占據區域——与長/中/短調的灰階跨度判定同源（2026-10-25） */
function renderZoneStrip(tone, stripEl, bracketEl) {
    if (!stripEl) return;
    if (!stripEl._built) {
        stripEl.innerHTML = Array.from({ length: ZONE_COUNT }, (_, n) => {
            const v = Math.round((255 * n) / (ZONE_COUNT - 1));
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

/* 饱和度直方图：0–100% 分布曲线（100 点固定结构，连续形变过渡）+ 均值标记
   + 低/中/高分界线（数值来自 JSON satBounds，避免与管线阈值脱钩）。
   目标 y 数组在拉取后一次算好入缓存，此处只做骨架与过渡 */
function paintSatHistogram(sat, satYs, svg) {
    if (!svg) return;
    const W = 100;
    const H = 48;
    if (!svg._built) {
        const guides = (sat.satBounds || []).map((x) =>
            `<line class="sat-threshold" x1="${x}" x2="${x}" y1="2" y2="${H - 2}" stroke="var(--color-text-muted)" stroke-width="1" stroke-dasharray="2 3" opacity="0.7" vector-effect="non-scaling-stroke"></line>`).join('');
        svg.innerHTML = guides
            + `<path class="sat-curve" fill="none" stroke="var(--color-sat-curve)" stroke-width="1.5" vector-effect="non-scaling-stroke"></path>`
            + `<line class="sat-mean" y1="2" y2="${H - 2}" stroke="var(--color-accent)" stroke-width="1" stroke-dasharray="3 3" vector-effect="non-scaling-stroke"></line>`;
        svg._els = { curve: svg.querySelector('.sat-curve'), mean: svg.querySelector('.sat-mean') };
        svg._built = true;
    }
    const apply = (arrs) => {
        const ys = arrs[0];
        let d = '';
        for (let x = 0; x < W; x++) d += (x === 0 ? 'M' : 'L') + x + ',' + ys[x].toFixed(2);
        svg._els.curve.setAttribute('d', d);
        svg._els.mean.setAttribute('x1', arrs[1][0]);
        svg._els.mean.setAttribute('x2', arrs[1][0]);
    };
    const toArrs = [satYs, [sat.satMean]];
    if (svg._prevYs) tweenMulti(svg, svg._prevYs, toArrs, apply);
    else apply(toArrs);
    svg._prevYs = toArrs;
}

/* 色相直方图：36 段（每段 10°），每段填其色相本色，主色相段高亮描边；
   黑白照以灰色柱呈现（无色相）；柱高连续形变过渡（过渡期间每帧只写
   y/height，静态属性与颜色在骨架/渲染时各写一次） */
function paintHueHistogram(hue, hueYs, svg) {
    if (!svg) return;
    const H = 48;
    if (!svg._built) {
        svg.innerHTML = Array.from({ length: HUE_SEG_COUNT }, (_, i) =>
            `<rect x="${i * 10 + 1}" width="8"></rect>`).join('');
        svg._rects = Array.from(svg.children);
        svg._built = true;
    }
    // 静态属性与颜色（不随过渡变化）：每次渲染写一次
    svg._rects.forEach((rect, i) => {
        const fill = hue.achromatic ? 'hsl(0, 0%, 60%)' : `hsl(${i * 10 + 5}, 70%, 55%)`;
        const dominant = !hue.achromatic && i === hue.hueSeg;
        rect.setAttribute('fill', fill);
        rect.setAttribute('opacity', dominant ? '1' : '0.55');
        rect.setAttribute('stroke', dominant ? 'var(--color-text)' : 'none');
        rect.setAttribute('stroke-width', '0.5');
    });
    const apply = (ys) => {
        svg._rects.forEach((rect, i) => {
            const y = ys[i];
            rect.setAttribute('y', y.toFixed(2));
            // 切图 tween/浮点边缘可能把零值柱的 y 推到 47 以上，height 算成
            // -0.01 触发 SVG 属性校验错误——柱高钳到 0（2026-10-25 实测）
            rect.setAttribute('height', Math.max(0, H - 1 - y).toFixed(2));
        });
    };
    if (svg._prevYs) tweenMulti(svg, [svg._prevYs], [hueYs], (arrs) => apply(arrs[0]));
    else apply(hueYs);
    svg._prevYs = hueYs;
}

/* 渲染影调结论与图表：结论（九调标准命名：高/中/低調 × 長/中/短調，如「低長調」，
   中调键取「中」前缀）+ 剪裁警告、合并直方图（RGB 通道 + 明度曲线 + 三分区/P50/剪裁注释）、
   區域系統、三区占比条、数据行（動態範圍/明度中位數） */
function renderTone(tone, histYs, lumYs, labels, els) {
    if (!els.wrap) return;
    els.wrap.style.display = '';
    // 经典九调组合名：低调 + 长调 → 低長調（共用「調」后缀；中调键前缀来自 i18n）
    const keyPrefix = tone.key === 1 ? labels.midPrefix : labels.key[tone.key].slice(0, -1);
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
    paintHistogram(histYs, lumYs, els.histEl, tone);
    renderHistLegend(els.legendEl, labels.histLegend);
    renderZoneStrip(tone, els.zoneStripEl, els.zoneBracketEl);
}

function renderSat(sat, satYs, labels, els) {
    if (!els.wrap) return;
    els.wrap.style.display = '';
    els.name.textContent = labels.sat[sat.sat];
    paintSatHistogram(sat, satYs, els.histEl);
}

function renderHue(hue, hueYs, labels, els) {
    if (!els.wrap) return;
    els.wrap.style.display = '';
    // 主色相名：8 个标准色名（来自模板 i18n 数据属性）按 45° 段映射，
    // 用段中心（+0.5）计算——用段索引会在 4 条边界带错位约 5–7.5°
    const hueIdx = Math.round((hue.hueSeg + 0.5) / (HUE_SEG_COUNT / labels.hue.length)) % labels.hue.length;
    els.name.textContent = hue.achromatic ? labels.gray : labels.hue[hueIdx];
    // 色相轴标注：8 个标准色名沿横向均布（一次性构建）
    if (els.axisEl && !els.axisEl._built) {
        els.axisEl.textContent = '';
        labels.hue.forEach((name) => {
            const span = document.createElement('span');
            span.textContent = name;
            els.axisEl.appendChild(span);
        });
        els.axisEl._built = true;
    }
    paintHueHistogram(hue, hueYs, els.histEl);
}

export function initLightboxAnalysis({ paletteWrap, paletteEl, tone, sat, hue, onDone, errorEl }) {
    const toneEls = tone || {};
    const satEls = sat || {};
    const hueEls = hue || {};
    const toneLabels = toneEls.wrap ? {
        key: (toneEls.wrap.dataset.keyNames || '').split('|'),
        range: (toneEls.wrap.dataset.rangeNames || '').split('|'),
        zoneNames: (toneEls.wrap.dataset.zoneNames || '').split('|'),
        clipShadow: toneEls.wrap.dataset.clipShadow,
        clipHigh: toneEls.wrap.dataset.clipHigh,
        midPrefix: toneEls.wrap.dataset.midPrefix,
        drUnit: toneEls.wrap.dataset.drUnit,
        histLegend: toneEls.wrap.dataset.histLegend,
    } : null;
    const satLabels = satEls.wrap ? {
        sat: (satEls.wrap.dataset.satNames || '').split('|'),
    } : null;
    const hueLabels = hueEls.wrap ? {
        hue: (hueEls.wrap.dataset.hueNames || '').split('|'),
        gray: hueEls.wrap.dataset.hueGray,
    } : null;

    const cache = new Map(); // slug → { histYs, lumYs, satYs, hueYs, palette, tone, sat, hue }
    // 在途拉取（slug → Promise）：预取与展开分析共用同一次请求——打开灯箱即
    // 预取、用户点展开时通常已完成；若仍在途则等待同一 Promise，不重复下载
    const inflight = new Map();
    // 任一大类启用才拉取/渲染（配置全部关闭时连预取请求也不发）
    const hasAnalysis = !!(paletteEl || toneEls.wrap || satEls.wrap || hueEls.wrap);

    function hideAll() {
        if (paletteWrap) paletteWrap.style.display = 'none';
        if (toneEls.wrap) toneEls.wrap.style.display = 'none';
        if (satEls.wrap) satEls.wrap.style.display = 'none';
        if (hueEls.wrap) hueEls.wrap.style.display = 'none';
    }

    function renderEntry(entry) {
        if (paletteEl) renderPalette(entry.palette, paletteWrap, paletteEl);
        if (toneEls.wrap) renderTone(entry.tone, entry.histYs, entry.lumYs, toneLabels, toneEls);
        if (satEls.wrap) renderSat(entry.sat, entry.satYs, satLabels, satEls);
        if (hueEls.wrap) renderHue(entry.hue, entry.hueYs, hueLabels, hueEls);
    }

    /* 拉取并派生单张作品的分析结果：schema 校验后一次算好各图表目标 y 数组
       （纯数学，缓存命中路径零重算）。 */
    async function fetchAnalysis(slug) {
        const res = await fetch('/analysis/' + encodeURIComponent(slug) + '.json');
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const data = await res.json();
        // schema 校验：版本与形状不符（SW 离线回退旧版 JSON、截断文件、
        // 未来 v3 未同步）→ 明确失败而非静默错位渲染（2026-10-21 审查 #8；
        // 版本号与管线 ANALYSIS_VERSION 对应、升级须两处同步）
        if (data.v !== 4) throw new Error('unsupported analysis schema v' + data.v);
        if (!Array.isArray(data.rgb) || data.rgb.length !== 3
            || !data.rgb.every((a) => Array.isArray(a) && a.length === 256)
            || !Array.isArray(data.lum) || data.lum.length !== 256
            || !Array.isArray(data.sat) || data.sat.length !== 100
            || !Array.isArray(data.hue) || data.hue.length !== 36
            || !data.tone || !data.color
            || !Array.isArray(data.color.satBounds) || data.color.satBounds.length !== 2
            || !Array.isArray(data.palette)) {
            throw new Error('malformed analysis schema');
        }
        // 曲线派生（纯数学）：通道桶窗口 5 平滑 + 线性纵轴 + 各图表目标
        // y 数组——统一最大值同时覆盖 RGB 与明度峰值（明度分布可能比单通道
        // 更集中，只按 RGB 峰值归一化会越过图表顶部）；一次算好随结果返回，
        // 缓存命中路径零重算
        const buckets = data.rgb.map((arr) => smooth5(arr));
        const smoothLum = smooth5(data.lum);
        let max = 1;
        buckets.forEach((arr) => arr.forEach((v) => { if (v > max) max = v; }));
        smoothLum.forEach((v) => { if (v > max) max = v; });
        const histYs = toneEls.wrap ? channelCurveYs(buckets, max) : null;
        const lumYs = toneEls.wrap ? lumCurveYs(smoothLum, max) : null;
        const satYs = satEls.wrap ? satYArray(data.sat) : null;
        const hueYs = hueEls.wrap ? hueYArray(data.hue) : null;
        const palette = data.palette;
        const tone = toneEls.wrap ? data.tone : null;
        // 饱和度与色相共用同一份定性统计（schema 的 color 对象）
        const satHue = (satEls.wrap || hueEls.wrap) ? {
            sat: data.color.sat,
            satMean: data.color.satMean,
            satBounds: data.color.satBounds,
            achromatic: data.color.achromatic,
            hueSeg: data.color.hueSeg,
        } : null;
        return { histYs, lumYs, satYs, hueYs, palette, tone, sat: satHue, hue: satHue };
    }

    /* 同 slug 在途请求去重：槽位随成功/失败释放（失败后展开路径可重试） */
    function load(slug) {
        const pending = inflight.get(slug);
        if (pending) return pending;
        const p = fetchAnalysis(slug);
        inflight.set(slug, p);
        const release = () => { if (inflight.get(slug) === p) inflight.delete(slug); };
        p.then(release, release);
        return p;
    }

    /* 分析指定作品：缓存命中直接重绘；否则等待（或发起）结果拉取——统计在
       管线生成时以全分辨率原图完成（见 tools/photo-pipeline/src/analysis.py），
       本端只做曲线派生与渲染、零逐像素成本。
       请求代次（analyzeSeq）：快速切图时慢响应乱序完成，代次不符不渲染过期结果。
       onDone 完成回调（图表内容高度变化后由调用方刷新抽屉箭头状态）：仅当前
       代次结束时触发——代次不符的过期响应已被新一次 analyze 取代 */
    let analyzeSeq = 0;
    async function analyze(slug) {
        if (!hasAnalysis) return;
        const mySeq = ++analyzeSeq;
        // 空 slug 守卫：无数据源的照片直接走失败语义（今日模板恒写 data-slug
        // 不可达；未来新增 [data-title] 根漏写 slug 时防 fetch /analysis/.json）
        if (!slug) {
            console.warn('[lightbox] analysis slug is empty');
            hideAll();
            if (errorEl) errorEl.hidden = false;
            if (onDone) onDone(false);
            return;
        }
        // 失败提示卡在入口不提前收起：保持上一张的可见状态直到新结果就绪——
        // 双失败切图时提示卡是分析区唯一内容，提前隐藏会让整区塌缩为 0 高、
        // 上方 EXIF 随 is-fit 重判两段式跳动（2026-10-19 修复）；结果到达后
        // 成功路径收起、失败路径幂等置位（恒显示则零视觉变化），状态恒定无跳动
        const cached = cache.get(slug);
        if (cached) {
            try {
                // 上次失败的提示随成功结果一并收起（重试命中缓存同样走此路径）
                if (errorEl) errorEl.hidden = true;
                renderEntry(cached);
                if (onDone) onDone(true);
            } catch (err) {
                // 坏缓存条目（此前版本可能已入缓存）：删除后走失败语义——下次
                // 展开重新拉取，不再重复抛 unhandled rejection（2026-10-21 审查 #4）
                cache.delete(slug);
                console.warn('[lightbox] cached analysis render failed, purged:', slug, err);
                hideAll();
                if (errorEl) errorEl.hidden = false;
                if (onDone) onDone(false);
            }
            return;
        }
        try {
            const entry = await load(slug);
            if (mySeq !== analyzeSeq) {
                // 已切到别的作品：结果入缓存但不渲染过期内容
                cache.set(slug, entry);
                return;
            }
            if (errorEl) errorEl.hidden = true; // 拉取成功：收起上次的失败提示
            renderEntry(entry);
            // 幂等入缓存（预取可能已写入同一结果）；渲染异常由缓存命中路径
            // 自愈清除，坏数据不长期污染（2026-10-21 审查 #4）
            cache.set(slug, entry);
            if (onDone) onDone(true);
        } catch (err) {
            console.warn('[lightbox] analysis load failed:', slug, err);
            // 代次守卫与成功路径对称：迟到的过期失败不得隐藏当前已渲染的照片
            if (mySeq === analyzeSeq) {
                hideAll();
                if (errorEl) errorEl.hidden = false;
                if (onDone) onDone(false);
            }
        }
    }

    /* 预取（不渲染）：灯箱打开/切图时由调用方触发，填充缓存供展开时直接渲染。
       失败仅告警、不入缓存——展开路径 analyze 会重试并走失败提示；空 slug /
       已缓存直接返回。 */
    function prefetch(slug) {
        if (!hasAnalysis) return;
        if (!slug || cache.has(slug)) return;
        load(slug).then(
            (entry) => cache.set(slug, entry),
            (err) => console.warn('[lightbox] analysis prefetch failed:', slug, err)
        );
    }

    return { analyze, prefetch };
}
