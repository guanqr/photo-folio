export function initHeaderScroll() {
    const header = document.querySelector('.site-header');
    if (!header) return;

    header.style.background = ''; // 清除任何历史遗留的 inline 背景，保证顶部纯透明

    // 背景/底边线/阴影随下拉程度连续渐变（不受时间过渡控制）：
    // 滚动距离走满 DIST 时进度 0→1（0 透明、1 完全不透明），每帧写入
    // --header-progress 供 CSS 消费；is-scrolled 保留为文字切换信号——
    // 亮色首页顶部白字须在背景过半前换回主题文字，否则白字压在半透米色底上
    const DIST = 50;      // 渐变全程所需滚动距离（px）——页面标题顶缘距页顶约 3em（48px），
                          // 导航栏触到标题即完全不透明
    const FLIP_AT = 0.5;  // 文字/交互态切换阈值（进度）
    let ticking = false;

    const update = () => {
        ticking = false;
        const p = Math.min(1, window.scrollY / DIST);
        header.style.setProperty('--header-progress', p.toFixed(3));
        header.classList.toggle('is-scrolled', p >= FLIP_AT);
    };
    window.addEventListener('scroll', () => {
        if (!ticking) {
            ticking = true;
            requestAnimationFrame(update);
        }
    }, { passive: true });
    update();
}
