// Cutscenes: short letterboxed camera moves the dream uses to show you something
// (the valley on arrival, a memory coming back, a way opening, the door). The
// world holds still while they play. Every shot stays up long enough to read its
// caption; Space, Enter or a click moves on to the next shot, Escape skips the
// rest, and anything a skipped shot would have started still happens.
import * as THREE from 'three';

const ease = (k) => k * k * (3 - 2 * k);
// how long a caption needs on screen: a comfortable reading pace, plus a breath
export const readTime = (text) => (text ? 2.2 + text.length / 11 : 0);
const val = (v, k) => (typeof v === 'function' ? v(k) : Array.isArray(v) ? v[0].clone().lerp(v[1], ease(k)) : v);

export class Cutscene {
  // shots: [{ dur, pos, look, fov, caption, at(), tick(dt, k), end() }]
  //   pos / look: Vector3, [from, to] (eased), or (k) => Vector3
  constructor(game, shots, { onEnd } = {}) {
    this.game = game;
    this.shots = shots.filter(Boolean);
    // never cut away from a line before it can be read; the camera move stretches to fit
    for (const s of this.shots) s.dur = Math.max(s.dur, readTime(s.caption));
    this.onEnd = onEnd;
    this.i = -1; this.t = 0; this.total = 0;
    this.next();
  }
  next() {
    if (this.i >= 0) this.shots[this.i].end?.();
    this.i++; this.t = 0; this.shotT = 0;
    const s = this.shots[this.i];
    if (!s) return;
    s.at?.();
    this.game.ui.cutCaption(s.caption || '');
  }
  get done() { return this.i >= this.shots.length; }
  update(dt, input) {
    this.total += dt;
    this.shotT = (this.shotT || 0) + dt;
    if (this.total > 0.6 && input.hit('pause')) { this.skip(); return; }
    // next shot (the camera jumps to where it would have ended)
    if (this.shotT > 0.5 && (input.hit('jump') || input.click(0) || input.pressed?.has('Enter'))) { this.next(); return; }
    const s = this.shots[this.i];
    if (!s) return;
    this.t += dt;
    const k = Math.min(1, this.t / s.dur);
    const cam = this.game.render.camera;
    cam.position.copy(val(s.pos, k));
    cam.up.set(0, 1, 0);
    cam.lookAt(val(s.look, k));
    const fov = s.fov ? (Array.isArray(s.fov) ? s.fov[0] + (s.fov[1] - s.fov[0]) * ease(k) : s.fov) : 55;
    if (cam.fov !== fov) { cam.fov = fov; cam.updateProjectionMatrix(); }
    s.tick?.(dt, k);
    if (k >= 1) this.next();
  }
  // run what the remaining shots would have started, then finish
  skip() {
    while (!this.done) this.next();
  }
}

// camera helpers for shot paths
export const orbit = (c, r, h, a0, a1) => (k) => new THREE.Vector3(c.x + Math.cos(a0 + (a1 - a0) * ease(k)) * r, c.y + h, c.z + Math.sin(a0 + (a1 - a0) * ease(k)) * r);
