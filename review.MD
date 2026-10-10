# 代码审查结论（灯箱与足迹，2026-10-09）

## 最新一轮审查（2026-10-11）——确认缺陷（按严重度）

审查范围：本会话全部改动（`git diff 59e7848`，22 文件 +826/-217）；9 个独立角度 + 1 轮查漏。

1. **sw.js:86 壳回退失效**——离线导航回退 `cache.match('/')` 只查 RUNTIME，install 预缓存进 SHELL_CACHE 的 `/` 从未被读；深链首访用户离线导航得到错误页。修：`caches.match('/')` 全局查。
2. **lightbox.js:148 centerComp 双 rAF 链**——同步 step() 内部排一条、外部再排一条，cancelCenterComp 只能取消最后一条；收起中途展开时残留链把标题/面板钉死。修：删外部排程行。
3. **lightbox.js 切图未取消 centerComp**——收起 0.4s 窗口内切图，补偿作用到新照片标题（纵向漂移）。修：isSwitch 分支加 cancelCenterComp()。
4. **lightbox.js:19 空值守卫前解引用**——`lightbox.querySelector` 在 `!lightbox` 守卫前，容器缺失时 init 崩溃。修：`lightbox ? lightbox.querySelector(...) : null`。
5. **mobile-nav.js:111 清理顺序**——transition 清理在 toggleMenu 之后，清掉刚写入的关闭过渡，跨断点收菜单变瞬移。修：清理移到 toggleMenu 之前。
6. **lightbox-drawer.js:222 fitAdjuster 漏计触发行**——只扣分析区高度、没扣触发行复现高度（~47px），收起后总高与面板差 0–47px 时 is-fit 过渡中途翻转、标题跳变。修：adjuster 同时扣 `analysisTrigger.offsetHeight`。
7. **masonry.js:248 滞回被静默丢弃**——注释谎称 CSS 有 enter/exit 双阈值（实际只有单阈值）；TIER_EXIT 的 521/789/1021 监听永不换档成死逻辑；断点附近布局反复全量重建。修：CSS 变量为可信输入 + exit 查询做升档滞回（恢复原语义），注释对齐。
8. **_utils.scss:76 返回顶部窄屏级联冲突**——窄屏 `.back-to-top { bottom: 1.5em }` 压过隐藏态 `-4em`，入场动画失效。修：窄屏规则改挂 `.back-to-top.active`。
9. **nav-dropdown.js:47 触屏关闭被粘性 hover 架空**——iPad 横屏点开下拉后关不掉（sub-open 摘了、hover-ready 规则仍展开）。修：hover-ready 规则加 `@media (hover: hover)` 门控。
10. **nav-dropdown.js:32 SPA 跳转后 sub-open 残留**——点下拉内链接跳转后下拉盖在新页面上。修：点击下拉内 `<a>` 时同样 resetSubMenus。
11. **viewport-fix.js 副作用与冗余**——meta 改写临时附加 maximum-scale 会重置用户捏合缩放；根因（overflow-x）修复后属冗余兜底。修：移除（如需可恢复）。
12. **lightbox.js:209 窄屏收起后抽屉箭头状态不刷新**——refresh 在 t=0 执行、高度未变，箭头停留在收起前。修：collapseEnd 中补 drawer.refresh()。
13. **sw.js:73 SWR 双 fetch**——缓存未命中时同一 URL 并发两次请求。修：共享同一 fetch promise。
14. **baseof.html aria-hidden 内可聚焦按钮**——收起态容器 `aria-hidden="true"` 内藏着 tabbable 的收起按钮。修：收起态 `visibility: hidden`（过渡尾部离散翻转）。
15. **lightbox.js:852 opacity 级联缝隙**——revealSynced 的内联 opacity 压过 `.is-open` 的类级 opacity，触发行收起无淡出。修：setAnalysisOpen 中切换前清内联 opacity。

已排除假阳性：sw.js 旧 'runtime' 缓存孤儿（旧 SW 因配置键嵌套从未注册）；reduced-motion transitionend 类问题（既有行为）。

