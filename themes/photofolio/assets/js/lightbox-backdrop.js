/**
 * 灯箱毛玻璃背景层栈（独立模块；集成见 lightbox.js，机制对齐参考站灯箱）
 *
 * - 每张作品一层 <img>（thumb 源 + blur 压暗）；首开一层淡入（随灯箱容器
 *   0.3s 一同淡入），切图旧层**立即**淡出 0.7s（不等新层就绪——加载慢时
 *   背景短暂为纯黑底）、新层就绪后淡入 0.7s；新层淡入后约 750ms 移除旧层
 *   （时长 + 50ms 余量）
 * - 层按 DOM 顺序叠放（新层在后、天然压在上层），回调只操作本层元素——
 *   无跨层状态可翻转，快速连切/关闭重开不会串层
 * - 层栈（数组/剪枝定时/全清）与辉光层共用 createLayerStack 工具
 */
import { isImageReady, createLayerStack } from './utils.js';

export function initLightboxBackdrop({ container, insertBefore, reducedMotion }) {
    const BACKDROP_MS = reducedMotion ? 0 : 700;
    const backdropTransition = reducedMotion
        ? 'opacity 0s'
        : `opacity ${BACKDROP_MS}ms cubic-bezier(0.4, 0, 0.2, 1)`;
    const backdropStack = createLayerStack(BACKDROP_MS + 50);
    const backdropLayers = backdropStack.layers;

    const createBackdropEl = () => {
        const el = document.createElement('img');
        el.className = 'lightbox-backdrop';
        el.alt = '';
        el.setAttribute('aria-hidden', 'true');
        el.setAttribute('draggable', 'false');
        return el;
    };
    const appendBackdropEl = (el) => {
        container.insertBefore(el, insertBefore || null);
    };

    // 首开：清空上一轮残留，新建一层淡入当前作品。
    // 首开无上一层可回退：缩略图失败时该层保持透明（背景纯黑），属可接受降级
    function open(src) {
        backdropStack.clear();
        const el = createBackdropEl();
        appendBackdropEl(el);
        el.src = src;
        el.offsetHeight; // 强制 reflow：让 opacity 走 CSS 过渡淡入
        el.style.opacity = '1';
        el._shown = true;
        backdropLayers.push(el);
    }

    // 切图：旧层立即淡出 0.7s、新层就绪后淡入 0.7s——淡出与图片切换同刻开始，
    // 背景变化贯穿整个切换过程；新层加载失败时丢弃该层并让上一层淡回显示。
    // 层模型为裸元素数组（最新层即数组末位），唯一状态标志是元素的 _shown
    // （是否已完成过淡入）——show 守卫 = 「仍是最新层且未显示过」，被更新的
    // 切换取代或已被剪枝的层自然失效
    function switchTo(src) {
        backdropStack.cancelPrune();
        backdropLayers.forEach((layerEl) => {
            layerEl.style.transition = backdropTransition;
            layerEl.style.opacity = '0';
        });
        const el = createBackdropEl();
        el.style.transition = backdropTransition;
        el.style.opacity = '0';
        el.src = src;
        appendBackdropEl(el);
        backdropLayers.push(el);
        const show = () => {
            // 守卫：已被更新的切换取代（不再是末位）或已显示过（首开/同步
            // complete 路径）则不再执行——被剪枝的层同样不在数组中
            if (el._shown || backdropLayers[backdropLayers.length - 1] !== el) return;
            el._shown = true;
            // 强制 reflow 让 opacity 0 先生效：缓存图 complete 同步为真时（同一帧内
            // 0→1 变化不触发过渡）同样走 0.7s 淡入
            el.offsetHeight;
            el.style.opacity = '1';
            backdropStack.schedulePrune();
        };
        if (isImageReady(el)) {
            show();
        } else {
            el.addEventListener('load', show, { once: true });
            el.addEventListener('error', () => {
                const idx = backdropLayers.indexOf(el);
                if (idx < 0) return;
                backdropLayers.splice(idx, 1);
                el.remove();
                if (idx === backdropLayers.length) {
                    // 失败的是最新层：上一层淡回显示。若上一层已显示过直接淡回并
                    // 补设剪枝定时；若其仍在加载（_shown 未置），它的 show 监听
                    // 仍挂在元素上——此时它已成为最新层、守卫放行，解码完成后
                    // 自然走 show 的淡入与剪枝，无需在这里重复触发
                    const prev = backdropLayers[backdropLayers.length - 1];
                    if (prev && prev._shown) {
                        prev.style.transition = backdropTransition;
                        prev.style.opacity = '1';
                        backdropStack.schedulePrune();
                    }
                }
            }, { once: true });
        }
    }

    return {
        open,
        switchTo,
        clear: () => backdropStack.clear()
    };
}
