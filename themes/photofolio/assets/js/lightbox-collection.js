/**
 * 灯箱作品集合与预加载（独立模块；集成见 lightbox.js）
 *
 * - 作品收集：扫描页面全部 .photo-wrapper，抽取 src/元信息为灯箱可预览列表
 *   （跳过未揭示与筛选隐藏的作品）——结果带缓存（脏检查见 collect）：
 *   switch 的 prev/next 每次切图调用 collect 时不重扫 DOM
 * - 邻居预加载：保留 Image 引用（切图时用于同步探测缓存状态，避免重复请求）；
 *   pruneKeep 只保留当前图与左右邻居，防止长时间翻看累积解码位图
 *   （每张 w_1920 约 10MB）
 * - 照片 URL 同步：?p=slug（与筛选共用 pushQueryState——地址栏实时更新、
 *   返回键回退历史、规范化比较防乱序参数误推）
 */
import { isImageReady, pushQueryState, loadWithAvifFallback } from './utils.js';

export function initLightboxCollection({ shortLens }) {
    // 预加载缓存（裸 Image 引用）：已就绪与在途（complete=false）的条目都保留
    // 现有引用——在途重建会丢弃进行中的下载/解码，慢网下同一张 10MB 图解码两次；
    // 只有失败过的条目（complete 但 naturalWidth=0）换新 Image 重试——否则一次
    // 瞬时失败会让该照片整个会话缓存探针恒为 false
    const preloadCache = new Map();
    const preload = (url) => {
        if (!url) return;
        const existing = preloadCache.get(url);
        if (existing && (!existing.complete || existing.naturalWidth > 0)) return;
        const img = new Image();
        loadWithAvifFallback(img); // 游离 Image 不进 document 捕获监听，实例级挂 AVIF 兜底
        img.src = url;
        preloadCache.set(url, img);
    };

    // 只保留 keepUrls（当前图与左右各两位邻居，见 lightbox-switch）的预载引用
    const pruneKeep = (keepUrls) => {
        preloadCache.forEach((_, url) => {
            if (!keepUrls.includes(url)) preloadCache.delete(url);
        });
    };

    // 缓存探测：切图时据此区分「HTTP 已缓存但解码未完成」与「未缓存」两种路径
    const isCached = (url) => isImageReady(preloadCache.get(url));

    // 收集当前页面所有可预览的作品。
    // 结果缓存：脏检查从网格既有状态惰性推导（O(1) 比较，无需跨模块推送脏标记）——
    // ① 网格元素身份变化 = SPA 换页（新页面新网格元素）；② _gridGen 变化 =
    // 筛选重启（代次递增，见 masonry.js）；③ _shownItems 数量变化 = 无限滚动
    // 揭示增长（灯箱打开时在途批次揭示完成同样自动感知）。打开入口 openByImg
    // 恒先 collect 再 open，快照对灯箱会话恒新鲜
    let cachedGrid = null;
    let cachedGen = -1;
    let cachedShownCount = -1;
    let cachedPhotos = null;
    // 网格状态读取唯一口径（脏检查与 collect 快照共用——归一化只在此处定义，
    // 两处口径失同步会致缓存永不失效或永不命中）
    const readGridState = () => {
        const grid = document.getElementById('masonry-grid');
        return {
            grid,
            gen: grid ? (grid._gridGen || 0) : -1,
            shown: grid && grid._shownItems ? grid._shownItems.length : -1
        };
    };
    const isGridDirty = () => {
        const s = readGridState();
        if (s.grid !== cachedGrid) return true;
        if (!s.grid) return false;
        return s.gen !== cachedGen || s.shown !== cachedShownCount;
    };
    const collect = () => {
        if (cachedPhotos && !isGridDirty()) return cachedPhotos;
        const wrappers = document.querySelectorAll('.photo-wrapper');
        const photos = [];
        wrappers.forEach(wrapper => {
            const img = wrapper.querySelector('img');
            if (!img || !img.getAttribute('src')) return; // 未揭示的作品还没有 src（无限滚动尚未加载），跳过——箭头仅停留在已加载的最后一张
            const item = wrapper.closest('.masonry-item');
            if (item && item.classList.contains('is-hidden')) return; // 被当前筛选隐藏的作品不进箭头集合
            // [data-title] 通用化：兼容 photo-card 与系列叙事块两种根元素
            const card = wrapper.closest('[data-title]');
            photos.push({
                // 照片唯一标识（URL ?p= 用）：photo-card 恒带 data-slug（构建期写入）
                slug: card ? (card.dataset.slug || '') : '',
                src: img.dataset.fullSrc || img.src,
                srcNarrow: (img.dataset.fullSrc || img.src).replace(/w_\d+/, 'w_1280'), // 窄屏灯箱主图（≤1000px 用）：首次光栅化成本约降 2.3×
                thumb: img.src, // 网格缩略图（w_800）：背景毛玻璃与辉光层共用——与网格同 URL 保证灯箱打开即缓存命中，背景不会因新请求等待而黑屏
                alt: img.alt,
                title: card ? (card.dataset.title || '') : '',
                place: card ? (card.dataset.place || '') : '',
                date: card ? (card.dataset.date || '') : '',
                description: card ? (card.dataset.description || '') : '',
                category: card ? (card.dataset.category || '') : '',
                categoryUrl: card ? (card.dataset.categoryUrl || '') : '',
                series: card ? (card.dataset.series || '') : '',
                seriesUrl: card ? (card.dataset.seriesUrl || '') : '',
                focus: card ? (card.dataset.focus || '') : '',
                aperture: card ? (card.dataset.aperture || '') : '',
                shutter: card ? (card.dataset.shutter || '') : '',
                iso: card ? (card.dataset.iso || '') : '',
                camera: card ? (card.dataset.camera || '') : '',
                lens: shortLens(card ? (card.dataset.lens || '') : '')
            });
        });
        // 快照网格状态供脏检查（口径见 readGridState）
        const s = readGridState();
        cachedGrid = s.grid;
        cachedGen = s.gen;
        cachedShownCount = s.shown;
        cachedPhotos = photos;
        return photos;
    };

    // 点击的作品在列表中的下标（灯箱点击打开入口用）
    const findIndexByImg = (photos, img) =>
        photos.findIndex(p => p.src === (img.dataset.fullSrc || img.src));

    // 照片 URL 同步：打开/切换写入 ?p=、关闭删除，其余参数自动保留；
    // replace 为真时 replaceState（切图/关闭）——灯箱只占一个历史条目：
    // 返回键 = 关闭灯箱（不逐张回退照片），地址栏始终为当前照片
    const syncPhotoUrl = (slug, replace = false) => {
        pushQueryState({ p: slug || null }, { replace });
    };

    return { collect, preload, pruneKeep, isCached, findIndexByImg, syncPhotoUrl };
}
