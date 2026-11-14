# PhotoFolio — 摄影作品站工程约定与完整规格

> 工程约定与博客统一维护；站点规格自原 .claude/spec.md 并入（2026-10-17）

## 工程约定

### 提交纪律

- 任何代码修改完成后都不自动 commit，停留工作区供用户检查；用户明确说「提交」后才提交
- `git add` 逐路径指定，禁止 `git add -A`；默认**不暂存、不提交 CHANGELOG.md**
- 用户说「提交 CHANGELOG」或「发布新版本」= 发布当前版本：把 `— Unreleased` 改为当天日期、按 SemVer 选档、以「发布 X.Y.Z：…」格式提交，自动完成不追问；之后新改动开下一版本

### Commit Message 格式

- 首行 = type + 冒号 + 空格 + 简洁中文主题，无引号、无句号
- type 集合：`feat:` 新功能 / `fix:` 修复 / `refactor:` 重构 / `docs:` 文档 / `style:` 样式 / `trim:` 删除 / `chore:` 杂项（如数据文件更新）
- 正文空一行后编号中文条目（1、2、3…），每条一句话说清一个改动点；改动很小可不写正文
- 照片数据更新按 `chore: 数据更新` 格式

### CHANGELOG 约定

- 每次代码变更完成后立即自动更新（追加到当前 Unreleased 版本），无需等用户指示；版本号与发布仍由用户决定
- **段落结构**：每个版本 `## [X.Y.Z] — YYYY-MM-DD`；其下按标准序排列 `### Added` / `### Changed` / `### Deprecated` / `### Removed` / `### Fixed` / `### Security`，每类至多一段，无内容的类别不写；版本之间与段之间不设 `---` 分隔线
- **条目格式**：`- **标题**：正文`——粗体标题一句话概括改动点，冒号后正文展开细节；一句话能说清的条目可只有标题；多要点用缩进子条目（`  - …`）；标题不重复「新增/修复」等段名已表达的语义（历史旧条目按原文标题化）
- 已发布版本锁定：CHANGELOG 随代码 commit 即视为发布，后续改动记入下一新版本；已发布版本仅允许修正条目归类与措辞（不改功能描述）
- SemVer：新功能 → minor（X.Y.0）；修复/内部调整 → patch（X.Y.Z）；发布时按本次改动内容选档，版本号严格递增
- 记录口径：只记主题自身修改，内容数据（照片、分类改名等）不进 CHANGELOG；同一版本内「出现又修复」视为从未发生，不记；措辞不写用户具体内容（用通用形式指代）；CHANGELOG 自身的整理维护（结构归并、补标题等）也不记入
- 注释/commit/CHANGELOG 不得出现外部站点信息，对齐第三方实现用「参考站/参考实现」等泛称；第三方库/图标集名称与自家项目代号（MimoRee）可保留；**本地目录路径同样不得写入文件**，用「博客/影集」等代号指代

### 修改原则

- 改代码前先输出对需求/现象/方案的理解，等用户确认后再改；只读诊断不受限，小改动（拼写、笔误）不适用
- 值等价优先：重构/整理类修改不得改变渲染结果，完成后必须构建并对比验证，差异逐项解释
- 改原规则而非追加覆盖；配置驱动（设计常量收编 hugo.toml）；一功能一文件；删除功能要删干净；不使用冗余抽象

### 代码风格

- 模板中任何展示给用户的文本（含 aria-label、JS 动态构建的）都必须经 `i18n` 转换，严禁硬编码；含可变部分的展示文本用 i18n 格式串（`photo_hover_meta_*`、`date_format_full` 同法），严禁模板拼接 mm/f/· 等字面量
- front matter 统一 TOML 格式（`+++` 包裹，2026-10-18 起 content 全量转换）；archetype 放主题内（站点根目录不设 archetypes，避免遮蔽主题模板）
- 注释用「为什么 + 实测日期」的因果式写法；模板内注释一律 `{{/* */}}`，HTML 注释会输出进管线
- 颜色规范：严禁硬编码颜色值（`#hex`、`rgb(数字)`），一律经 `var(--color-*)` / `var(--dark-*)` 引用；新增颜色先在 `:root` 经 `defineColorHSL` 定义为 HSL 四元组（主值 + -h/-s/-l 分量），再引用
- SCSS：长度以 em 为单位（**rem 仅两类正当例外、须附因果注释**：视口锚定的固定偏移如轮播指示器；跨字号恒等的容器级间距如灯箱 EXIF 双列网格——无注释的 rem 一律转 em 或补注释，注意 em 转换可能改变渲染值、须核对值等价）；`transition` 不写 `all` 明确列出属性；`animation` 与 `transition` 互斥；入场动画仅 `opacity`；须支持 `prefers-reduced-motion` 降级
- JS 断点单源：断点常量收敛 `breakpoints.js`（`BP_DESKTOP_MIN`=769、`BP_CARD_GRID_3COL_MIN`=1001、`BP_LIGHTBOX_NARROW`=1000），窄屏互补侧经 `BP_DESKTOP_MIN−1` 推导；CSS 侧对应值注释互指；换列 FLIP 滞回 `FLIP_HYSTERESIS`=20 与 FLIP 常量/四件套收敛 `flip.js`（about-stats 使用）；**cards-flip 不持像素阈值**，改读 `_base.scss` 的 `--layout-tier`/`--layout-tier-exit`（与 masonry 同一档位源，并监听 `orientationchange` 复核，规避 iPad 视口陈旧）；瀑布流档位阈值唯一源在 `_base.scss`（masonry 只读，不持数组）
- 不写旧浏览器降级路径（目标受众使用现代浏览器）
- 模板 dict 一律字符串键（整数键会转字符串）；`{{ with .X | default Y }}` 把 0/false/空 视为无值；partialCached 的 dict 输入必须传显式 variant（依赖默认缓存键会跨调用串内容）；页面无关 partial（site-style/site-fonts/site-meta/img-url-cached/photo-hash/photo-sorted/location-registry）一律 partialCached

### 构建与验证

- Hugo ≥ 0.139（标准版；`silenceDeprecations` 自 0.139 起支持）+ Dart Sass 1.107.0 **独立版**（不要用 npm 版：纯 JS 构建不支持 Hugo dartsass 的 embedded 协议，会报 EOF）；CI（.github/workflows/build.yml）由 peaceiris/actions-hugo@v3 pin Hugo 0.169.0 标准版（无 sha256 校验——动作源即 pin 对象），另下载官方 Dart Sass standalone 压缩包并加入 PATH（2026-10-30）
- 每次改动后至少跑一次 `hugo --cleanDestinationDir` 确认零警告零错误
- **样式标尺自检**：`python tools/style-lint/check_style.py` 扫描 SCSS 的间距/字号字面量（例外须带 `style-lint-ignore` 注释）；CI 在构建前运行该检查，Hugo 构建带 `--panicOnWarning`（警告即失败）
- 验证构建用 `-d` 独立目录（如 `.verify-build`），不写入 public/——public/ 不会自动清理、历史残留会混淆对比
- 编译产物抽查：JS 改动后查 bundle*.js（变量名被压缩，按语义模式匹配）；SCSS 改动后查 style*.css；怀疑回归用 `git worktree add` 构建旧版逐规则对比
- i18n 目录残留 `*.tmp` 文件会导致构建失败，排查前先清理 tmp

---
# PhotoFolio — 摄影作品站完整规格

> 最后同步：0.19.0（2026-10-18）

## 技术栈

- **Hugo** ≥ 0.139.0（标准版；SCSS 由外部 Dart Sass 1.107.0 独立版编译，JS 由内置 esbuild 打包）
- **自定义主题** `themes/photofolio`
- **数据格式** TOML（`data/photo.toml`、`data/locations.toml`、`data/birds.toml`）
- **部署** GitHub Pages + 阿里云 OSS CDN
- **JS** ES6 模块，Hugo `js.Build`（esbuild）打包
- **CSS** SCSS，Hugo `css.Sass` 经外部 Dart Sass 1.107.0 编译（`transpiler: dartsass`；模块用 `@use`，base 共享模块 `as *`；`unquote` 改 `string.unquote`，无弃用警告）

---

## 照片数据结构

每张照片在 `data/photo.toml` 中为一条 `[[photo]]` 记录：

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
address = "云南省丽江市玉龙雪山"     # 详细地址（选填，geocode-photos.py 地理编码输入；相机无 GPS）
lat = "27.1059"                    # 纬度（选填，由 address 地理编码生成；足迹地图点迹用）
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

### 足迹地图与地点页（`data/locations.toml`）

```toml
[[location]]
name = "雲南"     # 必须与 photo.toml 的 location 字段逐字一致
slug = "yunnan"  # 地点页 URL：/footprint/yunnan/（必填、唯一；缺省不自动生成，适配器会 errorf）
lat = 26.86      # 保留备用
lng = 100.23
```

