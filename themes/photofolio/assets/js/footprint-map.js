/**
 * 足迹世界地图（/footprint/ 顶部）
 *
 * - 自绘 SVG 等距圆柱投影（零外部库），世界陆地几何为一次性生成的简化静态 JSON
 *   （同源 fetch、模块级 Promise 记忆化，sw 自动缓存；失败仅降级为网格 + 光点）
 * - 按省份/国家聚合光点：三层圆（光晕/中层/核心），半径随作品数增长；
 *   交错弹入动画，作品数最多的首点带呼吸脉冲环
 * - 悬停/键盘聚焦显示弹层（地名 / 张数 / 年份跨度），点击光点跳转足迹详情页（SPA 拦截）
 * - 懒加载：IntersectionObserver rootMargin 600px 进入视口才构建
 * - SPA 页面切换重跑 initFootprintMap：同一节点幂等，旧状态（observers）先销毁
 */

const VIEW_W = 1000;       // 视图固定宽（SVG user 单位）
const MIN_H = 500;         // 视图高下限
const MAX_H = 1000;        // 视图高上限
const PAD = 0.15;          // fit-to-bounds 边距比例
const MIN_SPAN_X = 12;     // 最小经度跨度（°），防单点退化
const MIN_SPAN_Y = 9;      // 最小纬度跨度（°）
const GRID_STEP = 10;      // 网格线步长（°）
const STAGGER = 55;        // 光点交错弹入间隔 ms
const MAX_STAGGER = 1400;  // 交错延迟上限 ms

import { prefersReducedMotion, FLIP_TRANSITION } from './utils.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

// 窄屏断点（与 CSS 分栏 min-width: 769px 对应）：模块级单例，避免每次点击/构建重建 MediaQueryList
const MQ_NARROW = window.matchMedia('(max-width: 768px)');

let landPromise = null;    // 陆地几何 fetch 记忆化（跨 SPA 页面切换复用）
let state = null;          // { root, observer, resizeObserver, cleanup, tooltipCleanup,
                           //   revealIO, view, aspect, isNarrow, layoutRects, layoutAnimating }

export function initFootprintMap() {
    // 清理先于一切：导航到非足迹页时（无 #footprint-map）释放旧状态，
    // 避免 RO/断点监听滞留观察已脱离文档的地图
    destroyState();

    // 预览面板：独立于地图构建（无坐标地点时地图不渲染，面板仍展示默认地点；
    // 地图懒加载构建前即可用）——点击地图光点后由 build() 内的联动逻辑更新
    let previewData = [];
    const previewDataEl = document.getElementById('footprint-preview-data');
    if (previewDataEl) {
        try {
            previewData = JSON.parse(previewDataEl.textContent);
        } catch (err) {
            console.warn('[footprint-map] 预览数据解析失败', err);
        }
    }
    const previewPanel = document.getElementById('footprint-preview');
    // 初始为模板内的操作提示卡片（无 JS 时同样可见），点击地图光点后由 renderPreview 更新

    const root = document.getElementById('footprint-map');
    const dataEl = document.getElementById('footprint-map-data');
    if (!root || !dataEl) return;

    let points;
    try {
        points = JSON.parse(dataEl.textContent);
    } catch (err) {
        console.warn('[footprint-map] 数据解析失败', err);
        return;
    }
    if (!Array.isArray(points) || points.length === 0) return;

    state = { root, observer: null, resizeObserver: null };

    if ('IntersectionObserver' in window) {
        state.observer = new IntersectionObserver((entries) => {
            if (!entries[0].isIntersecting) return;
            state.observer.disconnect();
            state.observer = null;
            build(root, points, previewData, previewPanel).catch((err) => {
                console.warn('[footprint-map] 构建失败', err);
            });
        }, { rootMargin: '600px 0px' });
        state.observer.observe(root);
    } else {
        build(root, points, previewData, previewPanel);
    }
}

function destroyState() {
    if (!state) return;
    if (state.observer) state.observer.disconnect();
    if (state.resizeObserver) state.resizeObserver.disconnect();
    if (typeof state.cleanup === 'function') state.cleanup();
    state = null;
}

