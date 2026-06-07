export function initHeaderScroll() {
    const header = document.querySelector('.site-header');
    if (!header) return;

    window.addEventListener('scroll', () => {
        header.style.background = window.pageYOffset > 100 ? 'rgba(10, 10, 10, 0.95)' : 'rgba(10, 10, 10, 0.85)';
    });
}
