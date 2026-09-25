// Natural resources: trees, stumps, rocks & ore, berry bushes, ferns (weeds),
// daily forage and glinting dig spots — plus purely decorative scatter.
import * as THREE from 'three';
import { mulberry32, hash2, smoothstep } from '../engine/noise.js';
import { ZONES, LOC, WORLD } from './worldmap.js';
import { RELICS } from '../data/items.js';
import { DIG_TABLE } from '../data/world_data.js';
import { weighted } from './util.js';

const TREE_HP = { tree_pine_a: 6, tree_pine_b: 6, tree_pine_c: 6, tree_birch_a: 5, tree_birch_b: 5, tree_oak: 10, tree_dead: 4 };
const ROCK_HP = { rock_a: 4, rock_b: 4, rock_c: 5, ore_copper: 6, ore_iron: 9 };
const DEFAULT_R = { tree_oak: 0.6, tree_dead: 0.35, rock_big: 1.5, stump: 0.35 };

function zoneW(x, z, zone, soft = 0.35) {
  const d = Math.hypot(x - zone.x, z - zone.z);
  return smoothstep(zone.r, zone.r * (1 - soft), d);
}

export class Resources {
  constructor(game) {
    this.game = game;
    this.inst = game.inst;
    this.world = game.world;
    this.terrain = game.engine.terrain;
    this.trees = [];
    this.rocks = [];
    this.bushes = [];
    this.ferns = [];
    this.forage = [];     // runtime entries for today's forage
    this.digs = [];
    this.falling = [];
    this.shakes = [];
    this.group = new THREE.Group();
    game.engine.scene.add(this.group);
  }

