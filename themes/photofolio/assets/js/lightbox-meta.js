/**
 * 灯箱元信息面板渲染（独立模块；集成见 lightbox.js）
 *
 * - 地点/日期简行、EXIF 分行列表、标题下方分类/系列胶囊——由照片对象填充；
 *   标题（caption）单行文本仍由 lightbox.js 直接写入
 * - 镜头型号展示缩减：仅保留到光圈值（f/x-x）为止，其后的字母/系列后缀
 *   （VR、S、Di III VC VXD…）不展示——photo.toml 原始记录不动，仅灯箱展示截断
 * - EXIF 行结构（图标/标签）由模板渲染，这里只填值——行配置与 li 列表
 *   恒定，初始化时一次建好，切图时不再重建；单位/缺失文案由模板 data-* 的
 *   i18n 格式串提供，JS 不再硬编码 mm/f//ISO/s/N/A
 */
import { fillTemplate } from './utils.js';

export function initLightboxMeta({ tagsEl, metaEl, metaPlaceEl, metaDateEl, exifList }) {
    const shortLens = (lens) => {
        const m = lens.match(/f\/\d+(?:[.,]\d+)?(?:[-–]\d+(?:[.,]\d+)?)?/i);
        return m ? lens.slice(0, m.index + m[0].length) : lens;
    };

    // 简略信息行：地点 / 日期（带图标，组间空格分隔）；空项隐藏，全空则隐藏整个区域。
    // 拍摄参数简行已整体移除（EXIF 由下方分行列表完整展示）——此前 setMeta 的内联
    // display:'' 会压过样式表的全局隐藏规则让它复活，中屏双列下其超长 nowrap 内容
    // 把第一列轨道撑宽，地点/日期列整体右移、与 EXIF 行错位
    function setMeta(p) {
        if (!metaEl) return;
        const rows = [
            [metaPlaceEl, p.place],
            [metaDateEl, p.date]
        ];
        let any = false;
        rows.forEach(([el, text]) => {
            if (!el) return;
            el.textContent = text || '';
            el.parentElement.style.display = text ? '' : 'none';
            if (text) any = true;
        });
        metaEl.style.display = any ? '' : 'none';
    }

    // EXIF 分行列表（行配置与 li 列表恒定，初始化时一次建好）：
    // 单位/缺失文案由模板 data-format / data-missing 提供（i18n）；
    // 普通项空值隐藏，相机/镜头缺失显示占位（相机删除线）
    const exifLis = exifList ? Array.from(exifList.querySelectorAll('li')) : [];

    function renderExif(p) {
        if (!exifList) return;
        exifLis.forEach((li) => {
            const valueEl = li.querySelector('.exif-value');
            if (!valueEl) return;
            const key = li.dataset.exifKey;
            const value = p[key] || '';
            const missing = li.dataset.missing;
            valueEl.classList.remove('is-missing');
            if (value) {
                li.style.display = '';
                valueEl.textContent = li.dataset.format
                    ? fillTemplate(li.dataset.format, { VALUE: value })
                    : value;
            } else if (missing !== undefined) {
                li.style.display = '';
                valueEl.textContent = missing;
                if (li.dataset.missingStrike === 'true') valueEl.classList.add('is-missing');
            } else {
                li.style.display = 'none';
            }
        });
    }

    // 标题下方的分类/系列胶囊（点击跳转对应页面）：常驻标签保留，仅对新增/
    // 删除的标签做淡入淡出；标签行本身从空↔有高度折叠（见 _lightbox-panel.scss）
    const tagsInner = tagsEl ? (tagsEl.querySelector('.lightbox-tags-inner') || tagsEl) : null;

    function makeTag(t) {
        const a = document.createElement('a');
        a.className = 'lightbox-tag';
        a.href = t.url;
        a.textContent = t.text;
        a.dataset.tagKey = t.key;
        return a;
    }

    function renderTags(p) {
        if (!tagsEl || !tagsInner) return;
        // key 用标签类型而非值：分类值变化只更新文字（文字不淡出），
        // 只有系列标签等“整类标签有↔无”才走淡入/淡出
        const pills = [];
        if (p.category && p.categoryUrl) pills.push({ key: 'category', text: p.category, url: p.categoryUrl });
        if (p.series && p.seriesUrl) pills.push({ key: 'series', text: p.series, url: p.seriesUrl });
        const wanted = new Set(pills.map((t) => t.key));

        // 整类标签不再存在：先淡出；延时移除与 --transition-fade 同长
        Array.from(tagsInner.children).forEach((el) => {
            if (!el.dataset.tagKey || wanted.has(el.dataset.tagKey)) return;
            if (el.classList.contains('is-leaving')) return;
            el.classList.add('is-leaving');
            el.setAttribute('aria-hidden', 'true');
            el.tabIndex = -1;
            setTimeout(() => { if (el.isConnected) el.remove(); }, 320);
        });

        // 同类型标签复用并原位更新文字；整类新增才插入并淡入
        pills.forEach((t, i) => {
            let el = Array.from(tagsInner.children).find((node) => (
                node.dataset.tagKey === t.key && !node.classList.contains('is-leaving')
            ));
            if (!el) {
                el = makeTag(t);
                el.classList.add('is-entering');
                tagsInner.insertBefore(el, tagsInner.children[i] || null);
                void el.offsetWidth; // 先提交 entering 起点，再移除 class 触发过渡
                requestAnimationFrame(() => el.classList.remove('is-entering'));
            } else {
                if (el.getAttribute('href') !== t.url) el.href = t.url;
                if (el.textContent !== t.text) el.textContent = t.text;
            }
        });
        tagsEl.classList.toggle('is-visible', pills.length > 0);
    }

    return {
        shortLens,
        render(p) {
            setMeta(p);
            renderExif(p);
            renderTags(p);
        }
    };
}
