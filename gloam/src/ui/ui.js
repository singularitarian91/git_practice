// HTML overlay UI: HUD, hotbar, toasts, prompts, dialogue (typewriter +
// animalese), choices, modal panels, fades, and the fishing minigame.
import * as THREE from 'three';
import { ITEMS, CROPS } from '../data/items.js';
import { buildPanel } from './panels.js';
import { FishingGame } from './minigame.js';
import { Minimap } from './minimap.js';
import { showTitle, narrate } from './screens.js';
import { fmtTime } from '../game/util.js';
import { SEASON_DAYS } from '../game/state.js';
import { ZONES, LOC } from '../game/worldmap.js';

const h = (tag, cls, html) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;
  return e;
};

export const WEATHER_ICON = { clear: '☀', overcast: '☁', fog: '〰', rain: '🌧', storm: '⛈', snow: '❄' };
export const SEASON_NAME = { spring: 'Thaw', summer: 'Brightwane', autumn: 'Rotfall', winter: 'Deepfrost' };
const NPC_COLOR = { Corvin: '#8e2a22', Morrow: '#6b5638', Bramble: '#4d5359', Mothwyn: '#7b6b93', Grenna: '#3f5a36', Fennick: '#9a4a1e' };

export class UI {
  constructor(root, { audio, icons, content }) {
    this.root = root;
    this.audio = audio;
    this.icons = icons;
    this.content = content || {};
    this.game = null;
    this.stack = [];          // open modal panels
    this.dialogueOpen = false;
    this.timeRuns = false;
    this.musicOverride = null;
    this.hudT = 0;
    this.zoneName = null;
    this.build();
    window.addEventListener('keydown', (e) => this.onKey(e));
    // clicking anywhere advances dialogue (choices handle their own clicks)
    window.addEventListener('pointerdown', (e) => {
      if (this.dialogueOpen && !this.dlgChoices.contains(e.target) && !this.dlg.contains(e.target)) this.advance();
    });
  }

  get blocking() { return this.stack.length > 0 || this.dialogueOpen || !!this.overlayBusy; }

  itemText(id) {
    const L = this.content.LORE;
    return (L && L.ITEM_TEXT && L.ITEM_TEXT[id]) || '';
  }

  // ------------------------------------------------------------------
  build() {
    const r = this.root;
    r.innerHTML = '';
    // HUD
    this.hud = h('div', 'hud');
    this.hud.innerHTML = `
      <div class="hud-clock panel-lite">
        <div class="hc-date"><span class="hc-season"></span> · Day <span class="hc-day"></span></div>
        <div class="hc-time"><span class="hc-weather"></span><span class="hc-hm"></span></div>
        <div class="hc-coins"><span class="coin-ico">◉</span><span class="hc-coinv"></span></div>
      </div>
      <div class="hud-vitals">
        <div class="buffs"></div>
        <div class="bar hp"><div class="bar-fill"></div><span class="bar-lbl">♥</span></div>
        <div class="bar st"><div class="bar-fill"></div><span class="bar-lbl">⚡</span></div>
      </div>
      <div class="hud-can"><span>💧</span><span class="can-v"></span></div>
      <div class="hotbar"></div>
      <div class="hotbar-name"></div>
      <div class="prompt"></div>
      <div class="toasts"></div>
      <div class="zone-title"></div>
      <div class="boss-bar"><div class="boss-name"></div><div class="boss-track"><div class="boss-fill"></div></div></div>
      <div class="bite">!</div>
      <div class="dmg-layer"></div>
      <div class="hurt-vignette"></div>`;
    r.appendChild(this.hud);
    this.q = (sel) => this.hud.querySelector(sel);
    this.minimap = new Minimap(this);
    this.hud.appendChild(this.minimap.el);
    this.hotbarEl = this.q('.hotbar');
    this.slots = [];
    for (let i = 0; i < 10; i++) {
      const s = h('div', 'slot interactive', `<img alt=""><span class="n"></span><span class="k">${(i + 1) % 10}</span><span class="lvl"></span>`);
      s.addEventListener('pointerdown', (e) => { e.stopPropagation(); if (this.game) { this.game.inventory.selectedIndex = i; this.audio.sfx('ui_click', { volume: 0.4 }); } });
      this.hotbarEl.appendChild(s);
      this.slots.push(s);
    }
    // dialogue
    this.dlg = h('div', 'dlg');
    this.dlg.innerHTML = `<div class="dlg-name"></div><div class="dlg-text"></div><div class="dlg-next">▼</div>`;
    this.dlgChoices = h('div', 'dlg-choices');
    r.appendChild(this.dlg);
    r.appendChild(this.dlgChoices);
    this.dlg.addEventListener('pointerdown', (e) => { e.stopPropagation(); this.advance(); });
    // modal layer
    this.modal = h('div', 'modal-layer');
    r.appendChild(this.modal);
    // fade
    this.fadeEl = h('div', 'fade');
    r.appendChild(this.fadeEl);
    this.fishingUI = new FishingGame(this);
  }

