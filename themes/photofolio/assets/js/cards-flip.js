// 卡片网格换行 FLIP（参考 masonry.js 的档位滞回经验）：
// - 列数档位由 JS 驱动（CSS 媒体查询保留为无 JS 降级，内联样式优先级更高）
// - 档位信号与瀑布流同源：只读 :root 的 --layout-tier / --layout-tier-exit
//   （CSS 媒体查询写入）。不用 window.innerWidth/matchMedia——iPad Safari 旋转后
//   这些值可能永久陈旧，CSS 变量会随媒体查询重新求值（2026-11-14）
// - 两档列数基准：首页/目录卡 1/2/3 列；页面底端「其他分類/系列」入口
//   （page-others-grid）从 2 列起 → 2/3/4 列，窄屏也不退成单列大卡
// - 滞回：升档需 exit 档位越过当前档位（比基础档位高 20px），降档按基础档位
//   立即生效，与瀑布流 masonry.js updateTier 同一规则
// - 档位切换时做受控 FLIP：先记 First → 改列数 → 强制回流 → 记 Last → 位移+缩放回放。
//   First/Last 在同一同步任务内量测（布局变化由 JS 自己触发），不存在基准过期问题——
//   这正是瀑布流照片稳定的根本原因
// - 档位内随意缩放：列数不变，网格自然伸缩，无重排无动画

import { prefersReducedMotion } from './utils.js';
import { readLayoutTiers } from './breakpoints.js';
import { FLIP_TRANSITION, clearFlipInline, recordFlipRects, resetFlipFinish, scheduleFlipFinish } from './flip.js';

// 列数基准：由网格的 data-cols-base 声明（入口网格 2 → 2/3/4 列；缺省 1 →
// 1/2/3 列）。入口卡必须小于瀑布流作品，窄屏退成单列会重新变成大卡（2026-11-14）
function colsBase(grid) {
    const base = parseInt(grid.dataset.colsBase, 10);
    return Number.isFinite(base) ? base : 1;
}

function colsForTier(tier, base) {
    return base + tier - 1;
}

function initialCols(base) {
    return colsForTier(readLayoutTiers().tier, base);
}

// 带滞回的目标列数：升档需 exit 档位 > 当前档位；降档随基础档位立即生效
function desiredCols(current, base) {
    const currentTier = current - base + 1;
    const { tier, exit } = readLayoutTiers();
    if (tier > currentTier && exit <= currentTier) return current;
    return colsForTier(tier, base);
}

const observed = new Map(); // grid → { ro, cols }

function applyCols(grid, cols) {
    grid.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
}

function flipColumns(grid, entry, nextCols) {
    // 作废旧收尾（槽位在 entry 上、按网格隔离）：快速二次翻转时旧定时器
    // 会把第二次动画仍在途的内联样式（transition/transform）拦腰清掉、
    // 卡片中途急停（2026-10-18）
    resetFlipFinish(entry);
    // 兜底摘裁剪类（减弱动态路径不挂类、上轮动画中断残留一并清理）
    grid.classList.remove('is-flipping');
    const cards = [...grid.querySelectorAll('.category-card')];
    if (prefersReducedMotion()) {
        applyCols(grid, nextCols); // 减弱动态：直接切换，不播放动画
        entry.cols = nextCols;
        return;
    }
    // First：当前（旧列数）真实位置——先清掉上一轮动画残留并强制回流
    clearFlipInline(cards);
    void grid.offsetWidth;
    const first = recordFlipRects(grid, '.category-card');
    // 改列数并强制回流：受控重排（与 masonry 在同一同步任务内完成量测）
    applyCols(grid, nextCols);
    void grid.offsetWidth;
    const lasts = recordFlipRects(grid, '.category-card');
    // FLIP 窗口挂裁剪类：Invert 的 transform 溢出只在动画期间存在，
    // 裁剪随收尾定时器摘除（静态裁剪会把左右列卡片的悬停阴影切出硬边，
    // 见 _categories.scss .grid.is-flipping 注释）
    grid.classList.add('is-flipping');
    // Invert：把卡片摆回旧位置与旧尺寸（位移 + 缩放，左上角同一起点复合）
    cards.forEach((card, i) => {
        const dx = first[i].left - lasts[i].left;
        const dy = first[i].top - lasts[i].top;
        const sx = lasts[i].width ? first[i].width / lasts[i].width : 1;
        const sy = lasts[i].height ? first[i].height / lasts[i].height : 1;
        if (!dx && !dy && Math.abs(sx - 1) <= 0.001 && Math.abs(sy - 1) <= 0.001) return;
        card.style.transition = 'none';
        card.style.transformOrigin = '0 0';
        card.style.transform = `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`;
    });
    void grid.offsetWidth;
    // Play：过渡归位（位置 + 尺寸）
    cards.forEach((card) => {
        if (card.style.transform) {
            card.style.transition = FLIP_TRANSITION;
            card.style.transform = '';
        }
    });
    entry.cols = nextCols;
    // 动画结束后清理内联样式（恢复卡片自身的 hover 过渡）并摘裁剪类；
    // 定时器入槽位，二次翻转时在 flipColumns 入口作废旧收尾（见上）
    scheduleFlipFinish(entry, () => {
        grid.classList.remove('is-flipping');
        clearFlipInline(cards);
    });
}

// 旋转等视口变化：CSS 档位可能已重估，但 ResizeObserver 因 iPad 的视口陈旧
// 而未触发——补一次全网格复核（模块级只挂一次，SPA 换页不重复）
let viewportBound = false;

function recheckOnViewportChange() {
    for (const [grid, entry] of observed) {
        if (!grid.isConnected) continue;
        const next = desiredCols(entry.cols, entry.base);
        if (next !== entry.cols) flipColumns(grid, entry, next);
    }
}

function bindViewportRecheck() {
    if (viewportBound) return;
    viewportBound = true;
    window.addEventListener('orientationchange', recheckOnViewportChange);
    if (window.screen && window.screen.orientation
        && typeof window.screen.orientation.addEventListener === 'function') {
        window.screen.orientation.addEventListener('change', recheckOnViewportChange);
    }
}

export function initCardsFlip() {
    bindViewportRecheck();
    // 清理已脱离文档的旧网格观察器（SPA 换页）
    for (const [grid, entry] of observed) {
        if (!grid.isConnected) {
            entry.ro.disconnect();
            observed.delete(grid);
        }
    }

    document.querySelectorAll('.grid, .page-others-grid').forEach((grid) => {
        if (observed.has(grid)) return;
        const entry = { ro: null, cols: null, finishTimer: null };
        entry.base = colsBase(grid);
        entry.cols = initialCols(entry.base);
        applyCols(grid, entry.cols); // 立即接管列数（内联样式覆盖 CSS 媒体查询降级）
        if ('ResizeObserver' in window) {
            let pending = false;
            entry.ro = new ResizeObserver(() => {
                if (pending) return;
                pending = true;
                requestAnimationFrame(() => {
                    pending = false;
                    if (!grid.isConnected) return;
                    const next = desiredCols(entry.cols, entry.base);
                    if (next !== entry.cols) flipColumns(grid, entry, next);
                });
            });
            entry.ro.observe(grid);
        }
        observed.set(grid, entry);
    });
}
