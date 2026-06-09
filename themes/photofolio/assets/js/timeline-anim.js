export function initTimelineAnim() {
    const nodes = document.querySelectorAll('[data-anim="fade-up"]');
    if (!nodes.length) return;

    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('is-visible');
                observer.unobserve(entry.target); // 动画只执行一次
            }
        });
    }, { 
        threshold: 0.15, // 露出 15% 时触发
        rootMargin: '0px 0px -50px 0px' 
    });

    nodes.forEach(node => observer.observe(node));
}
