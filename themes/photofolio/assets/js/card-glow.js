/**
 * 光标跟随的卡片边框高亮（参考 GitHub 首页卡片，2026-11-14）：
 * pointermove 时把鼠标相对卡片的坐标写进 --card-glow-x/y，CSS 侧用
 * 径向渐变 + mask 内描边环把光晕限制在边框内侧，呈现「鼠标在哪一侧、
 * 哪一侧的边框亮起」。
 * 事件委托 + 模块级守卫：SPA 换页后新卡片无需重新绑定、也不重复注册。
 * 触屏（pointerType === touch）没有悬停位置，直接跳过。
 */
let bound = false;
let raf = 0;
let pending = null;

export function initCardGlow() {
    if (bound) return;
    bound = true;

    document.addEventListener('pointermove', (e) => {
        if (e.pointerType === 'touch') return;
        const card = e.target.closest('.photo-card, .category-card');
        if (!card) return;
        // 逐帧合并：高频 pointermove 只做一次布局读取与变量写入
        pending = { card, x: e.clientX, y: e.clientY };
        if (raf) return;
        raf = requestAnimationFrame(() => {
            raf = 0;
            if (!pending) return;
            const { card: el, x, y } = pending;
            pending = null;
            const rect = el.getBoundingClientRect();
            el.style.setProperty('--card-glow-x', `${x - rect.left}px`);
            el.style.setProperty('--card-glow-y', `${y - rect.top}px`);
            // 渐变半径取卡片短边：光标到最近边框的距离 / 半径恒为同一比例，
            // 大卡（首页目录卡）与小卡（瀑布流/入口卡）的边框亮度才一致
            el.style.setProperty('--card-glow-r', `${Math.min(rect.width, rect.height)}px`);
        });
    }, { passive: true });
}
