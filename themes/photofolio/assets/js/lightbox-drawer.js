/**
 * 灯箱元信息底部抽屉（窄屏 <769px）
 *
 * 收起态：详情区仅露出地点/日期简行（默认可见）；展开态：完整详情，
 * 上限 = 50% 视口 − 面板头部（图片区域不小于页面一半）。
 * 交互：滚轮 / 长按拖动渐进控制展开程度；底部箭头一次展开到底或收起；
 * 详情内容仅在全开后可滚动，地点/日期随内容滚动（仅标题固定）。
 * 桌面端：不干预（reset 时清除窄屏残留的内联样式，恢复宽屏详情常显）。
 */
export function initPanelDrawer({ lightbox, panel, panelDetails, panelToggle, metaEl }) {
    const narrowMedia = window.matchMedia('(max-width: 768px)');

    let level = 0;       // 展开程度 0..1
    let headHeight = 0;  // 面板头部高度（每次打开重测：面板总长恒为 50vh，不随标题行数漂移）
    let minHeight = 0;   // 收起态详情区高度 = 地点/日期简行高度

    function maxHeight() {
        // 下拉到底时图片区域不小于页面一半：详情区上限 = 50% 视口 − 面板头部高度
        const px = Math.round(window.innerHeight * 0.5) - headHeight;
        return Math.max(minHeight + 120, px); // 兜底最小可用高度
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
            panelToggle.setAttribute('aria-label', open
                ? (panelToggle.dataset.collapseLabel || '')
                : (panelToggle.dataset.expandLabel || ''));
        }
    }

    function reset(animate = false) {
        if (!narrowMedia.matches) {
            // 桌面：清除窄屏残留的内联样式（内联优先级高于媒体查询 CSS），恢复宽屏详情常显
            panelDetails.style.maxHeight = '';
            panelDetails.style.opacity = '';
            panelDetails.style.transition = '';
            panelDetails.style.overflowY = '';
            panel.classList.remove('is-open');
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
        apply(minHeight, animate);
    }

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

    // 底部箭头：一次展开到底 / 再点收起（收起回到简行可见态）
    if (panelToggle) {
        panelToggle.addEventListener('click', (e) => {
            e.stopPropagation();
            if (!narrowMedia.matches) return;
            const open = panel.classList.contains('is-open');
            level = open ? 0 : 1;
            apply(pxFor(level), true);
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
    panelDetails.addEventListener('scroll', markScrolling, { passive: true });
    lightbox.addEventListener('wheel', markScrolling, { passive: true });

    // 滚轮（灯箱任意区域，与拖动手势同一套滚动模型）：未全开时下滚一律展开抽屉；
    // 全开后滚轮手动滚动内容（光标位置无关，与拖动一致）；内容到底后无操作（图片区域保持半页不回弹）；
    // 上滚时内容回滚，到顶后渐进收起（至少保留地点/日期简行）
    lightbox.addEventListener('wheel', (e) => {
        if (!narrowMedia.matches || !lightbox.classList.contains('active')) return;
        // 容差 1px：浏览器缩放等场景 scrollTop 可能残留小数
        const atTop = panelDetails.scrollTop <= 1;
        const open = level > 0;
        if (e.deltaY > 0) {
            if (!open || level < 1) {
                const next = Math.min(maxHeight(), pxFor(level) + e.deltaY); // 未全开：下滚渐进展开
                e.preventDefault();
                level = (next - minHeight) / (maxHeight() - minHeight);
                apply(next, false);
            } else {
                // 全开：手动滚动内容（任意位置）
                const atBottom = panelDetails.scrollTop + panelDetails.clientHeight >= panelDetails.scrollHeight - 1;
                if (atBottom) return;
                e.preventDefault();
                panelDetails.scrollTop = Math.min(
                    panelDetails.scrollTop + e.deltaY,
                    panelDetails.scrollHeight - panelDetails.clientHeight
                );
            }
        } else if (open) {
            if (!atTop) {
                // 内容手动回滚（任意位置）
                e.preventDefault();
                panelDetails.scrollTop = Math.max(0, panelDetails.scrollTop + e.deltaY);
            } else {
                const next = Math.max(minHeight, pxFor(level) + e.deltaY); // 到顶：渐进收起
                e.preventDefault();
                level = (next - minHeight) / (maxHeight() - minHeight);
                apply(next, false);
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
        } else if (virt < travel) {
            level = virt / travel;
            panelDetails.scrollTop = 0;
            apply(Math.round(minHeight + virt), false);
        } else {
            level = 1;
            apply(maxHeight(), false);
            panelDetails.scrollTop = Math.min(virt - travel, panelDetails.scrollHeight - panelDetails.clientHeight);
        }
    });
    const endDrag = () => { dragging = false; };
    lightbox.addEventListener('pointerup', endDrag);
    lightbox.addEventListener('pointercancel', endDrag);

    return { reset };
}
