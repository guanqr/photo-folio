/**
 * 移动端导航菜单面板（<768px 全屏面板）
 * - 汉堡按钮开合、点击空白处收起；跨断点进入宽屏时自动收起
 * - 宽→窄/窄→宽切换的文字滑出/滑入动画
 * - 子导航手风琴与桌面悬停门控见 nav-dropdown.js
 */
import { resetSubMenus } from './nav-dropdown.js';
import { prefersReducedMotion } from './utils.js';
import { BP_DESKTOP_MIN } from './breakpoints.js';

// 菜单收起入口（SPA 换页时由 page-transition 调用）：模块级持有初始化后的
// 实现——开合过渡与收尾监听只有 mobile-nav 一个 owner，页面切换不再另建
// 一套 transition/transitionend 收尾（双 owner 会在重开窗口内互清在途过渡，
// 2026-11-10 审查 #14）
let closeImpl = null;

export function closeMobileNav() {
    return closeImpl ? closeImpl() : false;
}

export function initMobileNav() {
    const btn = document.getElementById('nav-toggle');
    const nav = document.getElementById('site-nav');
    const themeBtn = document.getElementById('theme-toggle');
    const siteHeader = document.querySelector('.site-header');

    if (!btn || !nav) return;

    // 开合过渡公共前缀：位移/淡入/可见性（两变体共用，避免逐字重复）
    const TRANSITION_BASE =
        'transform var(--transition-page), opacity var(--transition-fade), visibility var(--transition-fade), ';

    const TRANSITION_STYLE =
        TRANSITION_BASE + 'background var(--transition-fade), backdrop-filter var(--transition-fade), -webkit-backdrop-filter var(--transition-fade), box-shadow var(--transition-fade)';

    // 仅位移/淡入的过渡（页面已滚动时用：面板直接不透明打开，不做背景渐变；
    // 底部阴影仍随开合渐入渐出，与未滚动态一致）
    const TRANSITION_STYLE_NO_BG =
        TRANSITION_BASE + 'box-shadow var(--transition-fade)';

    let pendingEnd = null; // 在途 transitionend 收尾槽位（开合前作废旧监听，防幽灵收尾）

    function toggleMenu() {
        // 先作废旧收尾：主题切换窗口内全站过渡被压制（transitionend 不触发）、
        // 上次开合的收尾监听残留，若不清除会在本次开合的首个 transitionend
        // 拦腰清掉在途过渡（菜单中途瞬移）；残留的内联过渡一并清掉（2026-10-18）
        if (pendingEnd) {
            nav.removeEventListener('transitionend', pendingEnd);
            pendingEnd = null;
            nav.style.transition = '';
        }

        // 页面未滚动（导航栏透明）时，面板从透明渐变到不透明；
        // 页面已滚动（导航栏本来就不透明）时，面板直接以不透明打开，不做背景渐变
        const scrolled = window.scrollY > 10;
        nav.classList.toggle('nav-solid', scrolled);

        // 仅在用户主动切换时启用过渡，断点跨越不触发
        nav.style.transition = scrolled ? TRANSITION_STYLE_NO_BG : TRANSITION_STYLE;

        nav.addEventListener('transitionend', pendingEnd = () => {
            nav.style.transition = '';
            nav.removeEventListener('transitionend', pendingEnd);
            pendingEnd = null;
        });

        const closing = nav.classList.contains('active');
        nav.classList.toggle('active');
        btn.classList.toggle('active');

        // 收起菜单时同步重置子导航展开态：下次打开菜单时子导航保持收起
        if (closing) {
            resetSubMenus(nav);
        }

        // 菜单开合时同步切换导航栏的 menu-open 状态（滚动时打开菜单需隐藏底边线，
        // 让导航栏与面板合为一体）；背景整块由菜单面板统一渐变填充，导航栏自身不再渐变
        if (siteHeader) {
            siteHeader.classList.toggle('menu-open', nav.classList.contains('active'));
        }
    }

    // 页面切换沿同一收尾（含子导航重置、header menu-open 同步与过渡清理）
    closeImpl = () => {
        if (!nav.classList.contains('active')) return false;
        toggleMenu();
        return true;
    };

    // 1. 点击汉堡按钮切换菜单
    btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        toggleMenu();
    });

    // 2. 点击页面空白处关闭菜单（主题切换按钮除外：菜单展开时切明暗不应收起菜单，
    //    面板内容原地随主题变色）
    document.addEventListener('click', (e) => {
        if (nav.classList.contains('active') &&
            !nav.contains(e.target) &&
            !btn.contains(e.target) &&
            !(themeBtn && themeBtn.contains(e.target))) {
            toggleMenu();
        }
    });

    // 3. 跨断点导航切换动画（抽屉式，与主题按钮同步）：
    //    宽→窄：文字整块向右滑出，在内容右缘（= 汉堡右缘）被裁掉；
    //           汉堡立即出现（不延迟、不淡入），明暗主题按钮同步右移到窄屏位置；
    //    窄→宽：汉堡消失，文字从右缘滑回原位，主题按钮同步左移。
    //    不做透明度淡出，避免与汉堡叠加成残影。仅在断点跨越时播放，页面加载不触发（2026-11-14）。
    //    旋转导致的断点跨越不播放：该动画为「absolute + transform + 时长>0」，
    //    恰是 WebKit 旋转后 clientWidth 永久取旧值（Bug 287042）的触发模式——
    //    旋转时跳过动画、样式直接切换（桌面窗口缩放跨越断点仍保留动画）
    // 桌面断点单源（见 breakpoints.js BP_DESKTOP_MIN，与样式表 max-width: 768px
    // 严格互补——平板竖屏恰为 768px，两态重叠会致断点行为错位）
    const mqDesktop = window.matchMedia(`(min-width: ${BP_DESKTOP_MIN}px)`);

    // 加载时的屏幕朝向类型（iOS 16.4+ 提供 screen.orientation；不可用时为 null，
    // 维持原有动画行为）
    let lastOrientationType = (typeof screen !== 'undefined' && screen.orientation)
        ? screen.orientation.type
        : null;

    // 明暗切换图标与文字滑动同步：按布局差把主题按钮从旧位置 FLIP 回新位置
    let themeFlipTimer = null;

    function flipThemeToggle(delta) {
        if (!themeBtn || prefersReducedMotion()) return;
        if (themeFlipTimer) {
            clearTimeout(themeFlipTimer);
            themeFlipTimer = null;
        }
        themeBtn.style.transition = 'none';
        themeBtn.style.transform = `translateX(${delta}px)`;
        void themeBtn.offsetWidth;
        themeBtn.style.transition = 'transform var(--transition-page)';
        themeBtn.style.transform = '';
        themeFlipTimer = setTimeout(() => {
            themeFlipTimer = null;
            themeBtn.style.transition = '';
            themeBtn.style.transform = '';
        }, 400);
    }

    /* 主题按钮的位移差：宽屏 actions = [主题][导航]，窄屏 = [主题][汉堡]；
       文字右滑 W 的同时，主题按钮右移 W + 宽屏间距 − 汉堡宽 − 窄屏间距。
       尺寸从 token 读取（--space-24 / --space-12 / --control-md），避免写死 */
    function themeShift(navW) {
        const style = getComputedStyle(document.documentElement);
        const root = parseFloat(style.fontSize) || 16;
        const em = (name) => {
            const n = parseFloat(style.getPropertyValue(name));
            return Number.isFinite(n) ? n * root : 0;
        };
        return navW + em('--space-24') - em('--control-md') - em('--space-12');
    }

    // 窄→宽时汉堡淡出的收尾（动画被取消/页面隐藏时由定时器兜底）
    let crossingInTimer = null;

    function finishCrossingIn() {
        if (crossingInTimer) {
            clearTimeout(crossingInTimer);
            crossingInTimer = null;
        }
        if (siteHeader) siteHeader.classList.remove('nav-crossing-in');
    }

    function animateNavCrossing(enteringDesktop) {
        nav.classList.remove('nav-slide-in', 'nav-slide-out');
        finishCrossingIn();
        if (prefersReducedMotion()) return;
        // 强制重排，保证快速往返切换时动画重新播放
        void nav.offsetWidth;
        if (enteringDesktop) {
            // 汉堡以绝对定位淡出，与文字滑入同时开始，不占布局
            if (siteHeader) siteHeader.classList.add('nav-crossing-in');
            nav.classList.add('nav-slide-in');
            // 宽屏位置在窄屏位置左侧：从旧位置（右）回放
            flipThemeToggle(themeShift(nav.getBoundingClientRect().width));
            crossingInTimer = setTimeout(finishCrossingIn, 500);
        } else {
            nav.classList.add('nav-slide-out');
            // 窄屏位置在宽屏位置右侧：从旧位置（左）回放
            flipThemeToggle(-themeShift(nav.getBoundingClientRect().width));
        }
    }

    // 动画结束后清理类（监听器常驻，避免快速往返切换时状态残留）
    nav.addEventListener('animationend', (e) => {
        if (e.animationName === 'nav-slide-in') {
            nav.classList.remove('nav-slide-in');
            finishCrossingIn();
        }
        if (e.animationName === 'nav-slide-out') nav.classList.remove('nav-slide-out');
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