  // ------------------------------------------------------------------
  // Deterministic scatter (ids are stable between sessions)
  scatter() {
    const t = this.terrain;
    const rnd = mulberry32(WORLD.seed * 3 + 11);
    const half = t.half - 12;
    const occupied = [];
    const cellOcc = new Map();
    const key = (x, z) => `${Math.floor(x / 4)},${Math.floor(z / 4)}`;
    const free = (x, z, r) => {
      const ci = Math.floor(x / 4), cj = Math.floor(z / 4);
      for (let i = ci - 2; i <= ci + 2; i++) for (let j = cj - 2; j <= cj + 2; j++) {
        const arr = cellOcc.get(`${i},${j}`);
        if (!arr) continue;
        for (const o of arr) if ((o.x - x) ** 2 + (o.z - z) ** 2 < (o.r + r) ** 2) return false;
      }
      return true;
    };
    const occupy = (x, z, r) => {
      const k = key(x, z);
      if (!cellOcc.has(k)) cellOcc.set(k, []);
      cellOcc.get(k).push({ x, z, r });
      occupied.push({ x, z, r });
    };
    const valid = (x, z, { minH = 0.9, maxSlope = 0.75, pathPad = 2.6, blockPad = 1.5 } = {}) => {
      const h = t.heightAt(x, z);
      if (h < minH) return false;
      if (t.normalAt(x, z).y < maxSlope) return false;
      const s = t.splatAt(x, z);
      if (s.path > 0.25 || s.plaza > 0.2 || s.farm > 0.1) return false;
      if (this.world.pathDistance(x, z) < pathPad) return false;
      if (this.world.blocked(x, z, blockPad)) return false;
      return true;
    };
    const mist = ZONES.mistwood, meadow = ZONES.meadow, heath = ZONES.heath;
    const village = ZONES.village, croft = ZONES.croft, grave = ZONES.graveyard;

    // --- ore veins: a few dependable clusters in the heath and the Mistwood ---
    const veins = [
      { x: 84, z: 44, r: 12, n: 5, iron: 0 }, { x: 74, z: 58, r: 8, n: 3, iron: 0 },
      { x: 58, z: -50, r: 10, n: 4, iron: 0.5 }, { x: 74, z: -66, r: 10, n: 5, iron: 0.7 },
      { x: 46, z: -62, r: 8, n: 3, iron: 0.4 }, { x: -18, z: -70, r: 8, n: 3, iron: 0 },
    ];
    for (const v of veins) {
      let placed = 0;
      for (let k = 0; k < 60 && placed < v.n; k++) {
        const a = rnd() * Math.PI * 2, d = rnd() * v.r;
        const px = v.x + Math.cos(a) * d, pz = v.z + Math.sin(a) * d;
        if (!valid(px, pz, { minH: 0.8, maxSlope: 0.6, pathPad: 1.5 }) || !free(px, pz, 1.4)) continue;
        occupy(px, pz, 1.4);
        this.rocks.push({ model: rnd() < v.iron ? 'ore_iron' : 'ore_copper', x: px, z: pz, rot: rnd() * Math.PI * 2, scale: 0.9 + rnd() * 0.3 });
        placed++;
      }
    }
    // --- rocks & ore (6 m grid) ---
    for (let z = -half; z < half; z += 6) {
      for (let x = -half; x < half; x += 6) {
        const px = x + rnd() * 6, pz = z + rnd() * 6;
        const r1 = rnd(), r2 = rnd(), r3 = rnd();
        const wm = zoneW(px, pz, mist), wh = zoneW(px, pz, heath), wv = zoneW(px, pz, village, 0.3);
        let p = 0.045 + 0.2 * wm + 0.3 * wh;
        p *= 1 - wv * 0.9;
        if (r1 > p) continue;
        if (!valid(px, pz, { minH: 0.4, maxSlope: 0.6, pathPad: 2 })) continue;
        if (!free(px, pz, 1.3)) continue;
        let model = ['rock_a', 'rock_b', 'rock_c'][Math.floor(r2 * 3)];
        if (wh > 0.4 && r3 < 0.28) model = 'ore_copper';
        else if (wm > 0.4 && r3 < 0.14) model = 'ore_copper';
        else if (wm > 0.55 && r3 < 0.3) model = 'ore_iron';
        occupy(px, pz, 1.3);
        this.rocks.push({ model, x: px, z: pz, rot: rnd() * Math.PI * 2, scale: 0.85 + rnd() * 0.35 });
      }
    }
    // --- trees (3 m jittered grid) ---
    for (let z = -half; z < half; z += 3) {
      for (let x = -half; x < half; x += 3) {
        const px = x + rnd() * 3, pz = z + rnd() * 3;
        const r1 = rnd(), r2 = rnd(), r3 = rnd();
        const wm = zoneW(px, pz, mist), wmd = zoneW(px, pz, meadow), wh = zoneW(px, pz, heath);
        const wv = zoneW(px, pz, village, 0.3), wc = zoneW(px, pz, croft, 0.3), wg = zoneW(px, pz, grave, 0.4);
        const clump = hash2(Math.floor(px / 14), Math.floor(pz / 14), 3);
        let p = 0.09 + 0.14 * smoothstep(0.4, 0.8, clump);
        p = p * (1 - wm) + 0.68 * wm;
        p = p * (1 - wmd) + 0.16 * wmd;
        p = p * (1 - wh) + 0.035 * wh;
        p *= (1 - wv * 0.92) * (1 - wc * 0.85);
        if (r1 > p) continue;
        if (!valid(px, pz, { minH: 1.3, maxSlope: 0.72 })) continue;
        let model;
        if (wg > 0.4) model = 'tree_dead';
        else if (wm > 0.5) model = r2 < 0.22 ? 'tree_dead' : r2 < 0.3 ? 'tree_birch_b' : ['tree_pine_a', 'tree_pine_b', 'tree_pine_c'][Math.floor(r3 * 3)];
        else if (wmd > 0.5) model = r2 < 0.55 ? (r3 < 0.5 ? 'tree_birch_a' : 'tree_birch_b') : r2 < 0.72 ? 'tree_oak' : 'tree_pine_b';
        else model = r2 < 0.55 ? ['tree_pine_a', 'tree_pine_b', 'tree_pine_c'][Math.floor(r3 * 3)] : r2 < 0.85 ? (r3 < 0.5 ? 'tree_birch_a' : 'tree_birch_b') : 'tree_oak';
        const rr = model === 'tree_oak' ? 2.4 : model.includes('birch') ? 1.15 : 1.3;
        if (!free(px, pz, rr)) continue;
        occupy(px, pz, rr);
        this.trees.push({ model, x: px, z: pz, rot: rnd() * Math.PI * 2, scale: 0.8 + rnd() * 0.45 });
      }
    }
    // --- bushes & ferns (4 m grid) ---
    for (let z = -half; z < half; z += 4) {
      for (let x = -half; x < half; x += 4) {
        const px = x + rnd() * 4, pz = z + rnd() * 4;
        const r1 = rnd(), r2 = rnd();
        const wm = zoneW(px, pz, mist), wmd = zoneW(px, pz, meadow), wv = zoneW(px, pz, village, 0.3);
        const s = t.splatAt(px, pz);
        const pb = (0.03 + 0.16 * wmd + 0.03 * s.forest) * (1 - wv * 0.8);
        const pf = (0.05 + 0.25 * wm + 0.18 * s.forest) * (1 - wv * 0.9);
        if (r1 < pb) {
          if (!valid(px, pz, { minH: 1, maxSlope: 0.75, pathPad: 1.8, blockPad: 1 }) || !free(px, pz, 1)) continue;
          occupy(px, pz, 1);
          const model = r2 < 0.4 ? 'bush_raspberry' : r2 < 0.7 ? 'bush_blueberry' : 'bush_a';
          this.bushes.push({ kind: model, x: px, z: pz, rot: rnd() * Math.PI * 2, scale: 0.85 + rnd() * 0.3 });
        } else if (r1 < pb + pf) {
          if (!valid(px, pz, { minH: 0.9, maxSlope: 0.7, pathPad: 1.5, blockPad: 0.8 }) || !free(px, pz, 0.6)) continue;
          occupy(px, pz, 0.6);
          this.ferns.push({ x: px, z: pz, rot: rnd() * Math.PI * 2, scale: 0.8 + rnd() * 0.5 });
        }
      }
    }
    // --- decorative scatter ---
    this.decor = [];
    for (let z = -half; z < half; z += 3) {
      for (let x = -half; x < half; x += 3) {
        const px = x + rnd() * 3, pz = z + rnd() * 3;
        const r1 = rnd(), r2 = rnd(), r3 = rnd();
        const h = t.heightAt(px, pz);
        const s = t.splatAt(px, pz);
        const wmd = zoneW(px, pz, meadow), wm = zoneW(px, pz, mist), wh = zoneW(px, pz, heath);
        if (s.mud > 0.4 && h > -0.1 && h < 1.3 && r1 < 0.45) {
          if (free(px, pz, 0.5)) this.decor.push({ model: 'reeds', x: px, z: pz, rot: r2 * 6.28, scale: 0.8 + r3 * 0.5 });
          continue;
        }
        if (s.sand > 0.5 && h > 0.2 && r1 < 0.05) { this.decor.push({ model: 'pebbles', x: px, z: pz, rot: r2 * 6.28, scale: 1 + r3 }); continue; }
        if (!valid(px, pz, { minH: 0.8, maxSlope: 0.7, pathPad: 1.2, blockPad: 0.5 })) {
          // steep coastal slopes get cliff outcrops
          if (h > 1 && t.normalAt(px, pz).y < 0.55 && r1 < 0.05 && free(px, pz, 3)) {
            occupy(px, pz, 3);
            this.decor.push({ model: r2 < 0.5 ? 'cliff_a' : 'cliff_b', x: px, z: pz, rot: r3 * 6.28, scale: 0.6 + r1 * 8, collide: true });
          }
          continue;
        }
        const pflower = 0.02 + 0.3 * wmd;
        if (r1 < pflower) { if (free(px, pz, 0.3)) this.decor.push({ model: r2 < 0.5 ? 'flower_patch_a' : 'flower_patch_b', x: px, z: pz, rot: r3 * 6.28, scale: 0.8 + r2 * 0.6 }); continue; }
        if (r1 < pflower + 0.004 + 0.02 * wm && free(px, pz, 2)) { occupy(px, pz, 2); this.decor.push({ model: 'log_fallen', x: px, z: pz, rot: r3 * 6.28, scale: 0.8 + r2 * 0.4, collide: true }); continue; }
        if (r1 < pflower + 0.008 + 0.012 * wh && free(px, pz, 2.2)) { occupy(px, pz, 2.2); this.decor.push({ model: 'rock_big', x: px, z: pz, rot: r3 * 6.28, scale: 0.7 + r2 * 0.6, collide: true }); continue; }
      }
    }
    // forage spots (candidate points used by the daily roll)
    this.spots = [];
    for (let k = 0; k < 900; k++) {
      const px = (rnd() * 2 - 1) * half, pz = (rnd() * 2 - 1) * half;
      if (!valid(px, pz, { minH: 0.5, maxSlope: 0.7, pathPad: 1.2, blockPad: 0.8 })) continue;
      if (!free(px, pz, 0.5)) continue;
      const s = t.splatAt(px, pz);
      this.spots.push({
        x: px, z: pz,
        mist: zoneW(px, pz, mist), meadow: zoneW(px, pz, meadow), grave: zoneW(px, pz, grave),
        forest: s.forest, sand: s.sand, mud: s.mud, village: zoneW(px, pz, village, 0.3),
      });
    }
  }

