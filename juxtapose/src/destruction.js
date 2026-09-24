// Destruction: pre-fractured (Blender Voronoi) chunk swapping, debris
// lifetime management, explosions with radial impulses, and heavy impacts.
import * as THREE from 'three';
import { RAPIER, collectPoints } from './physics.js';
import { G, groups, ALL } from './config.js';
import { rnd } from './vfx.js';

const _m = new THREE.Matrix4();
const _p = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();

export class Destruction {
  constructor(game) {
    this.game = game;
    this.debris = [];
    this.hulls = new Map();
    this.maxDebris = 320;
    this.soundBudget = 0;
  }

  clear() {
    for (const d of this.debris) { this.game.physics.remove(d.body); d.mesh.parent?.remove(d.mesh); }
    this.debris = [];
  }

  hullFor(node) {
    let h = this.hulls.get(node.uuid);
    if (!h) { h = collectPoints(node, 64); this.hulls.set(node.uuid, h); }
    return h;
  }

  // Swap an entity for its fractured version and blow the pieces apart
  fracture(e, point, strength = 1, dir = null) {
    const game = this.game;
    const tpl = game.assets.templates.get(e.fracture_);
    const c = e.center();
    const isWood = /Drawers|DeadTree/.test(e.name);
    game.audio.sfx(isWood ? 'woodBreak' : 'shatter', { position: c, gain: 1 });
    game.vfx.dust(c, 1.4 + e.radius() * 0.4, e.dustColor || '#e8d5b0');
    game.vfx.shake = Math.min(1, game.vfx.shake + 0.15);
    game.lucidity.gain(1);
    game.stats.destroyed++;
    if (!tpl) return;
    e.obj.updateMatrixWorld(true);
    const burning = e.props.has('burning');
    const carry = [...e.props].filter((p) => p === 'burning' || p === 'floating' || p === 'hollow');
    const nodes = tpl.children;
    for (const node of nodes) {
      node.updateMatrix();
      _m.multiplyMatrices(e.obj.matrixWorld, node.matrix);
      _m.decompose(_p, _q, _s);
      const mesh = node.clone(true);
      mesh.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
      mesh.position.copy(_p); mesh.quaternion.copy(_q); mesh.scale.copy(_s);
      game.scene.add(mesh);
      const body = game.physics.dynamic(_p, _q, { linDamp: 0.08, angDamp: 0.35, gravityScale: carry.includes('floating') ? -0.3 : 1 });
      let pts = this.hullFor(node);
      if (_s.x !== 1) pts = pts.map((v) => v * _s.x);
      const desc = RAPIER.ColliderDesc.convexHull(pts) || RAPIER.ColliderDesc.ball(0.2);
      const col = game.physics.collider(desc, body, G.DEBRIS, carry.includes('hollow') ? G.WORLD : (G.WORLD | G.WALL | G.PROP | G.DEBRIS | G.ENEMY | G.CEIL), { friction: 0.8, restitution: 0.08, density: 1.4 });
      game.physics.setOwner(col, null);
      // radial impulse from the break point, plus the direction of the hit
      const away = _p.clone().sub(point);
      const dist = Math.max(0.3, away.length());
      away.normalize();
      const m = body.mass();
      const k = strength * 7.5 / (1 + dist * 0.55);
      const imp = away.multiplyScalar(k * m);
      imp.y += (1.5 + Math.random() * 2) * m * strength;
      if (dir) imp.addScaledVector(dir, 3 * m * strength);
      body.applyImpulse(imp, true);
      body.applyTorqueImpulse({ x: rnd(-1, 1) * m * 0.6, y: rnd(-1, 1) * m * 0.6, z: rnd(-1, 1) * m * 0.6 }, true);
      this.debris.push({ body, mesh, t: 0, life: rnd(9, 16), fade: 0, burning: burning ? rnd(2, 6) : 0, pv: null, hurt: 0 });
    }
    while (this.debris.length > this.maxDebris) this.removeDebris(0);
  }

