// Sleepwalkers: the dream's anxieties. Dynamic capsule bodies (so every
// property's physics applies to them), procedural sleepwalking animation,
// drawer-fired orbs, porcelain shatter on death.
import * as THREE from 'three';
import { Entity } from './entities.js';
import { RAPIER } from './physics.js';
import { G, ALL, TUNE } from './config.js';
import { rnd } from './vfx.js';
import { initPosture, updatePosture, canDeathblow } from './combat.js';

const _v = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const PARTS = ['SW_Hips', 'SW_Torso', 'SW_Head', 'SW_ArmL', 'SW_ArmR', 'SW_ForearmL', 'SW_ForearmR', 'SW_LegL', 'SW_LegR', 'SW_ShinL', 'SW_ShinR', 'SW_Drawer', 'SW_Core'];

export class Sleepwalker extends Entity {
  constructor(game, pos, opts = {}) {
    const obj = game.assets.clone('Sleepwalker');
    obj.position.copy(pos);
    game.scene.add(obj);
    super(game, { kind: 'enemy', name: 'Sleepwalker', obj, hp: opts.hp ?? 60, group: G.ENEMY, density: 1, linDamp: 0.3, flammable: true });
    this.variant = opts.variant || 'desert';
    this.dustColor = '#f1ece2';
    this.meltColor = '#efe7da';
    this.p = {};
    for (const n of PARTS) {
      const o = obj.getObjectByName(n);
      if (o) this.p[n] = { o, pos: o.position.clone(), quat: o.quaternion.clone() };
    }
    if (this.variant === 'golconda') {
      obj.traverse((m) => {
        if (!m.isMesh) return;
        const mats = Array.isArray(m.material) ? m.material : [m.material];
        for (const mm of mats) if (/Mannequin/.test(mm.name)) { mm.color.set('#2a2c33'); mm.roughness = 0.75; }
      });
      const head = this.p.SW_Head?.o;
      if (head) {
        const hat = game.assets.clone('BowlerHat');
        head.updateMatrixWorld(true);
        const bb = new THREE.Box3().setFromObject(head);
        const top = head.worldToLocal(new THREE.Vector3((bb.min.x + bb.max.x) / 2, bb.max.y - 0.04, (bb.min.z + bb.max.z) / 2));
        hat.position.copy(top);
        head.add(hat);
      }
    }
    this.coreMats = [];
    obj.traverse((m) => {
      if (!m.isMesh) return;
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      for (const mm of mats) if (/EnemyCore/.test(mm.name)) { this.coreMats.push(mm); mm.userData.baseEI = mm.emissiveIntensity || 3; }
    });
    const body = game.physics.dynamic(pos, null, { linDamp: 0.3, angDamp: 1, gravityScale: opts.gravity ?? 1, ccd: true });
    body.lockRotations(true, true);
    const col = game.physics.collider(RAPIER.ColliderDesc.capsule(0.55, 0.34).setTranslation(0, 0.95, 0), body, G.ENEMY, ALL, { friction: 0.0, restitution: 0.0, density: 1 });
    this.attachBody(body, [col]);
    this.localCenter.set(0, 0.95, 0);
    this.extent.set(0.35, 0.95, 0.35);
    this._r = 0.45;
    this.baseGravity = opts.gravity ?? 1;
    this.falling = opts.falling || false;
    this.yaw = Math.random() * Math.PI * 2;
    this.phase = Math.random() * 10;
    this.cool = rnd(1.5, 3.5);
    this.windup = 0;
    this.flinch = 0; this.flash = 0;
    this.strafeDir = Math.random() < 0.5 ? -1 : 1; this.strafeT = rnd(2, 4);
    this.wander = pos.clone();
    // a guard idles around the memory it keeps until someone comes for it
    this.guard = opts.guard || null;
    this.dormant = !!this.guard;
    this.losT = 0; this.canSee = false;
    this.meleeT = 0;
    this.speedMul = opts.speed || 1;
    this.fireRate = opts.fireRate || 1;
    this.t = 0;
    this.maxVy = 0;
    initPosture(this, this.variant === 'golconda' ? 80 : 70);
    this.lungeCool = rnd(2.5, 5);
    this.lunge = null;
    this.recoilT = 0;
  }

  // a deflected lunge throws it back on its heels
  recoil() {
    this.recoilT = 0.6;
    if (this.lunge) this.lunge.phase = 'recover', this.lunge.t = 0;
    const pl = this.game.player;
    if (pl && this.body) {
      const d = this.obj.position.clone().sub(pl.pos).setY(0).normalize();
      const m = this.body.mass();
      this.body.applyImpulse({ x: d.x * 6 * m, y: 1.5 * m, z: d.z * 6 * m }, true);
    }
  }
  onStagger() { this.lunge = null; this.windup = 0; }

