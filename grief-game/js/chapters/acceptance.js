/* Chapter 05 / Acceptance: "The missing place remains within a shared world."
 * A vast overcast river plain, patched shelter, worked soil and the empty chair.
 * Play: repair shelter and tend a garden alongside other people.
 */
(function () {
  'use strict';
  const G = window.G, M = G.M, C = G.C, P = G.paint;
  const TAU = M.TAU;
  const ZOOM = 0.44, FAR = 0.27, BASE = 500, HERO = 300, END_X = 3500, ROUTE_X = 2180;
  const SPOT_X = 2060;
  const TEARS = [[470, 186, 58, 40], [650, 172, 64, 44], [820, 190, 54, 38]];
  const SEEDS = [1030, 1120, 1210];
  const CLOTH = ['#d9cdb4', '#9d8aa6', '#c7a25a', '#8a8680', '#b8918a', '#cbbfa6', '#a9b3a1'];

  const ground = x => (x < ROUTE_X ? BASE : BASE + (x - ROUTE_X) * 0.07 + Math.sin((x - ROUTE_X) / 260) * 10);

  // ------------------------------------------------------------ painting (screen-space backdrop)
  function paintHills() {
    const L = G.layer(G.W + 300, 420, Math.min(G.RS, 1.5));
    const x = L.x;
    const r = M.rng(55);
    const layers = [[270, '#7d818a', 18], [292, '#6d727b', 26], [318, '#60656d', 30]];
    for (const [y, col, amp] of layers) {
      x.fillStyle = col;
      x.beginPath();
      x.moveTo(0, 420);
      for (let px = 0; px <= L.w; px += 10) x.lineTo(px, y - amp * (0.5 + 0.5 * Math.sin(px / (160 + amp * 6) + y)) - M.fbm1(px / 120 + y) * amp * 0.6);
      x.lineTo(L.w, 420);
      x.fill();
    }
    return L;
  }

  function paintValley() {
    const w = G.W + 500;
    const L = G.layer(w, G.H, Math.min(G.RS, 1.5));
    const x = L.x;
    const r = M.rng(66);
    const top = 300;
    const g = x.createLinearGradient(0, top, 0, G.H);
    g.addColorStop(0, '#77776a');
    g.addColorStop(0.35, '#5d5c4c');
    g.addColorStop(0.6, '#4d4d3a');
    g.addColorStop(1, '#3a3a2b');
    x.fillStyle = g;
    x.fillRect(0, top, w, G.H - top);
    // fields
    for (let i = 0; i < 70; i++) {
      const fy = top + Math.pow(r(), 1.4) * 115;
      const fw = r.range(40, 160) * (0.4 + (fy - top) / 115), fh = r.range(3, 10) * (0.4 + (fy - top) / 115);
      x.fillStyle = M.rgba(r.pick(['#6d6f58', '#827d64', '#5f6450', '#8a8470', '#707257']), 0.8);
      x.fillRect(r() * w, fy, fw, fh);
    }
    // the river, winding into the distance
    const pts = [];
    for (let i = 0; i <= 60; i++) {
      const u = i / 60;
      const near = 1 - Math.pow(u, 0.5);
      const px = M.lerp(-60, w + 40, u);
      const py = M.lerp(410, top + 5, Math.pow(u, 0.55)) + Math.sin(u * 14) * 16 * near;
      pts.push([px, py, M.lerp(24, 2, Math.pow(u, 0.5))]);
    }
    x.fillStyle = '#a7abb0';
    x.beginPath();
    pts.forEach((p, i) => (i ? x.lineTo(p[0], p[1] - p[2] / 2) : x.moveTo(p[0], p[1] - p[2] / 2)));
    for (let i = pts.length - 1; i >= 0; i--) x.lineTo(pts[i][0], pts[i][1] + pts[i][2] / 2);
    x.fill();
    x.strokeStyle = 'rgba(235,236,238,0.5)';
    x.lineWidth = 1;
    for (let i = 2; i < pts.length - 2; i += 2) {
      x.beginPath();
      x.moveTo(pts[i][0] - 8, pts[i][1]);
      x.lineTo(pts[i][0] + 10, pts[i][1] - 0.5);
      x.stroke();
    }
    // bare trees along the banks
    x.strokeStyle = '#3e3d38';
    x.lineCap = 'round';
    for (let i = 0; i < 46; i++) {
      const p = pts[r.int(3, 36)];
      const tx = p[0] + r.range(-70, 70), ty = p[1] + r.range(-6, 8);
      const th = r.range(8, 22) * (0.3 + (ty - top) / 115);
      x.lineWidth = 1;
      x.beginPath();
      x.moveTo(tx, ty);
      x.lineTo(tx, ty - th);
      for (let b = 0; b < 4; b++) {
        x.moveTo(tx, ty - th * r.range(0.4, 0.9));
        x.lineTo(tx + r.range(-th, th) * 0.5, ty - th * r.range(0.9, 1.3));
      }
      x.stroke();
    }
    return L;
  }

  function paintMidTrees() {
    const w = G.W + 1400;
    const L = G.layer(w, G.H, Math.min(G.RS, 1.5));
    const x = L.x;
    const r = M.rng(77);
    x.strokeStyle = '#2f2c28';
    x.lineCap = 'round';
    const tree = (bx, by, ang, len, wd, d) => {
      if (d > 6 || len < 4) return;
      const ex = bx + Math.cos(ang) * len, ey = by + Math.sin(ang) * len;
      x.lineWidth = wd;
      x.beginPath();
      x.moveTo(bx, by);
      x.lineTo(ex, ey);
      x.stroke();
      const n = d < 2 ? 3 : 2;
      for (let i = 0; i < n; i++) tree(ex, ey, ang + r.range(-0.7, 0.7), len * r.range(0.62, 0.8), wd * 0.66, d + 1);
    };
    for (const tx of [120, 520, 1060, 1500, 1880, 2350]) {
      if (tx > w) continue;
      tree(tx, 560, -Math.PI / 2 + r.range(-0.08, 0.08), r.range(90, 140), 9, 0);
    }
    // hedgerow along the slope
    for (let i = 0; i < w / 14; i++) {
      x.fillStyle = M.rgba(r.pick(['#3c3d30', '#45463a', '#34352b']), 0.9);
      x.beginPath();
      x.arc(i * 14 + r.range(-6, 6), 560 + r.range(-6, 10), r.range(8, 20), 0, TAU);
      x.fill();
    }
    return L;
  }

  function paintGround() {
    const W = END_X + 1700;
    const k = M.clamp(ZOOM * G.RS, 0.6, 1.4);
    const L = G.layer(W, 900, k);
    const x = L.x;
    const r = M.rng(88);
    const oy = 200; // local y of world 300
    // hillside
    x.fillStyle = '#5b5b41';
    x.beginPath();
    x.moveTo(0, 900);
    for (let px = 0; px <= W; px += 20) x.lineTo(px, ground(px) - 300 + oy + 4);
    x.lineTo(W, 900);
    x.fill();
    const gg = x.createLinearGradient(0, BASE - 300 + oy, 0, 900);
    gg.addColorStop(0, 'rgba(120,120,86,0.6)');
    gg.addColorStop(1, 'rgba(30,30,22,0.5)');
    x.fillStyle = gg;
    x.fill();
    // grass strokes
    x.lineCap = 'round';
    for (let i = 0; i < W * 0.9; i++) {
      const gx = r() * W, gy = ground(gx) - 300 + oy + r.range(0, 60);
      x.strokeStyle = M.rgba(r.pick(['#7d7c55', '#6a6a46', '#8d8a60', '#4d4d36']), 0.7);
      x.lineWidth = r.range(1, 2);
      x.beginPath();
      x.moveTo(gx, gy);
      x.lineTo(gx + r.range(-3, 3), gy - r.range(4, 12));
      x.stroke();
    }
    // the path: from the lake, past the garden, and on along the river
    x.fillStyle = '#8a7e66';
    x.beginPath();
    for (let px = 0; px <= W; px += 20) x.lineTo(px, ground(px) - 300 + oy - 2);
    for (let px = W; px >= 0; px -= 20) x.lineTo(px, ground(px) - 300 + oy + 16);
    x.fill();
    x.fillStyle = 'rgba(40,32,24,0.25)';
    for (let i = 0; i < 400; i++) { const px = r() * W; x.fillRect(px, ground(px) - 300 + oy + r.range(0, 14), r.range(2, 6), 2); }
    // a few old planks where the boardwalk ends
    x.fillStyle = '#4a4440';
    for (let i = 0; i < 6; i++) x.fillRect(i * 32, BASE - 300 + oy - 4, 26, 10);
    // garden beds (worked soil)
    for (const [a, b] of [[960, 1270], [1310, 1610], [1650, 1910]]) {
      x.fillStyle = '#3b3227';
      x.beginPath();
      x.moveTo(a, BASE - 300 + oy + 2);
      x.quadraticCurveTo((a + b) / 2, BASE - 300 + oy - 22, b, BASE - 300 + oy + 2);
      x.lineTo(b, BASE - 300 + oy + 18);
      x.lineTo(a, BASE - 300 + oy + 18);
      x.fill();
      x.strokeStyle = 'rgba(20,16,12,0.4)';
      x.lineWidth = 1;
      for (let i = 0; i < 12; i++) {
        const px = a + (b - a) * (i + 0.5) / 12;
        x.beginPath();
        x.moveTo(px - 8, BASE - 300 + oy - 6);
        x.lineTo(px + 8, BASE - 300 + oy - 10);
        x.stroke();
      }
      // stakes and twine
      x.strokeStyle = '#6e5a42';
      x.lineWidth = 3;
      const stakes = [];
      for (let px = a + 20; px < b; px += 70) {
        const h = r.range(80, 120);
        stakes.push([px, BASE - 300 + oy - h]);
        x.beginPath();
        x.moveTo(px, BASE - 300 + oy);
        x.lineTo(px + r.range(-4, 4), BASE - 300 + oy - h);
        x.stroke();
      }
      x.strokeStyle = 'rgba(214,196,160,0.6)';
      x.lineWidth = 1;
      x.beginPath();
      stakes.forEach((s, i) => (i ? x.quadraticCurveTo((stakes[i - 1][0] + s[0]) / 2, s[1] + 10, s[0], s[1] + 4) : x.moveTo(s[0], s[1] + 4)));
      x.stroke();
    }
    // plants already growing in the other beds
    for (let px = 1330; px < 1900; px += r.range(26, 44)) {
      if (px > 1610 && px < 1650) continue;
      const sz = r.range(10, 20);
      x.fillStyle = r.pick(['#5d6b3e', '#6f7c48', '#56643a']);
      for (let i = 0; i < 6; i++) {
        x.beginPath();
        P.leafPath(x, px, BASE - 300 + oy - 6, sz, sz * 0.4, -Math.PI / 2 + (i - 2.5) * 0.45);
        x.fill();
      }
    }
    // fence along the edge of the slope
    x.strokeStyle = '#4b3f33';
    x.lineWidth = 5;
    for (let px = 1960; px < W; px += 150) {
      const gy = ground(px) - 300 + oy;
      x.beginPath();
      x.moveTo(px, gy + 6);
      x.lineTo(px + r.range(-3, 3), gy - 70);
      x.stroke();
    }
    x.strokeStyle = 'rgba(60,60,60,0.5)';
    x.lineWidth = 1;
    for (const hgt of [30, 55]) {
      x.beginPath();
      for (let px = 1960; px < W; px += 150) { const gy = ground(px) - 300 + oy - hgt; if (px === 1960) x.moveTo(px, gy); else x.lineTo(px, gy + 4); }
      x.stroke();
    }
    P.texturize(L, 0.3);
    return { L, oy, W };
  }

  function paintShelter() {
    const k = M.clamp(ZOOM * G.RS * 1.3, 0.7, 1.6);
    const L = G.layer(640, 480, k);
    const x = L.x;
    const r = M.rng(99);
    // local frame: world (320, 100) is local (0, 0)
    const X = wx => wx - 320, Y = wy => wy - 100;
    // back cloth hanging on the left
    x.fillStyle = '#b9ad97';
    x.fillRect(X(360), Y(190), 40, 300);
    // posts and beams
    x.fillStyle = '#5a4a3c';
    for (const px of [380, 620, 860]) {
      x.fillRect(X(px) - 8, Y(152), 16, BASE - 152 + 6);
      x.fillStyle = 'rgba(255,240,220,0.08)';
      x.fillRect(X(px) - 8, Y(152), 4, BASE - 152 + 6);
      x.fillStyle = '#5a4a3c';
    }
    x.fillRect(X(360), Y(148), 520, 12);
    // tools under the roof
    x.fillStyle = '#8a8d8f';
    x.beginPath();
    x.moveTo(X(700), Y(BASE));
    x.lineTo(X(704), Y(BASE - 34));
    x.lineTo(X(736), Y(BASE - 34));
    x.lineTo(X(740), Y(BASE));
    x.fill();
    x.strokeStyle = '#8a8d8f';
    x.lineWidth = 3;
    x.beginPath();
    x.moveTo(X(736), Y(BASE - 28));
    x.lineTo(X(756), Y(BASE - 44));
    x.moveTo(X(708), Y(BASE - 34));
    x.quadraticCurveTo(X(720), Y(BASE - 52), X(732), Y(BASE - 34));
    x.stroke();
    for (const [px, pc] of [[780, '#a0522d'], [806, '#8e4a2a'], [770, '#9a5a3a']]) {
      x.fillStyle = pc;
      x.beginPath();
      x.moveTo(X(px) - 12, Y(BASE - 26));
      x.lineTo(X(px) + 12, Y(BASE - 26));
      x.lineTo(X(px) + 9, Y(BASE));
      x.lineTo(X(px) - 9, Y(BASE));
      x.fill();
    }
    x.fillStyle = '#8a6a3a';
    x.fillRect(X(410), Y(BASE - 30), 50, 30);
    x.strokeStyle = 'rgba(40,28,16,0.5)';
    x.lineWidth = 1;
    for (let i = 0; i < 6; i++) { x.beginPath(); x.moveTo(X(410) + i * 9, Y(BASE - 30)); x.lineTo(X(410) + i * 9, Y(BASE)); x.stroke(); }
    return { L, X, Y };
  }

  // ------------------------------------------------------------ scene
  function Acceptance(o) {
    o = o || {};
    G.SideScene.call(this, {
      zoom: ZOOM, camY: 60, minX: 120, maxX: ROUTE_X - 30, startX: 200, speed: 150, heroScale: HERO,
      loose: 0.95, bow: -0.04, camLead: 120, surface: 'grass', glintRange: 520, groundY: BASE
    });
    this.revisit = !!o.revisit;
    this.finish = { vignette: 0.75, grain: 0.7, frame: 'torn' };
    this.tears = TEARS.map((t, i) => ({ x: t[0], y: t[1], w: t[2], h: t[3], p: this.revisit ? 1 : 0, done: this.revisit, i }));
    this.seeds = SEEDS.map((sx, i) => ({ x: sx, planted: this.revisit, grow: this.revisit ? 1.6 : 0, i }));
    this.chair = { x: this.revisit ? SPOT_X : 540, facing: 1, carried: false, placed: this.revisit };
    this.phase = this.revisit ? 'open' : 'work';
    this.light = this.revisit ? 1 : 0;
    this.kneelT = 0;
    this.npcs = [
      { look: G.person.ELDER, x: 1455, dir: -1, kneel: 1, t: 0, state: 'work', say: 0 },
      { look: G.person.GARDENER, x: 1770, dir: -1, kneel: 1, t: 3, state: 'work', say: 0 }
    ];
    this.greeted = false;
    this.birdT = 3;
  }
  Acceptance.prototype = Object.create(G.SideScene.prototype);
  G.chapters.Acceptance = Acceptance;

  Acceptance.prototype.ground = function (x) { return ground(x); };
  Acceptance.prototype.surface = function (x) { return x < 200 ? 'wood' : 'grass'; };
  Acceptance.prototype.speedMul = function () { return this.chair.carried ? 0.75 : 1; };

  Acceptance.prototype.enter = function () {
    this.sky = P.paintSky(G.W + 200, 330, {
      top: '#5b5d64', bottom: '#aaa59c', light: '#d6d0c6', shadow: '#54565d', seed: 71, clouds: 26, scale: 1.3, maxY: 0.9,
      bright: { x: 980, y: 290, r: 420, color: '#e0d8cb', alpha: 0.35 }, strokes: 240
    });
    this.hills = paintHills();
    this.valley = paintValley();
    this.midTrees = paintMidTrees();
    this.groundL = paintGround();
    this.shelter = paintShelter();
    this.camMinX = G.W / 2 / ZOOM - 40;
    this.camMaxX = this.groundL.W - G.W / 2 / ZOOM;
    this.buildItems();
    this.snapCamera();
    G.audio.scene({ wind: 0.35, water: 0.25, drone: [48, 55, 64], droneLevel: 0.2 });
    if (this.revisit) {
      this.maxX = END_X + 200;
      G.ui.say('The garden came up.', { delay: 0.8 });
    } else {
      G.ui.say('Wide, and still grey. But not empty.', { delay: 0.9 });
    }
  };

  Acceptance.prototype.npcAnchor = function (n) {
    return () => {
      const p = this.cam.toScreen(n.x, ground(n.x) - (n.kneel > 0.5 ? 200 : 330));
      return { x: p.x, y: p.y };
    };
  };
  Acceptance.prototype.npcSay = function (i, text, delay) {
    const n = this.npcs[i];
    const go = () => { if (G.scene !== this) return; G.ui.speak(this.npcAnchor(n), text); n.look2 = 2.5; };
    if (delay) setTimeout(go, delay * 1000); else go();
  };

  Acceptance.prototype.buildItems = function () {
    this.items = [];
    this.tears.forEach(t => {
      this.item({
        id: 'tear' + t.i, x: t.x - t.w / 2 - 10, y: t.y - t.h / 2 - 10, w: t.w + 20, h: t.h + 20, at: t.x - 40, face: 1, hold: true,
        when: () => !t.done,
        tap: () => { G.ui.hint('Hold to sew the patch', 5); if (!this.saidTear) { this.saidTear = true; G.ui.say('Torn through. I can mend this.'); } },
        holdTick: (s, dt) => this.sew(t, dt)
      });
    });
    this.seeds.forEach(sd => {
      this.item({
        id: 'seed' + sd.i, x: sd.x - 34, y: BASE - 60, w: 68, h: 80, gy: BASE - 20, at: sd.x - 70, face: 1, reach: false,
        when: () => !sd.planted && !this.kneeling,
        use: () => this.plant(sd)
      });
    });
    this.chairItem = this.item({
      id: 'chair', x: () => this.chair.x - 60, y: BASE - 170, w: 130, h: 170, gy: BASE - 110,
      at: () => this.chair.x - 110, face: 1,
      when: () => !this.chair.carried,
      use: () => this.touchChair()
    });
    this.spotItem = this.item({
      id: 'spot', x: SPOT_X - 90, y: BASE - 90, w: 180, h: 110, gy: BASE - 20, at: SPOT_X - 110, face: 1, big: true, reach: false,
      when: () => this.chair.carried,
      use: () => this.placeChair()
    });
    this.item({ id: 'river', x: 2180, y: BASE - 220, w: 300, h: 200, gx: 2250, gy: BASE - 120, at: ROUTE_X - 40, face: 1,
      when: () => this.phase !== 'open', say: 'The river goes all the way to the edge of the sky.' });
  };

  Acceptance.prototype.sew = function (t, dt) {
    const before = t.p;
    t.p = Math.min(1, t.p + dt / 2.2);
    if (Math.floor(before * 12) !== Math.floor(t.p * 12)) G.audio.stitch();
    if (t.p >= 1 && !t.done) {
      t.done = true;
      const n = this.tears.filter(q => q.done).length;
      G.audio.chime([67, 71, 74][n - 1], 0.14);
      if (n === 1) { G.ui.say('Patched. The seam shows. That’s all right.'); this.npcSay(0, 'Small stitches hold better.', 1.6); }
      if (n === 3) this.npcSay(1, 'That’ll keep the worst of it off.', 0.6);
      this.checkWork();
      return true;
    }
    return false;
  };

  Acceptance.prototype.plant = function (sd) {
    this.kneeling = { t: 0, sd };
    this.locked = true;
    this.player.dir = 1;
  };

  Acceptance.prototype.checkWork = function () {
    if (this.phase !== 'work') return;
    if (this.tears.every(t => t.done) && this.seeds.every(s => s.planted)) {
      this.phase = 'chair';
      this.npcSay(0, 'Bring the chair out, if you like.', 2.2);
      this.npcSay(1, 'There’s a good spot by the fence.', 4.6);
      setTimeout(() => { if (G.scene === this && !this.chair.carried && !this.chair.placed) G.ui.hint('Carry the chair to the fence', 6); }, 6000);
    }
  };

  Acceptance.prototype.touchChair = function () {
    if (this.phase === 'work') { G.ui.say(this.chair.placed ? 'It can see the river from here.' : 'Their chair. It came all this way.'); return; }
    if (this.phase === 'chair' && !this.chair.placed) {
      this.chair.carried = true;
      this.player.carry = true;
      G.audio.thud(0.2);
      G.ui.say('It isn’t heavy.');
      return;
    }
    G.ui.say('Facing the river. Empty. It has its place.');
  };

  Acceptance.prototype.placeChair = function () {
    this.chair.carried = false;
    this.chair.placed = true;
    this.chair.x = SPOT_X;
    this.player.carry = false;
    this.phase = 'placed';
    this.locked = true;
    G.audio.thud(0.3);
    G.ui.hint(null);
    this.placedT = 0;
    for (const n of this.npcs) { n.state = 'look'; n.t = 0; }
  };

  Acceptance.prototype.update = function (dt) {
    const pl = this.player;
    if (this.kneeling) {
      const k = this.kneeling;
      k.t += dt;
      this.t += dt;
      pl.kneel = M.smoothstep(0, 0.5, k.t) * (1 - M.smoothstep(1.7, 2.2, k.t));
      pl.walk = 0;
      pl.work = 1;
      if (k.t > 1.1 && !k.sd.planted) {
        k.sd.planted = true;
        G.audio.chime([72, 76, 79][this.seeds.filter(s => s.planted).length - 1], 0.12);
        const n = this.seeds.filter(s => s.planted).length;
        if (n === 1) { this.npcSay(1, 'Not too deep.', 0.2); }
        if (n === 2) { this.npcSay(0, 'That’s it.', 0.3); }
        if (n === 3) G.ui.say('Three rows of small green.');
      }
      if (k.t > 2.3) { this.kneeling = null; this.locked = false; pl.kneel = 0; pl.work = 0; this.checkWork(); }
      this.updateCamera(dt);
    } else if (this.phase === 'placed') {
      this.t += dt;
      this.placedT += dt;
      const t = this.placedT;
      if (t > 1.8 && !this.saidRoom) { this.saidRoom = true; G.ui.say('There’s room for it here.'); }
      if (t > 4.4 && !this.saidGood) { this.saidGood = true; this.npcSay(0, 'Good spot.'); }
      this.light = M.smoothstep(3, 8, t);
      if (t > 7) {
        this.phase = 'open';
        this.locked = false;
        this.maxX = END_X + 200;
        for (const n of this.npcs) { n.state = 'work'; n.t = 0; }
        G.ui.hint('The path along the river is open', 6);
        G.audio.chord([48, 55, 64], 4);
      }
      this.updateCamera(dt);
    } else {
      this.sideUpdate(dt);
    }
    for (const sd of this.seeds) if (sd.planted) sd.grow = Math.min(this.revisit ? 1.6 : 1, sd.grow + dt / 1.5);

    // the two gardeners work, look up, now and then stand and stretch
    for (const n of this.npcs) {
      n.t += dt;
      if (n.look2) n.look2 = Math.max(0, n.look2 - dt);
      if (n.state === 'work') {
        n.kneel = M.damp(n.kneel, 1, 3, dt);
        if (n.t > 11 + n.x % 5) { n.state = 'stretch'; n.t = 0; }
      } else if (n.state === 'stretch') {
        n.kneel = M.damp(n.kneel, 0, 3, dt);
        if (n.t > 3.2) { n.state = 'work'; n.t = 0; }
      } else if (n.state === 'look') {
        n.kneel = M.damp(n.kneel, 0.2, 2, dt);
      }
      n.dir = (n.look2 || n.state === 'look') ? (pl.x < n.x ? -1 : 1) : (n.x < 1600 ? -1 : 1);
    }
    if (!this.greeted && pl.x > 880 && this.phase === 'work' && !this.revisit) {
      this.greeted = true;
      this.npcSay(0, 'Morning.');
      this.npcSay(1, 'Rain later, I think.', 2.2);
      this.npcSay(0, 'Always is.', 4.4);
    }

    // walking the route: the world widens around you
    if (this.phase === 'open') {
      const u = M.smoothstep(ROUTE_X, END_X - 300, pl.x);
      this.cam.zoom = M.damp(this.cam.zoom, M.lerp(ZOOM, FAR, u), 1.2, dt);
      this.cam.y = M.damp(this.cam.y, M.lerp(60, 380, u), 1.2, dt);
      this.camLead = M.lerp(120, 700, u);
      this.camMinX = G.W / 2 / this.cam.zoom - 40;
      this.camMaxX = this.groundL.W - G.W / 2 / this.cam.zoom;
      if (pl.x > END_X - 10 && !this.done) {
        this.done = true;
        this.locked = true;
        G.flow.complete(4);
      }
    }
    this.birdT -= dt;
    if (this.birdT < 0) { this.birdT = 5 + Math.random() * 8; G.audio.bird(); }
  };

  // ------------------------------------------------------------ drawing
  Acceptance.prototype.drawCanopy = function (x) {
    const t = this.t;
    const r = M.rng(17);
    // patchwork cloth sagging between the beams
    const x0 = 350, x1 = 890, y0 = 150, sag = 22;
    const cols = 9;
    for (let i = 0; i < cols; i++) {
      const a = x0 + (x1 - x0) * i / cols, b = x0 + (x1 - x0) * (i + 1) / cols;
      const ya = y0 + Math.sin(i / cols * Math.PI) * sag + Math.sin(t * 1.2 + i) * 2;
      const yb = y0 + Math.sin((i + 1) / cols * Math.PI) * sag + Math.sin(t * 1.2 + i + 1) * 2;
      x.fillStyle = CLOTH[(i * 3 + 1) % CLOTH.length];
      x.beginPath();
      x.moveTo(a, ya - 40);
      x.lineTo(b, yb - 40);
      x.lineTo(b, yb + 24 + (i % 3) * 6);
      x.lineTo(a, ya + 24 + ((i + 1) % 3) * 6);
      x.closePath();
      x.fill();
      P.whipstitch(x, b, yb - 40, b, yb + 20, { color: 'rgba(245,238,225,0.7)', gap: 7, len: 4, width: 0.9 });
      x.fillStyle = 'rgba(0,0,0,0.12)';
      x.fillRect(a, ya + 10, b - a, 14);
      r();
    }
    // hanging edge in the wind
    P.gauze(x, 350, 168, 60, 170, { t, alpha: 0.5, seed: 4, wind: 0.2, color: '#cbbfa6' });
    P.gauze(x, 838, 172, 56, 140, { t: t + 2, alpha: 0.45, seed: 8, wind: 0.2, color: '#b8918a' });
    // tears and their patches
    for (const tr of this.tears) {
      if (!tr.done) {
        x.fillStyle = '#9fa0a3';
        x.beginPath();
        P.roughPolyPath(x, [[tr.x - tr.w / 2, tr.y - tr.h / 2], [tr.x + tr.w / 2, tr.y - tr.h / 2 + 4], [tr.x + tr.w / 2 - 6, tr.y + tr.h / 2], [tr.x - tr.w / 2 + 4, tr.y + tr.h / 2 - 3]], true, 6, M.rng(tr.i + 3), 7);
        x.fill();
        x.strokeStyle = 'rgba(245,238,225,0.6)';
        x.lineWidth = 1;
        x.stroke();
      }
      if (tr.p > 0) P.patch(x, tr.x, tr.y, tr.w + 12, tr.h + 10, { color: CLOTH[(tr.i + 2) % CLOTH.length], progress: tr.p, seed: tr.i + 30, alpha: M.clamp(tr.p * 3, 0, 1) });
    }
  };

  Acceptance.prototype.drawSeedling = function (x, sd) {
    if (!sd.planted) {
      x.fillStyle = '#2d251c';
      x.beginPath();
      x.ellipse(sd.x, BASE - 4, 12, 4, 0, 0, TAU);
      x.fill();
      return;
    }
    const g = sd.grow;
    x.fillStyle = '#6f7c48';
    for (let i = 0; i < 5; i++) {
      x.beginPath();
      P.leafPath(x, sd.x, BASE - 6, 8 + g * 16, (8 + g * 16) * 0.42, -Math.PI / 2 + (i - 2) * 0.5);
      x.fill();
    }
  };

  Acceptance.prototype.drawNPC = function (x, n) {
    const sway = n.state === 'work' ? Math.sin(n.t * 2.2) * 0.02 : 0;
    G.person.draw(x, {
      x: n.x, y: ground(n.x), s: HERO * 0.98, dir: n.dir, t: this.t + n.x,
      look: n.look, kneel: n.kneel, work: n.state === 'work' ? 1 : 0, lean: sway, loose: 0.6, wind: 0.2,
      bow: n.state === 'work' ? 0.1 : -0.05
    });
  };

  Acceptance.prototype.draw = function (x) {
    const cam = this.cam, t = this.t;
    const off = cam.x;
    x.drawImage(this.sky.c, -((t * 2) % 200), 0, this.sky.w, this.sky.h);
    // a thin warm band opens at the horizon once the chair has its place
    if (this.light > 0) {
      x.save();
      x.globalCompositeOperation = 'lighter';
      const g = x.createLinearGradient(0, 200, 0, 320);
      g.addColorStop(0, 'rgba(255,214,160,0)');
      g.addColorStop(0.7, M.rgba('#f0c987', 0.22 * this.light));
      g.addColorStop(1, 'rgba(255,214,160,0)');
      x.fillStyle = g;
      x.fillRect(0, 200, G.W, 120);
      x.restore();
    }
    x.drawImage(this.hills.c, -(off * 0.02) % 300, 0, this.hills.w, this.hills.h);
    x.drawImage(this.valley.c, -Math.min(500, off * 0.06), 0, this.valley.w, G.H);
    const mt = this.midTrees;
    x.drawImage(mt.c, -Math.min(mt.w - G.W, off * cam.zoom * 0.35), -(cam.y - 60) * cam.zoom * 0.3, mt.w, G.H);

    x.save();
    cam.apply(x);
    const gl = this.groundL;
    x.fillStyle = '#3c3c2c';
    x.fillRect(-3000, 990, gl.W + 6000, 4000);
    x.drawImage(gl.L.c, 0, 300 - gl.oy, gl.W, 900);
    // shelter
    x.drawImage(this.shelter.L.c, 320, 100, 640, 480);
    this.drawCanopy(x);
    for (const sd of this.seeds) this.drawSeedling(x, sd);
    // the chair: under the shelter, carried, or by the fence facing the river
    const ch = this.chair;
    if (!ch.carried) {
      P.chair(x, ch.x, ground(ch.x) - 2, { s: 165, facing: ch.facing, throwColor: '#6b3f52' });
      if (ch.placed && this.light > 0) {
        x.save();
        x.globalCompositeOperation = 'lighter';
        P.glow(x, ch.x, ground(ch.x) - 80, 160, '#f0c987', 0.12 * this.light);
        x.restore();
      }
    }
    for (const n of this.npcs) this.drawNPC(x, n);
    this.drawPlayer(x);
    if (ch.carried) {
      const h = this.player.out.hand || { x: this.player.x + 40, y: this.player.y - 180 };
      P.chair(x, h.x + 30 * this.player.dir, h.y + 70, { s: 150, facing: this.player.dir, tip: 0.1 * this.player.dir, throwColor: '#6b3f52' });
    }
    if (ch.carried) {
      // where it could go
      x.save();
      x.globalCompositeOperation = 'lighter';
      P.glow(x, SPOT_X, BASE - 10, 120, '#f0c987', 0.1 + 0.04 * Math.sin(t * 2));
      x.restore();
    }
    if (!this.locked) this.drawGlints(x);
    x.restore();

    // grass at the very front
    x.save();
    x.strokeStyle = '#3d3d2b';
    x.lineCap = 'round';
    const r = M.rng(5);
    for (let i = 0; i < 80; i++) {
      const gx = ((r() * (G.W + 400) - off * cam.zoom * 1.25) % (G.W + 400) + G.W + 400) % (G.W + 400) - 200;
      x.lineWidth = r.range(2, 4);
      x.beginPath();
      x.moveTo(gx, G.H + 5);
      x.quadraticCurveTo(gx + 4, G.H - 20, gx + r.range(-10, 14) + Math.sin(t * 1.5 + i) * 3, G.H - r.range(20, 50));
      x.stroke();
    }
    x.restore();
  };
})();
