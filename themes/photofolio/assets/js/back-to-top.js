let scrollHandler = null;

export function initBackToTop() {
    const btn = document.getElementById('back-to-top');
    if (!btn) return;

    // 移除旧监听器
    if (scrollHandler) {
        window.removeEventListener('scroll', scrollHandler);
    }

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