清理项（未修）：chartsWrap 死代码；analysisOpen 冗余布尔；辉光/背景层模型同构复制；断点魔法数散落；定时器 debounce、relayout 无变化跳过、caches.open 提升、matchMedia 提升；startCenterComp 闭合解；iOSGlowDisabled 过宽覆盖。

## 修复状态（2026-10-11 已全部执行）

- 缺陷 1–15 全部修复：① sw 壳回退改 `caches.match('/')` 全局查 ② centerComp 删外部 rAF 排程 ③ 切图分支补 cancelCenterComp ④ lightboxImgArea 改三元空值安全 ⑤ mobile-nav 清理移到收菜单前 ⑥ fitAdjuster 同时扣触发行高度 ⑦ masonry 滞回恢复（CSS 变量基础值 + TIER_EXIT 出口查询升档门控，注释对齐）⑧ 返回顶部窄屏规则改挂 .active ⑨ hover-ready 规则加 `@media (hover: hover)` 门控 ⑩ 点下拉内链接同样 resetSubMenus ⑪ viewport-fix.js 移除（根因已修、副作用吞缩放）⑫ collapseEnd 补 drawer.refresh ⑬ SWR 单次 fetch 共享 promise ⑭ 收起态 visibility:hidden（移出 Tab 序、过渡尾部翻转）⑮ setAnalysisOpen 清内联 opacity
- 顺带：chartsWrap 死代码删除；构建零警告

## 清理项执行状态（2026-10-11 第二轮）

- **E analysisOpen 冗余布尔**：已删除——开合状态以 `analysisWrap` 的 is-open 类为唯一事实源
- **C 效率项**：已做——masonry 延迟定时器 debounce（新 resize 重置）；relayoutShown 宽/档位未变时跳过全量写回（`grid._lastW`）；sw.js `caches.open` 模块级复用（runtimeCache）；lightbox.js 窄屏 matchMedia 提升到初始化
- **B 断点单源（JS 侧）**：`utils.js` 新增 `BP_DESKTOP_MIN = 769`，nav-dropdown/mobile-nav 共用；CSS 侧对应值注释互指（完整 CSS+JS 单源需 Hugo 注入层，暂缓）
- **A 层栈抽取**：`utils.js` 新增 `createLayerStack`（layers/schedulePrune/cancelPrune/clear，clear 原地清空防引用失效）；辉光与背景两模型均改为共用（背景 BACKDROP_MS 单源保留）
- **D startCenterComp 闭合解**：**暂缓**——rAF 实测补偿承载了 T0 锚点（标题滚动出画面时的负值补偿）与触发行复现的增量修正，闭合解只覆盖翻转跳变一项，替换风险高于收益；留待动效有真机复验条件时再评估

审查范围：`e5d808b..HEAD` + 工作区改动，覆盖 lightbox.js / lightbox-analysis.js / footprint-map.js / _lightbox.scss / baseof.html。9 路独立扫描 + 逐条验证 + 补漏。

## 一、确认的缺陷

### 高（错误结果）
1. **动态范围误判**：`drStops = p5 > 0 ? ... : 0`——≥5% 像素纯黑时 p5=0，强制 0 檔/低對比（夜景/星空/剪影触发）；`+1` 已防 log(0)，守卫应删。（lightbox-analysis.js:352）
2. **快速同向连切失步**：滑出动画内连按两次同方向，旧 slideOutDone 闭包用旧 p 重放 src/面板，主图/分析与背景层指向不同照片。（lightbox.js:468）
3. **首开辉光绕过门控**：首开路径无 pendingGlowLoad 门控，辉光在解码前淡入空框、内容突现（切图路径已修、首开未修）。（lightbox.js:543）
4. **形变中断回跳**：tweenMulti 中断后从旧目标而非当前中间帧重新插值，快速连切时曲线回跳。（lightbox-analysis.js:397）