- `name`/`slug` 生成地点页；照片 `location` 未登记进本表时内容适配器构建报错（避免地图/地点链接指向未生成页面）
- `lat/lng` 保留备用：当前地图点迹使用照片 `photo.lat/lng`，地点页不依赖坐标；注册表不再输出坐标
- 地图陆地与省界几何为一次性生成数据（`themes/photofolio/static/maps/land-10m.json` 世界陆地 10m、`provinces.json` 中国省级边界线含港澳台——省界源要素需剔除无 adcode 的十段线/插图要素；管线 `python tools/map-data/generate-maps.py`，下载缓存 tools/map-data/vendor 不入库、临时文件原子替换写入、缓存损坏自动重下载）
- 省/国名映射唯一源 `tools/map-data/map_names.py`（PROVINCE_NAMES/COUNTRY_NAMES）；`generate-maps.py` 直接 import 并生成 `themes/photofolio/assets/js/map-names.js`（渲染端 import、勿手改；`--names-only` 只刷新映射），新增省/国拍摄地只改 Python 一处

### 排序规则
- 按 `time` 降序排列（全站统一，含系列详情页；带时刻时按完整拍摄时刻比较）
- 时刻相同（同秒，或双方仅有日期）按 `photo.toml` 中的数组索引（添加顺序）作为次级排序键
- 排序管线唯一实现：`layouts/partials/photo-sorted.html`（固定 time 降序，不接受 `order` 参数；调用方用 `partialCached` 显式 variant `"desc"`）

### 观鸟图鉴（`data/birds.toml`）

