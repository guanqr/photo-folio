# Changelog

PhotoFolio 主题的版本更新记录。格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.0.0/)。

## [Unreleased]

（暂无未发布变更）

---

## [0.5.2] — 2026-06-27

### Fixed
- 修复 resize 后行内照片顺序错乱：`rebuildAndDistribute` 从最短列优先改为 round-robin，保证每行始终按时间横排

---

## [0.5.1] — 2026-06-27

### Fixed
- 修复移动端首帧闪现三列再跳一列的问题：`column-count` 和 `display:flex` 冲突导致 fallback 失效，改为 JS 就绪前后两套独立 CSS（`.masonry-ready` 切换）

---

## [0.5.0] — 2026-06-27

### Added
- **瀑布流 JS 引擎**（`masonry.js`）：显式列容器 + round-robin 初始分配，替代 CSS `column-count`
- **resize FLIP 动画**：列数互切时位移+缩放平滑过渡（0.35s），自动保持滚动位置
- **足迹时间线 FLIP 动画**（`timeline-anim.js`）：JS 接管整卡 flex 布局、缩略图网格列数、竖线/圆点位置，跨越 768px 断点时统一 FLIP
- **inline 隐藏脚本**（`baseof.html`）：同步执行，在浏览器触发 lazy loading 前标记首批之外的 `.is-hidden`

### Changed
- **首屏加载策略**：inline script → masonry 初始化 → infinite-scroll 分发的三阶段管线
- `infinite-scroll.js` 基于 `grid._allItems` 原始时间序索引，不依赖 DOM 顺序；加载延迟 300ms → 800ms
- **移动端导航**：汉堡按钮 `display:none` → `visibility+opacity` 淡入淡出；菜单动画由 JS 动态注入 transition（`transitionend` 后清除）
- **CSS 架构**：移除 `_responsive.scss` 中由 JS 接管的规则（`.masonry-grid` flex-direction、`.timeline-gallery` 列数、`.timeline-node` / `.timeline-date` 移动端布局）。竖线/圆点改用 CSS 自定义属性（`--tl-line-left` 等）
- **全站内部链接**：`Permalink` → `RelPermalink`，`BaseURL` → `/`
- `.masonry-item`、`.timeline-thumb`、`.series-badge`、`.timeline-content` 统一 `transition: transform 0.35s`

### Fixed
- CSS columns 加载更多时已有照片位置跳变
- resize 后 loadMore 隐藏项全部挤入同一列：`rebuildAndDistribute` 脱离 DOM 后测高为 0 → 引入虚拟 `colHeights[]` 跟踪 + 入参 `firstMap` 预测量高度
- FLIP 元素索引错配：`allRendered.sort()` 原地排序导致 `firstRects[i]` / `lastRects[i]` 非同一元素 → `Map<Element, Rect>` 按元素查找
- FLIP Play 阶段清除 `transformOrigin` 导致缩放原点从 `top left` 跳回 `center` → 保留不清除
- `visibility:hidden` 阻止浏览器原生 lazy loading → 移除，用同步 inline script + round-robin 替代
- `getBoundingClientRect()` 在初始分配时每轮强制同步 layout → round-robin 替代最短列
- 足迹页面 `+N` 未计入组照内页数量
- `.series-badge` FLIP 动画时长与卡片不一致（0.3s vs 0.35s）
- mobile nav 跨越 768px 断点时从桌面可见态过渡造成闪烁

---

## [0.4.1] — 2026-06-16

### Added
- **组照徽章数量显示**：组照封面图右上角徽章新增照片数量，胶囊形状展示图标 + 数字

### Changed
- **统一颜色变量形式**：所有基础色值从 `#hex` 统一改为 `rgba()` 形式，保持与语义化变量一致
- **足迹时间线布局优化**：最大宽度从 800px 放宽至 1100px，时间列加宽（60px → 80px），间距增大（2em → 2.5em），时间字体略微放大
- **样式组织**：组照徽章窄屏响应式样式从 `_gallery.scss` 迁移至 `_responsive.scss`
- 更新首页 Hero 封面图

### Fixed
- **修复组照照片数量统计**：各分类页、足迹页、地区详情页的照片总数现在正确计入组照内页照片，而非仅统计封面和单图

---

## [0.4.0] — 2026-06-15

### Added
- **组图系列功能**：多张照片可归入同一主题系列，封面图显示组照图标，点击跳转至系列详情页
  - 新增 `series` 和 `is_cover` 字段支持
  - 新增 `/series/` 组照合集列表页
  - 新增系列详情页，展示组内全部照片
  - 照片卡片根据上下文自动切换渲染模式（封面链接 / 普通预览）
- 组照徽章 SVG 图标
- **Glyph Correction 本地字体注入**：通过 `@font-face` 加载 `glyph-correction.woff2`，修复中文引号等标点符号在不同字体下的显示不一致问题
- 组照相关 i18n 文案：`view_series`、`series_collection`、`total_photos`、`series_count`、`no_series`、`no_series_hint`、`no_photos_in_series`、`no_series_match_hint`

### Changed
- 照片卡片 (`photo-card.html`) 重构：支持 `isInSeriesPage` 上下文，自动区分组照封面与普通照片的渲染逻辑
- **字体栈重构**：支持多字体逗号分隔配置，自动解析并生成带引号的 CSS `font-family` 回退栈
- 标题字体与正文字体默认增加 `Glyph Correction` 作为首选字体
- 组照列表页和详情页的空状态提示改用 i18n 字符串

---

## [0.3.1] — 2026-06-11

### Changed
- 分类「folk（民俗）」重命名为「humanist（人文）」，对应目录 `content/folk/` → `content/humanist/`

### Removed
- `_footprint.scss` 独立样式文件，足迹样式合并至 `_responsive.scss`

---

## [0.3.0] — 2026-06-10

### Fixed
- 修复文字显示异常

---

## [0.2.0] — 2026-06-09

### Added
- 首页 Hero 轮播图（`heroImages`、`heroInterval` 配置）
- 作品合集页（`/gallery/`），按时间倒序展示全部照片
- **无限滚动加载**：照片超过 12 张时分批加载，滚动到底部自动触发
- **足迹时间线页**（`/footprint/`），按地区整理拍摄足迹

### Changed
- 首页分类封面图长宽比调整，优化视觉一致性
- 明暗主题切换图标尺寸微调

### Removed
- 首页不再显示汇总页面入口

---

## [0.1.0] — 2026-06-07

### Added
- 项目初始化，PhotoFolio 主题诞生
- **瀑布流布局**：CSS 多列瀑布流展示照片，宽屏三列，响应式适配
- **Lightbox 灯箱**：点击照片全屏预览，展示 EXIF 信息
- **EXIF 信息展示**：焦距、光圈、快门、ISO
- **暗色/亮色主题切换**：自动检测系统偏好，支持手动切换，统一颜色变量控制
- **PWA 支持**：Service Worker 离线缓存
- **Instant.page 预加载**：链接悬停预加载，提升浏览体验
- 照片描述字段，Lightbox 中展示
- 返回顶部按钮
- 中文排版优化：Noto Serif TC、I.MingCP、LXGW WenKai TC 字体
- CSS / JS 资源模块化重构
- 响应式窄屏适配
- 首页分类卡片、照片信息区域边距优化
