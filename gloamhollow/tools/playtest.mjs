// Scripted playtest in headless Chromium: drives the real game with
// keyboard/mouse, checks state, and saves screenshots along the way.
//   node tools/playtest.mjs <outdir> [scenario]      scenarios: farm (default), night, tour
import fs from 'node:fs';
import path from 'node:path';
import { startServer } from './serve.mjs';
import { launchBrowser } from './browser.mjs';

const outDir = process.argv[2] || '/tmp/playtest';
const scenario = process.argv[3] || 'farm';
fs.mkdirSync(outDir, { recursive: true });

const { server, port } = await startServer(0);
const browser = await launchBrowser();
const page = await browser.newPage({ viewport: { width: 1024, height: 576 } });
const logs = [];
page.on('console', (m) => { const t = m.text(); if (!/GPU stall|CERT|Failed to load resource|missing model/.test(t)) logs.push(`[${m.type()}] ${t}`); });
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}\n${(e.stack || '').split('\n').slice(0, 4).join('\n')}`));

const Q = ({ farm: 'play&skipintro&hour=9', night: 'play&skipintro&hour=21.5', tour: 'play&skipintro&hour=17.5', systems: 'play&skipintro&hour=9&weather=clear' }[scenario] || 'play&skipintro') + (process.env.QUALITY ? `&quality=${process.env.QUALITY}` : '');
await page.goto(`http://127.0.0.1:${port}/index.html?${Q}`);
await page.waitForFunction(() => window.__gh && window.__gh.ready, null, { timeout: 240000 });
let n = 0;
const shot = async (name) => { const f = path.join(outDir, `${String(++n).padStart(2, '0')}_${name}.png`); try { await page.screenshot({ path: f, timeout: 90000 }); console.log('  shot', f); } catch (e) { console.log('  shot failed', name, e.message.split('\n')[0]); } };
const ev = (fn, arg) => page.evaluate(fn, arg);
const wait = (ms) => page.waitForTimeout(ms);
const sim = (sec) => page.evaluate((s) => window.__gh.sim(s), sec);
const key = async (k, hold = 60) => { await page.keyboard.down(k); await sim(0.05); await page.keyboard.up(k); await sim(0.1); };
const click = async (after = 1.0) => { await page.mouse.down(); await sim(0.05); await page.mouse.up(); await sim(after); };
const fps = await ev(async () => { const t0 = performance.now(); let f = 0; await new Promise((r) => { const tick = () => { f++; if (performance.now() - t0 < 2000) requestAnimationFrame(tick); else r(); }; requestAnimationFrame(tick); }); return f / 2; });
console.log('fps ≈', fps.toFixed(1));

// aim the mouse at a world point
const aim = async (x, y, z) => {
  const p = await ev(([x, y, z]) => { const { game, THREE } = window.__gh; const v = new THREE.Vector3(x, y, z).project(game.engine.camera); return [(v.x + 1) / 2 * innerWidth, (1 - v.y) / 2 * innerHeight]; }, [x, y, z]);
  await page.mouse.move(p[0], p[1]);
  await wait(80);
};
const teleport = (x, z, facing = 0) => ev(([x, z, f]) => { const g = window.__gh.game; g.player.pos.set(x, g.world.groundY(x, z), z); g.player.facing = f; g.camera.snap(g.player.pos); }, [x, z, facing]);
const state = () => ev(() => { const g = window.__gh.game; return { day: g.state.day, time: Math.round(g.state.time), coins: g.state.coins, hp: Math.round(g.player.hp), st: Math.round(g.player.stamina), tiles: Object.keys(g.state.farm).length, crops: Object.values(g.state.farm).filter((t) => t.crop).length, wet: Object.values(g.state.farm).filter((t) => t.wet).length, dialog: g.ui.dialogueOpen, panels: g.ui.stack.map((p) => p.name), enemies: g.enemies.list.length, inv: g.inventory.slots.filter(Boolean).map((s) => `${s.id}:${s.n}`).join(' ') }; });
const skipDialogue = async (max = 60) => {
  await page.mouse.move(4, 4);
  for (let i = 0; i < max; i++) {
    const s = await ev(() => { const u = window.__gh.game.ui; return { open: u.dialogueOpen, choice: !!u.dlgChoicesActive && !u.typing && u.dlgPages.length === 0, panels: u.stack.length }; });
    if (s.panels) { await key('Escape'); continue; }
    if (!s.open) break;
    await key(s.choice ? 'Escape' : 'KeyE', 40);
  }
};

