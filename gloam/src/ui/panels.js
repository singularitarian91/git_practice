// Modal panels: inventory, crafting, shop, tithe crate, chest, museum,
// hearth offerings, forge, journal, map, help, pause/settings, item picker,
// and the end-of-day summary.
import { ITEMS, CROPS, FISH, BUGS, RELICS, TOOLS, isFish, isBug, isRelic } from '../data/items.js';
import { RECIPES, UPGRADES, UPGRADABLE } from '../data/recipes.js';
import { SHOP, OFFERINGS, VILLAGERS, DEBT_START } from '../data/world_data.js';
import { saveGame, saveSettings, SEASON_DAYS } from '../game/state.js';
import { getMapBase, homePos, MAP_LABELS } from './mapbase.js';

const h = (tag, cls, html) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;
  return e;
};
const SEASON_NAME = { spring: 'Thaw', summer: 'Brightwane', autumn: 'Rotfall', winter: 'Deepfrost' };

// ---------------------------------------------------------------------
let tip = null;
function tooltip(ui) {
  if (!tip) {
    tip = h('div', 'tooltip');
    document.body.appendChild(tip);
    window.addEventListener('mousemove', (e) => {
      tip.style.left = Math.min(innerWidth - 260, e.clientX + 16) + 'px';
      tip.style.top = Math.min(innerHeight - 120, e.clientY + 12) + 'px';
    });
  }
  return tip;
}
function showTip(ui, id, extra = '') {
  const t = tooltip(ui);
  const it = ITEMS[id];
  if (!it) return;
  const g = ui.game;
  const lvl = g && g.state.tools[id];
  const edible = it.edible ? `<div class="tt-eat">♥ +${it.edible.hp || 0}  ⚡ +${it.edible.stamina || 0}${it.edible.buff ? ` · ${it.edible.buff[0]}` : ''}</div>` : '';
  const price = it.price && it.cat !== 'tool' ? `<div class="tt-price">◉ ${it.price}</div>` : '';
  t.innerHTML = `<div class="tt-name">${it.name}${lvl ? ` <span class="tt-lvl">${['', 'Copper', 'Iron'][lvl]}</span>` : ''}</div><div class="tt-cat">${catName(it.cat)}</div><div class="tt-desc">${ui.itemText(id)}</div>${edible}${price}${extra}`;
  t.classList.add('show');
}
function hideTip() { if (tip) tip.classList.remove('show'); }

function catName(c) {
  return { material: 'Material', crop: 'Crop', seed: 'Seeds', forage: 'Forage', fish: 'Fish', bug: 'Bug', relic: 'Relic', food: 'Food', tool: 'Tool', place: 'Placeable', decor: 'Decoration', special: 'Special' }[c] || c;
}

function frame(ui, title, cls = '') {
  const el = h('div', `panel ${cls}`);
  el.innerHTML = `<div class="panel-head"><h2>${title}</h2><button class="x interactive" title="Close (Esc)">✕</button></div><div class="panel-body"></div>`;
  el.querySelector('.x').addEventListener('click', () => ui.close());
  el.addEventListener('pointerdown', (e) => e.stopPropagation());
  return { el, body: el.querySelector('.panel-body'), head: el.querySelector('.panel-head') };
}

function slotEl(ui, s, { onClick, onRight, extra, dim } = {}) {
  const el = h('div', 'islot interactive' + (s ? '' : ' empty') + (dim ? ' dim' : ''));
  if (s) {
    el.innerHTML = `<img src="${ui.icons.get(s.id)}" alt=""><span class="n">${s.n > 1 ? s.n : ''}</span>`;
    el.addEventListener('mouseenter', () => showTip(ui, s.id, extra ? extra(s) : ''));
    el.addEventListener('mouseleave', hideTip);
  }
  if (onClick) el.addEventListener('click', (e) => { hideTip(); onClick(e); });
  if (onRight) el.addEventListener('contextmenu', (e) => { e.preventDefault(); hideTip(); onRight(e); });
  return el;
}

function ingredientHave(g, ing) {
  const [id, n] = ing;
  const have = typeof id === 'string' ? g.inventory.count(id) : g.inventory.countMatch(id);
  const name = typeof id === 'string' ? ITEMS[id].name : `Any ${catName(id.cat).toLowerCase()}`;
  const icon = typeof id === 'string' ? id : Object.keys(ITEMS).find((k) => ITEMS[k].cat === id.cat);
  return { have, need: n, name, icon, ok: have >= n };
}

// ---------------------------------------------------------------------
export function buildPanel(name, ui, data) {
  const g = ui.game;
  switch (name) {
    case 'inventory': return inventoryPanel(ui, g);
    case 'crafting': return craftingPanel(ui, g, data);
    case 'shop': return shopPanel(ui, g);
    case 'crate': return cratePanel(ui, g);
    case 'chest': return chestPanel(ui, g, data);
    case 'museum': return museumPanel(ui, g);
    case 'hearth': return hearthPanel(ui, g);
    case 'forge': return forgePanel(ui, g);
    case 'journal': return journalPanel(ui, g);
    case 'map': return mapPanel(ui, g);
    case 'help': return helpPanel(ui);
    case 'pause': return pausePanel(ui, g);
    case 'pick': return pickPanel(ui, g, data);
    case 'summary': return summaryPanel(ui, g, data);
    default: return null;
  }
}