  radius() { return 0.45; }

  damage(amount, opts = {}) {
    if (this.dead) return;
    if (this.props.has('hollow')) return;
    if (this.props.has('sleeping')) {
      amount *= 2;
      if (amount > 28 && opts.type !== 'fire' && opts.type !== 'melt') this.removeProp('sleeping');
    }
    this.flinch = Math.min(1, this.flinch + amount / 30);
    if (!opts.silent && opts.type !== 'melee' && opts.type !== 'deathblow') this.postureT = Math.min(this.postureT, 0.5);
    this.flash = 1;
    if (!opts.silent) {
      this.game.audio.sfx('enemyHit', { position: this.center(), gain: 0.7 });
      this.game.ui.hitmarker(amount >= 30);
    }
    this.lastDir = opts.dir || null;
    if (this.dormant && this.guard) this.guard.wake();
    super.damage(amount, opts);
  }

  die(opts = {}) {
    if (this.dead) return;
    const game = this.game;
    this.obj.updateMatrixWorld(true);
    if (opts.type !== 'melt' && opts.type !== 'forgotten' && opts.type !== 'void') this.shatter(opts);
    else if (opts.type === 'forgotten') game.vfx.propertyBurst(this.center(), 'hollow', 1.2);
    game.audio.sfx('enemyDie', { position: this.center() });
    if (Math.random() < 0.28) game.spawnPickup(this.center().setY(this.obj.position.y));
    super.die(opts);
    game.stats.kills++;
  }

  // porcelain shatter: every limb becomes a physics body
  shatter(opts) {
    const game = this.game;
    const dir = (this.lastDir || new THREE.Vector3(0, 0, 0)).clone();
    for (const n of ['SW_Torso', 'SW_Head', 'SW_ArmL', 'SW_ArmR', 'SW_ForearmL', 'SW_ForearmR', 'SW_LegL', 'SW_LegR', 'SW_ShinL', 'SW_ShinR', 'SW_Hips']) {
      const part = this.p[n]?.o;
      if (!part) continue;
      const meshes = [];
      part.traverse((m) => { if (m.isMesh && (m === part || m.parent === part)) meshes.push(m); });
      if (!meshes.length) continue;
      const holder = new THREE.Group();
      part.updateMatrixWorld(true);
      part.matrixWorld.decompose(holder.position, holder.quaternion, holder.scale);
      const box = new THREE.Box3();
      for (const m of meshes) {
        const c = m.clone(false);
        const rel = new THREE.Matrix4().copy(part.matrixWorld).invert().multiply(m.matrixWorld);
        rel.decompose(c.position, c.quaternion, c.scale);
        c.castShadow = true;
        holder.add(c);
        m.geometry.computeBoundingBox();
        box.union(m.geometry.boundingBox.clone().applyMatrix4(rel));
      }
      game.scene.add(holder);
      const size = box.getSize(new THREE.Vector3()).multiplyScalar(0.5).max(new THREE.Vector3(0.04, 0.04, 0.04));
      const ctr = box.getCenter(new THREE.Vector3());
      const body = game.physics.dynamic(holder.position, holder.quaternion, { linDamp: 0.1, angDamp: 0.3 });
      game.physics.collider(RAPIER.ColliderDesc.cuboid(size.x, size.y, size.z).setTranslation(ctr.x, ctr.y, ctr.z), body, G.DEBRIS, G.WORLD | G.WALL | G.PROP | G.DEBRIS, { density: 0.8, friction: 0.7 });
      const m = body.mass();
      const f = this.deathblown ? 3 : 1;
      body.applyImpulse({ x: (dir.x * 4 * f + rnd(-2, 2)) * m, y: rnd(2, 5) * f * m, z: (dir.z * 4 * f + rnd(-2, 2)) * m }, true);
      body.applyTorqueImpulse({ x: rnd(-1, 1) * m * 0.3, y: rnd(-1, 1) * m * 0.3, z: rnd(-1, 1) * m * 0.3 }, true);
      game.destruction.debris.push({ body, mesh: holder, t: 0, life: rnd(4, 7), fade: 0, burning: this.props.has('burning') ? 3 : 0, pv: null, hurt: 9 });
    }
    game.vfx.dust(this.center(), 0.8, '#f5efe6');
  }

