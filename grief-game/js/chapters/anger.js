/* Chapter 02 / Anger: "The garden resists being crossed."
 * Patterned black trunks, torn textiles, bent paths and visible tension.
 * Play: untie a wind-strained gate and make one narrow route forward.
 */
(function () {
  'use strict';
  const G = window.G, M = G.M, C = G.C, P = G.paint;
  const TAU = M.TAU;
  const ZOOM = 0.72, CAM_Y = 520, BASE = 900, WORLD_W = 4300, HERO = 300;
  const GATE = { x: 3790, w: 210, top: 560 };
  const PILLARS = [3740, 4000];
  const KNOT_Y = [860, 760, 660];

  const ground = x => BASE + 12 * Math.sin(x / 340) + 7 * Math.sin(x / 130 + 1) * M.smoothstep(560, 900, x);

  // ------------------------------------------------------------ painting
  function paintSkyScreen() {
    const L = G.layer(G.W, G.H);
    const x = L.x;
    const g = x.createLinearGradient(0, 0, 0, G.H);
    g.addColorStop(0, '#b9b4ab');
    g.addColorStop(0.5, '#dcd7cd');
    g.addColorStop(1, '#9c9890');
    x.fillStyle = g;
    x.fillRect(0, 0, G.W, G.H);
    P.glow(x, 1040, 300, 420, '#f3efe6', 0.5);
    return L;
  }

  function canopy(x, cx, cy, rx, ry, r, cols, n, size) {
    for (let i = 0; i < n; i++) {
      const a = r() * TAU, d = Math.sqrt(r());
      const lx = cx + Math.cos(a) * rx * d, ly = cy + Math.sin(a) * ry * d;
      const ang = Math.atan2(ly - cy + ry * 0.6, lx - cx) + r.range(-0.6, 0.6);
      const len = size * r.range(0.7, 1.25);
      x.fillStyle = r.pick(cols);
      x.beginPath();
      P.leafPath(x, lx, ly, len, len * 0.36, ang);
      x.fill();
      if (r() < 0.35) {
        x.strokeStyle = 'rgba(200,200,190,0.18)';
        x.lineWidth = 0.8;
        x.beginPath();
        x.moveTo(lx, ly);
        x.lineTo(lx + Math.cos(ang) * len * 0.8, ly + Math.sin(ang) * len * 0.8);
        x.stroke();
      }
    }
  }

  // A parallax band of trunks in screen space.
  function paintTrunkBand(w, o) {
    const L = G.layer(w, G.H, Math.min(G.RS, 1.5));
    const x = L.x;
    const r = M.rng(o.seed);
    let tx = r.range(0, o.gap[0]);
    while (tx < w + 60) {
      const tw = r.range(o.width[0], o.width[1]);
      const lean = r.range(-0.03, 0.03);
      const top = -20, bot = o.base + r.range(-10, 10);
      x.save();
      x.beginPath();
      x.moveTo(tx - tw / 2, bot);
      x.lineTo(tx - tw / 2 + lean * (bot - top), top);
      x.lineTo(tx + tw / 2 + lean * (bot - top), top);
      x.lineTo(tx + tw / 2, bot);
      x.closePath();
      x.fillStyle = r.pick(o.cols);
      x.fill();
      if (o.pattern && r() < 0.5) {
        x.globalAlpha = o.patternAlpha;
        x.fillStyle = P.patternOf(x, o.pattern, o.patternScale);
        x.fill();
        x.globalAlpha = 1;
      }
      const sg = x.createLinearGradient(tx - tw / 2, 0, tx + tw / 2, 0);
      sg.addColorStop(0, 'rgba(0,0,0,0.35)');
      sg.addColorStop(0.45, 'rgba(0,0,0,0)');
      sg.addColorStop(1, 'rgba(0,0,0,0.4)');
      x.fillStyle = sg;
      x.fill();
      x.restore();
      if (o.leaves) canopy(x, tx + r.range(-30, 30), r.range(20, 160), r.range(90, 170), r.range(60, 110), r, o.leafCols, o.leaves, o.leafSize);
      tx += r.range(o.gap[0], o.gap[1]);
    }
    if (o.mist) {
      const g = x.createLinearGradient(0, 0, 0, G.H);
      g.addColorStop(0, M.rgba(o.mist, 0.05));
      g.addColorStop(0.7, M.rgba(o.mist, o.mistA));
      g.addColorStop(1, M.rgba(o.mist, o.mistA * 0.6));
      x.fillStyle = g;
      x.fillRect(0, 0, w, G.H);
    }
    return L;
  }

  function paintMain() {
    const k = M.clamp(ZOOM * G.RS, 0.75, 1.6);
    const L = G.layer(WORLD_W, 1000, k);
    const x = L.x;
    const r = M.rng(202);

    // ---- the torn bedroom
    x.save();
    x.beginPath();
    x.moveTo(-10, 40);
    const edge = [];
    for (let y = 40; y <= 905; y += 18) edge.push([400 + Math.sin(y * 0.021) * 40 + r.range(-26, 26) + (y > 600 ? (y - 600) * 0.25 : 0), y]);
    x.lineTo(edge[0][0], 40);
    for (const p of edge) x.lineTo(p[0], p[1]);
    x.lineTo(-10, 905);
    x.closePath();
    x.fillStyle = '#c8bfae';
    x.fill();
    x.save();
    x.clip();
    x.globalAlpha = 0.7;
    x.fillStyle = P.patternOf(x, P.damaskPale, 1.3);
    x.fillRect(0, 0, 600, 1000);
    x.globalAlpha = 1;
    for (let i = 0; i < 14; i++) P.glow(x, r() * 420, r.range(60, 880), r.range(30, 90), '#4a3a2e', r.range(0.08, 0.18));
    const wg = x.createLinearGradient(0, 0, 450, 0);
    wg.addColorStop(0, 'rgba(20,18,16,0.35)');
    wg.addColorStop(1, 'rgba(20,18,16,0)');
    x.fillStyle = wg;
    x.fillRect(0, 0, 450, 1000);
    x.restore();
    // white paper backing along the tear, and curling shreds
    x.strokeStyle = '#efe9dc';
    x.lineWidth = 7;
    x.beginPath();
    edge.forEach((p, i) => (i ? x.lineTo(p[0] + 2, p[1]) : x.moveTo(p[0] + 2, p[1])));
    x.stroke();
    for (let i = 0; i < 9; i++) {
      const p = edge[r.int(2, edge.length - 3)];
      x.fillStyle = r() < 0.5 ? '#e8e1d3' : '#c8bfae';
      x.beginPath();
      x.moveTo(p[0], p[1]);
      x.quadraticCurveTo(p[0] + r.range(20, 50), p[1] + r.range(-10, 30), p[0] + r.range(10, 40), p[1] + r.range(40, 80));
      x.lineTo(p[0] - 4, p[1] + 20);
      x.closePath();
      x.fill();
    }
    x.restore();
    // broken ceiling beam
    x.fillStyle = '#2b241f';
    x.beginPath();
    x.moveTo(-10, 20);
    x.lineTo(330, 26);
    x.lineTo(350, 48);
    x.lineTo(310, 60);
    x.lineTo(-10, 58);
    x.fill();
    // mirror and a framed fern left on the wall
    x.fillStyle = '#3a2e26';
    x.fillRect(60, 360, 110, 150);
    x.fillStyle = '#8b939a';
    x.fillRect(70, 370, 90, 130);
    x.strokeStyle = 'rgba(255,255,255,0.25)';
    x.lineWidth = 3;
    x.beginPath();
    x.moveTo(80, 480);
    x.lineTo(140, 390);
    x.stroke();
    // the floor, broken off at the right
    x.fillStyle = '#4a3a2f';
    x.beginPath();
    x.moveTo(-10, 895);
    x.lineTo(560, 897);
    for (let i = 0; i < 8; i++) x.lineTo(560 + r.range(-30, 40), 897 + i * 14);
    x.lineTo(-10, 1000);
    x.fill();
    x.strokeStyle = 'rgba(0,0,0,0.35)';
    x.lineWidth = 1.5;
    for (let i = 0; i < 6; i++) {
      x.beginPath();
      x.moveTo(-10, 905 + i * 16);
      x.lineTo(560 - i * 6, 905 + i * 16);
      x.stroke();
    }
    // the iron bed, half in the wreck
    x.fillStyle = '#d9d4cb';
    x.fillRect(-20, 770, 250, 70);
    x.fillStyle = '#b9b2a6';
    x.fillRect(-20, 820, 250, 40);
    x.strokeStyle = '#2d2b29';
    x.lineWidth = 8;
    x.beginPath();
    x.moveTo(236, 905);
    x.lineTo(236, 760);
    x.stroke();
    x.fillStyle = '#7a2a22';
    x.beginPath();
    x.moveTo(40, 780);
    x.lineTo(200, 772);
    x.lineTo(220, 850);
    x.lineTo(60, 870);
    x.fill();

    // ---- grove floor: roots, cobbles, undergrowth
    for (let px = 540; px < WORLD_W; px += 3) {
      const gy = ground(px);
      x.fillStyle = '#1a1816';
      x.fillRect(px, gy + 36, 3, 1000 - gy);
    }
    x.fillStyle = '#26221e';
    x.beginPath();
    x.moveTo(540, ground(540) - 8);
    for (let px = 540; px <= WORLD_W; px += 20) x.lineTo(px, ground(px) - 8);
    x.lineTo(WORLD_W, ground(WORLD_W) + 40);
    x.lineTo(540, ground(540) + 40);
    x.fill();
    // cobblestones
    let cx = 560;
    while (cx < WORLD_W - 40) {
      const w = r.range(34, 70);
      const gy = ground(cx + w / 2);
      for (let row = 0; row < 2; row++) {
        const sy = gy - 6 + row * 20, sw = w * (1 + row * 0.25), sx = cx + (row ? -w * 0.2 : 0);
        x.fillStyle = M.mixColor('#5d5953', '#8a847a', r());
        x.beginPath();
        P.roughRectPath(x, sx + 2, sy, sw - 4, 16 + row * 4, 1.8, r, 8);
        x.fill();
        x.fillStyle = 'rgba(255,250,240,0.1)';
        x.fillRect(sx + 4, sy + 1, sw - 10, 2);
      }
      cx += w + r.range(2, 8);
    }
    // roots crossing the path
    x.strokeStyle = '#141312';
    x.lineCap = 'round';
    for (let i = 0; i < 26; i++) {
      const rx = r.range(600, WORLD_W - 200);
      const gy = ground(rx);
      x.lineWidth = r.range(5, 13);
      x.beginPath();
      x.moveTo(rx, gy - r.range(0, 20));
      x.bezierCurveTo(rx + r.range(20, 60), gy - r.range(10, 30), rx + r.range(40, 110), gy + r.range(10, 30), rx + r.range(90, 180), gy + r.range(20, 60));
      x.stroke();
    }

    // ---- a fragment of the room standing among the trees
    x.save();
    x.translate(1900, ground(1900) - 8);
    x.rotate(-0.04);
    x.beginPath();
    P.roughPolyPath(x, [[-90, 0], [-100, -380], [-40, -420], [70, -400], [95, -250], [80, 0]], true, 7, r, 14);
    x.fillStyle = '#c3b9a7';
    x.fill();
    x.save();
    x.clip();
    x.globalAlpha = 0.7;
    x.fillStyle = P.patternOf(x, P.damaskPale, 1.3);
    x.fillRect(-120, -440, 240, 460);
    x.restore();
    x.strokeStyle = '#efe9dc';
    x.lineWidth = 4;
    x.stroke();
    x.fillStyle = '#3a2e26';
    x.save();
    x.translate(-8, -250);
    x.rotate(0.12);
    x.fillRect(-32, -40, 64, 80);
    x.fillStyle = '#e8e2d4';
    x.fillRect(-26, -34, 52, 68);
    x.strokeStyle = '#5c6b52';
    x.lineWidth = 1.2;
    x.beginPath();
    x.moveTo(0, 28);
    x.lineTo(0, -26);
    for (let i = 0; i < 7; i++) {
      const yy = 22 - i * 7, len = 16 - i * 2;
      x.moveTo(0, yy);
      x.lineTo(-len, yy - 4);
      x.moveTo(0, yy);
      x.lineTo(len, yy - 4);
    }
    x.stroke();
    x.strokeStyle = 'rgba(255,255,255,0.6)';
    x.lineWidth = 1;
    x.beginPath();
    x.moveTo(-20, -30);
    x.lineTo(4, 6);
    x.lineTo(-6, 30);
    x.moveTo(4, 6);
    x.lineTo(22, 14);
    x.stroke();
    x.restore();
    x.restore();

    // ---- main trunks
    const trunks = [640, 910, 1200, 1480, 1700, 2120, 2380, 2660, 2930, 3230, 3500];
    for (const tx of trunks) {
      const tw = r.range(70, 135);
      const gy = ground(tx);
      const lean = r.range(-0.025, 0.025);
      const damask = r() < 0.55;
      x.save();
      x.beginPath();
      x.moveTo(tx - tw / 2 - 18, gy + 14);
      x.quadraticCurveTo(tx - tw / 2, gy - 30, tx - tw / 2, gy - 90);
      x.lineTo(tx - tw / 2 + lean * 900, -10);
      x.lineTo(tx + tw / 2 + lean * 900, -10);
      x.lineTo(tx + tw / 2, gy - 90);
      x.quadraticCurveTo(tx + tw / 2, gy - 30, tx + tw / 2 + 22, gy + 14);
      x.closePath();
      x.fillStyle = damask ? '#b7a68a' : '#1d1c1a';
      x.fill();
      x.clip();
      if (damask) {
        x.fillStyle = P.patternOf(x, P.damaskDark, 1.25);
        x.fillRect(tx - tw, -20, tw * 2, gy + 60);
      } else {
        x.strokeStyle = 'rgba(90,90,86,0.35)';
        x.lineWidth = 1.2;
        for (let i = 0; i < 16; i++) {
          const bx = tx + r.range(-tw / 2, tw / 2);
          x.beginPath();
          P.wobbleLine(x, bx, r.range(0, gy - 200), bx + r.range(-6, 6), r.range(200, gy), 3, r() * 50);
          x.stroke();
        }
      }
      const sg = x.createLinearGradient(tx - tw / 2, 0, tx + tw / 2, 0);
      sg.addColorStop(0, 'rgba(10,10,10,0.7)');
      sg.addColorStop(0.35, 'rgba(10,10,10,0.05)');
      sg.addColorStop(0.7, 'rgba(10,10,10,0.2)');
      sg.addColorStop(1, 'rgba(10,10,10,0.75)');
      x.fillStyle = sg;
      x.fillRect(tx - tw, -20, tw * 2, gy + 60);
      x.restore();
      // flaring roots
      x.fillStyle = '#161514';
      for (const side of [-1, 1]) {
        const len = r.range(50, 100);
        x.beginPath();
        x.moveTo(tx + side * tw * 0.28, gy - 70);
        x.bezierCurveTo(tx + side * tw * 0.52, gy - 30, tx + side * (tw * 0.5 + len * 0.4), gy - 2, tx + side * (tw * 0.5 + len), gy + 16);
        x.bezierCurveTo(tx + side * (tw * 0.5 + len * 0.5), gy + 12, tx + side * tw * 0.4, gy + 14, tx + side * tw * 0.1, gy + 20);
        x.closePath();
        x.fill();
      }
      canopy(x, tx + r.range(-40, 40), r.range(40, 160), r.range(170, 260), r.range(90, 150), r, ['#15181a', '#1f2427', '#2b3135', '#20262a', '#393f44'], 150, 34);
    }
    // brambles
    x.strokeStyle = '#1b1a18';
    x.lineCap = 'round';
    for (let i = 0; i < 20; i++) {
      const bx = r.range(600, WORLD_W - 300), gy = ground(bx);
      let px = bx, py = gy + 20;
      x.lineWidth = r.range(1.5, 3);
      x.beginPath();
      x.moveTo(px, py);
      for (let s = 0; s < 6; s++) {
        const nx = px + r.range(-30, 30), ny = py - r.range(12, 30);
        x.quadraticCurveTo(px + r.range(-20, 20), (py + ny) / 2, nx, ny);
        px = nx;
        py = ny;
        x.moveTo(px, py);
        x.lineTo(px + r.range(-7, 7), py - 6);
        x.moveTo(px, py);
      }
      x.stroke();
    }

    // ---- stone walls and pillars at the gate
    const wallTop = BASE - 330;
    for (const [a, b] of [[3420, PILLARS[0]], [PILLARS[1] + 50, WORLD_W + 10]]) {
      x.fillStyle = '#4c4a46';
      x.fillRect(a, wallTop, b - a, BASE + 40 - wallTop);
      x.fillStyle = '#5d5a55';
      x.fillRect(a - 6, wallTop - 14, b - a + 12, 16);
      x.strokeStyle = 'rgba(20,20,20,0.35)';
      x.lineWidth = 1.5;
      for (let yy = wallTop + 30; yy < BASE + 30; yy += 34) {
        x.beginPath();
        x.moveTo(a, yy);
        x.lineTo(b, yy);
        x.stroke();
        for (let xx = a + ((yy / 34) % 2) * 30; xx < b; xx += 62) {
          x.beginPath();
          x.moveTo(xx, yy);
          x.lineTo(xx, yy + 34);
          x.stroke();
        }
      }
      // ivy
      canopy(x, (a + b) / 2, wallTop + 150, (b - a) / 2 + 20, 200, r, ['#1c211d', '#252c26', '#2f372f', '#161a17'], Math.round((b - a) * 0.9), 16);
    }
    for (const px of PILLARS) {
      const top = BASE - 420;
      x.fillStyle = '#6b6862';
      x.fillRect(px, top, 50, BASE + 30 - top);
      x.fillStyle = 'rgba(0,0,0,0.3)';
      x.fillRect(px + 34, top, 16, BASE + 30 - top);
      x.fillStyle = '#7a766f';
      x.fillRect(px - 6, top - 16, 62, 18);
      x.fillStyle = '#76726b';
      x.beginPath();
      x.arc(px + 25, top - 38, 24, 0, TAU);
      x.fill();
      x.fillStyle = 'rgba(0,0,0,0.3)';
      x.beginPath();
      x.arc(px + 30, top - 34, 20, -0.4, 1.8);
      x.fill();
      x.strokeStyle = 'rgba(20,20,20,0.4)';
      x.lineWidth = 1.2;
      for (let yy = top + 40; yy < BASE; yy += 44) {
        x.beginPath();
        x.moveTo(px, yy);
        x.lineTo(px + 50, yy);
        x.stroke();
      }
      canopy(x, px + 25, top + 160, 40, 160, r, ['#1c211d', '#252c26', '#161a17'], 60, 14);
    }
    P.texturize(L, 0.3);
    return L;
  }

  // Near trunks that pass in front of the camera mid-way (never at the start or the gate).
  function paintForeground(w, from, to) {
    const L = G.layer(w, G.H, Math.min(G.RS, 1.5));
    const x = L.x;
    const r = M.rng(77);
    for (const tx of [from + (to - from) * 0.2, from + (to - from) * 0.78]) {
      const tw = r.range(110, 160);
      x.fillStyle = '#0d0e0e';
      x.beginPath();
      x.moveTo(tx - tw / 2, G.H + 10);
      x.lineTo(tx - tw / 2 + r.range(-20, 20), -10);
      x.lineTo(tx + tw / 2 + r.range(-20, 20), -10);
      x.lineTo(tx + tw / 2, G.H + 10);
      x.fill();
      canopy(x, tx, r.range(0, 30), 200, 60, r, ['#0b0c0c', '#121414', '#191c1d'], 50, 42);
    }
    // undergrowth along the bottom edge
    for (let i = 0; i < w / 6; i++) {
      const bx = r() * w;
      canopy(x, bx, G.H + 34, 50, 26, r, ['#0b0c0c', '#121414', '#16191a'], 3, 34);
    }
    return L;
  }

  // ------------------------------------------------------------ scene
  function Anger(o) {
    o = o || {};
    G.SideScene.call(this, {
      zoom: ZOOM, camY: CAM_Y, minX: 120, maxX: 3935, startX: 260, speed: 230, heroScale: HERO,
      loose: 0.35, camLead: 160, surface: 'stone', glintRange: 380
    });
    this.revisit = !!o.revisit;
    this.finish = { vignette: 1, grain: 0.6 };
    this.gust = 0;
    this.gustPhase = 'calm';
    this.gustT = 0;
    this.gustNext = 3.6;
    this.gustLen = 1.8;
    this.telegraph = 0;
    this.knots = KNOT_Y.map((y, i) => ({ y, p: 0, done: false, i }));
    this.gateAngle = this.revisit ? 1.0 : 0;
    this.gateVel = 0;
    this.gateOpen = this.revisit;
    this.chairUp = this.revisit;
    this.chairTip = this.revisit ? 0 : -1.35;
    this.shoves = 0;
    this.freed = [];
    this.saidGust = false;
    this.saidPush = false;
    this.saidTight = false;
    this.exitAnim = null;
    this.player.alpha = 1;
  }
  Anger.prototype = Object.create(G.SideScene.prototype);
  G.chapters.Anger = Anger;

  Anger.prototype.ground = function (x) { return x < 560 ? BASE - 3 : ground(x); };
  Anger.prototype.surface = function (x) { return x < 560 ? 'wood' : 'stone'; };
  Anger.prototype.speedMul = function (want) {
    const W = this.gust;
    if (want > 0) return Math.max(-0.05, 1 - 1.08 * W);
    if (want < 0) return 1 + 0.35 * W;
    return 1;
  };

  Anger.prototype.enter = function () {
    this.camMinX = G.W / 2 / ZOOM;
    this.camMaxX = WORLD_W - G.W / 2 / ZOOM;
    const span = (this.camMaxX - this.camMinX) * ZOOM;
    this.sky = paintSkyScreen();
    this.far = paintTrunkBand(G.W + span * 0.25 + 40, {
      seed: 5, base: 660, width: [16, 38], gap: [50, 110], cols: ['#737980', '#82888f', '#6a7077'],
      leaves: 40, leafCols: ['#5f666d', '#6c737a', '#565c63'], leafSize: 20, mist: '#d8d3c9', mistA: 0.35
    });
    this.mid = paintTrunkBand(G.W + span * 0.55 + 40, {
      seed: 9, base: 670, width: [34, 70], gap: [130, 240], cols: ['#34373a', '#3d4043', '#2c2f31'],
      pattern: P.damaskDusk, patternAlpha: 0.35, patternScale: 0.9,
      leaves: 70, leafCols: ['#23272a', '#2d3235', '#1c1f21'], leafSize: 26, mist: '#cfcac0', mistA: 0.18
    });
    this.main = paintMain();
    // foreground band is drawn at -(off * ZOOM * 1.35) - 300; keep its trunks out of the first and last screens
    const fgW = G.W + span * 1.35 + 340;
    this.fg = paintForeground(fgW, 300 + G.W + 200, fgW - G.W - 200);
    this.ribbons = [];
    const anchors = [[700, 330], [960, 250], [1230, 420], [1510, 300], [1720, 460], [2140, 280], [2400, 380], [2690, 250], [2950, 420], [3250, 300], [3520, 360]];
    anchors.forEach(([ax, ay], i) => this.ribbons.push(this.makeRibbon(ax, ay, 9 + (i % 3) * 2, 22, i)));
    // long strips pinned between two trunks, as in the concept study
    const spans = [[[955, 300], [1150, 390]], [[1520, 250], [1665, 330]], [[2165, 230], [2330, 330]], [[2700, 300], [2885, 250]], [[3275, 280], [3455, 350]]];
    spans.forEach(([a, b], i) => {
      const d = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const n = 12, seg = d * 1.18 / (n - 1);
      const rb = this.makeRibbon(a[0], a[1], n, seg, 20 + i);
      rb.pts.forEach((p, j) => { p.x = p.px = M.lerp(a[0], b[0], j / (n - 1)); p.y = p.py = M.lerp(a[1], b[1], j / (n - 1)) + Math.sin(j / (n - 1) * Math.PI) * 30; });
      rb.bx = b[0];
      rb.by = b[1];
      rb.w = 22 + (i % 2) * 6;
      rb.garland = true;
      this.ribbons.push(rb);
    });
    this.leaves = [];
    for (let i = 0; i < 70; i++) this.leaves.push({ x: Math.random() * G.W, y: Math.random() * G.H, s: 0.6 + Math.random() * 0.8, p: Math.random() * TAU, paper: Math.random() < 0.18 });
    this.buildItems();
    this.snapCamera();
    G.audio.scene({ wind: 0.9, room: 0.1, drone: [45, 52, 55], droneLevel: 0.24 });
    if (this.revisit) {
      this.gustNext = 1e9;
      G.ui.say('Quiet now. The gate stands open.', { delay: 0.8 });
    } else {
      G.ui.say('The wall gave way.', { delay: 0.8 });
    }
  };

  Anger.prototype.makeRibbon = function (ax, ay, n, seg, seed) {
    const pts = [];
    for (let i = 0; i < n; i++) pts.push({ x: ax - i * seg * 0.3, y: ay + i * seg * 0.9, px: ax - i * seg * 0.3, py: ay + i * seg * 0.9 });
    return { ax, ay, pts, seg, seed, w: 16 + (seed % 4) * 4 };
  };

  Anger.prototype.buildItems = function () {
    this.items = [];
    this.item({
      id: 'chair', x: 380, y: 800, w: 130, h: 100, gx: 440, gy: 860, at: 360,
      use: () => {
        if (!this.chairUp) { this.chairUp = true; G.audio.thud(0.3); G.ui.say('I set it upright.'); this.player.reach = { x: 440, y: 860 }; this.player.reachT = 0.8; }
        else G.ui.say('Upright. For now.');
      }
    });
    this.item({ id: 'mirror', x: 60, y: 360, w: 110, h: 150, at: 160, say: 'The mirror is full of trees.' });
    this.item({ id: 'fragment', x: 1810, y: 480, w: 190, h: 420, gy: 650, at: 1900, say: ['A piece of the bedroom wall.', 'The ferns. The glass is cracked.'] });
    this.item({ id: 'cloth', x: 1180, y: 380, w: 110, h: 220, gx: 1235, gy: 520, at: 1230, say: 'Torn. Everything out here is torn.' });
    if (!this.gateOpen) {
      this.item({
        id: 'gate', x: GATE.x + 10, y: GATE.top, w: GATE.w - 50, h: BASE - GATE.top, gx: GATE.x + 80, gy: 700, at: 3880, face: 1,
        when: () => !this.gateOpen,
        use: () => this.shove()
      });
      this.knots.forEach(k => {
        this.item({
          id: 'knot' + k.i, x: GATE.x + GATE.w - 34, y: k.y - 26, w: 60, h: 52, gx: GATE.x + GATE.w - 4, gy: k.y, at: 3935, face: 1, hold: true,
          when: () => !k.done && !this.gateOpen,
          tap: () => { G.ui.hint('Hold on a knot to untie it', 5); if (!this.saidKnot) { this.saidKnot = true; G.ui.say('Knotted tight. Someone meant it to stay shut.'); } },
          holdTick: (s, dt) => this.untie(k, dt),
          holdEnd: () => {}
        });
      });
    }
    this.gapItem = this.item({
      id: 'gap', x: GATE.x + 90, y: GATE.top, w: GATE.w - 80, h: BASE - GATE.top, gx: GATE.x + 160, gy: 740, at: 3935, face: 1, big: true, reach: false,
      when: () => this.gateOpen && this.gateAngle > 0.6 && !this.exitAnim,
      use: () => this.walkThrough()
    });
  };

  Anger.prototype.shove = function () {
    this.shoves++;
    this.gateKick = 1;
    G.audio.thud(0.8);
    this.player.reach = { x: GATE.x + 90, y: 720 };
    this.player.reachT = 0.5;
    const lines = ['It won’t give.', 'It won’t give.', 'My hands sting.', 'It’s tied shut. Three knots.'];
    G.ui.say(lines[Math.min(this.shoves - 1, lines.length - 1)]);
    if (this.shoves >= 3) G.ui.hint('Hold on a knot to untie it', 6);
  };

  Anger.prototype.untie = function (k, dt) {
    if (this.gust > 0.38) {
      k.p = Math.max(0, k.p - dt * 0.55);
      k.strain = 1;
      if (!this.saidTight) {
        this.saidTight = true;
        G.ui.say('Pulling only makes it tighter.');
        G.ui.hint('Wait for the wind to drop', 6);
      }
      return false;
    }
    const before = k.p;
    k.p = Math.min(1, k.p + dt / 1.5);
    if (Math.floor(before * 5) !== Math.floor(k.p * 5)) G.audio.stitch();
    if (k.p >= 1) {
      k.done = true;
      G.audio.chime([57, 60, 64][this.knots.filter(q => q.done).length - 1], 0.16);
      const fr = this.makeRibbon(GATE.x + GATE.w + 2, k.y, 8, 18, 40 + k.i);
      fr.free = true;
      fr.life = 3;
      this.freed.push(fr);
      const left = this.knots.filter(q => !q.done).length;
      if (left === 2) G.ui.say('One loose.');
      else if (left === 1) G.ui.say('Another.');
      else this.release();
      return true;
    }
    return false;
  };

  // All knots undone: the wind that fought you opens the gate.
  Anger.prototype.release = function () {
    G.ui.hint(null);
    this.gustPhase = 'final';
    this.gustT = 0;
    this.locked = true;
    this.player.target = null;
  };

  Anger.prototype.walkThrough = function () {
    this.locked = true;
    this.exitAnim = { t: 0, x0: this.player.x };
    G.ui.hint(null);
  };

  Anger.prototype.updateWind = function (dt) {
    this.gustT += dt;
    let target = 0;
    if (this.revisit) target = 0;
    else if (this.gustPhase === 'calm') {
      target = 0;
      this.telegraph = M.smoothstep(this.gustNext - 1.0, this.gustNext, this.gustT);
      if (this.gustT >= this.gustNext) {
        this.gustPhase = 'gust';
        this.gustT = 0;
        this.gustLen = 1.5 + Math.random() * 1.0;
        G.audio.rustle(0.06);
        if (!this.saidGust) { this.saidGust = true; G.ui.say('Of course.'); }
      }
    } else if (this.gustPhase === 'gust') {
      target = 1;
      this.telegraph = 0;
      if (this.gustT >= this.gustLen) {
        this.gustPhase = 'calm';
        this.gustT = 0;
        this.gustNext = 3.4 + Math.random() * 2.4;
      }
    } else if (this.gustPhase === 'final') {
      // one last push swings the gate open, then the wind drops away
      target = this.gustT < 0.8 ? 0 : this.gustT < 2.2 ? 1 : 0;
      if (this.gustT >= 1.0 && !this.gateOpen) {
        this.gateOpen = true;
        this.gateVel = 3.2;
        G.audio.thud(1.2);
        this.cam.shake = 6;
        G.ui.say(['The wind opens it.', 'A narrow way through.']);
        G.audio.chord([45, 52, 57], 3);
      }
      if (this.gustT >= 2.6) { this.gustPhase = 'still'; this.locked = false; }
    } else target = 0;
    const rate = target > this.gust ? 2.4 : 1.2;
    this.gust = M.damp(this.gust, target, rate, dt);
    const W = this.gust;
    const base = this.revisit || this.gustPhase === 'still' ? 0.08 : 0.2;
    this.windNow = base + W;
    G.audio.gust = this.gateOpen && this.gustPhase === 'still' ? 0.05 : W;
    if (this.gustPhase === 'still' || this.revisit) G.audio.targets.wind = 0.35;
    // walking into a strong gust: legs keep working, progress stalls, a little is lost
    const pl = this.player;
    const trying = !this.locked && (G.input.axis() > 0 || (pl.target != null && pl.target > pl.x + 5) || (this.pending && this.itemAt(this.pending) > pl.x + 5));
    this.struggling = trying && W > 0.5;
    this.drift = this.struggling ? -(W - 0.5) * 70 : 0;
    pl.wind = 0.15 + W;
    const facingWind = pl.dir > 0 ? 1 : -0.4;
    pl.lean = M.damp(pl.lean, W * 0.22 * facingWind * (Math.abs(pl.vel) > 5 || this.holding ? 1 : 0.6), 5, dt);
    if (W > 0.8 && !this.saidPush && Math.abs(this.drift) > 20 && G.input.axis() > 0) {
      this.saidPush = true;
      G.ui.say('It pushes back. Everything pushes back.');
    }
    this.cam.shake = Math.max(this.cam.shake * Math.exp(-6 * dt), W > 0.7 ? (W - 0.7) * 5 : 0);
  };

  Anger.prototype.update = function (dt) {
    this.updateWind(dt);
    if (this.exitAnim) {
      this.t += dt;
      const a = this.exitAnim, pl = this.player;
      a.t += dt;
      const u = Math.min(1, a.t / 1.3);
      pl.x = M.lerp(a.x0, GATE.x + GATE.w - 40, u);
      pl.y = M.lerp(ground(a.x0), BASE - 40, u);
      pl.s = M.lerp(HERO, HERO * 0.78, u);
      pl.alpha = 1 - M.smoothstep(0.55, 1, u);
      pl.walk = 1;
      pl.dir = 1;
      pl.phase += dt * 5;
      this.updateCamera(dt);
      if (a.t > 1.5 && !a.done) { a.done = true; G.flow.complete(1); }
    } else {
      this.sideUpdate(dt);
      if (this.struggling) {
        this.player.walk = Math.max(this.player.walk, 0.6);
        this.player.phase += dt * 4.5;
      }
    }
    // gate: strains while tied, swings when released
    if (!this.gateOpen) {
      this.gateAngle = 0.025 * this.gust * Math.sin(this.t * 17) + (this.gateKick || 0) * 0.04 * Math.sin(this.t * 40);
      if (this.gateKick) this.gateKick = Math.max(0, this.gateKick - dt * 3);
      if (this.gust > 0.85 && Math.random() < dt * 1.5) G.audio.thud(0.25);
    } else if (!this.revisit) {
      const targetA = 1.0;
      this.gateVel += (targetA - this.gateAngle) * 14 * dt - this.gateVel * 2.2 * dt;
      this.gateAngle = Math.min(1.25, this.gateAngle + this.gateVel * dt);
    }
    if (!this.chairUp) this.chairTip = -1.35 + Math.sin(this.t * 8) * 0.03 * this.gust;
    else this.chairTip = M.damp(this.chairTip, 0, 8, dt);
    // cloth
    const W = this.windNow || 0.2;
    for (const rb of this.ribbons) this.stepRibbon(rb, dt, W);
    for (const fr of this.freed) {
      fr.life -= dt;
      fr.ax -= (260 + W * 300) * dt;
      fr.ay -= 40 * dt;
      this.stepRibbon(fr, dt, W + 0.6);
    }
    this.freed = this.freed.filter(f => f.life > 0);
    for (const l of this.leaves) {
      const sp = 60 + W * 1100 + this.telegraph * 200;
      l.x -= sp * l.s * dt;
      l.y += Math.sin(this.t * 3 + l.p) * 40 * dt + 20 * dt;
      l.p += dt * (2 + W * 6);
      if (l.x < -30) { l.x = G.W + 30 + Math.random() * 200; l.y = Math.random() * G.H * 0.9; }
      if (l.y > G.H + 20) l.y = -20;
    }
  };

  Anger.prototype.stepRibbon = function (rb, dt, W) {
    const pts = rb.pts;
    pts[0].x = rb.ax;
    pts[0].y = rb.ay;
    const gx = -(60 + W * 900), gy = 420 - W * 200;
    const d2 = dt * dt;
    const last = rb.bx != null ? pts.length - 1 : pts.length;
    for (let i = 1; i < last; i++) {
      const p = pts[i];
      // a ripple travelling down the strip
      const wave = this.t * (4 + W * 7) - i * 0.8 + rb.seed;
      const turb = Math.sin(wave) * (160 + W * 760);
      const turbX = Math.cos(wave * 0.7) * (40 + W * 200);
      const vx = (p.x - p.px) * 0.96, vy = (p.y - p.py) * 0.96;
      p.px = p.x;
      p.py = p.y;
      p.x += vx + (gx * (rb.garland ? 0.35 : 1) + turbX) * d2;
      p.y += vy + (gy + turb) * d2;
    }
    if (rb.bx != null) { const e = pts[pts.length - 1]; e.x = e.px = rb.bx; e.y = e.py = rb.by; }
    for (let it = 0; it < 4; it++) {
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1], b = pts[i];
        const dx = b.x - a.x, dy = b.y - a.y;
        const d = Math.hypot(dx, dy) || 1;
        const diff = (d - rb.seg) / d;
        const bPinned = rb.bx != null && i === pts.length - 1;
        if (i === 1 && !bPinned) { b.x -= dx * diff; b.y -= dy * diff; }
        else if (bPinned && i !== 1) { a.x += dx * diff; a.y += dy * diff; }
        else if (!bPinned) { a.x += dx * diff * 0.5; a.y += dy * diff * 0.5; b.x -= dx * diff * 0.5; b.y -= dy * diff * 0.5; }
      }
    }
  };

  Anger.prototype.drawGate = function (x) {
    const th = Math.max(0, this.gateAngle);
    const w = GATE.w, h = BASE + 10 - GATE.top;
    const x0 = GATE.x, y0 = GATE.top;
    // light beyond the gate
    x.save();
    x.beginPath();
    x.rect(x0, y0 - 40, w, h + 40);
    x.clip();
    const g = x.createLinearGradient(0, y0, 0, BASE);
    g.addColorStop(0, '#e9e5dc');
    g.addColorStop(1, '#b9b7ad');
    x.fillStyle = g;
    x.fillRect(x0, y0 - 40, w, h + 40);
    x.fillStyle = 'rgba(120,128,126,0.55)';
    for (let i = 0; i < 7; i++) x.fillRect(x0 + 10 + i * 30, y0 + 30 + (i % 3) * 20, 10, h);
    x.fillStyle = '#9d988d';
    x.beginPath();
    x.moveTo(x0 + w * 0.3, BASE + 10);
    x.lineTo(x0 + w * 0.55, BASE - 60);
    x.lineTo(x0 + w * 0.65, BASE - 60);
    x.lineTo(x0 + w, BASE + 10);
    x.fill();
    x.restore();
    // the leaf, swinging away from us
    const ww = w * Math.cos(Math.min(th, 1.45));
    const recede = h * 0.06 * Math.sin(th);
    const q = (u, v) => [x0 + ww * u, M.lerp(y0 + recede * u, y0 + h - recede * u, v)];
    const poly = pts => { x.beginPath(); pts.forEach((p, i) => (i ? x.lineTo(p[0], p[1]) : x.moveTo(p[0], p[1]))); x.closePath(); };
    poly([q(0, 0), q(1, 0), q(1, 1), q(0, 1)]);
    x.fillStyle = '#3d3229';
    x.fill();
    x.save();
    x.clip();
    const boards = 7;
    for (let i = 0; i < boards; i++) {
      const a = q(i / boards, 0), b = q((i + 1) / boards, 1);
      x.fillStyle = i % 2 ? '#4a3d32' : '#43372d';
      x.fillRect(a[0], Math.min(a[1], y0), b[0] - a[0] - 1, h + 20);
      x.strokeStyle = 'rgba(0,0,0,0.4)';
      x.lineWidth = 1;
      x.beginPath();
      x.moveTo(a[0] + 4, y0 + 20);
      x.lineTo(a[0] + 6, y0 + h - 30);
      x.stroke();
    }
    x.restore();
    x.strokeStyle = '#2a221c';
    x.lineWidth = 12;
    for (const v of [0.18, 0.82]) {
      const a = q(0, v), b = q(1, v);
      x.beginPath();
      x.moveTo(a[0], a[1]);
      x.lineTo(b[0], b[1]);
      x.stroke();
    }
    const a = q(0.05, 0.8), b = q(0.95, 0.2);
    x.lineWidth = 10;
    x.beginPath();
    x.moveTo(a[0], a[1]);
    x.lineTo(b[0], b[1]);
    x.stroke();
    // thorny vine over the gate
    x.strokeStyle = '#161514';
    x.lineWidth = 3;
    x.beginPath();
    const v0 = q(0, 0.3);
    x.moveTo(v0[0], v0[1]);
    for (let i = 1; i <= 6; i++) {
      const p = q(i / 6, 0.3 + Math.sin(i * 1.7) * 0.15);
      x.lineTo(p[0], p[1]);
    }
    x.stroke();
  };

  Anger.prototype.drawKnot = function (x, k) {
    if (k.done) return;
    const kx = GATE.x + GATE.w - 4, ky = k.y;
    const loose = k.p;
    const W = this.gust;
    x.save();
    x.translate(kx, ky);
    // binding wrapped around gate edge and pillar
    x.fillStyle = C.oxblood;
    x.fillRect(-14, -9, 34, 18);
    x.strokeStyle = 'rgba(236,226,208,0.6)';
    x.lineWidth = 1;
    x.beginPath();
    for (let i = 0; i < 5; i++) { x.moveTo(-12 + i * 7, -8); x.lineTo(-8 + i * 7, 8); }
    x.stroke();
    // bow loops loosen as it's worked
    const lr = 10 + loose * 12, sag = loose * 14;
    x.fillStyle = C.oxbloodLight;
    for (const s of [-1, 1]) {
      x.beginPath();
      x.ellipse(s * lr * 0.8, -2 + sag * 0.3, lr, 6 + loose * 3, s * (0.4 + loose * 0.6), 0, TAU);
      x.fill();
    }
    x.fillStyle = C.oxblood;
    x.beginPath();
    x.arc(0, 0, 7, 0, TAU);
    x.fill();
    // tails whipping in the wind
    x.strokeStyle = C.oxblood;
    x.lineWidth = 6;
    x.lineCap = 'round';
    for (const s of [0, 1]) {
      const len = 26 + loose * 26;
      x.beginPath();
      x.moveTo(0, 4);
      x.quadraticCurveTo(-len * 0.5 - W * 20, 12 + s * 8 + Math.sin(this.t * 13 + s) * 6 * (0.3 + W), -len - W * 30, 16 + s * 12 + Math.sin(this.t * 9 + s * 2) * 10 * (0.3 + W));
      x.stroke();
    }
    // progress ring
    if (k.p > 0.01 || this.holding && this.holding.id === 'knot' + k.i) {
      x.strokeStyle = k.strain && this.gust > 0.38 ? 'rgba(220,120,100,0.8)' : 'rgba(214,186,147,0.9)';
      x.lineWidth = 2.5;
      x.setLineDash([5, 4]);
      x.beginPath();
      x.arc(0, 0, 30, -Math.PI / 2, -Math.PI / 2 + TAU * k.p);
      x.stroke();
      x.setLineDash([]);
    }
    x.restore();
  };

  Anger.prototype.draw = function (x) {
    const cam = this.cam;
    x.drawImage(this.sky.c, 0, 0, G.W, G.H);
    const off = cam.x - this.camMinX;
    x.drawImage(this.far.c, -off * ZOOM * 0.25, 0, this.far.w, G.H);
    x.drawImage(this.mid.c, -off * ZOOM * 0.55, 0, this.mid.w, G.H);

    x.save();
    cam.apply(x);
    x.drawImage(this.main.c, 0, 0, WORLD_W, 1000);
    this.drawGate(x);
    for (const k of this.knots) this.drawKnot(x, k);
    P.chair(x, 445, BASE - 2, { s: 165, facing: -1, tip: this.chairTip, throwColor: C.ochre });
    for (const rb of this.ribbons) P.ribbon(x, rb.pts.map(p => [p.x, p.y]), { width: rb.w, seed: rb.seed, taper: rb.garland ? false : undefined });
    for (const fr of this.freed) {
      x.save();
      x.globalAlpha = Math.min(1, fr.life);
      P.ribbon(x, fr.pts.map(p => [p.x, p.y]), { width: 14, seed: fr.seed });
      x.restore();
    }
    this.drawPlayer(x, { alpha: this.player.alpha, s: this.player.s });
    if (!this.locked) this.drawGlints(x);
    x.restore();

    // wind-borne leaves and paper
    const W = this.windNow || 0.2;
    x.save();
    for (const l of this.leaves) {
      const a = M.clamp(0.15 + W * 0.9 + this.telegraph * 0.3, 0, 1);
      x.globalAlpha = a * (l.paper ? 0.8 : 0.9);
      x.fillStyle = l.paper ? '#e6dfd0' : '#141617';
      x.beginPath();
      if (l.paper) {
        x.save();
        x.translate(l.x, l.y);
        x.rotate(l.p);
        x.fillRect(-5 * l.s, -3 * l.s, 10 * l.s, 7 * l.s);
        x.restore();
      } else P.leafPath(x, l.x, l.y, 16 * l.s, 6 * l.s, l.p);
      x.fill();
    }
    x.restore();

    x.drawImage(this.fg.c, -off * ZOOM * 1.35 - 300, 0, this.fg.w, G.H);
  };
})();