// ---------------------------------------------------------------------
function inventoryPanel(ui, g) {
  const f = frame(ui, 'Pack', 'inv-panel');
  let held = null; // slot index being moved
  let focus = null;
  const grid = h('div', 'igrid cols10');
  const side = h('div', 'inv-side');
  f.body.append(grid, side);
  const render = () => {
    grid.innerHTML = '';
    g.inventory.slots.forEach((s, i) => {
      const el = slotEl(ui, s, {
        onClick: () => {
          if (held == null) { if (s) { held = i; focus = i; } }
          else { g.inventory.swap(held, i); held = null; focus = i; ui.audio.sfx('ui_click', { volume: 0.4 }); }
          render();
        },
        onRight: () => { if (s && ITEMS[s.id].edible) { g.inventory.selectedIndex = i < 10 ? i : g.inventory.selectedIndex; eat(i); } },
      });
      if (i < 10) el.classList.add('hot');
      if (i === held) el.classList.add('held');
      if (i === focus) el.classList.add('focus');
      grid.appendChild(el);
    });
    const s = focus != null ? g.inventory.slots[focus] : null;
    const st = g.state;
    side.innerHTML = `
      <div class="coins-big">◉ ${st.coins.toLocaleString()}</div>
      <div class="debt">${st.debt > 0 ? `Owed to Corvin: ${st.debt.toLocaleString()}` : 'Debt repaid ✓'}</div>
      <div class="inv-detail">${s ? `<img src="${ui.icons.get(s.id)}"><div class="d-name">${ITEMS[s.id].name}</div><div class="d-cat">${catName(ITEMS[s.id].cat)}</div><div class="d-desc">${ui.itemText(s.id)}</div>` : '<div class="d-hint">Click an item to inspect it.<br>Click another slot to move it.<br>Right-click food to eat.</div>'}</div>`;
    if (s) {
      const acts = h('div', 'acts');
      if (ITEMS[s.id].edible) { const b = h('button', 'btn interactive', 'Eat'); b.onclick = () => eat(focus); acts.appendChild(b); }
      if (ITEMS[s.id].cat !== 'tool' && ITEMS[s.id].cat !== 'special') {
        const b = h('button', 'btn ghost interactive', 'Drop one');
        b.onclick = () => { const r = g.inventory.removeAt(focus, 1); if (r) g.drops.spawn(r.id, 1, g.player.pos.clone().setY(g.player.pos.y + 0.6), { up: 2 }); render(); };
        acts.appendChild(b);
      }
      side.appendChild(acts);
    }
  };
  const eat = (i) => {
    const s = g.inventory.slots[i];
    if (!s || !ITEMS[s.id].edible) return;
    const e = ITEMS[s.id].edible;
    g.inventory.removeAt(i, 1);
    if (e.buff) g.addBuff(e.buff[0], e.buff[1], e.buff[2]);
    g.player.heal(e.hp || 0, e.stamina || 0);
    ui.audio.sfx('eat');
    render();
  };
  render();
  return { name: 'inventory', el: f.el, refresh: render, onClose: hideTip };
}

// ---------------------------------------------------------------------
function craftingPanel(ui, g, data) {
  const f = frame(ui, 'Crafting', 'craft-panel');
  let filter = data.station || 'all';
  let sel = null;
  const tabs = h('div', 'tabs');
  const list = h('div', 'rlist');
  const det = h('div', 'rdetail');
  f.body.append(tabs, h('div', 'craft-wrap'));
  f.body.querySelector('.craft-wrap').append(list, det);
  const stations = { all: 'All', workbench: 'Workbench', campfire: 'Campfire', cauldron: 'Cauldron' };
  const near = (st) => !!g.nearStation(st, 4) || (st === 'campfire' && !!g.nearStation('campfire', 4));
  const known = (r) => !r.unlock || g.state.flags[r.unlock];
  const craftable = (r) => known(r) && r.in.every((ing) => ingredientHave(g, ing).ok);
  const render = () => {
    tabs.innerHTML = '';
    for (const [k, v] of Object.entries(stations)) {
      const b = h('button', 'tab interactive' + (filter === k ? ' on' : ''), v);
      b.onclick = () => { filter = k; sel = null; render(); };
      tabs.appendChild(b);
    }
    list.innerHTML = '';
    const rs = RECIPES.filter((r) => (filter === 'all' || r.station === filter) && known(r));
    if (!sel || !rs.includes(sel)) sel = rs[0] || null;
    for (const r of rs) {
      const it = ITEMS[r.out[0]];
      const row = h('div', 'rrow interactive' + (r === sel ? ' on' : '') + (craftable(r) ? '' : ' cant'), `<img src="${ui.icons.get(r.out[0])}"><span>${it.name}${r.out[1] > 1 ? ` ×${r.out[1]}` : ''}</span>`);
      row.onclick = () => { sel = r; render(); };
      list.appendChild(row);
    }
    det.innerHTML = '';
    if (!sel) { det.innerHTML = '<p class="muted">No recipes here yet.</p>'; return; }
    const it = ITEMS[sel.out[0]];
    const stationOk = near(sel.station);
    det.innerHTML = `<div class="rd-head"><img src="${ui.icons.get(sel.out[0])}"><div><div class="d-name">${it.name}</div><div class="d-cat">${catName(it.cat)} · made at a ${sel.station}</div></div></div><div class="d-desc">${ui.itemText(sel.out[0])}</div>`;
    const ings = h('div', 'ings');
    for (const ing of sel.in) {
      const x = ingredientHave(g, ing);
      ings.appendChild(h('div', 'ing' + (x.ok ? ' ok' : ''), `<img src="${ui.icons.get(x.icon)}"><span>${x.name}</span><b>${x.have}/${x.need}</b>`));
    }
    det.appendChild(ings);
    if (!stationOk) det.appendChild(h('div', 'warnline', `You need to be near a ${sel.station} to make this.`));
    const btns = h('div', 'acts');
    const b1 = h('button', 'btn interactive', 'Craft');
    const b5 = h('button', 'btn ghost interactive', 'Craft ×5');
    b1.disabled = !craftable(sel) || !stationOk;
    b5.disabled = b1.disabled;
    const craft = (n) => {
      let made = 0;
      for (let k = 0; k < n; k++) {
        if (!craftable(sel) || !g.inventory.canAdd(sel.out[0], sel.out[1])) break;
        for (const [id, q] of sel.in) g.inventory.removeMatch(id, q);
        g.inventory.add(sel.out[0], sel.out[1]);
        made++;
      }
      if (made) {
        ui.audio.sfx(sel.station === 'workbench' ? 'craft' : 'cook');
        ui.toast(`Made ${ITEMS[sel.out[0]].name} ×${made * sel.out[1]}`, 'info');
        g.effects.burst('sparkle', g.player.pos.clone().setY(g.player.pos.y + 1.2), { n: 6 });
      }
      render();
    };
    b1.onclick = () => craft(1);
    b5.onclick = () => craft(5);
    btns.append(b1, b5);
    det.appendChild(btns);
  };
  render();
  return { name: 'crafting', el: f.el, refresh: render, onClose: hideTip };
}

