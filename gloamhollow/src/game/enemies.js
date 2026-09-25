// The Gloam: gloamlings and wraiths rise in the dark, draugr haunt the
// Mistwood ruins, and Ashhorn the Mist-Stag waits at the altar.
// Firelight is sanctuary — they will not step into a lit fire's radius.
import * as THREE from 'three';
import { findPart, approachAngle, angleDiff } from './util.js';
import { ZONES, LOC } from './worldmap.js';
import { lerp } from '../engine/noise.js';

const TYPES = {
  gloamling: { model: 'enemy_gloamling', hp: 30, speed: 3.5, dmg: 8, range: 1.55, windup: 0.5, recover: 0.8, radius: 0.35, night: true, sfx: 'gloamling_growl',
    drops: [['gloam_essence', 0.7, 1, 1], ['resin', 0.3, 1, 1], ['bone', 0.3, 1, 1]] },
  wraith: { model: 'enemy_wraith', hp: 60, speed: 4.4, dmg: 14, range: 1.9, windup: 0.6, recover: 0.9, radius: 0.4, night: true, float: true, sfx: 'wraith_scream',
    drops: [['gloam_essence', 1, 1, 2], ['ember', 0.15, 1, 1]] },
  draugr: { model: 'enemy_draugr', hp: 90, speed: 3.0, dmg: 18, range: 2.1, windup: 0.75, recover: 1.0, radius: 0.4, night: false, sfx: 'draugr_groan',
    drops: [['bone', 1, 1, 3], ['iron_ore', 0.35, 1, 2], ['copper_ore', 0.4, 1, 2]] },
  boss: { model: 'boss_stag', hp: 900, speed: 3.6, dmg: 26, range: 3.4, windup: 0.9, recover: 1.1, radius: 1.3, night: false, sfx: 'stag_roar', boss: true, drops: [] },
};

const DRAUGR_SPOTS = [[52, -45], [61, -55], [67, -49], [79, -67], [58, -64]];

export class Enemies {
  constructor(game) {
    this.game = game;
    this.list = [];
    this.spawnT = 4;
    this.draugrT = 0;
    this.bossActive = false;
    this.boss = null;
    this.lastCombat = -99;
    this.group = new THREE.Group();
    game.engine.scene.add(this.group);
  }

  inCombat() { return this.game.time - this.lastCombat < 6 || this.bossActive; }

  clearAll() {
    for (const e of this.list) e.obj.removeFromParent();
    this.list = [];
    this.bossActive = false;
    this.boss = null;
  }

  spawn(type, x, z, opts = {}) {
    const T = TYPES[type];
    const obj = this.game.lib.clone(T.model);
    obj.traverse((o) => { if (o.isMesh) { o.castShadow = true; } });
    this.group.add(obj);
    const P = (k) => findPart(obj, k);
    const parts = { body: P('body'), head: P('head'), armL: P('arm_l'), armR: P('arm_r'), legL: P('leg_l'), legR: P('leg_r'),
      legFL: P('leg_fl'), legFR: P('leg_fr'), legBL: P('leg_bl'), legBR: P('leg_br'), tail: P('tail') };
    const rest = {};
    for (const [k, o] of Object.entries(parts)) if (o) rest[k] = { p: o.position.clone(), r: o.rotation.clone() };
    const e = {
      type, T, obj, parts, rest,
      pos: new THREE.Vector3(x, this.game.world.groundY(x, z), z),
      vel: new THREE.Vector3(), facing: Math.random() * 6.28,
      hp: T.hp * (opts.hpMul || 1), maxHp: T.hp * (opts.hpMul || 1),
      state: 'rise', t: 0, phase: Math.random() * 10, pop: 0, hitT: 0,
      home: opts.home || null, burning: false, alive: true, lastSeen: 0,
    };
    obj.position.copy(e.pos);
    this.list.push(e);
    if (!T.boss) {
      this.game.effects.burst('gloam', e.pos.clone().add(new THREE.Vector3(0, 0.3, 0)));
      this.game.audio.sfx('gloam_spawn', { x, z, volume: 0.7 });
    }
    return e;
  }

