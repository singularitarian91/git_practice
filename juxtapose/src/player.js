// The Figment: parkour character controller (Rapier kinematic character
// controller, run at a fixed 60 Hz), the Ratchet & Clank style chase camera,
// and the two-barrelled Juxtaposition Gun.
import * as THREE from 'three';
import { RAPIER } from './physics.js';
import { G, groups, ALL, TUNE, PROPS, PROP_INFO } from './config.js';
import { FigureAnimator } from './animator.js';
import { giveTo, takeFrom, takeCandidate, lucidityForGive } from './properties.js';
import { rnd } from './vfx.js';

const UP = new THREE.Vector3(0, 1, 0);
const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _q = new THREE.Quaternion();

function approach(cur, target, maxDelta) {
  const d = target - cur;
  return Math.abs(d) <= maxDelta ? target : cur + Math.sign(d) * maxDelta;
}
function angleLerp(a, b, t) {
  let d = b - a;
  d = Math.atan2(Math.sin(d), Math.cos(d));
  return a + d * t;
}

export class Player {
  constructor(game, spawn) {
    this.game = game;
    const ph = game.physics;
    this.r = 0.34; this.halfH = 0.56; this.halfHSlide = 0.18;
    this.pos = spawn.clone();          // feet
    this.prevPos = spawn.clone();
    this.renderPos = spawn.clone();
    this.vel = new THREE.Vector3();
    this.body = ph.kinematic({ x: spawn.x, y: spawn.y + this.halfH + this.r, z: spawn.z });
    this.collider = ph.collider(RAPIER.ColliderDesc.capsule(this.halfH, this.r), this.body, G.PLAYER, ALL & ~G.DEBRIS & ~G.GHOST, { friction: 0 });
    ph.setOwner(this.collider, this);
    const kcc = this.kcc = ph.world.createCharacterController(0.03);
    kcc.setUp({ x: 0, y: 1, z: 0 });
    kcc.enableAutostep(0.5, 0.2, false);
    kcc.enableSnapToGround(0.35);
    kcc.setMaxSlopeClimbAngle(55 * Math.PI / 180);
    kcc.setMinSlopeSlideAngle(62 * Math.PI / 180);
    kcc.setApplyImpulsesToDynamicBodies(true);
    kcc.setCharacterMass(90);

    // visual
    this.visual = new THREE.Group();
    this.figure = game.assets.cloneFigure();
    this.visual.add(this.figure);
    game.scene.add(this.visual);
    this.anim = new FigureAnimator(this.figure, game.assets.figure.animations);
    this.anim.play('Idle', { fade: 0 });
    this.bones = this.anim.bones;
    this.vialMats = []; this.glowMats = []; this.figMats = [];
    this.figure.traverse((m) => {
      if (!m.isMesh) return;
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      for (const mm of mats) {
        if (mm.name === 'GunVial') this.vialMats.push(mm);
        else if (mm.name === 'GunGlow') this.glowMats.push(mm);
        this.figMats.push({ m: mm, color: mm.color.clone(), metal: mm.metalness, rough: mm.roughness, opacity: mm.opacity, transparent: mm.transparent, emissive: mm.emissive.clone(), ei: mm.emissiveIntensity });
      }
    });

    // state
    this.state = 'air';
    this.grounded = false;
    this.groundEntity = null;
    this.groundNormal = new THREE.Vector3(0, 1, 0);
    this.coyote = 0; this.jumpBuf = 0; this.jumpsUsed = 0;
    this.dashT = 0; this.dashCD = 0; this.airDashUsed = false; this.dashDir = new THREE.Vector3();
    this.slideT = 0; this.sprintT = 0;
    this.wall = { n: new THREE.Vector3(), side: 1, t: 0, cool: 0, lastN: new THREE.Vector3() };
    this.move = { from: new THREE.Vector3(), to: new THREE.Vector3(), apex: 0, t: 0, dur: 0.5, kind: '' };
    this.grind = { rail: null, s: 0, dir: 1, speed: 0, cool: 0, tickT: 0 };
    this.poundT = 0;
    this.fallFrom = spawn.y;
    this.safePos = spawn.clone(); this.safeT = 0;
    this.climbUsed = false; this.climbT = 0;
    this.landT = 0;
    this.airTime = 0;

    // camera
    this.camYaw = Math.PI; this.camPitch = -0.12;
    this.camPivot = spawn.clone().add(new THREE.Vector3(0, 2.0, 0));
    this.camDist = 4.3;
    this.shoulder = 1;
    this.roll = 0; this.fovKick = 0;
    this.yaw = 0;
    this.aimHold = 0;
    this.faded = new Map();
    this.aimPoint = new THREE.Vector3(); this.aimEntity = null; this.aimNormal = new THREE.Vector3(0, 1, 0);

    // combat
    this.hp = TUNE.playerHP; this.maxHp = TUNE.playerHP;
    this.dead = false;
    this.hurtT = 0; this.iframes = 0; this.regenT = 0;
    this.ammo = TUNE.magazine; this.fireCD = 0; this.reloadT = 0;
    this.charges = new Map();
    this.selected = 0;
    this.self = new Map();      // property -> seconds remaining
    this.roundProps = new Map(); // property -> rounds remaining
    this.decoys = [];
    this.pendingIn = { jump: false, dash: false, crouch: false };
    this.stepPhase = 0;
    this.controlLock = 0;
    this.hurtFlash = 0;
    this.drowsy = 0;
    this.disarmed = 0;
    this.lastFootIdx = -1;
    this.updateVial();
  }

  // ------------------------------------------------------------------ helpers
  get available() { return this.game.meta.unlockedProps(); }
  get selectedProp() { const a = this.available; return a[((this.selected % a.length) + a.length) % a.length]; }
  chargesOf(p) { return this.game.sandbox ? Infinity : (this.charges.get(p) || 0); }
  spend(p) { if (!this.game.sandbox) this.charges.set(p, Math.max(0, (this.charges.get(p) || 0) - 1)); }
  addCharges(p, n) { this.charges.set(p, Math.min(TUNE.maxCharges, (this.charges.get(p) || 0) + n)); }
  camForward(out = new THREE.Vector3()) {
    return out.set(Math.sin(this.camYaw) * Math.cos(this.camPitch), Math.sin(this.camPitch), Math.cos(this.camYaw) * Math.cos(this.camPitch));
  }
  flatForward(out = new THREE.Vector3()) { return out.set(Math.sin(this.camYaw), 0, Math.cos(this.camYaw)); }
  flatLeft(out = new THREE.Vector3()) { return out.set(Math.cos(this.camYaw), 0, -Math.sin(this.camYaw)); }
  wish() {
    const m = this.inMove || { x: 0, z: 0 };
    const f = this.flatForward(new THREE.Vector3()), l = this.flatLeft(new THREE.Vector3());
    return f.multiplyScalar(m.z).addScaledVector(l, m.x);
  }
  hspeed() { return Math.hypot(this.vel.x, this.vel.z); }
  gravity() {
    let g = TUNE.gravity;
    if (this.self.has('floating')) g *= 0.36;
    if (this.self.has('heavy')) g *= 1.35;
    return g;
  }
  maxJumps() { return 2 + (this.self.has('floating') ? 1 : 0); }
  moveSpeed() {
    let s = this.sprintT > TUNE.sprintAfter ? TUNE.sprintSpeed : TUNE.runSpeed;
    if (this.self.has('melting')) s *= 1.3;
    if (this.self.has('heavy')) s *= 0.88;
    if (this.self.has('sleeping')) s *= 0.85;
    if (this.drowsy > 0) s *= 0.55;
    return s;
  }
  filterGroups() {
    let mask = ALL & ~G.DEBRIS & ~G.GHOST & ~G.PLAYER;
    if (this.self.has('hollow')) mask &= ~G.WALL;
    return groups(G.PLAYER, mask);
  }
  rayMask() { return this.self.has('hollow') ? (G.WORLD | G.PROP) : (G.WORLD | G.WALL | G.PROP); }

  // ------------------------------------------------------------ per-frame input
  readInput(input, dt) {
    if (this.dead || this.controlLock > 0) { this.inMove = { x: 0, z: 0 }; return; }
    this.inMove = input.moveAxis();
    if (input.hit('jump')) this.jumpBuf = TUNE.jumpBuffer;
    this.jumpHeld = input.is('jump');
    if (input.hit('dash')) this.pendingIn.dash = true;
    if (input.hit('crouch')) this.pendingIn.crouch = true;
    this.crouchHeld = input.is('crouch');
  }

