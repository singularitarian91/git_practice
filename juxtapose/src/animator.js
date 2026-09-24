// Two-layer animation system for the Figment (lower body = locomotion,
// upper body = locomotion or an overlay such as aim/fire/reload), with
// crossfades, phase-synced locomotion switches and procedural additives
// (aim pitch, scarf physics, hovering apple, recoil).
import * as THREE from 'three';

const UPPER = new Set(['chest', 'neck', 'head', 'upperarmL', 'forearmL', 'handL', 'upperarmR', 'forearmR', 'handR',
  'gun', 'gunHammer', 'gunCylinder', 'gunBreak', 'gunVial', 'gunBlade']);
const LOWER = new Set(['hips', 'spine', 'thighL', 'shinL', 'footL', 'thighR', 'shinR', 'footR']);
const LOCO = new Set(['Idle', 'Run', 'Sprint', 'StrafeL', 'StrafeR', 'RunBack', 'WallRunL', 'WallRunR', 'Grind', 'Slide', 'Fall', 'PoundFall', 'DownStrike', 'Focus', 'Guard']);

function splitClip(clip, set, suffix) {
  const tracks = clip.tracks.filter((t) => {
    const [node, prop] = t.name.split('.');
    return set.has(node) && prop !== 'scale';
  });
  return new THREE.AnimationClip(clip.name + suffix, clip.duration, tracks);
}

const _q = new THREE.Quaternion();
const _rq = new THREE.Quaternion(), _pq = new THREE.Quaternion(), _sq = new THREE.Quaternion(), _e2 = new THREE.Euler();
const _e = new THREE.Euler();
const X = new THREE.Vector3(1, 0, 0);

export class FigureAnimator {
  constructor(root, clips) {
    this.root = root;
    this.mixer = new THREE.AnimationMixer(root);
    this.clips = {};
    this.lower = {}; this.upper = {};
    for (const c of clips) {
      this.clips[c.name] = c;
      this.lower[c.name] = this.mixer.clipAction(splitClip(c, LOWER, '_lo'));
      this.upper[c.name] = this.mixer.clipAction(splitClip(c, UPPER, '_up'));
    }
    this.bones = {};
    root.traverse((o) => { if (o.name) this.bones[o.name] = o; });
    this.appleRest = this.bones.appleFace ? this.bones.appleFace.position.clone() : null;
    this.base = null; this.baseLock = false;
    this.curLower = null; this.curUpper = null;
    this.overlay = null; this.overlayDone = null;
    this.aim = false;
    this.aimWeight = 0;
    this.aimPitch = 0;
    this.recoil = 0;
    this.scarf = [0, 0, 0];
    this.scarfVel = [0, 0, 0];
    this.time = 0;
    this.mixer.addEventListener('finished', (e) => this._finished(e.action));
  }

  _switch(layer, action, fade, syncFrom) {
    const cur = layer === 'lo' ? this.curLower : this.curUpper;
    if (cur === action) return;
    action.enabled = true;
    action.paused = false;
    action.setEffectiveTimeScale(action.userData?.speed ?? 1);
    if (syncFrom && action.loop !== THREE.LoopOnce) {
      const k = (syncFrom.time / syncFrom.getClip().duration) % 1;
      action.time = k * action.getClip().duration;
    } else if (!syncFrom) {
      action.time = 0;
    }
    action.setEffectiveWeight(1);
    action.play();
    if (cur) { action.fadeIn(fade); cur.fadeOut(fade); }
    if (layer === 'lo') this.curLower = action; else this.curUpper = action;
  }

