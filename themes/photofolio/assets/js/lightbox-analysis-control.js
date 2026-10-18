/**
 * 灯箱分析区开合控制（独立模块；集成见 lightbox.js）
 *
 * - 开合状态以 wrap 的 is-open 类为唯一事实源（默认收起、展开态跨切图/关开
 *   保持——用户已选择查看分析，后续打开延续该选择）；setOpen 展开/收起
 *   （max-height + opacity 过渡、双内联起点值、transitionend 收尾、
 *   reduced-motion 直切），reset 为关闭灯箱时的静默重置（不带动画、不发请求）
 * - 收起位置补偿：is-fit 翻转会把内容从「顶对齐」瞬时重排为「居中裁切」，
 *   标题/标签在 t=0 出现向上跳变——点击前测出标题实际位置，transform 整体
 *   补偿到该位置消除跳变；补偿量随收起进度锁步归零，标题从点击前位置平滑
 *   滑向最终居中位、与图表收缩同段动画。进度从 wrapper 高度恢复（max-height
 *   的 ease 曲线进度 = 1 − 当前高/初始高，与过渡天然锁步，无需另算缓动）。
 *   补偿量为纯实测驱动（此前按 offsetHeight 整数舍入推导、残留约 8px 上跳）：
 *   rect（小数精确）减去当前 dy 反推真实布局位；最终居中位由布局位逐帧实测
 *   估计（内容仅随分析区收缩：L_end = L + (1−p)·w0/2 为几何恒等式）——起点
 *   精确连续（p=0 时 dy = T0 − rect）、终点补偿恰好归零（p=1 时 dy = 0）
 * - 展开时分析当前照片由调用方注入 analyze 回调（本模块不认识切换管线）
 */
