/**
 * 足迹世界地图（/footprint/ 顶部）
 *
 * - 自绘 SVG 等距圆柱投影（零外部库），世界陆地（Natural Earth 10m）、中国省级边界与
 *   海外国家边界均为一次性生成的简化静态 JSON（同源 fetch、模块级 Promise 记忆化，
 *   sw 自动缓存；失败仅降级为网格 + 点迹）
 * - 省份/国家以**独立区块**呈现（填充 + 描边）：悬停提亮，点击选中（is-active 高亮）
 *   并更新地点预览面板（含该地区数据统计：张数/地点/年份/机身 Top3）——无照片的地区
 *   为中性填充、不可交互
 * - 全部照片按坐标形成**点迹**（小圆点，纯展示、pointer-events none）
 * - 弹层（地名 / 张数 / 年份跨度）：桌面悬停/键盘聚焦显示，触屏点按显示并常驻至外部点按/滚动
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

import { prefersReducedMotion, FLIP_TRANSITION } from './utils.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

// 窄屏断点（与 CSS 分栏 min-width: 769px 对应）：模块级单例，避免每次点击/构建重建 MediaQueryList
const MQ_NARROW = window.matchMedia('(max-width: 768px)');

// 繁→简省名映射（locations.toml 地点名 → provinces.json 键，数据源为简体省名）；
// 省份区块的 dataset 存站点地点名（繁），经此映射反向查省界数据
const PROVINCE_NAMES = {
    '廣東': '广东省',
    '浙江': '浙江省',
    '雲南': '云南省',
    '安徽': '安徽省',
    '福建': '福建省',
    '江西': '江西省',
    '上海': '上海市',
    '天津': '天津市',
    '青海': '青海省',
    '內蒙古': '内蒙古自治区',
};
const PROVINCE_NAMES_REV = Object.fromEntries(Object.entries(PROVINCE_NAMES).map(([k, v]) => [v, k]));

let landPromise = null;      // 陆地几何 fetch 记忆化（跨 SPA 页面切换复用）
let provincesPromise = null; // 省级边界 fetch 记忆化（同款）
let countriesPromise = null; // 海外国家边界 fetch 记忆化（同款）

function loadLandData() {
    if (!landPromise) {
        landPromise = fetch(new URL('/maps/land-10m.json', document.baseURI)).then((res) => {
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            return res.json();
        });
    }
    return landPromise;
}

function loadProvincesData() {
    if (!provincesPromise) {
        provincesPromise = fetch(new URL('/maps/provinces.json', document.baseURI)).then((res) => {
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            return res.json();
        });
    }
    return provincesPromise;
}

function loadCountriesData() {
    if (!countriesPromise) {
        countriesPromise = fetch(new URL('/maps/countries.json', document.baseURI)).then((res) => {
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            return res.json();
        });
    }
    return countriesPromise;
}

let state = null;          // { root, observer, resizeObserver, cleanup, tooltipCleanup,
                           //   view, aspect, isNarrow, layoutRects, layoutAnimating }

export function initFootprintMap() {
    // 清理先于一切：导航到非足迹页时（无 #footprint-map）释放旧状态，
    // 避免 RO/断点监听滞留观察已脱离文档的地图
    destroyState();

    // 预览面板：独立于地图构建（无坐标照片时地图不渲染，面板仍展示默认地点）——
    // 点击省/国区块后由 build() 内的联动逻辑更新
    let previewData = [];
    const previewDataEl = document.getElementById('footprint-preview-data');
    if (previewDataEl) {
        try {
            previewData = JSON.parse(previewDataEl.textContent);
        } catch (err) {
            console.warn('[footprint-map] preview data parse failed', err);
        }
    }
    let statsByName = {};
    const statsEl = document.getElementById('footprint-stats-data');
    if (statsEl) {
        try {
            statsByName = JSON.parse(statsEl.textContent);
        } catch (err) {
            console.warn('[footprint-map] stats data parse failed', err);
        }
    }
    const previewPanel = document.getElementById('footprint-preview');

    const root = document.getElementById('footprint-map');
    const dataEl = document.getElementById('footprint-map-data');
    if (!root || !dataEl) return;

    let points;
    try {
        points = JSON.parse(dataEl.textContent);
    } catch (err) {
        console.warn('[footprint-map] data parse failed', err);
        return;
    }
    if (!Array.isArray(points) || points.length === 0) return;

    state = { root, observer: null, resizeObserver: null };

    if ('IntersectionObserver' in window) {
        state.observer = new IntersectionObserver((entries) => {
            if (!entries[0].isIntersecting) return;
            state.observer.disconnect();
            state.observer = null;
            build(root, points, previewData, statsByName, previewPanel).catch((err) => {
                console.warn('[footprint-map] build failed', err);
            });
        }, { rootMargin: '600px 0px' });
        state.observer.observe(root);
    } else {
        build(root, points, previewData, statsByName, previewPanel);
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
   视图范围 = 全部照片坐标的包围盒（+ 15% 边距 + 最小跨度守卫）。
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
    // 最小跨度守卫：世界视野防单点退化
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

// 增量重投影（拖动窗口/跨断点时的重建路径）：陆地/区块/网格只改组的 matrix 变换、
// 点迹只重定位坐标——不重建任何 DOM、不重投影路径，每帧级成本（拖动中无卡顿）
function updateProjection(root, prNew) {
    const view = state.view;
    if (!view || !root.isConnected) return;
    view.svg.setAttribute('viewBox', `0 0 ${prNew.W} ${prNew.H}`);
    view.grid.setAttribute('transform', matrixFrom(view.gridPr, prNew));
    if (view.land) view.land.setAttribute('transform', matrixFrom(view.landPr, prNew));
    if (view.prov) view.prov.setAttribute('transform', matrixFrom(view.provPr, prNew));
    if (view.country) view.country.setAttribute('transform', matrixFrom(view.countryPr, prNew));
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

/* 区块 path：一个地区（省/国）的全部多边形合并为单个 path（多环子路径空格连接），
   便于整块点击/悬停/选中 */
