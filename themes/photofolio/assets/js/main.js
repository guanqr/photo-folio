import { initLightbox } from './lightbox.js';
import { initHeroSlider } from './hero-slider.js';
import { initLazyLoad } from './lazy-load.js';
import { initHeaderScroll } from './header-scroll.js';
import { initMobileNav } from './mobile-nav.js';
import { initBackToTop } from './back-to-top.js';
import { initThemeToggle } from './theme-toggle.js';
import { initInfiniteScroll } from './infinite-scroll.js';
import { initTimelineAnim } from './timeline-anim.js';

// 当 DOM 加载完成后，统一初始化所有模块
document.addEventListener('DOMContentLoaded', () => {
    initLightbox();
    initHeroSlider();
    initLazyLoad();
    initHeaderScroll();
    initMobileNav();
    initBackToTop();
    initThemeToggle();
    initInfiniteScroll();
    initTimelineAnim();
});
