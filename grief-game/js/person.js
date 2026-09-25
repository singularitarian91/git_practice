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
  function limb(x, pts, w, col, dark) {
    x.strokeStyle = col;
    x.lineWidth = w;
    x.lineCap = 'round';
    x.lineJoin = 'round';
    x.beginPath();
    x.moveTo(pts[0], pts[1]);
    for (let i = 2; i < pts.length; i += 2) x.lineTo(pts[i], pts[i + 1]);
    x.stroke();
    if (dark) {
      x.strokeStyle = 'rgba(0,0,0,' + dark + ')';
      x.stroke();
    }
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

  /* p = {
   *   x, y, s, dir, t,
   *   look: preset, walk: 0..1, phase, kneel: 0..1, lean, wind, loose,
   *   bow, reach: {x, y} world target for the near hand (or null), reachBoth,
   *   carry: bool, alpha
   * }
   * Writes world-space hand positions to p.out.
   */
  person.draw = function (x, p) {
    const look = p.look || person.HERO;
    const s = p.s, dir = p.dir || 1, t = p.t || G.time;
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
      if (trouF !== trou) limb(x, [hipX, hipY, lp.kx, lp.ky, lp.ax, lp.ay], 0.056, trouF, far ? 0.3 : 0);
      else limb(x, [hipX, hipY, lp.kx, lp.ky, lp.ax, lp.ay], 0.056, far ? trouD : trou);
      // boot
      const bootCol = far ? shade(look.boots, -0.3) : look.boots;
      x.save();
      x.translate(lp.ax, lp.ay);
      // walking: toe follows the shin; kneeling: foot turned back, sole up
      x.rotate(M.lerp(M.clamp((lp.th - lp.kb) * 0.35, -0.3, 0.5), Math.PI * 0.94, k));
      x.fillStyle = bootCol;
      x.beginPath();
      x.moveTo(-0.03, -0.035);
      x.lineTo(0.035, -0.03);
      x.quadraticCurveTo(0.085, -0.02, 0.085, 0.004);
      x.lineTo(-0.035, 0.008);
      x.closePath();
      x.fill();
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
    if (coatF !== coat) limb(x, [shoulder.x, shoulder.y, farHand.ex, farHand.ey, farHand.hx, farHand.hy], 0.05, coatF, 0.3);
    else limb(x, [shoulder.x, shoulder.y, farHand.ex, farHand.ey, farHand.hx, farHand.hy], 0.05, coatD);
    x.fillStyle = shade(look.skin, -0.2);
    x.beginPath();
    x.arc(farHand.hx, farHand.hy, 0.022, 0, TAU);
    x.fill();
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
    x.fillStyle = coatF;
    x.beginPath();
    x.moveTo(0.045, -0.33);
    x.quadraticCurveTo(0.085, -0.28, 0.078, -0.2);
    x.lineTo(0.082, -0.05);
    x.lineTo(hem[0][0], hem[0][1]);
    for (let i = 1; i <= hemN; i++) x.lineTo(hem[i][0], hem[i][1]);
    x.quadraticCurveTo(-0.1 - flare * 0.3, 0.02, -0.088, -0.12);
    x.quadraticCurveTo(-0.085, -0.28, -0.05, -0.325);
    x.closePath();
    x.fill();
    // shading down the back and a lighter front panel
    x.save();
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
    x.strokeStyle = M.rgba(coatD, 0.9);
    x.lineWidth = 0.007;
    x.beginPath();
    x.moveTo(hem[0][0], hem[0][1]);
    for (let i = 1; i <= hemN; i++) x.lineTo(hem[i][0], hem[i][1]);
    x.stroke();

    // ----- head
    const bow = (p.bow || 0) + k * 0.25;
    x.save();
    x.translate(0.012, -0.335);
    x.rotate(bow);
    // neck
    x.fillStyle = shade(look.skin, -0.12);
    x.fillRect(-0.018, -0.05, 0.036, 0.05);
    const hx = 0.012, hy = -0.1, hr = 0.074;
    x.fillStyle = look.skin;
    x.beginPath();
    x.ellipse(hx, hy, hr * 0.92, hr, 0, 0, TAU);
    x.fill();
    // a little modelling: the back of the head in shade, a warm cheek
    x.save();
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
    x.fillStyle = look.skin;
    // nose hint
    x.beginPath();
    x.moveTo(hx + hr * 0.85, hy - 0.01);
    x.lineTo(hx + hr * 1.05, hy + 0.012);
    x.lineTo(hx + hr * 0.84, hy + 0.02);
    x.fill();
    drawHair(x, look, hx, hy, hr, t, wind, walk);
    x.restore();

    // collar
    x.fillStyle = coatD;
    x.beginPath();
    x.moveTo(-0.055, -0.33);
    x.quadraticCurveTo(0.0, -0.37, 0.05, -0.335);
    x.lineTo(0.04, -0.3);
    x.quadraticCurveTo(0, -0.325, -0.05, -0.3);
    x.closePath();
    x.fill();

    // their scarf, once it's been freed from the thorns: wound at the neck, one end loose
    if (p.scarf) {
      const fl = wind * 0.09 + walk * 0.025;
      const knit = G.paint.cloth && G.paint.cloth(x, 'rust', '#8e4a2a', WEAVE * 0.8);
      x.fillStyle = knit || '#8e4a2a';
      x.beginPath();
      x.moveTo(-0.07, -0.345);
      x.quadraticCurveTo(0.0, -0.385, 0.068, -0.35);
      x.lineTo(0.06, -0.305);
      x.quadraticCurveTo(0.0, -0.335, -0.062, -0.3);
      x.closePath();
      x.fill();
      x.beginPath();
      x.moveTo(-0.04, -0.33);
      x.quadraticCurveTo(-0.09 - fl, -0.3 + Math.sin(t * 5) * 0.01, -0.12 - fl * 1.6, -0.2 + Math.sin(t * 7 + 1) * 0.015 * (0.3 + wind));
      x.lineTo(-0.085 - fl * 1.3, -0.19);
      x.quadraticCurveTo(-0.06, -0.27, -0.01, -0.31);
      x.closePath();
      x.fill();
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
    limb(x, [shoulder.x, shoulder.y, nearHand.ex, nearHand.ey, nearHand.hx, nearHand.hy], 0.056, coatF);
    limb(x, [shoulder.x, shoulder.y, nearHand.ex, nearHand.ey], 0.02, M.rgba(coatL, 0.4));
    // cuff and hand
    x.fillStyle = look.skin;
    x.beginPath();
    x.arc(nearHand.hx, nearHand.hy, 0.025, 0, TAU);
    x.fill();
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

  function drawHair(x, look, hx, hy, hr, t, wind, walk) {
    x.fillStyle = look.hair;
    const flow = wind * 0.06 + walk * 0.01;
    if (look.hairStyle === 'bun') {
      x.beginPath();
      x.ellipse(hx - 0.01, hy - 0.02, hr * 1.02, hr * 0.95, 0, Math.PI * 0.95, Math.PI * 2.2);
      x.lineTo(hx - hr * 0.9, hy + 0.02);
      x.fill();
      x.beginPath();
      x.arc(hx - hr * 0.95, hy - hr * 0.45, hr * 0.42, 0, TAU);
      x.fill();
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
    x.fill();
    if (look.beard) {
      x.beginPath();
      x.moveTo(hx + hr * 0.1, hy + hr * 0.35);
      x.quadraticCurveTo(hx + hr * 0.9, hy + hr * 1.05, hx + hr * 0.95, hy + hr * 0.25);
      x.lineTo(hx + hr * 0.6, hy + hr * 0.4);
      x.closePath();
      x.fill();
    }
    // loose strands in the wind
    if (wind > 0.05 || walk > 0.2) {
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
