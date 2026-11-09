/**
 * 灯箱主图缩放（独立模块；集成见 lightbox.js）
 *
 * - 放大镜按钮 / 图片区滚轮 / 触屏双指捏合进入缩放：主图在自身布局矩形上
 *   应用 translate+scale（origin 中心），视觉中心对齐灯箱（视口）中心；信息
 *   面板、缩略图条与左右箭头淡出但保留布局，图片可越过原图片区绘制（由
 *   .lightbox 统一裁切）——进出缩放不触发重排，抽屉无需重测
 * - 按钮默认 2× 居中（有过渡动画）；点击主图（触屏双击）同样切换缩放；
 *   滚轮锚定光标、双指锚定中点，倍率 1×–4×；放大后鼠标/单指拖动平移，
 *   平移范围钳制在图片不露出空白。窄屏（≤1000px）滚轮缩放仅在详情抽屉
 *   完全收起（图片最大）时启用，未收起时滚轮只驱动抽屉（见 canStartWheelZoom）
 * - 辉光层是独立元素：进入缩放时记录其静止内联状态，施加同一平移 +
 *   「2× 半分辨率补偿 × 当前倍率」缩放，进出过渡与主图同步，辉光始终环绕
 *   主图；退出/复位时还原
 * - 进入/退出用 transform 过渡（0.35s 标准缓出，超时兜底防 transitionend
 *   缺失）；减弱动态直切
 * - 缩放期间禁止切图（由 lightbox.js 在箭头/键盘/滑动/自动播放入口守卫）；
 *   关闭灯箱时立即复位缩放，但保留面板/缩略图条隐藏态到淡出结束，由下次
 *   首开 reset 摘除
 */
import { FLIP_TRANSITION, scheduleFlipFinish, resetFlipFinish, clearFlipInline } from './flip.js';
import { GLOW_ZOOM_TRANSITION } from './lightbox-glow.js';

const MIN_SCALE = 1;
const MAX_SCALE = 4;
const DEFAULT_SCALE = 2;
const DOUBLE_TAP_MS = 300; // 触屏双击窗口
const DOUBLE_TAP_DIST = 30; // 两次轻触的最大位移（px）
const TAP_MOVE_PX = 10; // 超过视为拖动/滑动，不参与双击判定
const PAN_START_PX = 4; // 拖动超过该位移才真正接管平移

