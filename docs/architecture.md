# 架构与数据模型

> 迁自 `.claude/CLAUDE.md`（2026-11-16）；行为变更时同步更新本文件。文档索引见 [README.md](README.md)。

## 技术栈

- **Hugo** ≥ 0.139.0（标准版；SCSS 由外部 Dart Sass 1.107.0 独立版编译，JS 由内置 esbuild 打包）
- **自定义主题** `themes/photofolio`
- **数据格式** TOML（`data/photos/*.toml` 照片分片、`data/locations.toml`、`data/birds.toml`）
- **部署** GitHub Pages + 阿里云 OSS CDN
- **JS** ES6 模块，Hugo `js.Build`（esbuild）打包
- **CSS** SCSS，Hugo `css.Sass` 经外部 Dart Sass 1.107.0 编译（`transpiler: dartsass`；模块用 `@use`，base 共享模块 `as *`；`unquote` 改 `string.unquote`，无弃用警告）

---

## 照片数据结构

每张照片在 `data/photos/` 的某个分片中为一条 `[[photo]]` 记录（分片按拍摄年份拆分，2024 年以前合并为 `pre-2024.toml`）：

```toml
[[photo]]
src = "/images/photos/示例.jpg"   # 图片路径（相对于 static/ 或 CDN）
alt = "照片标题"
category = "scenery"               # scenery(風光：城市/乡村/山河合并)/humanist/floral/animal
focus = "24"                       # 35mm 等效焦距（优先 FocalLengthIn35mmFilm；缺失回退 FocalLength）
iso = "100"
aperture = "5.6"
shutter = "1/250"
camera = "Panasonic DMC-FT5"       # 相机（EXIF Model；缺品牌时补 Make；管线自动填）
lens = "LEICA DG 12-60"           # 镜头（EXIF LensModel；管线自动填）
time = "2025-10-05 15:33:52"      # 拍摄时刻（EXIF 原始口径；Hugo 只认带秒的 HH:MM:SS 与纯日期，无秒的 HH:MM 会解析报错）
place = "云南丽江"                  # 拍摄地点
location = "云南"                   # 所属地区（足迹地点注册与地图聚合依据）
address = "云南省丽江市玉龙雪山"     # 详细地址（选填，geocode-photos.py 地理编码输入；原图无 GPS 时补坐标）
lat = "27.1059"                    # 纬度（选填；原图自带 EXIF GPS 时管线自动填，否则由 address 地理编码生成；足迹地图点迹用）
lng = "100.1812"                   # 经度（同上）
hash = "a1b2c3d4"                  # 输出图内容哈希（管线自动生成；图片 URL 以 ?v= 拼接，换图即刷新缓存）
source_hash = "…"                 # 输入图内容 MD5 全 32 位（管线自动生成；换图检测用，站点不消费）
published = "2026-11-12T10:00:00+08:00"  # 发布时间（管线新建条目时写入一次，重跑/换图不变；RSS 排序用，旧条目缺失回退 time）
description = "照片描述"            # Lightbox 展示
series = "割蔺草"                   # 组照名称（同组照片填相同值，单张留空）
species = "fairy-pitta"            # 鸟种 id（选填；对应 data/birds.toml，灯箱显示觀鳥圖鑑）
is_cover = false                   # 是否为组照封面（同组仅一张为 true）
featured = true                    # 精选标记（可选；true 的照片进入首页轮播、OG 封面回退与全部作品页「精選」筛选）
```

- `category` 必须是 `content/categories/<key>/` 下存在的分类：构建期在 `photo-sorted` 唯一入口校验，拼错即 `errorf`（否则该分类照片只会出现在全部作品页、从分类页静默消失）

### 足迹地图与地点页（`data/locations.toml`）

```toml
[[location]]
name = "雲南"     # 必须与照片数据（data/photos/）的 location 字段逐字一致
slug = "yunnan"  # 地点页 URL：/footprint/yunnan/（必填、唯一；缺省不自动生成，适配器会 errorf）
lat = 26.86      # 保留备用
lng = 100.23
```