  attach(game) {
    this.game = game;
    game.inventory.onChange(() => { this.hotbarDirty = true; this.refreshOpenPanel(); });
    this.hotbarDirty = true;
    this.hud.classList.add('on');
  }

  hideHud(v) { this.hud.classList.toggle('hidden', v); }

  // ------------------------------------------------------------------
  update(dt) {
    const g = this.game;
    if (!g) return;
    const p = g.player;
    this.q('.hp .bar-fill').style.transform = `scaleX(${Math.max(0, p.hp / p.maxHp)})`;
    this.q('.st .bar-fill').style.transform = `scaleX(${Math.max(0, p.stamina / p.maxStamina)})`;
    this.q('.st').classList.toggle('exhausted', p.exhausted);
    this.q('.hurt-vignette').style.opacity = String(Math.min(1, g.hurtVignette * 0.8 + (p.hp < p.maxHp * 0.25 ? 0.35 : 0)));
    this.hudT -= dt;
    if (this.hudT <= 0) {
      this.hudT = 0.15;
      const st = g.state;
      this.q('.hc-season').textContent = SEASON_NAME[g.season];
      this.q('.hc-day').textContent = `${st.day}/${SEASON_DAYS}`;
      this.q('.hc-hm').textContent = fmtTime(st.time);
      const night = g.darkness > 0.6;
      this.q('.hc-weather').textContent = (night && (st.weather === 'clear' || st.weather === 'overcast') ? '☾' : (WEATHER_ICON[st.weather] || '')) + ' ';
      this.q('.hc-coinv').textContent = st.coins.toLocaleString();
      this.q('.hud-clock').classList.toggle('late', g.hour >= 24);
      const sel = g.inventory.selected;
      const can = this.q('.hud-can');
      if (sel && sel.id === 'tool_can') { can.style.display = 'flex'; this.q('.can-v').textContent = `${st.canWater}/${[20, 40, 70][st.tools.tool_can || 0]}`; }
      else can.style.display = 'none';
      const buffs = this.q('.buffs');
      const html = st.buffs.map((b) => `<span class="buff" title="${b.id}">${{ rested: '🔥 Rested', wellfed: '🍖 Well Fed', hearty: '🍞 Hearty', mead: '🍯 Mead' }[b.id] || b.id} <i>${Math.ceil(b.t / 60)}m</i></span>`).join('');
      if (buffs.innerHTML !== html) buffs.innerHTML = html;
      this.updateZone();
    }
    if (this.hotbarDirty) this.renderHotbar();
    this.minimap.update(dt);
    this.fishingUI.update(dt);
    // damage numbers
    for (let i = this.dmgNums.length - 1; i >= 0; i--) {
      const d = this.dmgNums[i];
      d.t += dt;
      d.pos.y += dt * 1.2;
      const v = d.pos.clone().project(g.engine.camera);
      d.el.style.transform = `translate(${(v.x + 1) / 2 * innerWidth}px, ${(1 - v.y) / 2 * innerHeight}px) translate(-50%,-50%)`;
      d.el.style.opacity = String(1 - d.t / 0.9);
      if (d.t > 0.9 || v.z > 1) { d.el.remove(); this.dmgNums.splice(i, 1); }
    }
  }

  dmgNums = [];
  damageNumber(pos, n) {
    const el = h('div', 'dmg', String(n));
    this.q('.dmg-layer').appendChild(el);
    this.dmgNums.push({ el, pos: pos.clone(), t: 0 });
  }

