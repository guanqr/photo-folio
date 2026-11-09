import { prefersReducedMotion } from './utils.js';

let scrollHandler = null;
let clickHandler = null;
let clickBtn = null;

export function initBackToTop() {
    // 拆线先于早退：SPA 跳到无按钮页面后，旧滚动监听仍挂在 window、
    // 闭包持有已脱离文档的按钮（每次滚动空转执行 classList 操作）
    if (scrollHandler) {
        window.removeEventListener('scroll', scrollHandler);
        scrollHandler = null;
    }
    // click 监听同款拆线：按钮在壳层不重建、每次 SPA 换页重复挂载会
    // 随导航无限累积（2026-10-18）
    if (clickHandler && clickBtn) {
        clickBtn.removeEventListener('click', clickHandler);
        clickHandler = null;
        clickBtn = null;
    }

    const btn = document.getElementById('back-to-top');
    if (!btn) return;

    scrollHandler = () => {
        if (window.scrollY > 300) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    };

    window.addEventListener('scroll', scrollHandler, { passive: true });

    clickHandler = () => {
        // 减弱动态下瞬时回顶：CSS 媒体查询管不到 JS 的 scroll behavior（2026-11-09）
        window.scrollTo({ top: 0, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
    };
    clickBtn = btn;
    btn.addEventListener('click', clickHandler);
}
