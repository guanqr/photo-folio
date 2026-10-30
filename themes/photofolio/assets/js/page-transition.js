/**
 * 页面切换：拦截站内导航，仅替换主内容区，保持 header/footer 不重载。
 *
 * 导航先 fetch（旧页面保持可见、进度条即时推进），内容就绪后再
 * 淡出 → 替换 → 淡入——不再在 fetch 之前固定等待 150ms。
 * 淡出/淡入用 transitionend + 超时兜底；`navSeq` 作废被取代的旧导航。
 */
import { resetSubMenus } from './nav-dropdown.js';
import { closeLightbox } from './lightbox.js';
import { prefersReducedMotion } from './utils.js';
import { navTimeoutMs } from '@params';

let reinitFn = null;

// 并发导航守卫代次：快速连点/加载中按 Back 会启动并行 loadContent——各自
// fetch、各自写主内容区，最后 resolve 者胜（地址栏是 B、内容是 A 的错配）。
// 代次在每次导航递增，各 await 恢复点校验、被取代的旧导航静默退出
let navSeq = 0;

// 导航请求超时：弱网下连接挂起（既不 resolve 也不 reject）时 abort 触发
// reject、回退完整导航——页面不长期停在加载中。
// 值由 baseof.html 的 js.Build params 注入（与 sw.js 的模板注入同源，单点修改）
const NAV_TIMEOUT_MS = navTimeoutMs || 10000;

/* ===== SPA 导航顶部进度条 =====
   fetch 无 Content-Length 可依赖：宽度模拟推进（快速到 25% → 缓慢蠕动至
   80% 保持），内容替换完成后冲到 100% 短暂停留后淡出收起；惰性创建
   （首次导航才插入 DOM）；失败/超时走完整导航回退——整页重载自然重置 */
let progressEl = null;
let progressTimer = null;
// 收尾两级定时器入模块级槽位：快速连导（500ms 内再次导航）时 startProgress
// 先作废旧收尾链——否则旧定时器会把第二次导航的进度条中途熄灭
let progressFadeTimer = null;
let progressResetTimer = null;

// 淡出/淡入收尾清理槽：新导航先取消旧监听/定时器，
// 防止旧淡入的 transitionend 清掉新导航刚写入的过渡
let fadeCancel = null;

function startProgress() {
    if (!progressEl) {
        progressEl = document.createElement('div');
        progressEl.className = 'spa-progress';
        progressEl.style.width = '0';
        document.body.appendChild(progressEl);
    }
    if (progressTimer) clearInterval(progressTimer);
    clearTimeout(progressFadeTimer);
    clearTimeout(progressResetTimer);
    progressEl.style.transition = 'width 0.3s ease, opacity 0.2s ease';
    progressEl.style.opacity = '1';
    progressEl.style.width = '25%';
    let pct = 25;
    progressTimer = setInterval(() => {
        if (pct >= 80) {
            clearInterval(progressTimer);
            progressTimer = null;
            return;
        }
        pct = Math.min(80, pct + 4);
        progressEl.style.width = pct + '%';
    }, 300);
}

function finishProgress() {
    if (!progressEl) return;
    if (progressTimer) {
        clearInterval(progressTimer);
        progressTimer = null;
    }
    progressEl.style.width = '100%';
    progressFadeTimer = setTimeout(() => {
        progressEl.style.opacity = '0';
        progressResetTimer = setTimeout(() => { progressEl.style.width = '0'; }, 250);
    }, 250);
}

