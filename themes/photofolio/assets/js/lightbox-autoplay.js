/**
 * 灯箱自动播放（独立模块；集成见 lightbox.js）
 *
 * - 顶栏播放/暂停按钮：默认关闭；用户主动开始后按配置间隔自动 next
 *   （末张由切换管线的 next 回绕循环）。集合 ≤1、间隔 ≤0 或系统减弱动态时
 *   隐藏按钮（不自动播放）
 * - 主图未加载完成时不开始计时：open 触发 photoChanged，切换管线在主图
 *   全尺寸加载完成/失败时触发 photoReady；加载期间进度条隐藏、不计入
 *   当前图片的播放时长，就绪后才开始完整间隔
 * - 任意手动操作立即停止：指针/滚轮在 capture 阶段先于目标处理，键盘监听
 *   在 document（播放按钮自身的操作除外）；页面隐藏暂停计时、回到前台恢复
 * - 灯箱关闭由调用方 stop() 复位；状态不跨打开保留
 */
import { prefersReducedMotion } from './utils.js';

export function initLightboxAutoplay({ button, lightbox, next, intervalMs }) {
    if (!button || !lightbox) {
        return { photoChanged() {}, photoReady() {}, stop() {}, isPlaying: () => false };
    }

    let playing = false;
    let timer = null;
    // 当前照片主图是否仍在加载：加载期间不计时；photoChanged 置真，
    // photoReady（主图全尺寸加载完成/失败）置假并启动计时
    let loading = true;
    let pendingIndex = -1;
    let awaitingReady = false; // 同一照片的 photoReady 只接受一次（防重复/陈旧）
    const interval = Math.max(0, Number(intervalMs) || 0);
    const playLabel = button.dataset.playLabel || '';
    const pauseLabel = button.dataset.pauseLabel || '';

    // 顶部时间进度条：与计时器同起同停；加载期间隐藏，就绪后重置填充
    const progressEl = lightbox.querySelector('.lightbox-autoplay-progress');
    const progressFill = progressEl ? progressEl.querySelector('.lightbox-autoplay-progress-fill') : null;
    if (progressEl) progressEl.style.setProperty('--lightbox-autoplay-duration', `${interval}ms`);

    const hideProgress = () => {
        if (!progressEl) return;
        progressEl.classList.remove('is-visible', 'is-running');
    };

    const restartProgress = () => {
        if (!progressEl || !progressFill) return;
        progressEl.classList.add('is-visible');
        progressEl.classList.remove('is-running');
        void progressFill.offsetWidth; // 提交归零，重新触发填充动画
        progressEl.classList.add('is-running');
    };

    const syncButton = () => {
        button.setAttribute('aria-pressed', playing ? 'true' : 'false');
        button.setAttribute('aria-label', playing ? pauseLabel : playLabel);
    };

    const clearTimer = () => {
        if (timer !== null) {
            clearTimeout(timer);
            timer = null;
        }
    };

    const schedule = () => {
        clearTimer();
        if (!playing || loading || document.hidden || !lightbox.classList.contains('active')) return;
        timer = setTimeout(() => {
            timer = null;
            if (!playing || loading || document.hidden || !lightbox.classList.contains('active')) return;
            // 切到下一张：open 的 photoChanged 会隐藏进度条并暂停计时，
            // 新图完全加载后由 photoReady 重新开始完整间隔
            next();
        }, interval);
    };

    const stop = () => {
        playing = false;
        clearTimer();
        syncButton();
        hideProgress();
    };

    const start = () => {
        if (playing || interval <= 0 || button.hidden || !lightbox.classList.contains('active')) return;
        playing = true;
        syncButton();
        // 当前图片尚未加载完成：不计时，等 photoReady 再开始
        if (!loading) {
            restartProgress();
            schedule();
        }
    };

    // 照片切换入口（open 时调用）：更新按钮可用性，进入加载等待
    const photoChanged = (count, index) => {
        const available = interval > 0 && count > 1 && !prefersReducedMotion();
        button.hidden = !available;
        if (!available) stop();
        pendingIndex = index;
        awaitingReady = true;
        loading = true;
        clearTimer();
        hideProgress();
    };

    // 主图全尺寸加载完成/失败（切换管线调用）：同一照片只接受一次；
    // 若正在播放，从此刻开始当前图片的完整播放间隔
    const photoReady = (index) => {
        if (index !== pendingIndex || !awaitingReady) return;
        awaitingReady = false;
        loading = false;
        if (!playing || document.hidden || !lightbox.classList.contains('active')) return;
        restartProgress();
        schedule();
    };

    button.addEventListener('click', () => {
        if (playing) stop();
        else start();
    });

    // 用户一旦操作灯箱（播放/全屏按钮除外——纯视图切换、不切图）立即停止；
    // capture 先于目标处理
    lightbox.addEventListener('pointerdown', (e) => {
        if (!playing) return;
        if (e.target.closest && (e.target.closest('.lightbox-autoplay') || e.target.closest('.lightbox-fullscreen'))) return;
        stop();
    }, true);
    lightbox.addEventListener('wheel', (e) => {
        if (!playing) return;
        if (e.target.closest && (e.target.closest('.lightbox-autoplay') || e.target.closest('.lightbox-fullscreen'))) return;
        stop();
    }, { capture: true, passive: true });
    document.addEventListener('keydown', (e) => {
        if (!playing || !lightbox.classList.contains('active')) return;
        if (e.target instanceof Element && (e.target.closest('.lightbox-autoplay') || e.target.closest('.lightbox-fullscreen'))) return;
        stop();
    });

    // 后台标签页暂停计时；回到前台且当前图已就绪时从 0 恢复计时与进度条
    document.addEventListener('visibilitychange', () => {
        if (!playing) return;
        if (document.hidden) {
            clearTimer();
            hideProgress();
        } else if (!loading) {
            restartProgress();
            schedule();
        }
    });

    syncButton();
    button.hidden = true; // 集合数量未知前保持隐藏

    return { photoChanged, photoReady, stop, isPlaying: () => playing };
}
