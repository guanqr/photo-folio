/**
 * 灯箱底部缩略图条（独立模块；集成见 lightbox.js）
 *
 * - 以灯箱当前集合构建横向 strip track：等高缩略图、宽度按照片宽高比；
 *   原生横向滚动，缩略图 lazy 加载（小图宽度来自模板 data 属性，URL 从
 *   网格缩略图替换 w_ 宽度得到，保留 ?v= 内容哈希）
 * - 当前项高亮（accent 描边 + 外环、不透明；其余降透明）并滚到轨道中央；
 *   首次打开/减弱动态直切，翻页平滑跟随
 * - 点击缩略图经 onSelect(index) 交给切换管线；集合数组变化时重建
 * - 集合只有 1 张时隐藏条（与左右箭头一致），灯箱内容区高度/箭头居中随之恢复
 */
import { prefersReducedMotion } from './utils.js';

export function initLightboxStrip({ lightbox, strip, track, thumbWidth, cellLabelTemplate, onSelect }) {
    let builtFor = null; // 当前条对应的 photos 数组（集合缓存身份，变化才重建）
    let cells = [];
    let activeIndex = -1;
    let firstSync = true;

    // 小图 URL：网格缩略图的宽度段替换为条宽（绝对 URL/无宽度段时原样使用）
    const thumbUrl = (p) => (p.thumb || p.src || '').replace(/w_\d+/, `w_${thumbWidth}`);

    const build = (photos) => {
        track.textContent = '';
        cells = photos.map((p, i) => {
            const ratio = (p.width > 0 && p.height > 0) ? p.width / p.height : 1.5;
            const cell = document.createElement('button');
            cell.type = 'button';
            cell.className = 'lightbox-strip-cell';
            cell.style.setProperty('--strip-ratio', String(ratio));
            // 文案由模板 i18n 格式串注入（__N__ 占位），不在 JS 硬编码
            cell.setAttribute('aria-label', cellLabelTemplate.replace('__N__', String(i + 1)));
            cell.addEventListener('click', () => onSelect(i));
            const img = document.createElement('img');
            img.loading = 'lazy';
            img.decoding = 'async';
            img.draggable = false;
            img.alt = '';
            img.src = thumbUrl(p);
            cell.appendChild(img);
            return cell;
        });
        track.append(...cells);
        builtFor = photos;
        activeIndex = -1;
        firstSync = true;
        // 单张作品没有可切换目标：隐藏条，内容区高度与箭头居中恢复
        const hasStrip = photos.length > 1;
        strip.hidden = !hasStrip;
        lightbox.classList.toggle('has-strip', hasStrip);
    };

    // 当前项滚到轨道中央：首次打开（灯箱尚未 active）/减弱动态直切，翻页平滑跟随
    const center = (index) => {
        const cell = cells[index];
        if (!cell || strip.hidden) return;
        const trackRect = track.getBoundingClientRect();
        const cellRect = cell.getBoundingClientRect();
        const delta = (cellRect.left + cellRect.width / 2) - (trackRect.left + trackRect.width / 2);
        const behavior = firstSync || prefersReducedMotion() || !lightbox.classList.contains('active')
            ? 'auto'
            : 'smooth';
        track.scrollTo({ left: track.scrollLeft + delta, behavior });
        firstSync = false;
    };

    const sync = (photos, index) => {
        if (!photos || !photos.length) return;
        if (photos !== builtFor) build(photos);
        if (index < 0 || index >= cells.length) return;
        if (activeIndex !== index) {
            if (cells[activeIndex]) {
                cells[activeIndex].classList.remove('is-active');
                cells[activeIndex].removeAttribute('aria-current');
            }
            activeIndex = index;
            cells[index].classList.add('is-active');
            cells[index].setAttribute('aria-current', 'true');
        }
        center(index);
    };

    // 滚轮：纵向滚轮映射为横向滚动（鼠标用户）；横向滚轮交给原生。
    // 阻止冒泡——窄屏抽屉的 wheel 展开模型不得接管缩略图条
    strip.addEventListener('wheel', (e) => {
        e.stopPropagation();
        if (!e.target.closest('.lightbox-strip-track')) return;
        if (Math.abs(e.deltaX) < Math.abs(e.deltaY)) {
            e.preventDefault();
            track.scrollLeft += e.deltaY;
        }
    }, { passive: false });

    return {
        sync,
        // 全屏退出：条恢复可见后把当前项重新滚到中央（全屏中条为隐藏态，
        // center 的布局测量不生效）
        recenter: () => center(activeIndex)
    };
}
