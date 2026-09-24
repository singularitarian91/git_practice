// Two-layer animation system for the Figment (lower body = locomotion,
// upper body = locomotion or an overlay such as aim/fire/reload), with
// crossfades, phase-synced locomotion switches and procedural additives
// (aim pitch, scarf physics, hovering apple, recoil).
import * as THREE from 'three';

const UPPER = new Set(['chest', 'neck', 'head', 'upperarmL', 'forearmL', 'handL', 'upperarmR', 'forearmR', 'handR',
  'gun', 'gunHammer', 'gunCylinder', 'gunBreak', 'gunVial']);
const LOWER = new Set(['hips', 'spine', 'thighL', 'shinL', 'footL', 'thighR', 'shinR', 'footR']);
const LOCO = new Set(['Idle', 'Run', 'Sprint', 'StrafeL', 'StrafeR', 'RunBack', 'WallRunL', 'WallRunR', 'Grind', 'Slide', 'Fall', 'PoundFall']);

function splitClip(clip, set, suffix) {
  const tracks = clip.tracks.filter((t) => {
    const [node, prop] = t.name.split('.');
    return set.has(node) && prop !== 'scale';
  });
  return new THREE.AnimationClip(clip.name + suffix, clip.duration, tracks);
}

const _q = new THREE.Quaternion();
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

  setAim(on) {
    if (this.aim === on) return;
    this.aim = on;
    if (!this.overlay && !this.baseLock) this._restoreUpper(0.18);
  }

  _restoreUpper(fade) {
    const target = this.aim ? this.upper.AimIdle : this.upper[this.base];
    if (!target) return;
    const once = !LOCO.has(this.base) && !this.aim;
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
    // the apple hovers in front of the face
    if (b.appleFace) {
      b.appleFace.position.copy(this.appleRest);
      b.appleFace.position.y += Math.sin(this.time * 1.7) * 0.012;
      b.appleFace.rotation.y = Math.sin(this.time * 0.6) * 0.5;
    }
  }
}