/* ===== 投影与视图适配（等距圆柱，φ1 = 视图纬度中点） =====
   视图范围 = 全部拍摄地点坐标的包围盒（+ 15% 边距 + 最小跨度守卫）。
   targetH 传入时（桌面分栏：地图框高度由等高卡片决定）按框的宽高比重算视图高，
   地图内容始终填满等高框（多出的区域表现为更多的网格/海洋，而非 letterbox） */
function fitProjection(points, targetH) {
    let lngMin = Infinity, lngMax = -Infinity;
    let latMin = Infinity, latMax = -Infinity;
    for (const p of points) {
        lngMin = Math.min(lngMin, p.lng);
        lngMax = Math.max(lngMax, p.lng);
        latMin = Math.min(latMin, p.lat);
        latMax = Math.max(latMax, p.lat);
    }
    const phi1 = (latMin + latMax) / 2;
    const cos1 = Math.cos((phi1 * Math.PI) / 180);

    let dx = (lngMax - lngMin) * cos1;
    let dy = latMax - latMin;
    dx = Math.max(dx, MIN_SPAN_X);
    dy = Math.max(dy, MIN_SPAN_Y);

    // 视图高随数据纵横比锁定，限制在 2:1 ~ 1:1 之间；桌面分栏时由等高框决定（同样钳制）
    const H = Math.min(MAX_H, Math.max(MIN_H, targetH || Math.round((VIEW_W * dy) / dx)));
    const s = Math.min(VIEW_W / (dx * (1 + 2 * PAD)), H / (dy * (1 + 2 * PAD)));

    return {
        W: VIEW_W,
        H,
        s,
        ox: VIEW_W / 2 - s * cos1 * (lngMin + lngMax) / 2,
        oy: H / 2 + s * (latMin + latMax) / 2,
        cos1
    };
}

function project(pr, lng, lat) {
    return [pr.ox + pr.s * pr.cos1 * lng, pr.oy - pr.s * lat];
}

/* ===== 构建 ===== */
let buildSeq = 0; // 构建序号：断点重建与 RO 重建可能并发，只允许最新一次构建生效

// 仿射映射：等距圆柱投影变化（s/ox/oy/cos1）→ 旧坐标系到新坐标系的 matrix（x' = a·x + b，y' = c·y + d）
function matrixFrom(prFrom, prTo) {
    const a = (prTo.s * prTo.cos1) / (prFrom.s * prFrom.cos1);
    const b = prTo.ox - a * prFrom.ox;
    const c = prTo.s / prFrom.s;
    const d = prTo.oy - c * prFrom.oy;
    return `matrix(${a} 0 0 ${c} ${b} ${d})`;
}

// 增量重投影（拖动窗口/跨断点时的重建路径）：陆地与网格只改组的 matrix 变换、
// 光点只重定位 12 个坐标——不重建任何 DOM、不重投影陆地路径（4503 个坐标点），
// 每帧级成本（拖动中无卡顿）；viewBox 同步更新使地图始终填满等高框
function updateProjection(root, prNew) {
    const view = state.view;
    if (!view || !root.isConnected) return;
    view.svg.setAttribute('viewBox', `0 0 ${prNew.W} ${prNew.H}`);
    view.grid.setAttribute('transform', matrixFrom(view.gridPr, prNew));
    if (view.land) view.land.setAttribute('transform', matrixFrom(view.landPr, prNew));
    view.dotsData.forEach((d) => {
        const [x, y] = project(prNew, d.lng, d.lat);
        d.inner.setAttribute('transform', `translate(${x},${y})`);
    });
    view.pr = prNew;
    root.style.aspectRatio = `${prNew.W} / ${prNew.H}`; // 窄屏时决定框高；桌面由 CSS 高度决定（被忽略）
}

