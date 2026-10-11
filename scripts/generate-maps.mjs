/**
 * 一次性生成「地图足迹」所需的静态几何数据（零 npm 依赖，Node >= 18）。
 *
 * 管线（陆地 / 省级边界 / 城市边界三条）：
 *   下载源 GeoJSON（优先 jsDelivr CDN 镜像；缓存于 scripts/vendor/，不入库）
 *   → Douglas-Peucker 简化（容差逐级加强直到体积达标）
 *   → 量化成整数对（陆地 0.05° = ×20；省界/城市边界 0.005° = ×200，
 *     口径写入文件头 {quant, data} 由渲染端还原）→ 删除连续重复点 → 输出静态 JSON。
 *
 * 用法：node scripts/generate-maps.mjs
 * 输出（提交入库）：
 *   themes/photofolio/static/maps/land-10m.json   —— 世界陆地（Natural Earth 10m，精细海岸线）
 *   themes/photofolio/static/maps/provinces.json  —— 中国省级边界线（含港澳台，剔除十段线等非省界要素）
 */
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const SOURCES = {
    land: {
        urls: [
            'https://cdn.jsdelivr.net/gh/nvkelso/natural-earth-vector@master/geojson/ne_10m_land.geojson',
            'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_land.geojson',
        ],
        cache: 'ne_10m_land.geojson',
        out: 'land-10m.json',
        maxBytes: 350 * 1024,
        tolerances: [0.01, 0.015, 0.02, 0.03, 0.05, 0.08, 0.12, 0.18, 0.25],
    },
    provinces: {
        urls: ['https://geo.datav.aliyun.com/areas_v3/bound/100000_full.json'],
        cache: 'china-provinces.geojson',
        out: 'provinces.json',
        quant: 200, // 0.005° 量化：详情页近看省界须平滑，0.05° 折线棱角明显
        maxBytes: 500 * 1024,
        tolerances: [0.005, 0.008, 0.01, 0.015, 0.02],
        // 只保留省级单位：剔除无 adcode 的十段线/南海诸岛插图要素（adcode 100000_JD）
        keepFeature: (f) => f.properties && f.properties.adcode && f.properties.adcode !== '100000_JD',
    },
};
const QUANT = 20; // 0.05° 量化

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const vendorDir = path.join(__dirname, 'vendor');
const outDir = path.join(__dirname, '..', 'themes', 'photofolio', 'static', 'maps');

/* ---------- 下载（带本地缓存） ---------- */
async function loadSource(cfg) {
    const cacheFile = path.join(vendorDir, cfg.cache);
    if (existsSync(cacheFile)) return JSON.parse(readFileSync(cacheFile, 'utf8'));
    let lastErr = null;
    for (const url of cfg.urls) {
        try {
            console.log(`downloading ${url} ...`);
            const res = await fetch(url, { redirect: 'follow' });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const text = await res.text();
            mkdirSync(vendorDir, { recursive: true });
            writeFileSync(cacheFile, text);
            return JSON.parse(text);
        } catch (err) {
            lastErr = err;
            console.warn(`  failed: ${err.message}`);
        }
    }
    throw lastErr || new Error('download failed');
}

/* ---------- Douglas-Peucker 简化（点距平方，避免 sqrt） ---------- */
function dpSimplify(points, toleranceDeg) {
    const tol2 = toleranceDeg * toleranceDeg;
    const n = points.length;
    if (n <= 2) return points;
    const keep = new Uint8Array(n);
    keep[0] = keep[n - 1] = 1;

    const stack = [[0, n - 1]];
    while (stack.length) {
        const [a, b] = stack.pop();
        const [ax, ay] = points[a];
        const [bx, by] = points[b];
        const dx = bx - ax;
        const dy = by - ay;
        const base = dx * dx + dy * dy;
        let maxD = 0;
        let maxI = -1;
        for (let i = a + 1; i < b; i++) {
            let d;
            if (base === 0) {
                const px = points[i][0] - ax;
                const py = points[i][1] - ay;
                d = px * px + py * py;
            } else {
                // 点到线段距离：|cross| / |base|，比较时用 cross^2 / base 即可
                const cx = points[i][0] - ax;
                const cy = points[i][1] - ay;
                const cross = cx * dy - cy * dx;
                d = (cross * cross) / base;
            }
            if (d > maxD) { maxD = d; maxI = i; }
        }
        if (maxD > tol2 && maxI > 0) {
            stack.push([a, maxI], [maxI, b]);
            keep[maxI] = 1;
        }
    }
    return points.filter((_, i) => keep[i]);
}

