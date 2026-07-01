# Changelog

PhotoFolio 主题的版本更新记录。格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.0.0/)。

## [0.5.8] — 2026-07-01

### Added
- **404 页面**：含返回首页链接，完整 i18n
- **无障碍支持**：skip-to-content 跳转链接、全局 `:focus-visible` 焦点样式、aria-label 全部走 i18n
- **SEO**：meta description、canonical、Open Graph（含封面图）、Twitter Card

### Fixed
- **硬编码颜色**：`#fff` → `rgba(var(--rgb-white), 1)`，5 处阴影 `rgba(0,0,0,x)` → `rgba(var(--rgb-black), x)`
- **过渡时长统一**：懒加载 `filter/opacity`、masonry-item `transform/opacity`、category-card `opacity` 全部统一到匹配时长
- 足迹页面全部元素补齐黑白切换过渡（竖线、圆点、日期、标题、计数、+N 卡片、结束语）
- 首页分类卡片补齐 `background-color` 过渡
- `header-scroll.js` 废弃 API `pageYOffset` → `scrollY`
- `.gitignore` 补充 `.DS_Store`/`Thumbs.db`/`*.log`/`.vscode/`/`.idea/`/`node_modules/`

### Cleanup
- HTML 内联样式全部移至 SCSS：`index.html`、`404.html`、series 提示文字
- 删除冗余 `:focus-visible` 重复规则；`fadeInUp` 重命名为 `fadeIn`；`revealCategoryCards` 加空守卫

---

## [0.5.7] — 2026-06-29

### Changed
- **移动端导航图标**：菜单文字左侧显示图标（首页/作品/足迹/关于），宽屏隐藏；图标 0.85em + 微调对齐；下划线仅划文字不划图标
- **关于页版权声明**：底部新增摄影作品版权说明，顶部带分隔线
- **首页分类卡片入场**：改为与瀑布流一致的 `translateY` 滑入动画（JS 60ms 交错），不再用 CSS animation（避免覆盖 hover）
- **足迹结束语**：字体改为 `var(--font-meta)`，去掉斜体，与日期统一

### Fixed
- 移动端导航点击菜单项后带动画收回（滑入顶部+淡出），不再直接消失
- 足迹单页/系列详情页无无限滚动触发器，导致超过 12 张的照片永不加载
- 无限滚动 `wasIntersecting` 状态追踪在短页面导致永远不会触发加载
- 足迹卡片照片不足四张时，卡片宽度按比例收窄、缩略图保持原尺寸；取消缩略图 hover 放大双重动画
- 主题切换/汉堡图标动画卡顿：`transform` 与 `opacity` 统一时长曲线（`0.3s cubic-bezier(0.4, 0, 0.2, 1)`）
- SPA 页面切换后 `_allItems` 被 `shift` 破坏原始排序
- 黑白切换补齐颜色过渡：header/footer 边框、网站名称、汉堡横线、照片卡片、gallery-header、关于页、首页分类卡片

### Cleanup
- SCSS：合并重复 `fadeInDown`→`fadeInUp`，删除未用变量 `--color-accent-50`/`--color-dot-*`/`--size-h2`，删除未用选择器 `.debug-info`/`.photo-placeholder`
- JS：简化 `infinite-scroll` 冗余计时器；`lightbox` 守卫提前；`masonry`/`lazy-load` 去多余 export；`_allItems` 独立副本

---

## [0.5.6] — 2026-06-29

### Changed
- **全局动画增强**：新增 `--transition-spring` 变量（弹性缓动）、`body` 明暗主题过渡、`fadeInUp/Down` 全局关键帧
- **页面切换**：拦截站内导航，仅替换 `.main-content`，header/footer/Lightbox 不重载；History API 支持前进后退；切换后自动更新导航高亮、关闭移动菜单
- **导航栏**：下划线改为 `scaleX` 从中心展开 + `will-change` GPU 优化；header 背景平滑过渡
- **主题切换**：太阳光线向内收缩 + 核心圆与弯月交叉淡入（取代整图标旋转缩放）；`transform` 与 `opacity` 统一 0.4s 同步过渡
- **汉堡菜单**：三条线始终绝对定位，纯 `transform` 驱动叉号动画，交点精确居中
- **分类卡片**：交错淡入入场、hover 弹簧抬升 + 阴影（与照片卡片统一）
- **照片瀑布流**：逐张渐入揭示（JS + CSS）、hover 弹簧抬升 + 阴影、分类标签 hover 弹出
- **Lightbox**：图片 + 标题 + 说明同步淡入淡出切换；关闭按钮 hover 弹簧旋转（纯 SVG，不缩放按钮）；左右箭头仅 hover 时淡入浮现；控件尺寸统一 3em，窄屏不缩小
- **关于页**：头像/设备组交错淡入、头像 hover 弹簧旋转、设备标签 hover 变色
- **足迹时间线**：圆点弹入动画（`dotPulse`）、卡片 hover 弹簧抬升、缩略图 hover 弹出
- **页脚**：链接 hover 发光（`text-shadow`）
- **返回顶部**：弹簧弹入 + hover 上浮，页面切换后正确重新绑定
- **懒加载**：图片模糊渐清（`blur(10px) → 0`），页面切换复用已有 Observer
- **列数切换 FLIP**：使用平滑缓动替代弹簧曲线，过渡完成后清理 inline style
- **无限滚动**：仅从不可见→可见转变时触发（防初始误触）；800ms 延迟开始观察；滚动到底后转圈 700ms 再加载
- **模块防重入**：masonry、lightbox、timeline、lazy-load、back-to-top 加守卫/清理，支持页面切换后安全重新初始化

