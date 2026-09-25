// Static world: buildings, set pieces, decor, lights, doors, colliders,
// walkable platforms, and the objects the player builds.
import * as THREE from 'three';
import { BUILDINGS, DECOR, STATIONS, RUNESTONES, SIGNS, LOC, FARM, PATHS } from './worldmap.js';
import { ITEMS } from '../data/items.js';
import { findPart, findParts, worldPos } from './util.js';
import { getSharedMaterials } from '../engine/materials.js';

// How the light sockets of each model behave.
const LIGHTS = {
  hearth_great: { kind: 'fire', color: 0xff8a30, intensity: 14, radius: 16, scale: 2.0, safe: 18 },
  torch_standing: { kind: 'fire', color: 0xff9a40, intensity: 6, radius: 8, scale: 0.6, safe: 7 },
  brazier: { kind: 'fire', color: 0xff8a30, intensity: 8, radius: 11, scale: 0.9, safe: 10 },
  campfire: { kind: 'fire', color: 0xff8a3a, intensity: 8, radius: 9, scale: 1.0, safe: 8 },
  cauldron: { kind: 'fire', color: 0xff7a30, intensity: 4, radius: 6, scale: 0.55, safe: 5, smoke: true },
  museum_barrow: { kind: 'fire', color: 0xff9040, intensity: 5, radius: 8, scale: 0.7, safe: 9 },
  altar_offering: { kind: 'glow', color: 0x7fd8ff, intensity: 3.5, radius: 7, halo: 1.4 },
  villager_house_a: { kind: 'glow', color: 0xff7a2a, intensity: 4, radius: 7, halo: 0.6 },
  lantern_post: { kind: 'lantern', color: 0xffc070, intensity: 5, radius: 10, nightOnly: true, safe: 9 },
  dock: { kind: 'lantern', color: 0xffc070, intensity: 4, radius: 9, nightOnly: true },
  shop_stall: { kind: 'lantern', color: 0xffb060, intensity: 4, radius: 8, nightOnly: true, safe: 8 },
  villager_house_b: { kind: 'lantern', color: 0xffc98a, intensity: 2.2, radius: 6, nightOnly: true, halo: 0.7 },
  rain_totem: { kind: 'glow', color: 0x6fd0ff, intensity: 1.2, radius: 3, halo: 0.3 },
  default: { kind: 'window', color: 0xffa860, intensity: 2.2, radius: 6, nightOnly: true, halo: 0.45 },
};

export class World {
  constructor(game) {
    this.game = game;
    this.scene = game.engine.scene;
    this.terrain = game.engine.terrain;
    this.lib = game.lib;
    this.colliders = game.colliders;
    this.lighting = game.engine.lighting;
    this.effects = game.effects;
    this.group = new THREE.Group();
    this.group.name = 'world';
    this.scene.add(this.group);
    this.buildings = new Map();
    this.interactables = new Set();
    this.placed = new Map();   // placed id -> runtime record
    this.footprints = [];      // circles for scatter exclusion {x,z,r}
    this.hearth = null;
  }