  // --------------------------------------------------------- fixed-step motion
  fixedUpdate(h) {
    if (this.dead) { this.vel.set(0, Math.min(0, this.vel.y - 20 * h), 0); }
    this.prevPos.copy(this.pos);
    this.jumpBuf -= h;
    this.dashCD -= h; this.wall.cool -= h; this.grind.cool -= h;
    const wish = this.wish();
    const wlen = wish.length();
    const g = this.gravity();

    switch (this.state) {
      case 'mantle': case 'vault': return this.scriptedMove(h);
      case 'grind': return this.grindMove(h);
      default: break;
    }

    if (this.dashT > 0) {
      this.dashT -= h;
      this.vel.x = this.dashDir.x * TUNE.dashSpeed; this.vel.z = this.dashDir.z * TUNE.dashSpeed;
      this.vel.y = this.state === 'air' ? Math.max(this.vel.y, 0) * 0.5 : this.vel.y;
      this.dashEffects();
      if (this.dashT <= 0) { this.vel.x *= 0.5; this.vel.z *= 0.5; }
    } else if (this.state === 'ground') {
      const target = wish.clone().multiplyScalar(this.moveSpeed());
      const acc = (wlen > 0.1 ? TUNE.groundAccel : TUNE.groundDecel) * h;
      // pivoting: reversing direction kills speed quickly for snappy turns
      if (wlen > 0.1 && this.vel.x * target.x + this.vel.z * target.z < 0) { this.vel.x *= 0.8; this.vel.z *= 0.8; }
      this.vel.x = approach(this.vel.x, target.x, acc * Math.max(1, Math.abs(target.x - this.vel.x) / 4));
      this.vel.z = approach(this.vel.z, target.z, acc * Math.max(1, Math.abs(target.z - this.vel.z) / 4));
      this.vel.y = -3;
      if (wlen > 0.5 && this.hspeed() > 6) this.sprintT += h; else this.sprintT = Math.max(0, this.sprintT - h * 3);
      if (this.jumpBuf > 0) this.jump();
      else if (this.pendingIn.crouch && this.hspeed() > 5) this.startSlide();
      else if (this.pendingIn.dash && this.dashCD <= 0) this.startDash();
      else if (wlen > 0.5 && this.hspeed() > 6.5) this.tryVault();
    } else if (this.state === 'slide') {
      this.slideT -= h;
      const hs = this.hspeed();
      // slope: sliding downhill accelerates
      const n = this.groundNormal;
      const down = _v.set(n.x, 0, n.z);
      this.vel.x += down.x * g * 0.9 * h; this.vel.z += down.z * g * 0.9 * h;
      const fr = Math.max(0, 1 - TUNE.slideFriction * 0.12 * h * (this.self.has('melting') ? 0.1 : 1));
      this.vel.x *= fr; this.vel.z *= fr;
      if (wlen > 0.1 && hs > 0.1) { // gentle steering
        const cur = Math.atan2(this.vel.x, this.vel.z), want = Math.atan2(wish.x, wish.z);
        const a = angleLerp(cur, want, Math.min(1, h * 2.2));
        this.vel.x = Math.sin(a) * hs; this.vel.z = Math.cos(a) * hs;
      }
      this.vel.y = -3;
      if (this.jumpBuf > 0) { this.jump(1.18); }
      else if ((this.slideT <= 0 && !this.self.has('melting')) || hs < 3) this.endSlide();
    } else if (this.state === 'wallrun') {
      this.wallRunMove(h, wish);
    } else if (this.state === 'pound') {
      this.poundT += h;
      if (this.poundT < 0.3) this.vel.set(0, 1.5, 0);
      else this.vel.set(0, -TUNE.poundSpeed * (this.self.has('heavy') ? 1.3 : 1), 0);
    } else if (this.state === 'climb') {
      this.climbT -= h;
      this.vel.y = 7.5;
      this.vel.x *= 0.9; this.vel.z *= 0.9;
      if (this.tryMantle(true)) return;
      if (this.climbT <= 0 || !this.wallAhead(0.9)) { this.state = 'air'; this.vel.addScaledVector(this.wall.n, 3); }
    } else { // air
      this.airTime += h;
      const target = wish.clone().multiplyScalar(Math.max(this.moveSpeed(), this.hspeed()));
      const acc = TUNE.airAccel * h;
      if (wlen > 0.1) {
        this.vel.x = approach(this.vel.x, target.x, acc);
        this.vel.z = approach(this.vel.z, target.z, acc);
      }
      this.vel.y -= g * h;
      if (this.self.has('floating') && this.jumpHeld && this.vel.y < -2.5) this.vel.y = -2.5; // glide
      if (this.drowsy > 0 && this.vel.y < -8) this.vel.y = -8;
      this.vel.y = Math.max(-TUNE.maxFall, this.vel.y);
      this.coyote -= h;
      if (this.jumpBuf > 0) {
        if (this.coyote > 0) this.jump();
        else if (this.tryWallJump()) { /* kicked off a wall */ }
        else if (this.self.has('bursting')) this.blastJump();
        else if (this.jumpsUsed < this.maxJumps()) this.doubleJump();
      }
      if (this.state === 'air') {
        if (this.pendingIn.dash && !this.airDashUsed && this.dashCD <= 0) this.startDash();
        else if (this.pendingIn.crouch && this.heightAboveGround() > 1.6) this.startPound();
        else if (this.vel.y < 1 && this.grind.cool <= 0 && this.tryRail()) return;
        else if (wlen > 0.3 && this.tryMantle()) return;
        else if (this.vel.y < 5 && this.tryWallRun(wish)) { /* started */ }
        else if (wlen > 0.5 && !this.climbUsed && this.vel.y > -3 && this.tryClimb(wish)) { /* climbing */ }
      }
    }
    this.pendingIn.dash = false; this.pendingIn.crouch = false;
    this.integrate(h);
  }

  integrate(h) {
    const desired = { x: this.vel.x * h, y: this.vel.y * h, z: this.vel.z * h };
    const kcc = this.kcc;
    kcc.computeColliderMovement(this.collider, desired, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, this.filterGroups());
    const mv = kcc.computedMovement();
    const wasGrounded = this.grounded;
    this.grounded = kcc.computedGrounded();
    // ceiling bonk
    for (let i = 0; i < kcc.numComputedCollisions(); i++) {
      const c = kcc.computedCollision(i);
      if (c && c.normal1.y < -0.7 && this.vel.y > 0) this.vel.y = 0;
    }
    const t = this.body.translation();
    const nx = t.x + mv.x, ny = t.y + mv.y, nz = t.z + mv.z;
    this.body.setNextKinematicTranslation({ x: nx, y: ny, z: nz });
    this.pos.set(nx, ny - this.halfHNow() - this.r, nz);
    // horizontal velocity absorbs wall collisions (keeps momentum honest)
    if (h > 0 && this.dashT <= 0 && this.state !== 'pound') {
      const ax = mv.x / h, az = mv.z / h;
      if (Math.abs(ax) < Math.abs(this.vel.x) - 0.5) this.vel.x = ax;
      if (Math.abs(az) < Math.abs(this.vel.z) - 0.5) this.vel.z = az;
    }
    // ground grace: small gaps (dune bumps, crouching) don't count as leaving the ground
    if (!this.grounded && (this.state === 'ground' || this.state === 'slide') && this.vel.y <= 0.5) {
      const below = this.game.physics.ray({ x: this.pos.x, y: this.pos.y + 0.2, z: this.pos.z }, { x: 0, y: -1, z: 0 }, 0.55, this.rayMask());
      if (below && below.normal.y > 0.6) {
        this.grounded = true;
        const t2 = this.body.translation();
        const drop = Math.min(0.3, this.pos.y - below.point.y);
        if (drop > 0.01) { this.body.setNextKinematicTranslation({ x: t2.x + mv.x, y: t2.y + mv.y - drop, z: t2.z + mv.z }); this.pos.y -= drop; }
      }
    }
    if (this.grounded) this.probeGround();
    if (this.grounded && (this.state === 'air' || this.state === 'pound' || this.state === 'climb') && this.vel.y <= 0.5) this.land();
    else if (!this.grounded && (this.state === 'ground' || this.state === 'slide')) {
      this.state = 'air'; this.coyote = TUNE.coyote; this.airTime = 0; this.fallFrom = this.pos.y;
      if (this.halfHNow() !== this.halfH) this.setCrouch(false);
      this.anim.play('Fall', { fade: 0.25 });
    }
    // safe position + void rescue
    if (this.grounded && this.state === 'ground') {
      this.safeT += h;
      if (this.safeT > 0.5 && (!this.groundEntity || this.groundEntity.anchored)) { this.safeT = 0; this.safePos.copy(this.pos); }
    }
    if (this.pos.y < -25) this.rescue();
    // hard-coded arena bound (edge of the dream)
    const lim = this.game.level?.bound || 1e9;
    const rr = Math.hypot(this.pos.x, this.pos.z);
    if (rr > lim) this.rescue();
  }

  halfHNow() { return this.collider.halfHeight ? this.collider.halfHeight() : this.halfH; }
  setCrouch(on) {
    const hh = on ? this.halfHSlide : this.halfH;
    const cur = this.halfHNow();
    if (Math.abs(hh - cur) < 1e-3) return true;
    if (!on) { // need headroom to stand
      const t = this.body.translation();
      const hit = this.game.physics.ray({ x: t.x, y: t.y, z: t.z }, { x: 0, y: 1, z: 0 }, (this.halfH - cur) * 2 + this.r + 0.05, this.rayMask());
      if (hit) return false;
    }
    const t = this.body.translation();
    this.collider.setHalfHeight(hh);
    const y = this.pos.y + hh + this.r;
    this.body.setTranslation({ x: t.x, y, z: t.z }, true);
    this.body.setNextKinematicTranslation({ x: t.x, y, z: t.z });
    return true;
  }

  probeGround() {
    const hit = this.game.physics.ray({ x: this.pos.x, y: this.pos.y + 0.3, z: this.pos.z }, { x: 0, y: -1, z: 0 }, 0.8, this.rayMask());
    this.groundEntity = hit ? hit.entity : null;
    if (hit) this.groundNormal.copy(hit.normal);
  }