- 本表预登记全部 34 个省级地区（含港澳台）；内容适配器只为照片实际使用的地点生成 `/footprint/<slug>/` 页面，预留但无照片的地区不产生空页；照片 `location` 未登记进本表时构建报错（避免地图/地点链接指向未生成页面）
- `lat/lng` 保留备用：当前地图点迹使用照片 `photo.lat/lng`，地点页不依赖坐标；注册表不再输出坐标
- 地图陆地与省界几何为一次性生成数据（`themes/photofolio/static/maps/land-10m.json` 世界陆地 10m、`provinces.json` 中国省级边界线含港澳台——省界源要素需剔除无 adcode 的十段线/插图要素；管线 `python tools/map-data/generate-maps.py`，下载缓存 tools/map-data/vendor 不入库、临时文件原子替换写入、缓存损坏自动重下载）；几何统一为 `{quant, delta, data}`——整数对量化后再做增量编码（首点绝对、其余相邻差值，渲染端逐点累加还原），坐标点集与绝对坐标格式逐位一致，体积约减半（2026-11-15）
- 省/国名映射唯一源 `tools/map-data/map_names.py`（PROVINCE_NAMES/COUNTRY_NAMES）；`generate-maps.py` 直接 import 并生成 `themes/photofolio/assets/js/map-names.js`（渲染端 import、勿手改；`--names-only` 只刷新映射）；PROVINCE_NAMES 已全量覆盖 34 个省级地区（新增国内拍摄地无需再改），新增海外国家仍需登记 COUNTRY_NAMES

### 排序规则
- **分片内顺序即展示顺序**：`data/photos/` 按拍摄年份拆分，每个文件内部按「新→旧」保存；分片拼接顺序为 4 位年份降序、`pre-YYYY` 排最后（2026-11-20）
- **同一天的手动调序直接生效**：把条目在分片内上下移动即可，不再按 `time` 重排；管线 `write_photo_dir` 保持既有顺序，新条目/换图后 time 变化的条目按拍摄时间（新→旧）插入对应年份分片
- 跨日顺序始终由拍摄时间保证；手动调整只影响同一天的先后（跨日拖动会照文件顺序展示，不建议）
- 排序管线唯一实现：`layouts/partials/photo-sorted.html`（拼接分片、文件内顺序原样返回，不接受 `order` 参数；调用方用 `partialCached` 显式 variant `"display"`）

### 观鸟图鉴（`data/birds.toml`）

```toml
# 观鸟系列名：属于该系列的照片即使缺 species 也显示图鉴开关
bird_series = "觀鳥"

[[bird]]
id = "fairy-pitta"             # 与照片数据的 species 字段对应（唯一）
name = "仙八色鶇"               # 种名：「種」行使用，也是标题缺省值
display_name = "俗名（種名）"    # 可选：仅覆盖图鉴标题（俗名与种名不同时使用）
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
conservation_level = "vu"        # lc / nt / vu / en / cr / domestic；文案与底色由该值决定

[[bird.source]]
label = "资料来源名称"
url = "https://example.com/source"
```

- 照片填 `species = "<id>"` 后，灯箱详情栏底部显示可折叠「觀鳥圖鑑」（默认收起、开合状态跨切图保持、关闭灯箱复位）；展示目→科→屬→種分类（中文 + 拉丁学名）、分布區域、棲息地、習性、資料來源；标题优先用可选 `display_name`、缺省回落 `name`，「種」行始终用 `name`；物种名标题右侧显示保育等级标签（只维护 `conservation_level`，标签文案走 i18n、底色按等级切换），无插图、观察记录
- 属于 `bird_series` 的照片即使缺 `species` 也显示图鉴开关；展开显示「缺少鳥種圖鑑資料」空状态卡（沿用分析失败卡样式），补上 `species` 后显示图鉴
- `utils/bird-registry.html` 构建期校验：id 唯一、必需字段完整（含 `conservation_level`）、保育等级取值合法、每条至少一个 `[[bird.source]]`、照片数据的 species 必须能反查到条目、`bird_series` 必须匹配照片数据中至少一条 series、每个等级必须有 `bird_conservation_*` i18n 文案；灯箱壳内嵌 `data/birds.toml` JSON 供 `lightbox-bird.js` 按 id 取用，保育等级文案由注册表按唯一等级清单生成（`data-labels` JSON，shell/JS 不再逐级硬编码），照片卡片与灯箱壳共用注册表返回值

