# 啼鳥怨年華 — 摄影作品站

基于 [Hugo](https://gohugo.io/) 的个人摄影作品展示网站，使用自定义主题 **PhotoFolio**。

🔗 **线上地址：[photo.guanqr.com](https://photo.guanqr.com/)**

## ✨ 特性

- **两端对齐行布局** — Google Photos 式：行高由本行照片内容自然决定、行宽恰好铺满容器（零拉伸、零粗暴裁切），行高贴近参考值（肉眼看基本一致），按时间顺序逐行加载不乱序，resize 自动重排；超窄屏（≤500px）横构图独占一行、竖构图与相邻照片同行
- **系列作品** — 多张照片可归入同一主题系列；首页「系列」区块与「系列合集」页以目录卡片展示（封面/名称/张数），详情页单列展示全部照片；灯箱标题下方有分类/系列胶囊入口
- **作品分類目录** — `/categories/` 目录页与首页「分類」区块同款卡片（封面策略可配置：自定义封面或最新横构图作品），各分类页位于 `/categories/<key>/`
- **全部作品筛选** — 作品范围（全部/精選/橫構圖/豎構圖）/拍摄年份/拍摄地点/作品类型四组胶囊筛选（可组合、URL 参数同步、分页加载、计数滚动动画），各维度开关由 `hugo.toml` 的 `[params.galleryFilters]` 控制
- **足迹世界地图** — 足迹页顶部自绘 SVG 世界地图（按省份/国家聚合光点、大小随照片数），悬停显示地名/照片数/年份跨度，点击跳转足迹详情页
- **Lightbox 灯箱** — 点击照片全屏预览，左右箭头+键盘切换照片；桌面端右侧元信息面板（設備/鏡頭/EXIF 分行 / Camera Raw 风格直方图 / 影调分析 / 六色色卡 / 背後的故事，设备与镜头信息缺失时以删除线展示），窄屏为可拖动的底部抽屉（滚动条按需显示、预留空间不挤动文字）
- **摄影作品订阅源** — RSS 2.0（`/index.xml`），按拍摄日期分组通知新发布作品（张数/作品名/地点/日期），批次数量由 `feedCount` 配置
- **无限滚动加载** — 照片超过 12 张时自动分批加载，位置稳定，列间均匀分布
- **响应式动画过渡** — 列数切换、足迹时间线、移动端导航均带 FLIP/淡入动画
- **照片卡片悬浮效果** — 鼠标悬停时整卡轻微上移（带回弹弹簧曲线）；卡片不显示元信息，标题、地点、日期与 EXIF 仅在灯箱放大后展示
- **足迹时间线** — 按地区整理拍摄足迹（展示该地区全部作品，含系列内页）
- **PWA 支持** — Service Worker 离线缓存
- **Instant.page** — 链接预加载，提升浏览体验
- **中文排版优化** — 使用 Glyph Correction、Noto Serif TC、I.MingCP、LXGW WenKai TC 等中文字体，支持本地字体注入
- **图片 CDN** — 支持阿里云 OSS 等图床加速

## 🔬 灯箱分析算法说明

灯箱的色卡、影调与色彩分析共用同一条采样管线：探测加载 w_1024 缩略图 → 离屏 canvas 逐像素统计 → 按 src 缓存；OSS 未开启 CORS 时优雅降级为隐藏分析区块。分析采用**摄影界标准口径**，无外部黑盒算法。

### 直方图（并入影調区块）

- R/G/B 三通道曲线 + 金色明度曲线（Rec.709 加权亮度），各 256 点固定结构、对数纵轴（Camera Raw 风格），渲染为 SVG 矢量
- 切图时曲线**连续形变过渡**（0.4s easeOutCubic，与占比条/灰階括号同源同节奏，时长取自 `--transition-chart` 变量）
- 注释层：陰影/中間調/高光三分区底色（分区界 = 18% 灰 ±1 档曝光）、P50 虚线标记（亮度中位数位置，影调判定的依据）、两端剪裁三角（陰影/高光剪裁警告）
- 图例行：R / G / B / 明度（通道色圆点 + 名称）

### 影调分析

经典九调命名：**高調/中間調/低調 × 長調/中調/短調**（如「低長調」，共用「調」后缀）。

- **高/中/低**：亮度**中位数 P50**（不受极端像素拉动）相对 18% 灰（sRGB ≈118）——<95 低調 ｜ 95–150 中間調 ｜ >150 高調
- **长/中/短**：**動態範圍**（P5–P95 换算为档，摄影界衡量动态范围的标准单位；P5/P95 剔除两端各 5% 极端像素）——<3.5 檔 短調 ｜ 3.5–6.5 檔 中調 ｜ >6.5 檔 長調
- **剪裁警告**：≥2% 像素落在 0–5 → 陰影剪裁；≥2% 落在 250–255 → 高光剪裁（与修图软件的高光/陰影剪裁警告同口径）
- **曝光灰階标尺**：安塞尔·亚当斯區域系統 11 级（0 纯黑 → X 纯白），括号标出照片 P1–P99 占據區域
- **三区占比条**：陰影/中間調/高光三段堆叠 + 百分比（分区界 = 18% 灰 ±1 档曝光）

### 飽和度分布

HSV 饱和度 0–100% 直方图 + 均值标记（低飽和 ←→ 高飽和轴标注）；均值定性低飽和/適中/高飽和（<0.18 低飽和 ｜ 0.18–0.45 適中 ｜ >0.45 高飽和）。

### 色相分布

- HSV 色相 0–360° 直方图（36 段，每段填其色相本色、主色相段高亮），按饱和度加权（灰色无相，不参与判定）
- 主色相取 8 个标准色名（紅/橙/黃/綠/青/藍/紫/品紅），沿横向均布标注
- **黑白照判定**：平均饱和度 <5% → 结论显示「黑白」、色相图以灰色柱呈现

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
│   ├── series/          # 系列合集（主题系列作品）
│   ├── categories/      # 作品分類目录（各分类位于其下）
│   │   ├── scenery/     # 風光分类（城市/乡村/山河合并）
│   │   ├── humanist/    # 人文分类
│   │   ├── floral/      # 花木分类
│   │   └── animal/      # 动物分类
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
alt = "作品標題"
category = "scenery"      # scenery / humanist / floral / animal
focus = "24"              # 焦距 (mm)
iso = "100"
aperture = "5.6"
shutter = "1/250"
time = "2025-10-05"
place = "雲南麗江"
location = "雲南"
width = "1920"            # 原始像素宽高（由预处理脚本生成，横/竖构图据此推导）
height = "1280"
camera = "NIKON Z 5"      # 设备（灯箱「設備」行展示，缺失时以删除线占位）
lens = "NIKKOR Z 24-200mm f/4-6.3 VR"  # 镜头（灯箱「鏡頭」行展示，缺失时以删除线占位）
description = "照片描述（可选，用于 Lightbox 展示）"
series = ""               # 系列名称（可选，同一系列的多张照片填写相同名称）
is_cover = false          # 是否为系列封面（同一系列中仅一张设为 true）
featured = true           # 精選标记（可选，true 的照片进入首页轮播，并可在全部作品页按「作品範圍 → 精選」筛选）
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

### 系列作品

多张照片可归入同一个系列（如「割藺草」系列）。封面（`is_cover = true`）用于首页「系列」区块与「系列合集」页的目录卡片，点击卡片进入系列详情页浏览全部照片。

```toml
# 封面图
[[photo]]
series = "割藺草"
is_cover = true
# ... 其他字段

# 同系列其他照片
[[photo]]
series = "割藺草"
is_cover = false
# ... 其他字段
```

同时在 `content/series/` 目录下创建对应的 Markdown 文件（`photos` 列表决定详情页的展示顺序）：

```markdown
---
title: "割藺草"
photos: ["割蔺草-1.jpg", "割蔺草-2.jpg", "割蔺草-3.jpg"]
---
```

### 精選（featured）

在任意照片记录中添加 `featured = true`，该照片便会进入首页轮播（按时间排序，数量由 `carouselCount` 配置），并可在全部作品页通过「作品範圍 → 精選」筛选查看。

## 🎨 配置

主要配置在 `hugo.toml`：

| 配置项 | 说明 |
|---|---|
| `params.imageCDN` | 图片 CDN 前缀（如阿里云 OSS），留空则使用本地图片 |
| `params.carouselCount` | 首页轮播精选图数量（1–12 张） |
| `params.categoryCover` | 首页/分类目录卡片封面策略：`custom`（仅自定义封面）/ `latest-landscape`（默认，取最新横构图作品） |
| `params.feedCount` | 摄影作品订阅源（`/index.xml`）输出的更新批次数 |
| `params.lightbox` | 灯箱信息区块开关：`meta` / `exif` / `palette` / `story` / `tonal`（影調，含合并直方图）/ `saturation`（飽和度分布）/ `hue`（色相分布）（缺省全开） |
| `params.enableServiceWorker` | 启用 PWA Service Worker |
| `params.enableInstantPage` | 启用 Instant.page 预加载 |
| `params.typography` | 字体设置（fontLinks、字体名称、字号、本地字体注入） |
| `params.galleryFilters` | 全部作品页筛选维度开关：`scope` / `year` / `location` / `category`（true 开启、false 关闭；缺省仅开启 year） |
| `taxonomies` | 已清空（站点不使用 Hugo 内置分类法；`content/categories/` 为普通 Section 层级） |

## 🚢 部署

Push 到 `main` 分支后，GitHub Actions 自动：

1. 拉取源码 + 子模块
2. 使用 Hugo Extended 构建
3. 推送到 `guanqr/photo-folio` 仓库的 `gh-pages` 分支

CDN 图片通过阿里云 OSS（`guanqr.oss-cn-hangzhou.aliyuncs.com`）提供。

## 📄 License

主题 PhotoFolio 使用 MIT 协议。照片版权归作者所有。