// 跨断点布局切换的 FLIP（分栏 ↔ 上下堆叠）：与卡片换行同款——
// 基准位置每帧持续刷新（动画期间暂停），RO 检测到模式翻转时从上一帧基准回放。
// 不依赖 MQL change 事件「先于布局」的时序（不同环境下并不可靠）
function layoutEls() {
    // FLIP 作用于地图框/图例/预览面板本身，而非它们的容器 section——
    // section 的窄屏 padding-top（2em）会使 rect 顶缘比宽屏高 32px（紧贴页头横线），
    // FLIP 会把内边距差当位移、起点压到横线上；地图框两态顶缘一致（实测均为 header+2em）
    return [
        document.getElementById('footprint-map'),
        document.querySelector('.footprint-map-legend'),
        document.querySelector('.footprint-preview-wrap'),
    ].filter(Boolean);
}

function rectsOf(els) {
    return els.map((el) => el.getBoundingClientRect());
}

function flipLayout() {
    const els = layoutEls();
    const prev = state.layoutRects || [];
    if (!prev.length || prev.length !== els.length || prefersReducedMotion()) {
        state.layoutRects = rectsOf(els);
        return;
    }
    // 取消可能仍在进行的上一次动画（内联 transform 会污染量测）
    els.forEach((el) => {
        el.style.transition = '';
        el.style.transform = '';
    });
    void document.body.offsetWidth;
    const lasts = rectsOf(els);
    // Invert：摆回上一帧基准位置与尺寸（位移 + 缩放，左上角同一起点复合）
    els.forEach((el, i) => {
        const dx = prev[i].left - lasts[i].left;
        const dy = prev[i].top - lasts[i].top;
        const sx = lasts[i].width ? prev[i].width / lasts[i].width : 1;
        const sy = lasts[i].height ? prev[i].height / lasts[i].height : 1;
        if (!dx && !dy && Math.abs(sx - 1) <= 0.001 && Math.abs(sy - 1) <= 0.001) return;
        el.style.transition = 'none';
        el.style.transformOrigin = '0 0';
        el.style.transform = `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`;
    });
    void document.body.offsetWidth;
    // Play：过渡归位（位置 + 尺寸）
    els.forEach((el) => {
        if (el.style.transform) {
            el.style.transition = FLIP_TRANSITION;
            el.style.transform = '';
        }
    });
    state.layoutRects = lasts;
    state.layoutAnimating = true;
    setTimeout(() => {
        state.layoutAnimating = false;
        els.forEach((el) => {
            if (el.style.transition === FLIP_TRANSITION) el.style.transition = '';
            if (el.style.transformOrigin === '0 0') el.style.transformOrigin = '';
        });
    }, 400);
}

