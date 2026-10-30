/**
 * 作品网格引擎（两端对齐行布局，行高自然变化、行宽恰好铺满）
 *
 * - 行高 = (行宽 − 间距 − 边框) / 宽高比之和，由本行内容自然决定，行高可以变化
 * - 每行恰好铺满容器（右缘对齐），作品间间距全局统一（CSS gap 0.5em，引擎读取计算样式）
 * - 贪心分行以参考值 H（最宽布局每行 4 张 3:2 宽幅作品的基准）为目标，
 *   行高天然落在 H 附近；作品严格保持自身长宽比（object-fit: cover 仅兜底取整误差）
 * - 超窄屏 ≤500px：每行 1–2 张——3:2 横构图独占一行（行高基准 H = 行宽 × 2/3），
 *   竖构图（宽高比 < 1）绝不落单，与相邻作品同行
 * - 最后一行不强行对齐：行高封顶 H、左侧对齐、右侧留白
 * - 整页容器 + 渐进加载（2026-10-31）：初始化时一次算完整组行计划并把网格高度设为总高——
 *   滚动条一开始就是完整长度；首屏只揭示可见窗口内的行（不额外预载），由串行队列
 *   一次建立一行（图片请求与入场都逐行）；之后正常下拉按行逐行补载，已渲染的行保留
 *   （滚回不闪、灯箱箭头覆盖已看过的照片）。拖到未渲染区域时只补视口内的行，
 *   同样逐行建立；刷新恢复滚动位置时只揭示当前视口行
 * - 行容器按计划绝对定位，未渲染的卡片留在隐藏池（无 src、不请求图片）
 * - 逐张淡入（60ms/张），图片未到时由 LQIP 模糊底图占位
 * - resize：同档位行成员冻结、只按新宽度重算行高与位置（实时无动画）；跨档位重排整组行，
 *   不做 FLIP，按视口锚点补偿滚动位置，避免内容跳动
 */

import { prefersReducedMotion, markImageLoaded } from './utils.js';

const DEFAULT_RATIO = 1.5; // 图片宽高比读取失败时的兜底值（3:2）
const REVEAL_STAGGER = 60; // 逐张揭示间隔 ms
const DEFAULT_ROW_LOAD_RATIO = 0.75; // 下一行至少 3/4 进入视口才补载，config 缺省值

let resizeBound = false;
let windowBound = false;
let windowRaf = 0;
let gridObserver = null; // 每页只有一个网格；SPA 换页时断开旧观察，避免持有已脱离文档的整棵网格子树
let restartFadeTimer = null;
let restartFadeFinish = null; // 未执行筛选重启的收尾句柄（清 promise + 释放等待者）

export function initMasonry(skipInitialReveal = false) {
    // SPA 换页：上一页尚未执行的筛选重启作废（避免旧网格继续渲染/启动监听）
    cancelPendingRestart();
    const grid = document.getElementById('masonry-grid');
    // 换页先断开旧观察（与 lazy-load 同款：清理先于一切早退——跳转无网格页
    // （about/足迹列表/首页/404）时早退将不可达，观察器会持续持有已脱离
    // 文档的整棵作品子树，2026-10-18）
    if (gridObserver) {
        gridObserver.disconnect();
        gridObserver = null;
    }
    if (!grid) return;
    clearRenderQueue(grid); // 同页重入/异常残留的行队列先作废

    const allItems = Array.from(grid.querySelectorAll('.masonry-item'));
    if (allItems.length === 0) return;

    // 全部先隐藏（不依赖 baseof 的内联脚本——SPA 跳转时内联脚本不会执行，
    // 否则未进入窗口的作品会以原始尺寸占据版面）
    allItems.forEach((item) => item.classList.add('is-hidden'));

    // 原始时间顺序基准必须在任何行容器创建前捕获：首屏行会把卡片移出隐藏池，
    // 之后再查 DOM 顺序会变成「隐藏池 + 首屏行」，筛选/重置按错误基准排序（2026-10-31）
    if (!grid._origOrder) {
        grid._origOrder = new Map(allItems.map((el, i) => [el, i]));
    }
    grid._planItems = allItems; // 行计划覆盖的作品集合（筛选重启时替换为筛选结果）
    grid._shownItems = []; // 已渲染过的作品（灯箱集合与锚点补偿读取）
    grid._shownSet = new Set();
    grid._renderedRows = new Map(); // 已渲染行：行号 → 行容器
    grid._ratios = new Map(allItems.map((item) => [item, ratioOf(grid, item)]));
    grid._cardBorder = 0;
    grid._cardBorderV = 0;
    grid._gap = 0;
    // 行基准档位（0=超窄屏 ≤500、1=窄屏 501-768 与汉堡断点一致、2=中屏 769-1000、3=宽屏 >1000）；
    // 带滞回，防止断点附近来回切换；按当前宽度初始化
    grid._tier = null;
    updateTier(grid);
    grid._gridGen = 0; // 网格状态代次：筛选重启/跨档重排递增、作废旧批次淡入计时器
    grid._lastW = 0;
    grid._windowPaused = skipInitialReveal; // 带筛选参数的 URL：等筛选重启完成后再渲染窗口
    grid.classList.remove('is-fallback');
    grid.classList.add('is-virtual'); // 行容器绝对定位 + 网格高度 = 完整行计划总高
    grid._plan = buildPlan(grid); // 整组行计划与每行 top（按当前宽度/档位一次算好）
    setGridHeight(grid);

    // 观察网格自身尺寸变化（滚动条出现/消失等），自动重排行布局
    if (typeof ResizeObserver !== 'undefined') {
        gridObserver = new ResizeObserver(() => scheduleRelayout(grid));
        gridObserver.observe(grid);
    }

    // 带筛选参数的 URL 刷新时跳过首屏揭示，交由筛选恢复流程统一揭示——
    // 否则未筛选的行会先闪现、再被筛选重启隐藏，出现「显示→消失→再显示」的跳变
    if (!skipInitialReveal) {
        revealInitialRows(grid);
        updateRowsOnScroll(grid);
    }
    grid.classList.add('masonry-ready');
}