  // ------------------------------------------------------------------
  // Build instance pools & colliders; apply saved state
  build() {
    const st = this.game.state.res;
    const day = this.game.state.totalDays;
    const lib = this.game.lib;
    const colR = (name, s) => (lib.template(name).userData.col_r || DEFAULT_R[name] || 0.4) * s;
    this.trees.forEach((tr, i) => {
      tr.idx = i;
      tr.hpMax = TREE_HP[tr.model] || 6;
      tr.hp = tr.hpMax;
      tr.y = this.terrain.heightAt(tr.x, tr.z) - 0.05;
      tr.pool = this.inst.pool(tr.model, { capacity: 900, radius: 115 });
      tr.item = tr.pool.add(tr.x, tr.y, tr.z, tr.rot, tr.scale, tr);
      tr.stumpPool = this.inst.pool('stump', { capacity: 400, radius: 120 });
      tr.stump = null;
      tr.col = this.game.colliders.circle(tr.x, tr.z, colR(tr.model, tr.scale) * 0.9, tr);
      const saved = st.trees[i];
      if (saved) {
        // saved = { respawn: day, stump: bool }
        if (day < saved.respawn) this.fellTree(tr, true, saved.stump);
        else delete st.trees[i];
      }
    });
    this.rocks.forEach((rk, i) => {
      rk.idx = i;
      rk.hpMax = ROCK_HP[rk.model] || 4;
      rk.hp = rk.hpMax;
      rk.y = this.terrain.heightAt(rk.x, rk.z) - 0.05;
      rk.pool = this.inst.pool(rk.model, { capacity: 500, radius: 130 });
      rk.item = rk.pool.add(rk.x, rk.y, rk.z, rk.rot, rk.scale, rk);
      rk.col = this.game.colliders.circle(rk.x, rk.z, colR(rk.model, rk.scale) * 0.85, rk);
      const saved = st.rocks[i];
      if (saved && day < saved) this.breakRock(rk, true);
      else if (saved) delete st.rocks[i];
    });
    this.bushes.forEach((b, i) => {
      b.idx = i;
      b.y = this.terrain.heightAt(b.x, b.z) - 0.03;
      b.pools = {
        full: this.inst.pool(b.kind, { capacity: 400, radius: 110 }),
        empty: this.inst.pool('bush_a', { capacity: 600, radius: 110 }),
      };
      b.itemFull = b.pools.full.add(b.x, b.y, b.z, b.rot, b.scale, b);
      b.itemEmpty = b.kind === 'bush_a' ? null : b.pools.empty.add(b.x, b.y, b.z, b.rot, b.scale, b);
      this.refreshBush(b);
    });
    const fernPool = this.inst.pool('fern', { capacity: 1500, radius: 90, castShadow: false });
    this.ferns.forEach((f, i) => {
      f.idx = i;
      f.y = this.terrain.heightAt(f.x, f.z) - 0.02;
      f.item = fernPool.add(f.x, f.y, f.z, f.rot, f.scale, f);
      if (st.ferns[i] && day < st.ferns[i]) fernPool.kill(f.item);
      else delete st.ferns[i];
    });
    for (const d of this.decor) {
      const pool = this.inst.pool(d.model, { capacity: 1500, radius: d.model.startsWith('cliff') || d.model === 'rock_big' ? 220 : 90, castShadow: !['flower_patch_a', 'flower_patch_b', 'pebbles', 'reeds'].includes(d.model) });
      const y = this.terrain.heightAt(d.x, d.z) - (d.model.startsWith('cliff') ? 0.8 : 0.03);
      pool.add(d.x, y, d.z, d.rot, d.scale, d);
      if (d.collide) this.game.colliders.circle(d.x, d.z, colR(d.model, d.scale) * 0.85, d);
    }
    // world tree in the sky
    if (lib.has('world_tree')) this.game.engine.sky.setWorldTree(lib.template('world_tree'));
    this.rebuildForage();
    this.rebuildDigs();
  }

