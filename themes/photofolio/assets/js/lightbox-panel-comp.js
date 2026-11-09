/**
 * 灯箱详情区收起居中补偿（图像分析与觀鳥圖鑑共用）
 *
 * 桌面收起时内容从「超出面板、可滚动」缩回「放得下、整体居中」：若直接
 * 翻转 is-fit，标题/胶囊会在一帧内跳到居中位置（观鸟图鉴实测 182px）；
 * 图像分析采用的方案是：过渡窗口内冻结 is-fit（保持非居中、详情区仍可
 * 滚动），整组按最终剩余空间的一半做 transform 下滑，与内容收缩同曲线；
 * 过渡结束释放冻结、翻转 is-fit，并用同一任务内的残余 transform 拉回，
 * 再做 0.3s 吸收，翻转本身零瞬跳。2026-11-03 自 lightbox-analysis-control
 * 抽出，供图鉴收起复用。
 *
 * 调用约定：调用方在 begin 前给出最终详情区高度（窄屏不做补偿、不可调用）；
 * 顶对齐/冻结/输入挂起由 begin 经引用计数统一获取，finish/cancel 统一释放并
 * 完成翻转补偿。slideTransition 为下滑时长——默认与图像分析收起同长
 * （0.6s），觀鳥圖鑑收起用 fast 档（0.4s），调用方须与该块自身的高度/透明度
 * 过渡一致，否则会先滑到位再等残余补偿（2026-11-10 审查 #29）。
 */
// 共享收起冻结/输入挂起/顶对齐的引用计数：图像分析与觀鳥圖鑑各自持有 helper，
// 但作用于同一 panel/panelDetails；一侧 finish/cancel 不得提前释放另一侧仍在
// 进行的收起（2026-11-10 审查 #20）
let holdCount = 0;
function acquireHold(drawer, panelDetails) {
    holdCount += 1;
    if (holdCount === 1) {
        if (drawer) {
            drawer.setFitAdjuster(true);
            drawer.setInputHold(true);
        }
        if (panelDetails) panelDetails.classList.add('no-margin-center');
    }
}
function releaseHold(drawer, panelDetails) {
    holdCount = Math.max(0, holdCount - 1);
    if (holdCount === 0) {
        if (drawer) {
            drawer.setFitAdjuster(false);
            drawer.setInputHold(false);
        }
        if (panelDetails) panelDetails.classList.remove('no-margin-center');
    }
}

export function createPanelCenterComp({
    panel, panelDetails, caption, tagsEl, drawer,
    slideTransition = 'var(--transition-reveal)'
}) {
    if (!panel || !panelDetails) {
        return { begin: () => 0, finish() {}, cancel() {} };
    }

    const compEls = [caption, tagsEl, panelDetails].filter(Boolean);
    let held = false;

    function cancel() {
        // 只有本实例真正 begin 过才清 transform / 释放（非活跃实例的 cancel
        // 不得抹掉另一侧正在进行的收起）
        if (!held) return;
        held = false;
        compEls.forEach((el) => {
            el.style.transition = '';
            el.style.transform = '';
        });
        releaseHold(drawer, panelDetails);
    }

    function begin(finalDetailsH) {
        if (!held) {
            held = true;
            acquireHold(drawer, panelDetails);
        }
        // 最终组高与剩余空间（与 drawer.updateFit 的翻转判定同口径）：
        // panel.scrollHeight 含标题/胶囊与详情区，panelDetails.clientHeight 为
        // 当前可滚动窗口高；free/2 即最终居中时整组需要下移的距离
        const totalHFinal = panel.scrollHeight - panelDetails.clientHeight + finalDetailsH;
        const free = panel.clientHeight - totalHFinal;
        const dy = free > 0 ? free / 2 : 0;
        if (dy > 0 && drawer && drawer.fitApplicable() && !panel.classList.contains('is-fit')) {
            compEls.forEach((el) => {
                el.style.transition = `transform ${slideTransition}`; // 与调用方内容收起同曲线同时长
                el.style.transform = `translateY(${dy}px)`;
            });
        }
        return dy;
    }

    function finish() {
        if (!held) return;
        const visualBefore = caption ? caption.getBoundingClientRect().top : 0;
        // cancel 统一清除 transform 并 releaseHold：仅当最后一个持有者结束时
        // 才解冻/解除输入挂起/摘除顶对齐，避免另一侧收起中途被提前解冻
        cancel();
        if (drawer) drawer.flipFitNow();
        // 翻转前记录视觉位、翻转后以残余 transform 拉回（同一任务无绘制、
        // 零瞬跳），再 0.3s 平滑吸收
        if (caption) {
            const residual = visualBefore - caption.getBoundingClientRect().top;
            if (Math.abs(residual) > 0.5) {
                compEls.forEach((el) => {
                    el.style.transition = 'none';
                    el.style.transform = `translateY(${residual}px)`;
                });
                void caption.offsetHeight; // 提交起点
                compEls.forEach((el) => {
                    el.style.transition = 'transform var(--transition-fade)';
                    el.style.transform = '';
                });
            }
        }
        if (drawer) drawer.refresh();
    }

    return { begin, finish, cancel };
}