/* ---------- 编码：量化 + 去连续重复 ---------- */
function encodeRing(ring, quant) {
    const out = [];
    let prev = null;
    for (const [lon, lat] of ring) {
        const x = Math.round(lon * quant);
        const y = Math.round(lat * quant);
        if (prev === null || prev[0] !== x || prev[1] !== y) {
            out.push([x, y]);
            prev = [x, y];
        }
    }
    // 闭合环：首尾一致时去掉末点
    if (out.length > 2 && out[0][0] === out[out.length - 1][0] && out[0][1] === out[out.length - 1][1]) {
        out.pop();
    }
    return out;
}

const MIN_RING_POINTS = 4; // 量化后点数不足的碎屑环丢弃（微小岛礁等）

// 城市边界：各省单独文件（{adcode}_full.json），adcode 清单取自省份源要素；
// 输出 {省名: 多边形数组}（省界同款索引）。城市级边界需更细量化（0.005°）——
// 0.05°（约 5.5km）在城市视野下呈阶梯状、细节丢失，预算放宽到 2.5MB
const CITIES = {
    out: 'cities.json',
    quant: 200, // 0.005° 量化
    maxBytes: 2500 * 1024,
    tolerances: [0.002, 0.003, 0.005, 0.01, 0.02],
    urlFor: (adcode) => `https://geo.datav.aliyun.com/areas_v3/bound/${adcode}_full.json`,
    cacheFor: (adcode) => `${adcode}_city.geojson`,
};

function encode(geojson, tolerance, quant) {
    const polys = [];
    for (const f of geojson.features) {
        const geom = f.geometry;
        if (!geom || (geom.type !== 'Polygon' && geom.type !== 'MultiPolygon')) continue;
        // Polygon 的坐标是环数组、MultiPolygon 是多边形（各为环数组）数组——统一成「多边形列表」
        const polyList = geom.type === 'Polygon' ? [geom.coordinates] : geom.coordinates;
        for (const poly of polyList) {
            const rings = poly
                .map((ring) => encodeRing(dpSimplify(ring, tolerance), quant))
                .filter((ring) => ring.length >= MIN_RING_POINTS);
            if (rings.length) polys.push(rings);
        }
    }
    return polys;
}

// 省界专用：按省名输出 {省名: 环数组}——详情页小地图取单省轮廓
function encodeProvinces(features, tolerance, quant) {
    const byProvince = {};
    for (const f of features) {
        const geom = f.geometry;
        if (!geom || (geom.type !== 'Polygon' && geom.type !== 'MultiPolygon')) continue;
        const polyList = geom.type === 'Polygon' ? [geom.coordinates] : geom.coordinates;
        const rings = [];
        for (const poly of polyList) {
            const r = poly
                .map((ring) => encodeRing(dpSimplify(ring, tolerance), quant))
                .filter((ring) => ring.length >= MIN_RING_POINTS);
            if (r.length) rings.push(r);
        }
        if (rings.length) byProvince[f.properties.name] = rings;
    }
    return byProvince;
}

