/**
 * 灯箱元信息底部抽屉（窄屏/中屏 ≤1000px——与瀑布流宽屏档位 >1000px 衔接）
 *
 * 收起态：详情区仅露出地点/日期简行（默认可见）；展开态：完整详情，
 * 上限 = 50% 视口 − 面板头部（图片区域不小于页面一半）。
 * 交互：滚轮 / 长按拖动渐进控制展开程度；底部箭头点击全开抽屉（不做滚动定位，
 * 能展开到哪里算哪里），箭头仅在内容到达绝对底部时翻转——翻转后点击回到顶部，
 * 内容以回滚动画随抽屉合拢（与 max-height 过渡同曲线同时长，rAF 驱动 scrollTop）；
 * 视口高度变化时已展开的上限按新 50% 视口重夹（面板总长不随窗口缩小挤占图片区）；
 * 详情内容仅在全开后可滚动，地点/日期随内容滚动（仅标题固定）。
 * 桌面端：不干预（reset 时清除窄屏残留的内联样式，恢复宽屏详情常显）。
 */
export function initPanelDrawer({ lightbox, panel, panelDetails, panelToggle, metaEl }) {
    const narrowMedia = window.matchMedia('(max-width: 1000px)');

    let level = 0;       // 展开程度 0..1
    let headHeight = 0;  // 面板头部高度（每次打开重测：面板总长恒为 50vh，不随标题行数漂移）
    let minHeight = 0;   // 收起态详情区高度 = 地点/日期简行高度

    function maxHeight() {
        // 下方最多展开到画面中间，给上方图片留展示空间：
        // 面板总长（头部 + 详情区）恒为 50% 视口，详情区上限 = 50% 视口 − 面板头部高度
        const px = Math.round(window.innerHeight * 0.5) - headHeight;
        return Math.max(minHeight, px); // 至少露得出地点/日期简行；上限恒为半屏
    }

    function pxFor(lv) {
        return Math.round(minHeight + lv * (maxHeight() - minHeight));
    }

    function apply(px, animate) {
        panelDetails.style.transition = animate
            ? 'max-height 0.4s ease, opacity 0.3s ease'
            : 'none';
        panelDetails.style.maxHeight = px + 'px';
        // 溢出始终 hidden（窄屏滚动完全由手势/滚轮模型接管，程序化 scrollTop 不受影响）——
        // 全开瞬间滚动条弹出会打断进行中的拖拽（浏览器接管滚动条交互触发 pointercancel），
        // 且滚动条出现在指针下方时第二次按压前的状态不可预期
        panelDetails.style.overflowY = 'hidden';
        panelDetails.style.opacity = '1';
        const open = px > minHeight;
        panel.classList.toggle('is-open', open);
        if (panelToggle) {
            panelToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
        }
    }

    // 内容绝对底部（滚轮/拖动的滚动停止条件）
    function atAbsoluteBottom() {
        return panelDetails.scrollTop + panelDetails.clientHeight >= panelDetails.scrollHeight - 1;
    }

    // 箭头翻转判定：抽屉全开且内容到达绝对底部（手动滚过直方图等区域之后）
    function atTarget() {
        if (level < 1) return false;
        return atAbsoluteBottom();
    }

    // 箭头状态：翻转类 + 无障碍标签（翻转后点击是「返回顶部收起」，其余按展开程度区分）
    function updateArrowState() {
        const atBottom = atTarget();
        panel.classList.toggle('is-at-bottom', atBottom);
        if (panelToggle) {
            panelToggle.setAttribute('aria-label', atBottom
                ? (panelToggle.dataset.topLabel || '')
                : (level > 0
                    ? (panelToggle.dataset.collapseLabel || '')
                    : (panelToggle.dataset.expandLabel || '')));
        }
    }

    // 内容回滚动画：溢出恒为 hidden、无原生平滑滚动——rAF 逐帧驱动 scrollTop
    let scrollAnim = null;
    let scrollAnimTo = 0;

    // CSS ease（cubic-bezier(0.25, 0.1, 0.25, 1)）的 y 值求解（牛顿迭代）：
    // 与「收起过渡」同曲线，保证内容回滚与抽屉合拢两条动画锁步
    function cssEaseY(t) {
        const [x1, y1, x2, y2] = [0.25, 0.1, 0.25, 1];
        let s = t;
        for (let i = 0; i < 6; i++) {
            const inv = 1 - s;
            const x = 3 * inv * inv * s * x1 + 3 * inv * s * s * x2 + s * s * s;
            const dx = 3 * inv * inv * x1 + 6 * inv * s * (x2 - x1) + 3 * s * s * (1 - x2);
            if (Math.abs(dx) < 1e-6) break;
            s -= (x - t) / dx;
        }
        const inv = 1 - s;
        return 3 * inv * inv * s * y1 + 3 * inv * s * s * y2 + s * s * s;
    }

    function animateScrollTop(to, duration) {
        cancelScrollAnim();
        const from = panelDetails.scrollTop;
        if (from === to || duration <= 0) {
            panelDetails.scrollTop = to;
            return;
        }
        scrollAnimTo = to;
        const start = performance.now();
        const step = (now) => {
            const t = Math.min(1, (now - start) / duration);
            panelDetails.scrollTop = from + (to - from) * cssEaseY(t);
            scrollAnim = t < 1 ? requestAnimationFrame(step) : null;
        };
        scrollAnim = requestAnimationFrame(step);
    }

    // 中断即完成到目标：回滚期间「展开程度 < 1 时 scrollTop 必为 0」的虚拟位置
    // 不变量被新输入打断后必须立即复原，否则滚动模型错位
    function cancelScrollAnim() {
        if (scrollAnim !== null) {
            cancelAnimationFrame(scrollAnim);
            scrollAnim = null;
            panelDetails.scrollTop = scrollAnimTo;
        }
    }

    function reset(animate = false) {
        cancelScrollAnim();
        if (!narrowMedia.matches) {
            // 桌面：清除窄屏残留的内联样式（内联优先级高于媒体查询 CSS），恢复宽屏详情常显
            panelDetails.style.maxHeight = '';
            panelDetails.style.opacity = '';
            panelDetails.style.transition = '';
            panelDetails.style.overflowY = '';
            level = 0; // 展开程度归零：窄屏开过抽屉再切宽屏时，桌面原生滚动不残留箭头翻转判定
            panel.classList.remove('is-open', 'is-at-bottom');
            updateFit();
            return;
        }
        // 先禁用过渡再归零，避免 offsetHeight 读到过渡中的旧值（否则头部被低估、抽屉开过头）
        panelDetails.style.transition = 'none';
        panelDetails.style.maxHeight = '0px';
        // 每次打开重测头部：详情上限 = 50% 视口 − 头部 → 面板总长恒为 50vh
        headHeight = panel.offsetHeight - panelDetails.offsetHeight;
        minHeight = metaEl ? metaEl.offsetHeight : 0;
        level = 0;
        panelDetails.scrollTop = 0;
        panel.classList.remove('is-fit');
        apply(minHeight, animate);
        updateArrowState();
    }

    // 窄屏抽屉内的双列↔单列转换（768px 边界）：面板轻量淡入滑动柔化内部重排跳变；
    // 高度重测由 resize 处理器覆盖（媒体查询变化伴随 window resize）
    const singleColMedia = window.matchMedia('(max-width: 768px)');
    singleColMedia.addEventListener('change', () => {
        if (!lightbox.classList.contains('active')) return;
        lightbox.classList.remove('is-layout-switching-inner');
        void lightbox.offsetWidth; // 强制回流，重新触发动画
        lightbox.classList.add('is-layout-switching-inner');
    });

    // 灯箱打开期间跨断点：进窄屏重置抽屉、回宽屏清除内联样式恢复桌面布局；
    // 面板触发一次淡入动画柔化布局跳变（prefers-reduced-motion 时由 CSS 关闭）
    narrowMedia.addEventListener('change', (e) => {
        if (!lightbox.classList.contains('active')) return;
        lightbox.classList.remove('is-layout-switching');
        void lightbox.offsetWidth; // 强制回流，重新触发动画
        lightbox.classList.add('is-layout-switching');
        reset(true);
        if (!e.matches) panelDetails.scrollTop = 0;
    });

    // 视口尺寸变化（手机地址栏伸缩、窗口缩放、跨 768px 元信息双列断点）：面板总长恒为
    // 50% 视口——已展开时以新视口重夹上限（展开程度不变），否则固定 px 上限随视口缩小
    // 继续挤占图片区；头部与简行高度同步重测（标题行数 / 地点日期双列↔单列都会改变高度）
    window.addEventListener('resize', () => {
        if (!narrowMedia.matches || !lightbox.classList.contains('active')) return;
        headHeight = panel.offsetHeight - panelDetails.offsetHeight;
        minHeight = metaEl ? metaEl.offsetHeight : 0;
        if (level <= 0) {
            apply(minHeight, false); // 收起态高度随简行重测（双列↔单列切换）
        } else {
            apply(pxFor(level), false);
            panelDetails.scrollTop = Math.min(panelDetails.scrollTop, panelDetails.scrollHeight - panelDetails.clientHeight);
        }
        updateArrowState();
    });

    // 底部箭头：点击只全开抽屉（不做滚动定位，能展开到哪里算哪里）；
    // 箭头仅在内容到达绝对底部时翻转，翻转后点击 → 回到顶部（收起抽屉）
    if (panelToggle) {
        panelToggle.addEventListener('click', (e) => {
            e.stopPropagation();
            if (!narrowMedia.matches) return;
            cancelScrollAnim();
            if (atTarget()) {
                level = 0;
                apply(minHeight, true);
                // 内容回滚动画：与收起过渡同曲线同时长，锁步合拢
                animateScrollTop(0, 400);
            } else {
                level = 1;
                apply(maxHeight(), true);
            }
            updateArrowState();
        });
    }

    // 滚动条按需显示：滚轮/拖动内容时挂 is-scrolling、停止约 0.6s 后移除——
    // scroll 事件同时覆盖桌面原生滚轮滚动与窄屏程序化滚动（拖拽/滚轮手动 scrollTop）
    let scrollIdleTimer = null;
    const markScrolling = () => {
        panel.classList.add('is-scrolling');
        clearTimeout(scrollIdleTimer);
        scrollIdleTimer = setTimeout(() => panel.classList.remove('is-scrolling'), 600);
    };

    // 桌面端「放得下整体居中、放不下标题固定数据滚动」：
    // 全部内容天然高度 ≤ 面板高度 → is-fit（面板居中整组含标题胶囊，详情区不滚动）；
    // 否则标题/胶囊固定在顶部，仅数据区滚动。
    // fitAdjuster：分析区收起期间从其当前高度扣除——总高与正在收缩的分析区
    // 同步缩小，扣除后恒等于收起后的最终总高：「放得下」在点击瞬间即可判定、
    // 过渡全程保持稳定（否则阈值在过渡末段才越过，居中总晚于回顶一步）。
    // force：跳过 active 守卫强制重判（灯箱刚激活/关闭重置时调用）
    let fitAdjuster = null;
    function updateFit(force) {
        if (narrowMedia.matches || (!force && !lightbox.classList.contains('active'))) return;
        const totalH = panel.scrollHeight - panelDetails.clientHeight + panelDetails.scrollHeight
            - (fitAdjuster ? fitAdjuster() : 0);
        panel.classList.toggle('is-fit', totalH <= panel.clientHeight);
    }

    panelDetails.addEventListener('scroll', markScrolling, { passive: true });
    lightbox.addEventListener('wheel', markScrolling, { passive: true });

    // 面板与子块尺寸变化（内容渲染、切图、视口变化）→ 重判「放得下/放不下」
    if (typeof ResizeObserver !== 'undefined') {
        const fitObserver = new ResizeObserver(() => updateFit());
        fitObserver.observe(panel);
        fitObserver.observe(panelDetails);
        Array.from(panel.children).forEach((el) => fitObserver.observe(el));
        Array.from(panelDetails.children).forEach((el) => fitObserver.observe(el));
    }

    // 滚轮（灯箱任意区域，与拖动手势同一套滚动模型）：未全开时下滚一律展开抽屉；
    // 全开后滚轮手动滚动内容（光标位置无关，与拖动一致）；内容到底后无操作（图片区域保持半页不回弹）；
    // 上滚时内容回滚，到顶后渐进收起（至少保留地点/日期简行）
    lightbox.addEventListener('wheel', (e) => {
        // 新输入接管：中断回滚并完成到目标（桌面端分析区收起同样会启动回滚动画，
        // 用户中途滚轮时必须先摘除，否则动画逐帧覆盖滚动输入）
        cancelScrollAnim();
        if (!narrowMedia.matches || !lightbox.classList.contains('active')) return;
        // 容差 1px：浏览器缩放等场景 scrollTop 可能残留小数
        const atTop = panelDetails.scrollTop <= 1;
        const open = level > 0;
        if (e.deltaY > 0) {
            if (!open || level < 1) {
                const travel = maxHeight() - minHeight;
                if (travel < 1) return; // 行程为零（视口过矮/头部过高）：无展开余地
                const next = Math.min(maxHeight(), pxFor(level) + e.deltaY); // 未全开：下滚渐进展开
                e.preventDefault();
                level = (next - minHeight) / travel;
                apply(next, false);
                updateArrowState();
            } else {
                // 全开：手动滚动内容（任意位置，可越过箭头目标深入直方图）
                const scrolledToBottom = atAbsoluteBottom();
                if (scrolledToBottom) return;
                e.preventDefault();
                panelDetails.scrollTop = Math.min(
                    panelDetails.scrollTop + e.deltaY,
                    panelDetails.scrollHeight - panelDetails.clientHeight
                );
                updateArrowState();
            }
        } else if (open) {
            if (!atTop) {
                // 内容手动回滚（任意位置）
                e.preventDefault();
                panelDetails.scrollTop = Math.max(0, panelDetails.scrollTop + e.deltaY);
                updateArrowState();
            } else {
                const travel = maxHeight() - minHeight;
                if (travel < 1) return; // 行程为零：无收起余地
                const next = Math.max(minHeight, pxFor(level) + e.deltaY); // 到顶：渐进收起
                e.preventDefault();
                level = (next - minHeight) / travel;
                apply(next, false);
                updateArrowState();
            }
        }
    }, { passive: false });

    // 长按拖动（灯箱任意区域、所有指针类型，与滚轮同一套虚拟位置模型，除按钮/链接）：
    // 上滑先展开抽屉到全开，继续上滑则滚动内容露出直方图等剩余信息；下滑对称回退；
    // 详情区（元信息面板）同样参与——内容滚动由本模型接管，不依赖原生滚动
    let dragStartY = null;
    let dragStartVirt = 0;
    let dragging = false;
    lightbox.addEventListener('pointerdown', (e) => {
        if (!narrowMedia.matches || !lightbox.classList.contains('active')) return;
        if (e.target.closest('button') || e.target.closest('a')) return;
        e.preventDefault(); // 阻止原生图片拖拽/文本选择抢走 pointermove
        cancelScrollAnim(); // 拖拽接管前完成进行中的回滚，保持虚拟位置不变量
        if (maxHeight() - minHeight < 1) return; // 行程为零：拖拽无展开余地，不启动
        dragging = true;
        dragStartY = e.clientY;
        dragStartVirt = level * (maxHeight() - minHeight) + panelDetails.scrollTop;
        lightbox.setPointerCapture(e.pointerId);
    });
    lightbox.addEventListener('pointermove', (e) => {
        if (!dragging) return;
        const travel = maxHeight() - minHeight;
        const virt = dragStartVirt + (dragStartY - e.clientY);
        if (virt <= 0) {
            level = 0;
            panelDetails.scrollTop = 0;
            apply(minHeight, false);
            updateArrowState();
        } else if (virt < travel) {
            level = virt / travel;
            panelDetails.scrollTop = 0;
            apply(Math.round(minHeight + virt), false);
            updateArrowState();
        } else {
            level = 1;
            apply(maxHeight(), false);
            panelDetails.scrollTop = Math.min(virt - travel, panelDetails.scrollHeight - panelDetails.clientHeight);
            updateArrowState();
        }
    });
    const endDrag = () => { dragging = false; };
    lightbox.addEventListener('pointerup', endDrag);
    lightbox.addEventListener('pointercancel', endDrag);

    return {
        reset,
        refresh: updateArrowState,
        // 内容回滚到顶部（供分析区收起时同步回顶）：与收起过渡同曲线同时长锁步——
        // 曲线/时长与抽屉收起动画共用，中断行为同样由滚轮/拖动接管（cancelScrollAnim）
        scrollToTop: (duration) => animateScrollTop(0, duration),
        // 设置/清除内容高度扣除函数并立即重判（分析区收起期间传入其当前高度：
        // 最终总高在整个过渡期间恒定，「放得下」点击瞬间即判定且不翻覆）；
        // 返回重判后的「放得下」状态（窄屏恒 false——is-fit 仅桌面生效）
        setFitAdjuster: (fn) => { fitAdjuster = fn; updateFit(); return panel.classList.contains('is-fit'); },
        // 强制重判「放得下」（跳过 active 守卫）：灯箱刚激活时调用——展开态
        // 关灯箱残留的 is-fit=false 若不再重判，再打开时详情区 auto 边距会把
        // 内容挤到中部、标题与 EXIF 之间出现大空隙
        refreshFit: () => updateFit(true)
    };
}
