// Particles: fire, embers, smoke, debris bursts, sparkles, fireflies,
// rain and snow.  CPU-simulated, drawn as soft points in two batches
// (additive for glowing things, alpha-blended for everything else).
import * as THREE from 'three';

const VERT = /* glsl */`
  attribute float aSize;
  attribute vec4 aColor;
  attribute float aShape;
  varying vec4 vColor;
  varying float vShape;
  uniform float uScale;
  void main() {
    vColor = aColor;
    vShape = aShape;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = aSize * uScale / max(0.1, -mv.z);
  }
`;
const FRAG = /* glsl */`
  varying vec4 vColor;
  varying float vShape;
  void main() {
    vec2 p = gl_PointCoord - 0.5;
    float d = length(p) * 2.0;
    float a;
    if (vShape < 0.5) a = smoothstep(1.0, 0.0, d);                 // soft glow
    else if (vShape < 1.5) a = smoothstep(1.0, 0.55, d) * 0.9;       // puff
    else a = step(max(abs(p.x), abs(p.y)), 0.42);                    // square chip
    if (a < 0.01) discard;
    gl_FragColor = vec4(vColor.rgb, vColor.a * a);
  }
`;

class Batch {
  constructor(max, additive) {
    this.max = max;
    this.pos = new Float32Array(max * 3);
    this.col = new Float32Array(max * 4);
    this.size = new Float32Array(max);
    this.shape = new Float32Array(max);
    this.p = []; // live particles
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aColor', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aShape', new THREE.BufferAttribute(this.shape, 1).setUsage(THREE.DynamicDrawUsage));
    g.setDrawRange(0, 0);
    this.uniforms = { uScale: { value: 400 } };
    const m = new THREE.ShaderMaterial({
      uniforms: this.uniforms, vertexShader: VERT, fragmentShader: FRAG,
      transparent: true, depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(g, m);
    this.points.frustumCulled = false;
    this.points.renderOrder = additive ? 20 : 10;
  }

  // p: { x,y,z, vx,vy,vz, life, size, size1, r,g,b, a, a1, grav, drag, shape, spin, wob }
  add(p) {
    if (this.p.length >= this.max) this.p.shift();
    p.t = 0;
    this.p.push(p);
  }

  update(dt) {
    const arr = this.p;
    let w = 0;
    for (let i = 0; i < arr.length; i++) {
      const p = arr[i];
      p.t += dt;
      if (p.t >= p.life) continue;
      p.vy -= (p.grav || 0) * dt;
      const drag = p.drag || 0;
      if (drag) { const k = Math.exp(-drag * dt); p.vx *= k; p.vy *= k; p.vz *= k; }
      if (p.wob) { p.vx += Math.sin(p.t * 7 + p.seed) * p.wob * dt; p.vz += Math.cos(p.t * 6 + p.seed) * p.wob * dt; }
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      if (p.floor != null && p.y < p.floor) { p.y = p.floor; p.vy *= -0.3; p.vx *= 0.6; p.vz *= 0.6; }
      arr[w++] = p;
    }
    arr.length = w;
    for (let i = 0; i < w; i++) {
      const p = arr[i];
      const u = p.t / p.life;
      this.pos[i * 3] = p.x; this.pos[i * 3 + 1] = p.y; this.pos[i * 3 + 2] = p.z;
      const fadeIn = p.fadeIn ? Math.min(1, p.t / p.fadeIn) : 1;
      const a = (p.a1 != null ? p.a + (p.a1 - p.a) * u : p.a * (1 - u)) * fadeIn;
      const g = p.g1 != null ? p.g + (p.g1 - p.g) * u : p.g;
      const b = p.b1 != null ? p.b + (p.b1 - p.b) * u : p.b;
      this.col[i * 4] = p.r; this.col[i * 4 + 1] = g; this.col[i * 4 + 2] = b; this.col[i * 4 + 3] = a;
      this.size[i] = p.size1 != null ? p.size + (p.size1 - p.size) * u : p.size;
      this.shape[i] = p.shape || 0;
    }
    const g = this.points.geometry;
    g.setDrawRange(0, w);
    g.attributes.position.needsUpdate = true;
    g.attributes.aColor.needsUpdate = true;
    g.attributes.aSize.needsUpdate = true;
    g.attributes.aShape.needsUpdate = true;
  }
}

const BURSTS = {
  wood: { n: 10, colors: [[0.55, 0.4, 0.25], [0.7, 0.55, 0.35], [0.35, 0.25, 0.15]], speed: 3.2, up: 3, size: 0.09, life: 0.9, grav: 12, shape: 2 },
  leaves: { n: 8, colors: [[0.3, 0.42, 0.18], [0.4, 0.5, 0.2]], speed: 1.5, up: 1, size: 0.1, life: 2.2, grav: 1.4, drag: 1.5, wob: 6, shape: 2, spawnY: 3 },
  stone: { n: 10, colors: [[0.5, 0.5, 0.5], [0.35, 0.35, 0.36], [0.62, 0.6, 0.56]], speed: 3.6, up: 3.2, size: 0.08, life: 0.9, grav: 14, shape: 2 },
  dirt: { n: 9, colors: [[0.28, 0.2, 0.13], [0.35, 0.26, 0.17]], speed: 2.2, up: 2.5, size: 0.08, life: 0.7, grav: 12, shape: 2 },
  water: { n: 14, colors: [[0.55, 0.7, 0.8], [0.7, 0.85, 0.95]], speed: 1.2, up: 1.6, size: 0.06, life: 0.6, grav: 9, shape: 0, alpha: 0.7 },
  splash: { n: 22, colors: [[0.6, 0.72, 0.8], [0.85, 0.9, 0.95]], speed: 2.2, up: 4, size: 0.1, life: 0.9, grav: 11, shape: 0, alpha: 0.8 },
  dust: { n: 6, colors: [[0.45, 0.42, 0.38]], speed: 0.8, up: 0.5, size: 0.35, size1: 0.8, life: 0.8, grav: -0.2, drag: 3, shape: 1, alpha: 0.35 },
  sparkle: { n: 12, colors: [[1.0, 0.85, 0.45], [1, 1, 0.8]], speed: 1.4, up: 2, size: 0.12, life: 1.1, grav: -0.5, drag: 1, shape: 0, add: true, alpha: 1 },
  gloam: { n: 18, colors: [[0.3, 0.7, 1.0], [0.5, 0.85, 1.0]], speed: 2.4, up: 1.5, size: 0.16, life: 1.2, grav: -0.8, drag: 2, shape: 0, add: true, alpha: 1 },
  ember: { n: 14, colors: [[1.0, 0.55, 0.15], [1.0, 0.75, 0.3]], speed: 2.5, up: 3, size: 0.1, life: 1.2, grav: -1, drag: 1.5, shape: 0, add: true, alpha: 1 },
  hit: { n: 10, colors: [[1, 0.9, 0.7]], speed: 4, up: 1.5, size: 0.1, life: 0.35, grav: 4, shape: 0, add: true, alpha: 1 },
  heal: { n: 14, colors: [[0.6, 1.0, 0.6], [0.9, 1, 0.7]], speed: 0.8, up: 1.6, size: 0.12, life: 1.2, grav: -1, drag: 1, shape: 0, add: true, alpha: 0.9 },
  hearts: { n: 8, colors: [[1.0, 0.45, 0.55]], speed: 0.7, up: 1.8, size: 0.2, life: 1.4, grav: -0.8, drag: 1, shape: 0, add: true, alpha: 1 },
  snowpuff: { n: 10, colors: [[0.85, 0.88, 0.95]], speed: 1.5, up: 1.5, size: 0.12, life: 0.8, grav: 6, shape: 0, alpha: 0.8 },
};

export class Effects {
  constructor(scene) {
    this.add = new Batch(2500, true);
    this.alpha = new Batch(2500, false);
    scene.add(this.add.points, this.alpha.points);
    this.fires = new Set();
    this.smokes = new Set();
    this.scene = scene;
    this.rain = 0;
    this.snow = 0;
    this.fireflies = 0;
    this.motes = 0;
    this._acc = 0;
    // rain streaks
    const RN = 1400;
    this.rainN = RN;
    this.rainPos = new Float32Array(RN * 6);
    this.rainVel = new Float32Array(RN);
    const rg = new THREE.BufferGeometry();
    rg.setAttribute('position', new THREE.BufferAttribute(this.rainPos, 3).setUsage(THREE.DynamicDrawUsage));
    this.rainLines = new THREE.LineSegments(rg, new THREE.LineBasicMaterial({ color: 0x9fb0c0, transparent: true, opacity: 0.35, depthWrite: false }));
    this.rainLines.frustumCulled = false;
    this.rainLines.visible = false;
    scene.add(this.rainLines);
    this.rainInit = false;
  }

