import { initLightbox } from './lightbox.js';
import { initLazyLoad } from './lazy-load.js';
import { initHeaderScroll } from './header-scroll.js';
import { initMobileNav } from './mobile-nav.js';
import { initBackToTop } from './back-to-top.js';
import { initThemeToggle } from './theme-toggle.js';
import { initMasonry, initMasonryResize } from './masonry.js';
import { initInfiniteScroll } from './infinite-scroll.js';
import { initTimelineAnim, initTimelineResize } from './timeline-anim.js';
import { initPageTransition } from './page-transition.js';

// 首页分类卡片交错渐入
function revealCategoryCards() {
    const cards = document.querySelectorAll('.category-card:not(.is-revealed)');
    if (!cards.length) return;
    cards.forEach((card, i) => {
        setTimeout(() => card.classList.add('is-revealed'), i * 60);
    });
}

// 页面相关模块（每次页面切换需重新初始化）
function initPageModules() {
    initLightbox();
    initLazyLoad();
    initMasonry();
    initMasonryResize();
    initInfiniteScroll();
    initTimelineAnim();
    initTimelineResize();
    initBackToTop();
    revealCategoryCards();
}

// 全局模块（仅首次初始化，页面切换后不重复执行）
let globalInited = false;
function initGlobalModules() {
    if (globalInited) return;
    globalInited = true;
    initHeaderScroll();
    initMobileNav();
    initThemeToggle();
}

// 首次加载
document.addEventListener('DOMContentLoaded', () => {
    initGlobalModules();
    initPageModules();
    initPageTransition(initPageModules);
});
