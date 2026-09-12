/**
 * 照片网格引擎（两端对齐行布局，行高自然变化、行宽恰好铺满）
 *
 * - 行高 = (行宽 − 间距 − 边框) / 宽高比之和，由本行内容自然决定，行高可以变化
 * - 每行恰好铺满容器（右缘对齐），照片间间距全局统一（CSS gap，4px）
 * - 贪心分行以参考值 H（最宽布局每行 4 张 3:2 宽幅照片的基准）为目标，
 *   行高天然落在 H 附近；照片严格保持自身长宽比（object-fit: cover 仅兜底取整误差）
 * - 最后一行不强行对齐：行高封顶 H、左侧对齐、右侧留白
 * - 逐行加载：按 DOM 顺序逐张淡入（60ms/张）
 * - resize：先按比例缩放照片（行成员冻结，不做排布调整），仅跨窄屏断点（带滞回）才重新分行——
 *   拖拽变宽/变窄时布局稳定，不会来回跳跃
 */

const DEFAULT_RATIO = 1.5; // 图片宽高比读取失败时的兜底值（3:2）
const REVEAL_STAGGER = 60; // 逐张揭示间隔 ms

let resizeBound = false;

export function initMasonry() {
    const grid = document.getElementById('masonry-grid');
    if (!grid) return;

    const allItems = Array.from(grid.querySelectorAll('.masonry-item'));
    if (allItems.length === 0) return;

    // 全部先隐藏（不依赖 baseof 的内联脚本——SPA 跳转时内联脚本不会执行，
    // 否则未揭示的照片会以原始尺寸占据版面，造成大片空白、已排好的行被顶到底部）
    allItems.forEach((item) => item.classList.add('is-hidden'));

    const trigger = document.getElementById('load-more-trigger');
    const pageSize = trigger ? (parseInt(trigger.dataset.pageSize, 10) || 12) : 12;

    grid._pendingItems = [...allItems];
    grid._shownItems = [];
    grid._ratios = new Map();
    grid._cardBorder = 0;
    // 行基准档位（0=窄屏 ≤768 与汉堡断点一致、1=中屏 769-1000、2=宽屏 >1000）；
    // 带滞回，防止断点附近来回切换；按当前宽度初始化
    grid._tier = null;
    updateTier(grid);
    grid._rows = null; // 当前行划分（以全部已显示照片为坐标系；resize 时冻结复用，仅按比例缩放）
    grid._incompleteStart = -1; // 未完成尾行的起点（等待下一批照片补齐；-1 表示无）

    grid.classList.add('masonry-ready');

    // 观察网格自身尺寸变化（滚动条出现/消失等），自动重排行布局
    if (typeof ResizeObserver !== 'undefined') {
        new ResizeObserver(() => scheduleRelayout(grid)).observe(grid);
    }

    revealBatch(grid, pageSize);
}

/**
 * 揭示下一批照片：测量宽高比 → 计算行布局 → 逐张淡入
 * 返回 Promise，在全部揭示动画完成后 resolve（供无限滚动等待）
 */
export async function revealBatch(grid, count) {
    const batch = grid._pendingItems.splice(0, Math.min(count, grid._pendingItems.length));
    if (!batch.length) return;

    grid._shownItems.push(...batch);

    // 解除隐藏并显式设置图片 src（不依赖浏览器原生懒加载——
    // SPA 注入的 img 在某些浏览器中懒加载可能失效导致首跳空白；按批控制加载是确定性的）
    batch.forEach((item) => {
        item.classList.remove('is-hidden');
        const img = item.querySelector('img.photo-img');
        if (img && img.dataset.src && !img.src) {
            img.src = img.dataset.src;
            img.removeAttribute('data-src');
        }
    });

    // 等待测量，最多 800ms：
    // 快速路径（缓存命中等）直接用真实比例排布揭示——动画连贯无校正；
    // 慢速路径（如首次跳转 CDN 未缓存）先按兜底比例揭示让照片马上可见，
    // 测量完成后等揭示动画全部结束再做校正，避免动画中途跳变
    const measurePromise = measureRatios(grid, batch);
    const measured = await Promise.race([
        measurePromise.then(() => true),
        new Promise((resolve) => setTimeout(() => resolve(false), 800))
    ]);

    layoutRows(grid, batch);

    await new Promise((resolve) => {
        batch.forEach((item, i) => {
            setTimeout(() => {
                requestAnimationFrame(() => {
                    requestAnimationFrame(() => item.classList.add('is-revealed'));
                });
            }, i * REVEAL_STAGGER);
        });
        setTimeout(resolve, batch.length * REVEAL_STAGGER + 50);
    });

    if (!measured) {
        // 慢速路径校正：等揭示动画结束后用真实尺寸重排（仅尾部行变化）
        measurePromise.then(async () => {
            await new Promise((resolve) => setTimeout(resolve, 400));
            if (!grid._pendingItems || grid._shownItems.length === 0) return;
            rebuildAll(grid, true);
        });
    }
}

