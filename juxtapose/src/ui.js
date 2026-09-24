// HUD + menus (DOM overlay).
import * as THREE from 'three';
import { PROPS, PROP_INFO, propIconSVG, TUNE, LAYERS } from './config.js';
import { MEMORIES } from './meta.js';
import { takeCandidate } from './properties.js';

const $ = (s) => document.querySelector(s);

export class UI {
  constructor(game) {
    this.game = game;
    this.hud = $('#hud');
    this.el = {
      layer: $('#layer-name'), objective: $('#objective'),
      lucid: $('#lucid'), lucidFill: $('.lucid-fill'), lucidVal: $('.lucid-val'), iris: $('#lucid-eye .iris'), pops: $('#lucid-pops'),
      boss: $('#boss'), bossFill: $('.boss-fill'), bossText: $('.boss-text'), bossEcho: $('.boss-echo'),
      cross: $('#crosshair'), hurtRing: $('#hurt-ring'), target: $('#target'), tName: $('.t-name'), tProps: $('.t-props'), tHint: $('.t-hint'),
      selfChips: $('#self-chips'), hp: $('#hp'), hpFill: $('.hp-fill'), hpVal: $('.hp-val'),
      ribbon: $('#ribbon'), rounds: $('#rounds'), ammo: $('#ammo'), vIcon: $('.v-icon'), vName: $('.v-name'), vCount: $('.v-count'),
      toasts: $('#toasts'), wheel: $('#wheel'), fade: $('#fade'), card: $('#card'),
    };
    this.hitT = 0;
    this.lastTarget = null;
    this.lastKey = '';
    this.buildRibbon();
    this.buildAmmo();
    this.buildPropTable();
    this.wheelOpen = false;
    this.wheelSel = 0;
  }

  show(id) {
    for (const s of document.querySelectorAll('.screen')) s.hidden = s.id !== id;
    if (id) { const f = document.querySelector(`#${id} button.primary, #${id} button`); f && f.focus({ preventScroll: true }); }
  }
  hideScreens() { for (const s of document.querySelectorAll('.screen')) s.hidden = true; }
  setHud(on) { this.hud.hidden = !on; }

