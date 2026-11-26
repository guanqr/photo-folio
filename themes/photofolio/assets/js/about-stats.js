// 關於頁「拍攝檔案」統計卡片：跨 769px 斷點的兩列↔單列 FLIP（與分類/系列卡片同款機制，
// 參考 cards-flip.js / masonry.js 的檔位經驗）：
// - 列數由 JS 驅動（內聯樣式覆蓋 CSS 媒體查詢——後者保留為無 JS 降級）
// - 檔位信號與瀑布流/卡片网格同源：只讀 :root 的 --layout-tier / --layout-tier-exit
//   （CSS 媒體查詢寫入）；不用 matchMedia/innerWidth——iPad Safari 旋轉後可能陳舊
// - 滯回：升档需 exit 档位 >= 2，降档随基础档位立即生效
// - 斷點切換時做受控 FLIP：取 First → 改列數 → 強制回流 → 記 Last → 位移回放 +
//   真實寬高過渡（完全不用縮放——卡內文字絕不拉伸變形，寬高過渡每幀按真實佈局重排內容）
// - First 基准取「上一帧缓存」而非回调现场量测：RO 回调在布局切换（视口宽度已变、
//   列数尚未换）之后执行，现场量测会把旧列数在新宽度下的拉伸结果当起点——宽化时
//   卡片先被拉成近整页宽再缩回（「变形过头再弹回来」，2026-11-26）。缓存每帧刷新，
//   动画期间暂停（避免把变换中的位置当基准）——与顶部头像/信息 FLIP 同款经验
// - 拖动缩放期间（容器宽度每帧变化）：动画在途就以「当前可视矩形」为 First 重新
//   定向（retarget），目标始终跟随当下布局——否则 350ms 的过渡会停在跨越那一刻的
//   目标上（逐帧实测：720px 钉住约 400ms 后跳回 660px）。重定向用更短、前段更快
//   的缓动（RETARGET_TIMING）：标准曲线起始斜率近 0，每帧重启会几乎不前进
// - 斷點內隨意縮放：列數不變，網格自然伸縮，無重排無動畫

import { prefersReducedMotion } from './utils.js';
import { readLayoutTiers, onOrientationChange } from './breakpoints.js';
import { FLIP_DURATION, FLIP_EASE, clearFlipInline, recordFlipRects, resetFlipFinish, scheduleFlipFinish } from './flip.js';

const observed = new Map(); // grid → { ro, two, headerNarrow, headerRects, headerAnimating }

function applyCols(grid, two) {
    grid.style.gridTemplateColumns = two ? '1fr 1fr' : '1fr';
}

// 帶滯回的目標列數：升档需 exit 档位 >= 2；降档随基础档位立即生效
function desiredTwo(current, tiers) {
    if (current) return tiers.tier >= 2;
    return tiers.tier >= 2 && tiers.exit >= 2;
}

/* 拖动中重定向用的过渡参数：更短、前段更快（ease-soft 起始斜率大、无过冲）。
   标准 FLIP 曲线（ease-standard）在 t≈4% 处的进度接近 0——拖动中每帧重启过渡时，
   卡片几乎不前进（实测一直停在 395px 追不上 660px）；换成前段快的短曲线后每帧
   能吃掉约三成差距，跟随延迟约几十像素、松手后 ~0.2s 收敛 */
const RETARGET_TIMING = { duration: 250, ease: 'var(--ease-soft)' };