/* 测量图片宽高比：直接等待真实 <img> 加载完成，读取 naturalWidth / naturalHeight。
   不再使用独立 Image() 探针——每张图只请求一次 CDN；
   单张超时（4s）按兜底比例处理，保证揭示绝不会因个别图片卡住而空白 */
const MEASURE_TIMEOUT = 4000;

function measureRatios(grid, items) {
    return Promise.all(items.map((item) => {
        const img = item.querySelector('img.photo-img');
        if (!img || !img.src) return Promise.resolve();
        return new Promise((resolve) => {
            let settled = false;
            let timer = null;
            const settle = (ratio) => {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                grid._ratios.set(item, ratio);
                resolve();
            };
            timer = setTimeout(() => settle(DEFAULT_RATIO), MEASURE_TIMEOUT);
            if (img.complete && img.naturalWidth > 0) {
                settle(img.naturalWidth / img.naturalHeight);
                return;
            }
            const done = () => settle(img.naturalWidth / img.naturalHeight || DEFAULT_RATIO);
            img.addEventListener('load', done);
            img.addEventListener('error', done);
        });
    }));
}

/* 揭示新批次时：上一批未完成的尾行与本批照片合并，重新组成完整行——
   尾行照片的最终大小/裁切由补齐后的行内容决定（其余已显示的行保持不动）；
   为每个新行创建显式行容器（引擎行 = 视觉行），行起点换算到全部已显示照片的坐标系保存 */
function layoutRows(grid, batch) {
    const W = getGridWidth(grid);
    const gap = getRowGap(grid);
    const border2 = getCardBorder(grid);
    updateTier(grid);
    const H = getTargetRowHeight(W, gap, border2, grid._tier);

    // 合并上一批的未完成尾行（若有）与本批照片
    let combined = batch;
    let baseStart = grid._shownItems.length - batch.length;
    if (grid._incompleteStart >= 0) {
        const tailItems = grid._shownItems.slice(grid._incompleteStart, baseStart);
        combined = tailItems.concat(batch);
        baseStart = grid._incompleteStart;
        // 移除旧尾行的行容器与行记录，重建
        const rowEls = grid.querySelectorAll('.masonry-row');
        rowEls[rowEls.length - 1].remove();
        grid._rows.pop();
    }

    const combinedRatios = combined.map((item) => grid._ratios.get(item) || DEFAULT_RATIO);
    const rows = partitionRows(combinedRatios, combined, W, H, gap, border2, true, grid._tier === 0 ? 1 : 2);

    // 创建行容器并把照片移入（行容器保证每行是独立 flex 行，绝不与相邻行合并；
    // 行容器插入在未揭示照片之前，保持 DOM 顺序 = 展示顺序）
    rows.forEach((row) => {
        const rowEl = document.createElement('div');
        rowEl.className = 'masonry-row';
        for (let k = 0; k < row.count; k++) {
            rowEl.appendChild(combined[row.start + k]);
        }
        appendRowEl(grid, rowEl);
    });

    const globalRows = rows.map((row) => ({
        start: row.start + baseStart,
        count: row.count,
        h: row.h,
        ragged: row.ragged
    }));
    grid._rows = (grid._rows || []).concat(globalRows);

    // 记录未完成尾行起点（还有后续批次时最后一行等待补齐；全部加载完后保持左对齐留白）
    if (grid._pendingItems.length > 0) {
        grid._incompleteStart = globalRows[globalRows.length - 1].start;
    } else {
        grid._incompleteStart = -1;
    }

    applyRows(combined, rows, combinedRatios, W, gap, border2);
}

