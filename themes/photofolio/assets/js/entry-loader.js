/**
 * 按页加载独立入口 bundle（IIFE）：baseof 注入 #js-entry-urls（名称→指纹 URL），
 * 入口脚本加载后把 init 函数注册到 window.__MimoEntries，核心 bundle 只保留
 * 全站模块，页面模块按需拉取。URL 一次性读取；失败允许下次重试。
 */
let urls = null;
const pending = new Map();

function readUrls() {
    if (!urls) {
        const el = document.getElementById('js-entry-urls');
        urls = el ? JSON.parse(el.textContent) : {};
    }
    return urls;
}

export function loadEntry(name) {
    const registry = window.__MimoEntries;
    if (registry && registry[name]) return Promise.resolve(registry[name]);
    if (pending.has(name)) return pending.get(name);

    const src = readUrls()[name];
    if (!src) return Promise.reject(new Error('missing JS entry: ' + name));

    const promise = new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = src;
        script.async = true;
        script.onload = () => {
            const mod = window.__MimoEntries && window.__MimoEntries[name];
            if (mod) {
                resolve(mod);
            } else {
                pending.delete(name);
                script.remove();
                reject(new Error('JS entry did not register: ' + name));
            }
        };
        script.onerror = () => {
            pending.delete(name);
            script.remove();
            reject(new Error('failed to load JS entry: ' + name));
        };
        document.head.appendChild(script);
    });
    pending.set(name, promise);
    return promise;
}
