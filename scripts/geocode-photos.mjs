/**
 * 照片地理编码：把 photo.toml 中用户填写的详细地址（address 字段）转成 lat/lng 坐标
 * （零 npm 依赖，Node >= 18；相机无 GPS，坐标由地址解析而来）。
 *
 * 前置：申请高德开放平台「Web 服务」key（个人开发者免费额度），两种提供方式任选：
 *   1) 项目根目录 .env 文件（已加入 .gitignore，不会入库）：AMAP_KEY=你的key
 *   2) 环境变量：PowerShell $env:AMAP_KEY = "你的key" / bash export AMAP_KEY=你的key
 *
 * 管线：解析 data/photo.toml（按 [[photo]] 切块，保留原文顺序）
 *      → 对「有 address 且缺 lat/lng」的条目请求高德地理编码 API（350ms 间隔防限速）
 *      → 解析 geocodes[0].location "lng,lat" → 写回 lat/lng（6 位小数）
 *      → 原地更新 data/photo.toml（UTF-8 无 BOM；可重复运行，已有坐标的条目跳过）。
 *
 * 用法：node scripts/geocode-photos.mjs
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

/* ---------- key 来源：环境变量 AMAP_KEY 优先，其次项目根目录 .env（不入库） ---------- */
function loadKey() {
    if (process.env.AMAP_KEY) return process.env.AMAP_KEY;
    const envFile = path.join(ROOT, '.env');
    if (existsSync(envFile)) {
        for (const line of readFileSync(envFile, 'utf8').split('\n')) {
            const m = line.match(/^\s*AMAP_KEY\s*=\s*(.+?)\s*$/);
            if (m) return m[1].replace(/^["']|["']$/g, '');
        }
    }
    return null;
}
const KEY = loadKey();
if (!KEY) {
    console.error('缺少高德 key：设置环境变量 AMAP_KEY，或在项目根目录创建 .env 写入 AMAP_KEY=你的key');
    process.exit(1);
}

const PHOTO_PATH = path.join(ROOT, 'data', 'photo.toml');
const API_URL = 'https://restapi.amap.com/v3/geocode/geo';
const REQUEST_TIMEOUT_MS = 15000;
const INTERVAL_MS = 350; // 高德个人 key 并发限制 3 QPS，串行 + 间隔最稳妥

/* ---------- 解析 photo.toml：保留原文文本，仅定位需要编码的块 ----------
   键允许缩进（兼容 TOML 格式化器输出），宽松匹配避免条目被静默跳过 */
function parseBlocks(text) {
    const parts = text.replace(/^﻿/, '').split('[[photo]]');
    const entries = [];
    for (let i = 1; i < parts.length; i++) {
        const block = parts[i];
        const srcMatch = block.match(/^[ \t]*src\s*=\s*"([^"]+)"/m);
        const addrMatch = block.match(/^[ \t]*address\s*=\s*"([^"]+)"/m);
        entries.push({
            block,
            src: srcMatch ? srcMatch[1] : null,
            address: addrMatch ? addrMatch[1] : null,
            hasCoords: /^[ \t]*lat\s*=/m.test(block) && /^[ \t]*lng\s*=/m.test(block),
        });
    }
    return { header: parts[0], entries };
}

/* ---------- 单条编码：address → {lat, lng} ---------- */
async function geocodeAmap(address) {
    const url = new URL(API_URL);
    url.searchParams.set('address', address);
    url.searchParams.set('key', KEY);
    const res = await fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (data.status !== '1') throw new Error(`amap status ${data.status}: ${data.info || ''}`);
    const loc = data.geocodes?.[0]?.location;
    if (!loc) throw new Error('no geocode result');
    const [lng, lat] = loc.split(',').map(Number);
    if (!(Number.isFinite(lat) && Number.isFinite(lng))) throw new Error(`bad location "${loc}"`);
    return { lat: lat.toFixed(6), lng: lng.toFixed(6) };
}

/* 海外地址兜底：高德不覆盖境外（如日本），用 OSM Nominatim（免费无 key、限速 1 次/秒，
   官方策略要求带 User-Agent 标识） */
async function geocodeNominatim(address) {
    const url = new URL('https://nominatim.openstreetmap.org/search');
    url.searchParams.set('q', address);
    url.searchParams.set('format', 'jsonv2');
    url.searchParams.set('limit', '1');
    const res = await fetch(url, {
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        headers: { 'User-Agent': 'photo-toml-geocoder/1.0' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (!Array.isArray(data) || !data.length) throw new Error('no geocode result');
    const lat = Number(data[0].lat);
    const lng = Number(data[0].lon);
    if (!(Number.isFinite(lat) && Number.isFinite(lng))) throw new Error('bad result');
    return { lat: lat.toFixed(6), lng: lng.toFixed(6) };
}

async function geocode(address) {
    try {
        return await geocodeAmap(address);
    } catch (err) {
        try {
            const coords = await geocodeNominatim(address);
            console.log(`  ↳ 高德失败（${err.message}），已由 Nominatim 兜底`);
            return coords;
        } catch (err2) {
            throw new Error(`amap: ${err.message}; nominatim: ${err2.message}`);
        }
    }
}

/* ---------- 写回：在块内 address 行之后插入 lat/lng（与数据整理后的格式一致；
   无 address 时退回 src 行之后，再不行追加块尾） ---------- */
function insertCoords(block, coords) {
    const lines = block.split('\n');
    let insertAt = lines.findIndex((l) => /^[ \t]*address\s*=/.test(l));
    if (insertAt < 0) insertAt = lines.findIndex((l) => /^[ \t]*src\s*=/.test(l));
    if (insertAt < 0) insertAt = lines.length - 1;
    lines.splice(insertAt + 1, 0, `lat = "${coords.lat}"`, `lng = "${coords.lng}"`);
    return lines.join('\n');
}

/* ---------- 主流程 ---------- */
const text = readFileSync(PHOTO_PATH, 'utf8');
const { header, entries } = parseBlocks(text);

const todo = entries.filter((e) => e.address && !e.hasCoords);
console.log(`共 ${entries.length} 条记录，待编码 ${todo.length} 条`);

let done = 0;
let failed = 0;
for (const e of todo) {
    try {
        const coords = await geocode(e.address);
        e.block = insertCoords(e.block, coords);
        done++;
        console.log(`✓ ${e.src}  ${e.address} → ${coords.lat}, ${coords.lng}`);
    } catch (err) {
        failed++;
        console.warn(`✗ ${e.src}  ${e.address}  ${err.message}`);
    }
    await new Promise((r) => setTimeout(r, INTERVAL_MS));
}

if (done > 0) {
    writeFileSync(PHOTO_PATH, header + '[[photo]]' + entries.map((e) => e.block).join('[[photo]]'), 'utf8');
}
console.log(`完成：成功 ${done}，失败 ${failed}，已写回 data/photo.toml`);
