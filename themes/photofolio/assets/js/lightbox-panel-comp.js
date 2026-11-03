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
 * 调用约定：begin 前调用方已加 no-margin-center、setFitAdjuster(true)、
 * setInputHold(true)；finish 时 helper 负责释放这些状态并完成翻转补偿。
 */
export function createPanelCenterComp({ panel, panelDetails, caption, tagsEl, drawer }) {
    if (!panel || !panelDetails) {
        return { begin: () => 0, finish() {}, cancel() {} };
    }

    const compEls = [caption, tagsEl, panelDetails].filter(Boolean);

    function cancel() {
        compEls.forEach((el) => {
            el.style.transition = '';
            el.style.transform = '';
        });
    }

    function begin(finalDetailsH) {
        // 最终组高与剩余空间（与 drawer.updateFit 的翻转判定同口径）：
        // panel.scrollHeight 含标题/胶囊与详情区，panelDetails.clientHeight 为
        // 当前可滚动窗口高；free/2 即最终居中时整组需要下移的距离
        const totalHFinal = panel.scrollHeight - panelDetails.clientHeight + finalDetailsH;
        const free = panel.clientHeight - totalHFinal;
        const dy = free > 0 ? free / 2 : 0;
        if (dy > 0 && drawer && drawer.fitApplicable() && !panel.classList.contains('is-fit')) {
            compEls.forEach((el) => {
                el.style.transition = 'transform 0.6s ease'; // 与内容收缩同曲线同时长
                el.style.transform = `translateY(${dy}px)`;
            });
        }
        return dy;
    }

    function finish() {
        if (drawer) {
            drawer.setInputHold(false);
            drawer.setFitAdjuster(false);
        }
        const visualBefore = caption ? caption.getBoundingClientRect().top : 0;
        cancel();
        panelDetails.classList.remove('no-margin-center');
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
                    el.style.transition = 'transform 0.3s ease';
                    el.style.transform = '';
                });
            }
        }
        if (drawer) drawer.refresh();
    }

    return { begin, finish, cancel };
}
