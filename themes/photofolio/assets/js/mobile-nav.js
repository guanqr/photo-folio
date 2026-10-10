/**
 * 移动端导航菜单面板（<768px 全屏面板）
 * - 汉堡按钮开合、点击空白处收起；跨断点进入宽屏时自动收起
 * - 宽→窄/窄→宽切换的文字滑出/滑入动画
 * - 子导航手风琴与桌面悬停门控见 nav-dropdown.js
 */
import { resetSubMenus } from './nav-dropdown.js';
import { prefersReducedMotion, BP_DESKTOP_MIN } from './utils.js';

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

        const closing = nav.classList.contains('active');
        nav.classList.toggle('active');
        btn.classList.toggle('active');

        // 收起菜单时同步重置子导航展开态：下次打开菜单时子导航保持收起
        if (closing) {
            resetSubMenus(nav);
        }

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
    //    窄→宽时汉堡消失、文字从右侧滑回原位；仅在断点跨越时播放，页面加载不触发。
    //    旋转导致的断点跨越不播放：该动画为「absolute + transform + 时长>0」，
    //    恰是 WebKit 旋转后 clientWidth 永久取旧值（Bug 287042）的触发模式——
    //    旋转时跳过动画、样式直接切换（桌面窗口缩放跨越断点仍保留动画）
    // 桌面断点单源（见 utils.js BP_DESKTOP_MIN，与样式表 max-width: 768px
    // 严格互补——平板竖屏恰为 768px，两态重叠会致断点行为错位）
    const mqDesktop = window.matchMedia(`(min-width: ${BP_DESKTOP_MIN}px)`);

    // 加载时的屏幕朝向类型（iOS 16.4+ 提供 screen.orientation；不可用时为 null，
    // 维持原有动画行为）
    let lastOrientationType = (typeof screen !== 'undefined' && screen.orientation)
        ? screen.orientation.type
        : null;

    function animateNavCrossing(enteringDesktop) {
        if (prefersReducedMotion()) return;
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
        mqDesktop.addEventListener('change', (e) => {
            // 清除菜单开合残留的内联 transition（fixed + transform + 过渡时长>0
            // 同属 WebKit 旋转视口 bug 的触发模式——旋转跳过动画时清理也照常执行）。
            // 必须先清理再收菜单：toggleMenu 会给 nav 写入 0.35s 关闭过渡，
            // 后清理会把刚写入的过渡清掉、菜单瞬移消失
            nav.style.transition = '';
            // 进入宽屏时自动收起菜单——子导航展开态与悬停门控由 nav-dropdown.js 处理
            if (e.matches && nav.classList.contains('active')) {
                toggleMenu();
            }
            // 屏幕朝向类型变化（横屏↔竖屏）视为旋转：跳过滑出/滑入动画
            const rotated = lastOrientationType !== null
                && screen.orientation && screen.orientation.type !== lastOrientationType;
            lastOrientationType = screen.orientation
                ? screen.orientation.type
                : lastOrientationType;
            if (!rotated) {
                animateNavCrossing(e.matches);
            }
        });
    }
}