// ---------------------------------------------------------------------
function shopPanel(ui, g) {
  const f = frame(ui, "Corvin's Curios", 'shop-panel');
  let tab = 'buy';
  const render = () => {
    const st = g.state;
    f.body.innerHTML = '';
    const tabs = h('div', 'tabs');
    for (const [k, v] of [['buy', 'Buy'], ['sell', 'Sell']]) {
      const b = h('button', 'tab interactive' + (tab === k ? ' on' : ''), v);
      b.onclick = () => { tab = k; render(); };
      tabs.appendChild(b);
    }
    tabs.appendChild(h('div', 'coins-big right', `◉ ${st.coins.toLocaleString()}`));
    f.body.appendChild(tabs);
    if (tab === 'buy') {
      const list = h('div', 'shoplist');
      const stock = SHOP.filter((s) => (!s.season || s.season.includes(g.season)) && (!s.unlock || st.flags[s.unlock]) && !(s.recipe && st.flags[s.recipe]));
      for (const s of stock) {
        const it = ITEMS[s.id];
        const price = s.price || (it && it.buy) || (it ? it.price * 2 : 0);
        const name = s.name || it.name;
        const icon = it ? ui.icons.get(s.id) : ui.icons.get('item_letter') || '';
        const row = h('div', 'shoprow', `<img src="${icon || ui.icons.get('lantern_post')}"><span class="sn">${name}</span><span class="sp">◉ ${price}</span>`);
        if (it) { row.addEventListener('mouseenter', () => showTip(ui, s.id)); row.addEventListener('mouseleave', hideTip); }
        const buy = (n) => {
          if (st.coins < price * n) { ui.audio.sfx('ui_error'); ui.toast("You can't afford that.", 'warn'); return; }
          if (s.recipe) { st.flags[s.recipe] = true; st.coins -= price; ui.audio.sfx('buy'); ui.toast(`Learned: ${name.replace('Recipe: ', '')}`, 'quest'); render(); return; }
          if (!g.inventory.canAdd(s.id, n)) { ui.toast('Your pack is full.', 'warn'); ui.audio.sfx('ui_error'); return; }
          st.coins -= price * n;
          g.inventory.add(s.id, n);
          ui.audio.sfx('buy');
          render();
        };
        const b1 = h('button', 'btn small interactive', 'Buy');
        b1.onclick = () => buy(1);
        row.appendChild(b1);
        if (!s.recipe && it && it.stack > 1) { const b5 = h('button', 'btn small ghost interactive', '×5'); b5.onclick = () => buy(5); row.appendChild(b5); }
        list.appendChild(row);
      }
      f.body.appendChild(list);
      f.body.appendChild(h('div', 'muted small', 'Seeds change with the seasons. Corvin buys anything you sell here at the tithe crate price.'));
    } else {
      const grid = h('div', 'igrid cols10');
      g.inventory.slots.forEach((s, i) => {
        const sellable = s && ITEMS[s.id].cat !== 'tool' && ITEMS[s.id].cat !== 'special' && ITEMS[s.id].price > 0;
        const el = slotEl(ui, s, {
          dim: s && !sellable,
          onClick: (e) => { if (!sellable) return; const c = g.sellNow(i, e.shiftKey ? s.n : 1); ui.toast(`Sold for ◉ ${c}`, 'coins'); render(); },
          extra: (x) => sellable ? `<div class="tt-hint">Click: sell one · Shift-click: sell all (◉ ${ITEMS[x.id].price * x.n})</div>` : '',
        });
        grid.appendChild(el);
      });
      f.body.appendChild(grid);
    }
  };
  render();
  return { name: 'shop', el: f.el, refresh: render, onClose: hideTip };
}

