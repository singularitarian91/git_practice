// The Unwatched: a giant eye on four impossible legs.  It can only be hurt
// while you are NOT looking at it, it only moves when you look away, and it
// attacks with orbs carrying your last three property combos.
import * as THREE from 'three';
import { Entity } from './entities.js';
import { RAPIER } from './physics.js';
import { G, ALL, PROP_INFO } from './config.js';
import { rnd } from './vfx.js';
import { initPosture, updatePosture, addPosture } from './combat.js';

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _m = new THREE.Matrix4();

export class Unwatched extends Entity {
  constructor(game, pos) {
    const obj = game.assets.clone('Unwatched');
    obj.position.copy(pos);
    game.scene.add(obj);
    super(game, { kind: 'boss', name: 'Unwatched', obj, hp: 1100, group: G.ENEMY, anchored: true });
    this.bodyNode = obj.getObjectByName('UW_Body');
    this.iris = obj.getObjectByName('UW_Iris');
    this.lidTop = obj.getObjectByName('UW_LidTop');
    this.lidBot = obj.getObjectByName('UW_LidBottom');
    this.rest = {};
    for (const n of [this.bodyNode, this.iris, this.lidTop, this.lidBot]) if (n) this.rest[n.name] = { p: n.position.clone(), q: n.quaternion.clone() };
    this.eyeHeight = this.bodyNode ? this.bodyNode.position.y : 6.5;
    this.irisMats = [];
    obj.traverse((m) => {
      if (!m.isMesh) return;
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      for (const mm of mats) if (/Iris/.test(mm.name)) { this.irisMats.push(mm); mm.userData.baseEI = mm.emissiveIntensity || 1.5; }
    });
    // legs + IK setup
    obj.updateMatrixWorld(true);
    this.legs = [];
    for (let i = 0; i < 4; i++) {
      const up = obj.getObjectByName('UW_Leg' + i);
      const lo = obj.getObjectByName('UW_Leg' + i + '_Lower');
      if (!up || !lo) continue;
      const hipW = up.getWorldPosition(new THREE.Vector3());
      const kneeW = lo.getWorldPosition(new THREE.Vector3());
      // foot = lowest vertex of the lower leg
      let footW = kneeW.clone(); let minY = Infinity;
      lo.traverse((m) => {
        if (!m.isMesh) return;
        const p = m.geometry.attributes.position;
        for (let k = 0; k < p.count; k++) {
          _v.fromBufferAttribute(p, k).applyMatrix4(m.matrixWorld);
          if (_v.y < minY) { minY = _v.y; footW = _v.clone(); }
        }
      });
      const upInvBody = new THREE.Matrix4().copy(this.bodyNode.matrixWorld).invert();
      const d1 = kneeW.clone().applyMatrix4(upInvBody).sub(hipW.clone().applyMatrix4(upInvBody));
      const upInv = new THREE.Matrix4().copy(up.matrixWorld).invert();
      const d2 = footW.clone().applyMatrix4(upInv).sub(kneeW.clone().applyMatrix4(upInv));
      const outward = hipW.clone().sub(obj.position).setY(0).normalize();
      this.legs.push({
        up, lo, restUpQ: up.quaternion.clone(), restLoQ: lo.quaternion.clone(),
        d1: d1.clone().normalize(), d2: d2.clone().normalize(), L1: d1.length(), L2: d2.length(),
        outward, reach: footW.clone().sub(obj.position).setY(0).length(),
        foot: footW.clone(), from: footW.clone(), to: footW.clone(), stepT: 1, phase: i % 2,
      });
    }
    // kinematic collider on the eyeball
    const body = game.physics.kinematic(pos);
    const col = game.physics.collider(RAPIER.ColliderDesc.ball(1.55).setTranslation(0, this.eyeHeight, 0), body, G.ENEMY, ALL);
    this.attachBody(body, [col]);
    this.localCenter.set(0, this.eyeHeight, 0);
    this.extent.set(1.5, 1.5, 1.5);
    this._r = 1.6;
    this.dustColor = '#f3e9e0';
    this.watched = false; this.watchT = 0; this.stare = 0; this.occT = 0; this.occluded = false;
    this.yaw = 0;
    this.volleyT = 3; this.stompT = 4; this.gazeCharge = 0;
    this.lift = 0;
    this.blink = 0; this.blinkT = rnd(2, 5);
    this.phaseIdx = 0;
    this.propT = new Map();
    this.shockwaves = [];
    this.intro = 2.5;
    this.dying = 0;
    this.hurtFlash = 0;
    initPosture(this, 380);
  }

