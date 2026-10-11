/**
 * 足迹地点详情页小地图（/footprint/<slug>/）
 *
 * - 视图 = 照片点包围盒居中；**垂直跨度下限统一 1.12°**——小范围拍摄的省份不
 *   过度放大、放大率一致；水平跨度 = 垂直跨度 × 渲染框纵横比（视图随框动态适配，
 *   所有光点始终可见、无裁切）
 * - 图层（自下而上）：省界单独轮廓（填充，海外地点为海岸线裁剪）→ 城市边界线 +
 *   城市名称标注 → 经纬网格（1-2-5 自适应步长）→ 光点
 * - 光点按坐标去重聚合、**大小随照片数量增长**（与主地图同款公式），纯展示：
 *   无点击/无弹层，仅内置原生 <title>（桌面悬停显示地点名与张数）；
 *   文字/光点尺寸与描边线宽按渲染比例补偿，跨屏宽像素恒定
 * - 无懒加载/无弹入动画：页面顶部直接构建；resize 时观察器按新纵横比重建
 * - SPA 页面切换重跑 initFootprintLocationMap：同一节点幂等，旧状态先销毁
 */

import {
    fitProjection,
    project,
    buildLand,
    loadLandData,
    loadProvincesData,
} from './footprint-map.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const VIEW_W = 1000;  // 视图固定宽（与主地图一致）
const MIN_VB_H = 240; // 视图高下限（防极端横宽框）
const MAX_VB_H = 1000; // 视图高上限（防极端竖窄框）
const FLOOR_Y = 1.12; // 统一垂直跨度下限（°）：小范围省份固定放大率（水平跨度按框比例推导）
const PAD_FACTOR = 1.3; // 光点实际跨度 ×1.3（fitProjection 内另有 15% 边距）

// 繁→简省名映射（locations.toml 地点名 → provinces.json/cities.json 键，数据源为简体省名）
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

let state = null;        // { cleanup }
let citiesPromise = null; // 城市边界 fetch 记忆化（模块级，SPA 复用）

function loadCitiesData() {
    if (!citiesPromise) {
        citiesPromise = fetch(new URL('/maps/cities.json', document.baseURI)).then((res) => {
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            return res.json();
        });
    }
    return citiesPromise;
}

export function initFootprintLocationMap() {
    // 清理先于一切：SPA 换页释放旧状态
    if (state) {
        if (typeof state.cleanup === 'function') state.cleanup();
        state = null;
    }

    const root = document.getElementById('location-map');
    const dataEl = document.getElementById('location-map-data');
    if (!root || !dataEl) return;

    let data;
    try {
        data = JSON.parse(dataEl.textContent);
    } catch (err) {
        console.warn('[location-map] data parse failed', err);
        return;
    }
    const points = data.points;
    if (!Array.isArray(points) || points.length === 0) return;

    const rebuild = () => build(root, data.name, points).catch((err) => {
        console.warn('[location-map] build failed', err);
    });
    rebuild();

    // resize：高度固定、宽度随视口——框纵横比变化时按新比例重建（rAF 防抖；
    // 数据 fetch 已记忆化，重建只重投影）
    let pendingResize = false;
    const ro = new ResizeObserver(() => {
        if (pendingResize) return;
        pendingResize = true;
        requestAnimationFrame(() => {
            pendingResize = false;
            if (!root.isConnected) return;
            rebuild();
        });
    });
    ro.observe(root);

    state = { cleanup: () => ro.disconnect() };
}

/* 环的经纬度包围盒（量化整数对，quant = 单位/度） */
function ringBounds(ring, quant = 20) {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const [xq, yq] of ring) {
        const x = xq / quant;
        const y = yq / quant;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
    }
    return { minX, maxX, minY, maxY };
}

/* 与视野范围相交的环（海岸线裁剪、城市边界裁剪用） */
function ringsInView(polys, view, quant = 20) {
    const out = [];
    const pad = 0.8; // 视野外扩（°），留出边缘裁切余量
    for (const poly of polys) {
        const rings = [];
        for (const ring of poly) {
            const b = ringBounds(ring, quant);
            if (b.maxX >= view.minX - pad && b.minX <= view.maxX + pad &&
                b.maxY >= view.minY - pad && b.minY <= view.maxY + pad) {
                rings.push(ring);
            }
        }
        if (rings.length) out.push(rings);
    }
    return out;
}

