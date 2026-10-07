// 系列页氛围粒子引擎：canvas 单 rAF 循环 + 离屏 sprite 预渲染（动画期仅 drawImage 变换）。
// 主题由 series/single.html 渲染的 data-ambient 键驱动：
//   falling-leaves——白桦落叶随风飘摆 + 偶发风痕；firecracker——鞭炮爆裂碎屑 + 火星升腾；
//   dust——空气中悬浮的尘土：全视口缓慢漂移、微微沉浮、明暗闪烁。
// SPA 约定（main.js initPageModules 每次换页重入）：先销毁旧状态再初始化（root 幂等）；
// 换页销毁子树时同步 cancel rAF / disconnect observers（footprint-map.js 同款生命周期）。
// 减弱动态：prefers-reduced-motion 跳过粒子（另有 CSS 兜底隐藏 canvas）。
// 颜色取自 CSS 变量 --rgb-particle（各主题在 SCSS 中声明自身粒子配色，不影响页面强调色）；
// 白色火点用 --rgb-white。

import { prefersReducedMotion } from './utils.js';

const rand = (a, b) => a + Math.random() * (b - a);

/* ---- 离屏 sprite 预渲染（2x 绘制保证高 DPI 清晰） ---- */

function makeCanvas(w, h) {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    return c;
}

// 白桦叶：卵形锯齿缘叶身 + 叶柄 + 中脉与侧脉（逻辑尺寸 52×48，叶尖朝右）
function makeLeafSprite(rgb) {
    const c = makeCanvas(104, 96);
    const ctx = c.getContext('2d');
    ctx.scale(2, 2);
    ctx.fillStyle = `rgb(${rgb})`;
    ctx.beginPath();
    ctx.moveTo(10, 25);
    ctx.quadraticCurveTo(14, 16, 18, 17);
    ctx.quadraticCurveTo(22, 18, 24, 13);
    ctx.quadraticCurveTo(28, 10, 32, 11);
    ctx.quadraticCurveTo(36, 12, 38, 15);
    ctx.quadraticCurveTo(42, 20, 46, 24);
    ctx.quadraticCurveTo(41, 29, 37, 30);
    ctx.quadraticCurveTo(33, 32, 31, 37);
    ctx.quadraticCurveTo(27, 40, 23, 38);
    ctx.quadraticCurveTo(17, 35, 13, 34);
    ctx.quadraticCurveTo(9, 30, 10, 25);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = `rgba(${rgb}, 0.8)`;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(10, 25);
    ctx.lineTo(3, 32);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(12, 26);
    ctx.lineTo(42, 24);
    ctx.moveTo(18, 24.5);
    ctx.lineTo(17, 15);
    ctx.moveTo(26, 23.5);
    ctx.lineTo(27, 12);
    ctx.moveTo(34, 23.5);
    ctx.lineTo(35, 13);
    ctx.stroke();
    return c;
}

// 风痕：横向渐变短线（透明 → 主题色 → 透明，逻辑尺寸 100×2）
function makeStreakSprite(rgb) {
    const c = makeCanvas(200, 4);
    const ctx = c.getContext('2d');
    ctx.scale(2, 2);
    const g = ctx.createLinearGradient(0, 0, 100, 0);
    g.addColorStop(0, `rgba(${rgb}, 0)`);
    g.addColorStop(0.5, `rgba(${rgb}, 1)`);
    g.addColorStop(1, `rgba(${rgb}, 0)`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 100, 2);
    return c;
}

// 纸屑：细长小条（鞭炮爆裂碎屑，逻辑尺寸 16×8）
function makeShardSprite(rgb) {
    const c = makeCanvas(32, 16);
    const ctx = c.getContext('2d');
    ctx.scale(2, 2);
    ctx.fillStyle = `rgb(${rgb})`;
    ctx.beginPath();
    ctx.moveTo(1, 4);
    ctx.quadraticCurveTo(2, 1, 8, 1);
    ctx.quadraticCurveTo(14, 1, 15, 4);
    ctx.quadraticCurveTo(14, 7, 8, 7);
    ctx.quadraticCurveTo(2, 7, 1, 4);
    ctx.closePath();
    ctx.fill();
    return c;
}

// 爆裂闪光：白芯 → 主题色 → 透明的径向渐变（逻辑尺寸 64×64）
function makeFlashSprite(rgb) {
    const c = makeCanvas(128, 128);
    const ctx = c.getContext('2d');
    ctx.scale(2, 2);
    const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, 'rgba(255, 255, 255, 1)');
    g.addColorStop(0.3, `rgba(${rgb}, 0.45)`);
    g.addColorStop(1, `rgba(${rgb}, 0)`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 64);
    return c;
}

