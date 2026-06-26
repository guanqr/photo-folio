export function initMobileNav() {
    const btn = document.getElementById('nav-toggle');
    const nav = document.getElementById('site-nav');

    if (!btn || !nav) return;

    const TRANSITION_STYLE =
        'transform 0.35s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.3s ease, visibility 0.3s';

    function toggleMenu() {
        // 仅在用户主动切换时启用过渡，断点跨越不触发
        nav.style.transition = TRANSITION_STYLE;

        const onEnd = () => {
            nav.style.transition = '';
            nav.removeEventListener('transitionend', onEnd);
        };
        nav.addEventListener('transitionend', onEnd);

        nav.classList.toggle('active');
        btn.classList.toggle('active');
    }

    // 1. 点击汉堡按钮切换菜单
    btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        toggleMenu();
    });

    // 2. 点击页面空白处关闭菜单
    document.addEventListener('click', (e) => {
        if (nav.classList.contains('active') &&
            !nav.contains(e.target) &&
            !btn.contains(e.target)) {
            toggleMenu();
        }
    });
}
