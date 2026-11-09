// 全站共享小工具：prefers-reduced-motion、图片就绪/URL/宽度、缓动、URL 状态、
// i18n 格式串、滚动锚定与灯箱层栈。断点见 breakpoints.js，FLIP 常量与 helper
// 见 flip.js（2026-11-06 拆分）。

let reducedMotionCached = null;

// SPA 长生命周期内系统动效偏好不会变化，全程只查询一次
export function prefersReducedMotion() {
    if (reducedMotionCached === null) {
        reducedMotionCached = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    }
    return reducedMotionCached;
}

// OSS CDN 图片宽度段（w_<n>）改写/读取：灯箱集合窄屏主图、底部缩略图条与
// 展示图自然尺寸上限共用同一口径（2026-11-01 自三处正则收敛）
export function replaceImageWidth(url, width) {
    return (url || '').replace(/w_\d+/, `w_${width}`);
}

export function imageWidth(url) {
    const match = /w_(\d+)/.exec(url || '');
    return match ? parseInt(match[1], 10) : 0;
}

// easeOutCubic 缓动：图表的连续形变、数字滚动等 rAF 动画共用
export function easeOutCubic(t) {
    return 1 - Math.pow(1 - t, 3);
}

// 图片元素解码就绪判定（complete && naturalWidth > 0）：灯箱主图/辉光/背景层
// 与瀑布流比例测量共用同一口径
export function isImageReady(img) {
    return !!(img && img.complete && img.naturalWidth > 0);
}

// 统一图片加载完成标记：自然宽高 > 0 才算就绪（complete 对失败图片也为 true，
// 仅看 complete 会把破图标成已加载）；未就绪挂一次性 load。_loadBound 防止
// masonry 显式赋 src 与 lazy-load 交集观察重复挂监听。两处共用同一口径。
export function markImageLoaded(img) {
    if (!img) return;
    if (isImageReady(img)) {
        img.classList.add('is-loaded');
        return;
    }
    if (img._loadBound) return;
    img._loadBound = true;
    img.addEventListener('load', () => img.classList.add('is-loaded'), { once: true });
}

// AVIF 兜底（游离 Image 用）：脱离 DOM 的 Image 的 error 不传播到 document
// 捕获监听（avif-fallback.js），预载/探测层需在实例上自行挂兜底——
// error 时 format,avif → format,webp 重试一次（webp 再失败时 src 已不含
// format,avif、天然不重试，无循环）；dataset.avifRetry 标记供消费方
// （背景层的错误处理器）识别「重试在途」
export function loadWithAvifFallback(img) {
    img.addEventListener('error', () => {
        const src = img.src;
        if (!src || !src.includes('format,avif')) return;
        img.dataset.avifRetry = '1';
        img.src = src.replace('format,avif', 'format,webp');
    });
}

// URL 查询参数状态同步（灯箱 ?p= 与筛选 ?y=/?s=/?l=/?c= 共用）：
// 克隆当前参数、按 updates 写/删（null/'' 删除），与当前 URL **规范化比较**
// （键排序——location.search 原始串可能乱序/编码不同，字符串比较会误判）
// 后 pushState / replaceState；无变化不推历史。
// replace=true 用于加载恢复的清理路径——不产生历史（返回键不留死循环）
export function pushQueryState(updates, { replace = false } = {}) {
    const params = new URLSearchParams(location.search);
    Object.entries(updates).forEach(([k, v]) => {
        if (v === null || v === '') params.delete(k);
        else params.set(k, v);
    });
    const canon = (p) => [...p.entries()]
        .sort(([a], [b]) => (a < b ? -1 : 1))
        .map(([k, v]) => `${k}=${v}`)
        .join('&');
    if (canon(params) === canon(new URLSearchParams(location.search))) return;
    const qs = params.toString();
    const url = location.pathname + (qs ? '?' + qs : '');
    if (replace) history.replaceState({ url: location.origin + url }, '', url);
    else history.pushState({ url: location.origin + url }, '', url);
    // 通知 SPA（page-transition）：已渲染内容的 path+search 随查询状态改写。
    // 不换内容、只改 URL——同页 hash/后退判断以此为准（2026-11-10 审查 #22）
    window.dispatchEvent(new CustomEvent('pf:querystate', { detail: url }));
}