/* 网格步长：1-2-5 序列取约 targetLines 条线的「漂亮」步长 */
function niceStep(span, targetLines) {
    const raw = span / targetLines;
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    for (const m of [1, 2, 5, 10]) {
        if (raw <= m * mag) return m * mag;
    }
    return 10 * mag;
}

function buildGrid(g, pr, view) {
    const stepX = niceStep(view.maxX - view.minX, 5);
    const stepY = niceStep(view.maxY - view.minY, 4);
    for (let lng = Math.ceil(view.minX / stepX) * stepX; lng <= view.maxX; lng += stepX) {
        const [x] = project(pr, lng, 0);
        const line = document.createElementNS(SVG_NS, 'line');
        line.setAttribute('x1', x);
        line.setAttribute('x2', x);
        line.setAttribute('y1', 0);
        line.setAttribute('y2', pr.H);
        g.appendChild(line);
    }
    for (let lat = Math.ceil(view.minY / stepY) * stepY; lat <= view.maxY; lat += stepY) {
        const [, y] = project(pr, 0, lat);
        const line = document.createElementNS(SVG_NS, 'line');
        line.setAttribute('x1', 0);
        line.setAttribute('x2', pr.W);
        line.setAttribute('y1', y);
        line.setAttribute('y2', y);
        g.appendChild(line);
    }
}