  updateZone() {
    const p = this.game.player.pos;
    let z = null;
    const zones = [
      ['Hollow Green', LOC.hearth, 20], ['Your Croft', { x: -46, z: 28 }, 20], ['The Barrow', LOC.barrow, 18],
      ['Blackwater', LOC.lake, 26], ['The Mistwood', ZONES.mistwood, ZONES.mistwood.r * 0.8], ['Birchmeadow', ZONES.meadow, ZONES.meadow.r * 0.8],
      ['Greyshore', { x: 20, z: 90 }, 22], ['The Standing Stones', LOC.stones, 14], ['Ashen Heath', ZONES.heath, 22], ['The Old Altar', LOC.altar, 12],
    ];
    for (const [name, c, r] of zones) if (Math.hypot(p.x - c.x, p.z - c.z) < r) { z = name; }
    if (z && z !== this.zoneName) {
      const el = this.q('.zone-title');
      el.textContent = z;
      el.classList.remove('show');
      void el.offsetWidth;
      el.classList.add('show');
    }
    this.zoneName = z;
  }

  renderHotbar() {
    this.hotbarDirty = false;
    const g = this.game;
    const inv = g.inventory;
    for (let i = 0; i < 10; i++) {
      const s = inv.slots[i];
      const el = this.slots[i];
      el.classList.toggle('sel', i === inv.selectedIndex);
      const img = el.querySelector('img');
      const src = s ? this.icons.get(s.id) : '';
      if (img.getAttribute('src') !== src) { if (src) img.setAttribute('src', src); else img.removeAttribute('src'); }
      img.style.visibility = s ? 'visible' : 'hidden';
      el.querySelector('.n').textContent = s && s.n > 1 ? s.n : '';
      const lvl = s && g.state.tools[s.id];
      el.querySelector('.lvl').textContent = lvl ? ['', 'Cu', 'Fe'][lvl] : '';
    }
    const sel = inv.selected;
    const nm = this.q('.hotbar-name');
    const name = sel ? ITEMS[sel.id].name + (g.state.tools[sel.id] ? ` (${['', 'Copper', 'Iron'][g.state.tools[sel.id]]})` : '') : '';
    if (nm.dataset.v !== name) {
      nm.dataset.v = name;
      nm.textContent = name;
      nm.classList.remove('show'); void nm.offsetWidth; if (name) nm.classList.add('show');
    }
  }

  setPrompt(text) {
    const el = this.q('.prompt');
    if (this._prompt === text) return;
    this._prompt = text;
    if (!text) { el.classList.remove('show'); return; }
    el.innerHTML = `<kbd>E</kbd> ${text}`;
    el.classList.add('show');
  }

  toast(msg, kind = 'info') {
    const box = this.q('.toasts');
    const el = h('div', `toast ${kind}`, msg);
    box.appendChild(el);
    while (box.children.length > 6) box.firstChild.remove();
    setTimeout(() => el.classList.add('out'), kind === 'quest' || kind === 'new' ? 5200 : 3200);
    setTimeout(() => el.remove(), kind === 'quest' || kind === 'new' ? 6000 : 4000);
  }

  pickup(id, n, isNew = false) {
    const box = this.q('.toasts');
    // merge with a recent toast of the same item
    const last = [...box.children].reverse().find((c) => c.dataset.item === id && !c.classList.contains('out'));
    if (last) {
      last.dataset.n = String(Number(last.dataset.n) + n);
      last.querySelector('.pn').textContent = `+${last.dataset.n}`;
      return;
    }
    const el = h('div', `toast pickup${isNew ? ' new' : ''}`, `<img src="${this.icons.get(id)}" alt=""><span class="pname">${ITEMS[id] ? ITEMS[id].name : id}${isNew ? ' <b>NEW</b>' : ''}</span><span class="pn">+${n}</span>`);
    el.dataset.item = id;
    el.dataset.n = String(n);
    box.appendChild(el);
    while (box.children.length > 6) box.firstChild.remove();
    setTimeout(() => el.classList.add('out'), 2800);
    setTimeout(() => el.remove(), 3500);
  }

  bossBar(show, name, frac = 1) {
    const el = this.q('.boss-bar');
    el.classList.toggle('show', !!show);
    if (name) this.q('.boss-name').textContent = name;
    this.q('.boss-fill').style.transform = `scaleX(${frac})`;
  }

  biteAlert() {
    const el = this.q('.bite');
    el.classList.remove('show'); void el.offsetWidth; el.classList.add('show');
  }

  fishingGame(fish, rodLevel) { return this.fishingUI.start(fish, rodLevel); }
  fishingCancel() { this.fishingUI.stop(false); }

  // ------------------------------------------------------------------
  // Dialogue
  say(name, pages, voice) {
    return new Promise((resolve) => {
      this.dialogueOpen = true;
      this.dlgPages = pages.slice();
      this.dlgVoice = voice;
      this.dlgResolve = resolve;
      this.dlgChoicesActive = null;
      this.showDialogue(name);
      this.nextPage();
    });
  }

