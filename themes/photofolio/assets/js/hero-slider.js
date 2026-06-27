export function initHeroSlider() {
    const hero = document.querySelector('.hero');
    if (!hero) return;

    // 自定义模式：slides 已由 Hugo 渲染，直接启动轮播
    if (!hero.dataset.candidates) {
        const slides = hero.querySelectorAll('.hero-slide');
        const dots = hero.querySelectorAll('.hero-dot');
        if (!slides.length) return;
        startAutoplay(hero, slides.length);
        return;
    }

    // 自动模式：JS 预加载并筛选横图
    let candidates = [];
    try { candidates = JSON.parse(hero.dataset.candidates); } catch (e) {}

    if (!candidates.length) return;

    const MAX_HERO = 5;
    const imgData = new Array(candidates.length);
    let loaded = 0;

    candidates.forEach((c, i) => {
        const img = new Image();
        img.onload = function () {
            loaded++;
            imgData[i] = { src: c.src, alt: c.alt, series: c.series || '', isCover: c.isCover, isLandscape: this.naturalWidth > this.naturalHeight };
            checkDone();
        };
        img.onerror = function () {
            loaded++;
            imgData[i] = { src: c.src, alt: c.alt, series: c.series || '', isCover: c.isCover, isLandscape: false };
            checkDone();
        };
        img.src = c.src;
    });

    function checkDone() {
        if (loaded < candidates.length) return;
        const selected = [];
        const doneSeries = new Set();

        // 先收集组照信息：封面是否横图
        const seriesCover = new Map(); // seriesName -> imgData
        for (const d of imgData) {
            if (!d.series) continue;
            if (!seriesCover.has(d.series) && d.isCover) seriesCover.set(d.series, d);
        }

        for (const d of imgData) {
            if (!d || !d.isLandscape) continue;
            if (d.series) {
                if (doneSeries.has(d.series)) continue;
                // 封面优先：如果封面是横图，必须等封面出现；封面竖图才用其他
                const cover = seriesCover.get(d.series);
                if (cover && cover.isLandscape && d !== cover) continue; // 跳过非封面，等封面
                doneSeries.add(d.series);
            }
            selected.push({ src: d.src, alt: d.alt });
            if (selected.length >= MAX_HERO) break;
        }
        renderHero(hero, selected);
    }

    setTimeout(() => {
        if (!hero.querySelector('.hero-slide')) {
            const fallback = imgData.filter(d => d.isLandscape).slice(0, MAX_HERO).map(d => ({ src: d.src, alt: d.alt }));
            if (fallback.length) renderHero(hero, fallback);
        }
    }, 8000);
}

function renderHero(hero, images) {
    if (!images.length) return;
    const slides = hero.querySelector('.hero-slides');
    const indicators = hero.querySelector('.hero-indicators');

    slides.innerHTML = images.map((img, i) =>
        `<div class="hero-slide${i === 0 ? ' active' : ''}" style="background-image: url('${img.src}');"></div>`
    ).join('');

    if (images.length > 1) {
        indicators.innerHTML = images.map((_, i) =>
            `<button class="hero-dot${i === 0 ? ' active' : ''}" data-slide="${i}"></button>`
        ).join('');
    }

    startAutoplay(hero, images.length);
}

function startAutoplay(hero, count) {
    const interval = (parseInt(hero.dataset.interval, 10) || 5) * 1000;
    const slides = hero.querySelectorAll('.hero-slide');
    const dots = hero.querySelectorAll('.hero-dot');
    let current = 0;
    let timer;

    const go = (i) => {
        slides.forEach(s => s.classList.remove('active'));
        dots.forEach(d => d.classList.remove('active'));
        slides[i].classList.add('active');
        if (dots[i]) dots[i].classList.add('active');
        current = i;
    };

    if (count > 1) timer = setInterval(() => go((current + 1) % count), interval);

    dots.forEach((dot, i) => {
        dot.addEventListener('click', () => {
            clearInterval(timer);
            go(i);
            if (count > 1) timer = setInterval(() => go((current + 1) % count), interval);
        });
    });
}
