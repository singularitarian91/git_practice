// Villagers: schedules, wandering, procedural animation, and the whole
// Animal-Crossing-style conversation flow (chat, gifts, requests, roles).
import * as THREE from 'three';
import { VILLAGERS, DEBT_START, LONGHOUSE_COST } from '../data/world_data.js';
import { ITEMS, isFish, isBug, isRelic, FISH, BUGS, RELICS } from '../data/items.js';
import { DECOR, LOC } from './worldmap.js';
import { findPart, approachAngle, angleDiff, inHours, pick, fillTokens } from './util.js';
import { lerp } from '../engine/noise.js';

// "3 Turnip" → "3 Turnips" (mass nouns and already-plural names stay put)
const MASS = new Set(['Wood', 'Stone', 'Flint', 'Copper Ore', 'Iron Ore', 'Resin', 'Fiber', 'Coal', 'Gloam Essence', 'Barley', 'Flax', 'Nightshade', 'Raw Venison', 'Thistle']);
export function plural(name, qty) {
  if (qty <= 1 || MASS.has(name) || /s$/.test(name) || / (Perch|Pike|Carp|Cod|Herring|Mackerel|Hagfish|Eel)$/.test(name)) return name;
  if (/[^aeiou]y$/.test(name)) return name.slice(0, -1) + 'ies';
  if (/(sh|ch|x)$/.test(name)) return name + 'es';
  return name + 's';
}

const FALLBACK = {
  intro: 'Oh! A new face on Gloamhollow.|Welcome, {player}.',
  greet: { morning: ['Good morning, {player}.'], day: ['Hello, {player}.'], evening: ['Evening, {player}.'], night: ['Out late, {player}?'] },
  chat: ['The mist is thick today.', 'Keep a fire burning, friend.'],
  gift: { loved: ['Oh! {item}! I adore it!'], liked: ['{item}? How kind.'], neutral: ['Thank you for the {item}.'], disliked: ['Er… {item}. Thanks, I suppose.'], already: ["You've already given me something today."] },
  request: { ask: ['Could you bring me {qty} {item}?'], thanks: ['Wonderful! Thank you!'], pending: ['Still hoping for {qty} {item}…'] },
};

export class NPCs {
  constructor(game) {
    this.game = game;
    this.D = (game.content && game.content.DIALOGUE) || {};
    this.list = [];
    this.byId = {};
    for (const [id, cfg] of Object.entries(VILLAGERS)) {
      const n = new NPC(game, id, cfg);
      this.list.push(n);
      this.byId[id] = n;
    }
    this.lanternPosts = DECOR.filter((d) => d.model === 'lantern_post').map((d) => ({ x: d.x, z: d.z }));
    for (const n of this.list) n.initPlacement(this);
    this.setupDoors();
  }

  setupDoors() {
    const g = this.game;
    // your own door: sleep
    const home = g.world.buildings.get('home');
    const homeDoor = () => {
      const b = g.world.buildings.get('home');
      return b.obj.userData.doorPos || new THREE.Vector3(b.x + 3, 0, b.z);
    };
    g.world.addInteractable({
      x: () => homeDoor().x, z: () => homeDoor().z, r: 1.2, priority: 0.2,
      label: () => 'Sleep (end the day)',
      act: () => g.sleep(),
    });
    // villagers' doors: knock when they're home
    for (const n of this.list) {
      const b = g.world.buildings.get(n.cfg.house);
      if (!b || !b.obj.userData.doorPos || n.id === 'corvin' || n.id === 'morrow') continue;
      const dp = b.obj.userData.doorPos;
      g.world.addInteractable({
        x: dp.x, z: dp.z, r: 1.0, priority: -0.2,
        enabled: () => !n.visible,
        label: () => `Knock on ${n.cfg.name}'s door`,
        act: () => {
          g.audio.sfx('door');
          const late = g.hour >= 22 || g.hour < 6;
          g.ui.say(n.cfg.name, [late ? `(${n.cfg.name} seems to be asleep. Zzz…)` : `(No answer. ${n.cfg.name} must be out.)`], null);
        },
      });
    }
  }

