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
export const FLIP_TRANSITION = 'transform 0.35s cubic-bezier(0.4, 0, 0.2, 1)';

// easeOutCubic 缓动：图表的连续形变、数字滚动等 rAF 动画共用
export function easeOutCubic(t) {
    return 1 - Math.pow(1 - t, 3);
}

// 图片元素解码就绪判定（complete && naturalWidth > 0）：灯箱主图/辉光/背景层
// 与瀑布流比例测量共用同一口径
export function isImageReady(img) {
    return !!(img && img.complete && img.naturalWidth > 0);
}

// 桌面断点单源（nav-dropdown 与 mobile-nav 共用）：与样式表 max-width: 768px
// 严格互补——平板竖屏恰为 768px，JS 若用 min-width: 768 会与窄屏样式同时命中
// （汉堡菜单已显示而点击被视为桌面端）。CSS 侧对应值见 _responsive.scss 的
// @media (max-width: 768px)，两处改动必须同步
export const BP_DESKTOP_MIN = 769;

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
    stack.clear = () => {
        stack.cancelPrune();
        stack.layers.forEach((el) => el.remove());
        stack.layers.length = 0;
    };
    return stack;
}
