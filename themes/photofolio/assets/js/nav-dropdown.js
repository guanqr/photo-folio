/**
 * 导航下拉菜单（「作品」子导航）
 * - 窄屏：手风琴——点击父项展开/收起（sub-open），收起菜单时由 resetSubMenus 重置
 * - 桌面：hover-ready 门控悬停展开——防触屏粘性 :hover 从窄屏带到宽屏后误展开；
 *   进入宽屏时禁用门控，首次真实鼠标移动（pointermove）或键盘聚焦（focusin）后恢复
 * - 跨断点进入宽屏时自动重置展开态与门控（避免回到窄屏时菜单残留打开）
 */
import { BP_DESKTOP_MIN } from './utils.js';

let armListener = null; // 待命恢复 hover-ready 的监听（跨断点可替换，防残留堆积）

export function initNavDropdown() {
    const nav = document.getElementById('site-nav');
    if (!nav) return;

    // 桌面断点单源（见 utils.js BP_DESKTOP_MIN，与样式表 max-width: 768px
    // 严格互补——平板竖屏恰为 768px，两态重叠会致手风琴点不开）
    const mqDesktop = window.matchMedia(`(min-width: ${BP_DESKTOP_MIN}px)`);
    // 纯触屏设备（无悬停能力）：桌面模式也允许点击切换——悬停展开依赖
    // hover-ready 武装（首次 pointermove），iPad 点按可能不产生 pointermove、
    // 门控永不武装，下拉点不开
    const touchOnly = window.matchMedia('(hover: none) and (pointer: coarse)');

    // 窄屏手风琴 / 触屏桌面点击：切换子导航展开态
    nav.querySelectorAll('.nav-parent').forEach((el) => {
        el.addEventListener('click', () => {
            if (mqDesktop.matches && !touchOnly.matches) return; // 桌面鼠标：悬停展开，点击不处理
            el.closest('li').classList.toggle('sub-open');
        });
    });

    // 桌面触屏：点击下拉之外关闭；点击下拉内的链接同样关闭——SPA 跳转后
    // header 不重渲染，不重置则下拉残留展开、盖在新页面上
    document.addEventListener('click', (e) => {
        if (!mqDesktop.matches || !touchOnly.matches) return;
        if (!e.target.closest('.has-dropdown') || e.target.closest('.has-dropdown a')) {
            resetSubMenus(nav);
        }
    });

    // hover-ready 门控：桌面悬停展开需此开关（见 _header.scss）
    const armHover = () => {
        nav.querySelectorAll('.has-dropdown').forEach((li) => li.classList.add('hover-ready'));
    };
    const disarmHover = () => {
        nav.querySelectorAll('.has-dropdown').forEach((li) => li.classList.remove('hover-ready'));
    };

    if (mqDesktop.matches) {
        armHover(); // 初始即宽屏：直接可用
    }

    if (mqDesktop.addEventListener) {
        mqDesktop.addEventListener('change', (e) => {
            if (!e.matches) {
                // 进入窄屏：拆除 hover-ready（此前只在进入宽屏时武装、回到窄屏
                // 不拆——残留的 hover-ready 配合触屏粘性 :hover 会让更高特异性的
                // transform:none 规则恒压过 sub-open 的箭头旋转，子导航展开后
                // 箭头不翻转、点击导航栏外才恢复）
                disarmHover();
                return;
            }
            resetSubMenus(nav);
            disarmHover();
            if (armListener) {
                window.removeEventListener('pointermove', armListener);
                nav.removeEventListener('focusin', armListener);
            }
            armListener = () => {
                armListener = null;
                armHover();
            };
            window.addEventListener('pointermove', armListener, { once: true });
            nav.addEventListener('focusin', armListener, { once: true });
        });
    }
}

/* 重置子导航展开态（收起菜单时由 mobile-nav 调用，跨断点时本模块内部调用） */
export function resetSubMenus(nav) {
    nav.querySelectorAll('.has-dropdown.sub-open').forEach((li) => li.classList.remove('sub-open'));
}