function flipColumns(grid, entry, nextTwo, firstRects, timing) {
    // 作废旧收尾（槽位在 entry 上）：快速二次翻转时旧定时器会把第二次动画
    // 仍在途的内联样式（width/height/transition）拦腰清掉、卡片中途急停
    //（2026-10-18）
    resetFlipFinish(entry);
    const panels = [...grid.querySelectorAll('.stats-panel')];
    if (prefersReducedMotion()) {
        applyCols(grid, nextTwo); // 减弱动态：直接切换，不播放动画
        entry.two = nextTwo;
        return;
    }
    // First：上一帧缓存（见 recheck 的刷新口径）——RO 回调执行时布局已按新视口
    // 重排，现场量测会把「旧列数在新宽度下的拉伸结果」当起点（宽化时卡片先被
    // 拉成整页宽再缩回，即「变形过头再弹回来」；2026-11-26 与头部回放同因）。
    // 缓存缺失或尺寸不匹配时退回现场量测
    clearFlipInline(panels, { size: true });
    void grid.offsetWidth;
    const first = firstRects && firstRects.length === panels.length
        ? firstRects
        : recordFlipRects(grid, '.stats-panel');
    // 改列数并强制回流：受控重排（与分类/系列卡片同一同步任务量测流程）
    applyCols(grid, nextTwo);
    void grid.offsetWidth;
    const lasts = recordFlipRects(grid, '.stats-panel');
    // Invert：只平移 + 把尺寸设回旧值（px 内联）——完全不做缩放，
    // 卡内文字绝不拉伸变形（宽高过渡每帧按真实布局重排内容）
    panels.forEach((panel, i) => {
        const dx = first[i].left - lasts[i].left;
        const dy = first[i].top - lasts[i].top;
        const w0 = first[i].width;
        const h0 = first[i].height;
        if (!dx && !dy && Math.abs(w0 - lasts[i].width) <= 0.5 && Math.abs(h0 - lasts[i].height) <= 0.5) return;
        panel.style.transition = 'none';
        panel.style.transform = `translate(${dx}px, ${dy}px)`;
        panel.style.width = w0 + 'px';
        panel.style.height = h0 + 'px';
    });
    void grid.offsetWidth;
    // Play：位置平移 + 真实宽高过渡到新布局（默认与 FLIP 同曲线同时长；
    // 拖动中的重定向传更短的 timing，见 RETARGET_TIMING）
    const durationS = ((timing && timing.duration) || FLIP_DURATION) / 1000;
    const ease = (timing && timing.ease) || FLIP_EASE;
    panels.forEach((panel, i) => {
        if (!panel.style.width) return;
        panel.style.transition = `transform ${durationS}s ${ease}, width ${durationS}s ${ease}, height ${durationS}s ${ease}`;
        panel.style.transform = '';
        panel.style.width = lasts[i].width + 'px';
        panel.style.height = lasts[i].height + 'px';
    });
    entry.two = nextTwo;
    // 动画结束后清理内联样式（恢复卡片自身样式，不干扰后续 FLIP 的 First 量测）；
    // 定时器入槽位，二次翻转时在 flipColumns 入口作废旧收尾（见上）
    scheduleFlipFinish(entry, () => {
        clearFlipInline(panels, { size: true });
        // 动画结束后的真实布局刷新基准缓存（下一次翻转到此为止的前一帧）
        entry.panelRects = recordFlipRects(grid, '.stats-panel');
    }, durationS * 1000 + 50);
}

/* ===== 顶部头像/信息的横排↔竖排 FLIP（CSS 已切换布局，用上一帧基准回放） =====
   头像（图片）位移 + 缩放；文字块只平移不缩放——文字宽度跨断点变化大，
   FLIP 的缩放会把字形拉伸变形（头像等图片缩放无感，文字必须豁免） */
function headerEls(container) {
    return [
        { el: container.querySelector('.about-avatar'), scale: true },
        { el: container.querySelector('.about-header-text'), scale: false },
    ].filter((item) => item.el);
}

function rectsOf(els) {
    return els.map((item) => item.el.getBoundingClientRect());
}

function flipHeader(container, entry, fromRects, els, timing) {
    if (prefersReducedMotion()) return;
    const durationS = ((timing && timing.duration) || FLIP_DURATION) / 1000;
    const ease = (timing && timing.ease) || FLIP_EASE;
    // 清掉在途内联样式后量测目标布局（重定向时 fromRects 是清理前的可视矩形）
    clearFlipInline(els.map((item) => item.el));
    void container.offsetWidth;
    const lasts = rectsOf(els);
    els.forEach((item, i) => {
        const el = item.el;
        const dx = fromRects[i].left - lasts[i].left;
        const dy = fromRects[i].top - lasts[i].top;
        const sx = item.scale && lasts[i].width ? fromRects[i].width / lasts[i].width : 1;
        const sy = item.scale && lasts[i].height ? fromRects[i].height / lasts[i].height : 1;
        if (!dx && !dy && Math.abs(sx - 1) <= 0.001 && Math.abs(sy - 1) <= 0.001) return;
        el.style.transition = 'none';
        el.style.transformOrigin = '0 0';
        el.style.transform = `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`;
    });
    void container.offsetWidth;
    els.forEach((item) => {
        const el = item.el;
        if (el.style.transform) {
            el.style.transition = `transform ${durationS}s ${ease}`;
            el.style.transform = '';
        }
    });
    entry.headerAnimating = true;
    // 收尾定时器入槽位：快速二次翻转时先作废旧收尾——否则旧定时器会在第二次
    // 动画中途清掉在途内联样式、且 headerAnimating 提前复位（2026-10-18）
    if (entry.headerFinishTimer) {
        clearTimeout(entry.headerFinishTimer);
        entry.headerFinishTimer = null;
    }
    entry.headerFinishTimer = setTimeout(() => {
        entry.headerFinishTimer = null;
        entry.headerAnimating = false;
        clearFlipInline(els.map((item) => item.el)); // 恢复头像自身的 hover 过渡
    }, durationS * 1000 + 50);
}

