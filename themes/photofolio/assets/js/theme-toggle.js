// 明暗主题切换：点击按钮在 dark/light 间切换并写入 localStorage；
// 初始主题由 baseof.html 头部的内联脚本在首帧前恢复（避免闪烁），本模块只负责切换
import { prefersReducedMotion } from './utils.js';

export function initThemeToggle() {
    const toggleBtn = document.getElementById('theme-toggle');
    if (!toggleBtn) return;

    const applyTheme = (theme) => {
        document.documentElement.setAttribute('data-theme', theme);
        // 存储被禁（隐私模式/阻止 Cookie）时静默降级：视觉切换不受影响、偏好不持久化
        try {
            localStorage.setItem('theme', theme);
        } catch (e) { /* noop */ }
    };

    let themeSwitchTimer = null;
    toggleBtn.addEventListener('click', () => {
        const currentTheme = document.documentElement.getAttribute('data-theme');
        // 如果当前是 light，则切回 dark；否则切为 light
        const newTheme = currentTheme === 'light' ? 'dark' : 'light';
        // 主题切换是全页颜色突变的一次性巨大重绘（背景/卡片/文字/地图数万路径），
        // 低端机可能掉帧——支持 View Transitions 的浏览器（Chrome/Edge 111+、
        // Safari 18+）走整页快照交叉淡化（新旧态各光栅化一次、合成器淡化）；
        // 不支持与减弱动态偏好降级为即时切换（切换窗口内元素过渡同样压制，
        // 全站元素同刻换色）
        if (document.startViewTransition && !prefersReducedMotion()) {
            document.startViewTransition(() => applyTheme(newTheme));
        } else {
            applyTheme(newTheme);
        }
        // 主题切换窗口挂 html.theme-switching：期间全站元素级过渡统一压制
        // （_base.scss），切换动作瞬时完成、动画由整页快照交叉淡化唯一提供——
        // 元素自身颜色渐变与交叉淡化叠加成双重渐变、文字/标题滞后于瞬时
        // 换色元素（不同步）；结束后摘除恢复；快速连切时重置计时——
        // 否则旧定时器会提前摘类、切断第二次切换的在途过渡
        clearTimeout(themeSwitchTimer);
        document.documentElement.classList.add('theme-switching');
        themeSwitchTimer = setTimeout(() => {
            document.documentElement.classList.remove('theme-switching');
            themeSwitchTimer = null;
        }, 350);
    });
}