  buildRibbon() {
    this.el.ribbon.innerHTML = PROPS.map((p, i) => `<div class="slot" data-p="${p}" style="color:${PROP_INFO[p].color}" title="${PROP_INFO[p].label}"><span class="n">${i + 1}</span>${propIconSVG(p, 22)}<span class="c">0</span></div>`).join('');
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
  hitmarker(big) {
    this.hitT = 0.12;
    this.el.cross.classList.add('hitting');
    this.el.cross.classList.toggle('big', !!big);
  }
  hurtDirection(from) {
    const g = this.game;
    let ang = 0;
    if (from) {
      const d = from.clone().sub(g.player.pos);
      const a = Math.atan2(d.x, d.z) - g.player.camYaw;
      ang = -a * 180 / Math.PI + 180;
    }
    this.el.hurtRing.style.background = from ? `conic-gradient(from ${ang - 25}deg, rgba(220,40,60,0.75) 0deg, transparent 50deg, transparent 360deg)` : 'radial-gradient(circle, transparent 60%, rgba(220,40,60,0.5))';
    this.el.hurtRing.style.maskImage = 'radial-gradient(circle, transparent 62%, #000 64%, #000 70%, transparent 72%)';
    this.el.hurtRing.style.webkitMaskImage = this.el.hurtRing.style.maskImage;
    this.el.hurtRing.style.opacity = 1;
    clearTimeout(this._hr);
    this._hr = setTimeout(() => { this.el.hurtRing.style.opacity = 0; }, 350);
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
    this.el.fade.style.transition = `opacity ${dur}s`;
    this.el.fade.style.opacity = v;
  }

  // -------------------------------------------------------------- wheel
  openWheel() {
    const g = this.game;
    this.wheelOpen = true;
    this.el.wheel.hidden = false;
    const avail = g.player.available;
    this.wheelSel = g.player.selected;
    const ring = this.el.wheel.querySelector('.wheel-ring');
    ring.innerHTML = PROPS.map((p, i) => {
      const a = (i / PROPS.length) * Math.PI * 2 - Math.PI / 2;
      const x = 190 + Math.cos(a) * 140, y = 190 + Math.sin(a) * 140;
      const locked = !avail.includes(p);
      const c = g.player.chargesOf(p);
      return `<div class="wslot${locked ? ' locked' : ''}" data-i="${i}" style="left:${x}px;top:${y}px;color:${PROP_INFO[p].color}">${propIconSVG(p, 26)}<span class="mono">${locked ? '—' : c === Infinity ? '∞' : c}</span></div>`;
    }).join('');
    this.wheelVec = new THREE.Vector2();
    this.updateWheel(0, 0);
  }
  updateWheel(dx, dy) {
    const g = this.game;
    this.wheelVec.x += dx; this.wheelVec.y += dy;
    if (this.wheelVec.length() > 60) this.wheelVec.setLength(60);
    const avail = g.player.available;
    if (this.wheelVec.length() > 20) {
      const a = Math.atan2(this.wheelVec.y, this.wheelVec.x) + Math.PI / 2;
      const i = ((Math.round(a / (Math.PI * 2) * PROPS.length) % PROPS.length) + PROPS.length) % PROPS.length;
      const p = PROPS[i];
      const ai = avail.indexOf(p);
      if (ai >= 0) this.wheelSel = ai;
    }
    const selP = avail[this.wheelSel];
    for (const s of this.el.wheel.querySelectorAll('.wslot')) s.classList.toggle('sel', PROPS[+s.dataset.i] === selP);
    this.el.wheel.querySelector('.wc-name').textContent = PROP_INFO[selP].label;
    this.el.wheel.querySelector('.wc-name').style.color = PROP_INFO[selP].color;
    this.el.wheel.querySelector('.wc-desc').textContent = PROP_INFO[selP].blurb;
  }
  closeWheel() {
    this.wheelOpen = false;
    this.el.wheel.hidden = true;
    this.game.player.select(this.wheelSel);
  }

  // -------------------------------------------------------------- per frame
  update(dt) {
    const g = this.game;
    const pl = g.player;
    if (!pl || this.hud.hidden) return;
    // lucidity
    const L = g.lucidity.display;
    this.el.lucidFill.style.width = L.toFixed(1) + '%';
    this.el.lucidVal.textContent = Math.round(L);
    this.el.iris.setAttribute('r', (2.5 + L / 100 * 6).toFixed(2));
    this.el.lucid.classList.toggle('warn', L >= 75);
    // layer + objective
    this.el.objective.textContent = g.level?.objective || '';
    // health
    const hp = Math.max(0, pl.hp);
    this.el.hpFill.style.width = (hp / pl.maxHp * 100).toFixed(1) + '%';
    this.el.hpVal.textContent = Math.ceil(hp);
    this.el.hp.classList.toggle('low', hp < 30);
    // self properties
    const selfKey = [...pl.self].map(([p, t]) => p + Math.ceil(t)).join() + (pl.drowsy > 0 ? 'd' : '') + (pl.disarmed > 0 ? 'x' : '');
    if (selfKey !== this._selfKey) {
      this._selfKey = selfKey;
      let html = [...pl.self].map(([p, t]) => this.chip(p, `<span class="t">${Math.ceil(t)}s</span>`)).join('');
      if (pl.drowsy > 0) html += '<span class="chip">drowsy</span>';
      if (pl.disarmed > 0) html += '<span class="chip">hollow hands</span>';
      this.el.selfChips.innerHTML = html;
    }
    // ribbon
    const avail = pl.available;
    const sel = pl.selectedProp;
    for (const s of this.el.ribbon.children) {
      const p = s.dataset.p;
      const locked = !avail.includes(p);
      const c = pl.chargesOf(p);
      s.classList.toggle('locked', locked);
      s.classList.toggle('empty', !locked && c <= 0);
      s.classList.toggle('sel', p === sel);
      const cc = s.querySelector('.c');
      const txt = locked ? '' : c === Infinity ? '∞' : String(c);
      if (cc.textContent !== txt) cc.textContent = txt;
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
      this.el.vCount.textContent = c === Infinity ? '∞ charges' : `${c} charge${c === 1 ? '' : 's'} · E give · Q self · F rounds`;
    }
    // hitmarker
    if (this.hitT > 0) { this.hitT -= dt; if (this.hitT <= 0) this.el.cross.classList.remove('hitting'); }
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
        if (cand) parts.push(`<kbd>RMB</kbd> take <span style="color:${PROP_INFO[cand].color}">${PROP_INFO[cand].label.toLowerCase()}</span>`);
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
  }

  // -------------------------------------------------------------- screens
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
    $('#wake-stats').textContent = `depth ${stats.depth + 1} · strangeness ${Math.round(stats.strangeness)} · ${stats.kills} anxieties silenced · ${stats.destroyed} things broken · ${stats.explosions} explosions`;
  }
}