## 页面结构

### 1. 首页 `/`
- **全屏轮播**（`.carousel`，高度 `calc(100vh - 4.5em)`、宽度充满页面）：按展示顺序取前 `carouselCount` 张 `featured=true` 照片（分片拼接顺序，手动调序优先）（模板默认 12，站点当前 6）；`object-fit: cover` 居中适当裁剪、无白边；自动播放 5s/张（`params.carouselInterval`，默认 5000ms）+ 左右箭头 + 圆点；**鼠标悬停不再暂停**（仅键盘聚焦圆点暂停）；轮播仅作展示，点击照片不打开灯箱（2026-11-01 用户裁定）
- **轮播响应式图片**：`[params.imageSizes].carouselWidths`（默认 640/960/1280/1920）生成 `srcset` + `sizes=100vw`；首图 eager/fetchpriority 与 hero-preload 的 `imagesrcset` 同候选；其余 `data-src`/`data-srcset` 按需加载，左右邻居在 `requestIdleCallback` 空闲预取（1.5s 兜底），首屏不再同时拉 3 张 1920 图；AVIF 兜底同时改写 `srcset`
- 标题与副标题悬浮在轮播图左下角（`.carousel-overlay`，底部渐变压暗保证可读）
- **顶部导航栏透明**：滚动 ≤10px 时 header 背景透明；下拉后（`.is-scrolled`）显示 `--color-nav-bg` 背景 + 毛玻璃 + 底边框
- **分类卡片网格**（`categories-grid`）位于轮播图下方、下拉后可见：滚动进入视口时交错渐入（60ms/张）
- 分类卡片直接取 `categories` 分区（`site.GetPage "categories"`）下的四个分类生成，不按顶层目录枚举；每个卡片显示封面图、分类名、照片数量（分类描述不在任何卡片上展示）；封面默认取该分类最新一张横构图作品（`[params].categoryCover = latest-landscape`，可切 `custom`）
- 卡片按各分类页 front matter 的 `weight` 排序（当前 2–5；注意 Hugo `ByWeight` 将 0 视为无权重、排最后）

### 2. 作品集 `/gallery/` 及分类页 `/scenery/` 等
- 瀑布流照片展示
- 组照封面与内页一律作为普通卡片展示（不渲染系列图标/徽章），点击触发 Lightbox；系列入口由导航与系列合集页承担
- **页面底端「其他分類/系列」入口**（分类详情页与系列详情页共用 `page-others.html`）使用独立网格 `page-others-grid`：>1000px 4 列、0.5em 间距、3:2 封面，与瀑布流照片同尺寸；标题与张数压在封面底部渐变上（复用 `--photo-hover-overlay` 等照片悬停信息 token），封面按 `imageSizes.gallery`（800）取图、首页/目录大卡仍用 `category`（1000）；右侧带 `arrow_up_right` 大箭头标示可跳转（1.2em、跨标题/张数两行垂直居中、贴右边缘，悬停沿 ↗ 轻移；`svg.toml` 新增该图标）；列数基准由网格 `data-cols-base="2"` 声明（2/3/4 列），由 `cards-flip.js` 接管、与首页/目录卡共用同一套换列 FLIP 与滞回；档位只读 CSS 的 `--layout-tier`/`--layout-tier-exit`（不查 `innerWidth`/`matchMedia`，并监听 `orientationchange`），窄屏保持两列不退成单列大卡；首页与目录页的目录大卡不变
- **面包屑已移除**（全站）

