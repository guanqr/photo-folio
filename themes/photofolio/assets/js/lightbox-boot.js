/**
 * 灯箱懒启动：页面 HTML 不再携带约 19KB 灯箱骨架，也不再首载灯箱 JS 族。
 *
 * - 首次点击作品（或键盘 Enter/Space）→ fetch lightbox 骨架页并注入 →
 *   动态加载 lightbox 入口 → 初始化 → 重放本次点击
 * - URL 带 ?p= 深链时由 main.js 主动调用 openLightboxFromUrlIfNeeded
 * - 骨架/模块 Promise 均缓存；失败重置，下一次点击可重试
 * - 灯箱打开后 shell 在 body 壳层，SPA 换页不重载
 */
import { loadEntry } from './entry-loader.js';

let shellPromise = null;
let bootPromise = null;
let installed = false;
let booted = false;

// 骨架页 URL 由模板注入（relURL，兼容 baseURL 子路径）；缺失时回退根路径
function shellUrl() {
    const el = document.getElementById('js-entry-urls');
    return (el && el.dataset.lightboxShell) || '/lightbox-shell/';
}

function loadShell() {
    if (document.getElementById('lightbox')) return Promise.resolve();
    if (!shellPromise) {
        shellPromise = fetch(shellUrl(), { credentials: 'same-origin' })
            .then((res) => {
                if (!res.ok) throw new Error('lightbox shell HTTP ' + res.status);
                return res.text();
            })
            .then((html) => {
                if (document.getElementById('lightbox')) return;
                const doc = new DOMParser().parseFromString(html, 'text/html');
                const shell = doc.getElementById('lightbox');
                if (!shell) throw new Error('lightbox shell missing');
                document.body.appendChild(document.importNode(shell, true));
            })
            .catch((err) => {
                shellPromise = null;
                throw err;
            });
    }
    return shellPromise;
}

function loadModule() {
    return loadEntry('lightbox');
}

export function bootLightbox() {
    if (bootPromise) return bootPromise;
    bootPromise = (async () => {
        await loadShell();
        const mod = await loadModule();
        mod.initLightbox();
        booted = true; // 初始化完成，后续点击交给灯箱自身的委托
        return mod;
    })().catch((err) => {
        bootPromise = null;
        throw err;
    });
    return bootPromise;
}

export async function openLightboxFromUrlIfNeeded() {
    if (!new URLSearchParams(location.search).has('p')) return;
    const mod = await bootLightbox();
    return mod.openLightboxFromUrl();
}

export function initLightboxBoot() {
    if (installed) return;
    installed = true;

    // 捕获阶段先于 page-transition/lightbox 的冒泡委托：灯箱尚未初始化完成时
    // 拦截点击（含骨架已注入、入口仍在加载或上次初始化失败的窗口），完成后重放；
    // 已初始化则完全不干预，交给 lightbox.js 的全局委托
    document.addEventListener('click', (e) => {
        if (booted) return;
        if (e.target.closest('a')) return;
        const wrapper = e.target.closest('.photo-wrapper');
        if (!wrapper) return;
        e.preventDefault();
        e.stopPropagation();
        bootLightbox()
            .then(() => wrapper.click())
            .catch((err) => console.error('[lightbox] lazy boot failed', err));
    }, true);

    document.addEventListener('keydown', (e) => {
        if (booted) return;
        if (e.key !== 'Enter' && e.key !== ' ') return;
        if (e.target.closest('a')) return;
        const card = e.target.closest('.photo-card');
        if (!card) return;
        e.preventDefault();
        bootLightbox()
            .then(() => card.querySelector('.photo-wrapper')?.click())
            .catch((err) => console.error('[lightbox] lazy boot failed', err));
    }, true);
}