  onStagger() {
    this.game.ui.toast('It kneels. Deathblow! (F)', 'good');
    this.game.audio.sfx('bossRoar', { position: this.center(), gain: 0.7, pitch: 5 });
  }

  center(out = new THREE.Vector3()) { return out.set(this.obj.position.x, this.obj.position.y + this.eyeHeight + this.lift, this.obj.position.z); }
  radius() { return 1.6; }

  addProp(p, o) {
    super.addProp(p, o);
    if (this.props.has(p)) this.propT.set(p, p === 'sleeping' ? 5 : 8);
  }
  onPropsChanged() { /* the boss handles its own physics */ }
  onTaken(p) { this.propT.delete(p); }
  unanchor() { /* it walks on its own legs */ }
  onMelted() { this.melt = 0.55; this.removeProp('melting'); this.damage(90, { type: 'melt', force: true }); }

  get vulnerable() { return !this.watched || this.props.has('sleeping') || this.staggered > 0; }

  damage(amount, opts = {}) {
    if (this.dead || this.dying) return;
    if (this.props.has('hollow')) return;
    if (!this.vulnerable && !opts.force) {
      if (!opts.silent && this.game.time - (this._clink || 0) > 0.12) {
        this._clink = this.game.time;
        this.game.audio.sfx('reflect', { position: this.center(), gain: 0.5, pitch: 7 });
        this.game.ui.bossBlocked();
      }
      return;
    }
    this.hp -= amount;
    this.hurtFlash = 1;
    if (!opts.silent) { this.game.audio.sfx('bossHit', { position: this.center(), gain: Math.min(1.4, amount / 20) }); this.game.ui.hitmarker(true); }
    const frac = this.hp / this.maxHp;
    if ((frac < 0.66 && this.phaseIdx === 0) || (frac < 0.33 && this.phaseIdx === 1)) {
      this.phaseIdx++;
      this.game.audio.sfx('bossRoar', { position: this.center() });
      this.game.ui.toast(this.phaseIdx === 1 ? 'Its anxieties take shape.' : 'It will not blink again.', 'warn');
      for (let i = 0; i < 2 + this.phaseIdx; i++) {
        const a = Math.random() * Math.PI * 2;
        this.game.spawnEnemy(new THREE.Vector3(this.obj.position.x + Math.cos(a) * 9, 18, this.obj.position.z + Math.sin(a) * 9), { falling: true, gravity: 0.15, variant: 'golconda' });
      }
    }
    if (this.hp <= 0) { this.hp = 0; this.dying = 0.001; this.game.onBossDefeated(this); }
  }

  hitByRound(round, hit) {
    this.damage(14 * (round.props.has('heavy') ? 1.5 : 1), { type: 'round', point: hit.point });
    if (!this.vulnerable) this.game.vfx.impact(hit.point, hit.normal, '#b38cff', 0.8);
    else this.game.vfx.impact(hit.point, hit.normal, '#ff4d6d', 1.1);
    for (const p of round.props) if (p !== 'reflecting' && p !== 'multiplying' && p !== 'hollow' && Math.random() < 0.25 && !this.props.has(p)) this.addProp(p, { quiet: true });
  }

  checkWatched(dt) {
    const cam = this.game.render.camera;
    const c = this.center(_v);
    const ndc = c.clone().project(cam);
    const local = cam.worldToLocal(c.clone());
    const inView = local.z < 0 && Math.abs(ndc.x) < 1.02 && Math.abs(ndc.y) < 1.02;
    this.occT -= dt;
    if (this.occT <= 0 && inView) {
      this.occT = 0.12;
      const from = cam.position;
      const d = c.clone().sub(from);
      const L = d.length() - 1.6;
      const hit = this.game.physics.ray(from, d.normalize(), L, G.WALL | G.WORLD | G.PROP);
      this.occluded = !!hit && !(hit.entity && hit.entity.props.has('hollow'));
    }
    const w = inView && !this.occluded && this.blink < 0.6;
    this.watched = w && !this.props.has('sleeping');
  }