/* ===== 行计划与窗口渲染 ===== */

/* 每张作品的宽高比：优先取 photo.toml 回填的 width/height 属性（构建期写入，
   管线保证恒有）——整组行计划在初始化时一次算好，不再等待图片测量。
   属性缺失（数据地雷）不阻塞渲染：按 3:2 兜底并挂一次 load 校正——图片
   就绪后以自然宽高重算比例并重建行计划，不会整会话按 3:2 裁切竖构图
   （2026-10-28） */
function ratioOf(grid, item) {
    const img = item._img || (item._img = item.querySelector('img.photo-img'));
    if (!img) return DEFAULT_RATIO;
    const w = parseFloat(img.getAttribute('width'));
    const h = parseFloat(img.getAttribute('height'));
    if (w > 0 && h > 0) return w / h;

    warnMissingDimensions(img);
    // 已加载（如筛选重启时）直接用真实比例，无需等下一次 load
    const loadedRatio = naturalRatio(img);
    if (loadedRatio) return loadedRatio;
    watchRatioOnLoad(grid, item, img);
    return DEFAULT_RATIO;
}

function naturalRatio(img) {
    const w = img.naturalWidth;
    const h = img.naturalHeight;
    return (w > 0 && h > 0) ? w / h : 0;
}

function warnMissingDimensions(img) {
    if (img._ratioWarned) return;
    img._ratioWarned = true;
    console.warn('[masonry] width/height missing, using 3:2 until load:',
        img.getAttribute('data-src') || img.src || '(pending)');
}

/* 缺尺寸图片加载完成：把自然比例写回 _ratios 并重建行计划——
   行高依赖计划行的 sum，比例变化必须重算整组计划才能生效 */
function watchRatioOnLoad(grid, item, img) {
    if (img._ratioWatched) return;
    img._ratioWatched = true;
    img.addEventListener('load', () => {
        if (!grid.isConnected || !grid._ratios) return;
        const ratio = naturalRatio(img);
        const old = grid._ratios.get(item);
        if (!ratio || (old && Math.abs(old - ratio) < 0.001)) return;
        grid._ratios.set(item, ratio);
        // 重新规划整组行并保持视口锚点（与跨档重排同路径）
        rebuildForPlanChange(grid);
    }, { once: true });
}

/* 按当前宽度/档位为整组（筛选后）作品预计算行计划：
   行 = 一段连续作品，start/count/sum 以 _planItems 为坐标系；
   只有全局最后一行是 ragged（左对齐留白），其余行都恰好铺满 */
function buildPlan(grid) {
    const W = getGridWidth(grid);
    const gap = getRowGap(grid);
    const border2 = getCardBorder(grid);
    updateTier(grid);
    const H = getTargetRowHeight(W, gap, border2, grid._tier);
    const ratios = grid._planItems.map((item) => grid._ratios.get(item) || DEFAULT_RATIO);
    const plan = partitionRows(ratios, W, H, gap, border2, true, grid._tier);
    computeRowLayout(grid, plan);
    return plan;
}

/* 每行 top/高度与整组总高：行高与「卡片上下边框」之和 + 行距——
   网格高度设为总高后，滚动条从一开始就覆盖完整作品集合（2026-10-31） */
function computeRowLayout(grid, plan) {
    const W = getGridWidth(grid);
    const gap = getRowGap(grid);
    const border2 = getCardBorder(grid);
    const borderV = getCardBorderV(grid);
    const H = getTargetRowHeight(W, gap, border2, grid._tier);
    const layout = [];
    let top = 0;
    for (const row of plan) {
        const h = Math.round(planRowHeight(row, W, gap, border2, H));
        layout.push({ top, h });
        top += h + borderV + gap;
    }
    grid._rowLayout = layout;
    grid._planHeight = layout.length ? top - gap : 0;
    grid._lastW = W;
    grid._gap = gap;
    grid._border2 = border2;
    grid._borderV = borderV;
    return layout;
}

/* 行在给定宽度下的高度：普通行恰好铺满；真正的最后一行封顶 H、左对齐 */
function planRowHeight(row, W, gap, border2, H) {
    let h = rowHeight(W, row.count, row.sum, gap, border2);
    if (row.ragged) h = Math.min(h, H);
    return h;
}

function setGridHeight(grid) {
    grid.style.height = (grid._planHeight || 0) + 'px';
}

/* 首屏揭示行数：只覆盖当前可见窗口，不额外预载。
   网格在首屏下方（可见高度 <= 0）时返回 0，滚近后由补载逻辑处理 */
function initialRowCount(grid) {
    const W = getGridWidth(grid);
    const gap = getRowGap(grid);
    const border2 = getCardBorder(grid);
    const H = getTargetRowHeight(W, gap, border2, grid._tier);
    const visible = (window.innerHeight || 800) - Math.max(0, grid.getBoundingClientRect().top);
    if (visible <= 0) return 0;
    let acc = 0;
    let n = 0;
    while (n < grid._plan.length && acc < visible) {
        const row = grid._plan[n];
        acc += planRowHeight(row, W, gap, border2, H) + gap;
        n++;
    }
    return n;
}

