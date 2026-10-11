# 照片宽高回填

兜底回填 photo.toml 的 `width` / `height` 字段，并剥离已废弃的 `orientation` 行（零第三方依赖，Python 3.11+）。

## 目录结构

```
tools/backfill/
├── backfill-dimensions.py   # 回填入口
└── README.md
```

## 用途

- 常规流程中 width/height 已由预处理管线（`tools/photo-pipeline/`，上传照片时）生成——**正常情况不需要运行本脚本**
- 仅在「历史数据未覆盖 / 预处理管线未生成」时兜底补全宽高

## 用法

```bash
python tools/backfill/backfill-dimensions.py
```

## 行为说明

- 解析 `data/photo.toml`（复用 `tools/photo-pipeline/src/toml_utils.py` 的单一实现），对缺 width/height 的条目请求 OSS 图片信息接口（`?x-oss-process=image/info`，返回 ImageWidth/ImageHeight，无需下载图片本体）
- 写回时 `orientation` 字段自然剥离（构图方向已由站点模板从宽高推导：宽 ≥ 高 = landscape）
- 可重复运行，已有宽高的条目跳过；失败条目打印原因、不中断