  // Sword/axe arc: damage every enemy in front.  Returns true if anything was hit.
  hitArc(pos, facing, range, halfAngle, dmg, knock = 5) {
    let hit = false;
    for (const e of this.list) {
      if (!e.alive || e.state === 'dying' || e.state === 'rise') continue;
      const dx = e.pos.x - pos.x, dz = e.pos.z - pos.z;
      const d = Math.hypot(dx, dz) - e.T.radius;
      if (d > range) continue;
      const a = Math.abs(angleDiff(facing, Math.atan2(dx, dz)));
      if (a > halfAngle && d > 0.6) continue;
      this.damage(e, dmg, pos.x, pos.z, knock);
      hit = true;
    }
    if (this.boss && this.boss.alive && !hit) {
      const b = this.boss;
      const dx = b.pos.x - pos.x, dz = b.pos.z - pos.z;
      if (Math.hypot(dx, dz) - b.T.radius < range && Math.abs(angleDiff(facing, Math.atan2(dx, dz))) < halfAngle + 0.3) { this.damage(b, dmg, pos.x, pos.z, 0.5); hit = true; }
    }
    return hit;
  }

  damage(e, dmg, fx, fz, knock) {
    const g = this.game;
    e.hp -= dmg;
    e.pop = 1;
    e.hitT = 0.25;
    this.lastCombat = g.time;
    const dx = e.pos.x - fx, dz = e.pos.z - fz;
    const d = Math.hypot(dx, dz) || 1;
    e.vel.x += (dx / d) * knock; e.vel.z += (dz / d) * knock;
    g.effects.burst('hit', e.pos.clone().add(new THREE.Vector3(0, 1, 0)));
    g.effects.burst('gloam', e.pos.clone().add(new THREE.Vector3(0, 0.9, 0)), { n: 5 });
    g.audio.sfx('hit_enemy', { x: e.pos.x, z: e.pos.z });
    g.camera.shake(e.T.boss ? 0.12 : 0.08);
    g.ui.damageNumber && g.ui.damageNumber(e.pos.clone().add(new THREE.Vector3(0, e.T.boss ? 3.2 : 2, 0)), Math.round(dmg));
    if (e.state !== 'windup' || e.T.boss) { if (!e.T.boss) { e.state = 'stagger'; e.t = 0; } }
    if (e.hp <= 0) this.kill(e);
  }

  kill(e) {
    const g = this.game;
    e.alive = false;
    e.state = 'dying';
    e.t = 0;
    g.state.stats.kills++;
    g.audio.sfx('enemy_die', { x: e.pos.x, z: e.pos.z });
    g.effects.burst('gloam', e.pos.clone().add(new THREE.Vector3(0, 1, 0)), { n: 30 });
    for (const [id, chance, a, b] of e.T.drops) {
      if (Math.random() < chance) g.drops.spawn(id, a + Math.floor(Math.random() * (b - a + 1)), e.pos.clone().add(new THREE.Vector3(0, 0.6, 0)));
    }
    if (e.T.boss) this.onBossDeath(e);
  }

  // ------------------------------------------------------------------
  findSpawnPoint(minD, maxD) {
    const g = this.game;
    const p = g.player.pos;
    for (let k = 0; k < 16; k++) {
      const a = Math.random() * Math.PI * 2, d = minD + Math.random() * (maxD - minD);
      const x = p.x + Math.cos(a) * d, z = p.z + Math.sin(a) * d;
      const h = g.engine.terrain.heightAt(x, z);
      if (h < 0.6) continue;
      if (g.engine.lighting.safeAt(x, z)) continue;
      if (Math.hypot(x - LOC.hearth.x, z - LOC.hearth.z) < g.engine.env.clearRadius + 10) continue;
      if (g.colliders.overlaps(x, z, 0.5)) continue;
      return { x, z };
    }
    return null;
  }

