// Photo mode: the dream holds still while a free camera wanders through it.
// Entered with P (or from the pause menu); Esc leaves and puts everything back.
import * as THREE from 'three';
import { LAYERS } from './config.js';

const $ = (s) => document.querySelector(s);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const FMT = { exp: (v) => v.toFixed(2), vig: (v) => v.toFixed(2), grain: (v) => v.toFixed(3), fov: (v) => `${Math.round(v)}°` };

export class PhotoMode {
  constructor(game) {
    this.game = game;
    this.active = false;
    this.app = $('#app');
    this.panel = $('#photo-panel');
    this.flashEl = $('#photo-flash');
    this.note = this.panel.querySelector('.pp-note');
    this.ctl = { exp: $('#ph-exp'), vig: $('#ph-vig'), grain: $('#ph-grain'), fov: $('#ph-fov') };
    this.yaw = 0; this.pitch = 0;
    this.vel = new THREE.Vector3();
    this.look = { x: 0, y: 0 };
    this.drag = false;
    this.shots = 0;
    for (const [k, el] of Object.entries(this.ctl)) {
      el.addEventListener('input', () => this.set(k, +el.value));
      el.addEventListener('pointerup', () => el.blur()); // hand the keys back to the camera
    }
    $('#ph-shoot').addEventListener('click', () => this.capture());
    $('#ph-reset').addEventListener('click', () => this.resetView());
    $('#ph-exit').addEventListener('click', () => this.exit());
    // drag on the dream to look around (no pointer lock, so Esc always reaches us)
    const canvas = game.render.renderer.domElement;
    canvas.addEventListener('mousedown', () => { if (this.active) { this.drag = true; this.app.classList.add('dragging'); } });
    window.addEventListener('mouseup', () => { if (this.drag) { this.drag = false; this.app.classList.remove('dragging'); } });
    window.addEventListener('mousemove', (e) => { if (this.active && this.drag) { this.look.x += e.movementX; this.look.y += e.movementY; } });
  }

  enter() {
    const g = this.game;
    if (this.active || (g.state !== 'playing' && g.state !== 'paused') || !g.player) return false;
    const r = g.render, cam = r.camera, du = r.dream.uniforms;
    if (g.ui.wheelOpen) g.ui.closeWheel();
    this.saved = {
      state: g.state, hud: !g.ui.hud.hidden,
      pos: cam.position.clone(), quat: cam.quaternion.clone(), up: cam.up.clone(), fov: cam.fov,
      exposure: r.renderer.toneMappingExposure,
      u: { uVignette: du.uVignette.value, uGrain: du.uGrain.value, uHurt: du.uHurt.value, uSlowmo: du.uSlowmo.value, uLowHp: du.uLowHp.value },
    };
    this.active = true;
    g.state = 'photo';
    g.ui.hideScreens();
    g.ui.setHud(false);
    this.app.classList.add('photo');
    // a clean frame: no hurt flash, no slow-motion tint, no heartbeat
    du.uHurt.value = 0; du.uSlowmo.value = 0; du.uLowHp.value = 0;
    g.input.exitLock();
    g.input.takeLook(); g.input.takeWheel();
    const e = new THREE.Euler().setFromQuaternion(cam.quaternion, 'YXZ');
    this.yaw = e.y; this.pitch = e.x;
    this.start = { pos: cam.position.clone(), yaw: e.y, pitch: e.x, fov: cam.fov };
    this.vel.set(0, 0, 0);
    cam.up.set(0, 1, 0);
    this.orient();
    this.syncControls();
    this.panel.hidden = false;
    this.note.textContent = '';
    g.ui.settle(this.panel);
    return true;
  }

  exit() {
    if (!this.active) return;
    const g = this.game, r = g.render, cam = r.camera, du = r.dream.uniforms, S = this.saved;
    cam.position.copy(S.pos); cam.quaternion.copy(S.quat); cam.up.copy(S.up);
    cam.fov = S.fov; cam.updateProjectionMatrix(); cam.updateMatrixWorld();
    r.renderer.toneMappingExposure = S.exposure;
    for (const [k, v] of Object.entries(S.u)) du[k].value = v;
    this.active = false;
    this.drag = false;
    this.panel.hidden = true;
    this.app.classList.remove('photo', 'dragging');
    const a = document.activeElement;
    if (a && this.panel.contains(a)) a.blur();
    g.input.takeLook(); g.input.takeWheel(); g.input.pressed.clear();
    g.state = S.state;
    g.ui.setHud(S.hud);
    if (S.state === 'paused') { g.ui.renderPauseSummary(); g.ui.show('pause'); return; }
    // Esc is not a gesture the browser will lock the pointer for: if the lock is
    // refused, wait on the pause menu rather than run with a loose cursor
    g.input.requestLock({ soft: true, onFail: () => { if (g.state === 'playing' && !g.input.lockFailed && !g.input.locked) g.pause(); } });
  }

