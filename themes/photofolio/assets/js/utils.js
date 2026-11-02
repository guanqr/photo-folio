// 全站共享小工具：记忆化 prefers-reduced-motion——
// 原先在 masonry/carousel/mobile-nav/gallery-filter/series-ambient 五处各自实现，
// 统一收敛到此处，修改查询策略（如用户级动效开关）只动这一处。
// FLIP 过渡时长/缓动（masonry 重排行与卡片网格换行共用）同理收敛至此。

let reducedMotionCached = null;

// SPA 长生命周期内系统动效偏好不会变化，全程只查询一次
export function prefersReducedMotion() {
    if (reducedMotionCached === null) {
        reducedMotionCached = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    }
    return reducedMotionCached;
}

// 布局重排 FLIP 过渡（与足迹时间线列数切换一致；档位内冻结缩放保持实时无动画）
// 时长单源：瀑布流跨档收尾定时器与新卡片淡入共用；缓动同时供 about-stats
// 的 width/height 过渡复用（0.35s + 标准缓出，2026-11-01）
export const FLIP_DURATION = 350;
export const FLIP_EASE = 'cubic-bezier(0.4, 0, 0.2, 1)';
export const FLIP_TRANSITION = `transform ${FLIP_DURATION / 1000}s ${FLIP_EASE}`;

// 换列 FLIP 滞回宽度（卡片网格/关于页统计共用）
export const FLIP_HYSTERESIS = 20;

// 卡片网格 2→3 列断点（与 _categories.scss @media min-width:1001 同源）
export const BP_CARD_GRID_3COL_MIN = 1001;

/* 换列 FLIP 共用工具：清内联属性、记录矩形、收尾定时器槽位（列数判定各组件保留） */
export function clearFlipInline(elements, { size = false } = {}) {
    elements.forEach((el) => {
        el.style.transition = '';
        el.style.transform = '';
        el.style.transformOrigin = '';
        if (size) {
            el.style.width = '';
            el.style.height = '';
        }
    });
}

export function recordFlipRects(root, selector) {
    return [...root.querySelectorAll(selector)].map((el) => el.getBoundingClientRect());
}

export function resetFlipFinish(entry) {
    if (entry.finishTimer) {
        clearTimeout(entry.finishTimer);
        entry.finishTimer = null;
    }
}

export function scheduleFlipFinish(entry, finish, delay = FLIP_DURATION + 50) {
    resetFlipFinish(entry);
    entry.finishTimer = setTimeout(() => {
        entry.finishTimer = null;
        finish();
    }, delay);
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

// 桌面断点单源（nav-dropdown 与 mobile-nav 共用）：与样式表 max-width: 768px
// 严格互补——平板竖屏恰为 768px，JS 若用 min-width: 768 会与窄屏样式同时命中
// （汉堡菜单已显示而点击被视为桌面端）。CSS 侧对应值见 _responsive.scss 的
// @media (max-width: 768px)，两处改动必须同步
export const BP_DESKTOP_MIN = 769;

// 灯箱窄屏断点单源（lightbox.js 与 lightbox-drawer.js 共用）：≤1000px 抽屉模式、
// 主图窄屏宽度降档（imageSizes.lightboxNarrow）与抽屉同界——改断点两处同步生效
//（2026-10-18 自双份字面量收敛）
export const BP_LIGHTBOX_NARROW = 1000;

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
// 锚定，让内容随整体移动（例如详情栏上/下方已无可滚动内容）
export function anchorWhile(el, container, duration, edge = 'top') {
    if (!el || !container) return () => {};
    const read = () => {
        const r = el.getBoundingClientRect();
        return edge === 'bottom' ? r.bottom : r.top;
    };
    const anchorPos = read();
    const start = performance.now();
    let raf = 0;
    let canceled = false;
    const step = () => {
        if (canceled) return;
        const delta = read() - anchorPos;
        if (Math.abs(delta) > 0.5) {
            const before = container.scrollTop;
            const max = Math.max(0, container.scrollHeight - container.clientHeight);
            const next = Math.max(0, Math.min(max, before + delta));
            container.scrollTop = next;
            if (Math.abs(next - before) < 0.5 && Math.abs(delta) > 1) return; // 滚动尽头
        }
        if (performance.now() - start < duration + 60) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => {
        canceled = true;
        cancelAnimationFrame(raf);
    };
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
