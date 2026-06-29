/**
 * 瀑布流布局引擎
 */

let resizeTimeout = null;
let currentColumnCount = 0;
let resizeBound = false;

export function initMasonry() {
    const grid = document.getElementById('masonry-grid');
    if (!grid) return;

    const allItems = Array.from(grid.querySelectorAll('.masonry-item'));
    if (allItems.length === 0) return;

    currentColumnCount = getColumnCount();

    const columns = [];
    for (let i = 0; i < currentColumnCount; i++) {
        const col = document.createElement('div');
        col.className = 'masonry-column';
        columns.push(col);
        grid.appendChild(col);
    }

    // 全部照片不预分配，揭示时逐张放入当前最矮列
    allItems.forEach(item => item.remove());
    grid._pendingItems = allItems; // 揭示时会 shift，顺序逐步消耗
    grid._allItems = [...allItems]; // 独立副本，flipRebuild 依赖完整原始顺序
    grid._columns = columns;

    grid.classList.add('masonry-ready');

    // 首批照片逐张揭示（每张放入揭示瞬间的最矮列）
    const pageSize = 12;
    revealBatch(grid, pageSize);
}

export function revealBatch(grid, count) {
    const pending = grid._pendingItems;
    const batch = Math.min(count, pending.length);
    const columns = grid._columns;

    for (let i = 0; i < batch; i++) {
        setTimeout(() => {
            const item = pending.shift();
            const shortest = getShortestCol(columns);
            shortest.appendChild(item);
            item.classList.remove('is-hidden');
            // 触发渐入动画：先设初始态，下一帧切到可见
            requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                    item.classList.add('is-revealed');
                });
            });
        }, i * 60);
    }
}

function getShortestCol(columns) {
    const heights = columns.map(c => c.getBoundingClientRect().height);
    const counts = columns.map(c => c.children.length);
    let min = 0;
    for (let i = 1; i < columns.length; i++) {
        const diff = heights[i] - heights[min];
        if (diff < -0.5 || (Math.abs(diff) < 0.5 && counts[i] < counts[min])) {
            min = i;
        }
    }
    return columns[min];
}

function getColumnCount() {
    if (window.innerWidth <= 768) return 1;
    if (window.innerWidth <= 1024) return 2;
    return 3;
}

export function initMasonryResize() {
    if (resizeBound) return;
    resizeBound = true;
    window.addEventListener('resize', () => {
        clearTimeout(resizeTimeout);
        resizeTimeout = setTimeout(() => {
            const grid = document.getElementById('masonry-grid');
            if (!grid || !grid._columns) return;

            const newCount = getColumnCount();
            if (newCount !== currentColumnCount) {
                currentColumnCount = newCount;
                flipRebuild(grid);
            }
        }, 100);
    });
}

function flipRebuild(grid) {
    const scrollY = window.scrollY;

    const allRendered = [];
    grid._columns.forEach(col => {
        const children = Array.from(col.children);
        children.forEach(child => allRendered.push(child));
    });

    // First
    const firstMap = new Map();
    allRendered.forEach(el => firstMap.set(el, el.getBoundingClientRect()));

    // 重建（只有可见项参与；隐藏项在 _pendingItems 中，不受影响）
    allRendered.forEach(el => el.remove());
    grid.innerHTML = '';
    const columns = [];
    for (let i = 0; i < currentColumnCount; i++) {
        const col = document.createElement('div');
        col.className = 'masonry-column';
        columns.push(col);
        grid.appendChild(col);
    }
    grid._columns = columns;

    // 按时间排序后分配
    const itemIndexMap = new Map();
    grid._allItems.forEach((item, index) => itemIndexMap.set(item, index));
    allRendered.sort((a, b) => (itemIndexMap.get(a) || 0) - (itemIndexMap.get(b) || 0));
    distributeIntoColumns(allRendered, columns);

    window.scrollTo(0, scrollY);

    // Last
    const lastMap = new Map();
    allRendered.forEach(el => lastMap.set(el, el.getBoundingClientRect()));

    // Invert
    allRendered.forEach(el => {
        const fr = firstMap.get(el);
        const lr = lastMap.get(el);
        if (!fr || !lr) return;
        const dx = fr.left - lr.left;
        const dy = fr.top - lr.top;
        const sx = fr.width / lr.width;
        const sy = fr.height / lr.height;
        if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5 ||
            Math.abs(sx - 1) > 0.001 || Math.abs(sy - 1) > 0.001) {
            el.style.transition = 'none';
            el.style.transformOrigin = 'top left';
            el.style.transform = `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`;
        }
    });

    allRendered.forEach(el => el.offsetHeight);

    // Play（使用平滑缓动，不用弹簧曲线，列数切换更干净）
    allRendered.forEach(el => {
        el.style.transition = 'transform 0.35s cubic-bezier(0.4, 0, 0.2, 1)';
        el.style.transform = '';
        el.addEventListener('transitionend', function handler() {
            el.removeEventListener('transitionend', handler);
            el.style.transition = '';
        });
    });
}

// 混合分配（FLIP rebuild 用）：前 N 个 round-robin，后续最短列优先
function distributeIntoColumns(items, columns) {
    const colHeights = columns.map(() => 0);
    const colCounts = columns.map(() => 0);

    items.forEach((item, index) => {
        let colIdx;
        if (index < columns.length) {
            colIdx = index;
        } else {
            let minIdx = 0;
            for (let i = 1; i < columns.length; i++) {
                const diff = colHeights[i] - colHeights[minIdx];
                if (diff < -0.5 || (Math.abs(diff) < 0.5 && colCounts[i] < colCounts[minIdx])) {
                    minIdx = i;
                }
            }
            colIdx = minIdx;
        }
        columns[colIdx].appendChild(item);
        colHeights[colIdx] += item.getBoundingClientRect().height || 300;
        colCounts[colIdx]++;
    });
}