async function build(root, name, points) {
    // 视图纵横比跟随渲染框（宽屏更宽、窄屏更窄）：保证所有光点可见、无上下裁切。
    // 高度由样式表固定，宽度随视口——resize 时由观察器重建
    const boxW = root.getBoundingClientRect().width;
    const boxH = root.getBoundingClientRect().height;
    const ratio = boxW > 0 && boxH > 0 ? boxW / boxH : VIEW_W / 400;
    const vbH = Math.min(MAX_VB_H, Math.max(MIN_VB_H, Math.round(VIEW_W / ratio)));
    // 渲染尺寸补偿：viewBox 高度随框纵横比变化，文字/光点尺寸须按
    // vbH/boxH 反算——渲染后的像素大小恒定（字号、光点半径不随屏宽剧烈变化）
    const sizeScale = boxH > 0 ? vbH / boxH : 1;

    // 视野范围：光点包围盒居中；跨度 = max(实际 ×1.3, 统一下限)，再按框比例补齐
    // （水平跨度 = 垂直跨度 × 框比例——内容纵横比与框一致，渲染无裁切无留边）
    let minLng = Infinity, maxLng = -Infinity, minLat = Infinity, maxLat = -Infinity;
    for (const p of points) {
        if (p.lat == null || p.lng == null) continue;
        minLng = Math.min(minLng, p.lng);
        maxLng = Math.max(maxLng, p.lng);
        minLat = Math.min(minLat, p.lat);
        maxLat = Math.max(maxLat, p.lat);
    }
    const cx = (minLng + maxLng) / 2;
    const cy = (minLat + maxLat) / 2;
    let spanY = Math.max((maxLat - minLat) * PAD_FACTOR, FLOOR_Y);
    let spanX = Math.max((maxLng - minLng) * PAD_FACTOR, FLOOR_Y * ratio);
    if (spanX / spanY > ratio) {
        spanY = spanX / ratio;
    } else {
        spanX = spanY * ratio;
    }
    const view = {
        minX: cx - spanX / 2,
        maxX: cx + spanX / 2,
        minY: cy - spanY / 2,
        maxY: cy + spanY / 2,
    };

    // fit-to-bounds：传入两个极值角点（fitProjection 只取所有点的 min/max）；
    // 最小跨度守卫传 0——跨度已在上方按统一口径确定，勿让世界地图守卫（12°×9°）撑大视野；
    // 视图高强制 = vbH（内容纵横比已与框一致，两向约束同时触达、无留边）
    const pr = fitProjection([
        { lng: view.minX, lat: view.minY },
        { lng: view.maxX, lat: view.maxY },
    ], vbH, 0, 0, vbH, vbH);

    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', `0 0 ${pr.W} ${pr.H}`);
    // 内容纵横比已与渲染框一致，slice 实为无裁切直铺（防御极端钳制）
    svg.setAttribute('preserveAspectRatio', 'xMidYMid slice');
    svg.setAttribute('role', 'group');

    const provinceKey = PROVINCE_NAMES[name];

    // 描边恒定像素：viewBox 缩放时线宽不变（SVG 2 非缩放描边，光箱图表同款技巧）
    const fixStrokes = (g) => {
        g.querySelectorAll('path, line').forEach((el) => el.setAttribute('vector-effect', 'non-scaling-stroke'));
    };

    // 海岸线仅用于海外地点（如日本）——省份页只显示省图，海岸线已含在省界轮廓内
    if (!provinceKey) {
        try {
            const land = await loadLandData();
            const coast = document.createElementNS(SVG_NS, 'g');
            coast.setAttribute('class', 'lm-coast');
            buildLand(coast, ringsInView(land, view), pr);
            fixStrokes(coast);
            svg.appendChild(coast);
        } catch (err) {
            console.warn('[location-map] land data load failed', err);
        }
    }

    // 省界单独轮廓（填充背景，超出视野部分被裁剪）；数据为 {quant, data: {省名: 环数组}}
    if (provinceKey) {
        try {
            const provData = await loadProvincesData();
            const regionRings = provData.data && provData.data[provinceKey];
            if (regionRings) {
                const region = document.createElementNS(SVG_NS, 'g');
                region.setAttribute('class', 'lm-region');
                buildLand(region, regionRings, pr, provData.quant);
                fixStrokes(region);
                svg.appendChild(region);
            }
        } catch (err) {
            console.warn('[location-map] province data load failed', err);
        }

        // 城市边界线 + 城市名称标注（失败静默降级）；
        // 数据为 {quant, data: {省名: {polys, labels}}}，量化口径按文件头还原
        try {
            const cities = await loadCitiesData();
            const city = cities && cities.data && cities.data[provinceKey];
            if (city) {
                const cityG = document.createElementNS(SVG_NS, 'g');
                cityG.setAttribute('class', 'lm-cities');
                buildLand(cityG, ringsInView(city.polys, view, cities.quant), pr, cities.quant);
                fixStrokes(cityG);
                svg.appendChild(cityG);

                const labelG = document.createElementNS(SVG_NS, 'g');
                labelG.setAttribute('class', 'lm-labels');
                // 字号按渲染比例反算（CSS 不设 font-size，避免覆盖）
                labelG.setAttribute('font-size', Math.round(12 * sizeScale));
                for (const [labelName, xq, yq] of city.labels) {
                    const [x, y] = project(pr, xq / cities.quant, yq / cities.quant);
                    if (x < 0 || x > pr.W || y < 0 || y > pr.H) continue;
                    const t = document.createElementNS(SVG_NS, 'text');
                    t.setAttribute('x', x);
                    t.setAttribute('y', y);
                    t.setAttribute('text-anchor', 'middle');
                    t.textContent = labelName;
                    labelG.appendChild(t);
                }
                svg.appendChild(labelG);
            }
        } catch (err) {
            console.warn('[location-map] cities data load failed', err);
        }
    }

    // 经纬网格
    const grid = document.createElementNS(SVG_NS, 'g');
    grid.setAttribute('class', 'lm-grid');
    buildGrid(grid, pr, view);
    fixStrokes(grid);
    svg.appendChild(grid);

    // 光点：按坐标去重聚合（模板已聚合）；大小随照片数量增长（与主地图同款公式，
    // 半径再乘渲染补偿——渲染像素恒定）；纯展示——无点击/无弹层，内置原生 title
    const dots = document.createElementNS(SVG_NS, 'g');
    dots.setAttribute('class', 'lm-dots');
    for (const p of points) {
        if (p.lat == null || p.lng == null) continue;
        const count = p.count || 1;
        const r = Math.min(3 + 1.7 * Math.sqrt(count - 1), 13) * sizeScale;
        const coreR = Math.max(r * 0.45, 2 * sizeScale);
        const [x, y] = project(pr, p.lng, p.lat);
        const link = document.createElementNS(SVG_NS, 'g');
        link.setAttribute('class', 'lm-dot');
        link.setAttribute('transform', `translate(${x},${y})`);

        const title = document.createElementNS(SVG_NS, 'title');
        title.textContent = `${p.place || ''} · ${count} 張`;
        link.appendChild(title);

        const halo = document.createElementNS(SVG_NS, 'circle');
        halo.setAttribute('class', 'lm-halo');
        halo.setAttribute('r', r * 2.2);
        const core = document.createElementNS(SVG_NS, 'circle');
        core.setAttribute('class', 'lm-core');
        core.setAttribute('r', coreR);
        link.append(halo, core);
        dots.appendChild(link);
    }
    svg.appendChild(dots);

    root.replaceChildren(svg);
    // 高度与宽高比由样式表控制（全宽固定 18.5em），JS 不再写内联纵横比
}