  bushRipe(b) {
    const season = this.game.season;
    if (b.kind === 'bush_a') return false;
    const ok = b.kind === 'bush_raspberry' ? season === 'summer' : (season === 'summer' || season === 'autumn');
    const regrow = this.game.state.res.bushes[b.idx] || 0;
    return ok && this.game.state.totalDays >= regrow;
  }

  refreshBush(b) {
    if (b.kind === 'bush_a') return;
    const ripe = this.bushRipe(b);
    if (ripe) { b.pools.full.revive(b.itemFull); b.pools.empty.kill(b.itemEmpty); }
    else { b.pools.full.kill(b.itemFull); b.pools.empty.revive(b.itemEmpty); }
  }

  // ------------------------------------------------------------------
  // Daily forage & dig spots
  rebuildForage() {
    for (const f of this.forage) f.pool.kill(f.item);
    this.forage = [];
    for (const rec of this.game.state.res.forage) this.spawnForage(rec);
  }

  spawnForage(rec) {
    const pool = this.inst.pool(rec.id === 'hazelnut' || rec.id === 'cloudberry' ? `item_${rec.id}` : rec.id, { capacity: 120, radius: 100, castShadow: false });
    const y = this.terrain.heightAt(rec.x, rec.z) - 0.02;
    const it = { rec, pool, item: pool.add(rec.x, y, rec.z, rec.rot || 0, rec.id.startsWith('mushroom') || rec.id === 'thistle' || rec.id === 'dandelion' ? 1.2 : 0.9, rec), x: rec.x, z: rec.z };
    this.forage.push(it);
    return it;
  }