async function build(root, points, previewData, previewPanel) {
    // 增量重投影快速路径（拖动窗口宽高比漂移/跨断点）：只改 viewBox、组的 matrix
    // 变换与 12 个光点坐标，不重建 DOM、不重投影陆地路径。必须在递增构建序号之前——
    // 否则首建在等待陆地 fetch 期间被增量更新「取代」，陆地会永久缺失
    if (state.view && root.isConnected) {
        const width = root.getBoundingClientRect().width;
        if (width > 0) {
            // 模式判定用媒体查询（与 CSS 分栏断点一致）——不能用框高是否为 0 判断：
            // 跨断点后内联 aspect-ratio 会让窄屏框高也非 0，导致误按桌面模式算投影
            const isNarrow = MQ_NARROW.matches;
            // 桌面分栏：行高由右侧等高卡片决定——直接测卡片所在面板的高度，
            // 而非地图框自身（避免「框高由框的纵横比派生」的循环量测）
            let targetH = null;
            if (!isNarrow) {
                const panelWrap = document.querySelector('.footprint-preview-wrap');
                const refHeight = panelWrap ? panelWrap.getBoundingClientRect().height : root.getBoundingClientRect().height;
                if (refHeight > 0) {
                    targetH = Math.round((VIEW_W * refHeight) / width);
                }
            }
            updateProjection(root, fitProjection(points, targetH));
            state.aspect = (state.view.pr.W / state.view.pr.H);
        }
        return;
    }

    const seq = ++buildSeq;

    // 容器宽度为 0 守卫（display:none / SPA 淡出瞬间）：rAF 重试，30 帧后放弃
    let width = root.getBoundingClientRect().width;
    for (let frame = 0; width === 0 && frame < 30; frame++) {
        await new Promise((r) => requestAnimationFrame(r));
        if (seq !== buildSeq) return; // 已被更新的构建取代
        width = root.getBoundingClientRect().width;
    }
    if (width === 0 || !root.isConnected || seq !== buildSeq) return;

    // 模式判定用媒体查询（与 CSS 分栏断点一致）——不能用框高是否为 0 判断：
    // 跨断点后内联 aspect-ratio 会让窄屏框高也非 0，导致误按桌面模式算投影
    const isNarrow = MQ_NARROW.matches;
    // 桌面分栏：行高由右侧等高卡片决定——直接测卡片所在面板的高度，
    // 而非地图框自身（避免「框高由框的纵横比派生」的循环量测）
    let targetH = null;
    if (!isNarrow) {
        const panelWrap = document.querySelector('.footprint-preview-wrap');
        const refHeight = panelWrap ? panelWrap.getBoundingClientRect().height : root.getBoundingClientRect().height;
        if (refHeight > 0) {
            targetH = Math.round((VIEW_W * refHeight) / width);
        }
    }

    const pr = fitProjection(points, targetH);

    // 以下为首次构建：先清理上一次构建的监听与 DOM（防点击监听叠加、弹层重复）
    if (typeof state.cleanup === 'function') {
        state.cleanup();
        state.cleanup = null;
    }
    if (state.resizeObserver) {
        state.resizeObserver.disconnect();
        state.resizeObserver = null;
    }

    const countFormat = root.dataset.countFormat || '%COUNT% 張作品';
    const yearFormat = root.dataset.yearRangeFormat || '%MIN% — %MAX%';

    // 始终设置内联纵横比：窄屏时决定框高；桌面高度由 CSS height:100% 决定（此值被忽略），
    // 但跨断点瞬间框高未定前保持上一纵横比渲染，避免 5:3 兜底闪烁
    root.style.aspectRatio = `${pr.W} / ${pr.H}`;

    // 首次构建：创建网格、光点与弹层，先挂出网格与光点，陆地随后补入
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', `0 0 ${pr.W} ${pr.H}`);
    svg.setAttribute('role', 'group');

    const grid = document.createElementNS(SVG_NS, 'g');
    grid.setAttribute('class', 'fm-grid');
    buildGrid(grid, pr);
    svg.appendChild(grid);

    const dots = document.createElementNS(SVG_NS, 'g');
    dots.setAttribute('class', 'fm-dots');
    const dotsData = points.map((p, i) => buildDot(dots, pr, p, i, countFormat));
    svg.appendChild(dots);

    const tooltip = document.createElement('div');
    tooltip.className = 'fm-tooltip';
    tooltip.setAttribute('role', 'status');

    root.replaceChildren(svg, tooltip);

    // 视图状态：增量重投影依赖（重建路径只更新这些，不重建 DOM）
    state.view = { svg, grid, gridPr: pr, land: null, landPr: null, dotsData, pr };

    // 陆地几何：同源 fetch（记忆化的是解析后的 JSON——Response 只能消费一次，
    // SPA 返回重进本页时必须复用已解析数据；绝对路径避免解析到 /footprint/maps/…）
    // 失败仅 warn（且不记忆化，下次进入重试），网格 + 光点照常可用
    try {
        landPromise = landPromise || fetch(new URL('/maps/land-110m.json', document.baseURI)).then((res) => {
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            return res.json();
        });
        const polys = await landPromise;
        if (!root.isConnected || seq !== buildSeq) return; // 构建中途 SPA 已跳走或被更新的构建取代
        const land = document.createElementNS(SVG_NS, 'g');
        land.setAttribute('class', 'fm-land');
        buildLand(land, polys, pr);
        // 陆地按构建时的投影生成；若期间发生过增量重投影，用当前投影的仿射变换对齐
        land.setAttribute('transform', matrixFrom(pr, state.view.pr));
        state.view.land = land;
        state.view.landPr = pr;
        svg.insertBefore(land, grid);
    } catch (err) {
        landPromise = null;
        console.warn('[footprint-map] 陆地几何加载失败，仅显示网格与光点', err);
        if (seq !== buildSeq || !root.isConnected) return; // 与成功路径同款守卫：被取代的构建不得动 DOM
    }

    if (seq !== buildSeq) return; // 成功路径在 await 后已守卫，此处兜底（如未缓存 fetch 快速完成）
    state.aspect = pr.W / pr.H; // 构建生效后才写入（避免被取代的构建污染漂移检测基准）
    state.tooltipCleanup = bindTooltip(root, tooltip, countFormat, yearFormat);

    // 弹入动画：地图真正进入视口时才点亮——若在视口外提前构建完成（600px 预加载余量），
    // 交错弹入不会在用户看到之前播完（手机上滚动慢时尤其明显）；已在视口内则立即点亮
    const revealDots = () => {
        dots.querySelectorAll('.fm-dot-link').forEach((el) => {
            el.style.setProperty('--fm-delay', el.dataset.delay + 'ms');
            el.classList.add('fm-ready');
        });
    };
    if ('IntersectionObserver' in window) {
        const revealIO = new IntersectionObserver((entries) => {
            if (!entries[0].isIntersecting) return;
            revealIO.disconnect();
            state.revealIO = null;
            revealDots();
        });
        state.revealIO = revealIO; // 纳入 state：SPA 销毁时若从未相交也能断开
        revealIO.observe(root);
    } else {
        revealDots();
    }

    // resize/旋转：关闭弹层；桌面等高模式下宽高比漂移超过 1% 时做增量重投影——
    // 该路径成本极低（改 viewBox + 组变换 + 12 个光点坐标），无需防抖，拖动中地图实时跟随
    if ('ResizeObserver' in window) {
        let rebuildQueued = false;
        state.resizeObserver = new ResizeObserver(() => {
            hideTooltip(tooltip);
            if (rebuildQueued) return;
            rebuildQueued = true;
            requestAnimationFrame(() => {
                rebuildQueued = false;
                if (!root.isConnected) return;
                // 跨断点检测（RO 为后布局回调，此时布局已按新断点排好）：
                // 布局切换 FLIP + 地图重建（分栏/堆叠投影切换）
                const nowNarrow = MQ_NARROW.matches;
                if (nowNarrow !== state.isNarrow) {
                    state.isNarrow = nowNarrow;
                    // 先让地图完成投影/尺寸切换，再量测做 FLIP——动画目标（Last）
                    // 必须包含地图的最终尺寸，否则动画结束后地图会再跳一次
                    build(root, points, previewData, previewPanel).catch((err) => {
                        console.warn('[footprint-map] 断点重建失败', err);
                    });
                    flipLayout();
                    return;
                }
                // 基准位置每帧刷新（动画期间暂停）：下一次模式翻转的 FLIP First
                if (!state.layoutAnimating) {
                    state.layoutRects = rectsOf(layoutEls());
                }
                const w = root.getBoundingClientRect().width;
                const h = root.getBoundingClientRect().height;
                if (!(w > 0) || !(h > 0)) return;
                const cur = w / h;
                if (state.aspect && Math.abs(cur - state.aspect) / state.aspect > 0.01) {
                    build(root, points, previewData, previewPanel).catch((err) => {
                        console.warn('[footprint-map] 重建失败', err);
                    });
                }
            });
        });
        state.resizeObserver.observe(root);
    }

    // 断点同步：跨 769px 时地图与卡片切换分栏/上下堆叠。
    // 由 RO（后布局回调，必然触发）驱动，而非 MQL change 事件（其时序在不同环境
    // 下不可靠）；FLIP 用「上一帧持续刷新的基准位置」回放（与卡片换行 FLIP 同款，
    // 不依赖「先量后变」的时序假设）
    state.isNarrow = MQ_NARROW.matches;
    state.layoutRects = null;
    state.layoutAnimating = false;

    // ===== 联动：光点 ↔ 地点预览面板（点击光点更新面板内容，面板整块链接进详情页） =====
    const dotsBySlug = new Map();
    dots.querySelectorAll('.fm-dot-link').forEach((el) => {
        if (el.dataset.slug) dotsBySlug.set(el.dataset.slug, el);
    });

    const highlightDot = (slug) => {
        dots.querySelectorAll('.fm-dot-link.is-active').forEach((el) => el.classList.remove('is-active'));
        const dot = slug ? dotsBySlug.get(slug) : null;
        if (dot) dot.classList.add('is-active');
    };

    const onDotClick = (e) => {
        const link = e.target.closest('.fm-dot-link');
        if (!link || !link.dataset.slug) return;
        e.preventDefault();
        e.stopPropagation();
        highlightDot(link.dataset.slug);
        renderPreview(previewData, link.dataset.slug);
        // 窄屏（面板在地图下方）：滚动到面板，让更新内容可见
        if (!previewPanel) return;
        if (MQ_NARROW.matches) {
            previewPanel.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'nearest' });
        }
    };
    root.addEventListener('click', onDotClick);

    state.cleanup = () => {
        root.querySelectorAll('.fm-tooltip').forEach((t) => t.remove());
        root.removeEventListener('click', onDotClick);
        if (typeof state.tooltipCleanup === 'function') {
            state.tooltipCleanup();
            state.tooltipCleanup = null;
        }
        if (state.revealIO) {
            state.revealIO.disconnect();
            state.revealIO = null;
        }
    };
}

