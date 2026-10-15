/**
 * 灯箱切换管线（独立模块；集成见 lightbox.js）
 *
 * - open/close/prev/next 状态机与滑入滑出动画管线：切图时旧图轻微滑出
 *   （12% + 淡出）→ 换内容 → 新图从另一侧滑入归位并淡入，全程由
 *   slideStyle/startSlideIn/swapIn 编排；滑动提交经 fromPx 显式起点接入
 *   （slideStyle 双相提交，见其注释）；首开走 revealMain 揭示路径
 * - 辉光 activeGlow 编排（哪层随主图滑动/揭示、何时淡入）在本模块——
 *   层创建/就绪门控/淡入/剪枝仍在 lightbox-glow 模块
 * - 作品收集与邻居预载在 lightbox-collection 模块（无状态工具 + 预载缓存）；
 *   面板渲染 renderPanel 由调用方注入；分析区开合经 onSwitchStart/onClose
 *   钩子交给调用方接线（本模块不认识分析控制模块）
 */
import { isImageReady, loadWithAvifFallback } from './utils.js';
import { initLightboxZoom } from './lightbox-zoom.js';

export function initLightboxSwitch({
    lightbox, lightboxImg, lightboxImgLoading, lightboxImgArea,
    btnPrev, btnNext, revealSynced, narrowLightbox, reducedMotion,
    collection, renderPanel,
    glow, backdrop, swipe, drawer,
    closeBtn, pageRoots,
    onSwitchStart, onClose
}) {
    let currentPhotos = [];
    let currentIndex = -1;

    let switching = false; // 切换动画进行中（滑出/滑入期间 onLoad 不强制图片透明度，避免覆盖过渡）

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

    // 在途滑入结束监听（与滑出监听同槽位管理）：滑入 0.25s 内快速连切/关闭时
    // 陈旧监听会残留到下一次滑出/滑入的 transitionend——误触发会提前恢复裁剪、
    // 提前置 switching=false 并清空 transform 造成闪帧
    let pendingSlideIn = null;
    const clearPendingSlideIn = () => {
        if (pendingSlideIn) {
            lightboxImg.removeEventListener('transitionend', pendingSlideIn);
            pendingSlideIn = null;
        }
    };

    // 缩放换源后的 width/height 锁摘除监听（load）：换源后 load 事件为独立任务、
    // 与关闭/重开窗口竞态——摘除槽位防陈旧监听在下次打开时摘掉新锁；
    // once 触发即自摘除：若只清槽位不摘监听，幽灵监听会残留在 img 上、
    // 在后续打开/切图的每个 load 事件上重复摘锁（新开照片缩略图 load
    // 时锁刚上好即被摘掉——「打开显示小图、大图就绪后跳变」的根因）
    let pendingUnlock = null;
    const clearPendingUnlock = () => {
        if (pendingUnlock) {
            lightboxImg.removeEventListener('load', pendingUnlock);
            pendingUnlock = null;
        }
    };

    // 首开（非缩放路径）图片 load 监听：关闭后触发会把已关灯箱的透明度拨回、
    // 并在下次打开时提前揭示——槽位管理防残留
    let pendingFirstLoad = null;
    const clearPendingFirstLoad = () => {
        if (pendingFirstLoad) {
            lightboxImg.removeEventListener('load', pendingFirstLoad);
            pendingFirstLoad = null;
        }
    };

    // 缩放浮现进行中：其揭示由 zoom.onDone 负责——常驻 error 监听不得在
    // 缩放途中提前 revealMain（非 AVIF 环境 thumb 回退重试时的 error 会
    // 触发提前揭示）
    let zoomPending = false;

    let mainSlideStarted = false; // 主图是否已开始滑入/揭示（辉光不得先于主图淡入）
    const slideTransition = reducedMotion ? 'none' : 'transform 0.25s ease, opacity 0.25s ease';

    // iOS 上跳过辉光层（对齐参考站做法）：iOS Safari 对带 filter 的 img 换源/
    // 合成有一系列缺陷（闪帧、错位），逐案修补成本高且不稳定——照片无光晕
    // 直接显示，其余平台保持四边辉光。检测覆盖 iPadOS 的桌面 UA 伪装
    // （MacIntel + 触屏）
    const iOSGlowDisabled = /iP(hone|ad|od)/.test(navigator.userAgent) ||
        (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

    // 辉光层（层栈/就绪门控/淡入/剪枝见 lightbox-glow.js）：
    // activeGlow 编排（哪层随主图滑动/揭示、何时淡入）在本模块切换管线
    let activeGlow = null;
    const fadeGlowIn = (el) => glow.fadeIn(el);
    const spawnGlow = (src) => glow.spawn(lightboxImgArea, lightboxImg, src,
        (el) => el === activeGlow && mainSlideStarted && !switching);
    const closeGlow = () => {
        glow.clear();
        activeGlow = null;
    };

    // 首开缩放浮现动画（独立模块见 lightbox-zoom.js）：主图从缩略图视口矩形
    // FLIP 放大到居中布局位——start/cancel 由 open/close 编排
    const zoom = initLightboxZoom({ img: lightboxImg, area: lightboxImgArea, reducedMotion });

    // 打开代次：缩放浮现完成后的全尺寸换源前校验（快速连切/关闭期间
    // 换源作废，防旧照片覆盖当前显示）
    let openToken = 0;

    // dialog 语义：打开时焦点移入关闭按钮、背景页 inert（头部/主内容/页脚——
    // 灯箱在壳层不属其内）；关闭时先恢复背景、再把焦点还原到触发卡片
    //（SPA 导航关闭 keepUrl 不还原——页面内容即将替换）
    let opener = null;
    const enterDialog = () => {
        if (closeBtn) closeBtn.focus();
        if (pageRoots) pageRoots.forEach((el) => el.setAttribute('inert', ''));
    };
    const exitDialog = (restoreFocus) => {
        if (pageRoots) pageRoots.forEach((el) => el.removeAttribute('inert'));
        if (restoreFocus && opener) {
            const el = opener;
            opener = null;
            if (el.isConnected) el.focus({ preventScroll: true });
        } else {
            opener = null;
        }
    };

    // 图片加载转圈：新图未就绪时隐藏图片并显示（与瀑布流加载指示器同款），就绪后滑入消失
    const showImgLoading = () => {
        if (lightboxImgLoading) lightboxImgLoading.classList.add('is-active');
    };
    const hideImgLoading = () => {
        if (lightboxImgLoading) lightboxImgLoading.classList.remove('is-active');
    };

    // 图片加载失败（404/CDN 异常）：仍显示全部元信息，避免灯箱整片空白——
    // 缩放浮现进行中的揭示由 zoom.onDone 负责（error 只收起转圈，不提前揭示）
    lightboxImg.addEventListener('error', () => {
        hideImgLoading();
        if (!zoomPending) revealMain();
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
        lightboxImg.addEventListener('transitionend', pendingSlideIn = function slideInDone() {
            lightboxImg.removeEventListener('transitionend', slideInDone);
            pendingSlideIn = null;
            switching = false;
            if (lightboxImgArea) lightboxImgArea.style.overflow = ''; // 恢复裁剪（见 open 的 isSwitch 分支）
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

    function open(index, fromPx, zoomFrom) {
        if (!currentPhotos.length) currentPhotos = collection.collect();
        if (index < 0 || index >= currentPhotos.length) return;
        swipe.reset(); // 复位滑动内联残留（拖动中关闭后重开图片错位的根源）
        zoom.cancel(); // 作废在途缩放动画（含布局盒 width/height 锁与收尾回调残留）
        lightbox.style.transition = ''; // 缩放路径的容器直显内联残留（关闭淡出依赖样式表过渡）
        clearPendingSlideIn(); // 作废在途滑入收尾监听（防陈旧重放，见其声明注释）
        clearPendingUnlock(); // 作废上次换源的锁摘除监听
        clearPendingFirstLoad(); // 作废上次首开的 load 监听
        zoomPending = false; // 缩放进行标志复位（切换/普通首开路径不置位）
        openToken++;
        const isSwitch = lightbox.classList.contains('active');
        // 方向必须在更新 currentIndex 之前计算（与旧索引比较）
        const dir = isSwitch
            ? (index === (currentIndex + 1) % currentPhotos.length ? 1 : -1)
            : 1;
        currentIndex = index;
        const p = currentPhotos[index];
        // 照片 URL：?p=slug（保留筛选等其余参数）——首开 push、切图 replace：
        // 灯箱只占一个历史条目、返回键 = 关闭灯箱，翻看照片不刷历史
        collection.syncPhotoUrl(p.slug, isSwitch);
        // 窄屏（≤1000px，与抽屉断点一致）灯箱主图改用 w_1280：手机屏约 1080px
        // 宽、观感无差；w_1920 的首次光栅化与背景淡入同窗争抢合成器是旧版
        // Chromium 暗角恢复卡顿的剩余尖峰——桌面保持 w_1920
        const displaySrc = (photo) => (narrowLightbox.matches && photo.srcNarrow) || photo.src;
        const src = displaySrc(p);

        if (currentPhotos.length > 1) {
            // 预载窗口 = 当前 ± 左右各两位邻居（去重、排除当前图）：覆盖「翻走一张
            // 再回来」的来回翻看——走开两张后回翻仍在引用内、不重解位图/重新请求；
            // 严格限窗防长时间翻看累积解码位图（每张 w_1920 约 10MB、5 张 ≈ 50MB）
            const len = currentPhotos.length;
            const nextSrc = displaySrc(currentPhotos[(currentIndex + 1) % len]);
            const next2Src = displaySrc(currentPhotos[(currentIndex + 2) % len]);
            const prevSrc = displaySrc(currentPhotos[(currentIndex - 1 + len) % len]);
            const prev2Src = displaySrc(currentPhotos[(currentIndex - 2 + len) % len]);
            const neighbors = [...new Set([nextSrc, next2Src, prevSrc, prev2Src])].filter((u) => u !== src);
            collection.pruneKeep([src, ...neighbors]);
            neighbors.forEach((url) => collection.preload(url));
        }

        if (isSwitch) {
            // 切换作品：旧图轻微滑出（12%）并淡出 →
            // 换内容 → 新图从另一侧轻微滑入归位并淡入；
            // 毛玻璃背景在滑出开始即同步切换（对齐参考站：旧层立即淡出、
            // 新层就绪后淡入），背景变化贯穿整个切换过程。
            // 新图未缓存时浏览器在 src 加载期间仍显示旧图——隐藏图片并转圈，
            // 加载完成后再滑入（与瀑布流加载指示器同款）
            const cached = collection.isCached(src);

            // 切换开始即复位主图揭示标志：滑出期间辉光就绪只登记、不得淡入——
            // 否则缓存命中的新辉光会在旧图滑出途中就地显现（switching 要等
            // 滑出结束才置位、mainSlideStarted 残留上一次的 true，门控会被穿过），
            // 尾部叠出双影
            mainSlideStarted = false;
            // 收起补偿若在途（收起 0.4s 窗口内切图），立即摘除——其锚点是旧照片
            // 的 preClickTop/wrapH0，继续运行会把新照片的标题/面板拉到旧位移
            onSwitchStart();

            // 切换恒为揭示态：缩放未完成即切图时 zoom.onDone 被 cancel 作废、
            // 揭示未执行（面板文字停留 opacity:0）——恢复面板元素可见，
            // 与常规切换路径一致
            revealSynced.forEach((el) => {
                el.style.transition = '';
                el.style.opacity = '1';
            });

            slideStyle(-dir * 12, '0', slideTransition, fromPx);

            // 滑出/滑入期间放开图片区裁剪：图片越过面板区域完整显示——
            // 面板透明且文字在 DOM 后位、浮于图片之上（无遮挡冲突）；
            // 滑入完成恢复（见 startSlideIn 收尾）；reduced-motion 无动画、
            // 中间位移从未渲染、无需放开
            if (lightboxImgArea && !reducedMotion) {
                lightboxImgArea.style.overflow = 'visible';
            }

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
            // 元信息与图片同步：先全部隐藏，图片加载完成后随照片一起淡入——
            // 隐藏写入须无过渡（否则 1→0 淡出斜坡在容器直显时被看见：信息栏闪一下）
            revealSynced.forEach((el) => {
                el.style.transition = 'none';
                el.style.opacity = '0';
            });

            if (zoomFrom) {
                // 缩放浮现：视觉载体先用已缓存的网格缩略图（即时解码、零等待、
                // 无转圈）——容器跳过 0.3s 淡入直显（缩放动画本身就是揭示，
                // 关闭淡出保留）
                const thumbSrc = p.thumb || p.src;
                lightboxImg.src = thumbSrc;
                lightboxImg.alt = p.alt;
                lightboxImg.style.transition = 'none';
                if (isImageReady(lightboxImg)) {
                    // 已就绪：同帧亮出，缩放动画无空窗
                    lightboxImg.style.opacity = '1';
                } else {
                    // 换 src 后上一张照片的像素仍留在元素里直到新缩略图解码完成——
                    // 未就绪时保持隐藏（打开瞬间闪现上一张照片的根因）并转圈，
                    // 就绪后由 load 恢复；缩略图失败路径：常驻 error 监听收起转圈，
                    // 全尺寸换源的 load 兜底恢复 opacity（不会黑屏）
                    lightboxImg.style.opacity = '0';
                    showImgLoading();
                }
                // 恢复监听入 pendingFirstLoad 槽位（open 顶部已清同槽位残留）：
                // 关闭/重开/切图时被摘除，防陈旧监听跨打开重放
                lightboxImg.addEventListener('load', pendingFirstLoad = () => {
                    pendingFirstLoad = null;
                    lightboxImg.style.opacity = '1';
                    hideImgLoading();
                }, { once: true });
                backdrop.open(p.thumb || p.src);
                lightbox.style.transition = 'none';
                lightbox.classList.add('active');
                enterDialog();
                drawer.refreshFit(); // 激活后强制重判「放得下」：关灯箱重置期间的 is-fit 状态可能过期
                document.body.style.overflow = 'hidden';
                const token = openToken;
                zoomPending = true; // 揭示交由 zoom.onDone；error 监听不提前揭示
                // 展示图自然尺寸上限：OSS lfit 仅按宽度封顶（w_1920/w_1280、
                // 高度随比例）——超宽屏 contain 拟合大于自然尺寸时，缩放目标
                // 与布局盒锁按自然尺寸封顶（最大显示到自然尺寸、不再放大），
                // 换源后自然尺寸接管时盒不缩回；无尺寸属性（旧数据）时不封顶
                const srcWMatch = /w_(\d+)/.exec(src);
                const srcW = srcWMatch ? parseInt(srcWMatch[1], 10) : 0;
                const maxW = srcW && p.width ? Math.min(p.width, srcW) : 0;
                const maxH = maxW && p.height ? p.height * maxW / p.width : 0;
                zoom.start(zoomFrom, () => {
                    zoomPending = false;
                    lightbox.style.transition = ''; // 恢复容器淡入淡出（关闭保留淡出）
                    revealMain(); // 面板文字与辉光随缩放完成淡入
                }, maxW, maxH);
                // 全尺寸预载自点击瞬间启动（与旧流程同窗）：带宽不再被推迟到
                // 动画结束后、与 w_800 分析探测错峰；就绪即换源（无需等动画
                // 结束）——width/height 布局盒锁使缩放途中换入也无视觉变化
                //（仅变清晰，元素保留缩略图画面直到新图解码）；失败保留缩略图、
                // 锁保留（盒稳定不塌缩，下次打开/关闭经 zoom.cancel 兜底清理）；
                // 连切/关闭期间换源与错误处理一律作废
                const full = new Image();
                loadWithAvifFallback(full); // 游离 Image 不进 document 捕获监听：实例级 AVIF 兜底
                full.onload = () => {
                    if (openToken !== token) return;
                    lightboxImg.src = src;
                    clearPendingUnlock();
                    lightboxImg.addEventListener('load', pendingUnlock = () => {
                        pendingUnlock = null;
                        lightboxImg.style.width = '';
                        lightboxImg.style.height = '';
                    }, { once: true });
                };
                full.onerror = () => {
                    if (openToken !== token) return; // 旧打开的失败不得影响当前打开
                    // 失败保留缩略图：锁保持（见上方注释），无需动作
                };
                full.src = src;
            } else {
                lightboxImg.src = src;
                lightboxImg.alt = p.alt;
                backdrop.open(p.thumb || p.src);
                lightbox.classList.add('active');
                enterDialog();
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
                    clearPendingFirstLoad(); // 作废上一次的同槽位监听（重开路径）
                    lightboxImg.addEventListener('load', pendingFirstLoad = function onLoad() {
                        pendingFirstLoad = null;
                        // 切换动画进行中不强制透明度（slideIn 过渡会将其归位）——
                        // 否则慢图恰在滑出期间加载完成时会闪一下满透明覆盖过渡
                        if (!switching) lightboxImg.style.opacity = '1';
                        hideImgLoading();
                        revealMain();
                    }, { once: true });
                }
            }
        }
        updateArrows();
    }

    // keepUrl：SPA 导航关闭（见 lightbox.js closeLightbox）保留目标 URL 的
    // ?p=——前进/后退到 ?p= 条目后由 openLightboxFromUrl 恢复灯箱（无条件
    // 清理会把恢复条目的 p 抹掉并改写历史）；按钮/Escape/胶囊跳转关闭恒清理
    function close({ keepUrl = false } = {}) {
        // 关闭逆向 FLIP 目标：仅当当前照片的网格卡片仍在视口内（切图切到视口外
        // 照片时原路返回无意义）；SPA 导航关闭与减弱动态退化为普通淡出
        const collapseRect = (() => {
            if (keepUrl || reducedMotion) return null;
            const p = currentIndex >= 0 && currentIndex < currentPhotos.length ? currentPhotos[currentIndex] : null;
            if (!p || !p.slug) return null;
            const card = document.querySelector(`.photo-card[data-slug="${CSS.escape(p.slug)}"]`);
            if (!card) return null;
            const r = card.getBoundingClientRect();
            if (r.width <= 0 || r.height <= 0 || r.right <= 0 || r.bottom <= 0 ||
                r.left >= window.innerWidth || r.top >= window.innerHeight) return null;
            return r;
        })();
        if (collapseRect) {
            // 容器淡出与缩小同时长——样式表 0.3s 的 visibility 翻转须一并覆盖，
            // 否则 visibility 瞬时翻转、缩小动画不可见
            lightbox.style.transition = 'opacity 0.35s ease, visibility 0.35s';
        }
        lightbox.classList.remove('active');
        exitDialog(!keepUrl); // 恢复背景 inert 并还原焦点（SPA 导航关闭不还原，见 exitDialog 注释）
        zoom.cancel(); // 作废在途缩放动画（含容器直显内联残留）
        lightbox.style.transition = '';
        zoomPending = false;
        openToken++; // 缩放浮现后的全尺寸换源作废
        clearPendingSlideIn(); // 作废在途滑入收尾监听
        clearPendingUnlock(); // 作废换源锁摘除监听
        clearPendingFirstLoad(); // 作废首开 load 监听（防关闭后重放揭示）
        // 摘除打开时写入的无过渡内联（未走到揭示就关闭时，残留会破坏
        // 分析触发行等元素的开合过渡）
        revealSynced.forEach((el) => { el.style.transition = ''; });
        onClose(); // 展开的分析区随灯箱关闭收起：下次打开默认收起（含收起补偿摘除）
        hideImgLoading();
        switching = false; // 转圈期关闭：残留的 switching 会阻塞下次首开的透明度恢复
        clearPendingSwitch(); // 摘除在途切图监听，防陈旧闭包在下一次打开时重放
        clearPendingSlideOut(); // 在途滑出结束监听一并作废（关闭重开不残留陈旧重放）
        backdrop.clear(); // 移除所有背景层（下次首开重建，不残留旧作品背景）
        closeGlow(); // 移除所有辉光层（下次首开重建，不残留旧作品辉光）
        swipe.reset(); // 作废在途滑动手势与内联样式残留
        if (!keepUrl) collection.syncPhotoUrl('', true); // 关闭 replace 移除 ?p=（保留筛选参数）：历史回到打开前的页面状态，不残留过期照片 URL
        if (collapseRect) {
            // 缩小回缩略图位置：容器淡出与图片缩小并行，收尾时隐藏主图
            zoom.collapse(collapseRect, () => { lightboxImg.style.opacity = '0'; });
        } else {
            lightboxImg.style.opacity = '0';
        }
        document.body.style.overflow = '';
    }

    function prev(fromPx) {
        // 无条件重建：SPA 换页后旧列表已指向销毁的网格，必须先收集再取模
        currentPhotos = collection.collect();
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
        currentPhotos = collection.collect();
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

    // 标题与简行的透明度恢复（图片就绪路径共用）：恢复样式表过渡后写 1——
    // 与打开时的无过渡隐藏配对，淡入动画正常播放
    function revealOverlayText() {
        revealSynced.forEach((el) => {
            el.style.transition = '';
            el.style.opacity = '1';
        });
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

    // 点击作品打开（灯箱文档级点击监听入口）：收集并定位点击照片；
    // 缩略图可见（视口内、有尺寸）时把其矩形传给 open 作缩放浮现起点
    const openByImg = (img) => {
        currentPhotos = collection.collect();
        const idx = collection.findIndexByImg(currentPhotos, img);
        if (idx < 0) return;
        opener = img.closest('.photo-card') || null; // 关闭时焦点还原目标（dialog 语义）
        const rect = img.getBoundingClientRect();
        const zoomFrom = !reducedMotion && rect.width > 0 && rect.height > 0 &&
            rect.right > 0 && rect.bottom > 0 &&
            rect.left < window.innerWidth && rect.top < window.innerHeight
            ? rect : null;
        open(idx, undefined, zoomFrom);
    };

    return {
        open, close, prev, next, openByImg,
        getActiveGlow: () => activeGlow,
        current: () => (currentIndex >= 0 && currentIndex < currentPhotos.length)
            ? currentPhotos[currentIndex] : null
    };
}
