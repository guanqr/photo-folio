// 系列页氛围粒子引擎：SVG 矢量渲染（2026-10-18 自 canvas 迁移）——
// 粒子为 circle/path 节点，每帧仅更新 transform 与 opacity 属性（不重建节点），
// 矢量天然适应高 DPI 与浏览器缩放；颜色直接引用 CSS 变量（--color-particle
// 各主题四元组 + --color-white），canvas 时代的 RGB 分量数据变量
// （--rgb-particle / --rgb-white）已删除，颜色体系统一为 HSL 四元组。
// 主题由 series/single.html 渲染的 data-ambient 键驱动：
//   falling-leaves——白桦落叶随风飘摆；firecracker——鞭炮爆裂碎屑 + 火星升腾；
//   dust——空气中悬浮的尘土：全视口缓慢漂移、微微沉浮、明暗闪烁。
// SPA 约定（main.js initPageModules 每次换页重入）：先销毁旧状态再初始化（root 幂等）；
// 换页销毁子树时同步 cancel rAF / disconnect observers（footprint-map.js 同款生命周期）。
// 减弱动态：prefers-reduced-motion 跳过粒子（另有 CSS 兜底隐藏 svg）。

import { prefersReducedMotion } from './utils.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const rand = (a, b) => a + Math.random() * (b - a);

/* ---- 矢量形状定义（自原 canvas sprite 坐标逐点迁移，quadraticCurveTo → Q） ---- */

// 白桦叶：卵形锯齿缘叶身 + 叶柄 + 中脉与侧脉（逻辑 52×48，叶尖朝右）
const LEAF_BODY = 'M10,25 Q14,16 18,17 Q22,18 24,13 Q28,10 32,11 Q36,12 38,15 Q42,20 46,24 Q41,29 37,30 Q33,32 31,37 Q27,40 23,38 Q17,35 13,34 Q9,30 10,25 Z';
const LEAF_STEM = 'M10,25 L3,32';
const LEAF_VEINS = 'M12,26 L42,24 M18,24.5 L17,15 M26,23.5 L27,12 M34,23.5 L35,13';

// 纸屑：细长小条（鞭炮爆裂碎屑，逻辑 16×8）
const SHARD_PATH = 'M1,4 Q2,1 8,1 Q14,1 15,4 Q14,7 8,7 Q2,7 1,4 Z';

function makeEl(tag, attrs) {
    const el = document.createElementNS(SVG_NS, tag);
    for (const k in attrs) el.setAttribute(k, attrs[k]);
    return el;
}

/* ---- 各主题粒子构建（数组插入顺序即绘制顺序，先入先画） ---- */

// 秋原：24 白桦落叶（7-12s 全程下落、横摆、旋转）
function buildAutumn(st) {
    const parts = [];
    for (let i = 0; i < 24; i++) {
        const dur = rand(7, 12);
        parts.push({
            kind: 'leaf',
            x0: rand(0, st.w), y0: rand(-st.h * 0.5, st.h * 0.9),
            t: rand(0, dur), dur,
            size: rand(1, 1.8) * st.em,
            swayA: rand(0.6, 1.6) * st.em, swayT: rand(2.5, 4.5), phase: rand(0, Math.PI * 2),
            spin: rand(0.2, 0.6) * (Math.random() < 0.5 ? -1 : 1),
            alpha: rand(0.35, 0.7),
        });
    }
    return parts;
}