/* 首屏揭晓：入队逐行建立（不是一次建好后错开淡入）。
   刷新时浏览器已恢复滚动位置（网格顶部在视口上方）：只揭示当前视口内的行，
   不再从顶部前缀开始——否则恢复位置的那一段会走补行分支、看不到动画 */
function revealInitialRows(grid) {
    let first = 0;
    let last = initialRowCount(grid);
    if (grid.getBoundingClientRect().top < 0) {
        const range = viewportRowRange(grid);
        if (!range) return;
        first = range.start;
        last = range.end;
    }
    const indices = [];
    for (let i = first; i < last; i++) indices.push(i);
    enqueueRows(grid, indices);
}

/* 已渲染的连续前缀行数（正常下拉从 0 开始；跳转后前缀可能不变） */
function renderedPrefixRows(grid) {
    let n = 0;
    while (grid._renderedRows.has(n)) n++;
    return n;
}

/* 视口在行计划坐标系中的范围（不加上下预载）：
   用于跳到未渲染区域时补视口内的行 */
function viewportRowRange(grid) {
    const layout = grid._rowLayout;
    if (!layout || layout.length === 0) return null;
    const rect = grid.getBoundingClientRect();
    const vh = window.innerHeight || document.documentElement.clientHeight;
    const top = -rect.top;
    const bottom = vh - rect.top;
    const borderV = grid._borderV || 0;

    // 第一个「行底 > 视口顶」的行
    let lo = 0;
    let hi = layout.length;
    while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (layout[mid].top + layout[mid].h + borderV > top) hi = mid;
        else lo = mid + 1;
    }
    const start = lo;
    // 第一个「行顶 >= 视口底」的行
    lo = start;
    hi = layout.length;
    while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (layout[mid].top < bottom) lo = mid + 1;
        else hi = mid;
    }
    const end = lo;
    if (start >= layout.length || start >= end) return null;
    return { start, end };
}

/* 批量补视口内的行（跳转/快速拖动）：把行加入串行队列，一次只建立一行；
   跨档重排用 instant 直接落位（不排动画队列）。 */
function renderVisibleRows(grid, instant = false) {
    const range = viewportRowRange(grid);
    if (!range) return;
    const indices = [];
    for (let i = range.start; i < range.end; i++) {
        if (!grid._renderedRows.has(i)) indices.push(i);
    }
    if (instant) {
        indices.forEach((i) => renderRow(grid, i, true));
        return;
    }
    // 跳转目标优先：只保留仍在视口内的待办行，再加入当前视口行；
    // 不清队列计时器——滚动事件连续到来时仍保持一次只建立一行
    enqueueRows(grid, indices, true);
}

/* 行渲染队列：一次只建立一行（移入卡片、赋 src、排淡入）；
   下一行在本行最后一张开始淡入时建立（不再额外停顿）——图片请求逐行，
   入场节奏与改造前「每张 60ms 连续接续」一致。
   visibleOnly：丢弃不在当前视口范围内的待办行（跳转时优先补视口内的行） */
function enqueueRows(grid, indices, visibleOnly = false) {
    if (!grid || !grid.isConnected || !indices || !indices.length) return;
    if (!grid._renderQueue) {
        grid._renderQueue = [];
        grid._queuedRows = new Set();
    }
    if (visibleOnly) {
        const keep = new Set(indices);
        const kept = [];
        const keptSet = new Set();
        for (const i of grid._renderQueue) {
            if (keep.has(i)) {
                kept.push(i);
                keptSet.add(i);
            }
        }
        grid._renderQueue = kept;
        grid._queuedRows = keptSet;
    }
    for (const i of indices) {
        if (i < 0 || i >= grid._plan.length) continue;
        if (grid._renderedRows.has(i) || grid._queuedRows.has(i)) continue;
        grid._queuedRows.add(i);
        grid._renderQueue.push(i);
    }
    drainRenderQueue(grid);
}

function drainRenderQueue(grid) {
    if (!grid || !grid.isConnected) {
        if (grid) clearRenderQueue(grid);
        return;
    }
    if (grid._queueTimer) return; // 上一行还没到下一行的时间
    const queue = grid._renderQueue || [];
    let next = null;
    while (queue.length) {
        const idx = queue.shift();
        grid._queuedRows.delete(idx);
        if (!grid._renderedRows.has(idx) && grid._plan[idx]) {
            next = idx;
            break;
        }
    }
    if (next == null) return;
    renderRow(grid, next, false);
    const count = (grid._plan[next] && grid._plan[next].count) || 1;
    grid._queueTimer = setTimeout(() => {
        grid._queueTimer = null;
        if (!grid.isConnected) {
            clearRenderQueue(grid);
            return;
        }
        drainRenderQueue(grid);
    }, count * REVEAL_STAGGER);
}

function clearRenderQueue(grid) {
    if (!grid) return;
    if (grid._queueTimer) {
        clearTimeout(grid._queueTimer);
        grid._queueTimer = null;
    }
    grid._renderQueue = [];
    grid._queuedRows = new Set();
}

/* 滚动补载：正常下拉时从已渲染前缀逐行补下一行——下一行至少 rowLoadRatio 比例
   进入视口才加载；视口已越过已渲染内容（拖到未渲染区域）时只补视口内的行，避免空白。
   所有补行都只入队，由串行队列一次建立一行 */
