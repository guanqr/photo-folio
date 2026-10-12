/**
 * 灯箱辉光层栈（独立模块；集成见 lightbox.js）
 *
 * - 主图的同框模糊副本（thumb 源 + blur + scale(2) 半分辨率补偿）；
 *   每张作品一层 <img>，新层解码后淡入、旧层随后剪枝——消除就地换 src
 *   （iOS 过滤图换源闪烁的根因，强制重排等方案均无法根治）
 * - 层创建/就绪门控/淡入/剪枝由本模块负责；activeGlow 编排（哪层随主图
 *   滑动/揭示、何时淡入）仍在 lightbox.js 的切换管线里（whenReady 判定
 *   由调用方传入：仍是最新可见层 && 主图已开始滑入 && 滑入已完成）
 */
import { isImageReady, createLayerStack } from './utils.js';

export function initLightboxGlow({ reducedMotion }) {
    const glowStack = createLayerStack((reducedMotion ? 0 : 250) + 50); // 0.25s 淡入 + 50ms 余量
    const layers = glowStack.layers;
    const glowTransition = reducedMotion ? 'none' : 'opacity 0.25s ease';

    const createEl = () => {
        const el = document.createElement('img');
        el.className = 'lightbox-img-glow';
        el.alt = '';
        el.setAttribute('aria-hidden', 'true');
        el.setAttribute('draggable', 'false');
        el.style.opacity = '0';
        return el;
    };

    const fadeIn = (el) => {
        // 辉光只做透明度淡入，不做自己的滑入移动：位置已在 startSlideIn 立即
        // 归位——若从侧边自行滑入，解码晚于主图时会明显晚于主图到达中间（不同步）
        el.style.transition = glowTransition;
        el.style.opacity = '1';
    };

    // 就绪监听（load/error 均视为就绪）：解码完成后仅当 whenReady(el) 为真
    // （最新可见层 + 主图滑入/揭示完成）才淡入——滑入途中淡入会在落点先于
    // 主图显现（残影拖尾），就绪晚到的由调用方在 slideInDone 补淡
    const attachReady = (el, whenReady) => {
        const onReady = () => {
            el._ready = true;
            if (whenReady(el)) {
                fadeIn(el);
                glowStack.schedulePrune();
            }
        };
        if (isImageReady(el)) {
            el._ready = true;
            return;
        }
        el.addEventListener('load', onReady, { once: true });
        el.addEventListener('error', onReady, { once: true });
    };

    // 新建一层并注册：插入主图前、入栈、挂就绪门控——层创建/入栈/就绪内聚，
    // 调用方只持有返回的层引用（activeGlow）、不再触碰层栈
    const spawn = (area, img, src, whenReady) => {
        const el = createEl();
        area.insertBefore(el, img);
        layers.push(el);
        el.src = src;
        attachReady(el, whenReady);
        return el;
    };

    return {
        schedulePrune: () => glowStack.schedulePrune(),
        fadeIn,
        spawn,
        clear: () => glowStack.clear()
    };
}