export function initPageTransition(reinit) {
    reinitFn = reinit;

    // 拦截站内链接点击
    document.addEventListener('click', e => {
        // 修饰键点击放行浏览器默认行为：Ctrl/Cmd+点击开新标签、Shift+点击
        // 开新窗口——拦截会把它们劫持为同标签 SPA 导航（2026-10-18）
        if (e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
        const link = e.target.closest('a');
        if (!link || !shouldIntercept(link)) return;
        e.preventDefault();
        // 下拉子项点击后移出焦点：否则 :focus-within 会让下拉菜单在鼠标移出后仍保持展开
        if (link.closest('.nav-dropdown')) link.blur();
        navigateTo(link.href);
    });

    // 浏览器前进/后退
    window.addEventListener('popstate', e => {
        // 首次加载的页面（如首页）没有推入过状态（e.state 为 null）——
        // 此时按当前地址恢复（popstate 触发时 location 已指向目标页），否则无法返回首页
        loadContent(e.state && e.state.url ? e.state.url : location.href);
    });
}

function shouldIntercept(link) {
    return (
        link.host === location.host &&
        !link.hash &&
        !link.hasAttribute('download') &&
        link.target !== '_blank' &&
        link.getAttribute('href') !== '#'
    );
}

async function navigateTo(url) {
    history.pushState({ url }, '', url);
    await loadContent(url);
}

async function loadContent(url) {
    const seq = ++navSeq;

    // 作废上一次淡出/淡入收尾，避免旧闭包影响本次导航
    cancelFade();

    // 导航即关灯箱：灯箱在壳层 DOM、不随内容替换——不关闭则旧照片悬在
    // 新页面上（popstate/返回键路径同样经此）
    closeLightbox();

    const main = document.querySelector('.main-content');
    if (!main) return;
    // 新导航在旧淡出/淡入中途启动时，恢复旧主内容可见（旧 DOM 仍在）
    main.style.transition = '';
    main.style.opacity = '';

    // fetch 期间旧页面保持可见，进度条立即推进（不再先淡出空白）
    startProgress();

    let doc;
    try {
        // 超时控制见 NAV_TIMEOUT_MS：abort 同时中断正文流读取（headers 到达后
        // 正文停滞同样超时），finally 清理计时器防正常完成路径误触 abort
        const controller = new AbortController();
        const timeoutTimer = setTimeout(() => controller.abort(), NAV_TIMEOUT_MS);
        let res;
        let html;
        try {
            res = await fetch(url, { signal: controller.signal });
            if (!res.ok) throw new Error('HTTP ' + res.status); // 404/500 走下方兜底完整导航，不把错误页解析进正文
            html = await res.text();
        } finally {
            clearTimeout(timeoutTimer);
        }
        if (seq !== navSeq) return; // fetch 期间被取代：不动 DOM（新导航负责后续）

        doc = new DOMParser().parseFromString(html, 'text/html');
        if (!doc.querySelector('.main-content')) {
            if (seq === navSeq) window.location = url;
            return;
        }
    } catch (err) {
        if (seq !== navSeq) return; // 被取代的旧导航失败：不得回退到陈旧 URL
        // 网络错误/超时等回退到完整导航（浏览器自带加载指示，不留在加载中）
        window.location = url;
        return;
    }

    // 内容已就绪，旧页面再淡出、替换、淡入（fetch 不再被淡出阻塞）
    if (seq !== navSeq) return;
    await fadeOut(main);
    if (seq !== navSeq) return;
    commitPage(doc, url);
    finishProgress();
    await fadeIn(main);
}

/* 主内容替换与页面级状态同步 */
function commitPage(doc, url) {
    const main = document.querySelector('.main-content');
    const newMain = doc.querySelector('.main-content');
    if (!main || !newMain) return;

    main.innerHTML = newMain.innerHTML;

    // 同步 is-home 标志：内容替换不会重渲染 body 类，不更新则
    // 首页跳到其他页后 is-home 残留——亮色主题首页顶部强制暗色导航规则
    // （.is-home 限定）被错误应用到其他页；反向跳转同样缺失。
    // 只动这一个标志（classList.toggle 幂等），保留未来任何动态 body 类
    const headerEl = document.querySelector('.site-header');
    if (headerEl) {
        // 同步期间抑制头部颜色过渡：白字↔深色的 0.3s 过渡若落在新页
        // 淡入期间，白字压在米色底上不可读；抑制类 + 强制重排让换色瞬时完成
        headerEl.classList.add('no-color-transition');
        document.body.classList.toggle('is-home', doc.body.classList.contains('is-home'));
        void headerEl.offsetWidth;
        headerEl.classList.remove('no-color-transition');
    } else {
        document.body.classList.toggle('is-home', doc.body.classList.contains('is-home'));
    }

    // 更新标题
    const newTitle = doc.querySelector('title');
    if (newTitle) document.title = newTitle.textContent;

    // 更新导航当前页高亮
    updateActiveNav(url);

    // 关闭移动端菜单（带动画收回），并同步清理 header 上的 menu-open 状态；
    // 子导航展开态一并重置——否则下次打开菜单时子导航仍是展开的
    const nav = document.getElementById('site-nav');
    const navBtn = document.getElementById('nav-toggle');
    if (nav && nav.classList.contains('active')) {
        nav.style.transition = 'transform 0.35s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.3s ease, visibility 0.3s';
        nav.classList.remove('active');
        if (navBtn) navBtn.classList.remove('active');
        if (headerEl) headerEl.classList.remove('menu-open');
        resetSubMenus(nav);
        nav.addEventListener('transitionend', function handler() {
            nav.removeEventListener('transitionend', handler);
            nav.style.transition = '';
        });
    }

    // 滚动到顶部
    window.scrollTo(0, 0);

    // 重新初始化页面 JS
    if (reinitFn) reinitFn();
}

/* 淡出/淡入：transitionend + 超时兜底；取消槽避免旧收尾影响新导航 */
function cancelFade() {
    if (!fadeCancel) return;
    const cancel = fadeCancel;
    fadeCancel = null;
    cancel();
}

function fadeOut(el) {
    if (prefersReducedMotion()) {
        el.style.opacity = '0';
        return Promise.resolve();
    }
    return new Promise(resolve => {
        let done = false;
        let timer;
        const finish = () => {
            if (done) return;
            done = true;
            el.removeEventListener('transitionend', onEnd);
            clearTimeout(timer);
            if (fadeCancel === cancel) fadeCancel = null;
            resolve();
        };
        const cancel = () => finish();
        const onEnd = (e) => {
            if (e.target === el && e.propertyName === 'opacity') finish();
        };
        fadeCancel = cancel;
        el.addEventListener('transitionend', onEnd);
        timer = setTimeout(finish, 220);
        el.style.transition = 'opacity 0.15s ease';
        el.style.opacity = '0';
    });
}

function fadeIn(el) {
    if (prefersReducedMotion()) {
        el.style.opacity = '1';
        el.style.transition = '';
        return Promise.resolve();
    }
    el.style.transition = 'opacity 0.15s ease';
    el.style.opacity = '0';
    void el.offsetHeight;
    return new Promise(resolve => {
        let done = false;
        let timer;
        const finish = () => {
            if (done) return;
            done = true;
            el.removeEventListener('transitionend', onEnd);
            clearTimeout(timer);
            el.style.transition = '';
            if (fadeCancel === cancel) fadeCancel = null;
            resolve();
        };
        const cancel = () => finish();
        const onEnd = (e) => {
            if (e.target === el && e.propertyName === 'opacity') finish();
        };
        fadeCancel = cancel;
        el.addEventListener('transitionend', onEnd);
        timer = setTimeout(finish, 220);
        el.style.opacity = '1';
    });
}

function updateActiveNav(url) {
    // 包含 .nav-parent（带子菜单的父项是 span，无 href）——跳转后要一并清除其高亮，
    // 否则从子页面跳到其他页面时父项的横线不消失
    const links = document.querySelectorAll('.site-nav a, .site-nav .nav-parent');
    // 查询串不参与匹配：筛选（?y=/?l=/?c=）与灯箱（?p=）的 URL 经前进/后退
    // 恢复时仍应保持所在页面的导航高亮——此前裸 URL 比较恒不匹配、高亮
    //（含 aria-current）全部熄灭（2026-10-18）
    const path = new URL(url).pathname;
    links.forEach(el => {
        const match = el.tagName === 'A' && el.pathname === path;
        el.classList.toggle('active', match);
        // aria-current 同步（读屏器当前页语义；父项是按钮不是链接、不设）
        if (match) el.setAttribute('aria-current', 'page');
        else el.removeAttribute('aria-current');
        // 下拉子项匹配时，父级菜单项（如「作品」）一并高亮
        if (match && el.closest('.nav-dropdown')) {
            const parentLink = el.closest('li.has-dropdown').querySelector(':scope > a, :scope > .nav-parent');
            if (parentLink) parentLink.classList.add('active');
        }
    });
    // 首页特殊处理（与上方同法忽略查询串）
    if (path === '/') {
        const homeLink = document.querySelector('.site-nav a[href="/"]');
        if (homeLink) {
            homeLink.classList.add('active');
            homeLink.setAttribute('aria-current', 'page');
        }
    }
}