  // ---------------------------------------------------------------------
  build() {
    const t = this.terrain;
    // resolve positions that sit on the south coast
    const dockX = BUILDINGS.find((b) => b.id === 'sea_dock').x;
    const coastZ = t.findCoastSouth(dockX, 60, 0.35);
    this.dockOrigin = { x: dockX, z: coastZ - 1.5 };
    for (const b of BUILDINGS) {
      let { x, z } = b;
      if (b.coast === true) z = this.dockOrigin.z;
      if (b.coast === 'ship') z = this.dockOrigin.z + 7;
      if (b.shore) {
        // walk along the given direction until the ground drops to the waterline
        for (let k = 0; k < 120; k++) {
          if (t.heightAt(x + b.shore[0] * 0.5, z + b.shore[1] * 0.5) < 0.45) break;
          x += b.shore[0] * 0.5; z += b.shore[1] * 0.5;
        }
        x -= b.shore[0] * 1.0; z -= b.shore[1] * 1.0;
      }
      const obj = this.placeModel(b.model, x, z, b.rot, { id: b.id, ship: b.coast === 'ship' });
      this.buildings.set(b.id, { def: b, obj, x, z, rot: b.rot });
    }
    for (const d of DECOR) this.placeModel(d.model, d.x, d.z, d.rot, { decor: true });
    for (const s of STATIONS) {
      const obj = this.placeModel(s.model, s.x, s.z, s.rot, { id: s.id });
      this.buildings.set(s.id, { def: s, obj, x: s.x, z: s.z, rot: s.rot });
    }
    for (const r of RUNESTONES) {
      const obj = this.placeModel(r.model, r.x, r.z, r.rot, { id: r.id });
      this.buildings.set(r.id, { def: r, obj, x: r.x, z: r.z, rot: r.rot });
    }
    for (const s of SIGNS) {
      const rot = Math.atan2(-s.x, -s.z); // face the village
      const obj = this.placeModel('signpost', s.x, s.z, rot, { id: 'sign_' + s.id });
      this.buildings.set('sign_' + s.id, { def: s, obj, x: s.x, z: s.z, rot });
    }
    this.setupHearth();
    // scatter exclusion around the farm and along paths is handled by terrain splats
    this.footprints.push({ x: (FARM.x0 + FARM.x1) / 2, z: (FARM.z0 + FARM.z1) / 2, r: 11 });
  }

  groundY(x, z) {
    const p = this.colliders.platformAt(x, z);
    const h = this.terrain.heightAt(x, z);
    return p ? Math.max(p.h, h) : h;
  }

  // Place a model from the library on the ground.  Returns the Object3D.
  placeModel(name, x, z, rot = 0, opts = {}) {
    const obj = this.lib.clone(name);
    const ud = obj.userData || {};
    let y;
    if (opts.ship) {
      y = -0.05;
    } else if (name === 'dock' || name === 'bridge') {
      // the bridge spans its local Z axis: rest it on the lower of its two banks
      y = name === 'dock' ? Math.max(this.terrain.heightAt(x, z), 0) - 0.1
        : Math.min(this.terrain.heightAt(x - Math.sin(rot) * 3.8, z - Math.cos(rot) * 3.8), this.terrain.heightAt(x + Math.sin(rot) * 3.8, z + Math.cos(rot) * 3.8)) - 0.1;
    } else {
      // sit on the lowest ground under the footprint so nothing floats
      const r = ud.col_r || (ud.col_box ? Math.min(ud.col_box[0], ud.col_box[1]) / 2 : 0.3);
      y = Math.min(this.terrain.heightAt(x, z), this.terrain.heightAt(x + r * 0.7, z), this.terrain.heightAt(x - r * 0.7, z),
        this.terrain.heightAt(x, z + r * 0.7), this.terrain.heightAt(x, z - r * 0.7));
    }
    obj.position.set(x, y, z);
    obj.rotation.y = rot;
    this.group.add(obj);
    obj.updateMatrixWorld(true);

    // colliders
    const owner = opts.owner || obj;
    const colls = [];
    if (ud.col_box) colls.push(this.colliders.box(x, z, ud.col_box[0], ud.col_box[1], rot, owner));
    else if (ud.col_r) colls.push(this.colliders.circle(x, z, ud.col_r, owner));
    if (ud.stones) {
      const s = ud.stones;
      for (let i = 0; i + 1 < s.length; i += 2) {
        const lx = s[i], lz = -s[i + 1];
        colls.push(this.colliders.circle(x + lx * Math.cos(rot) + lz * Math.sin(rot), z - lx * Math.sin(rot) + lz * Math.cos(rot), 0.6, owner));
      }
    }
    obj.userData.colliders = colls;
    const fr = ud.col_r || (ud.col_box ? Math.hypot(ud.col_box[0], ud.col_box[1]) / 2 : 0.5);
    if (!opts.noFootprint) this.footprints.push({ x, z, r: fr + 1.2, obj });

    // walkable decks
    if (name === 'dock') {
      const len = ud.deck_len || 10, w = ud.deck_w || 3, h = (ud.deck_h ?? 0.9) + y;
      const cx = x + Math.sin(rot) * len / 2, cz = z + Math.cos(rot) * len / 2;
      this.colliders.addPlatform(cx, cz, w, len + 0.6, rot, () => h);
      obj.userData.deckEnd = new THREE.Vector3(x + Math.sin(rot) * (len - 0.8), h, z + Math.cos(rot) * (len - 0.8));
      obj.userData.deckY = h;
    }
    if (name === 'bridge') {
      const len = 8, w = ud.deck_w || 2.2;
      const hPeak = (ud.deck_h ?? 1.2) + y, hEnd = (ud.deck_end_h ?? 0.35) + y;
      // the bridge spans its local Z (Blender Y)
      this.colliders.addPlatform(x, z, w, len + 1, rot, (lx, lz) => {
        const u = Math.min(1, Math.abs(lz) / (len / 2));
        return hPeak + (hEnd - hPeak) * u * u;
      });
    }

    // lights, fires, smoke
    const L = LIGHTS[name] || LIGHTS.default;
    const lights = findParts(obj, 'light');
    obj.userData.lights = [];
    obj.userData.fires = [];
    for (const s of lights) {
      const p = worldPos(s);
      const src = this.lighting.add({
        pos: p, color: L.color, intensity: L.intensity, radius: L.radius, flicker: L.kind === 'fire' ? 0.8 : L.kind === 'window' ? 0.15 : 0.3,
        halo: L.halo ?? 1, nightOnly: !!L.nightOnly, safe: L.safe || 0,
      });
      obj.userData.lights.push(src);
      if (L.kind === 'fire') obj.userData.fires.push(this.effects.addFire(p, L.scale, { smoke: L.smoke ?? true }));
    }
    for (const s of findParts(obj, 'smoke')) this.effects.addSmoke(worldPos(s), 1);

    // doors become interaction points
    const door = findPart(obj, 'door');
    if (door) obj.userData.doorPos = worldPos(door);
    obj.userData.modelName = name;
    return obj;
  }

