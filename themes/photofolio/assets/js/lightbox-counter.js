/**
 * 灯箱当前照片编号（左上角）：显示 001/050 形式的集合索引/总数。
 *
 * 可见格式与无障碍标签来自模板 data 属性（i18n 格式串经哨兵占位传入），
 * 本模块只替换数值，不在 JS 里拼展示字面量；索引/总数由切换管线
 * onPhotoOpen 注入（打开/切图/深链同一入口），关闭时清空。
 */
export function initLightboxCounter({ el }) {
    if (!el) return { update() {}, reset() {} };

    // 三位补零（超过三位自然增长）；无障碍标签用不补零的原始数值
    const pad = (n) => String(n).padStart(3, '0');
    const fill = (template, current, total) => template
        .replace('%CUR%', current)
        .replace('%TOTAL%', total);

    function reset() {
        el.textContent = '';
        el.removeAttribute('aria-label');
    }

    function update(index, total) {
        if (index < 0 || total <= 0) {
            reset();
            return;
        }
        el.textContent = fill(el.dataset.format || '', pad(index + 1), pad(total));
        const labelFormat = el.dataset.labelFormat;
        if (labelFormat) {
            el.setAttribute('aria-label', fill(labelFormat, index + 1, total));
        } else {
            el.removeAttribute('aria-label');
        }
    }

    return { update, reset };
}
