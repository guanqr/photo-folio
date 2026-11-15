/**
 * 灯箱图表的绘制层（纯渲染函数；由 lightbox-analysis.js 引入）
 *
 * 抽出原因：曲线派生、直方图/区域尺/色卡/饱和度/色相的 SVG 绘制与补间动画
 * 全部只依赖入参 DOM 与数据、不持有加载状态；与「拉取/缓存/schema 校验/
 * 代次守卫」分开后，渲染逻辑可单独推理与复用（2026-11-15，拆分时经浏览器
 * 实际渲染回归验证，行为不变）。
 *
 * 颜色字面量：R/G/B 通道色是数据可视化身份色（rgb 计算值），明度曲线金色、
 * 分区底色等走 CSS 变量（--color-* / --dark-lum-curve），不在此硬编码主题色。
 */
import { prefersReducedMotion, easeOutCubic, fillTemplate } from './utils.js';
import { TONAL_ZONE_SHADOW, TONAL_ZONE_HIGH, TONAL_CLIP_DARK, TONAL_CLIP_BRIGHT, ZONE_COUNT, HUE_SEG_COUNT } from './analysis-meta.js';


/* 合并直方图（纯曲线 + 影调注释，连续形变过渡）：
   R/G/B 三通道曲线 + 金色明度曲线——全部为无填充曲线（每通道 256 点
   固定结构，天然平滑、无锯齿无竖条纹，且可形变）+ 陰影/中間調/高光
   三分区底色 + P50 虚线标记（带 x 过渡）+ 两端剪裁三角。
   数据变化时旧曲线与新曲线之间线性插值（0.4s），像曝光灰階括号一样
   连续变形而非跳变 */
const HIST_H = 96;
const HIST_SAMPLES = 256; // 每通道曲线采样点数：d 形变要求点数恒定
// 分析常量（schema 版本 / 影调区界 / 剪裁）由 analysis-meta.js 提供——
// 该文件由管线 analysis.py 生成，站点不再手写第二份
// 明度曲线金色：2026-10-18 收编为 CSS 变量 --dark-lum-curve（样式表设定
// .hist-lum stroke 与图例 .is-lum 圆点背景），JS 不再持有颜色字面量

/* 通道曲线目标 y 数组（线性纵轴、同 max；通道桶已平滑） */
export function channelCurveYs(buckets, max) {
    return buckets.map((arr) => Array.from({ length: HIST_SAMPLES }, (_, x) => {
        const lo = Math.floor((x / (HIST_SAMPLES - 1)) * 255);
        return HIST_H - (arr[Math.min(255, lo)] / max) * (HIST_H - 1);
    }));
}

/* 明度曲线目标 y 数组（线性纵轴、同 max；入参已窗口 5 平滑） */
export function lumCurveYs(smoothLum, max) {
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
export function satYArray(satHist) {
    const H = 48;
    let max = 1;
    satHist.forEach((v) => { if (v > max) max = v; });
    return satHist.map((v) => H - (v / max) * (H - 2) - 1);
}
export function hueYArray(hueHist) {
    return satYArray(hueHist);
}

/* 渲染色卡：每行 = 色块 + (hex / HSL 两行) + 占比（数据来自管线预计算的 palette） */
export function renderPalette(colors, paletteWrap, paletteEl) {
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

/* 影调注释几何常量与區域/色相分段数来自 analysis-meta.js（管线单一源头）；
   判定阈值本体在 tools/photo-pipeline/src/analysis.py */

/* 窗口 5 滑动平均（明度曲线平滑共用） */
export function smooth5(arr) {
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

/* 饱和度直方图：0–100% 分布曲线（100 点固定结构，连续形变过渡）
   + 低/中/高分区底色（分段值来自 JSON satBounds，与管线阈值同源）+ 均值虚线。
   分区用色块而非分界虚线，与明度直方图的三分区底色同一套视觉语言。
   目标 y 数组在拉取后一次算好入缓存，此处只做骨架与过渡 */
function paintSatHistogram(sat, satYs, svg) {
    if (!svg) return;
    const W = 100;
    const H = 48;
    if (!svg._built) {
        svg.innerHTML =
            `<rect class="sat-zone-low" y="0" height="${H}" fill="var(--color-sat-zone-low-bg)"></rect>`
            + `<rect class="sat-zone-mid" y="0" height="${H}" fill="var(--color-sat-zone-mid-bg)"></rect>`
            + `<rect class="sat-zone-high" y="0" height="${H}" fill="var(--color-sat-zone-high-bg)"></rect>`
            + `<path class="sat-curve" fill="none" stroke="var(--color-sat-curve)" stroke-width="1.5" vector-effect="non-scaling-stroke"></path>`
            + `<line class="sat-mean" y1="2" y2="${H - 2}" stroke="var(--color-accent)" stroke-width="1" stroke-dasharray="3 3" vector-effect="non-scaling-stroke"></line>`;
        svg._els = {
            curve: svg.querySelector('.sat-curve'),
            mean: svg.querySelector('.sat-mean'),
            zones: [
                svg.querySelector('.sat-zone-low'),
                svg.querySelector('.sat-zone-mid'),
                svg.querySelector('.sat-zone-high'),
            ],
        };
        svg._built = true;
    }
    // 分区边界逐次写入：satBounds 由 schema 校验保证为两项，不再保留 JS 本地回退常量
    const bounds = sat.satBounds;
    if (!Array.isArray(bounds) || bounds.length !== 2) return;
    const [b0, b1] = bounds;
    const setZone = (rect, x, w) => {
        rect.setAttribute('x', x);
        rect.setAttribute('width', Math.max(0, w));
    };
    setZone(svg._els.zones[0], 0, b0);
    setZone(svg._els.zones[1], b0, b1 - b0);
    setZone(svg._els.zones[2], b1, W - b1);
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
export function renderTone(tone, histYs, lumYs, labels, els) {
    if (!els.wrap) return;
    els.wrap.style.display = '';
    // 经典九调组合名：低调 + 长调 → 低長調（共用「調」后缀；中调键前缀来自 i18n）
    const keyPrefix = tone.key === 1 ? labels.midPrefix : (labels.keyPrefixes[tone.key] || '');
    const parts = [keyPrefix + labels.range[tone.range]];
    tone.warnings.forEach((w) => {
        parts.push(w === 'shadow' ? labels.clipShadow : labels.clipHigh);
    });
    els.name.textContent = parts.join(labels.separator);
    els.dr.textContent = tone.drStops + ' ' + labels.drUnit;
    els.p50.textContent = tone.p50;
    els.fracs[0].style.width = tone.fracs[0] + '%';
    els.fracs[1].style.width = tone.fracs[1] + '%';
    els.fracs[2].style.width = tone.fracs[2] + '%';
    els.fracText.textContent = fillTemplate(labels.fracFormat, {
        SHADOW_NAME: labels.zoneNames[0], SHADOW: tone.fracs[0],
        MID_NAME: labels.zoneNames[1], MID: tone.fracs[1],
        HIGH_NAME: labels.zoneNames[2], HIGH: tone.fracs[2],
    });
    paintHistogram(histYs, lumYs, els.histEl, tone);
    renderHistLegend(els.legendEl, labels.histLegend);
    renderZoneStrip(tone, els.zoneStripEl, els.zoneBracketEl);
}

export function renderSat(sat, satYs, labels, els) {
    if (!els.wrap) return;
    els.wrap.style.display = '';
    els.name.textContent = labels.sat[sat.sat];
    paintSatHistogram(sat, satYs, els.histEl);
}

export function renderHue(hue, hueYs, labels, els) {
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
