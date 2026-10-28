/**
 * 灯箱分析区开合控制（独立模块；集成见 lightbox.js）
 *
 * - 开合状态以 wrap 的 is-open 类为唯一事实源（默认收起、展开态跨切图/关开
 *   保持——用户已选择查看分析，后续打开延续该选择）；setOpen 展开/收起
 *   （max-height + opacity 过渡、双内联起点值、transitionend 收尾、
 *   reduced-motion 直切），reset 为关闭灯箱时的静默重置（不带动画、不发请求）
 * - 桌面收起改「滚动 + 居中同窗并发」（打开动作的逆向，2026-10-20 用户
 *   确认方案）：收起窗口内经 drawer.setFitAdjuster 冻结 is-fit 翻转——详情区
 *   保持可滚动、scrollToTop 回滚动画真实生效（内容随收缩平滑回顶）；同时
 *   整组以最终居中偏移 transform 下滑（与收缩同曲线同时长 0.6s）；过渡结束
 *   同帧交换为真实 is-fit 居中（先清 transform 再翻转、实测残余 0.3s 吸收，
 *   零瞬跳）；仅桌面生效且收起前未居中时下滑；放不下时不翻转不滑动
 * - 收起期间经 drawer.setInputHold 挂起滚轮输入：点击收起后仍在到达的旧手势
 *   惯性尾会瞬跳在途回滚/拉低抽屉 level，刻意编排不被旧手势接管；finish/
 *   展开/重置解除
 * - 展开时分析当前照片由调用方注入 analyze 回调（本模块不认识切换管线；
 *   分析本体为管线预计算结果拉取与渲染，见 lightbox-analysis.js）
 */
