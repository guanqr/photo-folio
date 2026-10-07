// 全站共享小工具：记忆化 prefers-reduced-motion——
// 原先在 masonry/carousel/mobile-nav/gallery-filter/series-ambient 五处各自实现，
// 统一收敛到此处，修改查询策略（如用户级动效开关）只动这一处。

let reducedMotionCached = null;

// SPA 长生命周期内系统动效偏好不会变化，全程只查询一次
export function prefersReducedMotion() {
    if (reducedMotionCached === null) {
        reducedMotionCached = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    }
    return reducedMotionCached;
}