  // Base (full-body) state. opts: fade, once, speed, lockUpper, onDone, restart
  play(name, opts = {}) {
    if (!this.lower[name]) return;
    const fade = opts.fade ?? 0.16;
    const lo = this.lower[name], up = this.upper[name];
    const once = opts.once ?? !LOCO.has(name);
    for (const a of [lo, up]) {
      a.setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat, once ? 1 : Infinity);
      a.clampWhenFinished = once;
      a.userData = { speed: opts.speed ?? 1 };
    }
    const same = this.base === name;
    if (same && !opts.restart) {
      lo.setEffectiveTimeScale(opts.speed ?? 1);
      if (this.curUpper === up) up.setEffectiveTimeScale(opts.speed ?? 1);
      return;
    }
    const sync = LOCO.has(name) && LOCO.has(this.base) ? this.curLower : null;
    if (same && opts.restart) { lo.reset(); up.reset(); }
    const prevBase = this.base;
    this.base = name;
    this.baseLock = !!opts.lockUpper;
    this.baseDone = opts.onDone || null;
    if (!sync) { lo.reset(); }
    this._switch('lo', lo, fade, sync);
    if (this.baseLock) { this.overlay = null; this._switch('up', up, fade, sync); }
    else if (!this.overlay) this._switch('up', this.aim ? this.upper.AimIdle : up, fade, this.aim ? null : sync);
    if (prevBase === name && opts.restart) { lo.time = 0; up.time = 0; }
  }

  // Upper-body one-shot overlay (fire, reload, ...)
  trigger(name, opts = {}) {
    if (this.baseLock || !this.upper[name]) return false;
    const a = this.upper[name];
    a.setLoop(THREE.LoopOnce, 1);
    a.clampWhenFinished = true;
    a.userData = { speed: opts.speed ?? 1 };
    a.reset();
    this.overlay = name;
    this.overlayDone = opts.onDone || null;
    if (this.curUpper === a) { a.reset().play(); return true; }
    this._switch('up', a, opts.fade ?? 0.06, null);
    return true;
  }

  cancelOverlay() {
    if (!this.overlay) return;
    this.overlay = null;
    this._restoreUpper(0.12);
  }

  setGuard(on) {
    if (this.guard === on) return;
    this.guard = on;
    if (!this.overlay && !this.baseLock) this._restoreUpper(0.1);
  }

  setAim(on) {
    if (this.aim === on) return;
    this.aim = on;
    if (!this.overlay && !this.baseLock) this._restoreUpper(0.18);
  }

  _restoreUpper(fade) {
    const target = this.guard ? this.upper.Guard : this.aim ? this.upper.AimIdle : this.upper[this.base];
    if (!target) return;
    const once = !LOCO.has(this.base) && !this.aim && !this.guard;
    target.setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat, once ? 1 : Infinity);
    target.clampWhenFinished = once;
    this._switch('up', target, fade, this.aim ? null : this.curLower);
  }

  _finished(action) {
    if (this.overlay && action === this.upper[this.overlay]) {
      const cb = this.overlayDone;
      this.overlay = null; this.overlayDone = null;
      this._restoreUpper(0.14);
      cb && cb();
      return;
    }
    if (action === this.curLower && this.baseDone) {
      const cb = this.baseDone; this.baseDone = null; cb();
    }
  }

  // phase of the base locomotion clip (0..1) - used for footstep timing
  phase() {
    if (!this.curLower) return 0;
    return (this.curLower.time / this.curLower.getClip().duration) % 1;
  }

  update(dt, ctx = {}) {
    this.time += dt;
    this.mixer.update(dt);
    const b = this.bones;
    // aim pitch: bend chest + arms toward the crosshair
    this.aimWeight += ((this.aim || this.overlay ? 1 : 0) - this.aimWeight) * Math.min(1, dt * 10);
    const pitch = this.aimPitch * this.aimWeight;
    if (b.chest) b.chest.quaternion.premultiply(_q.setFromAxisAngle(X, -pitch * 0.35));
    if (b.upperarmR) b.upperarmR.quaternion.premultiply(_q.setFromAxisAngle(X, -pitch * 0.65));
    if (b.upperarmL) b.upperarmL.quaternion.premultiply(_q.setFromAxisAngle(X, -pitch * 0.65));
    if (b.head) b.head.quaternion.premultiply(_q.setFromAxisAngle(X, -this.aimPitch * 0.3));
    // recoil kick on top of whatever is playing
    if (this.recoil > 0.001 && b.handR) {
      b.handR.quaternion.premultiply(_q.setFromAxisAngle(X, -this.recoil * 0.5));
      this.recoil *= Math.exp(-dt * 16);
    }
    // scarf: damped springs driven by body velocity + acceleration
    const v = ctx.localVel || { x: 0, y: 0, z: 0 };
    const targets = [
      THREE.MathUtils.clamp(-v.z * 0.1 + v.y * 0.04, -1.3, 0.3) - 0.1 + Math.sin(this.time * 7) * 0.05 * (0.3 + Math.abs(v.z) * 0.1),
      THREE.MathUtils.clamp(-v.z * 0.06, -0.8, 0.3) + Math.sin(this.time * 9 + 1) * 0.08,
      THREE.MathUtils.clamp(-v.z * 0.05, -0.6, 0.3) + Math.sin(this.time * 11 + 2) * 0.12,
    ];
    for (let i = 0; i < 3; i++) {
      const k = 60, d = 8;
      this.scarfVel[i] += ((targets[i] - this.scarf[i]) * k - this.scarfVel[i] * d) * dt;
      this.scarf[i] += this.scarfVel[i] * dt;
      const bone = b['scarf' + (i + 1)];
      if (bone) bone.quaternion.setFromEuler(_e.set(-this.scarf[i] * 1.2, 0, Math.sin(this.time * 5 + i) * 0.06 * (1 + Math.abs(v.x) * 0.1)));
    }
    // the oversize coat: hem panels and sleeve bags hang along the body's vertical
    // (gravity), trail behind motion on damped springs, and clear the thighs as they swing
    if (!this.coat) {
      this.coat = [];
      for (const n of ['coatBackL1', 'coatBackR1', 'coatBackL2', 'coatBackR2', 'coatSideL1', 'coatSideR1', 'sleeveL1', 'sleeveR1']) {
        const o = b[n];
        if (!o) continue;
        const L = /L\d$/.test(n);
        this.coat.push({ o, n, sign: L ? 1 : -1, thigh: b[L ? 'thighL' : 'thighR'], kind: n.replace(/[LR]\d$/, '') + n.slice(-1), x: 0, vx: 0, z: 0, vz: 0 });
      }
      this.coatByName = Object.fromEntries(this.coat.map((c) => [c.n, c]));
    }
    const trail = THREE.MathUtils.clamp(v.z * 0.12 - v.y * 0.03, -0.2, 1.3); // localVel.z is forward here
    const flutter = Math.min(1, Math.hypot(v.x, v.z) * 0.1);
    this.root.getWorldQuaternion(_rq);
    for (const c of this.coat) {
      let tx = 0, tz = 0, grav = 1;
      const th = c.thigh ? _e2.setFromQuaternion(c.thigh.quaternion) : null;
      if (c.kind === 'coatBack1') tx = Math.max(trail, 0.85 * Math.max(0, th ? th.x : 0));
      else if (c.kind === 'coatSide1') { tx = 0.7 * trail; tz = c.sign * (0.07 + Math.max(0, c.sign * (th ? th.z : 0)) + v.x * 0.05); }
      else if (c.kind === 'coatBack2') { grav = 0; tx = 0.3 * (this.coatByName[c.n.replace('2', '1')]?.x || 0) + 0.15 * trail; }
      else { grav = 0.35; tx = 0.5 * trail; }
      tx += Math.sin(this.time * 6 + c.sign + (grav ? 0 : 1)) * 0.04 * flutter;
      c.vx += ((tx - c.x) * 40 - c.vx * 7) * dt; c.x += c.vx * dt;
      c.vz += ((tz - c.z) * 40 - c.vz * 7) * dt; c.z += c.vz * dt;
      _sq.setFromEuler(_e.set(c.x, 0, c.z));
      if (grav > 0) { c.o.parent.getWorldQuaternion(_pq).invert().multiply(_rq); c.o.quaternion.identity().slerp(_pq, grav).multiply(_sq); }
      else c.o.quaternion.copy(_sq);
    }
    // the apple hovers in front of the face
    if (b.appleFace) {
      b.appleFace.position.copy(this.appleRest);
      b.appleFace.position.y += Math.sin(this.time * 1.7) * 0.012;
      b.appleFace.rotation.y = Math.sin(this.time * 0.6) * 0.5;
    }
  }
}
