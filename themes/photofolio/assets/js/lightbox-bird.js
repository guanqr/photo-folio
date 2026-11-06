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
import { fillTemplate, anchorWhile, prefersReducedMotion } from './utils.js';
import { createPanelCenterComp } from './lightbox-panel-comp.js';

export function initLightboxBird({
    block, trigger, body, nameEl, sourceList, drawer, fallbackFocus,
    panel, panelDetails, caption, tagsEl
}) {
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
    // 等级文案由模板从 bird-registry 的等级清单生成，JS 不再硬编码等级名单
    const labels = (() => {
        try {
            return JSON.parse((statusEl && statusEl.dataset.labels) || '{}') || {};
        } catch (err) {
            console.warn('[lightbox] bird labels parse failed:', err);
            return {};
        }
    })();
    const collapseBtn = document.getElementById('lightbox-bird-collapse');
    const slotEl = document.getElementById('lightbox-bird-slot');
    // 图鉴块存在性交给 slot 内层 grid 过渡（见 _lightbox-bird.scss）：
    // 块本身不再用 hidden 切换，否则 display:none 无法做高度过渡
    block.hidden = false;
    block.inert = true;
    block.setAttribute('aria-hidden', 'true');
    const scrollContainer = panelDetails || body.closest('.lightbox-panel-details');
    const panelEl = panel || (scrollContainer && scrollContainer.closest('.lightbox-panel'));
    // 收起居中补偿与图像分析共用（见 lightbox-panel-comp.js）
    const centerComp = createPanelCenterComp({
        panel: panelEl, panelDetails: scrollContainer, caption, tagsEl, drawer
    });
    let open = false;
    let renderedId = null; // 已构建資料來源链接的鸟种 id（同一鸟种不重建）
    let closedSlotHeight = 0; // 收起补偿用：图鉴收起时 slot 的完整占位（含外边距）
    let anchorCancel = null;
    let fitFreezeTimer = null;

    const clearFitFreeze = () => {
        if (fitFreezeTimer !== null) {
            clearTimeout(fitFreezeTimer);
            fitFreezeTimer = null;
        }
    };

    // 收起补偿需要精确的最终 slot 占位：缓存值可能因字体加载/布局模式与实际
    // 收起时不同，预测偏大时下滑会过头、再由末尾残余补偿向上修正（观感回弹）。
    // 在点击收起的同一任务内临时切到关闭态测量：禁过渡、恢复 scrollTop，
    // 测量过程不绘制，用户看不到中间态
    const measureClosedSlotHeight = () => {
        if (!slotEl) return closedSlotHeight;
        if (!block.classList.contains('is-open')) return slotEl.offsetHeight;
        const prevScrollTop = scrollContainer ? scrollContainer.scrollTop : 0;
        const targets = [block, body, trigger];
        const prevTransitions = targets.map((el) => el.style.transition);
        targets.forEach((el) => { el.style.transition = 'none'; });
        block.classList.remove('is-open');
        void block.offsetHeight; // 强制布局：关闭态
        const height = slotEl.offsetHeight;
        block.classList.add('is-open');
        if (scrollContainer) scrollContainer.scrollTop = prevScrollTop;
        void block.offsetHeight; // 恢复开启态
        targets.forEach((el, i) => { el.style.transition = prevTransitions[i]; });
        return height || closedSlotHeight;
    };

    const syncOpen = () => {
        block.classList.toggle('is-open', open);
        trigger.setAttribute('aria-expanded', open ? 'true' : 'false');
        body.setAttribute('aria-hidden', open ? 'false' : 'true');
        body.inert = !open;
    };

    // 有/无鸟种只切换 slot 的 is-present（内层 0fr↔1fr + opacity 过渡）；
    // 隐藏态用 inert/aria-hidden，保留布局以便高度过渡
    const setPresent = (present) => {
        if (slotEl) slotEl.classList.toggle('is-present', present);
        block.inert = !present;
        block.setAttribute('aria-hidden', present ? 'false' : 'true');
    };

    const cancelAnchor = () => {
        if (anchorCancel) {
            anchorCancel();
            anchorCancel = null;
        }
    };

    const setOpen = (next) => {
        if (open === next) return;
        // 窄屏：开合期间把当前按钮（展开=触发行、收起=底部收起按钮）锚定在
        // 屏幕位置；滚到上/下尽头时 anchorWhile 自动停止，让内容整体移动
        if (scrollContainer && drawer && !drawer.fitApplicable()) {
            cancelAnchor();
            anchorCancel = anchorWhile(next ? trigger : body, scrollContainer, next ? 650 : 450, next ? 'top' : 'bottom');
        }
        // 桌面：展开按实际高度逐帧重判 is-fit（内容超高时及时切为可滚动，
        // 避免冻结居中把标题裁出视口）；收起冻结 is-fit 并做居中下滑，
        // 过渡结束翻转 is-fit、残余补偿——与图像分析共用 helper
        if (drawer && drawer.fitApplicable() && panelEl && scrollContainer) {
            clearFitFreeze();
            if (next) {
                centerComp.cancel();
                if (scrollContainer) scrollContainer.classList.remove('no-margin-center');
                drawer.setFitAdjuster(false);
                drawer.setInputHold(false);
                drawer.cancelScroll();
            } else {
                if (scrollContainer) scrollContainer.classList.add('no-margin-center');
                drawer.setFitAdjuster(true);
                drawer.setInputHold(true);
                const currentSlotH = slotEl ? slotEl.offsetHeight : 0;
                const finalDetailsH = scrollContainer
                    ? scrollContainer.scrollHeight - currentSlotH + measureClosedSlotHeight()
                    : 0;
                if (!prefersReducedMotion()) centerComp.begin(finalDetailsH);
                fitFreezeTimer = setTimeout(() => {
                    fitFreezeTimer = null;
                    centerComp.finish();
                }, prefersReducedMotion() ? 0 : 650);
            }
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
        // 焦点在資料來源链接上切图：记录原索引，重建后原位恢复。此前每次切图
        // 无条件 replaceChildren 重建链接，同鸟种连切也会删除聚焦节点、焦点
        // 落回 body，下一 Tab 从对话框顶部重来（2026-11-03 审查修复）
        const activeEl = document.activeElement;
        const focusInBlock = !!(block && activeEl && block.contains(activeEl));
        const focusedSourceIndex = focusInBlock && sourceList && sourceList.contains(activeEl)
            ? Array.from(sourceList.querySelectorAll('a')).indexOf(activeEl)
            : -1;
        const focusInSources = focusedSourceIndex >= 0;

        // 开关显示条件：带 species 或属于观鸟系列（缺 species 也显示）
        if (!photo || (!photo.species && !photo.birdGuide)) {
            setPresent(false);
            cancelAnchor();
            // 聚焦节点随块隐藏时焦点会落回 body：交给常显的关闭按钮承接
            if (focusInBlock && fallbackFocus) fallbackFocus.focus({ preventScroll: true });
            return;
        }

        setPresent(true);
        // 收起补偿的最终组高需要图鉴收起时的 slot 占位（含触发行外边距）；
        // 块可见且收起时缓存（首张鸟照渲染即处于收起态）
        if (!open && slotEl) closedSlotHeight = slotEl.offsetHeight;
        // 缺 species / 无对应鸟种数据：展开显示与分析失败同款空状态卡
        if (!bird) {
            if (contentEl) contentEl.hidden = true;
            if (missingEl) missingEl.hidden = false;
            syncOpen();
            // 来源链接随内容区隐藏；展开态的收起按钮仍可见，承接焦点
            if (focusInSources) {
                const target = collapseBtn || fallbackFocus || trigger;
                if (target) target.focus({ preventScroll: true });
            }
            return;
        }

        if (contentEl) contentEl.hidden = false;
        if (missingEl) missingEl.hidden = true;
        // 标题可用 display_name 覆盖（俗名）；分类「種」仍用 name（种名）
        if (nameEl) nameEl.textContent = bird.display_name || bird.name || '';
        if (statusEl) {
            const level = bird.conservation_level || '';
            const label = level ? (labels[level] || '') : '';
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

        const rebuildSources = !!(sourceList && renderedId !== bird.id);
        if (rebuildSources) {
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
            renderedId = bird.id;
        }

        // 开合状态跨切图保持；块刚被显示时同步一次 aria/inert
        syncOpen();

        if (rebuildSources && focusInSources) {
            const links = sourceList ? sourceList.querySelectorAll('a') : [];
            // 按原索引落到新鸟种的来源链接；无链接时退回展开态的收起入口
            const target = links.length
                ? links[Math.min(Math.max(focusedSourceIndex, 0), links.length - 1)]
                : (collapseBtn || fallbackFocus || trigger);
            if (target) target.focus({ preventScroll: true });
        }
    }

    trigger.addEventListener('click', () => setOpen(!open));
    if (collapseBtn) collapseBtn.addEventListener('click', () => setOpen(false));

    return {
        render,
        cancelAnchor,
        // 关闭灯箱静默复位（下次打开默认收起，与图像分析一致）
        reset() {
            open = false;
            setPresent(false);
            cancelAnchor();
            clearFitFreeze();
            centerComp.cancel();
            if (scrollContainer) scrollContainer.classList.remove('no-margin-center');
            if (drawer) {
                drawer.setInputHold(false);
                drawer.setFitAdjuster(false);
            }
            syncOpen();
        }
    };
}