  rollForage(rnd = Math.random) {
    const season = this.game.season;
    const out = [];
    const table = [];
    for (const s of this.spots) {
      if (s.village > 0.6) continue;
      const opts = [];
      if (season !== 'winter') opts.push(['mushroom_red', 1 + 3 * s.forest + 2 * s.mist]);
      if (season === 'autumn') opts.push(['mushroom_yellow', 3 * s.mist + 1 * s.forest]);
      if (season !== 'summer') opts.push(['mushroom_glow', 2 * s.mist + 2.5 * s.grave]);
      if (season === 'spring' || season === 'summer') opts.push(['thistle', 0.5 + 3 * s.meadow]);
      if (season === 'spring') opts.push(['dandelion', 1 + 3 * s.meadow]);
      if (season === 'summer') opts.push(['dandelion', 0.4 + 1 * s.meadow]);
      if (season === 'autumn') { opts.push(['cloudberry', 3 * s.mud + 0.3]); opts.push(['hazelnut', 0.6 + 1.5 * s.meadow]); }
      if (season === 'winter') opts.push(['mushroom_red', 0.2 + s.forest]);
      const tot = opts.reduce((a, b) => a + b[1], 0);
      if (tot > 0) table.push({ s, opts, tot });
    }
    const n = 34;
    for (let k = 0; k < n && table.length; k++) {
      const i = Math.floor(rnd() * table.length);
      const { s, opts } = table.splice(i, 1)[0];
      out.push({ id: weighted(opts, rnd), x: s.x, z: s.z, rot: rnd() * 6.28 });
    }
    return out;
  }

  rebuildDigs() {
    for (const d of this.digs) d.pool.kill(d.item);
    this.digs = [];
    const pool = this.inst.pool('pebbles', { capacity: 40, radius: 120, castShadow: false });
    for (const rec of this.game.state.res.digs) {
      const y = this.terrain.heightAt(rec.x, rec.z);
      this.digs.push({ rec, pool, item: pool.add(rec.x, y, rec.z, rec.rot || 0, 0.9, rec), x: rec.x, z: rec.z, y, t: Math.random() * 2 });
    }
  }

  rollDigs(rnd = Math.random) {
    const out = [];
    const cands = this.spots.filter((s) => s.village < 0.4);
    for (let k = 0; k < 5 && cands.length; k++) {
      const i = Math.floor(rnd() * cands.length);
      const s = cands.splice(i, 1)[0];
      out.push({ x: s.x + 0.3, z: s.z - 0.3, rot: rnd() * 6.28 });
    }
    return out;
  }

  // Called by the day cycle.
  newDay(rnd) {
    const st = this.game.state;
    const day = st.totalDays;
    // regrow trees / rocks / ferns whose timers ran out
    for (const [i, v] of Object.entries(st.res.trees)) {
      if (day >= v.respawn) { this.regrowTree(this.trees[i]); delete st.res.trees[i]; }
    }
    for (const [i, v] of Object.entries(st.res.rocks)) {
      if (day >= v) { this.restoreRock(this.rocks[i]); delete st.res.rocks[i]; }
    }
    for (const [i, v] of Object.entries(st.res.ferns)) {
      if (day >= v) { this.inst.pool('fern').revive(this.ferns[i].item); delete st.res.ferns[i]; }
    }
    for (const b of this.bushes) this.refreshBush(b);
    st.res.forage = this.rollForage(rnd);
    st.res.digs = this.rollDigs(rnd);
    this.rebuildForage();
    this.rebuildDigs();
  }