/* ---------- 城市名称简→繁（数据源为简体；全站繁体，生成时转换后再入库） ---------- */
const TRAD_CHAR_MAP = {
    宁: '寧', 绍: '紹', 苏: '蘇', 锡: '錫', 温: '溫', 华: '華', 丽: '麗', 龙: '龍',
    广: '廣', 东: '東', 马: '馬', 驻: '駐', 抚: '撫', 钦: '欽', 贵: '貴', 毕: '畢',
    铜: '銅', 达: '達', 泸: '瀘', 绵: '綿', 乐: '樂', 资: '資', 凉: '涼', 锦: '錦',
    绥: '綏', 鸡: '雞', 双: '雙', 鸭: '鴨', 鹤: '鶴', 岗: '崗', 鹰: '鷹', 赣: '贛',
    饶: '饒', 吕: '呂', 临: '臨', 运: '運', 阳: '陽', 晋: '晉', 长: '長', 乌: '烏',
    兰: '蘭', 彦: '彥', 伦: '倫', 贝: '貝', 尔: '爾', 郑: '鄭', 庆: '慶', 庄: '莊',
    滨: '濱', 泽: '澤', 辽: '遼', 陕: '陝', 台: '臺', 湾: '灣', 门: '門', 汉: '漢',
    树: '樹', 沧: '滄', 邯: '邯', 郸: '鄲', 张: '張', 承: '承', 岛: '島', 邢: '邢',
    顺: '順', 廊: '廊', 坊: '坊', 保: '保', 唐: '唐', 秦: '秦', 皇: '皇', 衡: '衡',
    迁: '遷', 卢: '盧', 泸: '瀘', 畿: '畿', 鞍: '鞍', 营: '營', 盘: '盤', 阜: '阜',
    铁: '鐵', 岭: '嶺', 朝: '朝', 辽: '遼', 吉: '吉', 松: '鬆', 白: '白', 城: '城',
    通: '通', 化: '化', 延: '延', 边: '邊', 齐: '齊', 哈: '哈', 尔: '爾', 滨: '濱',
    牡: '牡', 丹: '丹', 佳: '佳', 木: '木', 斯: '斯', 大: '大', 兴: '興', 安: '安',
    鸡: '雞', 西: '西', 鹤: '鶴', 岗: '崗', 双: '雙', 鸭: '鴨', 山: '山', 七: '七',
    河: '河', 鹤: '鶴', 伊: '伊', 春: '春', 黑: '黑', 绥: '綏', 大: '大', 庆: '慶',
    无: '無', 锡: '錫', 徐: '徐', 州: '州', 常: '常', 南: '南', 通: '通', 连: '連',
    云: '雲', 港: '港', 淮: '淮', 盐: '鹽', 扬: '揚', 镇: '鎮', 江: '江', 泰: '泰',
    宿: '宿', 杭: '杭', 嘉: '嘉', 兴: '興', 湖: '湖', 金: '金', 衢: '衢', 舟: '舟',
    丽: '麗', 水: '水', 温: '溫', 义: '義', 乌: '烏', 绍: '紹', 宁: '寧', 波: '波',
    芜: '蕪', 蚌: '蚌', 埠: '埠', 淮: '淮', 南: '南', 马: '馬', 鞍: '鞍', 铜: '銅',
    陵: '陵', 安: '安', 庆: '慶', 黄: '黃', 滁: '滁', 阜: '阜', 宿: '宿', 六: '六',
    亳: '亳', 池: '池', 宣: '宣', 福: '福', 厦: '廈', 莆: '莆', 田: '田', 三: '三',
    明: '明', 泉: '泉', 漳: '漳', 南: '南', 平: '平', 龙: '龍', 岩: '岩', 宁: '寧',
    德: '德', 九: '九', 景: '景', 德: '德', 镇: '鎮', 鹰: '鷹', 潭: '潭', 新: '新',
    余: '餘', 萍: '萍', 乡: '鄉', 赣: '贛', 吉: '吉', 宜: '宜', 春: '春', 抚: '撫',
    上: '上', 饶: '饒', 济: '濟', 青: '青', 岛: '島', 淄: '淄', 博: '博', 枣: '棗',
    庄: '莊', 东: '東', 营: '營', 烟: '煙', 潍: '濰', 坊: '坊', 威: '威', 海: '海',
    日: '日', 照: '照', 临: '臨', 沂: '沂', 德: '德', 聊: '聊', 滨: '濱', 菏: '菏',
    泽: '澤', 郑: '鄭', 开: '開', 封: '封', 洛: '洛', 阳: '陽', 平: '平', 顶: '頂',
    安: '安', 鹤: '鶴', 壁: '壁', 新: '新', 乡: '鄉', 焦: '焦', 作: '作', 濮: '濮',
    许: '許', 昌: '昌', 漯: '漯', 三: '三', 门: '門', 峡: '峽', 南: '南', 阳: '陽',
    商: '商', 丘: '丘', 信: '信', 周: '周', 口: '口', 驻: '駐', 马: '馬', 店: '店',
    武: '武', 汉: '漢', 黄: '黃', 石: '石', 十: '十', 堰: '堰', 宜: '宜', 昌: '昌',
    襄: '襄', 阳: '陽', 鄂: '鄂', 荆: '荊', 门: '門', 孝: '孝', 感: '感', 荆: '荊',
    州: '州', 黄: '黃', 冈: '岡', 咸: '鹹', 宁: '寧', 随: '隨', 恩: '恩', 施: '施',
    长: '長', 沙: '沙', 株: '株', 洲: '洲', 湘: '湘', 潭: '潭', 衡: '衡', 阳: '陽',
    邵: '邵', 岳: '岳', 常: '常', 德: '德', 张: '張', 家: '家', 界: '界', 益: '益',
    郴: '郴', 永: '永', 怀: '懷', 化: '化', 娄: '婁', 底: '底', 湘: '湘', 西: '西',
    广: '廣', 深: '深', 圳: '圳', 珠: '珠', 汕: '汕', 头: '頭', 佛: '佛', 韶: '韶',
    关: '關', 湛: '湛', 肇: '肇', 江: '江', 门: '門', 茂: '茂', 名: '名', 惠: '惠',
    梅: '梅', 汕: '汕', 尾: '尾', 河: '河', 源: '源', 阳: '陽', 清: '清', 远: '遠',
    东: '東', 莞: '莞', 中: '中', 山: '山', 潮: '潮', 揭: '揭', 云: '雲', 浮: '浮',
    南: '南', 宁: '寧', 柳: '柳', 桂: '桂', 林: '林', 梧: '梧', 北: '北', 海: '海',
    防: '防', 城: '城', 港: '港', 钦: '欽', 贵: '貴', 玉: '玉', 林: '林', 百: '百',
    色: '色', 贺: '賀', 河: '河', 池: '池', 来: '來', 宾: '賓', 崇: '崇', 左: '左',
    海: '海', 口: '口', 三: '三', 亚: '亞', 儋: '儋', 成: '成', 都: '都', 自: '自',
    贡: '貢', 攀: '攀', 枝: '枝', 花: '花', 泸: '瀘', 德: '德', 绵: '綿', 广: '廣',
    元: '元', 遂: '遂', 宁: '寧', 内: '內', 乐: '樂', 山: '山', 南: '南', 充: '充',
    眉: '眉', 宜: '宜', 宾: '賓', 广: '廣', 安: '安', 达: '達', 雅: '雅', 巴: '巴',
    中: '中', 资: '資', 阿: '阿', 坝: '壩', 甘: '甘', 孜: '孜', 凉: '涼', 贵: '貴',
    阳: '陽', 六: '六', 盘: '盤', 水: '水', 遵: '遵', 义: '義', 安: '安', 顺: '順',
    毕: '畢', 节: '節', 铜: '銅', 仁: '仁', 黔: '黔', 西: '西', 南: '南', 黔: '黔',
    东: '東', 南: '南', 黔: '黔', 西: '西', 布: '布', 依: '依', 族: '族', 苗: '苗',
    自: '自', 治: '治', 昆: '昆', 明: '明', 曲: '曲', 靖: '靖', 玉: '玉', 溪: '溪',
    保: '保', 昭: '昭', 通: '通', 丽: '麗', 江: '江', 普: '普', 洱: '洱', 临: '臨',
    沧: '滄', 楚: '楚', 雄: '雄', 红: '紅', 河: '河', 文: '文', 西: '西', 双: '雙',
    版: '版', 纳: '納', 大: '大', 理: '理', 德: '德', 宏: '宏', 怒: '怒', 迪: '迪',
    庆: '慶', 拉: '拉', 萨: '薩', 日: '日', 喀: '喀', 则: '則', 昌: '昌', 那: '那',
    曲: '曲', 阿: '阿', 里: '裏', 林: '林', 芝: '芝', 山: '山', 西: '西', 安: '安',
    铜: '銅', 川: '川', 宝: '寶', 鸡: '雞', 咸: '鹹', 渭: '渭', 延: '延', 汉: '漢',
    中: '中', 榆: '榆', 安: '安', 康: '康', 商: '商', 洛: '洛', 兰: '蘭', 嘉: '嘉',
    峪: '峪', 关: '關', 金: '金', 昌: '昌', 白: '白', 银: '銀', 天: '天', 水: '水',
    武: '武', 威: '威', 张: '張', 掖: '掖', 平: '平', 凉: '涼', 酒: '酒', 泉: '泉',
    庆: '慶', 定: '定', 陇: '隴', 南: '南', 临: '臨', 夏: '夏', 回: '回', 甘: '甘',
    南: '南', 藏: '藏', 自: '自', 治: '治', 州: '州', 西: '西', 宁: '寧', 海: '海',
    东: '東', 城: '城', 城: '城', 中: '中', 区: '區', 果: '果', 洛: '洛', 藏: '藏',
    海: '海', 北: '北', 海: '海', 南: '南', 海: '海', 西: '西', 玉: '玉', 树: '樹',
    黄: '黃', 南: '南', 海: '海', 北: '北', 海: '海', 西: '西', 果: '果', 洛: '洛',
    银: '銀', 川: '川', 石: '石', 嘴: '嘴', 吴: '吳', 忠: '忠', 固: '固', 原: '原',
    中: '中', 卫: '衛', 乌: '烏', 鲁: '魯', 木: '木', 齐: '齊', 克: '克', 拉: '拉',
    玛: '瑪', 依: '依', 吐: '吐', 鲁: '魯', 番: '番', 哈: '哈', 密: '密', 昌: '昌',
    吉: '吉', 回: '回', 自: '自', 治: '治', 博: '博', 尔: '爾', 塔: '塔', 拉: '拉',
    阿: '阿', 克: '克', 苏: '蘇', 喀: '喀', 什: '什', 和: '和', 田: '田', 伊: '伊',
    犁: '犁', 塔: '塔', 城: '城', 阿: '阿', 勒: '勒', 泰: '泰', 博: '博', 州: '州',
    巴: '巴', 音: '音', 郭: '郭', 楞: '楞', 呼: '呼', 和: '和', 浩: '浩', 特: '特',
    包: '包', 头: '頭', 乌: '烏', 海: '海', 赤: '赤', 峰: '峰', 通: '通', 辽: '遼',
    鄂: '鄂', 尔: '爾', 多: '多', 斯: '斯', 呼: '呼', 伦: '倫', 贝: '貝', 尔: '爾',
    巴: '巴', 彦: '彥', 淖: '淖', 乌: '烏', 兰: '蘭', 察: '察', 布: '布', 锡: '錫',
    林: '林', 郭: '郭', 勒: '勒', 兴: '興', 安: '安', 盟: '盟', 阿: '阿', 拉: '拉',
    善: '善', 沈: '瀋', 阳: '陽', 大: '大', 连: '連', 鞍: '鞍', 抚: '撫', 本: '本',
    溪: '溪', 丹: '丹', 东: '東', 锦: '錦', 营: '營', 阜: '阜', 新: '新', 辽: '遼',
    盘: '盤', 铁: '鐵', 朝: '朝', 葫: '葫', 芦: '蘆', 岛: '島', 长: '長', 春: '春',
    吉: '吉', 林: '林', 四: '四', 平: '平', 辽: '遼', 源: '源', 通: '通', 白: '白',
    松: '鬆', 原: '原', 延: '延', 边: '邊', 黑: '黑', 河: '河', 齐: '齊', 齐: '齊',
    哈: '哈', 尔: '爾', 滨: '濱', 齐: '齊', 齐: '齊', 哈: '哈', 尔: '爾', 牡: '牡',
    丹: '丹', 江: '江', 佳: '佳', 木: '木', 斯: '斯', 大: '大', 庆: '慶', 鸡: '雞',
    西: '西', 鹤: '鶴', 岗: '崗', 双: '雙', 鸭: '鴨', 山: '山', 七: '七', 台: '臺',
    河: '河', 伊: '伊', 春: '春', 黑: '黑', 河: '河', 绥: '綏', 化: '化',
};

