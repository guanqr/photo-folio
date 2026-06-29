let inited = false;

export function initLightbox() {
    if (inited) return;

    const lightbox = document.getElementById('lightbox');
    const lightboxImg = document.getElementById('lightbox-img');
    const lightboxCaption = document.getElementById('lightbox-caption');
    const lightboxDesc = document.getElementById('lightbox-description');
    const lightboxClose = document.getElementById('lightbox-close');
    const btnPrev = document.getElementById('lightbox-prev');
    const btnNext = document.getElementById('lightbox-next');

    if (!lightbox || !lightboxImg) return;

    let currentPhotos = [];
    let currentIndex = -1;

    // 收集当前页面所有可预览的照片
    function collectPhotos() {
        const wrappers = document.querySelectorAll('.photo-wrapper');
        currentPhotos = [];
        wrappers.forEach(w => {
            if (w.tagName === 'A') return; // 跳过组照封面链接
            const img = w.querySelector('img');
            if (!img) return;
            const card = w.closest('.photo-card');
            const title = card ? card.querySelector('.photo-title') : null;
            const desc = card ? card.dataset.description : '';
            currentPhotos.push({
                src: img.src,
                alt: img.alt,
                title: title ? title.textContent : '',
                desc: desc || ''
            });
        });
    }

    function open(index) {
        if (!currentPhotos.length) collectPhotos();
        if (index < 0 || index >= currentPhotos.length) return;
        const isSwitch = lightbox.classList.contains('active');
        currentIndex = index;
        const p = currentPhotos[index];

        if (isSwitch) {
            // 切换照片：图片 + 标题 + 说明同步淡出 → 换内容 → 淡入
            lightboxImg.style.opacity = '0';
            if (lightboxCaption) lightboxCaption.style.opacity = '0';
            if (lightboxDesc) lightboxDesc.style.opacity = '0';

            lightboxImg.addEventListener('transitionend', function handler() {
                lightboxImg.removeEventListener('transitionend', handler);
                lightboxImg.src = p.src;
                lightboxImg.alt = p.alt;
                if (lightboxCaption) {
                    lightboxCaption.textContent = p.title;
                    lightboxCaption.style.opacity = '1';
                }
                if (lightboxDesc) {
                    lightboxDesc.textContent = p.desc;
                    lightboxDesc.style.opacity = '1';
                }
                lightboxImg.style.opacity = '1';
            });
        } else {
            lightboxImg.style.opacity = '0';
            if (lightboxCaption) { lightboxCaption.style.opacity = '0'; lightboxCaption.textContent = p.title; }
            if (lightboxDesc) { lightboxDesc.style.opacity = '0'; lightboxDesc.textContent = p.desc; }

            lightboxImg.src = p.src;
            lightboxImg.alt = p.alt;
            lightbox.classList.add('active');
            document.body.style.overflow = 'hidden';

            if (lightboxImg.complete) {
                lightboxImg.style.opacity = '1';
                if (lightboxCaption) lightboxCaption.style.opacity = '1';
                if (lightboxDesc) lightboxDesc.style.opacity = '1';
            } else {
                lightboxImg.addEventListener('load', function onLoad() {
                    lightboxImg.removeEventListener('load', onLoad);
                    lightboxImg.style.opacity = '1';
                    if (lightboxCaption) lightboxCaption.style.opacity = '1';
                    if (lightboxDesc) lightboxDesc.style.opacity = '1';
                });
            }
        }
        updateArrows();
    }

    function close() {
        lightbox.classList.remove('active');
        lightboxImg.style.opacity = '0';
        document.body.style.overflow = '';
    }

    function prev() {
        if (!currentPhotos.length) collectPhotos();
        if (currentPhotos.length === 0) return;
        const idx = (currentIndex - 1 + currentPhotos.length) % currentPhotos.length;
        open(idx);
    }

    function next() {
        if (!currentPhotos.length) collectPhotos();
        if (currentPhotos.length === 0) return;
        const idx = (currentIndex + 1) % currentPhotos.length;
        open(idx);
    }

    function updateArrows() {
        if (!btnPrev || !btnNext) return;
        const hasMultiple = currentPhotos.length > 1;
        btnPrev.style.display = hasMultiple ? '' : 'none';
        btnNext.style.display = hasMultiple ? '' : 'none';
    }

    // 点击照片打开
    document.addEventListener('click', function (e) {
        const wrapper = e.target.closest('.photo-wrapper');
        if (!wrapper || wrapper.tagName === 'A') return;
        const img = wrapper.querySelector('img');
        if (!img) return;
        collectPhotos();
        const index = currentPhotos.findIndex(p => p.src === img.src);
        if (index >= 0) open(index);
    });

    // 关闭
    if (lightboxClose) lightboxClose.addEventListener('click', close);

    // 箭头按钮
    if (btnPrev) btnPrev.addEventListener('click', e => { e.stopPropagation(); prev(); });
    if (btnNext) btnNext.addEventListener('click', e => { e.stopPropagation(); next(); });

    // 键盘
    document.addEventListener('keydown', e => {
        if (!lightbox.classList.contains('active')) return;
        if (e.key === 'Escape') close();
        if (e.key === 'ArrowLeft') prev();
        if (e.key === 'ArrowRight') next();
    });

    inited = true;
}
