/**
 * 足迹地图数据读取（零依赖；集成见 footprint-map.js）
 *
 * - 页面 JSON：地点（slug/详情页 URL/张数）、年份统计与照片坐标——构建期注入的
 *   script 标签；坐标解析失败或为空时返回 null（放弃构建），地点/年份容错为空
 * - 几何数据 fetch 记忆化（陆地 10m/省界/国家边界，模块级 Promise 跨 SPA 页面
 *   切换复用、Service Worker 自动缓存）：失败后由 reset* 重置缓存允许下次重试，
 *   降级为网格 + 点迹
 * - 繁→简省名映射（locations.toml 地点名 → provinces.json 键，数据源为简体省名）：
 *   省份区块的 dataset 存站点地点名（繁），经此映射反向查省界数据；
 *   映射来自生成的 map-names.js（唯一源 tools/map-data/map_names.py）
 */
import { PROVINCE_NAMES } from './map-names.js';

const PROVINCE_NAMES_REV = Object.fromEntries(Object.entries(PROVINCE_NAMES).map(([k, v]) => [v, k]));

// 省界数据键 → 站点地点名（无对应地点的省份返回 null，不并入视图范围）
export const provinceNameOf = (key) => PROVINCE_NAMES_REV[key] || null;

let landPromise = null;      // 陆地几何 fetch 记忆化（跨 SPA 页面切换复用）
let provincesPromise = null; // 省级边界 fetch 记忆化（同款）
let countriesPromise = null; // 海外国家边界 fetch 记忆化（同款）

export function loadLandData() {
    if (!landPromise) {
        landPromise = fetch(new URL('/maps/land-10m.json', document.baseURI)).then((res) => {
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            return res.json();
        });
    }
    return landPromise;
}

export function loadProvincesData() {
    if (!provincesPromise) {
        provincesPromise = fetch(new URL('/maps/provinces.json', document.baseURI)).then((res) => {
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            return res.json();
        });
    }
    return provincesPromise;
}

export function loadCountriesData() {
    if (!countriesPromise) {
        countriesPromise = fetch(new URL('/maps/countries.json', document.baseURI)).then((res) => {
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            return res.json();
        });
    }
    return countriesPromise;
}

// 加载失败重置：下次构建重试（成功路径不重置，跨页面复用）
export function resetLandData() { landPromise = null; }
export function resetProvincesData() { provincesPromise = null; }
export function resetCountriesData() { countriesPromise = null; }

// 页面 JSON 读取：root/dataEl 缺失、坐标解析失败或为空时返回 null（放弃构建）
export function readMapData() {
    let locationData = [];
    const locationDataEl = document.getElementById('footprint-locations-data');
    if (locationDataEl) {
        try {
            locationData = JSON.parse(locationDataEl.textContent);
        } catch (err) {
            console.warn('[footprint-map] location data parse failed', err);
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
    const root = document.getElementById('footprint-map');
    const dataEl = document.getElementById('footprint-map-data');
    if (!root || !dataEl) return null;

    let points;
    try {
        points = JSON.parse(dataEl.textContent);
    } catch (err) {
        console.warn('[footprint-map] data parse failed', err);
        return null;
    }
    if (!Array.isArray(points) || points.length === 0) return null;

    return { root, points, locationData, statsByName };
}