  // ------------------------------------------------------------------
  // Queries
  nearest(list, x, z, r, filter) {
    let best = null, bd = r * r;
    for (const e of list) {
      if (filter && !filter(e)) continue;
      const d = (e.x - x) ** 2 + (e.z - z) ** 2;
      if (d < bd) { bd = d; best = e; }
    }
    return best;
  }

  treeAt(x, z, r = 1.6) { return this.nearest(this.trees, x, z, r, (t) => !t.felled || t.stump); }
  rockAt(x, z, r = 1.5) { return this.nearest(this.rocks, x, z, r, (k) => !k.broken); }
  fernAt(x, z, r = 1.2) { return this.nearest(this.ferns, x, z, r, (f) => f.item.alive); }
  bushAt(x, z, r = 1.6) { return this.nearest(this.bushes, x, z, r, (b) => this.bushRipe(b)); }
  forageAt(x, z, r = 1.3) { return this.nearest(this.forage, x, z, r); }
  digAt(x, z, r = 1.0) { return this.nearest(this.digs, x, z, r); }

  // ------------------------------------------------------------------
  // Actions
  hitTree(tr, power, fromX, fromZ) {
    const g = this.game;
    if (tr.felled) {
      if (!tr.stump) return false;
      tr.stumpHp = (tr.stumpHp ?? 3) - power;
      g.effects.burst('wood', new THREE.Vector3(tr.x, tr.y + 0.4, tr.z));
      g.audio.sfx('chop', { x: tr.x, z: tr.z, pitch: 0.9 });
      if (tr.stumpHp <= 0) {
        tr.stumpPool.kill(tr.stump);
        tr.stump = null;
        g.colliders.remove(tr.col);
        g.state.res.trees[tr.idx].stump = false;
        g.drops.spawn('wood', 2 + (Math.random() < 0.5 ? 1 : 0), new THREE.Vector3(tr.x, tr.y + 0.3, tr.z));
        g.audio.sfx('rock_break', { x: tr.x, z: tr.z, pitch: 0.7 });
      }
      return true;
    }
    tr.hp -= power;
    g.effects.burst('wood', new THREE.Vector3(tr.x, tr.y + 1.0, tr.z));
    if (!tr.model.includes('dead')) g.effects.burst('leaves', new THREE.Vector3(tr.x, tr.y + 2.5, tr.z), { n: 5 });
    g.audio.sfx('chop', { x: tr.x, z: tr.z });
    this.shakes.push({ tr, t: 0, dir: Math.atan2(tr.x - fromX, tr.z - fromZ) });
    if (tr.hp <= 0) {
      this.fellTree(tr, false, true, Math.atan2(tr.x - fromX, tr.z - fromZ));
      const wood = { tree_oak: 9, tree_dead: 3, tree_birch_a: 5, tree_birch_b: 5 }[tr.model] || 6;
      const dir = Math.atan2(tr.x - fromX, tr.z - fromZ);
      const tip = new THREE.Vector3(tr.x + Math.sin(dir) * 3, tr.y + 0.5, tr.z + Math.cos(dir) * 3);
      g.drops.spawn('wood', wood + Math.floor(Math.random() * 3), tip, { delay: 1.2, spread: 1.5 });
      if (tr.model.includes('pine') && Math.random() < 0.6) g.drops.spawn('resin', 1 + Math.floor(Math.random() * 2), tip, { delay: 1.3 });
      if (tr.model === 'tree_dead' && Math.random() < 0.5) g.drops.spawn('coal', 1, tip, { delay: 1.3 });
      if ((tr.model === 'tree_oak' || tr.model.includes('birch')) && g.season === 'autumn' && Math.random() < 0.6) g.drops.spawn('hazelnut', 1 + Math.floor(Math.random() * 2), tip, { delay: 1.3 });
      if (Math.random() < 0.25) g.drops.spawn('feather', 1, tip, { delay: 1.4 });
      g.onTreeFelled && g.onTreeFelled(tr);
    }
    return true;
  }

