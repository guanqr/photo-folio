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

        // 菜单开合时同步切换导航栏的 menu-open 状态（滚动时打开菜单需隐藏底边线，
        // 让导航栏与面板合为一体）；背景整块由菜单面板统一渐变填充，导航栏自身不再渐变
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

    // 3. 跨断点导航切换动画：宽→窄时菜单文字向右滑出（转换为汉堡），
    //    窄→宽时汉堡消失、文字从右侧滑回原位；仅在断点跨越时播放，页面加载不触发
    const mqDesktop = window.matchMedia('(min-width: 768px)');
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    function animateNavCrossing(enteringDesktop) {
        if (prefersReducedMotion) return;
        const cls = enteringDesktop ? 'nav-slide-in' : 'nav-slide-out';
        nav.classList.remove('nav-slide-in', 'nav-slide-out');
        // 强制重排，保证快速往返切换时动画重新播放
        void nav.offsetWidth;
        nav.classList.add(cls);
    }

    // 动画结束后清理类（监听器常驻，避免快速往返切换时状态残留）
    nav.addEventListener('animationend', (e) => {
        if (e.animationName === 'nav-slide-in' || e.animationName === 'nav-slide-out') {
            nav.classList.remove('nav-slide-in', 'nav-slide-out');
        }
    });

    if (mqDesktop.addEventListener) {
        mqDesktop.addEventListener('change', (e) => animateNavCrossing(e.matches));
    }
}