  line(id, path, tokens = {}) {
    const D = this.D[id] || {};
    let v = D;
    for (const k of path.split('.')) v = v && v[k];
    if (v == null) {
      v = FALLBACK;
      for (const k of path.split('.')) v = v && v[k];
    }
    if (Array.isArray(v)) v = pick(v);
    if (v == null) return '…';
    return fillTokens(String(v), { player: this.game.state.name, season: this.game.season, weather: this.game.state.weather, day: this.game.state.day, npc: VILLAGERS[id].name, ...tokens });
  }

  pages(text) { return text.split('|').map((s) => s.trim()).filter(Boolean); }

  update(dt) { for (const n of this.list) n.update(dt, this); }

  onHour(h) { for (const n of this.list) n.replan(this); }

  newDay(rnd) {
    const st = this.game.state;
    for (const n of this.list) {
      const s = st.npcs[n.id];
      // new requests now and then
      if (s.met && !s.request && rnd() < 0.4) {
        const want = n.cfg.requests[Math.floor(rnd() * n.cfg.requests.length)];
        const it = ITEMS[want];
        const qty = it.cat === 'fish' || it.cat === 'food' ? 1 : it.price >= 20 ? 2 : 3 + Math.floor(rnd() * 5);
        s.request = { id: want, qty, day: st.totalDays, asked: false };
      }
      if (s.request && st.totalDays - s.request.day > 5) s.request = null;
    }
    for (const n of this.list) n.replan(this, true);
  }

  onItemGained() {}

  // ------------------------------------------------------------------
  // Conversations
  async talk(n) {
    const g = this.game;
    const ui = g.ui;
    const st = g.state.npcs[n.id];
    const name = n.cfg.name;
    const voice = n.cfg.voice;
    const today = g.state.totalDays;
    n.talking = true;
    n.faceToward(g.player.pos.x, g.player.pos.z);
    g.player.facing = Math.atan2(n.pos.x - g.player.pos.x, n.pos.z - g.player.pos.z);
    try {
      if (!st.met) {
        st.met = true;
        st.talkedDay = today;
        st.fp += 10;
        await ui.say(name, this.pages(this.line(n.id, 'intro')), voice);
        await this.roleIntro(n);
        return;
      }
      const hour = g.hour % 24;
      const tod = hour < 11 ? 'morning' : hour < 17 ? 'day' : hour < 21 ? 'evening' : 'night';
      let greeting = this.line(n.id, `greet.${tod}`);
      for (;;) {
        const opts = [];
        opts.push({ label: 'Chat', fn: () => this.chat(n) });
        opts.push({ label: 'Give a gift', fn: () => this.gift(n) });
        if (st.request) opts.push({ label: st.request.asked ? `About your request (${st.request.qty} ${plural(ITEMS[st.request.id].name, st.request.qty)})` : 'Need anything?', fn: () => this.request(n) });
        for (const r of this.roleOptions(n)) opts.push(r);
        opts.push({ label: 'Goodbye', fn: null });
        const i = await ui.choose(name, greeting, opts.map((o) => o.label), voice);
        const o = opts[i];
        if (!o || !o.fn) break;
        const again = await o.fn();
        if (again === 'close') break;
        greeting = 'Anything else?';
      }
    } finally {
      n.talking = false;
    }
  }

  async chat(n) {
    const g = this.game;
    const st = g.state.npcs[n.id];
    const today = g.state.totalDays;
    let text;
    const hearts = Math.floor(st.fp / 100);
    const told = st.heartsTold || 0;
    const levels = [2, 4, 6, 8, 10].filter((l) => l <= hearts && l > told);
    const D = this.D[n.id] || {};
    if (levels.length && D.hearts && D.hearts[levels[0]]) {
      text = this.line(n.id, `hearts.${levels[0]}`);
      st.heartsTold = levels[0];
    } else {
      const r = Math.random();
      const done = g.state.offeringsDone.length;
      if (g.state.ending && D.hearth && D.hearth.dawn && r < 0.3) text = this.line(n.id, 'hearth.dawn');
      else if (done > 0 && (st.hearthSeen || 0) < done && D.hearth && D.hearth[done]) { text = this.line(n.id, `hearth.${done}`); st.hearthSeen = done; }
      else if (r < 0.2 && D.weather && D.weather[g.state.weather]) text = this.line(n.id, `weather.${g.state.weather}`);
      else if (r < 0.35 && D.season) text = this.line(n.id, `season.${g.season}`);
      else text = this.line(n.id, 'chat');
    }
    if (st.talkedDay !== today) { st.talkedDay = today; this.addFp(n, 10); }
    await g.ui.say(n.cfg.name, this.pages(text), n.cfg.voice);
  }