function toTraditional(name) {
    return [...name].map((ch) => TRAD_CHAR_MAP[ch] || ch).join('');
}
// 城市标注：名称（简→繁）+ 位置（要素 center 属性，缺省取外环质心，量化口径同边界）
function cityLabels(src, quant) {
    const labels = [];
    for (const f of src.features) {
        const geom = f.geometry;
        if (!geom || (geom.type !== 'Polygon' && geom.type !== 'MultiPolygon')) continue;
        if (!f.properties || !f.properties.name) continue;
        let c = Array.isArray(f.properties.center) ? f.properties.center : null;
        if (!c) {
            const ring = geom.type === 'Polygon' ? geom.coordinates[0] : geom.coordinates[0][0];
            if (!ring || ring.length < 3) continue;
            let sx = 0;
            let sy = 0;
            for (const [lon, lat] of ring) {
                sx += lon;
                sy += lat;
            }
            c = [sx / ring.length, sy / ring.length];
        }
        labels.push([toTraditional(f.properties.name), Math.round(c[0] * quant), Math.round(c[1] * quant)]);
    }
    return labels;
}

async function generateCities(provinceFeatures) {
    const byProvince = {};
    for (const pf of provinceFeatures) {
        const name = pf.properties.name;
        const adcode = pf.properties.adcode;
        if (!adcode || adcode === '100000_JD') continue;
        let src = null;
        const cacheFile = path.join(vendorDir, CITIES.cacheFor(adcode));
        if (existsSync(cacheFile)) {
            src = JSON.parse(readFileSync(cacheFile, 'utf8'));
        } else {
            try {
                console.log(`downloading ${CITIES.urlFor(adcode)} ...`);
                const res = await fetch(CITIES.urlFor(adcode), { redirect: 'follow' });
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                const text = await res.text();
                mkdirSync(vendorDir, { recursive: true });
                writeFileSync(cacheFile, text);
                src = JSON.parse(text);
            } catch (err) {
                console.warn(`  ${name} 城市边界下载失败，跳过：${err.message}`);
                continue;
            }
        }
        byProvince[name] = { src, labels: cityLabels(src, CITIES.quant) };
    }

    let best = null;
    for (const tol of CITIES.tolerances) {
        const out = {};
        for (const [name, item] of Object.entries(byProvince)) {
            const polys = encode(item.src, tol, CITIES.quant);
            if (polys.length) out[name] = { polys, labels: item.labels };
        }
        const bytes = Buffer.byteLength(JSON.stringify(out));
        console.log(`[cities] tol=${tol}  provinces=${Object.keys(out).length}  bytes=${bytes}`);
        best = { out, bytes };
        if (bytes <= CITIES.maxBytes) break;
    }
    if (best.bytes > CITIES.maxBytes) {
        throw new Error(`[cities] cannot reach ${CITIES.maxBytes} bytes even at max tolerance`);
    }
    const outFile = path.join(outDir, CITIES.out);
    // 城市边界量化口径（200 = 0.005°）与陆地/省界（20 = 0.05°）不同——
    // 写入文件头由渲染端按口径还原坐标
    writeFileSync(outFile, JSON.stringify({ quant: CITIES.quant, data: best.out }));
    console.log(`written: ${outFile} (${Buffer.byteLength(JSON.stringify({ quant: CITIES.quant, data: best.out }))} bytes)`);
}

