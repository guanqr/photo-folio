export function initMobileNav() {
    const btn = document.getElementById('nav-toggle');
    const nav = document.getElementById('site-nav');
    
    if (!btn || !nav) return;

    // 1. 点击汉堡按钮切换菜单
    btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation(); // 阻止冒泡，防止触发下方的 document 点击事件
        nav.classList.toggle('active');
        btn.classList.toggle('active');
    });

    // 2. 点击页面空白处关闭菜单
    document.addEventListener('click', (e) => {
        if (nav.classList.contains('active') && 
            !nav.contains(e.target) && 
            !btn.contains(e.target)) {
            nav.classList.remove('active');
            btn.classList.remove('active');
        }
    });
}
