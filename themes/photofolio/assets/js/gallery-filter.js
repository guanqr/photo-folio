/**
 * 全部作品页筛选栏：作品範圍 / 拍攝年份 / 拍攝地點 / 作品類型（胶囊按钮组，可组合，默认「全部」）
 *
 * - 筛选切换：按行计划重启网格——集合外隐藏、集合内重新计算整组行计划与页面高度，
 *   只渲染当前视口窗口内的行，其余滚动到再渲染
 * - 无匹配时显示空状态文案
 * - 年份档含合并项：模板生成 `before-<分界年>` token（如 before-2024 = 「2024 前」，覆盖 2023 及更早），
 *   按卡片 data-year 数值小于分界年匹配
 * - 筛选状态同步到 URL（参考站同款）：?s=范围 &y=年份 &l=地点 &c=类型（pushState——
 *   iOS 地址栏实时更新、历史入栈返回键可逐步回退筛选，默认值不写入；
 *   加载恢复/过期参数清理走 replaceState 不产生历史）；直接打开带参数的 URL
 *   或 SPA 返回时自动恢复筛选
 */

import { restartMasonryGrid } from './masonry.js';
import { prefersReducedMotion, easeOutCubic, pushQueryState } from './utils.js';

export const PARAM_KEYS = { scope: 's', year: 'y', location: 'l', category: 'c' };

const YEAR_BUCKET_PREFIX = 'before-'; // 年份合并档 data-value 前缀（与模板生成规则对应）

let resizeBound = false; // 模块级：跨 SPA 页面实例只挂一个窗口监听

let countAnimRaf = null; // 计数动画单槽位：快速连点启动多个 rAF 循环会交替写同一 textContent（数字闪烁）

/* 作品计数滚动动画：旧值平滑滚动到新值（easeOutCubic，450ms）；减弱动态直切 */
function animateCount(el, target) {
    const from = parseInt(el.textContent, 10) || 0;
    if (from === target) return;
    if (prefersReducedMotion()) {
        el.textContent = String(target);
        return;
    }
    if (countAnimRaf) cancelAnimationFrame(countAnimRaf);
    const start = performance.now();
    const DURATION = 450;
    const step = (now) => {
        const p = Math.min(1, (now - start) / DURATION);
        const eased = easeOutCubic(p);
        el.textContent = String(Math.round(from + (target - from) * eased));
        countAnimRaf = p < 1 ? requestAnimationFrame(step) : null;
    };
    countAnimRaf = requestAnimationFrame(step);
}

export function initGalleryFilter() {
    const bar = document.querySelector('.gallery-filters');
    const grid = document.getElementById('masonry-grid');
    if (!bar || !grid) return;
    if (bar._filterBound) return; // SPA 重复初始化幂等
    bar._filterBound = true;

    /* 作品原始顺序基准由 initMasonry 在首屏行创建前写入（必须先于任何行容器）；
       这里只兜底异常路径：若 masonry 未初始化，当前 DOM 仍是原始顺序。
       筛选切换会拍平/重建行容器、DOM 顺序被打乱，重置「全部」必须按原始顺序排序 */
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
    /* 地点按钮：data-value 为英文 slug（URL 参数），匹配作品用按钮中文文本 */
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

    /* URL 同步：pushState（iOS 地址栏实时更新、历史入栈返回键可逐步回退筛选；
       路径保持站点目录式规范形态带尾斜杠）；未激活维度显式清除（含过期参数
       清理），?p= 等其余参数自动保留（pushQueryState 克隆基准）。
       replace=true 仅用于加载恢复的清理路径——不产生历史（返回键不留死循环） */
    const syncUrl = (replace = false) => {
        const updates = {};
        // 全部维度键入 updates：未渲染（配置关闭）的维度显式清 null——只写已
        // 渲染组会让带 ?l=/?c= 的旧链接参数永不清理、每次访问都重复一次
        // 隐藏-重启-揭示的闪现（2026-10-18）；已渲染组随后按当前值覆盖
        Object.values(PARAM_KEYS).forEach((key) => { updates[key] = null; });
        groups.forEach((g) => {
            updates[PARAM_KEYS[g.dataset.dim]] = valueOf(g.dataset.dim) || null;
        });
        pushQueryState(updates, { replace });
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
        box.scrollTo({ left: target, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
        updateMask(box);
    };

    const apply = (replace = false) => {
        // 每轮筛选只解析一次各维度值（避免在匹配谓词中逐项重复查询 DOM）
        const scope = valueOf('scope');
        const year = valueOf('year');
        // 合并档按数值区间匹配；普通年份仍精确相等（分界年由模板写入 token）
        const yearCutoff = year.startsWith(YEAR_BUCKET_PREFIX)
            ? parseInt(year.slice(YEAR_BUCKET_PREFIX.length), 10) || 0
            : 0;
        const locLabel = locLabelOf();
        const category = valueOf('category');
        const active = scope !== '' || year !== '' || locLabel !== '' || category !== '';
        const scopeToken = scope ? ' ' + scope + ' ' : '';
        const matches = (item) =>
            // 范围维度匹配卡片 data-scope token 列表（featured 与 orientation 可并存）
            (!scope || (' ' + (item.dataset.scope || '') + ' ').includes(scopeToken)) &&
            (!year || (yearCutoff > 0
                ? parseInt(item.dataset.year, 10) < yearCutoff
                : item.dataset.year === year)) &&
            (!locLabel || item.dataset.location === locLabel) &&
            (!category || item.dataset.category === category);
        const items = Array.from(grid.querySelectorAll('.masonry-item'));
        // 恢复原始时间顺序（DOM 顺序已被历次筛选拍平打乱）——装饰-排序-还原：
        // 比较器逐次比较会对同一元素重复查 Map（约 2·n·log n 次），order 值
        // 会话内不变、每个元素只取一次即可（2026-10-19）
        const matching = items
            .filter(matches)
            .map((el) => ({ el, order: grid._origOrder.get(el) ?? 0 }))
            .sort((a, b) => a.order - b.order)
            .map(({ el }) => el);

        // 空状态：筛选激活且无匹配时显示。
        // 卡片由模板预渲染（渲染条件与筛选栏相同——bar 存在则节点恒存在，
        // 无需 JS 兜底创建），这里只切换 hidden
        const emptyEl = document.getElementById('gallery-filter-empty');
        if (emptyEl) emptyEl.hidden = !(active && matching.length === 0);

        // 网格重启（0.12s 淡出后真正执行）：按新集合重建行计划与整页高度，
        // 只渲染当前视口窗口内的行，其余滚动到再加载
        restartMasonryGrid(grid, matching);
        // 头部计数随筛选结果滚动动画（数字包在 #photo-count-num 中）
        const countNum = document.getElementById('photo-count-num');
        if (countNum) animateCount(countNum, matching.length);
        syncUrl(replace);
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
    // 带筛选参数但无按钮可匹配（维度已关闭/值过期/空值）时也必须执行 apply——
    // 否则 skipReveal 跳过了首屏揭示而无人接管，网格整页空白；apply 后过期参数会被 syncUrl 清理
    const hadFilterParams = Object.values(PARAM_KEYS).some((k) => params.has(k));
    // 加载恢复/过期参数清理走 replaceState：URL 净化不产生历史（返回键不留死循环）
    if (restored || hadFilterParams) apply(true);
}
