/**
 * 灯箱图片分析（直方图 + 色卡 + 影调与色彩——只渲染，统计在管线预计算）
 *
 * 管线：拉取 /analysis/{slug}.json?v=<照片 hash>-<schema 版本>（管线在照片生成
 * 时以全分辨率原图预计算，同源 fetch、SW 运行时缓存离线可回退；单张约 8KB、
 * 压缩后约 3.6KB，零逐像素
 * 客户端成本）；统计口径（Rec.709 明度/九调/剪裁/HSV 饱和度/色相加权/色卡
 * k-means）见 tools/photo-pipeline/src/analysis.py（唯一实现）。灯箱打开/切图
 * 的预取在 lightbox-analysis-data.js（只预热 HTTP/SW 缓存、含 URL 记忆与在途
 * 去重，不加载渲染器）；本模块只负责展开后的拉取与渲染，同 slug + 内容版本的
 * 在途请求去重、结果按版本缓存，切换/回看作品时无需重复拉取。
 *
 * 本端职责：直方图窗口 5 平滑、线性纵轴与目标 y 数组的纯数学派生（每通道
 * 256 点固定结构可形变），以及全部图表渲染（SVG 矢量：高 DPI / 缩放 / 窄屏
 * 下始终清晰，不随像素密度发糊）与切图形变动画（新旧曲线线性插值）。
 */
import { ANALYSIS_VERSION } from './analysis-meta.js';
import { analysisUrl } from './lightbox-analysis-data.js';
import {
    smooth5, channelCurveYs, lumCurveYs, satYArray, hueYArray,
    renderPalette, renderTone, renderSat, renderHue
} from './lightbox-charts-paint.js';

export function initLightboxAnalysis({ paletteWrap, paletteEl, tone, sat, hue, onDone, errorEl }) {
    const toneEls = tone || {};
    const satEls = sat || {};
    const hueEls = hue || {};
    const toneLabels = toneEls.wrap ? {
        keyPrefixes: (toneEls.wrap.dataset.keyPrefixes || '').split('|'),
        range: (toneEls.wrap.dataset.rangeNames || '').split('|'),
        zoneNames: (toneEls.wrap.dataset.zoneNames || '').split('|'),
        clipShadow: toneEls.wrap.dataset.clipShadow,
        clipHigh: toneEls.wrap.dataset.clipHigh,
        midPrefix: toneEls.wrap.dataset.midPrefix,
        drUnit: toneEls.wrap.dataset.drUnit,
        histLegend: toneEls.wrap.dataset.histLegend,
        separator: toneEls.wrap.dataset.separator || '',
        fracFormat: toneEls.wrap.dataset.fracFormat || '',
    } : null;
    const satLabels = satEls.wrap ? {
        sat: (satEls.wrap.dataset.satNames || '').split('|'),
    } : null;
    const hueLabels = hueEls.wrap ? {
        hue: (hueEls.wrap.dataset.hueNames || '').split('|'),
        gray: hueEls.wrap.dataset.hueGray,
    } : null;

    // 缓存键 = slug@内容版本（照片 hash + schema 版本）：换图/算法升级后同一
    // slug 不会命中旧结果；SPA 跨页面复用本模块也不会串版本
    const analysisKey = (slug, hash) => slug + '@' + (hash || '') + '@' + ANALYSIS_VERSION;
    const cache = new Map(); // analysisKey → { histYs, lumYs, satYs, hueYs, palette, tone, sat, hue }
    // 在途拉取（analysisKey → Promise）：展开分析与缓存未命中路径共用同一次
    // 请求（预取只预热 HTTP/SW 缓存，去重由 data 模块负责，不共享本表）
    const inflight = new Map();
    // 任一大类启用才拉取/渲染（配置全关时分析触发行不渲染、预取也不发，
    // 见 lightbox.js 的 prefetchAnalysis 门禁与模板）
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
    async function fetchAnalysis(slug, hash) {
        // URL 与预取统一由 lightbox-analysis-data.js 构造（内容版本口径单源）
        const res = await fetch(analysisUrl(slug, hash));
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const data = await res.json();
        // schema 校验：版本与形状不符（SW 离线回退旧版 JSON、截断文件、
        // 未来版本未同步）→ 明确失败而非静默错位渲染（2026-10-21 审查 #8）
        if (data.v !== ANALYSIS_VERSION) throw new Error('unsupported analysis schema v' + data.v);
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

    /* 同 slug + 版本在途请求去重：槽位随成功/失败释放（失败后展开路径可重试） */
    function load(slug, hash) {
        const key = analysisKey(slug, hash);
        const pending = inflight.get(key);
        if (pending) return pending;
        const p = fetchAnalysis(slug, hash);
        inflight.set(key, p);
        const release = () => { if (inflight.get(key) === p) inflight.delete(key); };
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
    async function analyze(slug, hash) {
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
        const key = analysisKey(slug, hash);
        const cached = cache.get(key);
        if (cached) {
            try {
                // 上次失败的提示随成功结果一并收起（重试命中缓存同样走此路径）
                if (errorEl) errorEl.hidden = true;
                renderEntry(cached);
                if (onDone) onDone(true);
            } catch (err) {
                // 坏缓存条目（此前版本可能已入缓存）：删除后走失败语义——下次
                // 展开重新拉取，不再重复抛 unhandled rejection（2026-10-21 审查 #4）
                cache.delete(key);
                console.warn('[lightbox] cached analysis render failed, purged:', slug, err);
                hideAll();
                if (errorEl) errorEl.hidden = false;
                if (onDone) onDone(false);
            }
            return;
        }
        try {
            const entry = await load(slug, hash);
            if (mySeq !== analyzeSeq) {
                // 已切到别的作品：结果入缓存但不渲染过期内容
                cache.set(key, entry);
                return;
            }
            if (errorEl) errorEl.hidden = true; // 拉取成功：收起上次的失败提示
            renderEntry(entry);
            // 幂等入缓存；渲染异常由缓存命中路径自愈清除，坏数据不长期污染
            //（2026-10-21 审查 #4）
            cache.set(key, entry);
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

    return { analyze };
}
