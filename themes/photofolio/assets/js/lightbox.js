import { initLightboxDrawer } from './lightbox-drawer.js';
import { initLightboxAnalysis } from './lightbox-analysis.js';
import { initLightboxSwipe } from './lightbox-swipe.js';
import { initLightboxMeta } from './lightbox-meta.js';
import { initLightboxBackdrop } from './lightbox-backdrop.js';
import { initLightboxGlow } from './lightbox-glow.js';
import { initLightboxCollection } from './lightbox-collection.js';
import { initLightboxSwitch } from './lightbox-switch.js';
import { initLightboxAnalysisControl } from './lightbox-analysis-control.js';
import { prefersReducedMotion } from './utils.js';

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

    // 减弱动态偏好：滑出/滑入/辉光/背景/分析区开合的内联过渡全部直切（内联样式
    // 优先级高于 CSS 媒体查询，无法靠样式表关闭——与全站各动画模块的约定一致）
    const reducedMotion = prefersReducedMotion();

    // 触屏滑动切图（先于 drawer 创建：方向仲裁直接注入、无需可变引用桥接；
    // getGlow/onSwitch 经惰性闭包指向 switchModule 方法——事件期才求值）
    const swipe = initLightboxSwipe({
        img: lightboxImg,
        area: lightboxImgArea,
        getGlow: () => switchModule.getActiveGlow(),
        onSwitch: (dir, dx) => { if (dir > 0) switchModule.next(dx); else switchModule.prev(dx); }
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

    // 辉光层（独立模块见 lightbox-glow.js）：层栈/就绪门控/淡入/剪枝
    const glow = initLightboxGlow({ reducedMotion });

    // 作品集合与预加载（独立模块见 lightbox-collection.js）：收集/邻居预载/照片 URL 同步
    const collection = initLightboxCollection({ shortLens: meta.shortLens });

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

    // 切换管线（独立模块见 lightbox-switch.js）：open/close/prev/next 状态机、
    // 滑入滑出动画、辉光编排——分析区开合经钩子由本文件接线（两模块互不引用）
    const switchModule = initLightboxSwitch({
        lightbox, lightboxImg, lightboxImgLoading, lightboxImgArea,
        btnPrev, btnNext, revealSynced, narrowLightbox, reducedMotion,
        collection, renderPanel,
        glow, backdrop, swipe, drawer,
        onSwitchStart: () => analysisControl.cancelCenterComp(),
        onClose: () => analysisControl.reset()
    });

    // 分析区开合控制（独立模块见 lightbox-analysis-control.js）：展开收起过渡、
    // 收起位置补偿、关闭静默重置——展开时分析当前照片（由本文件注入）
    const analysisControl = initLightboxAnalysisControl({
        trigger: analysisTrigger, wrap: analysisWrap,
        caption: lightboxCaption, tagsEl, panelDetails,
        reducedMotion, drawer,
        analyze: () => {
            const p = switchModule.current();
            if (p) analysis.analyze(p.src);
        }
    });

    // 点击作品打开
    document.addEventListener('click', (e) => {
        if (e.target.closest('a')) return; // 链接点击（站内链接等）不触发灯箱
        const wrapper = e.target.closest('.photo-wrapper');
        if (!wrapper) return;
        const img = wrapper.querySelector('img');
        if (!img) return;
        switchModule.openByImg(img);
    });

    // 关闭
    if (lightboxClose) lightboxClose.addEventListener('click', () => switchModule.close());

    // 图像分析按需加载：触发行展开、区域底部收起按钮收起
    // （初始收起态由模板类/aria 属性就位，无需 JS 初始化）
    if (analysisTrigger) {
        analysisTrigger.addEventListener('click', () => analysisControl.setOpen(true));
    }
    if (analysisCollapse) {
        analysisCollapse.addEventListener('click', () => analysisControl.setOpen(false));
    }

    // 分类/系列胶囊：点击关闭灯箱（跳转由 SPA 常规拦截处理）
    if (tagsEl) {
        tagsEl.addEventListener('click', (e) => {
            if (e.target.closest('a')) switchModule.close();
        });
    }

    // 箭头按钮
    if (btnPrev) btnPrev.addEventListener('click', e => { e.stopPropagation(); switchModule.prev(); });
    if (btnNext) btnNext.addEventListener('click', e => { e.stopPropagation(); switchModule.next(); });

    // 键盘
    document.addEventListener('keydown', e => {
        if (!lightbox.classList.contains('active')) return;
        if (e.key === 'Escape') switchModule.close();
        if (e.key === 'ArrowLeft') switchModule.prev();
        if (e.key === 'ArrowRight') switchModule.next();
    });

    closeLightboxRef = switchModule.close;

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
