export function initMobileNav() {
    const btn = document.getElementById('nav-toggle');
    const nav = document.getElementById('site-nav');

    if (!btn || !nav) return;

    const TRANSITION_STYLE =
        'transform 0.35s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.3s ease, visibility 0.3s, ' +
        'background 0.5s ease, backdrop-filter 0.5s ease, -webkit-backdrop-filter 0.5s ease';

    // 仅位移/淡入的过渡（页面已滚动时用：面板直接不透明打开，不做背景渐变）
    const TRANSITION_STYLE_NO_BG =
        'transform 0.35s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.3s ease, visibility 0.3s';

    function toggleMenu() {
        // 页面未滚动（导航栏透明）时，面板从透明渐变到不透明；
        // 页面已滚动（导航栏本来就不透明）时，面板直接以不透明打开，不做背景渐变
        const scrolled = window.scrollY > 10;
        nav.classList.toggle('nav-solid', scrolled);

        // 仅在用户主动切换时启用过渡，断点跨越不触发
        nav.style.transition = scrolled ? TRANSITION_STYLE_NO_BG : TRANSITION_STYLE;

        const onEnd = () => {
            nav.style.transition = '';
            nav.removeEventListener('transitionend', onEnd);
        };
        nav.addEventListener('transitionend', onEnd);

        nav.classList.toggle('active');
        btn.classList.toggle('active');

        // 菜单开合时同步切换导航栏主体的不透明背景（顶部透明时点开菜单 → 导航栏变不透明）
        const header = document.querySelector('.site-header');
        if (header) {
            header.classList.toggle('menu-open', nav.classList.contains('active'));
        }
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
