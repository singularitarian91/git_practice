/* scenes.js: title, chapter plates, return menu, end card, and the flow between chapters. */
(function () {
  'use strict';
  const G = window.G, M = G.M, C = G.C, P = G.paint, T = G.text;
  G.chapters = G.chapters || {};

  const CH = [
    { name: 'Denial', ctor: 'Denial', title: 'The room repeats before it can be left.', play: 'Look closely. Notice what changes between the copies.' },
    { name: 'Anger', ctor: 'Anger', title: 'The garden resists being crossed.', play: 'Untie the gate. Make one narrow way through.' },
    { name: 'Bargaining', ctor: 'Bargaining', title: 'Every doorway offers another version.', play: 'Turn the rooms. Find the way that leads beyond the loop.' },
    { name: 'Depression', ctor: 'Depression', title: 'The world is large and hard to reach.', play: 'Follow the boardwalk. Stop, now and then.' },
    { name: 'Acceptance', ctor: 'Acceptance', title: 'The missing place remains within a shared world.', play: 'Mend the shelter. Tend the garden. Make room.' }
  ];
  const num = i => String(i + 1).padStart(2, '0');

  const inRect = (r, px, py) => px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h;

  // ------------------------------------------------------------ flow
  const flow = (G.flow = { CH, current: -1, revisit: false });

  // Painted images a chapter needs (see G.art). Shared ones (the chair, cloth) stay loaded.
  flow.artFor = function (i, o) {
    const Ctor = i >= 0 && i < CH.length && G.chapters[CH[i].ctor];
    return Ctor && Ctor.art ? Ctor.art(o || {}) : [];
  };
  // Keep only what's needed now and next, and fetch the next chapter quietly.
  flow.settleArt = function (now, next) {
    G.art.keepOnly(G.art.shared.concat(now, next || []));
    if (next && next.length) setTimeout(() => G.art.loadAll(next), 2500);
  };

  flow.title = function (sub) {
    G.fx.fade(() => { G.ui.clear(); G.setScene(new TitleScene(sub)); }, { dur: 1.4 });
  };
  flow.plate = function (i, o) {
    G.fx.tear(() => { G.ui.clear(); G.setScene(new PlateScene(i, o || {})); });
  };
  // `pre` is a chapter already built (and painted) while its plate was showing.
  flow.start = function (i, o, pre) {
    o = o || {};
    flow.current = i;
    flow.revisit = !!o.revisit;
    G.ui.clear();
    G.ui.label = num(i) + ' · ' + CH[i].name;
    G.ui.hud = true;
    if (!G.chapters[CH[i].ctor]) { G.ui.hud = false; G.setScene(new ComingScene(i)); return; }
    const scene = pre || new G.chapters[CH[i].ctor](o);
    scene.restart = () => G.fx.fade(() => flow.start(i, o), { dur: 1.2 });
    G.setScene(scene);
    flow.settleArt(flow.artFor(i, o), o.revisit ? [] : flow.artFor(i + 1));
    if (!o.revisit) {
      G.save.data.reached = Math.max(G.save.data.reached || 0, i);
      G.save.write();
    }
  };
  flow.complete = function (i) {
    const d = G.save.data;
    if (flow.revisit) { flow.title('return'); return; }
    d.reached = Math.max(d.reached || 0, i + 1);
    if (i === CH.length - 1) {
      d.done = true;
      G.save.write();
      G.fx.fade(() => { G.ui.clear(); G.ui.hud = false; G.setScene(new EndScene()); }, { dur: 3.2, color: '#e6dfd3' });
      return;
    }
    G.save.write();
    flow.plate(i + 1);
  };

  // ------------------------------------------------------------ title
  function paintTitleRoom() {
    const L = G.layer(G.W, G.H);
    const x = L.x;
    const r = M.rng(12);
    // wall with a faint damask
    x.fillStyle = '#1d201d';
    x.fillRect(0, 0, G.W, G.H);
    x.save();
    x.globalAlpha = 0.12;
    x.fillStyle = P.patternOf(x, P.damaskPale, 1.1);
    x.fillRect(0, 0, G.W, 560);
    x.restore();
    // window view
    const wx = 770, wy = 96, ww = 250, wh = 400;
    const sky = x.createLinearGradient(0, wy, 0, wy + wh);
    sky.addColorStop(0, '#aeb3b9');
    sky.addColorStop(0.55, '#cfd2d4');
    sky.addColorStop(0.62, '#8f949a');
    sky.addColorStop(1, '#6f747a');
    x.fillStyle = sky;
    x.fillRect(wx, wy, ww, wh);
    x.fillStyle = 'rgba(70,74,80,0.7)';
    x.beginPath();
    x.moveTo(wx, wy + wh * 0.56);
    for (let i = 0; i <= 10; i++) x.lineTo(wx + ww * i / 10, wy + wh * 0.56 - 10 - Math.sin(i * 1.3) * 7 - r() * 5);
    x.lineTo(wx + ww, wy + wh * 0.6);
    x.lineTo(wx, wy + wh * 0.6);
    x.fill();
    // bare tree outside
    x.strokeStyle = 'rgba(40,40,42,0.7)';
    x.lineCap = 'round';
    const branch = (bx, by, ang, len, w, d) => {
      if (d > 5 || len < 6) return;
      const ex = bx + Math.cos(ang) * len, ey = by + Math.sin(ang) * len;
      x.lineWidth = w;
      x.beginPath();
      x.moveTo(bx, by);
      x.lineTo(ex, ey);
      x.stroke();
      branch(ex, ey, ang - r.range(0.2, 0.6), len * r.range(0.6, 0.8), w * 0.65, d + 1);
      branch(ex, ey, ang + r.range(0.2, 0.6), len * r.range(0.6, 0.8), w * 0.65, d + 1);
    };
    branch(wx + 180, wy + wh * 0.6, -Math.PI / 2, 70, 5, 0);
    // frame and mullions
    x.strokeStyle = '#2a211b';
    x.lineWidth = 14;
    x.strokeRect(wx, wy, ww, wh);
    x.lineWidth = 7;
    x.beginPath();
    x.moveTo(wx + ww / 2, wy);
    x.lineTo(wx + ww / 2, wy + wh);
    x.moveTo(wx, wy + wh * 0.42);
    x.lineTo(wx + ww, wy + wh * 0.42);
    x.stroke();
    x.fillStyle = '#3a2d23';
    x.fillRect(wx - 18, wy + wh, ww + 36, 14);
    // floor
    const fy = 560;
    const fl = x.createLinearGradient(0, fy, 0, G.H);
    fl.addColorStop(0, '#2c2520');
    fl.addColorStop(1, '#171412');
    x.fillStyle = fl;
    x.fillRect(0, fy, G.W, G.H - fy);
    x.strokeStyle = 'rgba(0,0,0,0.35)';
    x.lineWidth = 1.2;
    for (let i = 0; i < 9; i++) {
      const yy = fy + Math.pow(i / 9, 1.6) * 160;
      x.beginPath();
      x.moveTo(0, yy);
      x.lineTo(G.W, yy);
      x.stroke();
    }
    for (let i = -12; i < 30; i++) {
      x.beginPath();
      x.moveTo(640 + i * 30, fy);
      x.lineTo(640 + i * 90, G.H);
      x.stroke();
    }
    x.fillStyle = '#0f0d0b';
    x.fillRect(0, fy - 8, G.W, 10);
    // light shaft on the floor
    x.save();
    x.globalCompositeOperation = 'lighter';
    const lg = x.createLinearGradient(wx, wy + wh, 520, G.H);
    lg.addColorStop(0, 'rgba(210,214,220,0.14)');
    lg.addColorStop(1, 'rgba(210,214,220,0.02)');
    x.fillStyle = lg;
    x.beginPath();
    x.moveTo(wx, wy);
    x.lineTo(wx + ww, wy);
    x.lineTo(wx + ww - 60, G.H);
    x.lineTo(wx - 360, G.H);
    x.closePath();
    x.fill();
    x.restore();
    P.texturize(L, 0.4);
    return L;
  }

  function TitleScene(sub) {
    this.t = 0;
    this.sub = sub || null;
    this.finish = { vignette: 1, grain: 0.9 };
    this.pausable = false;
  }
  TitleScene.prototype.enter = function () {
    G.ui.hud = false;
    this.painted = G.art.get('title/room.webp');
    if (!this.painted) this.room = paintTitleRoom();
    // keep the title's painting and fetch the chapter Begin/Continue leads to
    const d = G.save.data;
    flow.settleArt(TitleScene.art, d.done ? [] : flow.artFor(d.reached || 0));
    this.motes = new P.Motes(46, { x: 520, y: 120, w: 520, h: 560 }, 3);
    this.sel = 0;
    this.buildMenu();
    G.audio.scene({ room: 1.0, drone: [50, 57, 64], droneLevel: 0.4 });
  };
  TitleScene.prototype.buildMenu = function () {
    const d = G.save.data;
    const items = [];
    if (d.done) {
      items.push({ label: 'Return to a chapter', act: () => { this.sub = 'return'; this.sel = 0; } });
      items.push({ label: 'Begin again', act: () => flow.plate(0) });
    } else if (d.reached > 0) {
      items.push({ label: 'Continue · ' + num(d.reached) + ' ' + CH[d.reached].name, act: () => flow.plate(d.reached) });
      items.push({ label: 'Begin again', act: () => flow.plate(0) });
    } else {
      items.push({ label: 'Begin', act: () => flow.plate(0) });
    }
    this.items = items;
  };
  TitleScene.prototype.rects = function () {
    if (this.sub === 'return') {
      const w = 196, gap = 22, x0 = (G.W - (5 * w + 4 * gap)) / 2;
      const cards = CH.map((c, i) => ({ x: x0 + i * (w + gap), y: 262, w, h: 170 }));
      cards.push({ x: G.W / 2 - 80, y: 500, w: 160, h: 46 });
      return cards;
    }
    return this.items.map((it, i) => ({ x: 64, y: 506 + i * 50, w: 420, h: 44 }));
  };
  TitleScene.prototype.update = function (dt) {
    this.t += dt;
    const inp = G.input;
    const rects = this.rects();
    const count = rects.length;
    let hover = -1;
    rects.forEach((r, i) => { if (inRect(r, inp.x, inp.y)) hover = i; });
    if (hover >= 0 && inp.lastDevice === 'pointer') this.sel = hover;
    G.setCursor(hover >= 0 ? 'pointer' : 'default');
    const vertical = this.sub !== 'return';
    if (inp.hit[vertical ? 'up' : 'left']) this.sel = (this.sel + count - 1) % count;
    if (inp.hit[vertical ? 'down' : 'right']) this.sel = (this.sel + 1) % count;
    if (!vertical && (inp.hit.up || inp.hit.down)) this.sel = this.sel === count - 1 ? 0 : count - 1;
    let fire = inp.hit.act ? this.sel : -1;
    if (inp.pressed && hover >= 0) fire = hover;
    if (inp.hit.pause && this.sub === 'return') { this.sub = null; this.sel = 0; return; }
    if (fire >= 0 && this.t > 0.4) {
      G.audio.chime(69, 0.08);
      if (this.sub === 'return') {
        if (fire === count - 1) { this.sub = null; this.sel = 0; }
        else flow.plate(fire, { revisit: true });
      } else this.items[fire].act();
    }
  };
  TitleScene.prototype.draw = function (x) {
    const t = this.t;
    if (this.painted) x.drawImage(this.painted, 0, 0, G.W, G.H);
    else x.drawImage(this.room.c, 0, 0, G.W, G.H);
    // gauze at the window
    P.gauze(x, 752, 86, 120, 470, { t, alpha: this.painted ? 0.12 : 0.22, seed: 2, wind: 0.08 });
    P.gauze(x, 930, 86, 110, 440, { t: t + 3, alpha: this.painted ? 0.09 : 0.16, seed: 5, wind: 0.05 });
    // clouds passing outside: the light in the room swells and fades
    if (this.painted) {
      const sun = 0.5 + 0.5 * Math.sin(t * 0.35) * Math.sin(t * 0.13 + 1);
      const g0 = x.createLinearGradient(0, 110, 0, 720);
      g0.addColorStop(0, 'rgba(214,226,236,0.16)');
      g0.addColorStop(1, 'rgba(214,226,236,0.02)');
      x.save();
      x.globalCompositeOperation = 'lighter';
      x.globalAlpha = 0.25 + 0.75 * sun;
      x.fillStyle = g0;
      x.beginPath();
      x.moveTo(770, 110);
      x.lineTo(1010, 110);
      x.lineTo(990, 720);
      x.lineTo(470, 720);
      x.closePath();
      x.fill();
      x.restore();
    }
    this.motes.draw(x, t, 0.5);
    // the empty chair in the light
    P.chair(x, 690, 628, { s: 190, facing: 1, throwColor: C.ochre });
    // dark panel for the words, as on the guide's cover
    const g = x.createLinearGradient(0, 0, 760, 0);
    g.addColorStop(0, 'rgba(17,20,18,0.94)');
    g.addColorStop(0.62, 'rgba(17,20,18,0.72)');
    g.addColorStop(1, 'rgba(17,20,18,0)');
    x.fillStyle = g;
    x.fillRect(0, 0, 760, G.H);

    if (this.sub === 'return') { this.drawReturn(x); return; }

    const a = M.clamp(t / 1.2, 0, 1);
    x.save();
    x.globalAlpha = a;
    T.label(x, 'A game in five chapters', 72, 132, { size: 13 });
    x.fillStyle = C.bone;
    x.font = '84px ' + G.FONT_SERIF;
    x.textBaseline = 'alphabetic';
    ['A WORLD', 'THE SIZE', 'OF GRIEF'].forEach((ln, i) => x.fillText(ln, 66, 222 + i * 84));
    x.font = 'italic 25px ' + G.FONT_SERIF;
    x.fillStyle = 'rgba(237,233,226,0.82)';
    x.fillText('Start in one room. Let the world grow.', 70, 440);
    // menu
    this.items.forEach((it, i) => {
      const sel = i === this.sel;
      x.font = 'italic 31px ' + G.FONT_SERIF;
      x.fillStyle = sel ? C.tan : C.bone;
      x.fillText(it.label, 72, 540 + i * 50);
      if (sel) {
        const w = x.measureText(it.label).width;
        P.whipstitch(x, 72, 552 + i * 50, 72 + w, 552 + i * 50, { color: 'rgba(214,186,147,0.75)', gap: 8, len: 5 });
      }
    });
    x.font = '15px ' + G.FONT_SANS;
    x.fillStyle = 'rgba(237,233,226,0.55)';
    x.fillText('A short, quiet game about loss, about twenty minutes. These chapters are fiction, not a map for real grief.', 72, 660);
    x.fillText(G.touch
      ? 'Tap to walk and to look closer. Hold to pull, untie and sew. Sound follows your phone\u2019s silent switch.'
      : 'Click or tap to walk and to look closer. Hold to pull, untie and sew. Keys: A D or arrows, E or Space. Esc pauses.', 72, 684);
    if (G.portrait && !G.rotated) {
      T.label(x, 'Turn your phone sideways for a bigger view', G.W / 2, 40, { size: 13, align: 'center' });
    }
    x.restore();
  };
  TitleScene.prototype.drawReturn = function (x) {
    const rects = this.rects();
    x.save();
    x.fillStyle = 'rgba(17,20,18,0.72)';
    x.fillRect(0, 0, G.W, G.H);
    T.label(x, 'Return', G.W / 2, 150, { size: 14, align: 'center' });
    x.font = 'italic 30px ' + G.FONT_SERIF;
    x.fillStyle = C.bone;
    x.textAlign = 'center';
    x.fillText('Earlier places remain. Their light has changed.', G.W / 2, 210);
    CH.forEach((c, i) => {
      const r = rects[i];
      const sel = i === this.sel;
      const img = G.plates && G.plates[i];
      x.save();
      x.globalAlpha = sel ? 1 : 0.75;
      if (img && img.complete && img.naturalWidth) {
        x.drawImage(img, r.x, r.y, r.w, r.w * 9 / 16);
      } else {
        x.fillStyle = '#2a2e2a';
        x.fillRect(r.x, r.y, r.w, r.w * 9 / 16);
      }
      if (sel) {
        x.strokeStyle = C.tan;
        x.lineWidth = 2;
        x.strokeRect(r.x - 4, r.y - 4, r.w + 8, r.w * 9 / 16 + 8);
      }
      x.restore();
      T.label(x, num(i) + ' · ' + c.name, r.x, r.y + r.w * 9 / 16 + 30, { size: 13, color: sel ? C.tan : C.bone });
    });
    const b = rects[rects.length - 1];
    const selB = this.sel === rects.length - 1;
    x.font = 'italic 28px ' + G.FONT_SERIF;
    x.fillStyle = selB ? C.tan : C.bone;
    x.textAlign = 'center';
    x.fillText('Back', b.x + b.w / 2, b.y + 32);
    x.restore();
  };

  // ------------------------------------------------------------ chapter plates
  function PlateScene(i, o) {
    this.i = i;
    this.o = o || {};
    this.t = 0;
    this.finish = { vignette: 0.5, grain: 0.7 };
    this.pausable = false;
    this.done = false;
  }
  PlateScene.prototype.enter = function () {
    G.ui.hud = false;
    this.edge = [];
    const r = M.rng(this.i * 97 + 5);
    for (let xx = 0; xx <= G.W; xx += 14) this.edge.push([xx, 488 + r.range(-6, 6)]);
    G.audio.scene({ room: 0.5, drone: [[50, 57, 64], [48, 55, 63], [49, 56, 61], [45, 52, 60], [48, 55, 64]][this.i], droneLevel: 0.32 });
    this.art = flow.artFor(this.i, this.o);
    G.art.loadAll(this.art);
    this.video = G.plateVideo ? G.plateVideo(this.i) : null;
    this.vidA = 0;
  };
  PlateScene.prototype.exit = function () {
    if (this.video) this.video.release();
    this.video = null;
  };
  PlateScene.prototype.update = function (dt) {
    this.t += dt;
    const inp = G.input;
    // once the painted loop is actually moving, let it come up over the still
    const v = this.video;
    if (v && v.readyState >= 2 && !v.paused && v.currentTime > 0.05) this.vidA = Math.min(1, this.vidA + dt / 0.8);
    this.ready = G.art.ready(this.art);
    // build the chapter while the plate is up, one piece of scenery per frame
    const Ctor = G.chapters[CH[this.i].ctor];
    if (Ctor && this.t > 0.3 && !this.done && this.ready) {
      if (!this.next) this.next = new Ctor(this.o);
      else G.prepareStep(this.next);
    }
    // warm the chapter's paintings (and the figures' cloth), one a frame, while the plate is up
    if (this.ready && !this.warmList) this.warmList = this.art.concat(G.art.shared, ['cloth']);
    if (this.warmList && this.warmList.length && this.t > 0.4) {
      const w = this.warmList.shift();
      if (w === 'cloth') G.person.warm(this.next && this.next.paperLight);
      else G.art.warm(w);
    }
    G.setCursor(this.t > 1 && this.ready ? 'pointer' : 'default');
    if (!this.done && this.t > 1.0 && this.ready && (inp.pressed || inp.hit.act)) {
      this.done = true;
      if (this.next) G.prepareScene(this.next);
      const next = this.next;
      this.next = null;
      G.fx.tear(() => flow.start(this.i, this.o, next));
    }
  };
  PlateScene.prototype.draw = function (x) {
    const img = G.plates && G.plates[this.i];
    const c = CH[this.i];
    x.fillStyle = '#1b1e1b';
    x.fillRect(0, 0, G.W, G.H);
    const z = 1 + Math.min(this.t, 14) * 0.004;
    if (img && img.complete && img.naturalWidth && this.vidA < 1) {
      const sc = Math.max(G.W / img.naturalWidth, G.H / img.naturalHeight) * z;
      const w = img.naturalWidth * sc, h = img.naturalHeight * sc;
      x.drawImage(img, (G.W - w) / 2, (G.H - h) / 2 - 30, w, h);
    }
    const v = this.video;
    if (v && this.vidA > 0 && v.videoWidth) {
      const sc = Math.max(G.W / v.videoWidth, G.H / v.videoHeight) * z;
      const w = v.videoWidth * sc, h = v.videoHeight * sc;
      x.save();
      x.globalAlpha = this.vidA;
      x.drawImage(v, (G.W - w) / 2, (G.H - h) / 2 - 30, w, h);
      x.restore();
    }
    // the dark band with a torn top edge
    x.save();
    x.fillStyle = 'rgba(19,23,21,0.9)';
    x.beginPath();
    x.moveTo(0, G.H);
    for (const p of this.edge) x.lineTo(p[0], p[1]);
    x.lineTo(G.W, G.H);
    x.closePath();
    x.fill();
    x.restore();
    const a = M.clamp((this.t - 0.3) / 0.9, 0, 1);
    x.save();
    x.globalAlpha = a;
    T.label(x, (this.o.revisit ? 'Return · ' : '') + num(this.i) + ' · ' + c.name, 70, 552, { size: 14 });
    x.font = '50px ' + G.FONT_SERIF;
    x.fillStyle = C.bone;
    x.textBaseline = 'alphabetic';
    x.fillText(c.title, 66, 612);
    x.font = '18px ' + G.FONT_SANS;
    x.fillStyle = 'rgba(214,186,147,0.9)';
    x.fillText(this.o.revisit ? 'The loss is still here. The light has changed.' : c.play, 70, 656);
    x.restore();
    if (this.t > 1.2 && this.ready) {
      x.save();
      x.globalAlpha = 0.55 + 0.35 * Math.sin(this.t * 2.5);
      T.label(x, 'Continue ›', G.W - 70, 656, { size: 13, align: 'right', color: C.bone });
      x.restore();
    } else if (this.t > 1.2) {
      // still fetching the chapter's painted scenery: three stitches, one at a time
      x.save();
      x.strokeStyle = C.tan;
      x.lineWidth = 2;
      x.lineCap = 'round';
      for (let i = 0; i < 3; i++) {
        x.globalAlpha = 0.25 + 0.6 * Math.max(0, Math.sin(this.t * 3 - i * 0.9));
        const sx = G.W - 110 + i * 16;
        x.beginPath();
        x.moveTo(sx - 4, 652);
        x.lineTo(sx + 4, 660);
        x.stroke();
      }
      x.restore();
    }
  };

  // ------------------------------------------------------------ end card
  function EndScene() {
    this.t = 0;
    this.finish = { vignette: 0.28, grain: 0.75 };
    this.pausable = false;
    this.sel = 0;
  }
  EndScene.prototype.enter = function () {
    G.audio.scene({ wind: 0.15, water: 0.25, drone: [48, 55, 64], droneLevel: 0.32 });
    G.audio.arp([60, 64, 67, 72], 0.4, 0.1);
    this.vignette = paintEndVignette();
  };
  EndScene.prototype.rects = function () {
    const y = this.vignette ? 566 : 520;
    return [{ x: G.W / 2 - 250, y, w: 240, h: 44 }, { x: G.W / 2 + 10, y, w: 240, h: 44 }];
  };

  // The river plain from the last chapter, washed onto the paper like a book illustration.
  const VIG = { w: 680, h: 290, y: 298 };
  function paintEndVignette() {
    const im = G.art.get('acceptance/backdrop.webp');
    if (!im) return null;
    const L = G.layer(VIG.w, VIG.h);
    const x = L.x;
    const sw = im.width * 0.62, sh = sw * VIG.h / VIG.w;
    x.drawImage(im, im.width * 0.3, im.height * 0.2, sw, sh, 0, 0, VIG.w, VIG.h);
    // sit it on the paper: warm it, then let it fade out at the edges
    x.globalCompositeOperation = 'multiply';
    x.fillStyle = '#efe6d6';
    x.fillRect(0, 0, VIG.w, VIG.h);
    x.globalCompositeOperation = 'destination-in';
    x.save();
    x.translate(VIG.w / 2, VIG.h / 2);
    x.scale(1, VIG.h / VIG.w);
    const g = x.createRadialGradient(0, 0, VIG.w * 0.12, 0, 0, VIG.w * 0.5);
    g.addColorStop(0, 'rgba(0,0,0,1)');
    g.addColorStop(0.55, 'rgba(0,0,0,0.85)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    x.fillStyle = g;
    x.fillRect(-VIG.w, -VIG.w, VIG.w * 2, VIG.w * 2);
    x.restore();
    x.globalCompositeOperation = 'source-over';
    return L;
  }
  EndScene.prototype.update = function (dt) {
    this.t += dt;
    if (this.t < 5) return;
    const inp = G.input;
    const rects = this.rects();
    let hover = -1;
    rects.forEach((r, i) => { if (inRect(r, inp.x, inp.y)) hover = i; });
    if (hover >= 0 && inp.lastDevice === 'pointer') this.sel = hover;
    G.setCursor(hover >= 0 ? 'pointer' : 'default');
    if (inp.hit.left || inp.hit.right) this.sel = 1 - this.sel;
    let fire = inp.hit.act ? this.sel : -1;
    if (inp.pressed && hover >= 0) fire = hover;
    if (fire === 0) flow.title('return');
    if (fire === 1) flow.title();
  };
  EndScene.prototype.draw = function (x) {
    const t = this.t;
    x.fillStyle = '#e6dfd3';
    x.fillRect(0, 0, G.W, G.H);
    if (this.vignette) this.drawVignette(x);
    else {
    // charcoal chair and a single flower
    x.save();
    x.globalAlpha = M.clamp(t / 2, 0, 1) * 0.9;
    P.chair(x, G.W / 2 + 10, 470, { s: 120, facing: 1, wood: '#3b3631', woodDark: '#2a2622', woodLight: '#6b635a' });
    x.strokeStyle = '#4c5a3c';
    x.lineWidth = 1.5;
    x.beginPath();
    x.moveTo(G.W / 2 + 90, 470);
    x.quadraticCurveTo(G.W / 2 + 94, 452, G.W / 2 + 92, 436);
    x.stroke();
    x.fillStyle = '#f5f1e8';
    for (let i = 0; i < 6; i++) {
      const a = i / 6 * M.TAU;
      x.beginPath();
      x.ellipse(G.W / 2 + 92 + Math.cos(a) * 4, 434 + Math.sin(a) * 4, 4, 2, a, 0, M.TAU);
      x.fill();
    }
    x.fillStyle = '#c9a23c';
    x.beginPath();
    x.arc(G.W / 2 + 92, 434, 1.8, 0, M.TAU);
    x.fill();
    x.strokeStyle = 'rgba(31,35,31,0.35)';
    x.lineWidth = 1;
    x.beginPath();
    x.moveTo(G.W / 2 - 140, 471);
    x.lineTo(G.W / 2 + 160, 471);
    x.stroke();
    x.restore();
    }

    x.save();
    x.textAlign = 'center';
    x.textBaseline = 'alphabetic';
    x.globalAlpha = M.clamp((t - 1) / 1.5, 0, 1);
    x.fillStyle = '#1f231f';
    x.font = '52px ' + G.FONT_SERIF;
    x.fillText('The world grew around it.', G.W / 2, 180);
    x.globalAlpha = M.clamp((t - 3) / 1.5, 0, 1);
    T.label(x, 'A World the Size of Grief', G.W / 2, 240, { size: 14, align: 'center', color: C.orange });
    x.font = 'italic 22px ' + G.FONT_SERIF;
    x.fillStyle = '#3a3d38';
    x.fillText('Thank you for playing.', G.W / 2, 282);
    x.globalAlpha = M.clamp((t - 5) / 1, 0, 1);
    const rects = this.rects();
    ['Return to a chapter', 'Title'].forEach((label, i) => {
      const r = rects[i];
      const sel = this.sel === i;
      x.font = 'italic 27px ' + G.FONT_SERIF;
      x.fillStyle = sel ? C.orange : '#1f231f';
      x.fillText(label, r.x + r.w / 2, r.y + 30);
      if (sel) {
        const w = x.measureText(label).width;
        P.whipstitch(x, r.x + r.w / 2 - w / 2, r.y + 40, r.x + r.w / 2 + w / 2, r.y + 40, { color: 'rgba(180,116,58,0.8)', gap: 8, len: 5 });
      }
    });
    x.font = '15px ' + G.FONT_SANS;
    x.fillStyle = 'rgba(31,35,31,0.6)';
    x.fillText('Earlier places remain. Their light has changed.', G.W / 2, this.vignette ? 666 : 610);
    x.restore();
  };

  // The painted ending: the plain opening up, their chair by the fence, sweet peas on the wire.
  EndScene.prototype.drawVignette = function (x) {
    const t = this.t, L = this.vignette;
    const vx = G.W / 2 - VIG.w / 2, a = M.clamp(t / 2.5, 0, 1);
    x.save();
    x.globalAlpha = a;
    x.drawImage(L.c, vx, VIG.y, VIG.w, VIG.h);
    // the thin warm band at the horizon, opening slowly
    x.globalCompositeOperation = 'soft-light';
    const g = x.createLinearGradient(0, VIG.y + 40, 0, VIG.y + 150);
    g.addColorStop(0, 'rgba(255,214,160,0)');
    g.addColorStop(0.6, M.rgba('#f0c987', 0.5 * M.smoothstep(1, 7, t)));
    g.addColorStop(1, 'rgba(255,214,160,0)');
    x.fillStyle = g;
    x.fillRect(vx + 60, VIG.y + 40, VIG.w - 120, 110);
    x.restore();
    // their chair, and the sweet peas along the fence
    const cx = G.W / 2 + 40, gy = VIG.y + VIG.h - 36;
    x.save();
    x.globalAlpha = M.clamp((t - 0.6) / 2, 0, 1);
    x.strokeStyle = 'rgba(60,52,44,0.6)';
    x.lineWidth = 1;
    x.beginPath();
    x.moveTo(cx - 190, gy - 30);
    x.lineTo(cx + 130, gy - 32);
    x.stroke();
    x.fillStyle = 'rgba(60,52,44,0.75)';
    for (const px of [cx - 190, cx - 30, cx + 130]) x.fillRect(px - 2.5, gy - 52, 5, 54);
    const peas = G.art.get('acceptance/peas.webp');
    if (peas) {
      const w = 118, h = w * peas.height / peas.width;
      for (const [px, f] of [[cx - 118, 1], [cx + 62, -1]]) {
        x.save();
        x.translate(px, gy - 31);
        x.rotate(Math.sin(t * 0.9 + px) * 0.02);
        x.scale(f, 1);
        x.drawImage(peas, -w / 2, -h / 2, w, h);
        x.restore();
      }
    }
    P.chair(x, cx - 28, gy + 4, { s: 112, facing: 1, throwColor: '#6b3f52', shadow: 0.25 });
    x.restore();
  };

  // Shown for a chapter whose script isn't present yet (work-in-progress builds).
  function ComingScene(i) { this.i = i; this.t = 0; this.pausable = false; this.finish = { vignette: 1, grain: 0.7 }; }
  ComingScene.prototype.update = function (dt) {
    this.t += dt;
    G.setCursor('pointer');
    if (this.t > 0.8 && (G.input.pressed || G.input.hit.act)) flow.title();
  };
  ComingScene.prototype.draw = function (x) {
    x.fillStyle = C.char;
    x.fillRect(0, 0, G.W, G.H);
    x.save();
    x.textAlign = 'center';
    T.label(x, num(this.i) + ' \u00b7 ' + CH[this.i].name, G.W / 2, 300, { size: 14, align: 'center' });
    x.font = 'italic 34px ' + G.FONT_SERIF;
    x.fillStyle = C.bone;
    x.fillText('This chapter is still being built.', G.W / 2, 360);
    x.globalAlpha = 0.6;
    T.label(x, 'Back to the title \u203a', G.W / 2, 420, { size: 13, align: 'center', color: C.bone });
    x.restore();
  };

  TitleScene.art = ['title/room.webp'];
  G.TitleScene = TitleScene;
  G.PlateScene = PlateScene;
  G.EndScene = EndScene;
})();
