export function initLightbox() {
    const lightbox = document.getElementById('lightbox');
    const lightboxImg = document.getElementById('lightbox-img');
    const lightboxCaption = document.getElementById('lightbox-caption');
    const lightboxDesc = document.getElementById('lightbox-description');
    const lightboxClose = document.getElementById('lightbox-close');

    if (!lightbox || !lightboxImg) return;

    // 【核心修改】全局事件委托，支持瀑布流和时间流缩略图的点击
    document.addEventListener('click', function(e) {
        const wrapper = e.target.closest('.photo-wrapper');
        if (!wrapper) return; 
        if (wrapper.tagName === 'A') return; 

        const img = wrapper.querySelector('img');
        // 尝试向上寻找 photo-card (瀑布流) 或 timeline-content (时间流)
        const card = wrapper.closest('.photo-card') || wrapper.closest('.timeline-content');
        const title = card ? (card.querySelector('.photo-title') || card.querySelector('.timeline-location')) : null;
        const description = card ? card.dataset.description : '';

        if (img) {
            lightboxImg.src = img.src;
            lightboxImg.alt = img.alt;
            if (lightboxCaption) lightboxCaption.textContent = title ? title.textContent : '';
            if (lightboxDesc) lightboxDesc.textContent = description || '';
            lightbox.classList.add('active');
            document.body.style.overflow = 'hidden';
        }
    });

    const closeLightbox = () => {
        lightbox.classList.remove('active');
        document.body.style.overflow = '';
    };

    if (lightboxClose) lightboxClose.addEventListener('click', closeLightbox);
    lightbox.addEventListener('click', e => { if (e.target === lightbox) closeLightbox(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && lightbox.classList.contains('active')) closeLightbox(); });
}
