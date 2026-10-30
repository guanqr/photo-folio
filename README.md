# 啼鳥怨年華 — 摄影作品站

基于 [Hugo](https://gohugo.io/) 的个人摄影作品展示网站，使用自定义主题 **PhotoFolio**。

🔗 **线上地址：[photo.guanqr.com](https://photo.guanqr.com/)**

## ✨ 特性

### 作品浏览

- **两端对齐行布局** — 参考实现式：行高由本行照片内容自然决定、行宽恰好铺满容器（零拉伸、零粗暴裁切），行高贴近参考值（肉眼看基本一致），按时间顺序逐行加载不乱序，resize 自动重排；超窄屏（≤500px）横构图独占一行、竖构图与相邻照片同行
- **无限滚动加载** — 首屏按可见区域揭示若干行，之后滚动逐行揭示（行内 1–6 张随宽高比与屏宽变化），行高自然、间距统一；无固定 12 张批次与独立触发器
- **照片卡片悬浮效果** — 鼠标悬停时整卡轻微上移（带回弹弹簧曲线）；卡片不显示元信息，标题、地点、日期与 EXIF 仅在灯箱放大后展示
- **全部作品筛选** — 作品范围（全部/精選/橫構圖/豎構圖）/拍摄年份/拍摄地点/作品类型四组胶囊筛选（可组合、URL 参数同步 `?s=/?y=/?l=/?c=`、按行揭示、计数滚动动画），各维度开关由 `hugo.toml` 的 `[params.galleryFilters]` 控制
- **系列作品** — 多张照片可归入同一主题系列；首页「系列」区块与「系列合集」页以目录卡片展示（封面/名称/张数），详情页单列展示全部照片；灯箱标题下方有分类/系列胶囊入口
- **作品分類目录** — `/categories/` 目录页与首页「分類」区块同款卡片（封面策略可配置：自定义封面或最新横构图作品），各分类页位于 `/categories/<key>/`
- **SPA 页面切换** — 站内导航先取新页面、旧页面保持可见，内容就绪后淡出淡入；header/footer 不重载

### 灯箱与图像分析

- **Lightbox 灯箱** — 点击缩略图，灯箱从缩略图位置**放大浮现**（FLIP 缩放，与全站动画同曲线同时长；先用已缓存缩略图即时呈现、后台预载全尺寸换源——全程无转圈、仅变清晰）；左右箭头+键盘切换、触屏水平滑动切图（跟随手指、阈值提交、与抽屉展开方向仲裁）；桌面端右侧元信息面板（機身/鏡頭/EXIF 分行 / 线性直方图 / 影调分析 / 六色色卡 / 飽和度分布 / 色相分布 / 背後的故事，缺失信息以删除线展示；分析加载失败时显示提示卡而非静默空白），窄屏为可拖动的底部抽屉（滚动条按需显示、预留空间不挤动文字）；每张照片独立 URL `?p=照片名`（地址栏实时更新、**返回键关闭灯箱**——灯箱只占一个历史条目；带参直达自动恢复，与筛选 URL 参数互不干扰）
- **图像分析** — 直方图/影调/色卡/飽和度/色相（摄影界标准口径；打开/切图预取当前 ±1 照片的数据，展开时渲染；按 slug + 内容版本缓存），详见下文「灯箱分析算法说明」

### 足迹与統計

- **足迹世界地图** — 足迹页全宽自绘 SVG 世界地图（Natural Earth 10m 精细陆地 + 中国省级边界 + 海外国家边界；省份/国家为独立可点击区块，桌面悬停/键盘聚焦弹层显示地名/张数/年份，触屏点按无弹层直接跳转），照片坐标形成点迹（光环 + 核心、错峰入场、纯展示），视图自动适配全部足迹；点击区块经 SPA 直达地点详情页；地图高度随屏宽连续变化（≤768px 锁定 0.75、768→1200px 线性插值至 0.45 一屏看全）；明暗主题切换零光栅化负担
- **足迹地点页** — 每处拍摄地点自动生成详情页（`data/locations.toml` 加一条即生效，`/footprint/<slug>/`），展示该地区全部作品（含系列内页）；足迹页地图区块点击直达
- **拍攝檔案統計** — 關於頁照片參數統計：機身排行、焦距/光圈/快門/感光度分佈、年度拍攝走勢（兩列卡片等高、窄屏單列；構建期聚合、純 CSS 條形圖、零 JS）

### 站点体验

- **明暗主题切换** — 头部主题切换按钮（太阳/月亮图标过渡动画），localStorage 持久化、首帧前内联脚本恢复存储主题避免闪烁，默认暗色，`color-scheme` 随主题联动；亮色主题整套冷调色板（全部经 :root 分量变量引用、对比度全过 WCAG AA）；图片相关区域（灯箱/首页轮播）固定暗色不随主题切换；足迹地图颜色瞬时切换（无过渡）
- **响应式动画过渡** — 列数切换、分类/系列卡片网格、足迹地图旋转、移动端导航均带 FLIP/淡入动画（换行/布局跳变平滑过渡）
- **PWA 支持** — Service Worker 离线缓存（版本化壳缓存随发布自动清理；哈希产物/字体/分析结果 JSON 走缓存即用后台更新；离线打开未访问过的链接回退到首页壳；导航缓存键去查询串——`?y=`/`?p=` 等客户端状态参数 URL 与页面本体同缓存、离线可直接打开）
- **Instant.page** — 链接预加载，提升浏览体验
- **SEO 支持** — 站点地图 `/sitemap.xml`（Hugo 内置，仅页面 URL、不含图片地址——OSS 额度保护）与 `robots.txt`；全站与照片页结构化数据 JSON-LD（`WebSite`/`Person`/`ImageGallery`/`Photograph`，含拍摄日期/地点/EXIF 参数与作者，**不含任何图片 URL**——搜索引擎只获得元信息文本、不收录照片地址）
- **中文排版优化** — 使用 Glyph Correction、Noto Serif TC、I.MingCP、LXGW WenKai TC 等中文字体，支持本地字体注入

### 订阅与图片基建

- **摄影作品订阅源** — RSS 2.0（`/index.xml`），按拍摄日期分组通知新发布作品（张数/作品名/地点/日期），批次数量由 `feedCount` 配置
- **图片 CDN** — 阿里云 OSS 实时处理管线：AVIF/WebP 多尺寸多质量按需生成（缩略图 w_800 / 灯箱 w_1920 / 封面 w_1000 等，边缘缓存），不支持 AVIF 的环境自动回退 WebP；OG/社交抓取图保持 WebP

## 🔬 灯箱分析算法说明

灯箱的色卡、影调与色彩分析读取照片生成管线预计算的结果：对全分辨率原图逐像素统计（Rec.709 明度/HSV/色卡/直方图），写入 `/analysis/{slug}.json`；灯箱只做曲线派生与 SVG 渲染，无逐像素计算、不依赖 OSS CORS。结果缺失或拉取失败时显示「無法載入分析結果」提示卡。分析采用**摄影界标准口径**，无外部黑盒算法。

分析区块默认收起（数据在灯箱打开/切图时已预取当前照片与左右各一位，只填缓存不渲染），EXIF 下方「圖像分析」触发行点击后展开渲染（不额外显示加载指示，区域底部「收起圖像分析」收起）；展开态跨作品保持，结果按 slug + 内容版本缓存，Service Worker 对分析 JSON 走缓存即用/后台刷新——回看与再次展开直接命中。

### 直方图（并入影調区块）

- R/G/B 三通道曲线 + 金色明度曲线（Rec.709 加权亮度），各 256 点固定结构、线性纵轴（与常规修图软件一致；RGB 与明度共用统一峰值归一化），渲染为 SVG 矢量
- 切图时曲线**连续形变过渡**（0.4s easeOutCubic，与占比条/灰階括号同源同节奏，时长取自 `--transition-chart` 变量）
- 注释层：陰影/中間調/高光三分区底色（分区界 = 18% 灰 ±1 档曝光）、P50 虚线标记（亮度中位数位置，影调判定的依据）、两端剪裁三角（陰影/高光剪裁警告）
- 图例行：R / G / B / 明度（通道色圆点 + 名称）

### 影调分析

经典九调命名：**高調/中間調/低調 × 長調/中調/短調**（如「低長調」，共用「調」后缀）。

- **高/中/低**：亮度**中位数 P50**（不受极端像素拉动）相对 18% 灰（sRGB ≈118）——<95 低調 ｜ 95–150 中間調 ｜ >150 高調
- **长/中/短**：**灰階跨度**（P5–P95 在 11 级等距灰階上的跨区数；P5/P95 剔除两端各 5% 极端像素）——≤4 區 短調 ｜ 5–7 區 中調 ｜ ≥8 區 長調；動態範圍（线性光真档）单独展示，不参与長短判定
- **剪裁警告**：≥2% 像素落在 0–5 → 陰影剪裁；≥2% 落在 250–255 → 高光剪裁（与修图软件的高光/陰影剪裁警告同口径）
- **曝光灰階标尺**：安塞尔·亚当斯區域系統 11 级等距灰階（0 纯黑 → X 纯白），括号标出照片 P5–P95 占據區域（与長短判定同源）
- **三区占比条**：陰影/中間調/高光三段堆叠 + 百分比（分区界 = 18% 灰 ±1 档曝光）

### 飽和度分布

HSV 饱和度 0–100% 直方图 + 均值虚线 + 18%/45% 分段线（低飽和 ←→ 高飽和轴标注）；按低/中/高三段**像素占比最大的一档**判定（<18% 低飽和 ｜ 18–45% 適中 ｜ ≥45% 高飽和）。

### 色相分布

- HSV 色相 0–360° 直方图（36 段，每段填其色相本色、主色相段高亮），按饱和度加权（灰色无相，不参与判定）
- 主色相取 8 个标准色名（紅/橙/黃/綠/青/藍/紫/品紅），沿横向均布标注
- **黑白照判定**：平均饱和度 <5% → 结论显示「黑白」、色相图以灰色柱呈现

## 🚀 快速开始

### 环境要求

- **Hugo** ≥ 0.139（标准版；CI 固定 0.164；`silenceDeprecations` 自 0.139 起支持）
- **Dart Sass** 1.107.0 独立版（不要用 npm 版：纯 JS 构建缺少 Hugo dartsass 需要的 embedded 协议）
- **Git**

### 本地开发

```bash
# 克隆仓库（含子模块）
git clone --recurse-submodules https://github.com/guanqr/photo-folio.git
cd photo-folio

# 安装 Dart Sass 独立版（不要用 npm 版）：下载官方 standalone 包，
# 把含 sass / sass.bat 的目录加入 PATH，然后确认：
sass --version

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
├── tools/               # 站点工具（按功能分目录，Python、零第三方依赖）
│   ├── photo-pipeline/  # 照片水印/缩放/压缩处理管线（直写 data/photo.toml）
│   ├── map-data/        # 足迹地图几何生成管线（generate-maps.py，陆地 10m + 省界）
│   ├── geocode/         # 照片地址地理编码（geocode-photos.py + config.json）
│   └── backfill/        # 照片宽高回填（backfill-dimensions.py）
├── static/              # 静态文件（CNAME、robots.txt 等）
├── themes/
│   └── photofolio/      # 自定义主题
│       ├── archetypes/  # 内容模板（站点根目录不设 archetypes，避免遮蔽主题模板）
│       ├── assets/      # SCSS / JS 源文件（含 PWA manifest 模板）
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
width = "1920"            # 宽高由预处理管线 tools/photo-pipeline/ 生成（取处理后输出图尺寸，横/竖构图据此推导）
height = "1280"
hash = "a1b2c3d4"         # 输出图内容哈希（管线自动生成；图片 URL 以 ?v= 拼接，换图即刷新缓存）
camera = "NIKON Z 5"      # 机身（灯箱「機身」行展示，缺失时以删除线占位）
address = "浙江省杭州市西湖区曲院风荷"  # 详细地址（选填；相机无 GPS，由 geocode-photos.py 转经纬度）
lat = "30.2534"           # 纬度（选填，脚本从 address 生成，坐标字段保留备用）
lng = "120.1320"          # 经度（同上）
lens = "NIKKOR Z 24-200mm f/4-6.3 VR"  # 镜头（灯箱「鏡頭」行展示，缺失时以删除线占位）
description = "照片描述（可选，用于 Lightbox 展示）"
series = ""               # 系列名称（可选，同一系列的多张照片填写相同名称）
is_cover = false          # 是否为系列封面（同一系列中仅一张设为 true）
featured = true           # 精選标记（可选，true 的照片进入首页轮播，并可在全部作品页按「作品範圍 → 精選」筛选）
```

### 足迹地图与地点页

足迹页顶部的地图使用照片自身的 `lat`/`lng` 绘制点迹，并按省/国区块聚合、点击跳转地点详情页；`data/locations.toml` 负责地点页注册（名称与 slug），坐标字段保留备用、当前不参与地图：

```toml
[[location]]
name = "雲南"      # 必须与 photo.toml 的 location 字段逐字一致
slug = "yunnan"    # 地点页 URL：/footprint/yunnan/（缺省按名称 urlize）
lat = 26.86       # 保留备用
lng = 100.23
```

- 照片的 `location` 未登记进 `locations.toml` 时构建会报错（地点页无法生成，时间线/地图链接会 404）——新增拍摄地点时先加一条
- 地图陆地与省界几何为一次性生成的数据（`themes/photofolio/static/maps/land-10m.json` 世界陆地、`provinces.json` 中国省级边界线按省索引，含港澳台），如无特殊需要不必重新生成（管线：`python tools/map-data/generate-maps.py`）
- **照片坐标字段**：为照片填 `address`（详细地址）后运行 `python tools/geocode/geocode-photos.py` 生成 `lat`/`lng`（需先申请高德开放平台「Web 服务」key，写在 `tools/geocode/config.json`（`{"amap_key": "..."}`，复制 config.example.json 填写，已 gitignore 不入库）或环境变量 `AMAP_KEY`；脚本按 350ms 间隔串行请求、可重复运行，坐标写入 address 行之后；高德无结果/网络异常时经 OSM Nominatim 兜底（海外地址），key 无效/配额耗尽等错误直接中止、不会把境内地址误交给境外服务）；**lat/lng 用于足迹地图点迹**（详情页不再展示小地图）

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

同时在 `content/series/` 目录下创建对应的 Markdown 文件（`photos` 列表决定详情页的展示顺序；front matter 统一 TOML 格式）：

```markdown
+++
title = "割藺草"
photos = ["割蔺草-1.jpg", "割蔺草-2.jpg", "割蔺草-3.jpg"]
+++
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
| `params.galleryFilters` | 全部作品页筛选维度开关：`scope` / `year` / `location` / `category`（true 开启、false 关闭；模板缺省仅 year，站点当前开启 scope/year） |
| `params.grid` | 瀑布流加载策略：`initialFillExtra`（首屏可见区域外额外高度，默认 200px）/ `initialFillMaxItems`（首屏单批上限，默认 24 张）/ `triggerOffset`（滚动触发距离，默认 40px） |
| `params.aboutStats.yearMergeBefore` | 关于页「拍摄档案」年度走势：该年份以前的照片合并为一项（如 2024 表示 2024 年前合并） |
| `taxonomies` | 已清空（站点不使用 Hugo 内置分类法；`content/categories/` 为普通 Section 层级） |

## 🚢 部署

Push 到 `main` 分支后，GitHub Actions 自动：

1. 拉取源码 + 子模块
2. 使用 Hugo 标准版 + Dart Sass 构建
3. 推送到 `guanqr/photo-folio` 仓库的 `gh-pages` 分支

CDN 图片通过阿里云 OSS（`guanqr.oss-cn-hangzhou.aliyuncs.com`）提供。

## 📄 License

主题 PhotoFolio 使用 MIT 协议。照片版权归作者所有。