// ---------------------------------------------------------------------
function cratePanel(ui, g) {
  const f = frame(ui, 'Tithe Crate', 'crate-panel');
  const render = () => {
    const st = g.state;
    f.body.innerHTML = '';
    f.body.appendChild(h('p', 'muted', 'Leave goods here and Corvin\'s crows collect them overnight. Coins arrive by morning.'));
    const grid = h('div', 'igrid cols10');
    g.inventory.slots.forEach((s, i) => {
      const ok = s && ITEMS[s.id].cat !== 'tool' && ITEMS[s.id].cat !== 'special' && ITEMS[s.id].price > 0;
      grid.appendChild(slotEl(ui, s, {
        dim: s && !ok,
        onClick: (e) => { if (ok) { g.shipToCrate(i, e.shiftKey ? 1 : s.n); render(); } },
        extra: (x) => ok ? `<div class="tt-hint">Click: ship the stack · Shift-click: ship one</div>` : '',
      }));
    });
    f.body.appendChild(grid);
    const box = h('div', 'crate-box');
    let total = 0;
    const rows = h('div', 'igrid cols10');
    st.crate.forEach((c, i) => {
      total += ITEMS[c.id].price * c.n;
      rows.appendChild(slotEl(ui, c, {
        onClick: () => {
          const left = g.inventory.add(c.id, c.n);
          if (left) c.n = left; else st.crate.splice(i, 1);
          ui.audio.sfx('pickup');
          render();
        },
        extra: () => `<div class="tt-hint">${document.body.classList.contains('is-touch') ? 'Tap' : 'Click'} to take back</div>`,
      }));
    });
    box.appendChild(h('div', 'crate-title', `In the crate — worth <b>◉ ${total.toLocaleString()}</b>`));
    box.appendChild(rows);
    f.body.appendChild(box);
  };
  render();
  return { name: 'crate', el: f.el, refresh: render, onClose: hideTip };
}

// ---------------------------------------------------------------------
function chestPanel(ui, g, data) {
  const f = frame(ui, 'Storage Chest', 'chest-panel');
  const slots = g.state.chests[data.uid] || (g.state.chests[data.uid] = new Array(20).fill(null));
  const render = () => {
    f.body.innerHTML = '';
    f.body.appendChild(h('div', 'sub', 'Chest'));
    const cg = h('div', 'igrid cols10');
    slots.forEach((s, i) => cg.appendChild(slotEl(ui, s, {
      onClick: () => {
        if (!s) return;
        const left = g.inventory.add(s.id, s.n);
        if (left) s.n = left; else slots[i] = null;
        ui.audio.sfx('pickup', { volume: 0.5 });
        render();
      },
    })));
    f.body.appendChild(cg);
    f.body.appendChild(h('div', 'sub', 'Your pack'));
    const pg = h('div', 'igrid cols10');
    g.inventory.slots.forEach((s, i) => pg.appendChild(slotEl(ui, s, {
      onClick: () => {
        if (!s || ITEMS[s.id].cat === 'special') return;
        // stack into the chest
        let left = s.n;
        for (const c of slots) if (c && c.id === s.id && left > 0) { const k = Math.min(99 - c.n, left); c.n += k; left -= k; }
        for (let k = 0; k < slots.length && left > 0; k++) if (!slots[k]) { slots[k] = { id: s.id, n: left }; left = 0; }
        const moved = s.n - left;
        if (moved) g.inventory.removeAt(i, moved);
        ui.audio.sfx('drop', { volume: 0.5 });
        render();
      },
    })));
    f.body.appendChild(pg);
  };
  render();
  return { name: 'chest', el: f.el, refresh: render, onClose: () => { hideTip(); if (data.onClose) data.onClose(); } };
}

// ---------------------------------------------------------------------
function museumPanel(ui, g) {
  const f = frame(ui, 'The Barrow — Collection', 'museum-panel');
  let tab = 'fish';
  const sets = { fish: FISH, bugs: BUGS, relics: RELICS };
  const render = () => {
    f.body.innerHTML = '';
    const tabs = h('div', 'tabs');
    for (const k of Object.keys(sets)) {
      const total = Object.keys(sets[k]).length;
      const have = Object.keys(sets[k]).filter((id) => g.state.museum[id]).length;
      const b = h('button', 'tab interactive' + (tab === k ? ' on' : ''), `${k[0].toUpperCase() + k.slice(1)} ${have}/${total}`);
      b.onclick = () => { tab = k; render(); };
      tabs.appendChild(b);
    }
    f.body.appendChild(tabs);
    const grid = h('div', 'mgrid');
    for (const [id, d] of Object.entries(sets[tab])) {
      const got = g.state.museum[id];
      const cell = h('div', 'mcell' + (got ? ' got' : ''), `<img src="${ui.icons.get(id)}"><span>${got ? d.name : '???'}</span>`);
      if (got) { cell.addEventListener('mouseenter', () => showTip(ui, id)); cell.addEventListener('mouseleave', hideTip); }
      grid.appendChild(cell);
    }
    f.body.appendChild(grid);
    f.body.appendChild(h('div', 'muted small', 'Speak to Morrow at the Barrow door to donate what you find.'));
  };
  render();
  return { name: 'museum', el: f.el, refresh: render, onClose: hideTip };
}