  removeModel(obj) {
    if (!obj) return;
    for (const c of obj.userData.colliders || []) this.colliders.remove(c);
    for (const l of obj.userData.lights || []) this.lighting.remove(l);
    for (const f of obj.userData.fires || []) this.effects.removeFire(f);
    const fi = this.footprints.findIndex((f) => f.obj === obj);
    if (fi >= 0) this.footprints.splice(fi, 1);
    obj.removeFromParent();
  }

  // Scatter exclusion: near buildings/props or the farm field?
  blocked(x, z, pad = 0) {
    for (const f of this.footprints) {
      const dx = x - f.x, dz = z - f.z;
      if (dx * dx + dz * dz < (f.r + pad) ** 2) return true;
    }
    if (x > FARM.x0 - 1.5 && x < FARM.x1 + 1.5 && z > FARM.z0 - 1.5 && z < FARM.z1 + 1.5) return true;
    return false;
  }

  // ---------------------------------------------------------------------
  // The Great Hearth: rune stones light up as offerings are completed.
  setupHearth() {
    const b = this.buildings.get('hearth');
    if (!b) return;
    const obj = b.obj;
    const runes = [];
    for (let i = 1; i <= 5; i++) {
      const r = findPart(obj, `rune_${i}`);
      if (r) runes.push(r);
    }
    const dim = new THREE.MeshBasicMaterial({ color: 0x1c2a33 });
    this.hearth = { obj, runes, dim, emit: getSharedMaterials().Mat_Emit, level: -1 };
    this.setHearthLevel(0);
  }

