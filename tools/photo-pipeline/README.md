# 摄影作品批量处理工具

自动为摄影作品添加水印、缩放尺寸、压缩输出，从 EXIF 中提取拍摄参数并**直接写入站点数据源 `data/photo.toml`**（本仓库根目录，单一数据源）。

## 目录结构

```
tools/photo-pipeline/
├── run.py                   # 入口（python run.py）
├── backfill_camera_lens.py  # 一次性回填相机/镜头（历史数据迁移）
├── src/                     # 源代码
│   ├── main.py              # 调度逻辑 + 路径配置读取
│   ├── exif_utils.py        # EXIF 提取
│   ├── toml_utils.py        # TOML 读写（保留 address/lat/lng/hash 等站点扩展字段）
│   ├── watermark.py         # 水印与处理
│   ├── analysis.py          # 图像分析预计算（直方图/色卡/影调，输出 static/analysis/）
│   └── oss_utils.py         # OSS 上传
├── scripts/
│   └── download_font.py     # 字体下载（fonts/ 目录，gitignore）
├── pipeline_config.example.json  # 输入/输出目录与 toml 路径模板
├── oss_config.example.json # OSS 凭证模板（oss_config.json 不入库）
└── requirements.txt        # Pillow、oss2
```

**照片原图/输出图不在仓库内**（体积大），路径由 `pipeline_config.json` 指定（复制 example 修改；未配置时回退默认值并打印提示）。`data/photo.toml` 由管线直写。

## 准备工作

1. 安装依赖并下载字体：

```bash
pip install -r requirements.txt
python scripts/download_font.py
```

2. 复制 `pipeline_config.example.json` 为 `pipeline_config.json`，填写照片输入/输出目录（必填，照片目录在仓库外；toml_path 可省略，缺省直写 data/photo.toml；analysis_dir 可省略，缺省直写 static/analysis/）
3. （可选）复制 `oss_config.example.json` 为 `oss_config.json` 并填写 OSS 凭证（文件已 gitignore，不会入库）
4. 将需要处理的 `.jpg` / `.jpeg` 照片放入配置的输入目录

## 使用方法

```bash
cd tools/photo-pipeline
python run.py
```

处理完成并写入 `data/photo.toml` 后，站点侧如需补充地理坐标：为照片填 `address` 后运行 `python tools/geocode/geocode-photos.py`（站点根目录，详见站点 README）。

## 处理内容

- **缩放**：长边缩放至 1920px
- **水印**：`Guanqr Photography @ 年份` 底部居中（年份从 EXIF 读取，颜色按底部明暗自动选黑白）
- **压缩**：JPEG 质量循环递减，控制在 400KB 以内
- **图像分析**：对全分辨率原图（加水印前）预计算统计——RGB/明度/饱和度/色相直方图、6 主色色卡、影调定性（九调/动态范围/剪裁警告/区域系统），结果写 `static/analysis/{文件名}.json`（含 v 算法版本号），灯箱直接加载渲染、不再在线采样（每张约 2–3KB；全分辨率逐像素只付一次，见下「增量处理」）

## photo.toml 自动更新

新增照片自动追加，EXIF 拍摄参数自动填入，手动字段留空，按拍摄时间升序排列；已有条目的手动编辑内容（alt/category/place/location/description/series/featured/address/lat/lng 等）完整保留。

| 字段 | 来源 |
|------|------|
| focus / iso / aperture / shutter / time | EXIF 自动提取 |
| camera / lens | EXIF 自动提取 |
| width / height | 处理后图片尺寸（从输出目录读取） |
| hash | 处理后图片内容 MD5 前 8 位（图片 URL 的 `?v=` 缓存版本号） |
| alt / category / place / location / description / address | 留空，手动填写 |
| lat / lng | 由站点侧 geocode-photos.py 从 address 生成 |
| series / is_cover / featured | 不自动生成，手动添加后保留 |

## 历史数据回填（一次性）

旧版本未记录相机/镜头信息时，可运行：

```bash
python backfill_camera_lens.py <original_photos目录> <photo.toml路径>
```

脚本只读取 EXIF 并更新 `photo.toml` 的 `camera`/`lens` 字段，不处理图片、不上传 OSS。

## 增量处理

只处理新增或发生变化的照片（比较输入/输出修改时间），未变化的自动跳过。OSS 同步同样增量：只上传本次实际处理过的照片（覆盖云端同名文件），其余跳过。**图像分析为独立惰性步骤**：结果缺失或算法版本（JSON 的 v 字段）过期才重算，首次接入自动全量回填（一次性逐像素成本），此后日常运行只分析新增照片。每次运行都会按输出图字节重算 `hash`（未变化时值相同），上传对象写入一年 `immutable` 长缓存——图片 URL 带内容哈希，可放心缓存，同名换图会生成新 URL。
