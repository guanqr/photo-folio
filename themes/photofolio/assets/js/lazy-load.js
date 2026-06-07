export function initLazyLoad() {
    if (!('IntersectionObserver' in window)) return;

    const imageObserver = new IntersectionObserver(entries => {
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
    }, { rootMargin: '100px' });

    document.querySelectorAll('img[loading="lazy"]').forEach(img => imageObserver.observe(img));
}
