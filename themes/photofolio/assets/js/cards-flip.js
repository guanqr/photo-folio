// 卡片网格换行 FLIP（完全参考 masonry.js 的档位滞回经验）：
// - 列数档位由 JS 驱动（CSS 媒体查询保留为无 JS 降级，内联样式优先级更高）
// - 滞回：升档需越过阈值 20px、降档需低于阈值 20px——断点边界来回抖动不会反复切换，
//   与瀑布流的档位滞回（masonry.js updateTier）同一思想
// - 档位切换时做受控 FLIP：先记 First → 改列数 → 强制回流 → 记 Last → 位移+缩放回放。
//   First/Last 在同一同步任务内量测（布局变化由 JS 自己触发），不存在基准过期问题——
//   这正是瀑布流照片稳定的根本原因
// - 档位内随意缩放：列数不变，网格自然伸缩，无重排无动画

import { prefersReducedMotion, FLIP_TRANSITION } from './utils.js';

const HYSTERESIS = 20; // 档位滞回宽度（px）
const TIER_1_TO_2 = 769;  // 1→2 列阈值（与汉堡断点一致）
const TIER_2_TO_3 = 1001; // 2→3 列阈值

function initialCols(width) {
    if (width >= TIER_2_TO_3) return 3;
    if (width >= TIER_1_TO_2) return 2;
    return 1;
}

// 带滞回的目标列数：从当前档位出发，升档需越过阈值 + 滞回、降档需低于阈值 − 滞回
function desiredCols(width, current) {
    if (current === 1) return width >= TIER_1_TO_2 + HYSTERESIS ? 2 : 1;
    if (current === 2) {
        if (width >= TIER_2_TO_3 + HYSTERESIS) return 3;
        if (width < TIER_1_TO_2 - HYSTERESIS) return 1;
        return 2;
    }
    return width < TIER_2_TO_3 - HYSTERESIS ? 2 : 3;
}

const observed = new Map(); // grid → { ro, cols }

function applyCols(grid, cols) {
    grid.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
}

function recordRects(grid) {
    return [...grid.querySelectorAll('.category-card')].map((c) => c.getBoundingClientRect());
}

function clearInline(cards) {
    cards.forEach((card) => {
        card.style.transition = '';
        card.style.transform = '';
        card.style.transformOrigin = '';
    });
}

function flipColumns(grid, entry, nextCols) {
    const cards = [...grid.querySelectorAll('.category-card')];
    if (prefersReducedMotion()) {
        applyCols(grid, nextCols); // 减弱动态：直接切换，不播放动画
        entry.cols = nextCols;
        return;
    }
    // First：当前（旧列数）真实位置——先清掉上一轮动画残留并强制回流
    clearInline(cards);
    void grid.offsetWidth;
    const first = recordRects(grid);
    // 改列数并强制回流：受控重排（与 masonry 在同一同步任务内完成量测）
    applyCols(grid, nextCols);
    void grid.offsetWidth;
    const lasts = recordRects(grid);
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
    // 动画结束后清理内联样式（恢复卡片自身的 hover 过渡）
    setTimeout(() => clearInline(cards), 400);
}

export function initCardsFlip() {
    // 清理已脱离文档的旧网格观察器（SPA 换页）
    for (const [grid, entry] of observed) {
        if (!grid.isConnected) {
            entry.ro.disconnect();
            observed.delete(grid);
        }
    }

    document.querySelectorAll('.grid').forEach((grid) => {
        if (observed.has(grid)) return;
        const entry = { ro: null, cols: null };
        entry.cols = initialCols(grid.getBoundingClientRect().width);
        applyCols(grid, entry.cols); // 立即接管列数（内联样式覆盖 CSS 媒体查询降级）
        if ('ResizeObserver' in window) {
            let pending = false;
            entry.ro = new ResizeObserver(() => {
                if (pending) return;
                pending = true;
                requestAnimationFrame(() => {
                    pending = false;
                    if (!grid.isConnected) return;
                    const next = desiredCols(grid.getBoundingClientRect().width, entry.cols);
                    if (next !== entry.cols) flipColumns(grid, entry, next);
                });
            });
            entry.ro.observe(grid);
        }
        observed.set(grid, entry);
    });
}
