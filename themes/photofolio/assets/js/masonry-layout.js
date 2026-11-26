/**
 * 瀑布流排版数学（纯函数，与 DOM 无关；由 masonry.js 引入）
 *
 * 抽出原因：行高公式、贪心分行、末行判定、行内宽度分配是引擎里最需要独立
 * 推理与验证的部分，和 DOM 编排（行容器、隐藏池、FLIP）混在一个 1000 行的
 * 文件里不易维护；本模块不读写任何 DOM，输入宽高比与容器度量即可复算
 * （2026-11-15，拆分时经浏览器行计划逐值对比确认行为不变）。
 */

// 末行放大上限：铺满后行高最多比常规行最小实际行高高 10%（2026-11-01 用户裁定）
const LAST_ROW_FILL_MAX_RATIO = 1.1;
// 最窄档位正方形判定容差：正方形（1:1）只与竖构图并排，与横构图/正方形分行
//（并排会把行高压得过小；2026-11-06 用户裁定）
const SQUARE_RATIO_TOLERANCE = 0.02;

export const isSquareRatio = (ratio) => Math.abs(ratio - 1) <= SQUARE_RATIO_TOLERANCE;

/* 行高公式（全模块唯一实现）：行高 = (行宽 − 间距 − 边框) / 宽高比之和 */
export function rowHeight(W, count, sum, gap, border2) {
    return (W - gap * (count - 1) - border2 * count) / sum;
}

/* 行高参考值：以「每行 N 张 3:2 宽幅作品（长边 3、宽边 2）」为基准，按实际容器宽度反推
   档位：xs=超窄屏每行 1 张（占满整行）、sm=窄屏每行 2 张、md=中屏每行 3 张、lg=宽屏每行 4 张
   （档位判定在 masonry.js 的 updateTier；脚本内以数值等级 0–3 表示） */
export function getTargetRowHeight(containerWidth, gap, border2, tier) {
    // 数值档位 0（xs，超窄屏）：单张 3:2 占满整行为基准；其余档位每行 N 张 3:2 基准
    const N = tier === 0 ? 1 : (tier === 1 ? 2 : (tier === 2 ? 3 : 4));
    return rowHeight(containerWidth, N, N * (3 / 2), gap, border2);
}

/* 末行是否放大铺满（2026-11-01 用户裁定）：
   - 单张末行始终按 H 封顶、不放大（2026-10-31 用户裁定）；
   - 至少两张时以常规行的最小实际行高 minRowH 为基准：铺满后行高超过
     minRowH × 1.1 即放弃放大（否则末行照片明显大于前面各行）；
   - 未超过上限时，再按 minRowH 排布检查右侧余量——连当前集合最窄的一张照片
     都放不下（最窄照片宽 = 宽高比 × minRowH + 左右边框，另需一个行间距）
     才铺满，否则左对齐留白。自然高度不超过 minRowH 时本来就能铺满，
     只需吸收取整余量 */
export function shouldFillLastRow(row, ratios, W, gap, border2, H, minRowH, minRatio) {
    const hFill = rowHeight(W, row.count, row.sum, gap, border2);
    if (row.count < 2) return hFill <= H; // 单张末行按 H 封顶
    if (hFill > minRowH * LAST_ROW_FILL_MAX_RATIO) return false;
    if (hFill <= minRowH) return true;
    // 未铺满时的实际渲染行高（computeRowLayout 对行高取整）：余量按同口径估算
    const h = Math.round(minRowH);
    let used = border2 * row.count + gap * (row.count - 1);
    for (let k = 0; k < row.count; k++) {
        used += Math.round(ratios[k] * h + border2) - border2;
    }
    return W - used < minRatio * h + border2 + gap;
}

/* 行在给定宽度下的高度：普通行恰好铺满；末行（ragged）默认左对齐留白，
   至少两张时按常规行最小实际行高 minRowH 封顶（单张仍按 H），仅在 fill
   判定为真时按自然高度铺满 */
export function planRowHeight(row, W, gap, border2, H, minRowH = H) {
    let h = rowHeight(W, row.count, row.sum, gap, border2);
    if (row.ragged && !row.fill) h = Math.min(h, row.count >= 2 ? minRowH : H);
    return h;
}

