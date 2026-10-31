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

    // 标题下方的分类/系列胶囊（点击跳转对应页面）
    function renderTags(p) {
        if (!tagsEl) return;
        tagsEl.innerHTML = '';
        const pills = [];
        if (p.category && p.categoryUrl) pills.push({ text: p.category, url: p.categoryUrl });
        if (p.series && p.seriesUrl) pills.push({ text: p.series, url: p.seriesUrl });
        pills.forEach((t) => {
            const a = document.createElement('a');
            a.className = 'lightbox-tag';
            a.href = t.url;
            a.textContent = t.text;
            tagsEl.appendChild(a);
        });
        tagsEl.style.display = pills.length ? '' : 'none';
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
