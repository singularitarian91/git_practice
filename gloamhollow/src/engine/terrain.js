// Island heightfield: generation, chunked meshes with a splat shader, and
// fast height / surface-type queries for gameplay.
import * as THREE from 'three';
import { makeSimplex, clamp, lerp, smoothstep } from './noise.js';
import { globalUniforms } from './materials.js';
import { WORLD, PADS, PATHS, STREAM, LOC, FARM, ZONES } from '../game/worldmap.js';

const SURFACE = ['grass', 'path', 'rock', 'sand', 'forest', 'plaza', 'farm', 'mud'];

function distToSegment(px, pz, ax, az, bx, bz) {
  const vx = bx - ax, vz = bz - az;
  const wx = px - ax, wz = pz - az;
  const L = vx * vx + vz * vz;
  const t = L > 0 ? clamp((wx * vx + wz * vz) / L, 0, 1) : 0;
  const dx = wx - vx * t, dz = wz - vz * t;
  return Math.sqrt(dx * dx + dz * dz);
}

function distToPolyline(px, pz, pts) {
  let d = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const di = distToSegment(px, pz, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]);
    if (di < d) d = di;
  }
  return d;
}

const gauss = (x, z, cx, cz, r) => Math.exp(-((x - cx) ** 2 + (z - cz) ** 2) / (r * r));

export class Terrain {
  constructor() {
    this.size = WORLD.size;
    this.res = WORLD.res;
    this.n = Math.round(this.size / this.res) + 1; // verts per side
    this.half = this.size / 2;
    const N = this.n * this.n;
    this.heights = new Float32Array(N);
    this.splatA = new Float32Array(N * 4); // path, rock, sand, forest
    this.splatB = new Float32Array(N * 4); // plaza, farm, mud, (unused)
    this.surface = new Uint8Array(N);
    this.simplex = makeSimplex(WORLD.seed);
    this.uniforms = {
      uGrassColor: { value: new THREE.Color('#5d7034') },
      uGrassColor2: { value: new THREE.Color('#44562a') },
      uRockColor: { value: new THREE.Color('#6b6a66') },
      uHearthPos: { value: new THREE.Vector3(0, 6, 0) },
    };
    this.generate();
    this.group = new THREE.Group();
    this.group.name = 'terrain';
    this.buildMeshes();
    this.heightTexture = this.makeHeightTexture();
  }

  // ------------------------------------------------------------------
  // Generation
  // ------------------------------------------------------------------
  naturalHeight(x, z) {
    const { noise, fbm } = this.simplex;
    const ic = WORLD.islandCenter;
    const dx = x - ic.x, dz = z - ic.z;
    const r = Math.hypot(dx, dz);
    const ang = Math.atan2(dz, dx);
    const coastN = fbm(Math.cos(ang) * 1.6 + 7.3, Math.sin(ang) * 1.6 - 3.1, 3) * 0.2
      + noise(x * 0.03, z * 0.03) * 0.05;
    const R = WORLD.islandRadius * (1 + coastN);
    const t = R - r; // metres inside the coastline

    // inland rolling terrain + named hills
    let h = 4.6 + fbm(x * 0.011, z * 0.011, 4) * 3.0 + fbm(x * 0.045, z * 0.045, 2) * 0.55;
    h += 12 * gauss(x, z, 68, -66, 32);      // Mistwood highlands
    h += 7.5 * gauss(x, z, -64, -58, 19);    // standing-stones hill
    h += 3.5 * gauss(x, z, 84, 46, 22);      // east heath rise
    h += 6 * gauss(x, z, -96, 28, 22);       // western ridge
    h += 4 * gauss(x, z, -20, -80, 26);      // northern downs
    h = Math.max(h, 2.2);

    // cliffs along parts of the north and east coast
    const cliffNoise = this.simplex.noise(Math.cos(ang) * 2.1 + 40, Math.sin(ang) * 2.1);
    const north = smoothstep(10, -30, dz);
    const cliff = smoothstep(0.0, 0.45, cliffNoise) * north;
    const beachW = lerp(11, 2.5, cliff);

    let hc;
    if (t <= 0) {
      hc = lerp(-6.5, -0.5, smoothstep(-34, 0, t));
    } else {
      const beachH = lerp(-0.5, lerp(1.5, 3.5, cliff), smoothstep(0, beachW, t));
      hc = lerp(beachH, h, smoothstep(beachW * 0.6, beachW + 20, t));
    }
    return hc;
  }

