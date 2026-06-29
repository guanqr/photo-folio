let imageObserver;

export function initLazyLoad() {
    if (!('IntersectionObserver' in window)) return;

    if (!imageObserver) {
        imageObserver = new IntersectionObserver(entries => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    const img = entry.target;
                    if (img.dataset.src) {
                        img.src = img.dataset.src;
                        img.removeAttribute('data-src');
                    }
                    if (img.complete) {
                        img.classList.add('is-loaded');
                    } else {
                        img.addEventListener('load', function onLoad() {
                            img.removeEventListener('load', onLoad);
                            img.classList.add('is-loaded');
                        });
                    }
                    imageObserver.unobserve(img);
                }
            });
        }, { rootMargin: '200px' });
    }

    observeNewImages(document);
}

// 暴露方法，用于观察新插入 DOM 的图片
function observeNewImages(container) {
    if (!imageObserver) return;
    container.querySelectorAll('img[loading="lazy"]').forEach(img => {
        imageObserver.observe(img);
    });
}
