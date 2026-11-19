# 照片预处理管线

> 迁自 `.claude/CLAUDE.md`（2026-11-16）；行为变更时同步更新本文件。文档索引见 [README.md](README.md)。

## 流程与数据更新

- **入口**：管线目录内 `python run.py [--force]`——批量处理原图 → 输出图，并**直写 `data/photo.toml`**（单一数据源）；依赖 Pillow、oss2（requirements.txt）
- **路径配置**：`pipeline_config.json`（gitignore，example 为通用占位路径）指定照片输入/输出目录（在仓库外、必填，未配置则退出提示）；`toml_path` 缺省直写 data/photo.toml
- **处理流程**：长边缩放 1920px → 水印「Guanqr Photography @ 年份」（独立透明图层 + alpha_composite 控制透明度；颜色按水印文字实际渲染 bbox 的平均亮度自动黑白——2026-10-29 起，原底部 100px 全宽平均会被左右暗部拉低、水印中间亮时误选白字；年份取 EXIF DateTimeOriginal 回退 DateTime）→ JPEG 质量 95 起逐级降 5 压缩至 ≤400KB（最低降至 10；仍超限打印警告不中断——BytesIO 内存完成，不落临时文件）；**图像分析为独立步骤**（src/analysis.py）：对全分辨率原图（加水印前口径）单趟逐像素预计算统计，结果写 `static/analysis/{文件名}.json`（v5 算法版本号、约 8KB/张；RGB 直方图/色相 HSV 通道走 Pillow C 实现，色卡 k-means 与色相加权为逐像素融合单趟——全分辨率只付一次，见下增量策略）
- **分析常量单源**：`analysis.py` 的 `ANALYSIS_VERSION`、影调区界/剪裁、區域/色相分段数为唯一源头；管线启动时生成 `themes/photofolio/assets/js/analysis-meta.js`（文件头标注生成勿手改），灯箱 `lightbox-analysis.js` import，不得再写 JS 本地副本
- **EXIF 焦距口径**：`get_exif_info` 优先读取 `FocalLengthIn35mmFilm`（41989，35mm 等效焦距），缺失、为 0 或非法时回退 `FocalLength`（37386）；手机物理焦距（如 4mm）不得直接写入站点（2026-11-04）
- **EXIF 坐标口径**：`get_exif_info` 读 GPS IFD（34853），度分秒转十进制度（6 位小数、S/W 取负）；GPS 块存在不等于有坐标——缺 ref/经纬度、越界或 (0,0) 一律视为无坐标留空（实测有原图只写方向/海拔）。新建条目直接写入 lat/lng；同名换图仅在新图自带 GPS 时更新坐标，无 GPS 不得抹掉 address 地理编码结果（2026-11-19）
- **photo.toml 更新**：新条目 EXIF 字段（focus/iso/aperture/shutter/time/camera/lens，以及原图自带 GPS 时的 lat/lng）自动填（`time` 保留完整拍摄时刻 `YYYY-MM-DD HH:MM:SS`，同日作品按时刻排序；见 `exif_utils._normalize_time`）、width/height 恒取处理后的输出图尺寸（处理完成后统一刷新，避免同名换图改比例时预读旧输出值）、hash 恒取输出图内容 MD5 前 8 位（图片 URL 的 `?v=` 缓存版本号）、source_hash 恒取输入图内容 MD5 全 32 位（换图检测，站点不消费）、published 在新建条目时写入一次本地带时区时间戳（RSS 排序用；重跑/`--force`/同名换图不变，旧条目缺失回退拍摄时间）、手动字段留空；**同名换图（source_hash 变化）成功重出后同步更新上述 EXIF/time/camera/lens，手动字段保留；lat/lng 仅在新图自带 GPS 时覆盖**；新条目处理失败（无输出/抛错）不落条目；`write_toml` 按 time 升序**全量重写**——FIELDS 白名单**必须包含站点扩展字段 address/lat/lng/hash/source_hash**（漏掉会抹掉地理编码坐标与内容哈希——featured 曾被白名单漏掉而丢过，同类坑）；description/series/species/is_cover/featured 有值才写（species 供观鸟图鉴引用，登记在 CONDITIONAL_FIELDS）；字符串值写前转义反斜杠/双引号（`_tostr`）、读侧逆还原（`_fromstr`）——全量重写必须无损（改此文件须跑 tomllib 往返验证）；解析器严格匹配双引号字符串/布尔/数字整行，未登记字段或重复 src 拒绝重写（fail-fast，避免静默丢字段）
- **分析取整**：影调三段占比取整余数并入最大档（与饱和度同口径），v5 起合计恒为 100%；已有 v5 JSON 已修正
- **增量策略**：按输入图 `source_hash` 与 photo.toml 比较跳过未变化照片（同名换图保留旧 mtime 也能发现）；无 source_hash 的旧数据按变化处理，可用 `backfill_source_hash.py` 一次性回填；`run.py --force` 忽略增量重出全部图（仅重出图，分析仍按源图变化/缺失/版本惰性判定）；OSS 同步只传本次实际处理的文件名（force 覆盖云端），其余仅补云端缺失——避免本地/云端时间基准不一致；OSS 已有文件清单**分页拉取**（is_truncated/next_marker，单页默认 100 条）；待传文件按 `max_workers` 并发上传（默认 4、1=串行；oss2 `Bucket` 内部复用 requests.Session，不跨线程共享——每线程用同凭证新建实例，列表仍在主线程完成，输出按文件名顺序）；**图像分析为独立惰性步骤**：结果缺失或算法版本（JSON v 字段）过期才重算，源图变化成功重处理时强制重算、处理失败不重算；`--force` 仅重出图且分析未过期时不重算；首次接入自动全量回填（一次性成本），日常运行只付新增照片
- **写盘与上传顺序**：输出 JPEG 与 photo.toml 经 `compat.py` 临时文件 + `os.replace` 原子替换（TOML 固定 LF）；OSS 上传成功后才写 photo.toml，失败保留旧数据；新增条目打印手填字段提醒（2026-10-29）
- **OSS 凭证**：`oss_config.json`（gitignore，example 为模板）+ 环境变量回退（OSS_ACCESS_KEY_ID/SECRET/ENDPOINT/BUCKET_NAME）
- **上传缓存头**：新上传对象写入 `Cache-Control: public, max-age=31536000, immutable`——照片 URL 带内容哈希、对象内容不可变，可放心长缓存；同名换图产生新 URL，不依赖短 TTL 兜底（2026-10-26）
- **字体**：`fonts/` 不入库，`tools/photo-pipeline/scripts/download_font.py` 从 Google Fonts 下载 NotoSans-Bold.ttf；加载失败 ImageFont.load_default 兜底
- **兼容性**：Windows 控制台 stdout 重包 UTF-8 并保留行缓冲（`reconfigure(line_buffering=True)`，管道/调试控制台下同样逐行刷出——旧 `detach` + `codecs.StreamWriter` 会退化为 8KB 块缓冲、输出攒到进程结束，2026-11-19）、原子写、JS 取整统一在 `src/compat.py`（download_font 与 `tools/backfill/backfill-dimensions.py` 同样接入）；EXIF 字符串控制字符（NUL 等）在读写两侧清洗，否则 TOML 解析失败；backfill-dimensions 对中文文件名做 URL 编码
- **回填脚本**：`backfill_camera_lens.py <original_photos目录> <toml路径>`——只读 EXIF 写 camera/lens，无图片处理/上传副作用；`backfill_published.py <toml路径>`——按 `src` 首次出现在 photo.toml 的 git 提交时间回填 `published`（已有值不覆盖、无法溯源留空），只读 git 历史；**读不到 EXIF 的字段留空（覆盖既有值）——用户明确裁定的口径（2026-10-18），不得改为「保留既有值」**；`tools/backfill/backfill-dimensions.py` 经 OSS image/info 回填宽高（ROOT 三级 parent 指向仓库根）；`backfill_source_hash.py <original_photos目录> <toml路径>` 只读输入图回填 source_hash（无处理/上传/分析副作用），用于接入换图检测前跳过首轮全量重处理；`backfill_gps.py <original_photos目录> <toml路径>` 只读 EXIF 回填 lat/lng——自带 GPS 的坐标覆盖旧值（EXIF 实测优先于地址地理编码），无坐标的条目保持原值、不抹掉地理编码结果；`backfill_time.py <original_photos目录> <toml路径>` 从原图 EXIF 回填完整拍摄时刻，读不到时刻或原图缺失时**保持原值**（time 是站点排序/展示必需字段，写空会让构建期 `time.Format` 报错，不套用上面的留空口径）
- **OSS 孤儿核对（只读）**：`list_orphan_photos.py [photo.toml]` 分页拉取 OSS `images/photos/` 对象，与 `photo.toml` 的 `src` basename 比对，列出未被引用的对象（改名/删除后的残留）；不删除，删除仍走 OSS 控制台（2026-11-08）

