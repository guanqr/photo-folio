# PhotoFolio — 工程约定与文档索引

> 完整规格自 2026-11-16 起拆到 `docs/`（入口 [docs/README.md](../docs/README.md)）；本文件只保留硬约束与索引，改行为时同步更新对应文档。

## 文档地图

| 文档 | 内容 |
|---|---|
| [docs/architecture.md](../docs/architecture.md) | 技术栈、数据模型、页面结构、模板 / JS / 配置约定 |
| [docs/layout.md](../docs/layout.md) | 瀑布流算法与加载、resize、导航、断点 |
| [docs/lightbox.md](../docs/lightbox.md) | 灯箱交互与图像分析口径 |
| [docs/styling.md](../docs/styling.md) | 颜色、SCSS 标尺、动画与过渡 token |
| [docs/pipeline.md](../docs/pipeline.md) | 照片预处理、EXIF、分析 JSON、OSS 与回填 |
| [docs/quality.md](../docs/quality.md) | 无障碍、SEO、链接规范、关键行为 |

## 文档维护

- 同一口径只写一处；新增行为先判断落在哪个文档，再写实现。
- 能由 style-lint、测试或构建期 `errorf` 保证的规则不写进文档。
- `review.md`（内部审查记录）与 `.claude/memory/`（agent 工作记忆）不属于站点规格，不随仓库发布。
- 历史版本与发布说明仍以 `themes/photofolio/CHANGELOG.md` 为准。

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

### 审查记录（review.md）

- 只在用户明确要求「代码审核」时更新 `review.md`，记录发现的问题；普通功能/修复/样式改动不写审查记录
- 状态口径：`已办（YYYY-MM-DD）：验证方式` / `跳过（YYYY-MM-DD，裁定原因）` / `待裁定`；验证写清构建、lint、探针的结果
- `review.md` 是内部工作记录：不入库、不进 CHANGELOG、不写外部站点信息与本地绝对路径

### 修改原则

- 改代码前先输出对需求/现象/方案的理解，等用户确认后再改；只读诊断不受限，小改动（拼写、笔误）不适用
- 值等价优先：重构/整理类修改不得改变渲染结果，完成后必须构建并对比验证，差异逐项解释
- 改原规则而非追加覆盖；配置驱动（设计常量收编 hugo.toml）；一功能一文件；删除功能要删干净；不使用冗余抽象

### 代码风格

- 模板中任何展示给用户的文本（含 aria-label、JS 动态构建的）都必须经 `i18n` 转换，严禁硬编码；含可变部分的展示文本用 i18n 格式串（`photo_hover_place_date`、`date_format_full` 同法），严禁模板拼接 mm/f/· 等字面量；构建期 `errorf`/`warnf` 文案同样走 `i18n`（键名 `error_*`），分隔符走 i18n（`list_separator` / `error_list_separator`）
- front matter 统一 TOML 格式（`+++` 包裹，2026-10-18 起 content 全量转换）；archetype 放主题内（站点根目录不设 archetypes，避免遮蔽主题模板）
- 注释用「为什么 + 实测日期」的因果式写法；模板内注释一律 `{{/* */}}`，HTML 注释会输出进管线
- 颜色规范：严禁硬编码颜色值（`#hex`、`rgb(数字)`），一律经 `var(--color-*)` / `var(--dark-*)` 引用；新增颜色先在 `:root` 经 `defineColorHSL` 定义为 HSL 四元组（主值 + -h/-s/-l 分量），再引用
- SCSS：长度以 em 为单位（**rem 仅两类正当例外、须附因果注释**：视口锚定的固定偏移如轮播指示器；跨字号恒等的容器级间距如灯箱 EXIF 双列网格——无注释的 rem 一律转 em 或补注释，注意 em 转换可能改变渲染值、须核对值等价）；`transition` 不写 `all` 明确列出属性；`animation` 与 `transition` 互斥；入场动画仅 `opacity`；须支持 `prefers-reduced-motion` 降级
- JS 断点单源：断点常量收敛 `breakpoints.js`（`BP_DESKTOP_MIN`=769、`BP_LIGHTBOX_NARROW`=1000）与 `readLayoutTiers()`（读 `:root` 的 `--layout-tier`/`--layout-tier-exit`）；窄屏互补侧经 `BP_DESKTOP_MIN−1` 推导；CSS 侧对应值注释互指；FLIP 常量/四件套收敛 `flip.js`；**卡片网格与关于页统计不持像素阈值/滞回常量**，统一读 CSS 档位（升档看 exit 档位、降档随基础档位），并监听 `orientationchange` 复核，规避 iPad 视口陈旧；瀑布流档位阈值唯一源在 `_base.scss`（masonry 只读，不持数组）
- 不写旧浏览器降级路径（目标受众使用现代浏览器）
- 模板 dict 一律字符串键（整数键会转字符串）；`{{ with .X | default Y }}` 把 0/false/空 视为无值；partialCached 的 dict 输入必须传显式 variant（依赖默认缓存键会跨调用串内容）；页面无关 partial（site-style/site-fonts/site-meta/img-url-cached/photo-hash/photo-sorted/location-registry）一律 partialCached

### 构建与验证

- Hugo ≥ 0.139（标准版；`silenceDeprecations` 自 0.139 起支持）+ Dart Sass 1.107.0 **独立版**（不要用 npm 版：纯 JS 构建不支持 Hugo dartsass 的 embedded 协议，会报 EOF）；CI（.github/workflows/build.yml）由 peaceiris/actions-hugo@v3 pin Hugo 0.169.0 标准版（无 sha256 校验——动作源即 pin 对象），另下载官方 Dart Sass standalone 压缩包并加入 PATH（2026-10-30）
- 每次改动后至少跑一次 `hugo --cleanDestinationDir` 确认零警告零错误
- **样式标尺自检**：`python tools/style-lint/check_style.py` 扫描 SCSS 的间距、字号、`width/height/top/right/bottom/left` 字面量（例外须带 `style-lint-ignore` 注释）；CI 在构建前运行该检查，Hugo 构建带 `--panicOnWarning`（警告即失败）；`--printUnusedTemplates` 对 `layout` 指定的模板会误报（2026-11-16 实测），不得用作死模板判据或 CI 门禁
- 验证构建固定用 `-d .verify-build`（唯一临时构建目录，不另建 `.verify-local` 等变体名；需要临时改 baseURL 时也构建到这里，验证完按原参数重建），不写入 public/——public/ 不会自动清理、历史残留会混淆对比
- 编译产物抽查：JS 改动后查 bundle*.js（变量名被压缩，按语义模式匹配）；SCSS 改动后查 style*.css；怀疑回归用 `git worktree add` 构建旧版逐规则对比
- i18n 目录残留 `*.tmp` 文件会导致构建失败，排查前先清理 tmp
