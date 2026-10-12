/**
 * 灯箱触屏滑动切图（独立模块；集成见 lightbox.js）
 *
 * - 图片区水平滑动切换照片：跟随手指拖动，位移超过 100px 提交切图
 *   （右滑上一张、左滑下一张），未达阈值回弹归位；
 *   提交后直接交棒 open() 的 slideStyle 管线——与左右箭头同款动画
 *   （12% 滑出 + 淡出 + 毛玻璃背景渐变，当前拖动位置平滑过渡到目标）；
 *   垂直滑动仍归窄屏抽屉展开/收起（水平接管前不拦截）
 * - 方向仲裁经 getVerdict 挂点驱动抽屉（见 lightbox-drawer.js dirVerdict）：
 *   未决期抽屉冻结、垂直交还、水平接管结束拖拽——抽屉在水平接管前
 *   从未移动，无回滚抖动、无左右/上下同时响应
 * - 滑动跟随与滑入动画共用主图 transform：提交后由 open() 的 slideStyle
 *   管线接管（内联过渡被覆盖），互不冲突
 */
import { prefersReducedMotion } from './utils.js';

export function initLightboxSwipe({ img, area, getGlow, onSwitch }) {
    if (!area) return { isGestureActive: () => false, getVerdict: () => null, reset: () => {} };

    const SWIPE_TAKE_OVER = 20; // 滑动接管阈值 px（|dx| 且 |dx| > |dy|）——阈值过小
                               // 会在斜向手势（上下滑动带横向抖动）时误接管、与抽屉同时响应
    const SWIPE_ABANDON = 8;   // 垂直交还阈值 px（|dy| 且 |dy| > |dx|）——小阈值让
                               // 抽屉几乎立即接管纯垂直拖拽，未决期冻结无感
    const SWIPE_COMMIT = 100;  // 切图提交阈值 px

    let gesture = null; // { id, startX, startY, dx }
    // 方向仲裁结果（抽屉挂点，见 lightbox-drawer.js dirVerdict）：
    // null 未决（抽屉暂不响应）| 'horizontal' 已接管（抽屉结束拖拽）| 'vertical' 交还抽屉
    let verdict = null;
    const getVerdict = () => verdict;

    // 抽屉挂点：水平接管后为真
    const isGestureActive = () => verdict === 'horizontal';

    const applyFollow = (dx) => {
        img.style.transform = `translateX(${dx}px)`;
        const glow = getGlow();
        if (glow) glow.style.transform = `translateX(${dx}px) scale(2)`;
    };

    const snapBack = () => {
        // 未达阈值：回弹归位（reduced-motion 直切）
        const reduced = prefersReducedMotion();
        const tr = reduced ? 'none' : 'transform 0.2s ease';
        img.style.transition = tr;
        const glow = getGlow();
        if (glow) glow.style.transition = tr;
        img.style.transform = '';
        if (glow) glow.style.transform = 'scale(2)';
        const cleanup = () => {
            img.style.transition = '';
            if (glow) glow.style.transition = '';
            img.removeEventListener('transitionend', cleanup);
        };
        if (reduced) cleanup();
        else img.addEventListener('transitionend', cleanup);
    };

    area.addEventListener('pointerdown', (e) => {
        if (e.pointerType !== 'touch' || gesture) return; // 单指触屏；已有候选时忽略后续手指
        verdict = null; // 新手势：方向重新仲裁
        gesture = {
            id: e.pointerId,
            startX: e.clientX,
            startY: e.clientY,
            dx: 0
        };
    }, true);

    // move/up 统一挂 window 捕获监听：候选期抽屉可能把指针捕获到 lightbox
    // （其后事件不再经过 area），window 为共同祖先、必然收到
    const onWinMove = (e) => {
        if (!gesture || e.pointerId !== gesture.id) return;
        if (verdict === 'horizontal') {
            gesture.dx = e.clientX - gesture.startX;
            applyFollow(gesture.dx);
            return;
        }
        const dx = e.clientX - gesture.startX;
        const dy = e.clientY - gesture.startY;
        if (Math.abs(dx) > SWIPE_TAKE_OVER && Math.abs(dx) > Math.abs(dy)) {
            // 水平接管：跟随手指；后设的指针捕获覆盖抽屉对 lightbox 的捕获
            gesture.dx = dx;
            verdict = 'horizontal';
            area.setPointerCapture(e.pointerId);
            img.style.transition = 'none';
            applyFollow(dx);
        } else if (Math.abs(dy) > SWIPE_ABANDON && Math.abs(dy) > Math.abs(dx)) {
            gesture = null; // 垂直意图：交还抽屉（抽屉随即照常跟随）
            verdict = 'vertical';
        }
    };

    const onWinUp = (e) => {
        if (!gesture || e.pointerId !== gesture.id) return;
        const dx = gesture.dx;
        const takenOver = verdict === 'horizontal';
        gesture = null;
        verdict = null; // 手势结束：方向仲裁复位
        if (!takenOver) return;
        if (Math.abs(dx) >= SWIPE_COMMIT) {
            // 右滑 = 上一张（新图从左进入）；滑出动画与左右箭头同款，
            // 由 open() 的 slideStyle 从当前拖动位置过渡到 12% 目标——
            // 拖动位移随 dx 传出（slideStyle 的显式过渡起点，双相提交）
            onSwitch(dx > 0 ? -1 : 1, dx);
        } else {
            snapBack();
        }
    };

    window.addEventListener('pointermove', onWinMove, true);
    window.addEventListener('pointerup', onWinUp, true);
    window.addEventListener('pointercancel', onWinUp, true);

    // 灯箱关闭/打开前复位：作废在途手势与内联 transform/transition 残留——
    // 拖动中关闭（如 Escape）会把图片停在中断的位移上，首开路径不重置
    // transform，下次打开图片错位
    const reset = () => {
        gesture = null;
        verdict = null;
        img.style.transition = '';
        img.style.transform = '';
        const glow = getGlow();
        if (glow) {
            glow.style.transition = '';
            glow.style.transform = 'scale(2)';
        }
    };

    // snapBack 导出供 lightbox.js 复用：单照片集合下滑动提交无可切换目标，
    // open() 不执行——走回弹动画归位（原地 reset 会瞬间跳回）
    return { isGestureActive, getVerdict, reset, snapBack };
}
