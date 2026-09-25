// Ambient wildlife: crows that scatter when you approach, and deer that
// graze in the meadows and bolt (and can be hunted for meat and leather).
import * as THREE from 'three';
import { findPart, approachAngle, angleDiff } from './util.js';
import { ZONES, FARM, LOC } from './worldmap.js';

export class Critters {
  constructor(game) {
    this.game = game;
    this.crows = [];
    this.deer = [];
    this.crowT = 2;
    this.deerT = 0;
    this.group = new THREE.Group();
    game.engine.scene.add(this.group);
  }

  makeRig(model) {
    const obj = this.game.lib.clone(model);
    obj.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    this.group.add(obj);
    const P = (k) => findPart(obj, k);
    const parts = { body: P('body'), head: P('head'), wingL: P('wing_l'), wingR: P('wing_r'), legFL: P('leg_fl'), legFR: P('leg_fr'), legBL: P('leg_bl'), legBR: P('leg_br'), tail: P('tail') };
    const rest = {};
    for (const [k, o] of Object.entries(parts)) if (o) rest[k] = { r: o.rotation.clone() };
    return { obj, parts, rest };
  }

  spawnCrows() {
    const g = this.game;
    const spots = [
      { x: (FARM.x0 + FARM.x1) / 2, z: (FARM.z0 + FARM.z1) / 2, r: 7 },
      { x: 4, z: 14, r: 6 }, { x: -20, z: -30, r: 8 }, { x: -60, z: -20, r: 10 }, { x: 12, z: -50, r: 8 },
    ];
    const s = spots[Math.floor(Math.random() * spots.length)];
    const p = g.player.pos;
    if (Math.hypot(s.x - p.x, s.z - p.z) < 18 || Math.hypot(s.x - p.x, s.z - p.z) > 70) return;
    const n = 3 + Math.floor(Math.random() * 3);
    for (let i = 0; i < n; i++) {
      const rig = this.makeRig('critter_crow');
      const x = s.x + (Math.random() - 0.5) * s.r, z = s.z + (Math.random() - 0.5) * s.r;
      const c = { ...rig, pos: new THREE.Vector3(x, g.world.groundY(x, z), z), facing: Math.random() * 6.28, state: 'ground', t: Math.random() * 5, vel: new THREE.Vector3() };
      c.obj.scale.setScalar(1.3);
      this.crows.push(c);
    }
  }

  spawnDeer() {
    const g = this.game;
    const zones = [ZONES.meadow, ZONES.heath];
    const z = zones[Math.floor(Math.random() * zones.length)];
    const p = g.player.pos;
    for (let k = 0; k < 8; k++) {
      const a = Math.random() * 6.28, r = Math.random() * z.r * 0.7;
      const x = z.x + Math.cos(a) * r, zz = z.z + Math.sin(a) * r;
      if (g.engine.terrain.heightAt(x, zz) < 1 || g.colliders.overlaps(x, zz, 0.8)) continue;
      if (Math.hypot(x - p.x, zz - p.z) < 30) continue;
      const rig = this.makeRig('critter_deer');
      this.deer.push({ ...rig, pos: new THREE.Vector3(x, g.world.groundY(x, zz), zz), facing: Math.random() * 6.28, state: 'graze', t: 0, hp: 30, speed: 0, goal: null, zone: z, phase: Math.random() * 9 });
      return;
    }
  }

  hitArc(pos, facing, range, halfAngle, dmg) {
    const g = this.game;
    let hit = false;
    for (const d of this.deer) {
      if (d.state === 'dead') continue;
      const dx = d.pos.x - pos.x, dz = d.pos.z - pos.z;
      const dist = Math.hypot(dx, dz);
      if (dist > range + 0.6) continue;
      if (Math.abs(angleDiff(facing, Math.atan2(dx, dz))) > halfAngle) continue;
      d.hp -= dmg;
      hit = true;
      g.effects.burst('hit', d.pos.clone().add(new THREE.Vector3(0, 1, 0)));
      g.audio.sfx('hit_enemy', { x: d.pos.x, z: d.pos.z, pitch: 1.2 });
      if (d.hp <= 0) {
        d.state = 'dead'; d.t = 0;
        g.drops.spawn('raw_meat', 1 + Math.floor(Math.random() * 2), d.pos.clone().add(new THREE.Vector3(0, 0.5, 0)));
        g.drops.spawn('leather', 1 + Math.floor(Math.random() * 2), d.pos.clone().add(new THREE.Vector3(0, 0.5, 0)));
      } else { d.state = 'flee'; d.t = 0; d.facing = Math.atan2(dx, dz); }
    }
    for (const c of this.crows) {
      if (c.state === 'fly') continue;
      if (Math.hypot(c.pos.x - pos.x, c.pos.z - pos.z) < range) { c.state = 'fly'; c.t = 0; if (Math.random() < 0.3) g.drops.spawn('feather', 1, c.pos.clone()); hit = true; }
    }
    return hit;
  }

