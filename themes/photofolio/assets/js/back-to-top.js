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
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };
    clickBtn = btn;
    btn.addEventListener('click', clickHandler);
}