```toml
# 观鸟系列名：属于该系列的照片即使缺 species 也显示图鉴开关
bird_series = "觀鳥"

[[bird]]
id = "fairy-pitta"             # 与 photo.toml 的 species 字段对应（唯一）
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
- `utils/bird-registry.html` 构建期校验：id 唯一、必需字段完整（含 `conservation_level`）、保育等级取值合法、每条至少一个 `[[bird.source]]`、photo.toml 的 species 必须能反查到条目、`bird_series` 必须匹配 photo.toml 中至少一条 series、每个等级必须有 `bird_conservation_*` i18n 文案；灯箱壳内嵌 `data/birds.toml` JSON 供 `lightbox-bird.js` 按 id 取用，保育等级文案由注册表按唯一等级清单生成（`data-labels` JSON，shell/JS 不再逐级硬编码），照片卡片与灯箱壳共用注册表返回值

## 照片预处理管线（`tools/photo-pipeline/`）

- **入口**：管线目录内 `python run.py [--force]`——批量处理原图 → 输出图，并**直写 `data/photo.toml`**（单一数据源）；依赖 Pillow、oss2（requirements.txt）
- **路径配置**：`pipeline_config.json`（gitignore，example 为通用占位路径）指定照片输入/输出目录（在仓库外、必填，未配置则退出提示）；`toml_path` 缺省直写 data/photo.toml
- **处理流程**：长边缩放 1920px → 水印「Guanqr Photography @ 年份」（独立透明图层 + alpha_composite 控制透明度；颜色按水印文字实际渲染 bbox 的平均亮度自动黑白——2026-10-29 起，原底部 100px 全宽平均会被左右暗部拉低、水印中间亮时误选白字；年份取 EXIF DateTimeOriginal 回退 DateTime）→ JPEG 质量 95 起逐级降 5 压缩至 ≤400KB（最低降至 10；仍超限打印警告不中断——BytesIO 内存完成，不落临时文件）；**图像分析为独立步骤**（src/analysis.py）：对全分辨率原图（加水印前口径）单趟逐像素预计算统计，结果写 `static/analysis/{文件名}.json`（v5 算法版本号、约 8KB/张；RGB 直方图/色相 HSV 通道走 Pillow C 实现，色卡 k-means 与色相加权为逐像素融合单趟——全分辨率只付一次，见下增量策略）
- **分析常量单源**：`analysis.py` 的 `ANALYSIS_VERSION`、影调区界/剪裁、區域/色相分段数为唯一源头；管线启动时生成 `themes/photofolio/assets/js/analysis-meta.js`（文件头标注生成勿手改），灯箱 `lightbox-analysis.js` import，不得再写 JS 本地副本
- **EXIF 焦距口径**：`get_exif_info` 优先读取 `FocalLengthIn35mmFilm`（41989，35mm 等效焦距），缺失、为 0 或非法时回退 `FocalLength`（37386）；手机物理焦距（如 4mm）不得直接写入站点（2026-11-04）
- **photo.toml 更新**：新条目 EXIF 字段（focus/iso/aperture/shutter/time/camera/lens）自动填（`time` 保留完整拍摄时刻 `YYYY-MM-DD HH:MM:SS`，同日作品按时刻排序；见 `exif_utils._normalize_time`）、width/height 恒取处理后的输出图尺寸（处理完成后统一刷新，避免同名换图改比例时预读旧输出值）、hash 恒取输出图内容 MD5 前 8 位（图片 URL 的 `?v=` 缓存版本号）、source_hash 恒取输入图内容 MD5 全 32 位（换图检测，站点不消费）、published 在新建条目时写入一次本地带时区时间戳（RSS 排序用；重跑/`--force`/同名换图不变，旧条目缺失回退拍摄时间）、手动字段留空；**同名换图（source_hash 变化）成功重出后同步更新上述 EXIF/time/camera/lens，手动字段保留**；新条目处理失败（无输出/抛错）不落条目；`write_toml` 按 time 升序**全量重写**——FIELDS 白名单**必须包含站点扩展字段 address/lat/lng/hash/source_hash**（漏掉会抹掉地理编码坐标与内容哈希——featured 曾被白名单漏掉而丢过，同类坑）；description/series/species/is_cover/featured 有值才写（species 供观鸟图鉴引用，登记在 CONDITIONAL_FIELDS）；字符串值写前转义反斜杠/双引号（`_tostr`）、读侧逆还原（`_fromstr`）——全量重写必须无损（改此文件须跑 tomllib 往返验证）；解析器严格匹配双引号字符串/布尔/数字整行，未登记字段或重复 src 拒绝重写（fail-fast，避免静默丢字段）
- **分析取整**：影调三段占比取整余数并入最大档（与饱和度同口径），v5 起合计恒为 100%；已有 v5 JSON 已修正
- **增量策略**：按输入图 `source_hash` 与 photo.toml 比较跳过未变化照片（同名换图保留旧 mtime 也能发现）；无 source_hash 的旧数据按变化处理，可用 `backfill_source_hash.py` 一次性回填；`run.py --force` 忽略增量重出全部图（仅重出图，分析仍按源图变化/缺失/版本惰性判定）；OSS 同步只传本次实际处理的文件名（force 覆盖云端），其余仅补云端缺失——避免本地/云端时间基准不一致；OSS 已有文件清单**分页拉取**（is_truncated/next_marker，单页默认 100 条）；**图像分析为独立惰性步骤**：结果缺失或算法版本（JSON v 字段）过期才重算，源图变化成功重处理时强制重算、处理失败不重算；`--force` 仅重出图且分析未过期时不重算；首次接入自动全量回填（一次性成本），日常运行只付新增照片
- **写盘与上传顺序**：输出 JPEG 与 photo.toml 经 `compat.py` 临时文件 + `os.replace` 原子替换（TOML 固定 LF）；OSS 上传成功后才写 photo.toml，失败保留旧数据；新增条目打印手填字段提醒（2026-10-29）
- **OSS 凭证**：`oss_config.json`（gitignore，example 为模板）+ 环境变量回退（OSS_ACCESS_KEY_ID/SECRET/ENDPOINT/BUCKET_NAME）
- **上传缓存头**：新上传对象写入 `Cache-Control: public, max-age=31536000, immutable`——照片 URL 带内容哈希、对象内容不可变，可放心长缓存；同名换图产生新 URL，不依赖短 TTL 兜底（2026-10-26）
- **字体**：`fonts/` 不入库，`tools/photo-pipeline/scripts/download_font.py` 从 Google Fonts 下载 NotoSans-Bold.ttf；加载失败 ImageFont.load_default 兜底
- **兼容性**：Windows 控制台 stdout 重包 UTF-8、原子写、JS 取整统一在 `src/compat.py`（download_font 与 `tools/backfill/backfill-dimensions.py` 同样接入）；Pillow textbbox/textsize 与 getdata/get_flattened_data 新旧 API 回退；EXIF 字符串控制字符（NUL 等）在读写两侧清洗，否则 TOML 解析失败；backfill-dimensions 对中文文件名做 URL 编码
- **回填脚本**：`backfill_camera_lens.py <original_photos目录> <toml路径>`——只读 EXIF 写 camera/lens，无图片处理/上传副作用；`backfill_published.py <toml路径>`——按 `src` 首次出现在 photo.toml 的 git 提交时间回填 `published`（已有值不覆盖、无法溯源留空），只读 git 历史；**读不到 EXIF 的字段留空（覆盖既有值）——用户明确裁定的口径（2026-10-18），不得改为「保留既有值」**；`tools/backfill/backfill-dimensions.py` 经 OSS image/info 回填宽高（ROOT 三级 parent 指向仓库根）；`backfill_source_hash.py <original_photos目录> <toml路径>` 只读输入图回填 source_hash（无处理/上传/分析副作用），用于接入换图检测前跳过首轮全量重处理；`backfill_time.py <original_photos目录> <toml路径>` 从原图 EXIF 回填完整拍摄时刻，读不到时刻或原图缺失时**保持原值**（time 是站点排序/展示必需字段，写空会让构建期 `time.Format` 报错，不套用上面的留空口径）
- **OSS 孤儿核对（只读）**：`list_orphan_photos.py [photo.toml]` 分页拉取 OSS `images/photos/` 对象，与 `photo.toml` 的 `src` basename 比对，列出未被引用的对象（改名/删除后的残留）；不删除，删除仍走 OSS 控制台（2026-11-08）

---

## 页面结构

### 1. 首页 `/`
- **全屏轮播**（`.carousel`，高度 `calc(100vh - 4.5em)`、宽度充满页面）：按时间降序取最新 `carouselCount` 张 `featured=true` 照片（模板默认 12，站点当前 6）；`object-fit: cover` 居中适当裁剪、无白边；自动播放 5s/张（`params.carouselInterval`，默认 5000ms）+ 左右箭头 + 圆点；**鼠标悬停不再暂停**（仅键盘聚焦圆点暂停）；轮播仅作展示，点击照片不打开灯箱（2026-11-01 用户裁定）
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
- 每组横向滚动（窄屏）+ 右侧渐隐遮罩 `can-scroll-r`；切换后选中项自动滚入可视区
- **任何筛选状态都按整页容器渐进加载**：`restartMasonryGrid` 重启网格（集合外隐藏、集合内重建整组行计划与页面高度、先揭示当前视口内的行，之后滚动逐行补载）；无匹配显示空状态文案
- URL 同步（`pushState`；加载恢复/过期参数清理走 `replaceState`）：`?s=` 範圍、`?y=` 年份（合并档值形如 `before-2024`）、`?l=` 地点英文 slug（= 足迹页文件名，如 guangdong/japan）、`?c=` 类型；默认值不写入；直接打开带参链接 / 浏览器后退自动恢复筛选
- 维度开关由 `hugo.toml` 的 `[params.galleryFilters]` 控制（scope/year/location/category；模板缺省仅 year，站点当前开启 scope/year）
- 照片卡片带 `data-scope/year/location/category` 属性驱动匹配（`data-scope` 为 `featured`/`landscape`/`portrait` token 列表，精選与构图方向可并存）；地点按钮 data-value 存 slug、匹配用按钮中文文本

### 3. 组照合集 `/series/` 及详情页 `/series/{name}/`
- 列表页展示所有组照封面
- 详情页直接按 `photo.toml` 的 `series` 字段取图（含内页），按 `time` 降序展示（与其他瀑布流一致）；无需 front matter `photos` 列表，不支持自定义系列内顺序
- 构建期校验：每个系列 `is_cover` 恰好 1 张；`series-url.html` 找不到同名内容页时 errorf（不再回退 urlize 死链）

### 4. 足迹 `/footprint/` 及地区页 `/footprint/{slug}/`
- **足迹世界地图**：自绘 SVG 等距圆柱投影（零外部库/瓦片），视图 = 照片点迹 ∪ **有照片省份的完整包围盒**（省份完整可见；海外国家不并入包围盒）；**省份/国家为独立填充区块**（悬停提亮、点击唯一选中并更新预览面板——面板样式与旧光点版一致；无照片地区中性填充、pointer-events none）；全部照片坐标形成**点迹**（光环+核心两层、纯展示）；鼠标/触控笔悬停与键盘聚焦显示弹层（地名/张数/年份跨度），**触屏不显示弹层、点按直接跳转地点详情页**（footprint-tooltip.js 按 pointerType 判定）；区块须声明 `cursor: pointer`（iOS 只向可交互或 cursor:pointer 元素派发 click）；陆地/省界/国家几何静态数据 + 同源 fetch 记忆化（失败降级为网格+点迹）；IntersectionObserver 懒加载（rootMargin 600px）；`prefers-reduced-motion` 完整降级；带边框圆角框架（内容裁剪到 viewBox，区块宽度与导航栏一致）
- 照片坐标字段：photo.toml 可选 address/lat/lng——address 经 `tools/geocode/geocode-photos.py` 高德地理编码生成 lat/lng（key 走环境变量 AMAP_KEY 或 tools/geocode/config.json）；**lat/lng 用于足迹地图点迹**（详情页小地图已取消）；geocode 兜底口径：仅「无结果/网络异常」落 Nominatim——**key/配额类错误（infocode 1000 前缀）不落兜底、中止循环**（境外服务解析境内中文地址不可靠、会污染坐标）
- 地点注册表唯一实现：`layouts/partials/utils/location-registry.html`（Title → slug/URL，画廊筛选与足迹页共用；坐标不再输出，地图点迹用照片 lat/lng）
- 桌面端地图左栏 + 右侧地点预览面板（点击地块/点迹更新面板，整块链接进地点详情页）
- 地区详情页使用瀑布流展示

---

## 瀑布流布局

### 架构
- **两端对齐行布局（自然行高，零裁切）**：行高 = (行宽 − 间距 − 边框) / 宽高比之和，由本行照片内容自然决定、恰好铺满容器；全模块唯一实现为 `rowHeight()` 助手
- 布局容器 `.masonry-grid`：初始化后加 `.is-virtual`（`position: relative; display: block`，高度由 JS 设为行计划总高），**每个引擎行一个显式绝对定位 `.masonry-row` 容器**（`display: flex`，水平 gap 0.5em，`top` 取计划位置）——引擎行 = 视觉行；`.masonry-item` 行内左→右 = 新→旧
- 行高参考值：以「每行 N 张 3:2 宽幅照片（长边 3、宽边 2）」反推；**档位由 CSS 变量驱动**（`--layout-tier` 基础档位，`--layout-tier-exit` 为已越过的最高出口档位；升档需 exitTier > 当前档位、降档按基础档位立即生效）：**≤500px 每行 1–2 张**（3:2 横构图独占一行；正方形只与竖构图并排，与横构图/正方形分行；竖构图绝不落单、与相邻照片同行；尾行竖构图并入前一张横构图）、501–768px 每行 2 张基准、769–1000px 每行 3 张基准、>1000px 每行 4 张基准
- 照片间距 `gap: 0.5em`，全断点统一（JS 读取计算后的 columnGap/rowGap 并缓存——**勿硬编码回退值**）
- 分行规则：逐张累加宽高比，直到再加一张会低于参考值 H；边界处比较「停在此处 / 纳入下一张」两种方案，取行高最接近 H 者（规划整组行计划时启用；**不交换照片顺序**）——行高天然落在 H ±10% 内，肉眼看基本一致
- **整组行计划一次算好**：除真正的最后一行外，每行都是完整行；任意窗口的行可直接按计划建立（不依赖前缀揭示），跨档位 resize 重新规划整组行
- **真正的最后一行**（全部照片加载完毕）默认不强行对齐：左对齐、右侧留白。末行 ≥2 张时以**常规行的最小实际行高**为基准：铺满后行高超过该最小行高的 1.1 倍则放弃放大、保持最小行高左对齐；未超过时才按最小行高检查右侧余量，连当前集合最窄的一张照片（宽高比 × 最小行高 + 边框 + 一个间距）都放不下则按自然高度放大铺满（末张吸收取整余量）；单张末行仍按参考行高 H 左对齐留白（2026-11-01 用户裁定，取代 2026-10-31 纯参考行高余量判定）
- **绝不拉伸、绝不粗暴裁切**：盒子严格按照片自身比例设置，`object-fit: cover` 仅兜底取整误差；末张吸收取整余量并按实际渲染宽度扣减，保证完整行恰好铺满、不换行、不留白（末行见上条）
- **防换行**：容器宽度 = `floor(实际宽) − 2px` 安全余量；非末张宽度四舍五入（误差正负分布、末张吸收量最小）、末张向下取整吸收余量（行宽总和精确 ≤ 容器宽）；网格挂 `ResizeObserver`，滚动条出现/消失等尺寸变化时自动重排
- 中屏/宽屏（>768px）每行至少 2 张；独占一行的照片按自然行高显示、不裁切
- 网格图片 `max-width: none`（宽度由 JS 精确给定，避免 flex 循环尺寸依赖）；img 引用缓存于 item 上（resize 逐帧避免子树查询）

### 加载策略（整页容器 + 渐进加载）
- **整组行计划 + 完整页面高度**：初始化按 `width/height` 与当前宽度一次算完整组行计划（`_planItems` / `_plan`）与每行 top（`_rowLayout`），网格高度设为总高——滚动条长度从一开始就覆盖全部照片，可直接拖到底
- **初始化前两行占位**：baseof/SPA 换页给网格加 `is-masonry-pending`，按当前档位以 `aspect-ratio` 预留两行 3:2 照片高度（4/3/2/1 列 → `3/1`、`9/4`、`3/2`、`3/4`）；masonry-ready 或 4s 兜底后移除。用于避免空网格高度 0 把页尾 `page-others` 标题顶进视口；不隐藏 page-others，保持其原有懒加载/淡入；无 JS 时无该标记
- **首屏只揭示可见窗口**：`initialRowCount` 累计行高到当前可见高度即停，不额外预载；网格在首屏下方时初始为 0，滚近后由补载逻辑处理。首屏行进入串行渲染队列，一次只建立一行（图片请求与入场都逐行）；行容器绝对定位（`.masonry-grid.is-virtual`，`top` 取计划位置）
- **刷新恢复滚动位置**：网格顶部已在视口上方时，首屏只揭示当前视口内的行并逐行建立（不从顶部前缀开始，避免恢复位置走 instant 分支而无动画）
- **正常下拉逐行补载**：下一行至少 `rowLoadRatio`（站点当前 0.5，即一半高度）进入视口后才从已渲染前缀逐行建立；未渲染卡片留在隐藏池（`is-hidden`、无 `src`、不请求图片）
- **首行 LCP 预载**：`[params.grid].lcpPreload`（默认 4）把前 N 张卡片的 `img` 在 HTML 里直接写 `src`（仍保留 `data-src` 供灯箱/懒载），首张 `fetchpriority=high`；preload scanner 不再等 defer bundle 执行才看到图片，`0` 关闭
- **跳到未渲染区域只补视口内的行**：拖滚动条越过已渲染内容时只把视口内的行加入队列；队列一次只建立一行（图片请求与入场都逐行），不把中间空档全部加载
- **已渲染行保留**：滚过的行不回收（滚回不闪）；行内逐张 60ms 淡入，图片未到时由 LQIP 模糊底图占位
- **筛选重启 / 深链稳定**：`restartMasonryGrid` 重建整组行计划与页面高度（120ms 淡出衔接），按当前视口揭示后交回逐行补载；`grid._restartPromise` 在重启完成后释放，`?p=` 深链等待稳定后直接渲染目标所在行（instant）、滚入视口打开，目标不在筛选集合时静默放弃；SPA 换页清理未执行的筛选重启定时器
- **模糊占位（LQIP）**：每张卡片经 `--photo-blur` 注入 OSS 端生成的低清占位图（`placeholder` 宽 64px WebP、服务端烘焙高斯模糊、体积很小，带照片内容哈希随换图更新；URL 构造唯一实现 `utils/photo-blur-url.html`，photo-card 使用），由 `.photo-wrapper::before` 独立伪元素承载并 `filter: grayscale(1)` 转黑白，铺在 `.photo-wrapper` 底层；主图未就绪时透明并带全灰/压暗，加载完成（`is-loaded`）后播放一次 `@keyframes slowFadeIn` 1.4s——0→15% 快速浮现并带 blur(1.25em→0.625em) 与 brightness(2) 过曝辉光，15%→100% 缓慢去模糊、降回正常亮度并完成灰度→全彩（缓存命中的图片也能可靠播放，不受 `display:none` 揭示同帧加类影响；不做缩放）；占位层同步 1.4s 退场（`:has` 感知 is-loaded），形成「黑白低清 → 过曝辉光 → 彩色清晰」的慢速入场，不做双图长时间叠影。占位图仅在卡片进入渲染时请求（`display:none` 的隐藏作品不预取），占位图层的 `grayscale` 不涉及主图、也不叠模糊滤镜（模糊在服务端完成，避免并发栅格化尖峰）；尺寸/质量/模糊半径见 `[params.imageSizes]` 的 `placeholder` / `placeholderQuality` / `placeholderBlur`；无 CDN 或 `src` 为绝对 URL 时不生成占位（`img-url` 对绝对 URL 原样返回，占位会退化成全尺寸原图）
- **SPA 换页监听器清理**：masonry 的 ResizeObserver、窗口滚动监听、筛选的窗口 resize 监听必须模块级单例（只挂一次）或初始化时断开旧的；窗口监听读取当前文档中的网格，换页后自动作用于新网格

### resize
- **同档位冻结缩放**：同档位内行成员冻结，只按新宽度重算行高、行容器 top 与图片尺寸，布局实时跟随；跨档位（带滞回）重新规划整组行并做 **FLIP**（对视口内已渲染卡片记录旧矩形 → 重排 → Invert → Play，0.35s 标准缓出）——同时记录视口内最上方已渲染照片的视口偏移，重排后滚动补偿回原位，内容不跳动；新进入视口的卡片按旧行计划矩形参与 FLIP（从原布局位置移入，而非淡入）；重建前可见、重排后落入视口外的卡片临时渲染其新行参与 FLIP，动画结束后收回隐藏池；`prefers-reduced-motion` 跳过全部动画
- **rAF 逐帧重排（无 debounce）**：每帧最多执行一次；宽度/档位未变但视口高度变化（全屏/F11/拖高窗口）时仍按新视口补行；跨档位重建后按视口补行（instant），再交回逐行补载

### 照片卡片
- `.photo-card`：圆角（0.25em）、边框；**悬停时整卡轻微上移（translateY(-0.15em)，弹簧曲线，比分类卡 -0.35em 幅度小），图片不放大**；照片卡与分类/系列卡悬停时边框有**光标跟随高亮**——保留整圈强调色，鼠标附近一段叠全强调色光晕（`card-glow.js` 逐帧写入 `--card-glow-x/y`；`components/_card-glow.scss` 把边框本身画成高亮：透明边框 + 三层背景，实色卡底裁 padding-box、径向光晕与整圈强调色裁 border-box，与边框线完全重合；光晕半径取卡片短边（`--card-glow-r`），光标到最近边框的距离与半径同比例，大卡与小卡亮度一致；`card-hover` mixin 只做位移/阴影、不再改 `border-color`，避免高特异性规则盖掉透明边框导致亮度不一；仅可悬停设备）
- `.photo-wrapper`：统一 div 容器，`position: relative`，`overflow: hidden`
- **卡片悬停显示标题 + 焦距/光圈两行小字**（触屏无悬停）；标题与完整元信息（地点/分类/日期/EXIF）经 `.photo-card` 的 `data-title` / `data-place` / `data-category` / `data-date` / `data-focus` / `data-aperture` / `data-shutter` / `data-iso` / `data-camera` / `data-lens` 传给灯箱（不再使用 `data-exif` 聚合属性）
- 所有照片（含组照封面与内页）均为普通卡片，点击触发 Lightbox；点击委托守卫排除 `<a>` 内元素（卡片内部不再有系列链接）

---

## 移动端导航

- 汉堡按钮：`visibility + opacity` 替代 `display:none`（0.3s 淡入淡出）
- 菜单动画：JS 点击时动态注入 `transition`，`transitionend` 后清除
- 断点跨越时不设过渡，防止闪烁
- 菜单文字左侧显示图标（`hugo.toml` 中 `[menu.main.params]` 配置 `icon`），宽屏隐藏，窄屏可见
- 图标 `0.85em`，`translateY(-0.05em)` 微调对齐文字；下划线在 `.nav-text` 上，不涉及图标

---

## 整页容器与渐进加载

- 网格高度 = 整组行计划总高，滚动条一开始就覆盖全部照片；行容器绝对定位、按计划 top 摆放
- 首屏只揭示可见窗口内的行（不额外预载）
- 滚动/resize 监听 + rAF 节流：正常下拉时下一行至少 `rowLoadRatio`（站点当前 0.5）进入视口才从已渲染前缀逐行补载；拖到未渲染区域只补视口内的行；未渲染行留在隐藏池，不请求图片
- 所有补行都进入串行渲染队列：一次只建立一行（移入卡片、赋 src、排淡入），下一行在上一行最后一张开始淡入时建立（无额外行间停顿，与改造前每张 60ms 连续接续的节奏一致）；刷新恢复滚动位置时只揭示当前视口内的行并逐行建立
- 已渲染行保留（不回收）；滚回不闪
- `baseof.html` 同步 inline script：解析阶段即标记全部作品 `is-hidden`，阻止浏览器在 JS 接管前按原始尺寸撑高页面；`initMasonry` 按可见窗口揭示；bundle 失败时 4s 看门狗拆掉行容器、放出全部卡片
- 可重入：滚动监听模块级单例（只挂一次）；换页后自动读取当前文档中的新网格

---

## Lightbox

- **懒加载**：灯箱骨架不随页面 HTML 输出，由独立 `/lightbox-shell/` 页面承载（`content/lightbox-shell.md`，`noindex`、不进 sitemap）；首次点击 `.photo-wrapper` 或带 `?p=` 深链时 `lightbox-boot.js` fetch 骨架注入并动态加载灯箱入口（`entries/lightbox.js`），随后重放点击；骨架/入口加载失败可重试，SPA 换页保留已注入骨架。灯箱样式仍随全站 CSS 输出
- 全屏遮罩，点击 `.photo-wrapper` 触发；**背景为当前照片铺满屏幕的模糊毛玻璃**（`.lightbox-backdrop`：cover + `blur(40px) brightness(0.55)` 合成滤镜压暗 + scale 1.1，切换照片时随主图同步更换）；打开时滚动锁挂根元素（`documentElement` overflow hidden——只锁 body 不生效：`html { overflow-x: clip }` 阻断向视口传播），经典滚动条随灯箱隐藏、灯箱覆盖满视口，关闭恢复并保持滚动位置
- 全局事件委托 `document.addEventListener('click', ...)`；**箭头覆盖当前页面全部照片**——集合按网格 `_planItems`（当前筛选结果、时间顺序）生成，含尚未渲染、留在隐藏池的卡片（灯箱直接读卡片的 `data-src` / `data-full-src` 与元信息，翻页不触碰网格、不触发任何行渲染）；筛选时只在当前筛选集合内循环；关闭后页面停留在打开前的滚动与已渲染状态
- 图片切换：图片 + 标题 + 描述同步淡出 → 换内容 → 同步淡入（`opacity 0.3s ease`）
- 关闭按钮（3em 圆形）：hover 时 SVG 弹簧旋转 90°，仅改颜色不缩放按钮本身
- 左右箭头（3em 圆形，与关闭/播放/全屏按钮同档）：默认 `opacity: 0`，仅 hover/触达时淡入浮现（0.35s），hover 方向微移
- 窄屏不缩小控件尺寸，保持与桌面一致
- 仅叉号关闭，无遮罩点击关闭
- **模态焦点与抽屉可聚焦范围**：打开时对 header/main/footer 以及 body 直属的 `.skip-link`/`#back-to-top` 设 inert；窄屏收起抽屉时除地点/日期简行与分析容器（自身管理 inert）外，详情子块设 inert，被裁掉的分析触发行不可聚焦、不改写 `scrollTop`
- **切图收尾**：swipe 接管旧图滑出后回弹恢复主图 opacity；切图后重测抽屉头部/简行；辉光层上限 2、背景层上限 3；瀑布流 FLIP 收尾用 `transitionend` + 起播后 `FLIP_DURATION + 50ms` 定时兜底，不监听 `transitioncancel`
- 底部信息区：标题（caption，字重 400）+ 描述（description）+ 完整元信息（`#lightbox-meta` **单行不换行**：地点/日期/拍摄参数三组，各带 SVG 图标、组间 0.75em 间隔；窄屏缩字号/间隔保持单行；空项隐藏；分类标签不显示），随图片切换直接更新文字，不整块淡出
- **切图详情过渡**：分类/系列胶囊按标签类型复用——分类值变化原位更新文字，只有系列标签有↔无才淡入/淡出；觀鳥圖鑑与描述/故事块按有无用内层 grid 0fr↔1fr + opacity 展开/收起，隐藏态 inert/aria-hidden；宽屏详情 is-fit 居中随这些块高度连续移动；减弱动态直切
- **当前照片编号**（`lightbox-counter.js`）：灯箱左上角 `001 / 050`（当前/总数均三位补零，总数按当前页面/筛选后的灯箱集合计算），与播放/关闭按钮同一垂直中线（按钮按自身高度 `calc(50% - 1.5em)` 居中）；随打开/切图/深链同步（`onPhotoOpen` 统一入口），关闭清空；可见文本与 aria-label 均走 i18n 格式串（模板传哨兵占位、JS 只替换数值）
- **普通视图顶栏留白**：图片区顶部与宽屏右侧信息面板顶部均留 4em（= 顶栏高度），主图与信息栏不进入顶栏覆盖区；宽屏面板底部留白与图片区一致（1em + 缩略图条高），信息栏内容底边与照片底边对齐；真全屏模式不受此限制（面板隐藏、主图 1em）
- **真全屏**（`lightbox-fullscreen.js` + `_lightbox-fullscreen.scss`）：顶栏播放按钮右侧（关闭按钮左侧）按钮经浏览器 Fullscreen API 全屏灯箱元素（隐藏浏览器 chrome）；同时隐藏底部缩略图条、信息面板与放大镜按钮（主图缩放禁用，进入时立即复位；全屏/自动播放按钮右移补位，顶栏不留空档）、`--lightbox-strip-h` 归零，主图占满内容区居中（桌面左右对称留出箭头列），顶栏编号/按钮与左右箭头保留；切图保持全屏；Esc/系统退出经 `fullscreenchange` 同步摘除，再点按钮退出；API 不可用/被拒降级为纯沉浸布局；关闭灯箱退出浏览器全屏、沉浸布局保留到关闭动画结束、下次首开前复位；全屏按钮不停止自动播放；全屏闲置 3 秒（最后一次指针/触屏/键盘操作为起点）后顶栏（编号/播放/全屏/关闭）、左右箭头与自动播放顶部进度条一起淡出、鼠标光标隐藏，只留主图；闲置期间顶栏/箭头设 inert 并移出焦点；鼠标移动/触屏点按/键盘操作立即淡入恢复并重新计时；只改透明度，不暂停、不重置自动播放计时（进度条隐藏期间动画照常推进），闲置期间首次点按只唤回控件、不打断自动播放（滑动手势切图仍停止自动播放）；关闭灯箱淡出期间指针活动不再唤醒已隐藏的顶栏/箭头（含 SPA 返回关闭）；抽屉手势与布局重算在全屏中挂起，退出时 `refreshLayout` 重算、缩略图条 `recenter`；全屏中跨到宽屏后退出，`refreshLayout` 清窄屏内联高度/溢出，恢复桌面面板
- **主图缩放**（`lightbox-magnify.js` + `_lightbox-magnify.scss`）：顶栏放大镜按钮默认 2× 居中（点击还原），点击主图本身（触屏双击）同样切换；图片区滚轮/触屏双指捏合在 1×–4× 连续缩放（滚轮锚定光标、捏合锚定双指中点；窄屏 ≤1000px 滚轮仅在详情抽屉完全收起、图片最大时启用，未收起时滚轮只驱动抽屉），放大后鼠标/单指拖动平移并钳制不露空白；缩放时信息面板、缩略图条与左右箭头淡出但保留布局（图片越过原图片区绘制、由灯箱统一裁切；辉光层同步施加缩放变换、始终环绕主图；进出不触发重排），进入/退出 0.35s transform 过渡（减弱动态直切）；缩放期间切图入口（箭头/键盘/滑动/自动播放/缩略图）禁用，Esc 先还原；全屏模式隐藏放大镜并禁用缩放（进入全屏时若在缩放则立即复位）；关闭灯箱立即复位缩放，面板隐藏态保留到淡出结束、下次首开摘除
- **主图展示源随视口重估**：窄屏（≤1000px）打开灯箱时主图用 `imageSizes.lightboxNarrow`（默认 1280）降档宽度；灯箱打开期间视口跨过窄屏断点（进入全屏、拉宽窗口、旋转屏幕）时自动升级为 `data-full-src` 全宽大图——主图显示尺寸受自然尺寸封顶，窄版在放大的全屏里不会随之铺满（辉光层却按容器铺满，形成「辉光全屏、主图仍小」错位）；只升不降（大图在窄窗口同样受容器约束、观感一致），换源在图片稳定显示后执行、解码期间保留旧像素，失败回退原窄版；首开/切图/缩放浮现的赋值与重估均按赋值时断点求值，加载期间跨断点也会在就绪后补升级
- **底部缩略图条**（`lightbox-strip.js` + `_lightbox-strip.scss`）：灯箱底部全宽横向 strip track，按当前页面集合（含未渲染行）构建——等高缩略图、宽度按各自宽高比，原生横向滚动；当前项 accent 描边 + 外环、不透明，其余降透明，随箭头/键盘/滑动/点击同步并自动滚入轨道中央；点击缩略图走同一切换管线（滑入动画、`?p=`、分析预取）；缩略图用 `[params.imageSizes].strip`（默认 240）小图、lazy 加载并保留内容哈希（条内小图不套全局 lazy 模糊渐显，直接清晰显示）；桌面端条为内容区底部的透明覆盖层（不占 flex 行高）：图片区/面板底部预留条高，图片区与辉光继续延伸到条背后，条不新增背景、直接浮在毛玻璃背景上（不改辉光层本身）；箭头定位容器始终位于页面高度中线（窄屏条在内容区之外，以负条高补回）；窄屏条位于底部抽屉下方，抽屉半屏上限扣除条高以保持图片区约半屏，条内横向滚轮/触摸与抽屉手势隔离；集合只有 1 张时隐藏条与箭头；左右箭头由 `.lightbox-arrows` 定位容器（`.lightbox-content` 内 absolute）在页面高度中线垂直居中；单元格 aria-label 走 i18n（`lightbox_strip` / `lightbox_strip_photo`）
- **窄屏抽屉箭头**：初始朝下；点击向下箭头展开抽屉并**同时**开始滚到内容底部（原生平滑滚动，滚动目标按展开后的最终可视高度计算；信息栏到上限处不停顿，长内容/分析图表展开时也不卡顿），只有内容绝对触底时箭头才翻转为朝上（此时点击收起并回顶）；已全开但未触底时点击继续滚到底部；分析区展开、切图换内容等高度变化经 ResizeObserver + 滚动监听实时重判方向，不残留旧态；**收起图像分析期间保持原方向**（内容收缩＋回顶途中不因瞬时失底而翻转），收起完成后经 refresh 统一重判；箭头标签走 i18n（`lightbox_expand` / `lightbox_bottom` / `back_to_top`）
- **详情滚动条**：桌面原生细滚动条常显、不随滚动空闲隐藏；窄屏抽屉原生滚动条隐藏（滚动由手势模型接管），右侧自定义滚动条仅抽屉全开时显示/拖动，视觉与桌面一致（透明轨道、border 色滑块、悬停 muted；标准滚动条属性仅 Firefox 生效，Chrome 走 `::-webkit-scrollbar` 的 0.375em 宽度），可点击轨道跳转/拖动滑块；拖动前取消在途平滑滚底并遵守分析收起 `inputHold`，独立处理指针事件（`stopPropagation` + 抽屉守卫）不触发抽屉拖拽，随 scrollTop 与抽屉展开更新
- **开合滚动锚定**：窄屏图像分析/观鸟图鉴开合时，展开锚定触发行顶部、收起锚定折叠容器底边（`utils.anchorWhile` 逐帧补偿详情区 scrollTop），按钮位置尽量不变；切图、隐藏块、跨断点或用户指针/键盘/滚轮输入立即取消，同一时间仅允许一个锚定；滚到详情区上/下尽头即停止、随内容整体移动；`overflow-anchor: none` 仅窄屏生效（桌面保留原生锚定），防止浏览器二次锚定
- **自动播放**（`lightbox-autoplay.js`）：顶栏播放/暂停按钮与关闭同行（play/pause 图标走 `svg.toml`、切换交叉淡入淡出 + 缩放旋转（弹簧）、标签走 i18n、`aria-pressed` 同步），默认关闭；灯箱最顶部时间进度条按间隔从左到右填充、切图重置、暂停/停止隐藏（与 SPA 加载条同款细条；轨道白色 10%、填充 accent）；主图未完全加载时不计时——加载期间进度条隐藏、计时暂停，主图全尺寸图片加载完成/失败（失败按就绪继续，避免永久停摆）后才开始当前图片的完整间隔（切换管线 `onPhotoReady` 钩子）；用户点播放后按 `params.lightboxAutoplay`（默认 5000ms）自动 `next()`，末张回绕循环；悬停不暂停，任意手动操作（指针/滚轮/键盘，播放/全屏按钮及全屏闲置唤回控件的首次点按除外；滑动切图仍停止）立即停止；页面隐藏暂停计时、回前台恢复；集合 ≤1、间隔 0 或 `prefers-reduced-motion` 时隐藏按钮；关闭灯箱停止并复位，状态不跨打开保留
- **图像分析为管线预计算结果直读**：照片生成管线在加水印前对全分辨率原图预计算统计（`tools/photo-pipeline/src/analysis.py` 唯一实现：RGB/明度/饱和度/色相直方图、6 主色色卡、影调定性——Rec.709 明度、九调（長/中/短按 P5–P95 在 11 级等距灰阶上的跨区数：≤4 短、5–7 中、≥8 长）、动态范围（线性光真档，独立数值展示）、剪裁警告、区域系统），结果写 `static/analysis/{slug}.json`（v5 schema、v 算法版本号、约 8KB/张（压缩后约 3.6KB），入库随部署发布）；灯箱打开/切图预取当前 ±1 照片、展开时按 slug + 内容版本直读（URL `?v=<照片 hash>-<schema 版本>`，同源 fetch、SW Stale-While-Revalidate 缓存即用/后台刷新、离线可回退；缓存键保留查询串，换图/算法升级不命中旧结果）后纯数学派生曲线并渲染——浏览端零逐像素成本、无 CORS 依赖
- **分析失败提示卡**（`.lightbox-analysis-error`）：预计算结果拉取失败（网络异常/结果缺失）时显示提示（i18n `lightbox_analysis_failed`），成功/缓存命中收起，analyze 入口先收起上次提示再拉取；骨架来自 empty-state partial（icon alert）
- **觀鳥圖鑑**（`lightbox-bird.js` + `_lightbox-bird.scss`）：照片带 `species` 或属于 `bird_series` 时，详情栏最底部显示「觀鳥圖鑑」触发行与可折叠内容（默认收起、开合状态跨切图保持、关闭灯箱复位）；内容为目→科→屬→種（中文 + 拉丁学名）、分布區域、棲息地、習性、資料來源（外链新窗口）；物种名标题右侧显示保育等级标签（等级代码决定 i18n 文案与底色，文案来自注册表唯一等级清单）；数据来自灯箱壳内嵌的 `data/birds.toml` JSON，按 species id 取用；缺 `species`/无对应数据时展开显示「缺少鳥種圖鑑資料」空状态卡（同分析失败卡样式）；空 slot 恒为详情区末子块（slot 内层以 0fr 折叠，块本身保留布局、隐藏态 inert/aria-hidden），不破坏末子块 auto 边距居中规则；有↔无时只让该块高度/透明度过渡，详情文字不淡出；图鉴块随详情区其他块同步淡入；資料來源链接按鸟种缓存，同鸟种连切不重建、焦点保持，切换鸟种/非鸟照片时焦点落回对应新链接或收起/关闭按钮；开合走 grid 0fr↔1fr 过渡并刷新窄屏抽屉高度/箭头；桌面展开按实际高度逐帧重判 is-fit（内容超高即切为可滚动），收起复用图像分析的居中补偿（冻结 is-fit + transform 下滑 + 翻转残余补偿）；既无 species 也不属于 bird_series 的照片整块从 slot 折叠隐藏（inert/aria-hidden）