// 端午：5 组鞭炮定时爆裂（每次随机点位）——闪光 + 红纸屑/白火点四溅坠落（碎屑池复用）+ 12 粒火星升腾
function buildDragon(st) {
    const parts = [];
    for (let e = 0; e < 5; e++) {
        const flash = {
            kind: 'flash', active: false,
            x: 0, y: 0, t: 0, life: 0.18, size: 2 * st.em, alphaMax: 0.9,
        };
        const pool = [];
        for (let i = 0; i < 30; i++) {
            pool.push({
                kind: 'debris', active: false,
                x: 0, y: 0, vx: 0, vy: 0, gravity: 0,
                t: 0, life: 1.5, rot: 0, vrot: 0,
                size: 0.3 * st.em, alpha: 0, alphaMax: 0.8, shardIdx: 0,
            });
        }
        parts.push({
            kind: 'burst',
            nextIn: rand(0.5, 2.5),
            flash, pool,
        });
        parts.push(flash);
        parts.push(...pool);
    }
    // 火星：缓慢升腾的余烬（与爆裂碎屑并存）
    for (let i = 0; i < 12; i++) {
        const dur = rand(7, 12);
        parts.push({
            kind: 'spark',
            x0: rand(0, st.w), t: rand(0, dur), dur,
            wobA: rand(0.2, 0.5) * st.em, wobT: rand(2, 4), phase: rand(0, Math.PI * 2),
            size: rand(0.5, 0.8) * st.em,
            alphaMax: 0.75,
        });
    }
    return parts;
}

// 农田：空气中悬浮的尘土——全视口缓慢漂移、微微沉浮、明暗闪烁（下半部略密）
const DUST_MIN = 30; // 数量下限（窄屏）
const DUST_MAX = 80; // 数量上限（超宽屏，控制每帧成本）
const DUST_DENSITY = 24; // 每 24px 视口宽度一粒

function dustCount(st) {
    return Math.min(DUST_MAX, Math.max(DUST_MIN, Math.round(st.w / DUST_DENSITY)));
}

function makeDustParticle(st) {
    const yFrac = Math.pow(Math.random(), 0.6); // 分布偏向地面
    return {
        kind: 'dust',
        x: rand(0, st.w), y0: st.h * (0.15 + yFrac * 0.75),
        vx: rand(0.15, 0.5) * st.em * (Math.random() < 0.5 ? -1 : 1),
        bobA: rand(0.1, 0.35) * st.em, bobT: rand(5, 10), phase: rand(0, Math.PI * 2),
        t: rand(0, 10),
        alphaBase: rand(0.3, 0.5), alphaA: rand(0.1, 0.16), alphaT: rand(3, 6), alphaPhase: rand(0, Math.PI * 2),
        size: rand(0.5, 1.4) * st.em,
    };
}

function buildFarm(st) {
    const parts = [];
    for (let i = 0; i < dustCount(st); i++) {
        parts.push(makeDustParticle(st));
    }
    return parts;
}

const THEME_SPECS = {
    'falling-leaves': buildAutumn,
    'firecracker': buildDragon,
    'dust': buildFarm,
};

/* ---- 窗口缩放保活（不清屏重建）：既有粒子坐标等比缩放、尘土数量差值增减 ---- */

// 粒子绝对坐标随视口比例缩放：时间轴/相位/速度等运动状态全部保留，动画连续无跳变
function rescaleParticles(st, oldW, oldH) {
    const kx = st.w / oldW;
    const ky = st.h / oldH;
    for (const p of st.particles) {
        switch (p.kind) {
            case 'leaf':
                p.x0 *= kx;
                p.y0 *= ky;
                break;
            case 'spark':
                p.x0 *= kx;
                break;
            case 'dust':
                p.x *= kx;
                p.y0 *= ky;
                break;
            case 'burst':
                // 爆裂点位每次随机生成无需缩放；仅飞行中的碎屑坐标按比例缩放
                //（数组中的 flash/debris 条目与 pool 内对象为同一引用，无需单独处理；
                //  flash 不缩放：坐标在下次爆裂时重掷——若缩放恰逢闪光的 0.18s 生命期，
                //  闪光与碎屑短暂偏移缩放差值，随下一次爆裂自愈，可接受）
                for (const d of p.pool) {
                    if (!d.active) continue;
                    d.x *= kx;
                    d.y *= ky;
                }
                break;
        }
    }
}