  removeDebris(i) {
    const d = this.debris[i];
    this.game.physics.remove(d.body);
    d.mesh.parent?.remove(d.mesh);
    this.debris.splice(i, 1);
  }

  update(dt) {
    const game = this.game;
    this.soundBudget = Math.min(6, this.soundBudget + dt * 14);
    for (let i = this.debris.length - 1; i >= 0; i--) {
      const d = this.debris[i];
      d.t += dt;
      const t = d.body.translation(), r = d.body.rotation(), v = d.body.linvel();
      d.mesh.position.set(t.x, t.y, t.z);
      d.mesh.quaternion.set(r.x, r.y, r.z, r.w);
      const speed = Math.hypot(v.x, v.y, v.z);
      if (d.pv) {
        const dv = Math.hypot(v.x - d.pv.x, v.y - d.pv.y, v.z - d.pv.z);
        if (dv > 4 && this.soundBudget >= 1) { this.soundBudget -= 1; game.audio.sfx('debris', { position: d.mesh.position, gain: Math.min(1, dv / 12) }); }
      } else d.pv = {};
      d.pv.x = v.x; d.pv.y = v.y; d.pv.z = v.z;
      // fast chunks hurt enemies they strike
      if (speed > 9 && d.hurt < 2) {
        for (const e of game.entities) {
          if (e.kind !== 'enemy' || e.dead) continue;
          if (e.center(_p).distanceToSquared(d.mesh.position) < 1.1) { e.damage(speed * 2.2, { type: 'debris', point: d.mesh.position.clone() }); d.hurt++; }
        }
      }
      if (d.burning > 0) { d.burning -= dt; game.vfx.emitFor('burning', d.mesh.position, { x: 0.2, y: 0.2, z: 0.2 }, dt, 0.4); }
      if (t.y < -40) { this.removeDebris(i); continue; }
      if (d.t > d.life && (speed < 0.4 || d.t > d.life + 6)) {
        d.fade += dt;
        const s = Math.max(0.001, 1 - d.fade / 1.2);
        d.mesh.scale.setScalar(s);
        if (d.fade > 1.2) this.removeDebris(i);
      }
    }
  }

  // A thrown/falling entity hit something hard
  onImpact(e, speed, dv) {
    const game = this.game;
    const heavy = e.props.has('heavy');
    const c = e.center();
    if (this.soundBudget >= 1) { this.soundBudget -= 1; game.audio.sfx(heavy ? 'heavy' : 'debris', { position: c, gain: Math.min(1.5, dv / 10) }); }
    if (dv > 10) game.vfx.dust(c.clone().setY(c.y - e.extent.y), Math.min(1.5, dv / 14), e.dustColor);
    if (heavy && speed > 7) {
      game.vfx.shake = Math.min(1, game.vfx.shake + speed * 0.02);
      for (const w of game.entities) {
        if (w === e || w.dead) continue;
        const reach = w.radius() + e.radius() + 0.7;
        if (w.center(_p).distanceToSquared(c) > reach * reach) continue;
        if (w.kind === 'wall' && w.fracture_) w.damage(speed * 28, { point: c.clone(), heavy: true, dir: e.body ? new THREE.Vector3(e._pv.x, e._pv.y, e._pv.z).normalize() : null });
        else if (w.kind === 'enemy') w.damage(speed * 5, { type: 'crush', point: c.clone() });
        else if (w.fracture_) w.damage(speed * 10, { point: c.clone(), heavy: true });
      }
    }
  }