/* 网格列数与头部布局的复核：ResizeObserver 与 orientationchange 共用。
   头部横排/竖排由 CSS 切换，这里只比对档位并回放上一帧基准 */
function recheck(grid, entry) {
    if (!grid.isConnected) return;
    // 容器宽度变化检测（拖动缩放时每帧都会命中）
    const width = grid.clientWidth;
    const widthChanged = width !== entry.gridWidth;
    if (widthChanged) entry.gridWidth = width;
    const tiers = readLayoutTiers();
    const next = desiredTwo(entry.two, tiers);
    const animating = !!entry.finishTimer;
    if (next !== entry.two) {
        // 跨档：动画在途时以当前可视矩形为 First（缓存在动画期间暂停刷新），
        // 否则用上一帧缓存（即当前画面上的真实状态）
        flipColumns(grid, entry, next,
            animating ? recordFlipRects(grid, '.stats-panel') : entry.panelRects,
            animating ? RETARGET_TIMING : undefined);
    } else if (widthChanged && animating) {
        // 过渡在途 + 容器宽度继续变化：以当前可视矩形为 First 重新定向，
        // 目标始终是当下布局（见 RETARGET_TIMING 与文件头「拖动缩放期间的过渡定向」）
        flipColumns(grid, entry, entry.two, recordFlipRects(grid, '.stats-panel'), RETARGET_TIMING);
    }
    // 面板基准每帧刷新（动画期间暂停，避免把变换中的位置当基准）——
    // FLIP 的 First 取的就是这份「上一帧」矩形，而非 RO 回调时的现场量测
    if (!entry.finishTimer) entry.panelRects = recordFlipRects(grid, '.stats-panel');
    const container = grid.closest('.about-container');
    if (!container) return;
    const els = headerEls(container);
    const nowNarrow = tiers.tier < 2;
    if (entry.headerAnimating && widthChanged) {
        // 头部回放动画途中容器又变：以当前可视状态重新定向（与面板同口径）
        flipHeader(container, entry, rectsOf(els), els, RETARGET_TIMING);
    } else if (nowNarrow !== entry.headerNarrow && !entry.headerAnimating) {
        flipHeader(container, entry, entry.headerRects || rectsOf(els), els);
    }
    entry.headerNarrow = nowNarrow;
    // 基准位置每帧刷新（动画期间暂停，避免把变换中的位置当基准）
    if (!entry.headerAnimating) entry.headerRects = rectsOf(els);
}

// 旋转等视口变化：CSS 档位已重估，但 ResizeObserver 可能因 iPad 视口陈旧未触发
// （订阅收敛在 breakpoints.onOrientationChange）
function recheckAll() {
    for (const [grid, entry] of observed) recheck(grid, entry);
}

export function initAboutStats() {
    onOrientationChange(recheckAll);
    // 清理已脱离文档的旧网格观察器（SPA 换页）
    for (const [grid, entry] of observed) {
        if (!grid.isConnected) {
            entry.ro.disconnect();
            observed.delete(grid);
        }
    }

    document.querySelectorAll('.about-stats').forEach((grid) => {
        if (observed.has(grid)) return;
        const tiers = readLayoutTiers();
        const entry = {
            ro: null,
            two: null,
            panelRects: null,    // 面板上一帧基准矩形（FLIP 的 First，回放用）
            gridWidth: grid.clientWidth, // 上一次容器宽度（拖动缩放检测）
            headerNarrow: tiers.tier < 2,
            headerRects: null,   // 头部元素上一帧基准位置（回放用）
            headerAnimating: false,
            finishTimer: null,       // 列翻转收尾定时器槽位
            headerFinishTimer: null, // 头部翻转收尾定时器槽位
        };
        entry.two = tiers.tier >= 2;
        applyCols(grid, entry.two); // 立即接管列数（内联样式覆盖 CSS 媒体查询降级）
        entry.panelRects = recordFlipRects(grid, '.stats-panel');
        if ('ResizeObserver' in window) {
            /* 排 rAF 执行（不在 RO 回调里直接写样式）：回调内改动被观察网格的尺寸
               会触发 "ResizeObserver loop completed with undelivered notifications"；
               代价是可能多渲染 1 帧中间态，动画起点已由上一帧缓存保证正确 */
            let pending = false;
            entry.ro = new ResizeObserver(() => {
                if (pending) return;
                pending = true;
                requestAnimationFrame(() => {
                    pending = false;
                    recheck(grid, entry);
                });
            });
            entry.ro.observe(grid);
        }
        observed.set(grid, entry);
    });
}
