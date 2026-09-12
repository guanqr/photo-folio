/**
 * 无限滚动加载
 *
 * masonry.js 已处理首批揭示，这里接管后续批次。
 * 只在滚动到页面最底部（距底部 ≤80px）时触发加载。
 */

import { revealBatch } from './masonry.js';

export function initInfiniteScroll() {
    const trigger = document.getElementById('load-more-trigger');
    const grid = document.getElementById('masonry-grid');

    if (!trigger || !grid) return;
    if (!grid._pendingItems) return;

    const pageSize = parseInt(trigger.dataset.pageSize, 10) || 12;

    if (grid._pendingItems.length === 0) {
        // 全部照片已在首屏：直接显示完成文案（保留在页面底部，不消失）
        trigger.classList.add('is-finished');
        trigger.innerHTML = `<span class="load-more-text">${trigger.dataset.finishedText}</span>`;
        return;
    }

    let isLoading = false;
    let rafPending = false;

    function distToBottom() {
        return document.documentElement.scrollHeight - window.scrollY - window.innerHeight;
    }

    function loadMore() {
        if (isLoading || !grid.isConnected) return;
        if (grid._pendingItems.length === 0) {
            finishLoading();
            return;
        }

        isLoading = true;
        trigger.classList.add('is-loading');

        const batch = Math.min(pageSize, grid._pendingItems.length);

        // 先展示转圈图标 700ms，再测量并揭示照片（revealBatch 完成后恢复状态）
        setTimeout(async () => {
            await revealBatch(grid, batch);
            isLoading = false;
            trigger.classList.remove('is-loading');
            if (grid._pendingItems.length === 0) {
                finishLoading();
                return;
            }
            // 本批照片未把用户推出底部区域时继续加载，避免卡在「载入中」
            if (distToBottom() <= 80) {
                loadMore();
            }
        }, 700);
    }

    function finishLoading() {
        window.removeEventListener('scroll', onScroll);
        trigger.classList.remove('is-loading');
        trigger.classList.add('is-finished');
        // 完成文案保留在页面底部，不消失
        trigger.innerHTML = `<span class="load-more-text">${trigger.dataset.finishedText}</span>`;
    }

    // rAF 节流的滚动监听：距页面底部 ≤80px 时触发加载
    function onScroll() {
        if (rafPending) return;
        rafPending = true;
        requestAnimationFrame(() => {
            rafPending = false;
            if (isLoading || !grid.isConnected) return;
            if (grid._pendingItems.length === 0) {
                finishLoading();
                return;
            }
            if (distToBottom() <= 80) {
                loadMore();
            }
        });
    }
    window.addEventListener('scroll', onScroll, { passive: true });

    // 刷新/跳转后若已在底部，延迟检查一次
    setTimeout(onScroll, 800);
}