  update(dt) {
    const g = this.game;
    const dark = g.darkness;
    const p = g.player.pos;
    const w = g.state.weather;
    // --- spawning at night ---
    if (!g.cinematic && !g.player.dead) {
      this.spawnT -= dt;
      const nightOk = dark > 0.65;
      const inSafe = g.engine.lighting.safeAt(p.x, p.z);
      const limit = Math.min(8, 2 + Math.floor(g.state.totalDays / 4) + (w === 'fog' || w === 'storm' ? 2 : 0));
      const nightCount = this.list.filter((e) => e.T.night && e.alive).length;
      if (nightOk && this.spawnT <= 0 && nightCount < limit && !inSafe) {
        this.spawnT = 5 + Math.random() * 6;
        const pt = this.findSpawnPoint(18, 30);
        if (pt) {
          const mist = Math.hypot(pt.x - ZONES.mistwood.x, pt.z - ZONES.mistwood.z) < ZONES.mistwood.r;
          const wraithOdds = (mist ? 0.5 : 0.12) + (w === 'fog' ? 0.2 : 0) + Math.min(0.2, g.state.totalDays * 0.01);
          this.spawn(Math.random() < wraithOdds ? 'wraith' : 'gloamling', pt.x, pt.z);
        }
      }
      // draugr in the Mistwood ruins, any time of day
      this.draugrT -= dt;
      const nearRuins = Math.hypot(p.x - 62, p.z - 56 * -1) < 45;
      if (nearRuins && this.draugrT <= 0 && this.list.filter((e) => e.type === 'draugr' && e.alive).length < 3) {
        this.draugrT = 40 + Math.random() * 40;
        const s = DRAUGR_SPOTS[Math.floor(Math.random() * DRAUGR_SPOTS.length)];
        if (Math.hypot(s[0] - p.x, s[1] - p.z) > 14) this.spawn('draugr', s[0], s[1], { home: { x: s[0], z: s[1] } });
      }
    }

    // --- behaviour ---
    for (let i = this.list.length - 1; i >= 0; i--) {
      const e = this.list[i];
      e.t += dt;
      e.phase += dt;
      e.pop = Math.max(0, e.pop - dt * 5);
      e.hitT = Math.max(0, e.hitT - dt);
      if (e.T.boss) { this.updateBoss(e, dt); continue; }
      if (e.state === 'dying') {
        const u = e.t / 0.9;
        e.obj.position.y = e.pos.y - u * 1.2;
        e.obj.rotation.z = u * 0.6;
        if (e.t > 0.9) { e.obj.removeFromParent(); this.list.splice(i, 1); }
        continue;
      }
      // dawn burns the night-born away
      if (e.T.night && dark < 0.35 && !e.burning) { e.burning = true; e.state = 'dying'; e.t = 0; e.alive = false; g.effects.burst('ember', e.pos.clone().add(new THREE.Vector3(0, 1, 0)), { n: 20 }); continue; }
      const dx = p.x - e.pos.x, dz = p.z - e.pos.z;
      const dist = Math.hypot(dx, dz);
      if (dist > 60 && e.T.night) { e.obj.removeFromParent(); this.list.splice(i, 1); continue; }
      const toPlayer = Math.atan2(dx, dz);
      let want = null;
      let speed = 0;
      switch (e.state) {
        case 'rise':
          if (e.t > 1.0) { e.state = 'chase'; e.t = 0; g.audio.sfx(e.T.sfx, { x: e.pos.x, z: e.pos.z, volume: 0.6 }); }
          break;
        case 'chase': {
          const aggro = e.type === 'draugr' ? 16 : 34;
          if (dist > aggro || g.player.dead) {
            // idle / return home
            if (e.home) { const hx = e.home.x - e.pos.x, hz = e.home.z - e.pos.z; if (Math.hypot(hx, hz) > 2) { want = Math.atan2(hx, hz); speed = e.T.speed * 0.5; } }
            break;
          }
          this.lastCombat = g.time;
          if (dist < e.T.range && !g.player.dead) { e.state = 'windup'; e.t = 0; break; }
          want = toPlayer;
          speed = e.T.speed * (dist > 12 ? 1.2 : 1);
          break;
        }
        case 'windup':
          e.facing = approachAngle(e.facing, toPlayer, dt * 5);
          if (e.t >= e.T.windup) {
            // strike!
            const a = Math.abs(angleDiff(e.facing, toPlayer));
            if (dist < e.T.range * 1.25 + 0.3 && a < 1.3) {
              if (g.player.damage(e.T.dmg, e.pos.x, e.pos.z)) g.effects.burst('hit', g.player.pos.clone().add(new THREE.Vector3(0, 1, 0)));
            }
            g.audio.sfx('swing', { x: e.pos.x, z: e.pos.z, pitch: 0.7 });
            e.vel.x += Math.sin(e.facing) * 4; e.vel.z += Math.cos(e.facing) * 4;
            e.state = 'recover'; e.t = 0;
          }
          break;
        case 'recover':
          if (e.t > e.T.recover) { e.state = 'chase'; e.t = 0; }
          break;
        case 'stagger':
          if (e.t > 0.35) { e.state = 'chase'; e.t = 0; }
          break;
      }
      // light keeps them out: stop at the edge of any safe radius
      if (want != null) {
        const nx = e.pos.x + Math.sin(want) * speed * dt, nz = e.pos.z + Math.cos(want) * speed * dt;
        if (g.engine.lighting.safeAt(nx, nz)) {
          speed = 0;
          if (Math.random() < dt * 0.4) g.audio.sfx(e.T.sfx, { x: e.pos.x, z: e.pos.z, volume: 0.4, pitch: 1.3 });
        }
        e.facing = approachAngle(e.facing, want, dt * 7);
      }
      // pushed out if a fire was lit on top of them
      if (g.engine.lighting.safeAt(e.pos.x, e.pos.z)) {
        let best = null, bd = Infinity;
        for (const s of g.engine.lighting.sources) {
          if (!s.enabled || !s.safe) continue;
          const d = Math.hypot(s.pos.x - e.pos.x, s.pos.z - e.pos.z);
          if (d < s.safe && d < bd) { bd = d; best = s; }
        }
        if (best) { const a = Math.atan2(e.pos.x - best.pos.x, e.pos.z - best.pos.z); e.vel.x += Math.sin(a) * 20 * dt; e.vel.z += Math.cos(a) * 20 * dt; e.hp -= 6 * dt; if (e.hp <= 0) this.kill(e); }
      }
      e.vel.multiplyScalar(Math.exp(-dt * 6));
      const next = new THREE.Vector3(e.pos.x + (Math.sin(e.facing) * speed + e.vel.x) * dt, 0, e.pos.z + (Math.cos(e.facing) * speed + e.vel.z) * dt);
      g.colliders.resolve(next, e.T.radius);
      if (g.engine.terrain.heightAt(next.x, next.z) > -0.3) { e.pos.x = next.x; e.pos.z = next.z; }
      // don't stack on each other or the player
      for (const o of this.list) {
        if (o === e || !o.alive) continue;
        const ox = e.pos.x - o.pos.x, oz = e.pos.z - o.pos.z;
        const od = Math.hypot(ox, oz), R = e.T.radius + o.T.radius;
        if (od < R && od > 0.001) { e.pos.x += (ox / od) * (R - od) * 0.5; e.pos.z += (oz / od) * (R - od) * 0.5; }
      }
      const pr = e.T.radius + 0.35;
      const pd = Math.hypot(e.pos.x - p.x, e.pos.z - p.z);
      if (pd < pr && pd > 0.001) { e.pos.x = p.x + ((e.pos.x - p.x) / pd) * pr; e.pos.z = p.z + ((e.pos.z - p.z) / pd) * pr; }
      const gy = g.world.groundY(e.pos.x, e.pos.z);
      e.pos.y += (gy - e.pos.y) * Math.min(1, dt * 12);
      this.animate(e, speed);
    }
  }

