/**
 * 瀑布流布局引擎
 */

let resizeTimeout = null;
let currentColumnCount = 0;

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

    // 分离可见/隐藏：隐藏项不预分配，等加载时再逐张放入最矮列
    const visible = allItems.filter(item => !item.classList.contains('is-hidden'));
    const pending = allItems.filter(item => item.classList.contains('is-hidden'));

    // 只分配可见项
    distributeIntoColumns(visible, columns);

    // 隐藏项暂存，供 infinite-scroll 按需取出
    pending.forEach(item => item.remove());
    grid._pendingItems = pending;

    grid._allItems = allItems;
    grid._columns = columns;

    grid.classList.add('masonry-ready');
}

export function getColumnCount() {
    if (window.innerWidth <= 768) return 1;
    if (window.innerWidth <= 1024) return 2;
    return 3;
}

export function initMasonryResize() {
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

    // Play
    allRendered.forEach(el => {
        el.style.transition = '';
        el.style.transform = '';
    });
}

// 混合分配：前 N 个 round-robin（首行时间序），后续最短列优先（均衡列高）
function distributeIntoColumns(items, columns) {
    const colHeights = columns.map(() => 0);

    items.forEach((item, index) => {
        let col;
        if (index < columns.length) {
            col = columns[index];
        } else {
            let minIdx = 0;
            for (let i = 1; i < columns.length; i++) {
                if (colHeights[i] < colHeights[minIdx]) minIdx = i;
            }
            col = columns[minIdx];
        }
        col.appendChild(item);
        colHeights[columns.indexOf(col)] += item.getBoundingClientRect().height || 300;
    });
}