/* 贪心分行：行高 = (行宽 − 间距 − 边框) / 宽高比之和（自然铺满，行高可变化）
   逐张累加直到再加一张会低于参考值 H；
   超窄屏档位 xs：每行最多 2 张——横构图（宽高比 ≥ 1）可独占一行；竖构图开头的行必须
   与下一张同行（绝不落单）；行内一张横构图后若下一张是最后一张竖构图，则并入本行；
   正方形只与竖构图并排，与横构图/另一张正方形分行（否则行高过小，2026-11-06）；
   其余档位：边界处比较「停在此处 / 纳入下一张」，取行高最接近 H 者；
   最后一行（作品耗尽）可能标记 ragged：默认左对齐留白；≥2 张时以常规行最小
   实际行高为基准，放大不超过其 1.1 倍（见 planRowHeight / shouldFillLastRow） */
export function partitionRows(ratios, W, H, gap, border2, refine, tier) {
    const isTier0 = tier === 0;
    const maxPhotos = isTier0 ? 2 : Infinity; // 超窄屏每行最多 2 张
    const minPhotos = tier <= 1 ? 1 : 2;
    const hOf = (count, sum) => rowHeight(W, count, sum, gap, border2);
    const rows = [];
    let i = 0;
    const n = ratios.length;
    while (i < n) {
        // 超窄屏：竖构图（宽高比 < 1）开头的行必须凑足 2 张，与下一张同行
        const minForRow = isTier0 && ratios[i] < 1 ? 2 : minPhotos;
        let sum = 0;
        let count = 0;
        let j = i;
        while (j < n) {
            // 超窄屏：行内已有一张横构图、下一张是竖构图且为最后一张——并入本行，避免竖构图落单
            if (isTier0 && count === 1 && ratios[i] >= 1 && ratios[j] < 1 && j === n - 1) {
                sum += ratios[j];
                count++;
                j++;
                break;
            }
            const cand = hOf(count + 1, sum + ratios[j]);
            if (count >= minForRow && cand <= H) break; // 再加一张会低于参考值
            if (count >= maxPhotos) break; // 超窄屏每行最多 2 张
            sum += ratios[j];
            count++;
            j++;
        }

        let ragged = false;
        if (j === n) {
            // 行计划最后一行（作品耗尽）：按统一行高左对齐、不吸收余量；
            // 只有全局最后一行是 ragged，其余行都恰好铺满
            ragged = true;
        } else if (refine && count < maxPhotos) {
            // 最窄档位：正方形只与竖构图并排——正方形 + 横构图（或另一张
            // 正方形）分行；两者并排会把行高压得过小（2026-11-06 用户裁定）
            const squarePairBlocked = isTier0 && count === 1 &&
                ((isSquareRatio(ratios[i]) && ratios[j] >= 1) ||
                 (isSquareRatio(ratios[j]) && ratios[i] >= 1));
            if (!squarePairBlocked) {
                // 行边界微调：比较「停在此处 / 纳入下一张」，取行高最接近 H 者。
                // 注意：不交换作品顺序（JS 数组换序会与 DOM 顺序脱节，导致行划分错位）
                const hCur = hOf(count, sum);
                const hNext = hOf(count + 1, sum + ratios[j]);
                if (Math.abs(hNext - H) < Math.abs(hCur - H)) {
                    sum += ratios[j];
                    count++;
                }
            }
        }

        // 行高由 planRowHeight 按当前宽度计算，计划行不保存会过期的高度
        rows.push({ start: i, count, ragged, sum });
        i += count;
    }
    return rows;
}

export function rowCellAbsorbs(row, k) {
    return (!row.ragged || row.fill) && k === row.count - 1;
}

/* 行内第 k 张图片的宽度（applyRows 与 itemRectInPlan 共用，避免跨档 FLIP
   起点与实际布局各算一套而脱节）：普通行/判定铺满的 ragged 行末张向下取整
   吸收余量、整行恰好铺满；其余四舍五入（误差正负分布、末张 floor 已使行宽
   总和精确 ≤ W）。ragged 非铺满的末张按自然宽度参与四舍五入（右侧留白） */
export function rowCellWidth(row, k, remaining, ratio, h, border2) {
    if (rowCellAbsorbs(row, k)) {
        return Math.max(1, Math.floor(remaining - border2));
    }
    const cellW = ratio * h + border2;
    return Math.round(cellW - border2);
}
