/**
 * 无限滚动加载
 *
 * masonry.js 已处理首屏揭示，这里接管后续行：每次触发只揭示下一行——
 * 行内照片数由行计划按当前宽度/宽高比决定（1–6 张），不再固定张数。
 *
 * 滚动参考直接用网格底部（不再保留独立的 load-more 触发器）：网格底边越过
 * 视口底部边缘 [params.grid].triggerOffset（默认 40px，模板写入 data 属性）
 * 后揭示下一行；网格只在带 data-infinite-scroll 的页面启用，
 * 系列详情页由 masonry 一次揭示全部行。
 *
 * 揭示即时进行（无加载文字/转圈），图片未就绪由 LQIP 占位。
 *
 * 可重入：SPA 页面切换 / 筛选重置后重复调用 initInfiniteScroll()——
 * 同一网格已挂载监听时幂等跳过；换页时旧监听在下次初始化时清理
 * （同时覆盖导航到无网格的页面——清理先于早退，避免监听器与整棵旧网格子树滞留）。
 */

import { revealPlanRows } from './masonry.js';

const DEFAULT_TRIGGER_OFFSET = 40; // 触发距离缺省值（px），与 [params.grid].triggerOffset 缺省同源

let current = null; // { grid, onScroll, onResize }
let resizeDelayTimer = null;

/* 拆线：移除滚动监听并清空当前实例（换页清理 / 早退分支 / 完成收尾共用）。
   inst 缺省无条件拆除（换页清理旧监听）；传实例时仅当 current 仍是该实例才拆——
   旧页异步收尾迟到的拆线不得摘掉已换上的新页面监听（2026-10-18） */
function detach(inst = null) {
    if (!current) return;
    if (inst && current !== inst) return;
    window.removeEventListener('scroll', current.onScroll);
    if (current.onResize) window.removeEventListener('resize', current.onResize);
    if (resizeDelayTimer) {
        clearTimeout(resizeDelayTimer);
        resizeDelayTimer = null;
    }
    current = null;
}