function updateRowsOnScroll(grid) {
    if (!grid || !grid.isConnected || grid._windowPaused || !grid._plan || !grid._rowLayout) return;
    if (grid._restartPromise) return; // 筛选重启会按新集合重建并揭示首屏
    const plan = grid._plan;
    if (plan.length === 0) return;

    const rect = grid.getBoundingClientRect();
    const vh = window.innerHeight || document.documentElement.clientHeight;
    const layout = grid._rowLayout;
    const borderV = grid._borderV || 0;
    const prefixN = renderedPrefixRows(grid);
    if (prefixN >= plan.length) return;
    const prefixBottom = prefixN ? layout[prefixN - 1].top + layout[prefixN - 1].h + borderV : 0;
    const viewTop = -rect.top;

    // 视口已越过已渲染内容：只补视口内的行（仍逐行建立）
    if (viewTop > prefixBottom + 1) {
        renderVisibleRows(grid);
        return;
    }

    // 正常下拉：下一行至少 ratio 高度进入视口才入队；一次可入队多行，队列会逐行建立
    const ratio = Math.min(1, Math.max(0, gridFloat(grid, 'rowLoadRatio', DEFAULT_ROW_LOAD_RATIO)));
    const indices = [];
    let n = prefixN;
    let guard = 0;
    while (n < plan.length && guard++ < plan.length) {
        const rowLayout = layout[n];
        if (!rowLayout) break;
        const rowTopViewport = rect.top + rowLayout.top;
        const visibleRatio = rowLayout.h > 0 ? (vh - rowTopViewport) / rowLayout.h : 1;
        if (visibleRatio < ratio) break;
        indices.push(n);
        n++;
    }
    enqueueRows(grid, indices);
}

/* 建立一行：卡片从隐藏池移入绝对定位行容器、赋 src、按计划尺寸排版并淡入。
   instant（深链/跨档重排）：跳过淡入直接显示 */
function renderRow(grid, rowIndex, instant = false) {
    if (!grid._renderedRows || grid._renderedRows.has(rowIndex)) return;
    const row = grid._plan[rowIndex];
    const layout = grid._rowLayout[rowIndex];
    if (!row || !layout) return;

    const items = grid._planItems.slice(row.start, row.start + row.count);
    const rowEl = document.createElement('div');
    rowEl.className = 'masonry-row';
    rowEl.dataset.rowIndex = String(rowIndex);
    rowEl.style.top = layout.top + 'px';
    items.forEach((item) => rowEl.appendChild(item));
    insertRowSorted(grid, rowEl, rowIndex);

    const ratios = items.map((item) => grid._ratios.get(item) || DEFAULT_RATIO);
    applyRows(items, [{ start: 0, count: row.count, h: layout.h, ragged: row.ragged }], ratios,
        grid._lastW, grid._gap, grid._border2);

    items.forEach((item) => {
        if (!grid._shownSet.has(item)) {
            grid._shownSet.add(item);
            grid._shownItems.push(item);
        }
        prepareItemImage(item);
    });
    grid._renderedRows.set(rowIndex, rowEl);
    if (grid._queuedRows) grid._queuedRows.delete(rowIndex);
    revealItems(grid, items, instant);
}

/* 行容器按行号排序插入，保持 DOM 顺序 = 时间顺序（灯箱集合依赖 DOM 顺序）；
   隐藏池中的卡片无 src，不参与灯箱集合 */
function insertRowSorted(grid, rowEl, index) {
    const rows = grid.querySelectorAll(':scope > .masonry-row');
    for (const el of rows) {
        if (Number(el.dataset.rowIndex) > index) {
            grid.insertBefore(rowEl, el);
            return;
        }
    }
    grid.appendChild(rowEl);
}

/* 解除隐藏、赋 src 并绑定主图淡入标记（底下的模糊占位图见 photo-card 的 --photo-blur）：
   缓存命中立即标记，否则挂一次性 load；先判就绪再挂监听，避免漏掉已完成的图片。
   AVIF→webp 兜底换源后触发的仍是首个 load，标记不会丢 */
function prepareItemImage(item) {
    item.classList.remove('is-hidden');
    const img = item._img || (item._img = item.querySelector('img.photo-img'));
    if (!img) return;
    if (img.dataset.src && !img.src) {
        img.src = img.dataset.src;
        img.removeAttribute('data-src');
    }
    markImageLoaded(img);
}

/* 逐张淡入：同一行内 60ms 一张；跨行由渲染队列控制，不会多行同时建立。
   已渲染过的卡片（跨档重排复用）不再重播入场 */
function revealItems(grid, items, instant) {
    const gen = grid._gridGen || 0;
    items.forEach((item, i) => {
        if (item.classList.contains('is-revealed')) return;
        if (instant || prefersReducedMotion()) {
            item.classList.add('is-revealed');
            return;
        }
        setTimeout(() => {
            if ((grid._gridGen || 0) !== gen || !item.isConnected) return;
            requestAnimationFrame(() => {
                if ((grid._gridGen || 0) !== gen || !item.isConnected) return;
                requestAnimationFrame(() => {
                    if ((grid._gridGen || 0) !== gen || !item.isConnected) return;
                    item.classList.add('is-revealed');
                });
            });
        }, i * REVEAL_STAGGER);
    });
}

