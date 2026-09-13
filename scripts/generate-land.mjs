/**
 * 一次性生成「地图足迹」所需的世界陆地简化几何数据（零 npm 依赖，Node >= 18）。
 *
 * 管线：下载 Natural Earth 110m land GeoJSON → Douglas-Peucker 简化（逐级加强直到体积达标）
 *      → 0.1° 量化成整数对 [lon*10, lat*10] → 删除连续重复点 → 输出静态 JSON。
 *
 * 用法：node scripts/generate-land.mjs
 * 输出：themes/photofolio/static/maps/land-110m.json（提交入库；原始下载缓存于 scripts/vendor/，不入库）
 */
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// GitHub raw 在国内不稳定，优先走 jsDelivr CDN 镜像
const SRC_URLS = [
    'https://cdn.jsdelivr.net/gh/nvkelso/natural-earth-vector@master/geojson/ne_110m_land.geojson',
    'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_land.geojson'
];
const MAX_BYTES = 80 * 1024; // 输出体积上限
const QUANT = 10;            // 0.1° 量化

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const vendorDir = path.join(__dirname, 'vendor');
const outFile = path.join(__dirname, '..', 'themes', 'photofolio', 'static', 'maps', 'land-110m.json');

/* ---------- 下载（带本地缓存） ---------- */
async function loadSource() {
    const cacheFile = path.join(vendorDir, 'ne_110m_land.geojson');
    if (existsSync(cacheFile)) return JSON.parse(readFileSync(cacheFile, 'utf8'));
    let lastErr = null;
    for (const url of SRC_URLS) {
        try {
            console.log(`downloading ${url} ...`);
            const res = await fetch(url, { redirect: 'follow' });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const text = await res.text();
            mkdirSync(vendorDir, { recursive: true });
            writeFileSync(cacheFile, text);
            return JSON.parse(text);
        } catch (err) {
            lastErr = err;
            console.warn(`  failed: ${err.message}`);
        }
    }
    throw lastErr || new Error('download failed');
}

/* ---------- Douglas-Peucker 简化（点距平方，避免 sqrt） ---------- */
function dpSimplify(points, toleranceDeg) {
    const tol2 = toleranceDeg * toleranceDeg;
    const n = points.length;
    if (n <= 2) return points;
    const keep = new Uint8Array(n);
    keep[0] = keep[n - 1] = 1;

    const stack = [[0, n - 1]];
    while (stack.length) {
        const [a, b] = stack.pop();
        const [ax, ay] = points[a];
        const [bx, by] = points[b];
        const dx = bx - ax;
        const dy = by - ay;
        const base = dx * dx + dy * dy;
        let maxD = 0;
        let maxI = -1;
        for (let i = a + 1; i < b; i++) {
            let d;
            if (base === 0) {
                const px = points[i][0] - ax;
                const py = points[i][1] - ay;
                d = px * px + py * py;
            } else {
                // 点到线段距离：|cross| / |base|，比较时用 cross^2 / base 即可
                const cx = points[i][0] - ax;
                const cy = points[i][1] - ay;
                const cross = cx * dy - cy * dx;
                d = (cross * cross) / base;
            }
            if (d > maxD) { maxD = d; maxI = i; }
        }
        if (maxD > tol2 && maxI > 0) {
            stack.push([a, maxI], [maxI, b]);
            keep[maxI] = 1;
        }
    }
    return points.filter((_, i) => keep[i]);
}

/* ---------- 编码：量化 + 去连续重复 ---------- */
function encodeRing(ring) {
    const out = [];
    let prev = null;
    for (const [lon, lat] of ring) {
        const x = Math.round(lon * QUANT);
        const y = Math.round(lat * QUANT);
        if (prev === null || prev[0] !== x || prev[1] !== y) {
            out.push([x, y]);
            prev = [x, y];
        }
    }
    // 闭合环：首尾一致时去掉末点
    if (out.length > 2 && out[0][0] === out[out.length - 1][0] && out[0][1] === out[out.length - 1][1]) {
        out.pop();
    }
    return out;
}

function encode(geojson, tolerance) {
    const polys = [];
    for (const f of geojson.features) {
        const geom = f.geometry;
        if (!geom || (geom.type !== 'Polygon' && geom.type !== 'MultiPolygon')) continue;
        // Polygon 的坐标是环数组、MultiPolygon 是多边形（各为环数组）数组——统一成「多边形列表」
        const polyList = geom.type === 'Polygon' ? [geom.coordinates] : geom.coordinates;
        for (const poly of polyList) {
            polys.push(poly.map((ring) => encodeRing(dpSimplify(ring, tolerance))));
        }
    }
    return polys;
}

/* ---------- 主流程 ---------- */
const src = await loadSource();
console.log(`source features: ${src.features.length}`);

let best = null;
for (const tol of [0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.4, 0.5]) {
    const polys = encode(src, tol);
    const json = JSON.stringify(polys);
    const bytes = Buffer.byteLength(json);
    console.log(`tol=${tol}  polys=${polys.length}  bytes=${bytes}`);
    best = { json, bytes };
    if (bytes <= MAX_BYTES) break;
}

if (best.bytes > MAX_BYTES) {
    throw new Error(`cannot reach ${MAX_BYTES} bytes even at max tolerance`);
}

mkdirSync(path.dirname(outFile), { recursive: true });
writeFileSync(outFile, best.json);
console.log(`written: ${outFile} (${best.bytes} bytes)`);
