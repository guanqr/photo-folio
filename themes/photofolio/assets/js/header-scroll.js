export function initHeaderScroll() {
    const header = document.querySelector('.site-header');
    if (!header) return;

    window.addEventListener('scroll', () => {
        header.style.background = window.scrollY > 100 ? 'var(--color-nav-bg)' : 'var(--color-header-bg)';
    });
}
