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
        navigateTo(link.href);
    });

    // 浏览器前进/后退
    window.addEventListener('popstate', e => {
        if (e.state && e.state.url) {
            loadContent(e.state.url);
        }
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
    const links = document.querySelectorAll('.site-nav a');
    links.forEach(a => {
        a.classList.remove('active');
        if (a.href === url || a.href === url + '/') {
            a.classList.add('active');
        }
    });
    // 首页特殊处理
    if (url === location.origin + '/' || url === location.origin) {
        const homeLink = document.querySelector('.site-nav a[href="/"]');
        if (homeLink) homeLink.classList.add('active');
    }
}