/* ===== 预览面板渲染（数据 JSON 由模板生成：slug → 名称/详情页/总数/展示照片） ===== */
function renderPreview(data, slug) {
    const panel = document.getElementById('footprint-preview');
    if (!panel) return;
    const FADE_MS = prefersReducedMotion() ? 0 : 200;

    // 切换动画：淡出旧内容 → 换内容 → 淡入；
    // 快速连续点击光点时重置计时，以最新一次选择为准
    panel.style.opacity = '0';
    clearTimeout(renderPreview.timer);
    renderPreview.timer = setTimeout(() => {
        const entry = data.find((d) => d.slug === slug) || data[0];
        if (!entry || !entry.cover) {
            panel.style.opacity = '1';
            return;
        }

        panel.href = entry.url;
        panel.classList.remove('is-hint'); // 离开提示态（恢复链接交互与悬停样式）

        const name = document.createElement('h3');
        name.className = 'preview-name';
        name.textContent = entry.name;

        const media = document.createElement('div');
        media.className = 'preview-media';
        const img = document.createElement('img');
        img.src = entry.cover.src;
        img.alt = entry.cover.alt;
        // 不设 loading="lazy"：动态创建的元素不在 lazy-load 的监听范围内，
        // img[loading="lazy"] 的载入前模糊（blur）永远不会被清除，画面呈毛玻璃状
        media.appendChild(img);

        const more = document.createElement('span');
        more.className = 'preview-more';
        more.textContent = (panel.dataset.moreFormat || '查看全部 %COUNT% 張作品').replace('%COUNT%', entry.count);

        // 分类卡片同款结构：图片在上、信息块（地名 + 查看全部）在下
        const info = document.createElement('div');
        info.className = 'preview-info';
        info.append(name, more);

        panel.replaceChildren(media, info);
        panel.style.opacity = '1';
    }, FADE_MS);
}

