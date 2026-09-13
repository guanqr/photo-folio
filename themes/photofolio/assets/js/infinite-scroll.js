/**
 * 无限滚动加载
 *
 * masonry.js 已处理首批揭示，这里接管后续批次。
 * 只在滚动到页面最底部（距底部 ≤80px）时触发加载。
 *
 * 可重入：SPA 页面切换 / 筛选重置后重复调用 initInfiniteScroll()——
 * 同一触发器已挂载监听时幂等跳过；换页时旧监听在下次初始化时清理
 * （同时覆盖导航到无触发器的页面——清理先于早退，避免监听器与整棵旧网格子树滞留）。
 */

import { revealBatch } from './masonry.js';

let current = null; // { trigger, grid, onScroll }

export function initInfiniteScroll() {
    const trigger = document.getElementById('load-more-trigger');
    const grid = document.getElementById('masonry-grid');

    // 先清理旧监听（换页后旧 grid 已脱离文档；同页重置时保持不动）
    if (current && (current.trigger !== trigger || current.grid !== grid)) {
        window.removeEventListener('scroll', current.onScroll);
        current = null;
    }

    if (!trigger || !grid) return;
    if (!grid._pendingItems) return;
    // 同一触发器已初始化（滚动监听仍生效）→ 幂等
    if (current) return;

    const pageSize = parseInt(trigger.dataset.pageSize, 10) || 12;

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
        if (current && current.grid === grid) current = null;
        trigger.classList.remove('is-loading');
        trigger.classList.add('is-finished');
        // 完成文案保留在页面底部，不消失
        trigger.innerHTML = `<span class="load-more-text">${trigger.dataset.finishedText}</span>`;
    }

    // rAF 节流的滚动监听：距页面底部 ≤80px 时触发加载（其余守卫由 loadMore 统一处理）
    function onScroll() {
        if (rafPending) return;
        rafPending = true;
        requestAnimationFrame(() => {
            rafPending = false;
            if (isLoading || !grid.isConnected) return;
            if (distToBottom() <= 80) loadMore();
        });
    }
    window.addEventListener('scroll', onScroll, { passive: true });
    current = { trigger, grid, onScroll };

    if (grid._pendingItems.length === 0) {
        // 全部照片已在首屏：直接显示完成文案（保留在页面底部，不消失）
        finishLoading();
        return;
    }

    // 刷新/跳转后若已在底部，延迟检查一次
    setTimeout(onScroll, 800);
}