// 尘土数量随宽度变化：多退少补——既有粒子状态不动，新增的随机分布、多余的从尾部移除
function adjustDustCount(st) {
    const target = dustCount(st);
    if (target === st.dustTarget) return; // 数量未变时跳过（拖动窗口时多数帧无需重建数组）
    st.dustTarget = target;
    let kept = 0;
    const dropped = [];
    st.particles = st.particles.filter((p) => {
        if (p.kind !== 'dust') return true;
        if (kept < target) {
            kept++;
            return true;
        }
        dropped.push(p);
        return false;
    });
    // 淘汰的粒子必须同步摘除 DOM 节点：只从数组删除会留下不再被 frame 更新的
    // 孤儿 circle，反复变窄/变宽后节点持续累积（2026-10-29 实测 58→58→83…）
    for (const p of dropped) {
        if (p.el) {
            p.el.remove();
            p.el = null;
        }
    }
    // 只补差额：保留的尘土粒子节点与运动状态不动，避免 resize 时全量删建
    for (let i = kept; i < target; i++) {
        const p = makeDustParticle(st);
        p.el = makeEl('circle', { r: 32, fill: st.gradients.dust });
        st.root.appendChild(p.el);
        st.particles.push(p);
    }
}

/* ---- 粒子更新与渲染 ---- */

function stepParticle(st, p, dt) {
    switch (p.kind) {
        case 'leaf': {
            p.t += dt;
            if (p.t >= p.dur) {
                // 坠出底部：从顶部重生，重掷摆动与透明度
                p.t = 0;
                p.x0 = rand(0, st.w);
                p.y0 = -p.size * 2;
                p.swayA = rand(0.6, 1.6) * st.em;
                p.swayT = rand(2.5, 4.5);
                p.alpha = rand(0.35, 0.7);
            }
            const sway = Math.sin(2 * Math.PI * p.t / p.swayT + p.phase);
            p.y = p.y0 + (st.h + p.size * 4) * (p.t / p.dur);
            p.x = p.x0 + p.swayA * sway;
            p.rot = sway * 0.5 + p.spin * p.t; // 摆动倾角 ±0.5rad + 慢自旋
            break;
        }
        case 'burst': {
            p.nextIn -= dt;
            if (p.nextIn > 0) break;
            p.nextIn = rand(1.5, 3);
            // 每次爆裂完全随机点位（鞭炮丢哪儿炸哪儿）
            const bx = rand(st.w * 0.06, st.w * 0.94);
            const by = rand(st.h * 0.12, st.h * 0.75);
            // 闪光：白芯瞬亮后快速扩散淡出
            const f = p.flash;
            f.active = true;
            f.t = 0;
            f.x = bx;
            f.y = by;
            f.size = rand(1.6, 2.6) * st.em;
            // 碎屑：径向四溅 + 重力坠落 + 空气阻力（红纸屑为主、白色火点混合）
            let activated = 0;
            for (const d of p.pool) {
                if (d.active) continue;
                const ang = rand(0, Math.PI * 2);
                const sp = rand(3, 8) * st.em;
                d.active = true;
                d.t = 0;
                d.life = rand(1.2, 2.2);
                d.x = bx;
                d.y = by;
                d.vx = Math.cos(ang) * sp;
                d.vy = Math.sin(ang) * sp - rand(0.5, 1.5) * st.em; // 略向上
                d.gravity = rand(3, 5) * st.em;
                d.rot = rand(0, Math.PI * 2);
                d.vrot = rand(-7, 7);
                d.size = rand(0.25, 0.5) * st.em;
                d.alphaMax = rand(0.7, 0.95);
                d.shardIdx = Math.random() < 0.65 ? 0 : 1;
                if (++activated >= 24) break;
            }
            break;
        }
        case 'debris': {
            if (!p.active) break;
            p.t += dt;
            p.vy += p.gravity * dt;
            p.vx *= Math.exp(-1.2 * dt); // 空气阻力
            p.x += p.vx * dt;
            p.y += p.vy * dt;
            p.rot += p.vrot * dt;
            if (p.t >= p.life || p.y > st.h + 2 * st.em) {
                p.active = false;
                break;
            }
            // alpha 包络：前 8% 淡入、末 40% 淡出
            const k = p.t / p.life;
            p.alpha = k < 0.08 ? p.alphaMax * k / 0.08 : (k > 0.6 ? p.alphaMax * (1 - k) / 0.4 : p.alphaMax);
            break;
        }
        case 'flash': {
            if (!p.active) break;
            p.t += dt;
            if (p.t >= p.life) {
                p.active = false;
                break;
            }
            p.alpha = p.alphaMax * (1 - p.t / p.life);
            p.scale = 0.5 + 0.6 * (p.t / p.life);
            break;
        }
        case 'spark': {
            p.t += dt;
            if (p.t >= p.dur) {
                p.t = 0;
                p.x0 = rand(0, st.w);
                p.dur = rand(7, 12);
                p.wobT = rand(2, 4);
            }
            const k = p.t / p.dur;
            p.y = st.h + 2 * st.em - (st.h + 4 * st.em) * k;
            p.x = p.x0 + p.wobA * Math.sin(2 * Math.PI * p.t / p.wobT + p.phase);
            // alpha 包络：前 12% 淡入至峰值、末 45% 淡出
            p.alpha = k < 0.12 ? p.alphaMax * (k / 0.12) : (k > 0.55 ? p.alphaMax * (1 - k) / 0.45 : p.alphaMax);
            p.scale = 1 - 0.4 * k; // 随生命缩小
            break;
        }
        case 'dust': {
            p.t += dt;
            p.x += p.vx * dt;
            if (p.x > st.w + 2 * st.em) p.x = -2 * st.em;
            else if (p.x < -2 * st.em) p.x = st.w + 2 * st.em;
            p.y = p.y0 + p.bobA * Math.sin(2 * Math.PI * p.t / p.bobT + p.phase);
            p.alpha = p.alphaBase + p.alphaA * Math.sin(2 * Math.PI * p.t / p.alphaT + p.alphaPhase);
            break;
        }
    }
}

