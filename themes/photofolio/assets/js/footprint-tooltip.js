/**
 * 足迹地图弹层（独立模块；集成见 footprint-map.js）
 *
 * - 悬停/键盘聚焦显示地名/张数/年份简讯；锚点为指针坐标（凹形区块如內蒙古的
 *   包围盒中心会落在区块之外、弹层漂移）——悬停传 e.clientX/Y，键盘聚焦无
 *   指针坐标时回退区块包围盒中心；在视口坐标系做 clamp 与上下翻转，最后
 *   换算回容器相对坐标（弹层定位包含块是 #footprint-map，不是视口）
 * - 已显示时换区块：交叉淡入淡出——旧弹层克隆为幽灵元素在旧位置原地淡出，
 *   新弹层同时在新位置从 0 淡入，两段动画并行、无「先消失再出现」的真空期
 * - 隐藏须等淡出过渡结束再 display:none（同帧设置会让过渡无从播放、瞬间消失；
 *   但 display:none 不能省——visibility:hidden 的绝对定位元素在 Chrome 中
 *   仍计入 scrollable overflow，缩小窗口时残留位置会撑出横向滚动）
 * - 按事件指针类型判定悬停：触屏（pointerType='touch'）不显示弹层——
 *   点按区块直接跳转详情页；鼠标与触控笔悬停显示。设备级 hover 能力查询
 *   （(hover: hover)）在 iPad 桌面级浏览/外接键鼠配置下会匹配为真，
 *   手指触碰的 pointerenter 被放行、点按跳转前的空窗内弹层闪现——不可用
 */
import { prefersReducedMotion } from './utils.js';

// 淡出时长与 .fm-tooltip 的 transition（--transition = 0.3s）一致
const TOOLTIP_FADE_MS = 300;

