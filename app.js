/* =========================================================
   星光圣诞树 · 手势互动
   摄像头 + MediaPipe Hands：
     ✊ 握拳   → 点点星光汇聚成圣诞树
     ✋ 张开手掌 → 星光四散如雪
   ========================================================= */

const $ = (s) => document.querySelector(s);

const canvas = $('#scene');
const ctx = canvas.getContext('2d', { alpha: true });
const bgCanvas = $('#bg');
const bgCtx = bgCanvas.getContext('2d', { alpha: false });
const video = $('#cam');
const statusEl = $('#status');
const statusTxt = statusEl.querySelector('span');
const startBtn = $('#startBtn');
const toastEl = $('#toast');

const Q = new URLSearchParams(location.search);
const DEMO = Q.get('demo'); // tree | scatter —— 不开摄像头也能直接预览

const TAU = Math.PI * 2;
const rand = (a = 0, b = 1) => a + Math.random() * (b - a);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const smooth = (e0, e1, x) => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};

/* ---------------- 配色 ---------------- */
const PAL = [
  { c: '#fff3d6', w: 0.30 }, // 暖白
  { c: '#ffcd6e', w: 0.30 }, // 金
  { c: '#ffa233', w: 0.15 }, // 琥珀
  { c: '#8cffa8', w: 0.08 }, // 彩灯绿
  { c: '#ff5f5f', w: 0.08 }, // 彩灯红
  { c: '#8fd6ff', w: 0.06 }, // 冰蓝
  { c: '#ff8fd6', w: 0.03 }, // 粉
];

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function makeSprite(hex) {
  const SZ = 64;
  const cv = document.createElement('canvas');
  cv.width = cv.height = SZ;
  const g = cv.getContext('2d');
  const [r, gg, b] = hexToRgb(hex);
  const grd = g.createRadialGradient(SZ / 2, SZ / 2, 0, SZ / 2, SZ / 2, SZ / 2);
  grd.addColorStop(0, 'rgba(255,255,255,0.98)');
  grd.addColorStop(0.16, `rgba(${r},${gg},${b},0.92)`);
  grd.addColorStop(0.38, `rgba(${r},${gg},${b},0.36)`);
  grd.addColorStop(0.7, `rgba(${r},${gg},${b},0.08)`);
  grd.addColorStop(1, `rgba(${r},${gg},${b},0)`);
  g.fillStyle = grd;
  g.beginPath();
  g.arc(SZ / 2, SZ / 2, SZ / 2, 0, TAU);
  g.fill();
  return cv;
}

const SPRITE = PAL.map((p) => makeSprite(p.c));
const SPRITE_DUST = makeSprite('#cfe3ff');
const SPRITE_SNOW = makeSprite('#eef5ff');

function pickColor() {
  let r = Math.random(), acc = 0;
  for (let i = 0; i < PAL.length; i++) {
    acc += PAL[i].w;
    if (r <= acc) return i;
  }
  return 0;
}

/* ---------------- 全局状态 ---------------- */
const S = {
  W: 0, H: 0, dpr: 1,
  u: 700,            // 树高（像素），所有归一化坐标的基准
  cx: 0, cy: 0,
  t: 0,
  mode: 'intro',     // intro | tree | scatter
  modeAt: 0,
  rotY: 0, rotX: 0,
  targetRotY: 0, targetRotX: 0,
  hand: { present: false },
  gesture: 'none',
  gestureHits: 0,
  palmGlow: 0,
  palmX: 0, palmY: 0,
  camera: false,
  demo: DEMO,
  shock: null,
  starA: 0,
};

const MOBILE = matchMedia('(max-width: 820px)').matches || /Mobi|Android/i.test(navigator.userAgent);
const COUNT = MOBILE ? 2200 : 4200;
const DUST = MOBILE ? 90 : 170;
const SNOW_N = MOBILE ? 80 : 180;

const CFG = { radius: 0.40, height: 1.0 };

const P = []; // 星光粒子
const D = []; // 背景浮尘
const SNOW = []; // 飘雪
const STARS = []; // 远景星点

/* ---------------- 建树 ---------------- */
function buildTree() {
  P.length = 0;

  for (let i = 0; i < COUNT; i++) {
    const isTrunk = i < COUNT * 0.022;
    const ornament = !isTrunk && Math.random() < 0.17;

    let hx, hy, hz, sz, ci;

    if (isTrunk) {
      const a = rand(0, TAU);
      const rr = 0.032 * Math.sqrt(Math.random());
      hx = Math.cos(a) * rr;
      hz = Math.sin(a) * rr;
      hy = rand(0.45, 0.52);
      sz = rand(0.007, 0.012);
      ci = 2;
    } else {
      // y01：0 = 树尖，1 = 树底（底部更密）
      const y01 = Math.pow(Math.random(), 0.55);
      // 枝条起伏，让轮廓像真的冷杉而不是光滑圆锥
      const ripple = 1 + 0.045 * Math.sin(y01 * TAU * 8.5 + 0.6);
      // 大部分点贴在树冠表面，少量填在内部
      const shell = 0.80 + 0.20 * Math.pow(Math.random(), 0.35);
      let rr = CFG.radius * Math.pow(y01, 0.88) * ripple * shell;
      let th;

      if (ornament) {
        // 彩灯沿着螺旋灯串缠绕
        th = y01 * TAU * 6 + rand(-0.06, 0.06);
        rr = CFG.radius * Math.pow(y01, 0.88) * ripple;
      } else {
        th = rand(0, TAU);
      }

      hx = Math.cos(th) * rr;
      hz = Math.sin(th) * rr;
      hy = (y01 - 0.5) * CFG.height;

      if (ornament) {
        sz = rand(0.0085, 0.016);
        ci = pickColor();
      } else {
        sz = rand(0.0035, 0.0098);
        const r = Math.random();
        ci = r < 0.50 ? 0 : r < 0.85 ? 1 : 2;
      }

      // 底部枝条更厚实：一部分点直接填满内部，避免出现“空碗”感
      if (y01 > 0.86 && Math.random() < 0.35) {
        const f = Math.sqrt(Math.random());
        hx *= f;
        hz *= f;
      }
    }

    const part = {
      hx, hy, hz,
      x: hx, y: hy, z: hz,
      vx: 0, vy: 0, vz: 0,
      sz,
      ci,
      b: ornament ? rand(0.55, 1.0) : rand(0.26, 0.72),
      ph: rand(0, TAU),
      tw: rand(0.5, 2.3),
      k: rand(0.75, 1.35),
      delay: 0,
      psx: 0, psy: 0,
      flash: 0,
      spr: SPRITE[ci],
      bulb: false,
    };

    // 灯串上每隔一段放一颗大灯泡，才有“彩灯串”的质感
    if (ornament && Math.random() < 0.16) makeBulb(part);

    P.push(part);
  }

  // 开场：从四面八方飘散的位置出发
  for (const p of P) {
    const a = rand(0, TAU);
    const rr = rand(0.85, 1.75);
    p.x = Math.cos(a) * rr;
    p.y = Math.sin(a) * rr * 0.85 + 0.15;
    p.z = rand(-0.9, 0.9);
    p.delay = rand(0.1, 1.7);
  }

  buildDust();
  buildSnow();
  buildStars();
  if (S.demo) presetDemo();
}

