/* ui.js: thought lines, hints, HUD, pause menu, and page transitions (G.fx). */
(function () {
  'use strict';
  const G = window.G, M = G.M, C = G.C;

  // ------------------------------------------------------------ text helpers
  const T = (G.text = {});
  T.wrap = function (x, text, maxW) {
    const words = String(text).split(' ');
    const lines = [];
    let cur = '';
    for (const w of words) {
      const test = cur ? cur + ' ' + w : w;
      if (x.measureText(test).width > maxW && cur) { lines.push(cur); cur = w; } else cur = test;
    }
    if (cur) lines.push(cur);
    return lines;
  };
  // Letter-spaced text drawn glyph by glyph (canvas letterSpacing is not universal).
  T.tracked = function (x, str, px, py, track, align) {
    let w = 0;
    const widths = [];
    for (const ch of str) { const cw = x.measureText(ch).width; widths.push(cw); w += cw + track; }
    w -= track;
    let cx = align === 'center' ? px - w / 2 : align === 'right' ? px - w : px;
    const saved = x.textAlign;
    x.textAlign = 'left';
    let i = 0;
    for (const ch of str) { x.fillText(ch, cx, py); cx += widths[i++] + track; }
    x.textAlign = saved;
    return w;
  };
  T.label = function (x, str, px, py, o) {
    o = o || {};
    x.font = (o.weight || 700) + ' ' + (o.size || 13) + 'px ' + G.FONT_SANS;
    x.fillStyle = o.color || C.tan;
    x.textBaseline = 'alphabetic';
    return T.tracked(x, str.toUpperCase(), px, py, o.track == null ? 2.2 : o.track, o.align);
  };

  // ------------------------------------------------------------ ui state
  const ui = (G.ui = {
    line: null,
    queue: [],
    hintText: null,
    hintA: 0,
    hintT: 0,
    label: '',
    hud: false,
    menu: null,
    menuSel: 0,
    bubbles: [],
    hudHover: null
  });

  function lineDur(text) { return 1.8 + text.length * 0.052; }
  ui.lineDur = lineDur;

  // Thought line at the bottom of the stage. Arrays play in order.
  ui.say = function (text, o) {
    o = o || {};
    const list = Array.isArray(text) ? text : [text];
    ui.queue = list.slice(1).map(t => ({ text: t, dur: o.dur || lineDur(t), delay: 0.25 }));
    ui.line = { text: list[0], t: -(o.delay || 0), dur: o.dur || lineDur(list[0]) };
  };
  // Queue after whatever is showing.
  ui.then = function (text, o) {
    o = o || {};
    const list = Array.isArray(text) ? text : [text];
    const items = list.map(t => ({ text: t, dur: o.dur || lineDur(t), delay: o.delay == null ? 0.3 : o.delay }));
    if (!ui.line) { const f = items.shift(); ui.line = { text: f.text, t: -f.delay, dur: f.dur }; }
    ui.queue.push(...items);
  };
  ui.busy = function () { return !!ui.line || ui.queue.length > 0; };
  ui.clear = function () { ui.line = null; ui.queue = []; ui.bubbles = []; ui.action = null; ui.card = null; ui.hint(null); };

  // A close look at something of theirs: a painted card in the middle of the screen, with its
  // lines, until you tap or press a key.
  ui.keepsake = function (img, lines) {
    ui.card = { img, t: 0, a: 0, closing: false };
    if (lines) ui.say(lines);
  };

  ui.hint = function (text, dur) {
    if (text == null) { ui.hintT = 0; return; }
    ui.hintText = text;
    ui.hintT = dur == null ? 5 : dur;
  };

  // Short speech from another person, anchored to a screen-space function.
  ui.speak = function (anchor, text, dur) {
    ui.bubbles = ui.bubbles.filter(b => b.anchor !== anchor);
    ui.bubbles.push({ anchor, text, t: 0, dur: dur || lineDur(text) + 0.5 });
  };

  // ------------------------------------------------------------ HUD + pause
  const HUD = {
    sound: { x: G.W - 64, y: 18, w: 36, h: 36 },
    pause: { x: G.W - 108, y: 18, w: 36, h: 36 },
    action: { x: G.W - 112, y: G.H - 150, w: 80, h: 80 }
  };
  // A chapter can offer one hold-to-use action: a round button at the lower right, or a key.
  // ui.action = { label, key } while it's offered; ui.action.held says whether it's held now.
  ui.action = null;
  ui.actionHeldBy = null;
  const inRect = (r, px, py) => px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h;

  ui.toggleSound = function () {
    const m = !G.audio.muted;
    G.audio.setMuted(m);
    G.save.data.sound = !m;
    G.save.write();
  };

  ui.openMenu = function () {
    if (ui.menu) return;
    G.paused = true;
    ui.menuSel = 0;
    ui.menu = [
      { label: 'Continue', act: () => ui.closeMenu() },
      { label: () => 'Sound: ' + (G.audio.muted ? 'off' : 'on'), act: () => ui.toggleSound() },
      { label: 'Restart this chapter', act: () => { ui.closeMenu(); if (G.scene && G.scene.restart) G.scene.restart(); } },
      { label: 'Back to the title', act: () => { ui.closeMenu(); G.flow.title(); } }
    ];
  };
  ui.closeMenu = function () { ui.menu = null; G.paused = false; };

  function menuRects() {
    return ui.menu.map((m, i) => ({ x: G.W / 2 - 200, y: 300 + i * 58, w: 400, h: 48 }));
  }

  ui.preUpdate = function () {
    const inp = G.input;
    if (inp.hit.mute) ui.toggleSound();
    if (ui.menu) {
      const rects = menuRects();
      if (inp.lastDevice === 'pointer') rects.forEach((r, i) => { if (inRect(r, inp.x, inp.y)) ui.menuSel = i; });
      if (inp.hit.up) ui.menuSel = (ui.menuSel + ui.menu.length - 1) % ui.menu.length;
      if (inp.hit.down) ui.menuSel = (ui.menuSel + 1) % ui.menu.length;
      if (inp.hit.pause) { ui.closeMenu(); inp.consume(); inp.hit = {}; return; }
      if (inp.hit.act) { ui.menu[ui.menuSel].act(); inp.hit = {}; inp.consume(); return; }
      if (inp.pressed) {
        const i = rects.findIndex(r => inRect(r, inp.x, inp.y));
        if (i >= 0) ui.menu[i].act();
      }
      inp.consume();
      inp.hit = {};
      G.setCursor('default');
      return;
    }
    ui.hudHover = null;
    if (ui.card) {
      if (ui.card.t > 1.2 && (inp.pressed || inp.hit.act)) ui.card.closing = true;
      inp.consume();
      inp.hit = {};
      return;
    }
    if (!ui.hud) return;
    // the hold-to-use action: pressing the button holds it until the press ends
    const act = ui.action;
    if (act) {
      if (inp.pressed && inRect(HUD.action, inp.x, inp.y)) { ui.actionHeldBy = 'pointer'; inp.consume(); }
      if (ui.actionHeldBy === 'pointer' && !inp.down) ui.actionHeldBy = null;
      act.held = ui.actionHeldBy === 'pointer' || !!inp.keys[act.key];
      if (inp.keys[act.key]) inp.lastDevice = 'keys';
    } else ui.actionHeldBy = null;
    if (act && inRect(HUD.action, inp.x, inp.y)) ui.hudHover = 'action';
    else if (inRect(HUD.sound, inp.x, inp.y)) ui.hudHover = 'sound';
    else if (inRect(HUD.pause, inp.x, inp.y)) ui.hudHover = 'pause';
    if (inp.pressed && (ui.hudHover === 'sound' || ui.hudHover === 'pause')) {
      if (ui.hudHover === 'sound') ui.toggleSound(); else if (!G.fx.active) ui.openMenu();
      inp.consume();
    }
    if (inp.hit.pause && G.scene && G.scene.pausable !== false && !G.fx.active) { ui.openMenu(); inp.hit = {}; }
  };

  ui.update = function (dt) {
    // paused: every line, hint and speech bubble waits where it is
    if (G.paused) return;
    if (ui.line) {
      ui.line.t += dt;
      if (ui.line.t > ui.line.dur) {
        const n = ui.queue.shift();
        ui.line = n ? { text: n.text, t: -n.delay, dur: n.dur } : null;
      }
    }
    if (ui.hintT > 0) ui.hintT -= dt;
    ui.hintA = M.damp(ui.hintA, ui.hintT > 0 ? 1 : 0, 6, dt);
    for (const b of ui.bubbles) b.t += dt;
    ui.bubbles = ui.bubbles.filter(b => b.t < b.dur);
    if (ui.card) {
      const c = ui.card;
      c.t += dt;
      c.a = c.closing ? c.a - dt * 3 : Math.min(1, c.a + dt * 2.5);
      if (c.closing && c.a <= 0) ui.card = null;
    }
    if (ui.action) {
      const a = ui.action;
      a.t = (a.t || 0) + dt;
      a.fill = M.damp(a.fill || 0, a.held ? 1 : 0, 8, dt);
      a.appear = Math.min(1, (a.appear || 0) + dt * 1.5);
    }
    if (ui.hud && ui.hudHover && !ui.menu) G.setCursor('pointer');
  };

  function drawIcon(x, which, hover) {
    const r = HUD[which];
    x.save();
    x.globalAlpha = hover ? 0.95 : 0.5;
    x.strokeStyle = C.bone;
    x.fillStyle = C.bone;
    x.lineWidth = 1.6;
    x.lineCap = 'round';
    const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
    if (which === 'pause') {
      x.fillRect(cx - 6, cy - 8, 4, 16);
      x.fillRect(cx + 2, cy - 8, 4, 16);
    } else {
      x.beginPath();
      x.moveTo(cx - 10, cy - 4);
      x.lineTo(cx - 5, cy - 4);
      x.lineTo(cx + 1, cy - 9);
      x.lineTo(cx + 1, cy + 9);
      x.lineTo(cx - 5, cy + 4);
      x.lineTo(cx - 10, cy + 4);
      x.closePath();
      x.fill();
      if (G.audio.muted) {
        x.beginPath();
        x.moveTo(cx + 5, cy - 5); x.lineTo(cx + 12, cy + 5);
        x.moveTo(cx + 12, cy - 5); x.lineTo(cx + 5, cy + 5);
        x.stroke();
      } else {
        x.beginPath();
        x.arc(cx + 2, cy, 6, -0.8, 0.8);
        x.stroke();
        x.beginPath();
        x.arc(cx + 2, cy, 11, -0.8, 0.8);
        x.stroke();
      }
    }
    x.restore();
  }

  function drawCard(x, c) {
    const a = M.easeInOut(M.clamp(c.a, 0, 1));
    const im = typeof c.img === 'string' ? G.art.get(c.img) : c.img;
    x.save();
    x.fillStyle = 'rgba(10,12,11,' + (0.62 * a) + ')';
    x.fillRect(0, 0, G.W, G.H);
    if (im) {
      const k = Math.min(520 / im.naturalWidth, 380 / im.naturalHeight);
      const w = im.naturalWidth * k, h = im.naturalHeight * k;
      x.globalAlpha = a;
      x.translate(G.W / 2, G.H / 2 - 40 + (1 - a) * 16);
      x.rotate(-0.02);
      x.shadowColor = 'rgba(0,0,0,0.5)';
      x.shadowBlur = 24;
      x.drawImage(im, -w / 2, -h / 2, w, h);
      x.shadowBlur = 0;
    }
    x.restore();
    if (c.t > 1.2 && !c.closing) {
      x.save();
      x.globalAlpha = a * (0.5 + 0.3 * Math.sin(c.t * 2.5));
      T.label(x, G.touch ? 'Tap to put it back' : 'Click or press E to put it back', G.W / 2, G.H - 118, { size: 11, align: 'center', color: C.bone });
      x.restore();
    }
  }

  // The hold-to-use action: a stitched ring that fills with warm light while held.
  function drawAction(x, act, hover) {
    const r = HUD.action, cx = r.x + r.w / 2, cy = r.y + r.h / 2 - 8, rad = 25;
    const f = act.fill || 0;
    x.save();
    x.globalAlpha = (act.appear == null ? 1 : act.appear) * (hover || f > 0.05 ? 1 : 0.72);
    x.fillStyle = 'rgba(14,16,15,0.45)';
    x.beginPath();
    x.arc(cx, cy, rad + 5, 0, M.TAU);
    x.fill();
    if (f > 0.01) {
      const g = x.createRadialGradient(cx, cy, 2, cx, cy, rad);
      g.addColorStop(0, M.rgba(C.warm, 0.85 * f));
      g.addColorStop(1, M.rgba(C.ochre, 0.25 * f));
      x.fillStyle = g;
      x.beginPath();
      x.arc(cx, cy, rad, 0, M.TAU);
      x.fill();
    }
    // stitched ring
    x.strokeStyle = C.bone;
    x.lineWidth = 1.6;
    x.lineCap = 'round';
    const n = 18;
    for (let i = 0; i < n; i++) {
      const a0 = i / n * M.TAU + (act.t || 0) * 0.2, a1 = a0 + M.TAU / n * 0.55;
      x.beginPath();
      x.arc(cx, cy, rad, a0, a1);
      x.stroke();
    }
    // a small spool of thread
    x.fillStyle = C.bone;
    x.fillRect(cx - 9, cy - 11, 18, 3);
    x.fillRect(cx - 9, cy + 8, 18, 3);
    x.strokeStyle = C.oxbloodLight;
    x.lineWidth = 2;
    x.beginPath();
    for (let i = 0; i < 4; i++) { x.moveTo(cx - 6, cy - 6 + i * 4); x.lineTo(cx + 6, cy - 4 + i * 4); }
    x.stroke();
    x.shadowColor = 'rgba(0,0,0,0.7)';
    x.shadowBlur = 6;
    T.label(x, act.label, cx, cy + rad + 22, { size: 11, align: 'center', color: C.tan, track: 1.6 });
    if (!G.touch) T.label(x, 'hold ' + (act.keyName || ''), cx, cy + rad + 38, { size: 10, align: 'center', color: 'rgba(237,233,226,0.6)', track: 1.4 });
    x.restore();
  }

  // Upright phones: the stage is turned sideways; this note sits upright in the space below it.
  ui.drawTurnNote = function (x, v) {
    const band = v.ch - (v.ox + G.W * v.s);
    if (band < 34) return;
    const cy = v.ch - band / 2;
    const text = 'TURN YOUR PHONE SIDEWAYS', track = 1.6, r = 7, gap = 12;
    x.save();
    x.globalAlpha = 0.8;
    x.fillStyle = C.tan;
    x.font = '700 12px ' + G.FONT_SANS;
    x.textBaseline = 'middle';
    // measure first, so the arrow sits just before the words and the two are centred together
    let tw = -track;
    for (const ch of text) tw += x.measureText(ch).width + track;
    const left = v.cw / 2 - (2 * r + gap + tw) / 2;
    T.tracked(x, text, left + 2 * r + gap, cy, track, 'left');
    // a small turning arrow
    x.strokeStyle = C.tan;
    x.lineWidth = 1.5;
    x.beginPath();
    const ax = left + r;
    x.arc(ax, cy, r, -Math.PI * 0.9, Math.PI * 0.55);
    x.stroke();
    x.beginPath();
    x.moveTo(ax + r * Math.cos(Math.PI * 0.55) - 4, cy + r * Math.sin(Math.PI * 0.55) - 1);
    x.lineTo(ax + r * Math.cos(Math.PI * 0.55), cy + r * Math.sin(Math.PI * 0.55));
    x.lineTo(ax + r * Math.cos(Math.PI * 0.55) + 1, cy + r * Math.sin(Math.PI * 0.55) - 5);
    x.stroke();
    x.restore();
  };

  ui.draw = function (x) {
    // NPC speech
    for (const b of ui.bubbles) {
      const a = M.clamp(b.t / 0.4, 0, 1) * M.clamp((b.dur - b.t) / 0.6, 0, 1);
      const p = b.anchor();
      x.save();
      x.globalAlpha = a;
      x.font = 'italic 22px ' + G.FONT_SERIF;
      x.textAlign = 'center';
      x.textBaseline = 'alphabetic';
      const w = x.measureText(b.text).width;
      const bx = M.clamp(p.x, w / 2 + 30, G.W - w / 2 - 30);
      x.fillStyle = 'rgba(19,23,21,0.62)';
      x.fillRect(bx - w / 2 - 14, p.y - 30, w + 28, 40);
      x.fillStyle = '#efe7d8';
      x.fillText(b.text, bx, p.y - 3);
      x.restore();
    }

    // thought line
    const L = ui.line;
    if (L && L.t > 0) {
      const a = M.clamp(L.t / 0.5, 0, 1) * M.clamp((L.dur - L.t) / 0.7, 0, 1);
      x.save();
      x.font = 'italic 30px ' + G.FONT_SERIF;
      const lines = T.wrap(x, L.text, 900);
      const base = G.H - 64 - (lines.length - 1) * 36;
      const g = x.createLinearGradient(0, base - 90, 0, G.H);
      g.addColorStop(0, 'rgba(12,14,13,0)');
      g.addColorStop(0.55, 'rgba(12,14,13,0.5)');
      g.addColorStop(1, 'rgba(12,14,13,0.62)');
      x.globalAlpha = a;
      x.fillStyle = g;
      x.fillRect(0, base - 90, G.W, G.H - base + 90);
      x.textAlign = 'center';
      x.textBaseline = 'alphabetic';
      x.shadowColor = 'rgba(0,0,0,0.6)';
      x.shadowBlur = 10;
      x.fillStyle = C.bone;
      lines.forEach((ln, i) => x.fillText(ln, G.W / 2, base + i * 36));
      x.restore();
    }

    // hint
    if (ui.hintA > 0.01 && ui.hintText) {
      x.save();
      x.globalAlpha = ui.hintA * 0.95;
      x.shadowColor = 'rgba(0,0,0,0.7)';
      x.shadowBlur = 8;
      T.label(x, ui.hintText, G.W / 2, G.H - 22, { size: 13, align: 'center', color: C.tan });
      x.restore();
    }

    if (ui.hud) {
      x.save();
      x.globalAlpha = 0.7;
      x.shadowColor = 'rgba(0,0,0,0.6)';
      x.shadowBlur = 6;
      T.label(x, ui.label, 34, 42, { size: 13 });
      x.restore();
      drawIcon(x, 'sound', ui.hudHover === 'sound');
      drawIcon(x, 'pause', ui.hudHover === 'pause');
      if (ui.action) drawAction(x, ui.action, ui.hudHover === 'action');
    }

    if (ui.card) drawCard(x, ui.card);

    if (ui.menu) {
      x.save();
      x.fillStyle = 'rgba(14,16,15,0.84)';
      x.fillRect(0, 0, G.W, G.H);
      T.label(x, 'Paused', G.W / 2, 236, { size: 14, align: 'center' });
      const rects = menuRects();
      ui.menu.forEach((m, i) => {
        const r = rects[i];
        const sel = i === ui.menuSel;
        x.font = 'italic 30px ' + G.FONT_SERIF;
        x.textAlign = 'center';
        x.fillStyle = sel ? C.tan : C.bone;
        const label = typeof m.label === 'function' ? m.label() : m.label;
        x.fillText(label, G.W / 2, r.y + 32);
        if (sel) {
          const w = x.measureText(label).width;
          G.paint.whipstitch(x, G.W / 2 - w / 2, r.y + 42, G.W / 2 + w / 2, r.y + 42, { color: 'rgba(214,186,147,0.8)', gap: 8, len: 5 });
        }
      });
      x.restore();
    }
  };

  // ------------------------------------------------------------ transitions
  const fx = (G.fx = { active: null });

  // Tear the current page away and reveal the next scene beneath it.
  fx.tear = function (swap, o) {
    o = o || {};
    // a fade still on its way to switching: the newer destination wins
    if (fx.active && fx.active.kind === 'dip' && !fx.active.swapped) { fx.active.swap = swap; return; }
    if (fx.active) { swap(); return; }
    const snap = G.snapshot();
    const r = M.rng((Math.random() * 1e9) | 0);
    const edge = [];
    for (let y = -20; y <= G.H + 20; y += 16) edge.push([r.range(-26, 26) + (y / G.H) * (o.slant == null ? 90 : o.slant), y]);
    fx.active = { kind: G.reducedMotion ? 'fade' : 'tear', t: 0, dur: o.dur || 1.15, snap, edge };
    if (G.audio) G.audio.tear(fx.active.dur * 0.8);
    swap();
  };

  // Fade through a colour; swap happens at the midpoint.
  fx.fade = function (swap, o) {
    o = o || {};
    // already fading and not yet switched: the newer destination wins
    if (fx.active && fx.active.kind === 'dip' && !fx.active.swapped) { fx.active.swap = swap; return; }
    if (fx.active) { swap(); return; }
    fx.active = { kind: 'dip', t: 0, dur: o.dur || 1.6, color: o.color || '#0e100f', swap, swapped: false };
  };

  fx.update = function (dt) {
    const a = fx.active;
    if (!a) return;
    a.t += dt;
    if (a.kind === 'dip' && !a.swapped && a.t >= a.dur / 2) { a.swapped = true; a.swap(); }
    if (a.t >= a.dur) fx.active = null;
  };

  fx.draw = function (x) {
    const a = fx.active;
    if (!a) return;
    const u = M.clamp(a.t / a.dur, 0, 1);
    if (a.kind === 'dip') {
      x.save();
      x.globalAlpha = u < 0.5 ? M.easeInOut(u * 2) : 1 - M.easeInOut((u - 0.5) * 2);
      x.fillStyle = a.color;
      x.fillRect(0, 0, G.W, G.H);
      x.restore();
      return;
    }
    const s = a.snap;
    if (a.kind === 'fade') {
      x.save();
      x.globalAlpha = 1 - u;
      x.drawImage(s.c, s.sx, s.sy, s.sw, s.sh, 0, 0, G.W, G.H);
      x.restore();
      return;
    }
    // tear: edge sweeps left to right; the old page stays to its right
    const e = M.easeInOut(u);
    const off = M.lerp(-160, G.W + 140, e);
    x.save();
    x.beginPath();
    x.moveTo(G.W + 400, -40);
    for (const p of a.edge) x.lineTo(p[0] + off, p[1]);
    x.lineTo(G.W + 400, G.H + 40);
    x.closePath();
    // shadow cast onto the new page
    x.save();
    x.shadowColor = 'rgba(0,0,0,0.55)';
    x.shadowBlur = 24;
    x.shadowOffsetX = -8;
    x.fillStyle = '#d9d0c1';
    x.fill();
    x.restore();
    x.clip();
    x.drawImage(s.c, s.sx, s.sy, s.sw, s.sh, 0, 0, G.W, G.H);
    x.restore();
    // torn fibres along the edge
    x.save();
    x.strokeStyle = 'rgba(232,224,210,0.9)';
    x.lineWidth = 3;
    x.beginPath();
    a.edge.forEach((p, i) => { const px = p[0] + off - 2, py = p[1]; if (i) x.lineTo(px, py); else x.moveTo(px, py); });
    x.stroke();
    x.strokeStyle = 'rgba(255,250,240,0.35)';
    x.lineWidth = 1;
    x.beginPath();
    a.edge.forEach((p, i) => { const px = p[0] + off - 5 + Math.sin(i * 7.1) * 2, py = p[1]; if (i) x.lineTo(px, py); else x.moveTo(px, py); });
    x.stroke();
    x.restore();
  };
})();