/* 网格线：等距圆柱下均为直线；按可视范围反推经纬度起止 */
function buildGrid(g, pr) {
    const lngMin = (0 - pr.ox) / (pr.s * pr.cos1);
    const lngMax = (pr.W - pr.ox) / (pr.s * pr.cos1);
    const latMin = (pr.H - pr.oy) / -pr.s;
    const latMax = (0 - pr.oy) / -pr.s;

    for (let lng = Math.ceil(lngMin / GRID_STEP) * GRID_STEP; lng <= lngMax; lng += GRID_STEP) {
        const [x] = project(pr, lng, 0);
        const line = document.createElementNS(SVG_NS, 'line');
        line.setAttribute('x1', x);
        line.setAttribute('x2', x);
        line.setAttribute('y1', 0);
        line.setAttribute('y2', pr.H);
        g.appendChild(line);
    }
    for (let lat = Math.ceil(latMin / GRID_STEP) * GRID_STEP; lat <= latMax; lat += GRID_STEP) {
        const [, y] = project(pr, 0, lat);
        const line = document.createElementNS(SVG_NS, 'line');
        line.setAttribute('x1', 0);
        line.setAttribute('x2', pr.W);
        line.setAttribute('y1', y);
        line.setAttribute('y2', y);
        g.appendChild(line);
    }
}