// 每帧只更新 transform 与 opacity 属性（不重建节点）；rotate 用角度制（canvas 为弧度）
function applyParticle(st, p) {
    const el = p.el;
    if (!el) return;
    switch (p.kind) {
        case 'leaf': {
            const k = p.size / 48;
            el.setAttribute('transform', `translate(${p.x},${p.y}) rotate(${p.rot * 180 / Math.PI}) scale(${k})`);
            el.setAttribute('opacity', p.alpha);
            break;
        }
        case 'debris': {
            if (!p.active) { el.setAttribute('opacity', '0'); break; }
            el.setAttribute('fill', p.shardIdx === 0 ? 'var(--color-particle)' : 'var(--color-white)');
            const k = p.size / 16;
            el.setAttribute('transform', `translate(${p.x},${p.y}) rotate(${p.rot * 180 / Math.PI}) scale(${k})`);
            el.setAttribute('opacity', p.alpha);
            break;
        }
        case 'flash': {
            if (!p.active) { el.setAttribute('opacity', '0'); break; }
            const k = (p.size * (p.scale || 1)) / 64;
            el.setAttribute('transform', `translate(${p.x},${p.y}) scale(${k})`);
            el.setAttribute('opacity', p.alpha);
            break;
        }
        case 'spark': {
            const k = (p.size * p.scale) / 32;
            el.setAttribute('transform', `translate(${p.x},${p.y}) scale(${k})`);
            el.setAttribute('opacity', p.alpha);
            break;
        }
        case 'dust': {
            const k = p.size / 64;
            el.setAttribute('transform', `translate(${p.x},${p.y}) scale(${k})`);
            el.setAttribute('opacity', p.alpha);
            break;
        }
    }
}

/* ---- 节点构建 ---- */

let uidSeq = 0;