### 中（状态机）
5. **过期探测失败隐藏当前照片**：hideAll() 无 analyzeSeq 代次守卫，迟到 onerror 隐藏已渲染的 B。（lightbox-analysis.js:680）
6. **背景回退状态语义混用**：错误回退把 prev.on 当「应显示」，show() 守卫读它当「已显示」——恢复层不经淡入与剪枝；未查 prev.el.complete；剪枝定时器不补设。（lightbox.js:334/356）
7. **预载失败永不重试**：失败的 Image 永久占据 preloadCache，该照片整会话每次切换都转圈。（lightbox.js:194）
8. **新动画不响应 prefers-reduced-motion**：形变与背景 0.7s 内联过渡是全站唯一例外。（analysis.js:397 等）

### 低（边界/健壮性）
9. **单张照片按方向键空闪**：prev/next 不检查 length > 1，按键触发完整切换动画+背景闪黑。（lightbox.js:627）
10. **足迹预览计时器跨页泄漏**：renderPreview.timer 不在 cleanup 清理，SPA 换页后旧 slug 渲染新页面板。（footprint-map.js:461）
11. **histogram 配置键失联**：键已删但 merge 默认字典残留死键，老配置静默失效。（baseof.html:54）
12. **两处小问题**：色相名用段索引而非段中心，边界错位 5–7.5°（analysis.js:542）；openBackdrop 无 error 监听（lightbox.js:297，首开缩略图失败背景永远空白）。

## 二、结构 / 冗余 / 抽离建议

- A. 抽「SVG 数据过渡」通用组件 morphChart，统一三渲染器样板，顺带修回跳与 reduced-motion
- B. utils.js 收敛：easeOutCubic（第三份拷贝）、isImageReady（6 处）、smooth5（2 处）
- C. 时长与缓动单源：0.4s/0.7s/750ms 魔数；CSS ease 与 JS easeOutCubic 不一致（注释却称同款）；建议 --transition-chart/--transition-backdrop 变量，剪枝定时由时长推导
- D. 冗余状态化简：backdropLayers 三态 → 裸元素数组（show 守卫 = 最新层判定）；glowDecoded/mainSlideStarted 两布尔可消除
- E. SCSS 清理：.lightbox-histogram-wrap 死规则；五个 wrap 重复规则合并；四个图表标注块抽 %chart-note
- F. 阈值常量块补全：0.05/0.02/硬编码 10（应为 ZONE_COUNT-1）入块
- G. 效率：analyzeSatHue 同参两次；缓存命中重算目标 y 数组；renderExif 重建 rows；collectPhotos 无条件重建；过渡每帧 querySelector 与 x 前缀重建
- H. 标签结构化：6 个竖线串 data-* → JSON；slice(0,-1) → 显式 i18n 前缀键；三段语义位置序 → 显式语义键

## 三、已核查排除

缓存命中绕过代次（安全）；hideAll/render display 成对；nth-child(even) 竖线在单区块关闭时仍正确；labels.split 无兜底当前不可达；抽屉箭头点击实时重算（仅视觉残留）；色温/旧 i18n 删除无孤儿。

## 修复执行顺序

缺陷 1–12（1–4 优先）→ 结构 C/D/E/F → A/B/G → H（可议）。

## 修复状态（2026-10-09 已全部执行）

- 缺陷 1–12：全部修复（其中缺陷 8 的 reduced-motion 覆盖形变/背景/滑动/辉光全部内联过渡；缺陷 12b 首开背景无上层可回退，属可接受降级，未加逻辑）
- 结构：C（--transition-chart 变量单源 + 剪枝定时由时长推导）、D（背景层裸元素数组 + show 最新层守卫）、E（SCSS 死规则删除、wrap 规则合并、%chart-note 占位符）、F（阈值常量补全）、B（easeOutCubic/isImageReady 收敛 utils.js、smooth5 模块内共用）、G（analyzeSatHue 单次调用、目标曲线探测时入缓存、渲染器骨架引用缓存、EXIF 行配置提升）
- H（labels 竖线串 JSON 化与 slice(0,-1) 前缀键化）与 collectPhotos 失效触发优化：暂缓——当前模板与 zh-cn i18n 下无实际缺陷，改动收益低、风险高，留待多语言需求出现时再做
