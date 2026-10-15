/**
 * 足迹地图几何库（纯函数、零依赖；集成见 footprint-map.js）
 *
 * - 等距圆柱投影与视图适配（fit-to-bounds + 边距 + 最小跨度守卫）、连续宽高比
 *   （窄屏锁定 0.75、768→1200px 线性插值至 0.45）与增量重投影的仿射矩阵
 * - SVG 路径构建：网格线、陆地 path、省/国区块（每地区多环合并单 path、
 *   换日线断段守卫）；视图 bounds = 照片点迹 ∪ 有照片省份的完整区块
 * - 全部为无状态纯函数：数据进、DOM 元素出，不触碰模块状态
 */

const VIEW_W = 1000;       // 视图固定宽（SVG user 单位）
const MIN_H = 400;         // 视图高下限（桌面 0.45 封顶须低于此值；退化守卫由 MIN_SPAN 承担）
const MAX_H = 1000;        // 视图高上限
const PAD = 0.15;          // fit-to-bounds 边距比例
const MIN_SPAN_X = 12;     // 最小经度跨度（°），防单点退化
const MIN_SPAN_Y = 9;      // 最小纬度跨度（°）
const GRID_STEP = 10;      // 网格线步长（°）

export { VIEW_W };
export const SVG_NS = 'http://www.w3.org/2000/svg';

/* 连续宽高比：窄屏区域（≤768px，与全站断点一致）比例**锁定** 0.75（竖屏友好、
   不再随宽度变化）；768→1200px 线性插值到 0.45（一屏看全）；1200px 以上取 0.45 */
const NARROW_MAP_RATIO = 0.75;
const DESKTOP_MAP_RATIO = 0.45;
const RATIO_MIN_W = 768;   // 窄屏区域起点：低于此宽度比例锁定
const RATIO_MAX_W = 1200;

export function targetHForWidth(width) {
    const r = Math.min(1, Math.max(0, (width - RATIO_MIN_W) / (RATIO_MAX_W - RATIO_MIN_W)));
    return Math.round(VIEW_W * (NARROW_MAP_RATIO + (DESKTOP_MAP_RATIO - NARROW_MAP_RATIO) * r));
}

/* ===== 投影与视图适配（等距圆柱，φ1 = 视图纬度中点） =====
   视图范围 = 全部照片坐标的包围盒（+ 15% 边距 + 最小跨度守卫）。
   targetH 传入时（桌面分栏：地图框高度由等高卡片决定）按框的宽高比重算视图高，
   地图内容始终填满等高框（多出的区域表现为更多的网格/海洋，而非 letterbox） */
export function fitProjection(points, targetH) {
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

export function project(pr, lng, lat) {
    return [pr.ox + pr.s * pr.cos1 * lng, pr.oy - pr.s * lat];
}

// 仿射映射：等距圆柱投影变化（s/ox/oy/cos1）→ 旧坐标系到新坐标系的 matrix（x' = a·x + b，y' = c·y + d）
export function matrixFrom(prFrom, prTo) {
    const a = (prTo.s * prTo.cos1) / (prFrom.s * prFrom.cos1);
    const b = prTo.ox - a * prFrom.ox;
    const c = prTo.s / prFrom.s;
    const d = prTo.oy - c * prFrom.oy;
    return `matrix(${a} 0 0 ${c} ${b} ${d})`;
}

/* 网格线：等距圆柱下均为直线；按可视范围反推经纬度起止 */
export function buildGrid(g, pr) {
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
export function buildLand(g, polys, pr, quant = 20) {
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

/* 区块图层构建（省/国共用）：每个地区合并为单个 path，挂地点名/计数/年份
   数据属性；nameOf 把数据键映射为站点地点名（省经繁简映射、国恒等）；
   无照片地区中性填充、不可交互。有照片地区键盘可达：tabindex/role/link +
   aria-label（地点与作品数，countFormat 由页面模板注入、与弹层同格式） */
export function buildRegionLayer(g, data, pr, locationData, statsByName, nameOf, countFormat) {
    for (const [key, polys] of Object.entries(data.data)) {
        const siteName = nameOf(key);
        const entry = siteName ? locationData.find((d) => d.name === siteName) : null;
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
            attrs.tabindex = '0';
            attrs.role = 'link';
            attrs['aria-label'] = `${siteName}，${String(countFormat).replace('%COUNT%', entry.count)}`;
        }
        buildRegionPath(g, polys, pr, data.quant, attrs);
    }
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
   海外国家不并入包围盒，随照片点自然呈现）。nameOf 把省界数据键映射为站点
   地点名（无照片地区不并入） */
export function computeBounds(points, provData, activeNames, nameOf) {
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
            const siteName = nameOf(key);
            if (siteName && activeNames.has(siteName)) extendRings(polys, provData.quant);
        }
    }
    return { minLng, maxLng, minLat, maxLat };
}