// ---------------------------------------------------------------------
function hearthPanel(ui, g) {
  const f = frame(ui, 'The Great Hearth', 'hearth-panel');
  const T = (ui.content.LORE && ui.content.LORE.OFFERINGS_TEXT) || {};
  const render = () => {
    const st = g.state;
    f.body.innerHTML = '';
    const done = st.offeringsDone.length;
    f.body.appendChild(h('p', 'muted', done >= 6 ? 'Six runes burn. The old altar in the Mistwood has woken.' : `The Hearth gutters. ${done} of 6 runes are lit. Offer the island's bounty to rekindle it.`));
    const cards = h('div', 'offer-grid');
    for (const o of OFFERINGS) {
      const t = T[o.id] || { name: o.id, blurb: '' };
      const prog = st.offerings[o.id] || (st.offerings[o.id] = {});
      const isDone = st.offeringsDone.includes(o.id);
      const card = h('div', 'offer' + (isDone ? ' done' : ''));
      card.appendChild(h('div', 'o-name', `${isDone ? '<span class="rune lit">ᚱ</span>' : '<span class="rune">ᚱ</span>'} ${t.name || o.id}`));
      card.appendChild(h('div', 'o-blurb', t.blurb || ''));
      const req = h('div', 'o-req');
      let canGive = false;
      if (o.coins) {
        const have = prog.coins || 0;
        req.appendChild(h('div', 'ing' + (have >= o.coins ? ' ok' : ''), `<span class="coin-ico">◉</span><span>Coins</span><b>${have}/${o.coins}</b>`));
        if (!isDone && st.coins > 0) canGive = true;
      }
      for (const [id, n] of o.items) {
        const have = prog[id] || 0;
        const inv = g.inventory.count(id);
        req.appendChild(h('div', 'ing' + (have >= n ? ' ok' : ''), `<img src="${ui.icons.get(id)}"><span>${ITEMS[id].name}</span><b>${have}/${n}</b>${!isDone && have < n && inv ? `<i>(+${Math.min(inv, n - have)})</i>` : ''}`));
        if (!isDone && have < n && inv > 0) canGive = true;
      }
      card.appendChild(req);
      if (!isDone) {
        const b = h('button', 'btn interactive', 'Offer');
        b.disabled = !canGive;
        b.onclick = () => { g.offer(o); render(); };
        card.appendChild(b);
      } else card.appendChild(h('div', 'o-done', t.complete ? t.complete.split('|')[0] : 'Offered.'));
      cards.appendChild(card);
    }
    f.body.appendChild(cards);
    if (st.offeringsDone.length >= 6 && !st.ending) {
      const fin = h('div', 'offer final');
      const ft = T.final || { name: 'The Last Rite', blurb: 'Bring the heart of the Gloam to the Hearth.' };
      fin.appendChild(h('div', 'o-name', ft.name));
      fin.appendChild(h('div', 'o-blurb', ft.blurb));
      if (g.inventory.has('trophy_stag')) {
        const b = h('button', 'btn big interactive', "Lay Ashhorn's Antler upon the Hearth");
        b.onclick = () => { ui.close(); g.finalRite(); };
        fin.appendChild(b);
      } else fin.appendChild(h('div', 'warnline', st.bossDefeated ? 'Retrieve the antler Ashhorn dropped.' : 'Ashhorn waits at the altar deep in the Mistwood.'));
      f.body.appendChild(fin);
    }
  };
  render();
  return { name: 'hearth', el: f.el, refresh: render, onClose: hideTip };
}

// ---------------------------------------------------------------------
function forgePanel(ui, g) {
  const f = frame(ui, "Bramble's Forge", 'forge-panel');
  const render = () => {
    const st = g.state;
    f.body.innerHTML = '';
    f.body.appendChild(h('p', 'muted', 'Better tools hit harder, till and water wider, and cost less stamina.'));
    const list = h('div', 'shoplist');
    for (const id of UPGRADABLE) {
      if (!g.inventory.has(id)) continue;
      const lvl = st.tools[id] || 0;
      const next = UPGRADES.find((u) => u.level === lvl + 1);
      const row = h('div', 'shoprow', `<img src="${ui.icons.get(id)}"><span class="sn">${ITEMS[id].name} <i>${['Stone', 'Copper', 'Iron'][lvl]}</i></span>`);
      if (!next) { row.appendChild(h('span', 'sp', 'Mastered')); list.appendChild(row); continue; }
      const [ore, n] = next.ore;
      row.appendChild(h('span', 'sp', `→ ${next.name}: ◉ ${next.coins} + ${n} ${ITEMS[ore].name}`));
      const b = h('button', 'btn small interactive', 'Upgrade');
      b.disabled = st.coins < next.coins || g.inventory.count(ore) < n;
      b.onclick = () => {
        st.coins -= next.coins;
        g.inventory.remove(ore, n);
        st.tools[id] = next.level;
        if (id === 'tool_can') st.canWater = [20, 40, 70][next.level];
        ui.audio.sfx('levelup');
        ui.toast(`${ITEMS[id].name} upgraded to ${next.name}!`, 'quest');
        g.inventory.changed();
        render();
      };
      row.appendChild(b);
      list.appendChild(row);
    }
    f.body.appendChild(list);
  };
  render();
  return { name: 'forge', el: f.el, refresh: render, onClose: hideTip };
}

// ---------------------------------------------------------------------
export function goals(g) {
  const st = g.state;
  const met = Object.values(st.npcs).filter((n) => n.met).length;
  const out = [];
  out.push({ t: 'Speak with Corvin the raven', done: st.npcs.corvin.met });
  out.push({ t: 'Get a fishing rod from Fennick the fox (the south dock in the morning, the beach by day, the Hearth after 5 pm)', done: st.npcs.fennick.met });
  out.push({ t: 'Get a bug net from Mothwyn the moth (Birchmeadow in the morning, her house in the village after noon)', done: st.npcs.mothwyn.met });
  out.push({ t: 'Till soil in your field and plant seeds', done: Object.values(st.farm).some((t) => t.crop) || st.stats.crops > 0 });
  out.push({ t: 'Ship something in the tithe crate', done: st.stats.earned > 0 });
  out.push({ t: `Meet the villagers (${met}/6)`, done: met >= 6 });
  out.push({ t: 'Visit Grenna and learn of the Great Hearth', done: !!st.flags.offerings_known });
  out.push({ t: `Pay off your debt (${(DEBT_START - st.debt).toLocaleString()}/${DEBT_START.toLocaleString()})`, done: st.debt <= 0 });
  out.push({ t: `Rekindle the Hearth (${st.offeringsDone.length}/6 offerings)`, done: st.offeringsDone.length >= 6 });
  if (st.offeringsDone.length >= 6) out.push({ t: 'Face Ashhorn at the Mistwood altar', done: st.bossDefeated });
  if (st.bossDefeated) out.push({ t: 'Lay the antler upon the Hearth', done: st.ending });
  if (st.debt <= 0) out.push({ t: 'Build the longhouse', done: st.house === 'longhouse' });
  return out;
}