  setHearthLevel(n, dawn = false) {
    const h = this.hearth;
    if (!h || h.level === n) return;
    h.level = n;
    h.runes.forEach((r, i) => {
      r.traverse((o) => {
        if (!o.isMesh) return;
        if (!o.userData.origMat) o.userData.origMat = o.material;
        const isEmit = o.userData.origMat.name === 'Mat_Emit';
        if (isEmit) o.material = i < n ? h.emit : h.dim;
      });
    });
    const lights = h.obj.userData.lights || [];
    const fires = h.obj.userData.fires || [];
    const k = 0.45 + n * 0.11 + (dawn ? 0.3 : 0);
    for (const l of lights) { l.intensity = 14 * k; l.radius = 10 + n * 2; l.safe = 12 + n * 3; }
    for (const f of fires) f.scale = 1.2 + n * 0.25 + (dawn ? 0.4 : 0);
    this.game.engine.env.clearRadius = 12 + n * 3 + (dawn ? 10 : 0);
  }

  // ---------------------------------------------------------------------
  // Player-built objects
  addPlaced(rec) {
    const it = ITEMS[rec.id];
    const obj = this.placeModel(it.place, rec.x, rec.z, rec.rot || 0, { placed: true });
    obj.userData.placedId = rec.uid;
    this.placed.set(rec.uid, { rec, obj });
    return obj;
  }

  removePlaced(uid) {
    const p = this.placed.get(uid);
    if (!p) return null;
    this.removeModel(p.obj);
    this.placed.delete(uid);
    return p.rec;
  }

  placedNear(x, z, r) {
    let best = null, bd = r * r;
    for (const p of this.placed.values()) {
      const dx = p.rec.x - x, dz = p.rec.z - z;
      const d = dx * dx + dz * dz;
      if (d < bd) { bd = d; best = p; }
    }
    return best;
  }

  // Can a placeable of `id` go here?
  canPlace(id, x, z) {
    const t = this.terrain;
    const h = t.heightAt(x, z);
    if (h < 0.3) return false;
    const n = t.normalAt(x, z);
    if (n.y < 0.8) return false;
    const it = ITEMS[id];
    const ud = this.lib.template(it.place).userData || {};
    const r = ud.col_r || (ud.col_box ? Math.max(ud.col_box[0], ud.col_box[1]) / 2 * 0.8 : 0.35);
    if (this.colliders.overlaps(x, z, Math.max(0.3, r * 0.9))) return false;
    if (Math.hypot(x - LOC.hearth.x, z - LOC.hearth.z) < 4) return false;
    return true;
  }

  // ---------------------------------------------------------------------
  // Interactables: { x, z, r, label(), act(), enabled?(), priority? }
  addInteractable(i) { this.interactables.add(i); return i; }
  removeInteractable(i) { this.interactables.delete(i); }

  findInteractable(px, pz, facing, reach = 1.6) {
    let best = null, bestScore = Infinity;
    const fx = Math.sin(facing), fz = Math.cos(facing);
    for (const i of this.interactables) {
      if (i.enabled && !i.enabled()) continue;
      const ix = typeof i.x === 'function' ? i.x() : i.x;
      const iz = typeof i.z === 'function' ? i.z() : i.z;
      const dx = ix - px, dz = iz - pz;
      const d = Math.hypot(dx, dz);
      const R = (i.r || 1) + reach;
      if (d > R) continue;
      const dot = d > 0.01 ? (dx * fx + dz * fz) / d : 1;
      const score = d - dot * 0.8 - (i.priority || 0);
      if (score < bestScore) { bestScore = score; best = i; }
    }
    return best;
  }

  pathDistance(x, z) {
    let d = Infinity;
    for (const p of PATHS) {
      for (let i = 0; i < p.length - 1; i++) {
        const [ax, az] = p[i], [bx, bz] = p[i + 1];
        const vx = bx - ax, vz = bz - az, wx = x - ax, wz = z - az;
        const L = vx * vx + vz * vz;
        const t = Math.max(0, Math.min(1, (wx * vx + wz * vz) / L));
        d = Math.min(d, Math.hypot(wx - vx * t, wz - vz * t));
      }
    }
    return d;
  }
}