  heightAboveGround() {
    const hit = this.game.physics.ray({ x: this.pos.x, y: this.pos.y + 0.1, z: this.pos.z }, { x: 0, y: -1, z: 0 }, 30, this.rayMask());
    return hit ? hit.dist : 30;
  }

  // ------------------------------------------------------------------ moves
  jump(boost = 1) {
    this.jumpBuf = 0;
    const heavy = this.self.has('heavy');
    const j = TUNE.jumpVel * (heavy ? 0.82 : 1);
    if (this.state === 'slide') { this.setCrouch(false); this.vel.x *= boost; this.vel.z *= boost; }
    this.vel.y = j;
    this.state = 'air'; this.grounded = false; this.coyote = 0; this.jumpsUsed = 1; this.airTime = 0;
    this.fallFrom = this.pos.y;
    this.anim.play('JumpUp', { fade: 0.08, onDone: () => { if (this.state === 'air' && this.anim.base === 'JumpUp') this.anim.play('Fall', { fade: 0.3 }); } });
    this.game.audio.sfx('jump', { position: this.pos });
    this.game.vfx.dust(this.pos, 0.35);
    if (this.self.has('bursting')) this.blastJump(true);
  }

  doubleJump() {
    this.jumpBuf = 0;
    this.jumpsUsed++;
    this.vel.y = TUNE.doubleJumpVel * (this.self.has('heavy') ? 0.8 : 1);
    const wish = this.wish();
    if (wish.lengthSq() > 0.01) { // redirect momentum on the double jump
      const hs = Math.max(this.hspeed(), this.moveSpeed() * 0.9);
      wish.normalize();
      this.vel.x = wish.x * hs; this.vel.z = wish.z * hs;
    }
    this.fallFrom = this.pos.y;
    this.anim.play('DoubleJump', { fade: 0.06, lockUpper: true, restart: true, onDone: () => { if (this.state === 'air') this.anim.play('Fall', { fade: 0.2 }); } });
    this.game.audio.sfx('doubleJump', { position: this.pos });
    for (let i = 0; i < 12; i++) this.game.vfx.trail(this.pos.clone().add(new THREE.Vector3(rnd(-0.4, 0.4), rnd(0, 0.3), rnd(-0.4, 0.4))), '#fff3d6', 0.2, 0.4);
    this.game.vfx.ring(this.pos.clone().setY(this.pos.y + 0.05), 0.2, 1.4, 0.35, 0xfff3d6, 0.7);
  }

  blastJump(fromGround = false) {
    this.jumpBuf = 0;
    this.self.delete('bursting');
    this.game.explode(this.pos.clone(), { radius: 3.8, damage: 55, source: 'self' });
    this.vel.y = 17;
    const f = this.wish().normalize();
    this.vel.x += f.x * 8; this.vel.z += f.z * 8;
    this.state = 'air'; this.grounded = false;
    this.anim.play('DoubleJump', { fade: 0.05, lockUpper: true, restart: true, onDone: () => { if (this.state === 'air') this.anim.play('Fall', { fade: 0.2 }); } });
    this.refreshSelfLook();
  }

  startDash() {
    this.pendingIn.dash = false;
    const w = this.wish();
    if (w.lengthSq() < 0.01) this.flatForward(w);
    this.dashDir.copy(w.setY(0).normalize());
    this.dashT = TUNE.dashTime; this.dashCD = TUNE.dashCooldown;
    if (this.state === 'air') this.airDashUsed = true;
    if (this.state === 'slide') this.endSlide();
    this.iframes = Math.max(this.iframes, 0.12);
    this.fovKick = 1;
    this.anim.play('Dash', { fade: 0.05, restart: true, onDone: () => this.resumeLoco() });
    this.game.audio.sfx('dash', { position: this.pos });
    for (let i = 0; i < 10; i++) this.game.vfx.trail(this.pos.clone().add(new THREE.Vector3(rnd(-0.3, 0.3), rnd(0.3, 1.6), rnd(-0.3, 0.3))), '#fff0d0', 0.25, 0.35);
  }

  dashEffects() {
    const game = this.game;
    // heavy dashes smash through walls; burning dashes ignite; everything gets shoved
    const c = this.pos.clone().setY(this.pos.y + 1);
    for (const e of game.entities) {
      if (e.dead) continue;
      const d = e.center(_v).distanceTo(c);
      if (d > e.radius() + 1.0) continue;
      if (e.kind === 'enemy') {
        if (!e._dashHit || game.time - e._dashHit > 0.4) {
          e._dashHit = game.time;
          if (this.self.has('burning')) e.addProp('burning');
          e.damage(this.self.has('heavy') ? 35 : 8, { type: 'dash', dir: this.dashDir.clone() });
          if (e.body) e.body.applyImpulse({ x: this.dashDir.x * 8 * e.body.mass(), y: 3 * e.body.mass(), z: this.dashDir.z * 8 * e.body.mass() }, true);
        }
      } else if (this.self.has('heavy') && e.fracture_ && e.kind === 'wall') {
        e.damage(400, { point: c.clone(), heavy: true, dir: this.dashDir.clone() });
        game.vfx.shake = Math.min(1, game.vfx.shake + 0.4);
      } else if (e.body && e.body.isDynamic()) {
        e.body.applyImpulse({ x: this.dashDir.x * 4 * e.body.mass(), y: 1.5 * e.body.mass(), z: this.dashDir.z * 4 * e.body.mass() }, true);
      }
    }
  }

  startSlide() {
    this.pendingIn.crouch = false;
    this.state = 'slide';
    this.slideT = TUNE.slideTime;
    const hs = this.hspeed();
    const k = (hs + TUNE.slideBoost) / Math.max(0.01, hs);
    this.vel.x *= k; this.vel.z *= k;
    this.setCrouch(true);
    this.sprintT = 0;
    this.anim.play('Slide', { fade: 0.1 });
    this.game.audio.sfx('slide', { position: this.pos });
  }

  endSlide() {
    if (this.setCrouch(false)) { this.state = 'ground'; this.resumeLoco(); }
    else { this.slideT = 0.2; } // no headroom, keep sliding
  }

  startPound() {
    this.pendingIn.crouch = false;
    this.state = 'pound'; this.poundT = 0;
    this.anim.play('PoundStart', { fade: 0.05, lockUpper: true, restart: true, onDone: () => { if (this.state === 'pound') this.anim.play('PoundFall', { fade: 0.08, lockUpper: true }); } });
    this.game.audio.sfx('dash', { position: this.pos, pitch: -5 });
  }

  poundLand() {
    const game = this.game;
    const heavy = this.self.has('heavy');
    const R = heavy ? 7 : 3.6;
    game.audio.sfx('groundPound', { position: this.pos, gain: heavy ? 1.6 : 1 });
    game.vfx.ring(this.pos.clone().setY(this.pos.y + 0.1), 0.5, R * 1.3, 0.5, heavy ? 0x9aa3b5 : 0xfff0d0, 1);
    game.vfx.dust(this.pos, heavy ? 2.4 : 1.3);
    game.vfx.shake = Math.min(1, game.vfx.shake + (heavy ? 0.7 : 0.35));
    for (const e of game.entities) {
      if (e.dead) continue;
      const c = e.center(_v);
      const d = c.distanceTo(this.pos);
      if (d > R + e.radius()) continue;
      const k = 1 - d / (R + e.radius());
      if (e.kind === 'enemy') e.damage((heavy ? 60 : 28) * k + 6, { type: 'pound', dir: c.clone().sub(this.pos).normalize() });
      if (heavy && e.kind === 'wall' && e.fracture_) e.damage(500 * k, { point: this.pos.clone(), heavy: true });
      if (e.body && e.body.isDynamic()) {
        const m = e.body.mass();
        const dir = c.clone().sub(this.pos).normalize();
        e.body.applyImpulse({ x: dir.x * 6 * k * m, y: (heavy ? 9 : 6) * k * m, z: dir.z * 6 * k * m }, true);
      }
    }
    for (const col of game.physics.overlapSphere(this.pos, R, G.DEBRIS)) {
      const b = col.parent(); if (!b || !b.isDynamic()) continue;
      b.applyImpulse({ x: 0, y: 5 * b.mass(), z: 0 }, true);
    }
    this.anim.play('PoundLand', { fade: 0.03, lockUpper: true, restart: true, onDone: () => this.resumeLoco() });
    this.controlLock = 0.25;
  }

