// Instanced grass tufts in 16 m chunks around the player: wind sway,
// bends away from the player, seasonal colours, a sprinkle of wildflowers.
import * as THREE from 'three';
import { mulberry32, hash2 } from './noise.js';
import { globalUniforms } from './materials.js';

const CHUNK = 16;

function makeTuftGeometry(seed = 3) {
  const rnd = mulberry32(seed);
  const pos = [], nrm = [], hgt = [], flower = [];
  const blades = 7;
  for (let b = 0; b < blades; b++) {
    const a = rnd() * Math.PI * 2;
    const r = rnd() * 0.28;
    const cx = Math.cos(a) * r, cz = Math.sin(a) * r;
    const h = 0.28 + rnd() * 0.32;
    const w = 0.045 + rnd() * 0.03;
    const ya = rnd() * Math.PI;
    const dx = Math.cos(ya) * w, dz = Math.sin(ya) * w;
    const lean = (rnd() - 0.5) * 0.18;
    const lx = Math.cos(a) * lean, lz = Math.sin(a) * lean;
    // two segments per blade: base quad (2 tris) + tip tri
    const mid = 0.55;
    const P = [
      [cx - dx, 0, cz - dz], [cx + dx, 0, cz + dz],
      [cx - dx * 0.7 + lx * mid, h * mid, cz - dz * 0.7 + lz * mid], [cx + dx * 0.7 + lx * mid, h * mid, cz + dz * 0.7 + lz * mid],
      [cx + lx, h, cz + lz],
    ];
    const tris = [[0, 1, 3], [0, 3, 2], [2, 3, 4]];
    for (const t of tris) for (const i of t) {
      pos.push(...P[i]); nrm.push(0, 1, 0); hgt.push(P[i][1] / 0.6); flower.push(0);
    }
  }
  // one flower head (tiny double-sided triangle pair) on top; hidden per instance
  const fh = 0.5;
  const F = [[-0.05, fh, 0], [0.05, fh, 0], [0, fh + 0.07, 0.02], [0, fh, -0.05], [0, fh, 0.05], [0.02, fh + 0.07, 0]];
  for (const t of [[0, 1, 2], [3, 4, 5]]) for (const i of t) {
    pos.push(...F[i]); nrm.push(0, 1, 0); hgt.push(1.1); flower.push(1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('aH', new THREE.Float32BufferAttribute(hgt, 1));
  g.setAttribute('aFlower', new THREE.Float32BufferAttribute(flower, 1));
  return g;
}

export class Grass {
  constructor(terrain, { density = 1, blocked = () => false, radius = 70 } = {}) {
    this.terrain = terrain;
    this.radius = radius;
    this.uniforms = {
      uPlayer: { value: new THREE.Vector3(1e5, 0, 1e5) },
      uFocus: { value: new THREE.Vector3() },
      uBase: { value: new THREE.Color('#2e3d18') },
      uTip: { value: new THREE.Color('#7d8f45') },
      uHeight: { value: 1 },
      uFade: { value: radius * 0.8 },
    };
    this.material = this.makeMaterial();
    this.geometry = makeTuftGeometry();
    this.group = new THREE.Group();
    this.group.name = 'grass';
    this.chunks = [];
    this.build(density, blocked);
  }

  makeMaterial() {
    const mat = new THREE.MeshLambertMaterial({ side: THREE.DoubleSide });
    const u = this.uniforms;
    mat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, u);
      shader.uniforms.uTime = globalUniforms.uTime;
      shader.uniforms.uWind = globalUniforms.uWind;
      shader.uniforms.uSnow = globalUniforms.uSnow;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>
          attribute float aH;
          attribute float aFlower;
          attribute vec3 aTint;
          uniform float uTime;
          uniform float uWind;
          uniform vec3 uPlayer;
          uniform vec3 uFocus;
          uniform float uHeight;
          uniform float uFade;
          varying float vH;
          varying vec3 vTint;
          varying float vFlower;`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          {
            vec3 org = (instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
            float d = distance(org.xz, uFocus.xz);
            float fade = 1.0 - smoothstep(uFade * 0.75, uFade, d);
            float show = aFlower > 0.5 ? step(0.5, aTint.x > 1.5 ? 1.0 : 0.0) : 1.0;
            transformed.y *= uHeight * fade;
            transformed *= show;
            float h = clamp(aH, 0.0, 1.2);
            float ph = uTime * (1.3 + uWind * 0.6) + org.x * 0.27 + org.z * 0.19;
            float gust = sin(uTime * 0.7 + org.x * 0.05) * 0.5 + 0.5;
            float amp = (0.06 + 0.1 * uWind * (0.5 + gust)) * h * h;
            transformed.x += sin(ph) * amp;
            transformed.z += cos(ph * 0.8) * amp * 0.7;
            // push away from the player
            vec3 wp = (instanceMatrix * vec4(transformed, 1.0)).xyz;
            vec2 away = wp.xz - uPlayer.xz;
            float pd = length(away);
            float push = (1.0 - smoothstep(0.2, 1.1, pd)) * h;
            transformed.xz += (pd > 0.001 ? away / pd : vec2(0.0)) * push * 0.35;
            transformed.y -= push * 0.18;
            vH = h;
            vTint = aTint;
            vFlower = aFlower;
          }`);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>
          uniform vec3 uBase;
          uniform vec3 uTip;
          uniform float uSnow;
          varying float vH;
          varying vec3 vTint;
          varying float vFlower;`)
        .replace('#include <normal_fragment_begin>', `#include <normal_fragment_begin>
          normal = normalize(vNormal); // both faces lit like the ground`)
        .replace('#include <color_fragment>', `#include <color_fragment>
          {
            vec3 c = mix(uBase, uTip, clamp(vH, 0.0, 1.0)) * (0.8 + 0.35 * vTint.y);
            c = mix(c, c * vec3(1.15, 1.0, 0.7), vTint.z * 0.5);
            c = mix(c, vec3(0.8, 0.84, 0.9), uSnow * smoothstep(0.4, 1.0, vH) * 0.8);
            if (vFlower > 0.5) {
              float k = fract(vTint.x * 3.7);
              c = k < 0.33 ? vec3(0.85, 0.82, 0.7) : (k < 0.66 ? vec3(0.8, 0.62, 0.2) : vec3(0.45, 0.32, 0.62));
            }
            diffuseColor.rgb = c;
          }`);
    };
    mat.customProgramCacheKey = () => 'gh-grass';
    return mat;
  }

  build(density, blocked) {
    const t = this.terrain;
    const half = t.half;
    const n = Math.floor(t.size / CHUNK);
    const perM2 = 1.6 * density;
    const dummy = new THREE.Object3D();
    for (let cj = 0; cj < n; cj++) {
      for (let ci = 0; ci < n; ci++) {
        const x0 = -half + ci * CHUNK, z0 = -half + cj * CHUNK;
        const mats = [];
        const tints = [];
        const rnd = mulberry32(ci * 7919 + cj * 104729 + 17);
        const tries = Math.round(CHUNK * CHUNK * perM2);
        for (let k = 0; k < tries; k++) {
          const x = x0 + rnd() * CHUNK, z = z0 + rnd() * CHUNK;
          const h = t.heightAt(x, z);
          if (h < 0.35) continue;
          const s = t.splatAt(x, z);
          let w = (1 - s.path) * (1 - s.rock) * (1 - s.sand) * (1 - s.plaza) * (1 - s.farm) * (1 - s.mud) * (1 - 0.75 * s.forest);
          // patchiness
          w *= 0.55 + 0.9 * hash2(Math.floor(x / 3), Math.floor(z / 3), 5);
          if (rnd() > w) continue;
          if (blocked(x, z)) continue;
          dummy.position.set(x, h - 0.02, z);
          dummy.rotation.set(0, rnd() * Math.PI * 2, 0);
          const sc = 0.75 + rnd() * 0.6;
          dummy.scale.set(sc, sc * (0.8 + rnd() * 0.5), sc);
          dummy.updateMatrix();
          mats.push(dummy.matrix.clone());
          const flower = rnd() < 0.06 ? 2 + rnd() : rnd() * 0.99;
          tints.push(flower, rnd(), hash2(Math.floor(x / 9), Math.floor(z / 9), 11));
        }
        if (!mats.length) continue;
        const geo = this.geometry.clone();
        geo.setAttribute('aTint', new THREE.InstancedBufferAttribute(new Float32Array(tints), 3));
        const im = new THREE.InstancedMesh(geo, this.material, mats.length);
        for (let i = 0; i < mats.length; i++) im.setMatrixAt(i, mats[i]);
        im.instanceMatrix.needsUpdate = true;
        im.computeBoundingSphere();
        im.receiveShadow = true;
        im.castShadow = false;
        im.visible = false;
        im.userData.cx = x0 + CHUNK / 2;
        im.userData.cz = z0 + CHUNK / 2;
        this.group.add(im);
        this.chunks.push(im);
      }
    }
  }

  setSeason(season, snow = 0) {
    const u = this.uniforms;
    const P = {
      spring: ['#2e3d18', '#7d8f45', 1.0],
      summer: ['#34401a', '#8f8f44', 1.1],
      autumn: ['#3d3316', '#9a7a3c', 0.9],
      winter: ['#2c3024', '#7a7e70', 0.45],
    }[season] || ['#2e3d18', '#7d8f45', 1];
    u.uBase.value.set(P[0]);
    u.uTip.value.set(P[1]);
    u.uHeight.value = P[2] * (1 - snow * 0.5);
  }

  update(focus, player) {
    this.uniforms.uFocus.value.copy(focus);
    if (player) this.uniforms.uPlayer.value.copy(player);
    const r2 = (this.radius + CHUNK) * (this.radius + CHUNK);
    for (const c of this.chunks) {
      const dx = c.userData.cx - focus.x, dz = c.userData.cz - focus.z;
      c.visible = dx * dx + dz * dz < r2;
    }
  }
}