---

## 颜色系统

### HSL 四元组（唯一定义色值的地方，`_base.scss`，2026-10-17 自 --rgb-* 分量迁移）
`defineColorHSL` 为每个颜色产出 `--x` 主值 + `--x-h/-s/-l` 分量；透明/派生色用
`hsla(var(--x-h), var(--x-s), var(--x-l), a)`，主值用 `var(--x)`。

```scss
:root {
    /* 固定暗色分量（不随明暗主题切换，仅 :root 定义；灯箱/轮播引用） */
    @include defineColorHSL(--dark-card, 207.3, 18.6%, 11.6%);
    @include defineColorHSL(--dark-text, 0, 0%, 91%);
    @include defineColorHSL(--dark-accent, 168.9, 25.2%, 58%); /* teal */
    ...
    /* 主题色（暗色默认值；亮色值见 [data-theme="light"] 覆盖同组四元组） */
    @include defineColorHSL(--color-bg, 202.5, 22.2%, 7.1%);
    @include defineColorHSL(--color-bg-card, 207.3, 18.6%, 11.6%);
    @include defineColorHSL(--color-accent, 168.9, 25.2%, 58%);
    @include defineColorHSL(--color-white, 0, 0%, 100%);
    @include defineColorHSL(--color-black, 0, 0%, 0%);
    ...
}
[data-theme="light"] {
    @include defineColorHSL(--color-bg, 214.3, 30.4%, 95.5%);
    @include defineColorHSL(--color-accent, 172.6, 40.9%, 31.2%);
    ...
}
```