/* 远景星点 */
function buildStars() {
  STARS.length = 0;
  const n = MOBILE ? 60 : 120;
  for (let i = 0; i < n; i++) {
    STARS.push({
      x: rand(-1.35, 1.35),
      y: rand(-1.05, 0.28),
      z: rand(-0.4, 0.4),
      sz: rand(0.0014, 0.0044),
      b: rand(0.1, 0.5),
      ph: rand(0, TAU),
      tw: rand(0.3, 1.5),
    });
  }
}

/* 圣诞灯串上的大灯泡：用彩色灯，别让它们变成一团白光 */
function makeBulb(p, part) {
  const colored = [3, 4, 2, 5, 6, 1];
  const ci = colored[(Math.random() * colored.length) | 0];
  p.bulb = true;
  p.sz *= 1.3;
  p.ci = ci;
  p.spr = SPRITE[ci];
  p.b = 1;
  p.tw = rand(0.35, 0.9);
}

function buildSnow() {
  SNOW.length = 0;
  for (let i = 0; i < SNOW_N; i++) {
    const z = rand(-0.55, 0.55);
    SNOW.push({
      x: rand(-1.15, 1.15),
      y: rand(-0.9, 0.9),
      z,
      vy: rand(0.05, 0.13) * (0.85 + z * 0.55),
      sway: rand(0.12, 0.45),
      ph: rand(0, TAU),
      sz: rand(0.0035, 0.011) * (0.85 + z * 0.5),
      b: rand(0.16, 0.55),
    });
  }
}

function buildDust() {
  D.length = 0;
  for (let i = 0; i < DUST; i++) {
    D.push({
      x: rand(-0.9, 0.9),
      y: rand(-0.6, 0.6),
      z: rand(-0.8, 0.8),
      vx: rand(-0.02, 0.02),
      vy: rand(-0.035, -0.008),
      sz: rand(0.004, 0.011),
      b: rand(0.12, 0.45),
      ph: rand(0, TAU),
    });
  }
}

/* ---------------- 尺寸 ---------------- */
function resize() {
  const w = innerWidth, h = innerHeight;
  S.W = w;
  S.H = h;

  // 高分屏上别傻乎乎地按 2x 渲染：像素数按面积封顶，帧率优先
  const maxPx = MOBILE ? 4.0e6 : 3.2e6;
  const areaCap = Math.sqrt(maxPx / Math.max(w * h, 1));
  S.dpr = Math.max(1, Math.min(devicePixelRatio || 1, MOBILE ? 2 : 1.8, areaCap));

  canvas.width = Math.round(w * S.dpr);
  canvas.height = Math.round(h * S.dpr);
  ctx.setTransform(S.dpr, 0, 0, S.dpr, 0, 0);

  S.u = Math.min(h * 0.58, w * 0.98);
  S.cx = w / 2;
  S.cy = h * 0.415;

  // 背景画布：故意做小再拉伸，等于自带廉价模糊
  bgCanvas.width = 300;
  bgCanvas.height = Math.round((300 * h) / w);

  // 光晕画布的宽高比跟窗口一致（拉伸后不变形）
  bgCv.width = 220;
  bgCv.height = Math.max(80, Math.round((220 * h) / w));
  bgAt = -1;
}

/* ---------------- 摄像头背景（降采样 + 模糊，比 CSS 实时模糊便宜） ---------------- */
let bgAcc = 0;
function updateBg(dt) {
  if (!S.camera || video.readyState < 2) return;
  bgAcc += dt;
  if (bgAcc < 1 / 15) return;
  bgAcc = 0;

  const w = bgCanvas.width, h = bgCanvas.height;
  const vw = video.videoWidth || 640;
  const vh = video.videoHeight || 480;
  const scale = Math.max(w / vw, h / vh);
  const dw = vw * scale, dh = vh * scale;

  bgCtx.save();
  bgCtx.filter = 'blur(1.5px) saturate(1.08) brightness(0.5) contrast(1.05)';
  bgCtx.translate(w, 0);
  bgCtx.scale(-1, 1); // 镜像：像照镜子
  bgCtx.drawImage(video, (w - dw) / 2, (h - dh) / 2, dw, dh);
  bgCtx.restore();
  bgCtx.filter = 'none';
}

/* ---------------- 手势 → 状态 ---------------- */
function burst() {
  if (S.mode === 'scatter') return;
  S.mode = 'scatter';
  S.modeAt = S.t;
  S.shock = { t0: S.t, x: S.palmX || S.cx, y: S.palmY || S.cy };

  for (const p of P) {
    const d = Math.hypot(p.x, p.y, p.z * 0.6) || 1e-3;
    const sp = rand(0.45, 1.35);
    p.vx = (p.x / d) * sp * rand(0.7, 1.4) + rand(-0.12, 0.12);
    p.vy = (p.y / d) * sp * rand(0.7, 1.4) - rand(0.04, 0.5);
    p.vz = (p.z / d) * sp * rand(0.5, 1.1);
    p.flash = 1;
  }
}

function converge() {
  if (S.mode === 'tree') return;
  const wasScatter = S.mode === 'scatter';
  S.mode = 'tree';
  S.modeAt = S.t;
  if (wasScatter) {
    for (const p of P) {
      p.vx += rand(-0.15, 0.15);
      p.flash = 0.5;
    }
  }
}

function setGesture(g) {
  if (g === S.gesture) return;
  S.gesture = g;
  if (g === 'open') burst();
  else if (g === 'fist') converge();
}