/* 读取网格上的浮点加载策略配置（如 rowLoadRatio） */
function gridFloat(grid, key, fallback) {
    const value = parseFloat(grid.dataset[key]);
    return Number.isFinite(value) ? value : fallback;
}

/* 行内水平间距（缓存）：优先读行容器 columnGap；行容器尚未创建（首批）时读网格自身 rowGap——
   两者由同一条 CSS gap 声明驱动，避免行容器出现前回退到错误默认值导致行宽计算偏差 */
function getRowGap(grid) {
    if (grid._gap) return grid._gap;
    const rowEl = grid.querySelector('.masonry-row');
    let g = rowEl ? parseFloat(getComputedStyle(rowEl).columnGap) : 0;
    if (!g) g = parseFloat(getComputedStyle(grid).rowGap);
    // 只缓存真实读取值、不臆造兜底：CSS 恒声明 gap 0.5em，读取失败时按 0
    // 参与本次排布且不缓存（下次调用重读）——此前 8px 兜底与样式表脱钩、
    // 根字号/间距改动后行宽错档（2026-10-18）
    grid._gap = g || 0;
    return grid._gap;
}

/* 行基准档位判定：
   0=超窄屏 ≤500px（每行 1–2 张：3:2 横构图独占或与竖构图同行）、
   1=窄屏 501-768px（每行 2 张 3:2 基准）、2=中屏 769-1000px（每行 3 张 3:2 基准）、
   3=宽屏 >1000px（每行 4 张 3:2 基准）
   滞回：升档需越过 TIER_EXIT（520/788/1020），降档按原始阈值（500/768/1000），
   防止断点附近来回切换导致布局跳跃；返回档位是否变化。
   宽度信号：档位基础值读 CSS 变量 --layout-tier（样式表媒体查询写入——旋转后
   CSS 评估恒可信）；升档滞回用 TIER_EXIT 的 matchMedia 查询补充（媒体查询
   随旋转正常重估，与 CSS 变量同为可信信号） */
const TIER_ENTER = [500, 768, 1000];
const TIER_EXIT = [520, 788, 1020];

function updateTier(grid) {
    const raw = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--layout-tier'), 10);
    let tier = Number.isFinite(raw) ? Math.max(0, Math.min(3, raw)) : 0;
    if (grid._tier != null && tier > grid._tier) {
        // 升档滞回：未越过当前档位的出口值时保持原档位（降档随 CSS 变量立即生效）
        const exit = TIER_EXIT[grid._tier];
        if (!window.matchMedia(`(min-width: ${exit + 1}px)`).matches) {
            tier = grid._tier;
        }
    }
    const changed = tier !== grid._tier;
    grid._tier = tier;
    return changed;
}

/* 行高公式（全模块唯一实现）：行高 = (行宽 − 间距 − 边框) / 宽高比之和 */
function rowHeight(W, count, sum, gap, border2) {
    return (W - gap * (count - 1) - border2 * count) / sum;
}

/* 行高参考值：以「每行 N 张 3:2 宽幅作品（长边 3、宽边 2）」为基准，按实际容器宽度反推
   档位：0=超窄屏每行 1 张（占满整行）、1=窄屏每行 2 张、2=中屏每行 3 张、3=宽屏每行 4 张
   （档位判定见 updateTier） */
function getTargetRowHeight(containerWidth, gap, border2, tier) {
    // 档位 0（超窄屏）：单张 3:2 占满整行为基准；其余档位每行 N 张 3:2 基准
    const N = tier === 0 ? 1 : (tier === 1 ? 2 : (tier === 2 ? 3 : 4));
    return rowHeight(containerWidth, N, N * (3 / 2), gap, border2);
}

/* 贪心分行：行高 = (行宽 − 间距 − 边框) / 宽高比之和（自然铺满，行高可变化）
   逐张累加直到再加一张会低于参考值 H；
   超窄屏档位 0：每行最多 2 张——横构图（宽高比 ≥ 1）可独占一行；竖构图开头的行必须
   与下一张同行（绝不落单）；行内一张横构图后若下一张是最后一张竖构图，则并入本行；
   其余档位：边界处比较「停在此处 / 纳入下一张」，取行高最接近 H 者；
   最后一行（作品耗尽）行高封顶 H、右侧留白不强行对齐 */
function partitionRows(ratios, W, H, gap, border2, refine, tier) {
    const isTier0 = tier === 0;
    const maxPhotos = isTier0 ? 2 : Infinity; // 超窄屏每行最多 2 张
    const minPhotos = tier <= 1 ? 1 : 2;
    const hOf = (count, sum) => rowHeight(W, count, sum, gap, border2);
    const rows = [];
    let i = 0;
    const n = ratios.length;
    while (i < n) {
        // 超窄屏：竖构图（宽高比 < 1）开头的行必须凑足 2 张，与下一张同行
        const minForRow = isTier0 && ratios[i] < 1 ? 2 : minPhotos;
        let sum = 0;
        let count = 0;
        let j = i;
        while (j < n) {
            // 超窄屏：行内已有一张横构图、下一张是竖构图且为最后一张——并入本行，避免竖构图落单
            if (isTier0 && count === 1 && ratios[i] >= 1 && ratios[j] < 1 && j === n - 1) {
                sum += ratios[j];
                count++;
                j++;
                break;
            }
            const cand = hOf(count + 1, sum + ratios[j]);
            if (count >= minForRow && cand <= H) break; // 再加一张会低于参考值
            if (count >= maxPhotos) break; // 超窄屏每行最多 2 张
            sum += ratios[j];
            count++;
            j++;
        }

        let ragged = false;
        if (j === n) {
            // 行计划最后一行（作品耗尽）：按统一行高左对齐、不吸收余量；
            // 只有全局最后一行是 ragged，其余行都恰好铺满
            ragged = true;
        } else if (refine && count < maxPhotos) {
            // 行边界微调：比较「停在此处 / 纳入下一张」，取行高最接近 H 者。
            // 注意：不交换作品顺序（JS 数组换序会与 DOM 顺序脱节，导致行划分错位）
            const hCur = hOf(count, sum);
            const hNext = hOf(count + 1, sum + ratios[j]);
            if (Math.abs(hNext - H) < Math.abs(hCur - H)) {
                sum += ratios[j];
                count++;
            }
        }

        // 行高由 planRowHeight 按当前宽度计算，计划行不保存会过期的高度
        rows.push({ start: i, count, ragged, sum });
        i += count;
    }
    return rows;
}

