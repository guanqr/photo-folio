/**
 * 足迹世界地图（/footprint/ 顶部）——核心编排
 *
 * - 自绘 SVG 等距圆柱投影（零外部库），世界陆地（Natural Earth 10m）、中国省级边界与
 *   海外国家边界均为一次性生成的简化静态 JSON；省份/国家以独立区块呈现（悬停提亮 +
 *   弹层简讯、点击直接跳转对应地点详情页），照片坐标形成纯展示点迹
 * - 模块结构：几何/路径构建 → footprint-geometry.js（纯函数）、数据读取 →
 *   footprint-map-data.js、弹层 → footprint-tooltip.js；本文件保留状态生命周期
 *   （init/destroy）、build() 编排、增量重投影、布局 FLIP 与区块点击跳转
 * - 懒加载：IntersectionObserver rootMargin 600px 进入视口才构建
 * - SPA 页面切换重跑 initFootprintMap：同一节点幂等，旧状态（observers）先销毁
 */
import { prefersReducedMotion, FLIP_TRANSITION } from './utils.js';
import {
    SVG_NS, VIEW_W, targetHForWidth, fitProjection, project, matrixFrom,
    buildGrid, buildLand, buildRegionLayer, computeBounds
} from './footprint-geometry.js';
import {
    readMapData, loadLandData, loadProvincesData, loadCountriesData,
    resetLandData, resetProvincesData, resetCountriesData, provinceNameOf
} from './footprint-map-data.js';
import { initFootprintTooltip } from './footprint-tooltip.js';

let state = null;          // { root, observer, resizeObserver, cleanup, tooltipCleanup,
                           //   view, layoutRects, layoutAnimating }

export function initFootprintMap() {
    // 清理先于一切：导航到非足迹页时（无 #footprint-map）释放旧状态，
    // 避免 RO/断点监听滞留观察已脱离文档的地图
    destroyState();

    // 地点数据：slug → 详情页 URL/张数映射（区块点击跳转与弹层展示用）
    const mapData = readMapData();
    if (!mapData) return;
    const { root, points, locationData, statsByName } = mapData;

    state = { root, observer: null, resizeObserver: null };

    if ('IntersectionObserver' in window) {
        state.observer = new IntersectionObserver((entries) => {
            if (!entries[0].isIntersecting) return;
            state.observer.disconnect();
            state.observer = null;
            build(root, points, locationData, statsByName).catch((err) => {
                console.warn('[footprint-map] build failed', err);
            });
        }, { rootMargin: '600px 0px' });
        state.observer.observe(root);
    } else {
        build(root, points, locationData, statsByName);
    }
}

function destroyState() {
    if (!state) return;
    if (state.observer) state.observer.disconnect();
    if (state.resizeObserver) state.resizeObserver.disconnect();
    if (state.layoutTimer) clearTimeout(state.layoutTimer); // FLIP 收尾定时器（SPA 跳页后 state 置空，回调会解引用 null 抛 TypeError）
    if (typeof state.cleanup === 'function') state.cleanup();
    state = null;
}

let buildSeq = 0; // 构建序号：断点重建与 RO 重建可能并发，只允许最新一次构建生效

// 增量重投影（拖动窗口/跨断点时的重建路径）：陆地/区块/网格只改组的 matrix 变换、
// 点迹只重定位坐标——不重建任何 DOM、不重投影路径，每帧级成本（拖动中无卡顿）
function updateProjection(root, prNew) {
    const view = state.view;
    if (!view || !root.isConnected) return;
    view.svg.setAttribute('viewBox', `0 0 ${prNew.W} ${prNew.H}`);
    // 网格线按新投影重建：旧网格只覆盖旧视图范围，投影放大（如竖屏→横屏）
    // 后新露出的区域经纬线缺失——线数恒定（步长 10°）、重建成本可忽略；
    // 陆地/省国路径为全量几何，继续走矩阵增量重投影
    view.grid.replaceChildren();
    buildGrid(view.grid, prNew);
    view.grid.removeAttribute('transform');
    view.gridPr = prNew;
    if (view.land) view.land.setAttribute('transform', matrixFrom(view.landPr, prNew));
    if (view.prov) view.prov.setAttribute('transform', matrixFrom(view.provPr, prNew));
    if (view.country) view.country.setAttribute('transform', matrixFrom(view.countryPr, prNew));
    view.dotsData.forEach((d) => {
        const [x, y] = project(prNew, d.lng, d.lat);
        d.inner.setAttribute('transform', `translate(${x},${y})`);
    });
    view.pr = prNew;
    root.style.aspectRatio = `${prNew.W} / ${prNew.H}`; // 框高由纵横比决定
}