- 直方图明度曲线金色为固定四元组 `--dark-lum-curve`（JS 不持颜色字面量；R/G/B 通道色属数据可视化身份色、rgb 计算值豁免）

### 语义颜色（派生自上方四元组）
- 透明度阶梯：`--color-accent-15/30/50/75`（hsla(accent 分量, 0.15/0.3/0.5/0.75)）
- 背景遮罩：`--color-header-bg`(0.85)、`--color-nav-bg`(不透明)、`--color-lightbox-bg`(纯黑)
- 叠加层：`--color-overlay-subtle`（暗=白 10% / 亮=黑 5%，地图陆地填充用）
- 灯箱固定暗色：组件内重新声明语义变量，取值自 `--dark-*` 固定四元组

---

## SCSS 规范

- 长度以 `em` 为单位（基于 16px）
- **间距唯一标尺**：`--space-4 … --space-96`（4px 基准，名称即设计像素值，见 `_base.scss`）是 margin/padding/gap 的唯一来源；新增间距先登记 token，禁止 1.6em/1.7em 这类字号换算沉淀值；页面内容顶部统一 `--space-32`（2em）
- **字号唯一标尺**：H1 2.5 / H2 2 / H3 1.5 / lead 1.25 / body 1 / small 0.875 / meta 0.75（`--size-*`，footer 与 small 同值）；模板/样式不再写字面量字号，展示级 3em/6em（空状态图标、404 大字）为唯一例外
- **标尺自检**：间距/字号字面量由 `tools/style-lint/check_style.py` 拦截；几何配对、发丝级等真例外在同一行注释写 `style-lint-ignore`，不允许无标记放行
- **组件尺寸标尺**：图标 `--icon-xs/sm/md/lg/xl`（0.75/0.875/1/1.25/1.5em）、控件 `--control-sm/md`（2.5/3em）；缩略图高、图表高、色卡、头像、统计列宽等媒体/数据尺寸保留现值
- `transition` 不写 `all`，明确列出属性
- 重复样式合并共享选择器
- **严禁硬编码颜色值**（`#xxx`、`rgba(数字)`、`rgb(数字)`）——所有颜色必须通过 `var(--color-*)` / `var(--dark-*)` 引用
- 新增颜色先在 `_base.scss` 的 `:root` 中经 `defineColorHSL` 定义为 HSL 四元组，再在样式文件中 `var()` 引用
- 颜色值统一 `hsl()` 格式（不用 hex）；带透明度用 `hsla(var(--x-h), var(--x-s), var(--x-l), a)`