  land() {
    const fall = this.fallFrom - this.pos.y;
    const wasPound = this.state === 'pound';
    this.state = 'ground';
    this.jumpsUsed = 0; this.airDashUsed = false; this.climbUsed = false;
    this.grounded = true;
    if (this.vel.y < 0) this.vel.y = -3;
    const ge = this.groundEntity;
    if (ge && ge.bouncy && ge.props.has('sleeping') && !this.crouchHeld) { // the bed is a trampoline
      this.vel.y = TUNE.bedBounce * (this.self.has('heavy') ? 0.75 : 1);
      this.state = 'air'; this.grounded = false; this.jumpsUsed = 1; this.fallFrom = this.pos.y;
      this.anim.play('Bounce', { fade: 0.05, restart: true, onDone: () => { if (this.state === 'air') this.anim.play('Fall', { fade: 0.2 }); } });
      this.game.audio.sfx('bounce', { position: this.pos, quantize: 'loose' });
      this.game.vfx.propertyBurst(this.pos.clone().setY(this.pos.y + 0.2), 'sleeping', 0.6);
      return;
    }
    if (wasPound) { this.poundLand(); return; }
    const hs = this.hspeed();
    this.game.audio.sfx('land', { position: this.pos, gain: Math.min(1.5, 0.3 + fall * 0.12) });
    if (fall > 1.5) this.game.vfx.dust(this.pos, Math.min(1.4, 0.3 + fall * 0.08));
    if (fall > 7 && hs > 5) {
      this.anim.play('RollLand', { fade: 0.05, lockUpper: true, restart: true, onDone: () => this.resumeLoco() });
    } else if (fall > 1.2) {
      this.anim.play('Land', { fade: 0.05, restart: true, onDone: () => this.resumeLoco() });
      if (fall > 5) this.game.vfx.shake = Math.min(1, this.game.vfx.shake + 0.1);
    } else this.resumeLoco();
    if (fall > 14 && !this.self.has('floating')) this.hurt((fall - 14) * 3, { type: 'fall' });
    if (this.crouchHeld && hs > 5) this.startSlide();
  }

  resumeLoco() {
    if (this.state === 'ground') this.anim.play(this.locoClip(), { fade: 0.18 });
    else if (this.state === 'air') this.anim.play('Fall', { fade: 0.2 });
    else if (this.state === 'slide') this.anim.play('Slide', { fade: 0.12 });
  }

  // -------------------------------------------------------------- parkour
  wallAhead(dist) {
    const f = this.facingDir();
    const hit = this.game.physics.ray({ x: this.pos.x, y: this.pos.y + 1.0, z: this.pos.z }, { x: f.x, y: 0, z: f.z }, dist, this.rayMask());
    if (hit && Math.abs(hit.normal.y) < 0.35) { this.wall.n.copy(hit.normal); return hit; }
    return null;
  }
  facingDir() {
    const w = this.wish();
    if (w.lengthSq() > 0.01) return w.setY(0).normalize();
    const v = new THREE.Vector3(this.vel.x, 0, this.vel.z);
    if (v.lengthSq() > 0.1) return v.normalize();
    return new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
  }

  tryWallRun(wish) {
    if (this.wall.cool > 0 || this.hspeed() < TUNE.wallRunMinSpeed) return false;
    if (this.heightAboveGround() < 0.8) return false;
    const v = new THREE.Vector3(this.vel.x, 0, this.vel.z).normalize();
    const left = new THREE.Vector3(v.z, 0, -v.x); // +90 deg
    for (const side of [1, -1]) {
      const dir = left.clone().multiplyScalar(side);
      const hit = this.game.physics.ray({ x: this.pos.x, y: this.pos.y + 1.0, z: this.pos.z }, dir, 0.95, this.rayMask());
      if (!hit || Math.abs(hit.normal.y) > 0.3) continue;
      if (hit.entity && hit.entity.kind === 'enemy') continue;
      if (this.wall.lastN.dot(hit.normal) > 0.9 && this.wall.cool > -0.6) continue; // same wall again
      this.state = 'wallrun';
      this.wall.n.copy(hit.normal); this.wall.side = side; this.wall.t = 0;
      const along = new THREE.Vector3().crossVectors(hit.normal, UP).normalize();
      if (along.dot(v) < 0) along.negate();
      this.wall.along = along;
      const hs = Math.max(this.hspeed(), 9);
      this.vel.x = along.x * hs; this.vel.z = along.z * hs;
      this.vel.y = Math.max(this.vel.y, 3.2);
      this.jumpsUsed = 1; this.airDashUsed = false;
      // wall on the character's left if the wall normal points to our right
      const onLeft = new THREE.Vector3().crossVectors(UP, along).dot(hit.normal) < 0;
      this.wall.leftSide = onLeft;
      this.anim.play(onLeft ? 'WallRunL' : 'WallRunR', { fade: 0.12 });
      this.game.audio.sfx('wallrun', { position: this.pos });
      return true;
    }
    return false;
  }

  wallRunMove(h, wish) {
    const w = this.wall;
    w.t += h;
    const hs = Math.max(this.hspeed(), 8.5);
    this.vel.x = w.along.x * hs - w.n.x * 1.5; this.vel.z = w.along.z * hs - w.n.z * 1.5;
    const gk = w.t < 0.55 ? 0.12 : 0.12 + (w.t - 0.55) * 1.4;
    this.vel.y -= this.gravity() * gk * h;
    if (this.jumpBuf > 0) {
      this.jumpBuf = 0;
      this.state = 'air';
      this.vel.x = w.along.x * hs * 0.85 + w.n.x * TUNE.wallJumpOut;
      this.vel.z = w.along.z * hs * 0.85 + w.n.z * TUNE.wallJumpOut;
      this.vel.y = TUNE.wallJumpUp;
      this.endWall();
      this.anim.play('WallJump', { fade: 0.06, restart: true, onDone: () => { if (this.state === 'air') this.anim.play('Fall', { fade: 0.2 }); } });
      this.game.audio.sfx('wallJump', { position: this.pos });
      this.game.vfx.impact(this.pos.clone().setY(this.pos.y + 1).addScaledVector(w.n, -0.4), w.n, '#fff0d0', 0.8);
      this.integrate(h);
      return;
    }
    const still = this.game.physics.ray({ x: this.pos.x, y: this.pos.y + 1.0, z: this.pos.z }, { x: -w.n.x, y: 0, z: -w.n.z }, 1.2, this.rayMask());
    if (!still || w.t > TUNE.wallRunTime || this.grounded) {
      this.state = this.grounded ? 'ground' : 'air';
      this.endWall();
      this.vel.addScaledVector(w.n, 2);
      this.resumeLoco();
    } else if (still) {
      w.n.lerp(still.normal, 0.3).normalize();
    }
    // footfalls on the wall
    const ph = this.anim.phase();
    const idx = ph < 0.5 ? 0 : 1;
    if (idx !== this.lastFootIdx) { this.lastFootIdx = idx; this.game.audio.sfx('wallrun', { position: this.pos, gain: 0.6 }); }
    this.integrate(h);
  }
  endWall() { this.wall.cool = 0.25; this.wall.lastN.copy(this.wall.n); }

  tryWallJump() {
    const f = this.facingDir();
    const dirs = [f, f.clone().negate(), new THREE.Vector3(f.z, 0, -f.x), new THREE.Vector3(-f.z, 0, f.x)];
    for (const d of dirs) {
      const hit = this.game.physics.ray({ x: this.pos.x, y: this.pos.y + 1.0, z: this.pos.z }, d, 0.75, this.rayMask());
      if (hit && Math.abs(hit.normal.y) < 0.3 && !(hit.entity && hit.entity.kind === 'enemy')) {
        this.jumpBuf = 0;
        const hs = Math.max(this.hspeed(), 6);
        const w = this.wish();
        this.vel.x = hit.normal.x * TUNE.wallJumpOut + w.x * hs * 0.5;
        this.vel.z = hit.normal.z * TUNE.wallJumpOut + w.z * hs * 0.5;
        this.vel.y = TUNE.wallJumpUp;
        this.wall.lastN.copy(hit.normal); this.wall.cool = 0.2;
        this.anim.play('WallJump', { fade: 0.06, restart: true, onDone: () => { if (this.state === 'air') this.anim.play('Fall', { fade: 0.2 }); } });
        this.game.audio.sfx('wallJump', { position: this.pos });
        return true;
      }
    }
    return false;
  }

  tryClimb(wish) {
    const hit = this.wallAhead(0.7);
    if (!hit) return false;
    const f = wish.clone().setY(0).normalize();
    if (f.dot(hit.normal) > -0.75) return false;
    this.state = 'climb'; this.climbT = 0.42; this.climbUsed = true;
    this.anim.play('Mantle', { fade: 0.1, lockUpper: true, restart: true });
    this.game.audio.sfx('wallrun', { position: this.pos });
    return true;
  }

  // ledge detection -> scripted mantle
  tryMantle(force = false) {
    const f = this.facingDir();
    const ph = this.game.physics;
    const chest = { x: this.pos.x, y: this.pos.y + 0.9, z: this.pos.z };
    const wallHit = ph.ray(chest, { x: f.x, y: 0, z: f.z }, force ? 1.0 : 0.85, this.rayMask());
    let probe;
    if (wallHit && Math.abs(wallHit.normal.y) < 0.4) probe = wallHit.point.clone().addScaledVector(f, 0.35);
    else {
      // nothing at chest height: maybe a ledge just above the knees
      const low = ph.ray({ x: this.pos.x, y: this.pos.y + 0.35, z: this.pos.z }, { x: f.x, y: 0, z: f.z }, 0.8, this.rayMask());
      if (!low || Math.abs(low.normal.y) > 0.4) return false;
      probe = low.point.clone().addScaledVector(f, 0.35);
    }
    const top = ph.ray({ x: probe.x, y: this.pos.y + TUNE.mantleMax + 0.4, z: probe.z }, { x: 0, y: -1, z: 0 }, TUNE.mantleMax + 0.4, this.rayMask());
    if (!top || top.normal.y < 0.7) return false;
    const rise = top.point.y - this.pos.y;
    if (rise < 0.45 || rise > TUNE.mantleMax) return false;
    if (top.entity && (top.entity.kind === 'enemy' || top.entity.kind === 'boss')) return false;
    // headroom above the ledge
    const head = ph.ray({ x: top.point.x, y: top.point.y + 0.05, z: top.point.z }, { x: 0, y: 1, z: 0 }, 1.8, this.rayMask());
    if (head) return false;
    this.beginScripted('mantle', top.point.clone().addScaledVector(f, 0.25), 0.42 + rise * 0.07, top.point.y + 0.25);
    this.anim.play('Mantle', { fade: 0.06, lockUpper: true, restart: true, onDone: () => this.resumeLoco() });
    this.game.audio.sfx('mantle', { position: this.pos });
    return true;
  }

