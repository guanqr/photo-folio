import { initPanelDrawer } from './lightbox-drawer.js';
import { initPhotoAnalysis } from './lightbox-analysis.js';

let inited = false;

export function initLightbox() {
    if (inited) return;

    const lightbox = document.getElementById('lightbox');
    const lightboxImg = document.getElementById('lightbox-img');
    const lightboxBackdrop = document.getElementById('lightbox-backdrop');
    const lightboxBackdropNext = document.getElementById('lightbox-backdrop-next');
    const lightboxCaption = document.getElementById('lightbox-caption');
    const lightboxMeta = document.getElementById('lightbox-meta');
    const lightboxMetaPlace = document.querySelector('#lightbox-meta-place .lightbox-meta-text');
    const lightboxMetaDate = document.querySelector('#lightbox-meta-date .lightbox-meta-text');
    const lightboxMetaExif = document.querySelector('#lightbox-meta-exif .lightbox-meta-text');
    const lightboxClose = document.getElementById('lightbox-close');
    const btnPrev = document.getElementById('lightbox-prev');
    const btnNext = document.getElementById('lightbox-next');
    // 元信息面板（桌面右栏 / 窄屏底部抽屉）
    const panel = document.getElementById('lightbox-panel');
    const panelDetails = document.getElementById('lightbox-panel-details');
    const panelToggle = document.getElementById('lightbox-panel-toggle');
    const exifList = document.getElementById('lightbox-exif');
    const histogramWrap = document.getElementById('lightbox-histogram-wrap');
    const histogramEl = document.getElementById('lightbox-histogram');
    const paletteWrap = document.getElementById('lightbox-palette-wrap');
    const paletteEl = document.getElementById('lightbox-palette');
    const storyWrap = document.getElementById('lightbox-story-wrap');
    const storyEl = document.getElementById('lightbox-story');

    if (!lightbox || !lightboxImg) return;

    // 窄屏底部抽屉（<769px）：展开/收起、滚轮与拖动手势（独立模块，见 lightbox-drawer.js）
    const drawer = initPanelDrawer({ lightbox, panel, panelDetails, panelToggle, metaEl: lightboxMeta });
    // 图片分析：直方图与色卡（独立模块，见 lightbox-analysis.js）
    const analysis = initPhotoAnalysis({ histogramWrap, histogramEl, paletteWrap, paletteEl });

    let currentPhotos = [];
    let currentIndex = -1;
    // 两层毛玻璃背景：active 为当前显示层，inactive 用于交叉淡入新背景
    let activeBackdrop = lightboxBackdrop;
    let inactiveBackdrop = lightboxBackdropNext;

    // 收集当前页面所有可预览的照片
    function collectPhotos() {
        const wrappers = document.querySelectorAll('.photo-wrapper');
        currentPhotos = [];
        wrappers.forEach(wrapper => {
            const img = wrapper.querySelector('img');
            if (!img || !img.getAttribute('src')) return; // 未揭示的照片还没有 src（无限滚动尚未加载），跳过——箭头仅停留在已加载的最后一张
            const item = wrapper.closest('.masonry-item');
            if (item && item.classList.contains('is-hidden')) return; // 被当前筛选隐藏的照片不进箭头集合
            // [data-title] 通用化：兼容 photo-card 与组照叙事块两种根元素
            const card = wrapper.closest('[data-title]');
            currentPhotos.push({
                src: img.dataset.fullSrc || img.src,
                alt: img.alt,
                title: card ? (card.dataset.title || '') : '',
                place: card ? (card.dataset.place || '') : '',
                date: card ? (card.dataset.date || '') : '',
                exif: card ? (card.dataset.exif || '') : '',
                description: card ? (card.dataset.description || '') : '',
                focus: card ? (card.dataset.focus || '') : '',
                aperture: card ? (card.dataset.aperture || '') : '',
                shutter: card ? (card.dataset.shutter || '') : '',
                iso: card ? (card.dataset.iso || '') : ''
            });
        });
    }

    function preload(url) {
        if (!url) return;
        const img = new Image();
        img.src = url;
    }

    // 简略信息行：地点 / 日期 / 拍摄参数（带图标，组间空格分隔）；空项隐藏，全空则隐藏整个区域
    function setMeta(p) {
        if (!lightboxMeta) return;
        const rows = [
            [lightboxMetaPlace, p.place],
            [lightboxMetaDate, p.date],
            [lightboxMetaExif, p.exif]
        ];
        let any = false;
        rows.forEach(([el, text]) => {
            if (!el) return;
            el.textContent = text || '';
            el.parentElement.style.display = text ? '' : 'none';
            if (text) any = true;
        });
        lightboxMeta.style.display = any ? '' : 'none';
    }

    // EXIF 分行列表：行结构（图标/标签）由模板渲染，这里只填值（空项隐藏）
    function renderExif(p) {
        if (!exifList) return;
        const rows = [
            { key: 'focus', value: p.focus, prefix: '', suffix: 'mm' },
            { key: 'aperture', value: p.aperture, prefix: 'f/', suffix: '' },
            { key: 'shutter', value: p.shutter, prefix: '', suffix: 's' },
            { key: 'iso', value: p.iso, prefix: 'ISO', suffix: '' }
        ];
        exifList.querySelectorAll('li').forEach((li) => {
            const row = rows.find(r => r.key === li.dataset.exifKey);
            const valueEl = li.querySelector('.exif-value');
            if (!row || !row.value) {
                li.style.display = 'none';
                return;
            }
            li.style.display = '';
            valueEl.textContent = row.prefix + row.value + row.suffix;
        });
    }

    // 渲染整个元信息面板（标题 / 简行 / EXIF 分行 / 直方图与色卡 / 故事）
    function renderPanel(p) {
        if (lightboxCaption) lightboxCaption.textContent = p.title;
        setMeta(p);
        renderExif(p);
        if (storyWrap) storyWrap.style.display = p.description ? '' : 'none';
        if (storyEl) storyEl.textContent = p.description || '';
        analysis.analyze(p.src);
        if (panelDetails) panelDetails.scrollTop = 0;
    }

    function open(index) {
        if (!currentPhotos.length) collectPhotos();
        if (index < 0 || index >= currentPhotos.length) return;
        const isSwitch = lightbox.classList.contains('active');
        // 方向必须在更新 currentIndex 之前计算（与旧索引比较）
        const dir = isSwitch
            ? (index === (currentIndex + 1) % currentPhotos.length ? 1 : -1)
            : 1;
        currentIndex = index;
        const p = currentPhotos[index];

        if (currentPhotos.length > 1) {
            preload(currentPhotos[(currentIndex + 1) % currentPhotos.length].src);
            preload(currentPhotos[(currentIndex - 1 + currentPhotos.length) % currentPhotos.length].src);
        }

        if (isSwitch) {
            // 切换照片（参考储卫民摄影站）：旧图轻微滑出（12%）并淡出 →
            // 换内容 → 新图从另一侧轻微滑入归位并淡入；
            // 主图切换完成后，毛玻璃背景再跟随切换（淡出 → 换 → 淡入），更有层次感

            lightboxImg.style.transition = 'transform 0.25s ease, opacity 0.25s ease';
            lightboxImg.style.transform = `translateX(${-dir * 12}%)`;
            lightboxImg.style.opacity = '0';

            lightboxImg.addEventListener('transitionend', function slideOutDone() {
                lightboxImg.removeEventListener('transitionend', slideOutDone);

                // 换内容：新图在进入侧待命
                lightboxImg.style.transition = 'none';
                lightboxImg.style.transform = `translateX(${dir * 12}%)`;
                lightboxImg.src = p.src;
                lightboxImg.alt = p.alt;
                renderPanel(p);
                lightboxImg.offsetHeight; // 强制 reflow

                // 新图滑入归位并淡入
                lightboxImg.style.transition = 'transform 0.25s ease, opacity 0.25s ease';
                lightboxImg.style.transform = 'translateX(0)';
                lightboxImg.style.opacity = '1';
                lightboxImg.addEventListener('transitionend', function slideInDone() {
                    lightboxImg.removeEventListener('transitionend', slideInDone);
                    lightboxImg.style.transition = '';
                    lightboxImg.style.transform = '';

                    // 主图切换完成，背景交叉切换：旧层淡出的同时新层淡入
                    if (activeBackdrop && inactiveBackdrop) {
                        inactiveBackdrop.src = p.src; // 新背景载入非活动层
                        activeBackdrop.style.opacity = '0';
                        inactiveBackdrop.style.opacity = '1';
                        const tmp = activeBackdrop;
                        activeBackdrop = inactiveBackdrop;
                        inactiveBackdrop = tmp;
                    }
                });
            });
        } else {
            lightboxImg.style.opacity = '0';
            renderPanel(p);
            // 在灯箱激活前重置抽屉为收起态：避免旧展开状态先显示一帧导致图片大小反弹
            drawer.reset();
            if (lightboxMeta) lightboxMeta.style.opacity = '0';

            lightboxImg.src = p.src;
            lightboxImg.alt = p.alt;
            if (activeBackdrop) {
                activeBackdrop.src = p.src; // 当前层显示背景
                activeBackdrop.style.opacity = '1';
                if (inactiveBackdrop) inactiveBackdrop.style.opacity = '0';
            }
            lightbox.classList.add('active');
            document.body.style.overflow = 'hidden';

            if (lightboxImg.complete) {
                lightboxImg.style.opacity = '1';
                revealOverlayText();
            } else {
                lightboxImg.addEventListener('load', function onLoad() {
                    lightboxImg.removeEventListener('load', onLoad);
                    lightboxImg.style.opacity = '1';
                    revealOverlayText();
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
        // 无条件重建：SPA 换页后旧列表已指向销毁的网格，必须先收集再取模
        collectPhotos();
        if (currentPhotos.length === 0) return;
        const idx = (currentIndex - 1 + currentPhotos.length) % currentPhotos.length;
        open(idx);
    }

    function next() {
        collectPhotos();
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

    // 标题与简行的透明度恢复（图片就绪路径共用）
    function revealOverlayText() {
        if (lightboxCaption) lightboxCaption.style.opacity = '1';
        if (lightboxMeta) lightboxMeta.style.opacity = '1';
    }

    // 点击照片打开
    document.addEventListener('click', (e) => {
        if (e.target.closest('a')) return; // 链接点击（组照徽章等）不触发灯箱
        const wrapper = e.target.closest('.photo-wrapper');
        if (!wrapper) return;
        const img = wrapper.querySelector('img');
        if (!img) return;
        collectPhotos();
        const index = currentPhotos.findIndex(p => p.src === (img.dataset.fullSrc || img.src));
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
