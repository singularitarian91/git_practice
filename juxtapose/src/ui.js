// HUD + menus (DOM overlay).
import * as THREE from 'three';
import { PROPS, PROP_INFO, propIconSVG, TUNE, LAYERS } from './config.js';
import { MEMORIES, KEEPSAKES, WHIMS, WHIM_CATS, SCRAPS } from './meta.js';
import { drawPainting } from './painting.js';
import { takeCandidate } from './properties.js';
import { LINES } from './narrator.js';
import { RANKS, rankOf, rankProgress, TREE, treePoints, canBuy, buy } from './knots.js';
import { REGIONS } from './level.js';

const $ = (s) => document.querySelector(s);
const ROMAN = ['I', 'II', 'III', 'IV', 'V'];
const lockSVG = (s = 12) => `<svg viewBox="0 0 16 16" width="${s}" height="${s}" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" aria-hidden="true"><rect x="3.5" y="7" width="9" height="7" rx="1.5"/><path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2"/></svg>`;
const catSVG = (cat, s = 16) => `<svg viewBox="0 0 24 24" width="${s}" height="${s}" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${(WHIM_CATS[cat] || WHIM_CATS.blade).icon}</svg>`;
const notches = (n, on = true) => `<span class="notches">${Array.from({ length: n }, () => `<i class="notch${on ? ' on' : ''}"></i>`).join('')}</span>`;
const _v = new THREE.Vector3();
const _p = new THREE.Vector3();

// Screen-space placement for a world point: on screen, or pinned to the edge.
// Returns { x, y, on, ang } in HUD pixels (ang: degrees clockwise from "up").
// m = { x, top, bottom }: the inset box edge markers are pinned to.
function placeOnScreen(cam, world, W, H, m) {
  const c = _v.copy(world).applyMatrix4(cam.matrixWorldInverse);
  let dx, dy;
  if (c.z < -0.05) {
    const p = _p.copy(world).project(cam);
    dx = p.x * W / 2; dy = -p.y * H / 2;
    if (Math.abs(dx) < W / 2 - m.x && dy > -(H / 2 - m.top) && dy < H / 2 - m.bottom) return { x: W / 2 + dx, y: H / 2 + dy, on: true, ang: 0 };
  } else {
    // behind the camera: keep its left/right, and let "behind" read as "below"
    dx = c.x; dy = -c.y + Math.abs(c.z) * 0.15;
    if (Math.abs(dx) + Math.abs(dy) < 1e-3) dy = 1;
  }
  const hw = W / 2 - m.x, hh = dy < 0 ? H / 2 - m.top : H / 2 - m.bottom;
  const s = Math.min(hw / Math.max(1e-6, Math.abs(dx)), hh / Math.max(1e-6, Math.abs(dy)));
  let x = W / 2 + dx * s;
  const y = H / 2 + dy * s;
  // the bottom corners belong to the subtitles and the gun: keep "behind you" in the middle band
  if (dy > 0 && y >= H - m.bottom - 1) x = Math.min(W / 2 + W * 0.24, Math.max(W / 2 - W * 0.24, x));
  return { x, y, on: false, ang: Math.atan2(dx, -dy) * 180 / Math.PI };
}
const THREAT_BOX = { x: 64, top: 96, bottom: 190 };
const WAYPOINT_BOX = { x: 48, top: 90, bottom: 140 };