/* ---------------- 物理 ---------------- */
function step(dt) {
  S.t += dt;
  const t = S.t;

  // 手左右移动 → 树缓慢转动
  S.rotY += (S.targetRotY - S.rotY) * Math.min(1, dt * 3.2);
  S.rotX += (S.targetRotX - S.rotX) * Math.min(1, dt * 3.2);

  const palmWorld = S.hand.present
    ? { x: (S.palmX - S.cx) / S.u, y: (S.palmY - S.cy) / S.u }
    : null;

  for (const p of P) {
    if (p.flash > 0) p.flash = Math.max(0, p.flash - dt * 2.6);

    if (S.mode === 'scatter') {
      const damp = Math.exp(-1.35 * dt);
      p.vx *= damp; p.vy *= damp; p.vz *= damp;
      p.vy += 0.05 * dt; // 缓慢飘落

      // 挥手的风：掌心附近把星光推开
      if (palmWorld) {
        const dx = p.x - palmWorld.x;
        const dy = p.y - palmWorld.y;
        const dist = Math.hypot(dx, dy);
        if (dist < 0.34 && dist > 1e-4) {
          const f = (1 - dist / 0.34) * 2.2 * dt;
          p.vx += (dx / dist) * f;
          p.vy += (dy / dist) * f;
        }
      }

      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;

      // 软边界：飞太远的会被慢慢拉回来，不会全跑丢
      const r = Math.hypot(p.x, p.y, p.z * 0.5);
      if (r > 1.05) {
        const f = (r - 1.05) * 1.1 * dt;
        p.vx -= (p.x / r) * f;
        p.vy -= (p.y / r) * f;
        p.vz -= (p.z / r) * f * 0.6;
      }
    } else {
      // 弹簧回位；intro 阶段按顺序陆续亮起
      const ramp = S.mode === 'intro' ? smooth(p.delay, p.delay + 0.75, t) : 1;
      const k = (S.mode === 'intro' ? 8.5 : 14) * p.k * ramp;
      const damp = Math.exp(-(S.mode === 'intro' ? 2.3 : 5.2) * dt);

      p.vx = (p.vx + (p.hx - p.x) * k * dt) * damp;
      p.vy = (p.vy + (p.hy - p.y) * k * dt) * damp;
      p.vz = (p.vz + (p.hz - p.z) * k * dt) * damp;

      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
    }
  }

  // 开场结束（先握拳直接聚树时，开场计时不会走完，所以要单独判一次 ready）
  if (!S.readyDone && (S.mode !== 'intro' || t > 3.4)) {
    S.readyDone = true;
    document.body.classList.add('ready');
  }
  if (S.mode === 'intro' && t > 3.4) {
    S.mode = 'tree';
    S.modeAt = t;
  }

  // 浮尘
  for (const d of D) {
    d.x += d.vx * dt;
    d.y += d.vy * dt;
    if (d.y < -0.75) { d.y = 0.75; d.x = rand(-0.9, 0.9); }
    if (d.x < -1.0) d.x = 1.0;
    if (d.x > 1.0) d.x = -1.0;
  }

  // 飘雪
  for (const s of SNOW) {
    s.y += s.vy * dt;
    s.x += Math.sin(t * 0.6 + s.ph) * s.sway * dt;
    if (s.y > 1.0) { s.y = -1.0; s.x = rand(-1.15, 1.15); }
    if (s.x > 1.25) s.x = -1.25;
    if (s.x < -1.25) s.x = 1.25;
  }

  // 偶发流星：隔一阵划一颗，左右方向随机
  if (!S.shoot && Math.random() < dt * 0.11) {
    const dir = Math.random() < 0.5 ? 1 : -1;
    S.shoot = {
      t0: t,
      life: rand(0.9, 1.6),
      x: dir > 0 ? rand(-1.0, -0.2) : rand(0.2, 1.0),
      y: rand(-0.55, -0.15),
      vx: dir * rand(0.8, 1.5),
      vy: rand(0.3, 0.6),
      len: rand(0.2, 0.38),
    };
  }
  if (S.shoot && t - S.shoot.t0 > S.shoot.life) S.shoot = null;

  // 没检测到手时缓慢自转
  if (!S.hand.present) {
    S.targetRotY = Math.sin(t * 0.23) * 0.30;
    S.targetRotX = Math.sin(t * 0.17 + 1.1) * 0.05;
  }

  S.palmGlow += ((S.hand.present ? 1 : 0) - S.palmGlow) * Math.min(1, dt * 3);

  // 星星只在“树”形态亮着，散开时一起熄灭
  const starTarget = S.mode === 'scatter' ? 0 : smooth(1.4, 3.2, t);
  S.starA += (starTarget - S.starA) * Math.min(1, dt * 2.4);

  // 手离开画面太久：让树自己长回来，别让屏幕一直空着
  if (S.camera && !S.hand.present) {
    S.noHandSoft = (S.noHandSoft || 0) + dt;
    if (S.noHandSoft > 12 && S.mode === 'scatter') converge();
  } else {
    S.noHandSoft = 0;
  }

  // 状态条定期刷新（没检测到手时也要能反应过来）
  uiAcc += dt;
  if (uiAcc > 0.3) {
    uiAcc = 0;
    updateStatus();
    maybeHintNoHand();
  }
}

let uiAcc = 0;
let camStartAt = 0;
let hintedNoHand = false;

// 开了摄像头却一直看不到手 → 给一条能救命的提示
function maybeHintNoHand() {
  if (!S.camera || !S.modelReady) return;
  if (!camStartAt) camStartAt = S.t;
  if (hintedNoHand) return;
  if (S.hand.present) { hintedNoHand = true; return; }
  if (S.t - camStartAt < 12) return;

  hintedNoHand = true;
  const banner = $('#banner');
  banner.textContent = videoHasFrames()
    ? '没检测到手：把手掌抬到画面中央、离镜头一臂远（约 50cm），别背光 —— 背光时手会变成一团黑影'
    : '摄像头没有画面：检查一下手机的相机权限（设置 → 应用 → 浏览器 → 权限）';
  banner.classList.add('show');
  setTimeout(() => banner.classList.remove('show'), 15000);
}

/* ---------------- 绘制 ---------------- */
/* 背景光晕已经烘进 buildBackground()，这里不再单独画 */
function drawDust(t) {
  const cnv = Math.cos(S.rotY), snv = Math.sin(S.rotY);
  const cnx = Math.cos(S.rotX), snx = Math.sin(S.rotX);

  for (const d of D) {
    const x1 = d.x * cnv + d.z * snv;
    const z1 = -d.x * snv + d.z * cnv;
    const y1 = d.y * cnx - z1 * snx;
    const z2 = d.y * snx + z1 * cnx;
    const persp = 1 / (1 + z2 * 0.5);

    const sx = S.cx + x1 * S.u * persp;
    const sy = S.cy + y1 * S.u * persp;
    const r = d.sz * S.u * persp;
    if (r < 0.4) continue;

    ctx.globalAlpha = d.b * (0.55 + 0.45 * Math.sin(t * 0.9 + d.ph)) * 0.6 * persp;
    ctx.drawImage(SPRITE_DUST, sx - r, sy - r, r * 2, r * 2);
  }
}

function drawParticles(t) {
  const { cx, cy, u } = S;
  const cnv = Math.cos(S.rotY), snv = Math.sin(S.rotY);
  const cnx = Math.cos(S.rotX), snx = Math.sin(S.rotX);
  const scatter = S.mode === 'scatter';

  for (const p of P) {
    const x1 = p.x * cnv + p.z * snv;
    const z1 = -p.x * snv + p.z * cnv;
    const y1 = p.y * cnx - z1 * snx;
    const z2 = p.y * snx + z1 * cnx;

    const persp = 1 / (1 + z2 * 0.55);
    let sx = cx + x1 * u * persp;
    let sy = cy + y1 * u * persp;

    // 树形态下的微微呼吸感
    if (!scatter) {
      sx += Math.sin(t * p.tw * 1.7 + p.ph) * 0.9;
      sy += Math.cos(t * p.tw * 1.3 + p.ph * 1.7) * 0.9;
    }

    let alpha = p.b * (0.62 + 0.38 * Math.sin(t * p.tw + p.ph));
    if (p.flash > 0) alpha = Math.min(1, alpha + p.flash * 0.55);
    alpha *= 0.55 + 0.45 * persp;

    const r = p.sz * u * persp;
    if (alpha <= 0.012 || r < 0.3) { p.psx = sx; p.psy = sy; continue; }

    const dx = sx - p.psx, dy = sy - p.psy;
    const sp = Math.hypot(dx, dy);

    // 快速移动时留一点拖尾（瞬移不画，避免拉出“幻影”）
    if (scatter && sp > 3.5 && sp < 260) {
      for (let i = 3; i >= 1; i--) {
        const f = i / 3;
        ctx.globalAlpha = alpha * 0.22 * (1 - f * 0.55);
        const tr = r * (1 - f * 0.45);
        ctx.drawImage(p.spr, sx - dx * f * 0.9 - tr, sy - dy * f * 0.9 - tr, tr * 2, tr * 2);
      }
    }

    ctx.globalAlpha = alpha;
    ctx.drawImage(p.spr, sx - r, sy - r, r * 2, r * 2);

    // 灯泡加一圈柔光，才有彩灯串的质感
    if (p.bulb && !scatter) {
      ctx.globalAlpha = alpha * 0.22;
      const hr = r * 3.1;
      ctx.drawImage(p.spr, sx - hr, sy - hr, hr * 2, hr * 2);
    }

    p.psx = sx;
    p.psy = sy;
  }
}