  choose(name, text, options, voice) {
    return new Promise((resolve) => {
      this.dialogueOpen = true;
      this.dlgPages = [text];
      this.dlgVoice = voice;
      this.dlgResolve = null;
      this.dlgChoicesActive = { options, resolve, sel: 0 };
      this.showDialogue(name);
      this.nextPage();
    });
  }

  showDialogue(name) {
    const nm = this.dlg.querySelector('.dlg-name');
    nm.textContent = name || '';
    nm.style.display = name ? '' : 'none';
    nm.style.background = NPC_COLOR[name] || '#5b4a33';
    this.dlg.classList.add('show');
    this.setPrompt(null);
  }

  nextPage() {
    const txt = this.dlgPages.shift();
    const el = this.dlg.querySelector('.dlg-text');
    this.dlg.querySelector('.dlg-next').style.visibility = 'hidden';
    this.dlgChoices.classList.remove('show');
    const chars = Array.from(txt);
    this.typing = { full: txt, chars, i: 0, el };
    el.textContent = '';
    if (this.dlgVoice && this.audio.speak) this.speech = this.audio.speak(txt, this.dlgVoice);
    // speakers reveal their words in step with their babble; narration types briskly
    const tl = this.dlgVoice && this.audio.speechTimeline ? this.audio.speechTimeline(txt, this.dlgVoice) : null;
    const at = tl && tl.at && tl.at.length === chars.length + 1 ? tl.at : null;
    const t0 = performance.now();
    clearInterval(this.typeTimer);
    this.typeTimer = setInterval(() => {
      const T = this.typing;
      if (!T) return;
      const s = (performance.now() - t0) / 1000;
      let i = T.i;
      if (at) while (i < chars.length && at[i] <= s) i++;
      else i = Math.min(chars.length, Math.floor(s * 45));
      if (i !== T.i) { T.i = i; el.textContent = chars.slice(0, i).join(''); }
      if (i >= chars.length) this.finishTyping();
    }, 25);
  }

  finishTyping() {
    clearInterval(this.typeTimer);
    if (!this.typing) return;
    this.typing.el.textContent = this.typing.full;
    this.typing = null;
    if (this.dlgChoicesActive && this.dlgPages.length === 0) this.showChoices();
    else this.dlg.querySelector('.dlg-next').style.visibility = 'visible';
  }

  showChoices() {
    const c = this.dlgChoicesActive;
    this.dlgChoices.innerHTML = '';
    c.options.forEach((o, i) => {
      const b = h('button', 'choice interactive' + (i === c.sel ? ' sel' : ''), o);
      b.addEventListener('mouseenter', () => { if (this.dlgChoicesActive !== c) return; c.sel = i; this.markChoice(); this.audio.sfx('ui_hover', { volume: 0.3 }); });
      b.addEventListener('pointerdown', (e) => { e.stopPropagation(); this.pickChoice(i); });
      this.dlgChoices.appendChild(b);
    });
    this.dlgChoices.classList.add('show');
  }

  markChoice() {
    const c = this.dlgChoicesActive;
    if (!c) return;
    [...this.dlgChoices.children].forEach((b, i) => b.classList.toggle('sel', i === c.sel));
  }

  pickChoice(i) {
    const c = this.dlgChoicesActive;
    if (!c) return;
    this.audio.sfx('ui_click');
    this.dlgChoicesActive = null;
    this.dlgChoices.classList.remove('show');
    this.closeDialogue();
    c.resolve(i);
  }

  advance() {
    if (!this.dialogueOpen) return;
    if (this.typing) { this.finishTyping(); if (this.speech) this.speech.stop(); return; }
    if (this.dlgChoicesActive && this.dlgPages.length === 0) return; // must pick
    if (this.dlgPages.length) { this.audio.sfx('ui_click', { volume: 0.3 }); this.nextPage(); return; }
    this.closeDialogue();
    const r = this.dlgResolve;
    this.dlgResolve = null;
    if (r) r();
  }

  closeDialogue() {
    this.lastClose = performance.now();
    this.mouseLatch = true;
    clearInterval(this.typeTimer);
    this.typing = null;
    if (this.audio.stopSpeak) this.audio.stopSpeak();
    this.dlg.classList.remove('show');
    this.dialogueOpen = false;
  }