/* 应用行布局：每张盒子严格按自身比例（自然行高下恰好铺满，无裁切）
   非末张四舍五入、末张吸收取整误差并向下取整——防换行不依赖逐项 floor，
   末张 floor(remaining − border2) 已使行宽总和精确 ≤ W；
   ragged 行（真正的最后一行）不吸收余量，按自然宽度排列、右侧留白 */
function applyRows(items, rows, ratios, W, gap, border2) {
    rows.forEach((row) => {
        let remaining = W;
        for (let k = 0; k < row.count; k++) {
            const idx = row.start + k;
            const item = items[idx];
            if (!item) continue;
            // 缓存 img 引用（resize 逐帧调用时避免每项子树查询）
            const img = item._img || (item._img = item.querySelector('img.photo-img'));
            if (!img) continue;
            if (item.style.marginRight) item.style.marginRight = ''; // 清除任何残留的 inline margin（防止历史版本遗留导致行超宽换行）
            const cellW = ratios[idx] * row.h + border2;
            let imgW;
            if (!row.ragged && k === row.count - 1) {
                imgW = Math.max(1, Math.floor(remaining - border2)); // 末张吸收余量，整行恰好铺满
            } else {
                // 非末张取 round：误差 ±0.5px 正负分布（原 floor 单向为负、末张
                // 系统性吸收 ~n/2 px 正偏差、总是宽于理想）；防换行不依赖逐项
                // floor——末张 floor(remaining − border2) 已使行宽总和精确 ≤ W
                // （2026-10-19）
                imgW = Math.round(cellW - border2);
                // 按「实际渲染宽度」扣减，避免误差累积导致行宽超过容器而换行留白
                remaining -= (imgW + border2) + gap;
            }
            img.style.width = imgW + 'px';
            img.style.height = Math.round(row.h) + 'px';
        }
    });
}

/* 容器可用宽度：向下取整并留 2px 安全余量
   （吸收滚动条出现、小数边框等造成的实际行宽波动，杜绝行末作品被挤到下一行） */
function getGridWidth(grid) {
    return Math.max(1, Math.floor(grid.getBoundingClientRect().width) - 2);
}

/* 卡片左右边框总宽（行宽计算需扣除，防止换行） */
function getCardBorder(grid) {
    if (grid._cardBorder) return grid._cardBorder;
    const card = grid.querySelector('.photo-card');
    if (!card) return 2;
    const style = getComputedStyle(card);
    const b = parseFloat(style.borderLeftWidth) || 0;
    grid._cardBorder = b * 2;
    return grid._cardBorder;
}

/* 卡片上下边框总高：绝对定位行的 top/整页高度必须包含它，
   否则每行少算 2px、行距随行号累积偏移（2026-10-31） */
function getCardBorderV(grid) {
    if (grid._cardBorderV) return grid._cardBorderV;
    const card = grid.querySelector('.photo-card');
    if (!card) return 0;
    const style = getComputedStyle(card);
    const top = parseFloat(style.borderTopWidth) || 0;
    const bottom = parseFloat(style.borderBottomWidth) || 0;
    grid._cardBorderV = top + bottom;
    return grid._cardBorderV;
}

/* ===== 视口锚点：宽度变化/重排后保持视口内内容位置稳定 ===== */

/* 记录当前视口内最上方已渲染作品及其视口偏移；无可见行时返回 null */
function captureAnchor(grid) {
    const items = grid._shownItems;
    if (!items || items.length === 0) return null;
    const vh = window.innerHeight || document.documentElement.clientHeight;
    let best = null;
    for (const item of items) {
        if (!item.isConnected) continue;
        const r = item.getBoundingClientRect();
        if (r.bottom <= 0 || r.top >= vh) continue;
        if (!best || r.top < best.top) best = { item, top: r.top };
    }
    return best;
}

/* 按新行计划把锚点作品放回原视口偏移（不依赖 FLIP——虚拟化行是绝对定位，
   直接滚动补偿即可，跨档重排不会出现内容跳动） */
function restoreAnchor(grid, anchor) {
    if (!anchor || !anchor.item || !grid._planItems.includes(anchor.item)) return;
    // 网格顶部仍在视口内时不补偿：保留页头/筛选栏位置，避免 resize 后把页头滚出屏幕
    // （只有用户已滚进网格、视口内内容可能被上移时才做锚点回放）
    if (grid.getBoundingClientRect().top >= 0) return;
    const idx = grid._planItems.indexOf(anchor.item);
    const rowIdx = rowIndexForItem(grid, idx);
    if (rowIdx < 0) return;
    const gridTop = grid.getBoundingClientRect().top + window.scrollY;
    const target = gridTop + grid._rowLayout[rowIdx].top - anchor.top;
    if (Math.abs(target - window.scrollY) >= 1) {
        window.scrollTo({ top: Math.max(0, target), behavior: 'auto' });
    }
}

