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
 * - 按行揭示：初始化时按 width/height 预计算整组行计划，首屏填满视口，
 *   之后每次滚动只揭示下一行——行内张数随宽度/宽高比变化（2–6 张），不固定张数
 * - 逐张淡入（60ms/张），图片未到时由 LQIP 模糊底图占位
 * - resize：先按比例缩放作品（行成员冻结，不做排布调整），仅跨窄屏断点（带滞回）才重新分行——
 *   拖拽变宽/变窄时布局稳定，不会来回跳跃；跨档位重排时把待显示区前几张
 *   补进已显示边界行（否则右端会永久留缺口），旧照片走 FLIP、新补入的淡入
 */

import { prefersReducedMotion, FLIP_TRANSITION, markImageLoaded } from './utils.js';

const DEFAULT_RATIO = 1.5; // 图片宽高比读取失败时的兜底值（3:2）
const REVEAL_STAGGER = 60; // 逐张揭示间隔 ms
const DEFAULT_INITIAL_FILL_EXTRA = 200; // 首屏在可见区域之外多留的高度（px），config 缺省值
const DEFAULT_INITIAL_FILL_MAX_ITEMS = 24; // 首屏单批最多揭示张数，config 缺省值
const DEEP_LINK_ROWS_PER_CHUNK = 4; // ?p= 深链每次揭示行数，批间让出主线程

let resizeBound = false;
let gridObserver = null; // 每页只有一个网格；SPA 换页时断开旧观察，避免持有已脱离文档的整棵网格子树
let restartFadeTimer = null;
let restartFadeFinish = null; // 未执行筛选重启的收尾句柄（清 promise + 释放等待者）

export function initMasonry(skipInitialReveal = false) {
    // SPA 换页：上一页尚未执行的筛选重启作废（避免旧网格继续赋 src/启动监听）
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

    const allItems = Array.from(grid.querySelectorAll('.masonry-item'));
    if (allItems.length === 0) return;

    // 全部先隐藏（不依赖 baseof 的内联脚本——SPA 跳转时内联脚本不会执行，
    // 否则未揭示的作品会以原始尺寸占据版面，造成大片空白、已排好的行被顶到底部）
    allItems.forEach((item) => item.classList.add('is-hidden'));

    // 增量加载由网格上的 data-infinite-scroll 显式标记（唯一写入点
    // components/masonry-grid.html）：它同时决定首屏填充粒度与是否逐行揭示
    // （二者同属增量加载策略）；系列详情页不加，一次性揭示全部行
    grid._hasInfinite = grid.hasAttribute('data-infinite-scroll');

    grid._planItems = allItems; // 行计划覆盖的作品集合（筛选重启时替换为筛选结果）
    grid._pendingItems = [...allItems]; // 尚未揭示的作品（既有模块读取此队列）
    grid._shownItems = [];
    grid._ratios = new Map(allItems.map((item) => [item, ratioOf(grid, item)]));
    grid._cardBorder = 0;
    // 行基准档位（0=超窄屏 ≤500、1=窄屏 501-768 与汉堡断点一致、2=中屏 769-1000、3=宽屏 >1000）；
    // 带滞回，防止断点附近来回切换；按当前宽度初始化
    grid._tier = null;
    updateTier(grid);
    grid._gridGen = 0; // 网格状态代次：筛选重启递增、作废在途揭示的布局与淡入计时器（见 revealPlanRows）
    grid._revealedRows = 0; // 已揭示的计划行数（已揭示集合恒为 _planItems 的前缀）
    grid._plan = buildPlan(grid); // 整组行计划（按当前宽度/档位一次算好；已显示行即其前缀）

    grid.classList.remove('is-fallback'); // 看门狗兜底后 bundle 迟到的自愈路径：恢复正常行布局
    grid.classList.add('masonry-ready');

    // 观察网格自身尺寸变化（滚动条出现/消失等），自动重排行布局
    if (typeof ResizeObserver !== 'undefined') {
        gridObserver = new ResizeObserver(() => scheduleRelayout(grid));
        gridObserver.observe(grid);
    }

    // 带筛选参数的 URL 刷新时跳过首屏揭示，交由筛选恢复流程统一揭示——
    // 否则首屏作品会先闪现、再被筛选重启隐藏，出现「显示→消失→再显示」的跳变
    if (!skipInitialReveal) {
        revealInitialRows(grid);
    }
}

/* ===== 行计划与揭示 ===== */