### 2.5 全部作品筛选（仅 `/gallery/`）
- 四组胶囊按钮（`作品範圍 / 拍摄年份 / 拍摄地點 / 作品類型`），行首文字标签 + 「全部」按钮，可组合，默认全部；範圍选项为 `featured / landscape / portrait`（精選/橫構圖/豎構圖，可与年份等维度组合）
- 年份/地点/类型选项从网格渲染集（`$gridPhotos`，含组照内页——与卡片 data 属性同源）推导：年份降序、地点/类型按照片数降序；类型显示中文标题（風光/人文/花木/動物，分类页经 `site.GetPage (printf "/categories/%s" ...)` 绝对路径取标题）
- 早于 `params.yearMergeBefore` 的年份合并为一个「<分界年> 前」档（标签显示分界年本身，如分界 2024 → 「2024 前」、覆盖 2023 及更早；data-value `before-<分界年>`、`gallery-filter.js` 按数值区间匹配；0/缺省不合并），与关于页「拍摄档案」年度走势共用同一配置
- **年份干支背景**：选中具体拍摄年份时，页头标题区右侧淡入该年的天干地支（篆书竖排、浅灰背景，右侧与页面内容同边距；`utils/ganzhi.html` 按公曆年计算，i18n 取 10 天干/12 地支；`gallery-filter.js` 只切条目 `is-visible`，CSS 淡入/交叉淡入并支持减弱动态）；「全部」与合并档不显示，窄屏保持大字号、文字在上层
- 每组横向滚动（窄屏）+ 左右渐隐遮罩（深度分别随已滚动距离 / 右侧剩余可滚动距离连续变化：两侧各 48px 内由无渐隐平滑加深到满格，滚到对应端点时该侧完全消失）；切换后选中项自动滚入可视区
- **任何筛选状态都按整页容器渐进加载**：`restartMasonryGrid` 重启网格（集合外隐藏、集合内重建整组行计划与页面高度、先揭示当前视口内的行，之后滚动逐行补载）；无匹配显示空状态文案
- URL 同步（`pushState`；加载恢复/过期参数清理走 `replaceState`）：`?s=` 範圍、`?y=` 年份（合并档值形如 `before-2024`）、`?l=` 地点英文 slug（= 足迹页文件名，如 guangdong/japan）、`?c=` 类型；默认值不写入；直接打开带参链接 / 浏览器后退自动恢复筛选
- 维度开关由 `hugo.toml` 的 `[params.galleryFilters]` 控制（scope/year/location/category；模板缺省仅 year，站点当前开启 scope/year）
- 照片卡片带 `data-scope/year/location/category` 属性驱动匹配（`data-scope` 为 `featured`/`landscape`/`portrait` token 列表，精選与构图方向可并存）；地点按钮 data-value 存 slug、匹配用按钮中文文本

### 3. 组照合集 `/series/` 及详情页 `/series/{name}/`
- 列表页展示所有组照封面
- 详情页直接按照片数据的 `series` 字段取图（含内页），按展示顺序（分片内条目顺序，手动调序优先）排列，与其他瀑布流一致；无需 front matter `photos` 列表，不支持自定义系列内顺序
- 构建期校验：每个系列 `is_cover` 恰好 1 张；`series-url.html` 找不到同名内容页时 errorf（不再回退 urlize 死链）