export function initLightboxMagnify({
    lightbox, img, area, content, button, reducedMotion,
    isBlocked, cancelSwipe, cancelDrawerDrag, canStartWheelZoom, onExit
}) {
    if (!lightbox || !img || !area || !content) {
        return { exit() {}, reset() {}, resetForClose() {}, isActive: () => false };
    }

    let active = false;
    let animating = false;
    let scale = 1;
    let panX = 0;
    let panY = 0;

    let anim = null; // { token, onEnd, finishTimer }：在途缩放过渡收尾
    let animToken = 0;
    let applyRaf = 0;

    const pointers = new Map(); // pointerId -> { x, y, downX, downY, type, onImage }
    let pinch = null;
    let pan = null;
    // 辉光层（独立元素、不随主图 transform）：进入缩放时记录静止内联状态，
    // 施加同一缩放变换（自身 2× 半分辨率补偿 × 当前倍率）保持环绕主图
    let glowRecords = [];
    // 主图点击/双击：最近一次指针类型（触摸合成的 click 不重复触发）、
    // 鼠标拖动后的 click 抑制窗口、触摸双击配对
    let lastPointerType = '';
    let suppressClickUntil = 0;
    let lastTap = null;
    let pinchGuardUntil = 0; // 捏合结束后短暂屏蔽双击（两指先后抬起不误判为轻触）

    // 布局快照：捏合/滚轮/平移的每帧重复 getBoundingClientRect/getComputedStyle
    // 读的都是同一套布局（手势中只有 transform 变化），缓存后只在 ResizeObserver
    // 报告尺寸变化时失效；动画期间失效则在收尾后补一次 apply（2026-11-10 #6/#31）
    let metricsCache = null;
    let layoutChanged = false;
    const invalidateMetrics = () => {
        metricsCache = null;
        if (animating) layoutChanged = true;
    };
    const metrics = () => {
        if (metricsCache) return metricsCache;
        // 视口取灯箱全屏范围：图片可越过隐藏的缩略图条/面板，在整屏居中
        const view = lightbox.getBoundingClientRect();
        const ar = area.getBoundingClientRect();
        const cs = getComputedStyle(area);
        const pl = parseFloat(cs.paddingLeft) || 0;
        const pr = parseFloat(cs.paddingRight) || 0;
        const pt = parseFloat(cs.paddingTop) || 0;
        const pb = parseFloat(cs.paddingBottom) || 0;
        const innerW = Math.max(1, ar.width - pl - pr);
        const innerH = Math.max(1, ar.height - pt - pb);
        metricsCache = {
            w: img.offsetWidth,
            h: img.offsetHeight,
            baseCX: ar.left + pl + innerW / 2,
            baseCY: ar.top + pt + innerH / 2,
            viewCX: view.left + view.width / 2,
            viewCY: view.top + view.height / 2,
            viewW: view.width,
            viewH: view.height
        };
        return metricsCache;
    };

    const transformString = (m) => {
        const tx = (m.viewCX - m.baseCX) + panX;
        const ty = (m.viewCY - m.baseCY) + panY;
        return `translate(${tx}px, ${ty}px) scale(${scale})`;
    };

    /* 平移钳制：缩放后的图片大于内容区时边缘不得露出空白，小于时居中对齐 */
    const clampPan = (m) => {
        const sw = m.w * scale;
        const sh = m.h * scale;
        const maxX = Math.max(0, (sw - m.viewW) / 2);
        const maxY = Math.max(0, (sh - m.viewH) / 2);
        panX = Math.max(-maxX, Math.min(maxX, panX));
        panY = Math.max(-maxY, Math.min(maxY, panY));
    };

    // 半分辨率补偿系数与 CSS 同源（--glow-scale，见 _lightbox-image.scss）：
    // collectGlows 时读取一次，缩放态的内联 transform 不再硬编码 2×
    let glowScale = 2;

    const glowTarget = (m) => {
        const tx = (m.viewCX - m.baseCX) + panX;
        const ty = (m.viewCY - m.baseCY) + panY;
        return `translate(${tx}px, ${ty}px) scale(${glowScale * scale})`;
    };

    const collectGlows = () => {
        const raw = getComputedStyle(lightbox).getPropertyValue('--glow-scale');
        const n = parseFloat(raw);
        glowScale = Number.isFinite(n) && n > 0 ? n : 2;
        glowRecords = [...area.querySelectorAll('.lightbox-img-glow')].map((el) => ({
            el,
            transform: el.style.transform,
            transition: el.style.transition
        }));
    };

    // 连续缩放/平移：辉光层即时跟随（其内联过渡为 opacity，不动 transform）。
    // 与上次写入相同即跳过——平移被钳制在边缘时逐帧重复写同一个大倍率
    // 变换会让大半径模糊层反复栅格化（2026-11-10 审查 #7）
    const applyGlows = (m) => {
        if (!glowRecords.length) return;
        const target = glowTarget(m);
        glowRecords.forEach(({ el, transition }) => {
            if (el.style.transition !== transition) el.style.transition = transition;
            if (el.style.transform !== target) el.style.transform = target;
        });
    };

    const animateGlowsToZoom = (m) => {
        if (!glowRecords.length) return;
        const target = glowTarget(m);
        glowRecords.forEach(({ el }) => {
            el.style.transition = GLOW_ZOOM_TRANSITION;
            el.style.transform = target;
        });
    };

    const restoreGlowTransitions = () => {
        glowRecords.forEach(({ el, transition }) => { el.style.transition = transition; });
    };

    // 退出：辉光层与主图同时过渡回各自的静止内联状态
    const animateGlowsBack = () => {
        glowRecords.forEach(({ el, transform }) => {
            el.style.transition = GLOW_ZOOM_TRANSITION;
            el.style.transform = transform;
        });
    };

    const restoreGlows = () => {
        glowRecords.forEach(({ el, transform, transition }) => {
            el.style.transition = transition;
            el.style.transform = transform;
        });
        glowRecords = [];
    };

    const applyWith = (m) => {
        clampPan(m);
        img.style.transformOrigin = '50% 50%';
        img.style.transform = transformString(m);
        applyGlows(m);
    };

    const apply = () => {
        if (!active) return;
        applyWith(metrics());
    };

    const scheduleApply = () => {
        if (applyRaf) return;
        applyRaf = requestAnimationFrame(() => {
            applyRaf = 0;
            apply();
        });
    };

    const cancelApply = () => {
        if (applyRaf) {
            cancelAnimationFrame(applyRaf);
            applyRaf = 0;
        }
    };

    const cancelAnim = () => {
        if (!anim) return;
        img.removeEventListener('transitionend', anim.onEnd);
        resetFlipFinish(anim); // 收尾定时器槽位与瀑布流 FLIP 共用（flip.js）
        anim = null;
        animating = false;
        img.style.transition = '';
    };

    /* 单次 transform 过渡：transitionend 主收尾 + 超时兜底（过渡被全局
       压制/取消时无 end 事件）；定时器槽复用 flip.js 的 scheduleFlipFinish
       （2026-11-10 审查 #10） */
    const animateTo = (target, done) => {
        cancelAnim();
        const token = ++animToken;
        animating = true;
        const finish = () => {
            if (!anim || anim.token !== token) return;
            cancelAnim();
            if (done) done();
        };
        const onEnd = (e) => {
            if (e.target === img && e.propertyName === 'transform') finish();
        };
        img.addEventListener('transitionend', onEnd);
        anim = { token, onEnd };
        scheduleFlipFinish(anim, finish);
        img.style.transition = FLIP_TRANSITION;
        img.style.transform = target;
    };

    const updateButton = () => {
        if (!button) return;
        button.setAttribute('aria-pressed', active ? 'true' : 'false');
        button.setAttribute('aria-label', active
            ? (button.dataset.exitLabel || '')
            : (button.dataset.enterLabel || ''));
    };

    const finishExit = () => {
        restoreGlows();
        lastTap = null;
        active = false;
        lightbox.classList.remove('is-zoomed');
        clearFlipInline([img]); // 内联清理与 FLIP 共用（flip.js）
        scale = 1;
        panX = 0;
        panY = 0;
        pointers.clear();
        pinch = null;
        if (pan) endPan();
        cancelApply();
        updateButton();
        // 退出缩放后由调用方统一重算抽屉布局（缩放期间 resize 重算已跳过）
        if (onExit) onExit();
    };

    function enterZoom({ animate = false, targetScale = DEFAULT_SCALE, anchor = null } = {}) {
        if (active || animating) return false;
        if (isBlocked && isBlocked()) return false;
        if (!lightbox.classList.contains('active')) return false;
        invalidateMetrics(); // 新一次缩放按当前布局重新测量
        layoutChanged = false;
        active = true;
        lightbox.classList.add('is-zoomed', 'is-zoom-panel-hidden');
        // 断点切换的入场动画 fill: both 会以动画值覆盖面板 opacity，使缩放
        // 淡出/淡入失效；缩放期间不需要该动画，直接摘类（抽屉的收尾定时器
        // 同样会摘，这里覆盖「切换后动画未完就缩放」的在途窗口）
        lightbox.classList.remove('is-layout-switching', 'is-layout-switching-inner');
        // 进入缩放前作废可能在途的滑动手势（swipe.reset 会清主图内联 transform；
        // 此刻尚未施加缩放，安全；避免已缩放时第二指捏合再触发全量 reset）
        if (cancelSwipe) cancelSwipe();
        lastTap = null;
        updateButton();
        collectGlows();
        // 面板/缩略图条/箭头被隐藏：焦点若在其中，移到仍可见的放大镜按钮
        const hiddenRoots = [
            lightbox.querySelector('.lightbox-panel'),
            lightbox.querySelector('.lightbox-strip'),
            lightbox.querySelector('.lightbox-arrows')
        ].filter(Boolean);
        if (button && hiddenRoots.some((root) => root.contains(document.activeElement))) {
            button.focus();
        }
        img.style.transformOrigin = '50% 50%';
        img.style.transition = 'none';
        // 锚点缩放：从 1× 无平移起算，使光标/双指中点下的图像内容保持不动
        //（与 zoomTo 同一公式，f = 目标倍率 / 1）；无锚点则居中（按钮路径）
        const anchorPan = (m, s) => {
            if (!anchor) {
                panX = 0;
                panY = 0;
                return;
            }
            panX = (anchor.x - m.viewCX) * (1 - s);
            panY = (anchor.y - m.viewCY) * (1 - s);
            clampPan(m);
        };
        if (animate && !reducedMotion) {
            // 从当前无 transform 的原始位置平滑过渡到 targetScale
            scale = 1;
            panX = 0;
            panY = 0;
            img.style.transform = '';
            void img.offsetWidth;
            const m = metrics();
            scale = targetScale;
            anchorPan(m, targetScale);
            animateGlowsToZoom(m);
            animateTo(transformString(m), () => {
                restoreGlowTransitions();
                // 进入动画期间视口/布局变化：收尾后用新 metrics 补一次居中（#31）
                if (layoutChanged && active) {
                    layoutChanged = false;
                    invalidateMetrics();
                    apply();
                }
            });
        } else {
            scale = animate ? targetScale : 1;
            anchorPan(metrics(), scale);
            apply();
            img.style.transition = '';
        }
        return true;
    }

    function exitZoom() {
        if (!active) return;
        // 进入/退出动画期间按 Esc：取消在途过渡直接走归位——原先 animating
        // 守卫会把 Esc 吞掉、需再按一次才还原（2026-11-10 审查 #32）
        cancelAnim();
        // 作废在途手势与已排队的平移帧，避免归位过渡被覆盖
        cancelApply();
        pointers.clear();
        pinch = null;
        lastTap = null;
        if (pan) endPan();
        // 面板/缩略图条/箭头立即开始淡入；is-zoomed 留到图片归位动画结束，
        // 期间仍允许图片越界绘制
        lightbox.classList.remove('is-zoom-panel-hidden');
        const m = metrics();
        if (reducedMotion) {
            finishExit();
            return;
        }
        // 目标为无 transform 的原始布局位；辉光层同步过渡回静止状态
        scale = 1;
        panX = m.baseCX - m.viewCX;
        panY = m.baseCY - m.viewCY;
        animateGlowsBack();
        animateTo(transformString(m), finishExit);
    }

    const toggle = () => {
        if (animating) return;
        if (active) exitZoom();
        else enterZoom({ animate: true, targetScale: DEFAULT_SCALE });
    };

    /* 关闭灯箱前：立即复位缩放与手势，但保留 is-zoom-panel-hidden——关闭
       淡出期间面板/缩略图条不闪回，由下次首开 reset 统一摘除 */
    const resetForClose = () => {
        if (!active) return; // 未缩放：不触碰切图滑动的内联 transform
        cancelAnim();
        cancelApply();
        restoreGlows();
        metricsCache = null;
        layoutChanged = false;
        active = false;
        animating = false;
        lightbox.classList.remove('is-zoomed', 'is-panning');
        clearFlipInline([img]);
        scale = 1;
        panX = 0;
        panY = 0;
        pointers.clear();
        pinch = null;
        lastTap = null;
        if (pan) endPan();
        updateButton();
    };

    const reset = () => {
        cancelAnim();
        cancelApply();
        restoreGlows();
        metricsCache = null;
        layoutChanged = false;
        active = false;
        animating = false;
        lightbox.classList.remove('is-zoomed', 'is-zoom-panel-hidden', 'is-panning');
        clearFlipInline([img]);
        scale = 1;
        panX = 0;
        panY = 0;
        pointers.clear();
        pinch = null;
        lastTap = null;
        if (pan) endPan();
        updateButton();
    };

    /* 以 (px, py) 为锚点缩放到 next：保持光标/双指中点下的图像内容不动 */
    const zoomTo = (next, px, py) => {
        next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, next));
        if (Math.abs(next - scale) < 0.0001) return;
        const m = metrics();
        const f = next / scale;
        panX = (px - m.viewCX) * (1 - f) + panX * f;
        panY = (py - m.viewCY) * (1 - f) + panY * f;
        scale = next;
        img.style.transition = '';
        scheduleApply(); // 滚轮 burst 合并到每帧一次写入
    };

    function endPan() {
        if (!pan) return;
        const id = pan.id;
        const started = pan.started;
        pan = null;
        lightbox.classList.remove('is-panning');
        if (started) {
            try { area.releasePointerCapture(id); } catch (e) { /* 指针已释放 */ }
            // 平移收尾才设 click 抑制窗口：长拖动期间不失效
            suppressClickUntil = performance.now() + 400;
        }
    }

    /* ===== 滚轮（图片区缩放；未缩放时下滚仍交给抽屉/页面） ===== */
    const onWheel = (e) => {
        if (!lightbox.classList.contains('active')) return;
        if (isBlocked && isBlocked()) return;
        if (e.target.closest && e.target.closest('.lightbox-strip')) return;
        const inImage = area.contains(e.target) || e.target === img;
        const unit = e.deltaMode === 1 ? 16 : (e.deltaMode === 2 ? 100 : 1);
        const factor = Math.exp(-e.deltaY * unit * 0.0015);
        if (!active) {
            if (!inImage || e.deltaY >= 0) return;
            // 窄屏：抽屉未完全收起时滚轮只驱动抽屉（不 preventDefault，
            // 让事件继续冒泡到 lightbox-drawer 的 wheel 监听）
            if (canStartWheelZoom && !canStartWheelZoom()) return;
            const targetScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, factor));
            if (targetScale <= 1.001) return; // 惯性尾的极小首格：不视为缩放意图
            e.preventDefault();
            // 首次进入与按钮同一过渡路径：从原始位置平滑放大到光标锚点目标，
            // 不再先瞬移到整屏中心再缩放（桌面会横向跳半个面板宽）——过渡期间
            // 的后续滚轮由下方 animating 守卫跳过，结束后恢复连续缩放（#30）
            enterZoom({ animate: true, targetScale, anchor: { x: e.clientX, y: e.clientY } });
            return;
        }
        e.preventDefault();
        if (animating) return;
        zoomTo(scale * factor, e.clientX, e.clientY);
        if (scale <= 1.001) exitZoom();
    };
    content.addEventListener('wheel', onWheel, { passive: false });

    /* ===== 触屏双指捏合 / 鼠标与单指拖动平移 ===== */
    const onPointerDown = (e) => {
        lastPointerType = e.pointerType; // 触摸合成的 click 不重复触发缩放
        if (!lightbox.classList.contains('active')) return;
        if (isBlocked && isBlocked()) return;
        if (animating) return;
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        const inImage = area.contains(e.target) || e.target === img;
        if (!active && !inImage) return;
        if (active && e.target.closest && e.target.closest('button, a')) return;
        pointers.set(e.pointerId, {
            x: e.clientX, y: e.clientY,
            downX: e.clientX, downY: e.clientY,
            type: e.pointerType,
            onImage: e.target === img
        });

        if (pointers.size === 2) {
            const entries = [...pointers.entries()];
            const touchOnly = entries.every(([, p]) => p.type === 'touch');
            if (!touchOnly) return;
            if (animating) return;
            // 双指接管：作废单指滑动切图与抽屉拖拽（首指可能已开始）。
            // 已缩放时 swipe 被 isBlocked 拦住、不可能有在途手势；不能再调
            // 全量 reset（会清掉当前缩放 transform、图片跳回 fit）
            if (!active && cancelSwipe) cancelSwipe();
            if (cancelDrawerDrag) cancelDrawerDrag();
            lastTap = null;
            pinchGuardUntil = performance.now() + 400;
            if (pan) endPan();
            const [id1, p1] = entries[0];
            const [id2, p2] = entries[1];
            pinch = {
                ids: [id1, id2],
                startDist: Math.hypot(p1.x - p2.x, p1.y - p2.y) || 1,
                startScale: active ? scale : 1,
                startPanX: active ? panX : 0,
                startPanY: active ? panY : 0,
                startMidX: (p1.x + p2.x) / 2,
                startMidY: (p1.y + p2.y) / 2
            };
            img.style.transition = '';
            return;
        }

        if (pointers.size === 1 && active && scale > 1.001) {
            // 候选平移：拖动超过阈值才接管——单击/双击/轻触需保留，不能被
            // pointerdown 的捕获与 preventDefault 吞掉（2026-11-09）
            pan = { id: e.pointerId, startX: e.clientX, startY: e.clientY, panX, panY, started: false };
        }
    };
    content.addEventListener('pointerdown', onPointerDown);

    const onPointerMove = (e) => {
        const p = pointers.get(e.pointerId);
        if (!p) return;
        p.x = e.clientX;
        p.y = e.clientY;

        if (pinch && pinch.ids.includes(e.pointerId)) {
            const a = pointers.get(pinch.ids[0]);
            const b = pointers.get(pinch.ids[1]);
            if (!a || !b) return;
            const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
            const nextScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, pinch.startScale * (dist / pinch.startDist)));
            const midX = (a.x + b.x) / 2;
            const midY = (a.y + b.y) / 2;
            if (!active) {
                if (nextScale <= 1.001) return;
                if (!enterZoom({ animate: false })) return;
                // 以进入缩放后的居中态为新基准（进入前的位移不参与）
                pinch.startDist = dist;
                pinch.startScale = 1;
                pinch.startPanX = 0;
                pinch.startPanY = 0;
                pinch.startMidX = midX;
                pinch.startMidY = midY;
                return;
            }
            const m = metrics();
            const f = nextScale / pinch.startScale;
            panX = (midX - m.viewCX) - (pinch.startMidX - m.viewCX - pinch.startPanX) * f;
            panY = (midY - m.viewCY) - (pinch.startMidY - m.viewCY - pinch.startPanY) * f;
            scale = nextScale;
            img.style.transition = '';
            scheduleApply(); // 捏合事件合并到每帧一次（metrics 已缓存）
            e.preventDefault();
            return;
        }

        if (pan && pan.id === e.pointerId) {
            const dx = e.clientX - pan.startX;
            const dy = e.clientY - pan.startY;
            if (!pan.started) {
                if (Math.hypot(dx, dy) <= PAN_START_PX) return;
                pan.started = true;
                lastTap = null;
                lightbox.classList.add('is-panning');
                try { area.setPointerCapture(e.pointerId); } catch (err) { /* 忽略 */ }
            }
            panX = pan.panX + dx;
            panY = pan.panY + dy;
            img.style.transition = 'none';
            scheduleApply();
            e.preventDefault();
        }
    };
    window.addEventListener('pointermove', onPointerMove);

    const onPointerUp = (e) => {
        const p = pointers.get(e.pointerId);
        const wasPinch = !!(pinch && pinch.ids.includes(e.pointerId));
        pointers.delete(e.pointerId);
        if (pan && pan.id === e.pointerId) endPan();
        if (wasPinch) {
            pinch = null;
            // 捏合结束（先抬起一指）后短暂屏蔽双击：剩余手指随后的轻触
            // 可能位移不超阈值、被当作第一击种下 lastTap，与无关轻触凑成
            // 非预期双击（2026-11-10 审查 #33）
            pinchGuardUntil = performance.now() + 400;
            if (active && scale <= 1.001) exitZoom();
        }

        // pointercancel（系统手势/捕获丢失）不是轻触收尾：清掉此前种下的
        // 第一击，也不参与新的双击配对（2026-11-10 审查 #33）
        if (e.type !== 'pointerup') {
            lastTap = null;
            return;
        }

        // 触屏双击（只认落在主图上的轻触；拖动/捏合/滑动不参与）
        if (e.pointerType === 'touch' && p && p.onImage && !wasPinch
            && performance.now() >= pinchGuardUntil) {
            const moved = Math.hypot(p.x - p.downX, p.y - p.downY);
            if (moved <= TAP_MOVE_PX) {
                const now = performance.now();
                if (lastTap && now - lastTap.t <= DOUBLE_TAP_MS
                    && Math.hypot(p.x - lastTap.x, p.y - lastTap.y) <= DOUBLE_TAP_DIST) {
                    lastTap = null;
                    if (!isBlocked || !isBlocked()) toggle();
                } else {
                    lastTap = { t: now, x: p.x, y: p.y };
                }
            } else {
                lastTap = null;
            }
        }
    };
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);

    if (button) {
        button.addEventListener('click', (e) => {
            e.stopPropagation();
            toggle();
        });
    }

    // 桌面单击主图切换缩放；触屏合成 click 忽略（双击在 pointerup 判定），
    // 拖动平移后的 click 按抑制窗口忽略
    img.addEventListener('click', () => {
        if (lastPointerType === 'touch') return;
        if (performance.now() < suppressClickUntil) return;
        if (!lightbox.classList.contains('active')) return;
        if (isBlocked && isBlocked()) return;
        toggle();
    });

    /* 视口/全屏布局变化：图片布局框与内容区中心可能变化，重新测量并钳制 */
    if (typeof ResizeObserver !== 'undefined') {
        const ro = new ResizeObserver(() => {
            invalidateMetrics();
            if (!active || animating) return;
            scheduleApply();
        });
        ro.observe(lightbox);
        ro.observe(area);
        ro.observe(img);
    }

    updateButton();

    return {
        exit: exitZoom,
        reset,
        resetForClose,
        isActive: () => active
    };
}