  tryVault() {
    const f = this.facingDir();
    const ph = this.game.physics;
    const knee = ph.ray({ x: this.pos.x, y: this.pos.y + 0.55, z: this.pos.z }, { x: f.x, y: 0, z: f.z }, 1.1, this.rayMask());
    if (!knee || Math.abs(knee.normal.y) > 0.3) return false;
    if (knee.entity && knee.entity.kind === 'enemy') return false;
    const head = ph.ray({ x: this.pos.x, y: this.pos.y + 1.55, z: this.pos.z }, { x: f.x, y: 0, z: f.z }, 1.6, this.rayMask());
    if (head) return false;
    const p = knee.point.clone().addScaledVector(f, 0.3);
    const top = ph.ray({ x: p.x, y: this.pos.y + TUNE.vaultMax + 0.3, z: p.z }, { x: 0, y: -1, z: 0 }, TUNE.vaultMax + 0.3, this.rayMask());
    if (!top || top.normal.y < 0.6) return false;
    const rise = top.point.y - this.pos.y;
    if (rise < 0.4 || rise > TUNE.vaultMax) return false;
    // thin obstacle? find the far side
    const far = knee.point.clone().addScaledVector(f, 1.6);
    const beyond = ph.ray({ x: far.x, y: top.point.y + 0.2, z: far.z }, { x: 0, y: -1, z: 0 }, 6, this.rayMask());
    if (beyond && beyond.point.y < top.point.y - 0.3) {
      const land = knee.point.clone().addScaledVector(f, 2.3); land.y = beyond.point.y;
      this.beginScripted('vault', land, 0.42, top.point.y + 0.45);
      this.anim.play('Vault', { fade: 0.05, lockUpper: true, restart: true, onDone: () => this.resumeLoco() });
    } else {
      this.beginScripted('mantle', top.point.clone().addScaledVector(f, 0.3), 0.3, top.point.y + 0.2);
      this.anim.play('Land', { fade: 0.05, restart: true, onDone: () => this.resumeLoco() });
    }
    this.game.audio.sfx('mantle', { position: this.pos });
    return true;
  }

  beginScripted(kind, to, dur, apex) {
    const m = this.move;
    m.kind = kind; m.from.copy(this.pos); m.to.copy(to); m.dur = dur; m.t = 0; m.apex = apex;
    m.exitSpeed = kind === 'vault' ? Math.max(this.hspeed(), TUNE.runSpeed) : 3;
    m.exitDir = to.clone().sub(this.pos).setY(0).normalize();
    this.state = kind;
    this.vel.set(0, 0, 0);
    this.dashT = 0;
  }

  scriptedMove(h) {
    const m = this.move;
    m.t = Math.min(1, m.t + h / m.dur);
    const t = m.t;
    let x, y, z;
    if (m.kind === 'mantle') {
      // rise first, then move over the ledge
      const up = Math.min(1, t / 0.6), fw = Math.max(0, (t - 0.35) / 0.65);
      const eu = 1 - (1 - up) * (1 - up), ef = fw * fw * (3 - 2 * fw);
      y = m.from.y + (m.apex - m.from.y) * eu + (m.to.y - m.apex) * ef;
      x = m.from.x + (m.to.x - m.from.x) * ef; z = m.from.z + (m.to.z - m.from.z) * ef;
    } else {
      const e = t;
      x = m.from.x + (m.to.x - m.from.x) * e; z = m.from.z + (m.to.z - m.from.z) * e;
      const base = m.from.y + (m.to.y - m.from.y) * e;
      y = base + Math.sin(Math.PI * Math.min(1, e * 1.1)) * (m.apex - Math.max(m.from.y, m.to.y) + 0.1);
    }
    this.pos.set(x, y, z);
    const cy = y + this.halfHNow() + this.r;
    this.body.setNextKinematicTranslation({ x, y: cy, z });
    if (t >= 1) {
      this.state = 'air';
      this.vel.set(m.exitDir.x * m.exitSpeed, 0, m.exitDir.z * m.exitSpeed);
      this.fallFrom = this.pos.y;
      this.jumpsUsed = 1;
      this.integrate(h);
    }
  }

  // ---------------------------------------------------------------- grinding
  tryRail() {
    const rails = this.game.level?.rails || [];
    for (const rail of rails) {
      const hit = rail.closest(this.pos);
      if (!hit) continue;
      const dy = this.pos.y - hit.point.y;
      if (hit.dist2 < 0.55 * 0.55 && dy > -0.5 && dy < 0.7) {
        const t = rail.tangent(hit.s);
        const v = new THREE.Vector3(this.vel.x, 0, this.vel.z);
        const dir = v.dot(t) >= 0 ? 1 : -1;
        this.state = 'grind';
        this.grind.rail = rail; this.grind.s = hit.s; this.grind.dir = dir;
        this.grind.speed = Math.max(TUNE.grindMinSpeed, Math.abs(v.dot(t)) + 1.5);
        this.jumpsUsed = 0; this.airDashUsed = false;
        this.anim.play('Grind', { fade: 0.1 });
        this.game.audio.sfx('grindStart', { position: this.pos });
        this.game.vfx.impact(hit.point, UP, '#ffd27a', 1.2);
        return true;
      }
    }
    return false;
  }

  grindMove(h) {
    const gr = this.grind;
    const rail = gr.rail;
    const t = rail.tangent(gr.s);
    gr.speed += -t.y * gr.dir * this.gravity() * 0.8 * h;
    gr.speed = Math.max(TUNE.grindMinSpeed * 0.9, Math.min(26, gr.speed));
    gr.s += gr.dir * gr.speed * h;
    const p = rail.point(Math.max(0, Math.min(rail.length, gr.s)));
    this.pos.copy(p).add(new THREE.Vector3(0, 0.04, 0));
    this.vel.copy(t).multiplyScalar(gr.dir * gr.speed);
    this.body.setNextKinematicTranslation({ x: this.pos.x, y: this.pos.y + this.halfHNow() + this.r, z: this.pos.z });
    gr.tickT -= h;
    if (gr.tickT <= 0) {
      gr.tickT = 0.1;
      this.game.audio.sfx('grind', { position: this.pos, gain: 0.5 });
      this.game.vfx.impact(p, UP, '#ffcf6a', 0.5);
    }
    const leave = (up) => {
      this.state = 'air';
      this.vel.copy(t).multiplyScalar(gr.dir * gr.speed);
      this.vel.y = Math.max(this.vel.y, 0) + up;
      gr.cool = 0.35; gr.rail = null;
      this.fallFrom = this.pos.y;
      this.game.audio.sfx('grindEnd', { position: this.pos });
    };
    if (this.jumpBuf > 0) {
      this.jumpBuf = 0;
      leave(TUNE.jumpVel);
      this.jumpsUsed = 1;
      this.anim.play('JumpUp', { fade: 0.06, restart: true, onDone: () => { if (this.state === 'air') this.anim.play('Fall', { fade: 0.25 }); } });
      this.game.audio.sfx('jump', { position: this.pos });
    } else if (gr.s <= 0 || gr.s >= rail.length) {
      leave(3);
      this.anim.play('Fall', { fade: 0.2 });
    }
  }

  // --------------------------------------------------------------- damage
  hurt(amount, opts = {}) {
    if (this.dead || this.iframes > 0 || this.self.has('hollow') || this.game.godMode) return;
    if (this.state === 'mantle' || this.state === 'vault') amount *= 0.5;
    this.hp -= amount;
    this.hurtFlash = Math.min(1, this.hurtFlash + amount / 25);
    this.regenT = 0;
    this.iframes = 0.18;
    this.game.vfx.shake = Math.min(1, this.game.vfx.shake + amount / 60);
    this.game.audio.sfx('hit', { gain: Math.min(1.2, amount / 15) });
    this.game.ui.hurtDirection(opts.from || null);
    if (opts.props && opts.props.length) {
      for (const p of opts.props) this.applyEcho(p);
    }
    if (this.hp <= 0) this.die();
  }