  generate() {
    const { n, res, half } = this;
    const { noise, fbm } = this.simplex;
    const H = this.heights;

    // 1) natural height
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const x = -half + i * res, z = -half + j * res;
        H[j * n + i] = this.naturalHeight(x, z);
      }
    }

    // 2) pads (flatten), lake, stream
    const lake = LOC.lake;
    const padH = PADS.map((p) => (p.h == null ? this.naturalHeight(p.x, p.z) : p.h));
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const x = -half + i * res, z = -half + j * res;
        const k = j * n + i;
        let h = H[k];
        for (let p = 0; p < PADS.length; p++) {
          const pad = PADS[p];
          const d = Math.hypot(x - pad.x, z - pad.z);
          if (d < pad.r + pad.blend) {
            const w = smoothstep(pad.r + pad.blend, pad.r, d);
            h = lerp(h, padH[p], w);
          }
        }
        // lake basin
        const la = Math.atan2(z - lake.z, x - lake.x);
        const lr = Math.hypot(x - lake.x, z - lake.z) / (lake.r * (1 + 0.14 * noise(Math.cos(la) * 1.5, Math.sin(la) * 1.5 + 9)));
        if (lr < 1.8) {
          h = lerp(h, Math.min(h, 1.2), smoothstep(1.8, 1.15, lr));
          h = lerp(h, -3.6 + lr * 0.8, smoothstep(1.05, 0.55, lr));
        }
        // stream channel
        const sd = distToPolyline(x, z, STREAM.points);
        if (sd < STREAM.width * 5) {
          const w0 = STREAM.width;
          h = lerp(h, Math.min(h, 1.6), smoothstep(w0 * 5, w0 * 1.6, sd));
          h = lerp(h, -1.4, smoothstep(w0 * 1.25, w0 * 0.35, sd));
        }
        H[k] = h;
      }
    }

    // 3) smooth along paths (blend towards a blurred copy)
    const blur = new Float32Array(H.length);
    const R = 3;
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        let s = 0, c = 0;
        for (let b = -R; b <= R; b++) {
          const jj = j + b;
          if (jj < 0 || jj >= n) continue;
          for (let a = -R; a <= R; a++) {
            const ii = i + a;
            if (ii < 0 || ii >= n) continue;
            s += H[jj * n + ii]; c++;
          }
        }
        blur[j * n + i] = s / c;
      }
    }
    const pathDist = new Float32Array(H.length);
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const x = -half + i * res, z = -half + j * res;
        let d = Infinity;
        for (const p of PATHS) d = Math.min(d, distToPolyline(x, z, p));
        const k = j * n + i;
        pathDist[k] = d;
        if (d < 4 && H[k] > 0.5) H[k] = lerp(H[k], blur[k], 0.65 * smoothstep(4, 1, d));
      }
    }

    // 4) splat weights and dominant surface type
    const nrm = new THREE.Vector3();
    const inRect = (x, z, m) => x > FARM.x0 - m && x < FARM.x1 + m && z > FARM.z0 - m && z < FARM.z1 + m;
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const x = -half + i * res, z = -half + j * res;
        const k = j * n + i;
        const h = H[k];
        this.normalAtIndex(i, j, nrm);
        const slope = 1 - nrm.y;
        const edgeN = noise(x * 0.35, z * 0.35) * 0.45;

        const path = h > -0.2 ? smoothstep(1.9 + edgeN, 0.9 + edgeN * 0.5, pathDist[k]) : 0;
        let rock = smoothstep(0.2, 0.36, slope);
        const mist = smoothstep(ZONES.mistwood.r, ZONES.mistwood.r * 0.55, Math.hypot(x - ZONES.mistwood.x, z - ZONES.mistwood.z));
        rock = Math.max(rock, mist * smoothstep(0.35, 0.65, fbm(x * 0.06, z * 0.06, 2)) * 0.8);
        const lakeD = Math.hypot(x - lake.x, z - lake.z) / lake.r;
        const streamD = distToPolyline(x, z, STREAM.points);
        const nearFresh = Math.max(smoothstep(1.7, 1.2, lakeD), smoothstep(STREAM.width * 3, STREAM.width * 1.5, streamD));
        const coastal = smoothstep(2.6, 1.2, h) * (1 - nearFresh);
        const sand = Math.max(coastal, h < 0 ? 1 - nearFresh : 0);
        const mud = nearFresh * smoothstep(2.4, 0.6, h);
        const forest = Math.max(mist * 0.9, 0.35 * smoothstep(0.2, 0.6, fbm(x * 0.02 + 30, z * 0.02, 2)));
        const plaza = smoothstep(11, 8.5, Math.hypot(x, z) + edgeN * 1.5);
        const farm = inRect(x, z, 0) ? 1 : inRect(x, z, 1.2) ? 0.5 : 0;

        this.splatA[k * 4] = path;
        this.splatA[k * 4 + 1] = rock;
        this.splatA[k * 4 + 2] = sand;
        this.splatA[k * 4 + 3] = forest * (1 - path);
        this.splatB[k * 4] = plaza;
        this.splatB[k * 4 + 1] = farm;
        this.splatB[k * 4 + 2] = mud;
        this.splatB[k * 4 + 3] = 0;

        let type = 0;
        let best = 0.5;
        const cands = [[1, path], [2, rock], [3, sand], [4, forest > 0.6 ? forest : 0], [5, plaza], [6, farm], [7, mud]];
        for (const [ti, w] of cands) if (w > best) { best = w; type = ti; }
        this.surface[k] = type;
      }
    }
  }

  normalAtIndex(i, j, out) {
    const { n, res, heights: H } = this;
    const i0 = Math.max(0, i - 1), i1 = Math.min(n - 1, i + 1);
    const j0 = Math.max(0, j - 1), j1 = Math.min(n - 1, j + 1);
    const dx = (H[j * n + i1] - H[j * n + i0]) / ((i1 - i0) * res);
    const dz = (H[j1 * n + i] - H[j0 * n + i]) / ((j1 - j0) * res);
    return out.set(-dx, 1, -dz).normalize();
  }

  // ------------------------------------------------------------------
  // Meshes
  // ------------------------------------------------------------------
  buildMeshes() {
    const CH = 64; // chunk size in metres
    const cells = CH / this.res;
    const chunksPerSide = Math.round(this.size / CH);
    const material = this.makeMaterial();
    this.material = material;
    const nrm = new THREE.Vector3();
    for (let cj = 0; cj < chunksPerSide; cj++) {
      for (let ci = 0; ci < chunksPerSide; ci++) {
        const vn = cells + 1;
        const pos = new Float32Array(vn * vn * 3);
        const nor = new Float32Array(vn * vn * 3);
        const sa = new Float32Array(vn * vn * 4);
        const sb = new Float32Array(vn * vn * 4);
        for (let j = 0; j < vn; j++) {
          for (let i = 0; i < vn; i++) {
            const gi = ci * cells + i, gj = cj * cells + j;
            const k = gj * this.n + gi;
            const v = j * vn + i;
            pos[v * 3] = -this.half + gi * this.res;
            pos[v * 3 + 1] = this.heights[k];
            pos[v * 3 + 2] = -this.half + gj * this.res;
            this.normalAtIndex(gi, gj, nrm);
            nor[v * 3] = nrm.x; nor[v * 3 + 1] = nrm.y; nor[v * 3 + 2] = nrm.z;
            for (let c = 0; c < 4; c++) {
              sa[v * 4 + c] = this.splatA[k * 4 + c];
              sb[v * 4 + c] = this.splatB[k * 4 + c];
            }
          }
        }
        const idx = new Uint32Array(cells * cells * 6);
        let t = 0;
        for (let j = 0; j < cells; j++) {
          for (let i = 0; i < cells; i++) {
            const a = j * vn + i, b = a + 1, c = a + vn, d = c + 1;
            // alternate the diagonal to reduce directional artefacts
            if ((i + j) % 2 === 0) { idx[t++] = a; idx[t++] = c; idx[t++] = b; idx[t++] = b; idx[t++] = c; idx[t++] = d; }
            else { idx[t++] = a; idx[t++] = c; idx[t++] = d; idx[t++] = a; idx[t++] = d; idx[t++] = b; }
          }
        }
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
        g.setAttribute('splatA', new THREE.BufferAttribute(sa, 4));
        g.setAttribute('splatB', new THREE.BufferAttribute(sb, 4));
        g.setIndex(new THREE.BufferAttribute(idx, 1));
        g.computeBoundingSphere();
        g.computeBoundingBox();
        const mesh = new THREE.Mesh(g, material);
        mesh.receiveShadow = true;
        mesh.castShadow = true;
        mesh.name = `terrain_${ci}_${cj}`;
        this.group.add(mesh);
      }
    }
  }

  makeMaterial() {
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.97, metalness: 0 });
    const u = this.uniforms;
    mat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, u);
      shader.uniforms.uGrainTex = globalUniforms.uGrainTex;
      shader.uniforms.uSnow = globalUniforms.uSnow;
      shader.uniforms.uTime = globalUniforms.uTime;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>
          attribute vec4 splatA;
          attribute vec4 splatB;
          varying vec4 vSplatA;
          varying vec4 vSplatB;
          varying vec3 vTWorld;
          varying vec3 vTNormal;`)
        .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
          vSplatA = splatA;
          vSplatB = splatB;
          vTWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;
          vTNormal = normalize(mat3(modelMatrix) * objectNormal);`);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>
          uniform vec3 uGrassColor;
          uniform vec3 uGrassColor2;
          uniform vec3 uRockColor;
          uniform sampler2D uGrainTex;
          uniform float uSnow;
          uniform float uTime;
          varying vec4 vSplatA;
          varying vec4 vSplatB;
          varying vec3 vTWorld;
          varying vec3 vTNormal;
          float tHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
          float tNoise(vec2 p) {
            vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
            return mix(mix(tHash(i), tHash(i + vec2(1, 0)), f.x), mix(tHash(i + vec2(0, 1)), tHash(i + vec2(1, 1)), f.x), f.y);
          }
          // flagstones for the village green
          float stones(vec2 p) {
            vec2 i = floor(p); vec2 f = fract(p);
            float md = 8.0, md2 = 8.0;
            for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
              vec2 g = vec2(float(x), float(y));
              vec2 o = vec2(tHash(i + g), tHash(i + g + 17.0));
              vec2 r = g + o - f;
              float d = dot(r, r);
              if (d < md) { md2 = md; md = d; } else if (d < md2) { md2 = d; }
            }
            return smoothstep(0.02, 0.12, sqrt(md2) - sqrt(md));
          }`)
        .replace('#include <color_fragment>', `#include <color_fragment>
          {
            vec2 wp = vTWorld.xz;
            float macro = tNoise(wp * 0.035) * 0.6 + tNoise(wp * 0.11) * 0.4;
            float g1 = texture2D(uGrainTex, wp * 0.16).r;    // ~20cm texels
            float g2 = texture2D(uGrainTex, wp * 0.043 + 0.37).r;
            vec3 grass = mix(uGrassColor2, uGrassColor, smoothstep(0.25, 0.75, macro));
            vec3 forest = mix(vec3(0.13, 0.12, 0.075), vec3(0.12, 0.15, 0.07), smoothstep(0.4, 0.7, tNoise(wp * 0.21))) * (0.8 + 0.4 * macro);
            vec3 path = vec3(0.17, 0.13, 0.085) * (0.8 + 0.4 * g2);
            vec3 sand = vec3(0.36, 0.32, 0.24);
            vec3 mud = vec3(0.12, 0.095, 0.07);
            vec3 rock = uRockColor * (0.75 + 0.35 * tNoise(wp * 0.4));
            float st = stones(wp * 1.3);
            vec3 plaza = mix(vec3(0.09, 0.08, 0.065), vec3(0.2, 0.19, 0.175) * (0.7 + 0.5 * tHash(floor(wp * 1.3))), st);
            plaza = mix(plaza, grass * 0.8, (1.0 - st) * smoothstep(0.45, 0.75, tNoise(wp * 0.6)));
            vec3 farm = vec3(0.24, 0.17, 0.11);
            vec3 c = grass;
            c = mix(c, forest, vSplatA.w);
            c = mix(c, mud, vSplatB.z);
            c = mix(c, sand, vSplatA.z);
            c = mix(c, path, vSplatA.x);
            c = mix(c, farm, vSplatB.y);
            c = mix(c, plaza, vSplatB.x);
            c = mix(c, rock, vSplatA.y);
            // wet shoreline & underwater
            float wet = smoothstep(0.7, -0.1, vTWorld.y);
            c *= mix(1.0, 0.55, wet);
            c = mix(c, c * vec3(0.55, 0.7, 0.68), smoothstep(0.0, -2.0, vTWorld.y));
            // chunky texel grain
            c *= mix(0.7, 1.3, g1) * mix(0.86, 1.14, g2);
            // snow
            float snow = uSnow * smoothstep(0.55, 0.8, vTNormal.y) * smoothstep(-0.2, 0.6, vTWorld.y);
            snow *= mix(1.0, 0.75, vSplatA.x);
            c = mix(c, vec3(0.80, 0.84, 0.90) * mix(0.9, 1.05, g1), clamp(snow * (0.75 + 0.5 * macro), 0.0, 1.0));
            diffuseColor.rgb = c;
          }`);
    };
    mat.customProgramCacheKey = () => 'gh-terrain';
    return mat;
  }

  makeHeightTexture() {
    const { n } = this;
    const data = new Uint16Array(n * n);
    for (let k = 0; k < n * n; k++) data[k] = THREE.DataUtils.toHalfFloat(this.heights[k]);
    const tex = new THREE.DataTexture(data, n, n, THREE.RedFormat, THREE.HalfFloatType);
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearFilter;
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.needsUpdate = true;
    return tex;
  }

  // ------------------------------------------------------------------
  // Queries
  // ------------------------------------------------------------------
  heightAt(x, z) {
    const { n, res, half, heights: H } = this;
    let fx = (x + half) / res, fz = (z + half) / res;
    if (fx < 0 || fz < 0 || fx >= n - 1 || fz >= n - 1) return -6.5;
    const i = Math.floor(fx), j = Math.floor(fz);
    const tx = fx - i, tz = fz - j;
    const k = j * n + i;
    const h00 = H[k], h10 = H[k + 1], h01 = H[k + n], h11 = H[k + n + 1];
    return lerp(lerp(h00, h10, tx), lerp(h01, h11, tx), tz);
  }

  normalAt(x, z, out = new THREE.Vector3()) {
    const e = 0.5;
    const dx = (this.heightAt(x + e, z) - this.heightAt(x - e, z)) / (2 * e);
    const dz = (this.heightAt(x, z + e) - this.heightAt(x, z - e)) / (2 * e);
    return out.set(-dx, 1, -dz).normalize();
  }

  surfaceAt(x, z) {
    if (this.heightAt(x, z) < -0.15) return 'water';
    const { n, res, half } = this;
    const i = Math.round((x + half) / res), j = Math.round((z + half) / res);
    if (i < 0 || j < 0 || i >= n || j >= n) return 'water';
    return SURFACE[this.surface[j * n + i]];
  }

  splatAt(x, z) {
    const { n, res, half } = this;
    const i = clamp(Math.round((x + half) / res), 0, n - 1), j = clamp(Math.round((z + half) / res), 0, n - 1);
    const k = j * n + i;
    return {
      path: this.splatA[k * 4], rock: this.splatA[k * 4 + 1], sand: this.splatA[k * 4 + 2], forest: this.splatA[k * 4 + 3],
      plaza: this.splatB[k * 4], farm: this.splatB[k * 4 + 1], mud: this.splatB[k * 4 + 2],
    };
  }

  // Ray (origin, dir) → hit point on the terrain or water, by marching the heightfield.
  raycast(origin, dir, maxDist = 400, out = new THREE.Vector3()) {
    let t = 0;
    let step = 0.5;
    let prevT = 0;
    const p = new THREE.Vector3();
    for (let s = 0; s < 2000 && t < maxDist; s++) {
      p.copy(origin).addScaledVector(dir, t);
      const h = Math.max(this.heightAt(p.x, p.z), -0.05); // water surface counts as ground
      if (p.y <= h) {
        // bisect between prevT and t
        let a = prevT, b = t;
        for (let k = 0; k < 12; k++) {
          const m = (a + b) / 2;
          p.copy(origin).addScaledVector(dir, m);
          const hm = Math.max(this.heightAt(p.x, p.z), -0.05);
          if (p.y <= hm) b = m; else a = m;
        }
        return out.copy(origin).addScaledVector(dir, b);
      }
      prevT = t;
      t += step;
      step = Math.min(2.0, step * 1.02);
    }
    return null;
  }

  // Find the shoreline going south from (x, zStart): first z where height < level
  findCoastSouth(x, zStart, level = 0.3) {
    for (let z = zStart; z < this.half; z += 0.5) {
      if (this.heightAt(x, z) < level) return z;
    }
    return this.half;
  }
}
