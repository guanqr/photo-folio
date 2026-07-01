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
    let wasIntersecting = true;

    const observer = new IntersectionObserver((entries) => {
        const isIntersecting = entries[0].isIntersecting;
        if (isIntersecting && !wasIntersecting && !isLoading) {
            loadMore();
        }
        wasIntersecting = isIntersecting;
    }, { rootMargin: '0px' });

    // 延迟 800ms 后开始观察，此时若触发器已在视口内则直接触发加载
    setTimeout(() => {
        wasIntersecting = false;
        observer.observe(trigger);
    }, 800);

    function loadMore() {
        if (grid._pendingItems.length === 0) {
            finishLoading();
            return;
        }

        isLoading = true;
        trigger.classList.add('is-loading');

        const batch = Math.min(pageSize, grid._pendingItems.length);

        // 先展示转圈图标 700ms，再开始揭示照片
        setTimeout(() => {
            revealBatch(grid, batch);
            setTimeout(() => {
                isLoading = false;
                trigger.classList.remove('is-loading');
                if (grid._pendingItems.length === 0) {
                    finishLoading();
                }
            }, batch * 60);
        }, 700);
    }

    function finishLoading() {
        observer.disconnect();
        trigger.classList.remove('is-loading');
        trigger.classList.add('is-finished');
        trigger.innerHTML = `<span class="load-more-text">${trigger.dataset.finishedText}</span>`;
        setTimeout(() => trigger.remove(), 2000);
    }
}