function buildRegionPath(g, polys, pr, quant, attrs) {
    let d = '';
    for (const poly of polys) {
        d += poly.map((ring) => buildRingPath(ring, pr, quant)).join(' ');
    }
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', d);
    for (const [key, value] of Object.entries(attrs)) {
        path.setAttribute(key, value);
    }
    g.appendChild(path);
    return path;
}

/* 视图范围 = 照片点迹 ∪ 全部有照片省份的完整区块包围盒（海外国家除外——
   省份完整可见不被 viewBox 裁切，如青海照片在中东部、省界西段须完整露出；
   海外国家不并入包围盒，随照片点自然呈现） */
function computeBounds(points, provData, activeNames) {
    let minLng = Infinity, maxLng = -Infinity, minLat = Infinity, maxLat = -Infinity;
    const extend = (lng, lat) => {
        minLng = Math.min(minLng, lng);
        maxLng = Math.max(maxLng, lng);
        minLat = Math.min(minLat, lat);
        maxLat = Math.max(maxLat, lat);
    };
    for (const p of points) extend(p.lng, p.lat);

    const extendRings = (polys, quant) => {
        for (const poly of polys) {
            for (const ring of poly) {
                for (const [xq, yq] of ring) extend(xq / quant, yq / quant);
            }
        }
    };
    if (provData) {
        for (const [key, polys] of Object.entries(provData.data)) {
            const siteName = PROVINCE_NAMES_REV[key];
            if (siteName && activeNames.has(siteName)) extendRings(polys, provData.quant);
        }
    }
    return { minLng, maxLng, minLat, maxLat };
}

