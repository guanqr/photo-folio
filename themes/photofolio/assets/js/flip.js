/* FLIP 布局过渡：瀑布流重排、卡片网格换列、足迹地图与灯箱缩放共用。
   时长/缓动单源；FLIP_TRANSITION 由常量拼出，调用方直接写内联 transition。
   2026-11-06 自 utils.js 拆出，四个 helper 与常量保持一组。 */

// 时长单源：瀑布流跨档收尾定时器与新卡片淡入共用；缓动同时供 about-stats
// 的 width/height 过渡复用（0.35s + 标准缓出）
export const FLIP_DURATION = 350;
export const FLIP_EASE = 'var(--ease-standard)';
export const FLIP_TRANSITION = `transform ${FLIP_DURATION / 1000}s ${FLIP_EASE}`;

/* 换列 FLIP 共用工具：清内联属性、记录矩形、收尾定时器槽位（列数判定各组件保留） */
export function clearFlipInline(elements, { size = false } = {}) {
    elements.forEach((el) => {
        el.style.transition = '';
        el.style.transform = '';
        el.style.transformOrigin = '';
        if (size) {
            el.style.width = '';
            el.style.height = '';
        }
    });
}

export function recordFlipRects(root, selector) {
    return [...root.querySelectorAll(selector)].map((el) => el.getBoundingClientRect());
}

export function resetFlipFinish(entry) {
    if (entry.finishTimer) {
        clearTimeout(entry.finishTimer);
        entry.finishTimer = null;
    }
}

export function scheduleFlipFinish(entry, finish, delay = FLIP_DURATION + 50) {
    resetFlipFinish(entry);
    entry.finishTimer = setTimeout(() => {
        entry.finishTimer = null;
        finish();
    }, delay);
}
