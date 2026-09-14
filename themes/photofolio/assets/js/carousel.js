/**
 * 首页轮播：最新的精选图，淡入淡出自动播放 + 右下角指示器
 * 窄屏指示器为小圆点（当前项绿色放大），桌面端为横条进度条；自动播放始终由 JS 定时器驱动
 */

const AUTOPLAY_MS = 5000;
const SLIDE_TRANSITION_MS = 1200;

// 自定义平滑滚动：start fast, end slow（类似返回顶部按钮的弹簧感，但无回弹）
function smoothScrollTo(targetY, duration = 700) {
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (prefersReducedMotion) {
        window.scrollTo({ top: targetY });
        return;
    }

    const startY = window.scrollY;
    const diff = targetY - startY;
    const startTime = performance.now();

    // ease-out cubic：起始较快，接近目标时减速
    function easeOutCubic(t) {
        return 1 - Math.pow(1 - t, 3);
    }

    function step(currentTime) {
        const elapsed = currentTime - startTime;
        const progress = Math.min(elapsed / duration, 1);
        const ease = easeOutCubic(progress);
        window.scrollTo(0, startY + diff * ease);
        if (progress < 1) {
            requestAnimationFrame(step);
        }
    }

    requestAnimationFrame(step);
}

export function initCarousel() {
    const carousel = document.getElementById('home-carousel');
    if (!carousel) return;

    const slides = [...carousel.querySelectorAll('.carousel-slide')];
    const dotsEl = carousel.querySelector('.carousel-dots');

    if (!slides.length || !dotsEl) return;

    let index = 0;
    let autoplayTimer = null;

    function startAutoplay() {
        stopAutoplay();
        if (slides.length > 1) {
            autoplayTimer = setInterval(next, AUTOPLAY_MS);
        }
    }

    function stopAutoplay() {
        if (autoplayTimer) {
            clearInterval(autoplayTimer);
            autoplayTimer = null;
        }
    }

    function goTo(i, force = false) {
        // 点击当前正在播放的项时，不重置、不暂停，保持正常轮播
        if (!force && i === index) return;
        index = (i + slides.length) % slides.length;
        slides.forEach((s, k) => s.classList.toggle('active', k === index));
        dots.forEach((d, k) => d.classList.toggle('active', k === index));
        resetProgress();
        // 每次切换后重置自动播放计时器，确保每张图都有完整展示时间
        startAutoplay();
    }

    function next() { goTo(index + 1); }

    function resetProgress() {
        fills.forEach(f => {
            f.style.animation = 'none';
        });
        // 强制浏览器同步重排，确保 animation:none 生效后再恢复动画
        void dotsEl.offsetWidth;
        const activeFill = fills[index];
        if (activeFill) {
            activeFill.style.animation = '';
        }
    }

    // 创建进度条指示器：标题 + 进度条
    slides.forEach((slide, i) => {
        const img = slide.querySelector('img');
        const title = img ? img.alt : String(i + 1);
        const dot = document.createElement('button');
        dot.className = 'carousel-dot';
        dot.setAttribute('aria-label', title);
        dot.innerHTML = `
            <span class="carousel-dot-title">${title}</span>
            <span class="carousel-dot-bar"><span class="carousel-dot-fill"></span></span>
        `;
        dot.addEventListener('click', () => goTo(i));
        dotsEl.appendChild(dot);
    });
    const dots = [...dotsEl.children];
    const fills = dots.map(d => d.querySelector('.carousel-dot-fill'));

    // 向下滚动箭头：滚动到轮播图底部刚好被顶部导航栏遮挡的位置
    const scrollDownBtn = carousel.querySelector('.carousel-scroll-down');
    if (scrollDownBtn) {
        scrollDownBtn.addEventListener('click', () => {
            const header = document.querySelector('.site-header');
            const headerHeight = header ? header.offsetHeight : 0;
            const scrollTop = Math.max(0, carousel.offsetHeight - headerHeight);
            smoothScrollTo(scrollTop);
        });
    }

    // 延迟一帧初始化，确保 DOM 已完成布局、首屏图片开始加载后再启动动画与自动播放
    requestAnimationFrame(() => goTo(0, true));
}