export function initLightboxAnalysisControl({
    trigger, wrap, caption, tagsEl, panelDetails, panel,
    reducedMotion, drawer, analyze
}) {
    // 四项分析区块全关时模板不渲染 trigger/wrap：调用方仍会构造控制器，
    // 这里返回空实现，避免 getComputedStyle(null) 抛错中断 initLightbox
    // 后续的 masonry / 无限滚动 / 筛选等页面模块
    if (!trigger || !wrap) {
        return { setOpen() {}, reset() {}, cancelCenterComp() {} };
    }
    // 同窗居中下滑载体：标题/标签/详情区的 transform 过渡（合成器驱动、零
    // 逐帧重排——margin 版每帧整面板 reflow，与滚动/收缩叠加成重绘抖动、
    // 观感残影）；transform 会扩展祖先 scrollable overflow，交换时刻必须
    // 先清 transform 再翻转（见 transitionend 处理：同任务无绘制、视觉连续
    // 且 is-fit 判定读到干净布局）
    const compEls = [caption, tagsEl, panelDetails].filter(Boolean);
    function cancelCenterComp() {
        compEls.forEach((el) => { el.style.transition = ''; el.style.transform = ''; });
    }
    // 触发行的收起态完整足迹（内容高 + margin + padding）：模块初始化时分析区
    // 处于收起态、触发行完整可见——一次性实测缓存供收起路径的组高预测使用；
    // 收起路径不再临时摘类测量（transition:none 会把在途的 0.6s 复现过渡
    // 直接落位终态、触发行瞬弹约 2.6em，2026-10-21 审查修复 #3）
    const triggerCs = getComputedStyle(trigger);
    const triggerFootprint = trigger.offsetHeight + parseFloat(triggerCs.marginTop) + parseFloat(triggerCs.marginBottom);
    // 收起收尾的槽位（transitionend/transitioncancel 监听 + 超时兜底定时器）——
    // 幽灵监听教训：可拆可作废；展开/重置/新一轮收起前先作废旧收尾
    let collapseEndHandler = null;
    let collapseEndTimer = null;
    const teardownCollapseEnd = () => {
        if (collapseEndHandler) {
            wrap.removeEventListener('transitionend', collapseEndHandler);
            wrap.removeEventListener('transitioncancel', collapseEndHandler);
            collapseEndHandler = null;
        }
        if (collapseEndTimer !== null) {
            clearTimeout(collapseEndTimer);
            collapseEndTimer = null;
        }
    };

    function setOpen(open) {
        if (!trigger || !wrap) return;
        trigger.setAttribute('aria-expanded', open ? 'true' : 'false');
        trigger.classList.toggle('is-open', open);
        // 清除 revealSynced 写入的内联 opacity（内联压过 .is-open 的类级 opacity，
        // 不清理则触发行收起只有裁剪没有淡出）
        trigger.style.opacity = '';
        // 收起前显式移出子树内焦点：点击收起按钮的焦点若留在 wrap 内，
        // aria-hidden 生效时 Chrome 报「Blocked aria-hidden」并阻断隐藏——
        // inert 的焦点移出在部分浏览器同帧 a11y 更新之后才生效、时序不可靠，
        // 显式 blur 同步确定（2026-10-20）；inert 一并保留（Tab 序兜底）
        if (!open && wrap.contains(document.activeElement)) document.activeElement.blur();
        wrap.inert = !open;
        wrap.setAttribute('aria-hidden', open ? 'false' : 'true');
        if (open) {
            // 展开：清除收起留下的内联 max-height，走 class 兜底大值过渡；
            // 图表区照常展示（空图表框即占位，不额外显示加载指示），数据就绪后填充；
            // 触发行随开合平滑收拢（纯 CSS），展开方向无 t=0 布局跳变
            teardownCollapseEnd(); // 收起中途再展开：作废在途收尾（否则在展开过渡结束时重放）
            drawer.setFitAdjuster(false); // 清除收起窗口的冻结，按实际高度逐帧重判
            drawer.setInputHold(false); // 收起中途再展开：一并解除输入挂起
            cancelCenterComp(); // 停止滑入/补偿、摘除 transform
            if (panelDetails) panelDetails.classList.remove('no-margin-center'); // 展开清除收起窗口的顶对齐态
            drawer.cancelScroll(); // 取消收起启动的回滚动画（2026-10-18：不取消则展开期间仍逐帧强制 scrollTop 归零、覆盖用户滚动）
            wrap.style.maxHeight = '';
            wrap.classList.add('is-open');
            analyze(); // 展开即分析当前照片（调用方注入：展开态拉取预计算结果、结果入缓存）
        } else {
            // 收起：过渡起点用双内联值（实测高度 px → 0px）：与 class 移除
            // 同帧提交时过渡会从 class 的 80em 旧值起算、前段高度纹丝不动
            // （启动延迟），内联起点值经强制 reflow 提交后不再受干扰；
            // 过渡结束清除内联值、恢复 class 的 0 基线；reduced-motion 直切
            if (reducedMotion) {
                wrap.style.maxHeight = '';
                wrap.classList.remove('is-open');
                drawer.setFitAdjuster(false);
            } else {
                teardownCollapseEnd(); // 快速连点：作废上一轮的收尾再开始新一轮
                wrap.style.maxHeight = wrap.clientHeight + 'px';
                void wrap.offsetHeight; // 强制 reflow：内联起点值先提交
                wrap.style.maxHeight = '0px';
                wrap.classList.remove('is-open'); // opacity 随同淡出
                // 滚动 + 居中同窗并发（打开动作的逆向）：收起窗口内冻结 is-fit
                // （详情区保持可滚动、回滚动画真实生效）并保持内容顶对齐
                // （no-margin-center——内部边距居中会让 EXIF 出现先居中再上跳
                // 的两段运动）；同时整组以最终居中偏移 transform 下滑（与收缩
                // 同曲线同时长）；过渡结束同帧交换为真实 is-fit 居中（相消零跳变）
                if (panelDetails) panelDetails.classList.add('no-margin-center');
                // 冻结 is-fit 翻转（布尔语义，见 drawer.setFitAdjuster）
                drawer.setFitAdjuster(true);
                // 挂起滚轮输入：收起编排期间 wheel 整链早退——点击收起后
                // 仍在到达的旧手势惯性尾会经 cancelScrollAnim 把在途回滚瞬跳
                // 归零（桌面）、并驱动抽屉 level 拉低（窄屏），刻意编排不被
                // 旧手势接管（2026-10-21；finish/展开/reset 解除）
                drawer.setInputHold(true);
                // 居中偏移按最终组高推导（与 updateFit 翻转判定同口径，2026-10-21）：
                // 当前详情区 scrollHeight（含边距）− wrap 当前高 + 触发行最终足迹 −
                // 触发行当前盒（is-open 刚摘、过渡起点值 ≈ 0）——与翻转实测同一组量、
                // 残余归零（原 offsetHeight 逐块求和漏外边距、整数取整，差值经 0.3s
                // 补偿吸收呈「滑过头再上移」）；预测仅作滑行引导，终态由交换时刻的
                // 实测残余校正兜底
                if (panelDetails) {
                    const cs = getComputedStyle(trigger);
                    const finalDetailsH = panelDetails.scrollHeight
                        - wrap.clientHeight
                        + (triggerFootprint - trigger.offsetHeight
                            - parseFloat(cs.marginTop)
                            - parseFloat(cs.marginBottom));
                    const totalHFinal = panel.scrollHeight - panelDetails.clientHeight + finalDetailsH;
                    const free = panel.clientHeight - totalHFinal;
                    const dy = free > 0 ? free / 2 : 0;
                    // 下滑仅桌面生效（窄屏 is-fit 永不翻转、下滑只会被残余补偿弹回）
                    // 且仅当收起前未居中（已 is-fit 时整组本就居中，下滑会滑过头
                    // 再回弹）（2026-10-21 审查修复 #1/#9）
                    if (dy > 0 && drawer.fitApplicable() && !panel.classList.contains('is-fit')) {
                        compEls.forEach((el) => {
                            el.style.transition = 'transform 0.6s ease'; // 与收缩/滚动同曲线同时长（0.6s 全窗，2026-10-20 按用户要求放缓）
                            el.style.transform = `translateY(${dy}px)`;
                        });
                    }
                }
                // 收尾（幂等、槽位可拆）：释放冻结 → 交换为真实 is-fit 居中。
                // 触发源三个：max-height 的 transitionend、transitioncancel
                // （过渡被全站压制/减弱动态取消时无 end 事件，2026-10-21 审查
                // 修复 #2）、650ms 超时兜底——三路互斥，finish 先拆自身再执行；
                // 展开/重置路径经 teardownCollapseEnd 作废在途收尾（幽灵监听教训）
                const finish = () => {
                    teardownCollapseEnd();
                    wrap.style.maxHeight = ''; // 清除内联、恢复 class 的 0 基线
                    drawer.setInputHold(false); // 解除输入挂起（与释放冻结同任务，无中途派发）
                    drawer.setFitAdjuster(false); // 释放冻结
                    // 交换：先清 transform（判定读干净布局）→ 翻转到居中；滑行
                    // 预测的残余经实测校正——翻转前记视觉位、翻转后以残余
                    // transform 拉回（同任务无绘制、零瞬跳），再 0.3s 平滑吸收
                    const visualBefore = caption ? caption.getBoundingClientRect().top : 0;
                    cancelCenterComp();
                    if (panelDetails) panelDetails.classList.remove('no-margin-center');
                    drawer.flipFitNow(); // 翻转 is-fit（整组居中）
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
                    drawer.refresh(); // 内容高度已变：窄屏抽屉箭头状态补判（t=0 时高度未变、判的是旧态）
                };
                collapseEndHandler = (e) => {
                    if (e.type === 'transitionend' && e.propertyName !== 'max-height') return; // opacity 结束不处理
                    finish();
                };
                wrap.addEventListener('transitionend', collapseEndHandler);
                wrap.addEventListener('transitioncancel', collapseEndHandler);
                collapseEndTimer = setTimeout(finish, 650);
            }
            // 内容同步回滚到顶部：与收起过渡同曲线同时长锁步（cssEaseY =
            // CSS ease），收起过程中视口跟随内容收缩上移，不残留空白等待区
            drawer.scrollToTop(reducedMotion ? 0 : 600); // 0.6s 与收缩/下滑同窗锁步
        }
        drawer.refresh(); // 内容高度变化：刷新箭头状态（桌面 is-fit 由 ResizeObserver 重判）
    }

    // 关闭灯箱时静默重置分析区为收起态（不带动画、不发请求）：下次打开
    // 延续「默认收起、点击才加载」的按需约定；同会话切图仍保持展开态
    function reset() {
        if (!trigger || !wrap) return;
        trigger.setAttribute('aria-expanded', 'false');
        trigger.classList.remove('is-open');
        if (wrap.contains(document.activeElement)) document.activeElement.blur(); // 同 setOpen：显式移出焦点
        wrap.setAttribute('aria-hidden', 'true');
        wrap.inert = true; // 关闭灯箱静默重置：与模板初始态一致（2026-10-20）
        wrap.classList.remove('is-open');
        wrap.style.maxHeight = ''; // 清除开合残留内联
        teardownCollapseEnd(); // 关闭中断在途收尾
        cancelCenterComp(); // 关闭中断在途的滑入/补偿
        if (panelDetails) panelDetails.classList.remove('no-margin-center'); // 关闭清除收起窗口的顶对齐态
        drawer.setInputHold(false); // 关闭中断在途收起：解除输入挂起
        drawer.setFitAdjuster(false);
    }

    return { setOpen, reset, cancelCenterComp };
}
