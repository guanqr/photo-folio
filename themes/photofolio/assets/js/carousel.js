/**
 * 首页轮播：最新的精选图，淡入淡出自动播放 + 右下角指示器
 * 窄屏指示器为小圆点（当前项绿色放大），桌面端为横条进度条；自动播放始终由 JS 定时器驱动
 */

import { prefersReducedMotion, easeOutCubic } from './utils.js';

const SLIDE_TRANSITION_MS = 1200;

// 自定义平滑滚动：start fast, end slow（类似返回顶部按钮的弹簧感，但无回弹）
function smoothScrollTo(targetY, duration = 700) {
    if (prefersReducedMotion()) {
        window.scrollTo({ top: targetY });
        return;
    }

    const startY = window.scrollY;
    const diff = targetY - startY;
    const startTime = performance.now();

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

// 模块级自动播放定时器：SPA 离开首页后轮播 DOM 被替换销毁，但闭包定时器
// 仍持有一整套 slide img 并每 5s 空转——重新进入非首页时清掉上一轮定时器，
// 释放闭包与解码位图（往返首页多次不再叠加）
let runningTimer = null;

// 页面可见性监听（模块级、随 initCarousel 拆线重挂）：标签页隐藏时定时器
// 被节流后仍会触发轮换与 Ken Burns 空转——隐藏即停、可见恢复
//（对照系列页氛围粒子的停帧/续帧先例，2026-10-18）
let onVisibility = null;

export function initCarousel() {
    // 拆线先于早退：换页后旧监听闭包持有已销毁轮播的整组 slide img（解码位图）
    if (onVisibility) {
        document.removeEventListener('visibilitychange', onVisibility);
        onVisibility = null;
    }
    const carousel = document.getElementById('home-carousel');
    if (!carousel) {
        if (runningTimer) {
            clearInterval(runningTimer);
            runningTimer = null;
        }
        return;
    }

    // 自动播放间隔：hugo.toml [params].carouselInterval 经容器 data 属性传入
    //（0 = 禁用自动播放；未配置/非法值回退 5000ms；其余钳制最小 1200ms，与淡入淡出时长一致防重叠）
    const autoplayMs = parseInt(carousel.dataset.autoplayMs, 10);
    const AUTOPLAY_MS = Number.isNaN(autoplayMs) ? 5000 : (autoplayMs <= 0 ? 0 : Math.max(SLIDE_TRANSITION_MS, autoplayMs));
    // 进度条时长与自动播放间隔同步；禁用时进度条不再填充
    carousel.style.setProperty('--carousel-progress-duration', `${AUTOPLAY_MS > 0 ? AUTOPLAY_MS : 5000}ms`);
    if (AUTOPLAY_MS === 0) carousel.classList.add('no-autoplay');

    const slides = [...carousel.querySelectorAll('.carousel-slide')];
    const dotsEl = carousel.querySelector('.carousel-dots');

    if (!slides.length || !dotsEl) return;

    let index = 0;

    // 轮播图懒加载：第 2+ 张为 data-src（首张保持 src + eager，LCP 不受影响）——
    // 切换前确保目标与左右邻居已加载：预载领先于 1.2s 淡入过渡、切换无空窗
    const slideImgs = slides.map((slide) => slide.querySelector('img'));
    const ensureLoaded = (i) => {
        const img = slideImgs[i];
        if (img && img.dataset.src && !img.src) {
            img.src = img.dataset.src;
        }
    };

    function startAutoplay() {
        stopAutoplay();
        // 标签页隐藏时不启动（后台加载/恢复场景）：可见性恢复时经
        // visibilitychange 续播
        if (AUTOPLAY_MS > 0 && slides.length > 1 && !document.hidden) {
            runningTimer = setInterval(next, AUTOPLAY_MS);
        }
    }

    function stopAutoplay() {
        if (runningTimer) {
            clearInterval(runningTimer);
            runningTimer = null;
        }
    }

    // 标签页隐藏即停、可见且轮播仍挂载即恢复自动播放
    onVisibility = () => {
        if (document.hidden) {
            stopAutoplay();
        } else if (carousel.isConnected) {
            startAutoplay();
        }
    };
    document.addEventListener('visibilitychange', onVisibility);

    // Ken Burns 微缩放（WAAPI）：激活 slide 在自动播放时长内 1→1.05 极缓推近
    //（fill forwards 保持末端态）；切换时旧 slide 不做缩回——保持放大态随
    // 交叉淡化淡出（用户要求：展示期与切换均无缩小过程）；旧图重新激活时
    // 取消残留动画、从 1 重新缓推（此时它正从透明淡入、无可见跳变）
    const KENBURNS_SCALE = 1.05;
    const kenBurnsIn = (slide) => {
        const img = slide.querySelector('img');
        if (!img) return;
        img.getAnimations().forEach((a) => a.cancel()); // 清残留（上一轮缓推）防同属性动画叠加
        img.animate(
            [{ transform: 'scale(1)' }, { transform: `scale(${KENBURNS_SCALE})` }],
            { duration: AUTOPLAY_MS, easing: 'linear', fill: 'forwards' }
        );
    };

    function goTo(i, force = false) {
        // 点击当前正在播放的项时，不重置、不暂停，保持正常轮播
        if (!force && i === index) return;
        index = (i + slides.length) % slides.length;
        // 目标与左右邻居确保已加载（首张 src 恒在、邻居预载一次即命中）
        ensureLoaded(index);
        ensureLoaded((index + 1) % slides.length);
        ensureLoaded((index - 1 + slides.length) % slides.length);
        // Ken Burns：新激活 slide 重新缓推（旧 slide 保持放大态淡出、不缩回；
        // 减弱动态与自动播放禁用时跳过）
        if (!prefersReducedMotion() && AUTOPLAY_MS > 0) {
            kenBurnsIn(slides[index]);
        }
        // 当前 slide 语义：非激活图对读屏器隐藏、激活圆点 aria-current 标记
        slides.forEach((s, k) => {
            s.classList.toggle('active', k === index);
            s.toggleAttribute('aria-hidden', k !== index);
        });
        dots.forEach((d, k) => {
            d.classList.toggle('active', k === index);
            if (k === index) d.setAttribute('aria-current', 'true');
            else d.removeAttribute('aria-current');
        });
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
        // 骨架 innerHTML 不含任何动态部分；照片标题（photo.toml alt，自由文本）
        // 经 textContent 写入——标题含 <>& 等字符若拼进 innerHTML 会被当标签/实体解析
        dot.innerHTML = `
            <span class="carousel-dot-title"></span>
            <span class="carousel-dot-bar"><span class="carousel-dot-fill"></span></span>
        `;
        dot.querySelector('.carousel-dot-title').textContent = title;
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
