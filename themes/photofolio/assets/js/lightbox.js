export function initLightbox() {
    const lightbox = document.getElementById('lightbox');
    const lightboxImg = document.getElementById('lightbox-img');
    const lightboxCaption = document.getElementById('lightbox-caption');
    const lightboxDesc = document.getElementById('lightbox-description');
    const lightboxClose = document.getElementById('lightbox-close');

    if (!lightbox || !lightboxImg) return;

    const photoWrappers = document.querySelectorAll('.photo-wrapper');
    photoWrappers.forEach(wrapper => {
        wrapper.addEventListener('click', function() {
            const img = this.querySelector('img');
            const card = this.closest('.photo-card');
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
    });

    const closeLightbox = () => {
        lightbox.classList.remove('active');
        document.body.style.overflow = '';
    };

    if (lightboxClose) lightboxClose.addEventListener('click', closeLightbox);
    lightbox.addEventListener('click', e => { if (e.target === lightbox) closeLightbox(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && lightbox.classList.contains('active')) closeLightbox(); });
}