  // Explosion: visuals, sound, impulses, damage, destruction, carried properties
  explode(pos, o = {}) {
    const game = this.game;
    const R = (o.radius || 4) * (game.run?.mods.explosion ?? 1);
    const dmg = o.damage ?? 60;
    game.vfx.explosion(pos, R, { implode: o.implode });
    game.audio.sfx('explosion', { position: pos, gain: Math.min(2, R / 3.5) });
    game.lucidity.gain(o.small ? 0.5 : 2);
    game.stats.explosions++;
    const ground = game.physics.ray({ x: pos.x, y: pos.y + 0.5, z: pos.z }, { x: 0, y: -1, z: 0 }, R, G.WORLD);
    if (ground) game.vfx.decal(ground.point, ground.normal, R * 1.3, game.assets.textures.scorch, 0xffffff, o.implode ? 0.5 : 0.9, 40);
    const sign = o.implode ? -1 : 1;
    // rigid bodies (props, debris, enemies)
    const seen = new Set();
    for (const col of game.physics.overlapSphere(pos, R * 1.25)) {
      const b = col.parent();
      if (!b || !b.isDynamic() || seen.has(b.handle)) continue;
      seen.add(b.handle);
      const t = b.translation();
      const d = new THREE.Vector3(t.x - pos.x, t.y - pos.y, t.z - pos.z);
      const dist = Math.max(0.4, d.length());
      d.normalize();
      const fall = Math.max(0, 1 - dist / (R * 1.25));
      const m = b.mass();
      const f = (o.small ? 5 : 11) * fall * m * sign;
      b.applyImpulse({ x: d.x * f, y: d.y * f + Math.abs(f) * 0.45 * sign, z: d.z * f }, true);
      b.applyTorqueImpulse({ x: rnd(-1, 1) * m * fall, y: rnd(-1, 1) * m * fall, z: rnd(-1, 1) * m * fall }, true);
    }
    // entities
    for (const e of [...game.entities]) {
      if (e.dead || (e === o.source && e.kind !== 'boss')) continue;
      const c = e.center();
      const dist = c.distanceTo(pos) - e.radius() * 0.5;
      if (dist > R) continue;
      const fall = Math.max(0.15, 1 - dist / R);
      const dir = c.clone().sub(pos).normalize();
      if (e.kind === 'boss') { e.damage(dmg * fall * 1.2, { type: 'explosion', point: c, dir }); continue; }
      if (e.props.has('bursting') && !e.innate.has('bursting')) e.fuse = Math.min(e.fuse, 0.12 + Math.random() * 0.15);
      if (o.ignite && (e.flammable || e.kind === 'enemy')) e.addProp('burning', { quiet: true });
      if (o.carry && o.carry.length && dist < R * 0.85 && e.kind !== 'boss') {
        for (const p of o.carry) if (!e.props.has(p)) { e.addProp(p, { quiet: true }); game.lucidity.gain(1.5); }
      }
      e.damage(dmg * fall, { type: 'explosion', point: c, dir, heavy: true });
    }
    // the player
    const pl = game.player;
    if (pl && !pl.dead) {
      const pc = pl.pos.clone().setY(pl.pos.y + 0.9);
      const dist = pc.distanceTo(pos);
      if (dist < R * 1.2) {
        const fall = Math.max(0, 1 - dist / (R * 1.2));
        const dir = pc.sub(pos).normalize();
        pl.knock(dir.multiplyScalar(16 * fall * sign).add(new THREE.Vector3(0, 7 * fall, 0)));
        const selfish = o.source === 'player-round' || o.source === 'self';
        pl.hurt(dmg * fall * (selfish ? 0.18 : 0.45), { type: 'explosion', from: pos });
      }
      game.vfx.shake = Math.min(1, game.vfx.shake + Math.max(0, 0.6 - dist * 0.02));
    }
    // enemy projectiles caught in the blast are erased
    game.projectiles.clearNear(pos, R, 'enemy');
    if (o.shards) {
      for (let i = 0; i < 14; i++) {
        const a = (i / 14) * Math.PI * 2;
        const dir = new THREE.Vector3(Math.cos(a), 0.15 + Math.random() * 0.2, Math.sin(a)).normalize();
        game.projectiles.fireRound(pos.clone().add(new THREE.Vector3(0, 0.5, 0)), dir, new Set(['reflecting']), { speed: 60, noSound: true });
      }
    }
  }
}
