/**
 * 灯箱元信息底部抽屉（窄屏/中屏 ≤1000px——与瀑布流宽屏档位 >1000px 衔接）
 *
 * 收起态：详情区仅露出地点/日期简行（默认可见）；展开态：完整详情，
 * 上限 = 50% 视口 − 面板头部（图片区域不小于页面一半）。
 * 交互：滚轮 / 长按拖动渐进控制展开程度；底部箭头点击全开抽屉（不做滚动定位，
 * 能展开到哪里算哪里），箭头仅在内容到达绝对底部时翻转——翻转后点击回到顶部，
 * 内容以回滚动画随抽屉合拢（与 max-height 过渡同曲线同时长，rAF 驱动 scrollTop）；
 * 视口高度变化时已展开的上限按新 50% 视口重夹（面板总长不随窗口缩小挤占图片区）；
 * 详情内容仅在全开后可滚动，地点/日期随内容滚动（仅标题固定）。
 * 桌面端：不干预（reset 时清除窄屏残留的内联样式，恢复宽屏详情常显）。
 * 分析区收起期间输入挂起（setInputHold，由开合控制模块置位）：wheel 整链
 * 早退，旧手势惯性尾不接管在途回滚/抽屉 level。
 */
import { prefersReducedMotion, BP_LIGHTBOX_NARROW, BP_DESKTOP_MIN } from './utils.js';

