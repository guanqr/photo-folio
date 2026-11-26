# 啼鳥怨年華 — 摄影作品站

基于 [Hugo](https://gohugo.io/) 的个人摄影作品展示网站，使用自定义主题 **PhotoFolio**。

🔗 **线上地址：[photo.guanqr.com](https://photo.guanqr.com/)**

📚 **维护者文档**：[docs/](docs/README.md)（架构 / 布局 / 灯箱 / 样式 / 管线 / 质量）。

## ✨ 特性

### 作品浏览

- **两端对齐行布局** — 参考实现式：行高由本行照片内容自然决定、行宽恰好铺满容器（零拉伸、零粗暴裁切），行高贴近参考值（肉眼看基本一致），按展示顺序逐行加载不乱序，resize 自动重排（跨档位换行带 FLIP 过渡）；超窄屏（≤500px）横构图独占一行、竖构图与相邻照片同行
- **整页容器 + 渐进加载** — 整组照片的行计划一次算完、页面高度撑满，滚动条一开始就能直达底部；首屏只揭示可见窗口内的行（不额外预载），刷新恢复滚动位置时只揭示当前视口行；之后正常下拉逐行补载，一次补多行也由串行队列逐行建立（图片请求与入场都不同时）；拖到未渲染区域时只补视口内的行；已渲染行保留，滚回不闪；末行 ≥2 张时以常规行最小实际行高为基准，放大后超过其 1.1 倍则保持最小行高左对齐，单张末行仍按参考行高 H 留白（详见 [docs/layout.md](docs/layout.md)）
- **照片卡片悬浮效果** — 鼠标悬停时整卡轻微上移（带回弹弹簧曲线）；悬停显示标题与焦距/光圈两行小字（触屏无悬停）；地点、日期与完整 EXIF 在灯箱中展示
- **全部作品筛选** — 作品范围（全部/精選/橫構圖/豎構圖）/拍摄年份/拍摄地点/作品类型四组胶囊筛选（可组合、URL 参数同步 `?s=/?y=/?l=/?c=`、视口窗口渲染、计数滚动动画），各维度开关由 `hugo.toml` 的 `[params.galleryFilters]` 控制
- **系列作品** — 多张照片可归入同一主题系列；首页「系列」区块与「系列」页以目录卡片展示（封面/名称/张数），详情页单列展示全部照片；灯箱标题下方有分类/系列胶囊入口
- **分類目录** — `/categories/` 目录页与首页「分類」区块同款卡片（封面策略可配置：自定义封面或最新横构图作品），各分类页位于 `/categories/<key>/`
- **SPA 页面切换** — 站内导航先取新页面、旧页面保持可见，内容就绪后淡出淡入；header/footer 不重载

### 灯箱与图像分析

- **Lightbox 灯箱** — 骨架与灯箱入口在首次打开（点击作品或带 `?p=` 直达恢复）时才注入/加载（页面 HTML 不内联灯箱 DOM，首载不下载灯箱 JS）；点击缩略图，灯箱从缩略图位置**放大浮现**（FLIP 缩放，与全站动画同曲线同时长；先用已缓存缩略图即时呈现、后台预载全尺寸换源——全程无转圈、仅变清晰；打开时锁定页面滚动并隐藏滚动条，覆盖满视口）；左右箭头+键盘切换、触屏水平滑动切图（跟随手指、阈值提交、与抽屉展开方向仲裁；翻页覆盖当前页面全部照片，含尚未滚动加载的行——不触发布局加载、关闭后页面保持原状）；灯箱底部缩略图条（等高按比例、当前项 accent 高亮、点击切图、随翻页自动跟随；桌面端以透明覆盖层融入毛玻璃背景，窄屏位于抽屉下方，w_240 小图 lazy 加载）；自动播放（默认关闭、顶栏播放/暂停、灯箱顶部时间进度条随播放填充、切图重置、主图加载完成后才开始计时、末张循环、手动操作即停；间隔由 `params.lightboxAutoplay` 配置）；桌面端右侧元信息面板（機身/鏡頭/EXIF 分行 / 线性直方图 / 影调分析 / 六色色卡 / 飽和度分布 / 色相分布 / 背後的故事，缺失信息以删除线展示；分析加载失败时显示提示卡而非静默空白），窄屏为可拖动的底部抽屉（滚动条按需显示、预留空间不挤动文字；底缘箭头仅内容触底时朝上、收起图像分析期间方向不跳变，点向下箭头会展开并同时平滑滚到内容底部）；左上角显示当前照片编号（`001 / 050`，随翻页更新）；顶栏全屏按钮（真全屏、隐藏浏览器 chrome；全屏时隐藏底部缩略图与详情，只留主图/编号/按钮/左右箭头，Esc 退出，不影响自动播放）；每张照片独立 URL `?p=照片名`（地址栏实时更新、**返回键关闭灯箱**——灯箱只占一个历史条目；带参直达自动恢复，与筛选 URL 参数互不干扰）
- **图像分析** — 直方图/影调/色卡/飽和度/色相（摄影界标准口径；打开/切图预取当前 ±1 照片的数据，展开时渲染；按 slug + 内容版本缓存），算法口径见 [docs/lightbox.md](docs/lightbox.md)

### 足迹与統計

- **足迹世界地图** — 足迹页全宽自绘 SVG 世界地图（Natural Earth 10m 精细陆地 + 中国省级边界 + 海外国家边界；省份/国家为独立可点击区块（高精度省/国单层深色填充与描边；主岛低精度填充/描边整条隐藏、退化 sliver 不绘制，其他地区保留低精度陆地，两套线在边界处无缝衔接），桌面悬停/键盘聚焦弹层显示地名/张数/年份，触屏点按无弹层直接跳转），照片坐标形成点迹（光环 + 核心、错峰入场、纯展示），视图自动适配全部足迹；三份几何数据并行加载、Service Worker 走 SWR 回访即出缓存；地图高度随屏宽连续变化（≤768px 锁定 0.75、768→1200px 线性插值至 0.45 一屏看全）；明暗主题切换零光栅化负担
- **足迹地点页** — 全国省级地区已在 `data/locations.toml` 预登记，有照片的地区自动生成详情页（`/footprint/<slug>/`），展示该地区全部作品（含系列内页）；足迹页地图区块点击直达
- **拍攝檔案統計** — 關於頁照片參數統計：機身排行、焦距/光圈/快門/感光度分佈、年度拍攝走勢（兩列卡片等高、窄屏單列；構建期聚合、純 CSS 條形圖、零 JS）

### 站点体验

- **明暗主题切换** — 头部主题切换按钮（太阳/月亮图标过渡动画），localStorage 持久化、首帧前内联脚本恢复存储主题避免闪烁，默认跟随系统偏好（无本地选择时按 `prefers-color-scheme`，无 JS 时由媒体查询兜底），`color-scheme` 随主题联动；亮色主题整套冷调色板（全部经 :root 分量变量引用、对比度全过 WCAG AA）；图片相关区域（灯箱/首页轮播）固定暗色不随主题切换；足迹地图颜色瞬时切换（无过渡）
- **响应式动画过渡** — 瀑布流跨档位换行、列数切换、分类/系列卡片网格、足迹地图旋转、移动端导航均带 FLIP/淡入动画（换行/布局跳变平滑过渡）
- **页面级 JS 按需加载** — 核心 bundle 只保留全站模块；瀑布流/地图/轮播/系列粒子/关于统计按当前页面加载，灯箱入口首次打开才加载；入口带内容指纹、跨页复用缓存，SPA 换页时先按住新网格卡片避免无 src 卡片铺开
- **PWA 支持** — Service Worker 离线缓存（版本化壳缓存随发布自动清理；哈希产物/分析结果 JSON/地图几何 JSON 走缓存即用后台更新；离线打开未访问过的链接回退到首页壳；导航缓存键去查询串——`?y=`/`?p=` 等客户端状态参数 URL 与页面本体同缓存、离线可直接打开）
- **SEO 支持** — 站点地图 `/sitemap.xml`（Hugo 内置，仅页面 URL、不含图片地址——OSS 额度保护）与 `robots.txt`；OG/Twitter 图片在页面无 cover 时回退展示顺序最前的精选；SPA 换页同步 canonical/OG/Twitter/description；订阅源只保留首页 `/index.xml`，不再生成空 section feed；全站与照片页结构化数据 JSON-LD（`WebSite`/`Person`/`ImageGallery`/`Photograph`，含拍摄日期/地点/关键词与作者；列表页最多输出 `params.jsonldPhotoLimit` 条（默认 24，0 不限），EXIF 明细不进 JSON-LD，`numberOfItems` 保持真实总数；**不含任何图片 URL**——搜索引擎只获得元信息文本、不收录照片地址）
- **中文排版优化** — 使用自建字体库的 I.MingCP（标题/正文）与 LXGW WenKai TC（元信息/页脚），Glyph Correction 本地注入；不引入 Google Fonts 或思源宋体外链

### 订阅与图片基建

- **摄影作品订阅源** — RSS 2.0（`/index.xml`），每张作品一条、按发布时间倒序（`published` 缺失回退拍摄时间），条目数由 `feedCount` 配置；`guid` 用作品 `src`，补发旧拍摄日期的作品也能通知订阅者
- **图片 CDN** — 阿里云 OSS 实时处理管线：AVIF/WebP 多尺寸多质量按需生成（缩略图 w_800 / 灯箱 w_1920 / 窄屏灯箱 w_1280 / 缩略图条 w_240 / 封面 w_1000 等，边缘缓存），不支持 AVIF 的环境自动回退 WebP；OG/社交抓取图保持 WebP

## 📐 瀑布流排布算法

行高公式、分行规则、末行判定与整页渐进加载的完整推导见 [docs/layout.md](docs/layout.md)。

## 🔬 灯箱分析算法

直方图、影调、饱和度与色相的统计口径和判定阈值见 [docs/lightbox.md](docs/lightbox.md)。

## 🚀 快速开始

### 环境要求

- **Hugo** ≥ 0.139（标准版；CI 固定 0.169；`silenceDeprecations` 自 0.139 起支持）
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
# 样式标尺自检（CI 构建前也会运行）
python tools/style-lint/check_style.py

hugo --gc --minify --cleanDestinationDir --panicOnWarning
```

构建产物在 `public/` 目录。

## 📁 项目结构

```
photo-folio/
├── assets/              # Hugo 资源（jsconfig.json）
├── content/
│   ├── archives/        # 歸檔（全部作品）
│   ├── series/          # 系列（主题系列作品）
│   ├── categories/      # 分類目录（各分类位于其下）
│   │   ├── scenery/     # 風光分类（城市/乡村/山河合并）
│   │   ├── humanist/    # 人文分类
│   │   ├── floral/      # 花木分类
│   │   └── animal/      # 动物分类
│   ├── footprint/       # 足迹（按地区归档）
│   └── lightbox-shell.md # 灯箱骨架页（首开 fetch；noindex、不进 sitemap）
├── data/
│   ├── photos/          # ★ 照片数据分片（按拍摄年份：pre-2024.toml、2024.toml…）
│   └── locations.toml   # 足迹地图坐标（按 location 名键控）
├── tools/               # 站点工具（按功能分目录；photo-pipeline 依赖 Pillow/oss2）
│   ├── photo-pipeline/  # 照片水印/缩放/压缩处理管线（直写 data/photos/ 分片）
│   ├── map-data/        # 足迹地图几何生成管线（generate-maps.py，陆地 10m + 省界）
│   ├── geocode/         # 照片地址地理编码（geocode-photos.py + config.json）
│   ├── backfill/        # 照片宽高回填（backfill-dimensions.py）
│   └── style-lint/      # 样式标尺自检（check_style.py，CI 构建前运行）
├── static/              # 静态文件（CNAME、robots.txt 等）
├── themes/
│   └── photofolio/      # 自定义主题
│       ├── archetypes/  # 内容模板（站点根目录不设 archetypes，避免遮蔽主题模板）
│       ├── assets/      # SCSS / JS 源文件（含 entries/ 页面级入口、PWA manifest 模板）
│       ├── layouts/     # 页面模板（含 lightbox-shell.html 骨架页）
│       ├── i18n/        # 国际化
│       └── static/      # 主题静态资源（maps/ 陆地几何数据）
├── hugo.toml            # Hugo 配置
└── .github/workflows/   # CI/CD 自动部署
```

## 📸 添加照片

所有照片数据集中在 `data/photos/` 分片目录，按拍摄年份拆分（2024 年以前合并为 `pre-2024.toml`），每张照片一条记录。完整字段、构建期校验与排序口径见 [docs/architecture.md](docs/architecture.md)。

> 💡 推荐使用 [images](https://github.com/guanqr/images) 工具自动读取照片 EXIF 信息，批量生成照片数据条目，省去手工填写的麻烦。

```toml
[[photo]]
src = "/images/photos/示例照片.jpg"
alt = "作品標題"
category = "scenery"      # scenery / humanist / floral / animal
focus = "24"              # 焦距 (mm)
iso = "100"
aperture = "5.6"
shutter = "1/250"
time = "2025-10-05 15:33:52"  # 拍摄时刻（EXIF 原值；同日作品按秒级时刻区分）
place = "雲南麗江"
location = "雲南"
width = "1920"            # 宽高由预处理管线 tools/photo-pipeline/ 生成（取处理后输出图尺寸，横/竖构图据此推导）
height = "1280"
hash = "a1b2c3d4"         # 输出图内容哈希（管线自动生成；图片 URL 以 ?v= 拼接，换图即刷新缓存）
source_hash = "…"         # 输入图内容 MD5（换图检测，站点不消费；管线自动生成）
published = "2026-11-12T10:00:00+08:00"  # 发布时间（RSS 排序；管线新建条目时写入一次）
camera = "NIKON Z 5"      # 机身（灯箱「機身」行展示，缺失时以删除线占位）
address = "浙江省杭州市西湖区曲院风荷"  # 详细地址（选填；原图无 GPS 时供 geocode-photos.py 转经纬度）
lat = "30.2534"           # 纬度（选填；原图自带 GPS 时管线自动填，否则由 address 地理编码生成，用于足迹地图点迹）
lng = "120.1320"          # 经度（同上）
lens = "NIKKOR Z 24-200mm f/4-6.3 VR"  # 镜头（灯箱「鏡頭」行展示，缺失时以删除线占位）
description = "照片描述（可选，用于 Lightbox 展示）"
series = ""               # 系列名称（可选，同一系列的多张照片填写相同名称）
species = ""              # 鸟种 id（可选，对应 data/birds.toml；灯箱显示觀鳥圖鑑）
is_cover = false          # 是否为系列封面（同一系列中仅一张设为 true）
featured = true           # 精選标记（可选，true 的照片进入首页轮播，并可在歸檔页按「作品範圍 → 精選」筛选）
```

> 排序与调序：站点按年份分片降序拼接（2026 → 2025 → 2024 → pre-2024），每个分片文件内部从上到下就是瀑布流顺序（新→旧）。想调整同一天照片的先后，直接在对应分片里上下移动条目即可；跨日顺序由拍摄时间保证。管线重跑与回填脚本会保留既有顺序，新照片按拍摄时间插入对应年份分片。

### 足迹地图与地点页

足迹页顶部的地图使用照片自身的 `lat`/`lng` 绘制点迹，并按省/国区块聚合、点击跳转地点详情页；`data/locations.toml` 负责地点页注册（名称与 slug），坐标字段保留备用、当前不参与地图：

```toml
[[location]]
name = "雲南"      # 必须与照片数据的 location 字段逐字一致
slug = "yunnan"    # 地点页 URL：/footprint/yunnan/（必填且唯一；缺省构建报错）
lat = 26.86       # 保留备用
lng = 100.23
```

- 全国省级地区已在 `locations.toml` 预登记（含港澳台），新增国内照片无需再改注册表；只有**海外新国家/地区**需要加一条 `[[location]]`，并在 `tools/map-data/map_names.py` 的 `COUNTRY_NAMES` 登记后运行 `generate-maps.py --names-only`；照片的 `location` 未登记时构建会报错（避免地图/地点链接 404）
- 地图陆地与省界几何为一次性生成的数据（`themes/photofolio/static/maps/land-10m.json` 世界陆地、`provinces.json` 中国省级边界线按省索引，含港澳台），如无特殊需要不必重新生成（管线：`python tools/map-data/generate-maps.py`）
- **照片坐标字段**：原图自带 EXIF GPS 时预处理管线直接写入 `lat`/`lng`（无 GPS 留空），无需另填；没有 GPS 的照片填 `address`（详细地址）后运行 `python tools/geocode/geocode-photos.py` 补坐标（需先申请高德开放平台「Web 服务」key，写在 `tools/geocode/config.json`（`{"amap_key": "..."}`，复制 config.example.json 填写，已 gitignore 不入库）或环境变量 `AMAP_KEY`；脚本只处理仍缺坐标的条目，按 350ms 间隔串行请求、可重复运行；高德无结果/网络异常时经 OSM Nominatim 兜底（海外地址），key 无效/配额耗尽等错误直接中止、不会把境内地址误交给境外服务）；**lat/lng 用于足迹地图点迹**（详情页不再展示小地图）

### 系列作品

多张照片可归入同一个系列（如「割藺草」系列）。封面（`is_cover = true`）用于首页「系列」区块与「系列」页的目录卡片，点击卡片进入系列详情页浏览全部照片。

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

同时在 `content/series/` 目录下创建与系列同名的 Markdown 文件（front matter 统一 TOML 格式）。系列照片直接由照片数据的 `series` 字段自动带出，按展示顺序（分片内条目顺序，手动调序优先）排列，无需再维护文件名列表：

```markdown
+++
title = "割藺草"
+++
```

### 观鸟图鉴（`data/birds.toml`）

观鸟照片在照片数据中填 `species = "<id>"`（对应 `data/birds.toml` 的 `[[bird]]` id），灯箱详情栏底部会显示可折叠的「觀鳥圖鑑」：目→科→屬→種（中文 + 拉丁学名）、分布區域、棲息地、習性與資料來源，物种名右侧显示保育等级标签；默认收起、开合状态跨切图保持、关闭灯箱复位。不显示插图、观察记录与保护级别。

```toml
# 观鸟系列名：属于该系列的照片即使缺少 species 也显示图鉴开关
bird_series = "觀鳥"

[[bird]]
id = "fairy-pitta"
name = "仙八色鶇"              # 种名：「種」行使用，也是标题缺省值
display_name = "俗名（种名）"   # 可选：仅覆盖图鉴标题
latin = "Pitta nympha"
order = "雀形目"
order_latin = "Passeriformes"
family = "八色鶇科"
family_latin = "Pittidae"
genus = "八色鶇屬"
genus_latin = "Pitta"
distribution = "分布区域说明"
habitat = "栖息环境说明"
habits = "习性说明"
conservation_level = "vu"        # 保育等级：lc / nt / vu / en / cr / domestic；文案与底色由该值决定

[[bird.source]]
label = "资料来源名称"
url = "https://example.com/source"
```

- `id` 唯一；照片数据的 `species` 必须能在 birds.toml 找到；构建期校验字段完整性与引用，缺项会报错
- 图鉴标题优先使用可选 `display_name`，缺省回落 `name`；分类「種」始终使用 `name`
- 属于 `bird_series` 的照片即使没有 `species` 也会显示图鉴开关；展开显示「缺少鳥種圖鑑資料」空状态（与图像分析失败卡同款），补上 `species` 后显示图鉴
- 物种名标题右侧显示保育等级标签：只维护 `conservation_level`（`lc` / `nt` / `vu` / `en` / `cr` / `domestic`），标签文案按等级从 i18n 取、底色按等级切换；构建期校验等级取值
- `[[bird.source]]` 至少一条，灯箱内显示为外链；数据文本建议使用繁体中文

### 精選（featured）

在任意照片记录中添加 `featured = true`，该照片便会进入首页轮播（按展示顺序取前 N 张，数量由 `carouselCount` 配置），并可在歸檔页通过「作品範圍 → 精選」筛选查看。

## 🎨 配置

主要配置在 `hugo.toml`，完整说明见 [docs/architecture.md](docs/architecture.md)（配置项）：

| 配置项 | 说明 |
|---|---|
| `params.imageCDN` | 图片 CDN 前缀（如阿里云 OSS），留空则使用本地图片 |
| `params.imageSizes.strip` | 灯箱底部缩略图条小图宽度（默认 240，OSS 按需生成，lazy 加载） |
| `params.imageSizes.lightboxNarrow` | 窄屏（≤1000px）灯箱主图宽度（默认 1280，OSS 按需生成） |
| `params.imageSizes.carouselWidths` | 首页轮播 srcset 候选宽度（默认 640/960/1280/1920；`carousel` 为无 srcset 环境回退宽度） |
| `params.lightboxAutoplay` | 灯箱自动播放间隔（毫秒，默认 5000；0 禁用并隐藏播放按钮；打开灯箱默认不自动播放） |
| `params.carouselCount` | 首页轮播精选图数量（1–12 张） |
| `params.categoryCover` | 首页/分类目录卡片封面策略：`custom`（仅自定义封面）/ `latest-landscape`（默认，取最新横构图作品） |
| `params.feedCount` | 摄影作品订阅源（`/index.xml`）输出的作品条数（按发布时间倒序） |
| `params.lightbox` | 灯箱信息区块开关：`meta` / `exif` / `palette` / `story` / `tonal`（影調，含合并直方图）/ `saturation`（飽和度分布）/ `hue`（色相分布）（缺省全开） |
| `params.enableServiceWorker` | 启用 PWA Service Worker |
| `params.typography` | 字体设置（fontLinks、字体名称、本地字体注入、基础字号 `baseFontSize`；其余字号档位按固定倍率写在 `_base.scss`，不开放配置） |
| `params.galleryFilters` | 歸檔页筛选维度开关：`scope` / `year` / `location` / `category`（true 开启、false 关闭；模板缺省仅 year，站点当前开启 scope/year） |
| `params.grid` | 瀑布流加载策略：`rowLoadRatio`（下一行至少多少比例进入视口后补载，默认 0.75，站点当前 0.5）；`lcpPreload`（首行前 N 张卡片在 HTML 直接写 src，默认 4，0 关闭）；首屏只揭示可见窗口内的行，不额外预载 |
| `params.yearMergeBefore` | 年份合并分界：早于该年份的年份合并为一档，标签显示分界年本身（如 2024 → 「2024 前」，即 2023 及更早；0/缺省不合并），同时作用于歸檔页年份筛选与关于页「拍摄档案」年度走势 |
| `params.jsonldPhotoLimit` | 列表页 JSON-LD 最多输出的照片条数（默认 24，0 = 不限；EXIF 明细不进 JSON-LD，`numberOfItems` 始终为真实总数） |
| `taxonomies` | 已清空（站点不使用 Hugo 内置分类法；`content/categories/` 为普通 Section 层级） |

## 🚢 部署

Push 到 `main` 分支后，GitHub Actions 自动：

1. 拉取源码 + 子模块
2. 使用 Hugo 标准版 + Dart Sass 构建
3. 推送到 `guanqr/photo-folio` 仓库的 `gh-pages` 分支

CDN 图片通过阿里云 OSS（`guanqr.oss-cn-hangzhou.aliyuncs.com`）提供。

## 📄 License

主题 PhotoFolio 使用 MIT 协议。照片版权归作者所有。