  setViewport(height, fov) {
    const s = height / (2 * Math.tan(THREE.MathUtils.degToRad(fov) / 2));
    this.add.uniforms.uScale.value = s;
    this.alpha.uniforms.uScale.value = s;
  }

  // Persistent emitters -------------------------------------------------
  addFire(pos, scale = 1, opts = {}) {
    const f = { pos: pos.clone(), scale, enabled: true, acc: 0, smoke: opts.smoke ?? true, color: opts.color || null };
    this.fires.add(f);
    return f;
  }
  removeFire(f) { this.fires.delete(f); }
  addSmoke(pos, rate = 1) {
    const s = { pos: pos.clone(), rate, enabled: true, acc: 0 };
    this.smokes.add(s);
    return s;
  }

  // One-shot bursts -------------------------------------------------------
  burst(kind, pos, opts = {}) {
    const B = BURSTS[kind];
    if (!B) return;
    const n = Math.round((opts.n || B.n) * (opts.mult || 1));
    const batch = B.add ? this.add : this.alpha;
    for (let i = 0; i < n; i++) {
      const c = B.colors[(Math.random() * B.colors.length) | 0];
      const a = Math.random() * Math.PI * 2;
      const sp = B.speed * (0.4 + Math.random() * 0.8);
      batch.add({
        x: pos.x + (Math.random() - 0.5) * 0.3, y: pos.y + (B.spawnY ? Math.random() * B.spawnY : 0.1 + Math.random() * 0.3), z: pos.z + (Math.random() - 0.5) * 0.3,
        vx: Math.cos(a) * sp, vy: B.up * (0.5 + Math.random() * 0.7), vz: Math.sin(a) * sp,
        life: B.life * (0.7 + Math.random() * 0.6), size: B.size * (0.7 + Math.random() * 0.6), size1: B.size1,
        r: c[0], g: c[1], b: c[2], a: B.alpha ?? 1, grav: B.grav, drag: B.drag, wob: B.wob, seed: Math.random() * 10,
        shape: B.shape, floor: B.grav > 3 ? (opts.floor ?? pos.y - 0.05) : null,
      });
    }
  }

