import { initLightboxBoot, openLightboxFromUrlIfNeeded } from './lightbox-boot.js';
import { initLazyLoad } from './lazy-load.js';
import { initHeaderScroll } from './header-scroll.js';
import { initMobileNav } from './mobile-nav.js';
import { initNavDropdown } from './nav-dropdown.js';
import { initBackToTop } from './back-to-top.js';
import { initThemeToggle } from './theme-toggle.js';
import { initCardsFlip } from './cards-flip.js';
import { initCategoryReveal } from './category-reveal.js';
import { initPageTransition } from './page-transition.js';
import { initAvifFallback } from './avif-fallback.js';
import { PARAM_KEYS } from './gallery-filter-params.js';
import { loadEntry } from './entry-loader.js';

let pageGen = 0;

/* SPA 入口图片模块加载失败/挂起时的兜底：拆行容器、放出全部卡片并补 src。
   初始首屏由 baseof 的解析期脚本负责（同口径）；这里只处理 SPA 换页后
   异步入口迟迟未初始化的情况，避免新页瀑布流一直空白。 */
function releaseGridFallback(grid) {
    if (!grid.isConnected || grid.classList.contains('masonry-ready')
        || grid.classList.contains('is-fallback')) return;
    const rows = grid.querySelectorAll('.masonry-row');
    for (const row of rows) {
        const stray = grid.querySelector(':scope > .masonry-item');
        while (row.firstChild) {
            if (stray) grid.insertBefore(row.firstChild, stray);
            else grid.appendChild(row.firstChild);
        }
        row.remove();
    }
    grid.classList.remove('is-virtual');
    grid.style.height = '';
    grid.classList.add('is-fallback');
    grid.querySelectorAll('.masonry-item').forEach((item) => {
        item.classList.remove('is-hidden');
        item.classList.add('is-revealed');
        const img = item.querySelector('img.photo-img');
        if (img && img.dataset.src) {
            img.src = img.dataset.src;
            img.removeAttribute('data-src');
            img.classList.add('is-loaded');
        }
    });
}

// 页面相关模块（每次页面切换需重新初始化）；页面级 bundle 按需加载，
// pageGen 作废被新导航取代的旧批次，避免旧入口初始化到新页面 DOM 上
async function initPageModules(isSpa = false) {
    const gen = ++pageGen;
    // SPA 导入的新主内容不会重放 baseof 的解析期隐藏脚本：入口加载完成前
    // 先按住卡片，否则无 src 的 85 张卡会在网格初始化前以原始高度铺开闪现
    const grid = document.getElementById('masonry-grid');
    if (grid) {
        grid.querySelectorAll('.masonry-item').forEach((item) => item.classList.add('is-hidden'));
        // 初始首屏由 baseof 的 4s 看门狗兜底；SPA 换页没有解析期脚本，另备一份
        if (isSpa) {
            setTimeout(() => {
                if (gen === pageGen) releaseGridFallback(grid);
            }, 4000);
        }
    }
    initLazyLoad();
    initBackToTop();
    initCardsFlip();
    // 分类/系列卡片共用 .category-card：首页、分类目录、系列列表与详情页
    // 「其他」区块都需要滚动揭示，不能只在首页轮播页初始化（2026-11-01）。
    // 无卡页面由模块自身断开旧观察器后早退
    initCategoryReveal();

    try {
        if (grid) {
            // 带筛选参数的 URL（字母表与 PARAM_KEYS 同源）且页面有筛选栏时，
            // 跳过首屏全量揭示，由 initGalleryFilter 恢复筛选后统一揭示
            const filterParamRe = new RegExp('[?&](' + Object.values(PARAM_KEYS).join('|') + ')=');
            const skipReveal = filterParamRe.test(location.search) &&
                !!document.querySelector('.gallery-filters');
            const list = await loadEntry('list');
            if (gen !== pageGen) return;
            list.initMasonry(skipReveal);
            list.initMasonryResize();
            if (document.querySelector('.gallery-filters')) list.initGalleryFilter();
        }

        if (document.getElementById('footprint-map')) {
            const map = await loadEntry('map');
            if (gen !== pageGen) return;
            map.initFootprintMap();
        }

        if (document.querySelector('.series-ambient')) {
            const series = await loadEntry('series');
            if (gen !== pageGen) return;
            series.initSeriesAmbient();
        }

        if (document.getElementById('home-carousel')) {
            const home = await loadEntry('home');
            if (gen !== pageGen) return;
            home.initCarousel();
        }

        if (document.querySelector('.about-stats')) {
            const about = await loadEntry('about');
            if (gen !== pageGen) return;
            about.initAboutStats();
        }

        if (gen === pageGen) {
            // URL 带 ?p= 时懒启动灯箱并恢复（首次加载与 SPA 跳转均会执行）
            openLightboxFromUrlIfNeeded().catch((err) => console.error('[lightbox] restore failed', err));
        }
    } catch (err) {
        console.error('[page] module init failed', err);
    }
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
    initLightboxBoot(); // 首次点击作品时再拉取灯箱骨架与 JS
}

// 首次加载
document.addEventListener('DOMContentLoaded', () => {
    initGlobalModules();
    initPageModules();
    initPageTransition(initPageModules);
});
