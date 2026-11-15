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
let cssPromise = null;
let installed = false;
let booted = false;

// 骨架页 URL 由模板注入（relURL，兼容 baseURL 子路径）；缺失时回退根路径
function shellUrl() {
    const el = document.getElementById('js-entry-urls');
    return (el && el.dataset.lightboxShell) || '/lightbox-shell/';
}

// 灯箱专用样式表 URL（指纹化；与全站样式分离，首访不再携带灯箱 CSS）。
// 失败移除 <link> 并复位 Promise，下一次点击重试（与骨架/入口同口径）
function cssUrl() {
    const el = document.getElementById('js-entry-urls');
    return (el && el.dataset.lightboxCss) || '/css/lightbox.css';
}

function loadCss() {
    if (cssPromise) return cssPromise;
    cssPromise = new Promise((resolve, reject) => {
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = cssUrl();
        link.onload = () => resolve();
        link.onerror = () => {
            link.remove();
            cssPromise = null;
            reject(new Error('lightbox css failed'));
        };
        document.head.appendChild(link);
    });
    return cssPromise;
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
                // 先以 display:none 注入：灯箱样式是独立文件、可能仍在途——无样式
                // 时整块壳会以裸 HTML 闪现在页面底部；CSS 失败时也会永久残留。
                // bootLightbox 待样式就位后再放出（2026-11-15 审查修复）
                const node = document.importNode(shell, true);
                node.style.display = 'none';
                document.body.appendChild(node);
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
        // 样式、骨架、入口并行拉取；三者都就位后才初始化（样式先于显示，
        // 避免灯箱以无样式状态闪一帧）
        const [mod] = await Promise.all([loadModule(), loadShell(), loadCss()]);
        // 样式已就位：放出此前隐藏的骨架（CSS 失败时 Promise.all 拒绝，骨架
        // 保持隐藏、不残留裸壳，下次点击重试）
        const shellEl = document.getElementById('lightbox');
        if (shellEl) shellEl.style.display = '';
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

    // 预启动：指针悬停作品卡（桌面）或键盘聚焦时，后台完成骨架注入与入口加载，
    // 真正点击时灯箱已就绪；没打算打开灯箱的访客不会触发。失败不提示，
    // 点击路径照常重试（2026-11-14）
    document.addEventListener('pointerover', (e) => {
        if (booted || bootPromise) return;
        if (e.pointerType && e.pointerType !== 'mouse') return;
        if (!e.target.closest('.photo-wrapper')) return;
        bootLightbox().catch(() => { /* 留给点击重试 */ });
    }, { passive: true });

    document.addEventListener('focusin', (e) => {
        if (booted || bootPromise) return;
        if (!e.target.closest('.photo-card')) return;
        bootLightbox().catch(() => { /* 留给点击重试 */ });
    });
}