  set(k, v) {
    const r = this.game.render, du = r.dream.uniforms;
    if (k === 'exp') r.renderer.toneMappingExposure = v;
    else if (k === 'vig') du.uVignette.value = v;
    else if (k === 'grain') du.uGrain.value = v;
    else if (k === 'fov') { r.camera.fov = v; r.camera.updateProjectionMatrix(); }
    const el = this.ctl[k];
    if (+el.value !== v) el.value = v;
    const out = el.parentNode.querySelector('output');
    if (out) out.textContent = FMT[k](v);
  }
  syncControls() {
    const r = this.game.render, du = r.dream.uniforms;
    this.set('exp', r.renderer.toneMappingExposure);
    this.set('vig', du.uVignette.value);
    this.set('grain', du.uGrain.value);
    this.set('fov', r.camera.fov);
  }

  resetView() {
    if (!this.active) return;
    const cam = this.game.render.camera;
    cam.position.copy(this.start.pos);
    this.yaw = this.start.yaw; this.pitch = this.start.pitch;
    this.vel.set(0, 0, 0);
    this.set('fov', this.start.fov);
    this.orient();
  }

  orient() {
    const cam = this.game.render.camera;
    cam.quaternion.setFromEuler(new THREE.Euler(this.pitch, this.yaw, 0, 'YXZ'));
    cam.updateMatrixWorld();
  }

  update(dt, input) {
    const g = this.game, cam = g.render.camera;
    const P = input.pressed, D = input.down;
    if (P.has('Escape') || P.has('KeyP')) { this.exit(); return; }
    if (P.has('KeyC')) this.capture();
    if (P.has('KeyH')) this.panel.hidden = !this.panel.hidden;
    if (P.has('KeyR')) this.resetView();
    // look: drag with the mouse, or the arrow keys (unless a slider has them)
    const zoomK = cam.fov / 72;
    const sens = 0.0022 * (g.opts?.sens ?? 1) * zoomK;
    this.yaw -= this.look.x * sens;
    this.pitch -= this.look.y * sens * (g.opts?.invert ? -1 : 1);
    this.look.x = this.look.y = 0;
    const a = document.activeElement;
    if (!(a && a.tagName === 'INPUT')) {
      const ks = dt * 1.3 * zoomK;
      if (D.has('ArrowLeft')) this.yaw += ks;
      if (D.has('ArrowRight')) this.yaw -= ks;
      if (D.has('ArrowUp')) this.pitch += ks;
      if (D.has('ArrowDown')) this.pitch -= ks;
    }
    this.pitch = clamp(this.pitch, -1.5, 1.5);
    this.orient();
    // fly: WASD along the view, Q/E down and up, Shift to hurry
    const f = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
    const rt = new THREE.Vector3(1, 0, 0).applyQuaternion(cam.quaternion);
    const want = new THREE.Vector3();
    if (D.has('KeyW')) want.add(f);
    if (D.has('KeyS')) want.sub(f);
    if (D.has('KeyD')) want.add(rt);
    if (D.has('KeyA')) want.sub(rt);
    if (D.has('KeyE') || D.has('Space')) want.y += 1;
    if (D.has('KeyQ')) want.y -= 1;
    if (want.lengthSq() > 0) want.normalize().multiplyScalar(D.has('ShiftLeft') || D.has('ShiftRight') ? 16 : 4.5);
    this.vel.lerp(want, 1 - Math.exp(-dt * 8));
    cam.position.addScaledVector(this.vel, dt);
    // a leash, so the camera can't drift out of the dream entirely
    const pl = g.player;
    if (pl) {
      const d = cam.position.clone().sub(pl.pos);
      if (d.length() > 70) cam.position.copy(pl.pos).add(d.setLength(70));
    }
    const w = input.takeWheel();
    if (w) this.set('fov', clamp(cam.fov + w * 3, 15, 110));
    cam.updateMatrixWorld();
  }

  // where the sun's shadow frustum should look while the camera roams
  focus(out = new THREE.Vector3()) {
    const cam = this.game.render.camera;
    return out.set(0, 0, -12).applyQuaternion(cam.quaternion).add(cam.position);
  }

  capture() {
    if (!this.active) return;
    const g = this.game, r = g.render;
    try {
      g.portals?.beforeRender();
      r.render(); // no preserveDrawingBuffer: read the canvas in the same task we drew it
      const url = r.renderer.domElement.toDataURL('image/png');
      this.lastShot = url;
      const d = new Date();
      const p2 = (n) => String(n).padStart(2, '0');
      const where = g.sandbox ? 'lucid-room' : (LAYERS[g.depth]?.key || 'dream');
      const a = document.createElement('a');
      a.href = url;
      a.download = `juxtapose-${where}-${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}-${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}.png`;
      document.body.appendChild(a); a.click(); a.remove();
      this.shots++;
      this.note.textContent = this.shots === 1 ? 'Kept.' : `Kept. ${this.shots} so far.`;
      if (!g.opts?.reduceFlash) { this.flashEl.classList.remove('go'); void this.flashEl.offsetWidth; this.flashEl.classList.add('go'); }
      g.audio.sfx('uiSelect');
    } catch (err) {
      console.warn('photo mode: capture failed', err);
      this.note.textContent = 'The dream would not hold still.';
    }
  }
}
