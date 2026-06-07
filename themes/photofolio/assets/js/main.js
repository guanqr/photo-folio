import { initLightbox } from './lightbox.js';
import { initHeroSlider } from './hero-slider.js';
import { initLazyLoad } from './lazy-load.js';
import { initHeaderScroll } from './header-scroll.js';
import { initMobileNav } from './mobile-nav.js'; // 【新增】引入移动端菜单

// 当 DOM 加载完成后，统一初始化所有模块
document.addEventListener('DOMContentLoaded', () => {
    initLightbox();
    initHeroSlider();
    initLazyLoad();
    initHeaderScroll();
    initMobileNav(); // 【新增】初始化移动端菜单
});