  animate(e, speed) {
    const P = e.parts, R = e.rest;
    const set = (k, rx, ry, rz, py) => {
      const o = P[k];
      if (!o) return;
      o.rotation.set(R[k].r.x + (rx || 0), R[k].r.y + (ry || 0), R[k].r.z + (rz || 0));
      if (py != null) o.position.y = R[k].p.y + py;
    };
    const t = e.phase;
    const w = Math.min(1, speed / 3);
    const s = Math.sin(t * (e.type === 'gloamling' ? 12 : 8));
    let armL = s * 0.5 * w, armR = -s * 0.5 * w, bodyX = 0.15 + 0.1 * w, bob = Math.abs(Math.cos(t * 10)) * 0.05 * w;
    let headX = 0;
    if (e.state === 'windup') { const u = Math.min(1, e.t / e.T.windup); armL = -2.4 * u; armR = -2.4 * u; bodyX = -0.25 * u; headX = -0.2 * u; }
    if (e.state === 'recover') { const u = Math.min(1, e.t / 0.25); armL = lerp(-2.4, 0.3, u); armR = lerp(-2.4, 0.3, u); bodyX = lerp(0.4, 0.15, u); }
    if (e.state === 'stagger') { bodyX = -0.35; headX = -0.2; }
    if (e.T.float) { bob = 0.25 + Math.sin(t * 2.2) * 0.12; armL = armL * 0.6 - 0.5; armR = armR * 0.6 - 0.5; }
    set('legL', s * 0.7 * w, 0, 0);
    set('legR', -s * 0.7 * w, 0, 0);
    set('armL', armL, 0, 0.2);
    set('armR', armR, 0, -0.2);
    set('body', bodyX, 0, 0, bob);
    set('head', headX + Math.sin(t * 1.7) * 0.08, Math.sin(t * 1.1) * 0.2, 0);
    let y = e.pos.y;
    if (e.state === 'rise') y -= (1 - Math.min(1, e.t / 1.0)) * 1.4;
    e.obj.position.set(e.pos.x, y, e.pos.z);
    e.obj.rotation.set(0, e.facing, 0);
    e.obj.scale.setScalar(1 + e.pop * 0.12);
  }

