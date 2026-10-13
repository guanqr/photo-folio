/**
 * AVIF 兜底：不支持 AVIF 的环境（旧 WebView 等）图片加载失败时，
 * 把 OSS 处理参数 format,avif 改回 format,webp 重试一次
 *
 * - 经 document 捕获阶段 error 监听（图片 error 不冒泡，必须 capture）——
 *   覆盖全部 img：模板图、JS 动态层（辉光/背景）、懒加载 reveal 后的图
 * - dataset 记录兜底 URL：兜底重试仍失败时不再循环
 */
export function initAvifFallback() {
    document.addEventListener('error', (e) => {
        const img = e.target;
        if (!(img instanceof HTMLImageElement)) return;
        const src = img.src;
        if (!src || !src.includes('format,avif')) return;
        // 换 webp 重试一次：webp 再失败时 error 再次到达但 src 已不含
        // format,avif、自然不再处理（无循环，无需按 URL 防重——按 URL 防重
        // 会因 #lightbox-img 跨照片复用而误杀同照片重开的重试）；
        // dataset.avifRetry 标记供图层错误处理器识别「重试在途」（见 lightbox-backdrop）
        img.dataset.avifRetry = '1';
        img.src = src.replace('format,avif', 'format,webp');
    }, true);
}
