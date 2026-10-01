/**
 * 回填 photo.toml 的 orientation 字段（零 npm 依赖，Node >= 18）。
 *
 * 管线：解析 data/photo.toml → 对缺失 orientation 的条目请求 OSS 图片信息接口
 *      （?x-oss-process=image/info，返回 ImageWidth/ImageHeight，无需下载图片本体）
 *      → 按「水平长度 ≥ 竖直长度 = landscape，否则 portrait」写回 orientation = "..."。
 *
 * 用法：node scripts/backfill-orientation.mjs
 * 输出：原地更新 data/photo.toml（保留原有全部内容与顺序，UTF-8 无 BOM）；可重复运行（已有字段跳过）。
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const PHOTO_PATH = path.join(ROOT, 'data', 'photo.toml');
const CONCURRENCY = 6;

/* ---------- 读取 CDN 基础地址（hugo.toml 的 imageCDN） ---------- */
function readCdnBase() {
    const cfg = readFileSync(path.join(ROOT, 'hugo.toml'), 'utf8');
    const m = cfg.match(/^[ \t]*imageCDN\s*=\s*"([^"]+)"/m);
    if (!m) throw new Error('hugo.toml 中未找到 imageCDN');
    return m[1].replace(/\/+$/, '');
}

/* ---------- 解析 photo.toml：保留原文文本，仅定位需要回填的块 ---------- */
function parseBlocks(text) {
    const parts = text.replace(/^﻿/, '').split('[[photo]]');
    const entries = [];
    for (let i = 1; i < parts.length; i++) {
        const block = parts[i];
        const srcMatch = block.match(/^src\s*=\s*"([^"]+)"/m);
        entries.push({
            block,
            src: srcMatch ? srcMatch[1] : null,
            hasOrientation: /^orientation\s*=/m.test(block),
            orientation: null,
        });
    }
    return { header: parts[0], entries };
}

/* ---------- 单条回填：请求 OSS image/info → landscape/portrait ---------- */
async function fetchOrientation(cdnBase, src) {
    const url = new URL(src, cdnBase);
    url.searchParams.set('x-oss-process', 'image/info');
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const info = await res.json();
    const w = Number(info?.ImageWidth?.value);
    const h = Number(info?.ImageHeight?.value);
    if (!(w > 0 && h > 0)) throw new Error('missing ImageWidth/ImageHeight');
    return w >= h ? 'landscape' : 'portrait';
}

/* ---------- 并发池 ---------- */
async function mapPool(items, limit, fn) {
    const results = new Array(items.length);
    let next = 0;
    async function worker() {
        while (next < items.length) {
            const i = next++;
            results[i] = await fn(items[i], i);
        }
    }
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
    return results;
}

/* ---------- 主流程 ---------- */
const cdnBase = readCdnBase();
const original = readFileSync(PHOTO_PATH, 'utf8');
const eol = original.includes('\r\n') ? '\r\n' : '\n';
const { header, entries } = parseBlocks(original);

const pending = entries.filter((e) => e.src && !e.hasOrientation);
console.log(`total=${entries.length}  pending=${pending.length}  cdn=${cdnBase}`);

const failed = [];
await mapPool(pending, CONCURRENCY, async (e) => {
    try {
        e.orientation = await fetchOrientation(cdnBase, e.src);
        console.log(`  ok   ${e.src}`);
    } catch (err) {
        failed.push(`${e.src}  (${err.message})`);
        console.warn(`  FAIL ${e.src}  (${err.message})`);
    }
});

const changed = pending.filter((e) => e.orientation).length;
if (changed === 0) {
    console.log('没有需要回填的条目（或全部失败），文件未修改');
    if (failed.length) failed.forEach((f) => console.warn(`  skipped: ${f}`));
    process.exit(0);
}

// 重建文件：orientation 行插在 location 行之后（与预处理脚本 FIELDS 顺序一致）
let out = header;
for (const e of entries) {
    let block = e.block;
    if (e.orientation) {
        const locMatch = block.match(/^location\s*=\s*"[^"]*"\r?\n/m);
        if (locMatch) {
            const insertAt = locMatch.index + locMatch[0].length;
            block = block.slice(0, insertAt) + `orientation = "${e.orientation}"${eol}` + block.slice(insertAt);
        } else {
            // 块以换行开头（split 残留）：先剥掉，再补上 [[photo]] 标记后的换行，避免与标记拼在同一行
            block = eol + `orientation = "${e.orientation}"${eol}` + block.replace(/^\r?\n/, '');
        }
    }
    out += '[[photo]]' + block;
}
writeFileSync(PHOTO_PATH, out, 'utf8');
console.log(`written: ${PHOTO_PATH}  (+${changed} orientation)`);
if (failed.length) {
    console.warn(`失败 ${failed.length} 条（未写入字段）：`);
    failed.forEach((f) => console.warn(`  ${f}`));
}