// 径向渐变 defs（闪光/火星/尘土共用构造：白芯或纯色芯 → 主题色 → 透明）
function makeRadialGradient(id, stops) {
    const g = makeEl('radialGradient', { id });
    for (const s of stops) {
        g.appendChild(makeEl('stop', s));
    }
    return g;
}

function buildNode(p, st) {
    switch (p.kind) {
        case 'leaf': {
            const g = makeEl('g', {});
            const body = makeEl('path', { d: LEAF_BODY, fill: 'var(--color-particle)' });
            const stem = makeEl('path', { d: LEAF_STEM, fill: 'none', stroke: 'var(--color-particle)', 'stroke-opacity': 0.8, 'stroke-width': 1.5 });
            const veins = makeEl('path', { d: LEAF_VEINS, fill: 'none', stroke: 'var(--color-white)', 'stroke-opacity': 0.35, 'stroke-width': 1 });
            g.appendChild(body);
            g.appendChild(stem);
            g.appendChild(veins);
            return g;
        }
        case 'debris':
            return makeEl('path', { d: SHARD_PATH, fill: 'var(--color-particle)' });
        case 'flash':
            return makeEl('circle', { r: 32, fill: st.gradients.flash });
        case 'spark':
            return makeEl('circle', { r: 16, fill: st.gradients.spark });
        case 'dust':
            return makeEl('circle', { r: 32, fill: st.gradients.dust });
        default:
            return null; // burst 控制器无节点
    }
}

/* ---- 生命周期（footprint-map.js 同款：模块级 state + root 幂等 + destroyState） ---- */

let state = null;

function destroyState() {
    if (!state) return;
    cancelAnimationFrame(state.rafId);
    if (state.resizeObserver) state.resizeObserver.disconnect();
    if (state.onVisibility) document.removeEventListener('visibilitychange', state.onVisibility);
    if (state.root) state.root.replaceChildren();
    state = null;
}

function start() {
    if (!state || state.running || state.w === 0) return; // w=0：布局未就绪，等 measure 成功后启动
    state.running = true;
    state.lastT = null;
    state.rafId = requestAnimationFrame(frame);
}

function stop() {
    if (!state || !state.running) return;
    state.running = false;
    cancelAnimationFrame(state.rafId);
    state.lastT = null;
}

function frame(t) {
    if (!state || !state.running) return;
    state.rafId = requestAnimationFrame(frame);
    // 后台切回时 dt 钳制，防止长时间挂起后粒子瞬间跳变
    const dt = state.lastT === null ? 0 : Math.min((t - state.lastT) / 1000, 0.05);
    state.lastT = t;
    for (const p of state.particles) {
        stepParticle(state, p, dt);
        applyParticle(state, p);
    }
}

