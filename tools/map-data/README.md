# 足迹地图几何数据生成

一次性生成「足迹地图」所需的静态几何数据（零第三方依赖，Python 3.11+），输出提交入库，一般无需重新生成。

## 目录结构

```
tools/map-data/
├── generate-maps.py   # 数据生成入口
├── vendor/            # 源 GeoJSON 下载缓存（gitignore，不入库）
└── README.md
```

## 用法

```bash
python tools/map-data/generate-maps.py
```

## 输出（写入站点主题目录）

| 文件 | 内容 |
|------|------|
| `themes/photofolio/static/maps/land-10m.json` | 世界陆地（Natural Earth 10m，精细海岸线） |
| `themes/photofolio/static/maps/provinces.json` | 中国省级边界线（34 个省级单位含港澳台，按省索引） |
| `themes/photofolio/static/maps/countries.json` | 海外国家边界（按 COUNTRY_NAMES 映射过滤，如「日本」；远洋小岛按环包围盒 < 0.4° 丢弃，主岛链保留） |

## 管线说明

- **陆地**：Natural Earth 10m（jsDelivr CDN 镜像），0.05° 量化（×20），预算 350KB
- **省界**：省级边界 GeoJSON，0.005° 细量化（×200，轮廓平滑），预算 500KB；**源要素须剔除无 adcode 的十段线/南海诸岛插图要素**（adcode `100000_JD`）
- Douglas-Peucker 简化容差逐级加强直到体积达标；量化口径写入 `{quant, data}` 文件头，由渲染端（footprint-map.js）按口径还原
- **舍入口径**：与 JS `Math.round` 一致的四舍五入（Python 内置 `round` 是银行家舍入，坐标量化会差 1）
