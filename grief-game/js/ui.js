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
  ui.clear = function () { ui.line = null; ui.queue = []; ui.bubbles = []; ui.hint(null); };

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
    pause: { x: G.W - 108, y: 18, w: 36, h: 36 }
  };
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
    if (!ui.hud) return;
    if (inRect(HUD.sound, inp.x, inp.y)) ui.hudHover = 'sound';
    else if (inRect(HUD.pause, inp.x, inp.y)) ui.hudHover = 'pause';
    if (inp.pressed && ui.hudHover) {
      if (ui.hudHover === 'sound') ui.toggleSound(); else ui.openMenu();
      inp.consume();
    }
    if (inp.hit.pause && G.scene && G.scene.pausable !== false) { ui.openMenu(); inp.hit = {}; }
  };

  ui.update = function (dt) {
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
    }

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