  // ------------------------------------------------------------------
  // Modal panels
  open(name, data = {}) {
    if (this.stack.find((p) => p.name === name)) return;
    const panel = buildPanel(name, this, data);
    if (!panel) return;
    this.closeAll();
    this.stack.push(panel);
    this.modal.appendChild(panel.el);
    this.modal.classList.add('show');
    this.audio.sfx('ui_open');
    this.setPrompt(null);
    return panel;
  }

  close() {
    const p = this.stack.pop();
    if (!p) return;
    this.lastClose = performance.now();
    this.mouseLatch = true;
    p.el.remove();
    if (p.onClose) p.onClose();
    if (!this.stack.length) this.modal.classList.remove('show');
    this.audio.sfx('ui_close');
  }

  closeAll() { while (this.stack.length) this.close(); }

  refreshOpenPanel() {
    const p = this.stack[this.stack.length - 1];
    if (p && p.refresh) p.refresh();
  }

  pickItem(title, filter) {
    return new Promise((resolve) => {
      this.open('pick', { title, filter, resolve });
    });
  }

  confirm(text, yes = 'Yes', no = 'No') {
    return this.choose(null, text, [yes, no]).then((i) => i === 0);
  }

  // ------------------------------------------------------------------
  fade(target, dur = 1) {
    return new Promise((resolve) => {
      this.fadeEl.style.transition = `opacity ${dur}s ease`;
      this.fadeEl.classList.toggle('on', target > 0.5);
      setTimeout(resolve, dur * 1000 + 30);
    });
  }

  daySummary(s) { return new Promise((resolve) => this.open('summary', { summary: s, resolve })); }

  narrate(pages, title) { return narrate(this, pages, title); }
  title(opts) { return showTitle(this, opts); }

  morning(s) {
    const g = this.game;
    const L = this.content.LORE || {};
    if (s.reason === 'death') this.toast((L.DEATH_LINES && L.DEATH_LINES[Math.floor(Math.random() * L.DEATH_LINES.length)]) || 'You wake at home, aching. The Gloam took some coins.', 'warn');
    if (s.reason === 'passout') this.toast((L.PASSOUT_LINES && L.PASSOUT_LINES[Math.floor(Math.random() * L.PASSOUT_LINES.length)]) || 'Someone carried you home…', 'warn');
    this.toast(`${SEASON_NAME[g.season]}, day ${g.state.day}. ${WEATHER_ICON[g.state.weather] || ''} ${g.state.weather}.`, 'info');
  }

  // ------------------------------------------------------------------
  onKey(e) {
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
    // keys handled by an open dialogue or panel must not leak into the game next frame
    if ((this.dialogueOpen || this.stack.length) && this.input) this.input.consumeKey(e.code);
    if (this.dialogueOpen) {
      const c = this.dlgChoicesActive;
      if (c && this.dlgPages.length === 0 && !this.typing) {
        if (e.code === 'ArrowDown' || e.code === 'KeyS') { c.sel = (c.sel + 1) % c.options.length; this.markChoice(); this.audio.sfx('ui_hover', { volume: 0.3 }); e.preventDefault(); return; }
        if (e.code === 'ArrowUp' || e.code === 'KeyW') { c.sel = (c.sel - 1 + c.options.length) % c.options.length; this.markChoice(); this.audio.sfx('ui_hover', { volume: 0.3 }); e.preventDefault(); return; }
        if (e.code === 'KeyE' || e.code === 'Enter' || e.code === 'Space') { this.pickChoice(c.sel); e.preventDefault(); return; }
        if (e.code === 'Escape') { this.pickChoice(c.options.length - 1); e.preventDefault(); return; }
        const n = Number(e.key);
        if (n >= 1 && n <= c.options.length) { this.pickChoice(n - 1); return; }
        return;
      }
      if (['KeyE', 'Enter', 'Space', 'Escape'].includes(e.code)) { this.advance(); e.preventDefault(); }
      return;
    }
    if (this.stack.length) {
      const top = this.stack[this.stack.length - 1];
      if (top.onKey && top.onKey(e)) return;
      if (e.code === 'Escape' || (e.code === 'Tab' && top.name === 'inventory') || (e.code === 'KeyI' && top.name === 'inventory') || (e.code === 'KeyC' && top.name === 'crafting') || (e.code === 'KeyM' && top.name === 'map') || (e.code === 'KeyJ' && top.name === 'journal')) {
        if (!top.modal) { this.close(); e.preventDefault(); }
      }
      return;
    }
    if (e.code === 'Escape' && this.game && !this.game.cinematic && !this.fishingUI.active) {
      this.open('pause');
      e.preventDefault();
    }
  }
}
