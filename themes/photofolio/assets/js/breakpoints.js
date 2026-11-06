/* 全站 JS 断点单源：与 SCSS 媒体查询严格互补，改值须同步对应样式表。
   2026-11-06 自 utils.js 拆出，避免与 FLIP/图片/i18n 工具混在一起。 */

// 桌面断点（nav-dropdown 与 mobile-nav 共用）：与样式表 max-width: 768px
// 严格互补——平板竖屏恰为 768px，JS 若用 min-width: 768 会与窄屏样式同时命中
// （汉堡菜单已显示而点击被视为桌面端）。CSS 见 _responsive.scss，两处同步
export const BP_DESKTOP_MIN = 769;

// 卡片网格 2→3 列断点（与 _categories.scss @media min-width: 1001 同源）
export const BP_CARD_GRID_3COL_MIN = 1001;

// 灯箱窄屏断点（lightbox.js 与 lightbox-drawer.js 共用）：≤1000px 抽屉模式、
// 主图窄屏宽度降档（imageSizes.lightboxNarrow）与抽屉同界
export const BP_LIGHTBOX_NARROW = 1000;
