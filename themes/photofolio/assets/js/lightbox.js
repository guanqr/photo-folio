export function initLightbox() {
    const lightbox = document.getElementById('lightbox');
    const lightboxImg = document.getElementById('lightbox-img');
    const lightboxCaption = document.getElementById('lightbox-caption');
    const lightboxDesc = document.getElementById('lightbox-description');
    const lightboxClose = document.getElementById('lightbox-close');
    const grid = document.getElementById('masonry-grid');

    if (!lightbox || !lightboxImg || !grid) return;

    // 使用事件委托，监听父容器的点击，完美兼容动态加载的新节点
    grid.addEventListener('click', function(e) {
        const wrapper = e.target.closest('.photo-wrapper');
        if (!wrapper) return; // 如果点击的不是照片区域，则忽略

        const img = wrapper.querySelector('img');
        const card = wrapper.closest('.photo-card');
        const title = card ? card.querySelector('.photo-title') : null;
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
