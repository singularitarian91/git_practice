/* person.js: the protagonist (repaired ochre coat, short dark hair) and the gardeners.
 * Figures are drawn procedurally in a unit frame: feet at y=0, head top near y=-1.
 */
(function () {
  'use strict';
  const G = window.G, M = G.M, C = G.C;
  const TAU = M.TAU;

  const L_THIGH = 0.25, L_SHIN = 0.245, L_UPPER = 0.17, L_FORE = 0.16;

  function shade(col, amt) {
    return amt < 0 ? M.mixColor(col, '#000000', -amt) : M.mixColor(col, '#ffffff', amt);
  }

  // Two-bone IK. Returns elbow/knee and end positions.
  function ik2(sx, sy, tx, ty, l1, l2, bend) {
    let dx = tx - sx, dy = ty - sy;
    let d = Math.hypot(dx, dy);
    const maxD = l1 + l2 - 1e-4;
    if (d > maxD) { dx *= maxD / d; dy *= maxD / d; d = maxD; }
    if (d < 1e-4) d = 1e-4;
    const a = Math.atan2(dy, dx);
    const b = Math.acos(M.clamp((l1 * l1 + d * d - l2 * l2) / (2 * l1 * d), -1, 1));
    const a1 = a + bend * b;
    return { ex: sx + Math.cos(a1) * l1, ey: sy + Math.sin(a1) * l1, hx: sx + dx, hy: sy + dy };
  }

  // A sleeve or trouser leg. `dark` lays a shadow over it (for the far side of the body).
  // `ink` (paper mode) outlines it in charcoal first; only that first stroke casts a shadow.
  function limb(x, pts, w, col, dark, ink, cap) {
    x.lineCap = cap || 'round';
    x.lineJoin = 'round';
    x.beginPath();
    x.moveTo(pts[0], pts[1]);
    for (let i = 2; i < pts.length; i += 2) x.lineTo(pts[i], pts[i + 1]);
    x.save();
    if (ink) {
      x.strokeStyle = ink.col;
      x.lineWidth = w + ink.w * 2;
      x.stroke();
      x.shadowColor = 'rgba(0,0,0,0)';
    }
    x.strokeStyle = col;
    x.lineWidth = w;
    x.stroke();
    x.shadowColor = 'rgba(0,0,0,0)';
    if (dark) {
      x.strokeStyle = 'rgba(0,0,0,' + dark + ')';
      x.stroke();
    }
    x.restore();
  }

  // Size of one texture pixel of a coat's cloth, in the figure's unit frame.
  const WEAVE = 0.0045;

  const person = (G.person = {});

  // Presets
  person.HERO = {
    coat: C.ochre, trousers: C.linen, boots: '#2e231c', skin: C.skin, hair: C.hair, cloth: { coat: 'ochre', trousers: 'linen' },
    hairStyle: 'bob', patches: [['#8e4a2a', -0.07, 0.02, 0.07, 0.08, 'rust'], ['#d8b870', 0.035, -0.2, 0.05, 0.05, 'mustard'], ['#6d6a60', -0.02, 0.1, 0.06, 0.05, 'tweed']]
  };
  person.ELDER = {
    coat: '#4f2f3d', trousers: '#3a322d', boots: '#231b16', skin: '#cfae92', hair: '#a8a29a', cloth: { coat: 'plum', trousers: 'tweed' },
    hairStyle: 'bun', patches: [['#6b4a58', 0.02, -0.1, 0.05, 0.06, 'rose']]
  };
  person.GARDENER = {
    coat: '#434a39', trousers: '#2f2b26', boots: '#1f1914', skin: '#c79f82', hair: '#2a211b', cloth: { coat: 'sage', trousers: 'tweed' },
    hairStyle: 'short', beard: true, patches: [['#5c6450', -0.05, 0.0, 0.06, 0.07, 'sage']]
  };

  // Make the figures' recoloured cloth ahead of time (it's built on first use otherwise).
  person.warm = function (env) {
    if (!G.paint.cloth) return;
    const c = document.createElement('canvas');
    c.width = c.height = 1;
    const x = c.getContext('2d');
    for (const base of [person.HERO, person.ELDER, person.GARDENER]) {
      const look = litLook(base, env);
      if (!look.cloth) continue;
      G.paint.cloth(x, look.cloth.coat, look.coat, 1);
      G.paint.cloth(x, look.cloth.trousers, look.trousers, 1);
      for (const pa of look.patches || []) if (pa[5]) G.paint.cloth(x, pa[5], pa[0], 1);
    }
    G.paint.cloth(x, 'rust', '#8e4a2a', 1);
    G.paint.cloth(x, 'ochre', C.ochre, 1);
  };

  /* p = {
   *   x, y, s, dir, t,
   *   look: preset, walk: 0..1, phase, kneel: 0..1, lean, wind, loose,
   *   bow, reach: {x, y} world target for the near hand (or null), reachBoth,
   *   carry: bool, alpha
   * }
   * Writes world-space hand positions to p.out.
   */
  // The chapter's light, multiplied into a figure's colours (cached per light).
  function litLook(look, pp) {
    if (!pp || !pp.tint) return look;
    const cache = look.__lit || (look.__lit = {});
    const key = pp.tint + '|' + (pp.tintA || 0);
    if (cache[key]) return cache[key];
    const L = M.parseColor(pp.tint), A = pp.tintA == null ? 0.3 : pp.tintA;
    const f = [0, 1, 2].map(i => 1 - A + A * L[i] / 255);
    const m = c => { const q = M.parseColor(c); return 'rgb(' + q.map((v, i) => Math.round(v * f[i])).join(',') + ')'; };
    const out = Object.assign({}, look, { coat: m(look.coat), trousers: m(look.trousers), boots: m(look.boots), skin: m(look.skin), hair: m(look.hair) });
    if (look.patches) out.patches = look.patches.map(pa => [m(pa[0])].concat(pa.slice(1)));
    delete out.__lit;
    return (cache[key] = out);
  }

  person.draw = function (x, p) {
    const pp = p.paper;
    const look = litLook(p.look || person.HERO, pp);
    const s = p.s, dir = p.dir || 1, t = p.t || G.time;
    // paper mode: every piece is cut out and outlined in charcoal, and casts a faint shadow on
    // whatever lies under it (the page, or the piece beneath)
    let ink = null, shOn = () => {}, shOff = () => {};
    if (pp) {
      const tf = x.getTransform && x.getTransform();
      const a = tf ? Math.hypot(tf.a, tf.b) : 1; // device pixels per world unit
      const unit = s * a; // device pixels per figure height
      const key = p.out || p;
      const seed = key.__ink || (key.__ink = 1 + Math.random() * 97);
      const r = M.rng(Math.floor(seed * 131) + Math.floor((G.time || 0) * 8));
      const px = Math.max(1.15, unit * 0.0032) * r.range(0.85, 1.15);
      ink = { w: px / unit, col: 'rgba(28,23,20,0.88)' };
      const lift = Math.max(1, unit * (pp.lift == null ? 0.012 : pp.lift));
      shOn = () => { x.shadowColor = 'rgba(24,17,12,0.2)'; x.shadowOffsetX = lift; x.shadowOffsetY = lift * 0.75; x.shadowBlur = 0; };
      shOff = () => { x.shadowColor = 'rgba(0,0,0,0)'; x.shadowOffsetX = 0; x.shadowOffsetY = 0; };
    }
    // fill the current path as one cut piece: outline (which casts the shadow), then the cloth
    const piece = fill => {
      if (ink) {
        x.lineJoin = 'round';
        x.lineWidth = ink.w * 2;
        x.strokeStyle = ink.col;
        x.stroke();
        x.save();
        x.shadowColor = 'rgba(0,0,0,0)';
        x.fillStyle = fill;
        x.fill();
        x.restore();
      } else {
        x.fillStyle = fill;
        x.fill();
      }
    };
    const walk = M.clamp(p.walk || 0, 0, 1), ph = p.phase || 0;
    const k = M.clamp(p.kneel || 0, 0, 1);
    const wind = p.wind || 0, loose = p.loose == null ? 0.5 : p.loose;
    const coat = look.coat, coatD = shade(coat, -0.28), coatL = shade(coat, 0.18);
    const trou = look.trousers, trouD = shade(trou, -0.3);
    // painted cloth where it has loaded; flat colour otherwise
    const cloth = look.cloth && G.paint.cloth;
    const coatF = (cloth && G.paint.cloth(x, look.cloth.coat, coat, WEAVE)) || coat;
    const trouF = (cloth && G.paint.cloth(x, look.cloth.trousers, trou, WEAVE)) || trou;

    x.save();
    x.translate(p.x, p.y);
    x.scale(s * dir, s);
    if (p.alpha != null) x.globalAlpha *= p.alpha;

    // ground shadow
    x.fillStyle = 'rgba(0,0,0,0.22)';
    x.beginPath();
    x.ellipse(0, 0, 0.16 + k * 0.1, 0.025, 0, 0, TAU);
    x.fill();
    shOn();

    // ----- legs: walk gait blended toward a kneel
    const sw = 0.46 * walk;
    const legs = [0, Math.PI].map(off => {
      const q = ph + off;
      const th = sw * Math.sin(q);
      const kb = walk * 0.95 * Math.pow(Math.max(0, Math.cos(q)), 1.5) + 0.04;
      return { th, kb };
    });
    let ext = 0;
    for (const l of legs) ext = Math.max(ext, L_THIGH * Math.cos(l.th) + L_SHIN * Math.cos(l.th - l.kb));
    const hipWalk = -ext;
    const hipY = M.lerp(hipWalk, -0.15, k);
    const hipX = M.lerp(0, -0.02, k);
    // kneeling targets: both knees down in front, shins folded back
    const kneelLegs = [{ th: 1.05, kb: 2.6 }, { th: 1.15, kb: 2.7 }];
    const legPts = legs.map((l, i) => {
      const th = M.lerp(l.th, kneelLegs[i].th, k);
      const kb = M.lerp(l.kb, kneelLegs[i].kb, k);
      const kx = hipX + Math.sin(th) * L_THIGH, ky = hipY + Math.cos(th) * L_THIGH;
      const ax = kx + Math.sin(th - kb) * L_SHIN, ay = Math.min(-0.012, ky + Math.cos(th - kb) * L_SHIN);
      return { kx, ky, ax, ay, th, kb };
    });
    const drawLeg = (lp, far) => {
      // points up the shin from the ankle (the trouser stops inside the boot, so nothing
      // of the leg can show below the sole)
      const sl = Math.hypot(lp.ax - lp.kx, lp.ay - lp.ky) || 1;
      const up = d => [lp.ax - (lp.ax - lp.kx) / sl * d, lp.ay - (lp.ay - lp.ky) / sl * d];
      const [tx, ty] = up(0.05);
      if (trouF !== trou) limb(x, [hipX, hipY, lp.kx, lp.ky, tx, ty], 0.056, trouF, far ? 0.3 : 0, ink);
      else limb(x, [hipX, hipY, lp.kx, lp.ky, tx, ty], 0.056, far ? trouD : trou, 0, ink);
      // boot: a short shaft that follows the shin, then the foot over the ankle
      const bootCol = far ? shade(look.boots, -0.3) : look.boots;
      const [b0x, b0y] = up(0.078), [b1x, b1y] = up(0.012);
      limb(x, [b0x, b0y, b1x, b1y], 0.06, bootCol, 0, ink, 'butt');
      x.save();
      x.translate(lp.ax, lp.ay);
      // walking: toe follows the shin; kneeling: foot turned back, sole up
      x.rotate(M.lerp(M.clamp((lp.th - lp.kb) * 0.35, -0.3, 0.5), Math.PI * 0.94, k));
      x.beginPath();
      x.moveTo(-0.03, -0.035);
      x.lineTo(0.035, -0.03);
      x.quadraticCurveTo(0.085, -0.02, 0.085, 0.004);
      x.lineTo(-0.035, 0.008);
      x.closePath();
      piece(bootCol);
      x.restore();
    };
    drawLeg(legPts[1], true);

    // ----- upper body frame (origin at hip, leaning)
    const lean = (p.lean || 0) + k * 0.42;
    const armSwing = 0.42 * walk * Math.sin(ph);
    const out = (p.out = p.out || {});

    // far arm first (behind the body)
    x.save();
    x.translate(hipX, hipY);
    x.rotate(lean);
    const shoulder = { x: 0.005, y: -0.305 };
    let farHand;
    if (p.carry || p.reachBoth) {
      const tgt = p.carry ? { x: 0.19, y: -0.2 } : localTarget(p, hipX, hipY, lean, s, dir, 0.03);
      const a = ik2(shoulder.x + 0.02, shoulder.y + 0.01, tgt.x + 0.02, tgt.y - 0.01, L_UPPER, L_FORE, 1);
      farHand = a;
    } else if (k > 0.3) {
      farHand = ik2(shoulder.x, shoulder.y, 0.22, 0.15, L_UPPER, L_FORE, 1);
    } else {
      const aa = Math.PI / 2 + armSwing;
      const ex = shoulder.x + Math.cos(aa) * L_UPPER, ey = shoulder.y + Math.sin(aa) * L_UPPER;
      const fa = aa - 0.35 - walk * 0.2;
      farHand = { ex, ey, hx: ex + Math.cos(fa) * L_FORE, hy: ey + Math.sin(fa) * L_FORE };
    }
    if (coatF !== coat) limb(x, [shoulder.x, shoulder.y, farHand.ex, farHand.ey, farHand.hx, farHand.hy], 0.05, coatF, 0.3, ink);
    else limb(x, [shoulder.x, shoulder.y, farHand.ex, farHand.ey, farHand.hx, farHand.hy], 0.05, coatD, 0, ink);
    x.beginPath();
    x.arc(farHand.hx, farHand.hy, 0.022, 0, TAU);
    piece(shade(look.skin, -0.2));
    x.restore();

    drawLeg(legPts[0], false);

    x.save();
    x.translate(hipX, hipY);
    x.rotate(lean);

    // ----- coat
    const motion = walk * 0.6 + Math.abs(p.lean || 0) * 0.5;
    const flare = (0.02 + motion * 0.065 + wind * 0.13) * (0.55 + loose);
    const lift = wind * 0.06 * (0.5 + loose);
    const hemN = 6;
    const hem = [];
    const hemLen = 0.15 + loose * 0.015;
    for (let i = 0; i <= hemN; i++) {
      const u = i / hemN; // 0 front .. 1 back
      const bx = M.lerp(0.11 + 0.02 * walk * Math.sin(ph), -0.14, u) - flare * u * u * 1.4;
      const wave = Math.sin(t * (5 + wind * 7) + u * 5.5 + ph * 0.5) * (0.008 + wind * 0.025 + motion * 0.014) * (0.4 + loose) * u;
      let by = hemLen + 0.005 * Math.sin(u * 9) - lift * u * u + wave;
      hem.push([bx, by]);
    }
    // keep the hem above the ground (it pools when kneeling)
    const groundLocal = (gx, gy) => {
      // world y of local point (gx, gy) relative to ground 0
      const wy = hipY + gx * Math.sin(lean) + gy * Math.cos(lean);
      return wy;
    };
    for (const h of hem) {
      const wy = groundLocal(h[0], h[1]);
      if (wy > -0.008) h[1] -= (wy + 0.008) / Math.cos(lean);
    }
    x.beginPath();
    x.moveTo(0.045, -0.33);
    x.quadraticCurveTo(0.085, -0.28, 0.078, -0.2);
    x.lineTo(0.082, -0.05);
    x.lineTo(hem[0][0], hem[0][1]);
    for (let i = 1; i <= hemN; i++) x.lineTo(hem[i][0], hem[i][1]);
    x.quadraticCurveTo(-0.1 - flare * 0.3, 0.02, -0.088, -0.12);
    x.quadraticCurveTo(-0.085, -0.28, -0.05, -0.325);
    x.closePath();
    piece(coatF);
    // shading down the back and a lighter front panel (printed on the piece: no shadows)
    x.save();
    shOff();
    x.clip();
    x.fillStyle = M.rgba(coatD, 0.55);
    x.beginPath();
    x.moveTo(-0.1, -0.35);
    x.lineTo(-0.035, -0.35);
    x.quadraticCurveTo(-0.05, -0.05, -0.08 - flare, 0.2);
    x.lineTo(-0.3, 0.3);
    x.closePath();
    x.fill();
    x.fillStyle = M.rgba(coatL, 0.35);
    x.fillRect(0.03, -0.3, 0.06, 0.45);
    // pleats (after Issey Miyake): pressed flat at first, opening out chapter by chapter and with every step
    const fan = 0.25 + loose * 0.8 + walk * 0.35 + wind * 0.4;
    const hemAt = u => {
      const f = u * hemN, i0 = Math.min(hemN - 1, Math.floor(f)), k2 = f - i0;
      return [M.lerp(hem[i0][0], hem[i0 + 1][0], k2), M.lerp(hem[i0][1], hem[i0 + 1][1], k2)];
    };
    const waistAt = u => [M.lerp(0.07, -0.075, u), -0.03 + u * 0.01];
    for (let i = 0; i < 7; i++) {
      const u0 = i / 7, u1 = (i + 1) / 7;
      const a0 = waistAt(u0), a1 = waistAt(u1), b0 = hemAt(u0), b1 = hemAt(u1);
      x.fillStyle = i % 2 ? 'rgba(255,250,240,' + (0.05 * fan).toFixed(3) + ')' : 'rgba(0,0,0,' + (0.08 * fan).toFixed(3) + ')';
      x.beginPath();
      x.moveTo(a0[0], a0[1]);
      x.lineTo(a1[0], a1[1]);
      x.lineTo(b1[0], b1[1] + 0.02);
      x.lineTo(b0[0], b0[1] + 0.02);
      x.closePath();
      x.fill();
    }
    // pleats that loosen chapter by chapter
    x.strokeStyle = M.rgba(coatD, 0.45 + loose * 0.2);
    x.lineWidth = 0.006;
    x.beginPath();
    for (let i = 1; i < 5; i++) {
      const u = i / 5;
      const top = M.lerp(0.06, -0.07, u);
      x.moveTo(top, -0.02);
      x.lineTo(hem[Math.round(u * hemN)][0] * 0.95, hem[Math.round(u * hemN)][1] - 0.01);
    }
    x.stroke();
    // repairs
    for (const pa of look.patches || []) {
      const [pc, px, py, pw, phh, pf] = pa;
      x.fillStyle = (pf && cloth && G.paint.cloth(x, pf, pc, WEAVE)) || pc;
      x.fillRect(px - pw / 2, py - phh / 2, pw, phh);
      x.strokeStyle = 'rgba(240,230,210,0.75)';
      x.lineWidth = 0.004;
      x.beginPath();
      const n = 4;
      for (let i = 0; i <= n; i++) {
        const u = i / n;
        x.moveTo(px - pw / 2 + pw * u - 0.006, py - phh / 2 - 0.008);
        x.lineTo(px - pw / 2 + pw * u + 0.006, py - phh / 2 + 0.008);
        x.moveTo(px - pw / 2 + pw * u - 0.006, py + phh / 2 - 0.008);
        x.lineTo(px - pw / 2 + pw * u + 0.006, py + phh / 2 + 0.008);
      }
      x.stroke();
    }
    x.restore();
    // hem edge
    x.save();
    shOff();
    x.strokeStyle = M.rgba(coatD, 0.9);
    x.lineWidth = 0.007;
    x.beginPath();
    x.moveTo(hem[0][0], hem[0][1]);
    for (let i = 1; i <= hemN; i++) x.lineTo(hem[i][0], hem[i][1]);
    x.stroke();
    x.restore();

    // ----- head
    const bow = (p.bow || 0) + k * 0.25;
    x.save();
    x.translate(0.012, -0.335);
    x.rotate(bow);
    // neck
    x.beginPath();
    x.rect(-0.018, -0.05, 0.036, 0.05);
    piece(shade(look.skin, -0.12));
    const hx = 0.012, hy = -0.1, hr = 0.074;
    x.beginPath();
    x.ellipse(hx, hy, hr * 0.92, hr, 0, 0, TAU);
    piece(look.skin);
    // a little modelling: the back of the head in shade, a warm cheek
    x.save();
    shOff();
    x.clip();
    x.fillStyle = M.rgba(shade(look.skin, -0.4), 0.32);
    x.beginPath();
    x.ellipse(hx - hr * 0.62, hy + hr * 0.15, hr * 0.62, hr * 1.1, 0, 0, TAU);
    x.fill();
    x.fillStyle = 'rgba(196,106,86,0.16)';
    x.beginPath();
    x.arc(hx + hr * 0.42, hy + hr * 0.38, hr * 0.24, 0, TAU);
    x.fill();
    x.restore();
    x.save();
    shOff();
    x.fillStyle = look.skin;
    // nose hint
    x.beginPath();
    x.moveTo(hx + hr * 0.85, hy - 0.01);
    x.lineTo(hx + hr * 1.05, hy + 0.012);
    x.lineTo(hx + hr * 0.84, hy + 0.02);
    x.fill();
    x.restore();
    drawHair(x, look, hx, hy, hr, t, wind, walk, piece);
    x.restore();

    // collar
    x.beginPath();
    x.moveTo(-0.055, -0.33);
    x.quadraticCurveTo(0.0, -0.37, 0.05, -0.335);
    x.lineTo(0.04, -0.3);
    x.quadraticCurveTo(0, -0.325, -0.05, -0.3);
    x.closePath();
    piece(coatD);

    // their scarf, once it's been freed from the thorns: wound at the neck, one end loose
    if (p.scarf) {
      const fl = wind * 0.09 + walk * 0.025;
      const knit = G.paint.cloth && G.paint.cloth(x, 'rust', '#8e4a2a', WEAVE * 0.8);
      const wool = knit || '#8e4a2a';
      x.beginPath();
      x.moveTo(-0.04, -0.33);
      x.quadraticCurveTo(-0.09 - fl, -0.3 + Math.sin(t * 5) * 0.01, -0.12 - fl * 1.6, -0.2 + Math.sin(t * 7 + 1) * 0.015 * (0.3 + wind));
      x.lineTo(-0.085 - fl * 1.3, -0.19);
      x.quadraticCurveTo(-0.06, -0.27, -0.01, -0.31);
      x.closePath();
      piece(wool);
      x.beginPath();
      x.moveTo(-0.07, -0.345);
      x.quadraticCurveTo(0.0, -0.385, 0.068, -0.35);
      x.lineTo(0.06, -0.305);
      x.quadraticCurveTo(0.0, -0.335, -0.062, -0.3);
      x.closePath();
      piece(wool);
      x.strokeStyle = 'rgba(214,170,70,0.8)';
      x.lineWidth = 0.006;
      x.beginPath();
      x.moveTo(-0.112 - fl * 1.5, -0.218);
      x.lineTo(-0.08 - fl * 1.2, -0.21);
      x.stroke();
    }

    // ----- near arm
    let nearHand;
    if (p.carry) {
      nearHand = ik2(shoulder.x, shoulder.y, 0.2, -0.19, L_UPPER, L_FORE, 1);
    } else if (p.reach || p.reachBoth) {
      const tgt = localTarget(p, hipX, hipY, lean, s, dir, 0);
      nearHand = ik2(shoulder.x, shoulder.y, tgt.x, tgt.y, L_UPPER, L_FORE, 1);
    } else if (k > 0.3) {
      nearHand = ik2(shoulder.x, shoulder.y, 0.26 + Math.sin(t * 4) * 0.02 * (p.work || 0), 0.17 + Math.cos(t * 4) * 0.02 * (p.work || 0), L_UPPER, L_FORE, 1);
    } else {
      const aa = Math.PI / 2 - armSwing + (p.lean || 0) * -0.6;
      const ex = shoulder.x + Math.cos(aa) * L_UPPER, ey = shoulder.y + Math.sin(aa) * L_UPPER;
      const fa = aa - 0.3 - walk * 0.25;
      nearHand = { ex, ey, hx: ex + Math.cos(fa) * L_FORE, hy: ey + Math.sin(fa) * L_FORE };
    }
    limb(x, [shoulder.x, shoulder.y, nearHand.ex, nearHand.ey, nearHand.hx, nearHand.hy], 0.056, coatF, 0, ink);
    x.save();
    shOff();
    limb(x, [shoulder.x, shoulder.y, nearHand.ex, nearHand.ey], 0.02, M.rgba(coatL, 0.4));
    x.restore();
    // cuff and hand
    x.beginPath();
    x.arc(nearHand.hx, nearHand.hy, 0.025, 0, TAU);
    piece(look.skin);
    x.restore();

    // hand position in world space for props
    const toWorld = (lx, ly) => {
      const c = Math.cos(lean), sn = Math.sin(lean);
      const ux = hipX + lx * c - ly * sn, uy = hipY + lx * sn + ly * c;
      return { x: p.x + ux * s * dir, y: p.y + uy * s };
    };
    out.hand = toWorld(nearHand.hx, nearHand.hy);
    out.farHand = toWorld(farHand.hx, farHand.hy);
    out.head = toWorld(0.03, -0.44);
    x.restore();
  };

  // Converts a world-space reach target into the leaning upper-body frame.
  function localTarget(p, hipX, hipY, lean, s, dir, dx) {
    const r = p.reach || { x: p.x + dir * s * 0.3, y: p.y - s * 0.5 };
    const wx = (r.x - p.x) / (s * dir) - hipX + dx;
    const wy = (r.y - p.y) / s - hipY;
    const c = Math.cos(-lean), sn = Math.sin(-lean);
    return { x: wx * c - wy * sn, y: wx * sn + wy * c };
  }

  function drawHair(x, look, hx, hy, hr, t, wind, walk, piece) {
    const paper = !!piece;
    piece = piece || (f => { x.fillStyle = f; x.fill(); });
    x.fillStyle = look.hair;
    const flow = wind * 0.06 + walk * 0.01;
    if (look.hairStyle === 'bun') {
      x.beginPath();
      x.arc(hx - hr * 0.95, hy - hr * 0.45, hr * 0.42, 0, TAU);
      piece(look.hair);
      x.beginPath();
      x.ellipse(hx - 0.01, hy - 0.02, hr * 1.02, hr * 0.95, 0, Math.PI * 0.95, Math.PI * 2.2);
      x.lineTo(hx - hr * 0.9, hy + 0.02);
      piece(look.hair);
      return;
    }
    x.beginPath();
    x.moveTo(hx + hr * 0.75, hy - hr * 0.35);
    x.quadraticCurveTo(hx + hr * 0.5, hy - hr * 1.2, hx - hr * 0.3, hy - hr * 1.12);
    x.quadraticCurveTo(hx - hr * 1.25 - flow * 0.3, hy - hr * 0.6, hx - hr * 1.12 - flow, hy + hr * (look.hairStyle === 'short' ? 0.3 : 0.75));
    x.lineTo(hx - hr * 0.35 - flow * 0.5, hy + hr * (look.hairStyle === 'short' ? 0.2 : 0.8));
    x.quadraticCurveTo(hx - hr * 0.1, hy + hr * 0.1, hx + hr * 0.1, hy - hr * 0.1);
    x.quadraticCurveTo(hx + hr * 0.55, hy - hr * 0.35, hx + hr * 0.95, hy - hr * 0.2);
    x.closePath();
    piece(look.hair);
    if (look.beard) {
      x.beginPath();
      x.moveTo(hx + hr * 0.1, hy + hr * 0.35);
      x.quadraticCurveTo(hx + hr * 0.9, hy + hr * 1.05, hx + hr * 0.95, hy + hr * 0.25);
      x.lineTo(hx + hr * 0.6, hy + hr * 0.4);
      x.closePath();
      piece(look.hair);
    }
    // loose strands in the wind (cut paper keeps them for a real wind)
    if (paper ? wind > 0.3 : (wind > 0.05 || walk > 0.2)) {
      x.strokeStyle = M.rgba(look.hair, 0.7);
      x.lineWidth = 0.005;
      x.lineCap = 'round';
      x.beginPath();
      for (let i = 0; i < 4; i++) {
        const sy = hy - hr * 0.8 + i * hr * 0.4;
        const len = 0.03 + flow * 0.9;
        x.moveTo(hx - hr * 0.95, sy);
        x.quadraticCurveTo(hx - hr - len * 0.5, sy + Math.sin(t * 9 + i) * 0.01, hx - hr - len, sy + Math.sin(t * 11 + i * 2) * 0.02 * (wind + 0.2));
      }
      x.stroke();
    }
  }

  // ------------------------------------------------------------ cut paper
  // The people are cut paper laid over painted pages (the guide's FORM: cut paper, charcoal,
  // frayed linen). In paper mode each piece of a figure is outlined in charcoal (the line
  // thickens and thins a little, eight times a second, like a hand-drawn line), casts a faint
  // shadow on whatever lies under it, and takes on the chapter's light.
  // env: { tint: colour of the light, tintA: how strongly, lift: shadow distance (in figure heights) }
  person.drawPaper = function (x, p, env) {
    p.paper = env || {};
    person.draw(x, p);
    p.paper = null;
  };

  // Top-down figure for the folded rooms of bargaining. p: {x, y, s, ang, phase, walk}
  person.drawTop = function (x, p) {
    const s = p.s;
    x.save();
    x.translate(p.x, p.y);
    x.rotate(p.ang || 0);
    x.scale(s, s);
    x.fillStyle = 'rgba(0,0,0,0.28)';
    x.beginPath();
    x.ellipse(0.06, 0.08, 0.55, 0.42, 0, 0, TAU);
    x.fill();
    const step = Math.sin(p.phase || 0) * 0.22 * (p.walk || 0);
    // feet
    x.fillStyle = '#2e231c';
    x.beginPath();
    x.ellipse(0.12 + step, -0.16, 0.14, 0.07, 0, 0, TAU);
    x.ellipse(0.12 - step, 0.16, 0.14, 0.07, 0, 0, TAU);
    x.fill();
    // coat with a trailing hem
    x.fillStyle = (G.paint.cloth && G.paint.cloth(x, 'ochre', C.ochre, 0.016)) || C.ochre;
    x.beginPath();
    x.moveTo(0.18, -0.3);
    x.quadraticCurveTo(0.26, 0, 0.18, 0.3);
    x.quadraticCurveTo(-0.1, 0.42, -0.36, 0.3 + step * 0.3);
    x.quadraticCurveTo(-0.46, 0, -0.36, -0.3 - step * 0.3);
    x.quadraticCurveTo(-0.1, -0.42, 0.18, -0.3);
    x.fill();
    x.fillStyle = 'rgba(126,87,25,0.7)';
    x.beginPath();
    x.ellipse(-0.18, 0, 0.14, 0.26, 0, 0, TAU);
    x.fill();
    // patch
    x.fillStyle = '#8e4a2a';
    x.fillRect(-0.3, 0.08, 0.12, 0.12);
    // shoulders + arms
    x.fillStyle = '#9d6f24';
    x.beginPath();
    x.ellipse(0.02 + step * 0.4, -0.3, 0.12, 0.07, 0, 0, TAU);
    x.ellipse(0.02 - step * 0.4, 0.3, 0.12, 0.07, 0, 0, TAU);
    x.fill();
    // their scarf, round the shoulders, one end trailing
    if (p.scarf) {
      x.fillStyle = (G.paint.cloth && G.paint.cloth(x, 'rust', '#8e4a2a', 0.014)) || '#8e4a2a';
      x.beginPath();
      x.ellipse(0.0, 0, 0.13, 0.25, 0, 0, TAU);
      x.fill();
      x.beginPath();
      x.moveTo(-0.08, 0.12);
      x.quadraticCurveTo(-0.3, 0.2 + step * 0.4, -0.46, 0.14 + step * 0.6);
      x.lineTo(-0.44, 0.06 + step * 0.6);
      x.quadraticCurveTo(-0.28, 0.1 + step * 0.4, -0.1, 0.04);
      x.fill();
    }
    // head and hair
    x.fillStyle = C.hair;
    x.beginPath();
    x.arc(0.02, 0, 0.17, 0, TAU);
    x.fill();
    x.fillStyle = C.skin;
    x.beginPath();
    x.ellipse(0.13, 0, 0.05, 0.1, 0, 0, TAU);
    x.fill();
    x.restore();
  };
})();
