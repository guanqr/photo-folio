/**
 * 灯箱元信息面板渲染（独立模块；集成见 lightbox.js）
 *
 * - 地点/日期简行、EXIF 分行列表、标题下方分类/系列胶囊——由照片对象填充；
 *   标题（caption）单行文本仍由 lightbox.js 直接写入
 * - 镜头型号展示缩减：仅保留到光圈值（f/x-x）为止，其后的字母/系列后缀
 *   （VR、S、Di III VC VXD…）不展示——photo.toml 原始记录不动，仅灯箱展示截断
 * - EXIF 行结构（图标/标签）由模板渲染，这里只填值——行配置与 li 列表
 *   恒定，初始化时一次建好，切图时不再重建
 */
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
    // 普通项空值隐藏；设备（相机）缺失时显示删除线占位「—」、
    // 镜头缺失时以英文 N/A 表示——删除线在长型号旁视觉不佳
    const exifRows = [
        { key: 'camera', value: '', prefix: '', suffix: '', showMissing: true },
        { key: 'lens', value: '', prefix: '', suffix: '', showMissing: true, missingText: 'N/A' },
        { key: 'focus', value: '', prefix: '', suffix: 'mm' },
        { key: 'aperture', value: '', prefix: 'f/', suffix: '' },
        { key: 'shutter', value: '', prefix: '', suffix: 's' },
        { key: 'iso', value: '', prefix: 'ISO', suffix: '' }
    ];
    const exifLis = exifList ? Array.from(exifList.querySelectorAll('li')) : [];

    function renderExif(p) {
        if (!exifList) return;
        exifLis.forEach((li) => {
            const row = exifRows.find((r) => r.key === li.dataset.exifKey);
            const valueEl = li.querySelector('.exif-value');
            if (!row) {
                li.style.display = 'none';
                return;
            }
            const value = p[row.key] || '';
            valueEl.classList.remove('is-missing');
            if (value) {
                li.style.display = '';
                valueEl.textContent = row.prefix + value + row.suffix;
            } else if (row.showMissing) {
                li.style.display = '';
                valueEl.textContent = row.missingText || '—';
                if (!row.missingText) valueEl.classList.add('is-missing');
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
