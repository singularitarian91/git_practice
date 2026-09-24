// VFX: GPU-instanced billboard particles (CPU simulated), shockwave rings,
// ground decals, and composite effects (explosions, property bursts, dust).
import * as THREE from 'three';
import { PROP_INFO } from './config.js';

const VERT = /* glsl */`
attribute vec3 iPos;
attribute vec4 iColor;
attribute vec4 iMisc; // size, rotation, stretch, unused
attribute vec3 iVel;
varying vec2 vUv;
varying vec4 vColor;
varying float vFog;
uniform float uFogDensity;
void main(){
  vUv = uv;
  vColor = iColor;
  vec4 mv = modelViewMatrix * vec4(iPos, 1.0);
  vec2 p = position.xy * iMisc.x;
  if (iMisc.z > 0.0) {
    vec3 vv = (modelViewMatrix * vec4(iVel, 0.0)).xyz;
    vec2 d = normalize(vv.xy + 1e-5);
    float len = 1.0 + length(vv) * iMisc.z;
    p = vec2(position.x * iMisc.x * len, position.y * iMisc.x * 0.35);
    p = vec2(d.x * p.x - d.y * p.y, d.y * p.x + d.x * p.y);
  } else {
    float c = cos(iMisc.y), s = sin(iMisc.y);
    p = vec2(c * p.x - s * p.y, s * p.x + c * p.y);
  }
  mv.xy += p;
  float dist = length(mv.xyz);
  vFog = 1.0 - exp(-uFogDensity * uFogDensity * dist * dist);
  gl_Position = projectionMatrix * mv;
}`;
const FRAG = /* glsl */`
uniform sampler2D uMap;
uniform vec3 uFogColor;
uniform float uAdditive;
varying vec2 vUv;
varying vec4 vColor;
varying float vFog;
void main(){
  vec4 t = texture2D(uMap, vUv);
  vec4 c = vec4(vColor.rgb * t.rgb, vColor.a * t.a);
  if (uAdditive > 0.5) { c.rgb *= c.a * (1.0 - vFog); c.a = 1.0; }
  else { c.rgb = mix(c.rgb, uFogColor, vFog); }
  if (c.a < 0.003) discard;
  gl_FragColor = c;
}`;