  taste(n, id) {
    const it = ITEMS[id];
    const m = (list) => list.some((e) => (typeof e === 'string' ? e === id : e.cat === it.cat));
    if (m(n.cfg.loved)) return 'loved';
    if (m(n.cfg.disliked)) return 'disliked';
    if (m(n.cfg.liked)) return 'liked';
    return 'neutral';
  }

  async gift(n) {
    const g = this.game;
    const st = g.state.npcs[n.id];
    if (st.giftDay === g.state.totalDays) {
      await g.ui.say(n.cfg.name, this.pages(this.line(n.id, 'gift.already')), n.cfg.voice);
      return;
    }
    const slot = await g.ui.pickItem(`Give a gift to ${n.cfg.name}`, (s) => ITEMS[s.id] && ITEMS[s.id].cat !== 'tool' && ITEMS[s.id].cat !== 'special');
    if (slot == null) return;
    const s = g.inventory.slots[slot];
    if (!s) return;
    const id = s.id;
    g.inventory.removeAt(slot, 1);
    st.giftDay = g.state.totalDays;
    const t = this.taste(n, id);
    const fp = { loved: 80, liked: 45, neutral: 20, disliked: -20 }[t];
    this.addFp(n, fp);
    g.audio.sfx(t === 'disliked' ? 'ui_error' : 'gift');
    if (t === 'loved' || t === 'liked') g.effects.burst('hearts', new THREE.Vector3(n.pos.x, n.pos.y + 1.8, n.pos.z));
    n.emote = t === 'disliked' ? 'sad' : 'happy';
    n.emoteT = 1.5;
    await g.ui.say(n.cfg.name, this.pages(this.line(n.id, `gift.${t}`, { item: ITEMS[id].name })), n.cfg.voice);
  }

  async request(n) {
    const g = this.game;
    const st = g.state.npcs[n.id];
    const r = st.request;
    const tok = { item: plural(ITEMS[r.id].name, r.qty), qty: r.qty };
    if (!r.asked) {
      r.asked = true;
      await g.ui.say(n.cfg.name, this.pages(this.line(n.id, 'request.ask', tok)), n.cfg.voice);
      g.toast(`New request: ${r.qty} ${plural(ITEMS[r.id].name, r.qty)} for ${n.cfg.name}`, 'quest');
      return;
    }
    if (g.inventory.count(r.id) >= r.qty) {
      const ok = await g.ui.confirm(`Give ${r.qty} ${ITEMS[r.id].name} to ${n.cfg.name}?`, 'Hand over', 'Not yet');
      if (!ok) return;
      g.inventory.remove(r.id, r.qty);
      const reward = Math.round(ITEMS[r.id].price * r.qty * 1.6 + 60);
      g.state.coins += reward;
      st.request = null;
      this.addFp(n, 60);
      g.audio.sfx('quest_complete');
      g.effects.burst('sparkle', new THREE.Vector3(n.pos.x, n.pos.y + 1.5, n.pos.z));
      n.emote = 'happy'; n.emoteT = 2;
      await g.ui.say(n.cfg.name, this.pages(this.line(n.id, 'request.thanks', tok)), n.cfg.voice);
      g.toast(`Request complete! +${reward} coins`, 'coins');
    } else {
      await g.ui.say(n.cfg.name, this.pages(this.line(n.id, 'request.pending', tok)), n.cfg.voice);
    }
  }

  addFp(n, v) {
    const st = this.game.state.npcs[n.id];
    const before = Math.floor(st.fp / 100);
    st.fp = Math.max(0, Math.min(1000, st.fp + v));
    const after = Math.floor(st.fp / 100);
    if (after > before) {
      this.game.toast(`${n.cfg.name}: ${'♥'.repeat(after)} (${after} heart${after > 1 ? 's' : ''})`, 'heart');
      this.game.audio.sfx('friendship');
    }
  }