---

## 动画规范

### 缓动曲线

| 变量 | 值 | 用途 |
|---|---|---|
| `--ease-standard` | `cubic-bezier(0.4, 0, 0.2, 1)` | 标准缓出（transition/animation 共用） |
| `--ease-soft` | `cubic-bezier(0.22, 1, 0.36, 1)` | hero/panel/image 柔和入场 |
| `--ease-expo` | `cubic-bezier(0.16, 1, 0.3, 1)` | 页面/菜单滑动 |
| `--ease-spring` | `cubic-bezier(0.34, 1.56, 0.64, 1)` | 弹性缓出（轻微回弹） |
| `--ease-chart` | `cubic-bezier(0.215, 0.61, 0.355, 1)` | 图表 easeOutCubic |

### 过渡语义组

| 变量 | 值 | 用途 |
|---|---|---|
| `--transition` | `0.3s var(--ease-standard)` | 标准交互/组合过渡 |
| `--transition-fast` | `0.2s ease` | 微交互/按压/短淡入 |
| `--transition-fade` | `0.3s ease` | 颜色/边框/背景/透明度 |
| `--transition-layout` | `0.35s var(--ease-standard)` | 尺寸/展开/轮播几何/FLIP（JS FLIP 350ms 对齐） |
| `--transition-spring` | `0.5s var(--ease-spring)` | hover/按压抬升 |
| `--transition-reveal` | `0.6s ease` | 图片/占位图/面板入场 |
| `--transition-reveal-fast` | `0.4s ease` | 行/小元素入场 |
| `--transition-image-reveal` | `1.0s` | 照片 `slowFadeIn` 显形/占位退场时长 |
| `--transition-page` | `0.35s var(--ease-expo)` | 页面/菜单滑动 |
| `--transition-chart` | `0.4s var(--ease-chart)` | 图表 |