class ParticleLayer {
  constructor(max, map, additive, scene) {
    this.max = max;
    const base = new THREE.PlaneGeometry(1, 1);
    const g = this.geo = new THREE.InstancedBufferGeometry();
    g.index = base.index;
    g.setAttribute('position', base.attributes.position);
    g.setAttribute('uv', base.attributes.uv);
    this.aPos = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3);
    this.aCol = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4);
    this.aMisc = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4);
    this.aVel = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3);
    for (const a of [this.aPos, this.aCol, this.aMisc, this.aVel]) a.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('iPos', this.aPos); g.setAttribute('iColor', this.aCol); g.setAttribute('iMisc', this.aMisc); g.setAttribute('iVel', this.aVel);
    g.instanceCount = 0;
    this.mat = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG,
      uniforms: { uMap: { value: map }, uFogColor: { value: scene.fog.color }, uFogDensity: { value: 0 }, uAdditive: { value: additive ? 1 : 0 } },
      transparent: true, depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.mesh = new THREE.Mesh(g, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = additive ? 5 : 4;
    scene.add(this.mesh);
    this.scene = scene;
    // simulation state
    const F = (n) => new Float32Array(max * n);
    this.p = F(3); this.v = F(3); this.c0 = F(4); this.c1 = F(4);
    this.life = F(1); this.maxLife = F(1); this.s0 = F(1); this.s1 = F(1);
    this.rot = F(1); this.spin = F(1); this.drag = F(1); this.grav = F(1); this.stretch = F(1);
    this.next = 0;
  }
  spawn(o) {
    const i = this.next; this.next = (this.next + 1) % this.max;
    this.p[i * 3] = o.x; this.p[i * 3 + 1] = o.y; this.p[i * 3 + 2] = o.z;
    this.v[i * 3] = o.vx || 0; this.v[i * 3 + 1] = o.vy || 0; this.v[i * 3 + 2] = o.vz || 0;
    const a = o.color, b = o.color1 || o.color;
    this.c0[i * 4] = a.r; this.c0[i * 4 + 1] = a.g; this.c0[i * 4 + 2] = a.b; this.c0[i * 4 + 3] = o.alpha ?? 1;
    this.c1[i * 4] = b.r; this.c1[i * 4 + 1] = b.g; this.c1[i * 4 + 2] = b.b; this.c1[i * 4 + 3] = o.alpha1 ?? 0;
    this.life[i] = this.maxLife[i] = o.life || 1;
    this.s0[i] = o.size || 0.3; this.s1[i] = o.size1 ?? this.s0[i];
    this.rot[i] = o.rot ?? Math.random() * 6.283; this.spin[i] = o.spin || 0;
    this.drag[i] = o.drag || 0; this.grav[i] = o.grav || 0; this.stretch[i] = o.stretch || 0;
  }
  update(dt) {
    let n = 0;
    const P = this.aPos.array, C = this.aCol.array, M = this.aMisc.array, V = this.aVel.array;
    this.mat.uniforms.uFogDensity.value = this.scene.fog.density;
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      if (this.life[i] <= 0) continue;
      const k = 1 - this.life[i] / this.maxLife[i];
      const d = Math.max(0, 1 - this.drag[i] * dt);
      const i3 = i * 3;
      this.v[i3] *= d; this.v[i3 + 1] = this.v[i3 + 1] * d - this.grav[i] * dt; this.v[i3 + 2] *= d;
      this.p[i3] += this.v[i3] * dt; this.p[i3 + 1] += this.v[i3 + 1] * dt; this.p[i3 + 2] += this.v[i3 + 2] * dt;
      this.rot[i] += this.spin[i] * dt;
      const o3 = n * 3, o4 = n * 4, i4 = i * 4;
      P[o3] = this.p[i3]; P[o3 + 1] = this.p[i3 + 1]; P[o3 + 2] = this.p[i3 + 2];
      V[o3] = this.v[i3]; V[o3 + 1] = this.v[i3 + 1]; V[o3 + 2] = this.v[i3 + 2];
      const fade = k < 0.08 ? k / 0.08 : 1;
      C[o4] = this.c0[i4] + (this.c1[i4] - this.c0[i4]) * k;
      C[o4 + 1] = this.c0[i4 + 1] + (this.c1[i4 + 1] - this.c0[i4 + 1]) * k;
      C[o4 + 2] = this.c0[i4 + 2] + (this.c1[i4 + 2] - this.c0[i4 + 2]) * k;
      C[o4 + 3] = (this.c0[i4 + 3] + (this.c1[i4 + 3] - this.c0[i4 + 3]) * k) * fade;
      M[o4] = this.s0[i] + (this.s1[i] - this.s0[i]) * k; M[o4 + 1] = this.rot[i]; M[o4 + 2] = this.stretch[i];
      n++;
    }
    this.geo.instanceCount = n;
    if (n) {
      for (const a of [this.aPos, this.aCol, this.aMisc, this.aVel]) { a.needsUpdate = true; a.clearUpdateRanges(); a.addUpdateRange(0, n * a.itemSize); }
    }
  }
  clear() { this.life.fill(0); this.geo.instanceCount = 0; }
}

const tmpC = new THREE.Color();
const C = (hex, mul = 1) => new THREE.Color(hex).multiplyScalar(mul);
const rnd = (a, b) => a + Math.random() * (b - a);
function rndDir(out = new THREE.Vector3()) {
  const u = Math.random() * 2 - 1, t = Math.random() * Math.PI * 2, s = Math.sqrt(1 - u * u);
  return out.set(s * Math.cos(t), u, s * Math.sin(t));
}

export class VFX {
  constructor(scene, textures, renderer) {
    this.scene = scene;
    this.renderer = renderer;
    this.tex = textures;
    this.add = new ParticleLayer(5000, textures.soft, true, scene);
    this.sparks = new ParticleLayer(2500, textures.spark, true, scene);
    this.smoke = new ParticleLayer(1800, textures.smoke, false, scene);
    this.zs = new ParticleLayer(200, textures.z, false, scene);
    this.rings = [];
    this.decals = [];
    this.ringGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    this.shake = 0;
  }