function journalPanel(ui, g) {
  const f = frame(ui, 'Journal', 'journal-panel');
  let tab = 'goals';
  const render = () => {
    const st = g.state;
    f.body.innerHTML = '';
    const tabs = h('div', 'tabs');
    for (const [k, v] of [['goals', 'Goals'], ['villagers', 'Villagers'], ['stats', 'Records']]) {
      const b = h('button', 'tab interactive' + (tab === k ? ' on' : ''), v);
      b.onclick = () => { tab = k; render(); };
      tabs.appendChild(b);
    }
    f.body.appendChild(tabs);
    if (tab === 'goals') {
      const ul = h('ul', 'goals');
      for (const q of goals(g)) ul.appendChild(h('li', q.done ? 'done' : '', `${q.done ? '✓' : '◇'} ${q.t}`));
      f.body.appendChild(ul);
      const reqs = Object.entries(st.npcs).filter(([, n]) => n.request && n.request.asked);
      if (reqs.length) {
        f.body.appendChild(h('div', 'sub', 'Requests'));
        const ul2 = h('ul', 'goals');
        for (const [id, n] of reqs) ul2.appendChild(h('li', '', `◇ ${VILLAGERS[id].name} wants ${n.request.qty} × ${ITEMS[n.request.id].name} (you have ${g.inventory.count(n.request.id)})`));
        f.body.appendChild(ul2);
      }
    } else if (tab === 'villagers') {
      const list = h('div', 'vlist');
      for (const [id, cfg] of Object.entries(VILLAGERS)) {
        const n = st.npcs[id];
        const hearts = Math.floor(n.fp / 100);
        const row = h('div', 'vrow', `<b>${n.met ? cfg.name : '???'}</b><span class="vt">${n.met ? cfg.title : 'Not yet met'}</span><span class="hearts">${'♥'.repeat(hearts)}<i>${'♡'.repeat(10 - hearts)}</i></span>`);
        if (n.met) {
          const likes = [...cfg.loved.slice(0, 2)].filter((x) => typeof x === 'string' && st.seen[x]).map((x) => ITEMS[x].name);
          if (likes.length) row.appendChild(h('span', 'vlikes', `Loves: ${likes.join(', ')}`));
        }
        list.appendChild(row);
      }
      f.body.appendChild(list);
    } else {
      const s = st.stats;
      f.body.appendChild(h('div', 'stats', `
        <div><span>Days on Gloamhollow</span><b>${st.totalDays}</b></div>
        <div><span>Coins earned</span><b>${s.earned.toLocaleString()}</b></div>
        <div><span>Crops harvested</span><b>${s.crops}</b></div>
        <div><span>Fish caught</span><b>${s.fish}</b></div>
        <div><span>Bugs caught</span><b>${s.bugs}</b></div>
        <div><span>Relics unearthed</span><b>${s.relics}</b></div>
        <div><span>Gloam banished</span><b>${s.kills}</b></div>
        <div><span>Donations to the Barrow</span><b>${Object.keys(st.museum).length}/${Object.keys(FISH).length + Object.keys(BUGS).length + Object.keys(RELICS).length}</b></div>`));
    }
  };
  render();
  return { name: 'journal', el: f.el, refresh: render };
}