- 保留特例：轮播标题 `1.2s`、统计/加载动画 `0.8s`、灯箱背景板 `0.75s`、瀑布流重启行淡出 `0.12s`、进度条/自动播放动态时长；不与通用组强行合并。
- JS 内联 transition（灯箱/SPA 换页/移动导航）引用同一组 token；`FLIP_DURATION` 350ms 与 `--transition-layout` 对齐。
- 近值合并统一取较长档（0.25→0.3、0.35→0.4、0.45→0.6；spring 统一 0.5s），会轻微改变节奏，调整时需目检灯箱、轮播和页面切换。

### 动画原则

- **交互动画**（hover/click）用 `--transition-spring`，给即时反馈的灵动感
- **布局动画**（FLIP resize、列数切换）用标准缓出，避免弹簧回弹造成抖动
- **入场动画**（页面加载、滚动揭示）用纯 `opacity` 淡入，不碰 `transform`，防止覆盖 hover 效果
- **CSS animation 与 transition 互斥**：同一元素上 `animation` 中的属性会覆盖 `transition`，避免在需要 hover transform 的元素上用含 `transform` 的 animation
- FLIP Play 阶段显式设置 `el.style.transition` 为平滑曲线，`transitionend` 后清理，让 CSS hover 过渡恢复正常
- **瞬态溢出裁剪用窗口类**：仅动画期间存在的 transform 溢出（FLIP Invert 摆回旧位）裁剪用 JS 挂摘类（`.is-flipping` 先例：动画期间挂、收尾摘），不静态 `overflow` 裁剪——静态裁剪会切掉悬停阴影/内容
- 懒加载图片用 `filter: blur(10px)` → `blur(0)` + `opacity` 过渡实现模糊渐清；**瀑布流照片卡例外**——底层铺服务端烘焙模糊、前端转黑白的 LQIP，主图 `is-loaded` 后播放一次 `slowFadeIn` 1.0s（linear；0→15% 浮现并收模糊、15→50% 全黑白缓升到 brightness 1.25、50→100% 缓降上色），占位层同步 1.0s 退场（不做缩放，见瀑布流加载策略）；**动画只播一次**——`animationend` 后 JS 打 `is-animated`，`.is-loaded:not(.is-animated)` 才匹配动画规则，跨档换列/筛选重启移动卡片节点时不再重播（CSS 动画在节点移出再插入时会从头开始，2026-11-14）
- **SVG 陷阱**：CSS transform 会覆盖 SVG attribute transform——光点位置 translate 放内层 `<g>` attribute、弹入 scale 放外层 `<a>` CSS（`transform-box: fill-box`）
- **`prefers-reduced-motion`**：地图弹入/脉冲关键帧包在 `no-preference` 媒体查询内；JS 侧 matchMedia 同步跳过动画与脉冲环

### 入场动画

- `fadeInUp` / `fadeInDown`：只含 `opacity`（0→1），不含 `transform`
- 交错延迟：`animation-delay` 递增（如 `0.06s × index`）
- 滚动揭示：`IntersectionObserver` + `.is-visible` class（图片懒加载等）

### 页面切换（SPA 导航）

- `page-transition.js` 拦截站内链接点击，先 `fetch` 新页面 HTML（旧页面保持、进度条即时推进），再替换 `.main-content`；当前地址完全相同的链接拦截但不导航（不重复 pushState/fetch/滚顶），带 hash 的链接放行给原生锚点；同页 hash 导航产生的 `popstate` 不重新 fetch 主内容（否则 `commitPage` 的 `scrollTo(0,0)` 会把锚点滚动重置回顶部；筛选参数的 back/forward 仍走 SPA 重新应用）
- 主内容替换用 `DOMParser` 解析后的 `document.importNode` + `replaceChildren`，不再 `innerHTML` 重解析；保留 `application/json` / `application/ld+json` 数据脚本（足迹地图数据、JSON-LD），移除可执行脚本与内联 `on*` 事件属性（可执行脚本由 `initPageModules` 统一初始化；初始首屏的轮播 AVIF 内联兜底保留，SPA 换页后由常驻 `avif-fallback` 接管）
- header、footer、lightbox 等（位于 `.main-content` 外部）不重载
- History API 管理 URL，支持浏览器前进/后退；**后退/前进回到访问过的页面时恢复离开时的滚动位置**（按 path+search 记忆、`history.scrollRestoration` 设为 manual 由本模块接管；点击链接进入新页面仍回顶；瀑布流页等 `masonry-ready` 建立完整高度后再滚，等待期间用户主动操作则放弃恢复）；**整页刷新同样恢复**——`pagehide` 把位置按 path+search 存入 `sessionStorage`，仅 reload 导航读取，避免 manual 关闭原生恢复后刷新回顶
- 内容就绪后：淡出 → 替换 → 淡入（`transitionend` + 超时兜底）；不再在 fetch 之前固定等待 150ms；`navSeq` 作废被取代的旧导航
- 切换后自动更新导航 `active` 状态、关闭移动端菜单
- JS 初始化拆分为全局模块（`headerScroll`/`mobileNav` 仅首次执行）和页面模块（每次切换执行）
- 带全局监听器的模块均加守卫防止重复注册；换页后必须释放对旧网格子树的引用（观察器断开/监听清理）