function drawStar(t) {
  if (S.starA < 0.01) return;

  const { cx, cy, u } = S;
  const cnx = Math.cos(S.rotX), snx = Math.sin(S.rotX);

  const wy = -CFG.height * 0.5 - 0.006;
  const y1 = wy * cnx;
  const z2 = wy * snx;
  const persp = 1 / (1 + z2 * 0.55);
  const sx = cx;
  const sy = cy + y1 * u * persp;

  const pulse = 0.88 + 0.12 * Math.sin(t * 2.1);
  const R0 = u * 0.030 * persp * pulse;

  ctx.globalAlpha = S.starA;

  // 核心光晕
  const g = ctx.createRadialGradient(sx, sy, 0, sx, sy, R0 * 3.6);
  g.addColorStop(0, 'rgba(255,252,235,0.98)');
  g.addColorStop(0.10, 'rgba(255,232,168,0.65)');
  g.addColorStop(0.34, 'rgba(255,198,105,0.16)');
  g.addColorStop(1, 'rgba(255,175,85,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(sx, sy, R0 * 3.6, 0, TAU);
  ctx.fill();

  // 十字星芒
  ctx.save();
  ctx.translate(sx, sy);
  ctx.rotate(Math.sin(t * 0.35) * 0.16);
  for (let i = 0; i < 4; i++) {
    ctx.rotate(TAU / 4);
    const L = R0 * (i % 2 === 0 ? 5.4 : 3.0);
    const W = R0 * 0.26;
    const lg = ctx.createLinearGradient(0, 0, 0, -L);
    lg.addColorStop(0, 'rgba(255,248,220,0.70)');
    lg.addColorStop(0.30, 'rgba(255,218,145,0.13)');
    lg.addColorStop(1, 'rgba(255,200,120,0)');
    ctx.fillStyle = lg;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(W, -L);
    ctx.lineTo(0, -L * 0.80);
    ctx.lineTo(-W, -L);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();

  // 星核
  const cr = R0 * 1.05;
  ctx.drawImage(SPRITE[0], sx - cr, sy - cr, cr * 2, cr * 2);
  ctx.globalAlpha = 1;
}

function drawShock(t) {
  if (!S.shock) return;
  const age = t - S.shock.t0;
  if (age > 0.85) { S.shock = null; return; }

  const k = age / 0.85;
  const r = S.u * (0.05 + k * 0.95);
  ctx.globalAlpha = (1 - k) * 0.3;

  const g = ctx.createRadialGradient(S.shock.x, S.shock.y, r * 0.82, S.shock.x, S.shock.y, r);
  g.addColorStop(0, 'rgba(255,210,140,0)');
  g.addColorStop(0.72, 'rgba(255,225,170,0.42)');
  g.addColorStop(1, 'rgba(255,200,130,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(S.shock.x, S.shock.y, r, 0, TAU);
  ctx.fill();
  ctx.globalAlpha = 1;
}

function drawPalm() {
  if (S.palmGlow < 0.01) return;
  const g = ctx.createRadialGradient(S.palmX, S.palmY, 0, S.palmX, S.palmY, S.u * 0.16);
  g.addColorStop(0, `rgba(255,225,170,${0.13 * S.palmGlow})`);
  g.addColorStop(0.55, `rgba(255,190,110,${0.05 * S.palmGlow})`);
  g.addColorStop(1, 'rgba(255,180,90,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(S.palmX, S.palmY, S.u * 0.16, 0, TAU);
  ctx.fill();
}

/* 背景层（暖光晕 + 极光 + 地面光）全是慢变的，烘到一张小画布上，
   每帧只做一次拉伸贴图 —— 比每帧画 4 个全屏渐变省太多 */
const bgCv = document.createElement('canvas');
bgCv.width = 220;
bgCv.height = 140;
const bgCx = bgCv.getContext('2d');
let bgAt = -1;

function buildBackground(t) {
  const w = bgCv.width, h = bgCv.height;
  const k = S.W > 0 ? S.u / S.W : 0.4;
  const uu = k * w;
  const cx = w / 2;
  const cy = h * (S.H > 0 ? S.cy / S.H : 0.43);

  bgCx.setTransform(1, 0, 0, 1, 0, 0);
  bgCx.clearRect(0, 0, w, h);
  bgCx.globalCompositeOperation = 'lighter';

  const pulse = 0.92 + 0.08 * Math.sin(t * 1.1);
  let g = bgCx.createRadialGradient(cx, cy + uu * 0.06, 0, cx, cy + uu * 0.06, uu * 0.62 * pulse);
  g.addColorStop(0, 'rgba(255,178,80,0.115)');
  g.addColorStop(0.35, 'rgba(255,150,60,0.05)');
  g.addColorStop(0.72, 'rgba(120,90,200,0.018)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  bgCx.fillStyle = g;
  bgCx.fillRect(0, 0, w, h);

  // 树下的一小片地面辉光
  bgCx.save();
  bgCx.translate(cx, cy + uu * 0.505);
  bgCx.scale(1, 0.17);
  const rg = bgCx.createRadialGradient(0, 0, 0, 0, 0, uu * 0.48);
  rg.addColorStop(0, 'rgba(255,190,110,0.15)');
  rg.addColorStop(0.55, 'rgba(255,160,80,0.07)');
  rg.addColorStop(1, 'rgba(255,150,70,0)');
  bgCx.fillStyle = rg;
  bgCx.beginPath();
  bgCx.arc(0, 0, uu * 0.48, 0, TAU);
  bgCx.fill();
  bgCx.restore();

  bgCx.globalCompositeOperation = 'source-over';
}

function drawSnow(t) {
  const cnv = Math.cos(S.rotY), snv = Math.sin(S.rotY);
  const cnx = Math.cos(S.rotX), snx = Math.sin(S.rotX);

  for (const s of SNOW) {
    const x1 = s.x * cnv + s.z * snv;
    const z1 = -s.x * snv + s.z * cnv;
    const y1 = s.y * cnx - z1 * snx;
    const z2 = s.y * snx + z1 * cnx;
    const persp = 1 / (1 + z2 * 0.6);

    const sx = S.cx + x1 * S.u * persp;
    const sy = S.cy + y1 * S.u * persp;
    const r = s.sz * S.u * persp;
    if (r < 0.35) continue;

    ctx.globalAlpha = s.b * (0.55 + 0.45 * Math.sin(t * 1.2 + s.ph)) * persp;
    ctx.drawImage(SPRITE_SNOW, sx - r, sy - r, r * 2, r * 2);
  }
}

/* 树底一圈缓慢旋转的光环 */
function drawRing(t) {
  const a = S.starA;
  if (a < 0.05) return;

  const { cx, cy, u } = S;
  const cnv = Math.cos(S.rotY), snv = Math.sin(S.rotY);
  const cnx = Math.cos(S.rotX), snx = Math.sin(S.rotX);
  const n = 260;

  for (let i = 0; i < n; i++) {
    const th = (i / n) * TAU + t * 0.22 + (i % 7) * 0.02;
    const rr = 0.465 + 0.014 * Math.sin(t * 1.1 + i * 0.4) + (i % 5) * 0.004;
    const px = Math.cos(th) * rr;
    const pz = Math.sin(th) * rr;

    const x1 = px * cnv + pz * snv;
    const z1 = -px * snv + pz * cnv;
    const y1 = 0.475 * cnx - z1 * snx;
    const z2 = 0.475 * snx + z1 * cnx;
    const persp = 1 / (1 + z2 * 0.55);

    const sx = cx + x1 * u * persp;
    const sy = cy + y1 * u * persp;
    const r = u * 0.0021 * persp;

    ctx.globalAlpha = a * (0.14 + 0.13 * Math.sin(t * 2.2 + i * 0.55)) * (0.45 + 0.55 * persp);
    ctx.drawImage(SPRITE[1], sx - r, sy - r, r * 2, r * 2);
  }
}

function drawStars(t) {
  const cnv = Math.cos(S.rotY), snv = Math.sin(S.rotY);
  const cnx = Math.cos(S.rotX), snx = Math.sin(S.rotX);

  for (const s of STARS) {
    const x1 = s.x * cnv + s.z * snv;
    const z1 = -s.x * snv + s.z * cnv;
    const y1 = s.y * cnx - z1 * snx;
    const z2 = s.y * snx + z1 * cnx;
    const persp = 1 / (1 + z2 * 0.5);

    const sx = S.cx + x1 * S.u * persp;
    const sy = S.cy + y1 * S.u * persp;
    const r = s.sz * S.u * persp;
    if (r < 0.25) continue;

    const tw = Math.sin(t * s.tw + s.ph);
    ctx.globalAlpha = s.b * (0.3 + 0.7 * tw * tw) * persp;
    ctx.drawImage(SPRITE_DUST, sx - r, sy - r, r * 2, r * 2);
  }
}

function drawShoot(t) {
  const s = S.shoot;
  if (!s) return;

  const age = t - s.t0;
  const k = Math.min(1, age / s.life);
  const a = Math.sin(Math.PI * k) * 0.85;

  const sx = S.cx + (s.x + s.vx * age) * S.u;
  const sy = S.cy + (s.y + s.vy * age) * S.u;
  const len = s.len * S.u;
  const ang = Math.atan2(s.vy, s.vx);
  const tx = sx - Math.cos(ang) * len;
  const ty = sy - Math.sin(ang) * len;

  const g = ctx.createLinearGradient(sx, sy, tx, ty);
  g.addColorStop(0, `rgba(255,252,240,${a})`);
  g.addColorStop(0.18, `rgba(255,232,175,${a * 0.6})`);
  g.addColorStop(0.55, `rgba(255,205,135,${a * 0.18})`);
  g.addColorStop(1, 'rgba(255,195,120,0)');
  ctx.strokeStyle = g;
  ctx.lineWidth = Math.max(1.4, S.u * 0.005);
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(sx, sy);
  ctx.lineTo(tx, ty);
  ctx.stroke();

  // 头部亮点 + 一圈光晕
  const glow = S.u * 0.05;
  const hg = ctx.createRadialGradient(sx, sy, 0, sx, sy, glow);
  hg.addColorStop(0, `rgba(255,250,235,${a * 0.5})`);
  hg.addColorStop(1, 'rgba(255,235,200,0)');
  ctx.fillStyle = hg;
  ctx.beginPath();
  ctx.arc(sx, sy, glow, 0, TAU);
  ctx.fill();

  const r = S.u * 0.009;
  ctx.globalAlpha = a;
  ctx.drawImage(SPRITE[0], sx - r, sy - r, r * 2, r * 2);
}

function render() {
  ctx.clearRect(0, 0, S.W, S.H);
  const t = S.t;

  // 1) 先把背景光晕铺上去（加法混色）
  ctx.globalCompositeOperation = 'lighter';
  if (t - bgAt > 0.2) {
    bgAt = t;
    buildBackground(t);
  }
  ctx.drawImage(bgCv, 0, 0, S.W, S.H);

  // 2) 剩下的发光元素
  ctx.globalCompositeOperation = 'lighter';
  drawStars(t);
  drawDust(t);
  drawSnow(t);
  drawParticles(t);
  drawRing(t);
  drawStar(t);
  drawShoot(t);
  drawShock(t);
  drawPalm();
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
}

/* ---------------- 主循环 ---------------- */
let handLandmarker = null;
let stream = null;
let last = performance.now();
let detAcc = 0;
let lastVideoTime = -1;

function frame(now) {
  const dt = clamp((now - last) / 1000, 0.0005, 0.05);
  last = now;
  S.fps = S.fps ? S.fps * 0.9 + (1 / dt) * 0.1 : 1 / dt;

  if (S.camera && handLandmarker) {
    detAcc += dt;
    const vT = video.currentTime;
    // 每 1/16 秒、且视频有新帧时才跑一次识别
    if (detAcc > 1 / 16 && vT !== lastVideoTime) {
      detAcc = 0;
      lastVideoTime = vT;
      detect(now);
    }
  }

  updateBg(dt);
  step(dt);

  const r0 = performance.now();
  render();
  S.msRender = S.msRender ? S.msRender * 0.85 + (performance.now() - r0) * 0.15 : performance.now() - r0;

  drawDebug(dt);
  requestAnimationFrame(frame);
}

/* ---------------- 手势识别 ---------------- */
const VISION_JS = './vendor/vision_bundle.mjs';
const WASM_DIR = './vendor/wasm';
const MODEL = './vendor/models/hand_landmarker.task';

function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/* 送进模型的小画布：固定尺寸比直接喂 <video> 稳，也方便做方向探测 */
const feed = document.createElement('canvas');
feed.width = 480;
feed.height = 360;
const fctx = feed.getContext('2d');
let feedRot = 0;      // 0 | 90 —— 有些安卓前置摄像头是竖屏帧，转一下才认得出手
let rotProbes = 0;
let rotLocked = false;

/* 自动补光：暗环境下模型很吃力，先把送进识别器的画面提亮 */
let bright = 1.15;
const probe = document.createElement('canvas');
probe.width = 32;
probe.height = 24;
const pctx = probe.getContext('2d', { willReadFrequently: true });
let probeAt = 0;

function autoBrightness() {
  if (video.readyState < 2) return;
  try {
    pctx.drawImage(video, 0, 0, 32, 24);
    const d = pctx.getImageData(0, 0, 32, 24).data;
    let sum = 0;
    for (let i = 0; i < d.length; i += 4) sum += d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114;
    const mean = sum / (d.length / 4);
    const want = mean < 55 ? 1.62 : mean < 85 ? 1.38 : mean < 110 ? 1.18 : mean > 175 ? 0.92 : 1.04;
    bright += (want - bright) * 0.4;
    S.luma = Math.round(mean);
  } catch (e) {}
}

/* 手部 ROI 放大：手在画面里只占一小块时，关键点会很飘。
   追踪到手掌后就把这块区域裁出来铺满 480×360，等于免费给模型加了个长焦。
   分辨率不变，算力几乎不变，关键点是实打实更准。 */
const cropCv = document.createElement('canvas');
cropCv.width = feed.width;
cropCv.height = feed.height;
const cctx = cropCv.getContext('2d');

let crop = { x0: 0, y0: 0, w: 1, h: 1 };   // 视频归一化坐标
let cropTarget = null;
let cropMissAt = 0;

function resetCrop() {
  cropTarget = { x0: 0, y0: 0, w: 1, h: 1 };
}

function updateCrop(lm) {
  const vw = video.videoWidth || 640;
  const vh = video.videoHeight || 480;

  let minX = 1, minY = 1, maxX = 0, maxY = 0;
  for (const p of lm) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }

  // 关键点（当前裁剪空间）→ 全画面归一化
  const fcx = crop.x0 + ((minX + maxX) / 2) * crop.w;
  const fcy = crop.y0 + ((minY + maxY) / 2) * crop.h;
  const bwPx = Math.max(maxX - minX, 0.06) * crop.w * vw;
  const bhPx = Math.max(maxY - minY, 0.06) * crop.h * vh;

  // 手掌大约占裁剪区域的 1/3～1/2
  let sizePx = clamp(Math.max(bwPx, bhPx) * 2.4, Math.min(vw, vh) * 0.42, Math.min(vw, vh));
  let cw = sizePx / vw;
  let ch = (sizePx * 0.75) / vh;   // 保持 4:3，跟 feed 一致

  let x0 = clamp(fcx - cw / 2, 0, 1 - cw);
  let y0 = clamp(fcy - ch / 2, 0, 1 - ch);

  cropTarget = { x0, y0, w: Math.min(cw, 1), h: Math.min(ch, 1) };
}

function drawFeed() {
  const w = feed.width, h = feed.height;
  const vw = video.videoWidth || 640;
  const vh = video.videoHeight || 480;

  if (S.t - probeAt > 0.9) {
    probeAt = S.t;
    autoBrightness();
  }

  // 裁剪框平滑跟随，避免画面抖动
  if (cropTarget) {
    const k = 0.22;
    crop.x0 += (cropTarget.x0 - crop.x0) * k;
    crop.y0 += (cropTarget.y0 - crop.y0) * k;
    crop.w += (cropTarget.w - crop.w) * k;
    crop.h += (cropTarget.h - crop.h) * k;
  }

  // 1) 按 ROI 裁剪 + 提亮
  cctx.filter = `brightness(${bright.toFixed(2)}) contrast(1.05)`;
  cctx.drawImage(
    video,
    crop.x0 * vw, crop.y0 * vh, Math.max(crop.w, 0.05) * vw, Math.max(crop.h, 0.05) * vh,
    0, 0, w, h
  );
  cctx.filter = 'none';

  // 2) 可选旋转后送进模型
  fctx.save();
  fctx.fillStyle = '#000';
  fctx.fillRect(0, 0, w, h);
  if (feedRot) {
    fctx.translate(w / 2, h / 2);
    fctx.rotate(Math.PI / 2);
    fctx.drawImage(cropCv, -w / 2, -h / 2);
  } else {
    fctx.drawImage(cropCv, 0, 0);
  }
  fctx.restore();
}

/* ---------- 手势判定：指关节夹角 + 关键点平滑 + 多帧投票 ----------
   不再用"指尖离手腕远近"判断手指伸直 —— 手稍微转向镜头就会误判。
   现在算 PIP/DIP 两个关节的弯曲角度，只跟手的姿态有关，跟手在画面里的位置和角度无关。
*/
const FINGERS = [
  [5, 6, 7, 8],     // 食指
  [9, 10, 11, 12],  // 中指
  [13, 14, 15, 16], // 无名指
  [17, 18, 19, 20], // 小指
];

const vsub = (a, b) => ({ x: b.x - a.x, y: b.y - a.y });

function vang(u, v) {
  const lu = Math.hypot(u.x, u.y);
  const lv = Math.hypot(v.x, v.y);
  if (lu < 1e-6 || lv < 1e-6) return Math.PI;
  return Math.acos(clamp((u.x * v.x + u.y * v.y) / (lu * lv), -1, 1));
}

// 1 = 笔直，0 = 完全蜷起
function straightness(lm, f) {
  const [mcp, pip, dip, tip] = f;
  const a1 = vang(vsub(lm[mcp], lm[pip]), vsub(lm[pip], lm[dip]));
  const a2 = vang(vsub(lm[pip], lm[dip]), vsub(lm[dip], lm[tip]));
  return clamp(1 - (a1 + a2) / Math.PI, 0, 1);
}

function classifyInfo(lm) {
  const wrist = lm[0];
  const palm = Math.max(dist(wrist, lm[9]), 1e-4);

  const st = FINGERS.map((f) => straightness(lm, f));
  const meanSt = (st[0] + st[1] + st[2] + st[3]) / 4;
  const ext = st.filter((s) => s > 0.58).length;

  const spread = dist(lm[8], lm[20]) / palm;      // 食指↔小指张开程度
  const spreadN = clamp((spread - 0.75) / 0.85, 0, 1);
  const thumb = clamp((dist(lm[4], lm[17]) / palm - 0.95) / 0.9, 0, 1); // 拇指张开度

  const openScore = 0.55 * meanSt + 0.25 * spreadN + 0.2 * thumb;
  const fistScore = 0.6 * (1 - meanSt) + 0.25 * (1 - spreadN) + 0.15 * (1 - thumb);

  let g = 'none';
  if (ext >= 4) g = 'open';
  else if (ext === 3 && openScore >= 0.55) g = 'open';
  else if (ext <= 1 && fistScore >= 0.5) g = 'fist';

  return { g, ext, meanSt, spread, openScore, fistScore };
}

function classify(lm) {
  return classifyInfo(lm).g;
}

/* 关键点平滑：手指抖一下不会立刻翻转判定 */
let lmSmooth = null;
function smoothLandmarks(lm, alpha) {
  if (!lmSmooth) {
    lmSmooth = lm.map((p) => ({ x: p.x, y: p.y, z: p.z }));
    return lmSmooth;
  }
  for (let i = 0; i < 21; i++) {
    lmSmooth[i].x += (lm[i].x - lmSmooth[i].x) * alpha;
    lmSmooth[i].y += (lm[i].y - lmSmooth[i].y) * alpha;
    lmSmooth[i].z += (lm[i].z - lmSmooth[i].z) * alpha;
  }
  return lmSmooth;
}

/* 最近 4 帧里 3 帧一致才切换：又稳又快（16Hz 下约 200ms） */
const gHist = [];
function voteGesture(g) {
  gHist.push(g);
  if (gHist.length > 4) gHist.shift();

  let o = 0, f = 0;
  for (const x of gHist) {
    if (x === 'open') o++;
    else if (x === 'fist') f++;
  }
  if (o >= 3 && S.gesture !== 'open') setGesture('open');
  else if (f >= 3 && S.gesture !== 'fist') setGesture('fist');
}

function detect(now) {
  const t0 = performance.now();
  drawFeed();

  let res;
  try {
    res = handLandmarker.detectForVideo(feed, now);
  } catch (e) {
    S.detErr = (S.detErr || 0) + 1;
    return;
  }
  S.detCount = (S.detCount || 0) + 1;
  S.msDet = S.msDet ? S.msDet * 0.85 + (performance.now() - t0) * 0.15 : performance.now() - t0;

  if (res && res.landmarks && res.landmarks.length) {
    const raw = res.landmarks[0];
    const lm = smoothLandmarks(raw, 0.55);

    S.hitCount = (S.hitCount || 0) + 1;
    rotLocked = true; // 已经能认出手了，就别再翻转画面
    cropMissAt = 0;

    // 关键点：裁剪空间 → 全画面（画调试预览、摆放掌心光晕都要用全画面坐标）
    S.lastLm = lm.map((p) => ({
      x: crop.x0 + p.x * crop.w,
      y: crop.y0 + p.y * crop.h,
    }));

    // 把 ROI 跟到手上（转 90° 时不启用，否则坐标会对不上）
    if (!feedRot) updateCrop(lm);

    const fx = crop.x0 + lm[9].x * crop.w;
    const fy = crop.y0 + lm[9].y * crop.h;

    // 画面是镜像的，x 要翻过来
    const px = (1 - fx) * S.W;
    const py = fy * S.H;

    S.hand.present = true;
    S.palmX += (px - S.palmX) * 0.45;
    S.palmY += (py - S.palmY) * 0.45;

    S.targetRotY = (0.5 - fx) * 1.15;
    S.targetRotX = (fy - 0.5) * -0.35;

    const info = classifyInfo(lm);
    S.info = info;
    S.gestureRaw = info.g;
    voteGesture(info.g);
  } else {
    S.hand.present = false;
    S.lastLm = null;
    S.gestureRaw = 'none';
    S.info = null;
    lmSmooth = null;
    gHist.length = 0;

    // 手丢了，ROI 慢慢退回全画面
    if (!cropMissAt) cropMissAt = S.t;
    if (S.t - cropMissAt > 0.8) resetCrop();

    // 一直看不到手：可能手机前置摄像头给的是“躺倒”的帧，转 90° 再试（最多两次）
    if (!rotLocked) {
      if (!S.noHandAt) S.noHandAt = S.t;
      if (rotProbes < 2 && S.t - S.noHandAt > 5) {
        S.noHandAt = S.t;
        rotProbes++;
        feedRot = feedRot ? 0 : 90;
        resetCrop();
      }
    }
  }

  updateStatus();
}

/* ---------------- 调试面板 ---------------- */
const dbgCam = $('#dbgCam');
const dbgCtx = dbgCam.getContext('2d');
const dbgTxt = $('#dbgTxt');
let dbgAcc = 0;

function drawDebug(dt) {
  if (!document.body.classList.contains('debug')) return;
  dbgAcc += dt;
  if (dbgAcc < 1 / 6) return;
  dbgAcc = 0;

  const w = dbgCam.width, h = dbgCam.height;
  dbgCtx.setTransform(1, 0, 0, 1, 0, 0);
  dbgCtx.fillStyle = '#000';
  dbgCtx.fillRect(0, 0, w, h);

  if (video.readyState >= 2 && video.videoWidth) {
    const vw = video.videoWidth, vh = video.videoHeight;
    const sc = Math.max(w / vw, h / vh);
    dbgCtx.save();
    dbgCtx.translate(w, 0);
    dbgCtx.scale(-1, 1);
    dbgCtx.drawImage(video, (w - vw * sc) / 2, (h - vh * sc) / 2, vw * sc, vh * sc);
    dbgCtx.restore();
  }

  if (S.lastLm) {
    dbgCtx.fillStyle = '#ff3b6b';
    for (const p of S.lastLm) {
      dbgCtx.fillRect((1 - p.x) * w - 1.5, p.y * h - 1.5, 3, 3);
    }
  }

  const inf = S.info;
  dbgTxt.textContent = [
    `video ${video.videoWidth}x${video.videoHeight} rs=${video.readyState}`,
    `rot=${feedRot} bright=${bright.toFixed(2)} luma=${S.luma ?? '-'}`,
    `roi=${crop.w.toFixed(2)}x${crop.h.toFixed(2)} @${crop.x0.toFixed(2)},${crop.y0.toFixed(2)}`,
    `t=${video.currentTime.toFixed(1)}s  fps=${Math.round(S.fps || 0)}  render=${(S.msRender || 0).toFixed(1)}ms  det=${(S.msDet || 0).toFixed(1)}ms`,
    `det=${S.detCount || 0} hit=${S.hitCount || 0} err=${S.detErr || 0}`,
    `hand=${S.hand.present ? 'YES' : 'no'} raw=${S.gestureRaw || '-'}`,
    inf ? `ext=${inf.ext}/4 st=${inf.meanSt.toFixed(2)} open=${inf.openScore.toFixed(2)} fist=${inf.fistScore.toFixed(2)}` : 'ext=-',
    `mode=${S.mode}  g=${S.gesture}`,
  ].join('\n');
}

/* ---------------- 状态条 ---------------- */
let statusKey = '';
function setStatus(k) {
  if (statusKey === k) return;
  statusKey = k;

  statusEl.className = 'status';

  if (k === 'open') {
    statusEl.classList.add('on-open');
    statusTxt.textContent = '✋ 手掌张开 · 星光散开';
  } else if (k === 'fist') {
    statusEl.classList.add('on-fist');
    statusTxt.textContent = '✊ 握拳 · 星光聚合';
  } else if (k === 'hand-none') {
    // 看到手了，但手势不够明确 —— 和“完全没看到手”要区分开，还要给点提示
    const inf = S.info;
    statusEl.classList.add('on-fist');
    statusTxt.textContent = inf
      ? `看到手了 · 伸直 ${inf.ext}/4 根，五指再张开或握紧一点`
      : '看到手了 · 请把五指张开或握成拳';
  } else if (k === 'none') {
    statusTxt.textContent = '等待手势 · 把手掌放进画面';
  } else if (k === 'no-cam') {
    statusTxt.textContent = '摄像头无画面 · 检查后台权限';
  } else if (k === 'loading-model') {
    statusTxt.textContent = '正在加载手势模型（首次约 17MB）…';
  } else if (k === 'model-fail') {
    statusEl.classList.add('on-open');
    statusTxt.textContent = '手势模型加载失败 · 点「重试加载模型」';
  } else if (k === 'loading') {
    statusTxt.textContent = '正在启动摄像头…';
  } else if (k === 'demo') {
    statusTxt.textContent = '演示模式 · ' + (S.mode === 'scatter' ? '星光散开' : '星光汇聚');
  } else {
    statusTxt.textContent = k;
  }
}

function updateStatus() {
  if (S.demo) {
    const want = '演示模式 · ' + (S.mode === 'scatter' ? '星光散开' : '星光汇聚');
    if (statusTxt.textContent !== want) {
      statusKey = 'demo';
      statusEl.className = 'status';
      statusTxt.textContent = want;
    }
    return;
  }
  if (!S.camera) return;

  if (S.modelErr) { setStatus('model-fail'); return; }
  if (!videoHasFrames()) { setStatus('no-cam'); return; }
  if (!S.hand.present) { setStatus('none'); return; }
  if (S.gesture === 'open') setStatus('open');
  else if (S.gesture === 'fist') setStatus('fist');
  else setStatus('hand-none');
}

// 视频到底有没有在出新帧
let lastVTime = -1;
let lastVTimeChange = 0;
function videoHasFrames() {
  if (video.currentTime !== lastVTime) {
    lastVTime = video.currentTime;
    lastVTimeChange = performance.now();
  }
  return performance.now() - lastVTimeChange < 1500;
}

/* ---------------- 提示 ---------------- */
const hintEl = $('#hint');
const hintTitle = $('#hintTitle');
const hintBody = $('#hintBody');

function showHint(title, body) {
  hintTitle.textContent = title;
  hintBody.textContent = body;
  hintEl.classList.add('show');
}

function hideHint() {
  hintEl.classList.remove('show');
}

function toast(msg, ms = 5200) {
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => toastEl.classList.remove('show'), ms);
}

/* ---------------- 启动摄像头 ---------------- */
async function start() {
  startBtn.classList.add('gone');
  hideHint();
  setStatus('loading');

  // 手机上顺手进全屏，指头点的那一下正好是允许的手势
  if (MOBILE && document.documentElement.requestFullscreen) {
    try { await document.documentElement.requestFullscreen({ navigationUI: 'hide' }); } catch (e) {}
  }

  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    document.body.classList.add('ready');
    startBtn.classList.remove('gone');
    startBtn.innerHTML = '<span class="dot"></span>重试摄像头';
    showHint(
      '这个地址不能调用摄像头',
      '浏览器只允许 localhost 或 https 的页面开摄像头。请用 http://127.0.0.1:8017/ 打开，不要用 file:// 或局域网 IP。'
    );
    return;
  }

  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'user', width: { ideal: 960 }, height: { ideal: 720 } },
      audio: false,
    });
    video.srcObject = stream;
    await video.play();
    bgCanvas.classList.add('live');
    S.camera = true;
  } catch (e) {
    S.camera = false;
    document.body.classList.add('ready');

    startBtn.classList.remove('gone');
    startBtn.innerHTML = '<span class="dot"></span>重试摄像头';

    const name = e.name || '';
    let title = '摄像头没打开';
    let body = '';

    if (name === 'NotAllowedError' || name === 'SecurityError') {
      title = '摄像头权限被拒绝了';
      body = '点地址栏左边的相机图标 → 选择「始终允许」→ 再点下面的「重试摄像头」。' +
             '如果那里显示的是「已阻止」，改成允许后再刷新页面。';
    } else if (name === 'NotReadableError' || name === 'TrackStartError') {
      title = '摄像头被别的软件占用了';
      body = '关掉正在用摄像头的软件（腾讯会议、OBS、微信视频、相机 App 等），再点「重试摄像头」。';
    } else if (name === 'NotFoundError' || name === 'OverconstrainedError') {
      title = '没找到可用的摄像头';
      body = '检查摄像头是否插好、是否被禁用（设备管理器 → 摄像头）。';
    } else {
      body = '错误信息：' + (e.message || name || String(e));
    }

    showHint(title, body);
    toast('已切到鼠标模式', 4200);
    return;
  }

  try {
    const { HandLandmarker, FilesetResolver } = await import(VISION_JS);
    const fs = await FilesetResolver.forVisionTasks(WASM_DIR);

    const opts = (delegate) => ({
      baseOptions: { modelAssetPath: MODEL, delegate },
      runningMode: 'VIDEO',
      numHands: 1,
      minHandDetectionConfidence: 0.4,
      minHandPresenceConfidence: 0.4,
      minTrackingConfidence: 0.4,
    });

    setStatus('loading-model');

    try {
      handLandmarker = await HandLandmarker.createFromOptions(fs, opts('GPU'));
    } catch (e) {
      handLandmarker = await HandLandmarker.createFromOptions(fs, opts('CPU'));
    }

    S.palmX = S.cx;
    S.palmY = S.cy;
    S.modelErr = null;
    S.modelReady = true;
    setStatus('none');
    toast('握拳 → 星光聚成圣诞树；张开手掌 → 星光散开', 7000);
  } catch (e) {
    console.error(e);
    S.modelErr = (e && (e.message || e.name)) || String(e);

    startBtn.classList.remove('gone');
    startBtn.innerHTML = '<span class="dot"></span>重试加载模型';
    showHint(
      '手势模型没加载成功',
      '模型文件（约 17MB）没下载完整：' + String(S.modelErr).slice(0, 140) +
      '。检查网络后点「重试加载模型」，还不行就刷新页面。'
    );
    setStatus('model-fail');
  }
}

