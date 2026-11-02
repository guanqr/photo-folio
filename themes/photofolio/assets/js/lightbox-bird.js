/**
 * 灯箱「觀鳥圖鑑」（独立模块；集成见 lightbox.js）
 *
 * - 数据：灯箱壳内嵌 data/birds.toml 的 JSON（id → 物种资料），照片带
 *   species 时才显示；切到非鸟照片隐藏，块的展开状态跨切图保持
 * - 默认收起、点击触发行展开目→科→屬→種分类、分布/棲息/習性/資料來源；
 *   开合用 grid 0fr↔1fr 过渡（无需测量高度），标签与格式串全部来自模板
 *   i18n（data-format 哨兵），本模块只替换数据
 * - 详情区末子块是恒存在的空 slot（lightbox-bird-slot），块隐藏时 slot 高度 0，
 *   因此现有「末子块 auto 边距」居中规则无需改动
 * - 关闭灯箱静默复位为收起（同图像分析），开合时刷新窄屏抽屉高度/箭头
 */
import { fillTemplate, anchorWhile } from './utils.js';

export function initLightboxBird({ block, trigger, body, nameEl, sourceList, drawer }) {
    if (!block || !trigger || !body) return { render() {}, reset() {} };

    const dataEl = document.getElementById('lightbox-birds-data');
    const birds = new Map();
    try {
        const list = dataEl ? JSON.parse(dataEl.textContent || '[]') : [];
        if (Array.isArray(list)) {
            list.forEach((bird) => {
                if (bird && bird.id) birds.set(bird.id, bird);
            });
        }
    } catch (err) {
        console.warn('[lightbox] bird data parse failed:', err);
    }

    const rankEls = Array.from(body.querySelectorAll('[data-rank]'));
    const fieldEls = Array.from(body.querySelectorAll('[data-field]'));
    const contentEl = document.getElementById('lightbox-bird-content');
    const missingEl = document.getElementById('lightbox-bird-missing');
    const statusEl = document.getElementById('lightbox-bird-status');
    const collapseBtn = document.getElementById('lightbox-bird-collapse');
    const scrollContainer = body.closest('.lightbox-panel-details');
    let open = false;
    let anchorCancel = null;

    const syncOpen = () => {
        block.classList.toggle('is-open', open);
        trigger.setAttribute('aria-expanded', open ? 'true' : 'false');
        body.setAttribute('aria-hidden', open ? 'false' : 'true');
        body.inert = !open;
    };

    const setOpen = (next) => {
        if (open === next) return;
        // 窄屏：开合期间把当前按钮（展开=触发行、收起=底部收起按钮）锚定在
        // 屏幕位置；滚到上/下尽头时 anchorWhile 自动停止，让内容整体移动
        if (scrollContainer && drawer && !drawer.fitApplicable()) {
            if (anchorCancel) anchorCancel();
            anchorCancel = anchorWhile(next ? trigger : body, scrollContainer, next ? 650 : 450, next ? 'top' : 'bottom');
        }
        open = next;
        // 收起时显式移出子树焦点：inert 生效前焦点可能仍在資料來源链接上
        if (!open && body.contains(document.activeElement)) document.activeElement.blur();
        syncOpen();
        if (drawer) {
            drawer.remeasure(); // 窄屏：内容高度变化后重测抽屉高度
            drawer.refresh(); // 箭头方向补判（高度过渡本身无滚动事件）
        }
    };

    const rankValues = (bird) => ({
        order: { NAME: bird.order || '', LATIN: bird.order_latin || '' },
        family: { NAME: bird.family || '', LATIN: bird.family_latin || '' },
        genus: { NAME: bird.genus || '', LATIN: bird.genus_latin || '' },
        species: {
            NAME: bird.name || '',
            LATIN: bird.latin || ''
        }
    });

    function render(photo) {
        const id = photo ? (photo.species || '') : '';
        const bird = id ? birds.get(id) : null;
        // 开关显示条件：带 species 或属于观鸟系列（缺 species 也显示）
        if (!photo || (!photo.species && !photo.birdGuide)) {
            block.hidden = true;
            return;
        }

        block.hidden = false;
        // 缺 species / 无对应鸟种数据：展开显示与分析失败同款空状态卡
        if (!bird) {
            if (contentEl) contentEl.hidden = true;
            if (missingEl) missingEl.hidden = false;
            syncOpen();
            return;
        }

        if (contentEl) contentEl.hidden = false;
        if (missingEl) missingEl.hidden = true;
        if (nameEl) nameEl.textContent = bird.name || '';
        if (statusEl) {
            const level = bird.conservation_level || '';
            const label = level ? (statusEl.getAttribute('data-label-' + level) || '') : '';
            statusEl.textContent = label;
            statusEl.className = 'lightbox-bird-status' + (level ? ' is-' + level : '');
            statusEl.hidden = !label;
        }

        const values = rankValues(bird);
        rankEls.forEach((el) => {
            const value = values[el.dataset.rank];
            el.textContent = value ? fillTemplate(el.dataset.format || '', value) : '';
        });

        const fields = {
            distribution: bird.distribution || '',
            habitat: bird.habitat || '',
            habits: bird.habits || ''
        };
        fieldEls.forEach((el) => {
            el.textContent = fields[el.dataset.field] || '';
        });

        if (sourceList) {
            sourceList.replaceChildren();
            const separator = sourceList.dataset.separator || '';
            let first = true;
            (bird.source || []).forEach((src) => {
                if (!src || !src.url || !src.label) return;
                if (!first) sourceList.append(document.createTextNode(separator));
                const link = document.createElement('a');
                link.href = src.url;
                link.textContent = src.label;
                link.target = '_blank';
                link.rel = 'noopener noreferrer';
                sourceList.append(link);
                first = false;
            });
        }

        // 开合状态跨切图保持；块刚被显示时同步一次 aria/inert
        syncOpen();
    }

    trigger.addEventListener('click', () => setOpen(!open));
    if (collapseBtn) collapseBtn.addEventListener('click', () => setOpen(false));

    return {
        render,
        // 关闭灯箱静默复位（下次打开默认收起，与图像分析一致）
        reset() {
            open = false;
            block.hidden = true;
            if (anchorCancel) {
                anchorCancel();
                anchorCancel = null;
            }
            syncOpen();
        }
    };
}