  update(dt) {
    const g = this.game;
    const p = g.player.pos;
    const day = g.darkness < 0.5;
    // crows by day
    this.crowT -= dt;
    if (this.crowT <= 0) {
      this.crowT = 14 + Math.random() * 12;
      if (day && this.crows.length < 10) this.spawnCrows();
    }
    this.deerT -= dt;
    if (this.deerT <= 0) {
      this.deerT = 20;
      if (this.deer.filter((d) => d.state !== 'dead').length < 4) this.spawnDeer();
    }
    for (let i = this.crows.length - 1; i >= 0; i--) {
      const c = this.crows[i];
      c.t += dt;
      const dist = Math.hypot(c.pos.x - p.x, c.pos.z - p.z);
      if (c.state === 'ground') {
        if (dist < 6.5 || !day) {
          c.state = 'fly'; c.t = 0;
          c.facing = Math.atan2(c.pos.x - p.x, c.pos.z - p.z) + (Math.random() - 0.5);
          if (Math.random() < 0.5) g.audio.sfx('crow_caw', { x: c.pos.x, z: c.pos.z, volume: 0.6 });
        }
        // hop & peck
        if (Math.random() < dt * 0.6) { c.facing += (Math.random() - 0.5) * 2; c.hop = 0.25; }
        if (c.hop > 0) {
          c.hop -= dt;
          c.pos.x += Math.sin(c.facing) * dt * 1.5; c.pos.z += Math.cos(c.facing) * dt * 1.5;
        }
        c.pos.y = g.world.groundY(c.pos.x, c.pos.z) + (c.hop > 0 ? Math.sin(c.hop / 0.25 * Math.PI) * 0.08 : 0);
      } else {
        const sp = 7 + c.t * 2;
        c.pos.x += Math.sin(c.facing) * sp * dt; c.pos.z += Math.cos(c.facing) * sp * dt;
        c.pos.y += (2.5 + c.t) * dt;
        if (c.t > 7) { c.obj.removeFromParent(); this.crows.splice(i, 1); continue; }
      }
      const P = c.parts, R = c.rest;
      const flap = c.state === 'fly' ? Math.sin(c.t * 26) * 0.9 : 0;
      if (P.wingL) P.wingL.rotation.set(R.wingL.r.x, R.wingL.r.y, R.wingL.r.z + flap);
      if (P.wingR) P.wingR.rotation.set(R.wingR.r.x, R.wingR.r.y, R.wingR.r.z - flap);
      if (P.head && c.state === 'ground') P.head.rotation.set(R.head.r.x + Math.max(0, Math.sin(c.t * 3)) * 0.6, R.head.r.y, R.head.r.z);
      c.obj.position.copy(c.pos);
      c.obj.rotation.set(c.state === 'fly' ? -0.3 : 0, c.facing, 0);
    }
    for (let i = this.deer.length - 1; i >= 0; i--) {
      const d = this.deer[i];
      d.t += dt;
      d.phase += dt;
      const dist = Math.hypot(d.pos.x - p.x, d.pos.z - p.z);
      let speed = 0;
      if (d.state === 'dead') {
        d.obj.rotation.z = Math.min(1.4, d.t * 3);
        if (d.t > 6) { d.obj.removeFromParent(); this.deer.splice(i, 1); }
        d.obj.position.copy(d.pos);
        continue;
      }
      if (d.state === 'graze') {
        if (dist < (g.player.sprinting ? 16 : 10)) { d.state = 'flee'; d.t = 0; g.audio.sfx('deer_flee', { x: d.pos.x, z: d.pos.z }); }
        else {
          if (!d.goal || Math.random() < dt * 0.1) {
            const a = Math.random() * 6.28, r = Math.random() * d.zone.r * 0.6;
            d.goal = { x: d.zone.x + Math.cos(a) * r, z: d.zone.z + Math.sin(a) * r, wait: 3 + Math.random() * 6 };
          }
          const gx = d.goal.x - d.pos.x, gz = d.goal.z - d.pos.z;
          if (Math.hypot(gx, gz) > 1) { speed = 1.1; d.facing = approachAngle(d.facing, Math.atan2(gx, gz), dt * 2); }
        }
      } else if (d.state === 'flee') {
        speed = 7.5;
        d.facing = approachAngle(d.facing, Math.atan2(d.pos.x - p.x, d.pos.z - p.z), dt * 3);
        if (d.t > 5 && dist > 30) { d.state = 'graze'; d.goal = null; }
        if (dist > 90) { d.obj.removeFromParent(); this.deer.splice(i, 1); continue; }
      }
      const nx = d.pos.x + Math.sin(d.facing) * speed * dt, nz = d.pos.z + Math.cos(d.facing) * speed * dt;
      const next = new THREE.Vector3(nx, 0, nz);
      g.colliders.resolve(next, 0.5);
      if (g.engine.terrain.heightAt(next.x, next.z) > 0.6) { d.pos.x = next.x; d.pos.z = next.z; }
      else d.facing += 1.5;
      d.pos.y += (g.world.groundY(d.pos.x, d.pos.z) - d.pos.y) * Math.min(1, dt * 10);
      const P = d.parts, R = d.rest;
      const w = Math.min(1, speed / 4);
      const s = Math.sin(d.phase * (speed > 3 ? 14 : 6));
      const set = (k, rx) => { if (P[k]) P[k].rotation.set(R[k].r.x + rx, R[k].r.y, R[k].r.z); };
      set('legFL', s * 0.6 * w); set('legBR', s * 0.6 * w); set('legFR', -s * 0.6 * w); set('legBL', -s * 0.6 * w);
      set('head', speed < 0.5 ? 0.9 + Math.sin(d.phase * 2) * 0.1 : -0.1);
      d.obj.position.copy(d.pos);
      d.obj.rotation.set(0, d.facing, 0);
    }
  }
}
