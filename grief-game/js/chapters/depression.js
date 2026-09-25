/* Chapter 04 / Depression: "The world is large and hard to reach."
 * A low horizon, deep negative space, damp wood and one small living detail.
 * Play: follow the boardwalk, pause and notice what survives close by.
 */
(function () {
  'use strict';
  const G = window.G, M = G.M, C = G.C, P = G.paint;
  const TAU = M.TAU;
  const ZOOM = 0.4, CLOSE = 0.58, DECK = 450, HORIZON = 432, HERO = 300, LIFE_SCALE = 1.6;
  const LIVES = {
    moth: 'A moth, waiting out the rain.',
    snail: 'A snail, taking its time.',
    light: 'A patch of light on the boards. It won’t last. It’s here now.',
    puddle: 'Sky in a puddle. Lighter than it looks up there.',
    moss: 'Moss, greening between the boards.',
    bird: 'A small bird. It doesn’t mind me.'
  };

  // ------------------------------------------------------------ boardwalk (deterministic)
  function plankAt(i) {
    const r = M.rng(i * 7919 + 13);
    return { missing: i > 30 && r() < 0.05, dy: r.range(-2.5, 2.5), shade: r.range(0, 1), w: 25 + r.range(-2, 2) };
  }
  const PLANK = 29;
  function postAt(i) {
    const r = M.rng(i * 104729 + 7);
    return { x: 420 + i * 230 + r.range(-30, 30), h: r.range(40, 130), lean: r.range(-0.06, 0.06) };
  }

  function paintShore() {
    const L = G.layer(G.W, 120, Math.min(G.RS, 1.5));
    const x = L.x;
    const r = M.rng(404);
    const base = 100;
    x.fillStyle = 'rgba(58,59,64,0.85)';
    x.beginPath();
    x.moveTo(0, base);
    for (let px = 0; px <= G.W; px += 8) {
      const h = 6 + M.fbm1(px / 90) * 10 + (px > 700 ? 14 : 4) + (r() < 0.2 ? r.range(4, 12) : 0);
      x.lineTo(px, base - h);
    }
    x.lineTo(G.W, base);
    x.fill();
    // houses on the far shore, a few lit
    const houses = [[760, 16], [820, 12], [1010, 18], [1090, 14], [1180, 20], [300, 10]];
    for (const [hx, hw] of houses) {
      x.fillStyle = '#3a3b40';
      x.fillRect(hx - hw, base - 22, hw * 2, 14);
      x.beginPath();
      x.moveTo(hx - hw - 3, base - 22);
      x.lineTo(hx, base - 34);
      x.lineTo(hx + hw + 3, base - 22);
      x.fill();
      if (r() < 0.8) {
        x.fillStyle = '#f0c987';
        x.fillRect(hx - 4 + r.range(-4, 4), base - 18, 3, 3);
      }
    }
    return L;
  }

  // A band of reeds that tiles every `period` px (drawn twice when scrolling).
  function paintReeds(period, seed, o) {
    const L = G.layer(period + G.W, G.H, Math.min(G.RS, 1.5));
    L.period = period;
    const x = L.x;
    const r = M.rng(seed);
    x.lineCap = 'round';
    let cx = r.range(0, 200);
    while (cx < period) {
      const n = r.int(6, 16);
      const by = o.base + r.range(-10, 20);
      for (let i = 0; i < n; i++) {
       const jx = r.range(-26, 26), h = r.range(o.h[0], o.h[1]), bend = r.range(-18, 18);
       const col = r.pick(o.cols), lw = r.range(o.lw[0], o.lw[1]), cat = r() < 0.25;
       for (const rep of [0, period]) {
        if (rep && cx > G.W + 40) continue;
        const px = cx + rep + jx;
        x.strokeStyle = col;
        x.lineWidth = lw;
        x.beginPath();
        x.moveTo(px, by);
        x.quadraticCurveTo(px + bend * 0.3, by - h * 0.6, px + bend, by - h);
        x.stroke();
        if (cat) {
          x.fillStyle = '#4a3a2a';
          x.beginPath();
          x.ellipse(px + bend * 0.85, by - h * 0.85, 2.5 * o.lw[1], 7 * o.lw[1], bend * 0.02, 0, TAU);
          x.fill();
        }
       }
      }
      cx += r.range(o.gap[0], o.gap[1]);
    }
    return L;
  }

  function paintPorch() {
    const k = M.clamp(CLOSE * G.RS, 0.6, 1.5);
    const L = G.layer(640, 700, k);
    const x = L.x;
    const r = M.rng(41);
    const oy = 220; // local y of world 0
    const Y = wy => wy + oy;
    // back wall of weathered boards
    x.fillStyle = '#4b4541';
    x.fillRect(20, Y(DECK - 330), 120, 330);
    x.strokeStyle = 'rgba(0,0,0,0.35)';
    for (let i = 0; i < 6; i++) {
      x.beginPath();
      x.moveTo(20 + i * 20, Y(DECK - 330));
      x.lineTo(20 + i * 20, Y(DECK));
      x.stroke();
    }
    x.fillStyle = 'rgba(200,190,175,0.18)';
    x.fillRect(20, Y(DECK - 330), 120, 330);
    // posts
    x.fillStyle = '#2f2926';
    for (const px of [140, 470]) {
      x.fillRect(px - 9, Y(DECK - 370), 18, 390);
      x.fillStyle = 'rgba(255,240,220,0.08)';
      x.fillRect(px - 9, Y(DECK - 370), 4, 390);
      x.fillStyle = '#2f2926';
    }
    // brace
    x.strokeStyle = '#2f2926';
    x.lineWidth = 10;
    x.beginPath();
    x.moveTo(140, Y(DECK - 250));
    x.lineTo(240, Y(DECK - 360));
    x.stroke();
    // broken roof: planks with a torn edge
    x.fillStyle = '#272220';
    x.beginPath();
    x.moveTo(0, Y(DECK - 420));
    x.lineTo(560, Y(DECK - 385));
    for (let i = 0; i < 12; i++) x.lineTo(560 - i * 12 + r.range(-10, 10), Y(DECK - 385 + i * 4 + r.range(0, 22)));
    x.lineTo(0, Y(DECK - 350));
    x.closePath();
    x.fill();
    x.strokeStyle = 'rgba(160,150,140,0.25)';
    x.lineWidth = 1.5;
    for (let i = 0; i < 9; i++) {
      x.beginPath();
      x.moveTo(i * 60, Y(DECK - 420 + i * 3.5));
      x.lineTo(i * 60 + 10, Y(DECK - 350 + i * 2));
      x.stroke();
    }
    // hanging drips
    x.strokeStyle = 'rgba(200,205,210,0.4)';
    for (let i = 0; i < 6; i++) {
      const dx = r.range(60, 520);
      x.beginPath();
      x.moveTo(dx, Y(DECK - 380 + dx * 0.06));
      x.lineTo(dx, Y(DECK - 370 + dx * 0.06));
      x.stroke();
    }
    P.texturize(L, 0.3);
    return { L, oy };
  }

  // ------------------------------------------------------------ scene
  function Depression(o) {
    o = o || {};
    G.SideScene.call(this, {
      zoom: ZOOM, camY: 0, minX: 180, maxX: 1e7, startX: 330, speed: 95, heroScale: HERO,
      loose: 0.5, bow: 0.28, camLead: 260, surface: 'wet', glintRange: 700, groundY: DECK
    });
    this.revisit = !!o.revisit;
    this.finish = { vignette: 0.85, grain: 0.75, frame: 'torn' };
    this.lives = [];
    this.noticed = 0;
    this.still = 0;
    this.walked = 0;
    this.hinted = 0;
    this.warmth = this.revisit ? 0.5 : 0;
    this.beam = 0;
    this.ending = null;
    this.order = ['moth', 'light', 'snail', 'bird', 'puddle', 'moss'];
    const r = M.rng(9);
    for (let i = this.order.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); const tmp = this.order[i]; this.order[i] = this.order[j]; this.order[j] = tmp; }
    this.ripples = [];
    this.saidFar = false;
  }
  Depression.prototype = Object.create(G.SideScene.prototype);
  G.chapters.Depression = Depression;

  Depression.prototype.ground = function (x) {
    if (x < 420) return DECK;
    const p = plankAt(Math.floor(x / PLANK));
    return DECK + p.dy * 0.5;
  };

  // Scenery, painted ahead of time (during the chapter plate) when possible.
  Depression.prototype.prepareSteps = function () {
    return [
      () => {
        this.sky = P.paintSky(G.W + 400, HORIZON + 10, {
          top: '#5e5f64', bottom: '#a6a09b', light: '#d8d0c6', shadow: '#55565c', seed: 44, clouds: 30, scale: 1.4, maxY: 0.85,
          bright: { x: 820, y: 170, r: 380, color: '#e4dbcf', alpha: 0.45 }, strokes: 260
        });
      },
      () => {
        this.water = P.paintWater(G.W, G.H - HORIZON, { top: '#6f7076', bottom: '#3d3c3f', sky: '#b4aaa3', seed: 5, streaks: 700 });
        this.shore = paintShore();
      },
      () => { this.reedsMid = paintReeds(3000, 21, { base: 520, h: [30, 90], cols: ['#3a3430', '#4a4038', '#2f2b28'], lw: [1, 2], gap: [80, 260] }); },
      () => { this.reedsFg = paintReeds(4000, 33, { base: 740, h: [80, 190], cols: ['#1d1a18', '#26211d', '#151312'], lw: [2, 4], gap: [220, 520] }); },
      () => { this.porch = paintPorch(); }
    ];
  };

  Depression.prototype.enter = function () {
    G.prepareScene(this);
    this.camMinX = G.W / 2 / ZOOM - 20;
    this.rain = new P.Rain(150, 12);
    this.item({ id: 'chair', x: 150, y: DECK - 170, w: 150, h: 170, at: 330, face: -1, say: ['Their chair, facing the water.', 'I don’t sit in it.'] });
    this.snapCamera();
    G.audio.scene({ rain: 0.9, water: 0.8, wind: 0.15, drone: [45, 52, 57], droneLevel: 0.18 });
    if (this.revisit) {
      ['moth', 'light', 'bird'].forEach((k, i) => this.spawn(k, 900 + i * 520, true));
      this.spawn('flower', 2600, true);
      G.ui.say('Lighter, today.', { delay: 0.8 });
    } else {
      G.ui.say('The boardwalk goes on. The far shore doesn’t come any closer.', { delay: 1.0 });
    }
  };

  Depression.prototype.spawn = function (kind, wx, instant) {
    const r = Math.random;
    const life = { kind, x: wx, a: instant ? 1 : 0, t: 0, noticed: false, seed: r() * 10 };
    if (kind === 'moth' || kind === 'bird') {
      // settle on the nearest post
      let best = null;
      for (let i = Math.max(0, Math.floor((wx - 420) / 230) - 1); i < Math.floor((wx - 420) / 230) + 3; i++) {
        const p = postAt(i);
        if (!best || Math.abs(p.x - wx) < Math.abs(best.x - wx)) best = p;
      }
      life.x = best.x;
      life.y = DECK - 6 - best.h;
    } else {
      life.y = DECK - 8;
    }
    const size = { moth: [40, 34], bird: [50, 44], snail: [40, 30], light: [140, 30], puddle: [120, 26], moss: [44, 40], flower: [52, 70] }[kind].map(v => v * LIFE_SCALE);
    const it = this.item({
      id: 'life-' + kind, x: life.x - size[0] / 2, y: life.y - size[1] + 8, w: size[0], h: size[1] + 8,
      gx: life.x, gy: life.y - size[1] * 0.45, at: life.x - 70, face: 1, big: kind === 'flower',
      when: () => !life.noticed && life.a > 0.35 && !this.ending,
      use: () => this.notice(life)
    });
    it.glintBoost = 0.9;
    life.item = it;
    this.lives.push(life);
    if (!instant) G.audio.chime(84, 0.025);
    return life;
  };

  Depression.prototype.notice = function (life) {
    life.noticed = true;
    this.removeItem(life.item);
    this.noticed++;
    this.walked = 0;
    this.warmth = Math.min(1, this.warmth + 0.18);
    G.ui.hint(null);
    if (life.kind === 'flower') {
      G.audio.arp([69, 72, 76, 81], 0.35, 0.12);
      G.ui.say(['A flower, between the boards.', 'Still here.']);
      this.ending = { t: 0 };
      this.locked = true;
      this.player.target = null;
      return;
    }
    G.audio.chime([69, 72, 76][Math.min(2, this.noticed - 1)], 0.16);
    G.ui.say(LIVES[life.kind]);
  };

  Depression.prototype.update = function (dt) {
    const pl = this.player;
    const inp = G.input;
    // clicks up in the far distance
    if (!this.saidFar && inp.pressed && inp.y < HORIZON + 6 && inp.y > 60 && !this.locked) {
      this.saidFar = true;
      G.ui.say('Too far to reach from here.');
    }
    const x0 = pl.x;
    this.sideUpdate(dt);
    const moved = Math.abs(pl.x - x0);
    this.walked += moved;
    const idle = moved < 0.3 && !inp.down && !inp.axis() && !this.pending;
    this.still = idle ? this.still + dt : 0;

    // stand still long enough and something close by shows itself
    const unnoticedNear = this.lives.some(l => !l.noticed && Math.abs(l.x - pl.x) < 900);
    if (!this.revisit && !this.ending && this.still > 2.2 && !unnoticedNear && pl.x > 500) {
      const kind = this.noticed >= 3 ? 'flower' : this.order[this.noticed % this.order.length];
      const ahead = kind === 'flower' ? 190 : M.lerp(140, 260, Math.random());
      this.spawn(kind, pl.x + pl.dir * ahead);
      this.still = 0;
    }
    // walking and walking without stopping
    if (!this.revisit && !this.ending && this.still === 0 && this.walked > 1500 && this.hinted < 2 && !G.ui.busy()) {
      G.ui.say(this.hinted === 0 ? 'You don’t have to keep walking.' : 'You can stop here, for a while.');
      if (this.hinted === 1) G.ui.hint('Stand still for a moment', 6);
      this.hinted++;
      this.walked = 0;
    }
    for (const l of this.lives) { l.t += dt; l.a = Math.min(1, l.a + dt / 1.6); }

    // the camera leans in when you stop
    const targetZoom = this.ending ? 0.66 : (this.still > 1.2 ? CLOSE : ZOOM);
    this.cam.zoom = M.damp(this.cam.zoom, targetZoom, this.ending ? 0.8 : (targetZoom > this.cam.zoom ? 0.9 : 1.4), dt);
    this.cam.y = M.damp(this.cam.y, (this.cam.zoom - ZOOM) * 420, 2, dt);
    this.camMinX = G.W / 2 / this.cam.zoom - 20;
    this.camLead = this.still > 1.2 ? 60 : 260;

    this.rain.update(dt, 0.1);
    if (Math.random() < dt * 14) this.ripples.push({ x: Math.random() * G.W, y: HORIZON + 20 + Math.pow(Math.random(), 0.7) * (G.H - HORIZON - 20), t: 0 });
    for (const rp of this.ripples) rp.t += dt;
    this.ripples = this.ripples.filter(rp => rp.t < 1.4);

    if (this.ending) {
      const e = this.ending;
      e.t += dt;
      this.beam = Math.min(1, e.t / 2.5);
      G.audio.targets.rain = Math.max(0.2, 0.9 - e.t * 0.2);
      if (e.t > 6 && !e.done) { e.done = true; G.flow.complete(3); }
    }
  };

  Depression.prototype.drawLife = function (x, l) {
    const t = l.t, a = l.a;
    x.save();
    x.globalAlpha *= a;
    x.translate(l.x, l.y);
    if (!l.noticed && l.kind !== 'light') {
      x.save();
      x.globalCompositeOperation = 'lighter';
      P.glow(x, 0, -20, 70, '#f3e6cc', 0.12 + 0.05 * Math.sin(t * 2));
      x.restore();
    }
    x.scale(LIFE_SCALE, LIFE_SCALE);
    if (l.kind === 'moth') {
      const flap = 0.5 + 0.5 * Math.sin(t * (l.noticed ? 1.2 : 3));
      x.fillStyle = '#d9d3c6';
      for (const s of [-1, 1]) {
        x.beginPath();
        x.ellipse(s * 9 * (0.6 + flap * 0.4), -6, 10 * (0.5 + flap * 0.5), 7, s * 0.4, 0, TAU);
        x.fill();
      }
      x.fillStyle = '#6d6356';
      x.fillRect(-1.5, -12, 3, 12);
    } else if (l.kind === 'bird') {
      const bob = Math.sin(t * 5) * 2;
      x.fillStyle = '#3b3a3c';
      x.beginPath();
      x.ellipse(0, -12 + bob * 0.3, 12, 8, -0.2, 0, TAU);
      x.fill();
      x.beginPath();
      x.arc(9, -20 + bob * 0.3, 5.5, 0, TAU);
      x.fill();
      x.fillStyle = '#e8e2d6';
      x.beginPath();
      x.ellipse(2, -9, 7, 4, -0.2, 0, TAU);
      x.fill();
      x.strokeStyle = '#3b3a3c';
      x.lineWidth = 3;
      x.beginPath();
      x.moveTo(-10, -13);
      x.lineTo(-24, -18 + bob);
      x.stroke();
      x.fillStyle = '#c9a23c';
      x.beginPath();
      x.moveTo(14, -21);
      x.lineTo(20, -20);
      x.lineTo(14, -18);
      x.fill();
    } else if (l.kind === 'snail') {
      const crawl = Math.min(t * 1.5, 40);
      x.translate(crawl, 0);
      x.fillStyle = '#8b8378';
      x.beginPath();
      x.ellipse(0, -2, 16, 4, 0, 0, TAU);
      x.fill();
      x.fillStyle = '#9c7d5a';
      x.beginPath();
      x.arc(-3, -10, 10, 0, TAU);
      x.fill();
      x.strokeStyle = '#6b523a';
      x.lineWidth = 1.5;
      x.beginPath();
      x.arc(-3, -10, 6, 0, TAU * 0.8);
      x.stroke();
      x.strokeStyle = '#8b8378';
      x.beginPath();
      x.moveTo(12, -4);
      x.lineTo(17, -12);
      x.stroke();
    } else if (l.kind === 'light') {
      x.save();
      x.globalCompositeOperation = 'lighter';
      P.glow(x, 0, -4, 90, '#ffe2b0', 0.28 + 0.06 * Math.sin(t * 1.3));
      x.fillStyle = 'rgba(255,226,176,0.18)';
      x.beginPath();
      x.ellipse(0, -2, 70, 7, 0, 0, TAU);
      x.fill();
      x.restore();
    } else if (l.kind === 'puddle') {
      x.fillStyle = '#6f757e';
      x.beginPath();
      x.ellipse(0, -2, 56, 6, 0, 0, TAU);
      x.fill();
      x.fillStyle = 'rgba(232,228,220,0.7)';
      x.beginPath();
      x.ellipse(-8, -2.5, 26, 2, 0, 0, TAU);
      x.fill();
    } else if (l.kind === 'moss') {
      x.fillStyle = '#5f6d3e';
      for (let i = 0; i < 9; i++) {
        x.beginPath();
        P.leafPath(x, -8 + i * 2, 0, 18 + (i % 3) * 5, 4, -Math.PI / 2 + (i - 4) * 0.22);
        x.fill();
      }
    } else if (l.kind === 'flower') {
      x.strokeStyle = '#51623f';
      x.lineWidth = 3;
      x.beginPath();
      x.moveTo(0, 0);
      x.quadraticCurveTo(-5, -30, 2, -58);
      x.stroke();
      x.fillStyle = '#51623f';
      x.beginPath();
      P.leafPath(x, -1, -18, 20, 5, -2.4);
      x.fill();
      const sway = Math.sin(t * 1.4) * 0.08;
      x.translate(2, -60);
      x.rotate(sway);
      x.fillStyle = '#f5f1e8';
      for (let i = 0; i < 6; i++) {
        const an = i / 6 * TAU;
        x.beginPath();
        x.ellipse(Math.cos(an) * 9, Math.sin(an) * 9, 10, 4.5, an, 0, TAU);
        x.fill();
      }
      x.fillStyle = '#d4a93e';
      x.beginPath();
      x.arc(0, 0, 4.5, 0, TAU);
      x.fill();
    }
    x.restore();
  };

  Depression.prototype.drawBoardwalk = function (x) {
    const cam = this.cam;
    const x0 = Math.max(420, cam.left() - 60), x1 = cam.right() + 60;
    // posts first (behind the deck edge), then planks
    for (let i = Math.max(0, Math.floor((x0 - 420) / 230) - 1); i <= Math.floor((x1 - 420) / 230) + 1; i++) {
      const p = postAt(i);
      x.save();
      x.translate(p.x, DECK + 6);
      x.rotate(p.lean);
      x.fillStyle = '#2c2724';
      x.fillRect(-7, -p.h, 14, p.h + 140);
      x.fillStyle = 'rgba(255,245,230,0.07)';
      x.fillRect(-7, -p.h, 3, p.h + 140);
      x.restore();
      // reflection of the post
      x.fillStyle = 'rgba(30,28,28,0.25)';
      x.fillRect(p.x - 6, DECK + 150, 12, 90);
    }
    // deck
    const i0 = Math.floor(x0 / PLANK), i1 = Math.ceil(x1 / PLANK);
    x.fillStyle = '#1f1b19';
    x.fillRect(x0, DECK + 8, x1 - x0, 14);
    for (let i = i0; i <= i1; i++) {
      const p = plankAt(i);
      if (p.missing) continue;
      const px = i * PLANK;
      x.fillStyle = M.mixColor('#3f3a37', '#5d5754', p.shade);
      x.fillRect(px, DECK - 6 + p.dy, p.w, 14);
      x.fillStyle = 'rgba(210,205,200,0.10)';
      x.fillRect(px, DECK - 6 + p.dy, p.w, 2);
    }
  };

  Depression.prototype.draw = function (x) {
    const cam = this.cam, t = this.t;
    const warm = this.warmth, beam = this.beam;
    // sky, drifting slowly
    const drift = (Math.sin(t * 0.004) * 0.5 + 0.5) * 400;
    x.drawImage(this.sky.c, -drift, 0, this.sky.w, this.sky.h);
    if (warm > 0) {
      x.save();
      x.globalCompositeOperation = 'lighter';
      P.glow(x, 820, 200, 520, '#e8c9a0', warm * 0.12 + beam * 0.2);
      x.restore();
    }
    // the far shore does not come closer
    x.drawImage(this.shore.c, -(cam.x * 0.004) % 40, HORIZON - 100, G.W, 120);
    x.drawImage(this.water.c, 0, HORIZON, G.W, G.H - HORIZON);
    // reflections: bright sky and the shore lights
    x.save();
    x.globalCompositeOperation = 'lighter';
    x.fillStyle = 'rgba(210,205,196,0.10)';
    x.fillRect(620, HORIZON + 4, 420, 3);
    for (const hx of [756, 1006, 1086, 1176]) {
      const g = x.createLinearGradient(0, HORIZON, 0, HORIZON + 90);
      g.addColorStop(0, 'rgba(240,201,135,0.35)');
      g.addColorStop(1, 'rgba(240,201,135,0)');
      x.fillStyle = g;
      x.fillRect(hx - 1.5 + Math.sin(t * 2 + hx) * 1.2, HORIZON + 2, 3, 90);
    }
    x.restore();
    // rain on the water
    x.save();
    x.strokeStyle = 'rgba(220,220,225,0.25)';
    x.lineWidth = 1;
    for (const rp of this.ripples) {
      const k = rp.t / 1.4;
      const sc = 0.3 + (rp.y - HORIZON) / (G.H - HORIZON);
      x.globalAlpha = (1 - k) * 0.8;
      x.beginPath();
      x.ellipse(rp.x, rp.y, (4 + k * 22) * sc, (1 + k * 5) * sc, 0, 0, TAU);
      x.stroke();
    }
    x.restore();
    const reedOff = cam.x * cam.zoom;
    const rm = this.reedsMid, om = (reedOff * 0.5) % rm.period;
    x.drawImage(rm.c, -om, 0, rm.w, G.H);

    x.save();
    cam.apply(x);
    // porch and the chair
    x.drawImage(this.porch.L.c, 0, -this.porch.oy, 640, 700);
    this.drawBoardwalk(x);
    x.fillStyle = '#3a3431';
    x.fillRect(0, DECK - 6, 430, 14);
    x.fillStyle = '#1f1b19';
    x.fillRect(0, DECK + 8, 430, 14);
    P.chair(x, 225, DECK - 6, { s: 165, facing: 1, throwColor: '#8e8a84', throwPatch: false });
    for (const l of this.lives) this.drawLife(x, l);
    if (beam > 0) {
      const f = this.lives.find(l => l.kind === 'flower');
      if (f) {
        x.save();
        x.globalCompositeOperation = 'lighter';
        const g = x.createLinearGradient(f.x + 400, f.y - 900, f.x, f.y);
        g.addColorStop(0, 'rgba(255,225,170,0)');
        g.addColorStop(1, M.rgba('#ffe1aa', 0.28 * beam));
        x.fillStyle = g;
        x.beginPath();
        x.moveTo(f.x + 260, f.y - 1000);
        x.lineTo(f.x + 520, f.y - 1000);
        x.lineTo(f.x + 120, f.y + 10);
        x.lineTo(f.x - 200, f.y + 10);
        x.closePath();
        x.fill();
        P.glow(x, f.x - 30, f.y - 40, 220, '#ffd9a0', 0.3 * beam);
        x.restore();
      }
    }
    this.drawPlayer(x, { bow: this.player.bow * (1 - this.warmth * 0.6) - beam * 0.1 });
    if (!this.locked) this.drawGlints(x);
    x.restore();

    // foreground reeds, then rain over everything
    const rf = this.reedsFg, of = (reedOff * 1.3) % rf.period;
    x.drawImage(rf.c, -of, 20, rf.w, G.H);
    this.rain.draw(x, 0.9 - beam * 0.6, 0.1);
  };
})();