/* 每张作品的宽高比：优先取 photo.toml 回填的 width/height 属性（构建期写入，
   管线保证恒有）——整组行计划在初始化时一次算好，不再等待图片测量。
   属性缺失（数据地雷）不阻塞揭示：按 3:2 兜底并挂一次 load 校正——图片
   就绪后以自然宽高重算比例并重建已显示行，不会整会话按 3:2 裁切竖构图
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
   行成员冻结重排依赖计划行的 sum，比例变化必须重算整组计划才能生效 */
function watchRatioOnLoad(grid, item, img) {
    if (img._ratioWatched) return;
    img._ratioWatched = true;
    img.addEventListener('load', () => {
        if (!grid.isConnected || !grid._ratios) return;
        const ratio = naturalRatio(img);
        const old = grid._ratios.get(item);
        if (!ratio || (old && Math.abs(old - ratio) < 0.001)) return;
        grid._ratios.set(item, ratio);
        rebuildPlanShown(grid, false);
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
    grid._lastW = W;
    return plan;
}

/* 行在给定宽度下的高度：普通行恰好铺满；真正的最后一行封顶 H、左对齐 */
function planRowHeight(row, W, gap, border2, H) {
    let h = rowHeight(W, row.count, row.sum, gap, border2);
    if (row.ragged) h = Math.min(h, H);
    return h;
}

/* 行容器渲染唯一实现：按计划行建 .masonry-row、放入 items、applyRows 定尺寸。
   revealPlanRowsNow 与 rebuildPlanShown 共用；replace=true 时先移除旧行容器。 */
function renderRows(grid, items, rows, W, gap, border2, H, replace = false) {
    if (replace) grid.querySelectorAll('.masonry-row').forEach((el) => el.remove());
    const localRows = [];
    let localStart = 0;
    rows.forEach((row) => {
        const h = planRowHeight(row, W, gap, border2, H);
        localRows.push({ start: localStart, count: row.count, h, ragged: row.ragged });
        const rowEl = document.createElement('div');
        rowEl.className = 'masonry-row';
        for (let k = 0; k < row.count; k++) rowEl.appendChild(items[localStart + k]);
        appendRowEl(grid, rowEl);
        localStart += row.count;
    });
    const ratios = items.map((item) => grid._ratios.get(item) || DEFAULT_RATIO);
    applyRows(items, localRows, ratios, W, gap, border2);
}

/* 读取网格上的整数加载策略配置（[params.grid] 经模板写入 data 属性）：
   缺失/非法时用 JS 缺省值 */
function gridNumber(grid, key, fallback) {
    const value = parseInt(grid.dataset[key], 10);
    return Number.isFinite(value) ? value : fallback;
}

/* 首屏揭示行数：按累计行高填到「当前可见区域 + initialFillExtra」（默认 200px）——
   行内张数随宽度变化，不依赖照片总数；无 data-infinite-scroll 的页面由
   revealInitialRows 一次揭示全部行。可见区域从网格顶部算起（页头/筛选栏
   占掉的高度不计），避免首屏一次加载过多图片 */
function initialRowCount(grid) {
    const W = getGridWidth(grid);
    const gap = getRowGap(grid);
    const border2 = getCardBorder(grid);
    const H = getTargetRowHeight(W, gap, border2, grid._tier);
    const visible = Math.max(240, (window.innerHeight || 800) - Math.max(0, grid.getBoundingClientRect().top));
    // 加载策略由 hugo.toml [params.grid] 经模板 data 属性注入，JS 常量仅作缺省回退
    const target = visible + gridNumber(grid, 'initialFillExtra', DEFAULT_INITIAL_FILL_EXTRA);
    const maxItems = gridNumber(grid, 'initialFillMaxItems', DEFAULT_INITIAL_FILL_MAX_ITEMS);
    let acc = 0;
    let n = 0;
    let itemCount = 0;
    while (n < grid._plan.length && acc < target) {
        const row = grid._plan[n];
        // 上限只约束首屏单批；至少保留一行。超出部分由无限滚动接着逐行补齐
        if (n > 0 && itemCount + row.count > maxItems) break;
        acc += planRowHeight(row, W, gap, border2, H) + gap;
        itemCount += row.count;
        n++;
    }
    return Math.max(1, n);
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

/* 布局任务串行化：筛选恢复 / ?p= 恢复 / 无限滚动可能并发入队，
   交错执行会互相污染行容器与 _shownItems 快照——
   链到上一任务完成后再执行；gen 在入队瞬间捕获，筛选重启后旧任务直接放弃 */
function queueLayout(grid, gen, fn) {
    const run = () => {
        if ((grid._gridGen || 0) !== gen) return Promise.resolve();
        return fn();
    };
    const chained = (grid._layoutChain || Promise.resolve()).then(run);
    grid._layoutChain = chained.catch(() => {});
    return chained;
}

/* 揭示接下来的 rowCount 行：整行解除隐藏、赋 src、建行容器、逐张淡入。
   已揭示集合恒为 _planItems 的前缀，故计划行的 start 可直接用于 _shownItems。
   instant（?p= 恢复）：跳过淡入直接显示。 */
async function revealPlanRowsNow(grid, rowCount, instant, gen) {
    if ((grid._gridGen || 0) !== gen) return;
    const startRow = grid._revealedRows;
    const rows = grid._plan.slice(startRow, startRow + rowCount);
    if (!rows.length) return;

    const items = [];
    rows.forEach((row) => {
        for (let k = 0; k < row.count; k++) items.push(grid._planItems[row.start + k]);
    });
    grid._pendingItems.splice(0, items.length);
    grid._shownItems.push(...items);
    grid._revealedRows += rows.length;
    items.forEach(prepareItemImage);

    const W = getGridWidth(grid);
    const gap = getRowGap(grid);
    const border2 = getCardBorder(grid);
    const H = getTargetRowHeight(W, gap, border2, grid._tier);
    renderRows(grid, items, rows, W, gap, border2, H);

    if (instant || prefersReducedMotion()) {
        // 减弱动态：逐张错峰同款直切（60ms/张的 setTimeout 不受 CSS 兜底影响）
        items.forEach((item) => item.classList.add('is-revealed'));
        return;
    }
    await new Promise((resolve) => {
        let settled = false;
        const finish = () => {
            if (settled) return;
            settled = true;
            if (grid._revealAbort === finish) grid._revealAbort = null;
            resolve();
        };
        // 筛选重启会调用 grid._revealAbort：旧批次不再让布局链等满逐张计时器；
        // 计时器本身仍按 gen 作废，不会给新集合提前加 is-revealed
        grid._revealAbort = finish;
        items.forEach((item, i) => {
            setTimeout(() => {
                if ((grid._gridGen || 0) !== gen) return; // 筛选重启后旧行的淡入计时器作废（防提前揭示新队列作品）
                requestAnimationFrame(() => {
                    requestAnimationFrame(() => item.classList.add('is-revealed'));
                });
            }, i * REVEAL_STAGGER);
        });
        setTimeout(finish, items.length * REVEAL_STAGGER + 50);
    });
}

/* 揭示接下来的 rowCount 行（公开入口：无限滚动 / 筛选 / 深链共用） */
export function revealPlanRows(grid, rowCount, instant = false) {
    if (!grid || !grid._plan) return Promise.resolve();
    const gen = grid._gridGen || 0;
    return queueLayout(grid, gen, () => revealPlanRowsNow(grid, rowCount, instant, gen));
}

/* 首屏揭示：需要无限滚动的网格填满视口 + 预备高度，否则（系列详情页等）一次揭示全部行 */
function revealInitialRows(grid) {
    const n = grid._hasInfinite ? initialRowCount(grid) : grid._plan.length;
    if (n > 0) revealPlanRows(grid, n);
}

/* 深层 ?p= 恢复：揭示行直到目标作品所在行进入已显示集合（instant）。
   目标可能在被筛选隐藏的集合里（不在行计划中），此时直接返回（调用方静默放弃）。
   执行时等待当前筛选重启稳定；连续重启导致 gen 变化时重试（最多 3 次），
   不在旧集合上继续揭示 */
export async function revealUpToItem(grid, item) {
    if (!grid || !item || !grid._planItems) return;
    for (let attempt = 0; attempt < 3; attempt++) {
        // 等筛选重启稳定；等待期间若又开始新重启，循环继续等最新的 promise
        while (grid._restartPromise) {
            await grid._restartPromise;
            if (grid !== document.getElementById('masonry-grid')) return;
        }
        if (grid !== document.getElementById('masonry-grid')) return;
        if (!grid._planItems.includes(item)) return; // 已被筛选隐藏

        const gen = grid._gridGen || 0;
        let settled = false;
        await queueLayout(grid, gen, async () => {
            if ((grid._gridGen || 0) !== gen) return;
            const idx = grid._planItems.indexOf(item);
            if (idx < 0) { settled = true; return; } // 已筛掉：不再重试
            let rowIdx = -1;
            for (let i = 0; i < grid._plan.length; i++) {
                const row = grid._plan[i];
                if (idx >= row.start && idx < row.start + row.count) { rowIdx = i; break; }
            }
            if (rowIdx < 0) { settled = true; return; }
            let need = rowIdx + 1 - grid._revealedRows;
            // 分批揭开到目标行：批间 setTimeout(0) 让出主线程，避免远处深链
            // 在一个同步任务里建完所有中间行、同时排出全部图片请求
            while (need > 0) {
                if ((grid._gridGen || 0) !== gen) { settled = false; return; }
                const take = Math.min(need, DEEP_LINK_ROWS_PER_CHUNK);
                await revealPlanRowsNow(grid, take, true, gen);
                need -= take;
                if (need > 0) await new Promise((resolve) => setTimeout(resolve, 0));
            }
            // 揭示期间若被新一次筛选重启打断，则回到循环等待新集合
            settled = (grid._gridGen || 0) === gen;
        });
        if (settled) return;
    }
}

/* 行内水平间距（缓存）：优先读行容器 columnGap；行容器尚未创建（首批）时读网格自身 rowGap——
   两者由同一条 CSS gap 声明驱动，避免行容器出现前回退到错误默认值导致首屏行宽计算偏差 */
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

/* 追加行容器：插入在未揭示作品（网格的直接子级）之前，保持 DOM 顺序 = 展示顺序 */
function appendRowEl(grid, rowEl) {
    const firstStray = grid.querySelector(':scope > .masonry-item');
    if (firstStray) {
        grid.insertBefore(rowEl, firstStray);
    } else {
        grid.appendChild(rowEl);
    }
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
            // 只有全局最后一行是 ragged，其余行都恰好铺满（跨档位边界行由
            // rebuildPlanShown 补齐，不存在“未完成尾行等下一批”的合并逻辑）
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

        // 行高由 planRowHeight 按当前宽度计算，计划行不再保存会过期的 h
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

/* ===== 跨档位重排行的 FLIP 动画 ===== */
/* 时长/缓动见 utils.js 的 FLIP_TRANSITION；档位内的冻结缩放保持实时无动画 */

/* 清除上一次未完成的 FLIP 残留（内联 transform/transition）——
   残留会使 First 测量包含旧位移，导致新一轮动画起点错位 */
function clearFlipTransforms(grid) {
    grid._shownItems.forEach((item) => {
        if (item.style.transform) item.style.transform = '';
        if (item.style.transition) item.style.transition = '';
    });
}

/* FLIP 收尾：transform 过渡结束后清除内联 transition（transform 已在 Play 时清空）；
   监听器挂网格上一次（transitionend 冒泡，目标必为作品项自身） */
function bindFlipCleanup(grid) {
    if (grid._flipCleanupBound) return;
    grid._flipCleanupBound = true;
    grid.addEventListener('transitionend', (e) => {
        if (e.propertyName !== 'transform') return;
        if (e.target.classList && e.target.classList.contains('masonry-item')) {
            e.target.style.transition = '';
        }
    });
}

/* 对重建后的行执行 FLIP：First 旧位置 → 重建（Last）→ Invert 回旧位 → Play 过渡到新位。
   firstRectMap 只含重建前已显示的照片；跨档位补齐边界行时新补入的照片没有旧位置，
   Invert/Play 跳过它们（由调用方淡入）。 */
function flipRebuild(grid, firstRectMap) {
    const shown = grid._shownItems;
    const lastRects = new Map(shown.map((item) => [item, item.getBoundingClientRect()]));

    // Invert：回移到旧位置（无过渡）
    shown.forEach((item) => {
        const f = firstRectMap.get(item);
        if (!f) return; // 边界行新补入的照片：无旧位置，稍后淡入
        const l = lastRects.get(item);
        const dx = f.left - l.left;
        const dy = f.top - l.top;
        const sx = f.width / l.width;
        const sy = f.height / l.height;
        if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5 &&
            Math.abs(sx - 1) < 0.001 && Math.abs(sy - 1) < 0.001) return;
        item.style.transition = 'none';
        item.style.transformOrigin = 'top left';
        item.style.transform = `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`;
    });

    // 强制重排：单次布局读取即触发整文档 flush（布局是文档级、逐项读取
    // 不产生额外 reflow——其余读取只是干净布局上的廉价访问），确保 Invert
    // 立即生效后再启动过渡；调用方已保证 shown 非空
    void shown[0].offsetHeight;

    // Play：过渡到新位置
    shown.forEach((item) => {
        if (!item.style.transform) return;
        item.style.transition = FLIP_TRANSITION;
        item.style.transform = '';
    });

    bindFlipCleanup(grid);
}

/* ===== resize：逐帧重排（rAF 节流），布局实时跟随窗口宽度 ===== */
export function initMasonryResize() {
    if (resizeBound) return;
    resizeBound = true;
    const getGrid = () => document.getElementById('masonry-grid');
    // 延迟重判定时器（debounce：新 resize 到来时重置——连续缩放/地址栏伸缩
    // 不再堆积数十个定时器；每个只触发一次幂等的重排）
    let delayTimers = [];
    window.addEventListener('resize', () => {
        const grid = getGrid();
        if (!grid || !grid._shownItems || grid._shownItems.length === 0) return;
        scheduleRelayout(grid);
        // 旋转完成后 iPad Safari 不再派发 resize/change 事件——延迟重判补上
        // 查询稳定后的最终档位（幂等：无变化时只做一次廉价的档位比较）
        delayTimers.forEach(clearTimeout);
        delayTimers = [300, 800].map((ms) => setTimeout(() => {
            const g = getGrid();
            if (g && g._shownItems && g._shownItems.length > 0) scheduleRelayout(g);
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
                if (!grid || !grid._shownItems || grid._shownItems.length === 0) return;
                scheduleRelayout(grid);
            });
        }
    });
}

/* rAF 节流：每帧最多重排一次。
   冻结行成员的重排只做等比缩放，开销极小，可逐帧执行——
   布局实时跟随窗口宽度，不会因滞后导致行宽超过容器而换行错位 */
function scheduleRelayout(grid) {
    if (grid._rafPending) return;
    grid._rafPending = true;
    requestAnimationFrame(() => {
        grid._rafPending = false;
        relayoutShown(grid);
    });
}

function relayoutShown(grid) {
    const shown = grid._shownItems;
    if (!shown || shown.length === 0 || !grid._plan || grid._revealedRows === 0) return; // 首次揭示完成前不重排

    const W = getGridWidth(grid);
    const gap = getRowGap(grid);
    const border2 = getCardBorder(grid);
    const modeChanged = updateTier(grid);
    // 宽度与档位均未变（延迟重判/边界监听触发的大量幂等重排）：跳过全量
    // 样式写回——只在真正变化时重算
    if (!modeChanged && grid._lastW === W) return;
    grid._lastW = W;
    const H = getTargetRowHeight(W, gap, border2, grid._tier);

    if (modeChanged) {
        // 跨档位断点：按新档位重新规划整组行，并用计划行重建已显示区域；
        // 边界行里尚未显示的照片一并补入（否则右端永久缺口），旧照片 FLIP 平滑移动
        rebuildPlanShown(grid, true);
        return;
    }

    // 先按比例缩放作品（行成员冻结不动），不做排布调整——彻底消除拖拽时的来回跳跃；
    // 已显示行直接取计划前缀，行高由 planRowHeight 按当前宽度算
    const allRatios = shown.map((item) => grid._ratios.get(item) || DEFAULT_RATIO);
    const rows = grid._plan.slice(0, grid._revealedRows).map((row) => ({
        start: row.start,
        count: row.count,
        h: planRowHeight(row, W, gap, border2, H),
        ragged: row.ragged
    }));
    applyRows(shown, rows, allRatios, W, gap, border2);
}

/* 跨档位重建：按新宽度重新规划整组行计划，用计划行重建已显示区域。
   已显示集合可能在某行中间结束——把该行剩余作品一并提升为已显示，
   保持每行铺满（否则右端会永久留缺口）。旧照片走 FLIP，新补入的照片淡入。 */
function rebuildPlanShown(grid, flip) {
    const shownBefore = grid._shownItems;
    if (!shownBefore || shownBefore.length === 0) {
        grid._plan = buildPlan(grid);
        grid._revealedRows = 0;
        return;
    }

    // FLIP：重建前记录旧位置（清除上一次动画残留，保证 First 测量干净）
    let firstRects = null;
    if (flip && !prefersReducedMotion()) {
        clearFlipTransforms(grid);
        firstRects = new Map(shownBefore.map((item) => [item, item.getBoundingClientRect()]));
    }
    const oldCount = shownBefore.length;

    // 新宽度/档位下的完整行计划
    grid._plan = buildPlan(grid);
    const plan = grid._plan;

    // 覆盖旧展示边界的计划行：已显示集合恒为 _planItems 前缀，start < oldCount
    // 的行都属于已显示；最后一行若跨过 oldCount，其尾部作品需要一并提升
    const shownRows = [];
    for (const row of plan) {
        if (row.start >= oldCount) break;
        shownRows.push(row);
    }
    if (shownRows.length === 0) return; // 计划覆盖全部作品，不应发生；防御性早退
    const lastShownRow = shownRows[shownRows.length - 1];
    const newCount = lastShownRow.start + lastShownRow.count;

    // 边界行新增的照片：从待揭示队列头部移出并赋 src（旧照片位置已在 First 记录）
    const extra = grid._planItems.slice(oldCount, newCount);
    if (extra.length) {
        grid._pendingItems.splice(0, extra.length);
        grid._shownItems.push(...extra);
        extra.forEach(prepareItemImage);
    }
    const items = grid._planItems.slice(0, newCount);

    const W = getGridWidth(grid);
    const gap = getRowGap(grid);
    const border2 = getCardBorder(grid);
    const H = getTargetRowHeight(W, gap, border2, grid._tier);

    renderRows(grid, items, shownRows, W, gap, border2, H, true);
    grid._revealedRows = shownRows.length;
    grid._lastW = W;

    if (firstRects) flipRebuild(grid, firstRects);

    // 新补入边界行的照片没有旧位置：旧照片 FLIP 的同时，新照片原地淡入
    if (extra.length) {
        if (prefersReducedMotion()) {
            extra.forEach((item) => item.classList.add('is-revealed'));
        } else {
            requestAnimationFrame(() => requestAnimationFrame(() => {
                extra.forEach((item) => item.classList.add('is-revealed'));
            }));
        }
    }
}

/* ===== 筛选模式（全部作品页） ===== */

/* 将行容器拍平：所有作品（含隐藏的）回到网格直属子级——
   后续重建只重排 _shownItems，隐藏项必须留在 DOM 里供再次筛选/重置。
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

/* 筛选切换 / 清空筛选：以「按行揭示」模式重启网格——
   仅展示给定作品集合：全部重新隐藏，集合重新计算行计划；首屏按一屏行数揭示，
   其余交给无限滚动逐行揭示。入口立即递增 gen 并解除旧批次淡入等待，
   120ms 窗口内的滚动/深链不会按旧未筛选集继续揭示；
   grid._restartPromise 供 ?p= 深链等待筛选结果稳定。
   重启前旧集合整体快速淡出（0.12s）：与揭示错峰淡入衔接、替代瞬间消失；
   连点筛选时旧定时器作废（网格保持淡出态直至最后一次切换执行）。
   onRestarted：重启真正执行后回调——调用方借此同步依赖 _pendingItems 的模块
   （如无限滚动初始化）；重启前调用会读到旧队列状态。连点筛选时旧回调随
   旧定时器一并作废，只有最后一次重启会触发 */
export function restartMasonryGrid(grid, items, onRestarted) {
    if (!grid || !grid._shownItems) {
        if (onRestarted) onRestarted();
        return;
    }

    cancelPendingRestart(); // 连点筛选：旧重启作废，旧等待者释放后改等新 promise
    grid._gridGen = (grid._gridGen || 0) + 1; // 入口即作废 120ms 窗口内的旧揭示
    if (grid._revealAbort) grid._revealAbort(); // 旧批次淡入不再占住布局链

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
        if (onRestarted) onRestarted();
        finish();
    };
    grid.style.transition = 'opacity 0.12s ease';
    grid.style.opacity = '0.4';
    restartFadeTimer = setTimeout(run, 120);
}

function restartGrid(grid, items) {

    flattenRows(grid);
    const allItems = Array.from(grid.querySelectorAll('.masonry-item'));
    allItems.forEach((item) => {
        item.classList.add('is-hidden');
        item.classList.remove('is-revealed');
    });

    grid._shownItems = [];
    grid._planItems = items;
    grid._pendingItems = [...items];
    grid._gridGen = (grid._gridGen || 0) + 1; // 作废在途揭示（旧任务捕获的代次不再匹配）
    grid._revealedRows = 0;
    grid._ratios = new Map(allItems.map((item) => [item, ratioOf(grid, item)]));
    grid._plan = buildPlan(grid);

    revealInitialRows(grid);
}