  // boss orbs carry your own combos back at you
  applyEcho(p) {
    const game = this.game;
    switch (p) {
      case 'floating': this.self.set('floating', 3); this.vel.y = Math.max(this.vel.y, 6); if (this.state !== 'air') this.state = 'air'; break;
      case 'heavy': this.self.set('heavy', 4); break;
      case 'burning': this.self.set('burning', 3); break;
      case 'sleeping': this.drowsy = 3; break;
      case 'melting': this.drowsy = Math.max(this.drowsy, 1.5); break;
      case 'hollow': this.disarmed = 2; break;
      case 'multiplying': game.spawnEnemy(this.pos.clone().add(new THREE.Vector3(rnd(-6, 6), 12, rnd(-6, 6))), { falling: true, gravity: 0.2 }); break;
      case 'bursting': {
        const at = this.pos.clone();
        game.vfx.ring(at.clone().setY(at.y + 0.1), 3.5, 3.4, 1.0, 0xff2d6f, 1);
        setTimeout(() => game.explode(at, { radius: 3.4, damage: 30, source: 'boss' }), 1000);
        break;
      }
      default: break;
    }
    this.refreshSelfLook();
  }

  knock(v) {
    if (this.dead) return;
    const k = this.self.has('heavy') ? 0.2 : 1;
    this.vel.addScaledVector(v, k);
    if (v.y * k > 2 && (this.state === 'ground' || this.state === 'slide')) {
      if (this.state === 'slide') this.setCrouch(false);
      this.state = 'air'; this.grounded = false; this.fallFrom = this.pos.y;
      this.anim.play('Fall', { fade: 0.15 });
    }
    if (this.state === 'grind') { this.state = 'air'; this.grind.cool = 0.4; }
  }

  heal(n) { this.hp = Math.min(this.maxHp, this.hp + n); }

  die() {
    if (this.dead) return;
    this.dead = true;
    this.hp = 0;
    this.state = 'air';
    this.anim.play('Wake', { fade: 0.15, lockUpper: true, restart: true });
    this.game.onPlayerDeath();
  }

  rescue() {
    this.body.setTranslation({ x: this.safePos.x, y: this.safePos.y + 1.2 + this.halfH + this.r, z: this.safePos.z }, true);
    this.pos.copy(this.safePos).setY(this.safePos.y + 1.2);
    this.prevPos.copy(this.pos);
    this.vel.set(0, 0, 0);
    this.state = 'air';
    this.hurt(12, { type: 'void' });
    this.game.ui.toast('The dream catches you.');
  }

  teleport(p, yaw) {
    this.pos.copy(p); this.prevPos.copy(p); this.renderPos.copy(p);
    this.body.setTranslation({ x: p.x, y: p.y + this.halfHNow() + this.r, z: p.z }, true);
    this.body.setNextKinematicTranslation({ x: p.x, y: p.y + this.halfHNow() + this.r, z: p.z });
    this.vel.set(0, 0, 0);
    this.safePos.copy(p);
    if (yaw !== undefined) { this.camYaw = yaw; this.yaw = yaw; }
    this.camPivot.copy(p).add(new THREE.Vector3(0, 2.0, 0));
    this.state = 'air';
  }

  // ------------------------------------------------------------ the gun
  muzzle(which = 'Give', out = new THREE.Vector3()) {
    const b = this.bones['muzzle' + which];
    if (b) return b.getWorldPosition(out);
    return out.copy(this.renderPos).add(new THREE.Vector3(0, 1.4, 0));
  }

  weapon(input, dt) {
    const game = this.game;
    this.fireCD -= dt;
    this.aimHold -= dt;
    this.disarmed = Math.max(0, this.disarmed - dt);
    if (this.dead || this.controlLock > 0) return;
    const busy = this.state === 'mantle' || this.state === 'vault' || this.anim.baseLock;
    // property selection
    const wheel = input.takeWheel();
    const dig = input.digit();
    const avail = this.available;
    if (dig && dig <= avail.length) this.select(dig - 1);
    else if (wheel) this.select(this.selected + wheel);
    if (this.reloadT > 0) {
      const before = this.reloadT;
      this.reloadT -= dt;
      if (before > 0.75 && this.reloadT <= 0.75) game.audio.sfx('reloadSpin');
      if (this.reloadT <= 0) { this.ammo = TUNE.magazine; game.audio.sfx('reloadEnd', { quantize: 'loose' }); }
      if (busy) { this.reloadT = 0; }
    }
    if (busy || this.disarmed > 0) return;
    if (input.hit('reload') && this.ammo < TUNE.magazine && this.reloadT <= 0) this.reload();
    // LMB: dream rounds
    if (input.btn(0) && this.reloadT <= 0 && this.fireCD <= 0) {
      if (this.ammo > 0) this.fire();
      else { this.reload(); }
    }
    if (input.click(2)) this.take();
    if (input.hit('give') || input.click(1)) this.give();
    if (input.hit('giveSelf')) this.giveSelf();
    if (input.hit('giveRounds')) this.giveRounds();
    if (input.btn(2) || input.btn(0)) this.aimHold = Math.max(this.aimHold, 0.6);
  }

  select(i) {
    const n = this.available.length;
    const ni = ((i % n) + n) % n;
    if (ni === this.selected) return;
    this.selected = ni;
    this.anim.trigger('SwapProperty', { speed: 1.3 });
    this.game.audio.sfx('swapProperty', { property: this.selectedProp });
    this.updateVial();
  }

  updateVial() {
    const p = this.selectedProp;
    const col = new THREE.Color(PROP_INFO[p]?.color || '#9ffcff');
    const has = this.chargesOf(p) > 0;
    for (const m of this.vialMats) { m.color.copy(col); m.emissive.copy(col); m.emissiveIntensity = has ? 4 : 0.4; }
    const rp = [...this.roundProps.keys()];
    const gc = rp.length ? new THREE.Color(PROP_INFO[rp[rp.length - 1]].color) : new THREE.Color('#9ffcff');
    for (const m of this.glowMats) { m.emissive.copy(gc); m.color.copy(gc); m.emissiveIntensity = rp.length ? 4 : 1.5; }
  }

  fire() {
    const game = this.game;
    this.ammo--;
    this.fireCD = TUNE.fireRate;
    this.aimHold = 1.4;
    const from = this.muzzle('Give');
    const dir = this.aimPoint.clone().sub(from).normalize();
    const props = new Set(this.roundProps.keys());
    game.projectiles.fireRound(from, dir, props);
    for (const [p, n] of this.roundProps) { if (n <= 1) this.roundProps.delete(p); else this.roundProps.set(p, n - 1); }
    if (!this.roundProps.size && props.size) this.updateVial();
    this.anim.trigger('FireRound', { speed: 1.1 });
    this.anim.recoil = 0.25;
    game.vfx.muzzle(from, dir, props.size ? game.projectiles.roundColor(props) : '#fff0c0');
    game.render.flash(from, 0xffd9a0, 6, 5, 0.06);
    const first = [...props][0];
    game.audio.sfx('fire', { quantize: true, property: first });
  }

  reload() {
    if (this.reloadT > 0) return;
    this.reloadT = TUNE.reloadTime;
    this.anim.trigger('Reload', { speed: 1.0 });
    this.game.audio.sfx('reloadStart');
  }

  // RMB: take a property from what you aim at
  take() {
    const game = this.game;
    const target = this.aimEntity;
    const from = this.muzzle('Take');
    this.aimHold = 1.2;
    this.anim.trigger('Take');
    const p = takeCandidate(target);
    if (!target || !p) {
      game.projectiles.propertyShot(from, this.aimPoint, '#cfd3da', 90, () => game.vfx.impact(this.aimPoint, this.aimNormal, '#cfd3da', 0.5));
      game.audio.sfx('fireEmpty');
      if (target && !p) game.ui.toast(`${target.displayName || target.name} has nothing to take.`);
      return;
    }
    game.audio.sfx('take', { property: p, quantize: 'loose' });
    const point = this.aimPoint.clone();
    game.projectiles.propertyShot(from, point, '#e9e3ff', 110, () => {
      const got = takeFrom(game, target);
      if (!got) return;
      game.vfx.propertyBurst(point, got, 0.8);
      game.projectiles.propertyShot(point, this.muzzle('Take'), PROP_INFO[got].color, 32, () => {
        this.addCharges(got, TUNE.takeCharges);
        const idx = this.available.indexOf(got);
        if (idx >= 0 && this.chargesOf(this.selectedProp) <= 0) this.select(idx);
        this.updateVial();
        game.ui.pickupProp(got);
        game.audio.sfx('swapProperty', { property: got });
        game.stats.takes++;
      }, () => this.muzzle('Take'));
    });
  }

  give() {
    const game = this.game;
    const p = this.selectedProp;
    this.aimHold = 1.2;
    if (this.chargesOf(p) <= 0) { game.ui.toast(`No ${PROP_INFO[p].label.toLowerCase()} left. Take it from a ${PROP_INFO[p].source.toLowerCase()}.`); game.audio.sfx('fireEmpty'); return; }
    const target = this.aimEntity;
    if (!target || target.immutable) { game.ui.toast('Aim at something to give it a property.'); game.audio.sfx('fireEmpty'); return; }
    const from = this.muzzle('Give');
    this.anim.trigger('Give');
    this.spend(p);
    this.updateVial();
    game.audio.sfx('give', { property: p, quantize: true });
    game.vfx.muzzle(from, this.aimPoint.clone().sub(from).normalize(), PROP_INFO[p].color);
    game.projectiles.propertyShot(from, this.aimPoint.clone(), PROP_INFO[p].color, 85, () => {
      if (!giveTo(game, target, p)) this.addCharges(p, 1);
    });
  }

