export function initBackToTop() {
    const btn = document.getElementById('back-to-top');
    if (!btn) return;

    // 1. 监听滚动事件，控制按钮显示/隐藏
    // 当页面向下滚动超过 300px 时显示按钮
    window.addEventListener('scroll', () => {
        if (window.scrollY > 300) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    }, { passive: true }); // passive: true 优化滚动性能

    // 2. 点击事件：平滑滚动到顶部
    btn.addEventListener('click', () => {
        window.scrollTo({
            top: 0,
            behavior: 'smooth'
        });
    });
}
