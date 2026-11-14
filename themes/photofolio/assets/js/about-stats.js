// 關於頁「拍攝檔案」統計卡片：跨 769px 斷點的兩列↔單列 FLIP（與分類/系列卡片同款機制，
// 參考 cards-flip.js / masonry.js 的檔位經驗）：
// - 列數由 JS 驅動（內聯樣式覆蓋 CSS 媒體查詢——後者保留為無 JS 降級）
// - 檔位信號與瀑布流/卡片网格同源：只讀 :root 的 --layout-tier / --layout-tier-exit
//   （CSS 媒體查詢寫入）；不用 matchMedia/innerWidth——iPad Safari 旋轉後可能陳舊
// - 滯回：升档需 exit 档位 >= 2，降档随基础档位立即生效
// - 斷點切換時做受控 FLIP：先記 First → 改列數 → 強制回流 → 記 Last → 位移回放 +
//   真實寬高過渡（完全不用縮放——卡內文字絕不拉伸變形，寬高過渡每幀按真實佈局重排內容）。
//   First/Last 在同一同步任務內量測（佈局變化由 JS 自己觸發），基準不會過期
// - 斷點內隨意縮放：列數不變，網格自然伸縮，無重排無動畫
// - 顶部头像/信息（.about-avatar/.about-header-text）的横排↔竖排由 CSS 媒体查询切换——
//   RO 回调在布局切换之后，First 基准须用「上一帧持续刷新的基准位置」回放
//   （动画期间暂停刷新，避免把变换中的位置当基准——与足迹地图 flipLayout 同款经验）

import { prefersReducedMotion } from './utils.js';
import { readLayoutTiers } from './breakpoints.js';
import { FLIP_TRANSITION, FLIP_DURATION, FLIP_EASE, clearFlipInline, recordFlipRects, resetFlipFinish, scheduleFlipFinish } from './flip.js';

const observed = new Map(); // grid → { ro, two, headerNarrow, headerRects, headerAnimating }

function applyCols(grid, two) {
    grid.style.gridTemplateColumns = two ? '1fr 1fr' : '1fr';
}

// 帶滯回的目標列數：升档需 exit 档位 >= 2；降档随基础档位立即生效
function desiredTwo(current, tiers) {
    if (current) return tiers.tier >= 2;
    return tiers.tier >= 2 && tiers.exit >= 2;
}

function flipColumns(grid, entry, nextTwo) {
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
    // First：当前（旧列数）真实位置——先清掉上一轮动画残留并强制回流
    clearFlipInline(panels, { size: true });
    void grid.offsetWidth;
    const first = recordFlipRects(grid, '.stats-panel');
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
    // Play：位置平移 + 真实宽高过渡到新布局（与 FLIP 同曲线同时长）
    panels.forEach((panel, i) => {
        if (!panel.style.width) return;
        const sizeTransition = `width ${FLIP_DURATION / 1000}s ${FLIP_EASE}, height ${FLIP_DURATION / 1000}s ${FLIP_EASE}`;
        panel.style.transition = `${FLIP_TRANSITION}, ${sizeTransition}`;
        panel.style.transform = '';
        panel.style.width = lasts[i].width + 'px';
        panel.style.height = lasts[i].height + 'px';
    });
    entry.two = nextTwo;
    // 动画结束后清理内联样式（恢复卡片自身样式，不干扰后续 FLIP 的 First 量测）；
    // 定时器入槽位，二次翻转时在 flipColumns 入口作废旧收尾（见上）
    scheduleFlipFinish(entry, () => clearFlipInline(panels, { size: true }));
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

function flipHeader(container, entry, fromRects, els) {
    if (prefersReducedMotion()) return;
    // Invert：把元素摆回上一帧基准位置与尺寸，再 Play 过渡归位
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
            el.style.transition = FLIP_TRANSITION;
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
    }, FLIP_DURATION + 50);
}

/* 网格列数与头部布局的复核：ResizeObserver 与 orientationchange 共用。
   头部横排/竖排由 CSS 切换，这里只比对档位并回放上一帧基准 */
function recheck(grid, entry) {
    if (!grid.isConnected) return;
    const tiers = readLayoutTiers();
    const next = desiredTwo(entry.two, tiers);
    if (next !== entry.two) flipColumns(grid, entry, next);
    const container = grid.closest('.about-container');
    if (!container) return;
    const els = headerEls(container);
    const nowNarrow = tiers.tier < 2;
    if (nowNarrow !== entry.headerNarrow && !entry.headerAnimating) {
        flipHeader(container, entry, entry.headerRects || rectsOf(els), els);
    }
    entry.headerNarrow = nowNarrow;
    // 基准位置每帧刷新（动画期间暂停，避免把变换中的位置当基准）
    if (!entry.headerAnimating) entry.headerRects = rectsOf(els);
}

// 旋转等视口变化：CSS 档位已重估，但 ResizeObserver 可能因 iPad 视口陈旧未触发
let viewportBound = false;

function bindViewportRecheck() {
    if (viewportBound) return;
    viewportBound = true;
    const onViewportChange = () => {
        for (const [grid, entry] of observed) recheck(grid, entry);
    };
    window.addEventListener('orientationchange', onViewportChange);
    if (window.screen && window.screen.orientation
        && typeof window.screen.orientation.addEventListener === 'function') {
        window.screen.orientation.addEventListener('change', onViewportChange);
    }
}

export function initAboutStats() {
    bindViewportRecheck();
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
            headerNarrow: tiers.tier < 2,
            headerRects: null,   // 头部元素上一帧基准位置（回放用）
            headerAnimating: false,
            finishTimer: null,       // 列翻转收尾定时器槽位
            headerFinishTimer: null, // 头部翻转收尾定时器槽位
        };
        entry.two = tiers.tier >= 2;
        applyCols(grid, entry.two); // 立即接管列数（内联样式覆盖 CSS 媒体查询降级）
        if ('ResizeObserver' in window) {
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