export function initLightboxAnalysisControl({
    trigger, wrap, caption, tagsEl, panelDetails,
    reducedMotion, drawer, analyze
}) {
    let centerCompRaf = null;
    let centerCompDy = 0;
    function cancelCenterComp() {
        if (centerCompRaf !== null) {
            cancelAnimationFrame(centerCompRaf);
            centerCompRaf = null;
        }
        centerCompDy = 0;
        [caption, tagsEl, panelDetails].forEach((el) => { if (el) el.style.transform = ''; });
    }
    function startCenterComp(preClickTop) {
        cancelCenterComp();
        if (!caption) return;
        const compEls = [caption, tagsEl, panelDetails].filter(Boolean);
        const wrapH0 = wrap.clientHeight; // 收起前分析区高度（过渡起点）
        if (wrapH0 <= 0 || compEls.length === 0) return;
        const step = () => {
            const wrapH = wrap.clientHeight;
            const progress = 1 - wrapH / wrapH0;
            const rect = caption.getBoundingClientRect().top;
            const dy = (1 - progress) * (preClickTop - rect + centerCompDy + progress * wrapH0 / 2);
            centerCompDy = dy;
            compEls.forEach((el) => { el.style.transform = `translateY(${dy}px)`; });
            if (wrapH > 0.5) {
                centerCompRaf = requestAnimationFrame(step);
            } else {
                centerCompRaf = null;
                centerCompDy = 0;
                compEls.forEach((el) => { el.style.transform = ''; });
            }
        };
        step(); // 第一帧同步落位（点击当帧即连续，不闪跳变）；同步 step 内已排后续 rAF，不得再排一条——双链会让 cancelCenterComp 无法全取消
    }

    function setOpen(open) {
        if (!trigger || !wrap) return;
        // 收起前标题位置：触发行即将复现（展开时触发行是平滑收拢，不收布局
        // 跳变；收起时 is-open 移除令其回归布局、居中块位移约半行）——须在
        // 触发行 class 切换前实测（切换后旧位置即丢失），供收起补偿回原位
        const preClickTop = !open && caption && !reducedMotion
            ? caption.getBoundingClientRect().top
            : null;
        trigger.setAttribute('aria-expanded', open ? 'true' : 'false');
        trigger.classList.toggle('is-open', open);
        // 清除 revealSynced 写入的内联 opacity（内联压过 .is-open 的类级 opacity，
        // 不清理则触发行收起只有裁剪没有淡出）
        trigger.style.opacity = '';
        wrap.setAttribute('aria-hidden', open ? 'false' : 'true');
        if (open) {
            // 展开：清除收起留下的内联 max-height，走 class 兜底大值过渡；
            // 图表区照常展示（空图表框即占位，不额外显示加载指示），数据就绪后填充；
            // 触发行随开合平滑收拢（纯 CSS），展开方向无 t=0 布局跳变、无需补偿
            drawer.setFitAdjuster(null); // 清除收起期间的高度扣除，按实际高度逐帧重判
            cancelCenterComp(); // 收起中途再展开：停止收起补偿、摘除 transform
            drawer.cancelScroll(); // 取消收起启动的回滚动画（2026-10-18：不取消则展开期间仍逐帧强制 scrollTop 归零、覆盖用户滚动）
            wrap.style.maxHeight = '';
            wrap.classList.add('is-open');
            analyze(); // 展开即分析当前照片（调用方注入：展开态发探测、结果入缓存）
        } else {
            // 收起：纯对称收缩（展开的逆向）——is-fit 提前挂上后 unsafe center +
            // 面板裁切让整块内容（含顶部 EXIF）从第一帧起以中心为轴同速向中心
            // 收拢，恰为展开动作的镜像。过渡起点用双内联值（实测高度 px → 0px）：
            // 与 class 移除同帧提交时过渡会从 class 的 80em 旧值起算、前段高度
            // 纹丝不动（启动延迟），内联起点值经强制 reflow 提交后不再受干扰；
            // 过渡结束清除内联值、恢复 class 的 0 基线（内联恒压过 class，
            // 不清除会残留占位高度）；reduced-motion 下直切、无需内联定值
            if (reducedMotion) {
                wrap.style.maxHeight = '';
                wrap.classList.remove('is-open');
            } else {
                // 标题滚动出画面时 preClickTop 为负值，补偿自动保持其不可见、
                // 视口表现为返回顶部
                wrap.style.maxHeight = wrap.clientHeight + 'px';
                void wrap.offsetHeight; // 强制 reflow：内联起点值先提交
                wrap.style.maxHeight = '0px';
                wrap.classList.remove('is-open'); // opacity 随同淡出
                // 「放得下」立即判定：按收起后的最终总高（扣除正在收缩的分析区
                // 当前高度与正在复现的触发行高度——两者同步动画、合计恒等于
                // 最终总高的变化量）重判 is-fit——放得下则从第一帧起居中收缩、
                // 标题从点击前位置平滑滑向居中位（位置补偿消除翻转瞬间的向上跳变）
                const willFit = drawer.setFitAdjuster(() =>
                    wrap.clientHeight + trigger.offsetHeight);
                if (willFit && preClickTop !== null) startCenterComp(preClickTop);
                wrap.addEventListener('transitionend', function collapseEnd(e) {
                    if (e.propertyName !== 'max-height') return; // opacity 结束不处理
                    wrap.removeEventListener('transitionend', collapseEnd);
                    wrap.style.maxHeight = ''; // 清除内联、恢复 class 的 0 基线
                    drawer.setFitAdjuster(null); // 收起完成：恢复常规判定
                    cancelCenterComp(); // 滑动至最终居中位：摘除 transform（布局已居中）
                    drawer.refresh(); // 内容高度已变：窄屏抽屉箭头状态补判（t=0 时高度未变、判的是旧态）
                });
            }
            // 内容同步回滚到顶部：与收起过渡同曲线同时长锁步（cssEaseY =
            // CSS ease），收起过程中视口跟随内容收缩上移，不残留空白等待区
            drawer.scrollToTop(reducedMotion ? 0 : 400);
        }
        drawer.refresh(); // 内容高度变化：刷新箭头状态（桌面 is-fit 由 ResizeObserver 重判）
    }

    // 关闭灯箱时静默重置分析区为收起态（不带动画、不发请求）：下次打开
    // 延续「默认收起、点击才加载」的按需约定；同会话切图仍保持展开态
    function reset() {
        if (!trigger || !wrap) return;
        trigger.setAttribute('aria-expanded', 'false');
        trigger.classList.remove('is-open');
        wrap.setAttribute('aria-hidden', 'true');
        wrap.classList.remove('is-open');
        wrap.style.maxHeight = ''; // 清除开合残留内联
        drawer.setFitAdjuster(null);
        cancelCenterComp();
    }

    return { setOpen, reset, cancelCenterComp };
}
