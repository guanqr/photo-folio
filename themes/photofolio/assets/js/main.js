import { initLightbox } from './lightbox.js';
import { initLazyLoad } from './lazy-load.js';
import { initHeaderScroll } from './header-scroll.js';
import { initMobileNav } from './mobile-nav.js';
import { initBackToTop } from './back-to-top.js';
import { initMasonry, initMasonryResize } from './masonry.js';
import { initInfiniteScroll } from './infinite-scroll.js';
import { initGalleryFilter } from './gallery-filter.js';
import { initTimelineAnim, initTimelineResize } from './timeline-anim.js';
import { initFootprintMap } from './footprint-map.js';
import { initPageTransition } from './page-transition.js';
import { initCarousel } from './carousel.js';

// 首页分类卡片：滚动进入视口时交错渐入
function revealCategoryCards() {
    const cards = document.querySelectorAll('.category-card:not(.is-revealed)');
    if (!cards.length) return;
    const observer = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
            if (!entry.isIntersecting) return;
            const card = entry.target;
            const index = Array.prototype.indexOf.call(cards, card);
            setTimeout(() => card.classList.add('is-revealed'), index * 60);
            observer.unobserve(card);
        });
    }, { rootMargin: '0px 0px -40px 0px' });
    cards.forEach((card) => observer.observe(card));
}

// 页面相关模块（每次页面切换需重新初始化）
function initPageModules() {
    initLightbox();
    initLazyLoad();
    initMasonry();
    initMasonryResize();
    initInfiniteScroll();
    initGalleryFilter();
    initTimelineAnim();
    initTimelineResize();
    initFootprintMap();
    initBackToTop();
    initCarousel();
    revealCategoryCards();
}

// 全局模块（仅首次初始化，页面切换后不重复执行）
let globalInited = false;
function initGlobalModules() {
    if (globalInited) return;
    globalInited = true;
    initHeaderScroll();
    initMobileNav();
}

// 首次加载
document.addEventListener('DOMContentLoaded', () => {
    initGlobalModules();
    initPageModules();
    initPageTransition(initPageModules);
});
