// Scene lights: hemisphere + a shadow-casting sun/moon that follows the
// player, and a small pool of point lights handed to the nearest fires.
import * as THREE from 'three';
import { MAX_HALOS } from './post.js';

export class Lighting {
  constructor(scene, { poolSize = 6, shadowSize = 2048, shadowExtent = 42 } = {}) {
    this.scene = scene;
    this.hemi = new THREE.HemisphereLight(0xffffff, 0x222222, 1);
    scene.add(this.hemi);

    const sun = new THREE.DirectionalLight(0xffffff, 1);
    sun.castShadow = true;
    sun.shadow.mapSize.set(shadowSize, shadowSize);
    const c = sun.shadow.camera;
    c.left = -shadowExtent; c.right = shadowExtent; c.top = shadowExtent; c.bottom = -shadowExtent;
    c.near = 1; c.far = 220;
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.045;
    this.sun = sun;
    this.shadowExtent = shadowExtent;
    this.shadowSize = shadowSize;
    scene.add(sun, sun.target);

    this.pool = [];
    for (let i = 0; i < poolSize; i++) {
      const p = new THREE.PointLight(0xffaa55, 0, 14, 1.6);
      p.castShadow = false;
      scene.add(p);
      this.pool.push(p);
    }
    this.sources = new Set();
    this._arr = [];
    this.halos = [];
    this.time = 0;
    this._basis = { x: new THREE.Vector3(), y: new THREE.Vector3(), z: new THREE.Vector3() };
  }

  // A light source in the world (torch, brazier, window, hearth, lantern…)
  // { pos: Vector3, color: Color, intensity, radius, flicker (0..1), halo (0..1), enabled }
  add(src) {
    const s = {
      pos: src.pos.clone(), color: new THREE.Color(src.color ?? 0xff9a40), intensity: src.intensity ?? 6,
      radius: src.radius ?? 10, flicker: src.flicker ?? 0.6, halo: src.halo ?? 1, enabled: src.enabled ?? true,
      nightOnly: src.nightOnly ?? false, seed: Math.random() * 100, safe: src.safe ?? 0, current: 0,
    };
    this.sources.add(s);
    return s;
  }

  remove(s) { this.sources.delete(s); }

  // Called once per frame.
  update(dt, focus, camera, atmo) {
    this.time += dt;
    const t = this.time;
    // hemisphere + sun/moon from the atmosphere state
    this.hemi.color.copy(atmo.hemiSky);
    this.hemi.groundColor.copy(atmo.hemiGround);
    this.hemi.intensity = atmo.hemiIntensity;
    this.sun.color.copy(atmo.lightColor);
    this.sun.intensity = atmo.lightIntensity;
    this.sun.shadow.intensity = 1 - 0.5 * atmo.darkness; // moonlight casts soft shadows

    // place the shadow camera around the focus, snapped to shadow texels
    const dir = atmo.lightDir;
    const B = this._basis;
    B.z.copy(dir).normalize();
    B.x.set(0, 1, 0).cross(B.z);
    if (B.x.lengthSq() < 1e-6) B.x.set(1, 0, 0);
    B.x.normalize();
    B.y.copy(B.z).cross(B.x).normalize();
    const texel = (this.shadowExtent * 2) / this.shadowSize;
    const fx = Math.round(focus.dot(B.x) / texel) * texel;
    const fy = Math.round(focus.dot(B.y) / texel) * texel;
    const fz = focus.dot(B.z);
    const snapped = new THREE.Vector3().addScaledVector(B.x, fx).addScaledVector(B.y, fy).addScaledVector(B.z, fz);
    this.sun.target.position.copy(snapped);
    this.sun.position.copy(snapped).addScaledVector(dir, 100);
    this.sun.target.updateMatrixWorld();

    // flicker + night-only gating, then pick the nearest sources for the pool
    const arr = this._arr;
    arr.length = 0;
    for (const s of this.sources) {
      if (!s.enabled) { s.current = 0; continue; }
      const gate = s.nightOnly ? Math.max(0, Math.min(1, atmo.darkness * 1.6 - 0.1)) : 1;
      const fl = 1 - s.flicker * (0.12 * Math.sin(t * 9.1 + s.seed) + 0.08 * Math.sin(t * 23.7 + s.seed * 2.3) + 0.06 * Math.sin(t * 3.3 + s.seed * 0.7));
      s.current = s.intensity * fl * gate;
      s._d = s.pos.distanceToSquared(focus);
      if (s.current > 0.01) arr.push(s);
    }
    arr.sort((a, b) => a._d - b._d);
    for (let i = 0; i < this.pool.length; i++) {
      const L = this.pool[i];
      const s = arr[i];
      if (s && s._d < 60 * 60) {
        L.position.copy(s.pos);
        L.color.copy(s.color);
        // fade out at the edge of the pool's reach to avoid popping
        const fade = 1 - Math.min(1, Math.max(0, (Math.sqrt(s._d) - 40) / 20));
        L.intensity = s.current * fade;
        L.distance = s.radius * 1.6;
      } else {
        L.intensity = 0;
      }
    }
    // halos in the fog (nearest to the camera, only when darker)
    const halos = this.halos;
    halos.length = 0;
    const camPos = camera.position;
    const hs = arr.filter((s) => s.halo > 0).sort((a, b) => a.pos.distanceToSquared(camPos) - b.pos.distanceToSquared(camPos));
    for (let i = 0; i < Math.min(MAX_HALOS, hs.length); i++) {
      const s = hs[i];
      halos.push({ pos: s.pos, color: s.color, intensity: s.current * s.halo * (0.15 + atmo.darkness * 0.35), radius: 0.9 + s.radius * 0.1 });
    }
    return halos;
  }

  // Is a world point inside any lit fire's safe radius? (the Gloam avoids light)
  safeAt(x, z) {
    for (const s of this.sources) {
      if (!s.enabled || !s.safe) continue;
      const dx = s.pos.x - x, dz = s.pos.z - z;
      if (dx * dx + dz * dz < s.safe * s.safe) return true;
    }
    return false;
  }
}