### Fixed
- 首页排除关于页卡片：`about` section 加入 `excludeSections`，避免关于页作为分类卡片出现在首页
- 分类卡片 hover 上移不生效（CSS animation 覆盖 transform）
- 页面切换后导航下划线不更新

---

## [0.5.5] — 2026-06-28

### Changed
- **全部按需分配列**：首批照片也不再预分配，改为逐张揭示时实时测最矮列放入（`revealBatch`），确保加载过程中的列高始终均衡
- **高度比较加容差**：列高差 0.5px 以内视为相等，此时选照片数量更少的列，避免浮点精度导致堆积
- `initMasonry` 不再预分配，`infinite-scroll` 复用 `revealBatch`
- **Lightbox 升级**：新增左右箭头切换照片（半透明底+SVG 图标），支持键盘 ← → 导航；关闭按钮改用 SVG；手机端箭头缩小并叠加在图片上不占空间
- **关于页面**：新增 `/about/` 页面，展示头像、个人简介、设备工具列表，配置集中在 `hugo.toml` 的 `[params.author]`
- **SVG 统一管理**：所有 SVG 图标集中到 `data/svg.toml`，模板通过 `{{ $.Site.Data.svg.xxx | safeHTML }}` 引用，`baseof.html` 三处硬编码改为引用；新增 `x`、`chevron_left`、`chevron_right` 图标
- 关于页去除大标题「設備與工具」，保留分类小标题；清理冗余 `.about-section` 包裹层及 SCSS、i18n 无用键值
- 导航栏隐藏博客外链

### Fixed
- 修复首批 12 张照片在列高相等时全部堆积到第一列
- 修复两列模式下列高微差导致的不均衡
- 修复组照详情页照片排序：改为 `asc`，按 photo.toml 原始顺序展示

---

## [0.5.4] — 2026-06-27

### Changed
- **足迹时间线重新设计**：日期移到卡片上方、竖线+圆点在左侧、卡片式布局
  - 移除独立日期列，结构简化为 `.timeline-node` > date + card
  - 竖线和圆点统一用 CSS 变量控制（`--tl-line-left/top/bottom`、`--tl-dot-left/top`、`--tl-node-pad`）
  - 宽屏竖线与卡片间留小间隙，窄屏卡片左缘紧贴竖线、日期文字加左距防重叠
  - 结束语新增圆点
- **SCSS px → em 统一**：`_footprint.scss` 和 `_gallery.scss` 中长度值改为 em
- **首页轮播图自动选图**（已移除）：新增 `heroMode` 配置（`auto`/`custom`/`none`），后因性能考虑完全移除轮播功能

### Removed
- **首页轮播图**：删除 `hero-slider.js`、`_hero.scss`，首页直接进入分类卡片区域

### Fixed
- 足迹时间线日期换行与竖线重叠
- 窄屏圆点与竖线未对齐

---

## [0.5.3] — 2026-06-27

### Changed
- **加载动画**：12 张照片改为逐张揭示，每张间隔 60ms（首张延迟 300ms），瀑布流自上而下逐个淡入
- **按需分配列**：隐藏照片不再预分配到列中，改为 `loadMore` 时逐张放入当前最矮列后解除隐藏
- **混合分配策略**：可见照片分配采用"前 N 张 round-robin（保证首行时间序）+ 后续最短列优先（均衡列高）"
- **排序增强**：同日照片改用 photo.toml 数组索引作为次要排序键（`time-索引`）
- **SCSS 优化**：`transition: all` → 具体属性；合并重复淡入动画；移除未使用变量；颜色命名规范化；引入 RGB 分量变量

### Fixed
- 修复同一天照片排序不稳定：Hugo `sort` 非稳定排序，改为构建 `time-索引` 复合键。`time` 先经 `time.Format` 标准化为 `YYYY-MM-DD HH:MM:SS`
- 修复移动端首帧闪现三列：`column-count` 与 `display:flex` 冲突，改为 JS 就绪前后两套独立 CSS（`.masonry-ready` 切换）
- 修复 resize 后加载更多时照片全挤入同一列

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
