/* Chapter 03 / Bargaining: "Every doorway offers another version."
 * Fold-out architecture, translucent walls, repeated doors and contradictory rooms.
 * Play: rearrange passages and find the path that extends beyond the loop.
 */
(function () {
  'use strict';
  const G = window.G, M = G.M, C = G.C, P = G.paint;
  const TAU = M.TAU;
  const COLS = 5, ROWS = 3, TS = 150;
  const GX = (G.W - COLS * TS) / 2, GY = 150;
  const N = 1, E = 2, S = 4, Wd = 8;
  const DIRS = [[N, 0, -1, S], [E, 1, 0, Wd], [S, 0, 1, N], [Wd, -1, 0, E]];
  const ENTRY = { c: 0, r: 1 }, EXIT = { c: 4, r: 0 };
  const FABRICS = ['#b7a4c8', '#d4a6a0', '#a8bba0', '#a6c4bc', '#c9b98f', '#9fb0c9'];
  const VERSIONS = ['table', 'bed', 'chair', 'stairs', 'plant', 'empty'];
  // "If only", matched to the version of the room that has just turned into view.
  const IFS = {
    table: ['If we had stayed for another cup.', 'If I had called that morning.'],
    bed: ['If I had sat up with them that night.', 'If I had checked on them once more.'],
    chair: ['If I had stayed a little longer.', 'If I promise to keep their place.'],
    stairs: ['If I had gone down to see.', 'If we had left an hour earlier.'],
    plant: ['If I had noticed sooner.', 'If I give something up in return.'],
    empty: ['If this is the room where it didn’t happen.', 'If I try just one more door.']
  };
  // Their letter, on the landing where you arrive.
  const LETTER = { x: GX - 62, y: GY + TS * 1.5 + 38, r: 34 };
  const ART = ['bargaining/backdrop.webp', 'bargaining/rooms.webp', 'bargaining/letter.webp'];
  // Initial openings: the entrance feeds a closed loop through lamp-lit rooms.
  const START = [
    [S, E | S, Wd | S, Wd | N, N | S],
    [Wd | E, Wd | N | E, N | Wd, Wd | E, N | S | Wd],
    [N | E, Wd | S, N | S, E | S, Wd | N]
  ];
  const SOLVED = [
    [S, E | S, Wd | S, S | E, Wd | E],
    [Wd | E, Wd | S | E, N | Wd, N | S, N | S | Wd],
    [N | E, N | E, Wd | E, Wd | N, Wd | N]
  ];

  const rotCW = m => ((m << 1) | (m >> 3)) & 15;
  const has = (m, d) => (m & d) !== 0;

  function Bargaining(o) {
    o = o || {};
    this.revisit = !!o.revisit;
    this.t = 0;
    this.finish = { vignette: 1, grain: 0.6 };
    const r = M.rng(303);
    this.tiles = [];
    for (let row = 0; row < ROWS; row++) {
      for (let c = 0; c < COLS; c++) {
        const m = (this.revisit ? SOLVED : START)[row][c];
        this.tiles.push({
          c, r: row, mask: m, ang: 0, turning: 0, queue: 0,
          v: r.int(0, 5), seed: r() * 100,
          floor: r.pick(['stone', 'stone', 'wood', 'tile']),
          fabric: [0, 1, 2, 3].map(() => (r() < 0.45 ? r.pick(FABRICS) : null)),
          doors: [0, 0, 0, 0]
        });
      }
    }
    // more of the walls in the study's pale dyed cloth (a separate sequence, so the rooms stay as they were)
    const rf = M.rng(911);
    for (const t of this.tiles) t.fabric = t.fabric.map(f => f || (rf() < 0.45 ? rf.pick(FABRICS) : null));
    // the lamp-lit rooms sit on the loop; turning one away puts its lamp out
    for (const t of this.tiles) { t.lamp = 0; t.lampTo = 0; }
    for (const [c, row] of [[1, 0], [2, 0], [2, 1], [1, 1]]) {
      const t = this.tile(c, row);
      t.v = [0, 1, 0, 1][(c + row) % 4];
      if (!this.revisit) { t.lamp = 1; t.lampTo = 1; }
    }
    this.said = {};
    this.lampsOut = 0;
    this.letterRead = false;
    this.turns = 0;
    this.sel = { c: 2, r: 1 };
    this.keySel = false;
    this.solved = false;
    this.walk = null;
    this.hero = { x: GX - 58, y: GY + TS * 1.5, ang: 0, phase: 0, walk: 0 };
    this.connect();
    // Return: someone has lit the lamps along the way through
    if (this.revisit) for (const t of this.reached.keys()) { t.lamp = 1; t.lampTo = 1; }
  }
  G.chapters.Bargaining = Bargaining;
  Bargaining.art = () => ART;

  Bargaining.prototype.tile = function (c, r) {
    if (c < 0 || r < 0 || c >= COLS || r >= ROWS) return null;
    return this.tiles[r * COLS + c];
  };

  // Which rooms the red thread reaches from the entrance, and whether it gets out.
  Bargaining.prototype.connect = function () {
    const seen = new Map();
    const edges = [];
    const start = this.tile(ENTRY.c, ENTRY.r);
    this.reachExit = false;
    if (has(start.mask, Wd)) {
      const q = [start];
      seen.set(start, null);
      while (q.length) {
        const a = q.shift();
        for (const [d, dc, dr, back] of DIRS) {
          if (!has(a.mask, d)) continue;
          if (a.c === EXIT.c && a.r === EXIT.r && d === E) { this.reachExit = true; if (!this.exitParent) this.exitParent = a; continue; }
          const b = this.tile(a.c + dc, a.r + dr);
          if (!b || !has(b.mask, back)) continue;
          if (!edges.some(e => (e[0] === a && e[1] === b) || (e[0] === b && e[1] === a))) edges.push([a, b, d]);
          if (!seen.has(b)) { seen.set(b, a); q.push(b); }
        }
      }
    }
    this.reached = seen;
    this.edges = edges;
    if (!this.reachExit) this.exitParent = null;
    // door state for drawing: open wide when the neighbour answers
    for (const t of this.tiles) {
      DIRS.forEach(([d, dc, dr, back], i) => {
        let open = 0;
        if (has(t.mask, d)) {
          const b = this.tile(t.c + dc, t.r + dr);
          const isEntry = t.c === ENTRY.c && t.r === ENTRY.r && d === Wd;
          const isExit = t.c === EXIT.c && t.r === EXIT.r && d === E;
          open = isEntry || isExit || (b && has(b.mask, back)) ? 1 : 0;
        }
        t.doorsTarget = t.doorsTarget || [0, 0, 0, 0];
        t.doorsTarget[i] = open;
      });
    }
  };

  // Scenery, painted ahead of time (during the chapter plate) when possible.
  Bargaining.prototype.prepareSteps = function () {
    this.painted = !!G.art.get('bargaining/backdrop.webp');
    return [() => { if (!this.painted) this.backdrop = this.paintBackdrop(); }];
  };

  Bargaining.prototype.enter = function () {
    G.prepareScene(this);
    G.audio.scene({ room: 0.7, drone: [49, 56, 61], droneLevel: 0.3 });
    if (this.revisit) {
      G.ui.say(['The rooms are still here.', 'Someone has lit the lamps along the way through.'], { delay: 0.8 });
      this.solveAt = 2.5;
    } else {
      G.ui.say('The rooms fold into one another.', { delay: 0.8 });
      G.ui.hint((G.touch ? 'Tap' : 'Click') + ' a room to turn it · lead the red thread out to the right', 10);
    }
  };

  Bargaining.prototype.paintBackdrop = function () {
    const L = G.layer(G.W, G.H);
    const x = L.x;
    const r = M.rng(33);
    x.fillStyle = '#161418';
    x.fillRect(0, 0, G.W, G.H);
    // dusk over the rooftops
    const sky = x.createLinearGradient(0, 0, 0, 190);
    sky.addColorStop(0, '#26243a');
    sky.addColorStop(0.55, '#5f5173');
    sky.addColorStop(1, '#b98f82');
    x.fillStyle = sky;
    x.fillRect(0, 0, G.W, 190);
    x.fillStyle = '#1c1a22';
    let rx = -20;
    while (rx < G.W + 40) {
      const w = r.range(50, 130), h = r.range(40, 110);
      const base = 190;
      x.beginPath();
      x.moveTo(rx, base);
      x.lineTo(rx, base - h);
      if (r() < 0.5) { x.lineTo(rx + w / 2, base - h - r.range(15, 35)); }
      x.lineTo(rx + w, base - h);
      x.lineTo(rx + w, base);
      x.fill();
      if (r() < 0.6) x.fillRect(rx + r.range(8, w - 20), base - h - r.range(18, 34), r.range(8, 14), 30);
      for (let i = 0; i < 3; i++) {
        if (r() < 0.35) {
          x.fillStyle = '#e8c291';
          x.fillRect(rx + r.range(6, w - 14), base - h + r.range(10, h - 20), 6, 9);
          x.fillStyle = '#1c1a22';
        }
      }
      rx += w + r.range(-10, 12);
    }
    // arches and a stair going down into the loop below
    x.strokeStyle = 'rgba(120,110,120,0.25)';
    x.lineWidth = 2;
    for (let i = 0; i < 7; i++) {
      const ax = GX - 40 + i * 130;
      x.beginPath();
      x.arc(ax, 700, 46, Math.PI, 0);
      x.stroke();
    }
    x.fillStyle = 'rgba(90,82,86,0.35)';
    for (let i = 0; i < 9; i++) x.fillRect(GX - 150 + i * 14, 640 + i * 9, 60, 5);
    // grey daylight beyond the loop, to the right
    const day = x.createRadialGradient(G.W + 40, GY + TS * 0.5, 20, G.W + 40, GY + TS * 0.5, 330);
    day.addColorStop(0, 'rgba(206,205,200,0.9)');
    day.addColorStop(0.6, 'rgba(185,184,179,0.35)');
    day.addColorStop(1, 'rgba(185,184,179,0)');
    x.fillStyle = day;
    x.fillRect(900, 0, G.W - 900, 560);
    // the boardwalk out
    const by = GY + TS * 0.5;
    x.fillStyle = '#5a4b3f';
    x.fillRect(GX + COLS * TS, by - 24, G.W - GX - COLS * TS + 10, 48);
    x.strokeStyle = 'rgba(0,0,0,0.35)';
    x.lineWidth = 1.5;
    for (let px = GX + COLS * TS; px < G.W; px += 16) {
      x.beginPath();
      x.moveTo(px, by - 24);
      x.lineTo(px, by + 24);
      x.stroke();
    }
    x.fillStyle = 'rgba(0,0,0,0.3)';
    x.fillRect(GX + COLS * TS, by + 24, G.W, 8);
    // the landing where we arrive
    x.fillStyle = '#6d6259';
    x.beginPath();
    P.roughRectPath(x, GX - 110, GY + TS + 20, 110, TS - 40, 2, r, 10);
    x.fill();
    x.fillStyle = 'rgba(255,240,220,0.08)';
    x.fillRect(GX - 108, GY + TS + 22, 106, 4);
    P.texturize(L, 0.35);
    return L;
  };

  Bargaining.prototype.tileAt = function (px, py) {
    const c = Math.floor((px - GX) / TS), r = Math.floor((py - GY) / TS);
    return this.tile(c, r);
  };

  Bargaining.prototype.turn = function (t) {
    if (this.solved) return;
    t.queue++;
  };

  Bargaining.prototype.update = function (dt) {
    this.t += dt;
    const inp = G.input;
    if (!this.solved && !this.walk) {
      const hover = inp.lastDevice === 'pointer' ? this.tileAt(inp.x, inp.y) : null;
      const onLetter = !this.revisit && M.dist(inp.x, inp.y, LETTER.x, LETTER.y) < LETTER.r + 8;
      this.hover = hover;
      this.hoverLetter = inp.lastDevice === 'pointer' && onLetter;
      G.setCursor(hover || this.hoverLetter ? 'pointer' : 'default');
      if (inp.pressed && !inp.consumed && onLetter) { this.keySel = false; this.readLetter(); }
      else if (inp.pressed && !inp.consumed && hover) { this.keySel = false; this.turn(hover); }
      if (inp.hit.left || inp.hit.right || inp.hit.up || inp.hit.down) {
        if (this.keySel) {
          // one step left of the first column is the landing, with the letter
          const minC = this.revisit ? 0 : -1;
          this.sel.c = M.clamp(this.sel.c + (inp.hit.right ? 1 : 0) - (inp.hit.left ? 1 : 0), minC, COLS - 1);
          if (this.sel.c < 0) this.sel.r = ENTRY.r;
          else this.sel.r = M.clamp(this.sel.r + (inp.hit.down ? 1 : 0) - (inp.hit.up ? 1 : 0), 0, ROWS - 1);
        }
        this.keySel = true;
      }
      if (inp.hit.act) {
        this.keySel = true;
        if (this.sel.c < 0) this.readLetter();
        else this.turn(this.tile(this.sel.c, this.sel.r));
      }
    } else {
      this.hover = null;
      G.setCursor('default');
    }

    // rotations: each turn is a quarter fold, one at a time per room
    for (const t of this.tiles) {
      if (t.turning > 0) {
        t.turning = Math.min(1, t.turning + dt / 0.3);
        t.ang = M.easeInOut(t.turning) * Math.PI / 2;
        if (t.turning >= 1) {
          t.turning = 0;
          t.ang = 0;
          t.mask = rotCW(t.mask);
          t.v = (t.v + 1) % VERSIONS.length;
          this.turns++;
          this.connect();
          this.afterTurn(t);
        }
      } else if (t.queue > 0 && !this.solved) {
        t.queue--;
        t.turning = 0.0001;
        G.audio.chime([61, 63, 66, 68, 70, 73][(t.c + t.r * 2 + this.turns) % 6], 0.06);
      }
      for (let i = 0; i < 4; i++) t.doors[i] = M.damp(t.doors[i], t.turning > 0 ? 0 : (t.doorsTarget ? t.doorsTarget[i] : 0), 7, dt);
      // a lamp going out gutters first
      if (t.lamp > t.lampTo) t.lamp = Math.max(t.lampTo, t.lamp - dt * (0.5 + 0.8 * Math.random()));
    }

    if (this.solveAt != null && this.t >= this.solveAt && !this.walk) this.startWalk();
    if (this.walk) this.updateWalk(dt);
  };

  Bargaining.prototype.readLetter = function () {
    G.audio.chime(66, 0.08);
    if (!this.letterRead) {
      this.letterRead = true;
      G.ui.keepsake('bargaining/letter.webp', ['A letter, in their handwriting.', 'I know what it says.']);
    } else G.ui.keepsake('bargaining/letter.webp', 'I don’t need to open it again.');
  };

  Bargaining.prototype.afterTurn = function (t) {
    // turning a lit room away puts its lamp out, for good
    if (t.lampTo > 0) {
      t.lampTo = 0;
      this.lampsOut++;
      G.audio.chime(49, 0.05);
      if (this.lampsOut === 1 && !this.solved && !this.reachExit) { G.ui.say('The lamp goes out.'); return; }
    }
    if (this.reachExit && !this.solved) {
      this.solved = true;
      G.ui.hint(null);
      G.audio.arp([61, 65, 68, 73], 0.22, 0.12);
      G.ui.say(['None of these rooms go back.', 'One of them goes on.']);
      this.solveAt = this.t + 1.6;
      for (const q of this.tiles) q.queue = 0;
      return;
    }
    if (!G.ui.busy()) {
      const kind = VERSIONS[t.v], n = this.said[kind] || 0;
      G.ui.say(IFS[kind][n % IFS[kind].length]);
      this.said[kind] = n + 1;
    }
    if (this.turns === 16) G.ui.hint('The thread starts at the left. Turn rooms until it reaches the open door on the right', 8);
  };

  // Walk the thread from the landing, room by room, out onto the boardwalk.
  Bargaining.prototype.startWalk = function () {
    this.solved = true;
    this.connect();
    const path = [];
    let cur = this.exitParent;
    while (cur) { path.unshift(cur); cur = this.reached.get(cur); }
    const pts = [[GX - 58, GY + TS * 1.5], [GX, GY + TS * 1.5]];
    for (let i = 0; i < path.length; i++) {
      const t = path[i];
      const cx = GX + t.c * TS + TS / 2, cy = GY + t.r * TS + TS / 2;
      pts.push([cx, cy]);
      const nxt = path[i + 1];
      if (nxt) pts.push([(cx + GX + nxt.c * TS + TS / 2) / 2, (cy + GY + nxt.r * TS + TS / 2) / 2]);
    }
    const last = path[path.length - 1];
    pts.push([GX + COLS * TS, GY + last.r * TS + TS / 2]);
    pts.push([G.W + 40, GY + last.r * TS + TS / 2]);
    this.walk = { pts, i: 0, done: false };
  };

  Bargaining.prototype.updateWalk = function (dt) {
    const w = this.walk, h = this.hero;
    let step = 125 * dt;
    while (step > 0 && w.i < w.pts.length - 1) {
      const [tx, ty] = w.pts[w.i + 1];
      const dx = tx - h.x, dy = ty - h.y;
      const d = Math.hypot(dx, dy);
      if (d <= step) { h.x = tx; h.y = ty; w.i++; step -= d; }
      else {
        h.x += dx / d * step;
        h.y += dy / d * step;
        h.ang = Math.atan2(dy, dx);
        step = 0;
      }
    }
    h.walk = 1;
    h.phase += dt * 9;
    if (h.x > G.W - 90 && !w.done) {
      w.done = true;
      G.flow.complete(2);
    }
  };

  // ------------------------------------------------------------ drawing
  function drawFloor(x, t, r) {
    const cols = { stone: ['#b8987b', '#a88a70', '#c4a687'], wood: ['#8e7463', '#7d6555', '#9a7f6c'], tile: ['#c9b9a0', '#b3a58e', '#d6c7ae'] }[t.floor];
    x.fillStyle = cols[0];
    x.fillRect(-TS / 2, -TS / 2, TS, TS);
    x.strokeStyle = 'rgba(40,30,24,0.25)';
    x.lineWidth = 1;
    if (t.floor === 'wood') {
      for (let i = -TS / 2; i < TS / 2; i += 14) { x.beginPath(); x.moveTo(-TS / 2, i); x.lineTo(TS / 2, i); x.stroke(); }
    } else {
      const g = t.floor === 'tile' ? 25 : 37;
      for (let i = -TS / 2; i <= TS / 2; i += g) {
        x.beginPath(); x.moveTo(i, -TS / 2); x.lineTo(i, TS / 2); x.stroke();
        x.beginPath(); x.moveTo(-TS / 2, i); x.lineTo(TS / 2, i); x.stroke();
      }
      for (let i = 0; i < 5; i++) {
        x.fillStyle = M.rgba(r.pick(cols), 0.5);
        x.fillRect(-TS / 2 + r.int(0, 3) * g, -TS / 2 + r.int(0, 3) * g, g, g);
      }
    }
  }

  function drawContents(x, kind, t, time) {
    if (kind === 'table') {
      x.fillStyle = 'rgba(0,0,0,0.25)';
      x.beginPath(); x.arc(4, 5, 26, 0, TAU); x.fill();
      x.fillStyle = '#6b4f3c';
      x.beginPath(); x.arc(0, 0, 26, 0, TAU); x.fill();
      x.fillStyle = '#efe9dd';
      x.beginPath(); x.arc(-9, -4, 5, 0, TAU); x.arc(10, 6, 5, 0, TAU); x.fill();
      P.chairTop(x, -40, 0, 22, Math.PI / 2, {});
      P.chairTop(x, 40, 0, 22, -Math.PI / 2, {});
    } else if (kind === 'bed') {
      x.fillStyle = 'rgba(0,0,0,0.25)';
      x.fillRect(-34, -48, 74, 100);
      x.fillStyle = '#e8e3da';
      x.fillRect(-38, -52, 70, 96);
      x.fillStyle = C.ochre;
      x.fillRect(-38, -8, 70, 52);
      x.fillStyle = '#f5f1e9';
      x.fillRect(-32, -46, 26, 16);
      x.fillRect(0, -46, 26, 16);
      P.chairTop(x, 48, 30, 20, 0, {});
    } else if (kind === 'chair') {
      x.fillStyle = 'rgba(240,244,246,0.5)';
      x.fillRect(-30, -64, 60, 8);
      P.chairTop(x, 0, -18, 26, 0, { throwColor: C.ochre });
      P.glow(x, 0, -30, 50, '#dfe6ee', 0.18);
    } else if (kind === 'stairs') {
      for (let i = 0; i < 8; i++) {
        x.fillStyle = M.mixColor('#9c8a78', '#2a2226', i / 8);
        x.fillRect(-30, -50 + i * 11, 60, 10);
      }
      x.strokeStyle = 'rgba(0,0,0,0.3)';
      x.strokeRect(-30, -50, 60, 88);
    } else if (kind === 'plant') {
      x.fillStyle = '#7a4f3f';
      x.fillRect(-40, -30, 80, 60);
      x.strokeStyle = 'rgba(214,186,147,0.5)';
      x.lineWidth = 2;
      x.strokeRect(-34, -24, 68, 48);
      x.fillStyle = '#6b5a48';
      x.beginPath(); x.arc(30, -36, 10, 0, TAU); x.fill();
      x.fillStyle = '#56673f';
      for (let i = 0; i < 7; i++) {
        const a = i / 7 * TAU + time * 0.2;
        x.beginPath();
        P.leafPath(x, 30, -36, 16, 5, a);
        x.fill();
      }
    } else {
      P.glow(x, 10, 10, 50, '#f3ede0', 0.2);
    }
  }

  Bargaining.prototype.drawTile = function (x, t) {
    const cx = GX + t.c * TS + TS / 2, cy = GY + t.r * TS + TS / 2;
    const lifted = t.turning > 0 ? Math.sin(t.turning * Math.PI) : 0;
    const reached = this.reached.has(t);
    const kind = VERSIONS[t.v];
    const lit = t.lamp > 0.01;
    const rooms = this.painted && G.art.get('bargaining/rooms.webp');
    x.save();
    x.translate(cx, cy);
    if (lifted > 0) {
      // the room lifts off the page like a card while it turns (a soft, spreading shadow)
      for (let k = 0; k < 3; k++) {
        x.fillStyle = 'rgba(8,6,10,' + (0.16 * lifted).toFixed(3) + ')';
        const o = 5 + k * 5 * lifted, gr = k * 3;
        x.fillRect(-TS / 2 + o - gr, -TS / 2 + o * 1.3 - gr, TS + gr * 2, TS + gr * 2);
      }
      x.scale(1 + lifted * 0.07, 1 + lifted * 0.07);
    }
    x.rotate(t.ang);
    const r = M.rng(Math.floor(t.seed * 1000));
    if (rooms) {
      // painted floor and furniture: one cell of the 3 x 2 sheet per version of the room
      const cw = rooms.naturalWidth / 3, chh = rooms.naturalHeight / 2;
      x.drawImage(rooms, (t.v % 3) * cw, Math.floor(t.v / 3) * chh, cw, chh, -TS / 2, -TS / 2, TS, TS);
      if (!lit) { x.fillStyle = 'rgba(14,12,18,0.28)'; x.fillRect(-TS / 2, -TS / 2, TS, TS); }
    } else {
      drawFloor(x, t, r);
      drawContents(x, kind, t, this.t);
    }
    if (lit) {
      x.save();
      x.globalCompositeOperation = 'lighter';
      const flick = t.lampTo < t.lamp ? Math.random() * 0.5 + 0.5 : 1;
      P.glow(x, 0, 0, 96, '#e8b77a', (0.22 + 0.03 * Math.sin(this.t * 2 + t.seed)) * t.lamp * flick);
      x.restore();
    }
    if (!reached && !this.solved) {
      x.fillStyle = 'rgba(20,18,24,0.28)';
      x.fillRect(-TS / 2, -TS / 2, TS, TS);
    }
    // walls, with door gaps: translucent sewn cloth (after Do Ho Suh), so each room shows
    // through its neighbour's wall; some are patchwork in other colours
    const WT = 11, GAP0 = 44, GAP1 = 106;
    DIRS.forEach(([d], i) => {
      x.save();
      x.rotate(i * Math.PI / 2);
      // this frame: the wall runs along the top edge (y = -TS/2)
      const fabric = t.fabric[i];
      const segs = has(t.mask, d) ? [[0, GAP0], [GAP1, TS]] : [[0, TS]];
      for (const [a, b] of segs) {
        const x0 = -TS / 2 + a, w = b - a;
        const col = fabric || '#e8e0d0';
        // the cloth, with light coming through it
        x.fillStyle = M.rgba(col, fabric ? 0.52 : 0.4);
        x.fillRect(x0, -TS / 2, w, WT);
        x.fillStyle = 'rgba(255,248,236,0.16)';
        x.fillRect(x0, -TS / 2, w, 3);
        // the hem on the room side, and its running stitch
        x.fillStyle = M.rgba(M.mixColor(col, '#000000', 0.5), 0.55);
        x.fillRect(x0, -TS / 2 + WT - 1.6, w, 1.6);
        x.strokeStyle = 'rgba(250,244,232,0.7)';
        x.lineWidth = 1;
        x.setLineDash([3, 4]);
        x.beginPath();
        x.moveTo(x0 + 2, -TS / 2 + WT * 0.45);
        x.lineTo(x0 + w - 2, -TS / 2 + WT * 0.45);
        x.stroke();
        x.setLineDash([]);
        // where it hangs, a soft band of shade on the floor
        x.fillStyle = 'rgba(28,20,16,0.2)';
        x.fillRect(x0, -TS / 2 + WT, w, 4);
        x.fillStyle = 'rgba(28,20,16,0.1)';
        x.fillRect(x0, -TS / 2 + WT + 4, w, 5);
      }
      if (has(t.mask, d)) {
        // a doorway that answers stands open; one that leads nowhere swings shut
        const shut = 1 - t.doors[i];
        if (shut > 0.02) {
          x.save();
          x.translate(-TS / 2 + GAP0, -TS / 2 + WT / 2);
          x.rotate((1 - shut) * Math.PI * 0.5);
          x.fillStyle = '#5a4331';
          x.fillRect(0, -4, GAP1 - GAP0, 8);
          x.fillStyle = 'rgba(255,230,200,0.15)';
          x.fillRect(0, -4, GAP1 - GAP0, 2);
          x.fillStyle = '#c49c56';
          x.beginPath();
          x.arc(GAP1 - GAP0 - 8, 0, 2.5, 0, TAU);
          x.fill();
          x.restore();
        }
      }
      x.restore();
    });
    x.restore();
  };

  Bargaining.prototype.threadPoints = function () {
    const lines = [];
    const center = t => [GX + t.c * TS + TS / 2, GY + t.r * TS + TS / 2];
    const start = this.tile(ENTRY.c, ENTRY.r);
    if (this.reached.has(start)) lines.push([[GX - 58, GY + TS * 1.5], [GX, GY + TS * 1.5], center(start)]);
    for (const [a, b] of this.edges) {
      const A = center(a), B = center(b);
      lines.push([A, [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2], B]);
    }
    if (this.reachExit) {
      const t = this.tile(EXIT.c, EXIT.r), A = center(t);
      lines.push([A, [GX + COLS * TS, A[1]], [G.W + 20, A[1]]]);
    }
    return lines;
  };

  Bargaining.prototype.draw = function (x) {
    if (this.painted) x.drawImage(G.art.get('bargaining/backdrop.webp'), 0, 0, G.W, G.H);
    else x.drawImage(this.backdrop.c, 0, 0, G.W, G.H);
    // their letter on the landing
    if (!this.revisit) {
      const im = G.art.get('bargaining/letter.webp');
      x.save();
      x.translate(LETTER.x, LETTER.y);
      x.rotate(-0.25);
      if (im) { const w = 46, h = w * im.naturalHeight / im.naturalWidth; x.drawImage(im, -w / 2, -h / 2, w, h); }
      else { x.fillStyle = '#e8e0cc'; x.fillRect(-18, -12, 36, 24); }
      x.restore();
      const near = this.hoverLetter || (this.keySel && this.sel.c < 0);
      P.glint(x, LETTER.x, LETTER.y, this.t, near ? 1 : (this.letterRead ? 0 : 0.5), false);
    }
    // grid shadow and base
    x.fillStyle = 'rgba(0,0,0,0.45)';
    x.fillRect(GX + 10, GY + 14, COLS * TS, ROWS * TS);
    const order = this.tiles.slice().sort((a, b) => (a.turning > 0) - (b.turning > 0));
    for (const t of order) this.drawTile(x, t);
    // the red thread
    const off = -this.t * 22;
    for (const pts of this.threadPoints()) {
      P.runningStitch(x, pts, { color: 'rgba(40,10,8,0.35)', width: 4, dash: [8, 6], offset: off });
      P.runningStitch(x, pts, { color: C.oxbloodLight, width: 2.4, dash: [8, 6], offset: off });
    }
    // hover / key selection
    const sel = this.keySel && this.sel.c >= 0 ? this.tile(this.sel.c, this.sel.r) : (this.keySel ? null : this.hover);
    if (sel && !this.solved) {
      const sx = GX + sel.c * TS, sy = GY + sel.r * TS;
      x.save();
      x.strokeStyle = 'rgba(240,232,214,0.7)';
      x.lineWidth = 2;
      x.setLineDash([6, 5]);
      x.lineDashOffset = -this.t * 8;
      x.strokeRect(sx + 5, sy + 5, TS - 10, TS - 10);
      x.restore();
    }
    const h = this.hero;
    G.person.drawTop(x, { x: h.x, y: h.y, s: 44, ang: h.ang, phase: h.phase, walk: h.walk, scarf: !!G.save.data.scarf });
  };
})();