export class UI {
  constructor(game) {
    this.game = game;
    this.app = $('#app');
    this.hud = $('#hud');
    this.el = {
      layer: $('#layer-name'), objective: $('#objective'),
      lucid: $('#lucid'), lucidFill: $('.lucid-fill'), lucidVal: $('.lucid-val'), iris: $('#lucid-eye .iris'), pops: $('#lucid-pops'),
      boss: $('#boss'), bossFill: $('.boss-fill'), bossText: $('.boss-text'), bossEcho: $('.boss-echo'),
      cross: $('#crosshair'), hurtRing: $('#hurt-ring'), target: $('#target'), tName: $('.t-name'), tProps: $('.t-props'), tHint: $('.t-hint'),
      selfChips: $('#self-chips'), hp: $('#hp'), hpFill: $('.hp-fill'), hpTrail: $('.hp-trail'), hpHeal: $('.hp-heal'), hpVal: $('.hp-val'),
      ribbon: $('#ribbon'), rounds: $('#rounds'), ammo: $('#ammo'), vIcon: $('.v-icon'), vName: $('.v-name'), vCount: $('.v-count'),
      toasts: $('#toasts'), wheel: $('#wheel'), fade: $('#fade'), card: $('#card'),
      armor: $('.hp-armor'), reverie: $('#reverie'), rvLevel: $('#reverie .rv-level'), rvMarks: $('#reverie .rv-marks'), rvPips: $('.rv-pips'), dbPrompt: $('#db-prompt'),
      lore: $('#lore-card'), dmgDirs: $('#dmg-dirs'), threats: $('#threats'), waypoint: $('#waypoint'), wpDist: $('#waypoint .wp-dist'), wpArrow: $('#waypoint .wp-arrow'),
    };
    this.hudScale = 1;
    this.focusMem = {};
    this.lastTarget = null;
    this.lastKey = '';
    this.hmLast = {};
    this.stagSeen = new WeakSet();
    this.threatPool = [];
    this.buildRibbon();
    this.buildAmmo();
    this.buildPropTable();
    this.buildWheel();
    this.buildDmgDirs();
    this.wheelOpen = false;
    this.wheelSel = 0;
    // journal tabs: click, or the arrow keys once a tab has focus
    const tabs = [...document.querySelectorAll('#journal .tab')];
    for (const t of tabs) {
      t.addEventListener('click', () => this.journalTab(t.dataset.tab));
      t.addEventListener('keydown', (e) => {
        if (e.code !== 'ArrowLeft' && e.code !== 'ArrowRight') return;
        e.preventDefault(); e.stopPropagation();
        const n = tabs[(tabs.indexOf(t) + (e.code === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length];
        n.focus(); this.journalTab(n.dataset.tab);
      });
    }
  }

  // -------------------------------------------------------------- screens
  visibleScreen() { return document.querySelector('.screen:not([hidden])'); }
  show(id) {
    if (id === 'help') id = 'controls';
    const cur = this.visibleScreen();
    if (cur && cur.id !== id && cur.contains(document.activeElement)) this.focusMem[cur.id] = document.activeElement;
    for (const s of document.querySelectorAll('.screen')) s.hidden = s.id !== id;
    this.syncModal();
    const scr = id && document.getElementById(id);
    if (!scr) return;
    let f = this.focusMem[id];
    if (!(f && scr.contains(f) && f.offsetParent !== null && !f.disabled)) f = null;
    if (!f && id === 'title') { const t = this.game.meta.uiPref('titleFocus'); f = t && document.getElementById(t); }
    if (!f) f = scr.querySelector('button.primary') || scr.querySelector('button');
    if (f) f.focus({ preventScroll: true });
    this.settle(scr);
  }
  // Entrance animations are decoration: if frames are starved (a busy GPU, a
  // throttled tab) and they haven't really run, finish them so a menu is never
  // left half-faded. In a healthy browser this finds nothing to do.
  settle(root, after = 650) {
    const t0 = performance.now();
    setTimeout(() => {
      const waited = performance.now() - t0;
      for (const a of root.getAnimations({ subtree: true })) {
        const end = a.effect?.getComputedTiming().endTime;
        if (!isFinite(end) || a.playState !== 'running') continue;
        if (a.startTime === null || (a.currentTime ?? 0) + 250 < waited) a.finish();
      }
    }, after);
  }
  hideScreens() {
    for (const s of document.querySelectorAll('.screen')) s.hidden = true;
    this.syncModal();
    const a = document.activeElement;
    if (a && a !== document.body && a.closest && a.closest('.screen')) a.blur();
  }
  syncModal() {
    const s = this.visibleScreen();
    this.app.classList.toggle('modal-open', !!(s && s.classList.contains('modal')));
  }
  setHud(on) {
    this.hud.hidden = !on;
    if (on) this.clarity(this.game.meta?.data.clarity || 0, true);
    if (!on) { this.el.waypoint.hidden = true; for (const t of this.threatPool) t.el.hidden = true; }
  }
  setHudScale(s) {
    this.hudScale = s;
    this.hud.style.zoom = String(s);
  }

  // Arrow-key focus movement inside whatever screen is open. Returns true if handled.
  menuKey(e, scr) {
    const k = e.code;
    if (k !== 'ArrowUp' && k !== 'ArrowDown' && k !== 'ArrowLeft' && k !== 'ArrowRight') return false;
    const a = document.activeElement;
    const horiz = k === 'ArrowLeft' || k === 'ArrowRight';
    if (scr.id === 'whims' || (a && a.closest && a.closest('.tabs'))) return false; // they handle their own
    if (horiz && a && a.tagName === 'INPUT' && a.type === 'range') return false;          // nudging a slider
    if (horiz && a && a.tagName === 'SELECT') return false;
    const list = [...scr.querySelectorAll('button, input, select')].filter((el) => !el.disabled && el.offsetParent !== null);
    if (!list.length) return false;
    const i = list.indexOf(a);
    const step = k === 'ArrowUp' || k === 'ArrowLeft' ? -1 : 1;
    const next = i < 0 ? list[0] : list[(i + step + list.length) % list.length];
    e.preventDefault();
    next.focus({ preventScroll: false });
    return true;
  }

  // -------------------------------------------------------------- builders
  buildRibbon() {
    this.el.ribbon.innerHTML = PROPS.map((p) => `<div class="slot" data-p="${p}" style="color:${PROP_INFO[p].color}" title="${PROP_INFO[p].label}"><span class="n"></span>${propIconSVG(p, 22)}<span class="c">0</span><span class="lk">${lockSVG(12)}</span></div>`).join('');
    this.slots = [...this.el.ribbon.children].map((s) => ({ s, p: s.dataset.p, n: s.querySelector('.n'), c: s.querySelector('.c'), key: '' }));
  }
  buildAmmo() {
    this.el.ammo.innerHTML = Array.from({ length: TUNE.magazine }, () => '<div class="pip"></div>').join('');
    this.pips = [...this.el.ammo.children];
  }
  buildPropTable() {
    const rows = PROPS.map((p) => {
      const I = PROP_INFO[p];
      return `<tr><td style="color:${I.color}">${propIconSVG(p, 18)} <span class="pname">${I.label}</span></td><td>${I.source}</td><td>${I.target}</td><td>${I.self}</td><td>${I.rounds}</td></tr>`;
    }).join('');
    $('#prop-table').innerHTML = `<table><thead><tr><th>Property</th><th>Take it from</th><th>Given to a thing</th><th>Given to yourself</th><th>Loaded into rounds</th></tr></thead><tbody>${rows}</tbody></table>`;
  }
  buildWheel() {
    const N = PROPS.length, C = 190, R0 = 84, R1 = 184, gap = 0.014;
    const pt = (r, a) => `${(C + Math.cos(a) * r).toFixed(2)} ${(C + Math.sin(a) * r).toFixed(2)}`;
    let html = '';
    PROPS.forEach((p, i) => {
      const a0 = ((i - 0.5) / N) * Math.PI * 2 - Math.PI / 2 + gap, a1 = ((i + 0.5) / N) * Math.PI * 2 - Math.PI / 2 - gap;
      const c = PROP_INFO[p].color;
      html += `<path class="wedge" data-i="${i}" style="--c:${c}" d="M${pt(R1, a0)} A${R1} ${R1} 0 0 1 ${pt(R1, a1)} L${pt(R0, a1)} A${R0} ${R0} 0 0 0 ${pt(R0, a0)} Z"/>`;
      html += `<path class="wedge-edge" data-i="${i}" style="--c:${c}" d="M${pt(R1 + 5, a0 + 0.03)} A${R1 + 5} ${R1 + 5} 0 0 1 ${pt(R1 + 5, a1 - 0.03)}"/>`;
    });
    html += `<circle class="wheel-hub" cx="${C}" cy="${C}" r="${R0 - 6}"/>`;
    const svg = this.el.wheel.querySelector('.wheel-svg');
    svg.innerHTML = html;
    this.wedges = [...svg.querySelectorAll('.wedge')];
    this.wedgeEdges = [...svg.querySelectorAll('.wedge-edge')];
  }
  buildDmgDirs() {
    // an arc at the top of a 220 box; rotated to face wherever the hurt came from
    const arc = 'M66.2 20.1 A100 100 0 0 1 153.8 20.1';
    this.dd = [];
    for (let i = 0; i < 5; i++) {
      const el = document.createElement('div');
      el.className = 'dd';
      el.innerHTML = `<svg viewBox="0 0 220 220"><path class="ar-under" d="${arc}"/><path class="ar" d="${arc}"/><path class="tip" d="M102 7 L110 -4 L118 7 Z"/></svg>`;
      this.el.dmgDirs.appendChild(el);
      this.dd.push({ el, t: 0, from: null, guard: false });
    }
  }

  chip(p, extra = '', innate = false) {
    return `<span class="chip${innate ? ' innate' : ''}" style="color:${PROP_INFO[p].color}">${propIconSVG(p, 14)}<span style="color:var(--bone)">${PROP_INFO[p].label}</span>${extra}</span>`;
  }

  toast(text, kind = '') {
    const d = document.createElement('div');
    d.className = 'toast ' + kind;
    d.textContent = text;
    this.el.toasts.appendChild(d);
    while (this.el.toasts.children.length > 4) this.el.toasts.firstChild.remove();
    setTimeout(() => d.remove(), 3300);
  }
  lucidPopup(text) {
    const d = document.createElement('div');
    d.className = 'lpop'; d.textContent = text;
    this.el.pops.appendChild(d);
    setTimeout(() => d.remove(), 1400);
  }

  // -------------------------------------------------------------- combat feedback
  // kind: 'hit' | 'big' | 'kill' | 'break' | 'deflect'
  hitMarker(kind = 'hit') {
    const c = this.el.cross;
    const base = kind === 'big' ? 'hit' : kind;
    const now = performance.now();
    if (now - (this.hmLast[kind] || 0) < 40) return; // a split volley reads as one hit
    this.hmLast[kind] = now;
    if (base === 'hit') c.classList.toggle('hm-big', kind === 'big');
    const cls = `hm-${base}-on`;
    c.classList.remove(cls); void c.offsetWidth; c.classList.add(cls);
  }
  // enemies.js and boss.js call this on every blow that lands
  hitmarker(big) { this.hitMarker(big ? 'big' : 'hit'); }

  hurtDirection(from, type) {
    if (!from || !this.game.player) {
      const r = this.el.hurtRing;
      r.style.background = 'radial-gradient(circle, transparent 60%, rgba(220,40,60,0.5))';
      r.style.maskImage = r.style.webkitMaskImage = 'radial-gradient(circle, transparent 62%, #000 64%, #000 70%, transparent 72%)';
      r.style.opacity = 1;
      clearTimeout(this._hr);
      this._hr = setTimeout(() => { r.style.opacity = 0; }, 350);
      return;
    }
    const guard = type === 'guard';
    // a second blow from about the same place refreshes its arc; otherwise take the oldest
    let d = this.dd.find((x) => x.t > 0 && x.from && x.from.distanceToSquared(from) < 6);
    if (!d) d = this.dd.reduce((a, b) => (a.t <= b.t ? a : b));
    d.from = d.from ? d.from.copy(from) : from.clone();
    d.t = 1.4; d.guard = guard;
    d.el.classList.toggle('guard', guard);
  }
  updateDmgDirs(dt) {
    const pl = this.game.player;
    for (const d of this.dd) {
      if (d.t <= 0) continue;
      d.t -= dt;
      if (d.t <= 0 || !pl) { d.t = 0; d.el.style.opacity = '0'; continue; }
      const y = pl.camYaw;
      const dx = d.from.x - pl.pos.x, dz = d.from.z - pl.pos.z;
      const fwd = dx * Math.sin(y) + dz * Math.cos(y);
      const right = -dx * Math.cos(y) + dz * Math.sin(y);
      const ang = Math.atan2(right, fwd) * 180 / Math.PI;
      const age = 1.4 - d.t;
      d.el.style.opacity = Math.min(1, d.t / 0.55, age / 0.05).toFixed(3);
      d.el.style.transform = `rotate(${ang.toFixed(1)}deg) scale(${(1.06 - Math.min(age, 0.15) * 0.4).toFixed(3)})`;
    }
  }

  bossBlocked() {
    this.el.boss.classList.remove('blocked'); void this.el.boss.offsetWidth; this.el.boss.classList.add('blocked');
  }
  echo(props) {
    this.el.bossEcho.innerHTML = props.map((p) => this.chip(p)).join('') || '<span class="fine">(it has nothing of yours yet)</span>';
  }
  pickupProp(p) {
    const s = this.el.ribbon.querySelector(`[data-p="${p}"]`);
    if (s) { s.classList.remove('flash'); void s.offsetWidth; s.classList.add('flash'); }
    this.toast(`Took ${PROP_INFO[p].label.toLowerCase()} (+${TUNE.takeCharges})`, 'good');
  }

  card(num, name, sub) {
    const c = this.el.card;
    c.hidden = false;
    c.querySelector('.card-num').textContent = num;
    c.querySelector('.card-name').textContent = name;
    c.querySelector('.card-sub').textContent = sub;
    c.style.animation = 'none'; void c.offsetWidth; c.style.animation = '';
    clearTimeout(this._card);
    this._card = setTimeout(() => { c.hidden = true; }, 4300);
  }

  fade(v, dur = 0.6) {
    const f = this.el.fade;
    f.style.transition = `opacity ${dur}s`;
    f.style.opacity = v;
    if (dur === 0) void f.offsetWidth; // commit it, so a following fade starts from here
  }

  // -------------------------------------------------------------- wheel
  openWheel() {
    const g = this.game;
    this.wheelOpen = true;
    this.el.wheel.hidden = false;
    this.hud.classList.add('wheel-open');
    const avail = g.player.available;
    this.wheelSel = g.player.selected;
    const ring = this.el.wheel.querySelector('.wheel-ring');
    ring.innerHTML = PROPS.map((p, i) => {
      const a = (i / PROPS.length) * Math.PI * 2 - Math.PI / 2;
      const x = 190 + Math.cos(a) * 134, y = 190 + Math.sin(a) * 134;
      const locked = !avail.includes(p);
      const c = g.player.chargesOf(p);
      const tail = locked ? `<span class="lk">${lockSVG(11)}</span>` : `<span class="mono">${c === Infinity ? '∞' : c}</span>`;
      return `<div class="wslot${locked ? ' locked' : ''}" data-i="${i}" style="left:${x}px;top:${y}px;color:${PROP_INFO[p].color}">${propIconSVG(p, 26)}${tail}</div>`;
    }).join('');
    this.wslots = [...ring.children];
    PROPS.forEach((p, i) => this.wedges[i].classList.toggle('locked', !avail.includes(p)));
    this.wheelVec = new THREE.Vector2();
    this.wheelHover = -1;
    this.updateWheel(0, 0);
  }
  updateWheel(dx, dy) {
    const g = this.game;
    this.wheelVec.x += dx; this.wheelVec.y += dy;
    if (this.wheelVec.length() > 60) this.wheelVec.setLength(60);
    const avail = g.player.available;
    let hover = PROPS.indexOf(avail[this.wheelSel]);
    if (this.wheelVec.length() > 20) {
      const a = Math.atan2(this.wheelVec.y, this.wheelVec.x) + Math.PI / 2;
      hover = ((Math.round(a / (Math.PI * 2) * PROPS.length) % PROPS.length) + PROPS.length) % PROPS.length;
      const ai = avail.indexOf(PROPS[hover]);
      if (ai >= 0) this.wheelSel = ai;
    }
    if (hover === this.wheelHover) return;
    this.wheelHover = hover;
    const selP = avail[this.wheelSel];
    this.wslots.forEach((s, i) => s.classList.toggle('sel', i === hover || PROPS[i] === selP));
    this.wedges.forEach((w, i) => w.classList.toggle('sel', i === hover));
    this.wedgeEdges.forEach((w, i) => w.classList.toggle('sel', i === hover));
    // the hovered property, and what each key would do with it
    const p = PROPS[hover] || selP;
    const I = PROP_INFO[p];
    const locked = !avail.includes(p);
    const c = g.player.chargesOf(p);
    const w = this.el.wheel;
    const name = w.querySelector('.wc-name');
    name.textContent = I.label; name.style.color = I.color;
    w.querySelector('.wc-count').textContent = locked ? 'not yet dreamt' : c === Infinity ? '∞ charges' : `${c} charge${c === 1 ? '' : 's'}`;
    const cardEl = w.querySelector('.wheel-card');
    cardEl.style.setProperty('--c', I.color);
    cardEl.classList.toggle('locked', locked);
    w.querySelector('.wc-desc').textContent = locked ? 'Not in the dream yet. A memory will bring it.' : I.blurb;
    const off = locked || c <= 0 ? ' class="off"' : '';
    w.querySelector('.wc-acts').innerHTML = `<dt><kbd>Q</kbd></dt><dd>Take it from a ${I.source.toLowerCase()}.</dd>`
      + `<dt${off}><kbd>E</kbd></dt><dd${off}>${I.target}</dd>`
      + `<dt${off}><kbd>Z</kbd></dt><dd${off}>${I.self}</dd>`
      + `<dt${off}><kbd>G</kbd></dt><dd${off}>${I.rounds}</dd>`;
  }
  closeWheel() {
    this.wheelOpen = false;
    this.el.wheel.hidden = true;
    this.hud.classList.remove('wheel-open');
    this.game.player.select(this.wheelSel);
  }

  // -------------------------------------------------------------- per frame
  update(dt) {
    const g = this.game;
    const pl = g.player;
    if (!pl || this.hud.hidden) return;
    this.teach(pl);
    // lucidity
    const L = g.lucidity.display;
    this.el.lucidFill.style.width = L.toFixed(1) + '%';
    this.el.lucidVal.textContent = Math.round(L);
    this.el.iris.setAttribute('r', (2.5 + L / 100 * 6).toFixed(2));
    this.el.lucid.classList.toggle('warn', L >= 75);
    this.el.lucid.classList.toggle('crit', L >= 90);
    // layer + objective
    this.el.objective.textContent = g.level?.objective || '';
    this.updateHealth(pl, dt);
    // self properties
    const selfKey = [...pl.self].map(([p, t]) => p + Math.ceil(t)).join() + (pl.drowsy > 0 ? 'd' : '') + (pl.disarmed > 0 ? 'x' : '');
    if (selfKey !== this._selfKey) {
      this._selfKey = selfKey;
      let html = [...pl.self].map(([p, t]) => this.chip(p, `<span class="t">${Math.ceil(t)}s</span>`)).join('');
      if (pl.drowsy > 0) html += '<span class="chip">drowsy</span>';
      if (pl.disarmed > 0) html += '<span class="chip">hollow hands</span>';
      this.el.selfChips.innerHTML = html;
    }
    // ribbon: the number is the key that selects it
    const avail = pl.available;
    const sel = pl.selectedProp;
    for (const o of this.slots) {
      const ai = avail.indexOf(o.p);
      const locked = ai < 0;
      const c = pl.chargesOf(o.p);
      const key = `${ai}|${c}|${o.p === sel}`;
      if (key === o.key) continue;
      o.key = key;
      o.s.classList.toggle('locked', locked);
      o.s.classList.toggle('empty', !locked && c <= 0);
      o.s.classList.toggle('sel', o.p === sel);
      o.n.textContent = locked ? '' : ai < 10 ? String((ai + 1) % 10) : '';
      o.c.textContent = locked ? '' : c === Infinity ? '∞' : String(c);
      o.s.title = locked ? `${PROP_INFO[o.p].label}: not yet dreamt` : `${PROP_INFO[o.p].label} · from a ${PROP_INFO[o.p].source.toLowerCase()}`;
    }
    // gun
    this.pips.forEach((pp, i) => pp.classList.toggle('spent', i >= pl.ammo));
    this.el.ammo.classList.toggle('reloading', pl.reloadT > 0);
    const rkey = [...pl.roundProps].map(([p, n]) => p + n).join();
    if (rkey !== this._rkey) {
      this._rkey = rkey;
      this.el.rounds.innerHTML = [...pl.roundProps].map(([p, n]) => this.chip(p, `<span class="t">×${n}</span>`)).join('');
    }
    if (this._vsel !== sel + pl.chargesOf(sel)) {
      this._vsel = sel + pl.chargesOf(sel);
      this.el.vIcon.innerHTML = propIconSVG(sel, 24);
      this.el.vIcon.style.color = PROP_INFO[sel].color;
      this.el.vName.textContent = PROP_INFO[sel].label;
      this.el.vName.style.color = PROP_INFO[sel].color;
      const c = pl.chargesOf(sel);
      const more = this.game.meta.data.taught?.gives ? ' <kbd>Z</kbd> self <kbd>G</kbd> rounds' : '';
      this.el.vCount.innerHTML = c === Infinity ? '∞ charges · <kbd>E</kbd> give' + more
        : c <= 0 ? `none left · <kbd>Q</kbd> take from a ${PROP_INFO[sel].source.toLowerCase()}`
          : `${c} charge${c === 1 ? '' : 's'} · <kbd>E</kbd> give${more}`;
    }
    // target readout
    const t = pl.aimEntity;
    this.el.cross.classList.toggle('on-target', !!t);
    if (t && !t.dead && t.kind !== 'boss') {
      const key = t.id + [...t.props].join() + sel + pl.chargesOf(sel);
      if (key !== this.lastKey) {
        this.lastKey = key;
        this.el.target.hidden = false;
        this.el.tName.textContent = t.kind === 'enemy' ? 'Sleepwalker' : (t.name || '').replace('_', ' ').replace('BowlerHat', 'Bowler hat');
        this.el.tProps.innerHTML = [...t.props].map((p) => this.chip(p, '', t.innate.has(p))).join('');
        const cand = takeCandidate(t);
        const parts = [];
        if (cand) parts.push(`<kbd>Q</kbd> take <span style="color:${PROP_INFO[cand].color}">${PROP_INFO[cand].label.toLowerCase()}</span>`);
        if (pl.chargesOf(sel) > 0) parts.push(`<kbd>E</kbd> give <span style="color:${PROP_INFO[sel].color}">${PROP_INFO[sel].label.toLowerCase()}</span>`);
        this.el.tHint.innerHTML = parts.join(' &nbsp;·&nbsp; ');
      }
    } else if (!this.el.target.hidden) { this.el.target.hidden = true; this.lastKey = ''; }
    // boss
    const b = g.boss;
    if (b && !b.dead) {
      this.el.boss.hidden = false;
      this.el.bossFill.style.width = (b.hp / b.maxHp * 100).toFixed(1) + '%';
      const vul = b.vulnerable;
      this.el.boss.classList.toggle('watched', !vul);
      this.el.boss.classList.toggle('unwatched', vul);
      this.el.bossText.textContent = b.props.has('sleeping') ? 'Asleep: vulnerable' : vul ? 'Unwatched: vulnerable' : b.stare > 2.4 ? 'Watched. Look away!' : 'Watched: it cannot be hurt';
    } else this.el.boss.hidden = true;
    // combat feedback
    if (g.state === 'playing') {
      for (const e of g.entities) {
        if (e.kind !== 'enemy' && e.kind !== 'boss') continue;
        if (e.staggered > 0 && !e.dead) { if (!this.stagSeen.has(e)) { this.stagSeen.add(e); this.hitMarker('break'); } }
        else this.stagSeen.delete(e);
      }
    }
    this.updateDmgDirs(dt);
    const cam = g.render.camera;
    cam.updateMatrixWorld();
    const W = innerWidth / this.hudScale, H = innerHeight / this.hudScale;
    this.updateThreats(cam, W, H);
    this.updateWaypoint(cam, W, H);
  }

  // health: damage leaves a pale trail that drains after a beat; healing shows in teal first
  updateHealth(pl, dt) {
    const hp = Math.max(0, pl.hp);
    const k = Math.min(1, hp / pl.maxHp);
    if (this._hpPlayer !== pl) { this._hpPlayer = pl; this.fillK = this.trailK = this.healK = this.lastK = k; this.trailHold = 0; }
    if (k < this.lastK - 1e-4) {
      this.trailK = Math.max(this.trailK, this.fillK);
      this.trailHold = 0.5;
      this.fillK = Math.min(this.fillK, k);
      this.healK = Math.min(this.healK, k);
      if (this.lastK - k > 0.004) this.flashVal('hurt');
    } else if (k > this.lastK + 1e-4) {
      this.healK = k;
      if (k - this.lastK > 0.02) this.flashVal('healed');
    }
    this.lastK = k;
    if (this.fillK < k) this.fillK = Math.min(k, this.fillK + dt * 0.5);
    if (this.fillK > k) this.fillK = k;
    if (this.trailHold > 0) this.trailHold -= dt; else this.trailK = Math.max(this.fillK, this.trailK - dt * 0.55);
    if (this.healK < this.fillK) this.healK = this.fillK;
    this.el.hpFill.style.width = (this.fillK * 100).toFixed(2) + '%';
    this.el.hpTrail.style.width = (this.trailK * 100).toFixed(2) + '%';
    this.el.hpHeal.style.width = (this.healK * 100).toFixed(2) + '%';
    const txt = Math.ceil(hp) + (pl.armor > 0 ? ` +${Math.ceil(pl.armor)}` : '');
    if (this.el.hpVal.textContent !== txt) this.el.hpVal.textContent = txt;
    this.el.armor.style.width = Math.min(100, pl.armor / pl.maxHp * 100).toFixed(1) + '%';
    this.el.hp.classList.toggle('low', hp < pl.maxHp * 0.3);
    // reverie: a glass vessel, marked in focuses
    const rmax = this.game.run?.mods.reverieMax || 99;
    const n = Math.max(1, Math.round(rmax / 33));
    const rk = Math.min(1, pl.reverie / rmax);
    const y = 43.4 - rk * 30;
    if (Math.abs((this._rvY ?? -1) - y) > 0.05) { this._rvY = y; this.el.rvLevel.style.transform = `translate(0px, ${y.toFixed(2)}px)`; }
    if (this._rvN !== n) {
      this._rvN = n;
      let d = '';
      for (let i = 1; i < n; i++) { const my = (43.2 - (i / n) * 28.4).toFixed(1); d += `M8.6 ${my}h3.2`; }
      this.el.rvMarks.setAttribute('d', d);
      this.el.rvPips.innerHTML = '<i class="rv-pip"></i>'.repeat(n);
      this._rvOn = -1;
    }
    const on = Math.floor(pl.reverie / 33);
    if (this._rvOn !== on) { this._rvOn = on; [...this.el.rvPips.children].forEach((pp, i) => pp.classList.toggle('on', i < on)); }
    this.el.hp.classList.toggle('ready', on >= 1);
    this.el.dbPrompt.hidden = !pl.dbTarget;
  }
  flashVal(kind) {
    const v = this.el.hpVal;
    v.classList.remove('hurt', 'healed'); void v.offsetWidth; v.classList.add(kind);
    clearTimeout(this._hv);
    this._hv = setTimeout(() => v.classList.remove(kind), 260);
  }

  // Edge chevrons for attacks you can't see: a perilous lunge winding up, an orb
  // being readied, or an orb already on its way.
  updateThreats(cam, W, H) {
    const g = this.game, pl = g.player;
    const list = [];
    if (pl && !pl.dead && g.state === 'playing' && !this.wheelOpen) {
      for (const e of g.entities) {
        if (e.dead || e.kind !== 'enemy') continue;
        const peril = e.lunge && e.lunge.perilous && e.lunge.phase === 'wind';
        const orb = !peril && e.windup > 0 && e.canSee && !e.decoy;
        if (peril || orb) list.push({ pos: e.center(), kind: peril ? 'peril' : 'orb', d: e.obj.position.distanceTo(pl.pos) });
      }
      for (const p of g.projectiles.list) {
        if (p.type !== 'orb' || p.owner !== 'enemy') continue;
        const tx = pl.pos.x - p.pos.x, ty = pl.pos.y + 1.2 - p.pos.y, tz = pl.pos.z - p.pos.z;
        const d = Math.hypot(tx, ty, tz);
        if (d > 18 || tx * p.vel.x + ty * p.vel.y + tz * p.vel.z <= 0) continue;
        list.push({ pos: p.pos, kind: 'orb', d });
      }
      list.sort((a, b) => (a.kind === 'peril' ? 0 : 1) - (b.kind === 'peril' ? 0 : 1) || a.d - b.d);
    }
    let n = 0;
    for (const t of list) {
      if (n >= 6) break;
      const s = placeOnScreen(cam, t.pos, W, H, THREAT_BOX);
      if (s.on) continue;
      const it = this.threatEl(n++);
      if (it.kind !== t.kind) { it.kind = t.kind; it.el.className = 'threat ' + t.kind; }
      it.el.hidden = false;
      it.el.style.transform = `translate(${s.x.toFixed(1)}px, ${s.y.toFixed(1)}px)`;
      it.rot.setAttribute('transform', `rotate(${s.ang.toFixed(1)})`);
    }
    for (let i = n; i < this.threatPool.length; i++) this.threatPool[i].el.hidden = true;
  }
  threatEl(i) {
    while (this.threatPool.length <= i) {
      const el = document.createElement('div');
      el.className = 'threat';
      el.hidden = true;
      el.innerHTML = '<svg viewBox="-26 -26 52 52"><g class="rot"><path class="chev" d="M0 -25 L9 -14 L0 -17.5 L-9 -14 Z"/></g>'
        + '<g class="pg"><rect class="dia" x="-7.5" y="-7.5" width="15" height="15" rx="1" transform="rotate(45)"/><text class="bang" y="4.6">!</text></g><circle class="orbdot" r="6"/></svg>';
      this.el.threats.appendChild(el);
      this.threatPool.push({ el, rot: el.querySelector('.rot'), kind: '' });
    }
    return this.threatPool[i];
  }

  // The open door: a diamond with the distance, pinned to the edge when off screen
  updateWaypoint(cam, W, H) {
    const g = this.game, lvl = g.level, pl = g.player, el = this.el.waypoint;
    // until the door opens, the nearest memory still caught; then the door
    let door = lvl && lvl.doorOpen && lvl.door, memory = false;
    if (!door && lvl && lvl.knots && pl) {
      let best = Infinity;
      for (const k of lvl.knots) { if (k.state === 'taken') continue; const d = k.pos.distanceToSquared(pl.pos); if (d < best) { best = d; door = k; } }
      memory = !!door;
    }
    const dist = door && pl ? Math.hypot(pl.pos.x - door.pos.x, pl.pos.z - door.pos.z) : 0;
    if (!door || !pl || g.state !== 'playing' || dist < 3.5 || this.wheelOpen) { if (!el.hidden) el.hidden = true; return; }
    el.hidden = false;
    el.classList.toggle('memory', memory);
    el.classList.toggle('freed', memory && door.state === 'freed');
    _v.copy(door.pos); _v.y += memory ? 2.6 : 3.2;
    const s = placeOnScreen(cam, _v.clone(), W, H, WAYPOINT_BOX);
    el.classList.toggle('edge', !s.on);
    el.style.transform = `translate(${s.x.toFixed(1)}px, ${s.y.toFixed(1)}px) translate(-50%, -50%)`;
    if (!s.on) this.el.wpArrow.style.transform = `rotate(${(s.ang + 180).toFixed(1)}deg)`;
    const m = Math.round(dist) + ' m';
    if (this.el.wpDist.textContent !== m) this.el.wpDist.textContent = m;
  }

  // -------------------------------------------------------------- lore
  // cutscenes: letterbox bars and a line of text under the picture
  letterbox(on) {
    const el = document.getElementById('letterbox');
    if (!el) return;
    if (on) { el.hidden = false; void el.offsetWidth; el.classList.add('on'); }
    else { el.classList.remove('on'); clearTimeout(this._lb); this._lb = setTimeout(() => { if (!el.classList.contains('on')) el.hidden = true; }, 500); this.cutCaption(''); }
  }
  cutCaption(text) {
    const p = document.querySelector('#letterbox .lb-cap');
    if (!p || p.textContent === text) return;
    p.classList.remove('in'); void p.offsetWidth;
    p.textContent = text;
    if (text) p.classList.add('in');
  }

  // Clarity: rank name and progress to the next rank
  clarity(xp, quiet = false) {
    const r = rankOf(xp), el = document.querySelector('.cl-row');
    if (!el) return;
    el.querySelector('.cl-rank').textContent = `${RANKS[r].name}${r ? ' · ' + r : ''}`;
    el.querySelector('.cl-bar i').style.width = (rankProgress(xp) * 100).toFixed(1) + '%';
    if (!quiet) { el.classList.remove('gain'); void el.offsetWidth; el.classList.add('gain'); }
  }

  loreCard(scrap) {
    const el = this.el.lore;
    el.querySelector('.lc-text').textContent = scrap.text;
    el.querySelector('.lc-src').textContent = '— ' + scrap.src;
    el.hidden = false;
    el.style.animation = 'none'; void el.offsetWidth; el.style.animation = '';
    clearTimeout(this._lore);
    this._lore = setTimeout(() => { el.hidden = true; }, 8000);
  }

  journalTab(tab) {
    for (const t of document.querySelectorAll('#journal .tab')) {
      const on = t.dataset.tab === tab;
      t.classList.toggle('on', on);
      t.setAttribute('aria-selected', on ? 'true' : 'false');
      t.tabIndex = on ? 0 : -1;
    }
    for (const b of document.querySelectorAll('#journal .tab-body')) b.hidden = b.dataset.body !== tab;
    if (tab === 'painting') this.renderPainting();
    if (tab === 'dreamer') this.renderDreamer();
    if (tab === 'memories') this.renderMemories();
    this.game.meta.uiPref('journalTab', tab);
  }
  renderJournal() {
    const t = this.game.meta.uiPref('journalTab');
    this.journalTab(['figment', 'painting', 'dreamer', 'memories'].includes(t) ? t : 'figment');
  }

  renderPainting() {
    const meta = this.game.meta;
    const found = meta.scraps;
    drawPainting($('#painting-canvas'), { found, finished: meta.data.bossKills > 0 });
    $('#scrap-list').innerHTML = `<p class="fine">${found.size} of 9 scraps recovered.${meta.data.bossKills > 0 ? ' The painting is finished.' : ''}</p>` + SCRAPS.map((s) => found.has(s.id)
      ? `<div class="scrap">${s.text}<span class="src">${s.src} · layer ${ROMAN[s.layer]}</span></div>`
      : `<div class="scrap missing">A torn corner, somewhere in layer ${ROMAN[s.layer]}.</div>`).join('');
  }

  renderDreamer() {
    const meta = this.game.meta;
    const mem = meta.memories, sc = meta.scraps;
    const parts = ['<p>Someone is asleep. It is very late. The dream smells faintly of candle wax and clock oil.</p>'];
    if (meta.knowsName) parts.push('<p>Her name is <b>Odile Vautrin</b>. She is seventy-eight. She restored clocks for fifty years in a small shop on the Rue des Horloges, and lives alone above it now, with the shutters down.</p>');
    if (mem.has('nightlight') || sc.has(3)) parts.push('<p>For years she kept a candle burning in the window, every night, in case someone came home late.</p>');
    if (sc.has(1) || sc.has(4)) parts.push('<p>She had a younger brother, <b>Théo</b>, who painted. He thought everything was funnier if you put it next to something else.</p>');
    if (mem.has('station') || sc.has(5)) parts.push('<p>In December 1958 Théo caught the 6:40 train to the city. She went to platform 3 every morning for a month afterwards.</p>');
    if (mem.has('pomegranate')) parts.push('<p>He left a note under a split pomegranate on the kitchen table. She knows it by heart and has never said it aloud.</p>');
    if (mem.has('birdcage')) parts.push('<p>His canary, Pip, flew out of the door he left open. She kept the cage.</p>');
    if (sc.has(7) || mem.has('easel')) parts.push('<p>There is a painting in the back bedroom, under a sheet. She dusts around it.</p>');
    if (mem.has('letter') || sc.has(8)) parts.push('<p>In the second drawer there is a letter she has never opened. The handwriting is not his.</p>');
    if (meta.data.bossKills > 0) parts.push('<p><i>She lifted the sheet. She finished the face. It was hers.</i></p>');
    $('#dreamer-bio').innerHTML = parts.join('');
  }

  // ---- the map: hold M (or View). The dream's own sketch of where you are:
  // buildings, the ink, the memories, the door. No enemies on it; it is a memory, not radar.
  showMap(on) {
    const el = $('#map');
    if (!el) return;
    if (el.hidden === !on) { if (on) this.drawMap(); return; }
    el.hidden = !on;
    if (on) { this.game.audio.sfx('lore', { gain: 0.3 }); this.drawMap(); }
  }
  drawMap() {
    const g = this.game, L = g.level, p = g.player;
    const cv = $('#map-canvas');
    if (!L || !p || !cv) return;
    const S = cv.width, R = L.key === 'desert' ? 92 : L.key === 'piazza' ? 72 : 48;
    const cz = L.key === 'desert' ? 8 : 0;
    const X = (x) => (x + R) / (2 * R) * S, Z = (z) => (z - cz + R) / (2 * R) * S;
    const ctx = cv.getContext('2d');
    // the ground, once per layer: sand, water, the edge of the dream, the buildings
    if (this._mapFor !== L) {
      this._mapFor = L;
      const bg = this._mapBg = document.createElement('canvas'); bg.width = bg.height = S;
      const b = bg.getContext('2d'), n = 96, cell = S / n;
      for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
        const x = -R + (i + 0.5) / n * 2 * R, z = cz - R + (j + 0.5) / n * 2 * R, h = L.heightAt(x, z);
        const hi = Math.min(40, Math.max(0, h) * 4);
        b.fillStyle = h < -10 ? '#1b1620' : L.sea && h < L.sea.y ? '#3a5c6e' : `rgb(${196 - hi},${164 - hi},${118 - hi * 0.75})`;
        b.fillRect(i * cell, j * cell, cell + 0.6, cell + 0.6);
      }
      for (const r of L.town?.rects || []) {
        if (!/^B_/.test(r.name)) continue;
        b.save(); b.translate(X(r.x), Z(r.z)); b.rotate(-r.rotY);
        const w = r.hw * 2 / (2 * R) * S, d = r.hd * 2 / (2 * R) * S;
        b.fillStyle = '#efe4cf'; b.strokeStyle = '#3a2c22'; b.lineWidth = 1.5;
        b.fillRect(-w / 2, -d / 2, w, d); b.strokeRect(-w / 2, -d / 2, w, d);
        b.restore();
      }
    }
    ctx.clearRect(0, 0, S, S);
    ctx.drawImage(this._mapBg, 0, 0);
    // the ink: closed lines dark, parted ones a ghost
    for (const v of L.veils || []) {
      const m = v.mesh, half = m.geometry.parameters.width / 2, dir = new THREE.Vector3(1, 0, 0).applyQuaternion(m.quaternion);
      const a = m.position.clone().addScaledVector(dir, -half), bb = m.position.clone().addScaledVector(dir, half);
      ctx.strokeStyle = v.opening ? 'rgba(90,60,140,0.3)' : '#3b1f5c'; ctx.lineWidth = v.opening ? 2 : 5; ctx.setLineDash(v.opening ? [4, 6] : []);
      ctx.beginPath(); ctx.moveTo(X(a.x), Z(a.z)); ctx.lineTo(X(bb.x), Z(bb.z)); ctx.stroke();
    }
    ctx.setLineDash([]);
    // the regions: names where they lie; the ones the ink still closes are dim
    const stage = L.stage || 0;
    ctx.textAlign = 'center';
    for (const r of REGIONS[L.key] || []) {
      const open = stage >= r.open, here = L.region === r;
      ctx.font = `${here ? 'italic ' : ''}${here ? 16 : 14}px Georgia, serif`;
      ctx.fillStyle = here ? '#fff4d6' : open ? 'rgba(40,28,20,0.85)' : 'rgba(40,28,20,0.35)';
      ctx.fillText(r.name, X(r.at[0]), Z(r.at[1]));
      if (r.tier >= 0) { ctx.font = '10px Georgia, serif'; ctx.fillText('✦'.repeat(Math.min(5, r.tier + 1)), X(r.at[0]), Z(r.at[1]) + 13); }
    }
    // the memories: taken ones ticked, the one you're after glowing
    for (const k of L.knots || []) {
      const x = X(k.pos.x), y = Z(k.pos.z), cur = L.current === k;
      ctx.textAlign = 'center';
      if (k.state === 'taken') { ctx.fillStyle = '#ffd27a'; ctx.font = 'bold 16px Georgia, serif'; ctx.fillText('✓', x, y + 5); continue; }
      ctx.beginPath(); ctx.arc(x, y, cur ? 8 + Math.sin(g.time * 4) * 2 : 6, 0, Math.PI * 2);
      ctx.fillStyle = cur ? '#ffd27a' : k.def.optional ? '#b89cff' : '#6d4aa8'; ctx.fill();
      ctx.lineWidth = 2; ctx.strokeStyle = '#1b1620'; ctx.stroke();
      if (cur) { ctx.fillStyle = '#f5ecd8'; ctx.font = '13px Georgia, serif'; ctx.fillText(k.def.name, x, y - 14); }
    }
    // the way out, once it's open
    if (L.doorOpen && L.door) { const d = L.door.pos; ctx.fillStyle = '#fff2c0'; ctx.fillRect(X(d.x) - 4, Z(d.z) - 7, 8, 14); }
    // you: an arrow along the camera
    ctx.save(); ctx.translate(X(p.pos.x), Z(p.pos.z)); ctx.rotate(Math.PI - p.camYaw);
    ctx.beginPath(); ctx.moveTo(0, -11); ctx.lineTo(7, 8); ctx.lineTo(0, 4); ctx.lineTo(-7, 8); ctx.closePath();
    ctx.fillStyle = '#ffffff'; ctx.fill(); ctx.strokeStyle = '#1b1620'; ctx.lineWidth = 2; ctx.stroke();
    ctx.restore();
    const cur = L.current;
    $('#map-note').textContent = (L.region ? L.region.name + ' · ' : '') + (cur ? `${cur.def.name[0].toUpperCase() + cur.def.name.slice(1)}${cur.lock && !cur.lock.solved ? ': ' + cur.lock.hint : ''}` : L.objective || '');
  }
  // The HUD teaches itself: a new dreamer sees the Figment's health, the gun and
  // the properties they hold. Lucidity, reverie and Clarity appear the first time
  // they mean something, and stay from then on. Locked slots wait for a memory.
  teach(pl) {
    const g = this.game, m = g.meta, T = m.data.taught || (m.data.taught = {});
    let changed = false;
    const learn = (k, cond) => { if (!T[k] && cond) { T[k] = true; changed = true; } };
    learn('lucid', g.lucidity.value > 0.5 || g.sandbox);
    learn('reverie', pl.reverie > 0 || g.sandbox);
    learn('clarity', (m.data.clarity || 0) > 0 || g.sandbox);
    learn('gives', (g.stats.gives || 0) >= 2 || g.sandbox);
    if (changed) { m.save(); this._vsel = null; }
    const key = ['lucid', 'reverie', 'clarity'].map((k) => (T[k] ? 1 : 0)).join('') + (m.memories.size || g.sandbox ? 'm' : '');
    if (key === this._teachKey) return;
    this._teachKey = key;
    const h = this.hud.classList;
    h.toggle('no-lucid', !T.lucid);
    h.toggle('no-reverie', !T.reverie);
    h.toggle('no-clarity', !T.clarity);
    h.toggle('lean', !(m.memories.size || g.sandbox));
  }

  // crossing into a region: its name, small, under the objective, then gone
  regionCard(name, sub) {
    const el = $('#region');
    if (!el) return;
    el.querySelector('.rg-name').textContent = name;
    el.querySelector('.rg-sub').textContent = sub || '';
    el.hidden = false;
    el.classList.remove('out'); void el.offsetWidth; el.classList.add('in');
    clearTimeout(this._rgT);
    this._rgT = setTimeout(() => { el.classList.add('out'); setTimeout(() => { el.hidden = true; el.classList.remove('in', 'out'); }, 900); }, 4200);
  }

  // the title's Continue button: shown when a night was left mid-way
  refreshContinue() {
    const b = $('#btn-continue'), cp = this.game.meta.data.checkpoint;
    if (!b) return;
    b.hidden = !cp;
    const n = cp?.progress?.taken?.length || 0;
    if (cp) b.textContent = `Continue the night · ${LAYERS[cp.depth]?.name || ''}${n ? ` · ${n} ${n === 1 ? 'memory' : 'memories'} back` : ''}`;
  }

  // the Clarity tree: four branches, bought from the top down, one point per rank
  renderClarity() {
    const meta = this.game.meta;
    const own = new Set(meta.data.tree || []);
    const { free, earned } = treePoints(meta);
    const xp = meta.data.clarity || 0, r = rankOf(xp), next = RANKS[r + 1];
    $('#clarity-rank').textContent = `${RANKS[r].name} · ${Math.round(xp)} clarity${next ? ` · ${Math.ceil(next.at - xp)} to ${next.name}` : ''} · ${earned} point${earned === 1 ? '' : 's'} earned`;
    const pc = $('#clarity-points');
    pc.innerHTML = `<i class="notch${free ? ' on' : ''}"></i><span class="mono fine">&nbsp;${free}</span>`;
    const icon = { blade: 'blade', gun: 'gun', mind: 'mind', legs: 'motion' };
    $('#clarity-tree').innerHTML = Object.entries(TREE).map(([k, b]) => `<div class="branch"><h3>${catSVG(icon[k], 16)}${b.label}</h3>${b.nodes.map((n) => {
      const st = own.has(n.id) ? 'own' : canBuy(meta, n.id) ? 'can' : 'locked';
      return `<button class="tnode ${st}" data-id="${n.id}" aria-pressed="${st === 'own'}" ${st === 'locked' ? 'aria-disabled="true"' : ''}><div class="tn">${n.name}</div><div class="td">${n.desc}</div></button>`;
    }).join('')}</div>`).join('');
    for (const b of document.querySelectorAll('#clarity-tree .tnode')) {
      b.addEventListener('click', () => {
        if (b.classList.contains('own')) return;
        const ok = buy(meta, b.dataset.id);
        this.game.audio.sfx(ok ? 'memory' : 'fireEmpty');
        if (!ok) this.toast(treePoints(meta).free ? 'Take the one above it first.' : 'No Clarity to spend. Rank up to earn more.');
        this.renderClarity();
        document.querySelector(`#clarity-tree .tnode[data-id="${b.dataset.id}"]`)?.focus({ preventScroll: true });
      });
    }
  }

  renderKeepsakes() {
    const meta = this.game.meta;
    const eq = new Set(meta.equipped());
    const used = meta.usedNotches(), total = meta.notches;
    const nc = $('#notch-count');
    nc.innerHTML = Array.from({ length: total }, (_, i) => `<i class="notch${i < used ? ' on' : ''}"></i>`).join('') + `<span class="mono fine">&nbsp;${used}/${total}</span>`;
    nc.setAttribute('aria-label', `${used} of ${total} notches used`);
    $('#keepsake-list').innerHTML = KEEPSAKES.map((k) => {
      const un = meta.keepsakeUnlocked(k);
      const mem = MEMORIES.find((m) => m.id === k.memory);
      return `<button class="keep${eq.has(k.id) ? ' on' : ''}${un ? '' : ' locked'}" data-id="${k.id}" ${un ? '' : 'disabled'} aria-pressed="${eq.has(k.id)}">
        <span class="kc" aria-label="costs ${k.cost} notch${k.cost > 1 ? 'es' : ''}">${notches(k.cost, un)}</span><div class="kn">${un ? k.name : lockSVG(13) + 'Unremembered'}</div>
        <div class="kd">${un ? k.desc : 'Wake with the memory “' + (mem ? mem.title : '?') + '” to find it.'}</div></button>`;
    }).join('');
    for (const b of document.querySelectorAll('#keepsake-list .keep')) {
      b.addEventListener('click', () => {
        const ok = meta.toggleKeepsake(b.dataset.id);
        this.game.audio.sfx(ok ? 'uiSelect' : 'fireEmpty');
        if (!ok) this.toast('Not enough notches.');
        this.renderKeepsakes();
        const again = document.querySelector(`#keepsake-list .keep[data-id="${b.dataset.id}"]`);
        if (again) again.focus({ preventScroll: true });
      });
    }
  }

  // Three whims, picked by click, 1/2/3, or arrows and Enter
  showWhims(onPick) {
    const g = this.game;
    const taken = new Set(g.run.whims);
    const pool = WHIMS.filter((w) => !taken.has(w.id));
    const pick = [];
    while (pick.length < 3 && pool.length) pick.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
    // the Night-Light's aside, said here rather than queued for the next layer
    const nl = $('#whim-nl');
    nl.hidden = !g.opts?.tips;
    nl.querySelector('.nl-text').textContent = LINES.whim[0];
    $('#whim-cards').innerHTML = pick.map((w, i) => {
      const cat = WHIM_CATS[w.cat] || WHIM_CATS.blade;
      return `<button class="whim" data-i="${i}" style="--d:${i}"><span class="wk"><kbd>${i + 1}</kbd></span><span class="wi">${catSVG(w.cat, 30)}</span><span class="wc">${cat.label}</span><span class="wn">${w.name}</span><span class="wd">${w.desc}</span></button>`;
    }).join('');
    this.show('whims');
    const btns = [...document.querySelectorAll('#whim-cards .whim')];
    let done = false;
    const onKey = (e) => {
      if (done || g.state !== 'whims') return;
      const m = /^(?:Digit|Numpad)([1-9])$/.exec(e.code);
      if (m && +m[1] <= btns.length) { e.preventDefault(); take(+m[1] - 1); return; }
      const cur = btns.indexOf(document.activeElement);
      const step = e.code === 'ArrowRight' || e.code === 'ArrowDown' ? 1 : e.code === 'ArrowLeft' || e.code === 'ArrowUp' ? -1 : 0;
      if (step) { e.preventDefault(); btns[((cur < 0 ? 0 : cur + step) + btns.length) % btns.length].focus(); }
    };
    const take = (i) => {
      if (done) return;
      done = true;
      window.removeEventListener('keydown', onKey);
      btns[i].classList.add('taken');
      g.audio.sfx('uiSelect');
      g.input.pressed.clear(); // the digit that picked it must not also pick a property
      onPick(pick[i]);
    };
    btns.forEach((b, i) => {
      b.addEventListener('click', () => take(i));
      b.addEventListener('mouseenter', () => b.focus({ preventScroll: true }));
    });
    // bubble phase, after Input has seen the key, so the picking digit can be taken back out
    window.addEventListener('keydown', onKey);
  }

  // Pause: where you are, and what tonight has been so far
  renderPauseSummary() {
    const g = this.game;
    const s = g.stats;
    const layer = g.sandbox ? 'The Lucid Room' : (LAYERS[g.depth]?.name || '');
    $('#ps-where').textContent = g.sandbox ? 'lucid sandbox' : `layer ${ROMAN[g.depth] || g.depth + 1} of ${ROMAN[LAYERS.length - 1]}`;
    const secs = Math.floor(s.time || 0);
    const time = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
    const scraps = Math.max(0, g.meta.scraps.size - (g.scrapsAtStart ?? g.meta.scraps.size));
    const whims = g.run.whims.map((id) => WHIMS.find((w) => w.id === id)).filter(Boolean);
    const keeps = [...g.run.keepsakes].map((id) => KEEPSAKES.find((k) => k.id === id)).filter(Boolean);
    $('#pause-summary').innerHTML = `<h3>Tonight so far</h3>
      <dl class="ps-stats">
        <dt>Layer</dt><dd class="txt">${layer}</dd>
        <dt>Anxieties silenced</dt><dd>${s.kills}</dd>
        <dt>Scraps found</dt><dd>${scraps}</dd>
        <dt>Lucidity</dt><dd>${Math.round(g.lucidity.value)}</dd>
        <dt>Asleep for</dt><dd>${time}</dd>
      </dl>
      <h3>Whims</h3>
      <ul class="ps-list">${whims.length ? whims.map((w) => `<li>${catSVG(w.cat, 16)}<span>${w.name}</span></li>`).join('') : '<li class="none">None yet. One waits between layers.</li>'}</ul>
      <h3>Keepsakes</h3>
      <ul class="ps-list">${keeps.length ? keeps.map((k) => `<li><span>${k.name}</span>${notches(k.cost)}</li>`).join('') : '<li class="none">Nothing worn tonight.</li>'}</ul>`;
  }

  renderMemories() {
    const have = this.game.meta.memories;
    $('#memory-list').innerHTML = MEMORIES.map((m) => {
      const got = have.has(m.id);
      const unlock = m.unlock ? `<div class="mu">Adds ${PROP_INFO[m.unlock].label.toLowerCase()} to the dream</div>` : '';
      return `<div class="mem${got ? '' : ' locked'}"><div class="mt">${got ? m.title : 'A memory not yet dreamt'}</div>${got ? `<div>${m.text}</div>` : ''}${unlock}</div>`;
    }).join('');
  }

  showWaking({ lines, memory, stats, cause }) {
    this.show('waking');
    $('#wake-cause').textContent = cause;
    $('#wake-lines').innerHTML = lines.map((l, i) => `<p style="animation-delay:${0.4 + i * 0.9}s">${l}</p>`).join('');
    const wm = $('#wake-memory');
    if (memory) {
      wm.hidden = false;
      wm.style.animationDelay = `${0.6 + lines.length * 0.9}s`;
      wm.querySelector('.wm-title').textContent = memory.title;
      wm.querySelector('.wm-text').textContent = memory.text;
      wm.querySelector('.wm-unlock').innerHTML = memory.unlock ? this.chip(memory.unlock, ' now appears in the dream') : '';
    } else wm.hidden = true;
    $('#wake-stats').textContent = `depth ${stats.depth + 1} · strangeness ${Math.round(stats.strangeness)} · ${stats.kills} anxieties silenced · ${stats.destroyed} things broken · ${stats.explosions} explosions · ${stats.memoriesFreed || 0} memories freed · +${stats.clarity || 0} clarity (${RANKS[rankOf(this.game.meta.data.clarity || 0)].name})`;
    { const { free } = treePoints(this.game.meta), b = $('#btn-wake-clarity'); if (b) { b.textContent = free ? `Clarity · ${free} to spend` : 'Clarity'; b.classList.toggle('has-points', free > 0); } }
  }
}