function rowIndexForItem(grid, idx) {
    const plan = grid._plan || [];
    for (let i = 0; i < plan.length; i++) {
        const row = plan[i];
        if (idx >= row.start && idx < row.start + row.count) return i;
    }
    return -1;
}

/* ===== resize：逐帧重排（rAF 节流），布局实时跟随窗口宽度 ===== */
export function initMasonryResize() {
    if (!resizeBound) {
        resizeBound = true;
        const getGrid = () => document.getElementById('masonry-grid');
        // 延迟重判定时器（debounce：新 resize 到来时重置——连续缩放/地址栏伸缩
        // 不再堆积数十个定时器；每个只触发一次幂等的重排）
        let delayTimers = [];
        window.addEventListener('resize', () => {
            const grid = getGrid();
            if (!grid || !grid._plan) return;
            scheduleRelayout(grid);
            // 旋转完成后 iPad Safari 不再派发 resize/change 事件——延迟重判补上
            // 查询稳定后的最终档位（幂等：无变化时只做一次廉价的档位比较）
            delayTimers.forEach(clearTimeout);
            delayTimers = [300, 800].map((ms) => setTimeout(() => {
                const g = getGrid();
                if (g && g._plan) scheduleRelayout(g);
            }, ms));
        });
        // 边界媒体查询 change 驱动档位重判：旋转过渡期间的中间态 resize 会落错档
        // （如 4→3 而不到 2、刷新才恢复）——查询最终稳定后的 change 事件补上
        // 最终判定（iPad Safari 旋转后 resize 不再触发、媒体查询照常重估；
        // change 监听器幂等，与 resize 路径的重排互不冲突）
        const boundaries = [];
        TIER_ENTER.forEach((v) => boundaries.push(v + 1));
        TIER_EXIT.forEach((v) => boundaries.push(v + 1));
        boundaries.forEach((minPx) => {
            const mq = window.matchMedia(`(min-width: ${minPx}px)`);
            if (mq.addEventListener) {
                mq.addEventListener('change', () => {
                    const grid = getGrid();
                    if (!grid || !grid._plan) return;
                    scheduleRelayout(grid);
                });
            }
        });
    }

    // 滚动窗口更新：rAF 节流；SPA 换页后读取当前文档中的网格（旧网格已脱离文档）
    if (!windowBound) {
        windowBound = true;
        window.addEventListener('scroll', () => {
            if (windowRaf) return;
            windowRaf = requestAnimationFrame(() => {
                windowRaf = 0;
                const grid = document.getElementById('masonry-grid');
                if (grid && grid.isConnected) updateRowsOnScroll(grid);
            });
        }, { passive: true });
    }
}

/* rAF 节流：每帧最多重排一次 */
function scheduleRelayout(grid) {
    if (grid._rafPending) return;
    grid._rafPending = true;
    requestAnimationFrame(() => {
        grid._rafPending = false;
        relayout(grid);
    });
}

/* 宽度变化：同档位只按新宽度重算行高与行容器 top（行成员冻结）；
   跨档位重新规划整组行（不做 FLIP），按视口锚点补偿滚动位置 */
function relayout(grid) {
    if (!grid || !grid._plan || !grid._rowLayout) return;
    if (grid._restartPromise) return; // 筛选重启在即：按新集合统一重排，避免在旧集合上白算

    const W = getGridWidth(grid);
    const modeChanged = updateTier(grid);
    // 宽度与档位均未变（延迟重判/边界监听触发的大量幂等重排）：跳过全量
    // 样式写回——只在真正变化时重算
    if (!modeChanged && grid._lastW === W) return;

    if (modeChanged) {
        rebuildForPlanChange(grid);
        return;
    }

    const anchor = captureAnchor(grid);
    computeRowLayout(grid, grid._plan);
    setGridHeight(grid);
    applyRenderedRows(grid);
    restoreAnchor(grid, anchor);
    updateRowsOnScroll(grid);
}

/* 已渲染行按当前宽度缩放：行不变，只更新 top 与行内图片尺寸 */
function applyRenderedRows(grid) {
    grid._renderedRows.forEach((rowEl, rowIndex) => {
        const row = grid._plan[rowIndex];
        const layout = grid._rowLayout[rowIndex];
        if (!row || !layout) return;
        rowEl.style.top = layout.top + 'px';
        const items = Array.from(rowEl.children).filter((el) => el.classList.contains('masonry-item'));
        const ratios = items.map((item) => grid._ratios.get(item) || DEFAULT_RATIO);
        applyRows(items, [{ start: 0, count: row.count, h: layout.h, ragged: row.ragged }], ratios,
            grid._lastW, grid._gap, grid._border2);
    });
}

/* 行计划整体重建（跨档位 / 比例校正）：拆行回到隐藏池、重新规划、按当前视口窗口渲染。
   已渲染过的卡片保留已加载的 src 与 is-revealed（重排后不闪、不重播淡入） */