/* 陆地 path：逐点等距圆柱映射；换日线断段守卫 */
function buildLand(g, polys, pr) {
    for (const poly of polys) {
        const d = poly.map((ring) => buildRingPath(ring, pr)).join(' ');
        const path = document.createElementNS(SVG_NS, 'path');
        path.setAttribute('d', d);
        g.appendChild(path);
    }
}

function buildRingPath(ring, pr) {
    let d = '';
    let prev = null;
    ring.forEach(([x10, y10], i) => {
        const [x, y] = project(pr, x10 / 10, y10 / 10);
        if (i === 0) {
            d += `M${round1(x)},${round1(y)}`;
        } else if (prev !== null && Math.abs(x - prev) > pr.W / 2) {
            // 换日线：断开重起（当前东亚视野不会触发，仅防御）
            d += `M${round1(x)},${round1(y)}`;
        } else {
            d += `L${round1(x)},${round1(y)}`;
        }
        prev = x;
    });
    return d + 'Z';
}

function round1(v) {
    return Math.round(v * 10) / 10;
}

/* 光点：位置 translate 放内层 <g> attribute（弹入 scale 放外层 <a> CSS，两者互不覆盖）；
   弹层所需数据全部写入 <a> 的 dataset（悬停时从元素自身读取，无需回查点数组） */
function buildDot(g, pr, p, i, countFormat) {
    const r = Math.min(3 + 1.7 * Math.sqrt(p.count - 1), 13);
    const [x, y] = project(pr, p.lng, p.lat);
    const coreR = Math.max(r * 0.45, 2);

    const link = document.createElementNS(SVG_NS, 'a');
    link.setAttribute('class', 'fm-dot-link');
    link.setAttribute('href', p.url);
    link.dataset.delay = Math.min(i * STAGGER, MAX_STAGGER);
    link.dataset.slug = p.slug || '';
    link.dataset.name = p.name;
    link.dataset.count = p.count;
    link.dataset.minYear = p.minYear;
    link.dataset.maxYear = p.maxYear;
    link.setAttribute('aria-label', `${p.name}，${countFormat.replace('%COUNT%', p.count)}`);

    const inner = document.createElementNS(SVG_NS, 'g');
    inner.setAttribute('transform', `translate(${x},${y})`);

    const halo = document.createElementNS(SVG_NS, 'circle');
    halo.setAttribute('class', 'fm-halo');
    halo.setAttribute('r', r * 2.4);
    inner.appendChild(halo);

    const mid = document.createElementNS(SVG_NS, 'circle');
    mid.setAttribute('class', 'fm-mid');
    mid.setAttribute('r', r);
    inner.appendChild(mid);

    if (i === 0 && p.count > 1) {
        const pulse = document.createElementNS(SVG_NS, 'circle');
        pulse.setAttribute('class', 'fm-pulse');
        pulse.setAttribute('r', r * 1.7);
        inner.appendChild(pulse);
    }

    const core = document.createElementNS(SVG_NS, 'circle');
    core.setAttribute('class', 'fm-core');
    core.setAttribute('r', coreR);
    inner.appendChild(core);

    link.appendChild(inner);
    g.appendChild(link);
    return { inner, lng: p.lng, lat: p.lat }; // 增量重投影时用于重定位光点
}