  giveSelf() {
    const game = this.game;
    const p = this.selectedProp;
    if (this.chargesOf(p) <= 0) { game.ui.toast(`No ${PROP_INFO[p].label.toLowerCase()} to give yourself.`); game.audio.sfx('fireEmpty'); return; }
    this.spend(p);
    const { v, reason } = lucidityForGive(game, 'self', p);
    game.lucidity.gain(v, reason);
    game.recordCombo(p);
    this.anim.trigger('Infuse');
    game.audio.sfx('infuse', { property: p, quantize: 'loose' });
    game.vfx.propertyBurst(this.pos.clone().setY(this.pos.y + 1), p, 1.2);
    const dur = p === 'hollow' ? 6 : p === 'bursting' ? 30 : TUNE.selfDuration;
    this.self.set(p, dur);
    if (p === 'multiplying') { this.spawnDecoys(); this.self.delete('multiplying'); }
    if (p === 'melting') this.setCrouch(true);
    this.refreshSelfLook();
    this.updateVial();
    game.ui.toast(PROP_INFO[p].self);
  }

  giveRounds() {
    const game = this.game;
    const p = this.selectedProp;
    if (this.chargesOf(p) <= 0) { game.ui.toast(`No ${PROP_INFO[p].label.toLowerCase()} to load.`); game.audio.sfx('fireEmpty'); return; }
    this.spend(p);
    if (!this.roundProps.has(p) && this.roundProps.size >= 3) this.roundProps.delete(this.roundProps.keys().next().value);
    const { v, reason } = lucidityForGive(game, 'rounds', p);
    game.lucidity.gain(v, reason);
    game.recordCombo(p);
    this.roundProps.set(p, TUNE.roundsInfusion);
    this.anim.trigger('Infuse', { speed: 1.4 });
    game.audio.sfx('infuse', { property: p, quantize: 'loose' });
    this.updateVial();
    game.ui.toast(PROP_INFO[p].rounds);
  }

  spawnDecoys() {
    const game = this.game;
    for (const d of this.decoys) d.dead = true;
    this.decoys = [];
    for (let i = 0; i < 2; i++) {
      const fig = game.assets.cloneFigure();
      fig.traverse((m) => { if (m.isMesh) { m.material = m.material.clone(); m.material.transparent = true; m.material.opacity = 0.55; m.material.emissive = new THREE.Color('#ffd84a'); m.material.emissiveIntensity = 0.25; } });
      const grp = new THREE.Group(); grp.add(fig);
      const anim = new FigureAnimator(fig, game.assets.figure.animations);
      anim.play('Run', { fade: 0 });
      const pos = this.pos.clone().add(new THREE.Vector3(i ? 2 : -2, 0, 0));
      grp.position.copy(pos);
      game.scene.add(grp);
      this.decoys.push({ grp, anim, pos, dir: rnd(0, Math.PI * 2), t: 10, dead: false });
      game.vfx.propertyBurst(pos.clone().setY(pos.y + 1), 'multiplying', 0.8);
    }
  }

  refreshSelfLook() {
    const S = this.self;
    for (const s of this.figMats) {
      const m = s.m;
      if (m.name === 'GunVial' || m.name === 'GunGlow') continue;
      m.color.copy(s.color); m.metalness = s.metal; m.roughness = s.rough; m.opacity = s.opacity; m.transparent = s.transparent;
      m.emissive.copy(s.emissive); m.emissiveIntensity = s.ei;
      if (S.has('reflecting')) { m.color.lerp(new THREE.Color('#e8f0f8'), 0.8); m.metalness = 1; m.roughness = 0.05; }
      if (S.has('heavy')) { m.color.multiplyScalar(0.45); m.metalness = 0.8; m.roughness = 0.35; }
      if (S.has('sleeping')) { m.transparent = true; m.opacity = 0.45; m.color.lerp(new THREE.Color('#8f7bff'), 0.4); }
      if (S.has('hollow')) { m.transparent = true; m.opacity = 0.2; m.emissive.set('#5effd0'); m.emissiveIntensity = 0.5; }
      if (S.has('burning')) { m.emissive.set('#ff4a10'); m.emissiveIntensity = 0.25; }
      if (S.has('bursting')) { m.emissive.set('#ff2d6f'); m.emissiveIntensity = 0.3; }
      if (S.has('floating')) { m.emissive.set('#8fd3ff'); m.emissiveIntensity = Math.max(m.emissiveIntensity, 0.12); }
      m.needsUpdate = true;
    }
    const melting = S.has('melting');
    this.figure.scale.set(melting ? 1.25 : 1, melting ? 0.45 : 1, melting ? 1.25 : 1);
  }

  // ------------------------------------------------------------ per frame
  update(dt, input, alpha) {
    const game = this.game;
    this.controlLock = Math.max(0, this.controlLock - dt);
    this.iframes = Math.max(0, this.iframes - dt);
    this.hurtFlash = Math.max(0, this.hurtFlash - dt * 1.5);
    this.drowsy = Math.max(0, this.drowsy - dt);
    this.fovKick = Math.max(0, this.fovKick - dt * 3);
    // self-property timers
    let changed = false;
    for (const [p, t] of this.self) {
      const nt = t - dt;
      if (p === 'burning') { this.hp -= dt * 1.5; game.vfx.emitFor('burning', this.renderPos.clone().setY(this.renderPos.y + 0.9), { x: 0.3, y: 0.8, z: 0.3 }, dt, 0.7); }
      else if (p === 'melting') { this.hp -= dt * 0.8; game.vfx.emitFor('melting', this.renderPos, { x: 0.4, y: 0.4, z: 0.4 }, dt); }
      else game.vfx.emitFor(p, this.renderPos.clone().setY(this.renderPos.y + 0.2), { x: 0.3, y: 1.4, z: 0.3 }, dt, 0.6);
      if (nt <= 0) { this.self.delete(p); changed = true; if (p === 'melting') this.setCrouch(false); game.ui.toast(`${PROP_INFO[p].label} wears off.`); }
      else this.self.set(p, nt);
    }
    if (changed) this.refreshSelfLook();
    if (this.hp <= 0 && !this.dead) this.die();
    // regeneration
    this.regenT += dt;
    if (this.regenT > 6 && this.hp < this.maxHp && !this.dead) this.hp = Math.min(this.maxHp, this.hp + dt * 5);
    // interpolate the fixed-step position for rendering
    this.renderPos.lerpVectors(this.prevPos, this.pos, alpha);
    // camera look input
    const look = input.takeLook();
    if (!this.dead) {
      this.camYaw -= look.x;
      this.camPitch = THREE.MathUtils.clamp(this.camPitch - look.y, -1.15, 1.05);
    }
    this.weapon(input, dt);
    this.updateVisual(dt);
    this.updateCamera(dt);
    this.updateAim();
    this.updateDecoys(dt);
  }

  aiming() { return this.aimHold > 0 || this.anim.overlay != null; }

  locoClip() {
    const hs = this.hspeed();
    if (hs < 0.6) return 'Idle';
    if (this.aiming()) {
      const local = this.localVel();
      const a = Math.atan2(local.x, local.z);
      if (Math.abs(a) < 0.8) return 'Run';
      if (Math.abs(a) > 2.4) return 'RunBack';
      return a > 0 ? 'StrafeL' : 'StrafeR';
    }
    return this.sprintT > TUNE.sprintAfter ? 'Sprint' : 'Run';
  }

  localVel() {
    const v = new THREE.Vector3(this.vel.x, this.vel.y, this.vel.z);
    return v.applyAxisAngle(UP, -this.yaw);
  }

  updateVisual(dt) {
    const hs = this.hspeed();
    // facing
    let targetYaw = this.yaw;
    if (this.state === 'wallrun' && this.wall.along) targetYaw = Math.atan2(this.wall.along.x, this.wall.along.z);
    else if (this.state === 'grind') targetYaw = Math.atan2(this.vel.x, this.vel.z);
    else if (this.aiming() && this.state !== 'mantle' && this.state !== 'vault') targetYaw = this.camYaw;
    else if (hs > 0.8 && this.state !== 'mantle' && this.state !== 'vault') targetYaw = Math.atan2(this.vel.x, this.vel.z);
    else if (this.state === 'mantle' || this.state === 'vault') targetYaw = Math.atan2(this.move.exitDir.x, this.move.exitDir.z);
    const prevYaw = this.yaw;
    this.yaw = angleLerp(this.yaw, targetYaw, Math.min(1, dt * (this.aiming() ? 18 : 12)));
    const turnRate = Math.atan2(Math.sin(this.yaw - prevYaw), Math.cos(this.yaw - prevYaw)) / Math.max(dt, 1e-3);
    // locomotion clip + speed sync
    if (this.state === 'ground' && !['JumpUp', 'Land', 'RollLand', 'PoundLand', 'Dash', 'Mantle', 'Vault'].includes(this.anim.base)) {
      const clip = this.locoClip();
      const speed = clip === 'Idle' ? 1 : Math.max(0.6, hs / (clip === 'Sprint' ? TUNE.sprintSpeed : TUNE.runSpeed));
      this.anim.play(clip, { fade: 0.18, speed });
    }
    this.anim.setAim(this.aiming() && this.state !== 'mantle' && this.state !== 'vault');
    this.anim.aimPitch = this.camPitch + 0.12;
    const lv = this.localVel();
    this.anim.update(dt, { localVel: lv });
    // footsteps from the animation phase
    if (this.state === 'ground' && hs > 1) {
      const ph = this.anim.phase();
      const idx = ph < 0.5 ? 0 : 1;
      if (idx !== this.lastFootIdx) {
        this.lastFootIdx = idx;
        this.game.audio.sfx('footstep', { gain: Math.min(1, 0.25 + hs * 0.07), position: this.renderPos });
        if (hs > 7 && Math.random() < 0.5) this.game.vfx.dust(this.renderPos, 0.15);
      }
    }
    // lean into turns, tilt on walls
    let roll = 0, pitch = 0;
    if (this.state === 'ground' && !this.aiming()) roll = THREE.MathUtils.clamp(-turnRate * hs * 0.012, -0.28, 0.28);
    if (this.state === 'wallrun') roll = (this.wall.leftSide ? -1 : 1) * 0.42;
    if (this.state === 'ground' && hs > 1) pitch = Math.min(0.12, hs * 0.008);
    this.visual.position.copy(this.renderPos);
    const cur = this.visual.userData.roll || 0;
    const nr = cur + (roll - cur) * Math.min(1, dt * 8);
    this.visual.userData.roll = nr;
    this.visual.rotation.set(0, 0, 0);
    this.visual.rotateY(this.yaw);
    this.visual.rotateZ(nr);
    this.visual.rotateX(pitch * 0.5);
    if (this.self.has('floating') && this.state === 'air') this.visual.position.y += Math.sin(this.game.time * 3) * 0.05;
    // grind sparks under the feet
    if (this.state === 'grind' && Math.random() < dt * 30) this.game.vfx.impact(this.renderPos, UP, '#ffcf6a', 0.3);
    if (this.dashT > 0) this.game.vfx.trail(this.renderPos.clone().setY(this.renderPos.y + 1), '#fff0d0', 0.4, 0.25);
  }

