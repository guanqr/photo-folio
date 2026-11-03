/**
 * 灯箱关闭桥（极薄模块）：page-transition 不能静态 import lightbox.js，
 * 否则懒加载拆分失效；灯箱初始化完成后把内部 close 注册到这里。
 *
 * 用 window 注册而不是模块级变量：核心 bundle 与按需加载的灯箱入口各自
 * 打包本模块、模块实例互不相通——模块级 closeRef 在 page-transition 所在
 * 的核心包里恒为 null，SPA 导航/返回时灯箱会悬在新页面上（2026-11-03
 * 验证 #8 的闲置关闭场景时实测）。MimoRee 项目代号允许作为全局键名。
 */
const CLOSE_KEY = '__MimoLightboxClose';

export function setLightboxClose(fn) {
    window[CLOSE_KEY] = fn;
}

export function closeLightbox() {
    const fn = window[CLOSE_KEY];
    if (fn) fn({ keepUrl: true });
}
