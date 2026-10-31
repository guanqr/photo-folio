/**
 * 灯箱作品集合与预加载（独立模块；集成见 lightbox.js）
 *
 * - 作品收集：按网格当前行计划（_planItems = 筛选结果、时间顺序）收集页面
 *   全部作品——含尚未渲染、留在隐藏池的卡片：灯箱所需数据（data-full-src /
 *   data-src / 宽高 / 元信息）均由模板写在卡片属性上，翻页不触碰网格 DOM、
 *   不触发任何行渲染（2026-10-31）——浏览全集后关闭即回到打开前状态；
 *   筛选时集合只在当前筛选结果内循环
 * - 结果带缓存（脏检查见 collect）：switch 的 prev/next 每次切图调用 collect
 *   时不重扫 DOM——集合只在网格身份 / 行计划代次 / 行计划引用变化时重建，
 *   行渲染不再使缓存失效
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

    // 收集当前页面全部可预览的作品。集合来源：
    // ① 网格行计划 _planItems（当前筛选结果、时间顺序，含隐藏池中未渲染的
    //    卡片）——未渲染卡片虽无 src，但 data-src / data-full-src / 宽高 /
    //    元信息都在，直接读取即可，翻页不触发任何行渲染；
    // ② 无网格/未初始化的页面退回扫描已渲染的 .photo-wrapper（改造前口径）。
    // 结果缓存：脏检查从网格既有状态惰性推导（O(1) 比较，无需跨模块推送脏标记）——
    // ① 网格元素身份变化 = SPA 换页（新页面新网格元素）；② _gridGen 变化 =
    // 筛选重启/跨档重排（代次递增，见 masonry.js）；③ _planItems 引用变化 =
    // 筛选集合替换。行渲染不再使集合失效（2026-10-31）。打开入口 openByImg
    // 恒先 collect 再 open，快照对灯箱会话恒新鲜
    let cachedGrid = null;
    let cachedGen = -1;
    let cachedPlan = null;
    let cachedPhotos = null;
    // 网格状态读取唯一口径（脏检查与 collect 快照共用——归一化只在此处定义，
    // 两处口径失同步会致缓存永不失效或永不命中）
    const readGridState = () => {
        const grid = document.getElementById('masonry-grid');
        return {
            grid,
            gen: grid ? (grid._gridGen || 0) : -1,
            plan: grid ? (grid._planItems || null) : null
        };
    };
    const isGridDirty = () => {
        const s = readGridState();
        if (s.grid !== cachedGrid) return true;
        if (!s.grid) return false;
        return s.gen !== cachedGen || s.plan !== cachedPlan;
    };
    const collect = () => {
        if (cachedPhotos && !isGridDirty()) return cachedPhotos;
        const grid = document.getElementById('masonry-grid');
        // 空集合也是有效计划（筛选无结果）：[] 为真值，不走兜底扫描
        const planItems = grid && grid._planItems ? grid._planItems : null;
        // 兜底路径保持改造前口径：只收已渲染、未被筛选隐藏的作品
        const wrappers = planItems
            ? planItems.map((item) => item.querySelector('.photo-wrapper')).filter(Boolean)
            : Array.from(document.querySelectorAll('.photo-wrapper')).filter((wrapper) => {
                const img = wrapper.querySelector('img');
                if (!img || !img.getAttribute('src')) return false;
                const card = wrapper.closest('[data-title]');
                const item = card ? card.closest('.masonry-item') : null;
                return !(item && item.classList.contains('is-hidden'));
            });
        const photos = [];
        for (const wrapper of wrappers) {
            const img = wrapper.querySelector('img');
            if (!img) continue;
            // 全尺寸 URL 恒由模板写入 data-full-src（未渲染卡片同样有）
            const src = img.dataset.fullSrc || img.src;
            if (!src) continue;
            // [data-title] 通用化：兼容 photo-card 与系列叙事块两种根元素
            const card = wrapper.closest('[data-title]');
            photos.push({
                // 照片唯一标识（URL ?p= 用）：photo-card 恒带 data-slug（构建期写入）
                slug: card ? (card.dataset.slug || '') : '',
                // 内容哈希（分析 JSON 的缓存版本号）：photo-card 由 photo.toml 的 hash 写入
                hash: card ? (card.dataset.hash || '') : '',
                src,
                srcNarrow: src.replace(/w_\d+/, 'w_1280'), // 窄屏灯箱主图（≤1000px 用）：首次光栅化成本约降 2.3×
                // 网格缩略图（w_800）：背景毛玻璃与辉光层共用——已渲染卡片用实际
                // URL（AVIF 兜底后可能是 webp、且已在缓存中）；未渲染卡片读
                // data-src，与网格后续加载同 URL 保证命中同一缓存
                thumb: img.src || img.dataset.src || src,
                alt: img.alt,
                title: card ? (card.dataset.title || '') : '',
                place: card ? (card.dataset.place || '') : '',
                date: card ? (card.dataset.date || '') : '',
                description: card ? (card.dataset.description || '') : '',
                category: card ? (card.dataset.category || '') : '',
                categoryUrl: card ? (card.dataset.categoryUrl || '') : '',
                series: card ? (card.dataset.series || '') : '',
                seriesUrl: card ? (card.dataset.seriesUrl || '') : '',
                // 照片真实像素尺寸（photo.toml 回填的 width/height 属性）：
                // 供缩放目标按展示图自然尺寸封顶（超宽屏不再放大过头）
                width: parseFloat(img.getAttribute('width')) || 0,
                height: parseFloat(img.getAttribute('height')) || 0,
                focus: card ? (card.dataset.focus || '') : '',
                aperture: card ? (card.dataset.aperture || '') : '',
                shutter: card ? (card.dataset.shutter || '') : '',
                iso: card ? (card.dataset.iso || '') : '',
                camera: card ? (card.dataset.camera || '') : '',
                lens: shortLens(card ? (card.dataset.lens || '') : '')
            });
        }
        // 快照网格状态供脏检查（口径见 readGridState）
        const s = readGridState();
        cachedGrid = s.grid;
        cachedGen = s.gen;
        cachedPlan = s.plan;
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
