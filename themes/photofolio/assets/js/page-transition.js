/**
 * 页面切换：拦截站内导航，仅替换主内容区，保持 header/footer 不重载
 */
let reinitFn = null;

export function initPageTransition(reinit) {
    reinitFn = reinit;

    // 拦截站内链接点击
    document.addEventListener('click', e => {
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
    const main = document.querySelector('.main-content');
    if (!main) return;

    // 淡出
    main.style.transition = 'opacity 0.15s ease';
    main.style.opacity = '0';
    await sleep(150);

    try {
        const res = await fetch(url);
        const html = await res.text();
        const doc = new DOMParser().parseFromString(html, 'text/html');

        const newMain = doc.querySelector('.main-content');
        if (!newMain) { window.location = url; return; }

        // 替换主内容
        main.innerHTML = newMain.innerHTML;

        // 更新标题
        const newTitle = doc.querySelector('title');
        if (newTitle) document.title = newTitle.textContent;

        // 更新导航当前页高亮
        updateActiveNav(url);

        // 关闭移动端菜单（带动画收回），并同步清理 header 上的 menu-open 状态
        const nav = document.getElementById('site-nav');
        const navBtn = document.getElementById('nav-toggle');
        const header = document.querySelector('.site-header');
        if (nav && nav.classList.contains('active')) {
            nav.style.transition = 'transform 0.35s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.3s ease, visibility 0.3s';
            nav.classList.remove('active');
            if (navBtn) navBtn.classList.remove('active');
            if (header) header.classList.remove('menu-open');
            nav.addEventListener('transitionend', function handler() {
                nav.removeEventListener('transitionend', handler);
                nav.style.transition = '';
            });
        }

        // 滚动到顶部
        window.scrollTo(0, 0);

        // 重新初始化页面 JS
        if (reinitFn) reinitFn();
    } catch (err) {
        // 网络错误等回退到完整导航
        window.location = url;
        return;
    }

    // 淡入
    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            main.style.opacity = '1';
            setTimeout(() => { main.style.transition = ''; }, 200);
        });
    });
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function updateActiveNav(url) {
    // 包含 .nav-parent（带子菜单的父项是 span，无 href）——跳转后要一并清除其高亮，
    // 否则从子页面跳到其他页面时父项的横线不消失
    const links = document.querySelectorAll('.site-nav a, .site-nav .nav-parent');
    links.forEach(el => {
        const match = el.tagName === 'A' && (el.href === url || el.href === url + '/');
        el.classList.toggle('active', match);
        // 下拉子项匹配时，父级菜单项（如「作品」）一并高亮
        if (match && el.closest('.nav-dropdown')) {
            const parentLink = el.closest('li.has-dropdown').querySelector(':scope > a, :scope > .nav-parent');
            if (parentLink) parentLink.classList.add('active');
        }
    });
    // 首页特殊处理
    if (url === location.origin + '/' || url === location.origin) {
        const homeLink = document.querySelector('.site-nav a[href="/"]');
        if (homeLink) homeLink.classList.add('active');
    }
}