### 4. 足迹 `/footprint/` 及地区页 `/footprint/{slug}/`
- **足迹世界地图**：自绘 SVG 等距圆柱投影（零外部库/瓦片），视图 = 照片点迹 ∪ **有照片省份的完整包围盒**（省份完整可见；海外国家不并入包围盒）；**省份/国家为独立填充区块**（高精度省/国填充 + 描边；高精度区块用单层深色实色，边缘即高精度轮廓；低精度陆地填充与描边在省/国区域内由 mask 挖掉、区域外保留低精度海岸线，两套线在边界处直接衔接，无缺口；海外国家主岛（跨度 >2° 且落在国界 bbox 内）的低精度填充与描边整条隐藏，由高精度国界提供轮廓；实心小岛保留填充和描边，长条/退化 sliver 整条不绘制（保留小岛轮廓、消除东海的细直线闭合轮廓）；悬停/聚焦提亮、点击跳转地点详情页；无照片地区 pointer-events none）；全部照片坐标形成**点迹**（光环为 `--color-accent` 径向渐变辉光 + 核心两层、纯展示）；鼠标/触控笔悬停与键盘聚焦显示弹层（地名/张数/年份跨度），**触屏不显示弹层、点按直接跳转地点详情页**（footprint-tooltip.js 按 pointerType 判定）；区块须声明 `cursor: pointer`（iOS 只向可交互或 cursor:pointer 元素派发 click）；陆地/省界/国家几何静态数据 + 同源 fetch 记忆化（失败降级为网格+点迹）；IntersectionObserver 懒加载（rootMargin 600px）；`prefers-reduced-motion` 完整降级；带边框圆角框架（内容裁剪到 viewBox，区块宽度与导航栏一致）
- 照片坐标字段：照片数据可选 address/lat/lng——原图自带 EXIF GPS 时预处理管线直接写 lat/lng（度分秒转十进制度 6 位小数、S/W 取负；缺 ref/值、越界、(0,0) 视为无坐标留空，2026-11-19）；仍缺坐标的条目再由 address 经 `tools/geocode/geocode-photos.py` 高德地理编码生成（key 走环境变量 AMAP_KEY 或 tools/geocode/config.json）；**lat/lng 用于足迹地图点迹**（详情页小地图已取消）；geocode 兜底口径：仅「无结果/网络异常」落 Nominatim——**key/配额类错误（infocode 1000 前缀）不落兜底、中止循环**（境外服务解析境内中文地址不可靠、会污染坐标）
- 地点注册表唯一实现：`layouts/partials/utils/location-registry.html`（Title → slug/URL，画廊筛选与足迹页共用；坐标不再输出，地图点迹用照片 lat/lng）
- 桌面端地图左栏 + 右侧地点预览面板（点击地块/点迹更新面板，整块链接进地点详情页）
- 地区详情页使用瀑布流展示

---

## 模板规范

- **SVG 图标统一管理**：所有 SVG 图标必须定义在 `data/svg.toml` 中，模板通过 `{{ $.Site.Data.svg.xxx | safeHTML }}` 引用，**严禁在 HTML 模板中直接硬编码 `<svg>` 标签**
- 新增图标时先在 `svg.toml` 添加定义（含 `xmlns`、`viewBox` 等完整属性），再在模板中引用
- **共享数据管线用 partial**：`utils/photo-sorted.html`（展示顺序）、`utils/location-registry.html`（地点注册表）——新模板不得重复实现
- **页面骨架单源**：页面头与空状态骨架用 `components/page-header.html`、`components/empty-state.html`（2026-10-18 自 13 处复制收敛），新页面不得复制骨架
- **灯箱壳分块**：`lightbox-shell.html` 只保留容器骨架（图片区/面板底栏/箭头/缩略图条/气泡容器），顶栏、地点日期+EXIF、图像分析、故事、觀鳥圖鑑拆为 `components/lightbox-{topbar,meta-exif,analysis,story,bird}.html`；区块开关 `lbCfg` 与鸟种注册表经 dict 传入分块
- **瀑布流网格单源**：网格标记与卡片循环统一由 `components/masonry-grid.html` 渲染，新列表页不得复制网格骨架
- 页面注入 JSON 数据用 `<script type="application/json">` + `jsonify | safeJS`（Hugo 会把 script 内容转义成带引号字符串，漏 safeJS 会导致 JSON.parse 得到字符串）
- 构建期 `errorf`/`warnf` 文案同样走 `i18n`（`error_*` 键），分隔符走 i18n（`list_separator` / `error_list_separator`）；模板里不拼中文标点或句子

---

## JS 模块

