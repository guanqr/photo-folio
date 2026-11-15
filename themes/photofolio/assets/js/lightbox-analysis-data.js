/**
 * 图像分析结果的数据层（URL 构造 + 缓存预热），零渲染依赖
 *
 * 渲染器（lightbox-analysis.js）已拆成独立 entry、首次展开分析才加载；
 * 灯箱打开/切图时的预取只调用这里——不加载渲染代码也能提前把 JSON 拉进
 * 浏览器/SW 缓存，展开时直接命中（2026-11-15）。
 */
import { ANALYSIS_VERSION } from './analysis-meta.js';

// URL 带内容版本：照片内容哈希（换图即变）+ schema 版本（算法升级即变）；
// SW 对 /analysis/ 的缓存键保留查询串，新版本不命中旧结果
export function analysisUrl(slug, hash) {
    const version = (hash ? hash + '-' : '') + ANALYSIS_VERSION;
    return '/analysis/' + encodeURIComponent(slug) + '.json?v=' + encodeURIComponent(version);
}

/* 预取记忆：成功预取的 URL 与在途请求都不再重复发（换图/算法升级时 URL 自带
   新版本，自然换键）；上限防止长会话累积无界。此前渲染器内的 cache/inflight
   去重随模块拆分消失，来回翻看会反复请求，这里补回（2026-11-15 审查修复） */
const prefetched = new Set();
const inflight = new Map();
const MAX_PREFETCH_MEMORY = 200;

/* 预取：只发请求、读完响应即弃（不解析）——结果由 SW/HTTP 缓存承接（同 URL
   的 SWR 命中），失败仅告警，展开时渲染器会重试并走失败提示卡 */
export function prefetchAnalysis(slug, hash) {
    if (!slug) return;
    const url = analysisUrl(slug, hash);
    if (prefetched.has(url) || inflight.has(url)) return;
    const p = fetch(url)
        .then((res) => {
            if (!res.ok) throw new Error('HTTP ' + res.status);
            return res.text(); // 读完响应体：确保 HTTP/SW 缓存完整落盘
        })
        .then(() => {
            prefetched.add(url);
            if (prefetched.size > MAX_PREFETCH_MEMORY) {
                prefetched.delete(prefetched.values().next().value);
            }
        })
        .catch((err) => {
            console.warn('[lightbox] analysis prefetch failed:', slug, err);
        })
        .finally(() => {
            inflight.delete(url);
        });
    inflight.set(url, p);
}