  update(dt, camera, focus, darkness = 0, terrain = null) {
    // fires
    for (const f of this.fires) {
      if (!f.enabled) continue;
      const d2 = f.pos.distanceToSquared(focus);
      if (d2 > 90 * 90) continue;
      f.acc += dt * 26 * f.scale;
      while (f.acc > 1) {
        f.acc -= 1;
        const hot = Math.random() < 0.35;
        this.add.add({
          x: f.pos.x + (Math.random() - 0.5) * 0.22 * f.scale, y: f.pos.y + Math.random() * 0.05, z: f.pos.z + (Math.random() - 0.5) * 0.22 * f.scale,
          vx: (Math.random() - 0.5) * 0.25, vy: (0.9 + Math.random() * 0.9) * f.scale, vz: (Math.random() - 0.5) * 0.25,
          life: 0.45 + Math.random() * 0.35, size: (0.42 + Math.random() * 0.3) * f.scale, size1: 0.05,
          r: 1.0, g: hot ? 0.8 : 0.5, b: hot ? 0.35 : 0.12, g1: 0.25, b1: 0.05, a: 0.9, a1: 0, shape: 0, fadeIn: 0.06,
        });
        if (Math.random() < 0.12) {
          this.add.add({
            x: f.pos.x, y: f.pos.y + 0.2, z: f.pos.z,
            vx: (Math.random() - 0.5) * 0.8, vy: 1.5 + Math.random() * 1.6, vz: (Math.random() - 0.5) * 0.8,
            life: 1.2 + Math.random() * 1.2, size: 0.07, r: 1, g: 0.6, b: 0.2, a: 1, a1: 0, wob: 3, seed: Math.random() * 9, shape: 0,
          });
        }
        if (f.smoke && Math.random() < 0.08) {
          this.alpha.add({
            x: f.pos.x, y: f.pos.y + 0.7 * f.scale, z: f.pos.z,
            vx: (Math.random() - 0.5) * 0.2 + 0.15, vy: 0.7 + Math.random() * 0.4, vz: (Math.random() - 0.5) * 0.2,
            life: 3.5, size: 0.5 * f.scale, size1: 1.8 * f.scale, r: 0.22, g: 0.21, b: 0.2, a: 0.28, a1: 0, shape: 1, fadeIn: 0.4,
          });
        }
      }
    }
    for (const s of this.smokes) {
      if (!s.enabled) continue;
      if (s.pos.distanceToSquared(focus) > 100 * 100) continue;
      s.acc += dt * 2.2 * s.rate;
      while (s.acc > 1) {
        s.acc -= 1;
        this.alpha.add({
          x: s.pos.x, y: s.pos.y, z: s.pos.z,
          vx: 0.25 + (Math.random() - 0.5) * 0.2, vy: 0.8 + Math.random() * 0.4, vz: (Math.random() - 0.5) * 0.2,
          life: 5, size: 0.6, size1: 2.6, r: 0.3, g: 0.29, b: 0.29, a: 0.3, a1: 0, shape: 1, fadeIn: 0.5, drag: 0.3,
        });
      }
    }
    // fireflies / night motes near the player
    if (this.fireflies > 0) {
      this._acc += dt * 6 * this.fireflies;
      while (this._acc > 1) {
        this._acc -= 1;
        const a = Math.random() * Math.PI * 2, r = 4 + Math.random() * 18;
        const x = focus.x + Math.cos(a) * r, z = focus.z + Math.sin(a) * r;
        const y = (terrain ? Math.max(terrain.heightAt(x, z), 0) : focus.y) + 0.4 + Math.random() * 1.8;
        this.add.add({ x, y, z, vx: 0, vy: 0.05, vz: 0, life: 4 + Math.random() * 3, size: 0.12, r: 0.75, g: 1.0, b: 0.45, a: 1, a1: 0, fadeIn: 1, wob: 1.2, seed: Math.random() * 20, shape: 0 });
      }
    }
    // snow
    if (this.snow > 0) {
      const n = dt * 90 * this.snow;
      for (let i = 0; i < n; i++) {
        const x = camera.position.x + (Math.random() - 0.5) * 40, z = camera.position.z + (Math.random() - 0.5) * 40;
        this.alpha.add({ x, y: camera.position.y + 6 + Math.random() * 6, z, vx: 0.4, vy: -1.2 - Math.random() * 0.6, vz: 0.1, life: 9, size: 0.07 + Math.random() * 0.05, r: 0.9, g: 0.92, b: 0.96, a: 0.85, a1: 0.6, wob: 1.5, seed: Math.random() * 10, shape: 0 });
      }
    }
    this.updateRain(dt, camera);
    this.add.update(dt);
    this.alpha.update(dt);
  }