| 文件 | 功能 |
|---|---|
| `main.js` | 入口，DOMContentLoaded 统一初始化；全局模块只跑一次，页面模块按入口按需加载 |
| `entry-loader.js` | 页面级入口按需加载：读 `#js-entry-urls` 的指纹 URL、注入脚本、失败可重试 |
| `entries/*.js` | 按页/按需入口（list/home/map/about/lightbox，以及灯箱内按需的 lightbox-analysis/lightbox-bird）：打包对应模块并注册到 `window.__MimoEntries` |
| `lightbox-boot.js` | 灯箱懒启动：首次点击/`?p=` 深链时并行加载灯箱样式、fetch 骨架页、加载灯箱入口并重放点击；失败重试 |
| `lightbox-bridge.js` | SPA 导航关闭灯箱的薄桥（避免静态 import 把灯箱入口拉回核心 bundle；关闭函数经 window 注册——核心与灯箱入口各自打包本模块，模块级变量互不相通） |
| `gallery-filter-params.js` | 筛选 URL 参数键单源（核心 bundle 与 list 入口共用） |
| `masonry.js` | 网格引擎：整组行计划与完整页面高度、首屏可见窗口 + 下拉逐行补载（刷新恢复只揭示视口行、所有补行走串行队列一次建立一行、已渲染行保留）、自然行高布局（数学部分见 `masonry-layout.js`）、档位判定（CSS `--layout-tier`/`--layout-tier-exit` 单源 + 高度变化补行）、resize 重排（同档缩放 / 跨档 FLIP + 锚点补偿）、筛选重启（`restartMasonryGrid`）、`?p=` 深链直接渲染目标行、缺宽高照片 load 后按自然比例自愈 |
| `masonry-layout.js` | 瀑布流排版纯函数（零 DOM）：`rowHeight`/`getTargetRowHeight`/`partitionRows`/`shouldFillLastRow`/`planRowHeight`/`rowCellAbsorbs`/`rowCellWidth`/`isSquareRatio` |
| `gallery-filter.js` | 全部作品筛选：四组胶囊、URL 同步（pushState）、按窗口重启 |
| `footprint-map.js` | 足迹世界地图：等距圆柱投影、省/国区块、点迹/弹层/懒加载；三份几何数据并行拉取、失败分别降级 |
| `footprint-map-data.js` | 地图几何与省/国名数据 fetch/记忆化 |
| `footprint-geometry.js` | 地图投影/包围盒等几何工具 |
| `footprint-tooltip.js` | 地图弹层（pointerType 门控） |
| `lightbox.js` | 灯箱入口、全局点击委托与分析面板编排 |
| `lightbox-switch.js` | 灯箱打开/切图/关闭状态机与滑入滑出管线（监听/定时器经 `lightbox-lifecycle` 命名组注册，begin() 换代清理） |
| `lightbox-lifecycle.js` | 灯箱异步生命周期：AbortController + epoch 统一登记监听/定时器、按组清理与代次校验 |
| `lightbox-zoom.js` | 首开/关闭缩放 FLIP |
| `lightbox-glow.js` | 辉光层创建/就绪/淡入/剪枝 |
| `lightbox-backdrop.js` | 毛玻璃背景层 |
| `lightbox-collection.js` | 作品收集（按行计划覆盖当前页面全部照片，含未渲染卡片）与邻居预载缓存 |
| `lightbox-strip.js` | 底部缩略图条：集合构建、当前项高亮/自动跟随、点击切图、横向滚轮 |
| `lightbox-autoplay.js` | 灯箱自动播放与顶部时间进度条：播放/暂停、主图加载完成后才计时、手动操作停止、后台暂停、末张循环 |
| `lightbox-counter.js` | 灯箱当前照片编号：001 / 050 格式化、i18n 标签、随集合索引更新 |
| `lightbox-fullscreen.js` | 灯箱真全屏：Fullscreen API、沉浸布局切换、Esc/系统退出同步、全屏闲置隐藏控件、API 不可用降级 |
| `lightbox-magnify.js` | 主图缩放：放大镜/滚轮/双指捏合（1×–4×）、拖动平移与钳制、面板/缩略图条隐藏、缩放过渡 |
| `lightbox-swipe.js` | 触屏水平滑动切图 |
| `lightbox-drawer.js` | 窄屏底部抽屉：展开/滚动模型、触底箭头重判与自动滚底；全屏中手势/重算挂起、退出重算 |
| `lightbox-meta.js` | 灯箱元信息行渲染 |
| `lightbox-analysis.js` | 分析数据拉取/缓存/schema 校验/代次守卫与渲染编排（独立 entry，首次展开分析才加载；URL/预取口径见 data 模块） |
| `lightbox-charts-paint.js` | 图表绘制层（纯渲染）：曲线派生、直方图/区域尺/色卡/饱和度/色相 SVG 绘制与补间 |
| `lightbox-analysis-data.js` | 分析结果 URL 与预取（只拉 JSON、不加载渲染器；渲染器同样用其 URL 口径） |
| `lightbox-analysis-control.js` | 分析区开合与触发行；桌面收起居中补偿经共享 helper |
| `lightbox-analysis-help.js` | 图表说明气泡：问号按钮开合、fixed 定位与视口钳制、滚动/resize 跟随、Esc 与外部点击收起 |
| `lightbox-panel-comp.js` | 灯箱详情区收起居中补偿（图像分析与觀鳥圖鑑共用：冻结 is-fit、transform 下滑、翻转残余补偿） |
| `lightbox-bird.js` | 觀鳥圖鑑（独立 entry，首次遇到鸟种照片才加载）：species 查表填充分类/分布/棲息/習性/資料來源、缺资料空状态、默认收起与开合、抽屉刷新 |
| `lazy-load.js` | 图片懒加载（data-src 模式） |
| `header-scroll.js` | 滚动时 header 背景切换 |
| `mobile-nav.js` | 移动端导航：汉堡菜单切换 |
| `nav-dropdown.js` | 宽屏下拉菜单 |
| `back-to-top.js` | 返回顶部按钮 |
| `theme-toggle.js` | 明暗主题切换 |
| `carousel.js` | 首页轮播：srcset 响应式、首图 eager/邻居空闲预取、自动播放、圆点、箭头 |
| `category-reveal.js` | 首页分类卡片：滚动进入视口交错渐入（IntersectionObserver，换页拆线） |
| `about-stats.js` | 关于页统计条与换列 FLIP |
| `cards-flip.js` | 分类/系列卡片网格换列 FLIP（列数基准由网格 `data-cols-base` 声明，缺省 1） |
| `card-glow.js` | 卡片边框光标跟随高亮：委托 `pointermove` 写入 `--card-glow-x/y`（逐帧合并、触屏跳过） |
| `avif-fallback.js` | AVIF→WebP 兜底 |
| `page-transition.js` | SPA 页面切换：先 fetch、淡出淡入、节点导入替换主内容（保留 JSON/JSON-LD 数据脚本、移除可执行脚本与 on* 内联属性）、History API |
| `sw.js` | Service Worker（PWA 离线缓存；哈希资源/分析 JSON/地图几何 SWR） |
| `breakpoints.js` | JS 断点单源：`BP_DESKTOP_MIN` / `BP_LIGHTBOX_NARROW` + `readLayoutTiers()`（读 CSS 档位变量） |
| `flip.js` | FLIP 常量与四件套：`FLIP_DURATION/EASE/TRANSITION`、`clearFlipInline` / `recordFlipRects` / `resetFlipFinish` / `scheduleFlipFinish` |
| `utils.js` | 共享工具：`prefersReducedMotion`、图片就绪/URL/宽度、缓动、URL 状态、层栈、i18n 格式串、滚动锚定 |
| `analysis-meta.js` | 分析常量（管线生成，勿手改） |
| `map-names.js` | 省/国名映射（地图工具生成，勿手改） |

