/**
 * 导航下拉菜单（「作品」子导航）
 * - 窄屏：手风琴——点击父项展开/收起（sub-open），收起菜单时由 resetSubMenus 重置
 * - 桌面：hover-ready 门控悬停展开——防触屏粘性 :hover 从窄屏带到宽屏后误展开；
 *   进入宽屏时禁用门控，首次真实鼠标移动（pointermove）或键盘聚焦（focusin）后恢复
 * - 跨断点进入宽屏时自动重置展开态与门控（避免回到窄屏时菜单残留打开）
 */
let armListener = null; // 待命恢复 hover-ready 的监听（跨断点可替换，防残留堆积）

export function initNavDropdown() {
    const nav = document.getElementById('site-nav');
    if (!nav) return;

    // 与 CSS 断点对齐（样式表为 max-width: 768px）：平板竖屏恰为 768px 时，
    // 若用 min-width: 768px 会与窄屏样式同时命中——汉堡菜单已显示但点击
    // 处理器视为桌面端直接返回，手风琴无法展开（iPad 竖屏典型现象）
    const mqDesktop = window.matchMedia('(min-width: 769px)');

    // 窄屏手风琴：点击父项展开/收起子导航
    nav.querySelectorAll('.nav-parent').forEach((el) => {
        el.addEventListener('click', () => {
            if (mqDesktop.matches) return; // 桌面端悬停展开，点击不处理
            el.closest('li').classList.toggle('sub-open');
        });
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
