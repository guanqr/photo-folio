/**
 * 灯箱全屏（沉浸）模式（独立模块；集成见 lightbox.js）
 *
 * - 真全屏：按钮经浏览器 Fullscreen API 让灯箱元素进入全屏（隐藏浏览器
 *   chrome），同时切换 is-fullscreen 隐藏底部缩略图条、信息面板与放大镜
 *   （主图缩放禁用，进入时经 onEnter 复位），主图占满内容区并居中；顶栏
 *   编号/播放/全屏/关闭与左右箭头保留（布局见 _lightbox-fullscreen.scss）
 * - 全屏闲置隐藏控件：静置 IDLE_HIDE_MS 后顶栏（编号/播放/全屏/关闭）、左右
 *   箭头与自动播放进度条一起淡出、光标隐藏，只留主图；指针/滚轮/键盘活动
 *   立即恢复并重新计时。纯视觉状态——进度条动画与自动播放计时照常推进，
 *   闲置中的首次点按只唤回控件、不打断自动播放（lightbox-autoplay 读取
 *   is-idle 跳过停止）
 * - API 不可用/被拒（如 iPhone Safari）时降级为纯沉浸布局，按钮仍可切换
 * - 用户经 Esc/系统退出全屏时由 fullscreenchange 同步摘掉沉浸布局
 * - 状态随切图保持；关闭灯箱只退出浏览器全屏，布局类保留到关闭动画结束，
 *   由调用方在下一次首开前 reset（面板/条恢复可见供 drawer.reset 测量）
 * - 退出沉浸布局时经 onExit 回调重算抽屉布局，并把缩略图条当前项滚回中央
 */

// 闲置隐藏的等待时长：以最后一次指针/触屏/键盘操作为起点（2026-11-01）
const IDLE_HIDE_MS = 3000;

export function initLightboxFullscreen({ lightbox, button, onEnter, onExit }) {
    if (!lightbox || !button) return { reset() {}, exit() {}, exitNative() {} };

    let active = false;
    let idle = false; // 全屏闲置态：is-idle 使顶栏/箭头/进度条淡出、光标隐藏
    let idleTimer = null;
    const canNative = typeof lightbox.requestFullscreen === 'function';
    const isOpen = () => lightbox.classList.contains('active');
    const idleInertRoots = [
        lightbox.querySelector('.lightbox-topbar'),
        lightbox.querySelector('.lightbox-arrows')
    ].filter(Boolean);

    function setIdle(next) {
        if (idle === next) return;
        idle = next;
        lightbox.classList.toggle('is-idle', next);
        // 隐藏的顶栏/箭头移出 Tab 序与读屏树；否则焦点仍在不可见按钮上，
        // Enter/Space 会激活隐藏控件（2026-11-03 审查修复）
        idleInertRoots.forEach((el) => { el.inert = next; });
        if (next && document.activeElement &&
            idleInertRoots.some((el) => el.contains(document.activeElement))) {
            document.activeElement.blur();
        }
    }

    function stopIdleTimer() {
        if (idleTimer !== null) {
            clearTimeout(idleTimer);
            idleTimer = null;
        }
    }

    function scheduleIdle() {
        stopIdleTimer();
        if (!active || !isOpen()) return;
        idleTimer = setTimeout(() => {
            idleTimer = null;
            if (!active || !isOpen()) return;
            setIdle(true);
        }, IDLE_HIDE_MS);
    }

    // 手动活动：摘除闲置态（控件淡入）并重新计时。关闭流程已先摘 .active，
    // 关闭淡出期间的 pointermove/pointerdown/wheel 不得把 is-idle 摘掉——
    // 否则隐藏的顶栏/箭头会在淡出途中被唤醒；is-idle 保留到下次 reset
    // （2026-11-03 审查修复）
    function wake() {
        if (!active || !isOpen()) return;
        setIdle(false);
        scheduleIdle();
    }

    function render() {
        lightbox.classList.toggle('is-fullscreen', active);
        button.setAttribute('aria-pressed', active ? 'true' : 'false');
        button.setAttribute('aria-label', active
            ? (button.dataset.exitLabel || '')
            : (button.dataset.enterLabel || ''));
    }

    function apply(next) {
        if (active === next) return;
        active = next;
        render();
        if (active) {
            // 进入全屏：主图缩放禁用并复位（按钮隐藏见 _lightbox-fullscreen.scss）
            if (onEnter) onEnter();
            setIdle(false);
            scheduleIdle();
        } else {
            // 退出全屏/沉浸布局：立即恢复控件并停表
            stopIdleTimer();
            setIdle(false);
        }
        // 退出：面板/条恢复可见后再重算布局
        if (!active && onExit) onExit();
    }

    // 退出：浏览器全屏时等 fullscreenchange 再摘布局（避免面板在全屏态下闪现）；
    // 纯沉浸降级（API 不可用/被拒）直接退出
    function exit() {
        if (document.fullscreenElement === lightbox) {
            document.exitFullscreen().catch(() => apply(false));
        } else if (active) {
            apply(false);
        }
    }

    // 浏览器侧全屏状态变化（Esc/系统退出、或进入全屏）：同步沉浸布局。
    // 关闭灯箱过程中的退出不摘布局类（保留到关闭动画结束，下次首开 reset）
    document.addEventListener('fullscreenchange', () => {
        if (!lightbox.classList.contains('active')) return;
        apply(document.fullscreenElement === lightbox);
    });

    // 闲置唤醒：指针移动/点按/滚轮都算活动。pointerdown 用冒泡阶段——
    // lightbox-autoplay 的 capture 监听先执行、仍能读到 is-idle，从而把全屏
    // 闲置中的首次点按只当作唤回控件、不停止自动播放（2026-11-01）
    lightbox.addEventListener('pointermove', wake, { passive: true });
    lightbox.addEventListener('pointerdown', wake);
    lightbox.addEventListener('wheel', wake, { passive: true });
    document.addEventListener('keydown', () => {
        if (isOpen()) wake();
    });

    button.addEventListener('click', (e) => {
        e.stopPropagation();
        if (active) {
            exit();
            return;
        }
        apply(true); // 先落沉浸布局；真全屏请求失败时仍保留该视图
        if (canNative) {
            lightbox.requestFullscreen().then(() => {
                // 请求期间灯箱被关闭/已退出沉浸：立刻退出，避免全屏停在隐藏灯箱上
                if (!lightbox.classList.contains('is-fullscreen') ||
                    !lightbox.classList.contains('active')) {
                    document.exitFullscreen().catch(() => {});
                }
            }).catch(() => {});
        }
    });

    return {
        // 首开前复位（上次关闭遗留的布局态）：必要时退出浏览器全屏并摘类
        reset: () => {
            stopIdleTimer();
            setIdle(false);
            if (document.fullscreenElement === lightbox) {
                document.exitFullscreen().catch(() => {});
            }
            if (active) {
                active = false;
                render();
            }
        },
        // 退出全屏/沉浸布局（Esc 与按钮共用）：有原生全屏先退原生，由
        // fullscreenchange 摘布局；降级模式直接摘布局
        exit,
        // 关闭灯箱：只退出浏览器全屏，布局类保留到关闭动画结束
        exitNative: () => {
            // 停掉闲置计时，避免关闭/淡出期间再触发隐藏（is-idle 留待下次
            // 首开 reset 统一摘除）
            stopIdleTimer();
            if (document.fullscreenElement === lightbox) {
                document.exitFullscreen().catch(() => {});
            }
        }
    };
}