function rebuildForPlanChange(grid) {
    if (grid._restartPromise) return; // 筛选重启会按更新后的比例重建，无需插队
    const anchor = captureAnchor(grid);
    grid._gridGen = (grid._gridGen || 0) + 1; // 作废旧批次的淡入计时器
    clearRenderQueue(grid);
    flattenRows(grid);
    grid.querySelectorAll('.masonry-item').forEach((item) => item.classList.add('is-hidden'));
    grid._renderedRows.clear();
    grid._shownItems = [];
    grid._shownSet = new Set();
    grid._plan = buildPlan(grid);
    setGridHeight(grid);
    restoreAnchor(grid, anchor);
    // 重建后按视口补行（instant：不能让已看过的照片再淡一次），再交回滚动补载
    renderVisibleRows(grid, true);
    updateRowsOnScroll(grid);
}

/* ===== 筛选模式（全部作品页 / 列表页筛选） ===== */

/* 将行容器拍平：所有作品（含隐藏的）回到网格直属子级——
   后续重建只重排当前集合，隐藏项必须留在 DOM 里供再次筛选/重置。
   【顺序关键】行内作品必须插到第一个游离项之前（appendChild 到末尾会把
   行内作品挪到游离项之后，破坏时间顺序——筛选切换后作品乱序的根因） */
function flattenRows(grid) {
    const firstStray = grid.querySelector(':scope > .masonry-item');
    grid.querySelectorAll('.masonry-row').forEach((row) => {
        while (row.firstChild) {
            if (firstStray) grid.insertBefore(row.firstChild, firstStray);
            else grid.appendChild(row.firstChild);
        }
        row.remove();
    });
}

/* 取消尚未执行的筛选重启：清定时器并收尾（清 grid._restartPromise、释放等待者）。
   SPA 换页 / 连点筛选时旧重启不再执行；等待者会改等新一次重启 */
function cancelPendingRestart() {
    if (restartFadeTimer) {
        clearTimeout(restartFadeTimer);
        restartFadeTimer = null;
    }
    if (restartFadeFinish) {
        const finish = restartFadeFinish;
        restartFadeFinish = null;
        finish();
    }
}

/* 筛选切换 / 清空筛选：按给定作品集合重建行计划与整页高度。
   入口立即递增 gen，120ms 窗口内的旧滚动/深链不会按旧集合渲染；
   grid._restartPromise 供 ?p= 深链等待筛选结果稳定。
   重启前旧集合整体快速淡出（0.12s）：与新窗口内容衔接、替代瞬间消失；
   连点筛选时旧定时器作废（网格保持淡出态直至最后一次切换执行） */
export function restartMasonryGrid(grid, items) {
    if (!grid || !grid._planItems) return;

    cancelPendingRestart(); // 连点筛选：旧重启作废，旧等待者释放后改等新 promise
    clearRenderQueue(grid); // 旧集合的逐行队列立即停止，等新计划重新入队
    grid._gridGen = (grid._gridGen || 0) + 1; // 入口即作废 120ms 窗口内的旧批次

    let resolveDone;
    const done = new Promise((resolve) => { resolveDone = resolve; });
    const finish = () => {
        if (grid._restartPromise === done) grid._restartPromise = null;
        if (restartFadeFinish === finish) restartFadeFinish = null;
        resolveDone();
    };
    grid._restartPromise = done;
    restartFadeFinish = finish;

    const run = () => {
        restartFadeTimer = null;
        restartFadeFinish = null;
        grid.style.transition = '';
        grid.style.opacity = '';
        if (!grid.isConnected) { finish(); return; } // SPA 已换页：不再操作旧网格
        restartGrid(grid, items);
        finish();
    };
    grid.style.transition = 'opacity 0.12s ease';
    grid.style.opacity = '0.4';
    restartFadeTimer = setTimeout(run, 120);
}

function restartGrid(grid, items) {
    grid._gridGen = (grid._gridGen || 0) + 1; // 作废在途的旧批次淡入
    clearRenderQueue(grid);
    flattenRows(grid);
    const allItems = Array.from(grid.querySelectorAll('.masonry-item'));
    allItems.forEach((item) => {
        item.classList.add('is-hidden');
        item.classList.remove('is-revealed');
    });

    grid._shownItems = [];
    grid._shownSet = new Set();
    grid._renderedRows.clear();
    grid._planItems = items;
    grid._windowPaused = false;
    grid._plan = buildPlan(grid);
    setGridHeight(grid);

    // 筛选结果更短时滚出网格底部：回退到能看到网格末尾的位置
    const gridBottom = grid.getBoundingClientRect().top + window.scrollY + grid._planHeight;
    if (gridBottom < window.scrollY) {
        window.scrollTo({ top: Math.max(0, gridBottom - window.innerHeight + 160), behavior: 'auto' });
    }
    revealInitialRows(grid);
    updateRowsOnScroll(grid);
}

/* 深层 ?p= 恢复：把目标作品所在行直接渲染进 DOM（instant），
   由调用方滚入视口后打开灯箱。目标不在当前筛选集合时静默返回。
   同步渲染 + 等待筛选重启稳定，无需再按行逐步揭示 */
export async function revealUpToItem(grid, item) {
    if (!grid || !item || !grid._planItems) return;
    for (let attempt = 0; attempt < 3; attempt++) {
        while (grid._restartPromise) {
            await grid._restartPromise;
            if (grid !== document.getElementById('masonry-grid')) return;
        }
        if (grid !== document.getElementById('masonry-grid')) return;
        if (!grid._planItems.includes(item)) return;
        const idx = grid._planItems.indexOf(item);
        const rowIdx = rowIndexForItem(grid, idx);
        if (rowIdx < 0) return;
        renderRow(grid, rowIdx, true);
        return;
    }
}