  roleOptions(n) {
    const g = this.game;
    const st = g.state;
    const out = [];
    const say = (path, tok) => g.ui.say(n.cfg.name, this.pages(this.line(n.id, path, tok)), n.cfg.voice);
    if (n.id === 'corvin') {
      if (n.atPost) out.push({ label: 'Browse wares', fn: () => { g.ui.open('shop'); return 'close'; } });
      if (st.debt > 0) out.push({ label: `Pay debt (${st.debt.toLocaleString()} owed)`, fn: () => this.payDebt(n) });
      if (st.debt <= 0 && st.house === 'hut' && !st.houseUpgradeDay) out.push({ label: 'About a bigger home…', fn: () => this.offerLonghouse(n) });
      out.push({ label: 'How does the tithe crate work?', fn: () => say('role.tithe_crate') });
    }
    if (n.id === 'morrow') {
      out.push({ label: 'Donate to the Barrow', fn: () => this.donate(n) });
      out.push({ label: 'View the collection', fn: () => { g.ui.open('museum'); return 'close'; } });
    }
    if (n.id === 'bramble') out.push({ label: 'Upgrade tools', fn: () => { g.ui.open('forge'); return 'close'; } });
    if (n.id === 'grenna') {
      out.push({ label: 'Ask about the Hearth', fn: () => say(st.offeringsDone.length >= 6 ? 'role.final_rite' : 'role.offerings_intro') });
      if (st.flags.recipe_cauldron) out.push({ label: 'Cooking advice', fn: () => say('role.cooking_hint') });
    }
    if (n.id === 'fennick') {
      out.push({ label: 'Any fishing tips?', fn: () => say(g.season === 'winter' && Math.random() < 0.5 ? 'role.sovereign_legend' : 'role.fishing_tips') });
    }
    return out;
  }

  async roleIntro(n) {
    const g = this.game;
    const say = (path, tok) => g.ui.say(n.cfg.name, this.pages(this.line(n.id, path, tok)), n.cfg.voice);
    if (n.id === 'fennick') {
      await say('role.give_rod');
      this.giveItem('tool_rod');
    } else if (n.id === 'mothwyn') {
      await say('role.give_net');
      this.giveItem('tool_net');
    } else if (n.id === 'grenna') {
      await say('role.offerings_intro');
      g.state.flags.offerings_known = true;
      g.toast('New goal: rekindle the Great Hearth with six offerings.', 'quest');
    } else if (n.id === 'corvin') {
      await say('role.debt_explain');
      await say('role.tithe_crate');
      g.toast(`Goal: pay Corvin back ${DEBT_START.toLocaleString()} coins.`, 'quest');
    } else if (n.id === 'morrow') {
      await say('role.barrow_intro');
    }
  }

  giveItem(id) {
    const g = this.game;
    const left = g.inventory.add(id, 1);
    if (left) g.drops.spawn(id, 1, g.player.pos.clone());
    g.ui.pickup(id, 1, true);
    g.audio.sfx('quest_complete');
  }

  async payDebt(n) {
    const g = this.game;
    const st = g.state;
    const opts = [100, 500, 1000].filter((v) => v < st.debt && v <= st.coins);
    const all = Math.min(st.debt, st.coins);
    const labels = opts.map((v) => `${v} coins`);
    if (all > 0) labels.push(`All I can (${all})`);
    labels.push('Never mind');
    const i = await g.ui.choose(n.cfg.name, `You owe ${st.debt.toLocaleString()} coins. You carry ${st.coins.toLocaleString()}.`, labels, n.cfg.voice);
    let amount = 0;
    if (i < opts.length) amount = opts[i];
    else if (all > 0 && i === opts.length) amount = all;
    if (amount <= 0) {
      if (st.coins <= 0) await g.ui.say(n.cfg.name, this.pages(this.line(n.id, 'role.broke')), n.cfg.voice);
      return;
    }
    st.coins -= amount;
    st.debt -= amount;
    g.audio.sfx('coin');
    if (st.debt <= 0) {
      st.debt = 0;
      this.addFp(n, 100);
      await g.ui.say(n.cfg.name, this.pages(this.line(n.id, 'role.debt_paid_full')), n.cfg.voice);
      g.toast('Debt repaid! The croft is truly yours.', 'quest');
      g.audio.sfx('quest_complete');
    } else {
      await g.ui.say(n.cfg.name, this.pages(this.line(n.id, 'role.debt_paid_partial', { coins: st.debt.toLocaleString() })), n.cfg.voice);
    }
  }