async function build(root, points, previewData, statsByName, previewPanel) {
    // 增量重投影快速路径（拖动窗口宽高比漂移/跨断点）：只改 viewBox、组的 matrix
    // 变换与点迹坐标，不重建 DOM、不重投影路径。必须在递增构建序号之前——
    // 否则首建在等待数据 fetch 期间被增量更新「取代」，几何会永久缺失
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
            // 视图范围沿用首次构建的完整区块 bounds（含省/国区块包围盒）
            updateProjection(root, fitProjection(state.bounds, targetH));
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

    const countFormat = root.dataset.countFormat;
    const yearFormat = root.dataset.yearRangeFormat || '%MIN% — %MAX%';

    // 可交互区块名单：previewData 里有该地点才可点（无照片的地区中性填充、pointer-events none）
    const activeNames = new Set(previewData.map((d) => d.name));
    const regionList = []; // [{ path, name }]——高亮联动用

    // 几何数据先于投影加载：视图范围 = 照片点迹 ∪ 全部有照片地区的完整区块
    //（省区块完整可见、不被 viewBox 裁切——如青海照片在中东部、省界西段须完整露出）
    let landPolys = null;
    try {
        landPolys = await loadLandData();
    } catch (err) {
        landPromise = null;
        console.warn('[footprint-map] land geometry load failed', err);
    }
    if (!root.isConnected || seq !== buildSeq) return;

    let provData = null;
    try {
        provData = await loadProvincesData();
    } catch (err) {
        provincesPromise = null;
        console.warn('[footprint-map] province boundaries load failed', err);
    }
    if (!root.isConnected || seq !== buildSeq) return;

    let countryData = null;
    try {
        countryData = await loadCountriesData();
    } catch (err) {
        countriesPromise = null;
        console.warn('[footprint-map] country boundaries load failed', err);
    }
    if (!root.isConnected || seq !== buildSeq) return;

    const bounds = computeBounds(points, provData, activeNames);
    const fitPoints = [
        { lng: bounds.minLng, lat: bounds.minLat },
        { lng: bounds.maxLng, lat: bounds.maxLat },
    ];
    const pr = fitProjection(fitPoints, targetH);
    state.bounds = fitPoints; // 增量重投影沿用同一视图范围

    // 以下为首次构建：先清理上一次构建的监听与 DOM（防点击监听叠加、弹层重复）
    if (typeof state.cleanup === 'function') {
        state.cleanup();
        state.cleanup = null;
    }
    if (state.resizeObserver) {
        state.resizeObserver.disconnect();
        state.resizeObserver = null;
    }

    // 始终设置内联纵横比：窄屏时决定框高；桌面高度由 CSS height:100% 决定（此值被忽略），
    // 但跨断点瞬间框高未定前保持上一纵横比渲染，避免 5:3 兜底闪烁
    root.style.aspectRatio = `${pr.W} / ${pr.H}`;

    // 首次构建：创建网格、点迹与弹层，先挂出网格与点迹，陆地区块随后补入
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', `0 0 ${pr.W} ${pr.H}`);
    svg.setAttribute('role', 'group');

    const grid = document.createElementNS(SVG_NS, 'g');
    grid.setAttribute('class', 'fm-grid');
    buildGrid(grid, pr);
    svg.appendChild(grid);

    // 照片点迹：小圆点、纯展示（整组 pointer-events none）
    const dots = document.createElementNS(SVG_NS, 'g');
    dots.setAttribute('class', 'fm-photo-dots');
    const dotsData = points.map((p) => {
        const [x, y] = project(pr, p.lng, p.lat);
        const inner = document.createElementNS(SVG_NS, 'g');
        inner.setAttribute('transform', `translate(${x},${y})`);
        // 光环 + 核心（旧光点同款两层结构，点迹清晰可见）
        const halo = document.createElementNS(SVG_NS, 'circle');
        halo.setAttribute('class', 'fm-photo-halo');
        halo.setAttribute('r', 6);
        inner.appendChild(halo);
        const dot = document.createElementNS(SVG_NS, 'circle');
        dot.setAttribute('class', 'fm-photo-dot');
        dot.setAttribute('r', 2.5);
        inner.appendChild(dot);
        dots.appendChild(inner);
        return { inner, lng: p.lng, lat: p.lat }; // 增量重投影时用于重定位
    });
    // 点迹错峰入场：animation-delay 按序号注入（起播 80ms、10ms 步进）——
    // 地图几何先于光点呈现；CSS animation 首帧必从 0 起播，不依赖类切换时序；
    // 减弱动态偏好由 CSS 媒体查询直显（animation:none），无需 JS 分支
    const DOT_REVEAL_BASE_MS = 80;
    const DOT_REVEAL_STEP_MS = 10;
    dotsData.forEach((d, i) => {
        d.inner.style.animationDelay = `${DOT_REVEAL_BASE_MS + i * DOT_REVEAL_STEP_MS}ms`;
    });
    svg.appendChild(dots);

    const tooltip = document.createElement('div');
    tooltip.className = 'fm-tooltip';
    tooltip.setAttribute('role', 'status');

    root.replaceChildren(svg, tooltip);

    // 视图状态：增量重投影依赖（重建路径只更新这些，不重建 DOM）
    state.view = {
        svg, grid, gridPr: pr, land: null, landPr: null,
        prov: null, provPr: null, country: null, countryPr: null,
        dotsData, pr,
    };

    // 陆地几何（数据已在投影前加载；失败仅降级为网格 + 点迹）
    if (landPolys) {
        const land = document.createElementNS(SVG_NS, 'g');
        land.setAttribute('class', 'fm-land');
        buildLand(land, landPolys, pr);
        land.setAttribute('transform', matrixFrom(pr, state.view.pr));
        state.view.land = land;
        state.view.landPr = pr;
        svg.insertBefore(land, grid);
    }

    // 省份区块：每省一个合并 path（填充 + 描边）；数据为 {quant, data: {省名: 多边形数组}}
    if (provData) {
        const prov = document.createElementNS(SVG_NS, 'g');
        prov.setAttribute('class', 'fm-regions');
        for (const [key, polys] of Object.entries(provData.data)) {
            const siteName = PROVINCE_NAMES_REV[key] || null;
            const entry = siteName ? previewData.find((d) => d.name === siteName) : null;
            const attrs = {
                class: 'fm-region' + (entry ? '' : ' is-inert'),
                'data-name': siteName || key,
            };
            if (entry) {
                attrs['data-slug'] = entry.slug;
                attrs['data-count'] = entry.count;
                const st = statsByName[siteName] || {};
                attrs['data-min-year'] = st.yearMin || '';
                attrs['data-max-year'] = st.yearMax || '';
            }
            const path = buildRegionPath(prov, polys, pr, provData.quant, attrs);
            if (entry) {
                regionList.push({ path, name: siteName }); // 高亮联动只需 path 与地点名
            }
        }
        prov.setAttribute('transform', matrixFrom(pr, state.view.pr));
        state.view.prov = prov;
        state.view.provPr = pr;
        svg.insertBefore(prov, grid);
    }

    // 海外国家区块（键 = 站点地点名，与 locations.toml 一致）
    if (countryData) {
        const country = document.createElementNS(SVG_NS, 'g');
        country.setAttribute('class', 'fm-regions');
        for (const [key, polys] of Object.entries(countryData.data)) {
            const entry = previewData.find((d) => d.name === key);
            const attrs = {
                class: 'fm-region' + (entry ? '' : ' is-inert'),
                'data-name': key,
            };
            if (entry) {
                attrs['data-slug'] = entry.slug;
                attrs['data-count'] = entry.count;
                const st = statsByName[key] || {};
                attrs['data-min-year'] = st.yearMin || '';
                attrs['data-max-year'] = st.yearMax || '';
            }
            const path = buildRegionPath(country, polys, pr, countryData.quant, attrs);
            if (entry) {
                regionList.push({ path, name: key });
            }
        }
        country.setAttribute('transform', matrixFrom(pr, state.view.pr));
        state.view.country = country;
        state.view.countryPr = pr;
        svg.insertBefore(country, grid);
    }

    if (seq !== buildSeq) return; // 成功路径在 await 后已守卫，此处兜底（如未缓存 fetch 快速完成）
    state.aspect = pr.W / pr.H; // 构建生效后才写入（避免被取代的构建污染漂移检测基准）
    state.tooltipCleanup = bindTooltip(root, tooltip, countFormat, yearFormat);

    // resize/旋转：关闭弹层；桌面等高模式下宽高比漂移超过 1% 时做增量重投影——
    // 该路径成本极低（改 viewBox + 组变换 + 点迹坐标），无需防抖，拖动中地图实时跟随
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
                    build(root, points, previewData, statsByName, previewPanel).catch((err) => {
                        console.warn('[footprint-map] breakpoint rebuild failed', err);
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
                    build(root, points, previewData, statsByName, previewPanel).catch((err) => {
                        console.warn('[footprint-map] rebuild failed', err);
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

    // ===== 联动：省/国区块 ↔ 地点预览面板（点击区块更新面板内容与统计，面板整块链接进详情页） =====
    const highlightRegion = (name) => {
        document.querySelectorAll('.fm-region.is-active').forEach((el) => el.classList.remove('is-active'));
        const target = regionList.find((r) => r.name === name);
        if (target) target.path.classList.add('is-active');
    };

    const onRegionClick = (e) => {
        const path = e.target.closest('.fm-region');
        if (!path || !path.dataset.slug) return;
        e.preventDefault();
        e.stopPropagation();
        highlightRegion(path.dataset.name);
        renderPreview(previewData, path.dataset.slug);
        // 不做自动滚动：点击区块后页面保持在原位（区块高亮即反馈），
        // 自动滚入面板会把地图顶出视口、页面跳位
    };
    root.addEventListener('click', onRegionClick);

    state.cleanup = () => {
        root.querySelectorAll('.fm-tooltip').forEach((t) => t.remove());
        root.removeEventListener('click', onRegionClick);
        if (typeof state.tooltipCleanup === 'function') {
            state.tooltipCleanup();
            state.tooltipCleanup = null;
        }
        // 在途预览切换计时一并作废：SPA 换页后不得用旧页面的 slug 渲染新页面的面板
        if (renderPreview.timer) {
            clearTimeout(renderPreview.timer);
            renderPreview.timer = null;
        }
    };
}

/* ===== 预览面板渲染（数据 JSON 由模板生成：slug → 名称/详情页/总数/展示照片；
   面板卡片结构与样式与旧光点版完全一致，不额外展示统计信息） ===== */
function renderPreview(data, slug) {
    const panel = document.getElementById('footprint-preview');
    if (!panel) return;
    const FADE_MS = prefersReducedMotion() ? 0 : 200;

    // 切换动画：淡出旧内容 → 换内容 → 淡入；
    // 快速连续点击区块时重置计时，以最新一次选择为准
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
        more.textContent = panel.dataset.moreFormat.replace('%COUNT%', entry.count);

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
function buildLand(g, polys, pr, quant = 20) {
    for (const poly of polys) {
        const d = poly.map((ring) => buildRingPath(ring, pr, quant)).join(' ');
        const path = document.createElementNS(SVG_NS, 'path');
        path.setAttribute('d', d);
        g.appendChild(path);
    }
}

function buildRingPath(ring, pr, quant = 20) {
    let d = '';
    let prev = null;
    // 数据为量化整数对（陆地/国家 20 单位/度 = 0.05°；省界 200 单位/度 = 0.005°，
    // 见 tools/map-data/generate-maps.py），投影前按口径还原为度
    ring.forEach(([xq, yq], i) => {
        const [x, y] = project(pr, xq / quant, yq / quant);
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

/* ===== 弹层 ===== */
function bindTooltip(root, tooltip, countFormat, yearFormat) {
    const mapRect = () => root.getBoundingClientRect();
    const hide = () => hideTooltip(tooltip);
    const isHoverCapable = matchMedia('(hover: hover)').matches;

    // 弹层内容与定位渲染（先恢复显示并测量——读取 offset 强制初始态样式生效，
    // 随后加 fm-visible 才有淡入过渡）。
    // 锚点为指针坐标（凹形区块如內蒙古的包围盒中心会落在区块之外、弹层漂移）：
    // 悬停/点按传 e.clientX/Y，键盘聚焦无指针坐标时回退区块包围盒中心
    const render = (el, anchorX, anchorY) => {
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
        tooltip.dataset.slug = el.dataset.slug || '';

        // 淡出途中的重新显示：作废在途的隐藏计时，从当前透明度平滑淡回
        if (tooltip.hideTimer) {
            clearTimeout(tooltip.hideTimer);
            tooltip.hideTimer = null;
        }
        tooltip.style.display = '';
        tooltip.style.left = '0px';
        tooltip.style.top = '0px';
        const w = tooltip.offsetWidth;
        const h = tooltip.offsetHeight;

        // 在视口坐标系做 clamp 与上下翻转，最后换算回容器相对坐标
        //（tooltip 的定位包含块是 #footprint-map，不是视口）
        const rect = mapRect();
        let x = anchorX;
        let y = anchorY;
        if (x == null || y == null) {
            const dotRect = el.getBoundingClientRect();
            x = dotRect.left + dotRect.width / 2;
            y = dotRect.top + dotRect.height / 2;
        }
        const leftVp = Math.min(Math.max(x - w / 2, rect.left + 12), rect.left + rect.width - w - 12);
        // 指针上方留 16px 间距；上方空间不足（弹层高 + 间距）则翻转到指针下方
        let topVp = y - 16 - h;
        if (topVp < rect.top + 8) topVp = y + 16;
        tooltip.style.left = (leftVp - rect.left) + 'px';
        tooltip.style.top = (topVp - rect.top) + 'px';
        tooltip.classList.add('fm-visible');
    };

    // 已显示时换区块：交叉淡入淡出——旧弹层克隆为幽灵元素在旧位置原地淡出，
    // 新弹层同时在新位置从 0 淡入，两段动画并行、无「先消失再出现」的真空期；
    // 幽灵垫在主弹层之下（后插入者在上）——两框重叠时新内容直接叠在旧内容上淡入
    const swap = (el, anchorX, anchorY) => {
        const ghost = tooltip.cloneNode(true);
        ghost.removeAttribute('role'); // 状态播报只保留主弹层
        root.insertBefore(ghost, tooltip);
        // 先入 DOM、强制提交带类样式（opacity 1），再摘类触发淡出——
        // 顺序颠倒时幽灵的首次计算样式就是 0，过渡无从播放、旧弹层瞬间消失
        void ghost.offsetWidth;
        ghost.classList.remove('fm-visible');
        setTimeout(() => ghost.remove(), prefersReducedMotion() ? 0 : TOOLTIP_FADE_MS);

        // 主弹层同步瞬移到隐藏态：关过渡 + 内联 opacity 0，强制提交 0 基准，
        // 再恢复样式表过渡并交还类控制——render 加回 fm-visible 后必然从已提交的
        // 0 起淡入（不依赖 display:none 抑制过渡的行为，WebKit 下同样可靠）
        tooltip.style.transition = 'none';
        tooltip.classList.remove('fm-visible');
        tooltip.style.opacity = '0';
        void tooltip.offsetWidth;
        tooltip.style.transition = '';
        tooltip.style.opacity = '';
        render(el, anchorX, anchorY);
    };

    const show = (el, anchorX, anchorY) => {
        // 同一区块重复触发：无需动作（避免无意义的淡出淡入闪烁）
        if (tooltip.classList.contains('fm-visible') && tooltip.dataset.slug === (el.dataset.slug || '')) return;
        if (tooltip.classList.contains('fm-visible')) {
            swap(el, anchorX, anchorY);
            return;
        }
        render(el, anchorX, anchorY);
    };

    // 触屏点按显示（非悬停设备）：点按区块后弹层**常驻**（触屏没有「指针离开」可依赖），
    // 直到点按地图外任意处 / 页面滚动 / Escape / resize / 重建才收起。
    // 悬停设备不受影响：touchShown 只会经 onTap（悬停门禁之后）置位，hover 设备恒为 false
    let touchShown = false;
    let touchDismiss = null; // 常驻态的收起监听（外部点按 + 滚动），首次点按后懒挂载
    const dismissTouch = () => {
        touchShown = false;
        hide();
        if (touchDismiss) {
            touchDismiss();
            touchDismiss = null;
        }
    };
    const ensureTouchDismiss = () => {
        if (touchDismiss) return;
        const onDocDown = (e) => {
            // 点按任意区块不收起（随后的 click 会立即在对应区块重新显示）
            if (e.target.closest && e.target.closest('.fm-region')) return;
            dismissTouch();
        };
        // 页面滚动：弹层随地图滚走，常驻态一并结束（capture 覆盖内部滚动容器）
        const onScroll = () => dismissTouch();
        document.addEventListener('pointerdown', onDocDown, true);
        window.addEventListener('scroll', onScroll, { passive: true, capture: true });
        touchDismiss = () => {
            document.removeEventListener('pointerdown', onDocDown, true);
            window.removeEventListener('scroll', onScroll, { passive: true, capture: true });
        };
    };

    const onPointerEnter = (e) => {
        if (!isHoverCapable) return;
        const link = e.target.closest('.fm-region');
        if (link && link.dataset.slug) show(link, e.clientX, e.clientY);
    };
    const onPointerLeave = (e) => {
        // 触屏常驻弹层不随 pointerleave 收起（触屏点按抬起即触发 leave，会立即关掉刚显示的弹层）
        if (touchShown) return;
        if (e.target.closest('.fm-region')) hide();
    };
    // 触屏点按兜底：pointerenter 被悬停门禁挡掉；走 click 而非 pointerdown 触发——
    // 手指起手滚动不产生 click，不会误显示弹层
    const onTap = (e) => {
        if (isHoverCapable) return;
        const link = e.target.closest('.fm-region');
        if (!link || !link.dataset.slug) return;
        show(link, e.clientX, e.clientY);
        touchShown = true;
        ensureTouchDismiss();
    };
    const onFocusIn = (e) => {
        const link = e.target.closest('.fm-region');
        if (link && link.dataset.slug) show(link);
    };
    const onFocusOut = (e) => {
        // 焦点在区块之间移动时不闪烁（focusin 会立即重新显示）
        if (e.relatedTarget && e.relatedTarget.closest && e.relatedTarget.closest('.fm-region')) return;
        if (e.target.closest('.fm-region')) hide();
    };
    const onKeydown = (e) => {
        if (e.key === 'Escape') dismissTouch();
    };

    root.addEventListener('pointerenter', onPointerEnter, true);
    root.addEventListener('pointerleave', onPointerLeave, true);
    root.addEventListener('click', onTap);
    root.addEventListener('focusin', onFocusIn);
    root.addEventListener('focusout', onFocusOut);
    root.addEventListener('keydown', onKeydown);

    // 返回移除函数：重建时会重新绑定弹层监听，旧监听必须移除（否则随重建次数累积，
    // 每次悬停都会在已脱离文档的旧弹层上重复执行布局读取）
    return () => {
        root.removeEventListener('pointerenter', onPointerEnter, true);
        root.removeEventListener('pointerleave', onPointerLeave, true);
        root.removeEventListener('click', onTap);
        root.removeEventListener('focusin', onFocusIn);
        root.removeEventListener('focusout', onFocusOut);
        root.removeEventListener('keydown', onKeydown);
        // 常驻态的外部监听一并移除（SPA 换页/重建时不得滞留观察已脱离文档的地图）
        if (touchDismiss) {
            touchDismiss();
            touchDismiss = null;
        }
    };
}

// 淡出时长与 .fm-tooltip 的 transition（--transition = 0.3s）一致
const TOOLTIP_FADE_MS = 300;

function hideTooltip(tooltip) {
    tooltip.classList.remove('fm-visible');
    // display:none 必须等淡出过渡结束再设置——同帧设置会让过渡无从播放、瞬间消失；
    // 但 display:none 不能省：visibility:hidden 的绝对定位元素在 Chrome 中
    // 仍计入 scrollable overflow，缩小窗口时残留位置会撑出横向滚动
    if (tooltip.hideTimer) clearTimeout(tooltip.hideTimer);
    tooltip.hideTimer = setTimeout(() => {
        tooltip.hideTimer = null;
        // 淡出期间被重新显示（再次悬停/点按）时放弃本次隐藏
        if (!tooltip.classList.contains('fm-visible')) {
            tooltip.style.display = 'none';
        }
    }, prefersReducedMotion() ? 0 : TOOLTIP_FADE_MS);
}