// i18n 格式串填充：统一 %KEY% 占位（%CUR%/%TOTAL%、%N%、%COUNT%/%MIN%/%MAX%、
// %SHADOW_NAME% 等）；未知占位原样保留，便于暴露漏传
export function fillTemplate(template, values) {
    return (template || '').replace(/%([A-Z0-9_]+)%/g, (token, key) =>
        Object.prototype.hasOwnProperty.call(values, key) ? String(values[key]) : token);
}

// 开合内容高度变化时把控件钉在屏幕位置（2026-11-02 用户方案）：每帧按控件
// 视口位移补偿容器 scrollTop；edge='bottom' 用于收起方向（锚定可折叠容器
// 的底边，避免收起按钮被裁剪后的布局位置失真）。滚到容器上/下尽头即停止
// 锚定，让内容随整体移动（例如详情栏上/下方已无可滚动内容）。
// 同一时间只允许一个锚定；切图/隐藏/断点/用户指针、键盘、滚轮输入都取消，
// 避免旧 rAF 或两个折叠区互相抢写 scrollTop（2026-11-03 审查修复）
let activeAnchorCancel = null;

export function anchorWhile(el, container, duration, edge = 'top') {
    if (!el || !container) return () => {};
    if (activeAnchorCancel) activeAnchorCancel();
    const read = () => {
        const r = el.getBoundingClientRect();
        return edge === 'bottom' ? r.bottom : r.top;
    };
    const anchorPos = read();
    const start = performance.now();
    let raf = 0;
    let stopped = false;
    const stop = () => {
        if (stopped) return;
        stopped = true;
        cancelAnimationFrame(raf);
        document.removeEventListener('pointerdown', stop, true);
        document.removeEventListener('keydown', stop, true);
        document.removeEventListener('wheel', stop);
        window.removeEventListener('resize', stop);
        if (activeAnchorCancel === stop) activeAnchorCancel = null;
    };
    const step = () => {
        if (stopped) return;
        // 锚点被隐藏/移除（如切到非观鸟照片后图鉴块 hidden）：立即停止
        if (!el.isConnected || el.getClientRects().length === 0) {
            stop();
            return;
        }
        const delta = read() - anchorPos;
        if (Math.abs(delta) > 0.5) {
            const before = container.scrollTop;
            const max = Math.max(0, container.scrollHeight - container.clientHeight);
            const next = Math.max(0, Math.min(max, before + delta));
            container.scrollTop = next;
            if (Math.abs(next - before) < 0.5 && Math.abs(delta) > 1) { // 滚动尽头
                stop();
                return;
            }
        }
        if (performance.now() - start < duration + 60) raf = requestAnimationFrame(step);
        else stop();
    };
    // 任何后续用户输入/视口变化都让位（初始触发事件已派发完毕）
    document.addEventListener('pointerdown', stop, { capture: true, once: true });
    document.addEventListener('keydown', stop, { capture: true, once: true });
    document.addEventListener('wheel', stop, { passive: true, once: true });
    window.addEventListener('resize', stop, { once: true });
    activeAnchorCancel = stop;
    raf = requestAnimationFrame(step);
    return stop;
}

// 裸元素层栈（灯箱背景层与辉光层共用）：最新层 = 末位；剪枝只留末层
// （延时由调用方传入，均取「淡入时长 + 50ms 余量」）；关闭时全清。
// 层元素自身的状态标志（背景 _shown / 辉光 _ready）由调用方维护。
// clear 原地清空数组（外部持有 layers 引用时仍指向同一数组，不会失效）
export function createLayerStack(pruneDelay) {
    const stack = { layers: [], pruneTimer: null };
    stack.schedulePrune = () => {
        if (stack.pruneTimer) clearTimeout(stack.pruneTimer);
        stack.pruneTimer = setTimeout(() => {
            stack.pruneTimer = null;
            while (stack.layers.length > 1) stack.layers.shift().remove();
        }, pruneDelay);
    };
    stack.cancelPrune = () => {
        if (stack.pruneTimer !== null) {
            clearTimeout(stack.pruneTimer);
            stack.pruneTimer = null;
        }
    };
    // 硬上限：快速连切时新层可能迟迟不淡入、schedulePrune 不触发；只保留
    // 最新 max 层，防止层数随切换次数线性增长（辉光/背景层共用）
    stack.cap = (max) => {
        while (stack.layers.length > max) stack.layers.shift().remove();
    };
    stack.clear = () => {
        stack.cancelPrune();
        stack.layers.forEach((el) => el.remove());
        stack.layers.length = 0;
    };
    return stack;
}