  update(dt) {
    if (this.dead) return;
    const game = this.game;
    const pl = game.player;
    super.update(dt);
    if (this.dead) return;
    for (const [p, t] of this.propT) {
      const nt = t - dt;
      if (nt <= 0) { this.propT.delete(p); this.removeProp(p); } else this.propT.set(p, nt);
    }
    this.checkWatched(dt);
    updatePosture(this, dt);
    this.hurtFlash = Math.max(0, this.hurtFlash - dt * 4);
    const pos = this.obj.position;
    if (this.dying) { this.updateDeath(dt); return; }
    if (this.intro > 0) this.intro -= dt;

    // lift from floating / weight from heavy
    const floating = this.props.has('floating') && !this.props.has('heavy');
    const staggered = this.staggered > 0;
    const liftTarget = staggered ? -(this.eyeHeight - 2.4) : floating ? 7 : 0;
    this.lift += (liftTarget - this.lift) * Math.min(1, dt * (floating ? 0.5 : staggered ? 5 : 2));
    const asleep = this.props.has('sleeping');
    const canAct = !this.watched && !asleep && !floating && !staggered && this.intro <= 0;
    const toP = pl ? pl.pos.clone().sub(pos).setY(0) : new THREE.Vector3();
    const dist = toP.length();

    // it only moves when you look away
    if (canAct && pl) {
      const speed = (this.props.has('heavy') ? 2.5 : 5.5) * (1 + this.phaseIdx * 0.25) * (this.props.has('melting') ? 0.6 : 1);
      const want = dist > 10 ? toP.clone().normalize() : dist < 7 ? toP.clone().normalize().negate() : new THREE.Vector3(-toP.z, 0, toP.x).normalize();
      pos.addScaledVector(want, speed * dt);
      const lim = 30;
      const r = Math.hypot(pos.x, pos.z);
      if (r > lim) { pos.x *= lim / r; pos.z *= lim / r; }
      const ty = Math.atan2(toP.x, toP.z);
      let dy = ty - this.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      this.yaw += dy * Math.min(1, dt * 3);
      this.volleyT -= dt;
      this.stompT -= dt;
      if (this.volleyT <= 0) { this.volleyT = rnd(2.6, 3.6) / (1 + this.phaseIdx * 0.3); this.volley(); }
      if (this.stompT <= 0 && dist < 11) { this.stompT = rnd(4, 6); this.stomp(); }
      this.stare = Math.max(0, this.stare - dt * 2);
    } else if (this.watched && !asleep && this.intro <= 0 && pl) {
      // staring into it too long is dangerous
      this.stare += dt;
      const ty = Math.atan2(toP.x, toP.z);
      let dy = ty - this.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      this.yaw += dy * Math.min(1, dt * 1.5);
      if (this.stare > 3.2) {
        this.gazeCharge += dt;
        if (this.gazeCharge > 0.9) { this.gazeCharge = 0; this.stare = 1.2; this.gaze(); }
      }
    }
    this.body.setNextKinematicTranslation({ x: pos.x, y: pos.y + this.lift, z: pos.z });
    this.obj.rotation.set(0, this.yaw, 0);

    // eye: pupil tracks the camera, lids blink, iris glows when watched
    if (this.bodyNode) {
      const r = this.rest.UW_Body;
      this.bodyNode.position.set(r.p.x, r.p.y + this.lift + Math.sin(game.time * 1.3) * 0.15, r.p.z);
      const cam = game.render.camera.position;
      const eyeW = this.center();
      const look = cam.clone().sub(eyeW).normalize();
      const inv = new THREE.Quaternion().copy(this.obj.quaternion).invert();
      look.applyQuaternion(inv);
      const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), look);
      this.bodyNode.quaternion.copy(r.q).premultiply(new THREE.Quaternion().slerp(q, 0.8));
    }
    this.blinkT -= dt;
    if (this.blinkT <= 0) { this.blinkT = this.phaseIdx >= 2 ? 99 : rnd(3, 7); this.blink = 1.001; }
    if (this.blink > 0) this.blink = Math.max(0, this.blink - dt * 4);
    const close = asleep ? 1 : staggered ? 0.6 : this.blink > 0 ? Math.sin(this.blink * Math.PI) : 0;
    if (this.lidTop) this.lidTop.quaternion.copy(this.rest.UW_LidTop.q).multiply(_q.setFromAxisAngle(new THREE.Vector3(1, 0, 0), close * 0.42));
    if (this.lidBot) this.lidBot.quaternion.copy(this.rest.UW_LidBottom.q).multiply(_q.setFromAxisAngle(new THREE.Vector3(1, 0, 0), -close * 0.42));
    if (this.iris) {
      const dil = this.watched ? 0.8 + Math.sin(game.time * 8) * 0.04 : 1.15;
      this.iris.scale.setScalar(dil);
    }
    for (const m of this.irisMats) m.emissiveIntensity = m.userData.baseEI * (this.watched ? 3.2 + this.stare : 0.7) + this.hurtFlash * 6;

    this.updateLegs(dt, canAct);
    this.updateShockwaves(dt);
  }

  volley() {
    const game = this.game;
    const props = game.recentCombos.slice(-3);
    const colors = props.length ? props.map((p) => PROP_INFO[p].color) : ['#b38cff'];
    const origin = this.center();
    const pl = game.player;
    const n = 5 + this.phaseIdx * 2;
    for (let i = 0; i < n; i++) {
      const tgt = pl.pos.clone().setY(pl.pos.y + 1).add(new THREE.Vector3(rnd(-3, 3), rnd(0, 2), rnd(-3, 3)));
      const v = tgt.sub(origin).normalize().multiplyScalar(13 + Math.random() * 4);
      v.y += 2;
      setTimeout(() => {
        if (this.dead || this.dying) return;
        game.projectiles.enemyOrb(this.center(), v, { damage: 9, homing: 0.35, shooter: this, color: colors[i % colors.length], props, size: 1.3 });
      }, i * 110);
    }
    game.audio.sfx('enemyShoot', { position: origin, pitch: -7, gain: 1.2 });
    game.ui.echo(props);
  }

  addPosture(n) { addPosture(this.game, this, n); }

  stomp() {
    const game = this.game;
    const pos = this.obj.position.clone();
    game.audio.sfx('groundPound', { position: pos, gain: 1.4 });
    game.vfx.dust(pos, 2.5);
    game.vfx.shake = Math.min(1, game.vfx.shake + 0.4);
    this.shockwaves.push({ c: pos, r: 1, speed: 13, max: 18 * (this.props.has('heavy') ? 1.5 : 1), hit: false });
    game.vfx.ring(pos.clone().setY(pos.y + 0.2), 1, 18, 1.4, 0xb38cff, 1);
  }

  gaze() {
    const game = this.game;
    const pl = game.player;
    const from = this.center();
    const to = pl.pos.clone().setY(pl.pos.y + 1);
    const d = to.clone().sub(from);
    const hit = game.physics.ray(from, d.clone().normalize(), d.length(), G.WALL | G.WORLD | G.PROP);
    for (let i = 0; i < 30; i++) game.vfx.trail(from.clone().lerp(hit ? hit.point : to, i / 30), '#b38cff', 0.5, 0.4);
    if (!hit) {
      pl.hurt(16, { type: 'gaze', from });
      game.lucidity.gain(8, 'it saw you');
    }
    game.audio.sfx('bossRoar', { position: from, gain: 0.6 });
  }

  updateShockwaves(dt) {
    const pl = this.game.player;
    for (let i = this.shockwaves.length - 1; i >= 0; i--) {
      const s = this.shockwaves[i];
      s.r += s.speed * dt;
      if (!s.hit && pl && !pl.dead) {
        const d = pl.pos.clone().sub(s.c).setY(0).length();
        if (Math.abs(d - s.r) < 0.9 && pl.pos.y - s.c.y < 0.8) {
          s.hit = true;
          pl.hurt(15, { type: 'shockwave', from: s.c });
          pl.knock(pl.pos.clone().sub(s.c).setY(0).normalize().multiplyScalar(12).setY(8));
        }
      }
      if (s.r > s.max) this.shockwaves.splice(i, 1);
    }
  }

  // procedural stepping with analytic two-bone IK
  updateLegs(dt, moving) {
    if (!this.legs.length) return;
    const game = this.game;
    const pos = this.obj.position;
    this.obj.updateMatrixWorld(true);
    let stepping = this.legs.some((l) => l.stepT < 1);
    for (const l of this.legs) {
      const out = l.outward.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), this.yaw);
      const ideal = pos.clone().addScaledVector(out, l.reach);
      const g = game.physics.ray({ x: ideal.x, y: ideal.y + 8, z: ideal.z }, { x: 0, y: -1, z: 0 }, 20, G.WORLD);
      ideal.y = g ? g.point.y : 0;
      if (l.stepT >= 1 && !stepping && l.foot.distanceTo(ideal) > 2.2 && this.lift < 1) {
        l.from.copy(l.foot); l.to.copy(ideal); l.stepT = 0; stepping = true;
      }
      if (l.stepT < 1) {
        l.stepT = Math.min(1, l.stepT + dt * 3.2);
        const k = l.stepT * l.stepT * (3 - 2 * l.stepT);
        l.foot.lerpVectors(l.from, l.to, k);
        l.foot.y += Math.sin(l.stepT * Math.PI) * 1.6;
        if (l.stepT >= 1) { game.audio.sfx('heavy', { position: l.foot, gain: 0.4, pitch: -12 }); game.vfx.dust(l.foot, 0.5); }
      }
      let target = l.foot;
      if (this.lift > 0.5) target = l.foot.clone().setY(l.foot.y + this.lift * 0.8 + Math.sin(game.time * 2 + l.phase * 3) * 0.6);
      this.solveLeg(l, target);
    }
  }

  solveLeg(l, target) {
    const body = this.bodyNode;
    body.updateMatrixWorld(true);
    const invBody = _m.copy(body.matrixWorld).invert();
    l.up.quaternion.copy(l.restUpQ);
    l.up.updateMatrixWorld(true);
    const H = l.up.getWorldPosition(new THREE.Vector3()).applyMatrix4(invBody);
    const T = target.clone().applyMatrix4(invBody);
    const a = l.L1, b = l.L2;
    const HT = T.clone().sub(H);
    let d = HT.length();
    d = Math.min(a + b - 0.01, Math.max(Math.abs(a - b) + 0.01, d));
    const n = HT.normalize();
    // bend the knee outward and upward
    const hipDir = H.clone().setY(0).normalize();
    const pole = hipDir.add(new THREE.Vector3(0, 1.4, 0)).normalize();
    pole.sub(n.clone().multiplyScalar(pole.dot(n))).normalize();
    const x = (a * a - b * b + d * d) / (2 * d);
    const h = Math.sqrt(Math.max(0, a * a - x * x));
    const K = H.clone().addScaledVector(n, x).addScaledVector(pole, h);
    // upper: rotate rest direction onto hip->knee (in body space)
    const dirU = K.clone().sub(H).normalize();
    const qU = new THREE.Quaternion().setFromUnitVectors(l.d1, dirU);
    l.up.quaternion.copy(qU).multiply(l.restUpQ);
    l.up.updateMatrixWorld(true);
    // lower: rotate its rest direction onto knee->target in the upper's frame
    const invUp = new THREE.Matrix4().copy(l.up.matrixWorld).invert();
    const Kw = K.clone().applyMatrix4(body.matrixWorld);
    const Kl = Kw.clone().applyMatrix4(invUp);
    const Tl = target.clone().applyMatrix4(invUp);
    const dirL = Tl.sub(Kl).normalize();
    l.lo.quaternion.copy(l.restLoQ);
    l.lo.quaternion.copy(new THREE.Quaternion().setFromUnitVectors(l.d2, dirL)).multiply(l.restLoQ);
  }

  updateDeath(dt) {
    const game = this.game;
    this.dying += dt;
    const k = Math.min(1, this.dying / 3);
    if (this.lidTop) this.lidTop.quaternion.copy(this.rest.UW_LidTop.q).multiply(_q.setFromAxisAngle(new THREE.Vector3(1, 0, 0), k * 0.42));
    if (this.lidBot) this.lidBot.quaternion.copy(this.rest.UW_LidBottom.q).multiply(_q.setFromAxisAngle(new THREE.Vector3(1, 0, 0), -k * 0.42));
    this.lift = -k * (this.eyeHeight - 1.8);
    if (this.bodyNode) this.bodyNode.position.y = this.rest.UW_Body.p.y + this.lift;
    for (const l of this.legs) this.solveLeg(l, l.foot.clone().add(l.outward.clone().multiplyScalar(k * 2)));
    if (Math.random() < dt * 8) game.vfx.explosion(this.center().add(new THREE.Vector3(rnd(-1.5, 1.5), rnd(-1, 1.5), rnd(-1.5, 1.5))), 1.5, { color: '#b38cff' });
    if (this.dying > 3.2 && !this.dead) {
      game.explode(this.center(), { radius: 7, damage: 0, source: this });
      this.die({ type: 'boss' });
    }
  }
}