  updateRain(dt, camera) {
    const on = this.rain > 0.01;
    this.rainLines.visible = on;
    if (!on) return;
    const P = this.rainPos, N = this.rainN;
    const cx = camera.position.x, cy = camera.position.y, cz = camera.position.z;
    const R = 22;
    const active = Math.floor(N * Math.min(1, this.rain));
    for (let i = 0; i < N; i++) {
      const o = i * 6;
      if (i >= active) { P[o + 1] = -999; P[o + 4] = -999; continue; }
      if (!this.rainInit || P[o + 1] < cy - 14 || Math.abs(P[o] - cx) > R || Math.abs(P[o + 2] - cz) > R) {
        P[o] = cx + (Math.random() - 0.5) * 2 * R;
        P[o + 1] = cy - 12 + Math.random() * 22;
        P[o + 2] = cz + (Math.random() - 0.5) * 2 * R;
        this.rainVel[i] = 16 + Math.random() * 6;
      }
      const v = this.rainVel[i];
      P[o + 1] -= v * dt;
      P[o] += 2.2 * dt;
      P[o + 3] = P[o] - 0.08; P[o + 4] = P[o + 1] + 0.55; P[o + 5] = P[o + 2];
    }
    this.rainInit = true;
    this.rainLines.geometry.attributes.position.needsUpdate = true;
  }
}