---

## 模板规范

- **SVG 图标统一管理**：所有 SVG 图标必须定义在 `data/svg.toml` 中，模板通过 `{{ $.Site.Data.svg.xxx | safeHTML }}` 引用，**严禁在 HTML 模板中直接硬编码 `<svg>` 标签**
- 新增图标时先在 `svg.toml` 添加定义（含 `xmlns`、`viewBox` 等完整属性），再在模板中引用
- **共享数据管线用 partial**：`utils/photo-sorted.html`（时间排序）、`utils/location-registry.html`（地点注册表）——新模板不得重复实现
- **页面骨架单源**：页面头与空状态骨架用 `components/page-header.html`、`components/empty-state.html`（2026-10-18 自 13 处复制收敛），新页面不得复制骨架
- **瀑布流网格单源**：网格标记与卡片循环统一由 `components/masonry-grid.html` 渲染，新列表页不得复制网格骨架
- 页面注入 JSON 数据用 `<script type="application/json">` + `jsonify | safeJS`（Hugo 会把 script 内容转义成带引号字符串，漏 safeJS 会导致 JSON.parse 得到字符串）

---

## JS 模块

| 文件 | 功能 |
|---|---|
| `main.js` | 入口，DOMContentLoaded 统一初始化；全局模块只跑一次，页面模块按入口按需加载 |
| `entry-loader.js` | 页面级入口按需加载：读 `#js-entry-urls` 的指纹 URL、注入脚本、失败可重试 |
| `entries/*.js` | 按页入口（list/home/map/about/lightbox）：打包对应页面模块并注册到 `window.__MimoEntries` |
| `lightbox-boot.js` | 灯箱懒启动：首次点击/`?p=` 深链时 fetch 骨架页、加载灯箱入口并重放点击；失败重试 |
| `lightbox-bridge.js` | SPA 导航关闭灯箱的薄桥（避免静态 import 把灯箱入口拉回核心 bundle；关闭函数经 window 注册——核心与灯箱入口各自打包本模块，模块级变量互不相通） |
| `gallery-filter-params.js` | 筛选 URL 参数键单源（核心 bundle 与 list 入口共用） |
| `masonry.js` | 网格引擎：整组行计划与完整页面高度、首屏可见窗口 + 下拉逐行补载（刷新恢复只揭示视口行、所有补行走串行队列一次建立一行、已渲染行保留）、自然行高布局（`rowHeight()` 唯一公式）、档位判定（CSS `--layout-tier`/`--layout-tier-exit` 单源 + 高度变化补行）、resize 重排（同档缩放 / 跨档 FLIP + 锚点补偿）、筛选重启（`restartMasonryGrid`）、`?p=` 深链直接渲染目标行、缺宽高照片 load 后按自然比例自愈 |
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
| `lightbox-analysis.js` | 分析结果拉取与图表渲染 |
| `lightbox-analysis-control.js` | 分析区开合与触发行；桌面收起居中补偿经共享 helper |
| `lightbox-panel-comp.js` | 灯箱详情区收起居中补偿（图像分析与觀鳥圖鑑共用：冻结 is-fit、transform 下滑、翻转残余补偿） |
| `lightbox-bird.js` | 觀鳥圖鑑：species 查表填充分类/分布/棲息/習性/資料來源、缺资料空状态、默认收起与开合、抽屉刷新 |
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
| `breakpoints.js` | JS 断点单源：`BP_DESKTOP_MIN` / `BP_CARD_GRID_3COL_MIN` / `BP_LIGHTBOX_NARROW` |
| `flip.js` | FLIP 常量与四件套：`FLIP_DURATION/EASE/TRANSITION/HYSTERESIS`、`clearFlipInline` / `recordFlipRects` / `resetFlipFinish` / `scheduleFlipFinish` |
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
    enableInstantPage = false              # SPA 已自行 fetch；SW NetworkFirst 使预取无法复用，站点关闭
    carouselCount = 6                      # 首页轮播精选图数量（1–12）
    carouselInterval = 5000                # 轮播自动播放间隔（毫秒；0 禁用，其余最小 1200）
    lightboxAutoplay = 5000                # 灯箱自动播放间隔（毫秒；0 禁用并隐藏按钮；默认关闭）
    yearMergeBefore = 2024                 # 早于此年的年份合并为一档（如 2024 → 「2024 前」，即 2023 及更早；0 = 不合并）
    jsonldPhotoLimit = 24                  # 列表页 JSON-LD 最多输出的照片条数（0 = 不限；EXIF 明细不进 JSON-LD）
    feedCount = 20                         # RSS 最近发布作品条数
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
    # 字号标尺: H1 2.5 / H2 2 / H3 1.5 / lead 1.25 / body 1 / small 0.875 / meta 0.75（footer 与 small 同值）
    # 变量: baseFontSize, sizeH1-H3, sizeLead, sizeBody, sizeSmall, sizeMeta, sizeFooter
    # baseFontSize 注入 --base-font-size，由 _base.scss 的 html font-size 消费
```

---

## 无障碍

- skip-to-content 跳转链接（`.skip-link`），`:focus-visible` 全局焦点样式
- 所有 aria-label 通过 `{{ i18n }}` 引用，严禁硬编码（JS 动态构建的 aria-label 用 i18n 格式串占位符替换，如地图光点）
- 筛选胶囊、地图光点支持键盘聚焦/回车

## SEO

- `head.html` 包含 meta description、canonical、Open Graph（`og:*`）、Twitter Card；SPA 导航后 `page-transition.js` 从新页面 head 同步这些页面级标签（canonical/OG/Twitter/description/RSS alternate），字体/样式/站点级 JSON-LD 不动
- OG/Twitter 图片：页面 `.Params.cover` 优先；无 cover 的首页/全部作品/系列/足迹/关于回退最新精选（无则最新作品）
- RSS 只保留首页摄影 feed（`/index.xml`）；section 输出设为仅 HTML，不再生成空的 `/section/index.xml` 与 `rel=alternate`
- 订阅源每张作品一条、按 `published`（缺失回退 `time`）倒序取最近 `feedCount` 条；`guid` 用作品 `src`（稳定唯一），链接指向灯箱深链 `/gallery/?p=<slug>`——补发旧拍摄日期的作品也会成为新条目
- sitemap 由 Hugo 自动生成

---

## 链接规范

- 所有站内链接使用相对路径：`RelPermalink`、`/`
- 外部链接（博客等）使用绝对 URL
- 筛选 URL 参数：`?s=` 範圍、`?y=` 年份、`?l=` 地点英文 slug、`?c=` 类型

---

## 响应式断点

| 断点 | 瀑布流行基准 | 导航 |
|---|---|---|
| ≤500px | 每行 1–2 张（3:2 横构图独占 / 正方形仅与竖构图同行 / 竖构图同行） | 汉堡菜单 |
| 501–768px | 每行 2 张（3:2 基准） | 汉堡菜单 |
| 769–1000px | 每行 3 张（3:2 基准） | 水平菜单 |
| >1000px | 每行 4 张（3:2 基准） | 水平菜单 |

- 档位滞回：升档需越过 520/788/1020（CSS `--layout-tier-exit`），降档按 500/768/1000（`--layout-tier`）；JS 只读变量
- 间距全断点统一 0.5em；≤768px 容器 padding 缩小为 1em

---

## 关键行为

1. **照片排序**：time 降序（带时刻时按完整拍摄时刻）+ 同秒或仅日期时按 TOML 索引；排序管线唯一实现 `partials/photo-sorted.html`
2. **组照展示**：画廊/分类页展示全部作品（含组照封面与内页），不按 `is_cover` 过滤；系列入口由系列合集页与导航承担
3. **照片计数**：页头总数与地图弹层计数使用 `realCount`（含组照内页）
4. **初始渲染**：照片全部在 DOM 中，未渲染者带 `is-hidden`（display:none）；`baseof` 内联脚本解析阶段先加、initMasonry 按可见窗口揭示时移除（bundle 失败有 4s 兜底看门狗，拆行容器后放出全部卡片）；SPA 换页由 `main.js` 在入口加载前为新网格重新加 `is-hidden`，4s 未就绪走同口径兜底释放
5. **隐藏照片**：仍在 DOM 中（供筛选复用与后来补载），留在网格隐藏池（无 src）
6. **resize**：同档位行成员冻结按比例缩放；跨档位重新规划整组行并做 FLIP + 锚点滚动补偿
7. **筛选切换**：按整页容器渐进加载模式重启网格（重建计划与页面高度，先揭示视口内行后逐行补载）；拍平行容器时行内照片 insertBefore 第一个游离项（保持时间顺序）
8. **提交**：忽略 CHANGELOG.md，版本号由用户决定；用户说「发布」才包含 CHANGELOG