/* 行内水平间距：读取行容器的 columnGap */
function getRowGap(grid) {
    const rowEl = grid.querySelector('.masonry-row');
    if (!rowEl) return 4;
    return parseFloat(getComputedStyle(rowEl).columnGap) || 4;
}

/* 追加行容器：插入在未揭示照片（网格的直接子级）之前，保持 DOM 顺序 = 展示顺序 */
function appendRowEl(grid, rowEl) {
    const firstStray = grid.querySelector(':scope > .masonry-item');
    if (firstStray) {
        grid.insertBefore(rowEl, firstStray);
    } else {
        grid.appendChild(rowEl);
    }
}

/* 行基准档位判定（与汉堡图标断点一致）：
   0=窄屏 ≤768px（每行 2 张 3:2 基准）、1=中屏 769-1000px（每行 3 张 3:2 基准）、
   2=宽屏 >1000px（每行 4 张 3:2 基准）
   带滞回（回升时 788/1020 才换档），防止断点附近来回切换导致布局跳跃；返回档位是否变化 */
function updateTier(grid) {
    const sw = window.innerWidth;
    let tier;
    if (grid._tier == null) {
        tier = sw <= 768 ? 0 : (sw <= 1000 ? 1 : 2);
    } else if (grid._tier === 0) {
        tier = sw >= 788 ? (sw <= 1000 ? 1 : 2) : 0;
    } else if (grid._tier === 1) {
        tier = sw <= 768 ? 0 : (sw >= 1020 ? 2 : 1);
    } else {
        tier = sw <= 1000 ? 1 : 2;
    }
    const changed = tier !== grid._tier;
    grid._tier = tier;
    return changed;
}

/* 行高参考值：以「每行 N 张 3:2 宽幅照片（长边 3、宽边 2）」为基准，按实际容器宽度反推
   档位：0=窄屏每行 2 张、1=中屏每行 3 张、2=宽屏每行 4 张（档位判定见 updateTier） */
function getTargetRowHeight(containerWidth, gap, border2, tier) {
    const N = tier === 0 ? 2 : (tier === 1 ? 3 : 4);
    return (containerWidth - gap * (N - 1) - border2 * N) / (N * (3 / 2));
}

/* 贪心分行：行高 = (行宽 − 间距 − 边框) / 宽高比之和（自然铺满，行高可变化）
   逐张累加直到再加一张会低于参考值 H；边界处比较「停在此处 / 纳入下一张 /
   与下下张交换后纳入」三种方案，取行高最接近 H 者；
   最后一行（照片耗尽）行高封顶 H、右侧留白不强行对齐 */
function partitionRows(ratios, items, W, H, gap, border2, refine, minPhotos) {
    const hOf = (count, sum) => (W - gap * (count - 1) - border2 * count) / sum;
    const rows = [];
    let i = 0;
    const n = ratios.length;
    while (i < n) {
        let sum = 0;
        let count = 0;
        let j = i;
        while (j < n) {
            const cand = hOf(count + 1, sum + ratios[j]);
            if (count >= minPhotos && cand <= H) break; // 再加一张会低于参考值
            sum += ratios[j];
            count++;
            j++;
        }

        let h;
        let ragged = false;
        if (j === n) {
            // 末尾行：无论是否还有后续批次，都按统一行高左对齐（自然宽度、不吸收余量）——
            // 有后续批次时该行是「未完成尾行」，等待下一批照片补齐后重新组成完整行；
            // 全部照片加载完后的真正最后一行则保持左对齐留白
            const hNatural = hOf(count, sum);
            h = Math.min(hNatural, H);
            ragged = true;
        } else if (refine) {
            // 行边界微调：比较「停在此处 / 纳入下一张」，取行高最接近 H 者。
            // 注意：不交换照片顺序（JS 数组换序会与 DOM 顺序脱节，导致行划分错位）
            h = hOf(count, sum);
            const hNext = hOf(count + 1, sum + ratios[j]);
            if (Math.abs(hNext - H) < Math.abs(h - H)) {
                h = hNext;
                sum += ratios[j];
                count++;
            }
        } else {
            // 纯贪心：行高 = 当前自然行高
            h = hOf(count, sum);
        }

        rows.push({ start: i, count, h, ragged });
        i += count;
    }
    return rows;
}

/* 应用行布局：每张盒子严格按自身比例（自然行高下恰好铺满，无裁切）
   末张吸收取整误差并向下取整，保证整行宽度不超容器、不换行；
   ragged 行（未完成尾行 / 真正的最后一行）不吸收余量，按自然宽度排列、右侧留白 */
