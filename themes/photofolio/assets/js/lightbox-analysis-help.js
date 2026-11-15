/**
 * 灯箱图表说明气泡（独立模块；集成见 lightbox.js）
 *
 * - 四个分析区块（影調/色卡/飽和度/色相）标题右端各有一个圆形问号按钮，
 *   点击把该区块的说明以气泡形式显示；文案来自模板按钮的 data-help（i18n
 *   构建期写入），模块内不持任何展示文本
 * - 出现与消失都走 opacity 过渡：淡入在下一帧加 is-open；收起先摘 is-open
 *   淡出、过渡结束才 hidden（display:none 会立刻中断过渡、直接收会闪断），
 *   减弱动态时直接切换（2026-11-15）
 * - 气泡是灯箱根节点下的 fixed 层：分析区 `.lightbox-analysis` 自身
 *   `overflow: hidden`（开合过渡需要），气泡若挂在区内会被裁切（2026-11-15）
 * - 位置在按钮下方、空间不足时翻到上方，并钳制在详情面板内（面板矩形 ∩
 *   视口；面板比气泡窄时先收窄气泡宽度，保证不越过详情区边界）；打开时
 *   摆放一次，之后页面/详情区一旦滚动（含抽屉滚底动画）、视口尺寸变化或
 *   开始拖拽即收起——气泡不做跟随，避免滚动期间浮窗悬在内容上挡图
 *   （2026-11-15 用户裁定）
 * - 同一时间只开一个；点击气泡外任意位置、再次点击同一按钮、Esc
 *   （由 lightbox.js 先消费）或关闭灯箱都会收起；气泡本身 pointer-events:none，
 *   不遮挡图表、也不截获切图等操作
 *
 * 浏览器实测（headless Chrome / CDP）：展开/收起、Esc 只收气泡、外部点击、
 * 滚动即收起、跨断点收起均在真实页面验证通过
 */
