/* A World the Size of Grief
 * core.js: stage, main loop, input, camera, math helpers, save data.
 * Everything hangs off one global, G, so the game runs from plain <script> tags
 * (no build step, and it opens straight from the file system).
 */
(function () {
  'use strict';
  const G = (window.G = window.G || {});

  // Logical stage size. Everything is drawn in these units and letterboxed to fit.
  G.W = 1280;
  G.H = 720;
  G.time = 0;
  G.dt = 0;
  G.reducedMotion = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  G.FONT_SERIF = '"IM Fell English", "Iowan Old Style", Georgia, "Times New Roman", serif';
  G.FONT_SANS = '"Alegreya Sans", "Gill Sans", "Segoe UI", system-ui, sans-serif';

  // Palette pulled from the visual direction document.
  G.C = {
    ink: '#131715',
    char: '#1f231f',
    char2: '#2a2e2a',
    bone: '#ede9e2',
    paper: '#e6dfd3',
    tan: '#d6ba93',
    orange: '#b4743a',
    ochre: '#b8842e',
    ochreDark: '#7e5719',
    ochreLight: '#d6a54c',
    oxblood: '#8a2b22',
    oxbloodLight: '#b1432f',
    oxbloodDark: '#541813',
    linen: '#d8d0c0',
    skin: '#d6b394',
    hair: '#1b1614',
    wood: '#4a3a2e',
    woodDark: '#2b211b',
    woodLight: '#7a6450',
    overcast: '#6f6e70',
    warm: '#f0c987'
  };

  // ------------------------------------------------------------------ math
  const M = (G.M = {});
  M.TAU = Math.PI * 2;
  M.clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  M.lerp = (a, b, t) => a + (b - a) * t;
  M.smooth = t => t * t * (3 - 2 * t);
  M.smoothstep = (a, b, v) => M.smooth(M.clamp((v - a) / (b - a), 0, 1));
  M.easeInOut = t => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
  M.easeOut = t => 1 - Math.pow(1 - t, 3);
  M.easeIn = t => t * t * t;
  // Frame-rate independent exponential approach.
  M.damp = (v, target, rate, dt) => target + (v - target) * Math.exp(-rate * dt);
  M.dist = (x1, y1, x2, y2) => Math.hypot(x2 - x1, y2 - y1);
  M.mixColor = function (a, b, t) {
    const pa = M.parseColor(a), pb = M.parseColor(b);
    const r = Math.round(M.lerp(pa[0], pb[0], t));
    const g = Math.round(M.lerp(pa[1], pb[1], t));
    const bl = Math.round(M.lerp(pa[2], pb[2], t));
    return 'rgb(' + r + ',' + g + ',' + bl + ')';
  };
  const colorCache = {};
  M.parseColor = function (c) {
    if (colorCache[c]) return colorCache[c];
    let out = [0, 0, 0];
    if (c[0] === '#') {
      const h = c.length === 4 ? c.slice(1).split('').map(x => x + x).join('') : c.slice(1);
      out = [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
    } else {
      const m = c.match(/[\d.]+/g);
      if (m) out = [+m[0], +m[1], +m[2]];
    }
    colorCache[c] = out;
    return out;
  };
  M.rgba = function (c, a) {
    const p = M.parseColor(c);
    return 'rgba(' + p[0] + ',' + p[1] + ',' + p[2] + ',' + a + ')';
  };

  // Seeded random numbers (mulberry32) so painted layers are stable between visits.
  M.rng = function (seed) {
    let a = (seed >>> 0) || 1;
    const r = function () {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    r.range = (lo, hi) => lo + (hi - lo) * r();
    r.int = (lo, hi) => Math.floor(lo + (hi - lo + 1) * r());
    r.pick = arr => arr[Math.floor(r() * arr.length)];
    r.sign = () => (r() < 0.5 ? -1 : 1);
    return r;
  };

  // Value noise, 1D and 2D, range roughly -1..1.
  const perm = new Uint8Array(512);
  (function () {
    const r = M.rng(7331);
    const p = [];
    for (let i = 0; i < 256; i++) p[i] = i;
    for (let i = 255; i > 0; i--) {
      const j = Math.floor(r() * (i + 1));
      const t = p[i]; p[i] = p[j]; p[j] = t;
    }
    for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
  })();
  const val = i => perm[i & 511] / 127.5 - 1;
  M.noise1 = function (x) {
    const i = Math.floor(x), f = x - i;
    return M.lerp(val(i), val(i + 1), f * f * (3 - 2 * f));
  };
  M.noise2 = function (x, y) {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = x - xi, yf = y - yi;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    const a = val(perm[xi & 255] + yi), b = val(perm[(xi + 1) & 255] + yi);
    const c = val(perm[xi & 255] + yi + 1), d = val(perm[(xi + 1) & 255] + yi + 1);
    return M.lerp(M.lerp(a, b, u), M.lerp(c, d, u), v);
  };
  M.fbm1 = function (x, oct) {
    let s = 0, amp = 0.5, f = 1;
    for (let i = 0; i < (oct || 3); i++) { s += amp * M.noise1(x * f + i * 17.3); f *= 2; amp *= 0.5; }
    return s;
  };
  M.fbm2 = function (x, y, oct) {
    let s = 0, amp = 0.5, f = 1;
    for (let i = 0; i < (oct || 4); i++) { s += amp * M.noise2(x * f + i * 31.7, y * f - i * 11.1); f *= 2; amp *= 0.5; }
    return s;
  };

  // ------------------------------------------------------------------ stage
  // Each frame is drawn upright into an offscreen stage at logical size x k, then placed on
  // the visible canvas: letterboxed, and turned sideways on an upright phone so it fills
  // the screen once the phone is turned (works with rotation lock on, too).
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const stage = document.createElement('canvas');
  const sctx = stage.getContext('2d');
  G.canvas = canvas;
  G.stage = stage;
  G.ctx = sctx;
  G.touch = !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
  G.view = { cw: G.W, ch: G.H, vw: G.W, vh: G.H, dpr: 1, s: 1, k: 1, rot: false, ox: 0, oy: 0 };
  G.RS = 1; // pixel density used for painted offscreen layers
  // Pixel density: capped lower on touch screens, and stepped down if frames run slow.
  G.qualitySteps = [1, 0.8, 0.66];
  G.qualityIndex = 0;

  function resize() {
    const cw = Math.max(1, canvas.clientWidth || window.innerWidth);
    const ch = Math.max(1, canvas.clientHeight || window.innerHeight);
    const base = Math.min(window.devicePixelRatio || 1, G.touch ? 1.5 : 2);
    const dpr = Math.max(Math.min(base, 1), base * G.qualitySteps[G.qualityIndex]);
    const rot = G.touch && ch > cw * 1.1 && cw < 600;
    const vw = rot ? ch : cw, vh = rot ? cw : ch; // the landscape frame the stage fits in
    const s = Math.min(vw / G.W, vh / G.H);
    const k = s * dpr;
    canvas.width = Math.round(cw * dpr);
    canvas.height = Math.round(ch * dpr);
    stage.width = Math.max(1, Math.round(G.W * k));
    stage.height = Math.max(1, Math.round(G.H * k));
    G.view = { cw, ch, vw, vh, dpr, s, k, rot, ox: (vw - G.W * s) / 2, oy: (vh - G.H * s) / 2 };
    G.RS = M.clamp(Math.ceil(k * 4) / 4, 1, 1.5);
    G.portrait = ch > cw * 1.1;
    G.rotated = rot;
  }
  window.addEventListener('resize', resize);
  if (window.ResizeObserver) new ResizeObserver(resize).observe(canvas);
  resize();

  // Release the painted layers a scene owns (iOS Safari caps total canvas memory).
  G.release = function (scene) {
    if (!scene) return;
    for (const key of Object.keys(scene)) {
      const v = scene[key];
      const L = v && (v.c instanceof HTMLCanvasElement ? v : v.L && v.L.c instanceof HTMLCanvasElement ? v.L : null);
      if (L) { L.c.width = 0; L.c.height = 0; }
    }
  };

  // Chapters paint their scenery in steps (see prepareSteps) so it can happen during a title plate.
  G.prepareStep = function (scene) {
    if (!scene || !scene.prepareSteps) return true;
    if (!scene._steps) scene._steps = scene.prepareSteps();
    if (scene._steps.length) scene._steps.shift()();
    return scene._steps.length === 0;
  };
  G.prepareScene = function (scene) {
    while (!G.prepareStep(scene)) { /* paint whatever is left */ }
  };

  // Offscreen canvas in logical units, painted at G.RS density.
  G.layer = function (w, h, rs) {
    const k = rs || G.RS;
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.ceil(w * k));
    c.height = Math.max(1, Math.ceil(h * k));
    const x = c.getContext('2d');
    x.scale(k, k);
    return { c, x, w, h, k };
  };

  // ------------------------------------------------------------------ input
  const input = (G.input = {
    x: G.W / 2, y: G.H / 2,
    down: false, pressed: false, released: false,
    downX: 0, downY: 0, downAt: 0, travel: 0,
    consumed: false,
    keys: {}, hit: {},
    lastDevice: 'pointer'
  });

  function toLogical(e) {
    const r = canvas.getBoundingClientRect();
    const v = G.view;
    const px = e.clientX - r.left, py = e.clientY - r.top;
    // turned stage: its top runs along the screen's right edge
    const vx = v.rot ? py : px, vy = v.rot ? v.cw - px : py;
    return { x: (vx - v.ox) / v.s, y: (vy - v.oy) / v.s };
  }
  canvas.addEventListener('pointerdown', e => {
    if (e.button !== undefined && e.button > 0) return;
    const p = toLogical(e);
    input.x = p.x; input.y = p.y;
    input.down = true; input.pressed = true;
    input.downX = p.x; input.downY = p.y; input.downAt = G.time; input.travel = 0;
    input.lastDevice = 'pointer';
    document.body.classList.remove('keys');
    try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    canvas.focus({ preventScroll: true });
    if (G.audio) G.audio.unlock();
    e.preventDefault();
  });
  canvas.addEventListener('pointermove', e => {
    const p = toLogical(e);
    if (input.down) input.travel += Math.hypot(p.x - input.x, p.y - input.y);
    input.x = p.x; input.y = p.y;
  });
  const up = e => {
    if (!input.down) return;
    const p = toLogical(e);
    input.x = p.x; input.y = p.y;
    input.down = false; input.released = true;
  };
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', up);
  canvas.addEventListener('contextmenu', e => e.preventDefault());
  // iOS starts audio most reliably from a touchend
  canvas.addEventListener('touchend', () => { if (G.audio) G.audio.unlock(); }, { passive: true });

  const KEYMAP = {
    ArrowLeft: 'left', KeyA: 'left',
    ArrowRight: 'right', KeyD: 'right',
    ArrowUp: 'up', KeyW: 'up',
    ArrowDown: 'down', KeyS: 'down',
    KeyE: 'act', Space: 'act', Enter: 'act',
    Escape: 'pause', KeyP: 'pause',
    KeyM: 'mute'
  };
  window.addEventListener('keydown', e => {
    if (e.code === 'Tab') document.body.classList.add('keys');
    const k = KEYMAP[e.code];
    if (!k) return;
    if (!input.keys[k]) input.hit[k] = true;
    input.keys[k] = true;
    input.lastDevice = 'keys';
    if (G.audio) G.audio.unlock();
    e.preventDefault();
  });
  window.addEventListener('keyup', e => {
    const k = KEYMAP[e.code];
    if (k) input.keys[k] = false;
  });
  window.addEventListener('blur', () => { input.keys = {}; input.down = false; });

  input.axis = () => (input.keys.right ? 1 : 0) - (input.keys.left ? 1 : 0);
  // A press counts as a tap only if it barely moved.
  input.isTap = () => input.released && input.travel < 18;
  input.consume = () => { input.pressed = false; input.released = false; input.consumed = true; };

  function endFrameInput() {
    input.pressed = false;
    input.released = false;
    input.consumed = false;
    input.hit = {};
  }

  G.setCursor = function (c) {
    if (G._cursor !== c) { G._cursor = c; canvas.style.cursor = c; }
  };

  // ------------------------------------------------------------------ camera
  // A side-view camera: (x, y) is the world point at the stage centre.
  G.Camera = function () {
    this.x = G.W / 2; this.y = G.H / 2; this.zoom = 1; this.shake = 0;
  };
  G.Camera.prototype.apply = function (c) {
    let sx = 0, sy = 0;
    if (this.shake > 0 && !G.reducedMotion) {
      sx = (Math.random() - 0.5) * this.shake;
      sy = (Math.random() - 0.5) * this.shake;
    }
    c.translate(G.W / 2 + sx, G.H / 2 + sy);
    c.scale(this.zoom, this.zoom);
    c.translate(-this.x, -this.y);
  };
  G.Camera.prototype.toWorld = function (sx, sy) {
    return { x: (sx - G.W / 2) / this.zoom + this.x, y: (sy - G.H / 2) / this.zoom + this.y };
  };
  G.Camera.prototype.toScreen = function (wx, wy) {
    return { x: (wx - this.x) * this.zoom + G.W / 2, y: (wy - this.y) * this.zoom + G.H / 2 };
  };
  // Visible world span in x.
  G.Camera.prototype.left = function () { return this.x - G.W / 2 / this.zoom; };
  G.Camera.prototype.right = function () { return this.x + G.W / 2 / this.zoom; };

  // ------------------------------------------------------------------ save
  const SAVE_KEY = 'a-world-the-size-of-grief/v1';
  G.save = {
    data: { reached: 0, done: false, sound: true },
    load() {
      try {
        const s = window.localStorage.getItem(SAVE_KEY);
        if (s) Object.assign(this.data, JSON.parse(s));
      } catch (e) { /* storage unavailable: play without saving */ }
    },
    write() {
      try { window.localStorage.setItem(SAVE_KEY, JSON.stringify(this.data)); } catch (e) { /* ignore */ }
    }
  };

  // ------------------------------------------------------------------ scenes + loop
  G.scene = null;
  G.paused = false;

  G.setScene = function (scene) {
    const prev = G.scene;
    if (prev && prev.exit) prev.exit();
    G.timers = [];
    G.scene = scene;
    G.setCursor('default');
    if (scene.enter) scene.enter();
    if (prev && prev !== scene) G.release(prev);
  };

  // Game-time delays: they wait while paused and are dropped when the scene changes.
  G.timers = [];
  G.after = function (seconds, fn) {
    G.timers.push({ t: seconds, fn, scene: G.scene });
  };
  function runTimers(dt) {
    if (!G.timers.length) return;
    const due = [];
    for (const tm of G.timers) { tm.t -= dt; if (tm.t <= 0) due.push(tm); }
    G.timers = G.timers.filter(tm => tm.t > 0);
    for (const tm of due) if (tm.scene === G.scene) tm.fn();
  }

  // Snapshot of the stage as it looks right now (used by page-tear transitions).
  G.snapshot = function () {
    const snap = document.createElement('canvas');
    snap.width = stage.width;
    snap.height = stage.height;
    snap.getContext('2d').drawImage(stage, 0, 0);
    return { c: snap, sx: 0, sy: 0, sw: snap.width, sh: snap.height };
  };

  function update(dt) {
    if (G.ui) G.ui.preUpdate(dt); // HUD buttons and pause menu may consume input
    if (!G.paused) runTimers(dt);
    if (!G.paused && G.scene && G.scene.update) G.scene.update(dt);
    if (G.ui) G.ui.update(dt);
    if (G.fx) G.fx.update(dt);
    if (G.audio) G.audio.update(dt);
  }

  function render() {
    const v = G.view;
    // 1. the stage, upright, in logical units
    sctx.setTransform(v.k, 0, 0, v.k, 0, 0);
    sctx.globalAlpha = 1;
    sctx.globalCompositeOperation = 'source-over';
    sctx.fillStyle = '#0e100f';
    sctx.fillRect(0, 0, G.W, G.H);
    if (G.scene && G.scene.draw) {
      sctx.save();
      G.scene.draw(sctx);
      sctx.restore();
    }
    if (G.paint) G.paint.finish(sctx, G.scene);
    if (G.ui) G.ui.draw(sctx);
    if (G.fx) G.fx.draw(sctx);
    // 2. onto the screen: fill the letterbox, place the stage
    if (v.rot) ctx.setTransform(0, v.dpr, -v.dpr, 0, v.cw * v.dpr, 0);
    else ctx.setTransform(v.dpr, 0, 0, v.dpr, 0, 0);
    ctx.fillStyle = '#0e100f';
    const sw = G.W * v.s, sh = G.H * v.s;
    if (v.ox > 0) { ctx.fillRect(0, 0, v.ox + 1, v.vh); ctx.fillRect(v.ox + sw - 1, 0, v.vw - v.ox - sw + 1, v.vh); }
    if (v.oy > 0) { ctx.fillRect(0, 0, v.vw, v.oy + 1); ctx.fillRect(0, v.oy + sh - 1, v.vw, v.vh - v.oy - sh + 1); }
    ctx.drawImage(stage, v.ox, v.oy, sw, sh);
    if (v.rot && G.ui && G.ui.drawTurnNote) {
      ctx.setTransform(v.dpr, 0, 0, v.dpr, 0, 0);
      G.ui.drawTurnNote(ctx, v);
    }
  }

  // Step the pixel density down if frames stay slow (checked every few seconds).
  const recent = [];
  let checkAt = 4;
  function watchFrames(dt) {
    recent.push(dt);
    if (recent.length > 90) recent.shift();
    if (G.time < checkAt || recent.length < 90 || document.hidden) return;
    checkAt = G.time + 3;
    const median = recent.slice().sort((a, b) => a - b)[45];
    const base = Math.min(window.devicePixelRatio || 1, G.touch ? 1.5 : 2);
    const next = G.qualityIndex + 1;
    if (median > 0.026 && next < G.qualitySteps.length && base * G.qualitySteps[G.qualityIndex] > 1.01) {
      G.qualityIndex = next;
      recent.length = 0;
      resize();
    }
  }

  let last = 0;
  function frame(now) {
    let dt = last ? (now - last) / 1000 : 1 / 60;
    last = now;
    if (dt > 0.1) dt = 0.1;
    G.dt = dt;
    G.time += dt;
    try {
      update(dt);
      render();
      watchFrames(dt);
    } catch (err) {
      console.error(err);
    }
    endFrameInput();
    requestAnimationFrame(frame);
  }
  G.startLoop = function () { requestAnimationFrame(frame); };
})();
