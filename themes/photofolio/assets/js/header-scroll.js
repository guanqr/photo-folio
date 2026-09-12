export function initHeaderScroll() {
    const header = document.querySelector('.site-header');
    if (!header) return;

    header.style.background = ''; // 清除任何历史遗留的 inline 背景，保证顶部纯透明

    window.addEventListener('scroll', () => {
        // 顶部纯透明；下拉滚动后显示背景
        header.classList.toggle('is-scrolled', window.scrollY > 10);
    });
}
