/**
 * 灯箱毛玻璃背景层栈（独立模块；集成见 lightbox.js，机制对齐参考站灯箱）
 *
 * - 每张作品一层 <img>（thumb 源 + blur 压暗）；首开一层淡入（随灯箱容器
 *   0.3s 一同淡入）。切图由调用方按主图就绪状态分两段驱动：主图未就绪先
 *   fadeOut 把旧层淡化到黑（不建新层），主图就绪后 switchTo 创建新层、
 *   旧层淡出 0.7s、新层就绪后淡入 0.7s；新层淡入后约 750ms 移除旧层
 *   （时长 + 50ms 余量）——背景不会先于主图显示下一张（2026-11-09）
 * - 层按 DOM 顺序叠放（新层在后、天然压在上层），回调只操作本层元素——
 *   无跨层状态可翻转，快速连切/关闭重开不会串层
 * - 层栈（数组/剪枝定时/全清）与辉光层共用 createLayerStack 工具
 */
import { isImageReady, createLayerStack } from './utils.js';

export function initLightboxBackdrop({ container, insertBefore, reducedMotion }) {
    const BACKDROP_MS = reducedMotion ? 0 : 700;
    const backdropTransition = reducedMotion
        ? 'opacity 0s'
        : `opacity ${BACKDROP_MS}ms var(--ease-standard)`;
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

    // 切图（主图就绪后由调用方触发）：旧层淡出 0.7s、新层就绪后淡入 0.7s——
    // 未就绪期间调用方已先 fadeOut 到黑，此处从黑淡入新层；
    // 新层加载失败时丢弃该层并让上一层淡回显示。
    // 层模型为裸元素数组（最新层即数组末位），唯一状态标志是元素的 _shown
    // （是否已完成过淡入）——show 守卫 = 「仍是最新层且未显示过」，被更新的
    // 切换取代或已被剪枝的层自然失效
    // 主图未就绪：只把现有层淡化到黑，不创建/加载新层——新层等主图就绪后
    // 由 switchTo 创建（背景与主图异步，避免背景先于主图显示下一张）。
    // 不提前剪枝：保留最后一层供新层加载失败时回退
    function fadeOut() {
        backdropStack.cancelPrune();
        backdropLayers.forEach((layerEl) => {
            // 作废仍在加载的层的 show：否则主图未就绪期间旧的 load 完成后
            // 会把上一张背景从黑场重新淡回（2026-11-10 审查 #21）
            layerEl._stale = true;
            layerEl.style.transition = backdropTransition;
            layerEl.style.opacity = '0';
        });
    }

    function switchTo(src) {
        fadeOut();
        const el = createBackdropEl();
        el.style.transition = backdropTransition;
        el.style.opacity = '0';
        el.src = src;
        appendBackdropEl(el);
        backdropLayers.push(el);
        backdropStack.cap(3); // 保留当前 + 两张淡出层；快速连切不随次数累积
        const show = () => {
            // 守卫：已被更新的切换取代（不再是末位）、已被 fadeOut 作废、或已
            // 显示过（首开/同步 complete 路径）则不再执行——被剪枝的层同样不在数组中
            if (el._stale || el._shown || backdropLayers[backdropLayers.length - 1] !== el) return;
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
            const fail = () => {
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
            };
            el.addEventListener('load', show, { once: true });
            el.addEventListener('error', function onError() {
                // AVIF 兜底重试在途（avif-fallback 捕获阶段已换 webp、新加载已开始）：
                // 本次 error 属旧 AVIF 请求、不删层（删层会让在途的 webp 落空、
                // 背景错误回退旧图）——重挂监听等待重试结果：成功由 load 走 show
                // 淡入，再失败由重挂的监听走恢复路径（2026-10-18：此前 return
                // 消费掉 once 监听、webp 再失败时死层永驻背景纯黑）
                if (el.dataset.avifRetry) {
                    delete el.dataset.avifRetry;
                    el.addEventListener('error', onError, { once: true });
                    return;
                }
                fail();
            }, { once: true });
        }
    }

    return {
        open,
        fadeOut,
        switchTo,
        clear: () => backdropStack.clear()
    };
}
