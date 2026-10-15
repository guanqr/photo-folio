let scrollHandler = null;

export function initBackToTop() {
    // 拆线先于早退：SPA 跳到无按钮页面后，旧滚动监听仍挂在 window、
    // 闭包持有已脱离文档的按钮（每次滚动空转执行 classList 操作）
    if (scrollHandler) {
        window.removeEventListener('scroll', scrollHandler);
        scrollHandler = null;
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

    btn.addEventListener('click', () => {
        window.scrollTo({ top: 0, behavior: 'smooth' });
    });
}
