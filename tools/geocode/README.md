# 照片地址地理编码

把 photo.toml 中用户填写的详细地址（`address` 字段）转成 `lat`/`lng` 坐标（零第三方依赖，Python 3.11+；相机无 GPS，坐标由地址解析而来）。

## 目录结构

```
tools/geocode/
├── geocode-photos.py      # 地理编码入口
├── config.example.json    # 配置模板（复制为 config.json 填写）
├── config.json            # 高德 key（gitignore，不入库）
└── README.md
```

## 前置

1. 申请高德开放平台「Web 服务」key（个人开发者免费额度）
2. 复制 `config.example.json` 为 `config.json` 并填写：

```json
{
    "amap_key": "你的key"
}
```

也可以不建文件、用环境变量 `AMAP_KEY`（优先于 config.json）。

## 用法

```bash
python tools/geocode/geocode-photos.py
```

## 行为说明

- 仅处理「有 `address` 且缺 `lat`/`lng`」的条目；**可重复运行**，已有坐标的跳过
- 350ms 间隔串行请求（高德个人 key 并发限制 3 QPS）
- **海外地址**：高德不覆盖境外（如日本）时自动经 OSM Nominatim 兜底；当前国内网络下 Nominatim 不可达——海外照片手工填写 `lat`/`lng` 即可
- 写回 `data/photo.toml`：复用预处理管线 `tools/photo-pipeline/src/toml_utils.py` 的单一实现（全量重写、按 time 升序，字段白名单含 address/lat/lng，其余手动字段完整保留）
- 之后在 photo.toml 为照片补充坐标的使用方式见站点 README「照片坐标字段」
