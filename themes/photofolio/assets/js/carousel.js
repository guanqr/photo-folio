/**
 * 首页轮播：最新的精选图，淡入淡出自动播放 + 圆点指示
 * 悬停/聚焦时暂停自动播放
 */

const AUTOPLAY_MS = 4000;

let autoTimer = null;

export function initCarousel() {
    const carousel = document.getElementById('home-carousel');
    if (!carousel) return;

    const slides = [...carousel.querySelectorAll('.carousel-slide')];
    const dotsEl = carousel.querySelector('.carousel-dots');

    if (!slides.length) return;

    let index = 0;

    function stopAuto() {
        if (autoTimer) {
            clearInterval(autoTimer);
            autoTimer = null;
        }
    }

    function startAuto() {
        stopAuto();
        autoTimer = setInterval(next, AUTOPLAY_MS);
    }

    function goTo(i) {
        index = (i + slides.length) % slides.length;
        slides.forEach((s, k) => s.classList.toggle('active', k === index));
        dots.forEach((d, k) => d.classList.toggle('active', k === index));
    }

    function next() { goTo(index + 1); }

    // 圆点
    slides.forEach((_, i) => {
        const dot = document.createElement('button');
        dot.className = 'carousel-dot';
        dot.setAttribute('aria-label', String(i + 1));
        dot.addEventListener('click', () => goTo(i));
        dotsEl.appendChild(dot);
    });
    const dots = [...dotsEl.children];

    // 悬停/聚焦暂停自动播放
    carousel.addEventListener('mouseenter', stopAuto);
    carousel.addEventListener('mouseleave', startAuto);
    carousel.addEventListener('focusin', stopAuto);
    carousel.addEventListener('focusout', startAuto);

    goTo(0);
    if (slides.length > 1) startAuto();
}
