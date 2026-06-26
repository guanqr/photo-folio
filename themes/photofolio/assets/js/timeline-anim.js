export function initTimelineAnim() {
    const nodes = document.querySelectorAll('[data-anim="fade-up"]');
    if (!nodes.length) return;

    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('is-visible');
                observer.unobserve(entry.target);
            }
        });
    }, {
        threshold: 0.15,
        rootMargin: '0px 0px -50px 0px'
    });

    nodes.forEach(node => observer.observe(node));
}

// ── 足迹时间线 resize：JS 控制整卡布局 + 缩略图列数 + FLIP ──
let timelineCols = 0;
let isMobile = false;
let resizeTimer = null;

const MOBILE_BP = 768;

export function initTimelineResize() {
    const galleries = document.querySelectorAll('.timeline-gallery');
    if (!galleries.length) return;

    // 初始状态
    timelineCols = getTimelineColumns();
    isMobile = window.innerWidth <= MOBILE_BP;

    // 立即应用正确的列数和移动端布局（无动画）
    applyTimelineState();

    window.addEventListener('resize', () => {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => {
            const newMobile = window.innerWidth <= MOBILE_BP;
            const newCols = getTimelineColumns();

            if (newMobile !== isMobile || newCols !== timelineCols) {
                const oldMobile = isMobile;
                const oldCols = timelineCols;
                isMobile = newMobile;
                timelineCols = newCols;
                flipTimeline(oldMobile, oldCols, newMobile, newCols);
            }
        }, 100);
    });
}

function getTimelineColumns() {
    return window.innerWidth <= MOBILE_BP ? 2 : 4;
}

// ── 收集所有需要 FLIP 的时间线元素 ──
function collectTimelineElements() {
    const elements = [];
    document.querySelectorAll('.timeline-node').forEach(n => elements.push(n));
    document.querySelectorAll('.timeline-date').forEach(n => elements.push(n));
    document.querySelectorAll('.timeline-thumb, .timeline-more').forEach(n => elements.push(n));
    return elements;
}

// ── 切换布局并执行 FLIP ──
function flipTimeline(oldMobile, oldCols, newMobile, newCols) {
    const elements = collectTimelineElements();
    if (!elements.length) return;

    // First：强制回到旧状态测量
    applyTimelineState(oldMobile, oldCols);
    const firstRects = elements.map(el => el.getBoundingClientRect());

    // Last：切到新状态
    applyTimelineState(newMobile, newCols);
    const lastRects = elements.map(el => el.getBoundingClientRect());

    // Invert
    elements.forEach((el, i) => {
        const dx = firstRects[i].left - lastRects[i].left;
        const dy = firstRects[i].top - lastRects[i].top;
        const sx = firstRects[i].width / lastRects[i].width;
        const sy = firstRects[i].height / lastRects[i].height;
        if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5 ||
            Math.abs(sx - 1) > 0.001 || Math.abs(sy - 1) > 0.001) {
            el.style.transition = 'none';
            el.style.transformOrigin = 'top left';
            el.style.transform = `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`;
        }
    });

    elements.forEach(el => el.offsetHeight);

    // Play
    elements.forEach(el => {
        el.style.transition = 'transform 0.35s cubic-bezier(0.4, 0, 0.2, 1)';
        el.style.transform = '';
    });

    const onEnd = function () {
        this.style.transition = '';
        this.removeEventListener('transitionend', onEnd);
    };
    elements.forEach(el => el.addEventListener('transitionend', onEnd));
}

// ── 应用布局状态（不带动画）──
function applyTimelineState(mobile, cols) {
    if (mobile === undefined) mobile = isMobile;
    if (cols === undefined) cols = timelineCols;

    // 缩略图列数
    document.querySelectorAll('.timeline-gallery').forEach(g => {
        g.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
    });

    // 移动端布局
    document.querySelectorAll('.timeline-node, .timeline-end').forEach(el => {
        el.style.flexDirection = mobile ? 'column' : '';
        el.style.gap = mobile ? '0.5em' : '';
        el.style.marginBottom = mobile ? '3em' : '';
    });

    document.querySelectorAll('.timeline-date').forEach(el => {
        el.style.width = mobile ? 'auto' : '';
        el.style.textAlign = mobile ? 'left' : '';
        el.style.paddingLeft = mobile ? '2em' : '';
    });

    // 时间线左侧竖线位置
    document.querySelectorAll('.timeline-container').forEach(el => {
        el.style.setProperty('--tl-line-left', mobile ? '1em' : '');
    });

    // 圆点位置
    document.querySelectorAll('.timeline-date').forEach(el => {
        el.style.setProperty('--tl-dot-left', mobile ? 'calc(1em - 5px)' : '');
        el.style.setProperty('--tl-dot-top', mobile ? '0.3em' : '');
    });
}