  async offerLonghouse(n) {
    const g = this.game;
    const st = g.state;
    await g.ui.say(n.cfg.name, this.pages(this.line(n.id, 'role.longhouse_offer')), n.cfg.voice);
    const i = await g.ui.choose(n.cfg.name, `A longhouse for ${LONGHOUSE_COST.toLocaleString()} coins?`, [`Build it (${LONGHOUSE_COST.toLocaleString()})`, 'Maybe later'], n.cfg.voice);
    if (i !== 0) return;
    if (st.coins < LONGHOUSE_COST) {
      await g.ui.say(n.cfg.name, this.pages(this.line(n.id, 'role.broke')), n.cfg.voice);
      return;
    }
    st.coins -= LONGHOUSE_COST;
    st.houseUpgradeDay = st.totalDays + 1;
    g.audio.sfx('buy');
    await g.ui.say(n.cfg.name, ['Splendid. My crew works quickly — by tomorrow\'s dawn, it will stand.'], n.cfg.voice);
  }

  async donate(n) {
    const g = this.game;
    const st = g.state;
    const can = (s) => (isFish(s.id) || isBug(s.id) || isRelic(s.id)) && !st.museum[s.id];
    if (!g.inventory.slots.some((s) => s && can(s))) {
      await g.ui.say(n.cfg.name, this.pages(this.line(n.id, 'role.nothing_to_donate')), n.cfg.voice);
      return;
    }
    const slot = await g.ui.pickItem('Donate to the Barrow', can);
    if (slot == null) return;
    const s = g.inventory.slots[slot];
    if (!s) return;
    const id = s.id;
    g.inventory.removeAt(slot, 1);
    st.museum[id] = st.totalDays;
    g.audio.sfx('quest_complete');
    this.addFp(n, 15);
    const lore = g.content && g.content.LORE && g.content.LORE.MUSEUM_TEXT && g.content.LORE.MUSEUM_TEXT[id];
    const pages = [];
    if (isBug(id)) pages.push(...this.pages(this.line(n.id, 'role.bug_shudder')));
    pages.push(...this.pages(lore || this.line(n.id, 'role.donate_new', { item: ITEMS[id].name })));
    await g.ui.say(n.cfg.name, pages, n.cfg.voice);
    const all = (obj) => Object.keys(obj).every((k) => st.museum[k]);
    if (isFish(id) && all(FISH)) await g.ui.say(n.cfg.name, this.pages(this.line(n.id, 'role.collection_fish_done')), n.cfg.voice);
    if (isBug(id) && all(BUGS)) await g.ui.say(n.cfg.name, this.pages(this.line(n.id, 'role.collection_bugs_done')), n.cfg.voice);
    if (isRelic(id) && all(RELICS)) await g.ui.say(n.cfg.name, this.pages(this.line(n.id, 'role.collection_relics_done')), n.cfg.voice);
  }
}

// ----------------------------------------------------------------------
class NPC {
  constructor(game, id, cfg) {
    this.game = game;
    this.id = id;
    this.cfg = cfg;
    this.obj = game.lib.clone(cfg.model);
    this.obj.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    game.engine.scene.add(this.obj);
    const P = (k) => findPart(this.obj, k);
    this.parts = {
      body: P('body'), head: P('head'), armL: P('arm_l'), armR: P('arm_r'), legL: P('leg_l'), legR: P('leg_r'),
      tail: P('tail'), wingL: P('wing_l'), wingR: P('wing_r'), antL: P('antenna_l'), antR: P('antenna_r'), earL: P('ear_l'), earR: P('ear_r'),
    };
    this.rest = {};
    for (const [k, o] of Object.entries(this.parts)) if (o) this.rest[k] = { p: o.position.clone(), r: o.rotation.clone() };
    this.pos = new THREE.Vector3();
    this.facing = 0;
    this.goal = null;
    this.visible = true;
    this.speed = 0;
    this.phase = Math.random() * 10;
    this.wanderT = 0;
    this.talking = false;
    this.block = null;
    this.stuckT = 0;
    this.lastPos = new THREE.Vector3();
    this.emote = null;
    this.emoteT = 0;
    this.workT = 0;
    this.lanternIdx = 0;
    this.atPost = false;
    if (id === 'fennick' && game.lib.has('tool_rod')) {
      const hand = findPart(this.obj, 'hand_r');
      if (hand) {
        const rod = game.lib.clone('tool_rod');
        rod.rotation.set(Math.PI / 2 - 0.5 - Math.PI, 0, 0);
        hand.add(rod);
        this.rod = rod;
        rod.visible = false;
      }
    }
    // interaction
    game.world.addInteractable({
      x: () => this.pos.x, z: () => this.pos.z, r: 1.1, priority: 0.5,
      enabled: () => this.visible && !this.talking,
      label: () => `Talk to ${cfg.name}`,
      act: () => game.npcs.talk(this),
    });
  }