// 旋转时布局 FLIP（地图尺寸/图例位置变化）：与卡片换行同款——
// 基准位置每帧持续刷新（动画期间暂停），RO 检测到模式翻转时从上一帧基准回放。
// 不依赖 MQL change 事件「先于布局」的时序（不同环境下并不可靠）
function layoutEls() {
    // FLIP 作用于地图框/图例本身，而非容器 section
    return [
        document.getElementById('footprint-map'),
        document.querySelector('.footprint-map-legend'),
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
    state.layoutTimer = setTimeout(() => {
        state.layoutTimer = null;
        if (!state) return; // SPA 跳页后 destroyState 已置空（定时器本应被取消，双保险）
        state.layoutAnimating = false;
        els.forEach((el) => {
            if (el.style.transition === FLIP_TRANSITION) el.style.transition = '';
            if (el.style.transformOrigin === '0 0') el.style.transformOrigin = '';
        });
    }, 400);
}

async function build(root, points, locationData, statsByName) {
    // 增量重投影快速路径（拖动窗口宽高比漂移/跨断点）：只改 viewBox、组的 matrix
    // 变换与点迹坐标，不重建 DOM、不重投影路径。必须在递增构建序号之前——
    // 否则首建在等待数据 fetch 期间被增量更新「取代」，几何会永久缺失
    if (state.view && root.isConnected) {
        const width = root.getBoundingClientRect().width;
        if (width > 0) {
            // 模式判定用媒体查询（与 CSS 分栏断点一致）——不能用框高是否为 0 判断：
            // 跨断点后内联 aspect-ratio 会让窄屏框高也非 0，导致误按桌面模式算投影
            // 连续宽高比（targetHForWidth）；视图范围沿用首次构建的完整区块 bounds
            updateProjection(root, fitProjection(state.bounds, targetHForWidth(width)));
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
    const countFormat = root.dataset.countFormat;
    const yearFormat = root.dataset.yearRangeFormat || '%MIN% — %MAX%';

    // 可交互区块名单：locationData 里有该地点才可点（无照片的地区中性填充、pointer-events none）
    const activeNames = new Set(locationData.map((d) => d.name));

    // 几何数据先于投影加载：视图范围 = 照片点迹 ∪ 全部有照片地区的完整区块
    //（省区块完整可见、不被 viewBox 裁切——如青海照片在中东部、省界西段须完整露出）
    let landPolys = null;
    try {
        landPolys = await loadLandData();
    } catch (err) {
        resetLandData();
        console.warn('[footprint-map] land geometry load failed', err);
    }
    if (!root.isConnected || seq !== buildSeq) return;

    let provData = null;
    try {
        provData = await loadProvincesData();
    } catch (err) {
        resetProvincesData();
        console.warn('[footprint-map] province boundaries load failed', err);
    }
    if (!root.isConnected || seq !== buildSeq) return;

    let countryData = null;
    try {
        countryData = await loadCountriesData();
    } catch (err) {
        resetCountriesData();
        console.warn('[footprint-map] country boundaries load failed', err);
    }
    if (!root.isConnected || seq !== buildSeq) return;

    const bounds = computeBounds(points, provData, activeNames, provinceNameOf);
    const fitPoints = [
        { lng: bounds.minLng, lat: bounds.minLat },
        { lng: bounds.maxLng, lat: bounds.maxLat },
    ];
    const pr = fitProjection(fitPoints, targetHForWidth(width));
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
        buildRegionLayer(prov, provData, pr, locationData, statsByName, provinceNameOf);
        prov.setAttribute('transform', matrixFrom(pr, state.view.pr));
        state.view.prov = prov;
        state.view.provPr = pr;
        svg.insertBefore(prov, grid);
    }

    // 海外国家区块（键 = 站点地点名，与 locations.toml 一致）
    if (countryData) {
        const country = document.createElementNS(SVG_NS, 'g');
        country.setAttribute('class', 'fm-regions');
        buildRegionLayer(country, countryData, pr, locationData, statsByName, (key) => key);
        country.setAttribute('transform', matrixFrom(pr, state.view.pr));
        state.view.country = country;
        state.view.countryPr = pr;
        svg.insertBefore(country, grid);
    }

    if (seq !== buildSeq) return; // 成功路径在 await 后已守卫，此处兜底（如未缓存 fetch 快速完成）
    const tooltipMod = initFootprintTooltip({ root, tooltip, countFormat, yearFormat });
    state.tooltipCleanup = tooltipMod.cleanup;

    // resize/旋转：关闭弹层；桌面等高模式下宽高比漂移超过 1% 时做增量重投影——
    // 该路径成本极低（改 viewBox + 组变换 + 点迹坐标），无需防抖，拖动中地图实时跟随
    if ('ResizeObserver' in window) {
        let rebuildQueued = false;
        // 屏幕朝向类型（iOS 16.4+ 提供；不可用时为 null）：区分旋转（一次性大跳变 → FLIP）
        // 与拖动（连续小变化 → 直接跟随、不 FLIP）
        let lastOrientationType = (typeof screen !== 'undefined' && screen.orientation)
            ? screen.orientation.type
            : null;
        state.resizeObserver = new ResizeObserver(() => {
            tooltipMod.hide();
            if (rebuildQueued) return;
            rebuildQueued = true;
            requestAnimationFrame(() => {
                rebuildQueued = false;
                if (!root.isConnected) return;
                const w = root.getBoundingClientRect().width;
                const h = root.getBoundingClientRect().height;
                if (!(w > 0) || !(h > 0)) return;
                // 连续宽高比（targetHForWidth）：偏差超 0.5% 即增量重投影
                //（fast path 每帧级成本）——拖动窗口时地图随宽度连续形变、无跳变
                const targetRatio = targetHForWidth(w) / VIEW_W;
                const drift = Math.abs(h / w - targetRatio) / targetRatio;
                // 基准位置每帧刷新（动画期间暂停）：旋转 FLIP 的 First
                const prevRects = state.layoutRects;
                if (!state.layoutAnimating) {
                    state.layoutRects = rectsOf(layoutEls());
                }
                if (drift > 0.005) {
                    build(root, points, locationData, statsByName).catch((err) => {
                        console.warn('[footprint-map] rebuild failed', err);
                    });
                    // 旋转带来的一次性大跳变：以旋转前的基准回放 FLIP 平滑过渡
                    //（拖动不触发；fast path 同步完成后再量测 Last）
                    const rotated = lastOrientationType !== null
                        && screen.orientation && screen.orientation.type !== lastOrientationType;
                    lastOrientationType = screen.orientation
                        ? screen.orientation.type
                        : lastOrientationType;
                    if (rotated) {
                        state.layoutRects = prevRects;
                        flipLayout();
                    }
                }
            });
        });
        state.resizeObserver.observe(root);
    }

    // 布局 FLIP 基准：RO 每 tick 刷新（动画期间暂停），旋转时回放
    state.layoutRects = null;
    state.layoutAnimating = false;

    // ===== 联动：省/国区块点击 → 直接跳转地点详情页 =====
    const onRegionClick = (e) => {
        const path = e.target.closest('.fm-region');
        if (!path || !path.dataset.slug) return;
        e.preventDefault();
        e.stopPropagation();
        const entry = locationData.find((d) => d.slug === path.dataset.slug);
        if (!entry || !entry.url) return;
        // 创建 <a> 触发 click 走站内 SPA 切换管线（page-transition 拦截），
        // 与普通站内链接跳转体验一致；弹层在滚动/点按外部时照常收起
        const link = document.createElement('a');
        link.href = entry.url;
        document.body.appendChild(link);
        link.click();
        link.remove();
    };
    root.addEventListener('click', onRegionClick);

    state.cleanup = () => {
        root.querySelectorAll('.fm-tooltip').forEach((t) => t.remove());
        root.removeEventListener('click', onRegionClick);
        if (typeof state.tooltipCleanup === 'function') {
            state.tooltipCleanup();
            state.tooltipCleanup = null;
        }
    };
}
