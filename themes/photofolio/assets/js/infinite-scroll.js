/**
 * 无限滚动加载
 *
 * 依赖 inline script（baseof.html）在 HTML 解析阶段标记首批之外的 .is-hidden。
 * masonry.js 随后用 round-robin 将 items 移入列容器。
 *
 * 关键：使用 grid._allItems（原始时间顺序）而非 DOM 查询来定位下一批，
 *      避免 round-robin 重排后 document 顺序导致的一列全显、他列为空。
 */

export function initInfiniteScroll() {
    const trigger = document.getElementById('load-more-trigger');
    const grid = document.getElementById('masonry-grid');

    if (!trigger || !grid) return;
    if (!grid._allItems) return;

    const allItems = grid._allItems;  // 原始时间倒序数组，由 masonry 保存
    const pageSize = parseInt(trigger.dataset.pageSize, 10) || 12;

    // 前 pageSize 张已可见（inline script 只隐藏了 index >= pageSize 的项）
    let currentIndex = pageSize;

    if (currentIndex >= allItems.length) {
        trigger.remove();
        return;
    }

    let isLoading = false;

    const observer = new IntersectionObserver((entries) => {
        if (entries[0].isIntersecting && !isLoading) {
            loadMore();
        }
    }, { rootMargin: '300px' });

    observer.observe(trigger);

    function loadMore() {
        if (currentIndex >= allItems.length) {
            finishLoading();
            return;
        }

        isLoading = true;
        trigger.classList.add('is-loading');

        setTimeout(() => {
            const nextIndex = Math.min(currentIndex + pageSize, allItems.length);

            // 按原始时间顺序依次解除隐藏 —— 均匀分布在所有列中
            for (let i = currentIndex; i < nextIndex; i++) {
                allItems[i].classList.remove('is-hidden');
            }

            currentIndex = nextIndex;
            isLoading = false;
            trigger.classList.remove('is-loading');

            if (currentIndex >= allItems.length) {
                finishLoading();
            }
        }, 800);
    }

    function finishLoading() {
        observer.disconnect();
        trigger.classList.remove('is-loading');
        trigger.classList.add('is-finished');
        trigger.innerHTML = `<span class="load-more-text">${trigger.dataset.finishedText}</span>`;
        setTimeout(() => trigger.remove(), 2000);
    }
}
