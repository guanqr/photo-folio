# 啼鳥怨年華 — 摄影作品站

基于 [Hugo](https://gohugo.io/) 的个人摄影作品展示网站，使用自定义主题 **PhotoFolio**。

🔗 **线上地址：[photo.guanqr.com](https://photo.guanqr.com/)**

## ✨ 特性

- **两端对齐行布局** — Google Photos 式：行高由本行照片内容自然决定、行宽恰好铺满容器（零拉伸、零粗暴裁切），行高贴近参考值（肉眼看基本一致），按时间顺序逐行加载不乱序，resize 自动重排；超窄屏（≤500px）横构图独占一行、竖构图与相邻照片同行
- **组图系列** — 支持将多张照片归入同一主题系列，封面图右上角胶囊徽章显示照片数量，点击进入系列详情页
- **全部作品筛选** — 拍摄年份/拍摄地点/作品类型三组胶囊筛选（可组合、URL 参数同步、分页加载），各维度开关由 `hugo.toml` 的 `[params.galleryFilters]` 控制
- **足迹世界地图** — 足迹页顶部自绘 SVG 世界地图（按省份/国家聚合金色光点、大小随照片数），悬停显示地名/照片数/年份跨度，点击跳转足迹详情页
- **Lightbox 灯箱** — 点击照片全屏预览，左右箭头+键盘切换照片，展示 EXIF 参数
- **暗色/亮色主题切换** — 自动检测系统偏好，支持手动切换
- **无限滚动加载** — 照片超过 12 张时自动分批加载，位置稳定，列间均匀分布
- **响应式动画过渡** — 列数切换、足迹时间线、移动端导航均带 FLIP/淡入动画
- **照片卡片悬浮效果** — 鼠标悬停时整卡轻微上移（带回弹弹簧曲线）；卡片不显示元信息，标题、地点、日期与 EXIF 仅在灯箱放大后展示
- **足迹时间线** — 按地区整理拍摄足迹
- **PWA 支持** — Service Worker 离线缓存
- **Instant.page** — 链接预加载，提升浏览体验
- **中文排版优化** — 使用 Glyph Correction、Noto Serif TC、I.MingCP、LXGW WenKai TC 等中文字体，支持本地字体注入
- **图片 CDN** — 支持阿里云 OSS 等图床加速

## 🚀 快速开始

### 环境要求

- **Hugo** ≥ 0.128.0（Extended 版本，支持 Sass）
- **Git**

### 本地开发

```bash
# 克隆仓库（含子模块）
git clone --recurse-submodules https://github.com/guanqr/photo-folio.git
cd photo-folio

# 启动开发服务器
hugo server -D

# 浏览器访问 http://localhost:1313
```

### 构建

```bash
hugo --gc --minify --cleanDestinationDir
```

构建产物在 `public/` 目录。

## 📁 项目结构

```
photo-folio/
├── archetypes/          # 内容模板
├── assets/              # Hugo 资源（jsconfig.json）
├── content/
│   ├── gallery/         # 全部作品页
│   ├── series/          # 组照合集（主题系列作品）
│   ├── featured/        # 精選页（featured = true 的照片）
│   ├── scenery/         # 風光分类（城市/乡村/山河合并）
│   ├── humanist/        # 人文分类
│   ├── floral/          # 花木分类
│   ├── animal/          # 动物分类
│   └── footprint/       # 足迹（按地区归档）
├── data/
│   ├── photo.toml       # ★ 照片数据（集中管理）
│   └── locations.toml   # 足迹地图坐标（按 location 名键控）
├── scripts/
│   └── generate-land.mjs # 足迹地图陆地几何生成管线（一次性，零依赖）
├── static/              # 静态文件（CNAME、manifest 等）
├── themes/
│   └── photofolio/      # 自定义主题
│       ├── assets/      # SCSS / JS 源文件
│       ├── layouts/     # 页面模板
│       ├── i18n/        # 国际化
│       └── static/      # 主题静态资源（maps/ 陆地几何数据）
├── hugo.toml            # Hugo 配置
└── .github/workflows/   # CI/CD 自动部署
```

## 📸 添加照片

所有照片数据集中在 `data/photo.toml`，每张照片一条记录。

> 💡 推荐使用 [images](https://github.com/guanqr/images) 工具自动读取照片 EXIF 信息，批量生成 `photo.toml` 数据条目，省去手工填写的麻烦。

```toml
[[photo]]
src = "/images/photos/示例照片.jpg"
alt = "照片標題"
category = "scenery"      # scenery / humanist / floral / animal
focus = "24"              # 焦距 (mm)
iso = "100"
aperture = "5.6"
shutter = "1/250"
time = "2025-10-05"
place = "雲南麗江"
location = "雲南"
description = "照片描述（可选，用于 Lightbox 展示）"
series = ""               # 组照名称（可选，同一组照的多张照片填写相同名称）
is_cover = false          # 是否为组照封面（同一组照中仅一张设为 true）
featured = true           # 精選标记（可选，true 的照片收录进 /featured/ 页面）
```

### 足迹地图坐标

足迹页顶部的地图按 `location` 聚合光点，坐标维护在 `data/locations.toml`：

```toml
[[location]]
name = "雲南"      # 必须与 photo.toml 的 location 字段逐字一致
lat = 26.86       # 省份/地区级近似坐标即可
lng = 100.23
```

- 没有坐标的地点不出现在地图上（时间线不受影响）；新增地点后地图视图会自动适配到全部拍摄点
- 地图陆地几何为一次性生成的数据（`themes/photofolio/static/maps/land-110m.json`），如无特殊需要不必重新生成（管线：`node scripts/generate-land.mjs`）

### 组照（系列作品）

多张照片可归入同一个「组照」（如"割藺草"系列）。在非组照页面中，组照的封面图会显示为带图标的链接，点击后跳转到独立组照详情页浏览全部照片。

```toml
# 封面图
[[photo]]
series = "割藺草"
is_cover = true
# ... 其他字段

# 同组其他照片
[[photo]]
series = "割藺草"
is_cover = false
# ... 其他字段
```

同时在 `content/series/` 目录下创建对应的 Markdown 文件：

```markdown
---
title: "割藺草"
---
```

### 精選（featured）

在任意照片记录中添加 `featured = true`，该照片便会收录进 `/featured/` 页面。精選页跨分类收集照片、按时间排序，照片仍保留原分类标签。組照照片標記精選時，只展示該單張（不帶組照鏈接與徽章），不會連帶展示整組照片。首页的精選分类卡片会自动统计精選照片数量，并以最新的精選照片作为封面。

## 🎨 配置

主要配置在 `hugo.toml`：

| 配置项 | 说明 |
|---|---|
| `params.imageCDN` | 图片 CDN 前缀（如阿里云 OSS），留空则使用本地图片 |
| `params.enableServiceWorker` | 启用 PWA Service Worker |
| `params.enableInstantPage` | 启用 Instant.page 预加载 |
| `params.typography` | 字体设置（fontLinks、字体名称、字号、本地字体注入） |
| `params.galleryFilters` | 全部作品页筛选维度开关：`year` / `location` / `category`（true 开启、false 关闭；缺省仅开启 year） |

## 🚢 部署

Push 到 `main` 分支后，GitHub Actions 自动：

1. 拉取源码 + 子模块
2. 使用 Hugo Extended 构建
3. 推送到 `guanqr/photo-folio` 仓库的 `gh-pages` 分支

CDN 图片通过阿里云 OSS（`guanqr.oss-cn-hangzhou.aliyuncs.com`）提供。

## 📄 License

主题 PhotoFolio 使用 MIT 协议。照片版权归作者所有。
