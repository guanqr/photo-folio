let imageObserver;

export function initLazyLoad() {
    if (!('IntersectionObserver' in window)) return;

    imageObserver = new IntersectionObserver(entries => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                const img = entry.target;
                if (img.dataset.src) {
                    img.src = img.dataset.src;
                    img.removeAttribute('data-src');
                }
                imageObserver.unobserve(img);
            }
        });
    }, { rootMargin: '200px' }); // 提前 200px 开始加载

    observeNewImages(document);
}

// 暴露方法，用于观察新插入 DOM 的图片
export function observeNewImages(container) {
    if (!imageObserver) return;
    container.querySelectorAll('img[loading="lazy"]').forEach(img => {
        imageObserver.observe(img);
    });
}
