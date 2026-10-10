import { initPanelDrawer } from './lightbox-drawer.js';
import { initPhotoAnalysis } from './lightbox-analysis.js';
import { prefersReducedMotion, isImageReady } from './utils.js';

let inited = false;

// 镜头型号展示缩减：仅保留到光圈值（f/x-x）为止，其后的字母/系列后缀
// （VR、S、Di III VC VXD…）不展示——photo.toml 原始记录不动，仅灯箱展示截断
const shortLens = (lens) => {
    const m = lens.match(/f\/\d+(?:[.,]\d+)?(?:[-–]\d+(?:[.,]\d+)?)?/i);
    return m ? lens.slice(0, m.index + m[0].length) : lens;
};

export function initLightbox() {
    if (inited) return;

    const lightbox = document.getElementById('lightbox');
    const lightboxImg = document.getElementById('lightbox-img');
    const lightboxImgGlow = document.getElementById('lightbox-img-glow');
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
    const chartsWrap = document.getElementById('lightbox-charts');

    // 随图片同步淡入的元信息元素：打开时全部隐藏，图片加载完成后统一揭示——
    // 标题 / 分类与系列胶囊 / 地点日期简行 / EXIF / 分析触发行 / 直方图与色卡 / 影调与色彩 / 故事
    const revealSynced = [
        lightboxCaption, tagsEl, lightboxMeta, exifList, analysisTrigger,
        paletteWrap, tonalWrap, satWrap, hueWrap, storyWrap,
    ].filter(Boolean);

    if (!lightbox || !lightboxImg) return;

    // 背景层的插入点：顶栏之前（层按 DOM 顺序叠放，新层在后、天然压在上层）
    const backdropInsertBefore = lightbox.querySelector('.lightbox-topbar');

    // 窄屏/中屏底部抽屉（≤1000px）：展开/收起、滚轮与拖动手势（独立模块，见 lightbox-drawer.js）
    const drawer = initPanelDrawer({ lightbox, panel, panelDetails, panelToggle, metaEl: lightboxMeta });
    // 图片分析：色卡/影调与色彩（独立模块，见 lightbox-analysis.js；直方图
    // 已并入影调区块——RGB 通道曲线 + 三分区/P50/剪裁注释同图展示）
    const analysis = initPhotoAnalysis({
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

    // 分析区开合状态：默认收起（打开/切图不发探测请求）；展开态跨切图/
    // 关开保持——用户已选择查看分析，后续打开延续该选择
    let analysisOpen = false;

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
        step(); // 第一帧同步落位（点击当帧即连续，不闪跳变），后续 rAF 跟随
        centerCompRaf = requestAnimationFrame(step);
    }

    function setAnalysisOpen(open) {
        if (!analysisTrigger || !analysisWrap) return;
        analysisOpen = open;
        // 收起前标题位置：触发行即将复现（展开时触发行是平滑收拢，不收布局
        // 跳变；收起时 is-open 移除令其回归布局、居中块位移约半行）——须在
        // 触发行 class 切换前实测（切换后旧位置即丢失），供收起补偿回原位
        const preClickTop = !open && lightboxCaption && !reducedMotion
            ? lightboxCaption.getBoundingClientRect().top
            : null;
        analysisTrigger.setAttribute('aria-expanded', open ? 'true' : 'false');
        analysisTrigger.classList.toggle('is-open', open);
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
                // 当前高度）重判 is-fit——放得下则从第一帧起居中收缩、标题从点击前
                // 位置平滑滑向居中位（位置补偿消除翻转瞬间的向上跳变）
                const willFit = drawer.setFitAdjuster(() => analysisWrap.clientHeight);
                if (willFit && preClickTop !== null) startCenterComp(preClickTop);
                analysisWrap.addEventListener('transitionend', function collapseEnd(e) {
                    if (e.propertyName !== 'max-height') return; // opacity 结束不处理
                    analysisWrap.removeEventListener('transitionend', collapseEnd);
                    analysisWrap.style.maxHeight = ''; // 清除内联、恢复 class 的 0 基线
                    drawer.setFitAdjuster(null); // 收起完成：恢复常规判定
                    cancelCenterComp(); // 滑动至最终居中位：摘除 transform（布局已居中）
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
    // 与参考站一致）、新层就绪后淡入（0.7s）；新层淡入后约 750ms 移除所有旧层
    let backdropLayers = []; // 裸元素数组：最新层 = 末位；状态仅元素上的 _shown 标志
    let backdropPruneTimer = null;

    // 滑动动画同时作用于主图与辉光层：辉光随主图一起移动与淡入淡出
    const slideStyle = (transform, opacity, transition) => {
        lightboxImg.style.transform = transform;
        lightboxImg.style.opacity = opacity;
        if (transition !== undefined) lightboxImg.style.transition = transition;
        if (lightboxImgGlow) {
            lightboxImgGlow.style.transform = transform;
            lightboxImgGlow.style.opacity = opacity;
            if (transition !== undefined) lightboxImgGlow.style.transition = transition;
        }
    };

    // 在途切图监听（load/error 成对）：新切换前先摘除旧对，避免陈旧闭包重放
    let pendingSwitchLoad = null;
    let pendingSwitchError = null;
    const clearPendingSwitch = () => {
        if (pendingSwitchLoad) {
            lightboxImg.removeEventListener('load', pendingSwitchLoad);
            pendingSwitchLoad = null;
        }
        if (pendingSwitchError) {
            lightboxImg.removeEventListener('error', pendingSwitchError);
            pendingSwitchError = null;
        }
    };

    // 在途辉光监听（load/error 共用同一回调）：辉光内容未解码时保持隐藏，
    // 解码完成后随主图一起淡入——移动端解码慢时若随滑入先淡入空框、内容
    // 到达时突现，边缘暗角变化会出现明显断点；主图仍在加载时辉光同样保持
    // 隐藏（独自淡入会呈现悬浮的模糊残影）；error 视为就绪（内容缺失时
    // 边缘保持暗，不残留隐藏态）
    let pendingGlowLoad = null;
    const clearPendingGlow = () => {
        if (pendingGlowLoad) {
            if (lightboxImgGlow) {
                lightboxImgGlow.removeEventListener('load', pendingGlowLoad);
                lightboxImgGlow.removeEventListener('error', pendingGlowLoad);
            }
            pendingGlowLoad = null;
        }
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

    let glowDecoded = false; // 辉光内容是否已就绪（解码完成或加载失败）
    let mainSlideStarted = false; // 主图是否已开始滑入（辉光不得先于主图淡入）
    // 减弱动态偏好：滑出/滑入/辉光/背景的内联过渡全部直切（内联样式优先级高于
    // CSS 媒体查询，无法靠样式表关闭——与全站各动画模块的 reduced-motion 约定一致）
    const reducedMotion = prefersReducedMotion();
    const slideTransition = reducedMotion ? 'none' : 'transform 0.25s ease, opacity 0.25s ease';
    const glowTransition = reducedMotion ? 'none' : 'opacity 0.25s ease';
    const fadeGlowIn = () => {
        // 辉光只做透明度淡入，不做自己的滑入移动：位置已在 startSlideIn 立即
        // 归位——若从侧边自行滑入，解码晚于主图时会明显晚于主图到达中间（不同步）
        lightboxImgGlow.style.transition = glowTransition;
        lightboxImgGlow.style.opacity = '1';
    };

    // 图片加载转圈：新图未就绪时隐藏图片与辉光并显示（与瀑布流加载指示器同款），就绪后滑入消失
    const showImgLoading = () => {
        if (lightboxImgLoading) lightboxImgLoading.classList.add('is-active');
        if (lightboxImgGlow) lightboxImgGlow.style.opacity = '0'; // 加载期间辉光同藏，不残留旧图轮廓
    };
    const hideImgLoading = () => {
        if (lightboxImgLoading) lightboxImgLoading.classList.remove('is-active');
        if (lightboxImgGlow) lightboxImgGlow.style.opacity = '';
    };

    // 图片加载失败（404/CDN 异常）：仍显示全部元信息，避免灯箱整片空白
    lightboxImg.addEventListener('error', () => {
        hideImgLoading();
        revealOverlayText();
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
                src: img.dataset.fullSrc || img.src,
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
    }

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

    // 简略信息行：地点 / 日期（带图标，组间空格分隔）；空项隐藏，全空则隐藏整个区域。
    // 拍摄参数简行已整体移除（EXIF 由下方分行列表完整展示）——此前 setMeta 的内联
    // display:'' 会压过样式表的全局隐藏规则让它复活，中屏双列下其超长 nowrap 内容
    // 把第一列轨道撑宽，地点/日期列整体右移、与 EXIF 行错位
    function setMeta(p) {
        if (!lightboxMeta) return;
        const rows = [
            [lightboxMetaPlace, p.place],
            [lightboxMetaDate, p.date]
        ];
        let any = false;
        rows.forEach(([el, text]) => {
            if (!el) return;
            el.textContent = text || '';
            el.parentElement.style.display = text ? '' : 'none';
            if (text) any = true;
        });
        lightboxMeta.style.display = any ? '' : 'none';
    }

    // EXIF 分行列表：行结构（图标/标签）由模板渲染，这里只填值
    // （普通项空值隐藏；设备（相机）缺失时显示删除线占位「—」，
    //   镜头缺失时以英文 N/A 表示——删除线在长型号旁视觉不佳）
    // EXIF 行结构（图标/标签）由模板渲染，这里只填值——行配置与 li 列表
    // 恒定，初始化时一次建好，切图时不再重建
    const exifRows = [
        { key: 'camera', value: '', prefix: '', suffix: '', showMissing: true },
        { key: 'lens', value: '', prefix: '', suffix: '', showMissing: true, missingText: 'N/A' },
        { key: 'focus', value: '', prefix: '', suffix: 'mm' },
        { key: 'aperture', value: '', prefix: 'f/', suffix: '' },
        { key: 'shutter', value: '', prefix: '', suffix: 's' },
        { key: 'iso', value: '', prefix: 'ISO', suffix: '' }
    ];
    const exifLis = exifList ? Array.from(exifList.querySelectorAll('li')) : [];

    function renderExif(p) {
        if (!exifList) return;
        exifLis.forEach((li) => {
            const row = exifRows.find(r => r.key === li.dataset.exifKey);
            const valueEl = li.querySelector('.exif-value');
            if (!row) {
                li.style.display = 'none';
                return;
            }
            const value = p[row.key] || '';
            valueEl.classList.remove('is-missing');
            if (value) {
                li.style.display = '';
                valueEl.textContent = row.prefix + value + row.suffix;
            } else if (row.showMissing) {
                li.style.display = '';
                valueEl.textContent = row.missingText || '—';
                if (!row.missingText) valueEl.classList.add('is-missing');
            } else {
                li.style.display = 'none';
            }
        });
    }

    // 标题下方的分类/系列胶囊（点击跳转对应页面）
    function renderTags(p) {
        if (!tagsEl) return;
        tagsEl.innerHTML = '';
        const pills = [];
        if (p.category && p.categoryUrl) pills.push({ text: p.category, url: p.categoryUrl });
        if (p.series && p.seriesUrl) pills.push({ text: p.series, url: p.seriesUrl });
        pills.forEach((t) => {
            const a = document.createElement('a');
            a.className = 'lightbox-tag';
            a.href = t.url;
            a.textContent = t.text;
            tagsEl.appendChild(a);
        });
        tagsEl.style.display = pills.length ? '' : 'none';
    }

    // 新建背景层：thumb 源 + blur 压暗（样式见 _lightbox.scss）；切图淡入淡出
    // 一律 0.7s cubic-bezier(0.4, 0, 0.2, 1)（参考站 duration-700 同款）。
    // 剪枝定时由时长推导（时长 + 50ms 余量）：两处魔数单源，改时长不脱节
    const BACKDROP_MS = reducedMotion ? 0 : 700;
    const backdropTransition = reducedMotion
        ? 'opacity 0s'
        : `opacity ${BACKDROP_MS}ms cubic-bezier(0.4, 0, 0.2, 1)`;
    const backdropPruneDelay = BACKDROP_MS + 50;
    const createBackdropEl = () => {
        const el = document.createElement('img');
        el.className = 'lightbox-backdrop';
        el.alt = '';
        el.setAttribute('aria-hidden', 'true');
        el.setAttribute('draggable', 'false');
        return el;
    };
    const appendBackdropEl = (el) => {
        lightbox.insertBefore(el, backdropInsertBefore || null);
    };

    // 只保留最新一层：旧层此时已完全淡出（0.7s < 750ms），移除不可见
    const pruneBackdrops = () => {
        while (backdropLayers.length > 1) {
            backdropLayers.shift().remove();
        }
    };

    // 首开：清空上一轮残留，新建一层淡入当前作品（随灯箱容器 0.3s 一同淡入）。
    // 首开无上一层可回退：缩略图失败时该层保持透明（背景纯黑），属可接受降级
    function openBackdrop(src) {
        if (backdropPruneTimer) {
            clearTimeout(backdropPruneTimer);
            backdropPruneTimer = null;
        }
        backdropLayers.forEach((el) => el.remove());
        backdropLayers = [];
        const el = createBackdropEl();
        appendBackdropEl(el);
        el.src = src;
        el.offsetHeight; // 强制 reflow：让 opacity 走 CSS 过渡淡入
        el.style.opacity = '1';
        el._shown = true;
        backdropLayers.push(el);
    }

    // 切图（对齐参考站灯箱机制）：旧层**立即**淡出 0.7s（不等新层就绪，
    // 加载慢时背景短暂为纯黑底）、新层就绪后淡入 0.7s——淡出与图片切换同刻开始，
    // 背景变化贯穿整个切换过程；新层加载失败时丢弃该层并让上一层淡回显示。
    // 层模型为裸元素数组（最新层即数组末位），唯一状态标志是元素的 _shown
    // （是否已完成过淡入）——show 守卫 = 「仍是最新层且未显示过」，被更新的
    // 切换取代或已被剪枝的层自然失效；回调只操作本层元素，无跨层状态可翻转
    function switchBackdrop(src) {
        if (backdropPruneTimer) {
            clearTimeout(backdropPruneTimer);
            backdropPruneTimer = null;
        }
        backdropLayers.forEach((layerEl) => {
            layerEl.style.transition = backdropTransition;
            layerEl.style.opacity = '0';
        });
        const el = createBackdropEl();
        el.style.transition = backdropTransition;
        el.style.opacity = '0';
        el.src = src;
        appendBackdropEl(el);
        backdropLayers.push(el);
        const show = () => {
            // 守卫：已被更新的切换取代（不再是末位）或已显示过（首开/同步
            // complete 路径）则不再执行——被剪枝的层同样不在数组中
            if (el._shown || backdropLayers[backdropLayers.length - 1] !== el) return;
            el._shown = true;
            // 强制 reflow 让 opacity 0 先生效：缓存图 complete 同步为真时（同一帧内
            // 0→1 变化不触发过渡）同样走 0.7s 淡入
            el.offsetHeight;
            el.style.opacity = '1';
            backdropPruneTimer = setTimeout(pruneBackdrops, backdropPruneDelay);
        };
        if (isImageReady(el)) {
            show();
        } else {
            el.addEventListener('load', show, { once: true });
            el.addEventListener('error', () => {
                const idx = backdropLayers.indexOf(el);
                if (idx < 0) return;
                backdropLayers.splice(idx, 1);
                el.remove();
                if (idx === backdropLayers.length) {
                    // 失败的是最新层：上一层淡回显示。若上一层已显示过直接淡回并
                    // 补设剪枝定时；若其仍在加载（_shown 未置），它的 show 监听
                    // 仍挂在元素上——此时它已成为最新层、守卫放行，解码完成后
                    // 自然走 show 的淡入与剪枝，无需在这里重复触发
                    const prev = backdropLayers[backdropLayers.length - 1];
                    if (prev && prev._shown) {
                        prev.style.transition = backdropTransition;
                        prev.style.opacity = '1';
                        backdropPruneTimer = setTimeout(pruneBackdrops, backdropPruneDelay);
                    }
                }
            }, { once: true });
        }
    }

    // 关闭：移除所有背景层（下次首开重建，不残留旧作品背景）
    function closeBackdrop() {
        if (backdropPruneTimer) {
            clearTimeout(backdropPruneTimer);
            backdropPruneTimer = null;
        }
        backdropLayers.forEach((el) => el.remove());
        backdropLayers = [];
    }

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
        // 仅在内容就绪时淡入；未就绪时保持隐藏（解码完成后由 pendingGlowLoad
        // 淡入）——防止空框先淡入、内容到达时突现的暗角断点，也不得先于主图
        // 独自淡入（悬浮模糊残影）
        if (lightboxImgGlow) {
            lightboxImgGlow.style.transition = 'none';
            lightboxImgGlow.style.transform = 'translateX(0)';
            if (glowDecoded || isImageReady(lightboxImgGlow)) {
                glowDecoded = true;
                fadeGlowIn();
            } else {
                lightboxImgGlow.style.opacity = '0';
            }
        }
        lightboxImg.addEventListener('transitionend', function slideInDone() {
            lightboxImg.removeEventListener('transitionend', slideInDone);
            switching = false;
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
        renderTags(p);
        setMeta(p);
        renderExif(p);
        if (storyWrap) storyWrap.style.display = p.description ? '' : 'none';
        if (storyEl) storyEl.textContent = p.description || '';
        // 分析按需加载：仅在展开态触发（收起态不发探测请求、不占主线程）；
        // 展开切图时旧图表保持显示，新数据就绪后按既有形变过渡替换
        if (analysisOpen) {
            analysis.analyze(p.src);
        }
        // 切图保持信息栏滚动位置（不回到顶部）：内容高度变化时浏览器自动把
        // scrollTop 钳制到新范围，抽屉的虚拟位置模型（展开程度 × 行程 + scrollTop）
        // 随之停在原位；箭头状态按当前 scrollTop 显式刷新（内容变化后可能
        // 不触发 scroll 事件）
        drawer.refresh();
    }

    function open(index) {
        if (!currentPhotos.length) collectPhotos();
        if (index < 0 || index >= currentPhotos.length) return;
        const isSwitch = lightbox.classList.contains('active');
        // 方向必须在更新 currentIndex 之前计算（与旧索引比较）
        const dir = isSwitch
            ? (index === (currentIndex + 1) % currentPhotos.length ? 1 : -1)
            : 1;
        currentIndex = index;
        const p = currentPhotos[index];

        if (currentPhotos.length > 1) {
            const nextSrc = currentPhotos[(currentIndex + 1) % currentPhotos.length].src;
            const prevSrc = currentPhotos[(currentIndex - 1 + currentPhotos.length) % currentPhotos.length].src;
            // 只保留当前图与左右邻居的预载引用：防止长时间翻看累积解码位图（每张 w_1920 约 10MB）
            preloadCache.forEach((_, url) => {
                if (url !== p.src && url !== nextSrc && url !== prevSrc) {
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
            const cachedImg = preloadCache.get(p.src);
            const cached = isImageReady(cachedImg);

            slideStyle(`translateX(${-dir * 12}%)`, '0', slideTransition);

            // 摘除上一次切换的在途滑出监听（快速同向连切时不重放旧作品）
            clearPendingSlideOut();

            // 背景毛玻璃随滑出开始切换（对齐参考站）：旧层立即淡出 0.7s、新层
            // 就绪后淡入 0.7s——旧层不保持等待，背景变化与图片切换同刻开始、
            // 贯穿整个切换过程
            switchBackdrop(p.thumb || p.src);

            lightboxImg.addEventListener('transitionend', pendingSlideOut = function slideOutDone() {
                lightboxImg.removeEventListener('transitionend', slideOutDone);
                pendingSlideOut = null;
                switching = true; // 滑入期间 onLoad 不强制透明度

                // 换内容：新图在进入侧待命
                slideStyle(`translateX(${dir * 12}%)`, '0', 'none');
                lightboxImg.src = p.src;
                lightboxImg.alt = p.alt;
                if (lightboxImgGlow) {
                    lightboxImgGlow.src = p.thumb || p.src; // 辉光层随主图同步切换
                    void lightboxImgGlow.offsetHeight; // 强制重排：iOS Safari 过滤图换源需重绘提交，否则模糊闪帧/消失
                    clearPendingGlow();
                    glowDecoded = false;
                    mainSlideStarted = false;
                    if (isImageReady(lightboxImgGlow)) {
                        glowDecoded = true;
                    } else {
                        // 辉光未解码：保持隐藏，解码完成后随主图一起淡入（主图仍在
                        // 加载时不得独自淡入，避免悬浮模糊残影）
                        pendingGlowLoad = () => {
                            clearPendingGlow();
                            glowDecoded = true;
                            if (mainSlideStarted) fadeGlowIn();
                        };
                        lightboxImgGlow.addEventListener('load', pendingGlowLoad);
                        lightboxImgGlow.addEventListener('error', pendingGlowLoad);
                    }
                }
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
                    pendingSwitchLoad = () => {
                        clearPendingSwitch();
                        startSlideIn(p);
                    };
                    pendingSwitchError = () => {
                        clearPendingSwitch();
                        hideImgLoading();
                        startSlideIn(p); // 加载失败：元信息照常，滑入后显示失败占位
                    };
                    lightboxImg.addEventListener('load', pendingSwitchLoad);
                    lightboxImg.addEventListener('error', pendingSwitchError);
                }
            });
        } else {
            lightboxImg.style.opacity = '0';
            if (lightboxImgGlow) lightboxImgGlow.style.opacity = '0';
            renderPanel(p);
            // 在灯箱激活前重置抽屉为收起态：避免旧展开状态先显示一帧导致图片大小反弹
            drawer.reset();
            // 元信息与图片同步：先全部隐藏，图片加载完成后随照片一起淡入
            revealSynced.forEach((el) => { el.style.opacity = '0'; });

            lightboxImg.src = p.src;
            lightboxImg.alt = p.alt;
            if (lightboxImgGlow) {
                lightboxImgGlow.src = p.thumb || p.src; // 辉光层随主图同步切换
                void lightboxImgGlow.offsetHeight; // 强制重排：iOS Safari 过滤图换源需重绘提交，否则模糊闪帧/消失
                // 与切图路径同款门控：辉光未解码时保持隐藏，解码完成后淡入——
                // 首开同样存在「淡入空框、内容突现」的暗角断点，不可绕过
                clearPendingGlow();
                glowDecoded = isImageReady(lightboxImgGlow);
                if (!glowDecoded) {
                    lightboxImgGlow.style.transition = 'none';
                    lightboxImgGlow.style.opacity = '0';
                    pendingGlowLoad = () => {
                        clearPendingGlow();
                        glowDecoded = true;
                        fadeGlowIn();
                    };
                    lightboxImgGlow.addEventListener('load', pendingGlowLoad);
                    lightboxImgGlow.addEventListener('error', pendingGlowLoad);
                }
            }
            openBackdrop(p.thumb || p.src);
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
                // 辉光未就绪时保持隐藏（hideImgLoading 清掉内联 opacity 会使其
                // 按 CSS 默认值 1 提前淡入空框）——解码完成后由 pendingGlowLoad 淡入
                if (lightboxImgGlow && !glowDecoded) {
                    lightboxImgGlow.style.transition = 'none';
                    lightboxImgGlow.style.opacity = '0';
                }
                revealOverlayText();
            } else {
                lightboxImg.addEventListener('load', function onLoad() {
                    lightboxImg.removeEventListener('load', onLoad);
                    // 切换动画进行中不强制透明度（slideIn 过渡会将其归位）——
                    // 否则慢图恰在滑出期间加载完成时会闪一下满透明覆盖过渡
                    if (!switching) lightboxImg.style.opacity = '1';
                    hideImgLoading();
                    if (lightboxImgGlow && !glowDecoded) {
                        lightboxImgGlow.style.transition = 'none';
                        lightboxImgGlow.style.opacity = '0';
                    }
                    revealOverlayText();
                });
            }
        }
        updateArrows();
    }

    // 关闭灯箱时静默重置分析区为收起态（不带动画、不发请求）：下次打开
    // 延续「默认收起、点击才加载」的按需约定；同会话切图仍保持展开态
    function resetAnalysisState() {
        if (!analysisTrigger || !analysisWrap) return;
        analysisOpen = false;
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
        clearPendingGlow(); // 在途辉光淡入一并作废（关闭重开不残留隐藏态）
        clearPendingSlideOut(); // 在途滑出结束监听一并作废（关闭重开不残留陈旧重放）
        cancelCenterComp(); // 关闭打断收起补偿：摘除 transform，不残留到下次打开
        closeBackdrop(); // 移除所有背景层（下次首开重建，不残留旧作品背景）
        lightboxImg.style.opacity = '0';
        if (lightboxImgGlow) lightboxImgGlow.style.opacity = '0';
        document.body.style.overflow = '';
    }

    function prev() {
        // 无条件重建：SPA 换页后旧列表已指向销毁的网格，必须先收集再取模
        collectPhotos();
        if (currentPhotos.length <= 1) return; // 单张作品：切换无意义（避免空闪动画）
        const idx = (currentIndex - 1 + currentPhotos.length) % currentPhotos.length;
        open(idx);
    }

    function next() {
        collectPhotos();
        if (currentPhotos.length <= 1) return;
        const idx = (currentIndex + 1) % currentPhotos.length;
        open(idx);
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

    inited = true;
}