// ---------------------------------------------------------------------
function mapPanel(ui, g) {
  const f = frame(ui, 'Map of Gloamhollow', 'map-panel');
  const S = 520;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  cv.className = 'map-canvas';
  f.body.appendChild(cv);
  const base = getMapBase(g);
  const toPx = (x, z) => [((x + base.W / 2) / base.W) * S, ((z + base.W / 2) / base.W) * S];
  const draw = () => {
    const c = cv.getContext('2d');
    c.drawImage(base.canvas, 0, 0, S, S);
    c.font = '12px Cinzel, serif';
    c.textAlign = 'center';
    for (const [name, p] of MAP_LABELS) {
      const [x, y] = toPx(p.x, p.z);
      c.fillStyle = 'rgba(10,10,10,0.55)';
      c.fillText(name, x + 1, y + 1);
      c.fillStyle = '#eadfc4';
      c.fillText(name, x, y);
    }
    const dot = (x, y, r, fill) => {
      c.beginPath(); c.arc(x, y, r, 0, 6.28);
      c.fillStyle = fill; c.fill();
      c.lineWidth = 1; c.strokeStyle = 'rgba(12,8,4,0.9)'; c.stroke();
    };
    const hp = homePos(g);
    const [hx, hy] = toPx(hp.x, hp.z);
    c.fillStyle = '#f1e6cd';
    c.beginPath(); c.moveTo(hx, hy - 7); c.lineTo(hx + 6, hy - 1); c.lineTo(hx + 4.5, hy - 1); c.lineTo(hx + 4.5, hy + 6);
    c.lineTo(hx - 4.5, hy + 6); c.lineTo(hx - 4.5, hy - 1); c.lineTo(hx - 6, hy - 1); c.closePath();
    c.fill(); c.lineWidth = 1.2; c.strokeStyle = 'rgba(12,8,4,0.9)'; c.stroke();
    c.font = '11px Alegreya, Georgia, serif';
    c.textAlign = 'left';
    for (const n of g.npcs.list) {
      if (!n.visible) continue;
      const [x, y] = toPx(n.pos.x, n.pos.z);
      dot(x, y, 3.5, '#e6a44a');
      c.fillStyle = 'rgba(10,10,10,0.7)';
      c.fillText(n.cfg.name, x + 6, y + 4);
      c.fillStyle = '#f3c77e';
      c.fillText(n.cfg.name, x + 5, y + 3);
    }
    for (const e of g.enemies.list) {
      if (!e.alive) continue;
      const [x, y] = toPx(e.pos.x, e.pos.z);
      dot(x, y, e === g.enemies.boss ? 5 : 3, '#d8453a');
    }
    const p = g.player.pos;
    const [px, py] = toPx(p.x, p.z);
    c.save();
    c.translate(px, py);
    c.rotate(-g.player.facing + Math.PI);
    c.fillStyle = '#fff4d0';
    c.beginPath(); c.moveTo(0, -8); c.lineTo(5, 6); c.lineTo(-5, 6); c.closePath(); c.fill();
    c.lineWidth = 1; c.strokeStyle = 'rgba(12,8,4,0.9)'; c.stroke();
    c.restore();
  };
  draw();
  const iv = setInterval(draw, 500);
  f.body.appendChild(h('div', 'muted small', 'The arrow is you and the house is home. Amber dots are villagers (Fennick has a fishing rod for you, Mothwyn a bug net); red ones are the Gloam.'));
  return { name: 'map', el: f.el, onClose: () => clearInterval(iv) };
}

// ---------------------------------------------------------------------
function helpPanel(ui) {
  const f = frame(ui, 'How to Play', 'help-panel');
  const touch = document.body.classList.contains('is-touch');
  const controls = touch ? `
    <div><h3>Moving</h3>
      <p>Drag on the left of the screen to walk; drag past the ring to run · <b>⤳</b> dodge-roll</p>
      <p>Drag on the right to turn the camera · pinch to zoom</p>
      <h3>Doing</h3>
      <p><b>⚒</b> use the held tool/item (hold to keep swinging)</p>
      <p><b>E</b> talk · pick · harvest · open · sleep at your door</p>
      <p>Tap a hotbar slot to hold that item</p>
      <h3>Menus</h3>
      <p>The buttons along the top open your pack, crafting, journal, map and the pause menu. Tap the minimap for the full map.</p>
    </div>` : `
    <div><h3>Moving</h3>
      <p><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> walk · <kbd>Shift</kbd> sprint · <kbd>Space</kbd> dodge-roll</p>
      <p><b>Right-drag</b> or <kbd>←</kbd><kbd>→</kbd> turn the camera · <b>Wheel</b> zoom</p>
      <h3>Doing</h3>
      <p><b>Left-click</b> use the held tool/item (aim with the mouse; hold to keep swinging)</p>
      <p><kbd>E</kbd> talk · pick · harvest · open · sleep at your door</p>
      <p><kbd>1</kbd>–<kbd>0</kbd> or <kbd>Q</kbd>/<kbd>R</kbd> choose hotbar slot</p>
      <h3>Menus</h3>
      <p><kbd>Tab</kbd> pack · <kbd>C</kbd> crafting · <kbd>J</kbd> journal · <kbd>M</kbd> map · <kbd>Esc</kbd> pause</p>
      <p>The minimap turns with your view. Click it for the full map; scroll over it to zoom.</p>
    </div>`;
  const fishHow = touch
    ? 'use the rod to cast, tap again when it bites, then hold a finger down to keep the fish in the green bar'
    : 'click to cast, click again when it bites, then hold the mouse to keep the fish in the green bar';
  f.body.innerHTML = `
  <div class="help-cols">${controls}
    <div><h3>Living here</h3>
      <p>Till your field with the hoe, plant seeds, water them each day (or let the rain). Crops only grow in their season.</p>
      <p>Drop goods in the <b>tithe crate</b> by your hut; they're sold overnight. Pay Corvin back at his stall.</p>
      <p>Chop trees, break rocks, forage, fish (${fishHow}), and catch bugs with the net. Bugs twinkle gold: on tree trunks and over water by day, around lights and in the fields at night. Fennick the fox has a spare rod and Mothwyn the moth makes nets.</p>
      <p>After dark the <b>Gloam</b> hunts. Stay near fire — torches, braziers and the Great Hearth keep them away. Standing by a fire makes you <b>Rested</b>.</p>
      <p>Sleep at your hut door before 2 am. Your game saves each morning.</p>
    </div>
  </div>`;
  return { name: 'help', el: f.el };
}

