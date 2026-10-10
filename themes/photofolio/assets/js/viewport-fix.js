/**
 * iPad Safari 旋转视口兜底：横屏转竖屏后布局视口宽度残留旧值（WebKit
 * Bug 287042 特征——媒体查询全部按横屏宽评估、窄屏样式不切换，刷新才恢复；
 * 逐个排查触发元素模式未能根治）。社区验证过的 workaround：旋转后临时改写
 * viewport meta（附加 maximum-scale）强制 WebKit 重算布局视口，随后恢复原文。
 * 健康浏览器上该改写为无害空操作（400ms 延迟等旋转重排结束后再改写）。
 */
export function initViewportFix() {
    const meta = document.querySelector('meta[name="viewport"]');
    if (!meta || typeof screen === 'undefined' || !screen.orientation ||
        !screen.orientation.addEventListener) return;

    const content = meta.getAttribute('content');
    screen.orientation.addEventListener('change', () => {
        setTimeout(() => {
            meta.setAttribute('content', content + ', maximum-scale=1.0');
            setTimeout(() => {
                meta.setAttribute('content', content);
            }, 300);
        }, 400);
    });
}