  fellTree(tr, instant, keepStump = true, dir = 0) {
    tr.felled = true;
    tr.pool.kill(tr.item);
    const days = 6 + Math.floor(Math.random() * 4);
    const st = this.game.state.res.trees;
    if (!st[tr.idx]) st[tr.idx] = { respawn: this.game.state.totalDays + days, stump: keepStump };
    if (keepStump) {
      tr.stump = tr.stumpPool.add(tr.x, tr.y, tr.z, tr.rot, tr.scale, tr);
      tr.stumpHp = 3;
      // shrink the collider to the stump
      this.game.colliders.remove(tr.col);
      tr.col = this.game.colliders.circle(tr.x, tr.z, 0.35 * tr.scale, tr);
    } else {
      this.game.colliders.remove(tr.col);
    }
    if (!instant) {
      const obj = this.game.lib.clone(tr.model);
      obj.position.set(tr.x, tr.y, tr.z);
      obj.rotation.set(0, tr.rot, 0);
      obj.scale.setScalar(tr.scale);
      this.group.add(obj);
      this.falling.push({ obj, t: 0, dir, tr });
      this.game.audio.sfx('tree_fall', { x: tr.x, z: tr.z });
    }
  }

  regrowTree(tr) {
    if (!tr) return;
    tr.felled = false;
    tr.hp = tr.hpMax;
    if (tr.stump) { tr.stumpPool.kill(tr.stump); tr.stump = null; }
    tr.pool.revive(tr.item);
    this.game.colliders.remove(tr.col);
    const r = (this.game.lib.template(tr.model).userData.col_r || 0.4) * tr.scale * 0.9;
    tr.col = this.game.colliders.circle(tr.x, tr.z, r, tr);
  }

  hitRock(rk, power, toolLevel) {
    const g = this.game;
    if (rk.model === 'ore_iron' && toolLevel < 1) {
      g.audio.sfx('block', { x: rk.x, z: rk.z });
      g.effects.burst('hit', new THREE.Vector3(rk.x, rk.y + 0.6, rk.z));
      g.toast('This iron vein is too hard for a stone pickaxe. Bramble could help.');
      return true;
    }
    rk.hp -= power;
    g.effects.burst('stone', new THREE.Vector3(rk.x, rk.y + 0.6, rk.z));
    g.audio.sfx('pick_stone', { x: rk.x, z: rk.z });
    if (rk.hp <= 0) {
      this.breakRock(rk, false);
      const p = new THREE.Vector3(rk.x, rk.y + 0.5, rk.z);
      if (rk.model === 'ore_copper') { g.drops.spawn('copper_ore', 2 + Math.floor(Math.random() * 3), p); g.drops.spawn('stone', 2, p); }
      else if (rk.model === 'ore_iron') { g.drops.spawn('iron_ore', 2 + Math.floor(Math.random() * 2), p); g.drops.spawn('stone', 2, p); }
      else {
        g.drops.spawn('stone', 3 + Math.floor(Math.random() * 3), p);
        if (Math.random() < 0.35) g.drops.spawn('flint', 1, p);
        if (Math.random() < 0.15) g.drops.spawn('coal', 1, p);
        if (Math.random() < 0.06) g.drops.spawn('copper_ore', 1, p);
      }
      g.audio.sfx('rock_break', { x: rk.x, z: rk.z });
      g.effects.burst('dust', p, { n: 8 });
    }
    return true;
  }

  breakRock(rk, instant) {
    rk.broken = true;
    rk.pool.kill(rk.item);
    this.game.colliders.remove(rk.col);
    const st = this.game.state.res.rocks;
    if (!st[rk.idx]) st[rk.idx] = this.game.state.totalDays + 4 + Math.floor(Math.random() * 3);
  }

  restoreRock(rk) {
    if (!rk) return;
    rk.broken = false;
    rk.hp = rk.hpMax;
    rk.pool.revive(rk.item);
    const r = (this.game.lib.template(rk.model).userData.col_r || 0.5) * rk.scale * 0.85;
    rk.col = this.game.colliders.circle(rk.x, rk.z, r, rk);
  }

  cutFern(f) {
    const g = this.game;
    this.inst.pool('fern').kill(f.item);
    g.state.res.ferns[f.idx] = g.state.totalDays + 2;
    g.effects.burst('leaves', new THREE.Vector3(f.x, f.y + 0.3, f.z), { n: 6 });
    g.audio.sfx('harvest', { x: f.x, z: f.z, pitch: 1.2 });
    if (Math.random() < 0.8) g.drops.spawn('fiber', 1 + (Math.random() < 0.3 ? 1 : 0), new THREE.Vector3(f.x, f.y + 0.2, f.z), { up: 2.5 });
  }

