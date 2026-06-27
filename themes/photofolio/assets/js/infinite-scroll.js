/**
 * 无限滚动加载
 *
 * 隐藏照片不预分配列，存入 grid._pendingItems。
 * 加载时逐张取出，放入当前最矮列后立即解除隐藏。
 */

import { getColumnCount } from './masonry.js';

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

    function getShortestCol() {
        const cols = grid._columns;
        let min = cols[0];
        for (let i = 1; i < cols.length; i++) {
            if (cols[i].getBoundingClientRect().height < min.getBoundingClientRect().height) {
                min = cols[i];
            }
        }
        return min;
    }

    function loadMore() {
        const pending = grid._pendingItems;
        if (pending.length === 0) {
            finishLoading();
            return;
        }

        isLoading = true;
        trigger.classList.add('is-loading');

        const batch = Math.min(pageSize, pending.length);
        let done = 0;

        for (let i = 0; i < batch; i++) {
            setTimeout(() => {
                const item = pending.shift();
                const col = getShortestCol();
                col.appendChild(item);
                item.classList.remove('is-hidden');
                done++;

                if (done === batch) {
                    isLoading = false;
                    trigger.classList.remove('is-loading');

                    if (pending.length === 0) {
                        finishLoading();
                    }
                }
            }, 300 + i * 60);
        }
    }

    function finishLoading() {
        observer.disconnect();
        trigger.classList.remove('is-loading');
        trigger.classList.add('is-finished');
        trigger.innerHTML = `<span class="load-more-text">${trigger.dataset.finishedText}</span>`;
        setTimeout(() => trigger.remove(), 2000);
    }
}
