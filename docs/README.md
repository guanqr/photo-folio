# 文档索引

本目录是站点实现规格的唯一来源（2026-11-16 自 `.claude/CLAUDE.md` 的「完整规格」迁出，内容为迁移时基线）。`.claude/CLAUDE.md` 只保留工程约定与索引。

| 文档 | 内容 | 何时读 |
|---|---|---|
| [architecture.md](architecture.md) | 技术栈、`photo.toml` / `locations.toml` / `birds.toml` 数据结构、页面结构、模板与 JS 模块约定、配置项 | 加字段、改页面、动模板或入口 |
| [layout.md](layout.md) | 瀑布流行高公式与分行、末行规则、加载与 resize、移动端导航、断点 | 改间距、断点或加载行为 |
| [lightbox.md](lightbox.md) | 灯箱交互（切图/抽屉/缩放/全屏/自动播放）与图像分析口径 | 改灯箱或分析图表 |
| [styling.md](styling.md) | 颜色四元组、SCSS 标尺、动画与过渡 token | 改样式或动画 |
| [pipeline.md](pipeline.md) | 照片预处理、EXIF、分析 JSON、OSS 上传、回填与增量策略 | 动 `tools/photo-pipeline` |
| [quality.md](quality.md) | 无障碍、SEO、链接规范、关键行为 | 改 head、结构化数据或页面行为 |
| [../README.md](../README.md) | 面向访客与协作者：特性、快速开始、添加照片、配置、部署 | 首次上手 |

## 维护约定

- **单一来源**：同一口径只写一处，其他文档用链接指代；不要再把规格复制回 `.claude/CLAUDE.md`。
- **能自动检查的规则不写文档**：间距/字号/颜色由 `tools/style-lint` 与构建期 `errorf` 保证，文档只解释为什么。
- **与代码同改**：行为、数据结构、配置项变更时同步更新对应文件；纯内容数据（照片、系列文案）不进文档。
- **不进公开构建**：`docs/` 只存在于仓库，不参与 Hugo 构建，也不会被部署；内部审查记录 `review.md` 仍不入库。

## 推荐阅读顺序

- 新接手：本页 → `architecture.md` → `layout.md` → `quality.md`
- 改灯箱：`lightbox.md` → `styling.md` → `architecture.md`（JS 模块）
- 改排版：`layout.md` → `architecture.md`（照片卡片/模板）
- 动管线：`pipeline.md` → `architecture.md`（数据结构）