/* ---------- 主流程 ---------- */
for (const [name, cfg] of Object.entries(SOURCES)) {
    const src = await loadSource(cfg);
    console.log(`\n[${name}] source features: ${src.features.length}`);

    if (name === 'provinces') {
        // 要素清单核对：只应出现省级单位的多边形要素（十段线/插图等非省界要素在 encode 阶段按几何类型剔除）
        const lines = src.features
            .filter((f) => f.geometry && (f.geometry.type === 'Polygon' || f.geometry.type === 'MultiPolygon'))
            .map((f) => `${f.properties.name || '?'}(${f.properties.adcode || '?'})`);
        const skipped = src.features.length - lines.length;
        console.log(`province features: ${lines.join('、')}`);
        if (skipped > 0) console.log(`skipped non-polygon features: ${skipped}`);
    }

    let best = null;
    for (const tol of cfg.tolerances) {
        const feats = cfg.keepFeature ? src.features.filter(cfg.keepFeature) : src.features;
        // 省界按省索引输出（{省名: 环数组}，详情页取单省轮廓用）；陆地保持数组
        const quant = cfg.quant || QUANT;
        const out = name === 'provinces'
            ? encodeProvinces(feats, tol, quant)
            : encode({ features: feats }, tol, quant);
        const json = JSON.stringify(out);
        const bytes = Buffer.byteLength(json);
        const polyCount = name === 'provinces' ? Object.keys(out).length : out.length;
        console.log(`tol=${tol}  polys=${polyCount}  bytes=${bytes}`);
        best = { out, bytes };
        if (bytes <= cfg.maxBytes) break;
    }

    if (best.bytes > cfg.maxBytes) {
        throw new Error(`[${name}] cannot reach ${cfg.maxBytes} bytes even at max tolerance`);
    }

    mkdirSync(outDir, { recursive: true });
    const outFile = path.join(outDir, cfg.out);
    if (name === 'provinces') {
        // 省界量化口径写入文件头（渲染端按口径还原；陆地保持旧格式数组、口径固定 20）
        writeFileSync(outFile, JSON.stringify({ quant: cfg.quant, data: best.out }));
        console.log(`written: ${outFile} (${Buffer.byteLength(JSON.stringify({ quant: cfg.quant, data: best.out }))} bytes)`);
    } else {
        writeFileSync(outFile, JSON.stringify(best.out));
        console.log(`written: ${outFile} (${best.bytes} bytes)`);
    }
}

// 城市边界在省份源生成后执行（复用其缓存的省名/adcode 清单）
await generateCities(
    (await loadSource(SOURCES.provinces)).features.filter(SOURCES.provinces.keepFeature)
);
