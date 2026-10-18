/**
 * 首页分类卡片：滚动进入视口时交错渐入（2026-10-18 自 main.js 迁出——
 * 一功能一文件；换页清理与 lazy-load 同因：观察器对未揭示目标持强引用，
 * 换页后永不 intersect、累积持有已脱离文档的卡片子树）
 */
let categoryObserver = null;

export function initCategoryReveal() {
    // 断开须在早退之前：跳转无分类卡页面（about/作品页等）时早退将不可达、
    // 旧观察器持续持有首页卡片子树
    if (categoryObserver) {
        categoryObserver.disconnect();
        categoryObserver = null;
    }
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
    categoryObserver = observer;
    cards.forEach((card) => observer.observe(card));
}
