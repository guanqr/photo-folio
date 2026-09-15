/**
 * 全部作品页筛选栏：拍摄年份 / 拍摄地点 / 作品类型（胶囊按钮组，可组合，默认「全部」）
 *
 * - 筛选切换：以「下拉加载更多」分页模式重启网格——集合外隐藏、集合内重新分页
 *   （首批 12 张揭示，其余滚动加载；无限滚动照常工作，触发器保持可见）
 * - 无匹配时显示空状态文案并隐藏触发器
 * - 筛选状态同步到 URL（参考站同款）：?y=年份 &l=地点 &c=类型（history.replaceState，
 *   默认值不写入）；直接打开带参数的 URL 或 SPA 返回时自动恢复筛选
 */

import { restartMasonryGrid } from './masonry.js';
import { initInfiniteScroll } from './infinite-scroll.js';

const PARAM_KEYS = { year: 'y', location: 'l', category: 'c' };

let resizeBound = false; // 模块级：跨 SPA 页面实例只挂一个窗口监听

export function initGalleryFilter() {
    const bar = document.querySelector('.gallery-filters');
    const grid = document.getElementById('masonry-grid');
    if (!bar || !grid) return;
    if (bar._filterBound) return; // SPA 重复初始化幂等
    bar._filterBound = true;

    /* 首次初始化时记录照片原始 DOM 顺序（= 时间顺序）——
       筛选切换会拍平/重建行容器，行内照片被插到游离照片之前、DOM 顺序被打乱，
       重置回「全部」时必须按原始顺序排序，不能直接沿用当前 DOM 顺序 */
    if (!grid._origOrder) {
        grid._origOrder = new Map(
            Array.from(grid.querySelectorAll('.masonry-item')).map((el, i) => [el, i])
        );
    }

    const groups = Array.from(bar.querySelectorAll('.filter-group'));
    const activeBtnOf = (dim) => {
        const g = groups.find((gr) => gr.dataset.dim === dim);
        return g ? g.querySelector('button.is-active') : null;
    };
    const valueOf = (dim) => {
        const b = activeBtnOf(dim);
        return b ? b.dataset.value : '';
    };
    /* 地点按钮：data-value 为英文 slug（URL 参数），匹配照片用按钮中文文本 */
    const locLabelOf = () => {
        const b = activeBtnOf('location');
        return b && b.dataset.value ? b.textContent : '';
    };

    const activate = (group, btn) => {
        group.querySelectorAll('button').forEach((b) => {
            const on = b === btn;
            b.classList.toggle('is-active', on);
            b.setAttribute('aria-pressed', on ? 'true' : 'false');
        });
    };

    /* URL 同步：replaceState（不产生历史记录），默认值不写入 */
    const syncUrl = () => {
        const params = new URLSearchParams();
        groups.forEach((g) => {
            const v = valueOf(g.dataset.dim);
            if (v) params.set(PARAM_KEYS[g.dataset.dim], v);
        });
        const qs = params.toString();
        const url = location.pathname + (qs ? '?' + qs : '');
        history.replaceState({ url: location.origin + url }, '', url);
    };

    /* 横向滚动渐隐遮罩：仅当右侧还有内容时显示（参考站 can-scroll-r） */
    const updateMask = (box) => {
        const scrollable = box.scrollLeft + box.clientWidth < box.scrollWidth - 8;
        box.classList.toggle('can-scroll-r', scrollable);
    };

    /* 切换筛选后把选中胶囊滚到可视区中间 */
    const scrollActiveIntoView = (g) => {
        const box = g.querySelector('.filter-options');
        const active = g.querySelector('button.is-active');
        if (!box || !active) return;
        const target = active.offsetLeft - box.clientWidth / 2 + active.clientWidth / 2;
        box.scrollTo({ left: target, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
        updateMask(box);
    };

    const apply = () => {
        // 每轮筛选只解析一次各维度值（避免在匹配谓词中逐项重复查询 DOM）
        const year = valueOf('year');
        const locLabel = locLabelOf();
        const category = valueOf('category');
        const active = year !== '' || locLabel !== '' || category !== '';
        const matches = (item) =>
            (!year || item.dataset.year === year) &&
            (!locLabel || item.dataset.location === locLabel) &&
            (!category || item.dataset.category === category);
        const items = Array.from(grid.querySelectorAll('.masonry-item'));
        const matching = active ? items.filter(matches) : items;
        // 恢复原始时间顺序（DOM 顺序已被历次筛选拍平打乱）
        matching.sort((a, b) => (grid._origOrder.get(a) ?? 0) - (grid._origOrder.get(b) ?? 0));

        // 空状态：筛选激活且无匹配时显示，并隐藏触发器
        let emptyEl = document.getElementById('gallery-filter-empty');
        if (active && matching.length === 0) {
            if (!emptyEl) {
                emptyEl = document.createElement('div');
                emptyEl.id = 'gallery-filter-empty';
                emptyEl.className = 'filter-empty';
                emptyEl.textContent = bar.dataset.emptyText || '';
                grid.after(emptyEl);
            }
            emptyEl.style.display = '';
        } else if (emptyEl) {
            emptyEl.style.display = 'none';
        }

        restartMasonryGrid(grid, matching);
        if (active && matching.length === 0) {
            const trigger = document.getElementById('load-more-trigger');
            if (trigger) trigger.style.display = 'none';
        }
        // 若无限滚动的监听曾因加载完成被移除，重新挂载；仍生效时幂等跳过
        initInfiniteScroll();
        syncUrl();
    };

    bar.addEventListener('click', (e) => {
        const btn = e.target.closest('button[data-value]');
        if (!btn || btn.classList.contains('is-active')) return;
        const group = btn.closest('.filter-group');
        activate(group, btn);
        scrollActiveIntoView(group);
        apply();
    });

    // 初始遮罩状态（每页实例绑定各自滚动容器；窗口监听只挂一次，运行时从文档解析）
    groups.forEach((g) => {
        const box = g.querySelector('.filter-options');
        updateMask(box);
        box.addEventListener('scroll', () => updateMask(box), { passive: true });
    });
    if (!resizeBound) {
        resizeBound = true;
        window.addEventListener('resize', () => {
            document.querySelectorAll('.gallery-filters .filter-options').forEach(updateMask);
        }, { passive: true });
    }

    // 从 URL 恢复筛选（直接打开带参数链接 / SPA 返回）
    const params = new URLSearchParams(location.search);
    let restored = false;
    groups.forEach((g) => {
        const pv = params.get(PARAM_KEYS[g.dataset.dim]);
        if (!pv) return;
        const btn = Array.from(g.querySelectorAll('button')).find((b) => b.dataset.value === pv);
        if (btn) {
            activate(g, btn);
            restored = true;
        }
    });
    if (restored) apply();
}