export function initInfiniteScroll() {
    const grid = document.getElementById('masonry-grid');
    // 读屏器加载状态（模板中的视觉隐藏 live region）：只写文案，不做视觉呈现
    const statusEl = document.getElementById('masonry-status');
    const statusLoading = statusEl ? (statusEl.dataset.loading || '') : '';
    const statusFinished = statusEl ? (statusEl.dataset.finished || '') : '';
    function setStatus(text) {
        if (!statusEl || !text || statusEl.textContent === text) return;
        statusEl.textContent = text;
    }
    function clearStatus() {
        if (statusEl && statusEl.textContent) statusEl.textContent = '';
    }
    function markFinishedStatus() {
        // 空筛选结果不播报“全部加载完”（空状态卡片自身有文案）
        if (grid && grid._planItems && grid._planItems.length === 0) clearStatus();
        else setStatus(statusFinished);
    }
    clearStatus(); // 新页面/筛选重启：清掉上一状态，下一次开始/完成会重新播报

    // 先清理旧监听（换页后旧 grid 已脱离文档；同页重置时保持不动）
    if (current && current.grid !== grid) {
        detach();
    }

    if (!grid || !grid._pendingItems || !grid._hasInfinite) return;
    // 同一网格已初始化（滚动监听仍生效）→ 只同步收尾状态后返回：
    // 筛选重启后首屏揭示可能是异步的（队列在布局链上尚未消费），
    // 直接幂等返回会让小结果集保留已无意义的监听器——等链完成后再判一次
    if (current) {
        const inst = current;
        if (grid._pendingItems.length === 0) {
            markFinishedStatus();
            detach(inst);
            return;
        }
        (grid._layoutChain || Promise.resolve()).then(() => {
            if (current !== inst) return;
            if (grid._pendingItems.length === 0) {
                markFinishedStatus();
                detach(inst);
                return;
            }
            // 筛选重启后的首屏揭示完成：若网格已在触发区，补一次判断
            requestAnimationFrame(() => {
                if (current === inst) inst.onScroll();
            });
        });
        return;
    }

    let isLoading = false;
    let rafPending = false;

    // 网格底边距视口底部的距离；触发距离由 hugo.toml [params.grid] 经模板 data 属性注入
    const triggerOffsetPx = parseInt(grid.dataset.triggerOffset, 10);
    const TRIGGER_OFFSET = -(Number.isFinite(triggerOffsetPx) ? triggerOffsetPx : DEFAULT_TRIGGER_OFFSET);
    function distToBottom() {
        return grid.getBoundingClientRect().bottom - window.innerHeight;
    }

    function loadMore() {
        if (isLoading || !grid.isConnected) return;
        if (grid._restartPromise) return; // 筛选重启在即：不要按旧集合揭示
        if (!grid._plan || grid._pendingItems.length === 0) {
            finishLoading();
            return;
        }

        const gen = grid._gridGen || 0;
        isLoading = true;
        setStatus(statusLoading); // 读屏器：开始加载（同一状态不重复写）
        // 揭示即时进行：LQIP 已在行内占位，主图就绪后淡入
        revealPlanRows(grid, 1).then(() => {
            // 先复位加载锁：即使本批因筛选重启作废，旧实例也不要把加载锁死
            isLoading = false;
            // 页面归属守卫：SPA 换页后 current 已指向新页实例，旧页续体的
            // 收尾（finishLoading→detach）会摘掉新页面的滚动监听、
            // 致新页剩余作品加载不出——已换页则静默放弃收尾（2026-10-18）
            if (current !== me || (grid._gridGen || 0) !== gen) return;
            if (grid._pendingItems.length === 0) {
                finishLoading();
                return;
            }
            // 本行未把用户推出触发区时继续揭示下一行，避免卡在加载中
            if (distToBottom() <= TRIGGER_OFFSET) loadMore();
        }).catch((err) => {
            // 揭示链异常：复位加载锁，避免无限滚动永久停住
            isLoading = false;
            console.warn('[infinite-scroll] reveal next row failed:', err);
        });
    }

    function finishLoading() {
        markFinishedStatus(); // 读屏器：全部加载完（空结果由 markFinishedStatus 清空）
        detach(me);
    }

    // rAF 节流的滚动监听：网格底边越过视口底部边缘 TRIGGER_OFFSET 距离后触发加载
    //（其余守卫由 loadMore 统一处理）
    function onScroll() {
        if (rafPending) return;
        rafPending = true;
        requestAnimationFrame(() => {
            rafPending = false;
            if (isLoading || !grid.isConnected) return;
            if (distToBottom() <= TRIGGER_OFFSET) loadMore();
        });
    }
    // 视口变高/全屏/旋转：masonry 的 resize 重排完成后补一次触发判断；
    // 900ms 后的延迟检查覆盖 masonry 300/800ms 的档位重判重排
    function onResize() {
        onScroll();
        if (resizeDelayTimer) clearTimeout(resizeDelayTimer);
        resizeDelayTimer = setTimeout(() => {
            resizeDelayTimer = null;
            onScroll();
        }, 900);
    }
    // 实例身份：异步续体与拆线据此判断「仍是本页」（换页后 current 被新实例覆盖）
    const me = { grid, onScroll, onResize };
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onResize, { passive: true });
    current = me;

    if (grid._pendingItems.length === 0) {
        // 全部作品已在首屏：直接收尾
        finishLoading();
        return;
    }

    // 首屏揭示是异步的（布局链上）：完成后若待加载队列已空则收尾；
    // 否则补一次触发判断（小结果集/短页可能已在触发区，不依赖用户滚动）
    (grid._layoutChain || Promise.resolve()).then(() => {
        if (current !== me) return;
        if (grid._pendingItems.length === 0) {
            finishLoading();
            return;
        }
        requestAnimationFrame(() => {
            if (current === me) onScroll();
        });
    });

    // 刷新/跳转后若已在底部，延迟检查一次
    setTimeout(onScroll, 800);
}
