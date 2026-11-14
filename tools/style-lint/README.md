# 样式标尺自检

零依赖脚本，检查 SCSS 里的间距/字号是否都走了 token（`--space-*` / `--size-*`）。

```bash
python tools/style-lint/check_style.py            # 检查主题 SCSS
python tools/style-lint/check_style.py <目录>      # 检查指定目录（可选）
```

规则：

- `margin` / `padding` / `gap` 及其方向变体：值里不得出现 `em` / `rem` 字面量，只允许 `0`、`auto`、`var(...)`；`var(...)` 内的默认值不计
- `font-size`：只允许 `var(--size-*)` / `var(--base-font-size ...)`；展示级 `3em` / `6em` 为白名单
- 确属几何/发丝级例外的行，在同一行注释里写 `style-lint-ignore`（备注原因）
- 注释里的数值不参与检查

退出码：0 通过，1 有违规（CI 在构建前运行，警告即失败）。
