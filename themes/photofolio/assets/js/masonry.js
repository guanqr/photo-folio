/**
 * 瀑布流布局引擎
 *
 * 替代 CSS column-count，实现：
 * 1. 按时间顺序横排（左→右 = 新→旧）—— round-robin 分配
 * 2. 加载更多时已有照片位置不变
 * 3. resize 列数切换时使用 FLIP 动画平滑过渡
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

    allItems.forEach((item, index) => {
        const col = columns[index % currentColumnCount];
        col.appendChild(item);
    });

    grid._allItems = allItems;
    grid._columns = columns;
    grid._renderedCount = allItems.length;
    grid._nextIndex = allItems.length;

    // 标记就绪，CSS 从 column-count fallback 切换到 flex 布局
    grid.classList.add('masonry-ready');
}

export function getColumnCount() {
    if (window.innerWidth <= 768) return 1;
    if (window.innerWidth <= 1024) return 2;
    return 3;
}

export function getShortestColumn(columns) {
    if (!columns || columns.length === 0) return null;
    return columns.reduce((a, b) =>
        a.getBoundingClientRect().height <= b.getBoundingClientRect().height ? a : b
    );
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

/**
 * FLIP 动画重建列
 * First（旧位置）→ 拆 DOM → Last（新位置）→ Invert → Play
 */
function flipRebuild(grid) {
    // 保存滚动位置，防止 DOM 清空时页面回顶
    const scrollY = window.scrollY;

    const allRendered = [];
    grid._columns.forEach(col => {
        const children = Array.from(col.children);
        children.forEach(child => allRendered.push(child));
    });

    // ── First：记录旧位置（用 Map 按元素索引，避免后续 sort 打乱顺序）──
    const firstMap = new Map();
    allRendered.forEach(el => firstMap.set(el, el.getBoundingClientRect()));

    // ── 拆旧列、建新列 ──
    // 传入 firstMap 供 rebuildAndDistribute 使用预测量高度（避免 item 脱离 DOM 后测高为 0）
    allRendered.forEach(el => el.remove());
    rebuildAndDistribute(grid, allRendered, firstMap);

    // 重建后立即恢复滚动位置
    window.scrollTo(0, scrollY);

    // ── Last：新位置 ──
    const lastMap = new Map();
    allRendered.forEach(el => lastMap.set(el, el.getBoundingClientRect()));

    // ── Invert：瞬间拉到旧位置 + 旧尺寸 ──
    allRendered.forEach(el => {
        const fr = firstMap.get(el);
        const lr = lastMap.get(el);
        if (!fr || !lr) return;
        const dx = fr.left - lr.left;
        const dy = fr.top - lr.top;
        const sx = fr.width / lr.width;
        const sy = fr.height / lr.height;
        const moved = Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5;
        const sized = Math.abs(sx - 1) > 0.001 || Math.abs(sy - 1) > 0.001;
        if (moved || sized) {
            el.style.transition = 'none';
            el.style.transformOrigin = 'top left';
            el.style.transform = `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`;
        }
    });

    // 强制浏览器应用 invert 状态
    allRendered.forEach(el => el.offsetHeight);

    // ── Play：移除 transform，CSS transition 接管 ──
    // 注意：不清除 transformOrigin，否则从 top-left 跳回默认 center 会导致缩放原点突变
    allRendered.forEach(el => {
        el.style.transition = '';
        el.style.transform = '';
    });
}

function rebuildAndDistribute(grid, items, firstMap) {
    grid.innerHTML = '';
    const columns = [];
    const colHeights = [];
    for (let i = 0; i < currentColumnCount; i++) {
        const col = document.createElement('div');
        col.className = 'masonry-column';
        columns.push(col);
        colHeights.push(0);
        grid.appendChild(col);
    }
    grid._columns = columns;

    const itemIndexMap = new Map();
    grid._allItems.forEach((item, index) => itemIndexMap.set(item, index));
    items.sort((a, b) => (itemIndexMap.get(a) || 0) - (itemIndexMap.get(b) || 0));

    // 用 firstMap 中预测量的高度（此时 items 已脱离 DOM，需用旧数据）
    const visibleHeights = [];
    items.forEach(item => {
        if (!item.classList.contains('is-hidden')) {
            const fr = firstMap ? firstMap.get(item) : null;
            visibleHeights.push(fr ? fr.height : 300);
        }
    });
    const avgHeight = visibleHeights.length > 0
        ? visibleHeights.reduce((a, b) => a + b, 0) / visibleHeights.length
        : 300;

    items.forEach(item => {
        const hidden = item.classList.contains('is-hidden');
        let minIdx = 0;
        for (let i = 1; i < columns.length; i++) {
            if (colHeights[i] < colHeights[minIdx]) minIdx = i;
        }
        columns[minIdx].appendChild(item);
        // 刚插入的 item 已在 DOM 中，可用真实高度；隐藏项用预估高度
        colHeights[minIdx] += hidden ? avgHeight : item.getBoundingClientRect().height;
    });
}
