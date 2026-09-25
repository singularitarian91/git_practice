// Cutscenes: short letterboxed camera moves the dream uses to show you something
// (the valley on arrival, a memory coming back, a way opening, the door). The
// world holds still while they play; Space, Escape or a click skips to the end,
// and anything a skipped shot would have started still happens.
import * as THREE from 'three';

const ease = (k) => k * k * (3 - 2 * k);
const val = (v, k) => (typeof v === 'function' ? v(k) : Array.isArray(v) ? v[0].clone().lerp(v[1], ease(k)) : v);

export class Cutscene {
  // shots: [{ dur, pos, look, fov, caption, at(), tick(dt, k), end() }]
  //   pos / look: Vector3, [from, to] (eased), or (k) => Vector3
  constructor(game, shots, { onEnd } = {}) {
    this.game = game;
    this.shots = shots.filter(Boolean);
    this.onEnd = onEnd;
    this.i = -1; this.t = 0; this.total = 0;
    this.next();
  }
  next() {
    if (this.i >= 0) this.shots[this.i].end?.();
    this.i++; this.t = 0;
    const s = this.shots[this.i];
    if (!s) return;
    s.at?.();
    this.game.ui.cutCaption(s.caption || '');
  }
  get done() { return this.i >= this.shots.length; }
  update(dt, input) {
    this.total += dt;
    if (this.total > 0.6 && (input.hit('jump') || input.hit('pause') || input.click(0))) { this.skip(); return; }
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