export function initLightboxAnalysisHelp({ lightbox, pop, panel, reducedMotion }) {
    if (!lightbox || !pop) return { close() {}, closeIfOpen() { return false; } };

    const GAP = 6;   // 气泡与按钮的垂直间距（px，几何量，与 SCSS 的 em 标尺无关）
    const EDGE = 8;  // 与面板/视口边缘的最小留白（px）

    let openBtn = null;
    let fadeRaf = 0;

    // 可放置范围 = 详情面板矩形 ∩ 视口，再各收进 EDGE；面板缺失/隐藏
    // （全屏、缩放等）时退回整个视口
    function boundRect(vw, vh) {
        let left = EDGE;
        let top = EDGE;
        let right = vw - EDGE;
        let bottom = vh - EDGE;
        const pr = panel ? panel.getBoundingClientRect() : null;
        if (pr && pr.width > 0 && pr.height > 0) {
            left = Math.max(left, pr.left + EDGE);
            top = Math.max(top, pr.top + EDGE);
            right = Math.min(right, pr.right - EDGE);
            bottom = Math.min(bottom, pr.bottom - EDGE);
        }
        return { left, top, right, bottom };
    }

    function place(r, vw, vh) {
        const b = boundRect(vw, vh);
        // 量尺寸前先归零定位与内联宽度：上一次的 left 可能贴着右缘甚至落在
        // 视口外，fixed 元素会被压窄、文字多折几行，高度测量严重偏大（实测
        // 跨断点后 617px 的按钮被误判成「下方放不下」而翻到顶部）；同一帧内
        // 先写 0 再写最终位置，不会闪现
        pop.style.maxWidth = '';
        pop.style.left = '0px';
        pop.style.top = '0px';
        let w = pop.offsetWidth;
        let h = pop.offsetHeight;
        const avail = Math.max(0, b.right - b.left);
        if (w > avail) {
            // 面板比气泡窄（窄屏抽屉）：先收窄到可用宽度，再按新高度重新摆位
            pop.style.maxWidth = `${avail}px`;
            w = pop.offsetWidth;
            h = pop.offsetHeight;
        }
        // 优先与按钮左缘对齐；两侧都钳制在面板内
        const left = Math.min(Math.max(b.left, r.left), Math.max(b.left, b.right - w));
        let top = r.bottom + GAP;
        if (top + h > b.bottom) top = r.top - h - GAP; // 下方放不下：翻到上方
        // 上下同样钳制：锚点只在边缘露出一部分时也保证气泡完整可见
        top = Math.min(Math.max(b.top, top), Math.max(b.top, b.bottom - h));
        pop.style.left = left + 'px';
        pop.style.top = top + 'px';
    }

    // 收起动画：先移除 is-open 走 opacity 过渡，过渡结束再 hidden——display:none
    // 会立刻中断过渡，直接 hidden 等于闪断；时长从实际 transition-duration
    // 读取，与样式表 token 保持一致（2026-11-15）
    let hideTimer = 0;

    function clearHide() {
        if (hideTimer) {
            clearTimeout(hideTimer);
            hideTimer = 0;
        }
    }

    function hideNow() {
        clearHide();
        pop.hidden = true;
        pop.textContent = '';
    }

    function fadeMs() {
        const d = parseFloat(getComputedStyle(pop).transitionDuration);
        return Number.isNaN(d) ? 0 : d * 1000;
    }

    function close() {
        if (!openBtn) return;
        openBtn.setAttribute('aria-expanded', 'false');
        openBtn = null;
        if (fadeRaf) {
            cancelAnimationFrame(fadeRaf);
            fadeRaf = 0;
        }
        pop.classList.remove('is-open');
        if (reducedMotion) {
            hideNow();
        } else {
            clearHide();
            hideTimer = setTimeout(hideNow, fadeMs() + 20);
        }
        document.removeEventListener('scroll', close, true);
        window.removeEventListener('scroll', close);
        window.removeEventListener('resize', close);
    }

    // 供 lightbox.js 的 Esc 处理先消费：气泡开着时 Esc 只收气泡、不关灯箱
    function closeIfOpen() {
        if (!openBtn) return false;
        close();
        return true;
    }

    function open(btn) {
        // 不可见的按钮不弹：分析区收起时 max-height: 0 + overflow: hidden 只是把
        // 按钮裁掉（矩形仍在布局里），按钮本身被点不到；滚出面板可视范围的同理
        const wrap = btn.closest('.lightbox-analysis');
        if (wrap && !wrap.classList.contains('is-open')) return;
        const r = btn.getBoundingClientRect();
        const vw = document.documentElement.clientWidth;
        const vh = document.documentElement.clientHeight;
        if (r.width === 0 || r.bottom <= 0 || r.top >= vh) return;
        // 从一个按钮切到另一个：气泡不复位、直接换文案与位置（避免淡出再淡入闪一下）；
        // 正在淡出的气泡被重新点开：取消隐藏定时器，从当前透明度直接淡回
        const wasOpen = !!openBtn;
        if (openBtn) openBtn.setAttribute('aria-expanded', 'false');
        clearHide();
        openBtn = btn;
        pop.textContent = btn.dataset.help || '';
        pop.hidden = false;
        // 先摆位再淡入：hidden 移除的同一帧若还没定位，气泡会从左上角飞入
        place(r, vw, vh);
        if (wasOpen) {
            pop.classList.add('is-open'); // 已显示：只移动，不重播淡入
        } else {
            pop.classList.remove('is-open');
            if (reducedMotion) {
                pop.classList.add('is-open');
            } else {
                fadeRaf = requestAnimationFrame(() => {
                    fadeRaf = 0;
                    if (openBtn) pop.classList.add('is-open');
                });
            }
        }
        btn.setAttribute('aria-expanded', 'true');
        // 页面移动即收起：capture 阶段接住元素内滚动（详情区/抽屉滚底动画），
        // 再补窗口自身的滚动与尺寸变化（旋转/拉宽窗口）
        document.addEventListener('scroll', close, true);
        window.addEventListener('scroll', close, { passive: true });
        window.addEventListener('resize', close);
    }

    lightbox.addEventListener('click', (e) => {
        const btn = e.target.closest('.lightbox-chart-help');
        if (btn) {
            if (openBtn === btn) close();
            else open(btn);
            return;
        }
        close(); // 点到气泡外任意处即收起（气泡 pointer-events:none，不会落到这里）
    });

    // 拖拽抽屉不会产生 click：按下别处即收起，避免拖动过程中气泡脱锚悬空；
    // 按在问号按钮上则交给 click 做开合切换
    lightbox.addEventListener('pointerdown', (e) => {
        if (openBtn && !e.target.closest('.lightbox-chart-help')) close();
    });

    return { close, closeIfOpen };
}