try {
  if (scenario === 'farm') {
    await wait(1500);
    await shot('spawn');
    // talk to Corvin (standing by the hut on day one)
    const cpos = await ev(() => { const n = window.__gh.game.npcs.byId.corvin; return [n.pos.x, n.pos.z]; });
    await teleport(cpos[0] - 1.6, cpos[1], Math.PI / 2);
    await wait(400);
    console.log('prompt:', await ev(() => window.__gh.game.ui._prompt));
    await page.mouse.move(4, 4);
    await key('KeyE');
    await sim(0.8);
    await shot('corvin_intro');
    await skipDialogue();
    console.log('corvin met:', await ev(() => window.__gh.game.state.npcs.corvin.met));
    // till / plant / water a row in the field
    await teleport(-52.5, 30.5, 0);
    await wait(300);
    await key('Digit1');
    for (let i = 0; i < 3; i++) { await aim(-52.5 + i, 5.2, 31.5); await click(0.9); }
    await shot('tilled');
    await key('Digit6');
    for (let i = 0; i < 3; i++) { await aim(-52.5 + i, 5.2, 31.5); await click(0.6); }
    await key('Digit2');
    for (let i = 0; i < 3; i++) { await aim(-52.5 + i, 5.2, 31.5); await click(0.9); }
    console.log('after farming:', JSON.stringify(await state()));
    await shot('planted');
    // chop the nearest tree
    const tree = await ev(() => { const g = window.__gh.game; const p = g.player.pos; let best = null, bd = 1e9; for (const t of g.resources.trees) { if (t.felled) continue; const d = Math.hypot(t.x - p.x, t.z - p.z); if (d < bd) { bd = d; best = t; } } return [best.x, best.z, best.model]; });
    console.log('nearest tree', tree);
    await teleport(tree[0] - 1.3, tree[1], Math.PI / 2);
    await key('Digit3');
    for (let i = 0; i < 12; i++) { await aim(tree[0], 5.5, tree[1]); await click(0.75); }
    await sim(3);
    await shot('chopped');
    console.log('after chopping:', JSON.stringify(await state()));
    // open panels
    await key('Tab'); await sim(0.3); await shot('inventory'); await key('Escape'); await sim(0.2);
    await key('KeyC'); await sim(0.3); await shot('crafting'); await key('Escape'); await sim(0.2);
    await key('KeyM'); await sim(0.3); await shot('map'); await key('Escape'); await sim(0.2);
    // sleep
    const door = await ev(() => { const b = window.__gh.game.world.buildings.get('home'); const d = b.obj.userData.doorPos; return d ? [d.x, d.z] : [b.x + 3, b.z]; });
    await teleport(door[0] + 0.6, door[1], -Math.PI / 2);
    await wait(400);
    console.log('door prompt:', await ev(() => window.__gh.game.ui._prompt));
    await key('KeyE'); await sim(0.5);
    await shot('sleep_confirm');
    await key('KeyE'); await wait(4000); await sim(1);
    await shot('summary');
    await key('Enter'); await wait(3000); await sim(1);
    console.log('next morning:', JSON.stringify(await state()));
    await shot('morning');
  } else if (scenario === 'night') {
    await teleport(-20, -40, 0);
    await sim(25);
    await shot('night1');
    console.log('night:', JSON.stringify(await state()));
    await key('Digit5');
    for (let i = 0; i < 20; i++) {
      const e = await ev(() => { const g = window.__gh.game; const p = g.player.pos; const e = g.enemies.list.find((x) => x.alive); return e ? [e.pos.x, e.pos.y, e.pos.z, Math.hypot(e.pos.x - p.x, e.pos.z - p.z)] : null; });
      if (e) { await aim(e[0], e[1] + 1, e[2]); if (e[3] < 3) await click(0.5); else await sim(0.5); } else await sim(1);
    }
    await shot('night_fight');
    console.log('after fight:', JSON.stringify(await state()));
  } else if (scenario === 'systems') {
    // meet every villager (walk up and press E), checking their gifts
    for (const id of ['fennick', 'mothwyn', 'grenna', 'bramble', 'morrow', 'corvin']) {
      await ev((h) => { window.__gh.game.state.time = h * 60; }, id === 'mothwyn' ? 9 : id === 'fennick' ? 7 : 13);
      await sim(0.2);
      await ev(() => window.__gh.game.npcs.list.forEach((n) => n.replan(window.__gh.game.npcs, true)));
      const np = await ev((id) => { const n = window.__gh.game.npcs.byId[id]; return [n.pos.x, n.pos.z, n.visible]; }, id);
      await teleport(np[0], np[1] + 1.4, Math.PI);
      await sim(0.3);
      await page.mouse.move(4, 4);
      await key('KeyE');
      await sim(0.5);
      if (id === 'fennick') await shot('talk_fennick');
      await skipDialogue();
      console.log(`met ${id}:`, await ev((id) => window.__gh.game.state.npcs[id].met, id), 'visible:', np[2]);
    }
    console.log('inv after meeting:', (await state()).inv);
    // gift: talk again and choose "Give a gift"
    const b = await ev(() => { const n = window.__gh.game.npcs.byId.corvin; return [n.pos.x, n.pos.z]; });
    await teleport(b[0], b[1] + 1.4, Math.PI);
    await ev(() => window.__gh.game.inventory.add('raspberry', 3));
    await key('KeyE'); await sim(0.4);
    await shot('menu');
    await key('ArrowDown'); await key('KeyE'); await sim(0.4);
    await shot('gift_pick');
    const slot = await ev(() => window.__gh.game.inventory.slots.findIndex((s) => s && s.id === 'raspberry'));
    await ev((i) => { const p = window.__gh.game.ui.stack[window.__gh.game.ui.stack.length - 1]; const el = p.el.querySelectorAll('.islot')[i]; el.click(); }, slot);
    await sim(0.4);
    await shot('gift_reaction');
    await skipDialogue();
    console.log('corvin fp:', await ev(() => window.__gh.game.state.npcs.corvin.fp));
    // fishing at the lake jetty
    await ev(() => { window.__gh.game.state.time = 10 * 60; });
    await teleport(41, 5, Math.PI / 2);
    await sim(0.3);
    const rodSlot = await ev(() => window.__gh.game.inventory.slots.findIndex((s) => s && s.id === 'tool_rod'));
    if (rodSlot >= 0 && rodSlot < 10) {
      await ev((i) => { window.__gh.game.inventory.selectedIndex = i; }, rodSlot);
      await page.mouse.move(700, 300);
      await click(1.5);
      console.log('fishing phase:', await ev(() => window.__gh.game.fishing.phase), 'where:', await ev(() => window.__gh.game.fishing.where));
      await ev(() => { const f = window.__gh.game.fishing; if (f.active) f.waitFor = 0.1; });
      await sim(0.4);
      await shot('bite');
      await click(0.3);
      console.log('phase after hook:', await ev(() => window.__gh.game.fishing.phase));
      await shot('minigame');
      // hold the mouse to keep the zone up for a while, then force the result
      await page.mouse.down(); await sim(1); await page.mouse.up(); await sim(0.5);
      await ev(() => { const u = window.__gh.game.ui.fishingUI; if (u.active) u.p = 1; });
      await sim(0.3);
      console.log('fish caught:', await ev(() => window.__gh.game.state.stats.fish));
    } else console.log('no rod in hotbar', rodSlot);
    // bug net
    const netSlot = await ev(() => window.__gh.game.inventory.slots.findIndex((s) => s && s.id === 'tool_net'));
    await ev(() => { const g = window.__gh.game; for (let i = 0; i < 6; i++) g.bugs.spawn(); });
    const bug = await ev(() => { const b = window.__gh.game.bugs.list[0]; return b ? [b.pos.x, b.pos.z, b.id] : null; });
    console.log('bug', bug);
    if (bug && netSlot >= 0 && netSlot < 10) {
      await teleport(bug[0] - 1, bug[1], Math.PI / 2);
      await ev((i) => { window.__gh.game.inventory.selectedIndex = i; }, netSlot);
      await ev(() => { const g = window.__gh.game; const b = g.bugs.list[0]; if (b) { b.anchor.set(g.player.pos.x + 1, g.player.pos.y + 1, g.player.pos.z); b.r = 0.1; } });
      await aim(bug[0], 6, bug[1]);
      await click(0.8);
      console.log('bugs caught:', await ev(() => window.__gh.game.state.stats.bugs));
    }
    // offerings: give kindling
    await ev(() => { const g = window.__gh.game; g.inventory.add('wood', 30); g.inventory.add('stone', 20); g.inventory.add('resin', 5); g.state.flags.offerings_known = true; });
    await teleport(0, 4, Math.PI);
    await key('KeyE'); await sim(0.4);
    await shot('hearth_panel');
    await ev(() => { const p = window.__gh.game.ui.stack[0]; const btn = p && p.el.querySelector('.offer .btn'); if (btn) btn.click(); });
    await sim(0.5);
    await shot('offering_done');
    await skipDialogue();
    console.log('offerings:', await ev(() => window.__gh.game.state.offeringsDone.join(',')), 'recipes:', await ev(() => Object.keys(window.__gh.game.state.flags).join(',')));
    // shop: buy seeds
    await ev(() => { window.__gh.game.state.time = 12 * 60; window.__gh.game.npcs.list.forEach((n) => n.replan(window.__gh.game.npcs, true)); });
    await sim(0.3);
    await ev(() => window.__gh.game.ui.open('shop'));
    await sim(0.3);
    await shot('shop');
    await ev(() => { const p = window.__gh.game.ui.stack[0]; p.el.querySelector('.shoprow .btn').click(); });
    console.log('coins after buying:', await ev(() => window.__gh.game.state.coins));
    await key('Escape');
    // crafting: a campfire at the workbench
    await teleport(-41, 18.5, Math.PI);
    await sim(0.2);
    await ev(() => window.__gh.game.ui.open('crafting', { station: 'workbench' }));
    await sim(0.3);
    await shot('crafting_bench');
    await key('Escape');
    // place a torch in the field edge
    const tslot = await ev(() => window.__gh.game.inventory.slots.findIndex((s) => s && s.id === 'torch_standing'));
    await ev((i) => { window.__gh.game.inventory.selectedIndex = i; }, tslot);
    await teleport(-40, 36, 0);
    await aim(-40.5, 5, 38.5);
    await sim(0.2);
    await shot('ghost');
    await click(0.6);
    console.log('placed:', await ev(() => window.__gh.game.state.placed.map((p) => p.id).join(',')));
    // museum donation
    const hasFish = await ev(() => window.__gh.game.inventory.slots.find((s) => s && s.id.startsWith('fish_')));
    if (hasFish) {
      const m = await ev(() => { const n = window.__gh.game.npcs.byId.morrow; return [n.pos.x, n.pos.z]; });
      await teleport(m[0], m[1] + 1.4, Math.PI);
      await ev(() => window.__gh.game.npcs.donate(window.__gh.game.npcs.byId.morrow));
      await sim(0.3);
      const fs = await ev(() => window.__gh.game.inventory.slots.findIndex((s) => s && s.id.startsWith('fish_')));
      await ev((i) => { const p = window.__gh.game.ui.stack[window.__gh.game.ui.stack.length - 1]; if (p) p.el.querySelectorAll('.islot')[i].click(); }, fs);
      await sim(0.4);
      await shot('donation');
      await skipDialogue();
      console.log('museum:', await ev(() => Object.keys(window.__gh.game.state.museum).join(',')));
    }
    // boss + ending
    await ev(() => { const g = window.__gh.game; g.state.offeringsDone = ['kindling', 'soil', 'deep', 'wild', 'dark', 'tithe']; g.world.setHearthLevel(6); });
    await teleport(66, -74, 2.4);
    await ev(() => window.__gh.game.enemies.summonBoss());
    await sim(3);
    await shot('boss');
    await ev(() => { const g = window.__gh.game; const b = g.enemies.boss; g.enemies.damage(b, 5000, g.player.pos.x, g.player.pos.z, 0); });
    await sim(3);
    await ev(() => { const g = window.__gh.game; g.player.pos.copy(g.drops.list.find((d) => d.id === 'trophy_stag')?.pos || g.player.pos); });
    await sim(2);
    console.log('has antler:', await ev(() => window.__gh.game.inventory.has('trophy_stag')), 'boss defeated:', await ev(() => window.__gh.game.state.bossDefeated));
    await ev(() => window.__gh.game.finalRite());
    await wait(4000); await sim(0.5);
    await shot('ending');
    for (let i = 0; i < 12; i++) { await page.mouse.click(500, 300); await wait(200); }
    await wait(3500); await sim(1);
    await shot('dawn');
    console.log('ending:', await ev(() => window.__gh.game.state.ending));
  } else if (scenario === 'tour') {
    const spots = [['village', 4, 14, Math.PI], ['croft', -36, 30, -2], ['barrow', 2, -54, Math.PI], ['lake', 30, 12, 1.2], ['dock', 22, 70, Math.PI], ['mistwood', 48, -44, 2.4], ['meadow', -62, -4, 0], ['altar', 64, -70, 2.6]];
    for (const [name, x, z, f] of spots) {
      await teleport(x, z, f);
      await ev((f) => { const g = window.__gh.game; g.camera.yawGoal = f + Math.PI; g.camera.snap(g.player.pos); }, f);
      await sim(1.5);
      await shot(name);
    }
  }
} catch (e) {
  console.log('SCRIPT ERROR', e.message);
}
console.log(logs.slice(0, 60).join('\n'));
await browser.close();
server.close();