  updateCamera(dt) {
    const game = this.game;
    const cam = game.render.camera;
    const L = game.lucidity.k;
    const aiming = this.aiming();
    const pivotTarget = this.renderPos.clone().add(new THREE.Vector3(0, this.state === 'slide' ? 1.35 : (aiming ? 1.85 : 2.0), 0));
    const follow = 1 - Math.exp(-dt * (16 - L * 9));
    this.camPivot.lerp(pivotTarget, follow);
    this.camPivot.y = THREE.MathUtils.lerp(this.camPivot.y, pivotTarget.y, 1 - Math.exp(-dt * 10));
    const f = this.camForward(new THREE.Vector3());
    const left = this.flatLeft(new THREE.Vector3());
    const hs = this.hspeed();
    const baseDist = (aiming ? 3.2 : 4.4) + Math.min(1.2, hs * 0.05) + (this.state === 'grind' ? 0.8 : 0);
    this.camDist += (baseDist - this.camDist) * Math.min(1, dt * 5);
    const shoulderAmt = (aiming ? 0.85 : 0.55) * this.shoulder;
    const pivot = this.camPivot.clone().addScaledVector(left, -shoulderAmt);
    // lucid dolly zoom: fov breathes while the distance compensates
    const baseFov = 72 + Math.min(9, hs * 0.55) + this.fovKick * 8;
    const dolly = L > 0.55 ? Math.sin(game.time * 0.9) * 18 * (L - 0.55) / 0.45 : 0;
    const fov = baseFov + dolly;
    const comp = Math.tan(THREE.MathUtils.degToRad(baseFov / 2)) / Math.tan(THREE.MathUtils.degToRad(fov / 2));
    let dist = this.camDist * comp;
    // collision: terrain pulls the camera in; walls/props between us fade out instead
    const back = f.clone().negate();
    const hit = game.physics.sphereCast(pivot, back, 0.28, dist, G.WORLD);
    if (hit) dist = Math.max(0.6, hit.dist - 0.05);
    const pos = pivot.clone().addScaledVector(back, dist);
    // fade occluders
    const seen = new Set();
    const toCam = pos.clone().sub(pivot);
    const L2 = toCam.length();
    game.physics.world.intersectionsWithRay(new RAPIER.Ray(pivot, toCam.normalize()), L2, true, (h) => {
      const e = game.physics.ownerOf(h.collider);
      if (e && e !== this && e.obj && e.kind !== 'boss') seen.add(e);
      return true;
    }, undefined, groups(ALL, G.WALL | G.PROP | G.WORLD | G.ENEMY));
    for (const e of seen) this.faded.set(e, 0.25);
    for (const [e, v] of this.faded) {
      const target = seen.has(e) ? 0.22 : 1;
      const nv = v + (target - v) * Math.min(1, dt * 10);
      if (!seen.has(e) && nv > 0.98) { this.setFade(e, 1); this.faded.delete(e); continue; }
      this.faded.set(e, nv);
      this.setFade(e, nv);
    }
    // shake (trauma^2)
    const tr = game.vfx.shake;
    game.vfx.shake = Math.max(0, tr - dt * 1.4);
    const s = tr * tr;
    const t = game.time * 30;
    const sx = (Math.sin(t * 1.1) + Math.sin(t * 2.3) * 0.5) * s * 0.25;
    const sy = (Math.sin(t * 1.7 + 3) + Math.sin(t * 2.9) * 0.5) * s * 0.25;
    cam.position.copy(pos).add(new THREE.Vector3(sx * left.x, sy, sx * left.z));
    // roll: wallrun tilt + lucid sway + drowsiness
    const rollT = (this.state === 'wallrun' ? (this.wall.leftSide ? 1 : -1) * 0.14 : 0) + Math.sin(game.time * 0.5) * 0.05 * L * L + (this.drowsy > 0 ? Math.sin(game.time * 1.3) * 0.08 : 0);
    this.roll += (rollT - this.roll) * Math.min(1, dt * 6);
    const target = pivot.clone().addScaledVector(f, 30);
    cam.up.set(0, 1, 0);
    cam.lookAt(target);
    cam.rotateZ(this.roll + (Math.sin(t * 0.9) * s * 0.03));
    cam.fov = fov;
    cam.updateProjectionMatrix();
  }

  setFade(e, v) {
    e.obj.traverse((o) => {
      if (!o.isMesh) return;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) {
        if (m.userData.fadeBase === undefined) m.userData.fadeBase = { t: m.transparent, o: m.opacity, dw: m.depthWrite };
        const b = m.userData.fadeBase;
        if (v >= 0.99) { m.transparent = b.t; m.opacity = b.o; m.depthWrite = b.dw; }
        else { m.transparent = true; m.opacity = b.o * v; m.depthWrite = false; }
      }
    });
  }

  updateAim() {
    const game = this.game;
    const cam = game.render.camera;
    const f = new THREE.Vector3();
    cam.getWorldDirection(f);
    // start the ray at the pivot plane so nothing behind the player is hit
    const start = cam.position.clone().addScaledVector(f, cam.position.distanceTo(this.camPivot) * 0.9);
    const mask = ALL & ~G.PLAYER & ~G.DEBRIS;
    let hit = game.physics.ray(start, f, 300, mask);
    this.aimEntity = null;
    if (hit) {
      this.aimPoint.copy(hit.point); this.aimNormal.copy(hit.normal);
      this.aimEntity = hit.entity && !hit.entity.immutable ? hit.entity : null;
    } else {
      this.aimPoint.copy(start).addScaledVector(f, 300); this.aimNormal.set(0, 1, 0);
    }
    // aim assist: a fat ray for take/give targets
    if (!this.aimEntity) {
      const s = game.physics.sphereCast(start, f, 0.55, hit ? hit.dist : 80, G.PROP | G.ENEMY | G.WALL);
      if (s && s.entity && !s.entity.immutable) this.aimEntity = s.entity;
    }
    // ghosts (hollow things) can still be targeted
    if (!this.aimEntity) {
      const gh = game.physics.ray(start, f, hit ? hit.dist : 80, G.GHOST);
      if (gh && gh.entity) { this.aimEntity = gh.entity; }
    }
  }

  updateDecoys(dt) {
    for (const d of this.decoys) {
      if (d.dead) continue;
      d.t -= dt;
      d.dir += (Math.random() - 0.5) * dt * 2;
      d.pos.x += Math.sin(d.dir) * 6 * dt; d.pos.z += Math.cos(d.dir) * 6 * dt;
      const g = this.game.physics.ray({ x: d.pos.x, y: d.pos.y + 3, z: d.pos.z }, { x: 0, y: -1, z: 0 }, 10, G.WORLD);
      if (g) d.pos.y = g.point.y;
      d.grp.position.copy(d.pos);
      d.grp.rotation.y = d.dir;
      d.anim.update(dt, { localVel: { x: 0, y: 0, z: 6 } });
      if (d.t <= 0) { d.dead = true; d.grp.parent?.remove(d.grp); this.game.vfx.propertyBurst(d.pos.clone().setY(d.pos.y + 1), 'multiplying', 0.6); }
    }
    this.decoys = this.decoys.filter((d) => !d.dead);
  }

  dispose() {
    this.game.physics.remove(this.body);
    this.game.physics.world.removeCharacterController(this.kcc);
    this.visual.parent?.remove(this.visual);
    for (const d of this.decoys) d.grp.parent?.remove(d.grp);
    for (const [e] of this.faded) this.setFade(e, 1);
  }
}
