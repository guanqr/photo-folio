/**
 * 无限滚动加载
 *
 * masonry.js 已处理首批揭示，这里接管后续批次。
 */

import { revealBatch } from './masonry.js';

export function initInfiniteScroll() {
    const trigger = document.getElementById('load-more-trigger');
    const grid = document.getElementById('masonry-grid');

    if (!trigger || !grid) return;
    if (!grid._pendingItems) return;

    const pageSize = parseInt(trigger.dataset.pageSize, 10) || 12;

    if (grid._pendingItems.length === 0) {
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
        if (grid._pendingItems.length === 0) {
            finishLoading();
            return;
        }

        isLoading = true;
        trigger.classList.add('is-loading');

        const batch = Math.min(pageSize, grid._pendingItems.length);
        let done = 0;

        for (let i = 0; i < batch; i++) {
            setTimeout(() => {
                done++;
                if (done === batch) {
                    isLoading = false;
                    trigger.classList.remove('is-loading');
                    if (grid._pendingItems.length === 0) {
                        finishLoading();
                    }
                }
            }, i * 60);
        }

        revealBatch(grid, batch);
    }

    function finishLoading() {
        observer.disconnect();
        trigger.classList.remove('is-loading');
        trigger.classList.add('is-finished');
        trigger.innerHTML = `<span class="load-more-text">${trigger.dataset.finishedText}</span>`;
        setTimeout(() => trigger.remove(), 2000);
    }
}
