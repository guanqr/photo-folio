/* 全站 JS 断点单源：与 SCSS 媒体查询严格互补，改值须同步对应样式表。
   2026-11-06 自 utils.js 拆出，避免与 FLIP/图片/i18n 工具混在一起。 */

// 桌面断点（nav-dropdown 与 mobile-nav 共用）：与样式表 max-width: 768px
// 严格互补——平板竖屏恰为 768px，JS 若用 min-width: 768 会与窄屏样式同时命中
// （汉堡菜单已显示而点击被视为桌面端）。CSS 见 _responsive.scss，两处同步
export const BP_DESKTOP_MIN = 769;

// 灯箱窄屏断点（lightbox.js 与 lightbox-drawer.js 共用）：≤1000px 抽屉模式、
// 主图窄屏宽度降档（imageSizes.lightboxNarrow）与抽屉同界
export const BP_LIGHTBOX_NARROW = 1000;

/* 读取 :root 的 CSS 档位（0: ≤500 / 1: 501-768 / 2: 769-1000 / 3: >1000）。
   卡片/统计网格至少按 1 档处理（0 与 1 档同义）。
   不用 matchMedia/innerWidth：iPad Safari 旋转后这些值可能永久陈旧，
   CSS 变量由媒体查询重新求值（2026-11-14） */
export function readLayoutTiers() {
    const style = getComputedStyle(document.documentElement);
    const read = (name) => {
        const v = parseInt(style.getPropertyValue(name), 10);
        return Number.isFinite(v) ? Math.max(1, Math.min(3, v)) : 1;
    };
    return { tier: read('--layout-tier'), exit: read('--layout-tier-exit') };
}
