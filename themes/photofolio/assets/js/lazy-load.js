import { markImageLoaded } from './utils.js';

let imageObserver;

export function initLazyLoad() {
    if (!('IntersectionObserver' in window)) return;

    // 换页断开旧观察再重建：旧页面中未进入视口的图片永远不会 intersect、
    // 不被 unobserve——观察器对目标持强引用，随导航累积持有已脱离文档的
    // img 子树（含已解码位图）
    if (imageObserver) imageObserver.disconnect();
    imageObserver = new IntersectionObserver(entries => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                const img = entry.target;
                if (img.dataset.src) {
                    img.src = img.dataset.src;
                    img.removeAttribute('data-src');
                }
                markImageLoaded(img);
                imageObserver.unobserve(img);
            }
        });
    }, { rootMargin: '200px' });

    observeNewImages(document);
}

// 暴露方法，用于观察新插入 DOM 的图片
function observeNewImages(container) {
    if (!imageObserver) return;
    container.querySelectorAll('img[loading="lazy"]').forEach(img => {
        imageObserver.observe(img);
    });
}
