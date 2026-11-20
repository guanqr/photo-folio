# 无障碍、SEO 与关键行为

> 迁自 `.claude/CLAUDE.md`（2026-11-16）；行为变更时同步更新本文件。文档索引见 [README.md](README.md)。

## 无障碍

- skip-to-content 跳转链接（`.skip-link`），`:focus-visible` 全局焦点样式
- 内容页面每页恰好一个 `h1`：首页主标题用 `h1`，详情/列表页标题由 `page-header` 输出 `h1`
- 所有 aria-label 通过 `{{ i18n }}` 引用，严禁硬编码（JS 动态构建的 aria-label 用 i18n 格式串占位符替换，如地图光点）
- 灯箱标题（`#lightbox-caption`）带 `aria-live="polite"` + `aria-atomic`：切图后标题变化由读屏播报，同时仍作为对话框的 accessible name
- 筛选胶囊、地图光点支持键盘聚焦/回车

## SEO

- `head.html` 包含 meta description、canonical、Open Graph（`og:*`）、Twitter Card；SPA 导航后 `page-transition.js` 从新页面 head 同步这些页面级标签（canonical/OG/Twitter/description/RSS alternate），字体/样式/站点级 JSON-LD 不动
- OG/Twitter 图片：页面 `.Params.cover` 优先；无 cover 的首页/全部作品/系列/足迹/关于回退展示顺序最前的精选（无则作品首张）
- RSS 只保留首页摄影 feed（`/index.xml`）；section 输出设为仅 HTML，不再生成空的 `/section/index.xml` 与 `rel=alternate`；页脚版权行末尾以「·RSS」链接指向该 feed（`params.enableFooterRss` 开关，文案与分隔符走 i18n）
- 订阅源每张作品一条、按 `published`（缺失回退 `time`）倒序取最近 `feedCount` 条；`guid` 用作品 `src`（稳定唯一），链接指向灯箱深链 `/gallery/?p=<slug>`——补发旧拍摄日期的作品也会成为新条目；描述文本给出「地點 · 日期 · 焦距 · 光圈 · 快門 · 感光度」并另起一行附「來源：」+ 同一深链（读者端通常只渲染描述、看不到 item link）
- sitemap 由 Hugo 自动生成

---

## 链接规范

- 所有站内链接使用相对路径：`RelPermalink`、`/`
- 外部链接（博客等）使用绝对 URL
- 筛选 URL 参数：`?s=` 範圍、`?y=` 年份、`?l=` 地点英文 slug、`?c=` 类型

---

## 关键行为

1. **照片排序**：`data/photos/` 分片内顺序即展示顺序（新→旧），分片按年份降序拼接、`pre-YYYY` 最后；同日手动调序优先；排序管线唯一实现 `partials/photo-sorted.html`
2. **组照展示**：画廊/分类页展示全部作品（含组照封面与内页），不按 `is_cover` 过滤；系列入口由系列合集页与导航承担
3. **照片计数**：页头总数与地图弹层计数使用 `realCount`（含组照内页）
4. **初始渲染**：照片全部在 DOM 中，未渲染者带 `is-hidden`（display:none）；`baseof` 内联脚本解析阶段先加、initMasonry 按可见窗口揭示时移除（bundle 失败有 4s 兜底看门狗，拆行容器后放出全部卡片）；SPA 换页由 `main.js` 在入口加载前为新网格重新加 `is-hidden`，4s 未就绪走同口径兜底释放
5. **隐藏照片**：仍在 DOM 中（供筛选复用与后来补载），留在网格隐藏池（无 src）
6. **resize**：同档位行成员冻结按比例缩放；跨档位重新规划整组行并做 FLIP + 锚点滚动补偿
7. **筛选切换**：按整页容器渐进加载模式重启网格（重建计划与页面高度，先揭示视口内行后逐行补载）；拍平行容器时行内照片 insertBefore 第一个游离项（保持展示顺序）
8. **提交**：忽略 CHANGELOG.md，版本号由用户决定；用户说「发布」才包含 CHANGELOG