---

## 配置项

```toml
[params]
    description = "站点描述"
    heroTitle = "首页标题"
    heroSubtitle = "首页副标题"
    logo = ""                              # 站点 Logo（空 = 文字站名）
    copyrightText = ""                     # 自定义页脚版权（支持 HTML）
    imageCDN = "https://cdn.example.com"   # 图床前缀
    enableServiceWorker = true
    carouselCount = 6                      # 首页轮播精选图数量（1–12）
    carouselInterval = 5000                # 轮播自动播放间隔（毫秒；0 禁用，其余最小 1200）
    lightboxAutoplay = 5000                # 灯箱自动播放间隔（毫秒；0 禁用并隐藏按钮；默认关闭）
    yearMergeBefore = 2024                 # 早于此年的年份合并为一档（如 2024 → 「2024 前」，即 2023 及更早；0 = 不合并）
    jsonldPhotoLimit = 24                  # 列表页 JSON-LD 最多输出的照片条数（0 = 不限；EXIF 明细不进 JSON-LD）
    feedCount = 20                         # RSS 最近发布作品条数
    enableFooterRss = true                 # 页脚版权行末尾「·RSS」订阅入口（false 隐藏）
    categoryCover = "latest-landscape"     # 分类卡片封面：custom / latest-landscape

    # 瀑布流加载策略（首屏只揭示可见窗口，之后正常下拉逐行补载）
    [params.grid]
        rowLoadRatio = 0.5         # 下一行至少一半进入视口后才逐行加载
        lcpPreload = 4             # 首行前 N 张卡片在 HTML 中直接写 src（0 关闭）

    # 全部作品页筛选维度开关（模板缺省仅 year；站点当前开启 scope/year）
    [params.galleryFilters]
        scope = true
        year = true
        location = false
        category = false

    # 灯箱信息区块开关（缺省全开；关闭的区块不渲染、也不请求对应分析数据）
    [params.lightbox]
        meta = true            # 地點/日期简行
        exif = true            # EXIF 分行（焦距/光圈/快門/感光度）
        palette = true         # 色卡
        story = true           # 背後的故事
        tonal = true           # 影調
        saturation = true      # 飽和度
        hue = true             # 色相

    # 图片尺寸（OSS 按需生成，保留 ?v= 内容哈希）
    [params.imageSizes]
        gallery = 800                         # 瀑布流缩略图
        category = 1000                       # 分类卡片封面
        lightbox = 1920                       # 灯箱大图
        carousel = 1920                       # 轮播回退宽度（无 srcset 环境）
        carouselWidths = [640, 960, 1280, 1920] # 轮播 srcset 候选
        carouselQuality = 85                  # 轮播画质（与社交预览 ogQuality 解耦）
        strip = 240                           # 灯箱底部缩略图条小图宽度（lazy 加载）
        lightboxNarrow = 1280                 # 窄屏（≤1000px）灯箱主图宽度
        ogWidth = 1200                        # Open Graph 宽度
        ogHeight = 630                        # Open Graph 高度
        quality = 80                          # 默认质量
        lightboxQuality = 90                  # 灯箱质量
        ogQuality = 85                        # 社交媒体封面质量
        placeholder = 64                      # LQIP 宽度（px，按原比例）
        placeholderQuality = 30
        placeholderBlur = 3                   # 模糊半径/标准差

[params.author]
    name = "作者名"
    avatar = "/icons/favicon.svg"
    bio = "个人简介"

[params.typography]
    fontLinks = [...]       # 字体外链
    headingFont = "..."
    bodyFont = "..."
    footerFont = "..."
    metaFont = "..."
    # 基础字号：唯一开放配置的字号项；注入 --base-font-size，由 _base.scss 的 html font-size 消费
    # 其余档位按固定倍率定义在 _base.scss 的 --size-*（H1 2.5 / H2 2 / H3 1.5 / lead 1.25 /
    # body 1 / small 0.875 / meta 0.75，footer 与 small 同值），随基础字号等比缩放，不开放配置
    baseFontSize = "16px"
```