export function initFootprintTooltip({ root, tooltip, countFormat, yearFormat }) {
    const mapRect = () => root.getBoundingClientRect();

    // 弹层内容与定位渲染（先恢复显示并测量——读取 offset 强制初始态样式生效，
    // 随后加 fm-visible 才有淡入过渡）。
    const render = (el, anchorX, anchorY) => {
        const { name, count, minYear, maxYear } = el.dataset;
        const years = minYear === maxYear ? String(minYear) : yearFormat.replace('%MIN%', minYear).replace('%MAX%', maxYear);
        tooltip.innerHTML = '';
        const nameEl = document.createElement('strong');
        nameEl.textContent = name;
        const countEl = document.createElement('span');
        countEl.textContent = countFormat.replace('%COUNT%', count);
        const yearEl = document.createElement('span');
        yearEl.textContent = years;
        tooltip.append(nameEl, countEl, yearEl);
        tooltip.dataset.slug = el.dataset.slug || '';

        // 淡出途中的重新显示：作废在途的隐藏计时，从当前透明度平滑淡回
        if (tooltip.hideTimer) {
            clearTimeout(tooltip.hideTimer);
            tooltip.hideTimer = null;
        }
        tooltip.style.display = '';
        tooltip.style.left = '0px';
        tooltip.style.top = '0px';
        const w = tooltip.offsetWidth;
        const h = tooltip.offsetHeight;

        const rect = mapRect();
        let x = anchorX;
        let y = anchorY;
        if (x == null || y == null) {
            const dotRect = el.getBoundingClientRect();
            x = dotRect.left + dotRect.width / 2;
            y = dotRect.top + dotRect.height / 2;
        }
        const leftVp = Math.min(Math.max(x - w / 2, rect.left + 12), rect.left + rect.width - w - 12);
        // 指针上方留 16px 间距；上方空间不足（弹层高 + 间距）则翻转到指针下方
        let topVp = y - 16 - h;
        if (topVp < rect.top + 8) topVp = y + 16;
        tooltip.style.left = (leftVp - rect.left) + 'px';
        tooltip.style.top = (topVp - rect.top) + 'px';
        tooltip.classList.add('fm-visible');
    };

    // 已显示时换区块：幽灵垫在主弹层之下（后插入者在上）——两框重叠时
    // 新内容直接叠在旧内容上淡入
    const swap = (el, anchorX, anchorY) => {
        const ghost = tooltip.cloneNode(true);
        ghost.removeAttribute('role'); // 状态播报只保留主弹层
        root.insertBefore(ghost, tooltip);
        // 先入 DOM、强制提交带类样式（opacity 1），再摘类触发淡出——
        // 顺序颠倒时幽灵的首次计算样式就是 0，过渡无从播放、旧弹层瞬间消失
        void ghost.offsetWidth;
        ghost.classList.remove('fm-visible');
        setTimeout(() => ghost.remove(), prefersReducedMotion() ? 0 : TOOLTIP_FADE_MS);

        // 主弹层同步瞬移到隐藏态：关过渡 + 内联 opacity 0，强制提交 0 基准，
        // 再恢复样式表过渡并交还类控制——render 加回 fm-visible 后必然从已提交的
        // 0 起淡入（不依赖 display:none 抑制过渡的行为，WebKit 下同样可靠）
        tooltip.style.transition = 'none';
        tooltip.classList.remove('fm-visible');
        tooltip.style.opacity = '0';
        void tooltip.offsetWidth;
        tooltip.style.transition = '';
        tooltip.style.opacity = '';
        render(el, anchorX, anchorY);
    };

    const show = (el, anchorX, anchorY) => {
        // 同一区块重复触发：无需动作（避免无意义的淡出淡入闪烁）
        if (tooltip.classList.contains('fm-visible') && tooltip.dataset.slug === (el.dataset.slug || '')) return;
        if (tooltip.classList.contains('fm-visible')) {
            swap(el, anchorX, anchorY);
            return;
        }
        render(el, anchorX, anchorY);
    };

    const hide = () => {
        tooltip.classList.remove('fm-visible');
        if (tooltip.hideTimer) clearTimeout(tooltip.hideTimer);
        tooltip.hideTimer = setTimeout(() => {
            tooltip.hideTimer = null;
            // 淡出期间被重新显示（再次悬停/点按）时放弃本次隐藏
            if (!tooltip.classList.contains('fm-visible')) {
                tooltip.style.display = 'none';
            }
        }, prefersReducedMotion() ? 0 : TOOLTIP_FADE_MS);
    };

    const onPointerEnter = (e) => {
        if (e.pointerType === 'touch') return; // 触屏无悬停：点按直接跳转详情页（鼠标/触控笔悬停照常）
        const link = e.target.closest('.fm-region');
        if (link && link.dataset.slug) show(link, e.clientX, e.clientY);
    };
    const onPointerLeave = (e) => {
        if (e.target.closest('.fm-region')) hide();
    };
    const onFocusIn = (e) => {
        const link = e.target.closest('.fm-region');
        if (link && link.dataset.slug) show(link);
    };
    const onFocusOut = (e) => {
        // 焦点在区块之间移动时不闪烁（focusin 会立即重新显示）
        if (e.relatedTarget && e.relatedTarget.closest && e.relatedTarget.closest('.fm-region')) return;
        if (e.target.closest('.fm-region')) hide();
    };
    root.addEventListener('pointerenter', onPointerEnter, true);
    root.addEventListener('pointerleave', onPointerLeave, true);
    root.addEventListener('focusin', onFocusIn);
    root.addEventListener('focusout', onFocusOut);

    // 移除函数：重建时会重新绑定弹层监听，旧监听必须移除（否则随重建次数累积，
    // 每次悬停都会在已脱离文档的旧弹层上重复执行布局读取）
    const cleanup = () => {
        root.removeEventListener('pointerenter', onPointerEnter, true);
        root.removeEventListener('pointerleave', onPointerLeave, true);
        root.removeEventListener('focusin', onFocusIn);
        root.removeEventListener('focusout', onFocusOut);
    };

    return { cleanup, hide };
}
