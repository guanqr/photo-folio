/**
 * 足迹世界地图（/footprint/ 顶部）
 *
 * - 自绘 SVG 等距圆柱投影（零外部库），世界陆地几何为一次性生成的简化静态 JSON
 *   （同源 fetch、模块级 Promise 记忆化，sw 自动缓存；失败仅降级为网格 + 光点）
 * - 按省份/国家聚合光点：三层圆（光晕/中层/核心），半径随照片数增长；
 *   交错弹入动画，照片数最多的首点带呼吸脉冲环；reduced-motion 全部降级
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

const SVG_NS = 'http://www.w3.org/2000/svg';

let landPromise = null;    // 陆地几何 fetch 记忆化（跨 SPA 页面切换复用）
let state = null;          // { root, observer, resizeObserver, cleanup }

export function initFootprintMap() {
    const root = document.getElementById('footprint-map');
    const dataEl = document.getElementById('footprint-map-data');
    if (!root || !dataEl) return;

    // 同一节点已初始化（或正在懒加载观察中）→ 幂等
    if (state && state.root === root) return;

    destroyState();

    let points;
    try {
        points = JSON.parse(dataEl.textContent);
    } catch (err) {
        console.warn('[footprint-map] 数据解析失败', err);
        return;
    }
    if (!Array.isArray(points) || points.length === 0) return;

    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    state = { root, reduced, observer: null, resizeObserver: null };

    if ('IntersectionObserver' in window) {
        state.observer = new IntersectionObserver((entries) => {
            if (!entries[0].isIntersecting) return;
            state.observer.disconnect();
            state.observer = null;
            build(root, points, reduced).catch((err) => {
                console.warn('[footprint-map] 构建失败', err);
            });
        }, { rootMargin: '600px 0px' });
        state.observer.observe(root);
    } else {
        build(root, points, reduced);
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
   视图范围 = 全部拍摄地点坐标的包围盒（+ 15% 边距 + 最小跨度守卫） */
function fitProjection(points) {
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

    // 视图高随数据纵横比锁定，限制在 2:1 ~ 1:1 之间
    const H = Math.min(MAX_H, Math.max(MIN_H, Math.round((VIEW_W * dy) / dx)));
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
async function build(root, points, reduced) {
    // 容器宽度为 0 守卫（display:none / SPA 淡出瞬间）：rAF 重试，30 帧后放弃
    let width = root.getBoundingClientRect().width;
    for (let frame = 0; width === 0 && frame < 30; frame++) {
        await new Promise((r) => requestAnimationFrame(r));
        width = root.getBoundingClientRect().width;
    }
    if (width === 0 || !root.isConnected) return;

    const pr = fitProjection(points);
    const countFormat = root.dataset.countFormat || '%COUNT% 張照片';
    const yearFormat = root.dataset.yearRangeFormat || '%MIN% — %MAX%';

    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', `0 0 ${pr.W} ${pr.H}`);
    svg.setAttribute('role', 'group');
    root.style.aspectRatio = `${pr.W} / ${pr.H}`; // 锁定纵横比，弹层坐标换算无 letterbox

    const grid = document.createElementNS(SVG_NS, 'g');
    grid.setAttribute('class', 'fm-grid');
    buildGrid(grid, pr);
    svg.appendChild(grid);

    const dots = document.createElementNS(SVG_NS, 'g');
    dots.setAttribute('class', 'fm-dots');
    points.forEach((p, i) => buildDot(dots, pr, p, i, reduced, countFormat));
    svg.appendChild(dots);

    root.appendChild(svg);

    // 弹层与事件（在陆地加载前即可用）
    const tooltip = document.createElement('div');
    tooltip.className = 'fm-tooltip';
    tooltip.setAttribute('role', 'status');
    root.appendChild(tooltip);
    bindTooltip(root, tooltip, countFormat, yearFormat);

    // 陆地几何：同源 fetch（记忆化的是解析后的 JSON——Response 只能消费一次，
    // SPA 返回重进本页时必须复用已解析数据；绝对路径避免解析到 /footprint/maps/…）
    // 失败仅 warn（且不记忆化，下次进入重试），网格 + 光点照常可用
    try {
        landPromise = landPromise || fetch(new URL('/maps/land-110m.json', document.baseURI)).then((res) => {
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            return res.json();
        });
        const polys = await landPromise;
        if (!root.isConnected) return; // 构建中途 SPA 已跳走
        const land = document.createElementNS(SVG_NS, 'g');
        land.setAttribute('class', 'fm-land');
        buildLand(land, polys, pr);
        svg.insertBefore(land, grid);
    } catch (err) {
        landPromise = null;
        console.warn('[footprint-map] 陆地几何加载失败，仅显示网格与光点', err);
    }

    // 弹入动画：构建完成后统一点亮（reduced 时直接可见）
    if (reduced) {
        dots.querySelectorAll('.fm-dot-link').forEach((el) => {
            el.style.opacity = '1';
            el.style.transform = 'none';
        });
    } else {
        dots.querySelectorAll('.fm-dot-link').forEach((el) => {
            el.style.setProperty('--fm-delay', el.dataset.delay + 'ms');
            el.classList.add('fm-ready');
        });
    }

    // resize/旋转时关闭弹层（viewBox 等比缩放无需重算布局）
    if ('ResizeObserver' in window) {
        state.resizeObserver = new ResizeObserver(() => hideTooltip(tooltip));
        state.resizeObserver.observe(root);
    }
    state.cleanup = () => root.querySelectorAll('.fm-tooltip').forEach((t) => t.remove());
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
function buildDot(g, pr, p, i, reduced, countFormat) {
    const r = Math.min(3 + 1.7 * Math.sqrt(p.count - 1), 13);
    const [x, y] = project(pr, p.lng, p.lat);
    const coreR = Math.max(r * 0.45, 2);

    const link = document.createElementNS(SVG_NS, 'a');
    link.setAttribute('class', 'fm-dot-link');
    link.setAttribute('href', p.url);
    link.dataset.delay = Math.min(i * STAGGER, MAX_STAGGER);
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

    if (!reduced && i === 0 && p.count > 1) {
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

    root.addEventListener('pointerenter', (e) => {
        if (!isHoverCapable) return;
        const link = e.target.closest('.fm-dot-link');
        if (link) show(link);
    }, true);
    root.addEventListener('pointerleave', (e) => {
        if (e.target.closest('.fm-dot-link')) hide();
    }, true);
    root.addEventListener('focusin', (e) => {
        const link = e.target.closest('.fm-dot-link');
        if (link) show(link);
    });
    root.addEventListener('focusout', (e) => {
        // 焦点在光点之间移动时不闪烁（focusin 会立即重新显示）
        if (e.relatedTarget && e.relatedTarget.closest && e.relatedTarget.closest('.fm-dot-link')) return;
        if (e.target.closest('.fm-dot-link')) hide();
    });
    root.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') hide();
    });
}

function hideTooltip(tooltip) {
    tooltip.classList.remove('fm-visible');
    // display:none 彻底移出布局与可滚动溢出（visibility:hidden 的绝对定位元素
    // 在 Chrome 中仍计入 scrollable overflow，缩小窗口时残留位置会撑出横向滚动）
    tooltip.style.display = 'none';
}