export function initSeriesAmbient() {
    const section = document.querySelector('.series-themed[data-ambient]');
    const svg = section ? section.querySelector('svg.series-ambient') : null;

    // 清理先于早退：导航到非系列页也要释放旧状态（masonry 窗口监听同款约定）
    if (!section || !svg) {
        destroyState();
        return;
    }
    if (state && state.root === svg) return; // 幂等（footprint-map.js 同款）
    destroyState();

    if (prefersReducedMotion()) return; // 粒子跳过

    const builder = THEME_SPECS[section.dataset.ambient];
    if (!builder) return;

    const uid = `series-ambient-${++uidSeq}`;

    state = {
        root: svg,
        theme: section.dataset.ambient,
        w: 0, h: 0,
        em: parseFloat(getComputedStyle(document.documentElement).fontSize) || 16,
        particles: [],
        gradients: {
            flash: `url(#${uid}-flash)`,
            spark: `url(#${uid}-spark)`,
            dust: `url(#${uid}-dust)`,
        },
        rafId: 0, running: false, lastT: null,
        resizeObserver: null, onVisibility: null,
        measureFrames: 0,
        dustTarget: null, // 上次调整后的尘土数量（相等时跳过重建）
    };

    // 渐变 defs：id 带实例序号，避免 SPA 过渡期新旧页面同名 id 串扰
    const defs = makeEl('defs', {});
    defs.appendChild(makeRadialGradient(`${uid}-flash`, [
        { offset: 0, 'stop-color': 'var(--color-white)' },
        { offset: 0.3, 'stop-color': 'var(--color-particle)', 'stop-opacity': 0.45 },
        { offset: 1, 'stop-color': 'var(--color-particle)', 'stop-opacity': 0 },
    ]));
    defs.appendChild(makeRadialGradient(`${uid}-spark`, [
        { offset: 0, 'stop-color': 'var(--color-white)' },
        { offset: 0.25, 'stop-color': 'var(--color-particle)', 'stop-opacity': 0.6 },
        { offset: 1, 'stop-color': 'var(--color-particle)', 'stop-opacity': 0 },
    ]));
    defs.appendChild(makeRadialGradient(`${uid}-dust`, [
        { offset: 0, 'stop-color': 'var(--color-particle)', 'stop-opacity': 0.75 },
        { offset: 0.35, 'stop-color': 'var(--color-particle)', 'stop-opacity': 0.45 },
        { offset: 0.7, 'stop-color': 'var(--color-particle)', 'stop-opacity': 0.18 },
        { offset: 1, 'stop-color': 'var(--color-particle)', 'stop-opacity': 0 },
    ]));
    svg.appendChild(defs);

    // 本 init 的 state 令牌：销毁/重初始化后，残留的 measure/RO 回调对不上令牌即自停
    const myState = state;

    const measure = () => {
        if (!myState || state !== myState) return;
        const w = svg.clientWidth;
        const h = svg.clientHeight;
        if (w === 0 || h === 0) {
            // 布局未就绪：重试 ≤30 帧后放弃（footprint-map.js 同款守卫）
            if (state.measureFrames++ < 30) state.rafId = requestAnimationFrame(measure);
            return;
        }
        state.measureFrames = 0; // 成功即归零（预算按次生效而非终身一次性消耗）
        // 尺寸变化不清屏重建：先更新尺寸，再对既有粒子做保活缩放（时间轴/相位保留）、
        // 尘土数量多退少补——动画连续无跳变（首次构建除外）
        const sizeChanged = state.w !== w || state.h !== h;
        const widthChanged = state.w !== w;
        const oldW = state.w;
        const oldH = state.h;
        state.w = w;
        state.h = h;
        if (sizeChanged) {
            if (oldW > 0) {
                rescaleParticles(state, oldW, oldH);
                // 尘土数量随宽度变化：仅尘土主题执行（其余主题无尘土粒子，
                // 若无条件调用会把目标数量全部补齐，凭空多出雾点）
                if (widthChanged && state.theme === 'dust') adjustDustCount(state);
            } else {
                state.particles = builder(state); // 首次构建（此时 w/h 已更新）
                for (const p of state.particles) {
                    const el = buildNode(p, state);
                    p.el = el;
                    if (el) svg.appendChild(el);
                }
            }
        }
        start();
    };

    // 视口尺寸变化（旋转/断点/桌面窗口调整）：不停帧（保持连续动画），
    // 仅更新尺寸与保活缩放。拖动窗口时 RO 密集触发：rAF 合并为每帧至多一次
    let resizeQueued = false;
    state.resizeObserver = new ResizeObserver(() => {
        if (resizeQueued) return;
        resizeQueued = true;
        requestAnimationFrame(() => {
            resizeQueued = false;
            if (!myState || state !== myState) return;
            measure();
        });
    });
    state.resizeObserver.observe(svg);

    // 切后台停帧、回前台续帧（svg 全视口铺满，不做视口可见性判定）
    state.onVisibility = () => {
        if (document.hidden) stop();
        else start();
    };
    document.addEventListener('visibilitychange', state.onVisibility);

    measure();
}
