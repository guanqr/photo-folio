export function initInfiniteScroll() {
    const trigger = document.getElementById('load-more-trigger');
    const grid = document.getElementById('masonry-grid');
    
    if (!trigger || !grid) return;

    const items = grid.querySelectorAll('.masonry-item');
    const pageSize = parseInt(trigger.dataset.pageSize, 10) || 12;
    
    // 如果照片总数小于等于 pageSize，不需要无限滚动
    if (items.length <= pageSize) {
        trigger.remove();
        return;
    }

    let currentIndex = pageSize;
    let isLoading = false;

    // 1. 初始化：隐藏第 13 张及以后的照片
    items.forEach((item, index) => {
        if (index >= pageSize) {
            item.classList.add('is-hidden');
        }
    });

    // 2. 监听滚动
    const observer = new IntersectionObserver((entries) => {
        if (entries[0].isIntersecting && !isLoading) {
            loadMore();
        }
    }, { rootMargin: '300px' });

    observer.observe(trigger);

    function loadMore() {
        if (currentIndex >= items.length) {
            finishLoading();
            return;
        }

        isLoading = true;
        trigger.classList.add('is-loading');

        // 模拟一点点延迟，让 loading 动画显示出来
        setTimeout(() => {
            const nextIndex = Math.min(currentIndex + pageSize, items.length);
            
            // 显示下一批照片
            for (let i = currentIndex; i < nextIndex; i++) {
                items[i].classList.remove('is-hidden');
            }
            
            currentIndex = nextIndex;
            isLoading = false;
            trigger.classList.remove('is-loading');

            if (currentIndex >= items.length) {
                finishLoading();
            }
        }, 300); 
    }

    function finishLoading() {
        observer.disconnect();
        trigger.classList.remove('is-loading');
        trigger.classList.add('is-finished');
        trigger.innerHTML = `<span class="load-more-text">${trigger.dataset.finishedText}</span>`;
        setTimeout(() => trigger.remove(), 2000);
    }
}
