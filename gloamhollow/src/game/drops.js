// Items lying in the world: they pop out, bounce, bob, and fly to the
// player when close enough (if there's room in the backpack).
import * as THREE from 'three';
import { ITEMS } from '../data/items.js';

export class Drops {
  constructor(game) {
    this.game = game;
    this.list = [];
    this.group = new THREE.Group();
    this.group.name = 'drops';
    game.engine.scene.add(this.group);
    this.scaleCache = new Map();
  }

  modelScale(model) {
    if (this.scaleCache.has(model)) return this.scaleCache.get(model);
    const b = this.game.lib.getBounds(model);
    const s = b.getSize(new THREE.Vector3());
    const k = 0.42 / Math.max(0.05, s.x, s.y, s.z);
    // lift so the lowest point rests on the ground (e.g. the watering can hangs below its origin)
    const r = { k, lift: Math.max(0, -b.min.y * k) };
    this.scaleCache.set(model, r);
    return r;
  }

  // Spawn `n` of `id` at pos, split across a few physical pickups.
  spawn(id, n, pos, { spread = 1, up = 3.5, delay = 0 } = {}) {
    const it = ITEMS[id];
    if (!it || n <= 0) return;
    const pieces = Math.min(n, 5);
    let left = n;
    for (let i = 0; i < pieces; i++) {
      const count = i === pieces - 1 ? left : Math.max(1, Math.floor(n / pieces));
      left -= count;
      const obj = this.game.lib.clone(it.model);
      const ms = this.modelScale(it.model);
      obj.scale.setScalar(ms.k);
      obj.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; } });
      if (it.tint) obj.traverse((o) => { if (o.isMesh) { o.material = o.material.clone(); o.material.color = new THREE.Color(it.tint).lerp(new THREE.Color(1, 1, 1), 0.35); } });
      const a = Math.random() * Math.PI * 2;
      const sp = (0.6 + Math.random() * 1.2) * spread;
      const d = {
        id, n: count, obj,
        pos: pos.clone().add(new THREE.Vector3(0, 0.3, 0)),
        vel: new THREE.Vector3(Math.cos(a) * sp, up * (0.7 + Math.random() * 0.5), Math.sin(a) * sp),
        t: 0, delay: delay + i * 0.05, spin: (Math.random() - 0.5) * 6, rest: false, magnet: false, lift: ms.lift,
      };
      obj.position.copy(d.pos);
      obj.visible = d.delay <= 0;
      this.group.add(obj);
      this.list.push(d);
    }
  }

  update(dt) {
    const g = this.game;
    const pp = g.player.pos;
    const world = g.world;
    for (let i = this.list.length - 1; i >= 0; i--) {
      const d = this.list[i];
      if (d.delay > 0) { d.delay -= dt; if (d.delay <= 0) d.obj.visible = true; continue; }
      d.t += dt;
      const dx = pp.x - d.pos.x, dz = pp.z - d.pos.z, dy = (pp.y + 0.7) - d.pos.y;
      const dist = Math.hypot(dx, dz, dy);
      if (d.t > 0.45 && dist < 2.6 && g.inventory.canAdd(d.id, d.n)) d.magnet = true;
      if (d.magnet) {
        const sp = 9 + d.t * 4;
        d.pos.x += (dx / dist) * sp * dt; d.pos.y += (dy / dist) * sp * dt; d.pos.z += (dz / dist) * sp * dt;
        if (dist < 0.45) {
          const left = g.inventory.add(d.id, d.n);
          const got = d.n - left;
          if (got > 0) g.onPickup(d.id, got);
          if (left > 0) { d.n = left; d.magnet = false; continue; }
          d.obj.removeFromParent();
          this.list.splice(i, 1);
          continue;
        }
      } else if (!d.rest) {
        d.vel.y -= 18 * dt;
        d.pos.addScaledVector(d.vel, dt);
        const gy = Math.max(world.groundY(d.pos.x, d.pos.z), -0.2) + 0.05 + d.lift;
        if (d.pos.y < gy) {
          d.pos.y = gy;
          if (Math.abs(d.vel.y) < 1.2) { d.rest = true; d.restY = gy; }
          d.vel.y = -d.vel.y * 0.35; d.vel.x *= 0.55; d.vel.z *= 0.55;
        }
      } else {
        d.pos.y = d.restY + 0.12 + Math.sin(d.t * 3 + i) * 0.05;
      }
      d.obj.position.copy(d.pos);
      d.obj.rotation.y += d.spin * dt + dt * 0.8;
      d.spin *= Math.exp(-dt * 2);
      // despawn very old drops that nobody picked up (keeps the world tidy)
      if (d.t > 600) { d.obj.removeFromParent(); this.list.splice(i, 1); }
    }
  }

  clear() {
    for (const d of this.list) d.obj.removeFromParent();
    this.list.length = 0;
  }
}
