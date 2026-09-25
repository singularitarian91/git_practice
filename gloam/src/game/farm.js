// The croft's field: tilling, planting, watering, overnight growth,
// withering out of season, crows, rain totems, harvesting.
import * as THREE from 'three';
import { CROPS, ITEMS } from '../data/items.js';
import { FARM } from './worldmap.js';

const WET = new THREE.Color(0.55, 0.52, 0.5);
const DRY = new THREE.Color(1, 1, 1);

export class Farm {
  constructor(game) {
    this.game = game;
    this.terrain = game.engine.terrain;
    this.tiles = game.state.farm;
    this.soilPool = game.inst.pool('soil_tilled', { capacity: 400, radius: 140, castShadow: false });
    this.rt = new Map(); // key -> runtime { soil, crop, cropPool }
    for (const key of Object.keys(this.tiles)) this.sync(key);
  }

  key(tx, tz) { return `${tx},${tz}`; }
  inField(tx, tz) { return tx >= FARM.x0 && tx < FARM.x1 && tz >= FARM.z0 && tz < FARM.z1; }
  tile(tx, tz) { return this.tiles[this.key(tx, tz)] || null; }

  stageOf(t) {
    if (!t.crop) return null;
    if (t.dead) return 'crop_withered';
    const c = CROPS[t.crop];
    const u = t.growth / c.days;
    if (u >= 1) return `crop_${t.crop}_ripe`;
    if (u >= 0.6) return `crop_${t.crop}_grow`;
    if (u >= 0.25) return 'crop_young';
    return 'crop_sprout';
  }

  isRipe(t) { return t && t.crop && !t.dead && t.growth >= CROPS[t.crop].days; }

  // Rebuild the visuals of one tile.
  sync(key) {
    const t = this.tiles[key];
    let r = this.rt.get(key);
    const [tx, tz] = key.split(',').map(Number);
    const cx = tx + 0.5, cz = tz + 0.5;
    const y = this.terrain.heightAt(cx, cz);
    if (!r) { r = { soil: null, crop: null, cropPool: null, stage: null }; this.rt.set(key, r); }
    if (!t) {
      if (r.soil) this.soilPool.kill(r.soil);
      if (r.crop) r.cropPool.kill(r.crop);
      this.rt.delete(key);
      return;
    }
    if (!r.soil) r.soil = this.soilPool.add(cx, y - 0.01, cz, ((tx * 7 + tz * 3) % 4) * Math.PI / 2, 1);
    this.soilPool.setColor(r.soil, t.wet ? WET : DRY);
    const stage = this.stageOf(t);
    if (stage !== r.stage) {
      if (r.crop) { r.cropPool.kill(r.crop); r.crop = null; }
      if (stage) {
        r.cropPool = this.game.inst.pool(stage, { capacity: 300, radius: 120, castShadow: true });
        const rot = ((tx * 13 + tz * 7) % 8) * 0.785;
        r.crop = r.cropPool.add(cx, y + 0.02, cz, rot, 0.95 + ((tx + tz) % 3) * 0.04, { key });
      }
      r.stage = stage;
    }
  }

  // --- actions ---------------------------------------------------------
  canTill(tx, tz) {
    if (!this.inField(tx, tz) || this.tile(tx, tz)) return false;
    return !this.game.colliders.overlaps(tx + 0.5, tz + 0.5, 0.3);
  }

  till(tx, tz) {
    if (!this.canTill(tx, tz)) {
      const t = this.tile(tx, tz);
      if (t && t.dead) { t.crop = null; t.dead = false; this.sync(this.key(tx, tz)); return true; }
      return false;
    }
    const k = this.key(tx, tz);
    this.tiles[k] = { crop: null, growth: 0, wet: this.game.state.weather === 'rain' || this.game.state.weather === 'storm', dead: false };
    this.sync(k);
    return true;
  }

  water(tx, tz) {
    const t = this.tile(tx, tz);
    if (!t || t.wet) return false;
    t.wet = true;
    this.sync(this.key(tx, tz));
    return true;
  }

  plant(tx, tz, cropId) {
    const t = this.tile(tx, tz);
    if (!t || t.crop) return 'occupied';
    const c = CROPS[cropId];
    if (!c.seasons.includes(this.game.season)) return 'season';
    t.crop = cropId;
    t.growth = 0;
    t.dead = false;
    this.sync(this.key(tx, tz));
    return 'ok';
  }

  harvest(tx, tz) {
    const t = this.tile(tx, tz);
    if (!this.isRipe(t)) return false;
    const g = this.game;
    const id = t.crop;
    const c = CROPS[id];
    const n = Math.random() < 0.12 ? 2 : 1;
    const pos = new THREE.Vector3(tx + 0.5, this.terrain.heightAt(tx + 0.5, tz + 0.5) + 0.3, tz + 0.5);
    const left = g.inventory.add(id, n);
    if (left) g.drops.spawn(id, left, pos);
    if (n - left > 0) g.onPickup(id, n - left);
    if (c.extra) for (const [eid, en] of Object.entries(c.extra)) g.drops.spawn(eid, en, pos);
    g.state.stats.crops += n;
    t.crop = null;
    t.growth = 0;
    this.sync(this.key(tx, tz));
    g.effects.burst('dirt', pos, { n: 6 });
    g.effects.burst('leaves', pos, { n: 4 });
    g.audio.sfx('harvest', { x: pos.x, z: pos.z });
    return true;
  }

  // Remove a tilled tile entirely (e.g. building on top of it)
  clear(tx, tz) {
    const k = this.key(tx, tz);
    if (!this.tiles[k]) return;
    delete this.tiles[k];
    this.sync(k);
  }

  // --- overnight -------------------------------------------------------
  newDay(newSeason, weather) {
    const g = this.game;
    let grown = 0;
    const crops = [];
    for (const [k, t] of Object.entries(this.tiles)) {
      if (t.crop && !t.dead) {
        if (t.wet) { t.growth += 1; grown++; }
        if (!CROPS[t.crop].seasons.includes(newSeason)) t.dead = true;
        else crops.push([k, t]);
      }
      t.wet = false;
    }
    // crows (unless a scarecrow watches over the crop)
    const scarecrows = g.state.placed.filter((p) => p.id === 'scarecrow');
    let eaten = 0;
    if (crops.length >= 12) {
      for (const [k, t] of crops) {
        const [tx, tz] = k.split(',').map(Number);
        const safe = scarecrows.some((s) => Math.hypot(s.x - tx - 0.5, s.z - tz - 0.5) < 8.5);
        if (!safe && Math.random() < 0.05 && eaten < 3) { t.crop = null; t.growth = 0; eaten++; }
      }
    }
    // rain waters everything; rain totems water their neighbours
    const raining = weather === 'rain' || weather === 'storm';
    for (const t of Object.values(this.tiles)) if (raining) t.wet = true;
    for (const p of g.state.placed) {
      if (p.id !== 'rain_totem') continue;
      for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
        const t = this.tile(Math.floor(p.x) + dx, Math.floor(p.z) + dz);
        if (t) t.wet = true;
      }
    }
    for (const k of Object.keys(this.tiles)) this.sync(k);
    return { grown, eaten };
  }

  stats() {
    let crops = 0, ripe = 0, dry = 0;
    for (const t of Object.values(this.tiles)) {
      if (t.crop && !t.dead) { crops++; if (this.isRipe(t)) ripe++; else if (!t.wet) dry++; }
    }
    return { crops, ripe, dry };
  }
}

export function seedCrop(id) { return ITEMS[id] && ITEMS[id].crop; }
