/* paint.js: the shared visual grammar.
 * cut paper / charcoal / frayed linen / stained wood / gouache / photographic light
 */
(function () {
  'use strict';
  const G = window.G, M = G.M, C = G.C;
  const P = (G.paint = {});
  const TAU = M.TAU;

  // ------------------------------------------------------------ finishing layers
  let grainTile = null, vignette = null, tornFrame = null;

  function makeGrain() {
    const n = 256;
    const c = document.createElement('canvas');
    c.width = c.height = n;
    const x = c.getContext('2d');
    const img = x.createImageData(n, n);
    const r = M.rng(99);
    for (let i = 0; i < n * n; i++) {
      const px = i % n, py = (i / n) | 0;
      // fine tooth plus a slow mottle, like cold-press paper
      const mott = M.noise2(px / 23, py / 23) * 0.5 + M.noise2(px / 7, py / 7) * 0.25;
      const v = r() - 0.5 + mott * 0.25;
      const o = i * 4;
      if (v > 0) {
        img.data[o] = 245; img.data[o + 1] = 238; img.data[o + 2] = 226;
        img.data[o + 3] = Math.min(255, v * 44);
      } else {
        img.data[o] = 10; img.data[o + 1] = 9; img.data[o + 2] = 8;
        img.data[o + 3] = Math.min(255, -v * 62);
      }
    }
    x.putImageData(img, 0, 0);
    // fibres
    x.lineCap = 'round';
    for (let i = 0; i < 70; i++) {
      const fx = r() * n, fy = r() * n, len = r.range(6, 22), a = r() * TAU;
      x.strokeStyle = r() < 0.5 ? 'rgba(250,244,232,0.10)' : 'rgba(0,0,0,0.10)';
      x.lineWidth = r.range(0.4, 1.1);
      x.beginPath();
      x.moveTo(fx, fy);
      x.quadraticCurveTo(fx + Math.cos(a + 0.6) * len * 0.5, fy + Math.sin(a + 0.6) * len * 0.5,
        fx + Math.cos(a) * len, fy + Math.sin(a) * len);
      x.stroke();
    }
    return c;
  }

  function makeVignette() {
    const L = G.layer(G.W, G.H, 1);
    const g = L.x.createRadialGradient(G.W / 2, G.H * 0.46, 260, G.W / 2, G.H * 0.5, 860);
    g.addColorStop(0, 'rgba(8,10,9,0)');
    g.addColorStop(0.6, 'rgba(8,10,9,0.18)');
    g.addColorStop(1, 'rgba(8,10,9,0.72)');
    L.x.fillStyle = g;
    L.x.fillRect(0, 0, G.W, G.H);
    return L;
  }

  // Rough deckled border, like the marked-paper studies for the later levels.
  function makeTornFrame() {
    const L = G.layer(G.W, G.H);
    const x = L.x;
    const r = M.rng(4242);
    x.fillStyle = '#0e100f';
    x.fillRect(0, 0, G.W, G.H);
    x.globalCompositeOperation = 'destination-out';
    x.beginPath();
    P.roughRectPath(x, 7, 7, G.W - 14, G.H - 14, 4, r, 9);
    x.fill();
    x.globalCompositeOperation = 'source-over';
    // paper margin
    x.save();
    x.beginPath();
    P.roughRectPath(x, 7, 7, G.W - 14, G.H - 14, 4, M.rng(4242), 9);
    x.clip();
    x.fillStyle = '#d9d0c1';
    x.beginPath();
    x.rect(0, 0, G.W, G.H);
    P.roughRectPath(x, 15, 15, G.W - 30, G.H - 30, 5, r, 7);
    x.fill('evenodd');
    x.restore();
    // cut out the picture area
    x.globalCompositeOperation = 'destination-out';
    x.beginPath();
    P.roughRectPath(x, 15, 15, G.W - 30, G.H - 30, 5, M.rng(77), 7);
    x.fill();
    x.globalCompositeOperation = 'source-over';
    // watercolour tide-line just inside the edge
    x.save();
    x.beginPath();
    P.roughRectPath(x, 15, 15, G.W - 30, G.H - 30, 5, M.rng(77), 7);
    x.clip();
    // layered strokes instead of a blur filter (Safari ignores canvas filters)
    for (const [w, a] of [[26, 0.05], [16, 0.07], [9, 0.09], [4, 0.12]]) {
      x.strokeStyle = 'rgba(40,30,22,' + a + ')';
      x.lineWidth = w;
      x.stroke();
    }
    x.restore();
    return L;
  }

  P.init = function () {
    grainTile = makeGrain();
    vignette = makeVignette();
    tornFrame = makeTornFrame();
    P.damaskPale = P.damask('#8f9aa0', '#cfc6b4', 58, 84, 0.45);
    P.damaskDark = P.damask('#2e3844', '#b9a888', 46, 66, 0.9);
    P.damaskDusk = P.damask('#3a4452', '#8d7f6c', 46, 66, 0.8);
  };

  // Scene-controlled finishing: vignette, torn frame and paper grain, pre-composited into
  // one overlay at stage resolution so each frame pays for a single full-screen draw.
  let overlay = null, overlayKey = '';
  P.finish = function (ctx, scene) {
    const o = (scene && scene.finish) || {};
    const va = o.vignette == null ? 1 : o.vignette;
    const ga = o.grain == null ? 0.7 : o.grain;
    const torn = o.frame === 'torn';
    const k = G.view.k;
    const key = va + '|' + ga + '|' + torn + '|' + G.stage.width + 'x' + G.stage.height;
    if (key !== overlayKey) {
      if (overlay) { overlay.c.width = 0; overlay.c.height = 0; }
      overlay = G.layer(G.W, G.H, k);
      overlayKey = key;
      const x = overlay.x;
      if (va > 0) { x.globalAlpha = va; x.drawImage(vignette.c, 0, 0, G.W, G.H); }
      if (torn) { x.globalAlpha = 1; x.drawImage(tornFrame.c, 0, 0, G.W, G.H); }
      if (ga > 0 && grainTile) {
        x.globalAlpha = ga;
        x.fillStyle = x.createPattern(grainTile, 'repeat');
        x.fillRect(0, 0, G.W, G.H);
      }
    }
    ctx.drawImage(overlay.c, 0, 0, G.W, G.H);
  };

  // Bake grain into a painted layer.
  P.texturize = function (L, alpha) {
    if (!grainTile) return;
    const x = L.x;
    x.save();
    x.globalAlpha = alpha;
    x.fillStyle = x.createPattern(grainTile, 'repeat');
    x.fillRect(0, 0, L.w, L.h);
    x.restore();
  };

  // ------------------------------------------------------------ rough geometry
  // Adds a jittered polyline through pts to the current path (torn paper edges).
  P.roughPolyPath = function (x, pts, closed, jitter, r, step) {
    step = step || 12;
    const n = pts.length;
    const count = closed ? n : n - 1;
    let first = true;
    for (let i = 0; i < count; i++) {
      const a = pts[i], b = pts[(i + 1) % n];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const segs = Math.max(1, Math.round(len / step));
      const nx = -(b[1] - a[1]) / (len || 1), ny = (b[0] - a[0]) / (len || 1);
      for (let s = 0; s < segs; s++) {
        const t = s / segs;
        const j = (r() - 0.5) * 2 * jitter;
        const px = a[0] + (b[0] - a[0]) * t + nx * j;
        const py = a[1] + (b[1] - a[1]) * t + ny * j;
        if (first) { x.moveTo(px, py); first = false; } else x.lineTo(px, py);
      }
    }
    if (closed) x.closePath();
    else x.lineTo(pts[n - 1][0], pts[n - 1][1]);
  };
  P.roughRectPath = function (x, rx, ry, w, h, jitter, r, step) {
    P.roughPolyPath(x, [[rx, ry], [rx + w, ry], [rx + w, ry + h], [rx, ry + h]], true, jitter, r || Math.random, step);
  };

  // A hand-held line: slight wobble along its length.
  P.wobbleLine = function (x, x1, y1, x2, y2, amp, seed) {
    const len = Math.hypot(x2 - x1, y2 - y1);
    const segs = Math.max(2, Math.round(len / 14));
    const nx = -(y2 - y1) / (len || 1), ny = (x2 - x1) / (len || 1);
    x.moveTo(x1, y1);
    for (let i = 1; i <= segs; i++) {
      const t = i / segs;
      const w = i === segs ? 0 : M.noise1(seed + t * len / 40) * amp;
      x.lineTo(x1 + (x2 - x1) * t + nx * w, y1 + (y2 - y1) * t + ny * w);
    }
  };

  // Whipstitch across a seam from (x1,y1) to (x2,y2).
  P.whipstitch = function (x, x1, y1, x2, y2, o) {
    o = o || {};
    const gap = o.gap || 9, len = o.len || 6;
    const dist = Math.hypot(x2 - x1, y2 - y1);
    if (dist < 1) return;
    const ux = (x2 - x1) / dist, uy = (y2 - y1) / dist;
    const nx = -uy, ny = ux;
    const count = Math.floor(dist / gap);
    const upto = o.progress == null ? count : Math.floor(count * o.progress);
    x.save();
    x.strokeStyle = o.color || 'rgba(236,228,212,0.8)';
    x.lineWidth = o.width || 1.2;
    x.lineCap = 'round';
    x.beginPath();
    for (let i = 0; i <= upto && i <= count; i++) {
      const cx = x1 + ux * (i * gap + gap * 0.5), cy = y1 + uy * (i * gap + gap * 0.5);
      x.moveTo(cx - nx * len * 0.5 - ux * 2, cy - ny * len * 0.5 - uy * 2);
      x.lineTo(cx + nx * len * 0.5 + ux * 2, cy + ny * len * 0.5 + uy * 2);
    }
    x.stroke();
    if (o.seam) {
      x.strokeStyle = o.seam;
      x.lineWidth = 0.8;
      x.beginPath();
      x.moveTo(x1, y1);
      x.lineTo(x2, y2);
      x.stroke();
    }
    x.restore();
  };

  // Running stitch along a polyline (dashes), used for the red thread.
  P.runningStitch = function (x, pts, o) {
    o = o || {};
    x.save();
    x.strokeStyle = o.color || C.oxbloodLight;
    x.lineWidth = o.width || 2;
    x.lineCap = 'round';
    x.setLineDash(o.dash || [7, 6]);
    x.lineDashOffset = o.offset || 0;
    x.beginPath();
    for (let i = 0; i < pts.length; i++) {
      if (i === 0) x.moveTo(pts[i][0], pts[i][1]); else x.lineTo(pts[i][0], pts[i][1]);
    }
    x.stroke();
    x.restore();
  };

  // Soft radial blob.
  P.glow = function (x, cx, cy, r, color, alpha) {
    const g = x.createRadialGradient(cx, cy, 0, cx, cy, r);
    g.addColorStop(0, M.rgba(color, alpha));
    g.addColorStop(1, M.rgba(color, 0));
    x.fillStyle = g;
    x.fillRect(cx - r, cy - r, r * 2, r * 2);
  };

  // Charcoal hatching inside the current clip.
  P.hatch = function (x, rx, ry, w, h, o) {
    o = o || {};
    const ang = o.angle == null ? -0.9 : o.angle;
    const gap = o.gap || 7;
    const r = o.rng || M.rng(5);
    x.save();
    x.strokeStyle = o.color || 'rgba(20,18,16,0.25)';
    x.lineWidth = o.width || 1;
    x.lineCap = 'round';
    const ca = Math.cos(ang), sa = Math.sin(ang);
    const diag = Math.hypot(w, h);
    const cx = rx + w / 2, cy = ry + h / 2;
    x.beginPath();
    for (let d = -diag / 2; d < diag / 2; d += gap * r.range(0.7, 1.3)) {
      const px = cx - sa * d, py = cy + ca * d;
      const l = diag / 2 * r.range(0.6, 1);
      x.moveTo(px - ca * l, py - sa * l);
      x.lineTo(px + ca * l, py + sa * l);
    }
    x.stroke();
    x.restore();
  };

  // ------------------------------------------------------------ patterns
  // Damask wallpaper motif. The same print lines the bedroom and, later, the anger grove.
  P.damask = function (fg, bg, w, h, strength) {
    const L = G.layer(w, h, 2);
    const x = L.x;
    x.fillStyle = bg;
    x.fillRect(0, 0, w, h);
    x.fillStyle = M.rgba(fg, strength);
    const motif = (cx, cy, s) => {
      x.save();
      x.translate(cx, cy);
      for (const m of [1, -1]) {
        x.save();
        x.scale(m, 1);
        x.beginPath();
        x.moveTo(0, -0.04 * s);
        x.bezierCurveTo(0.22 * s, -0.26 * s, 0.46 * s, -0.08 * s, 0.32 * s, 0.12 * s);
        x.bezierCurveTo(0.24 * s, 0.22 * s, 0.1 * s, 0.14 * s, 0.13 * s, 0.03 * s);
        x.bezierCurveTo(0.15 * s, -0.04 * s, 0.07 * s, -0.06 * s, 0, 0.1 * s);
        x.fill();
        x.beginPath();
        x.moveTo(0, -0.24 * s);
        x.quadraticCurveTo(0.2 * s, -0.33 * s, 0.22 * s, -0.5 * s);
        x.quadraticCurveTo(0.06 * s, -0.46 * s, 0, -0.3 * s);
        x.fill();
        x.beginPath();
        x.moveTo(0, 0.2 * s);
        x.quadraticCurveTo(0.2 * s, 0.24 * s, 0.25 * s, 0.42 * s);
        x.quadraticCurveTo(0.08 * s, 0.41 * s, 0, 0.3 * s);
        x.fill();
        x.restore();
      }
      x.fillRect(-0.018 * s, -0.46 * s, 0.036 * s, 0.9 * s);
      x.beginPath();
      x.ellipse(0, -0.52 * s, 0.055 * s, 0.1 * s, 0, 0, TAU);
      x.fill();
      x.beginPath();
      x.arc(0, 0.04 * s, 0.07 * s, 0, TAU);
      x.fill();
      x.restore();
    };
    const s = h * 0.5;
    motif(w / 2, h / 2, s);
    motif(0, 0, s); motif(w, 0, s); motif(0, h, s); motif(w, h, s);
    // print wear
    const r = M.rng(w * 31 + h);
    x.globalCompositeOperation = 'destination-out';
    for (let i = 0; i < 40; i++) {
      x.fillStyle = 'rgba(0,0,0,' + r.range(0.05, 0.25) + ')';
      x.beginPath();
      x.arc(r() * w, r() * h, r.range(1, 5), 0, TAU);
      x.fill();
    }
    x.globalCompositeOperation = 'destination-over';
    x.fillStyle = bg;
    x.fillRect(0, 0, w, h);
    x.globalCompositeOperation = 'source-over';
    return L;
  };
  // A CanvasPattern for a damask layer, scaled to logical units.
  P.patternOf = function (ctx, L, scale) {
    const p = ctx.createPattern(L.c, 'repeat');
    const k = (scale || 1) / L.k;
    if (p.setTransform && window.DOMMatrix) p.setTransform(new DOMMatrix([k, 0, 0, k, 0, 0]));
    return p;
  };

  // Ovate leaf path (Earle-style designed foliage).
  P.leafPath = function (x, cx, cy, len, wid, ang) {
    const ca = Math.cos(ang), sa = Math.sin(ang);
    const tx = cx + ca * len, ty = cy + sa * len;
    const mx = cx + ca * len * 0.45, my = cy + sa * len * 0.45;
    x.moveTo(cx, cy);
    x.quadraticCurveTo(mx - sa * wid, my + ca * wid, tx, ty);
    x.quadraticCurveTo(mx + sa * wid, my - ca * wid, cx, cy);
  };

  // ------------------------------------------------------------ skies and water
  // Overcast sky painted in gouache-like washes. o: {top, bottom, light, shadow, seed, clouds, bright}
  P.paintSky = function (w, h, o) {
    const L = G.layer(w, h, o.rs || Math.min(G.RS, 1.5));
    const x = L.x;
    const r = M.rng(o.seed || 1);
    const g = x.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, o.top);
    g.addColorStop(1, o.bottom);
    x.fillStyle = g;
    x.fillRect(0, 0, w, h);
    if (o.bright) {
      const b = o.bright;
      P.glow(x, b.x, b.y, b.r, b.color, b.alpha);
    }
    const clouds = o.clouds == null ? 22 : o.clouds;
    for (let i = 0; i < clouds; i++) {
      const cx = r() * w, cy = h * r.range(0.04, o.maxY || 0.78);
      const cw = r.range(180, 520) * (o.scale || 1), chh = cw * r.range(0.22, 0.4);
      const blobs = Math.round(cw / 10);
      for (let j = 0; j < blobs; j++) {
        const bx = cx + r.range(-0.5, 0.5) * cw;
        const by = cy + r.range(-0.5, 0.5) * chh * (1 - Math.abs(bx - cx) / cw);
        const br = r.range(0.18, 0.4) * chh + 10;
        const vy = (by - (cy - chh / 2)) / chh; // 0 top .. 1 bottom
        const col = M.mixColor(o.light, o.shadow, M.clamp(vy * 1.1 + r.range(-0.15, 0.15), 0, 1));
        const gg = x.createRadialGradient(bx, by, 0, bx, by, br);
        gg.addColorStop(0, M.rgba(col, r.range(0.18, 0.36)));
        gg.addColorStop(1, M.rgba(col, 0));
        x.fillStyle = gg;
        x.fillRect(bx - br, by - br, br * 2, br * 2);
      }
    }
    // dry-brush drag
    x.lineCap = 'round';
    for (let i = 0; i < (o.strokes || 160); i++) {
      const sx = r() * w, sy = r() * h * 0.9, len = r.range(30, 160);
      x.strokeStyle = r() < 0.5 ? M.rgba(o.light, r.range(0.03, 0.08)) : M.rgba(o.shadow, r.range(0.03, 0.07));
      x.lineWidth = r.range(2, 9);
      x.beginPath();
      x.moveTo(sx, sy);
      x.quadraticCurveTo(sx + len / 2, sy + r.range(-8, 8), sx + len, sy + r.range(-5, 5));
      x.stroke();
    }
    P.texturize(L, 0.5);
    return L;
  };

  // Still water with horizontal drag and reflections. o: {top, bottom, sky, seed, streaks}
  P.paintWater = function (w, h, o) {
    const L = G.layer(w, h, o.rs || Math.min(G.RS, 1.5));
    const x = L.x;
    const r = M.rng(o.seed || 3);
    const g = x.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, o.top);
    g.addColorStop(1, o.bottom);
    x.fillStyle = g;
    x.fillRect(0, 0, w, h);
    x.lineCap = 'round';
    for (let i = 0; i < (o.streaks || 500); i++) {
      const yy = Math.pow(r(), 1.6) * h;
      const sx = r() * w, len = r.range(20, 200) * (0.3 + yy / h);
      const light = r() < 0.55;
      x.strokeStyle = light ? M.rgba(o.sky || '#b4aaa3', r.range(0.05, 0.16)) : 'rgba(20,20,22,' + r.range(0.04, 0.12) + ')';
      x.lineWidth = r.range(0.6, 2.2) * (0.5 + yy / h);
      x.beginPath();
      x.moveTo(sx, yy);
      x.lineTo(sx + len, yy + r.range(-0.5, 0.5));
      x.stroke();
    }
    P.texturize(L, 0.35);
    return L;
  };

  // ------------------------------------------------------------ cloth
  // Hanging gauze panel. Sways from its top edge.
  P.gauze = function (x, px, py, w, h, o) {
    o = o || {};
    const t = o.t || 0, sway = o.sway == null ? 1 : o.sway;
    const a = o.alpha == null ? 0.3 : o.alpha;
    const seed = o.seed || 1;
    const segs = 8;
    const bottom = [];
    for (let i = 0; i <= segs; i++) {
      const u = i / segs;
      const dx = Math.sin(t * 0.9 + seed + u * 2.2) * 6 * sway + (o.wind || 0) * 30 * (0.6 + 0.4 * Math.sin(t * 5 + u * 6 + seed));
      const dy = Math.sin(u * 17.1 + seed) * 5 + Math.sin(t * 1.3 + u * 4 + seed) * 2 * sway;
      bottom.push([px + u * w + dx, py + h + dy]);
    }
    x.save();
    x.beginPath();
    x.moveTo(px, py);
    x.lineTo(px + w, py);
    for (let i = segs; i >= 0; i--) x.lineTo(bottom[i][0], bottom[i][1]);
    x.closePath();
    const g = x.createLinearGradient(px, py, px, py + h);
    g.addColorStop(0, M.rgba(o.color || '#eeebe4', a * 1.1));
    g.addColorStop(1, M.rgba(o.color || '#eeebe4', a * 0.7));
    x.fillStyle = g;
    x.fill();
    // folds
    x.clip();
    x.strokeStyle = M.rgba('#ffffff', a * 0.5);
    x.lineWidth = 3;
    for (let i = 1; i < 6; i++) {
      const fx = px + (i / 6) * w + Math.sin(seed * 3 + i) * 8;
      x.beginPath();
      x.moveTo(fx, py);
      x.quadraticCurveTo(fx + Math.sin(t * 0.8 + i + seed) * 6 * sway, py + h * 0.5, bottom[Math.round(i / 6 * segs)][0], py + h + 10);
      x.stroke();
    }
    x.restore();
    // seams and a hem
    x.save();
    if (o.seams !== false) {
      const sc = M.rgba('#f4efe6', Math.min(1, a * 2.2));
      P.whipstitch(x, px, py + 2, px + w, py + 2, { color: sc, gap: 8, len: 5, width: 1 });
      if (o.midSeam) P.whipstitch(x, px + w / 2, py, (bottom[4][0] + px + w / 2) / 2, py + h, { color: sc, gap: 9, len: 5, width: 1 });
    }
    x.restore();
    return bottom;
  };

  // Torn textile strip along a polyline of points (the red cloth of anger).
  P.ribbon = function (x, pts, o) {
    o = o || {};
    const n = pts.length;
    if (n < 2) return;
    const left = [], right = [];
    for (let i = 0; i < n; i++) {
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
      const dx = b[0] - a[0], dy = b[1] - a[1];
      const d = Math.hypot(dx, dy) || 1;
      const nx = -dy / d, ny = dx / d;
      const taper = o.taper === false ? 1 : 1 - (i / (n - 1)) * 0.28;
      const fray = (i > n - 3 ? 0.6 : 1) * (1 + 0.25 * Math.sin(i * 12.9898 + (o.seed || 0)));
      const w = (o.width || 14) * taper * fray * 0.5;
      const twist = o.twist ? Math.cos(o.twist[i] || 0) : 1;
      left.push([pts[i][0] + nx * w * twist, pts[i][1] + ny * w * twist]);
      right.push([pts[i][0] - nx * w * twist, pts[i][1] - ny * w * twist]);
    }
    x.save();
    x.beginPath();
    x.moveTo(left[0][0], left[0][1]);
    for (let i = 1; i < n; i++) x.lineTo(left[i][0], left[i][1]);
    // torn end
    const e = pts[n - 1];
    x.lineTo(e[0] + Math.sin((o.seed || 0) * 3) * 4, e[1] + 3);
    for (let i = n - 1; i >= 0; i--) x.lineTo(right[i][0], right[i][1]);
    x.closePath();
    x.fillStyle = o.color || C.oxblood;
    x.fill();
    x.strokeStyle = M.rgba(o.edge || C.oxbloodDark, 0.8);
    x.lineWidth = 1;
    x.stroke();
    // a lighter fold down the middle
    x.strokeStyle = M.rgba(o.light || C.oxbloodLight, 0.5);
    x.lineWidth = Math.max(1, (o.width || 14) * 0.18);
    x.beginPath();
    for (let i = 0; i < n; i++) {
      const px = (left[i][0] * 0.65 + right[i][0] * 0.35), py = (left[i][1] * 0.65 + right[i][1] * 0.35);
      if (i === 0) x.moveTo(px, py); else x.lineTo(px, py);
    }
    x.stroke();
    // stitches every few points
    if (o.stitches !== false) {
      x.strokeStyle = 'rgba(236,226,208,0.7)';
      x.lineWidth = 0.9;
      x.beginPath();
      for (let i = 1; i < n - 1; i += 2) {
        x.moveTo(left[i][0] * 0.8 + right[i][0] * 0.2, left[i][1] * 0.8 + right[i][1] * 0.2);
        x.lineTo(left[i + 1][0] * 0.2 + right[i + 1][0] * 0.8, left[i + 1][1] * 0.2 + right[i + 1][1] * 0.8);
      }
      x.stroke();
    }
    x.restore();
  };

  // A patch of cloth with stitched border. progress (0..1) draws stitches around it.
  P.patch = function (x, cx, cy, w, h, o) {
    o = o || {};
    const r = M.rng(o.seed || 11);
    const pts = [[cx - w / 2, cy - h / 2], [cx + w / 2, cy - h / 2], [cx + w / 2, cy + h / 2], [cx - w / 2, cy + h / 2]];
    x.save();
    if (o.rot) { x.translate(cx, cy); x.rotate(o.rot); x.translate(-cx, -cy); }
    x.beginPath();
    P.roughPolyPath(x, pts, true, 1.5, r, 6);
    x.fillStyle = o.color || '#c9b27a';
    x.globalAlpha = o.alpha == null ? 1 : o.alpha;
    x.fill();
    x.globalAlpha = 1;
    if (o.texture !== false) {
      x.save();
      x.clip();
      P.hatch(x, cx - w / 2, cy - h / 2, w, h, { color: 'rgba(0,0,0,0.12)', gap: 3.5, angle: 0.8, rng: r });
      x.restore();
    }
    const prog = o.progress == null ? 1 : o.progress;
    if (prog > 0) {
      const sc = o.stitch || 'rgba(240,232,216,0.85)';
      const per = [[0, 1], [1, 2], [2, 3], [3, 0]];
      let total = prog * 4;
      for (const [a, b] of per) {
        if (total <= 0) break;
        const f = Math.min(1, total);
        const A = pts[a], B = pts[b];
        P.whipstitch(x, A[0], A[1], A[0] + (B[0] - A[0]) * f, A[1] + (B[1] - A[1]) * f, { color: sc, gap: 6, len: 5, width: 1 });
        total -= 1;
      }
    }
    x.restore();
  };

  // ------------------------------------------------------------ the empty chair
  // Side view with a little 3/4 depth. (fx, fy) is the floor point under the seat.
  // o: {s: height in px, facing: 1|-1, tip: radians, throwColor, throwPatch, alpha, wood}
  P.chair = function (x, fx, fy, o) {
    o = o || {};
    const s = o.s || 100;
    const wood = o.wood || '#4a3628', dark = o.woodDark || '#2a1d15', lite = o.woodLight || '#7b5f47';
    x.save();
    x.translate(fx, fy);
    if (o.tip) x.rotate(o.tip);
    x.scale((o.facing || 1) * s, s);
    if (o.alpha != null) x.globalAlpha = o.alpha;
    x.lineCap = 'round';
    x.lineJoin = 'round';
    const d = [0.13, -0.07]; // depth offset for the far side
    const bar = (ax, ay, bx, by, w, col) => {
      x.strokeStyle = col;
      x.lineWidth = w;
      x.beginPath();
      x.moveTo(ax, ay);
      x.lineTo(bx, by);
      x.stroke();
    };
    // far legs and far upright
    bar(0.2 + d[0], -0.44 + d[1], 0.2 + d[0], 0 + d[1], 0.038, dark);
    bar(-0.19 + d[0], -0.44 + d[1], -0.19 + d[0], 0 + d[1], 0.038, dark);
    bar(-0.19 + d[0], -0.44 + d[1], -0.24 + d[0], -1.0 + d[1], 0.04, dark);
    // stretchers
    bar(-0.19, -0.16, 0.2, -0.16, 0.022, dark);
    bar(0.2, -0.2, 0.2 + d[0], -0.2 + d[1], 0.02, dark);
    // seat
    x.fillStyle = lite;
    x.beginPath();
    x.moveTo(-0.22, -0.45);
    x.lineTo(0.23, -0.45);
    x.lineTo(0.23 + d[0], -0.45 + d[1]);
    x.lineTo(-0.22 + d[0], -0.45 + d[1]);
    x.closePath();
    x.fill();
    x.fillStyle = wood;
    x.fillRect(-0.22, -0.45, 0.45, 0.045);
    // spindles of the back, seen at an angle
    for (let i = 0; i < 4; i++) {
      const u = (i + 0.5) / 4;
      const bx = -0.2 + d[0] * u, by = -0.45 + d[1] * u;
      bar(bx, by, bx - 0.045 + d[0] * 0.05, -0.95 + d[1] * u, 0.018, M.mixColor(dark, wood, u));
    }
    // top rail
    x.strokeStyle = wood;
    x.lineWidth = 0.075;
    x.beginPath();
    x.moveTo(-0.25, -0.99);
    x.quadraticCurveTo(-0.24 + d[0] * 0.5, -1.03 + d[1] * 0.5, -0.24 + d[0], -1.0 + d[1]);
    x.stroke();
    // near legs and upright
    bar(0.2, -0.44, 0.2, 0, 0.042, wood);
    bar(-0.19, -0.44, -0.19, 0, 0.042, wood);
    bar(-0.19, -0.42, -0.25, -1.0, 0.045, wood);
    // highlights
    bar(0.19, -0.42, 0.19, -0.03, 0.01, M.rgba(lite, 0.8));
    bar(-0.205, -0.5, -0.245, -0.95, 0.01, M.rgba(lite, 0.7));
    // the throw (knitted, repaired), draped over the top rail
    if (o.throwColor) {
      x.fillStyle = o.throwColor;
      x.beginPath();
      x.moveTo(-0.3, -1.0);
      x.quadraticCurveTo(-0.18, -1.09, -0.07, -1.0);
      x.quadraticCurveTo(-0.02, -0.86, -0.05, -0.72);
      x.quadraticCurveTo(-0.08, -0.68, -0.12, -0.71);
      x.lineTo(-0.17, -0.63);
      x.quadraticCurveTo(-0.25, -0.52, -0.33, -0.55);
      x.quadraticCurveTo(-0.37, -0.72, -0.34, -0.87);
      x.quadraticCurveTo(-0.33, -0.96, -0.3, -1.0);
      x.fill();
      x.save();
      x.clip();
      x.strokeStyle = 'rgba(0,0,0,0.2)';
      x.lineWidth = 0.008;
      x.beginPath();
      for (let i = 0; i < 9; i++) {
        const yy = -1.02 + i * 0.055;
        x.moveTo(-0.4, yy);
        x.quadraticCurveTo(-0.2, yy + 0.025, 0, yy + 0.01);
      }
      x.stroke();
      x.fillStyle = 'rgba(0,0,0,0.18)';
      x.fillRect(-0.4, -0.78, 0.2, 0.3);
      x.restore();
      // fringe
      x.strokeStyle = o.throwColor;
      x.lineWidth = 0.008;
      x.beginPath();
      for (let i = 0; i < 6; i++) {
        const u = i / 5;
        const fx = M.lerp(-0.33, -0.18, u), fy = M.lerp(-0.555, -0.62, u);
        x.moveTo(fx, fy);
        x.lineTo(fx - 0.004, fy + 0.04);
      }
      x.stroke();
      if (o.throwPatch !== false) {
        x.fillStyle = 'rgba(60,40,20,0.45)';
        x.beginPath();
        x.arc(-0.2, -0.85, 0.055, 0, TAU);
        x.fill();
        x.strokeStyle = 'rgba(240,226,200,0.6)';
        x.lineWidth = 0.007;
        x.beginPath();
        for (let i = 0; i < 12; i++) {
          const a = i / 12 * TAU;
          x.moveTo(-0.2 + Math.cos(a) * 0.035, -0.85 + Math.sin(a) * 0.035);
          x.lineTo(-0.2 + Math.cos(a) * 0.068, -0.85 + Math.sin(a) * 0.068);
        }
        x.stroke();
      }
    }
    x.restore();
  };

  // Top-down chair for the folded rooms.
  P.chairTop = function (x, cx, cy, s, ang, o) {
    o = o || {};
    x.save();
    x.translate(cx, cy);
    x.rotate(ang);
    x.fillStyle = 'rgba(0,0,0,0.25)';
    x.fillRect(-s * 0.45 + 3, -s * 0.45 + 3, s * 0.9, s * 0.9);
    x.fillStyle = o.seat || '#7b5f47';
    x.fillRect(-s * 0.42, -s * 0.4, s * 0.84, s * 0.8);
    x.fillStyle = o.back || '#4a3628';
    x.fillRect(-s * 0.46, -s * 0.52, s * 0.92, s * 0.16);
    x.strokeStyle = 'rgba(0,0,0,0.25)';
    x.lineWidth = 1;
    x.strokeRect(-s * 0.42, -s * 0.4, s * 0.84, s * 0.8);
    if (o.throwColor) {
      x.fillStyle = o.throwColor;
      x.fillRect(-s * 0.46, -s * 0.56, s * 0.6, s * 0.5);
    }
    x.restore();
  };

  // Marker for things that can be looked at: a small stitched ring.
  P.glint = function (x, cx, cy, t, a, big) {
    if (a <= 0.01) return;
    const r = (big ? 13 : 9) + Math.sin(t * 2.4) * 1.5;
    x.save();
    x.globalAlpha = a;
    x.strokeStyle = 'rgba(240,232,214,0.85)';
    x.lineWidth = 1.3;
    x.setLineDash([3, 4]);
    x.lineDashOffset = -t * 6;
    x.beginPath();
    x.arc(cx, cy, r, 0, TAU);
    x.stroke();
    x.setLineDash([]);
    x.fillStyle = 'rgba(240,232,214,0.9)';
    x.beginPath();
    x.arc(cx, cy, 1.8, 0, TAU);
    x.fill();
    x.restore();
  };

  // Rain streaks over the stage.
  P.Rain = function (count, seed) {
    const r = M.rng(seed || 8);
    this.drops = [];
    for (let i = 0; i < count; i++) this.drops.push({ x: r() * G.W, y: r() * G.H, v: r.range(500, 800), l: r.range(8, 18), a: r.range(0.08, 0.22) });
  };
  P.Rain.prototype.update = function (dt, slant) {
    for (const d of this.drops) {
      d.y += d.v * dt;
      d.x += d.v * dt * (slant || 0.12);
      if (d.y > G.H + 20) { d.y = -20; d.x = Math.random() * (G.W + 200) - 200; }
      if (d.x > G.W + 20) d.x -= G.W + 40;
    }
  };
  P.Rain.prototype.draw = function (x, alpha, slant) {
    x.save();
    x.strokeStyle = '#d9d6d2';
    x.lineWidth = 1;
    x.lineCap = 'round';
    for (const d of this.drops) {
      x.globalAlpha = d.a * alpha;
      x.beginPath();
      x.moveTo(d.x, d.y);
      x.lineTo(d.x - d.l * (slant || 0.12), d.y - d.l);
      x.stroke();
    }
    x.restore();
  };

  // Floating dust motes in a light shaft.
  P.Motes = function (count, box, seed) {
    const r = M.rng(seed || 21);
    this.box = box;
    this.m = [];
    for (let i = 0; i < count; i++) this.m.push({ x: r() * box.w, y: r() * box.h, p: r() * TAU, s: r.range(0.6, 1.8), v: r.range(4, 12) });
  };
  P.Motes.prototype.draw = function (x, t, alpha, color) {
    const b = this.box;
    x.save();
    x.fillStyle = color || '#f3efe6';
    for (const m of this.m) {
      const px = b.x + ((m.x + Math.sin(t * 0.3 + m.p) * 14 + t * m.v * 0.3) % b.w + b.w) % b.w;
      const py = b.y + ((m.y + Math.cos(t * 0.21 + m.p) * 10 - t * m.v * 0.25) % b.h + b.h) % b.h;
      x.globalAlpha = alpha * (0.3 + 0.7 * Math.abs(Math.sin(t * 0.7 + m.p)));
      x.beginPath();
      x.arc(px, py, m.s, 0, TAU);
      x.fill();
    }
    x.restore();
  };
})();