  // ------------------------------------------------------------------
  // Ashhorn, the Mist-Stag
  summonBoss() {
    const g = this.game;
    if (this.bossActive) return;
    const a = LOC.altar;
    const b = this.spawn('boss', a.x - 6, a.z + 8);
    b.state = 'intro';
    b.t = 0;
    b.summonT = 12;
    this.boss = b;
    this.bossActive = true;
    g.audio.sfx('stag_roar');
    g.camera.shake(0.6);
    g.effects.burst('gloam', b.pos.clone().add(new THREE.Vector3(0, 1.5, 0)), { n: 60 });
    g.ui.bossBar && g.ui.bossBar(true, "Ashhorn, the Mist-Stag");
  }

  updateBoss(b, dt) {
    const g = this.game;
    const p = g.player.pos;
    const dx = p.x - b.pos.x, dz = p.z - b.pos.z;
    const dist = Math.hypot(dx, dz);
    const toP = Math.atan2(dx, dz);
    const enraged = b.hp < b.maxHp * 0.4;
    const spd = enraged ? 1.35 : 1;
    let speed = 0;
    this.lastCombat = g.time;
    if (b.state === 'dying') {
      const u = Math.min(1, b.t / 2.5);
      b.obj.position.y = b.pos.y - u * 2.5;
      b.obj.rotation.z = u * 0.5;
      if (b.t > 2.5) { b.obj.removeFromParent(); this.list.splice(this.list.indexOf(b), 1); }
      return;
    }
    switch (b.state) {
      case 'intro':
        if (b.t > 2.2) { b.state = 'stalk'; b.t = 0; }
        break;
      case 'stalk': {
        b.facing = approachAngle(b.facing, toP, dt * 2.5 * spd);
        speed = b.T.speed * spd;
        b.summonT -= dt;
        if (b.summonT <= 0) {
          b.summonT = enraged ? 14 : 20;
          b.state = 'summon'; b.t = 0;
        } else if (dist < b.T.range) { b.state = 'sweep'; b.t = 0; }
        else if (dist > 8 && dist < 26 && Math.random() < dt * 0.5) { b.state = 'charge_wind'; b.t = 0; }
        break;
      }
      case 'charge_wind':
        b.facing = approachAngle(b.facing, toP, dt * 4);
        if (b.t > 0.9 / spd) { b.state = 'charge'; b.t = 0; b.hitDone = false; g.audio.sfx('stag_roar', { pitch: 1.2, volume: 0.7 }); }
        break;
      case 'charge': {
        speed = 17 * spd;
        const a = Math.abs(angleDiff(b.facing, toP));
        if (!b.hitDone && dist < 2.8 && a < 1.2) { b.hitDone = true; g.player.damage(b.T.dmg, b.pos.x, b.pos.z); g.player.vel.x += Math.sin(b.facing) * 10; g.player.vel.z += Math.cos(b.facing) * 10; }
        if (b.t > 1.1) { b.state = 'recover'; b.t = 0; g.camera.shake(0.3); g.effects.burst('dust', b.pos, { n: 16 }); }
        break;
      }
      case 'sweep':
        if (b.t > 0.9 / spd && !b.hitDone) {
          b.hitDone = true;
          if (dist < 4.6) g.player.damage(b.T.dmg * 0.8, b.pos.x, b.pos.z);
          g.effects.burst('gloam', b.pos.clone().add(new THREE.Vector3(0, 1.2, 0)), { n: 30 });
          g.camera.shake(0.25);
        }
        if (b.t > 1.4 / spd) { b.state = 'recover'; b.t = 0; b.hitDone = false; }
        break;
      case 'summon':
        if (b.t > 1.2 && !b.summoned) {
          b.summoned = true;
          g.audio.sfx('stag_roar', { pitch: 0.8 });
          for (let k = 0; k < (enraged ? 3 : 2); k++) {
            const a = Math.random() * 6.28;
            this.spawn('gloamling', b.pos.x + Math.cos(a) * 5, b.pos.z + Math.sin(a) * 5);
          }
        }
        if (b.t > 2) { b.state = 'stalk'; b.t = 0; b.summoned = false; }
        break;
      case 'recover':
        if (b.t > b.T.recover / spd) { b.state = 'stalk'; b.t = 0; b.hitDone = false; }
        break;
    }
    b.vel.multiplyScalar(Math.exp(-dt * 4));
    const next = new THREE.Vector3(b.pos.x + (Math.sin(b.facing) * speed + b.vel.x) * dt, 0, b.pos.z + (Math.cos(b.facing) * speed + b.vel.z) * dt);
    g.colliders.resolve(next, 1.0);
    if (g.engine.terrain.heightAt(next.x, next.z) > 0.2) { b.pos.x = next.x; b.pos.z = next.z; }
    b.pos.y += (g.world.groundY(b.pos.x, b.pos.z) - b.pos.y) * Math.min(1, dt * 8);
    // animate quadruped
    const P = b.parts, R = b.rest;
    const set = (k, rx, ry, rz) => { const o = P[k]; if (o) o.rotation.set(R[k].r.x + rx, R[k].r.y + ry, R[k].r.z + rz); };
    const w = Math.min(1, speed / 4);
    const s = Math.sin(b.phase * (b.state === 'charge' ? 16 : 7));
    set('legFL', s * 0.5 * w, 0, 0); set('legBR', s * 0.5 * w, 0, 0);
    set('legFR', -s * 0.5 * w, 0, 0); set('legBL', -s * 0.5 * w, 0, 0);
    let headX = Math.sin(b.phase * 1.3) * 0.08;
    if (b.state === 'charge_wind' || b.state === 'charge') headX = 0.6;
    if (b.state === 'sweep') headX = b.t < 0.9 ? -0.4 : 0.5;
    if (b.state === 'summon' || b.state === 'intro') headX = -0.6;
    set('head', headX, b.state === 'sweep' ? Math.sin(b.t * 8) * 0.6 : 0, 0);
    set('body', 0, 0, 0);
    if (P.tail) set('tail', 0, Math.sin(b.phase * 4) * 0.3, 0);
    let y = b.pos.y;
    if (b.state === 'intro') y -= (1 - Math.min(1, b.t / 2)) * 3;
    b.obj.position.set(b.pos.x, y, b.pos.z);
    b.obj.rotation.set(0, b.facing, 0);
    b.obj.scale.setScalar(1 + b.pop * 0.05);
    g.ui.bossBar && g.ui.bossBar(true, 'Ashhorn, the Mist-Stag', Math.max(0, b.hp / b.maxHp));
  }

  onBossDeath(b) {
    const g = this.game;
    this.bossActive = false;
    g.state.bossDefeated = true;
    g.ui.bossBar && g.ui.bossBar(false);
    g.drops.spawn('trophy_stag', 1, b.pos.clone().add(new THREE.Vector3(0, 1, 0)), { up: 5 });
    g.drops.spawn('gloam_essence', 8, b.pos.clone().add(new THREE.Vector3(0, 1, 0)));
    g.drops.spawn('ember', 3, b.pos.clone().add(new THREE.Vector3(0, 1, 0)));
    g.audio.sfx('stag_roar', { pitch: 0.6 });
    g.camera.shake(0.8);
    for (const e of this.list) if (e !== b && e.alive) this.kill(e);
    g.toast("Ashhorn falls. Bring its antler to the Great Hearth.", 'quest');
  }
}
