# 荷戟獨彷徨 — 摄影作品站

基于 [Hugo](https://gohugo.io/) 的个人摄影作品展示网站，使用自定义主题 **PhotoFolio**。

🔗 **线上地址：[photo.guanqr.com](https://photo.guanqr.com/)**

## ✨ 特性

- **瀑布流布局** — CSS 多列瀑布流展示照片，宽屏三列，响应式适配
- **组图系列** — 支持将多张照片归入同一主题系列（如组照），以封面图展示，点击进入系列详情页浏览全部照片
- **Lightbox 灯箱** — 点击照片全屏预览
- **暗色/亮色主题切换** — 自动检测系统偏好，支持手动切换
- **无限滚动加载** — 照片超过 12 张时自动分批加载
- **EXIF 信息展示** — 每张照片展示焦距、光圈、快门、ISO 等参数
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
│   ├── city/            # 城市分类
│   ├── countryside/     # 乡村分类
│   ├── landscape/       # 山河分类
│   ├── humanist/        # 人文分类
│   ├── floral/          # 花木分类
│   ├── animal/          # 动物分类
│   └── footprint/       # 足迹（按地区归档）
├── data/
│   └── photo.toml       # ★ 照片数据（集中管理）
├── static/              # 静态文件（CNAME、manifest 等）
├── themes/
│   └── photofolio/      # 自定义主题
│       ├── assets/      # SCSS / JS 源文件
│       ├── layouts/     # 页面模板
│       ├── i18n/        # 国际化
│       └── static/      # 主题静态资源
├── hugo.toml            # Hugo 配置
└── .github/workflows/   # CI/CD 自动部署
```

## 📸 添加照片

所有照片数据集中在 `data/photo.toml`，每张照片一条记录：

```toml
[[photo]]
src = "/images/photos/示例照片.jpg"
alt = "照片標題"
category = "landscape"    # city / countryside / landscape / humanist / floral / animal
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
```

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

## 🎨 配置

主要配置在 `hugo.toml`：

| 配置项 | 说明 |
|---|---|
| `params.imageCDN` | 图片 CDN 前缀（如阿里云 OSS），留空则使用本地图片 |
| `params.heroImages` | 首页轮播图片列表 |
| `params.heroInterval` | 轮播间隔（秒） |
| `params.enableServiceWorker` | 启用 PWA Service Worker |
| `params.enableInstantPage` | 启用 Instant.page 预加载 |
| `params.typography` | 字体设置（fontLinks、字体名称、字号、本地字体注入） |

## 🚢 部署

Push 到 `main` 分支后，GitHub Actions 自动：

1. 拉取源码 + 子模块
2. 使用 Hugo Extended 构建
3. 推送到 `guanqr/photo-folio` 仓库的 `gh-pages` 分支

CDN 图片通过阿里云 OSS（`guanqr.oss-cn-hangzhou.aliyuncs.com`）提供。

## 📄 License

主题 PhotoFolio 使用 MIT 协议。照片版权归作者所有。