// ---------------------------------------------------------------------
function pausePanel(ui, g) {
  const f = frame(ui, 'Paused', 'pause-panel');
  const s = g.settings;
  const slider = (key, label) => `<label class="srow"><span>${label}</span><input type="range" min="0" max="1" step="0.05" value="${s[key]}" data-k="${key}" class="interactive"></label>`;
  f.body.innerHTML = `
    <div class="pause-cols">
      <div class="pause-menu">
        <button class="btn big interactive" data-a="resume">Resume</button>
        <button class="btn big ghost interactive" data-a="help">How to play</button>
        <button class="btn big ghost interactive" data-a="journal">Journal</button>
        <button class="btn big ghost interactive" data-a="quit">Save &amp; quit to title</button>
        <p class="muted small">The game saves automatically every morning. Quitting keeps your progress from the start of today.</p>
      </div>
      <div class="settings">
        <h3>Sound</h3>
        ${slider('master', 'Master')}${slider('music', 'Music')}${slider('sfx', 'Effects')}${slider('ambience', 'Ambience')}${slider('voice', 'Voices')}
        <h3>Game</h3>
        <label class="srow"><span>Graphics</span><select data-k="quality" class="interactive"><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option></select></label>
        <label class="srow"><span>Day length</span><select data-k="dayLength" class="interactive"><option value="short">Short (~8 min)</option><option value="normal">Normal (~11 min)</option><option value="long">Long (~16 min)</option></select></label>
        <label class="srow"><span>Minimap</span><select data-k="minimap" class="interactive"><option value="rotate">Turns with view</option><option value="north">North up</option><option value="off">Hidden</option></select></label>
      </div>
    </div>`;
  f.body.querySelectorAll('select').forEach((el) => { el.value = s[el.dataset.k]; });
  f.body.querySelectorAll('input[type=range]').forEach((el) => el.addEventListener('input', () => {
    s[el.dataset.k] = Number(el.value);
    ui.audio.setVolumes({ [el.dataset.k]: s[el.dataset.k] });
    saveSettings(s);
  }));
  f.body.querySelectorAll('select').forEach((el) => el.addEventListener('change', () => {
    s[el.dataset.k] = el.value;
    if (el.dataset.k === 'quality') { g.engine.setQuality(el.value); s.qualityChosen = true; }
    saveSettings(s);
  }));
  f.body.querySelector('[data-a=resume]').onclick = () => ui.close();
  f.body.querySelector('[data-a=help]').onclick = () => { ui.close(); ui.open('help'); };
  f.body.querySelector('[data-a=journal]').onclick = () => { ui.close(); ui.open('journal'); };
  f.body.querySelector('[data-a=quit]').onclick = () => { ui.close(); g.quitToTitle && g.quitToTitle(); };
  g.audio.suspend && g.audio.suspend();
  return { name: 'pause', el: f.el, onClose: () => g.audio.resume && g.audio.resume() };
}

// ---------------------------------------------------------------------
function pickPanel(ui, g, data) {
  const f = frame(ui, data.title, 'pick-panel');
  let resolved = false;
  const grid = h('div', 'igrid cols10');
  g.inventory.slots.forEach((s, i) => {
    const ok = s && data.filter(s);
    grid.appendChild(slotEl(ui, s, { dim: s && !ok, onClick: () => { if (!ok) return; resolved = true; ui.close(); data.resolve(i); } }));
  });
  f.body.appendChild(grid);
  const cancel = h('button', 'btn ghost interactive', 'Never mind');
  cancel.onclick = () => ui.close();
  f.body.appendChild(cancel);
  return { name: 'pick', el: f.el, onClose: () => { hideTip(); if (!resolved) data.resolve(null); } };
}

// ---------------------------------------------------------------------
function summaryPanel(ui, g, data) {
  const s = data.summary;
  const f = frame(ui, `${SEASON_NAME[s.season]} — Day ${s.day}${s.year > 1 ? `, Year ${s.year}` : ''}`, 'summary-panel');
  f.el.querySelector('.x').remove();
  const L = ui.content.LORE || {};
  const line = (arr) => (arr && arr.length ? arr[Math.floor(Math.random() * arr.length)] : '');
  const head = s.reason === 'death' ? line(L.DEATH_LINES) || 'The Gloam claimed you in the dark. You wake at home.' :
    s.reason === 'passout' ? line(L.PASSOUT_LINES) || 'You collapsed. Someone carried you home.' :
      line(L.SLEEP_LINES) || 'You sleep soundly as the fire burns low.';
  f.body.appendChild(h('p', 'sum-head', head));
  if (s.sold.length) {
    const list = h('div', 'sum-list');
    for (const x of s.sold) list.appendChild(h('div', 'sum-row', `<img src="${ui.icons.get(x.id)}"><span>${ITEMS[x.id].name} ×${x.n}</span><b>◉ ${x.price.toLocaleString()}</b>`));
    f.body.appendChild(list);
    f.body.appendChild(h('div', 'sum-total', `Shipped: <b>◉ ${s.earned.toLocaleString()}</b>`));
  } else f.body.appendChild(h('p', 'muted', 'Nothing was shipped today.'));
  if (s.lost) f.body.appendChild(h('div', 'warnline', `Lost ◉ ${s.lost} in the night.`));
  for (const e of s.events) f.body.appendChild(h('div', 'sum-event', e));
  const tips = L.TIPS || [];
  if (tips.length) f.body.appendChild(h('div', 'sum-tip', `<i>Tip:</i> ${tips[Math.floor(Math.random() * tips.length)]}`));
  f.body.appendChild(h('div', 'sum-weather', `Today's weather: ${s.weather}`));
  const b = h('button', 'btn big interactive', 'Wake up');
  b.onclick = () => { ui.close(); data.resolve(); };
  f.body.appendChild(b);
  return { name: 'summary', el: f.el, modal: true, onKey: (e) => { if (e.code === 'Enter' || e.code === 'KeyE' || e.code === 'Space') { b.click(); return true; } return e.code === 'Escape'; } };
}
