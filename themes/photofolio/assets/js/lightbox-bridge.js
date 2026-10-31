/**
 * 灯箱关闭桥（极薄模块）：page-transition 不能静态 import lightbox.js，
 * 否则懒加载拆分失效；灯箱初始化完成后把内部 close 注册到这里。
 */
let closeRef = null;

export function setLightboxClose(fn) {
    closeRef = fn;
}

export function closeLightbox() {
    if (closeRef) closeRef({ keepUrl: true });
}