  pose(n, x = 0, y = 0, z = 0, px = 0, py = 0, pz = 0) {
    const r = this.p[n];
    if (!r) return;
    r.o.quaternion.copy(r.quat).multiply(_q.setFromEuler(_e.set(x, y, z)));
    r.o.position.set(r.pos.x + px, r.pos.y + py, r.pos.z + pz);
  }

  update(dt) {
    if (this.dead) return;
    super.update(dt);
    if (this.dead) return;
    this.t += dt;
    const game = this.game;
    const b = this.body;
    const P = this.props;
    const t = b.translation();
    const v = b.linvel();
    const pos = this.obj.position;
    const pl = game.player;
    const asleep = P.has('sleeping');
    const floating = P.has('floating');
    const hollow = P.has('hollow');
    // landing from a long fall hurts
    if (v.y < this.maxVy) this.maxVy = v.y;
    if (v.y > -1 && this.maxVy < -16) { this.damage((-this.maxVy - 14) * 4, { type: 'fall' }); game.vfx.dust(pos, 0.8); }
    if (v.y > -1) this.maxVy = 0;
    if (this.falling && (v.y > -0.5 && this.t > 0.5)) { this.falling = false; b.setGravityScale(this.gravity, true); this.baseGravity = 1; }
    if (hollow) { this.hollowT -= dt; if (this.hollowT <= 0) { this.die({ type: 'forgotten' }); return; } }

    // ---- brain
    let want = new THREE.Vector3();
    let speed = 3.4 * this.speedMul * (P.has('heavy') ? 0.4 : 1) * (P.has('melting') ? 0.55 : 1);
    const toP = pl ? pl.pos.clone().sub(pos) : new THREE.Vector3();
    toP.y = 0;
    const dist = toP.length();
    this.losT -= dt;
    if (this.losT <= 0 && pl) {
      this.losT = 0.3;
      const eye = { x: t.x, y: t.y + 1.6, z: t.z };
      const tgt = pl.pos.clone().setY(pl.pos.y + 1.2);
      const d = tgt.clone().sub(eye);
      const L = d.length();
      const hit = game.physics.ray(eye, d.normalize(), L, G.WORLD | G.WALL);
      this.canSee = !hit && L < 48 && !pl.dead && !pl.self.has('sleeping') && !pl.self.has('hollow');
      if (pl.decoys && pl.decoys.length) this.decoy = pl.decoys[Math.floor(Math.random() * pl.decoys.length)];
      else this.decoy = null;
    }
    if (this.dormant) {
      this.canSee = false;
      if (pl && !pl.dead && dist < 9) this.guard.wake();
    }
    const target = this.decoy && !this.decoy.dead ? this.decoy.pos : (pl ? pl.pos : pos);
    const toT = target.clone().sub(pos); toT.y = 0;
    const dT = toT.length();
    updatePosture(this, dt);
    this.recoilT = Math.max(0, this.recoilT - dt);
    const staggered = this.staggered > 0;
    const controllable = !asleep && !floating && !this.falling && !hollow && !staggered && this.recoilT <= 0;
    if (controllable) {
      if (this.canSee) {
        toT.normalize();
        this.strafeT -= dt;
        if (this.strafeT <= 0) { this.strafeT = rnd(1.5, 3.5); this.strafeDir *= -1; }
        const side = new THREE.Vector3(-toT.z, 0, toT.x).multiplyScalar(this.strafeDir);
        if (dT > 13) want.copy(toT).addScaledVector(side, 0.3);
        else if (dT < 5) want.copy(toT).negate().addScaledVector(side, 0.5);
        else want.copy(side).addScaledVector(toT, 0.15);
      } else {
        const home = this.dormant ? this.guard.pos : null, span = home ? 4 : 10;
        if (pos.distanceTo(this.wander) < 2 || Math.random() < dt * 0.1) { const c = home || pos; this.wander.set(c.x + rnd(-span, span), 0, c.z + rnd(-span, span)); }
        want.copy(this.wander).sub(pos).setY(0);
        speed *= home ? 0.25 : 0.45;
      }
      if (want.lengthSq() > 0) want.normalize();
      // steer around walls
      if (want.lengthSq() > 0) {
        // three whiskers: straight on, and 40 degrees either side. Slopes (sand, ramps) are not walls.
        const blocked = (dir, len) => {
          const h = game.physics.ray({ x: t.x, y: t.y + 0.9, z: t.z }, { x: dir.x, y: 0, z: dir.z }, len, G.WALL | G.WORLD | G.PROP);
          return h && Math.abs(h.normal.y) < 0.6 ? h : null;
        };
        if (blocked(want, 2.2)) {
          const up = new THREE.Vector3(0, 1, 0);
          const l = want.clone().applyAxisAngle(up, 0.7), r = want.clone().applyAxisAngle(up, -0.7);
          const bl = blocked(l, 2.6), br = blocked(r, 2.6);
          if (!bl && br) this.strafeDir = 1; else if (bl && !br) this.strafeDir = -1;
          want.applyAxisAngle(up, this.strafeDir * (bl && br ? 1.6 : 0.9));
        }
      }
      const tx = want.x * speed, tz = want.z * speed;
      const k = Math.min(1, dt * 6);
      b.setLinvel({ x: v.x + (tx - v.x) * k, y: v.y, z: v.z + (tz - v.z) * k }, true);
    } else if (hollow) {
      b.setLinvel({ x: Math.sin(this.t * 0.7) * 1.2, y: v.y, z: Math.cos(this.t * 0.5) * 1.2 }, true);
    }
    // facing
    const face = this.canSee && controllable ? toT : new THREE.Vector3(v.x, 0, v.z);
    if (face.lengthSq() > 0.05) {
      const yaw = Math.atan2(face.x, face.z);
      let dy = yaw - this.yaw;
      dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      this.yaw += dy * Math.min(1, dt * 6);
    }
    this.obj.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), this.yaw);

    // ---- lunge (melee): a white glint can be deflected, a red 危 must be dodged
    this.lungeCool -= dt;
    if (controllable && this.canSee && pl && !pl.dead && !this.lunge && this.windup <= 0 && this.lungeCool <= 0 && dT < 5.5 && this.decoy == null) {
      const perilous = Math.random() < (this.variant === 'golconda' ? 0.35 : 0.25);
      this.lunge = { phase: 'wind', t: 0, perilous, hit: false, dir: toT.clone().normalize() };
      if (perilous) game.audio.sfx('perilous', { position: pos });
      else game.vfx.add.spawn({ x: pos.x, y: pos.y + 1.4, z: pos.z, color: new THREE.Color('#ffffff').multiplyScalar(8), alpha: 1, alpha1: 0, size: 0.7, size1: 0.1, life: 0.3, rot: 0.78 });
    }
    if (this.lunge) {
      const L = this.lunge;
      L.t += dt;
      if (staggered || asleep || floating || hollow) this.lunge = null;
      else if (L.phase === 'wind') {
        b.setLinvel({ x: v.x * 0.8, y: v.y, z: v.z * 0.8 }, true);
        if (pl) L.dir.copy(pl.pos.clone().sub(pos).setY(0).normalize());
        if (L.t > (L.perilous ? 0.75 : 0.55)) { L.phase = 'strike'; L.t = 0; }
      } else if (L.phase === 'strike') {
        b.setLinvel({ x: L.dir.x * 12, y: v.y, z: L.dir.z * 12 }, true);
        if (pl && !L.hit && pl.pos.distanceTo(pos) < 1.5) {
          L.hit = true;
          const res = pl.incoming('melee', L.perilous ? 24 : 15, pos.clone(), { perilous: L.perilous, shooter: this, type: 'lunge' });
          if (res !== 'deflect') { L.phase = 'recover'; L.t = 0; }
        }
        if (L.t > 0.3) { L.phase = 'recover'; L.t = 0; }
      } else if (L.phase === 'recover') {
        b.setLinvel({ x: v.x * 0.85, y: v.y, z: v.z * 0.85 }, true);
        if (L.t > 0.5) { this.lunge = null; this.lungeCool = rnd(3.5, 6.5); }
      }
    }

    // ---- attacks
    if (controllable && !this.lunge && this.canSee && pl && !pl.dead) {
      this.cool -= dt * this.fireRate * (P.has('burning') ? 0.6 : 1);
      if (this.cool <= 0 && this.windup <= 0 && dT < 32) { this.windup = 0.65; game.audio.sfx('enemyShoot', { position: pos, gain: 0.35, pitch: -12 }); }

    }
    if (this.windup > 0) {
      this.windup -= dt;
      if (this.windup <= 0) {
        this.cool = rnd(2.8, 4.4);
        const origin = this.drawerWorld();
        const aim = target.clone().setY(target.y + 1.0);
        if (pl && this.decoy == null) aim.addScaledVector(pl.vel.clone().setY(0), dT / 16 * 0.6);
        const vel = aim.sub(origin).normalize().multiplyScalar(13);
        game.projectiles.enemyOrb(origin, vel, { damage: 8, homing: 0.35, shooter: this, color: '#7ff7ff' });
        game.audio.sfx('enemyShoot', { position: origin });
      }
    }

    // ---- procedural animation
    const hs = Math.hypot(v.x, v.z);
    this.phase += dt * (1.2 + hs * 1.7);
    const s = Math.sin(this.phase), c = Math.cos(this.phase);
    const amp = Math.min(1, hs / 3);
    this.flinch = Math.max(0, this.flinch - dt * 4);
    this.flash = Math.max(0, this.flash - dt * 6);
    const open = this.windup > 0 ? 1 - this.windup / 0.65 : 0;
    const drowse = asleep ? 1 : 0;
    const flail = floating || this.falling ? 1 : 0;
    const breathe = Math.sin(this.t * 1.7) * 0.03;
    this.pose('SW_LegL', -s * 0.55 * amp + flail * Math.sin(this.t * 3) * 0.4, 0, 0.04);
    this.pose('SW_LegR', s * 0.55 * amp - flail * Math.sin(this.t * 3.3) * 0.4, 0, -0.04);
    this.pose('SW_ShinL', Math.max(0, c) * 0.9 * amp + 0.1 + flail * 0.5);
    this.pose('SW_ShinR', Math.max(0, -c) * 0.9 * amp + 0.1 + flail * 0.5);
    this.pose('SW_Hips', 0, s * 0.08 * amp, 0, 0, Math.abs(s) * 0.04 * amp - drowse * 0.05, 0);
    this.pose('SW_Torso', 0.1 + breathe - this.flinch * 0.5 + drowse * 0.35, -s * 0.06 * amp, Math.sin(this.t * 0.9) * 0.05);
    const armUp = -1.35 * (1 - drowse) + flail * -1.4 + breathe;
    this.pose('SW_ArmL', armUp + Math.sin(this.t * 1.3) * 0.06, 0, 0.12 + flail * 0.9);
    this.pose('SW_ArmR', armUp + Math.sin(this.t * 1.3 + 1) * 0.06 - open * 0.3, 0, -0.12 - flail * 0.9);
    this.pose('SW_ForearmL', -0.15 - drowse * 0.2);
    this.pose('SW_ForearmR', -0.15 - drowse * 0.2);
    this.pose('SW_Head', 0.15 + drowse * 0.5 - this.flinch * 0.4, Math.sin(this.t * 0.7) * 0.2, 0.25 * Math.sin(this.t * 0.5) + drowse * 0.3);
    this.pose('SW_Drawer', 0, 0, 0, 0, 0, open * 0.22);
    // lunge wind-up / strike overrides
    if (this.lunge) {
      const L = this.lunge;
      const w = L.phase === 'wind' ? Math.min(1, L.t / 0.3) : L.phase === 'strike' ? 1 : Math.max(0, 1 - L.t / 0.3);
      const st = L.phase === 'strike' ? 1 : 0;
      this.pose('SW_Torso', -0.35 * w * (1 - st) + 0.45 * st, 0, 0);
      this.pose('SW_ArmL', -2.6 * w * (1 - st) - 1.2 * st, 0, 0.3);
      this.pose('SW_ArmR', -2.6 * w * (1 - st) - 1.2 * st, 0, -0.3);
      this.pose('SW_Head', -0.3 * w + 0.3 * st, 0, 0);
    }
    // staggered: slumped, one knee down, the red deathblow mark overhead
    if (staggered) {
      this.pose('SW_Hips', 0.3, 0, 0.1, 0, -0.35, 0);
      this.pose('SW_LegL', -1.3, 0, 0.1); this.pose('SW_ShinL', 1.5);
      this.pose('SW_LegR', 0.2, 0, -0.1); this.pose('SW_ShinR', 1.9);
      this.pose('SW_Torso', 0.6, 0.2, 0.2);
      this.pose('SW_ArmL', 0.1, 0, 0.2); this.pose('SW_ArmR', -0.2, 0, -0.1);
      this.pose('SW_Head', 0.8, 0, 0.3);
    } else if (this.recoilT > 0) {
      this.pose('SW_Torso', -0.5 * this.recoilT / 0.6, 0, 0);
    }
    const glory = canDeathblow(this);
    const glow = 1 + this.flash * 5 + open * 4 + (P.has('burning') ? 1 : 0) + (glory ? 3 + Math.sin(this.t * 14) * 2 : 0);
    for (const m of this.coreMats) m.emissiveIntensity = m.userData.baseEI * glow * (asleep ? 0.2 : 1);
  }

  drawerWorld() {
    const d = this.p.SW_Drawer?.o || this.p.SW_Torso?.o;
    const w = new THREE.Vector3();
    if (d) d.getWorldPosition(w); else w.copy(this.obj.position).setY(this.obj.position.y + 1.3);
    w.addScaledVector(new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw)), 0.35);
    return w;
  }
}