/* ---------------- 无摄像头 / 触屏兜底 ---------------- */
addEventListener('keydown', (e) => {
  if (e.key === 'o' || e.key === 'O') burst();
  if (e.key === 'f' || e.key === 'F') converge();
  if (e.key === 'd' || e.key === 'D') document.body.classList.toggle('debug');
  if (e.key === 'r' || e.key === 'R') {
    feedRot = feedRot ? 0 : 90;
    toast('识别画面方向：' + (feedRot ? '旋转 90°' : '正常'), 3000);
  }
});

// 手指按住 = 散开，松开 = 聚合（有没有摄像头都认，摄像头失灵时这就是救命通道）
canvas.addEventListener('pointerdown', (e) => { e.preventDefault(); burst(); });
addEventListener('pointerup', () => converge());
addEventListener('pointercancel', () => converge());

/* ---------------- 演示模式（截图 / 无摄像头预览） ---------------- */
function presetDemo() {
  document.body.classList.add('demo');
  for (const p of P) { p.x = p.hx; p.y = p.hy; p.z = p.hz; }
  S.mode = 'tree';
  S.t = 4.2;
  document.body.classList.add('ready');
  if (S.demo === 'scatter') {
    setTimeout(() => { burst(); S.modeAt = S.t; }, 40);
  }
}

/* ---------------- 初始化 ---------------- */
resize();
addEventListener('resize', resize);
buildTree();
startBtn.addEventListener('click', start);
if (Q.get('autostart')) setTimeout(start, 400);

// 手机/局域网用 http 打开时，浏览器不给摄像头：提前说明，别让人以为是坏了
if (!window.isSecureContext) {
  const banner = $('#banner');
  banner.textContent = '当前地址不是 https/localhost，浏览器不允许开摄像头 —— 触屏点点也能看效果：按住=星光散开，松开=聚合';
  banner.classList.add('show');
  setTimeout(() => banner.classList.remove('show'), 12000);
}

if (Q.has('debug')) document.body.classList.add('debug');

window.__xmas = S; // 调试用
window.__classify = classify;
window.__classifyInfo = classifyInfo;
window.__updateCrop = updateCrop;
window.__crop = () => ({ ...crop, target: cropTarget });
requestAnimationFrame(frame);
