/* Chapter 01 / Denial: "The room repeats before it can be left."
 * Translucent sewn rooms, repeated furniture, a doorway with one detail missing.
 * Play: inspect the familiar room; notice what changes between its copies.
 */
(function () {
  'use strict';
  const G = window.G, M = G.M, C = G.C, P = G.paint;
  const TAU = M.TAU;
  const FLOOR = 600, GROUND = 662, HERO = 300;
  const GAUZE = [0, 0.2, 0.42, 0.64, 0.86];
  const DOOR_L = { x: 70, y: 238, w: 145, h: 362 };
  const DOOR_R = { x: 1095, y: 238, w: 140, h: 362 };
  // Painted scenery (assets/art/denial): the room with its walls turning to cloth, and small
  // painted pieces laid over it for the things that change. [x, y, w, h] in stage units.
  const PATCH = { cupB: [907, 414, 47, 43], coat: [997, 270, 109, 278] };
  const ART = { room: 'denial/room.webp', gauze: 'denial/gauze.webp', warm: 'denial/warm.webp', open: 'denial/warm-open.webp' };
  const LOOK_FIRST = 3; // things to look at in the first room before its door will open

  const LINES = {
    bed: { 0: 'The bed, half made. Their side is still creased.', n: 'The bed, half made. The same.', rv: 'The bed is made now.' },
    prints: { 0: 'Pressed ferns. We framed them together.', n: 'The ferns, behind glass.', rv: 'Pressed ferns. We framed them together.' },
    window: { 0: 'Overcast. The lake is flat and grey.', n: 'The same grey light.', 4: 'Beyond the glass, only more of this room.', rv: 'Still overcast. A little brighter.' },
    chair: { 0: 'The chair by the window, where the light is best.', n: 'The chair by the window.', 3: 'Turned toward the door.', 4: 'Still turned toward the door.', rv: 'Their chair by the window. Empty, and still here.' },
    cups: { 0: 'Two cups. One still has tea in it.', n: 'One cup.', rv: 'One cup.' },
    hook: { 0: 'Their coat, on its hook.', 1: 'Their coat, on its hook.', n: 'The bare hook.', rv: 'The bare hook.' },
    vase: { 0: 'Dry stems. I should throw them out.', n: 'Dry stems.', rv: 'A fresh flower in the vase.' },
    back: { 0: 'The way I came in.', n: 'Behind me, the same room.', rv: 'The way I came in.' }
  };
  const CHANGES = {
    1: { id: 'cups', lines: ['One cup.', 'There were two.'], mark: [912, 414] },
    2: { id: 'hook', lines: ['The hook is bare.', 'Their coat isn’t here.'], mark: [1045, 336] },
    3: { id: 'chair', lines: ['The chair has turned toward the door.', 'As if someone might still come in.'], mark: [742, 470] }
  };
  const ENTER = [
    'Everything is where it should be.',
    'The same room.',
    'The same room. Paler, somehow.',
    'Thinner now. Like cloth.',
    'The walls are only cloth now.'
  ];
  const PANELS = [
    [],
    [[520, 70, 150, 300, 0.2], [1000, 70, 120, 250, 0.18]],
    [[150, 70, 170, 360, 0.22], [520, 70, 150, 330, 0.24], [990, 70, 140, 290, 0.22]],
    [[30, 70, 200, 470, 0.24], [330, 70, 180, 380, 0.22], [530, 70, 140, 360, 0.28], [880, 70, 200, 360, 0.24]],
    [[0, 70, 235, 520, 0.28], [240, 70, 215, 430, 0.26], [462, 70, 195, 400, 0.28], [880, 70, 210, 400, 0.26]]
  ];

  // ------------------------------------------------------------ painting
  function ghostRoom(x, cx, cy, k, a, st) {
    x.save();
    x.globalAlpha *= a;
    x.translate(cx, cy);
    x.scale(k, k);
    x.translate(-640, -335);
    x.fillStyle = '#cdc9c2';
    x.fillRect(0, 70, 1280, 530);
    x.fillStyle = 'rgba(255,255,255,0.5)';
    for (const sx of [165, 470, 640, 900, 1075]) x.fillRect(sx - 4, 70, 8, 530);
    x.fillStyle = '#8f8a84';
    x.fillRect(0, 0, 1280, 70);
    x.fillStyle = '#f4f6f7';
    x.fillRect(680, 210, 180, 230);
    x.strokeStyle = '#6c665f';
    x.lineWidth = 10;
    x.strokeRect(680, 210, 180, 230);
    x.fillStyle = '#6a645d';
    x.fillRect(DOOR_L.x, DOOR_L.y, DOOR_L.w, DOOR_L.h);
    x.fillRect(DOOR_R.x, DOOR_R.y, DOOR_R.w, DOOR_R.h);
    x.fillStyle = '#857e75';
    x.fillRect(0, 600, 1280, 120);
    x.fillStyle = '#efede9';
    x.fillRect(262, 500, 336, 62);
    x.fillStyle = '#5a554f';
    x.fillRect(250, 420, 14, 190);
    x.fillRect(590, 480, 14, 130);
    x.fillStyle = '#6f675f';
    x.fillRect(880, 455, 130, 145);
    P.chair(x, st.chairX, 612, { s: 165, facing: st.chairFacing, wood: '#5f5850', woodDark: '#4f4943', woodLight: '#7a736b' });
    x.restore();
  }

  function paintWindow(x, st, r) {
    const wx = 680, wy = 210, ww = 180, wh = 230;
    x.save();
    x.beginPath();
    x.rect(wx, wy, ww, wh);
    x.clip();
    const sky = x.createLinearGradient(0, wy, 0, wy + wh);
    sky.addColorStop(0, st.warm ? '#cbc3b6' : '#b9c0c7');
    sky.addColorStop(0.6, st.warm ? '#efe5d2' : '#e2e6e9');
    sky.addColorStop(0.61, '#8a9198');
    sky.addColorStop(1, '#a6adb4');
    x.fillStyle = sky;
    x.fillRect(wx, wy, ww, wh);
    x.fillStyle = 'rgba(104,110,118,0.85)';
    x.beginPath();
    x.moveTo(wx, wy + wh * 0.61);
    for (let i = 0; i <= 12; i++) x.lineTo(wx + ww * i / 12, wy + wh * 0.61 - 8 - Math.sin(i * 0.9) * 9 - r() * 4);
    x.lineTo(wx + ww, wy + wh * 0.62);
    x.closePath();
    x.fill();
    x.strokeStyle = 'rgba(240,244,246,0.5)';
    x.lineWidth = 1;
    for (let i = 0; i < 14; i++) {
      const yy = wy + wh * r.range(0.64, 0.98);
      const sx = wx + r() * ww;
      x.beginPath();
      x.moveTo(sx, yy);
      x.lineTo(sx + r.range(10, 40), yy);
      x.stroke();
    }
    // bare tree
    x.strokeStyle = 'rgba(44,44,46,0.75)';
    x.lineCap = 'round';
    const branch = (bx, by, ang, len, w, d) => {
      if (d > 5 || len < 5) return;
      const ex = bx + Math.cos(ang) * len, ey = by + Math.sin(ang) * len;
      x.lineWidth = w;
      x.beginPath();
      x.moveTo(bx, by);
      x.lineTo(ex, ey);
      x.stroke();
      branch(ex, ey, ang - r.range(0.25, 0.6), len * r.range(0.6, 0.78), w * 0.62, d + 1);
      branch(ex, ey, ang + r.range(0.25, 0.6), len * r.range(0.6, 0.78), w * 0.62, d + 1);
    };
    branch(wx + 130, wy + wh * 0.63, -Math.PI / 2 - 0.05, 52, 4, 0);
    x.restore();
    x.strokeStyle = '#3a2e26';
    x.lineWidth = 11;
    x.strokeRect(wx, wy, ww, wh);
    x.lineWidth = 6;
    x.beginPath();
    x.moveTo(wx + ww / 2, wy);
    x.lineTo(wx + ww / 2, wy + wh);
    x.moveTo(wx, wy + wh * 0.42);
    x.lineTo(wx + ww, wy + wh * 0.42);
    x.stroke();
    x.fillStyle = '#4a3a2e';
    x.fillRect(wx - 16, wy + wh + 2, ww + 32, 12);
    x.fillStyle = 'rgba(0,0,0,0.25)';
    x.fillRect(wx - 16, wy + wh + 14, ww + 32, 6);
  }

  function paintPrint(x, px, py, w, h) {
    x.fillStyle = 'rgba(0,0,0,0.25)';
    x.fillRect(px - 1, py + 2, w + 8, h + 8);
    x.fillStyle = '#3a2e26';
    x.fillRect(px - 4, py - 4, w + 8, h + 8);
    x.fillStyle = '#e8e2d4';
    x.fillRect(px, py, w, h);
    const cx = px + w / 2;
    x.strokeStyle = '#5c6b52';
    x.lineWidth = 1.2;
    x.lineCap = 'round';
    x.beginPath();
    x.moveTo(cx, py + h - 6);
    x.quadraticCurveTo(cx + 3, py + h / 2, cx - 2, py + 8);
    x.stroke();
    x.beginPath();
    for (let i = 0; i < 9; i++) {
      const t = i / 9;
      const yy = py + h - 10 - t * (h - 20);
      const len = (1 - t) * w * 0.3 + 3;
      x.moveTo(cx, yy);
      x.quadraticCurveTo(cx - len * 0.6, yy - 4, cx - len, yy - 2);
      x.moveTo(cx, yy);
      x.quadraticCurveTo(cx + len * 0.6, yy - 4, cx + len, yy - 2);
    }
    x.stroke();
    x.fillStyle = 'rgba(255,255,255,0.14)';
    x.beginPath();
    x.moveTo(px, py);
    x.lineTo(px + w * 0.5, py);
    x.lineTo(px, py + h * 0.45);
    x.fill();
  }

  function paintCoat(x) {
    x.fillStyle = '#55575a';
    x.beginPath();
    x.moveTo(1045, 297);
    x.quadraticCurveTo(1022, 300, 1016, 320);
    x.lineTo(1010, 522);
    x.quadraticCurveTo(1045, 530, 1081, 522);
    x.lineTo(1075, 320);
    x.quadraticCurveTo(1068, 300, 1045, 297);
    x.fill();
    x.fillStyle = 'rgba(0,0,0,0.25)';
    x.beginPath();
    x.moveTo(1016, 320);
    x.lineTo(1010, 522);
    x.lineTo(1030, 525);
    x.lineTo(1030, 330);
    x.fill();
    x.strokeStyle = 'rgba(20,20,22,0.55)';
    x.lineWidth = 1.5;
    x.beginPath();
    x.moveTo(1045, 300);
    x.lineTo(1052, 360);
    x.lineTo(1047, 522);
    x.moveTo(1045, 300);
    x.lineTo(1034, 350);
    x.stroke();
    x.fillStyle = '#2a2a2c';
    for (let i = 0; i < 4; i++) {
      x.beginPath();
      x.arc(1056, 372 + i * 34, 2.6, 0, TAU);
      x.fill();
    }
    // sleeve hanging on the near side
    x.fillStyle = '#4a4c4f';
    x.beginPath();
    x.moveTo(1073, 326);
    x.quadraticCurveTo(1083, 400, 1078, 470);
    x.lineTo(1066, 470);
    x.quadraticCurveTo(1068, 400, 1064, 332);
    x.fill();
  }

  function paintFloor(x, r, st) {
    const fl = x.createLinearGradient(0, FLOOR, 0, G.H);
    fl.addColorStop(0, st.warm ? '#56443a' : '#4a3a2f');
    fl.addColorStop(1, '#241c17');
    x.fillStyle = fl;
    x.fillRect(0, FLOOR, G.W, G.H - FLOOR);
    x.strokeStyle = 'rgba(0,0,0,0.32)';
    x.lineWidth = 1.1;
    for (let i = -22; i <= 22; i++) {
      x.beginPath();
      x.moveTo(640 + i * 72 * 0.647, FLOOR);
      x.lineTo(640 + i * 72, G.H);
      x.stroke();
    }
    x.strokeStyle = 'rgba(0,0,0,0.22)';
    for (let i = 0; i < 40; i++) {
      const lane = r.int(-20, 20), v = r();
      const yy = FLOOR + v * (G.H - FLOOR);
      const f = 0.647 + v * 0.353;
      const x0 = 640 + lane * 72 * f, x1 = 640 + (lane + 1) * 72 * f;
      x.beginPath();
      x.moveTo(x0, yy);
      x.lineTo(x1, yy);
      x.stroke();
    }
    x.strokeStyle = 'rgba(210,190,160,0.06)';
    x.lineWidth = 3;
    for (let i = 0; i < 18; i++) {
      const yy = FLOOR + r() * 110, sx = r() * G.W;
      x.beginPath();
      x.moveTo(sx, yy);
      x.lineTo(sx + r.range(40, 160), yy + r.range(-1, 1));
      x.stroke();
    }
    // rug before the bed
    x.save();
    x.beginPath();
    x.moveTo(300, 612);
    x.lineTo(640, 612);
    x.lineTo(676, 652);
    x.lineTo(270, 652);
    x.closePath();
    x.fillStyle = '#6e4d40';
    x.fill();
    x.clip();
    x.strokeStyle = 'rgba(214,186,147,0.35)';
    x.lineWidth = 2;
    for (let i = 0; i < 5; i++) {
      x.beginPath();
      x.moveTo(250, 617 + i * 8);
      x.lineTo(700, 617 + i * 8);
      x.stroke();
    }
    P.hatch(x, 260, 610, 430, 45, { color: 'rgba(0,0,0,0.18)', gap: 4, angle: 0.6, rng: r });
    x.restore();
    // skirting board
    x.fillStyle = '#2a211b';
    x.fillRect(0, FLOOR - 12, G.W, 14);
    x.fillStyle = 'rgba(255,240,220,0.06)';
    x.fillRect(0, FLOOR - 12, G.W, 2);
  }

  function paintBed(x, r) {
    const d = [40, -22];
    x.fillStyle = 'rgba(0,0,0,0.32)';
    x.fillRect(252, 588, 360, 26);
    const iron = '#2d2b29';
    x.lineCap = 'round';
    // far posts
    x.strokeStyle = '#3c3a37';
    x.lineWidth = 6;
    x.beginPath();
    x.moveTo(254 + d[0], 612 + d[1]);
    x.lineTo(254 + d[0], 412 + d[1]);
    x.moveTo(598 + d[0], 612 + d[1]);
    x.lineTo(598 + d[0], 478 + d[1]);
    x.stroke();
    // mattress top and side
    x.fillStyle = '#cfcac2';
    x.beginPath();
    x.moveTo(262, 505);
    x.lineTo(598, 505);
    x.lineTo(598 + d[0], 505 + d[1]);
    x.lineTo(262 + d[0], 505 + d[1]);
    x.closePath();
    x.fill();
    x.fillStyle = '#bdb7ae';
    x.fillRect(262, 505, 336, 54);
    // pillows
    for (const [px, py] of [[318, 478], [300, 492]]) {
      x.fillStyle = '#e9e6e0';
      x.beginPath();
      x.ellipse(px, py, 48, 17, -0.08, 0, TAU);
      x.fill();
      x.strokeStyle = 'rgba(80,76,70,0.35)';
      x.lineWidth = 1;
      x.stroke();
    }
    // rumpled cover
    x.fillStyle = '#e4e0d9';
    x.beginPath();
    x.moveTo(345, 492);
    for (let i = 0; i <= 10; i++) x.lineTo(345 + i * 26, 494 - Math.sin(i * 1.7) * 6 - r() * 5);
    x.lineTo(610, 498);
    x.lineTo(606, 574);
    for (let i = 10; i >= 0; i--) x.lineTo(345 + i * 26 - 20, 572 + Math.sin(i * 2.3) * 5);
    x.closePath();
    x.fill();
    x.strokeStyle = 'rgba(90,86,80,0.35)';
    x.lineWidth = 1.2;
    for (let i = 0; i < 8; i++) {
      const sx = 360 + r() * 230;
      x.beginPath();
      x.moveTo(sx, 500 + r() * 10);
      x.quadraticCurveTo(sx + r.range(-20, 20), 530, sx + r.range(-30, 10), 568);
      x.stroke();
    }
    // folded blanket at the foot
    x.fillStyle = '#5f6b75';
    x.fillRect(530, 494, 70, 22);
    x.fillStyle = 'rgba(0,0,0,0.2)';
    x.fillRect(530, 510, 70, 6);
    // near posts and rails
    x.strokeStyle = iron;
    x.lineWidth = 8;
    x.beginPath();
    x.moveTo(254, 614);
    x.lineTo(254, 410);
    x.moveTo(600, 614);
    x.lineTo(600, 476);
    x.stroke();
    x.lineWidth = 4;
    x.beginPath();
    x.moveTo(254, 420);
    x.quadraticCurveTo(274 + d[0] / 2, 404 + d[1] / 2, 254 + d[0], 420 + d[1]);
    x.moveTo(600, 482);
    x.lineTo(600 + d[0], 482 + d[1]);
    x.stroke();
    x.lineWidth = 2;
    x.beginPath();
    for (let i = 1; i < 4; i++) {
      x.moveTo(254 + d[0] * i / 4, 424 + d[1] * i / 4);
      x.lineTo(254 + d[0] * i / 4, 500 + d[1] * i / 4);
    }
    x.stroke();
    x.fillStyle = '#9a8a6a';
    for (const [bx, by] of [[254, 408], [600, 474]]) {
      x.beginPath();
      x.arc(bx, by, 5, 0, TAU);
      x.fill();
    }
  }

  function paintDresser(x, r, st) {
    const L = 880, R = 1010, T = 455, B = 600;
    x.fillStyle = 'rgba(0,0,0,0.3)';
    x.fillRect(L - 6, B - 6, R - L + 12, 18);
    x.fillStyle = '#3b2c22';
    x.fillRect(L, T, R - L, B - T - 6);
    x.fillStyle = '#4e3b2d';
    x.fillRect(L - 7, T - 9, R - L + 14, 11);
    x.strokeStyle = 'rgba(0,0,0,0.45)';
    x.lineWidth = 1.5;
    for (let i = 0; i < 3; i++) {
      const dy = T + 12 + i * 42;
      x.strokeRect(L + 8, dy, R - L - 16, 34);
      x.fillStyle = '#a58a55';
      x.beginPath();
      x.arc(L + 38, dy + 17, 3, 0, TAU);
      x.arc(R - 38, dy + 17, 3, 0, TAU);
      x.fill();
    }
    x.fillStyle = 'rgba(255,230,200,0.08)';
    x.fillRect(L - 7, T - 9, R - L + 14, 2);
    // cups
    for (let i = 0; i < st.cups; i++) {
      const cx = 898 + i * 28, cy = T - 9;
      x.fillStyle = '#e9e4da';
      x.beginPath();
      x.moveTo(cx - 8, cy - 15);
      x.lineTo(cx + 8, cy - 15);
      x.lineTo(cx + 6, cy);
      x.lineTo(cx - 6, cy);
      x.closePath();
      x.fill();
      x.strokeStyle = '#e9e4da';
      x.lineWidth = 2;
      x.beginPath();
      x.arc(cx + 10, cy - 8, 4, -1.2, 1.2);
      x.stroke();
      x.fillStyle = '#2f3a44';
      x.fillRect(cx - 8, cy - 16, 16, 2);
      if (i === 0 && st.cups === 2) {
        x.fillStyle = 'rgba(120,80,40,0.8)';
        x.beginPath();
        x.ellipse(cx, cy - 14, 6, 1.4, 0, 0, TAU);
        x.fill();
      }
    }
    // vase
    const vx = 985, vy = T - 9;
    x.fillStyle = '#7d857c';
    x.beginPath();
    x.moveTo(vx - 5, vy - 36);
    x.lineTo(vx + 5, vy - 36);
    x.quadraticCurveTo(vx + 14, vy - 18, vx + 9, vy);
    x.lineTo(vx - 9, vy);
    x.quadraticCurveTo(vx - 14, vy - 18, vx - 5, vy - 36);
    x.fill();
    x.fillStyle = 'rgba(255,255,255,0.15)';
    x.fillRect(vx - 7, vy - 28, 3, 20);
    x.lineCap = 'round';
    if (st.flower) {
      x.strokeStyle = '#51623f';
      x.lineWidth = 1.6;
      x.beginPath();
      x.moveTo(vx, vy - 36);
      x.quadraticCurveTo(vx - 4, vy - 60, vx + 2, vy - 78);
      x.stroke();
      x.fillStyle = '#f4efe4';
      for (let i = 0; i < 7; i++) {
        const a = i / 7 * TAU;
        x.beginPath();
        x.ellipse(vx + 2 + Math.cos(a) * 6, vy - 80 + Math.sin(a) * 6, 6, 3, a, 0, TAU);
        x.fill();
      }
      x.fillStyle = '#d0a63a';
      x.beginPath();
      x.arc(vx + 2, vy - 80, 3, 0, TAU);
      x.fill();
    } else {
      x.strokeStyle = '#6a5238';
      x.lineWidth = 1.2;
      x.beginPath();
      for (const [ex, ey, cx2] of [[-22, -92, -8], [10, -98, 6], [26, -80, 18], [-2, -104, -4]]) {
        x.moveTo(vx, vy - 36);
        x.quadraticCurveTo(vx + cx2, vy - 60, vx + ex, vy + ey);
      }
      x.stroke();
      x.fillStyle = '#7a5e40';
      for (const [ex, ey] of [[-22, -92], [10, -98], [26, -80]]) {
        x.beginPath();
        x.arc(vx + ex, vy + ey, 2.2, 0, TAU);
        x.fill();
      }
    }
  }

  function paintDoorFrame(x, d) {
    x.fillStyle = '#2a1f18';
    x.fillRect(d.x - 13, d.y - 15, d.w + 26, d.h + 15);
    x.fillStyle = '#3b2d23';
    x.fillRect(d.x - 13, d.y - 15, d.w + 26, 5);
    x.fillStyle = '#15110e';
    x.fillRect(d.x, d.y, d.w, d.h);
  }

  function paintRoom(st) {
    const L = G.layer(G.W, G.H);
    const x = L.x;
    const r = M.rng(101);
    const g = st.g;

    const bg = x.createLinearGradient(0, 0, 0, FLOOR);
    bg.addColorStop(0, '#9da1a4');
    bg.addColorStop(1, '#c4c6c5');
    x.fillStyle = bg;
    x.fillRect(0, 0, G.W, FLOOR);
    if (g > 0) {
      ghostRoom(x, 640, 336, 0.7, 0.8, st);
      ghostRoom(x, 640, 322, 0.47, 0.72, st);
      ghostRoom(x, 640, 312, 0.31, 0.64, st);
      ghostRoom(x, 640, 305, 0.2, 0.56, st);
    }

    // back wall with the damask print
    x.save();
    x.globalAlpha = 1 - g * 0.8;
    x.fillStyle = st.warm ? '#d4c9b5' : '#c5bfb4';
    x.fillRect(0, 70, G.W, FLOOR - 70);
    x.globalAlpha = (1 - g * 0.8) * 0.6;
    x.fillStyle = P.patternOf(x, P.damaskPale, 1);
    x.fillRect(0, 70, G.W, FLOOR - 70);
    x.restore();
    x.save();
    x.globalAlpha = 1 - g * 0.6;
    const sh = x.createLinearGradient(0, 70, 0, FLOOR);
    sh.addColorStop(0, 'rgba(30,26,22,0.5)');
    sh.addColorStop(0.35, 'rgba(30,26,22,0.05)');
    sh.addColorStop(1, 'rgba(30,26,22,0.28)');
    x.fillStyle = sh;
    x.fillRect(0, 70, G.W, FLOOR - 70);
    for (let i = 0; i < 26; i++) P.glow(x, r() * G.W, r.range(80, FLOOR - 20), r.range(20, 90), '#5a4636', r.range(0.05, 0.13));
    x.strokeStyle = 'rgba(40,32,26,0.35)';
    x.lineWidth = 1;
    for (let i = 0; i < 6; i++) {
      const cx = r() * G.W, cy = r.range(90, 300);
      x.beginPath();
      P.wobbleLine(x, cx, cy, cx + r.range(-40, 40), cy + r.range(40, 120), 5, r() * 100);
      x.stroke();
    }
    // light falling off away from the window
    const wl = x.createRadialGradient(770, 330, 60, 770, 330, 700);
    wl.addColorStop(0, st.warm ? 'rgba(255,236,200,0.14)' : 'rgba(235,240,245,0.12)');
    wl.addColorStop(1, 'rgba(20,18,16,0.25)');
    x.fillStyle = wl;
    x.fillRect(0, 70, G.W, FLOOR - 70);
    x.restore();

    // seams where the walls are becoming cloth
    if (g > 0) {
      const sa = Math.min(1, g * 1.5);
      x.fillStyle = M.rgba('#eeebe5', g * 0.22);
      x.fillRect(0, 70, G.W, FLOOR - 70);
      for (const sx of [165, 470, 640, 900, 1075]) {
        P.whipstitch(x, sx, 74, sx, FLOOR - 12, { color: M.rgba('#f4f0e8', sa * 0.85), gap: 11, len: 7, seam: M.rgba('#7d7872', sa * 0.6) });
      }
      P.whipstitch(x, 0, 186, G.W, 186, { color: M.rgba('#f4f0e8', sa * 0.6), gap: 12, len: 6, seam: M.rgba('#7d7872', sa * 0.4) });
    }

    // ceiling
    x.save();
    x.globalAlpha = 1 - g * 0.55;
    x.fillStyle = '#26221e';
    x.fillRect(0, 0, G.W, 70);
    x.fillStyle = '#3a322b';
    x.fillRect(0, 56, G.W, 16);
    x.restore();
    if (g > 0.3) {
      x.fillStyle = M.rgba('#e9e6e0', (g - 0.3) * 0.5);
      x.fillRect(0, 0, G.W, 70);
      for (let i = 0; i < 8; i++) P.whipstitch(x, i * 170, 0, i * 170 + 60, 70, { color: M.rgba('#f4f0e8', g * 0.5), gap: 9, len: 5 });
    }

    x.save();
    x.globalAlpha = 1 - g * 0.35;
    paintWindow(x, st, r);
    paintPrint(x, 315, 285, 56, 70);
    paintPrint(x, 395, 306, 46, 58);
    paintPrint(x, 916, 318, 50, 62);
    x.restore();

    // hook (and, early on, their coat)
    x.fillStyle = '#5b4a32';
    x.fillRect(1037, 284, 16, 9);
    x.fillStyle = '#b08d4a';
    x.beginPath();
    x.arc(1045, 294, 3.5, 0, TAU);
    x.fill();
    if (st.coat) paintCoat(x);

    paintDoorFrame(x, DOOR_L);
    paintDoorFrame(x, DOOR_R);
    paintFloor(x, r, st);
    paintBed(x, r);
    paintDresser(x, r, st);
    P.texturize(L, 0.28);
    return L;
  }

  // A door leaf swinging toward the viewer. open: 0 closed .. 1 open.
  function doorLeaf(x, d, open, hingeLeft) {
    if (open >= 0.995) return;
    const th = open * 1.35;
    const ww = d.w * Math.cos(th);
    const bulge = d.h * 0.07 * Math.sin(th);
    const x0 = hingeLeft ? d.x : d.x + d.w;
    const x1 = hingeLeft ? d.x + ww : d.x + d.w - ww;
    const q = (u, v) => {
      const xx = M.lerp(x0, x1, u);
      const top = M.lerp(d.y, d.y - bulge, u), bot = M.lerp(d.y + d.h, d.y + d.h + bulge, u);
      return [xx, M.lerp(top, bot, v)];
    };
    const poly = (pts) => { x.beginPath(); pts.forEach((p, i) => (i ? x.lineTo(p[0], p[1]) : x.moveTo(p[0], p[1]))); x.closePath(); };
    poly([q(0, 0), q(1, 0), q(1, 1), q(0, 1)]);
    const g = x.createLinearGradient(x0, 0, x1, 0);
    g.addColorStop(0, '#3a2b20');
    g.addColorStop(1, M.mixColor('#4d3a2b', '#6a5240', open));
    x.fillStyle = g;
    x.fill();
    x.strokeStyle = 'rgba(0,0,0,0.45)';
    x.lineWidth = 2;
    poly([q(0.16, 0.08), q(0.84, 0.08), q(0.84, 0.44), q(0.16, 0.44)]);
    x.stroke();
    poly([q(0.16, 0.54), q(0.84, 0.54), q(0.84, 0.92), q(0.16, 0.92)]);
    x.stroke();
    const k = q(0.86, 0.52);
    x.fillStyle = '#b39152';
    x.beginPath();
    x.arc(k[0], k[1], 4, 0, TAU);
    x.fill();
  }

  // The painted door leaf, cut from the room painting and swung toward the viewer in strips.
  function paintedLeaf(x, img, d, open, hingeLeft, alpha) {
    if (open >= 0.995 || !img) return;
    const th = open * 1.35, ww = d.w * Math.cos(th), bulge = d.h * 0.07 * Math.sin(th);
    const k = img.naturalWidth / G.W, N = 12;
    x.save();
    x.globalAlpha *= alpha == null ? 1 : alpha;
    for (let i = 0; i < N; i++) {
      const u0 = i / N, u1 = (i + 1) / N, um = (u0 + u1) / 2;
      const sx = hingeLeft ? d.x + d.w * u0 : d.x + d.w * (1 - u1);
      const dx0 = hingeLeft ? d.x + ww * u0 : d.x + d.w - ww * u1;
      const top = d.y - bulge * um, h = d.h + 2 * bulge * um;
      x.drawImage(img, sx * k, d.y * k, (d.w / N) * k, d.h * k, dx0, top, ww / N + 0.6, h);
    }
    // the leaf darkens as it turns away from the window light
    x.fillStyle = 'rgba(10,8,6,' + (0.45 * open) + ')';
    x.beginPath();
    const x0 = hingeLeft ? d.x : d.x + d.w, x1 = hingeLeft ? d.x + ww : d.x + d.w - ww;
    x.moveTo(x0, d.y); x.lineTo(x1, d.y - bulge); x.lineTo(x1, d.y + d.h + bulge); x.lineTo(x0, d.y + d.h);
    x.closePath();
    x.fill();
    x.restore();
  }

  // ------------------------------------------------------------ scene
  function Denial(o) {
    o = o || {};
    G.SideScene.call(this, {
      zoom: 1, minX: 150, maxX: 1165, startX: 205, speed: 270, heroScale: HERO, groundY: GROUND,
      loose: 0.15, follow: false, surface: 'wood', glintRange: 340
    });
    this.revisit = !!o.revisit;
    this.groundY = GROUND;
    this.cam.x = G.W / 2;
    this.cam.y = G.H / 2;
    this.finish = { vignette: 0.9, grain: 0.55 };
    // the light the cut-paper figure stands in: cool window daylight (warm afternoon on a return)
    this.paperLight = this.revisit ? { tint: '#f0d6a8', tintA: 0.2 } : { tint: '#e3e1db', tintA: 0.16 };
    this.copy = 0;
    this.noticed = 0;
    this.loops = 0;
    this.marks = [];
    this.white = 0;
    this.leftDoor = 0;
    this.rightDoor = 0;
    this.anim = null;
    this.pull = 0;
    this.popped = 0;
    this.bits = [];
    this.ending = null;
    this.ribbons = [];
    this.pushT = 0;
    this.player.alpha = 1;
    this.looked = new Set();
    this.nudged = 0;
    this.remember = 0;
    this.windowOpen = 0;
  }
  Denial.prototype = Object.create(G.SideScene.prototype);
  G.chapters.Denial = Denial;
  Denial.art = o => (o.revisit ? [ART.warm, ART.open] : [ART.room, ART.gauze, 'denial/cupB.webp', 'denial/coat.webp', 'denial/coat-card.webp']);

  Denial.prototype.state = function () {
    const c = this.copy, rv = this.revisit;
    return {
      copy: c,
      g: rv ? 0 : GAUZE[c],
      cups: rv ? 1 : (c >= 1 ? 1 : 2),
      coat: rv ? false : c < 2,
      chairX: rv ? 640 : (c >= 3 ? 742 : 640),
      chairFacing: rv ? 1 : (c >= 3 ? -1 : 1),
      sewn: !rv && c === 4,
      flower: rv,
      warm: rv ? 1 : 0
    };
  };

  // Scenery, painted ahead of time (during the chapter plate) when possible.
  Denial.prototype.prepareSteps = function () {
    return [() => {
      this.painted = !!G.art.get(this.revisit ? ART.warm : ART.room);
      if (!this.painted) this.layer = paintRoom(this.state());
      this.motes = new P.Motes(40, { x: 430, y: 230, w: 470, h: 420 }, 9);
    }];
  };

  Denial.prototype.enter = function () {
    G.prepareScene(this);
    this.buildItems();
    G.audio.scene({ room: 1.0, drone: [50, 57, 62], droneLevel: 0.3 });
    G.ui.say(this.revisit ? 'The light has changed.' : ENTER[0], { delay: 0.9 });
    if (!this.revisit) G.ui.hint(G.touch ? 'Tap to walk · tap things to look closer' : 'Click to walk · click things to look closer', 8);
  };

  Denial.prototype.lineFor = function (id) {
    const L = LINES[id];
    if (this.revisit) return L.rv;
    if (L[this.copy] != null) return L[this.copy];
    return this.copy === 0 ? L[0] : L.n;
  };

  Denial.prototype.look = function (id) {
    if (this.copy === 0) this.looked.add(id);
    // their coat, the first time: taken down and looked at, then put back
    if (id === 'hook' && this.copy === 0 && !this.revisit && !this.coatSeen && G.art.get('denial/coat-card.webp')) {
      this.coatSeen = true;
      G.audio.chime(64, 0.07);
      G.ui.keepsake('denial/coat-card.webp', ['Their coat, on its hook.', 'As if they’d only stepped out.']);
      return;
    }
    if (this.revisit && id === 'window') { this.openWindow(); return; }
    const ch = CHANGES[this.copy];
    if (!this.revisit && ch && ch.id === id && this.noticed < this.copy) {
      this.noticed = this.copy;
      G.audio.chime([74, 76, 79][this.copy - 1], 0.18);
      this.marks.push(ch.mark.slice());
      this.markFlash = 1;
      for (const it of this.items) it.glintBoost = 0;
      G.ui.say(ch.lines);
      G.ui.hint(null);
      return;
    }
    G.ui.say(this.lineFor(id));
  };

  Denial.prototype.buildItems = function () {
    this.items = [];
    const st = this.state();
    const look = id => () => this.look(id);
    this.item({ id: 'bed', x: 255, y: 440, w: 350, h: 160, gx: 440, gy: 525, use: look('bed') });
    this.item({ id: 'prints', x: 305, y: 278, w: 150, h: 95, use: look('prints') });
    this.item({ id: 'window', x: 680, y: 210, w: 180, h: 230, use: look('window') });
    this.item({ id: 'chair', x: st.chairX - 70, y: 440, w: 140, h: 172, gy: 520, at: st.chairX + (st.chairFacing > 0 ? -115 : 115), use: look('chair') });
    this.item({ id: 'cups', x: 882, y: 420, w: 64, h: 36, gy: 436, at: 905, use: look('cups') });
    this.item({ id: 'vase', x: 968, y: 360, w: 40, h: 90, gy: 420, at: 960, use: look('vase') });
    this.item({ id: 'hook', x: 1010, y: 280, w: 72, h: st.coat ? 245 : 50, gy: 300, at: 1030, use: look('hook') });
    this.item({ id: 'back', x: DOOR_L.x, y: DOOR_L.y, w: DOOR_L.w, h: DOOR_L.h, gy: 430, at: 180, use: look('back') });
    if (st.sewn) {
      this.seamItem = this.item({
        id: 'seam', x: DOOR_R.x, y: DOOR_R.y, w: DOOR_R.w, h: DOOR_R.h, gy: 400, at: 1160, face: 1, hold: true, big: true,
        tap: () => {
          G.ui.say(['There is no door here.', 'Only a seam.']);
          G.ui.hint('Hold to pull the thread', 6);
        },
        holdTick: (s, dt) => this.pullSeam(dt),
        when: () => !this.ending
      });
    } else {
      this.item({ id: 'door', x: DOOR_R.x, y: DOOR_R.y, w: DOOR_R.w, h: DOOR_R.h, gy: 430, at: 1160, face: 1, reach: false, use: () => this.tryDoor() });
    }
    // after a loop without noticing, the changed thing shimmers a little
    const ch = CHANGES[this.copy];
    if (!this.revisit && ch && this.noticed < this.copy && this.loops >= 1) {
      const it = this.items.find(i => i.id === ch.id);
      if (it) it.glintBoost = this.loops >= 2 ? 1 : 0.7;
    }
  };

  // The first room's door won't open until you've really looked at the room.
  Denial.prototype.tryDoor = function () {
    if (!this.revisit && this.copy === 0 && this.looked.size < LOOK_FIRST) {
      this.nudged++;
      this.pushT = -1.2;
      this.rattle = 1;
      G.audio.thud(0.12);
      G.ui.say(this.nudged === 1 ? 'Not yet.' : ['Not yet.', 'I haven’t really looked.']);
      if (this.nudged >= 2) G.ui.hint(G.touch ? 'Tap a few things in the room first' : 'Look at a few things in the room first', 6);
      return;
    }
    this.startExit();
  };

  // Return: the window can be opened now.
  Denial.prototype.openWindow = function () {
    if (this.windowOpened) { G.ui.say('The window stays open.'); return; }
    this.windowOpened = true;
    G.audio.creak();
    G.ui.say(['I open the window.', 'Air. It smells of rain.']);
    G.audio.scene({ room: 0.7, wind: 0.35, drone: [50, 57, 64], droneLevel: 0.3 });
    G.after(1.4, () => G.audio.bird());
  };

  Denial.prototype.startExit = function () {
    if (this.anim) return;
    this.locked = true;
    this.pending = null;
    this.player.target = null;
    this.anim = { phase: 'open', t: 0 };
    G.audio.creak();
    G.ui.hint(null);
  };

  Denial.prototype.nextCopy = function () {
    const c = this.copy;
    let n = c;
    if (c === 0) n = 1;
    else if (this.noticed >= c) n = Math.min(4, c + 1);
    this.loops = n === c ? this.loops + 1 : 0;
    this.copy = n;
    if (!this.painted) {
      if (this.layer) { this.layer.c.width = 0; this.layer.c.height = 0; }
      this.layer = paintRoom(this.state());
    }
    this.buildItems();
    if (n === 4) G.audio.scene({ room: 0.8, wind: 0.3, drone: [50, 56, 62], droneLevel: 0.3 });
  };

  Denial.prototype.onEnterCopy = function () {
    if (this.copy === 1 && this.loops === 0) {
      G.ui.hint(G.touch ? 'Hold the round button to remember how the room was' : 'Hold R, or the round button, to remember how the room was', 9);
    }
    if (this.loops === 0) G.ui.say(ENTER[this.copy]);
    else if (this.loops === 1) G.ui.say('The same room. Again.');
    else G.ui.say(['Something here is different.', 'Look again.']);
  };

  Denial.prototype.updateAnim = function (dt) {
    const a = this.anim, pl = this.player;
    a.t += dt;
    const next = ph => { a.phase = ph; a.t = 0; };
    const walkOn = () => { pl.walk = 1; pl.phase += dt * 5.5; };
    if (a.phase === 'open') {
      this.rightDoor = M.easeInOut(Math.min(1, a.t / 0.35));
      pl.walk = M.damp(pl.walk, 0, 10, dt);
      if (a.t >= 0.35) next('enter');
    } else if (a.phase === 'enter') {
      const u = Math.min(1, a.t / 0.75);
      pl.y = M.lerp(GROUND, FLOOR + 4, u);
      pl.s = M.lerp(HERO, HERO * 0.76, u);
      pl.alpha = 1 - M.smoothstep(0.5, 1, u);
      pl.dir = 1;
      walkOn();
      if (u >= 1) next('white');
    } else if (a.phase === 'white') {
      this.white = Math.min(1, a.t / 0.4);
      if (a.t >= 0.45) {
        if (this.revisit) { this.anim = { phase: 'done', t: 0 }; G.flow.complete(0); return; }
        this.nextCopy();
        this.rightDoor = 0;
        this.leftDoor = 1;
        pl.x = 145;
        pl.y = FLOOR + 4;
        pl.s = HERO * 0.76;
        pl.alpha = 0;
        next('reveal');
      }
    } else if (a.phase === 'reveal') {
      this.white = 1 - Math.min(1, a.t / 0.45);
      if (a.t >= 0.45) next('step');
    } else if (a.phase === 'step') {
      const u = Math.min(1, a.t / 0.7);
      pl.x = M.lerp(145, 205, u);
      pl.y = M.lerp(FLOOR + 4, GROUND, u);
      pl.s = M.lerp(HERO * 0.76, HERO, u);
      pl.alpha = M.smoothstep(0, 0.35, u);
      pl.dir = 1;
      walkOn();
      if (u >= 1) next('close');
    } else if (a.phase === 'close') {
      this.leftDoor = 1 - M.easeInOut(Math.min(1, a.t / 0.4));
      pl.walk = M.damp(pl.walk, 0, 10, dt);
      if (a.t >= 0.4) {
        this.anim = null;
        this.locked = false;
        this.leftDoor = 0;
        pl.target = null;
        this.onEnterCopy();
      }
    }
  };

  Denial.prototype.pullSeam = function (dt) {
    const N = 9;
    this.pull = Math.min(1, this.pull + dt / 3.2);
    const pop = Math.floor(this.pull * N + 0.001);
    while (this.popped < pop) {
      const i = this.popped++;
      const y = DOOR_R.y + 30 + i * ((DOOR_R.h - 60) / (N - 1));
      G.audio.stitch();
      for (let k = 0; k < 4; k++) {
        this.bits.push({ x: DOOR_R.x + DOOR_R.w / 2, y, vx: -40 - Math.random() * 120, vy: -60 - Math.random() * 80, life: 1.4, r: Math.random() * TAU });
      }
      if (i === 3) G.ui.say('It comes loose, stitch by stitch.');
    }
    if (this.pull >= 1) {
      this.startEnding();
      return true;
    }
    return false;
  };

  Denial.prototype.startEnding = function () {
    this.ending = { t: 0 };
    this.locked = true;
    G.ui.hint(null);
    G.audio.scene({ room: 0.3, wind: 1, drone: [50, 56, 61], droneLevel: 0.26 });
    G.audio.gust = 1;
    G.audio.tear(0.5);
    G.ui.say('The wind comes in.');
    for (let i = 0; i < 7; i++) {
      this.ribbons.push({ x: DOOR_R.x + 70, y: DOOR_R.y + 60 + i * 42, vx: -(300 + Math.random() * 160), seed: Math.random() * 10, delay: i * 0.14, trail: [], w: 14 + Math.random() * 10 });
    }
  };

  Denial.prototype.update = function (dt) {
    const pl = this.player;
    if (this.anim) {
      this.t += dt;
      if (this.anim.phase !== 'done') this.updateAnim(dt);
    } else {
      this.sideUpdate(dt);
      // walking into the far door with the keys also opens it
      const st = this.state();
      if (!this.locked && !st.sewn && G.input.axis() > 0 && pl.x >= this.maxX - 2) {
        this.pushT += dt;
        if (this.pushT > 0.35) this.tryDoor();
      } else if (this.pushT > 0) this.pushT = 0;
      else this.pushT = Math.min(0, this.pushT + dt);
    }
    if (this.markFlash) this.markFlash = Math.max(0, this.markFlash - dt * 0.6);
    if (this.rattle) this.rattle = Math.max(0, this.rattle - dt * 2.5);
    if (this.windowOpened) this.windowOpen = Math.min(1, this.windowOpen + dt / 1.8);
    // hold to remember the room as it was (from the second copy on)
    const canRemember = !this.revisit && this.copy >= 1 && !this.anim && !this.ending;
    if (canRemember && !G.ui.action) G.ui.action = { label: 'Remember', key: 'remember', keyName: 'R', owner: this };
    else if (!canRemember && G.ui.action && G.ui.action.owner === this) G.ui.action = null;
    const held = !!(G.ui.action && G.ui.action.owner === this && G.ui.action.held);
    if (held && this.remember < 0.05) G.audio.chime(62, 0.05);
    this.remember = M.damp(this.remember, held ? 1 : 0, held ? 4 : 6, dt);
    for (const b of this.bits) {
      b.life -= dt;
      b.vy += 260 * dt;
      b.vx += (this.ending ? -300 : 0) * dt;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.r += dt * 6;
    }
    this.bits = this.bits.filter(b => b.life > 0);
    if (this.ending) {
      const e = this.ending;
      e.t += dt;
      G.audio.gust = M.clamp(1 - (e.t - 1.2) * 0.5, 0.4, 1);
      this.cam.shake = e.t < 1.6 ? 3 * (1 - e.t / 1.6) : 0;
      for (const r of this.ribbons) {
        if (e.t < r.delay) continue;
        r.x += r.vx * dt;
        r.y += Math.sin(e.t * 2.4 + r.seed) * 60 * dt;
        r.trail.unshift([r.x, r.y + Math.sin(e.t * 7 + r.seed) * 16]);
        if (r.trail.length > 24) r.trail.pop();
        // the tail flutters more than the head
        for (let i = 1; i < r.trail.length; i++) r.trail[i][1] += Math.sin(e.t * 11 + i * 0.7 + r.seed) * 0.9;
      }
      if (e.t > 2.6 && !e.done) {
        e.done = true;
        G.flow.complete(0);
      }
    }
  };

  // The painted room as it stands now: the solid room, the cloth version fading in copy by
  // copy, then the things that change.
  Denial.prototype.drawRoom = function (x, st) {
    if (!this.painted) { x.drawImage(this.layer.c, 0, 0, G.W, G.H); return; }
    const A = G.art.get;
    if (this.revisit) {
      x.drawImage(A(ART.warm), 0, 0, G.W, G.H);
      const w = M.easeInOut(this.windowOpen);
      if (w > 0 && A(ART.open)) { x.globalAlpha = w; x.drawImage(A(ART.open), 0, 0, G.W, G.H); x.globalAlpha = 1; }
      return;
    }
    x.drawImage(A(ART.room), 0, 0, G.W, G.H);
    if (st.g > 0 && A(ART.gauze)) { x.globalAlpha = st.g; x.drawImage(A(ART.gauze), 0, 0, G.W, G.H); x.globalAlpha = 1; }
    this.drawPatches(x, st, 1);
    if (st.cups >= 2) this.drawSteam(x, 1);
  };
  // A thread of steam from the second cup, the one still warm (after Tove Jansson: a little
  // domestic warmth inside an uneasy room). It goes when the cup goes.
  Denial.prototype.drawSteam = function (x, alpha) {
    const t = this.t, cx = 929, cy = 429;
    x.save();
    x.lineCap = 'round';
    for (let k = 0; k < 3; k++) {
      const ph = (t * 0.28 + k / 3) % 1;
      const a = Math.sin(ph * Math.PI) * 0.34 * alpha;
      x.strokeStyle = 'rgba(244,242,236,' + a.toFixed(3) + ')';
      x.lineWidth = 2.6 - ph * 1.2;
      x.beginPath();
      for (let i = 0; i <= 10; i++) {
        const u = i / 10, y = cy - 3 - ph * 22 - u * 30;
        const xx = cx + (k - 1) * 3 + Math.sin(u * 4.5 + t * 1.4 + k * 2.1) * (2 + u * 6);
        if (i) x.lineTo(xx, y); else x.moveTo(xx, y);
      }
      x.stroke();
    }
    x.restore();
  };
  Denial.prototype.drawPatches = function (x, st, alpha) {
    x.save();
    x.globalAlpha *= alpha;
    for (const key of ['cupB', 'coat']) {
      if ((key === 'cupB' && st.cups < 2) || (key === 'coat' && !st.coat)) continue;
      const im = G.art.get('denial/' + key + '.webp'), r = PATCH[key];
      if (im) x.drawImage(im, r[0], r[1], r[2], r[3]);
    }
    x.restore();
  };
  Denial.prototype.roomImage = function () {
    return this.painted ? G.art.get(this.revisit ? ART.warm : ART.room) : null;
  };

  // Holding Remember: the first room, as it was, laid over this one like an old photograph.
  Denial.prototype.drawRemembered = function (x) {
    const a = this.remember;
    if (a < 0.01) return;
    const first = { cups: 2, coat: true, g: 0 };
    x.save();
    x.globalAlpha = a * 0.82;
    if (this.painted) {
      x.drawImage(G.art.get(ART.room), 0, 0, G.W, G.H);
      this.drawPatches(x, first, 1);
      this.drawSteam(x, 1);
    } else x.drawImage(this.layer.c, 0, 0, G.W, G.H);
    P.chair(x, 640, 612, { s: 165, facing: 1, throwColor: C.ochre });
    x.globalAlpha = a;
    x.globalCompositeOperation = 'soft-light';
    x.fillStyle = 'rgba(214,170,110,0.55)';
    x.fillRect(0, 0, G.W, G.H);
    x.globalCompositeOperation = 'source-over';
    // a pale, uneven edge, like a photograph handled often
    const g = x.createRadialGradient(G.W / 2, G.H / 2, G.H * 0.45, G.W / 2, G.H / 2, G.W * 0.62);
    g.addColorStop(0, 'rgba(240,232,214,0)');
    g.addColorStop(1, 'rgba(240,232,214,0.35)');
    x.fillStyle = g;
    x.fillRect(0, 0, G.W, G.H);
    x.restore();
    x.save();
    x.globalAlpha = a * 0.85;
    G.text.label(x, 'As it was', G.W / 2, 104, { size: 13, align: 'center', color: C.bone });
    x.restore();
  };

  // Things in the doorways: a smaller copy of this room, or the grove behind the seam.
  Denial.prototype.drawBeyond = function (x, d, st) {
    const im = this.roomImage();
    if (im) {
      // the next copy of the room waits behind every door
      x.save();
      x.beginPath();
      x.rect(d.x, d.y, d.w, d.h);
      x.clip();
      x.fillStyle = '#2b2622';
      x.fillRect(d.x, d.y, d.w, d.h);
      const k = 0.34, w = G.W * k, h = G.H * k;
      x.drawImage(im, d.x + d.w / 2 - w / 2, d.y + d.h - h * 0.93, w, h);
      x.fillStyle = 'rgba(30,26,22,0.3)';
      x.fillRect(d.x, d.y, d.w, d.h);
      x.restore();
      return;
    }
    x.save();
    x.beginPath();
    x.rect(d.x, d.y, d.w, d.h);
    x.clip();
    x.fillStyle = '#c9cbca';
    x.fillRect(d.x, d.y, d.w, d.h);
    ghostRoom(x, d.x + d.w / 2, d.y + d.h * 0.52, 0.2, 0.9, st);
    x.fillStyle = 'rgba(40,36,32,0.25)';
    x.fillRect(d.x, d.y, d.w, d.h);
    x.restore();
  };

  Denial.prototype.drawSeam = function (x, st) {
    const d = DOOR_R, t = this.t;
    const part = this.ending ? M.easeOut(Math.min(1, this.ending.t / 1.2)) : 0;
    x.save();
    x.beginPath();
    x.rect(d.x, d.y, d.w, d.h);
    x.clip();
    // the grove waiting behind the cloth: the next chapter's painting, if it has arrived
    const grove = G.art.get('anger/far.webp');
    if (grove) {
      const sh = 1000, sw = sh * d.w / d.h;
      x.drawImage(grove, 1210, 40, sw, sh, d.x, d.y, d.w, d.h);
      x.fillStyle = 'rgba(40,36,32,0.18)';
      x.fillRect(d.x, d.y, d.w, d.h);
    } else {
      x.fillStyle = '#6f6a62';
      x.fillRect(d.x, d.y, d.w, d.h);
      x.fillStyle = '#d9d6cf';
      x.fillRect(d.x + 40, d.y, 40, d.h);
      x.fillStyle = '#1b1a18';
      for (const [tx, tw] of [[d.x + 8, 22], [d.x + 60, 16], [d.x + 104, 26]]) x.fillRect(tx, d.y, tw, d.h);
    }
    x.strokeStyle = P.fabric(x, 'oxblood', 0.1) || C.oxblood;
    x.lineWidth = 7;
    x.beginPath();
    x.moveTo(d.x, d.y + 120 + Math.sin(t * 2) * 8);
    x.quadraticCurveTo(d.x + 70, d.y + 90, d.x + d.w, d.y + 150 + Math.sin(t * 2.4) * 10);
    x.stroke();
    // two halves of gauze, parting at the end
    const half = d.w / 2;
    const wind = this.ending ? 1.2 : 0.12;
    for (const side of [-1, 1]) {
      const px = side < 0 ? d.x - part * half * 0.9 : d.x + half + part * half * 0.9;
      P.gauze(x, px, d.y, half, d.h + 6, { t: t + (side > 0 ? 2 : 0), alpha: 0.62 - part * 0.3, seed: side > 0 ? 7 : 3, wind: wind * (side < 0 ? 1 : 0.6), seams: false });
    }
    x.restore();
    // the red thread down the middle
    if (!this.ending) {
      const N = 9;
      x.save();
      x.lineCap = 'round';
      const cx = d.x + d.w / 2;
      for (let i = this.popped; i < N; i++) {
        const y = d.y + 30 + i * ((d.h - 60) / (N - 1));
        // a stitch of thick thread: its shadow on the cloth, the thread, a glint along it, the two holes
        x.strokeStyle = 'rgba(38,14,10,0.45)';
        x.lineWidth = 3.4;
        x.beginPath();
        x.moveTo(cx - 8, y - 5.5);
        x.lineTo(cx + 10, y + 8.5);
        x.stroke();
        x.strokeStyle = C.oxbloodLight;
        x.lineWidth = 2.8;
        x.beginPath();
        x.moveTo(cx - 9, y - 7);
        x.quadraticCurveTo(cx, y - 1.5, cx + 9, y + 7);
        x.stroke();
        x.strokeStyle = 'rgba(236,160,130,0.55)';
        x.lineWidth = 0.9;
        x.beginPath();
        x.moveTo(cx - 7, y - 6.4);
        x.quadraticCurveTo(cx, y - 2.4, cx + 6, y + 4);
        x.stroke();
        x.fillStyle = 'rgba(30,22,18,0.6)';
        x.beginPath();
        x.arc(cx - 10, y - 8, 1.3, 0, TAU);
        x.moveTo(cx + 11.3, y + 8);
        x.arc(cx + 10, y + 8, 1.3, 0, TAU);
        x.fill();
      }
      x.strokeStyle = C.oxbloodLight;
      x.lineWidth = 2.6;
      x.strokeStyle = 'rgba(177,67,47,0.6)';
      x.lineWidth = 1.2;
      x.beginPath();
      x.moveTo(cx, d.y + 20);
      x.lineTo(cx, d.y + d.h - 10);
      x.stroke();
      if (this.popped > 0) {
        // the loose end hanging from the last pulled stitch
        const y = d.y + 30 + (this.popped - 1) * ((d.h - 60) / (N - 1));
        x.beginPath();
        x.moveTo(cx, y);
        x.quadraticCurveTo(cx - 20, y + 20 + Math.sin(t * 3) * 4, cx - 12 + Math.sin(t * 2) * 6, y + 46);
        x.stroke();
      }
      x.restore();
    }
  };

  Denial.prototype.draw = function (x) {
    const st = this.state(), t = this.t, pl = this.player;
    x.save();
    this.cam.apply(x);
    this.drawRoom(x, st);

    // what's beyond the two doors, then the leaves (painted doors only need drawing while they move)
    const im = this.roomImage();
    if (im) {
      const leaf = (d, open, hingeLeft) => {
        if (open < 0.005) return;
        this.drawBeyond(x, d, st);
        paintedLeaf(x, im, d, open, hingeLeft);
        if (!this.revisit && st.g > 0) paintedLeaf(x, G.art.get(ART.gauze), d, open, hingeLeft, st.g);
      };
      leaf(DOOR_L, this.leftDoor, true);
      if (st.sewn) this.drawSeam(x, st);
      else leaf(DOOR_R, Math.max(this.rightDoor, (this.rattle || 0) * 0.04 * Math.abs(Math.sin(this.t * 40))), false);
    } else {
      this.drawBeyond(x, DOOR_L, st);
      doorLeaf(x, DOOR_L, this.leftDoor, true);
      if (st.sewn) this.drawSeam(x, st);
      else {
        this.drawBeyond(x, DOOR_R, st);
        doorLeaf(x, DOOR_R, Math.max(this.rightDoor, (this.rattle || 0) * 0.04 * Math.abs(Math.sin(this.t * 40))), false);
      }
    }

    // marks left by each noticing: a few red cross-stitches
    for (let i = 0; i < this.marks.length; i++) {
      const m = this.marks[i];
      const fresh = i === this.marks.length - 1 ? (this.markFlash || 0) : 0;
      if (fresh > 0) P.glow(x, m[0], m[1], 40, C.warm, fresh * 0.35);
      x.save();
      x.strokeStyle = C.oxbloodLight;
      x.lineWidth = 2;
      x.lineCap = 'round';
      x.beginPath();
      for (let k = 0; k < 3; k++) {
        const mx = m[0] - 12 + k * 12, my = m[1];
        x.moveTo(mx - 4, my - 4); x.lineTo(mx + 4, my + 4);
        x.moveTo(mx + 4, my - 4); x.lineTo(mx - 4, my + 4);
      }
      x.stroke();
      x.restore();
    }

    // window light and dust
    x.save();
    x.globalCompositeOperation = 'lighter';
    const breathe = (0.85 + 0.15 * Math.sin(t * 0.4)) * (this.painted ? 0.4 : 1);
    const lg = x.createLinearGradient(760, 220, 560, 700);
    lg.addColorStop(0, M.rgba(st.warm ? '#ffe7c4' : '#dfe6ee', 0.13 * breathe));
    lg.addColorStop(1, M.rgba(st.warm ? '#ffe7c4' : '#dfe6ee', 0.03));
    x.fillStyle = lg;
    x.beginPath();
    x.moveTo(684, 214);
    x.lineTo(856, 214);
    x.lineTo(760, 704);
    x.lineTo(430, 704);
    x.closePath();
    x.fill();
    x.restore();
    this.motes.draw(x, t, 0.45);

    // cloth hanging from the ceiling
    const panels = PANELS[this.revisit ? 0 : this.copy];
    const wind = this.ending ? M.clamp(this.ending.t * 1.5, 0, 1.4) : (st.sewn ? 0.1 : 0);
    panels.forEach((p, i) => P.gauze(x, p[0], p[1], p[2], p[3], { t: t + i, alpha: p[4], seed: i + 1, wind, midSeam: i % 2 === 0 }));

    P.chair(x, st.chairX, 612, { s: 165, facing: st.chairFacing, throwColor: C.ochre });
    this.drawRemembered(x);

    this.drawPlayer(x, { alpha: pl.alpha, s: pl.s });

    // thread bits
    x.save();
    x.strokeStyle = C.oxbloodLight;
    x.lineWidth = 1.6;
    for (const b of this.bits) {
      x.globalAlpha = Math.min(1, b.life);
      x.beginPath();
      x.moveTo(b.x - Math.cos(b.r) * 5, b.y - Math.sin(b.r) * 5);
      x.lineTo(b.x + Math.cos(b.r) * 5, b.y + Math.sin(b.r) * 5);
      x.stroke();
    }
    x.restore();

    // red cloth blowing in
    for (const r of this.ribbons) if (r.trail.length > 2) P.ribbon(x, r.trail, { width: r.w, seed: r.seed, fabric: 'oxblood' });

    if (!this.locked) this.drawGlints(x);
    x.restore();

    if (this.white > 0) {
      x.fillStyle = M.rgba('#f1efe9', this.white);
      x.fillRect(0, 0, G.W, G.H);
    }
  };
})();
