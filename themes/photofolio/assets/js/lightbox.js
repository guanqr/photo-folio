import { initLightboxDrawer } from './lightbox-drawer.js';
import { initLightboxAnalysis } from './lightbox-analysis.js';
import { initLightboxSwipe } from './lightbox-swipe.js';
import { initLightboxMeta } from './lightbox-meta.js';
import { initLightboxBackdrop } from './lightbox-backdrop.js';
import { initLightboxGlow } from './lightbox-glow.js';
import { prefersReducedMotion, isImageReady, pushQueryState } from './utils.js';

let inited = false;

// SPA 导航时由 page-transition 调用的关闭钩子（initLightbox 后指向内部 close）：
// 灯箱在壳层 DOM、不随内容替换——不关闭则旧照片悬在新页面上、URL 状态错乱
let closeLightboxRef = null;
export function closeLightbox() {
    if (closeLightboxRef) closeLightboxRef();
}

export function initLightbox() {
    if (inited) return;

    const lightbox = document.getElementById('lightbox');
    const lightboxImg = document.getElementById('lightbox-img');
    const lightboxImgArea = lightbox ? lightbox.querySelector('.lightbox-img-area') : null; // 辉光层插入点（主图之前；lightbox 缺失时保持 null——下方守卫兜底）
    const lightboxImgLoading = document.getElementById('lightbox-img-loading');
    const lightboxCaption = document.getElementById('lightbox-caption');
    const tagsEl = document.getElementById('lightbox-tags');
    const lightboxMeta = document.getElementById('lightbox-meta');
    const lightboxMetaPlace = document.querySelector('#lightbox-meta-place .lightbox-meta-text');
    const lightboxMetaDate = document.querySelector('#lightbox-meta-date .lightbox-meta-text');
    const lightboxClose = document.getElementById('lightbox-close');
    const btnPrev = document.getElementById('lightbox-prev');
    const btnNext = document.getElementById('lightbox-next');
    // 元信息面板（桌面右栏 / 窄屏底部抽屉）
    const panel = document.getElementById('lightbox-panel');
    const panelDetails = document.getElementById('lightbox-panel-details');
    const panelToggle = document.getElementById('lightbox-panel-toggle');
    const exifList = document.getElementById('lightbox-exif');
    const histogramEl = document.getElementById('lightbox-histogram');
    const histLegendEl = document.getElementById('lightbox-hist-legend');
    const paletteWrap = document.getElementById('lightbox-palette-wrap');
    const paletteEl = document.getElementById('lightbox-palette');
    const storyWrap = document.getElementById('lightbox-story-wrap');
    const storyEl = document.getElementById('lightbox-story');
    const tonalWrap = document.getElementById('lightbox-tonal-wrap');
    const tonalName = document.getElementById('lightbox-tonal-name');
    const tonalZoneStrip = document.getElementById('lightbox-zone-strip');
    const tonalZoneBracket = document.getElementById('lightbox-zone-bracket');
    const tonalFracShadow = document.getElementById('lightbox-tone-ratio-shadow');
    const tonalFracMid = document.getElementById('lightbox-tone-ratio-mid');
    const tonalFracHigh = document.getElementById('lightbox-tone-ratio-high');
    const tonalFracText = document.getElementById('lightbox-tone-frac-text');
    const tonalDr = document.getElementById('lightbox-tonal-dr');
    const tonalP50 = document.getElementById('lightbox-tonal-p50');
    const satWrap = document.getElementById('lightbox-sat-wrap');
    const satName = document.getElementById('lightbox-sat-name');
    const satHist = document.getElementById('lightbox-sat-hist');
    const hueWrap = document.getElementById('lightbox-hue-wrap');
    const hueName = document.getElementById('lightbox-hue-name');
    const hueHist = document.getElementById('lightbox-hue-hist');
    const hueAxis = document.getElementById('lightbox-hue-axis');
    // 图像分析按需加载：默认收起——打开/切图不再探测下载 w_1024 采样图，
    // 只有点击触发行才展开加载；收起不取消在途探测（结果入缓存，再展开直接命中）。
    // 展开/收起过渡：wrapper max-height + opacity——展开走 class 兜底大值
    // （内容高度未知、加载后增长），收起先按当前 clientHeight 内联定值再移除
    // is-open（从固定大值收起会在动画前段无可见变化、有停顿感）
    const analysisTrigger = document.getElementById('lightbox-analysis-trigger');
    const analysisWrap = document.getElementById('lightbox-analysis');
    const analysisCollapse = document.getElementById('lightbox-analysis-collapse');
    // 窄屏灯箱主图降档判定（≤1000px 用 w_1280）：与抽屉断点一致——
    // 初始化时创建一次，不在每次 open() 重建 MQL
    const narrowLightbox = window.matchMedia('(max-width: 1000px)');

    // 随图片同步淡入的元信息元素：打开时全部隐藏，图片加载完成后统一揭示——
    // 标题 / 分类与系列胶囊 / 地点日期简行 / EXIF / 分析触发行 / 直方图与色卡 / 影调与色彩 / 故事
    const revealSynced = [
        lightboxCaption, tagsEl, lightboxMeta, exifList, analysisTrigger,
        paletteWrap, tonalWrap, satWrap, hueWrap, storyWrap,
    ].filter(Boolean);

    if (!lightbox || !lightboxImg) return;

    // 背景层的插入点：顶栏之前（层按 DOM 顺序叠放，新层在后、天然压在上层）
    const backdropInsertBefore = lightbox.querySelector('.lightbox-topbar');

    // 触屏滑动切图（先于 drawer 创建：方向仲裁直接注入、无需可变引用桥接；
    // onSwitch 的 prev/next 为函数声明提升、getGlow 闭包事件期求值，均可用）
    const swipe = initLightboxSwipe({
        img: lightboxImg,
        area: lightboxImgArea,
        getGlow: () => activeGlow,
        onSwitch: (dir, dx) => { if (dir > 0) next(dx); else prev(dx); }
    });

    // 窄屏/中屏底部抽屉（≤1000px）：展开/收起、滚轮与拖动手势（独立模块，见 lightbox-drawer.js）；
    // dirVerdict：触屏方向仲裁（未决冻结抽屉、垂直交还、水平结束拖拽）
    const drawer = initLightboxDrawer({
        lightbox, panel, panelDetails, panelToggle, metaEl: lightboxMeta,
        dirVerdict: () => swipe.getVerdict()
    });
    // 图片分析：色卡/影调与色彩（独立模块，见 lightbox-analysis.js；直方图
    // 已并入影调区块——RGB 通道曲线 + 三分区/P50/剪裁注释同图展示）
    const analysis = initLightboxAnalysis({
        paletteWrap, paletteEl,
        tone: {
            wrap: tonalWrap, name: tonalName, histEl: histogramEl, legendEl: histLegendEl,
            zoneStripEl: tonalZoneStrip, zoneBracketEl: tonalZoneBracket,
            fracs: [tonalFracShadow, tonalFracMid, tonalFracHigh], fracText: tonalFracText,
            dr: tonalDr, p50: tonalP50
        },
        sat: { wrap: satWrap, name: satName, histEl: satHist },
        hue: { wrap: hueWrap, name: hueName, histEl: hueHist, axisEl: hueAxis },
        onDone: () => {
            // 分析完成（缓存命中/探测成功/失败）：图表内容高度变化后刷新抽屉
            // 箭头状态（桌面 is-fit 由 ResizeObserver 重判）
            drawer.refresh();
        }
    });

    let currentPhotos = [];
    let currentIndex = -1;

    // 分析区开合状态以 analysisWrap 的 is-open 类为唯一事实源（默认收起、
    // 展开态跨切图/关开保持——用户已选择查看分析，后续打开延续该选择）；
    // 不再维护独立的 analysisOpen 布尔（与类必然同步的冗余状态）

    // 收起位置补偿：is-fit 翻转会把内容从「顶对齐」瞬时重排为「居中裁切」，
    // 标题/标签在 t=0 出现向上跳变——点击前测出标题实际位置，transform 整体
    // 补偿到该位置消除跳变；补偿量随收起进度锁步归零，标题从点击前位置平滑
    // 滑向最终居中位、与图表收缩同段动画。进度从 wrapper 高度恢复（max-height
    // 的 ease 曲线进度 = 1 − 当前高/初始高，与过渡天然锁步，无需另算缓动）。
    // 补偿量为纯实测驱动（此前按 offsetHeight 整数舍入推导、残留约 8px 上跳）：
    // rect（小数精确）减去当前 dy 反推真实布局位；最终居中位由布局位逐帧实测
    // 估计（内容仅随分析区收缩：L_end = L + (1−p)·w0/2 为几何恒等式）——起点
    // 精确连续（p=0 时 dy = T0 − rect）、终点补偿恰好归零（p=1 时 dy = 0）
    let centerCompRaf = null;
    let centerCompDy = 0;
    function cancelCenterComp() {
        if (centerCompRaf !== null) {
            cancelAnimationFrame(centerCompRaf);
            centerCompRaf = null;
        }
        centerCompDy = 0;
        [lightboxCaption, tagsEl, panelDetails].forEach((el) => { if (el) el.style.transform = ''; });
    }
    function startCenterComp(preClickTop) {
        cancelCenterComp();
        if (!lightboxCaption) return;
        const compEls = [lightboxCaption, tagsEl, panelDetails].filter(Boolean);
        const wrapH0 = analysisWrap.clientHeight; // 收起前分析区高度（过渡起点）
        if (wrapH0 <= 0 || compEls.length === 0) return;
        const step = () => {
            const wrapH = analysisWrap.clientHeight;
            const progress = 1 - wrapH / wrapH0;
            const rect = lightboxCaption.getBoundingClientRect().top;
            const dy = (1 - progress) * (preClickTop - rect + centerCompDy + progress * wrapH0 / 2);
            centerCompDy = dy;
            compEls.forEach((el) => { el.style.transform = `translateY(${dy}px)`; });
            if (wrapH > 0.5) {
                centerCompRaf = requestAnimationFrame(step);
            } else {
                centerCompRaf = null;
                centerCompDy = 0;
                compEls.forEach((el) => { el.style.transform = ''; });
            }
        };
        step(); // 第一帧同步落位（点击当帧即连续，不闪跳变）；同步 step 内已排后续 rAF，不得再排一条——双链会让 cancelCenterComp 无法全取消
    }

    function setAnalysisOpen(open) {
        if (!analysisTrigger || !analysisWrap) return;
        // 收起前标题位置：触发行即将复现（展开时触发行是平滑收拢，不收布局
        // 跳变；收起时 is-open 移除令其回归布局、居中块位移约半行）——须在
        // 触发行 class 切换前实测（切换后旧位置即丢失），供收起补偿回原位
        const preClickTop = !open && lightboxCaption && !reducedMotion
            ? lightboxCaption.getBoundingClientRect().top
            : null;
        analysisTrigger.setAttribute('aria-expanded', open ? 'true' : 'false');
        analysisTrigger.classList.toggle('is-open', open);
        // 清除 revealSynced 写入的内联 opacity（内联压过 .is-open 的类级 opacity，
        // 不清理则触发行收起只有裁剪没有淡出）
        analysisTrigger.style.opacity = '';
        analysisWrap.setAttribute('aria-hidden', open ? 'false' : 'true');
        if (open) {
            // 展开：清除收起留下的内联 max-height，走 class 兜底大值过渡；
            // 图表区照常展示（空图表框即占位，不额外显示加载指示），数据就绪后填充；
            // 触发行随开合平滑收拢（纯 CSS），展开方向无 t=0 布局跳变、无需补偿
            drawer.setFitAdjuster(null); // 清除收起期间的高度扣除，按实际高度逐帧重判
            cancelCenterComp(); // 收起中途再展开：停止收起补偿、摘除 transform
            analysisWrap.style.maxHeight = '';
            analysisWrap.classList.add('is-open');
            if (currentIndex >= 0 && currentPhotos[currentIndex]) {
                analysis.analyze(currentPhotos[currentIndex].src);
            }
        } else {
            // 收起：纯对称收缩（展开的逆向）——is-fit 提前挂上后 unsafe center +
            // 面板裁切让整块内容（含顶部 EXIF）从第一帧起以中心为轴同速向中心
            // 收拢，恰为展开动作的镜像。过渡起点用双内联值（实测高度 px → 0px）：
            // 与 class 移除同帧提交时过渡会从 class 的 80em 旧值起算、前段高度
            // 纹丝不动（启动延迟），内联起点值经强制 reflow 提交后不再受干扰；
            // 过渡结束清除内联值、恢复 class 的 0 基线（内联恒压过 class，
            // 不清除会残留占位高度）；reduced-motion 下直切、无需内联定值
            if (reducedMotion) {
                analysisWrap.style.maxHeight = '';
                analysisWrap.classList.remove('is-open');
            } else {
                // 标题滚动出画面时 preClickTop 为负值，补偿自动保持其不可见、
                // 视口表现为返回顶部
                analysisWrap.style.maxHeight = analysisWrap.clientHeight + 'px';
                void analysisWrap.offsetHeight; // 强制 reflow：内联起点值先提交
                analysisWrap.style.maxHeight = '0px';
                analysisWrap.classList.remove('is-open'); // opacity 随同淡出
                // 「放得下」立即判定：按收起后的最终总高（扣除正在收缩的分析区
                // 当前高度与正在复现的触发行高度——两者同步动画、合计恒等于
                // 最终总高的变化量）重判 is-fit——放得下则从第一帧起居中收缩、
                // 标题从点击前位置平滑滑向居中位（位置补偿消除翻转瞬间的向上跳变）
                const willFit = drawer.setFitAdjuster(() =>
                    analysisWrap.clientHeight + analysisTrigger.offsetHeight);
                if (willFit && preClickTop !== null) startCenterComp(preClickTop);
                analysisWrap.addEventListener('transitionend', function collapseEnd(e) {
                    if (e.propertyName !== 'max-height') return; // opacity 结束不处理
                    analysisWrap.removeEventListener('transitionend', collapseEnd);
                    analysisWrap.style.maxHeight = ''; // 清除内联、恢复 class 的 0 基线
                    drawer.setFitAdjuster(null); // 收起完成：恢复常规判定
                    cancelCenterComp(); // 滑动至最终居中位：摘除 transform（布局已居中）
                    drawer.refresh(); // 内容高度已变：窄屏抽屉箭头状态补判（t=0 时高度未变、判的是旧态）
                });
            }
            // 内容同步回滚到顶部：与收起过渡同曲线同时长锁步（cssEaseY =
            // CSS ease），收起过程中视口跟随内容收缩上移，不残留空白等待区
            drawer.scrollToTop(reducedMotion ? 0 : 400);
        }
        drawer.refresh(); // 内容高度变化：刷新箭头状态（桌面 is-fit 由 ResizeObserver 重判）
    }

    let switching = false; // 切换动画进行中（滑出/滑入期间 onLoad 不强制图片透明度，避免覆盖过渡）
    // 毛玻璃背景层（机制对齐参考站灯箱）：每张作品一层 <img>，
    // 切换时旧层**立即**淡出（0.7s，不等新层就绪——加载慢时背景短暂为纯黑底，
    // 与参考站一致）、新层就绪后淡入（0.7s）；新层淡入后约 750ms 移除所有旧层。
    // 层栈与常量定义见下方背景层区块（BACKDROP_MS 与 createLayerStack）

    // 滑动动画同时作用于主图与当前辉光层：辉光随主图一起移动与淡入淡出。
    // 主图位移百分比按**自身盒宽**解析（object-fit: contain 的照片盒，竖构图时
    // 窄于网格单元）——辉光按像素对齐主图实际位移（百分比补偿只对单元宽度
    // 有效，竖构图下辉光会先于主图移出）
    const slideStyle = (pct, opacity, transition, fromPx) => {
        if (fromPx !== undefined) {
            // 滑动提交的显式起点（双相提交）：先无过渡把主图与辉光落位到拖动
            // 位置并强制提交为过渡起点——依赖「reset 与写入之间无布局读取」
            // 不可靠：下方 offsetWidth 的强制回流会把辉光的起点钉在 reset 后的
            // 归位值（中心）、与主图错位——Android 真机滑动切图辉光不同步的根因
            lightboxImg.style.transition = 'none';
            lightboxImg.style.transform = `translateX(${fromPx}px)`;
            if (activeGlow) {
                activeGlow.style.transition = 'none';
                activeGlow.style.transform = `translateX(${fromPx}px) scale(2)`;
            }
            void lightboxImg.offsetWidth; // 强制回流：提交起点
        }
        const transform = `translateX(${pct}%)`;
        lightboxImg.style.transform = transform;
        lightboxImg.style.opacity = opacity;
        if (transition !== undefined) lightboxImg.style.transition = transition;
        if (activeGlow) {
            const mainW = lightboxImg.offsetWidth; // 主图盒宽（照片渲染盒）
            // scale(2) 必须并入 transform 内联（独立 scale 属性会把 transform
            // 的位移也放大 2 倍——辉光滑出速度翻倍、与主图拖尾错位）
            activeGlow.style.transform = `translateX(${(pct / 100) * mainW}px) scale(2)`;
            activeGlow.style.opacity = opacity;
            if (transition !== undefined) activeGlow.style.transition = transition;
        }
    };

    // 在途切图监听（load/error 同生共死、成对管理）：新切换前先摘除，避免陈旧闭包重放
    let pendingSwitch = null; // { load, error }
    const clearPendingSwitch = () => {
        if (!pendingSwitch) return;
        lightboxImg.removeEventListener('load', pendingSwitch.load);
        lightboxImg.removeEventListener('error', pendingSwitch.error);
        pendingSwitch = null;
    };

    // 在途滑出结束监听：快速同向连切时（0.25s 滑出动画内再次切换），第二次
    // slideStyle 写入相同 transform 不会重启过渡、旧监听照常触发——旧闭包会用
    // 上一张作品重放 src/面板；新切换开始时先摘除旧监听，仅最新一次切换生效
    let pendingSlideOut = null;
    const clearPendingSlideOut = () => {
        if (pendingSlideOut) {
            lightboxImg.removeEventListener('transitionend', pendingSlideOut);
            pendingSlideOut = null;
        }
    };

    let mainSlideStarted = false; // 主图是否已开始滑入/揭示（辉光不得先于主图淡入）
    // 减弱动态偏好：滑出/滑入/辉光/背景的内联过渡全部直切（内联样式优先级高于
    // CSS 媒体查询，无法靠样式表关闭——与全站各动画模块的 reduced-motion 约定一致）
    const reducedMotion = prefersReducedMotion();
    const slideTransition = reducedMotion ? 'none' : 'transform 0.25s ease, opacity 0.25s ease';

    // iOS 上跳过辉光层（对齐参考站做法）：iOS Safari 对带 filter 的 img 换源/
    // 合成有一系列缺陷（闪帧、错位），逐案修补成本高且不稳定——照片无光晕
    // 直接显示，其余平台保持四边辉光。检测覆盖 iPadOS 的桌面 UA 伪装
    // （MacIntel + 触屏）
    const iOSGlowDisabled = /iP(hone|ad|od)/.test(navigator.userAgent) ||
        (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

    // 辉光层（独立模块见 lightbox-glow.js）：层栈/就绪门控/淡入/剪枝/层创建在此；
    // activeGlow 编排（哪层随主图滑动/揭示、何时淡入）仍在本文件切换管线
    const glow = initLightboxGlow({ reducedMotion });
    let activeGlow = null;
    const fadeGlowIn = (el) => glow.fadeIn(el);
    const spawnGlow = (src) => glow.spawn(lightboxImgArea, lightboxImg, src,
        (el) => el === activeGlow && mainSlideStarted && !switching);
    const closeGlow = () => {
        glow.clear();
        activeGlow = null;
    };


    // 图片加载转圈：新图未就绪时隐藏图片并显示（与瀑布流加载指示器同款），就绪后滑入消失
    const showImgLoading = () => {
        if (lightboxImgLoading) lightboxImgLoading.classList.add('is-active');
    };
    const hideImgLoading = () => {
        if (lightboxImgLoading) lightboxImgLoading.classList.remove('is-active');
    };

    // 图片加载失败（404/CDN 异常）：仍显示全部元信息，避免灯箱整片空白
    lightboxImg.addEventListener('error', () => {
        hideImgLoading();
        revealMain();
    });

    // 收集当前页面所有可预览的作品
    function collectPhotos() {
        const wrappers = document.querySelectorAll('.photo-wrapper');
        currentPhotos = [];
        wrappers.forEach(wrapper => {
            const img = wrapper.querySelector('img');
            if (!img || !img.getAttribute('src')) return; // 未揭示的作品还没有 src（无限滚动尚未加载），跳过——箭头仅停留在已加载的最后一张
            const item = wrapper.closest('.masonry-item');
            if (item && item.classList.contains('is-hidden')) return; // 被当前筛选隐藏的作品不进箭头集合
            // [data-title] 通用化：兼容 photo-card 与系列叙事块两种根元素
            const card = wrapper.closest('[data-title]');
            currentPhotos.push({
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
                lens: meta.shortLens(card ? (card.dataset.lens || '') : '')
            });
        });
    }

    // 照片 URL 同步（与筛选共用 pushQueryState：地址栏实时更新、返回键回退历史、
    // 规范化比较防乱序参数误推）——打开/切换写入 ?p=、关闭删除，其余参数自动保留
    const syncPhotoUrl = (slug) => {
        pushQueryState({ p: slug || null });
    };

    // 预加载左右邻居（保留 Image 引用：切图时用于同步探测缓存状态，避免重复请求）
    const preloadCache = new Map();
    function preload(url) {
        if (!url) return;
        // 已就绪的条目直接复用；失败过的条目（complete 但 naturalWidth=0）
        // 换新 Image 重试——否则一次瞬时失败会让该照片整个会话缓存探针恒为 false
        const existing = preloadCache.get(url);
        if (isImageReady(existing)) return;
        const img = new Image();
        img.src = url;
        preloadCache.set(url, img);
    }

    // 元信息面板渲染（独立模块见 lightbox-meta.js）：简行/EXIF/胶囊填充
    const meta = initLightboxMeta({
        tagsEl,
        metaEl: lightboxMeta,
        metaPlaceEl: lightboxMetaPlace,
        metaDateEl: lightboxMetaDate,
        exifList
    });

    // 毛玻璃背景层（独立模块见 lightbox-backdrop.js）：层栈/淡入淡出/剪枝
    const backdrop = initLightboxBackdrop({
        container: lightbox,
        insertBefore: backdropInsertBefore,
        reducedMotion
    });

    // 新图滑入归位并淡入（切换路径共用）；毛玻璃背景已在滑出开始同步切换
    // （见 open 的 isSwitch 分支）：旧层淡出与图片切换同刻开始、新层就绪后
    // 淡入，背景变化贯穿整个切换过程
    function startSlideIn(p) {
        hideImgLoading();
        mainSlideStarted = true;
        // 主图滑入归位并淡入
        lightboxImg.style.transition = slideTransition;
        lightboxImg.style.transform = 'translateX(0)';
        lightboxImg.style.opacity = '1';
        // 辉光位置立即归位（不参与滑入移动——自己滑入会晚于主图到达中间），
        // 滑入期间保持隐藏、滑入完成后才淡入（见 slideInDone）——防止辉光在
        // 落点先于主图显现的残影拖尾，也不得先于主图独自淡入（悬浮模糊残影）；
        // reduced-motion 无滑入过渡（transitionend 不触发），就绪即淡入
        if (activeGlow) {
            activeGlow.style.transition = 'none';
            activeGlow.style.transform = 'scale(2)'; // 归位（scale 并入 transform，见 slideStyle）
            if (reducedMotion && activeGlow._ready) {
                fadeGlowIn(activeGlow);
                glow.schedulePrune();
            } else {
                activeGlow.style.opacity = '0';
            }
        }
        if (reducedMotion) {
            // 减弱动态：无滑入过渡（transitionend 不触发）——直接收尾，
            // 辉光淡入由上方 reduced 分支的 fadeGlowIn 处理
            switching = false;
            lightboxImg.style.transform = '';
            lightboxImg.style.transition = '';
            return;
        }
        lightboxImg.addEventListener('transitionend', function slideInDone() {
            lightboxImg.removeEventListener('transitionend', slideInDone);
            switching = false;
            // 主图滑入完成：辉光就绪则淡入（就绪晚到的由 attachGlowReady 补淡）
            if (activeGlow && activeGlow._ready) {
                fadeGlowIn(activeGlow);
                glow.schedulePrune();
            }
            // 只收尾主图（保留内联 opacity=1，CSS 基础值为 0）：辉光的透明度
            // 由就绪门控独立管理，此处不触碰——避免覆盖未就绪的隐藏态
            lightboxImg.style.transform = '';
            lightboxImg.style.transition = '';
            lightboxImg.style.opacity = '1';
        });
    }

    // 渲染整个元信息面板（标题 / 分类与系列胶囊 / 简行 / EXIF 分行 / 直方图与色卡 / 故事）
    function renderPanel(p) {
        if (lightboxCaption) lightboxCaption.textContent = p.title;
        meta.render(p);
        if (storyWrap) storyWrap.style.display = p.description ? '' : 'none';
        if (storyEl) storyEl.textContent = p.description || '';
        // 分析按需加载：仅在展开态触发（收起态不发探测请求、不占主线程）；
        // 展开切图时旧图表保持显示，新数据就绪后按既有形变过渡替换
        if (analysisWrap && analysisWrap.classList.contains('is-open')) {
            analysis.analyze(p.src);
        }
        // 切图保持信息栏滚动位置（不回到顶部）：内容高度变化时浏览器自动把
        // scrollTop 钳制到新范围，抽屉的虚拟位置模型（展开程度 × 行程 + scrollTop）
        // 随之停在原位；箭头状态按当前 scrollTop 显式刷新（内容变化后可能
        // 不触发 scroll 事件）
        drawer.refresh();
    }

    function open(index, fromPx) {
        if (!currentPhotos.length) collectPhotos();
        if (index < 0 || index >= currentPhotos.length) return;
        swipe.reset(); // 复位滑动内联残留（拖动中关闭后重开图片错位的根源）
        const isSwitch = lightbox.classList.contains('active');
        // 方向必须在更新 currentIndex 之前计算（与旧索引比较）
        const dir = isSwitch
            ? (index === (currentIndex + 1) % currentPhotos.length ? 1 : -1)
            : 1;
        currentIndex = index;
        const p = currentPhotos[index];
        if (p.slug) syncPhotoUrl(p.slug); // 照片 URL：?p=slug（保留筛选等其余参数）
        // 窄屏（≤1000px，与抽屉断点一致）灯箱主图改用 w_1280：手机屏约 1080px
        // 宽、观感无差；w_1920 的首次光栅化与背景淡入同窗争抢合成器是旧版
        // Chromium 暗角恢复卡顿的剩余尖峰——桌面保持 w_1920
        const displaySrc = (photo) => (narrowLightbox.matches && photo.srcNarrow) || photo.src;
        const src = displaySrc(p);

        if (currentPhotos.length > 1) {
            const nextSrc = displaySrc(currentPhotos[(currentIndex + 1) % currentPhotos.length]);
            const prevSrc = displaySrc(currentPhotos[(currentIndex - 1 + currentPhotos.length) % currentPhotos.length]);
            // 只保留当前图与左右邻居的预载引用：防止长时间翻看累积解码位图（每张 w_1920 约 10MB）
            preloadCache.forEach((_, url) => {
                if (url !== src && url !== nextSrc && url !== prevSrc) {
                    preloadCache.delete(url);
                }
            });
            preload(nextSrc);
            preload(prevSrc);
        }

        if (isSwitch) {
            // 切换作品：旧图轻微滑出（12%）并淡出 →
            // 换内容 → 新图从另一侧轻微滑入归位并淡入；
            // 毛玻璃背景在滑出开始即同步切换（对齐参考站：旧层立即淡出、
            // 新层就绪后淡入），背景变化贯穿整个切换过程。
            // 新图未缓存时浏览器在 src 加载期间仍显示旧图——隐藏图片并转圈，
            // 加载完成后再滑入（与瀑布流加载指示器同款）
            const cachedImg = preloadCache.get(src);
            const cached = isImageReady(cachedImg);

            // 切换开始即复位主图揭示标志：滑出期间辉光就绪只登记、不得淡入——
            // 否则缓存命中的新辉光会在旧图滑出途中就地显现（switching 要等
            // 滑出结束才置位、mainSlideStarted 残留上一次的 true，门控会被穿过），
            // 尾部叠出双影
            mainSlideStarted = false;
            // 收起补偿若在途（收起 0.4s 窗口内切图），立即摘除——其锚点是旧照片
            // 的 preClickTop/wrapH0，继续运行会把新照片的标题/面板拉到旧位移
            cancelCenterComp();

            slideStyle(-dir * 12, '0', slideTransition, fromPx);

            // 摘除上一次切换的在途滑出监听（快速同向连切时不重放旧作品）
            clearPendingSlideOut();

            // 背景毛玻璃随滑出开始切换（对齐参考站）：旧层立即淡出 0.7s、新层
            // 就绪后淡入 0.7s——旧层不保持等待，背景变化与图片切换同刻开始、
            // 贯穿整个切换过程
            backdrop.switchTo(p.thumb || p.src);

            // 新建辉光层（在滑出开始即创建：0 态在 0.25s 滑出期间提交、解码
            // 提前开始；旧辉光层已随滑出淡出，新层就绪后随主图淡入、旧层剪枝；
            // iOS 跳过辉光——见 iOSGlowDisabled）
            if (lightboxImgArea && !iOSGlowDisabled) {
                activeGlow = spawnGlow(p.thumb || p.src);
            }

            // 换内容（滑出完成）：新图在进入侧待命（辉光层经 slideStyle 同步
            // 就位入口侧；mainSlideStarted 已在切换开始复位，辉光淡入由
            // startSlideIn 门控）
            const swapIn = () => {
                switching = true; // 滑入期间 onLoad 不强制透明度
                slideStyle(dir * 12, '0', 'none');
                lightboxImg.src = src;
                lightboxImg.alt = p.alt;
                renderPanel(p);
                lightboxImg.offsetHeight; // 强制 reflow

                // 主图元素自身已解码才直接滑入；HTTP 已缓存但解码未完成时同样
                // 等 load（不转圈）——按预载引用判定会先滑入空框、内容到达时
                // 在淡入中途突现（移动端解码慢时尤为明显）
                if (isImageReady(lightboxImg)) {
                    startSlideIn(p);
                } else {
                    // 未就绪：隐藏图片（仍在显示旧图）并转圈，加载完成后再滑入。
                    // 监听以模块级引用登记：新切换/关闭灯箱时先摘除旧对，防止陈旧
                    // 闭包用旧作品重放滑入
                    clearPendingSwitch();
                    lightboxImg.style.opacity = '0';
                    if (!cached) showImgLoading(); // HTTP 未就绪才转圈；已缓存仅等解码
                    pendingSwitch = {
                        load: () => {
                            clearPendingSwitch();
                            startSlideIn(p);
                        },
                        error: () => {
                            clearPendingSwitch();
                            hideImgLoading();
                            startSlideIn(p); // 加载失败：元信息照常，滑入后显示失败占位
                        }
                    };
                    lightboxImg.addEventListener('load', pendingSwitch.load);
                    lightboxImg.addEventListener('error', pendingSwitch.error);
                }
            };

            if (reducedMotion) {
                // 减弱动态：滑出过渡为 none（transitionend 不触发）——跳过滑出
                // 等待直接换图；滑出位移从未渲染（同一任务内完成换图）
                swapIn();
            } else {
                lightboxImg.addEventListener('transitionend', pendingSlideOut = function slideOutDone() {
                    lightboxImg.removeEventListener('transitionend', slideOutDone);
                    pendingSlideOut = null;
                    swapIn();
                });
            }
        } else {
            lightboxImg.style.opacity = '0';
            closeGlow(); // 清空残留辉光层（关闭灯箱时通常已清空，兜底）
            mainSlideStarted = false; // 首开复位：辉光不得先于主图揭示淡入
            // 新建当前辉光层（隐藏）：主图就绪后随其淡入（见 revealMain）；
            // iOS 跳过辉光——见 iOSGlowDisabled
            if (lightboxImgArea && !iOSGlowDisabled) {
                activeGlow = spawnGlow(p.thumb || p.src);
            }
            renderPanel(p);
            // 在灯箱激活前重置抽屉为收起态：避免旧展开状态先显示一帧导致图片大小反弹
            drawer.reset();
            // 元信息与图片同步：先全部隐藏，图片加载完成后随照片一起淡入
            revealSynced.forEach((el) => { el.style.opacity = '0'; });

            lightboxImg.src = src;
            lightboxImg.alt = p.alt;
            backdrop.open(p.thumb || p.src);
            lightbox.classList.add('active');
            drawer.refreshFit(); // 激活后强制重判「放得下」：关灯箱重置期间的 is-fit 状态可能过期
            document.body.style.overflow = 'hidden';

            // 首开未缓存：转圈等待（缓存命中时 complete 立即为真，无需转圈）
            if (!isImageReady(lightboxImg)) {
                showImgLoading();
            }
            if (lightboxImg.complete) {
                lightboxImg.style.opacity = '1';
                hideImgLoading();
                revealMain();
            } else {
                lightboxImg.addEventListener('load', function onLoad() {
                    lightboxImg.removeEventListener('load', onLoad);
                    // 切换动画进行中不强制透明度（slideIn 过渡会将其归位）——
                    // 否则慢图恰在滑出期间加载完成时会闪一下满透明覆盖过渡
                    if (!switching) lightboxImg.style.opacity = '1';
                    hideImgLoading();
                    revealMain();
                });
            }
        }
        updateArrows();
    }

    // 关闭灯箱时静默重置分析区为收起态（不带动画、不发请求）：下次打开
    // 延续「默认收起、点击才加载」的按需约定；同会话切图仍保持展开态
    function resetAnalysisState() {
        if (!analysisTrigger || !analysisWrap) return;
        analysisTrigger.setAttribute('aria-expanded', 'false');
        analysisTrigger.classList.remove('is-open');
        analysisWrap.setAttribute('aria-hidden', 'true');
        analysisWrap.classList.remove('is-open');
        analysisWrap.style.maxHeight = ''; // 清除开合残留内联
        drawer.setFitAdjuster(null);
        cancelCenterComp();
    }

    function close() {
        lightbox.classList.remove('active');
        resetAnalysisState(); // 展开的分析区随灯箱关闭收起：下次打开默认收起
        hideImgLoading();
        switching = false; // 转圈期关闭：残留的 switching 会阻塞下次首开的透明度恢复
        clearPendingSwitch(); // 摘除在途切图监听，防陈旧闭包在下一次打开时重放
        clearPendingSlideOut(); // 在途滑出结束监听一并作废（关闭重开不残留陈旧重放）
        cancelCenterComp(); // 关闭打断收起补偿：摘除 transform，不残留到下次打开
        backdrop.clear(); // 移除所有背景层（下次首开重建，不残留旧作品背景）
        closeGlow(); // 移除所有辉光层（下次首开重建，不残留旧作品辉光）
        swipe.reset(); // 作废在途滑动手势与内联样式残留
        syncPhotoUrl(''); // 关闭移除 ?p= 参数（保留筛选参数）
        lightboxImg.style.opacity = '0';
        document.body.style.overflow = '';
    }

    function prev(fromPx) {
        // 无条件重建：SPA 换页后旧列表已指向销毁的网格，必须先收集再取模
        collectPhotos();
        if (currentPhotos.length <= 1) {
            // 单张作品：切换无意义——滑动提交走到这里时 open() 不执行，
            // 走回弹动画归位（原地 reset 会从拖动位移瞬间跳回）
            swipe.snapBack();
            return;
        }
        const idx = (currentIndex - 1 + currentPhotos.length) % currentPhotos.length;
        open(idx, fromPx);
    }

    function next(fromPx) {
        collectPhotos();
        if (currentPhotos.length <= 1) {
            swipe.snapBack(); // 同 prev：单照片集合滑动提交回弹归位
            return;
        }
        const idx = (currentIndex + 1) % currentPhotos.length;
        open(idx, fromPx);
    }

    function updateArrows() {
        if (!btnPrev || !btnNext) return;
        const hasMultiple = currentPhotos.length > 1;
        btnPrev.style.display = hasMultiple ? '' : 'none';
        btnNext.style.display = hasMultiple ? '' : 'none';
    }

    // 标题与简行的透明度恢复（图片就绪路径共用）
    function revealOverlayText() {
        revealSynced.forEach((el) => { el.style.opacity = '1'; });
    }

    // 主图揭示（首开就绪/失败路径共用）：辉光随主图一起淡入——已就绪立即淡入，
    // 未就绪保持隐藏、就绪后由 attachGlowReady 的监听淡入（不先于主图）
    function revealMain() {
        mainSlideStarted = true;
        if (activeGlow) {
            if (activeGlow._ready) {
                fadeGlowIn(activeGlow);
                glow.schedulePrune();
            } else {
                activeGlow.style.transition = 'none';
                activeGlow.style.opacity = '0';
            }
        }
        revealOverlayText();
    }

    // 点击作品打开
    document.addEventListener('click', (e) => {
        if (e.target.closest('a')) return; // 链接点击（站内链接等）不触发灯箱
        const wrapper = e.target.closest('.photo-wrapper');
        if (!wrapper) return;
        const img = wrapper.querySelector('img');
        if (!img) return;
        collectPhotos();
        const index = currentPhotos.findIndex(p => p.src === (img.dataset.fullSrc || img.src));
        if (index >= 0) open(index);
    });

    // 关闭
    if (lightboxClose) lightboxClose.addEventListener('click', close);

    // 图像分析按需加载：触发行展开、区域底部收起按钮收起
    // （初始收起态由模板类/aria 属性就位，无需 JS 初始化）
    if (analysisTrigger) {
        analysisTrigger.addEventListener('click', () => setAnalysisOpen(true));
    }
    if (analysisCollapse) {
        analysisCollapse.addEventListener('click', () => setAnalysisOpen(false));
    }

    // 分类/系列胶囊：点击关闭灯箱（跳转由 SPA 常规拦截处理）
    if (tagsEl) {
        tagsEl.addEventListener('click', (e) => {
            if (e.target.closest('a')) close();
        });
    }

    // 箭头按钮
    if (btnPrev) btnPrev.addEventListener('click', e => { e.stopPropagation(); prev(); });
    if (btnNext) btnNext.addEventListener('click', e => { e.stopPropagation(); next(); });

    // 键盘
    document.addEventListener('keydown', e => {
        if (!lightbox.classList.contains('active')) return;
        if (e.key === 'Escape') close();
        if (e.key === 'ArrowLeft') prev();
        if (e.key === 'ArrowRight') next();
    });

    closeLightboxRef = close;

    inited = true;
}

/* 从 URL 恢复灯箱（?p=照片 slug）：页面加载/SPA 跳转后由 main.js 调用——
   经文档级点击监听触发 open（initLightbox 已绑定、幂等）。
   仅能恢复已渲染（有 src）的作品——无限滚动隐藏批次外照片、深位置不恢复 */
export function openLightboxFromUrl() {
    const slug = new URLSearchParams(location.search).get('p');
    if (!slug) return;
    const card = document.querySelector(`.photo-card[data-slug="${CSS.escape(slug)}"]`);
    const wrapper = card ? card.querySelector('.photo-wrapper') : null;
    if (!wrapper) return;
    wrapper.click();
}
