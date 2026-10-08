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

灯箱的直方图、影调、冷暖倾向与平均色温共用同一条采样管线：探测加载 w_1024 缩略图（与参考网站「长边 ≤1024px 采样」同级）→ 离屏 canvas 逐像素统计 → 按 src 缓存；OSS 未开启 CORS 时优雅降级为隐藏分析区块。

### 直方图（RGB 直方圖）

- 三通道（R/G/B）各 256 桶计数，窗口 5 滑动平均平滑
- 对数纵轴（Camera Raw 风格），渲染为 SVG 矢量（缩放/高 DPI 不失真）
- 加法混合不依赖 `mix-blend-mode`：按列把三通道高度排序拆段，每段直接填「底色 + 0.55×通道色之和」的不透明色（与 canvas `lighter` 数学等价，全浏览器一致）

### 影调分析

给照片的明暗气质起专业名：**高/中/低 × 长/中/短** 九格 + 第 10 格「全長調」。

- **亮度** = Rec.709 加权（0.2126R + 0.7152G + 0.0722B）
- **高/中/低**：亮度均值 ≤85 低調 ｜ 85–170 中間調 ｜ ≥170 高調；均值贴近 85/170（±4）或与分区亮度重心打架时标「邊界·接近 X 調」置信提示
- **长/中/短**：P0.5–P99.5 跨度（直方图两端各剔除 0.5% 尾部）<85 短調 ｜ 85–190 中調 ｜ >190 長調（阈值与参考网站 18 张实测对齐）
- **σ（标准差）** 只作展示、不参与判定——高 ISO 纹理不会把跨度不长的照片误判成长调
- **全長調**（九格装不下时单独命名）：深暗（亮度 ≤40）与明亮（≥215）各 ≥15%、中间带（90–165）≤30% 的双峰分布——剪影、暗调风光
- 含剪切（亮度 <1 或 >254 的像素 ≥0.5%）时标「跨度為表觀值」
- 结论组合名：低调 + 中调 → 低中调（共用「調」后缀）

### 冷暖倾向

- 色谱：左冷蓝 → 右暖橙渐变；标记每张都显示（与色温数值解耦）
- 标记定位：倒数温标（mired）分段映射——10000K → 左端 0、5500K（摄影日光中性）→ 正中 0.5、2500K → 右端 1
- 结论：标记 <0.5 偏冷 ｜ 正中 中性 ｜ >0.5 偏暖

### 平均色温（K）

采用**白平衡反推口径**（与参考网站实测对齐，平均偏差 ≈800K）：

- 取各通道 **90 分位**作「白点」（高位分位避开暗部噪声与局部色块），灰世界反推光源色 = (G/R, 1, G/B)
- 光源色经 sRGB → XYZ(D65) → xy 色度，McCamy 近似求色温：n = (x − 0.332) / (y − 0.1858)，CCT = −449n³ + 3525n² − 6823.3n + 5520.33
- 黑白（白点三通道无彩度）或结果超出 1500–40000K（色度出界/极端偏色）时显示「不適用」
- 注意：数值包含调色与题材的影响——它是画面平均的冷暖倾向估计，不等于拍摄时的光源色温

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
| `params.lightbox` | 灯箱信息区块开关：`meta` / `exif` / `histogram` / `palette` / `story`（缺省全开） |
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