  currentBlock() {
    const h = this.game.hour % 24;
    const st = this.game.state;
    if (this.id === 'corvin' && st.totalDays === 1 && h < 9.5 && !st.npcs.corvin.met) return [6, 9.5, 'croft_welcome', 'stand'];
    for (const b of this.cfg.schedule) if (inHours(h, b[0], b[1])) return b;
    return null;
  }

  // Resolve a schedule place into a target point (+ facing, wander radius)
  placeTarget(place, npcs) {
    const g = this.game;
    const W = g.world;
    const B = (id) => W.buildings.get(id);
    const rnd = Math.random;
    switch (place) {
      case 'shop': {
        const b = B('shop');
        const back = -1.3;
        return { x: b.x + Math.sin(b.rot) * back, z: b.z + Math.cos(b.rot) * back, face: b.rot, r: 0 };
      }
      case 'barrow': {
        const b = B('barrow');
        const d = b.obj.userData.doorPos || new THREE.Vector3(b.x, 0, b.z + 6);
        return { x: d.x + 2.4, z: d.z + 0.6, face: b.rot, r: 0 };
      }
      case 'croft_welcome': return { x: LOC.spawn.x + 3.5, z: LOC.spawn.z + 1.5, face: -Math.PI / 2, r: 0 };
      case 'forge': return { x: -18.8, z: -7.6, face: Math.atan2(-17.5 + 18.8, -9 + 7.6), r: 0, work: true };
      case 'green': { const a = rnd() * 6.28, r = 6 + rnd() * 6; return { x: Math.cos(a) * r, z: Math.sin(a) * r, r: 5 }; }
      case 'hearth': { const a = rnd() * 6.28; return { x: Math.cos(a) * 4.6, z: Math.sin(a) * 4.6, face: Math.atan2(-Math.cos(a), -Math.sin(a)), r: 0 }; }
      case 'meadow': return { x: LOC.meadow.x + (rnd() - 0.5) * 20, z: LOC.meadow.z + (rnd() - 0.5) * 20, r: 8 };
      case 'forest_edge': return { x: 26 + (rnd() - 0.5) * 10, z: -34 + (rnd() - 0.5) * 8, r: 6 };
      case 'home_yard': {
        const b = B(this.cfg.house);
        const d = (b && b.obj.userData.doorPos) || new THREE.Vector3(b ? b.x : 0, 0, b ? b.z + 3 : 0);
        return { x: d.x + (rnd() - 0.5) * 4, z: d.z + (rnd() - 0.5) * 4, r: 2.5 };
      }
      case 'lanterns': {
        const L = npcs.lanternPosts;
        const p = L[this.lanternIdx % L.length];
        return { x: p.x + 1.0, z: p.z + 0.6, face: Math.atan2(-1.0, -0.6), r: 0, lantern: true };
      }
      case 'sea_dock': {
        const b = B('sea_dock');
        const e = b.obj.userData.deckEnd;
        return e ? { x: e.x, z: e.z - 0.4, face: b.rot, r: 0, fish: true } : { x: b.x, z: b.z, r: 0 };
      }
      case 'beach': return { x: 8 + (rnd() - 0.5) * 18, z: 74 + (rnd() - 0.5) * 8, r: 6 };
      default: return { x: 0, z: 0, r: 5 };
    }
  }

  homeDoor() {
    const b = this.game.world.buildings.get(this.cfg.house);
    if (!b) return new THREE.Vector3();
    return b.obj.userData.doorPos ? b.obj.userData.doorPos.clone() : new THREE.Vector3(b.x, 0, b.z);
  }

  initPlacement(npcs) {
    const blk = this.currentBlock();
    this.block = blk;
    if (blk) {
      const t = this.placeTarget(blk[2], npcs);
      this.pos.set(t.x, 0, t.z);
      this.goal = t;
      this.facing = t.face ?? 0;
      this.setVisible(true);
    } else {
      this.pos.copy(this.homeDoor());
      this.setVisible(false);
    }
    this.pos.y = this.game.world.groundY(this.pos.x, this.pos.z);
  }

  setVisible(v) { this.visible = v; this.obj.visible = v; }

