# 二十四节气数据

生成灯箱节气标识使用的 `data/solar_terms.toml`（日期 → 节气 i18n key）。

## 用法

```bash
python tools/solar-terms/generate.py [--start 2010] [--end 2040]
```

默认覆盖 2010–2040；调整范围后重跑并提交生成结果。

## 口径

- **按日期当天匹配**，不看交节时刻：同一天上午拍摄的照片仍归当天节气。
- 日期由 Meeus 太阳视黄经算法计算，取北京时间（UTC+8）；日期级结果与公开历表一致。
- 节气名文案在 `themes/photofolio/i18n/zh-hant.toml` 的 `solar_term_*` 键，模板不硬编码。