/* ===== 弹层 ===== */
function bindTooltip(root, tooltip, countFormat, yearFormat) {
    const mapRect = () => root.getBoundingClientRect();
    const hide = () => hideTooltip(tooltip);
    const isHoverCapable = matchMedia('(hover: hover)').matches;

    const show = (el) => {
        const { name, count, minYear, maxYear } = el.dataset;
        const years = minYear === maxYear ? String(minYear) : yearFormat.replace('%MIN%', minYear).replace('%MAX%', maxYear);
        tooltip.innerHTML = '';
        const nameEl = document.createElement('strong');
        nameEl.textContent = name;
        const countEl = document.createElement('span');
        countEl.textContent = countFormat.replace('%COUNT%', count);
        const yearEl = document.createElement('span');
        yearEl.textContent = years;
        tooltip.append(nameEl, countEl, yearEl);

        // 先恢复显示并测量（读取 offset 强制初始态样式生效，随后加 fm-visible 才有淡入过渡）
        tooltip.style.display = '';
        tooltip.style.left = '0px';
        tooltip.style.top = '0px';
        const w = tooltip.offsetWidth;
        const h = tooltip.offsetHeight;

        // 光点自身包围盒 = 光晕圆包围盒（居中即光点中心、半宽即光晕半径），
        // 在视口坐标系做 clamp 与上下翻转，最后换算回容器相对坐标
        //（tooltip 的定位包含块是 #footprint-map，不是视口）
        const rect = mapRect();
        const dotRect = el.getBoundingClientRect();
        const x = dotRect.left + dotRect.width / 2;
        const y = dotRect.top + dotRect.height / 2;
        const haloPx = dotRect.width / 2;
        const leftVp = Math.min(Math.max(x - w / 2, 12), window.innerWidth - w - 12);
        // 上方空间不足（弹层高 + 光晕 + 间距）则翻转到光点下方
        let topVp = y - haloPx - 12 - h;
        if (topVp < 8) topVp = y + haloPx + 12;
        tooltip.style.left = (leftVp - rect.left) + 'px';
        tooltip.style.top = (topVp - rect.top) + 'px';
        tooltip.classList.add('fm-visible');
    };

    const onPointerEnter = (e) => {
        if (!isHoverCapable) return;
        const link = e.target.closest('.fm-dot-link');
        if (link) show(link);
    };
    const onPointerLeave = (e) => {
        if (e.target.closest('.fm-dot-link')) hide();
    };
    const onFocusIn = (e) => {
        const link = e.target.closest('.fm-dot-link');
        if (link) show(link);
    };
    const onFocusOut = (e) => {
        // 焦点在光点之间移动时不闪烁（focusin 会立即重新显示）
        if (e.relatedTarget && e.relatedTarget.closest && e.relatedTarget.closest('.fm-dot-link')) return;
        if (e.target.closest('.fm-dot-link')) hide();
    };
    const onKeydown = (e) => {
        if (e.key === 'Escape') hide();
    };

    root.addEventListener('pointerenter', onPointerEnter, true);
    root.addEventListener('pointerleave', onPointerLeave, true);
    root.addEventListener('focusin', onFocusIn);
    root.addEventListener('focusout', onFocusOut);
    root.addEventListener('keydown', onKeydown);

    // 返回移除函数：重建时会重新绑定弹层监听，旧监听必须移除（否则随重建次数累积，
    // 每次悬停都会在已脱离文档的旧弹层上重复执行布局读取）
    return () => {
        root.removeEventListener('pointerenter', onPointerEnter, true);
        root.removeEventListener('pointerleave', onPointerLeave, true);
        root.removeEventListener('focusin', onFocusIn);
        root.removeEventListener('focusout', onFocusOut);
        root.removeEventListener('keydown', onKeydown);
    };
}

function hideTooltip(tooltip) {
    tooltip.classList.remove('fm-visible');
    // display:none 彻底移出布局与可滚动溢出（visibility:hidden 的绝对定位元素
    // 在 Chrome 中仍计入 scrollable overflow，缩小窗口时残留位置会撑出横向滚动）
    tooltip.style.display = 'none';
}
