/**
 * 回填 photo.toml 的 width / height 字段，并剥离已废弃的 orientation 行（零 npm 依赖，Node >= 18）。
 *
 * 注意：常规流程中 width/height 已由预处理脚本（E:\预处理摄影作品\处理图片\git，上传照片时）生成，
 * 构图方向由站点模板从宽高推导（宽 ≥ 高 = landscape）——orientation 字段已废弃，本脚本会移除它；
 * 本站脚本仅在「历史数据未覆盖/预处理脚本未生成」时兜底补全宽高。
 *
 * 管线：解析 data/photo.toml → 对缺 width/height 的条目请求 OSS 图片信息接口
 *      （?x-oss-process=image/info，返回 ImageWidth/ImageHeight，无需下载图片本体）
 *      → 写回 width/height（照片卡懒加载图片的显式尺寸，消除 CLS 审计告警）。
 *
 * 用法：node scripts/backfill-dimensions.mjs
 * 输出：原地更新 data/photo.toml（保留原有全部内容与顺序，UTF-8 无 BOM）；可重复运行（已有字段跳过）。
 */
import { readFileSync, writeFileSync, renameSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const PHOTO_PATH = path.join(ROOT, 'data', 'photo.toml');
const CONCURRENCY = 6;
const REQUEST_TIMEOUT_MS = 15000;

/* ---------- 读取 CDN 基础地址（hugo.toml 的 imageCDN） ---------- */
function readCdnBase() {
    const cfg = readFileSync(path.join(ROOT, 'hugo.toml'), 'utf8');
    const m = cfg.match(/^[ \t]*imageCDN\s*=\s*"([^"]+)"/m);
    if (!m) throw new Error('hugo.toml 中未找到 imageCDN');
    return m[1].replace(/\/+$/, '');
}

/* ---------- 解析 photo.toml：保留原文文本，仅定位需要回填的块 ----------
   键允许缩进（兼容 TOML 格式化器输出），宽松匹配避免条目被静默跳过 */
function parseBlocks(text) {
    const parts = text.replace(/^﻿/, '').split('[[photo]]');
    const entries = [];
    for (let i = 1; i < parts.length; i++) {
        const block = parts[i];
        const srcMatch = block.match(/^[ \t]*src\s*=\s*"([^"]+)"/m);
        entries.push({
            block,
            src: srcMatch ? srcMatch[1] : null,
            hasDims: /^[ \t]*width\s*=/m.test(block) && /^[ \t]*height\s*=/m.test(block),
            width: null,
            height: null,
        });
    }
    return { header: parts[0], entries };
}

/* ---------- 单条回填：请求 OSS image/info → width/height ---------- */
async function fetchImageInfo(cdnBase, src) {
    const url = new URL(src, cdnBase);
    url.searchParams.set('x-oss-process', 'image/info');
    // 超时中止：单条请求挂起不得永久占住并发池 worker
    const res = await fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const info = await res.json();
    const w = Number(info?.ImageWidth?.value);
    const h = Number(info?.ImageHeight?.value);
    if (!(w > 0 && h > 0)) throw new Error('missing ImageWidth/ImageHeight');
    return { width: w, height: h };
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

const pending = entries.filter((e) => e.src && !e.hasDims);
console.log(`total=${entries.length}  pending=${pending.length}  cdn=${cdnBase}`);

const failed = [];
if (pending.length > 0) {
    await mapPool(pending, CONCURRENCY, async (e) => {
        try {
            const info = await fetchImageInfo(cdnBase, e.src);
            e.width = info.width;
            e.height = info.height;
            console.log(`  ok   ${e.src}`);
        } catch (err) {
            failed.push(`${e.src}  (${err.message})`);
            console.warn(`  FAIL ${e.src}  (${err.message})`);
        }
    });
}

const changed = pending.filter((e) => e.width).length;
if (pending.length > 0 && changed === 0) {
    // 全部请求失败：以非零退出码报告，避免调用方（CI/手动）误判成功
    console.error(`全部 ${pending.length} 条请求失败，文件未修改：`);
    failed.forEach((f) => console.error(`  ${f}`));
    process.exit(1);
}

// 重建文件：剥离已废弃的 orientation 行；width/height 插在 location 行之后（与预处理脚本 FIELDS 顺序一致）
let out = header;
let stripped = 0;
for (const e of entries) {
    let block = e.block;
    const before = block.length;
    block = block.replace(/^[ \t]*orientation\s*=\s*"[^"]*"[ \t]*(?:\r?\n|$)/gm, '');
    if (block.length !== before) stripped++;

    let insert = '';
    if (e.width) insert += `width = "${e.width}"${eol}height = "${e.height}"${eol}`;
    if (insert) {
        const anchor = block.match(/^[ \t]*location\s*=\s*"[^"]*"\r?\n/m);
        if (anchor) {
            const insertAt = anchor.index + anchor[0].length;
            block = block.slice(0, insertAt) + insert + block.slice(insertAt);
        } else {
            // 块以换行开头（split 残留）：先剥掉，再补上 [[photo]] 标记后的换行，避免与标记拼在同一行
            block = eol + insert + block.replace(/^\r?\n/, '');
        }
    }
    out += '[[photo]]' + block;
}

if (changed === 0 && stripped === 0) {
    console.log('文件无需修改');
    process.exit(0);
}

// 原子写入：先写临时文件再 rename，中断（Ctrl-C/断电）不会截断损坏原文件
const tmpPath = PHOTO_PATH + '.tmp';
writeFileSync(tmpPath, out, 'utf8');
renameSync(tmpPath, PHOTO_PATH);
console.log(`written: ${PHOTO_PATH}  (+${changed} 条补全，剥离 ${stripped} 条 orientation)`);
if (failed.length) {
    console.warn(`失败 ${failed.length} 条（未写入字段）：`);
    failed.forEach((f) => console.warn(`  ${f}`));
}