  replan(npcs, morning = false) {
    const blk = this.currentBlock();
    const same = blk && this.block && blk[2] === this.block[2];
    this.block = blk;
    if (!blk) { this.goal = { ...this.homeDoor(), r: 0, home: true }; return; }
    if (same && !morning) return;
    const t = this.placeTarget(blk[2], npcs);
    if (!this.visible || morning) {
      // appear at home, or snap if very far and out of sight
      const door = this.homeDoor();
      this.pos.set(door.x, 0, door.z);
      if (this.id === 'corvin' || this.id === 'morrow' || morning) this.pos.set(t.x, 0, t.z);
      this.pos.y = this.game.world.groundY(this.pos.x, this.pos.z);
      this.setVisible(true);
    }
    this.goal = t;
  }

  faceToward(x, z) { this.facing = Math.atan2(x - this.pos.x, z - this.pos.z); }

  update(dt, npcs) {
    const g = this.game;
    this.phase += dt;
    if (!this.block && !this.goal) this.replan(npcs);
    if (!this.visible) return;
    const p = g.player.pos;
    const distPlayer = Math.hypot(p.x - this.pos.x, p.z - this.pos.z);
    let moving = false;
    this.atPost = false;
    if (this.talking) {
      this.facing = approachAngle(this.facing, Math.atan2(p.x - this.pos.x, p.z - this.pos.z), dt * 8);
    } else if (this.goal) {
      const dx = this.goal.x - this.pos.x, dz = this.goal.z - this.pos.z;
      const d = Math.hypot(dx, dz);
      if (d > 0.35) {
        // walk
        const sp = (this.id === 'bramble' ? 2.0 : this.id === 'grenna' ? 1.4 : 2.1) * (d > 30 ? 1.6 : 1);
        const step = Math.min(d, sp * dt);
        const next = new THREE.Vector3(this.pos.x + (dx / d) * step, 0, this.pos.z + (dz / d) * step);
        g.colliders.resolve(next, 0.3);
        if (g.engine.terrain.heightAt(next.x, next.z) < -0.4 && !g.colliders.platformAt(next.x, next.z)) { next.x = this.pos.x; next.z = this.pos.z; }
        this.pos.x = next.x; this.pos.z = next.z;
        this.facing = approachAngle(this.facing, Math.atan2(dx, dz), dt * 6);
        moving = true;
        // stuck?
        this.stuckT += dt;
        if (this.stuckT > 1.5) {
          if (this.pos.distanceTo(this.lastPos) < 0.4) {
            const far = distPlayer > 30;
            if (far || this.stuckCount > 3) { this.pos.set(this.goal.x, 0, this.goal.z); this.stuckCount = 0; }
            else {
              // sidestep
              this.stuckCount = (this.stuckCount || 0) + 1;
              const a = Math.atan2(dx, dz) + (Math.random() < 0.5 ? 1.2 : -1.2);
              this.pos.x += Math.sin(a) * 0.8; this.pos.z += Math.cos(a) * 0.8;
            }
          } else this.stuckCount = 0;
          this.stuckT = 0;
          this.lastPos.copy(this.pos);
        }
        // teleport long trips when nobody is watching
        if (d > 45 && distPlayer > 45) { this.pos.set(this.goal.x, 0, this.goal.z); }
      } else {
        if (this.goal.home) { this.setVisible(false); this.goal = null; return; }
        if (this.goal.face != null) this.facing = approachAngle(this.facing, this.goal.face, dt * 4);
        this.atPost = true;
        // wander within the area
        this.wanderT -= dt;
        if (this.goal.r > 0 && this.wanderT <= 0) {
          this.wanderT = 4 + Math.random() * 7;
          const a = Math.random() * 6.28;
          const base = this.block ? this.placeTarget(this.block[2], npcs) : this.goal;
          this.goal = { ...base, x: base.x + Math.cos(a) * Math.random() * base.r * 0.6, z: base.z + Math.sin(a) * Math.random() * base.r * 0.6 };
        }
        if (this.goal.lantern) {
          this.wanderT -= 0;
          this.lanternT = (this.lanternT || 0) + dt;
          if (this.lanternT > 4) {
            this.lanternT = 0;
            this.lanternIdx++;
            g.effects.burst('sparkle', new THREE.Vector3(this.goal.x - 1, this.pos.y + 2.2, this.goal.z - 0.6), { n: 6 });
            this.goal = this.placeTarget('lanterns', npcs);
          }
        }
        // glance at a nearby player
        if (distPlayer < 5 && this.goal.face == null) this.facing = approachAngle(this.facing, Math.atan2(p.x - this.pos.x, p.z - this.pos.z), dt * 3);
      }
    }
    const gy = g.world.groundY(this.pos.x, this.pos.z);
    this.pos.y += (gy - this.pos.y) * Math.min(1, dt * 12);
    this.speed = lerp(this.speed, moving ? 1 : 0, 1 - Math.exp(-dt * 8));
    if (this.rod) this.rod.visible = !!(this.goal && this.goal.fish && this.atPost);
    // Bramble's hammering sparks
    if (this.goal && this.goal.work && this.atPost) {
      this.workT += dt;
      if (this.workT > 1.1) {
        this.workT = 0;
        if (distPlayer < 25) {
          g.audio.sfx('pick_stone', { x: this.pos.x, z: this.pos.z, pitch: 1.4, volume: 0.5 });
          g.effects.burst('ember', new THREE.Vector3(-17.5, this.pos.y + 0.9, -9), { n: 8 });
        }
      }
    }
    this.emoteT = Math.max(0, this.emoteT - dt);
    this.animate(dt);
  }