function applyRows(items, rows, ratios, W, gap, border2) {
    rows.forEach((row) => {
        let remaining = W;
        for (let k = 0; k < row.count; k++) {
            const idx = row.start + k;
            const img = items[idx] && items[idx].querySelector('img.photo-img');
            if (!img) continue;
            items[idx].style.marginRight = ''; // 清除任何残留的 inline margin（防止历史版本遗留导致行超宽换行）
            const cellW = ratios[idx] * row.h + border2;
            let imgW;
            if (!row.ragged && k === row.count - 1) {
                imgW = Math.max(1, Math.floor(remaining - border2)); // 末张吸收余量，整行恰好铺满
            } else {
                imgW = Math.floor(cellW - border2); // 只舍不入，保证整行绝不超宽换行
                // 按「实际渲染宽度」扣减，避免误差累积导致行宽超过容器而换行留白
                remaining -= (imgW + border2) + gap;
            }
            img.style.width = imgW + 'px';
            img.style.height = Math.round(row.h) + 'px';
        }
    });
}

/* 容器可用宽度：向下取整并留 2px 安全余量
   （吸收滚动条出现、小数边框等造成的实际行宽波动，杜绝行末照片被挤到下一行） */
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

/* ===== resize：逐帧重排（rAF 节流），布局实时跟随窗口宽度 ===== */
export function initMasonryResize() {
    if (resizeBound) return;
    resizeBound = true;
    window.addEventListener('resize', () => {
        const grid = document.getElementById('masonry-grid');
        if (!grid || !grid._shownItems || grid._shownItems.length === 0) return;
        scheduleRelayout(grid);
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
    if (!shown || shown.length === 0 || !grid._rows) return; // 首次揭示完成前不重排

    const W = getGridWidth(grid);
    const gap = getRowGap(grid);
    const border2 = getCardBorder(grid);
    const modeChanged = updateTier(grid);
    const H = getTargetRowHeight(W, gap, border2, grid._tier);

    if (modeChanged) {
        // 跨档位断点：重新分行——与揭示时同一规则（含边界微调），
        // 保证档位切换后的布局与初次进入该档位的布局一致
        rebuildAll(grid, true);
        return;
    }

    // 先按比例缩放照片（行成员冻结不动），不做排布调整——彻底消除拖拽时的来回跳跃
    const rows = grid._rows.map((row) => {
        let sum = 0;
        for (let k = 0; k < row.count; k++) {
            sum += grid._ratios.get(shown[row.start + k]) || DEFAULT_RATIO;
        }
        let h = (W - gap * (row.count - 1) - border2 * row.count) / sum;
        if (row.ragged) h = Math.min(h, H);
        return { start: row.start, count: row.count, h, ragged: row.ragged };
    });
    const allRatios = shown.map((item) => grid._ratios.get(item) || DEFAULT_RATIO);
    applyRows(shown, rows, allRatios, W, gap, border2);
}

/* 对全部已显示照片重新分行并重建行容器（跨断点切换 / 测量完成后的校正）；
   已用真实比例排布过的行重新计算后结果不变，只有尾部（新批次所在行）会调整 */
function rebuildAll(grid, refine) {
    const shown = grid._shownItems;
    if (!shown || shown.length === 0) return;

    const W = getGridWidth(grid);
    const gap = getRowGap(grid);
    const border2 = getCardBorder(grid);
    updateTier(grid);
    const H = getTargetRowHeight(W, gap, border2, grid._tier);

    const allRatios = shown.map((item) => grid._ratios.get(item) || DEFAULT_RATIO);
    const rows = partitionRows(allRatios, shown, W, H, gap, border2, refine, grid._tier === 0 ? 1 : 2);
    grid._rows = rows;

    grid.querySelectorAll('.masonry-row').forEach((el) => el.remove());
    rows.forEach((row) => {
        const rowEl = document.createElement('div');
        rowEl.className = 'masonry-row';
        for (let k = 0; k < row.count; k++) {
            rowEl.appendChild(shown[row.start + k]);
        }
        appendRowEl(grid, rowEl);
    });

    grid._incompleteStart = grid._pendingItems.length > 0
        ? rows[rows.length - 1].start
        : -1;

    applyRows(shown, rows, allRatios, W, gap, border2);
}