  update(dt) {
    this.add.update(dt); this.sparks.update(dt); this.smoke.update(dt); this.zs.update(dt);
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i];
      r.t += dt;
      const k = r.t / r.life;
      const s = r.r0 + (r.r1 - r.r0) * (1 - Math.pow(1 - Math.min(k, 1), 3));
      r.mesh.scale.set(s, s, s);
      r.mesh.material.opacity = (1 - k) * r.alpha;
      if (k >= 1) { this.scene.remove(r.mesh); r.mesh.material.dispose(); this.rings.splice(i, 1); }
    }
    for (let i = this.decals.length - 1; i >= 0; i--) {
      const d = this.decals[i];
      d.t += dt;
      if (d.t > d.life) {
        d.mesh.material.opacity = Math.max(0, d.alpha * (1 - (d.t - d.life) / 3));
        if (d.t > d.life + 3) { this.scene.remove(d.mesh); d.mesh.material.dispose(); this.decals.splice(i, 1); }
      }
    }
  }

  clear() {
    for (const L of [this.add, this.sparks, this.smoke, this.zs]) L.clear();
    for (const r of this.rings) this.scene.remove(r.mesh);
    for (const d of this.decals) this.scene.remove(d.mesh);
    this.rings = []; this.decals = [];
  }

  ring(pos, r0, r1, life, color, alpha = 1, normal = null) {
    const mat = new THREE.MeshBasicMaterial({ map: this.tex.ring, color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: alpha, side: THREE.DoubleSide, toneMapped: false });
    const m = new THREE.Mesh(this.ringGeo, mat);
    m.position.copy(pos);
    if (normal) m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), normal);
    m.renderOrder = 6;
    this.scene.add(m);
    this.rings.push({ mesh: m, t: 0, life, r0, r1, alpha });
  }

  decal(pos, normal, size, tex, color = 0xffffff, alpha = 1, life = 30) {
    const mat = new THREE.MeshStandardMaterial({ map: tex, color, transparent: true, depthWrite: false, opacity: alpha, roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -4 });
    const m = new THREE.Mesh(this.ringGeo, mat);
    m.position.copy(pos).addScaledVector(normal, 0.03);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), normal);
    m.rotateY(Math.random() * 6.28);
    m.scale.setScalar(size);
    m.receiveShadow = true;
    this.scene.add(m);
    this.decals.push({ mesh: m, t: 0, life, alpha });
    if (this.decals.length > 60) { const d = this.decals.shift(); this.scene.remove(d.mesh); }
    return m;
  }

  // ---------------------------------------------------------------- composites
  explosion(pos, radius = 4, opts = {}) {
    const hot = opts.color ? C(opts.color, 6) : C('#ffb060', 7);
    const warm = opts.color ? C(opts.color, 2) : C('#ff4a14', 3);
    const n = Math.round(40 + radius * 10);
    const d = new THREE.Vector3();
    // fireball
    for (let i = 0; i < n; i++) {
      rndDir(d);
      const sp = rnd(2, 7) * radius * 0.45 * (opts.implode ? -1 : 1);
      this.add.spawn({ x: pos.x + d.x * 0.3, y: pos.y + d.y * 0.3 + 0.2, z: pos.z + d.z * 0.3, vx: d.x * sp, vy: d.y * sp + 1.5, vz: d.z * sp,
        color: hot, color1: warm, alpha: 1, alpha1: 0, size: rnd(0.8, 1.6) * radius * 0.35, size1: rnd(1.2, 2.2) * radius * 0.4, life: rnd(0.35, 0.8), drag: 4, spin: rnd(-2, 2) });
    }
    // sparks
    for (let i = 0; i < n * 1.2; i++) {
      rndDir(d); d.y = Math.abs(d.y) * 0.8 + 0.1;
      const sp = rnd(8, 26) * (opts.implode ? -0.5 : 1);
      this.sparks.spawn({ x: pos.x, y: pos.y + 0.2, z: pos.z, vx: d.x * sp, vy: d.y * sp, vz: d.z * sp, color: C('#ffd27a', 8), color1: C('#ff5a1f', 2),
        alpha: 1, alpha1: 0, size: rnd(0.05, 0.12), life: rnd(0.4, 1.2), grav: 14, drag: 1.2, stretch: 0.05 });
    }
    // smoke
    for (let i = 0; i < 18 + radius * 3; i++) {
      rndDir(d); d.y = Math.abs(d.y);
      const sp = rnd(1, 4) * radius * 0.3;
      this.smoke.spawn({ x: pos.x + d.x * radius * 0.3, y: pos.y + 0.4 + d.y * radius * 0.2, z: pos.z + d.z * radius * 0.3, vx: d.x * sp, vy: d.y * sp + 1.2, vz: d.z * sp,
        color: C('#3a302b'), color1: C('#8a7d72'), alpha: 0.75, alpha1: 0, size: radius * 0.5, size1: radius * rnd(1.2, 1.9), life: rnd(1.8, 3.8), drag: 1.6, spin: rnd(-0.6, 0.6), grav: -0.4 });
    }
    // the flash + shockwave
    this.add.spawn({ x: pos.x, y: pos.y + 0.5, z: pos.z, color: C('#fff1d6', 12), alpha: 1, alpha1: 0, size: radius * 2.4, size1: radius * 3.2, life: 0.14 });
    this.ring(new THREE.Vector3(pos.x, pos.y + 0.15, pos.z), 0.5, radius * 2.2, 0.55, opts.implode ? 0x8a5cff : 0xffc27a, 0.9);
    if (this.renderer) this.renderer.flash(new THREE.Vector3(pos.x, pos.y + 1.2, pos.z), opts.implode ? 0x9b6bff : 0xff8a3a, 60 * radius, radius * 6, 0.55, 0.25);
    this.shake = Math.min(1, this.shake + 0.35 + radius * 0.06);
  }

  // stucco/stone breakage dust
  dust(pos, amount = 1, color = '#d8c4a0') {
    const d = new THREE.Vector3();
    for (let i = 0; i < 14 * amount; i++) {
      rndDir(d);
      const sp = rnd(0.5, 3) * amount;
      this.smoke.spawn({ x: pos.x + d.x * 0.5, y: pos.y + d.y * 0.5, z: pos.z + d.z * 0.5, vx: d.x * sp, vy: Math.abs(d.y) * sp * 0.6, vz: d.z * sp,
        color: C(color, 0.9), color1: C(color, 1.1), alpha: 0.55, alpha1: 0, size: rnd(0.4, 0.9) * amount, size1: rnd(1.5, 2.8) * amount, life: rnd(1.2, 2.6), drag: 2.2, spin: rnd(-0.5, 0.5), grav: 0.3 });
    }
  }

  // small debris kick-up on impacts
  impact(pos, normal, color = '#e8d3a8', scale = 1) {
    const d = new THREE.Vector3();
    for (let i = 0; i < 8 * scale; i++) {
      rndDir(d).add(normal).normalize();
      const sp = rnd(3, 9);
      this.sparks.spawn({ x: pos.x, y: pos.y, z: pos.z, vx: d.x * sp, vy: d.y * sp, vz: d.z * sp, color: C(color, 2), alpha: 1, alpha1: 0, size: 0.06, life: rnd(0.2, 0.45), grav: 18, stretch: 0.04 });
    }
    for (let i = 0; i < 3 * scale; i++) {
      rndDir(d).add(normal).normalize();
      this.smoke.spawn({ x: pos.x, y: pos.y, z: pos.z, vx: d.x, vy: d.y + 0.4, vz: d.z, color: C(color), alpha: 0.4, alpha1: 0, size: 0.25 * scale, size1: 0.9 * scale, life: rnd(0.6, 1.1), drag: 2 });
    }
  }

  muzzle(pos, dir, color) {
    const c = C(color, 5);
    this.add.spawn({ x: pos.x, y: pos.y, z: pos.z, color: c, alpha: 1, alpha1: 0, size: 0.35, size1: 0.1, life: 0.07 });
    for (let i = 0; i < 5; i++) {
      const sp = rnd(4, 12);
      this.sparks.spawn({ x: pos.x, y: pos.y, z: pos.z, vx: (dir.x + rnd(-0.3, 0.3)) * sp, vy: (dir.y + rnd(-0.3, 0.3)) * sp, vz: (dir.z + rnd(-0.3, 0.3)) * sp,
        color: c, alpha: 1, alpha1: 0, size: 0.04, life: rnd(0.08, 0.18), stretch: 0.03 });
    }
  }

  trail(pos, color, size = 0.12, life = 0.25) {
    this.add.spawn({ x: pos.x, y: pos.y, z: pos.z, color: C(color, 3), alpha: 0.8, alpha1: 0, size, size1: size * 0.2, life });
  }

  propertyBurst(pos, prop, big = 1) {
    const col = PROP_INFO[prop]?.color || '#ffffff';
    const d = new THREE.Vector3();
    for (let i = 0; i < 26 * big; i++) {
      rndDir(d);
      const sp = rnd(1.5, 5) * big;
      this.add.spawn({ x: pos.x, y: pos.y, z: pos.z, vx: d.x * sp, vy: d.y * sp, vz: d.z * sp, color: C(col, 4), alpha: 1, alpha1: 0, size: rnd(0.08, 0.2), size1: 0.02, life: rnd(0.35, 0.8), drag: 3 });
    }
    this.ring(pos, 0.2, 1.8 * big, 0.4, new THREE.Color(col), 0.8, new THREE.Vector3(0, 1, 0));
    this.add.spawn({ x: pos.x, y: pos.y, z: pos.z, color: C(col, 6), alpha: 1, alpha1: 0, size: 1.4 * big, size1: 0.3, life: 0.2 });
  }

  // ambient emitters for properties on an entity (called each frame with a spawn chance)
  emitFor(prop, pos, extent, dt, strength = 1) {
    const r = () => (Math.random() - 0.5) * 2;
    switch (prop) {
      case 'burning':
        if (Math.random() < dt * 40 * strength) {
          this.add.spawn({ x: pos.x + r() * extent.x, y: pos.y + Math.random() * extent.y, z: pos.z + r() * extent.z, vx: r() * 0.3, vy: rnd(1.5, 3.2), vz: r() * 0.3,
            color: C('#ffcf6a', 5), color1: C('#ff3a0a', 1.5), alpha: 1, alpha1: 0, size: rnd(0.25, 0.55) * Math.max(0.6, extent.x), size1: 0.05, life: rnd(0.35, 0.8), drag: 1 });
        }
        if (Math.random() < dt * 6 * strength) {
          this.smoke.spawn({ x: pos.x + r() * extent.x * 0.5, y: pos.y + extent.y, z: pos.z + r() * extent.z * 0.5, vx: r() * 0.2, vy: rnd(1, 2), vz: r() * 0.2,
            color: C('#2c2622'), color1: C('#6d655e'), alpha: 0.5, alpha1: 0, size: 0.5, size1: 1.8, life: rnd(1.5, 2.5), drag: 0.6 });
        }
        break;
      case 'floating':
        if (Math.random() < dt * 8) this.add.spawn({ x: pos.x + r() * extent.x, y: pos.y, z: pos.z + r() * extent.z, vy: rnd(0.6, 1.4), color: C('#8fd3ff', 2), alpha: 0.7, alpha1: 0, size: 0.09, life: 1.2 });
        break;
      case 'sleeping':
        if (Math.random() < dt * 1.3) this.zs.spawn({ x: pos.x + r() * 0.3, y: pos.y + extent.y + 0.2, z: pos.z + r() * 0.3, vx: 0.25, vy: 0.6, color: C('#c9b8ff'), alpha: 0.9, alpha1: 0, size: 0.35, size1: 0.6, life: 2.2, rot: 0 });
        break;
      case 'bursting':
        if (Math.random() < dt * 20) this.sparks.spawn({ x: pos.x + r() * extent.x * 0.6, y: pos.y + extent.y * (0.5 + Math.random() * 0.5), z: pos.z + r() * extent.z * 0.6, vx: r() * 3, vy: rnd(1, 4), vz: r() * 3,
          color: C('#ff2d6f', 4), alpha: 1, alpha1: 0, size: 0.04, life: 0.35, grav: 8, stretch: 0.04 });
        break;
      case 'melting':
        if (Math.random() < dt * 4) this.add.spawn({ x: pos.x + r() * extent.x, y: pos.y + extent.y * Math.random(), z: pos.z + r() * extent.z, vy: -1.2, color: C('#ffb347', 1.4), alpha: 0.8, alpha1: 0, size: 0.08, life: 0.8, grav: 4 });
        break;
      case 'multiplying':
        if (Math.random() < dt * 5) this.add.spawn({ x: pos.x + r() * extent.x, y: pos.y + Math.random() * extent.y, z: pos.z + r() * extent.z, color: C('#ffd84a', 2.5), alpha: 0.8, alpha1: 0, size: 0.12, size1: 0.3, life: 0.5 });
        break;
      case 'hollow':
        if (Math.random() < dt * 4) this.add.spawn({ x: pos.x + r() * extent.x, y: pos.y + Math.random() * extent.y, z: pos.z + r() * extent.z, vy: 0.3, color: C('#5effd0', 1.8), alpha: 0.6, alpha1: 0, size: 0.18, size1: 0.02, life: 0.9 });
        break;
      case 'reflecting':
        if (Math.random() < dt * 3) this.add.spawn({ x: pos.x + r() * extent.x, y: pos.y + Math.random() * extent.y, z: pos.z + r() * extent.z, color: C('#ffffff', 6), alpha: 1, alpha1: 0, size: 0.25, size1: 0.0, life: 0.25, rot: 0.78 });
        break;
      default: break;
    }
  }
}

export { rnd, rndDir, C };