  pickBush(b) {
    const g = this.game;
    const id = b.kind === 'bush_raspberry' ? 'raspberry' : 'blueberry';
    g.state.res.bushes[b.idx] = g.state.totalDays + 3;
    this.refreshBush(b);
    g.drops.spawn(id, 2 + Math.floor(Math.random() * 3), new THREE.Vector3(b.x, b.y + 0.6, b.z), { up: 2.5 });
    g.effects.burst('leaves', new THREE.Vector3(b.x, b.y + 0.5, b.z), { n: 5 });
    g.audio.sfx('harvest', { x: b.x, z: b.z });
  }

  pickForage(f) {
    const g = this.game;
    f.pool.kill(f.item);
    this.forage.splice(this.forage.indexOf(f), 1);
    const arr = g.state.res.forage;
    const i = arr.indexOf(f.rec);
    if (i >= 0) arr.splice(i, 1);
    const left = g.inventory.add(f.rec.id, 1);
    if (left) g.drops.spawn(f.rec.id, 1, new THREE.Vector3(f.x, this.terrain.heightAt(f.x, f.z) + 0.3, f.z));
    else g.onPickup(f.rec.id, 1);
    g.audio.sfx('harvest', { x: f.x, z: f.z, pitch: 1.1 });
  }

  dig(d) {
    const g = this.game;
    d.pool.kill(d.item);
    this.digs.splice(this.digs.indexOf(d), 1);
    const arr = g.state.res.digs;
    const i = arr.indexOf(d.rec);
    if (i >= 0) arr.splice(i, 1);
    let loot = weighted(DIG_TABLE);
    if (loot === 'relic') {
      const pairs = Object.entries(RELICS).map(([id, r]) => [id, r.weight]);
      loot = weighted(pairs);
      g.state.stats.relics++;
      g.audio.sfx('relic_found');
    }
    const p = new THREE.Vector3(d.x, d.y + 0.3, d.z);
    g.drops.spawn(loot, 1, p, { up: 4 });
    g.effects.burst('dirt', p);
    g.effects.burst('sparkle', p);
  }

  // ------------------------------------------------------------------
  update(dt) {
    // tree shake on hit
    for (let i = this.shakes.length - 1; i >= 0; i--) {
      const s = this.shakes[i];
      s.t += dt;
      const tr = s.tr;
      if (s.t > 0.35 || tr.felled) {
        tr.pool.compose(tr.item);
        tr.pool.dirty = true;
        this.shakes.splice(i, 1);
        continue;
      }
      const a = Math.sin(s.t * 40) * (1 - s.t / 0.35) * 0.05;
      tr.pool.compose(tr.item, { x: Math.cos(s.dir) * a, z: -Math.sin(s.dir) * a });
      tr.pool.dirty = true;
    }
    // falling trees
    for (let i = this.falling.length - 1; i >= 0; i--) {
      const f = this.falling[i];
      f.t += dt;
      const u = Math.min(1, f.t / 1.4);
      const ang = u * u * (Math.PI / 2 - 0.08);
      const ax = new THREE.Vector3(Math.cos(f.dir), 0, -Math.sin(f.dir));
      f.obj.quaternion.setFromAxisAngle(ax, ang).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), f.tr.rot));
      if (f.t > 1.4 && !f.thud) {
        f.thud = true;
        this.game.camera.shake(0.25);
        this.game.effects.burst('dust', new THREE.Vector3(f.tr.x + Math.sin(f.dir) * 4, f.tr.y + 0.2, f.tr.z + Math.cos(f.dir) * 4), { n: 14 });
        this.game.effects.burst('leaves', new THREE.Vector3(f.tr.x + Math.sin(f.dir) * 5, f.tr.y + 0.5, f.tr.z + Math.cos(f.dir) * 5), { n: 12 });
      }
      if (f.t > 1.9) {
        f.obj.position.y -= dt * 2.5;
        f.obj.scale.multiplyScalar(1 - dt * 1.5);
      }
      if (f.t > 2.6) { f.obj.removeFromParent(); this.falling.splice(i, 1); }
    }
    // dig spot sparkles
    for (const d of this.digs) {
      d.t -= dt;
      if (d.t <= 0) {
        d.t = 1.4 + Math.random();
        if (d.item.alive && d.x) this.game.effects.burst('sparkle', new THREE.Vector3(d.x, d.y + 0.15, d.z), { n: 3 });
      }
    }
  }
}