export function initLightboxDrawer({ lightbox, panel, panelDetails, panelToggle, metaEl, dirVerdict, reservedBottom }) {
    const narrowMedia = window.matchMedia(`(max-width: ${BP_LIGHTBOX_NARROW}px)`);
    // 全屏（沉浸）模式：面板 display:none，抽屉手势/布局重算一律暂停，
    // 退出时由 refreshLayout 在面板恢复可见后统一重算（见 lightbox-fullscreen.js）
    const isFullscreen = () => lightbox.classList.contains('is-fullscreen');

    let level = 0;       // 展开程度 0..1
    let headHeight = 0;  // 面板头部高度（每次打开重测：面板总长恒为 50vh，不随标题行数漂移）
    let minHeight = 0;   // 收起态详情区高度 = 地点/日期简行高度

    function maxHeight() {
        // 下方最多展开到画面中间，给上方图片留展示空间：
        // 面板总长（头部 + 详情区）恒为 50% 视口，详情区上限 = 50% 视口 − 面板头部高度；
        // 底部缩略图条占用的高度扣除，图片区仍保持约半屏（reservedBottom 由调用方注入）
        const px = Math.round(window.innerHeight * 0.5) - headHeight
            - (reservedBottom ? reservedBottom() : 0);
        return Math.max(minHeight, px); // 至少露得出地点/日期简行
    }

    function pxFor(lv) {
        return Math.round(minHeight + lv * (maxHeight() - minHeight));
    }

    function apply(px, animate) {
        panelDetails.style.transition = animate
            ? 'max-height 0.4s ease, opacity 0.3s ease'
            : 'none';
        panelDetails.style.maxHeight = px + 'px';
        // 溢出始终 hidden（窄屏滚动完全由手势/滚轮模型接管，程序化 scrollTop 不受影响）——
        // 全开瞬间滚动条弹出会打断进行中的拖拽（浏览器接管滚动条交互触发 pointercancel），
        // 且滚动条出现在指针下方时第二次按压前的状态不可预期
        panelDetails.style.overflowY = 'hidden';
        panelDetails.style.opacity = '1';
        const open = px > minHeight;
        panel.classList.toggle('is-open', open);
        if (panelToggle) {
            panelToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
        }
    }

    // 内容绝对底部（滚轮/拖动的滚动停止条件）
    function atAbsoluteBottom() {
        return panelDetails.scrollTop + panelDetails.clientHeight >= panelDetails.scrollHeight - 1;
    }

    // 箭头翻转判定：抽屉全开且内容到达绝对底部（手动滚过直方图等区域之后）
    function atTarget() {
        if (level < 1) return false;
        return atAbsoluteBottom();
    }

    // 箭头状态：翻转类 + 无障碍标签（翻转后点击是「返回顶部收起」，其余按展开程度区分）
    function updateArrowState() {
        // 图像分析收起编排期间（inputHold）不重判：内容收缩 + 回顶会让「触底」
        // 瞬时为假，箭头会先翻下、收起完成后再翻上；保持收起前的方向，
        // finish 解除挂起时经 refresh 统一重判（2026-10-31）
        if (inputHold) return;
        const atBottom = atTarget();
        panel.classList.toggle('is-at-bottom', atBottom);
        if (panelToggle) {
            panelToggle.setAttribute('aria-label', atBottom
                ? (panelToggle.dataset.topLabel || '')
                : (level > 0
                    ? (panelToggle.dataset.bottomLabel || '')
                    : (panelToggle.dataset.expandLabel || '')));
        }
    }

    // 内容回滚动画：溢出恒为 hidden、无原生平滑滚动——rAF 逐帧驱动 scrollTop
    let scrollAnim = null;
    let scrollAnimTo = 0;

    // CSS ease（cubic-bezier(0.25, 0.1, 0.25, 1)）的 y 值求解（牛顿迭代）：
    // 与「收起过渡」同曲线，保证内容回滚与抽屉合拢两条动画锁步
    function cssEaseY(t) {
        const [x1, y1, x2, y2] = [0.25, 0.1, 0.25, 1];
        let s = t;
        for (let i = 0; i < 6; i++) {
            const inv = 1 - s;
            const x = 3 * inv * inv * s * x1 + 3 * inv * s * s * x2 + s * s * s;
            const dx = 3 * inv * inv * x1 + 6 * inv * s * (x2 - x1) + 3 * s * s * (1 - x2);
            if (Math.abs(dx) < 1e-6) break;
            s -= (x - t) / dx;
        }
        const inv = 1 - s;
        return 3 * inv * inv * s * y1 + 3 * inv * s * s * y2 + s * s * s;
    }

    function animateScrollTop(to, duration) {
        cancelScrollAnim();
        const from = panelDetails.scrollTop;
        if (from === to || duration <= 0) {
            panelDetails.scrollTop = to;
            return;
        }
        scrollAnimTo = to;
        const start = performance.now();
        const step = (now) => {
            const t = Math.min(1, (now - start) / duration);
            panelDetails.scrollTop = from + (to - from) * cssEaseY(t);
            scrollAnim = t < 1 ? requestAnimationFrame(step) : null;
        };
        scrollAnim = requestAnimationFrame(step);
    }

    // 向下箭头 = 滚到内容底部：展开与滚底同时开始，避免信息栏到上限后
    // 再等展开结束才滚动的停顿；目标按展开后的最终可视高度计算（介于展开
    // 中间的高度范围内，不会滚过头）
    const scrollToBottom = (finalClientH) => {
        const clientH = finalClientH != null ? finalClientH : panelDetails.clientHeight;
        const to = Math.max(0, panelDetails.scrollHeight - clientH);
        if (to <= panelDetails.scrollTop + 1) {
            updateArrowState(); // 已经触底（内容放得下）：无需滚动，直接同步箭头
            return;
        }
        if (prefersReducedMotion()) {
            panelDetails.scrollTop = to;
            updateArrowState();
            return;
        }
        // 原生平滑滚动（合成器驱动）：展开的图像分析图表较重，逐帧 JS 写
        // scrollTop 会在长内容中产生可感知的中途停顿（2026-10-31）
        panelDetails.scrollTo({ top: to, behavior: 'smooth' });
    };

    // 中断即完成到目标：回滚期间「展开程度 < 1 时 scrollTop 必为 0」的虚拟位置
    // 不变量被新输入打断后必须立即复原，否则滚动模型错位
    function cancelScrollAnim() {
        if (scrollAnim !== null) {
            cancelAnimationFrame(scrollAnim);
            scrollAnim = null;
            panelDetails.scrollTop = scrollAnimTo;
        }
        // 同时取消在途的原生平滑滚动：以当前 scrollTop 的 auto 滚动落位，
        // 用户滚轮/拖动/点击接管时不被残余平滑动画继续拖动
        panelDetails.scrollTo({ top: panelDetails.scrollTop, behavior: 'auto' });
    }

    function reset(animate = false) {
        cancelScrollAnim();
        lightbox.classList.remove('is-dragging'); // 打开兜底清除拖拽残留（拖动中关闭/重开的残留）
        if (!narrowMedia.matches) {
            // 桌面：清除窄屏残留的内联样式（内联优先级高于媒体查询 CSS），恢复宽屏详情常显
            panelDetails.style.maxHeight = '';
            panelDetails.style.opacity = '';
            panelDetails.style.transition = '';
            panelDetails.style.overflowY = '';
            level = 0; // 展开程度归零：窄屏开过抽屉再切宽屏时，桌面原生滚动不残留箭头翻转判定
            panel.classList.remove('is-open', 'is-at-bottom');
            updateFit();
            return;
        }
        // 先禁用过渡再归零，避免 offsetHeight 读到过渡中的旧值（否则头部被低估、抽屉开过头）
        panelDetails.style.transition = 'none';
        panelDetails.style.maxHeight = '0px';
        // 每次打开重测头部：详情上限 = 50% 视口 − 头部 → 面板总长恒为 50vh
        headHeight = panel.offsetHeight - panelDetails.offsetHeight;
        minHeight = metaEl ? metaEl.offsetHeight : 0;
        level = 0;
        panelDetails.scrollTop = 0;
        panel.classList.remove('is-fit');
        apply(minHeight, animate);
        updateArrowState();
    }

    // 窄屏抽屉内的双列↔单列转换（768px 边界）：面板轻量淡入滑动柔化内部重排跳变；
    // 高度重测由 resize 处理器覆盖（媒体查询变化伴随 window resize）；
    // 768 = BP_DESKTOP_MIN - 1（与全站窄屏上限严格互补，经单源推导不写死）
    const singleColMedia = window.matchMedia(`(max-width: ${BP_DESKTOP_MIN - 1}px)`);
    singleColMedia.addEventListener('change', () => {
        if (!lightbox.classList.contains('active')) return;
        lightbox.classList.remove('is-layout-switching-inner');
        void lightbox.offsetWidth; // 强制回流，重新触发动画
        lightbox.classList.add('is-layout-switching-inner');
    });

    // 灯箱打开期间跨断点：进窄屏重置抽屉、回宽屏清除内联样式恢复桌面布局；
    // 面板触发一次淡入动画柔化布局跳变（prefers-reduced-motion 时由 CSS 关闭）
    narrowMedia.addEventListener('change', (e) => {
        if (!lightbox.classList.contains('active')) return;
        if (isFullscreen()) return; // 隐藏态不测量；退出时 refreshLayout 按新视口重算
        lightbox.classList.remove('is-layout-switching');
        void lightbox.offsetWidth; // 强制回流，重新触发动画
        lightbox.classList.add('is-layout-switching');
        reset(true);
        if (!e.matches) panelDetails.scrollTop = 0;
    });

    // 视口尺寸变化（手机地址栏伸缩、窗口缩放、跨 768px 元信息双列断点）：面板总长恒为
    // 50% 视口——已展开时以新视口重夹上限（展开程度不变），否则固定 px 上限随视口缩小
    // 继续挤占图片区；头部与简行高度同步重测（标题行数 / 地点日期双列↔单列都会改变高度）
    window.addEventListener('resize', () => {
        if (!narrowMedia.matches || !lightbox.classList.contains('active')) return;
        if (isFullscreen()) return; // 隐藏态不测量；退出时 refreshLayout 按新视口重算
        headHeight = panel.offsetHeight - panelDetails.offsetHeight;
        minHeight = metaEl ? metaEl.offsetHeight : 0;
        if (level <= 0) {
            apply(minHeight, false); // 收起态高度随简行重测（双列↔单列切换）
        } else {
            apply(pxFor(level), false);
            panelDetails.scrollTop = Math.min(panelDetails.scrollTop, panelDetails.scrollHeight - panelDetails.clientHeight);
        }
        updateArrowState();
    });

    // 底部箭头：点击只全开抽屉（不做滚动定位，能展开到哪里算哪里）；
    // 箭头仅在内容到达绝对底部时翻转，翻转后点击 → 回到顶部（收起抽屉）
    if (panelToggle) {
        panelToggle.addEventListener('click', (e) => {
            e.stopPropagation();
            if (!narrowMedia.matches) return;
            cancelScrollAnim();
            if (atTarget()) {
                // 已触底：收起并回到顶部（箭头由朝上翻转回朝下）
                level = 0;
                apply(minHeight, true);
                // 内容回滚动画：与收起过渡同曲线同时长，锁步合拢（减弱动态直切）
                animateScrollTop(0, prefersReducedMotion() ? 0 : 400);
            } else if (level < 1) {
                // 向下箭头：展开与滚底同时开始，避免信息栏到上限后再等一拍的停顿
                level = 1;
                apply(maxHeight(), true);
                scrollToBottom(Math.min(maxHeight(), panelDetails.scrollHeight));
            } else {
                // 已全开但未触底：继续滚到内容底部
                scrollToBottom();
            }
            updateArrowState();
        });
    }

    // 滚动条按需显示：滚轮/拖动内容时挂 is-scrolling、停止约 0.6s 后移除——
    // scroll 事件同时覆盖桌面原生滚轮滚动与窄屏程序化滚动（拖拽/滚轮手动 scrollTop）
    let scrollIdleTimer = null;
    const markScrolling = () => {
        panel.classList.add('is-scrolling');
        clearTimeout(scrollIdleTimer);
        scrollIdleTimer = setTimeout(() => panel.classList.remove('is-scrolling'), 600);
    };

    // 桌面端「放得下整体居中、放不下标题固定数据滚动」：
    // 全部内容天然高度 ≤ 面板高度 → is-fit（面板居中整组含标题胶囊，详情区不滚动）；
    // 否则标题/胶囊固定在顶部，仅数据区滚动。
    // fitAdjuster（分析区收起期间非空）：**冻结** is-fit 翻转——收起改「滚动
    // 先行、翻转押后」（2026-10-20 用户确认方案）：收起窗口内详情区保持
    // 可滚动、scrollToTop 回滚动画真实生效，过渡结束由调用方置 null 并经
    // flipFitNow 翻转（翻转位移由调用方做位置补偿平滑滑入居中）。
    // force：跳过 active 守卫强制重判（灯箱刚激活/关闭重置时调用）
    let fitAdjuster = null;
    // inputHold（分析区收起期间 true）：wheel 事件整链早退（含最顶部的
    // cancelScrollAnim 接管）——点击收起后仍在到达的旧手势惯性尾会把在途
    // 回滚瞬跳归零（桌面）、并驱动抽屉 level 拉低（窄屏）；收起编排是点击
    // 发起的刻意动作，不应被旧手势接管（2026-10-21）。置位/清除见返回的
    // setInputHold（调用方：分析区开合控制模块）
    let inputHold = false;
    function updateFit(force) {
        if (narrowMedia.matches || (!force && !lightbox.classList.contains('active'))) return;
        // 收起窗口冻结：判定押后，避免收缩中段翻转截断滚动——force 豁免
        // （强制重判不因冻结被静默吞掉，2026-10-21 审查修复 #14）
        if (fitAdjuster && !force) return;
        const totalH = panel.scrollHeight - panelDetails.clientHeight + panelDetails.scrollHeight;
        panel.classList.toggle('is-fit', totalH <= panel.clientHeight);
    }

    // 任何滚动（滚轮/拖动/程序化滚底）都重判箭头：原生/程序化滚动不一定经过
    // 手势分支的 updateArrowState，遗漏会让箭头停在旧方向（2026-10-31）
    panelDetails.addEventListener('scroll', () => {
        markScrolling();
        updateArrowState();
    }, { passive: true });
    lightbox.addEventListener('wheel', markScrolling, { passive: true });

    // 面板与子块尺寸变化（内容渲染、切图、视口变化）→ 重判「放得下/放不下」
    if (typeof ResizeObserver !== 'undefined') {
        const fitObserver = new ResizeObserver(() => {
            if (isFullscreen()) return; // 隐藏态不重判；退出时 refreshFit/refreshLayout 统一恢复
            updateFit();
            // 窄屏：抽屉/内容高度变化（展开过渡、分析区开合、切图换内容）后
            // 重判箭头方向——高度过渡结束没有滚动事件，箭头不能停在旧状态
            if (narrowMedia.matches && lightbox.classList.contains('active')) updateArrowState();
        });
        fitObserver.observe(panel);
        fitObserver.observe(panelDetails);
        Array.from(panel.children).forEach((el) => fitObserver.observe(el));
        Array.from(panelDetails.children).forEach((el) => fitObserver.observe(el));
    }

    // 滚轮（灯箱任意区域，与拖动手势同一套滚动模型）：未全开时下滚一律展开抽屉；
    // 全开后滚轮手动滚动内容（光标位置无关，与拖动一致）；内容到底后无操作（图片区域保持半页不回弹）；
    // 上滚时内容回滚，到顶后渐进收起（至少保留地点/日期简行）
    lightbox.addEventListener('wheel', (e) => {
        if (inputHold) return; // 收起编排挂起：点击收起后的旧手势惯性尾不接管（见 setInputHold）
        if (isFullscreen()) return; // 全屏：面板已隐藏，滚轮不驱动抽屉
        if (e.target.closest('.lightbox-strip')) return; // 底部缩略图条自行处理滚轮（横向滚动）
        // 新输入接管：中断回滚并完成到目标（桌面端分析区收起同样会启动回滚动画，
        // 用户中途滚轮时必须先摘除，否则动画逐帧覆盖滚动输入）
        cancelScrollAnim();
        if (!narrowMedia.matches || !lightbox.classList.contains('active')) return;
        // 容差 1px：浏览器缩放等场景 scrollTop 可能残留小数
        const atTop = panelDetails.scrollTop <= 1;
        const open = level > 0;
        if (e.deltaY > 0) {
            if (!open || level < 1) {
                const travel = maxHeight() - minHeight;
                if (travel < 1) return; // 行程为零（视口过矮/头部过高）：无展开余地
                const next = Math.min(maxHeight(), pxFor(level) + e.deltaY); // 未全开：下滚渐进展开
                e.preventDefault();
                level = (next - minHeight) / travel;
                apply(next, false);
                updateArrowState();
            } else {
                // 全开：手动滚动内容（任意位置，可越过箭头目标深入直方图）
                const scrolledToBottom = atAbsoluteBottom();
                if (scrolledToBottom) return;
                e.preventDefault();
                panelDetails.scrollTop = Math.min(
                    panelDetails.scrollTop + e.deltaY,
                    panelDetails.scrollHeight - panelDetails.clientHeight
                );
                updateArrowState();
            }
        } else if (open) {
            if (!atTop) {
                // 内容手动回滚（任意位置）
                e.preventDefault();
                panelDetails.scrollTop = Math.max(0, panelDetails.scrollTop + e.deltaY);
                updateArrowState();
            } else {
                const travel = maxHeight() - minHeight;
                if (travel < 1) return; // 行程为零：无收起余地
                const next = Math.max(minHeight, pxFor(level) + e.deltaY); // 到顶：渐进收起
                e.preventDefault();
                level = (next - minHeight) / travel;
                apply(next, false);
                updateArrowState();
            }
        }
    }, { passive: false });

    // 长按拖动（灯箱任意区域、所有指针类型，与滚轮同一套虚拟位置模型，除按钮/链接）：
    // 上滑先展开抽屉到全开，继续上滑则滚动内容露出直方图等剩余信息；下滑对称回退；
    // 详情区（元信息面板）同样参与——内容滚动由本模型接管，不依赖原生滚动
    let dragStartY = null;
    let dragStartVirt = 0;
    let dragging = false;
    let dragFromImgArea = false; // 拖拽起点是否在图片区——方向仲裁仅对图片区起手的手势生效
    lightbox.addEventListener('pointerdown', (e) => {
        if (!narrowMedia.matches || !lightbox.classList.contains('active')) return;
        if (isFullscreen()) return; // 全屏：不进入抽屉拖拽，触屏水平滑动切图由 swipe 模块接管
        // 任何点按（含按钮/缩略图条）接管在途的 JS 回滚与原生平滑滚底
        cancelScrollAnim();
        if (e.target.closest('button') || e.target.closest('a')) return;
        // 底部缩略图条：横向滚动/点按切换，不进入抽屉拖拽
        if (e.target.closest('.lightbox-strip')) return;
        // 鼠标不进入拖拽模型（展开由滚轮路径覆盖）：保留中屏桌面的文本
        // 选择/复制（触屏选择本就被 touch-action:none 禁止、拖拽期间另由
        // .is-dragging 禁选中防 pointercancel 打断）
        if (e.pointerType !== 'touch') return;
        e.preventDefault(); // 阻止原生图片拖拽/文本选择抢走 pointermove
        if (maxHeight() - minHeight < 1) return; // 行程为零：拖拽无展开余地，不启动
        dragging = true;
        lightbox.classList.add('is-dragging'); // 拖拽期间禁选中（见 _lightbox-panel.scss）
        dragFromImgArea = !!(e.target.closest && e.target.closest('.lightbox-img-area'));
        dragStartY = e.clientY;
        dragStartVirt = level * (maxHeight() - minHeight) + panelDetails.scrollTop;
        lightbox.setPointerCapture(e.pointerId);
    });
    // 虚拟位置统一落位（拖动中/接管回滚共用）：virt = 展开程度×行程 + 内容滚动
    const applyVirt = (virt) => {
        const travel = maxHeight() - minHeight;
        if (virt <= 0) {
            level = 0;
            panelDetails.scrollTop = 0;
            apply(minHeight, false);
        } else if (virt < travel) {
            level = virt / travel;
            panelDetails.scrollTop = 0;
            apply(Math.round(minHeight + virt), false);
        } else {
            level = 1;
            apply(maxHeight(), false);
            panelDetails.scrollTop = Math.min(virt - travel, panelDetails.scrollHeight - panelDetails.clientHeight);
        }
        updateArrowState();
    };

    lightbox.addEventListener('pointermove', (e) => {
        if (!dragging) return;
        // 触屏方向仲裁（见 lightbox-swipe.js getVerdict）：
        // 未决期抽屉**暂不响应**（水平接管前从未移动、无需回滚——消除
        // 接管瞬间的回滚抖动与左右/上下「同时进行」观感）；
        // 垂直意图确认后照常跟随；水平接管后结束本次拖拽
        if (e.pointerType === 'touch' && dirVerdict && dragFromImgArea) {
            const v = dirVerdict();
            if (v === 'horizontal') {
                dragging = false;
                // 与 dragging 成对摘除：endDrag 因 !dragging 早退不再执行，
                // 类残留会让面板文字整场无法长按选择（2026-10-18）
                lightbox.classList.remove('is-dragging');
                return;
            }
            if (v === null) return;
        }
        applyVirt(dragStartVirt + (dragStartY - e.clientY));
    });
    const endDrag = () => {
        if (!dragging) return;
        dragging = false;
        lightbox.classList.remove('is-dragging'); // 拖拽结束恢复文字选择
    };
    lightbox.addEventListener('pointerup', endDrag);
    lightbox.addEventListener('pointercancel', endDrag);

    return {
        reset,
        refresh: updateArrowState,
        // 内容回滚到顶部（供分析区收起时同步回顶）：与收起过渡同曲线同时长锁步——
        // 曲线/时长与抽屉收起动画共用，中断行为同样由滚轮/拖动接管（cancelScrollAnim）
        scrollToTop: (duration) => animateScrollTop(0, duration),
        // 取消在途回滚动画（供分析区收起中途再展开调用：回滚仍在逐帧强制
        // scrollTop 归零、会覆盖用户任何滚动输入，2026-10-18）
        cancelScroll: cancelScrollAnim,
        // 设置/清除 is-fit 冻结（布尔语义：分析区收起期间 true 冻结翻转、
        // 滚动上下文保持；false 解除，翻转随内容增长自然发生——此前为
        // 「高度扣除回调」但从不被调用、属死 API，2026-10-21 审查修复 #15）
        setFitAdjuster: (frozen) => { fitAdjuster = frozen; },
        // 全屏退出：面板恢复可见后按当前 level 重算抽屉高度（全屏期间 resize/
        // 媒体查询重算被跳过，且 display:none 测量不可用）；桌面 is-fit 由 refreshFit 负责
        refreshLayout: () => {
            if (!narrowMedia.matches || !lightbox.classList.contains('active')) return;
            headHeight = panel.offsetHeight - panelDetails.offsetHeight;
            minHeight = metaEl ? metaEl.offsetHeight : 0;
            apply(pxFor(level), false);
            updateArrowState();
        },
        // 挂起/恢复滚轮输入（分析区收起期间置位、finish/展开/重置清除——
        // 收起编排不被旧手势惯性尾接管，2026-10-21）
        setInputHold: (held) => { inputHold = held; },
        // is-fit 是否适用于当前视口（窄屏抽屉模式恒 false——居中下滑与翻转
        // 仅桌面生效，调用方以本函数门控（2026-10-21 审查修复：窄屏无门控
        // 时收起出现「先下滑再弹回」伪动效））
        fitApplicable: () => !narrowMedia.matches,
        // 释放冻结后的显式翻转入口（收起过渡结束时由调用方在位置补偿前调用；
        // 走 force：active 守卫此时必然通过、且强制重判语义与 refreshFit 一致）
        flipFitNow: () => updateFit(true),
        // 强制重判「放得下」（跳过 active 守卫）：灯箱刚激活时调用——展开态
        // 关灯箱残留的 is-fit=false 若不再重判，再打开时详情区 auto 边距会把
        // 内容挤到中部、标题与 EXIF 之间出现大空隙
        refreshFit: () => updateFit(true)
    };
}
