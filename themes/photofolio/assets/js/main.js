import { initLightbox, openLightboxFromUrl } from './lightbox.js';
import { initLazyLoad } from './lazy-load.js';
import { initHeaderScroll } from './header-scroll.js';
import { initMobileNav } from './mobile-nav.js';
import { initNavDropdown } from './nav-dropdown.js';
import { initBackToTop } from './back-to-top.js';
import { initThemeToggle } from './theme-toggle.js';
import { initMasonry, initMasonryResize } from './masonry.js';
import { initGalleryFilter, PARAM_KEYS } from './gallery-filter.js';
import { initFootprintMap } from './footprint-map.js';
import { initCardsFlip } from './cards-flip.js';
import { initSeriesAmbient } from './series-ambient.js';
import { initPageTransition } from './page-transition.js';
import { initCarousel } from './carousel.js';
import { initAboutStats } from './about-stats.js';
import { initAvifFallback } from './avif-fallback.js';
import { initCategoryReveal } from './category-reveal.js';

// 页面相关模块（每次页面切换需重新初始化）
function initPageModules() {
    initLightbox();
    initLazyLoad();
    // 带筛选参数的 URL（字母表与 PARAM_KEYS 同源，新增维度无需改这里）且页面有筛选栏时，
    // 跳过首屏全量揭示，由 initGalleryFilter 恢复筛选后统一揭示，避免全量作品闪现
    const filterParamRe = new RegExp('[?&](' + Object.values(PARAM_KEYS).join('|') + ')=');
    const skipReveal = filterParamRe.test(location.search) &&
        !!document.querySelector('.gallery-filters');
    initMasonry(skipReveal);
    initMasonryResize();
    initGalleryFilter();
    initFootprintMap();
    initSeriesAmbient();
    initBackToTop();
    initCarousel();
    initAboutStats();
    initCategoryReveal();
    initCardsFlip();
    openLightboxFromUrl(); // URL 带 ?p= 时恢复灯箱（首次加载与 SPA 跳转均会执行）
}

// AVIF 兜底在 bundle 求值时立即挂载（defer 脚本先于 DOMContentLoaded）：
// hero 首图带 eager+preload、error 可能早于 DCL 到达——若挂在 initGlobalModules
// （DCL 内）会漏接首图错误，非 AVIF 环境二次访问 LCP 首图确定性破图
initAvifFallback();

// 全局模块（仅首次初始化，页面切换后不重复执行）
let globalInited = false;
function initGlobalModules() {
    if (globalInited) return;
    globalInited = true;
    initHeaderScroll();
    initMobileNav();
    initNavDropdown();
    initThemeToggle();
}

// 首次加载
document.addEventListener('DOMContentLoaded', () => {
    initGlobalModules();
    initPageModules();
    initPageTransition(initPageModules);
});