  animate(dt) {
    const P = this.parts, R = this.rest;
    const set = (k, rx, ry, rz, py) => {
      const o = P[k];
      if (!o) return;
      o.rotation.set(R[k].r.x + (rx || 0), R[k].r.y + (ry || 0), R[k].r.z + (rz || 0));
      if (py != null) o.position.y = R[k].p.y + py;
    };
    const t = this.phase;
    const w = this.speed;
    const s = Math.sin(t * 8.5);
    let armR = -s * 0.45 * w, armL = s * 0.45 * w;
    let bodyX = 0.04 * w, bob = Math.abs(Math.cos(t * 8.5)) * 0.04 * w + Math.sin(t * 2.1) * 0.01;
    let headX = Math.sin(t * 0.7) * 0.04, headY = Math.sin(t * 0.43) * 0.12 * (1 - w);
    if (this.talking) { headX = Math.sin(t * 7) * 0.06; armR = -0.4 + Math.sin(t * 3) * 0.25; }
    if (this.goal && this.goal.work && this.atPost && !this.talking) {
      const u = (this.workT / 1.1);
      armR = u < 0.6 ? -2.4 * (u / 0.6) : -2.4 + (u - 0.6) / 0.4 * 2.0;
      bodyX = 0.15;
    }
    if (this.goal && this.goal.fish && this.atPost && !this.talking) { armR = -1.0 + Math.sin(t * 1.3) * 0.05; armL = -0.7; }
    if (this.goal && this.goal.lantern && this.atPost && !this.talking) { armR = -2.6 + Math.sin(t * 2) * 0.1; headX = -0.35; }
    if (this.emoteT > 0) {
      if (this.emote === 'happy') { bob += Math.abs(Math.sin(t * 12)) * 0.12; armL = -2.4; armR = -2.4; }
      else { headX = 0.4; bodyX = 0.15; }
    }
    set('legL', s * 0.6 * w, 0, 0);
    set('legR', -s * 0.6 * w, 0, 0);
    set('armL', armL, 0, 0.08);
    set('armR', armR, 0, -0.08);
    set('body', bodyX, 0, Math.cos(t * 8.5) * 0.03 * w, bob);
    set('head', headX, headY, 0);
    if (P.tail) set('tail', 0, Math.sin(t * 3) * 0.35, 0);
    if (P.wingL) { const f = Math.sin(t * (w > 0.3 ? 14 : 2.2)) * (w > 0.3 ? 0.4 : 0.12); set('wingL', 0, f, 0); set('wingR', 0, -f, 0); }
    if (P.antL) { set('antL', Math.sin(t * 5) * 0.08, 0, 0); set('antR', Math.sin(t * 5 + 1) * 0.08, 0, 0); }
    if (P.earL) { set('earL', 0, 0, Math.max(0, Math.sin(t * 0.9)) * 0.15); set('earR', 0, 0, -Math.max(0, Math.sin(t * 0.9 + 2)) * 0.15); }
    this.obj.position.copy(this.pos);
    this.obj.rotation.y = this.facing;
  }
}
