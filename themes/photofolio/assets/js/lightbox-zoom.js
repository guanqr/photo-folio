/**
 * 灯箱缩放浮现（独立模块；集成见 lightbox-switch.js）
 *
 * - 首开动画：主图从点击缩略图的视口矩形（同框、同位置）FLIP 放大过渡到
 *   居中布局位——与全站 FLIP 同款（FLIP_TRANSITION 曲线/时长）；
 *   目标矩形由照片宽高比对图片区（扣除 padding）做 contain 拟合得出，
 *   不依赖大图解码时机；起点精确覆盖缩略图（sx/sy 独立映射盒矩形，
 *   缩略图与全尺寸的宽高比舍入差被吸收、无扭曲）
 * - 目标矩形与布局盒锁按展示图自然尺寸（调用方经 maxW/maxH 传入）封顶：
 *   超宽屏 contain 拟合大于自然尺寸时不再放大过头，换源后自然尺寸接管
 *   盒不缩回（拟合盒先 clamp 再 contain，普通屏拟合小于自然尺寸、不生效）
 * - 纯动画职责：start 驱动 transform 过渡、transitionend 收尾（清理
 *   transform-origin 与内联残留）后回调 onDone；cancel 作废在途动画
 *   （关闭/重开/切图前调用，防陈旧收尾回调重放）
 */
import { FLIP_TRANSITION } from './utils.js';

export function initLightboxZoom({ img, area, reducedMotion }) {
    let pendingDone = null; // 在途 transitionend 监听（start 前作废旧动画）

    const cancel = () => {
        if (pendingDone) {
            img.removeEventListener('transitionend', pendingDone);
            pendingDone = null;
        }
        img.style.transition = '';
        img.style.transform = '';
        img.style.transformOrigin = '';
        img.style.width = '';
        img.style.height = '';
        if (area) {
            area.style.transition = ''; // 恢复图片区过渡（缩放期间冻结，见 start）
            area.style.overflow = '';   // 恢复裁剪（缩放期间放开，见 start）
        }
    };

    // startRect：点击缩略图的视口矩形（其宽高比即照片宽高比）；
    // maxW/maxH：展示图自然尺寸上限（调用方传入，0 表示不封顶）
    const start = (startRect, onDone, maxW, maxH) => {
        cancel();
        if (reducedMotion || !area) {
            onDone();
            return;
        }
        // 目标矩形：图片区内容盒（扣除 padding）内按照片宽高比 contain 拟合——
        // 与 object-fit: contain 的主图渲染矩形一致；居中取内容盒中心
        // （place-items:center 居中在 padding 之内——用完整区宽居中会在桌面
        // 非对称内边距 5.5em/2em 下把起点偏移 1.75em、与缩略图错位）
        // 动画期间冻结图片区过渡：打开时抽屉残留 is-open 的收起会把
        // padding-top 2.5em→1em 过渡（0.4s）叠在缩放（0.35s）上——内容盒
        // 高度中途变化、高受限照片 laid-out 盒随之变大 = 缩放途中尺寸跳变；
        // 冻结后 padding 变化首帧前直切（起点/终点同一布局），不产生中途漂移。
        // 冻结必须先于测量：getComputedStyle 会读到过渡中的中间 padding 值、
        // 目标矩形按错误口径计算、起点与缩略图错位
        area.style.transition = 'none';
        const areaRect = area.getBoundingClientRect();
        const cs = getComputedStyle(area);
        const pl = parseFloat(cs.paddingLeft);
        const pr = parseFloat(cs.paddingRight);
        const pt = parseFloat(cs.paddingTop);
        const pb = parseFloat(cs.paddingBottom);
        const boxW = areaRect.width - pl - pr;
        const boxH = areaRect.height - pt - pb;
        // 目标宽高比优先取自然尺寸比例（maxW/maxH，即照片真实宽高比）：网格
        // 单元矩形有取整差（如 1.4964 vs 1.5），以其算目标会在封顶边上残留
        // 亚像素偏差——用真实比例则目标恒等于换源后 CSS contain 的结果（零跳变）；
        // 无自然尺寸（旧数据未回填）时退回缩略图矩形比例
        const aspect = maxW > 0 && maxH > 0
            ? maxW / maxH
            : startRect.width / startRect.height;
        // 自然尺寸封顶：拟合盒先 clamp 到展示图自然尺寸（0 不封顶）再 contain
        // 拟合——与换源后 CSS 的 max-width/max-height contain 口径一致，仅
        // 超宽屏生效（普通屏 contain 拟合小于自然尺寸、clamp 不动）；
        // 最大显示到自然尺寸、不再放大，换源后盒零跳变
        const fitW = maxW > 0 ? Math.min(boxW, maxW) : boxW;
        const fitH = maxH > 0 ? Math.min(boxH, maxH) : boxH;
        let tw = fitW;
        let th = tw / aspect;
        if (th > fitH) {
            th = fitH;
            tw = th * aspect;
        }
        const targetLeft = areaRect.left + pl + (boxW - tw) / 2;
        const targetTop = areaRect.top + pt + (boxH - th) / 2;
        const dx = startRect.left - targetLeft;
        const dy = startRect.top - targetTop;
        const sx = startRect.width / tw;
        const sy = startRect.height / th;

        // 动画期间放开裁剪：overflow:hidden 为水平滑动切图而设——右侧缩略图
        // 放大的途中图片伸入面板区域会被裁掉（观感如被信息栏遮挡）；
        // 面板透明、文字此刻均隐藏，图片越过面板区域无遮挡冲突，
        // 动画结束恢复裁剪（辉光淡入前复原，blur 溢出不闪变）
        area.style.overflow = 'visible';

        // 布局盒显式锁定为目标矩形：主图 src 为缩略图时其自然尺寸（800×534）
        // 封顶 width/height auto 的替换元素——大屏上盒停在缩略图自然尺寸、
        // 换源全尺寸时才瞬间铺满（尺寸跳变根因）；显式尺寸覆盖自然尺寸，
        // 缩放与换源窗口的盒恒等于 contain 拟合目标，全尺寸就绪后由调用方摘除
        img.style.transformOrigin = '0 0';
        img.style.width = tw + 'px';
        img.style.height = th + 'px';
        img.style.transition = 'none';
        img.style.transform = `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`;
        void img.offsetWidth; // 强制提交起点（FLIP First）
        img.style.transition = FLIP_TRANSITION;
        img.style.transform = '';
        img.addEventListener('transitionend', pendingDone = function done(e) {
            if (e.propertyName !== 'transform') return;
            img.removeEventListener('transitionend', done);
            pendingDone = null;
            img.style.transition = '';
            img.style.transformOrigin = '';
            // width/height 锁保留：换源期间盒仍为 contain 拟合目标（见 start 注释），
            // 全尺寸元数据就绪后由调用方摘除
            area.style.transition = ''; // 恢复图片区过渡（抽屉展开的 padding 动画照常）
            area.style.overflow = '';   // 恢复裁剪（辉光淡入前复原，见 start 注释）
            onDone();
        });
    };

    return { start, cancel };
}
