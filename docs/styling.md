# 颜色、SCSS 与动画

> 迁自 `.claude/CLAUDE.md`（2026-11-16）；行为变更时同步更新本文件。文档索引见 [README.md](README.md)。

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
- 叠加层：`--color-overlay-subtle`（暗=白 10% / 亮=黑 5%，遮罩/叠加用）
- 足迹地图：`--color-map-fill`（低精度陆地填充）、`--color-map-region-fill`（高精度省/国区块，单层深色实色）、`--color-map-region-hover`（省/国悬停色块，旧版叠加色）、`--color-map-border`（边界/海岸线）
- 灯箱固定暗色：组件内重新声明语义变量，取值自 `--dark-*` 固定四元组

---

## SCSS 规范

- **样式入口拆分**：`scss/main.scss`（全站）与 `scss/lightbox.scss`（灯箱专用，首次启动灯箱才加载）两个入口；不产出 CSS 的占位符/mixin 放 `base/_primitives.scss`（`_base.scss` 通过 `@forward` 转发），两入口共用同一份定义、不得复制
- 长度以 `em` 为单位（基于 16px）
- **间距唯一标尺**：`--space-4 … --space-96`（4px 基准，名称即设计像素值，见 `_base.scss`）是 margin/padding/gap 的唯一来源；新增间距先登记 token，禁止 1.6em/1.7em 这类字号换算沉淀值；页面内容顶部统一 `--space-32`（2em）
- **字号唯一标尺**：H1 2.5 / H2 2 / H3 1.5 / lead 1.25 / body 1 / small 0.875 / meta 0.75（`--size-*`，footer 与 small 同值）；**倍率固定写在 `_base.scss` 的 `:root`，不开放站点配置**——hugo.toml 只暴露 `baseFontSize`，各档位随根字号等比缩放；模板/样式不再写字面量字号，展示级 3em/6em（轮播大屏标题、空状态图标、404 大字）为唯一例外
- **标尺自检**：间距、字号、`width/height/top/right/bottom/left` 的 `em/rem` 字面量由 `tools/style-lint/check_style.py` 拦截；几何配对、发丝级、媒体/数据尺寸等真例外在同一行注释写 `style-lint-ignore`，不允许无标记放行
- **组件尺寸标尺**：图标 `--icon-xs/sm/md/lg/xl`（0.75/0.875/1/1.25/1.5em）、控件 `--control-sm/md`（2.5/3em）；定位偏移用 `--space-*`；缩略图高、图表高、色卡、头像、统计列宽等媒体/数据尺寸保留现值并标记例外
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