// 火星：白芯 → 主题色 → 透明的径向渐变（芯更亮、色环更强，逻辑尺寸 32×32）
function makeSparkSprite(rgb) {
    const c = makeCanvas(64, 64);
    const ctx = c.getContext('2d');
    ctx.scale(2, 2);
    const g = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
    g.addColorStop(0, 'rgba(255, 255, 255, 1)');
    g.addColorStop(0.25, `rgba(${rgb}, 0.6)`);
    g.addColorStop(1, `rgba(${rgb}, 0)`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 32, 32);
    return c;
}

// 尘土：柔和的土黄雾点（逻辑尺寸 64×64）
function makeDustSprite(rgb) {
    const c = makeCanvas(128, 128);
    const ctx = c.getContext('2d');
    ctx.scale(2, 2);
    const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, `rgba(${rgb}, 0.75)`);
    g.addColorStop(0.35, `rgba(${rgb}, 0.45)`);
    g.addColorStop(0.7, `rgba(${rgb}, 0.18)`);
    g.addColorStop(1, `rgba(${rgb}, 0)`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 64);
    return c;
}

/* ---- 各主题粒子构建（数组插入顺序即绘制顺序，先入先画） ---- */

// 秋原：4 风痕（间歇漂过）+ 24 白桦落叶（7-12s 全程下落、横摆、旋转）
function buildAutumn(st) {
    const parts = [];
    for (let i = 0; i < 4; i++) {
        parts.push({
            kind: 'streak',
            x: rand(-st.w * 0.5, st.w), y: rand(st.h * 0.1, st.h * 0.85),
            vx: rand(5, 9) * st.em, len: rand(5, 10) * st.em,
            alpha: rand(0.1, 0.2), delay: rand(0, 2.5),
        });
    }
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
function buildFarm(st) {
    const parts = [];
    const count = Math.min(80, Math.max(30, Math.round(st.w / 24))); // 超宽屏封顶，控制每帧成本
    for (let i = 0; i < count; i++) {
        const yFrac = Math.pow(Math.random(), 0.6); // 分布偏向地面
        parts.push({
            kind: 'dust',
            x: rand(0, st.w), y0: st.h * (0.15 + yFrac * 0.75),
            vx: rand(0.15, 0.5) * st.em * (Math.random() < 0.5 ? -1 : 1),
            bobA: rand(0.1, 0.35) * st.em, bobT: rand(5, 10), phase: rand(0, Math.PI * 2),
            t: rand(0, 10),
            alphaBase: rand(0.3, 0.5), alphaA: rand(0.1, 0.16), alphaT: rand(3, 6), alphaPhase: rand(0, Math.PI * 2),
            size: rand(0.5, 1.4) * st.em,
        });
    }
    return parts;
}

const THEME_SPECS = {
    'falling-leaves': buildAutumn,
    'firecracker': buildDragon,
    'dust': buildFarm,
};

/* ---- 粒子更新与绘制 ---- */

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
        case 'streak': {
            if (p.delay > 0) {
                p.delay -= dt;
                break;
            }
            p.x += p.vx * dt;
            if (p.x - p.len > st.w) {
                // 漂出右缘：左侧重生并进入间歇
                p.x = -p.len;
                p.y = rand(st.h * 0.1, st.h * 0.85);
                p.alpha = rand(0.1, 0.2);
                p.delay = rand(1, 3);
            }
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

function drawParticle(ctx, st, p) {
    switch (p.kind) {
        case 'leaf': {
            ctx.save();
            ctx.translate(p.x, p.y);
            ctx.rotate(p.rot);
            ctx.globalAlpha = p.alpha;
            const w = p.size * (52 / 48);
            ctx.drawImage(st.sprites.leaf, -w / 2, -p.size / 2, w, p.size);
            ctx.restore();
            break;
        }
        case 'streak': {
            if (p.delay > 0) break; // 间歇期（visible 可由 delay 推导，不单独存状态）
            ctx.globalAlpha = p.alpha;
            ctx.drawImage(st.sprites.streak, p.x, p.y, p.len, 2);
            break;
        }
        case 'debris': {
            if (!p.active) break;
            ctx.save();
            ctx.translate(p.x, p.y);
            ctx.rotate(p.rot);
            ctx.globalAlpha = p.alpha;
            const h = p.size * 0.5;
            ctx.drawImage(st.sprites.shards[p.shardIdx], -p.size / 2, -h / 2, p.size, h);
            ctx.restore();
            break;
        }
        case 'flash': {
            if (!p.active) break;
            const s = p.size * (p.scale || 1);
            ctx.globalAlpha = p.alpha;
            ctx.drawImage(st.sprites.flash, p.x - s / 2, p.y - s / 2, s, s);
            break;
        }
        case 'spark': {
            // 无旋转：直接绘制，避免 save/restore 的全状态克隆
            ctx.globalAlpha = p.alpha;
            const s = p.size * p.scale;
            ctx.drawImage(st.sprites.spark, p.x - s / 2, p.y - s / 2, s, s);
            break;
        }
        case 'dust': {
            ctx.globalAlpha = p.alpha;
            ctx.drawImage(st.sprites.dust, p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
            break;
        }
    }
}

/* ---- 生命周期（footprint-map.js 同款：模块级 state + root 幂等 + destroyState） ---- */

let state = null;

function destroyState() {
    if (!state) return;
    cancelAnimationFrame(state.rafId);
    if (state.resizeObserver) state.resizeObserver.disconnect();
    if (state.onVisibility) document.removeEventListener('visibilitychange', state.onVisibility);
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
    const ctx = state.ctx;
    ctx.clearRect(0, 0, state.w, state.h);
    for (const p of state.particles) {
        stepParticle(state, p, dt);
        drawParticle(ctx, state, p);
    }
}

export function initSeriesAmbient() {
    const section = document.querySelector('.series-themed[data-ambient]');
    const canvas = section ? section.querySelector('canvas.series-canvas') : null;

    // 清理先于早退：导航到非系列页也要释放旧状态（infinite-scroll.js 同款约定）
    if (!section || !canvas) {
        destroyState();
        return;
    }
    if (state && state.root === canvas) return; // 幂等（footprint-map.js 同款）
    destroyState();

    if (prefersReducedMotion()) return; // 粒子跳过

    const builder = THEME_SPECS[section.dataset.ambient];
    if (!builder) return;

    const css = getComputedStyle(section);
    const rgbWhite = (css.getPropertyValue('--rgb-white') || '').trim() || '255, 255, 255';
    // 粒子配色：读各主题块声明的 --rgb-particle，缺省回退柔白
    const rgbParticle = (css.getPropertyValue('--rgb-particle') || '').trim() || rgbWhite;

    state = {
        root: canvas,
        ctx: canvas.getContext('2d'), w: 0, h: 0,
        em: parseFloat(getComputedStyle(document.documentElement).fontSize) || 16,
        particles: [],
        sprites: {
            leaf: makeLeafSprite(rgbParticle),
            streak: makeStreakSprite(rgbParticle),
            shards: [makeShardSprite(rgbParticle), makeShardSprite(rgbWhite)],
            flash: makeFlashSprite(rgbParticle),
            spark: makeSparkSprite(rgbParticle),
            dust: makeDustSprite(rgbParticle),
        },
        rafId: 0, running: false, lastT: null,
        resizeObserver: null, onVisibility: null,
        measureFrames: 0,
    };

    // 本 init 的 state 令牌：销毁/重初始化后，残留的 measure/RO 回调对不上令牌即自停
    const myState = state;

    const measure = () => {
        if (!myState || state !== myState) return;
        const w = canvas.clientWidth;
        const h = canvas.clientHeight;
        if (w === 0 || h === 0) {
            // 布局未就绪：重试 ≤30 帧后放弃（footprint-map.js 同款守卫）
            if (state.measureFrames++ < 30) state.rafId = requestAnimationFrame(measure);
            return;
        }
        state.measureFrames = 0; // 成功即归零（预算按次生效而非终身一次性消耗）
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const bw = Math.round(w * dpr);
        const bh = Math.round(h * dpr);
        if (canvas.width !== bw || canvas.height !== bh) {
            canvas.width = bw;
            canvas.height = bh;
            state.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        }
        // 仅宽度变化才重建粒子（移动端地址栏伸缩只改高度——重建会让粒子位置/相位
        // 全部重置、画面瞬间跳变；高度变化只更新尺寸，运动参数在 step 中实时适配）。
        // 注意先更新尺寸再构建——builder 从 state 读取 w/h，旧值会让粒子全挤在 x=0 边缘
        const widthChanged = state.w !== w;
        state.w = w;
        state.h = h;
        if (widthChanged) state.particles = builder(state);
        start();
    };

    // 视口尺寸变化（旋转/断点/桌面窗口调整）：停帧 → 重建尺寸与粒子。
    // 拖动窗口时 RO 密集触发：rAF 合并为每帧至多一次重建，防每帧重建全粒子
    let resizeQueued = false;
    state.resizeObserver = new ResizeObserver(() => {
        if (resizeQueued) return;
        resizeQueued = true;
        requestAnimationFrame(() => {
            resizeQueued = false;
            if (!myState || state !== myState) return;
            stop();
            measure();
        });
    });
    state.resizeObserver.observe(canvas);

    // 切后台停帧、回前台续帧（canvas 全视口铺满，不做视口可见性判定）
    state.onVisibility = () => {
        if (document.hidden) stop();
        else start();
    };
    document.addEventListener('visibilitychange', state.onVisibility);
}
