/**
 * 灯箱全屏（沉浸）模式（独立模块；集成见 lightbox.js）
 *
 * - 真全屏：按钮经浏览器 Fullscreen API 让灯箱元素进入全屏（隐藏浏览器
 *   chrome），同时切换 is-fullscreen 隐藏底部缩略图条与信息面板、主图占满
 *   内容区并居中；顶栏编号/按钮与左右箭头保留（布局见 _lightbox-fullscreen.scss）
 * - API 不可用/被拒（如 iPhone Safari）时降级为纯沉浸布局，按钮仍可切换
 * - 用户经 Esc/系统退出全屏时由 fullscreenchange 同步摘掉沉浸布局
 * - 状态随切图保持；关闭灯箱只退出浏览器全屏，布局类保留到关闭动画结束，
 *   由调用方在下一次首开前 reset（面板/条恢复可见供 drawer.reset 测量）
 * - 退出沉浸布局时经 onExit 回调重算抽屉布局，并把缩略图条当前项滚回中央
 */
export function initLightboxFullscreen({ lightbox, button, onExit }) {
    if (!lightbox || !button) return { reset() {}, exit() {}, exitNative() {} };

    let active = false;
    const canNative = typeof lightbox.requestFullscreen === 'function';

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
            if (document.fullscreenElement === lightbox) {
                document.exitFullscreen().catch(() => {});
            }
        }
    };
}
