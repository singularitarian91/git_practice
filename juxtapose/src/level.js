// Dream layers: terrain, looks, procedural set-piece layouts from the
// Blender kit, grind rails, the exit door, enemy waves, and the waking bedroom.
import * as THREE from 'three';
import { RAPIER } from './physics.js';
import { G, ALL, TUNE, LAYERS, PROPS } from './config.js';
import { spawnEntity } from './entities.js';
import { rnd } from './vfx.js';
import { drawPainting } from './painting.js';
import { SandField } from './sand.js';
import { Town } from './town.js';
import { Sea } from './sea.js';
import { Knot, KNOTS, KNOTS_NEEDED } from './knots.js';

// ---------------------------------------------------------------- noise
function hash(x, y) { const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return s - Math.floor(s); }
function vnoise(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash(xi, yi), b = hash(xi + 1, yi), c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function fbm(x, y, o = 4) { let s = 0, a = 0.5; for (let i = 0; i < o; i++) { s += a * vnoise(x, y); x *= 2.03; y *= 2.03; a *= 0.5; } return s; }
const ss = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

export function mulberry(seed) {
  return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}

export const LOOKS = {
  // Dali: deep cobalt overhead, pale cyan band, a creamy horizon; long raking light
  desert: {
    zenith: '#1d4b8c', mid: '#8db8d8', horizon: '#f5d7a8', ground: '#a8783f', cloud: '#fff4e2', clouds: 0.85, haze: 0.55,
    sunDir: [0.62, 0.2, 0.38], sunColor: '#ffd3a2', sunIntensity: 3.6,
    hemiSky: '#a9c8f0', hemiGround: '#8a5a33', hemiIntensity: 0.55,
    fog: '#e8c79c', fogDensity: 0.0078, fogFalloff: 0.045, fogSun: '#ffd9a8', fogSunAmt: 0.5,
    exposure: 1.0, envIntensity: 0.75, tint: '#fff8ee', saturation: 1.08,
    sand: ['#d9a86a', '#c48f55', '#ebc38a'],
  },
  // de Chirico: viridian sky over a lemon horizon, ochre stone, black shadows
  piazza: {
    zenith: '#0e3a3e', mid: '#3d8a7e', horizon: '#ecd999', ground: '#5a4a33', cloud: '#eef6dc', clouds: 0.3, haze: 0.5,
    sunDir: [0.85, 0.11, 0.25], sunColor: '#ffc46f', sunIntensity: 4.3,
    hemiSky: '#8fc6b4', hemiGround: '#8a6a42', hemiIntensity: 0.62,
    fog: '#d3c890', fogDensity: 0.0048, fogFalloff: 0.05, fogSun: '#ffcf80', fogSunAmt: 0.55, stucco: '#e9b872',
    exposure: 1.0, envIntensity: 0.7, tint: '#fff9ee', saturation: 1.1,
    sand: ['#c9a877', '#b39063', '#d9bc8b'],
  },
  // the Unwatched: cold moonlight against a rose horizon
  boss: {
    zenith: '#0b0922', mid: '#2c1f58', horizon: '#b8657e', ground: '#140f1f', cloud: '#8c6fb3', clouds: 0.55, stars: 0.8, haze: 0.5,
    sunDir: [0.25, 0.55, 0.3], sunColor: '#c4d2ff', sunIntensity: 2.2,
    hemiSky: '#7a6fc4', hemiGround: '#3a2640', hemiIntensity: 0.6,
    fog: '#2b2042', fogDensity: 0.0085, fogFalloff: 0.06, fogSun: '#ff9fb4', fogSunAmt: 0.35,
    exposure: 1.2, envIntensity: 0.9, tint: '#f1ecff', saturation: 1.05,
    sand: ['#4d4467', '#433a5d', '#5a5077'],
  },
  sandbox: {
    zenith: '#2464aa', mid: '#8fc0e2', horizon: '#f6dfbd', ground: '#9c7a55', cloud: '#ffffff', clouds: 1, haze: 0.4,
    sunDir: [0.5, 0.45, 0.35], sunColor: '#fff0d6', sunIntensity: 3.2,
    hemiSky: '#b7d2f2', hemiGround: '#8a6a45', hemiIntensity: 0.6,
    fog: '#ecd6b8', fogDensity: 0.0042, fogFalloff: 0.045, fogSunAmt: 0.35,
    exposure: 1.0, envIntensity: 0.8, tint: '#ffffff', saturation: 1.02,
    sand: ['#dcb482', '#caa06d', '#ecc998'],
  },
  bedroom: {
    zenith: '#9cc6ea', mid: '#cfe2f0', horizon: '#fff1d8', ground: '#c9b294', cloud: '#ffffff', clouds: 0.8,
    sunDir: [-0.6, 0.35, 0.4], sunColor: '#fff0cf', sunIntensity: 4.5,
    hemiSky: '#dbe8f5', hemiGround: '#b8977a', hemiIntensity: 0.9,
    fog: '#f3e6d4', fogDensity: 0.002, fogFalloff: 0, fogSunAmt: 0, exposure: 1.1, envIntensity: 0.8, tint: '#fff8ee', saturation: 0.95,
  },
};

// ---------------------------------------------------------------- the Soft Desert, as a place
// A fishing village half-buried in sand (Dali's Port Lligat), in a valley
// closed by schist cliffs east, west and north, opening south onto the sea.
// Doors face +Z rotated by rotY. Plots are flattened into the land.
export const DESERT = {
  seaY: -1.2,
  trackX: 52,
  buildings: [
    ['B_Workshop', -15, -2, Math.PI / 2],
    ['B_House', 15.5, -4, -Math.PI / 2],
    ['B_Loggia', 0, -15.5, 0],
    ['B_Cottage', -13, 15, Math.PI / 2],
    ['B_Cottage', 13.5, 16, -Math.PI / 2],
    ['B_House', 27, 28, -Math.PI / 2 - 0.35],
    ['B_Chapel', -30, -33, 0.35],
    ['B_Tower', 31, -37, -0.4],
    ['B_Station', 42, 6, -Math.PI / 2],
    ['B_StationPlatform', 47.6, 6, Math.PI / 2],
    ['B_Boathouse', -19, 41, 0],
  ],
  // footprints (w, d) for flattening before the kit is measured
  // plot sizes to flatten: the kit's real extents (the chapel's tower and apse overhang its nave)
  sizes: { B_Workshop: [12.6, 9.7], B_House: [9, 14], B_Loggia: [17.5, 7], B_Cottage: [9.5, 9], B_Chapel: [20, 24], B_Tower: [7, 7.2], B_Station: [17, 8.5], B_StationPlatform: [34, 6.5], B_Boathouse: [11, 12] },
  plaza: [0, 1, 11],
  cliffs: [
    // name, x, z, rotY, scale: a ring of headlands; the valley is inside them
    ['H_Cliff_A', -74, -30, Math.PI / 2, 1.1], ['H_Cliff_B', -70, 22, Math.PI / 2 + 0.2, 1.0], ['H_Cliff_C', -64, 66, Math.PI / 2 + 0.6, 1.1],
    ['H_Cliff_B', -40, -86, 0.1, 1.2], ['H_Cliff_A', 14, -90, -0.1, 1.2], ['H_Cliff_C', 62, -78, -0.5, 1.1],
    ['H_Cliff_A', 76, -24, -Math.PI / 2, 1.1], ['H_Cliff_C', 74, 26, -Math.PI / 2 - 0.2, 1.0], ['H_Cliff_B', 66, 70, -Math.PI / 2 - 0.6, 1.1],
  ],
};

// Golconda Piazza's palazzi: the same kit in de Chirico's ochre, around the square
export const PIAZZA = {
  buildings: [
    ['B_Chapel', -59, 2, Math.PI / 2], ['B_Tower', 58, 6, -Math.PI / 2],
    ['B_House', -15, -59, 0], ['B_House', 15, -59, 0], ['B_Loggia', 0, 64, Math.PI],
    ['B_Workshop', 30, -52, -0.6], ['B_Cottage', -34, 50, Math.PI - 0.7],
  ],
};

// ---------------------------------------------------------------- textures
// value noise that wraps every `p` lattice cells, so textures tile without seams
function tnoise(x, y, p) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const m = (a) => ((a % p) + p) % p;
  const a = hash(m(xi), m(yi)), b = hash(m(xi + 1), m(yi)), c = hash(m(xi), m(yi + 1)), d = hash(m(xi + 1), m(yi + 1));
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function tfbm(x, y, p, o = 3) { let s = 0, a = 0.5; for (let i = 0; i < o; i++) { s += a * tnoise(x, y, p); x *= 2; y *= 2; p *= 2; a *= 0.5; } return s; }

function sandNormalMap() {
  const S = 512, c = document.createElement('canvas'); c.width = c.height = S;
  const g = c.getContext('2d'), img = g.createImageData(S, S);
  const H = new Float32Array(S * S);
  const TAU = Math.PI * 2;
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const u = x / S, v = y / S;
    // ripples run mostly one way but bend around low-frequency swirls
    const bend = (tfbm(u * 3, v * 3, 3, 3) - 0.5) * 2.2;
    const ph = (v * 14 + Math.sin(u * TAU * 2 + bend) * 0.35 + bend * 0.6) * TAU;
    const saw = (Math.sin(ph) + 0.35 * Math.sin(ph * 2 + 0.6)) * 0.5; // asymmetric crest
    const amp = 0.25 + 0.75 * ss(0.3, 0.72, tfbm(u * 4 + 0.5, v * 4, 4, 3)); // calm patches between ripple fields
    H[y * S + x] = saw * amp + (tfbm(u * 32, v * 32, 32, 2) - 0.5) * 0.35;
  }
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const hx = H[y * S + ((x + 1) % S)] - H[y * S + ((x - 1 + S) % S)];
    const hy = H[((y + 1) % S) * S + x] - H[((y - 1 + S) % S) * S + x];
    const n = new THREE.Vector3(-hx * 2.4, -hy * 2.4, 1).normalize();
    const i = (y * S + x) * 4;
    img.data[i] = (n.x * 0.5 + 0.5) * 255; img.data[i + 1] = (n.y * 0.5 + 0.5) * 255; img.data[i + 2] = (n.z * 0.5 + 0.5) * 255; img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; return t;
}

// distant ripples resolve into flat sand instead of shimmering corduroy
function fadeNormalWithDistance(mat, near = 16, far = 70) {
  mat.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader.replace('#include <normal_fragment_maps>',
      THREE.ShaderChunk.normal_fragment_maps.replace('mapN.xy *= normalScale;', `mapN.xy *= normalScale * (1.0 - 0.85 * smoothstep(${near.toFixed(1)}, ${far.toFixed(1)}, length(vViewPosition)));`));
  };
  mat.customProgramCacheKey = () => 'sandfade';
}

function pavingTextures() {
  const S = 512, c = document.createElement('canvas'); c.width = c.height = S;
  const g = c.getContext('2d');
  g.fillStyle = '#b8a582'; g.fillRect(0, 0, S, S);
  const n = 4, w = S / n;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const k = 0.88 + hash(x, y) * 0.2;
    g.fillStyle = `rgb(${Math.round(196 * k)},${Math.round(178 * k)},${Math.round(142 * k)})`;
    g.fillRect(x * w + 3, y * w + 3, w - 6, w - 6);
    for (let i = 0; i < 180; i++) {
      g.fillStyle = `rgba(${hash(i, x) > 0.5 ? '255,250,235' : '70,55,35'},${0.04 + hash(i, y) * 0.05})`;
      g.fillRect(x * w + hash(i, y + x) * w, y * w + hash(y, i + x) * w, 2 + hash(i, i) * 6, 2 + hash(x, i) * 6);
    }
  }
  const map = new THREE.CanvasTexture(c); map.colorSpace = THREE.SRGBColorSpace; map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.anisotropy = 8;
  return map;
}

// ---------------------------------------------------------------- rails
export class Rail {
  constructor(game, points, opts = {}) {
    this.curve = new THREE.CatmullRomCurve3(points, !!opts.closed, 'centripetal');
    this.length = this.curve.getLength();
    this.samples = [];
    const n = Math.max(40, Math.round(this.length * 3));
    for (let i = 0; i <= n; i++) this.samples.push(this.curve.getPointAt(i / n));
    this.n = n;
    const mat = new THREE.MeshStandardMaterial({ color: '#d6a84e', metalness: 1, roughness: 0.25 });
    const tube = new THREE.Mesh(new THREE.TubeGeometry(this.curve, n, 0.07, 10, !!opts.closed), mat);
    tube.castShadow = true; tube.receiveShadow = true;
    game.level.group.add(tube);
    // Dali crutches hold the rail up
    const step = 5.5;
    for (let s = 0.5; s < this.length; s += step) {
      const p = this.point(s);
      const hit = game.physics.ray({ x: p.x, y: p.y - 0.3, z: p.z }, { x: 0, y: -1, z: 0 }, 40, G.WORLD | G.WALL);
      const gy = hit ? hit.point.y : 0;
      const h = p.y - gy;
      if (h < 0.4) continue;
      const post = game.assets.clone('RailPost', { uniqueMaterials: false });
      post.position.set(p.x, gy, p.z);
      post.scale.set(1, h / 1.6, 1);
      const t = this.tangent(s);
      post.rotation.y = Math.atan2(t.x, t.z) + Math.PI / 2;
      post.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
      game.level.group.add(post);
    }
  }
  point(s) { return this.curve.getPointAt(Math.max(0, Math.min(1, s / this.length))); }
  tangent(s) { return this.curve.getTangentAt(Math.max(0, Math.min(1, s / this.length))); }
  closest(p) {
    let best = -1, bd = Infinity;
    for (let i = 0; i <= this.n; i++) {
      const q = this.samples[i];
      const d = (q.x - p.x) ** 2 + (q.y - p.y) ** 2 * 0.25 + (q.z - p.z) ** 2;
      if (d < bd) { bd = d; best = i; }
    }
    if (bd > 4) return null;
    const s = (best / this.n) * this.length;
    const point = this.point(s);
    const d2 = (point.x - p.x) ** 2 + (point.z - p.z) ** 2;
    return { s, point, dist2: d2 };
  }
}

// ---------------------------------------------------------------- level
export class Level {
  constructor(game, key, opts = {}) {
    this.game = game;
    this.key = key;
    this.index = opts.index ?? 0;
    this.seed = opts.seed ?? Math.floor(Math.random() * 1e9);
    this.rng = mulberry(this.seed);
    this.group = new THREE.Group();
    game.scene.add(this.group);
    this.rails = [];
    this.bodies = [];
    this.waves = [];
    this.waveIdx = -1;
    this.waveDelay = 3;
    this.doorOpen = false;
    this.objective = '';
    this.bound = 118;
    this.deco = [];
    this.time = 0;
    this.scrapSpots = [];
    this.spawnPoints = [];
  }

  // undisturbed desert land before plots are flattened into it
  desertBase(x, z) {
    let h = (fbm(x * 0.04 + 11, z * 0.04 - 7, 4) - 0.5) * 1.2;
    // drift dunes pile up north of the village, in long wind-combed ridges
    const north = ss(-20, -62, z);
    const ridge = Math.sin(z * 0.12 + x * 0.025 + fbm(x * 0.02, z * 0.02) * 4) * 0.5 + 0.5;
    h += north * (1 - 0.75 * ss(-64, -80, z)) * (2 + ridge * ridge * 6 + fbm(x * 0.03 + 5, z * 0.03, 3) * 6); // thinning out at the cliff foot
    // sand banks creeping into the streets
    h += (1 - north) * ss(0.55, 0.85, fbm(x * 0.07 + 3, z * 0.07 + 9, 3)) * 1.6;
    // a scree apron rises toward the headlands east, west and far north (the kit's cliffs stand on it)
    const side = Math.max(ss(60, 92, Math.abs(x)), ss(-80, -104, z));
    h += side * (4 + fbm(x * 0.05, z * 0.05, 3) * 4);
    // the beach falls away south into the sea
    const beach = ss(34, 78, z);
    h = h * (1 - beach) + beach * (-3.2 - ss(78, 115, z) * 6);
    // beyond the cliffs the land drops into the sea
    h -= ss(112, 128, Math.hypot(x, z)) * 60;
    return h;
  }

  desertHeight(x, z) {
    if (!this._plots) {
      // building plots, the plaza and the railway bed, each flattened at the land's height at its centre
      this._plots = DESERT.buildings.map(([name, px, pz, rotY]) => {
        const [w, d] = DESERT.sizes[name] || [8, 8];
        return { x: px, z: pz, hw: w / 2 + 1.2, hd: d / 2 + 1.2, rotY, y: name === 'B_StationPlatform' ? this.desertBase(DESERT.trackX - 10, pz) : this.desertBase(px, pz) + (name === 'B_Tower' ? -1.5 : 0) };
      });
      this._plots.push({ x: DESERT.trackX, z: -18, hw: 3, hd: 58, rotY: 0, y: 0.4, soft: 6 });
      const [px, pz, pr] = DESERT.plaza;
      this._plots.push({ x: px, z: pz, hw: pr, hd: pr, rotY: 0, y: this.desertBase(px, pz), round: true });
    }
    let h = this.desertBase(x, z);
    for (const P of this._plots) {
      const dx = x - P.x, dz = z - P.z, c = Math.cos(-P.rotY), s = Math.sin(-P.rotY);
      const lx = dx * c + dz * s, lz = -dx * s + dz * c;
      const out = P.round ? Math.hypot(lx, lz) - P.hw : Math.max(Math.abs(lx) - P.hw, Math.abs(lz) - P.hd);
      if (out > (P.soft || 5)) continue;
      const w = 1 - ss(0, P.soft || 5, out);
      h = h + (P.y - h) * w;
    }
    return h;
  }

  heightAt(x, z) {
    const r = Math.hypot(x, z);
    switch (this.key) {
      case 'desert': return this.desertHeight(x, z);
      case 'sandbox': {
        let h = (fbm(x * 0.035 + 11, z * 0.035 - 7, 4) - 0.5) * 1.4;
        const dune = Math.sin(x * 0.045 + fbm(x * 0.01, z * 0.01) * 6) * 0.5 + 0.5;
        h += ss(46, 90, r) * (5 + dune * 9 + fbm(x * 0.02, z * 0.02) * 8);
        h -= ss(108, 125, r) * 60;
        h *= 0.2 + 0.8 * ss(54, 70, r); // flat floor that rises smoothly into the dunes
        return h;
      }
      case 'piazza': {
        let h = r < 64 ? 0 : (r - 64) * 0.15 + (fbm(x * 0.04, z * 0.04) - 0.5) * 2;
        h -= ss(100, 118, r) * 60;
        for (const [name, px, pz, rotY] of PIAZZA.buildings) {
          const [w, d] = DESERT.sizes[name] || [8, 8];
          const dx = x - px, dz = z - pz, c = Math.cos(-rotY), sn = Math.sin(-rotY);
          const out = Math.max(Math.abs(dx * c + dz * sn) - w / 2 - 1, Math.abs(-dx * sn + dz * c) - d / 2 - 1);
          if (out < 5) h *= ss(0, 5, out);
        }
        return h;
      }
      case 'boss': {
        let h = r < 36 ? 0 : ss(36, 44, r) * 3.2 + (fbm(x * 0.05, z * 0.05) - 0.5) * 1.2 * ss(40, 50, r);
        h -= ss(56, 70, r) * 60;
        return h;
      }
      default: return 0;
    }
  }

  // the sand's colour at a point (vertex colours for the static terrain and the sand field)
  sandColor(x, z, out = new THREE.Color()) {
    const pal = this._pal || (this._pal = (LOOKS[this.key].sand || ['#c9a36a', '#b88a55', '#d8b27a']).map((c) => new THREE.Color(c)));
    const n = fbm(x * 0.06, z * 0.06, 3);
    return out.copy(pal[0]).lerp(pal[1], ss(0.35, 0.7, n)).lerp(pal[2], ss(0.6, 0.9, fbm(x * 0.2 + 3, z * 0.2, 2)) * 0.5);
  }

  buildTerrain() {
    const game = this.game;
    const sandy = this.key === 'desert' || this.key === 'sandbox';
    // sand.js continues this plane's ripple UVs; on sand layers it only carries the far dunes, so it can be coarser
    const size = this.terrainSize = 260, seg = sandy ? 116 : 170;
    let mat;
    if (!sandy) {
      const map = pavingTextures();
      map.repeat.set(size / 8, size / 8);
      mat = new THREE.MeshStandardMaterial({ map, vertexColors: true, roughness: 0.82, metalness: 0 });
      if (this.key === 'boss') mat.color.set('#8a7aa6');
    } else {
      const nm = sandNormalMap();
      nm.repeat.set(size / 11, size / 11);
      mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.94, metalness: 0, normalMap: nm, normalScale: new THREE.Vector2(0.5, 0.5) });
      fadeNormalWithDistance(mat);
      // the living sand: a deformable field over the play area; the static terrain
      // below it only carries the far dunes and sinks out of the way inside its square
      this.sandMat = mat;
      this.sand = new SandField(game, this, this.sandOpts || { size: 150, cell: 0.4, center: new THREE.Vector3() });
    }
    const geo = new THREE.PlaneGeometry(size, size, seg, seg);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    const cols = new Float32Array(pos.count * 3);
    const c = new THREE.Color();
    const inset = (x, z) => this.sand && this.sand.active && this.sand.contains(x, z) && this.sand.contains(x + Math.sign(x - this.sand.center.x) * 2, z + Math.sign(z - this.sand.center.z) * 2);
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      pos.setY(i, this.heightAt(x, z) - (inset(x, z) ? 4 : 0));
      this.sandColor(x, z, c);
      cols[i * 3] = c.r; cols[i * 3 + 1] = c.g; cols[i * 3 + 2] = c.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    this.group.add(mesh);
    // physics: a trimesh of the same surface
    const verts = new Float32Array(pos.array);
    const idx = new Uint32Array(geo.index.array);
    const body = game.physics.fixed({ x: 0, y: 0, z: 0 });
    game.physics.collider(RAPIER.ColliderDesc.trimesh(verts, idx), body, G.WORLD, ALL, { friction: 0.9 });
    this.bodies.push(body);
    // the dream's ceiling: things that float end up pressed against it
    const ceil = game.physics.fixed({ x: 0, y: TUNE.ceiling, z: 0 });
    game.physics.collider(RAPIER.ColliderDesc.cuboid(200, 0.5, 200), ceil, G.CEIL, ALL & ~G.PLAYER);
    this.bodies.push(ceil);
    const cc = document.createElement('canvas'); cc.width = cc.height = 128;
    const cg = cc.getContext('2d'), gr = cg.createRadialGradient(64, 64, 0, 64, 64, 64);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.45, 'rgba(255,255,255,0.35)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    cg.fillStyle = gr; cg.fillRect(0, 0, 128, 128);
    const cm = new THREE.Mesh(new THREE.PlaneGeometry(160, 160), new THREE.MeshBasicMaterial({ color: '#ffffff', alphaMap: new THREE.CanvasTexture(cc), transparent: true, opacity: 0.03, side: THREE.DoubleSide, depthWrite: false, fog: true }));
    cm.rotation.x = Math.PI / 2; cm.position.y = TUNE.ceiling - 0.5;
    cm.userData.noAO = true;
    this.group.add(cm);
  }

  groundY(x, z) {
    const hit = this.game.physics.ray({ x, y: 60, z }, { x: 0, y: -1, z: 0 }, 120, G.WORLD);
    return hit ? hit.point.y : this.heightAt(x, z);
  }

  put(name, x, z, opts = {}) {
    const y = (opts.y ?? this.groundY(x, z)) + (opts.dy || 0);
    return spawnEntity(this.game, name, new THREE.Vector3(x, y, z), opts);
  }

  decoration(name, pos, rotY = 0, scale = 1) {
    const o = this.game.assets.clone(name, { uniqueMaterials: false });
    o.position.copy(pos); o.rotation.y = rotY; o.scale.setScalar(scale);
    o.traverse((m) => { if (m.isMesh) { m.castShadow = scale < 3; m.receiveShadow = true; } });
    this.group.add(o);
    return o;
  }

  addRail(points, opts) {
    const r = new Rail(this.game, points, opts);
    this.rails.push(r);
    return r;
  }

  // ------------------------------------------------------------ set pieces
  clockGrove(cx, cz, rot) {
    const R = this.rng;
    for (let i = 0; i < 3; i++) {
      const a = rot + i * 2.1 + R() * 0.5, d = 4 + R() * 3;
      const x = cx + Math.cos(a) * d, z = cz + Math.sin(a) * d;
      const tree = this.put('DeadTree', x, z, { rotY: -a });
      // drape a clock over the branch
      const branch = new THREE.Vector3(1.7, 2.15, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), -a).add(tree.obj.position);
      const clk = this.put('Clock', branch.x, branch.z, { y: branch.y - 0.35, rotY: -a + Math.PI / 2, anchored: true });
      if (i === 0) this.groveBranch = new THREE.Vector3(branch.x, 0, branch.z);
      clk.melt = 0.3;
    }
    this.put('Candle', cx + 1, cz, {});
    this.put('Candle', cx - 0.6, cz + 0.8, {});
    this.put('Clock', cx + 2.5, cz - 2, { rotY: R() * 6 });
    this.put('Pomegranate', cx - 2, cz - 2.5, {});
  }

  ruins(cx, cz, rot) {
    const R = this.rng;
    const q = new THREE.Vector3();
    const place = (lx, lz, ry, name = 'Wall') => {
      q.set(lx, 0, lz).applyAxisAngle(new THREE.Vector3(0, 1, 0), rot);
      return this.put(name, cx + q.x, cz + q.z, { rotY: rot + ry });
    };
    // two parallel walls (wall-run corridor) + a cap wall with a column colonnade
    for (let i = 0; i < 3; i++) { place(-3.2, -4 + i * 4.05, Math.PI / 2); place(3.2, -4 + i * 4.05, Math.PI / 2); }
    const cap = place(0, 8.5, 0);
    this.ruinsTop = this.ruinsTop || cap.obj.position.clone().add(new THREE.Vector3(0, 3.9, 0));
    for (let i = 0; i < 4; i++) place(-7.5 + i * 5, -9, 0, 'Column');
    place(8, 2, 0, 'Column');
    this.put('Drawers', cx + q.set(0, 0, 3).applyAxisAngle(new THREE.Vector3(0, 1, 0), rot).x, cz + q.z, { rotY: rot });
    // an anvil balanced on top of the corridor wall, waiting to be dropped
    const p = new THREE.Vector3(3.2, 0, -4).applyAxisAngle(new THREE.Vector3(0, 1, 0), rot);
    this.put('Anvil', cx + p.x, cz + p.z, { y: this.groundY(cx + p.x, cz + p.z) + 3.08, rotY: rot + Math.PI / 2 });
    // a rail along the top of one wall line
    const a = new THREE.Vector3(3.2, 3.6, -7).applyAxisAngle(new THREE.Vector3(0, 1, 0), rot);
    const b = new THREE.Vector3(3.2, 3.6, 7).applyAxisAngle(new THREE.Vector3(0, 1, 0), rot);
    const c2 = new THREE.Vector3(6, 2.2, 13).applyAxisAngle(new THREE.Vector3(0, 1, 0), rot);
    const gy = this.groundY(cx, cz);
    this.addRail([new THREE.Vector3(cx + a.x, gy + a.y - 1.2, cz + a.z), new THREE.Vector3(cx + a.x * 0.5 + b.x * 0.5, gy + 3.6, cz + a.z * 0.5 + b.z * 0.5), new THREE.Vector3(cx + b.x, gy + b.y, cz + b.z), new THREE.Vector3(cx + c2.x, gy + c2.y, cz + c2.z)]);
  }

  floatingStairs(cx, cz, rot) {
    const R = this.rng;
    const gy = this.groundY(cx, cz);
    let h = 1.6;
    let last;
    for (let i = 0; i < 7; i++) {
      const a = rot + i * 0.95;
      const d = 5 + i * 0.25;
      const x = cx + Math.cos(a) * d, z = cz + Math.sin(a) * d;
      last = this.put('Platform', x, z, { y: gy + h, rotY: a });
      if (i === 3) this.put('Mirror', x, z, { y: gy + h, rotY: a + Math.PI });
      h += 1.35 + R() * 0.4;
    }
    const top = last.obj.position;
    this.stairsTop = top.clone().add(new THREE.Vector3(0, 1.3, 0));
    this.put('Cloud', top.x + 3, top.z, { y: top.y + 1.5 });
    this.put('Pomegranate', top.x, top.z, { y: top.y + 0.02 });
    this.put('Cloud', cx, cz, { y: gy + 5.5 });
    this.put('Anvil', cx + 0.5, cz + 0.5, { y: gy + 9, props: ['sleeping'] }); // asleep in mid-air
  }

  bedroomOutdoors(cx, cz, rot) {
    this.put('Bed', cx, cz, { rotY: rot });
    const p = (lx, lz) => new THREE.Vector3(lx, 0, lz).applyAxisAngle(new THREE.Vector3(0, 1, 0), rot).add(new THREE.Vector3(cx, 0, cz));
    let q = p(2.2, 1); this.put('Mirror', q.x, q.z, { rotY: rot - 0.6 });
    q = p(-2, 1.4); this.put('Birdcage', q.x, q.z, { rotY: rot });
    q = p(-2.2, -1.5); this.put('Drawers', q.x, q.z, { rotY: rot + 0.3 });
    q = p(-2.2, -1.5); this.put('BowlerHat', q.x, q.z, { y: this.groundY(q.x, q.z) + 1.12 });
    q = p(1.8, -2.2); this.put('Candle', q.x, q.z, {});
    q = p(3.6, -0.6); this.put('Frame', q.x, q.z, { rotY: rot + 0.4 });
    q = p(0, -4); this.put('Wall', q.x, q.z, { rotY: rot });
  }

  anvilGarden(cx, cz, rot) {
    const gy = this.groundY(cx, cz);
    for (let i = 0; i < 3; i++) {
      const a = rot + i * 2.09;
      const x = cx + Math.cos(a) * 4, z = cz + Math.sin(a) * 4;
      this.put('Platform', x, z, { y: gy + 3.2, rotY: a });
      this.put('Anvil', x, z, { y: gy + 3.21, rotY: a });
      if (i === 1) this.gardenTop = new THREE.Vector3(x + 0.9, gy + 4.3, z);
    }
    this.put('Cloud', cx, cz, { y: gy + 7 });
    this.put('BowlerHat', cx + 1, cz, {});
    this.put('Drawers', cx - 1.5, cz + 1, { rotY: rot });
    this.put('Pomegranate', cx, cz - 1.5, {});
  }

  arcade(cx, cz, rot, n = 4) {
    const gy = this.groundY(cx, cz);
    const dir = new THREE.Vector3(1, 0, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), rot);
    for (let i = 0; i < n; i++) {
      const p = new THREE.Vector3(cx, gy, cz).addScaledVector(dir, (i - (n - 1) / 2) * 4);
      this.staticPiece('Arch', p, rot);
    }
    // grind rail along the top of the arcade
    const a = new THREE.Vector3(cx, gy + 5.1, cz).addScaledVector(dir, -(n / 2) * 4 + 0.5);
    const b = new THREE.Vector3(cx, gy + 5.1, cz).addScaledVector(dir, (n / 2) * 4 - 0.5);
    const ramp = a.clone().addScaledVector(dir, -5).setY(gy + 2.4);
    this.addRail([ramp, a, a.clone().lerp(b, 0.5), b]);
  }

  staticPiece(name, pos, rotY) {
    const o = this.game.assets.clone(name, { uniqueMaterials: false });
    o.position.copy(pos); o.rotation.y = rotY;
    o.traverse((m) => { if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } });
    this.group.add(o);
    // trimesh collider from its geometry
    o.updateMatrixWorld(true);
    const verts = [], idx = [];
    o.traverse((m) => {
      if (!m.isMesh) return;
      const g = m.geometry, p = g.attributes.position, base = verts.length / 3;
      const v = new THREE.Vector3();
      for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i).applyMatrix4(m.matrixWorld); verts.push(v.x, v.y, v.z); }
      if (g.index) for (let i = 0; i < g.index.count; i++) idx.push(base + g.index.getX(i));
      else for (let i = 0; i < p.count; i++) idx.push(base + i);
    });
    const body = this.game.physics.fixed({ x: 0, y: 0, z: 0 });
    this.game.physics.collider(RAPIER.ColliderDesc.trimesh(new Float32Array(verts), new Uint32Array(idx)), body, G.WORLD, ALL, { friction: 0.8 });
    this.bodies.push(body);
    return o;
  }

  scatterRocks(n, rMin, rMax) {
    const R = this.rng;
    for (let i = 0; i < n; i++) {
      const a = R() * Math.PI * 2, d = rMin + R() * (rMax - rMin);
      const x = Math.cos(a) * d, z = Math.sin(a) * d;
      const name = ['Rock_A', 'Rock_B', 'Rock_C'][i % 3];
      const e = this.put(name, x, z, { rotY: R() * 6.28, dy: -0.3 });
      e.immutable = true;
    }
  }

  skyDressing() {
    const R = this.rng;
    for (let i = 0; i < 14; i++) {
      const a = R() * Math.PI * 2, d = 140 + R() * 120;
      const c = this.decoration('Cloud', new THREE.Vector3(Math.cos(a) * d, 30 + R() * 50, Math.sin(a) * d), R() * 6, 6 + R() * 8);
      c.traverse((m) => { if (m.isMesh) m.castShadow = false; });
      this.deco.push({ o: c, spin: (R() - 0.5) * 0.02, bob: R() * 6 });
    }
  }

  // ------------------------------------------------------------ builders
  // clouds take a little of the layer's light into themselves instead of reading as grey lumps
  dressTemplates(look) {
    const tint = new THREE.Color(look.stucco || '#ffffff');
    for (const [name, tpl] of this.game.assets.templates) {
      if (!/^(B_|T_|TP_)/.test(name)) continue;
      tpl.traverse((m) => { if (m.isMesh && /^TX_(stucco|plaster)/.test(m.material.name)) m.material.color.copy(tint); });
    }
    const t = this.game.assets.templates.get('Cloud');
    if (t) t.traverse((m) => {
      if (m.isMesh && m.material.name === 'Cloud') {
        m.material.emissive.set(look.cloud || '#ffffff');
        m.material.emissiveIntensity = look.cloudGlow ?? 0.3;
        m.material.roughness = 1;
      }
    });
  }

  build() {
    const game = this.game;
    game.render.setLook(LOOKS[this.key]);
    this.dressTemplates(LOOKS[this.key]);
    // the living sand covers the valley floor, not the cliff slopes or the sea bed
    // grid density follows the graphics setting; fine prints come from the imprint texture either way
    const q = game.render.qualityName, cell = q === 'low' ? 0.58 : q === 'medium' ? 0.48 : 0.4;
    if (this.key === 'desert') this.sandOpts = { size: 124, cell, center: new THREE.Vector3(0, 0, -6) };
    if (this.key === 'sandbox') this.sandOpts = { size: 150, cell: Math.max(cell, 0.46), center: new THREE.Vector3() };
    this.buildTerrain();
    this.skyDressing();
    const R = this.rng;
    if (this.key === 'desert') this.buildDesert(R);
    else if (this.key === 'piazza') this.buildPiazza(R);
    else if (this.key === 'boss') this.buildBoss(R);
    else if (this.key === 'sandbox') this.buildSandbox(R);
  }

  buildDesert(R) {
    const game = this.game, T = this.town = new Town(this);
    // the player comes over the north dunes and looks down on the roofs and the sea
    this.spawn = new THREE.Vector3(0, this.heightAt(0, -48) + 0.6, -48);
    this.spawnYaw = 0;
    this.bound = 104;
    this.sea = new Sea(this, { y: DESERT.seaY });
    // buildings
    for (const [name, x, z, rotY] of DESERT.buildings) T.place(name, x, z, rotY);
    // headlands close the valley; a far ridge and islets finish the horizon
    for (const [name, x, z, rotY, sc] of DESERT.cliffs) this.cliff(name, x, z, rotY, sc);
    if (game.assets.has('H_Ridge')) for (const [x, z, r] of [[-60, -230, 0.1], [150, -160, -0.8], [-170, -120, 0.9]]) T.place('H_Ridge', x, z, r, { y: -2, lock: false, slots: false });
    if (game.assets.has('H_Islet')) for (const [x, z, r, sc] of [[-38, 118, 0.4, 1], [52, 150, 2.1, 1.6], [-110, 170, 1, 2.2]]) T.place('H_Islet', x, z, r, { y: DESERT.seaY - 1.5, lock: false, slots: false, scale: sc });
    // the plaza: a well, lamps, benches, a frame to hang
    const P = (name, x, z, rotY = 0, o = {}) => (game.assets.has(name) ? T.place(name, x, z, rotY, o) : null); // street props lock the sand under them too
    P('T_Well', -4, 5);
    for (const [x, z] of [[-8, -8], [8, -9], [-8, 10], [9, 10], [-3, 26], [6, 36], [30, 2], [-26, 6]]) P('T_Lamp', x, z, Math.atan2(-x, -z));
    P('T_Bench', 5, 7, -2.4); P('T_Bench', -6, -6, 0.8);
    for (const [x, z, r] of [[-5, -18, 0.2], [4, -18.5, 1.1], [7, -17, 0.4], [-8, -13, 2]]) P(['T_Crate', 'T_Barrel', 'T_Amphora', 'T_Crate'][Math.floor(R() * 4)], x, z, r);
    P('T_Cart', 6, -10, 0.7); P('T_Amphora', -10, 8, 0); P('T_Barrel', 10, -12, 0);
    this.put('Frame', 3, -5, { rotY: 0.2 });
    // lanes: garden walls, cypresses by the chapel, olives in the yards, eggs on the roofs
    for (const [x, z, r] of [[-22, 8, 0], [-22, 20, 0], [21, 8, 0], [22, 20, 0], [-7, 22, Math.PI / 2], [7, 23, Math.PI / 2], [36, 20, 0.4], [-28, 30, 1.1]]) P('T_GardenWall', x, z, r);
    for (const [x, z] of [[-40, -22], [-37, -44], [-20, -42], [-44, -30]]) P('T_Cypress', x, z, R() * 6);
    for (const [x, z] of [[-24, 18], [22, 12], [34, 36], [-4, 30]]) P('T_Olive', x, z, R() * 6);
    game.physics.world.updateSceneQueries?.(); // so rays see the roofs just built
    for (const r of T.rects) {
      if (!/House|Workshop/.test(r.name) || R() >= 0.7) continue;
      const ex = r.x + Math.cos(r.rotY) * (r.hw - 1), ez = r.z - Math.sin(r.rotY) * (r.hw - 1);
      P('T_Egg', ex, ez, R() * 6, { y: this.groundY(ex, ez) }); // on whatever roof is there: terrace, parapet or tiles
    }
    // the village gate, where the dunes come down into the streets
    P('T_Gate', 0, -27, 0);
    // the beach: boats hauled up and half-buried, the melting clocks on their dead trees
    P('T_Boat', 5, 52, 0.7); P('T_Boat', -34, 50, 2.4, { y: this.heightAt(-34, 50) - 0.5 }); P('T_Boat', 28, 49, -0.4);
    this.clockGrove(8, 45, 0.3);
    this.bedroomOutdoors(-40, 20, 0.9);
    // the dream is still a dream: stairs floating up toward the tower, anvils on the dunes
    this.floatingStairs(18, -24, -0.6);
    this.anvilGarden(-6, -44, 0.4);
    // a railway from a tunnel in the north cliff, past the station, into the sea
    this.railway();
    // grind lines: across the plaza from roof to roof, and along the dune crest
    const roof = (name) => T.rects.find((r) => r.name === name);
    const w = roof('B_Workshop'), h = roof('B_House');
    if (w && h) this.addRail([new THREE.Vector3(w.x + 3, w.top + 0.9, w.z), new THREE.Vector3(-2, Math.max(w.top, h.top) + 1.6, -3), new THREE.Vector3(h.x - 3, h.top + 0.9, h.z)]);
    const crest = [];
    for (let i = 0; i < 7; i++) { const x = -34 + i * 11, z = -52 + Math.sin(i * 0.9) * 5; crest.push(new THREE.Vector3(x, this.heightAt(x, z) + 2.4, z)); }
    this.addRail(crest);
    // rocks at the foot of the cliffs and along the shore
    for (let i = 0; i < 14; i++) {
      const side = i % 2 ? 1 : -1, z = -60 + R() * 110, x = side * (46 + R() * 10);
      const e = this.put(['Rock_A', 'Rock_B', 'Rock_C'][i % 3], x, z, { rotY: R() * 6.28, dy: -0.3 });
      e.immutable = true;
    }
    // the way out: a door standing in the shallows
    this.door = this.makeDoor(new THREE.Vector3(0, 0, 55), Math.PI);
    // lore: prefer the kit's hidden spots, then the set pieces
    const spots = [...this.scrapSpots];
    const tower = roof('B_Tower');
    if (tower) spots.push(new THREE.Vector3(tower.x, tower.top + 0.8, tower.z));
    this.scrapSpots = [...spots, this.stairsTop, this.gardenTop].filter(Boolean).slice(0, 3);
    // the anxieties guard memories: a knot in front of each of these buildings
    this.knotSpots = [];
    for (const def of KNOTS.desert) {
      const r = T.rects.find((q) => q.name === def.at);
      const lz = r ? (r.hd + 3.5) * (def.side || 1) : 0; // in front of its door (+Z in the kit)
      const x = r ? r.x + Math.sin(r.rotY) * lz : 0, z = r ? r.z + Math.cos(r.rotY) * lz : 0;
      if (r) this.knotSpots.push({ def, pos: new THREE.Vector3(x, this.groundY(x, z), z), hp: 60 });
    }
    this.waves = [];
    this.objectiveName = 'Free the memories the anxieties are guarding';
  }

  // a headland from the kit; until it exists, a rough stack of stone
  cliff(name, x, z, rotY, sc = 1) {
    // stand the headland on the ground at its scree toe, which faces the valley
    const tx = x + Math.sin(rotY) * 14 * sc, tz = z + Math.cos(rotY) * 14 * sc;
    const y = Math.min(this.heightAt(tx, tz), this.heightAt(x, z)) - 1.5;
    if (this.game.assets.has(name)) { this.town.place(name, x, z, rotY, { y, lock: false, slots: false, scale: sc }); return; }
    const geo = new THREE.BoxGeometry(60 * sc, 34 * sc, 22 * sc, 24, 14, 8);
    const p = geo.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const vx = p.getX(i), vy = p.getY(i), vz = p.getZ(i);
      const k = fbm(vx * 0.08 + x, vy * 0.08 + z, 4) - 0.5;
      p.setXYZ(i, vx + k * 6, vy + Math.sin(vy * 0.6 + vx * 0.05) * 0.8, vz + k * 9 + Math.sin(vy * 0.5) * 1.5);
    }
    geo.computeVertexNormals();
    const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: '#8a6f58', roughness: 0.95, flatShading: true }));
    m.position.set(x, y + 17 * sc, z); m.rotation.y = rotY;
    m.castShadow = true; m.receiveShadow = true;
    this.group.add(m);
    const body = this.game.physics.fixed({ x, y: y + 17 * sc, z }, new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rotY, 0)));
    this.game.physics.collider(RAPIER.ColliderDesc.cuboid(28 * sc, 17 * sc, 9 * sc), body, G.WORLD, ALL);
    this.bodies.push(body);
  }

  // rails and sleepers from the north cliff to the sea; the train never stops
  railway() {
    const X = DESERT.trackX, z0 = -80, z1 = 90, n = Math.round((z1 - z0) / 0.9);
    const sleepers = new THREE.InstancedMesh(new THREE.BoxGeometry(2.4, 0.14, 0.24), new THREE.MeshStandardMaterial({ color: '#4a3526', roughness: 0.9 }), n);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion();
    let k = 0;
    for (let i = 0; i < n; i++) {
      const z = z0 + i * 0.9 + (this.rng() - 0.5) * 0.08;
      const y = this.heightAt(X, z);
      m.compose(new THREE.Vector3(X, y + 0.05, z), q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), (this.rng() - 0.5) * 0.06), new THREE.Vector3(1, 1, 1));
      sleepers.setMatrixAt(k++, m);
    }
    sleepers.count = k; sleepers.receiveShadow = true; sleepers.castShadow = true;
    this.group.add(sleepers);
    const steel = new THREE.MeshStandardMaterial({ color: '#6d665e', metalness: 0.85, roughness: 0.35 });
    for (const side of [-0.72, 0.72]) {
      const pts = [];
      for (let z = z0; z <= z1; z += 3) pts.push(new THREE.Vector3(X + side, this.heightAt(X, z) + 0.2, z));
      const tube = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), pts.length * 3, 0.06, 5), steel);
      tube.castShadow = true; tube.receiveShadow = true;
      this.group.add(tube);
    }
    if (this.game.assets.has('T_Gate')) this.town.place('T_Gate', X, -72, 0, { lock: false, scale: 1.5, y: this.heightAt(X, -72) }); // the tunnel mouth
    this.train = this.decoration('Train', new THREE.Vector3(X, this.heightAt(X, -80), -140), 0, 1.4);
    this.trainAxis = 'z';
  }

  buildPiazza(R) {
    this.spawn = new THREE.Vector3(0, 0.5, -40);
    this.spawnYaw = 0;
    const ring = 44;
    for (let k = 0; k < 4; k++) {
      const a = k * Math.PI / 2 + Math.PI / 4;
      this.arcade(Math.cos(a) * ring, Math.sin(a) * ring, -a + Math.PI / 2, 5);
    }
    // colonnades and wall ruins inside the square
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2 + R() * 0.2, d = 16 + R() * 4;
      this.put('Column', Math.cos(a) * d, Math.sin(a) * d, {});
    }
    this.ruins(-18, 8, 0.4);
    this.ruins(20, -6, 2.2);
    this.bedroomOutdoors(0, 22, Math.PI);
    this.anvilGarden(-14, -20, 1.1);
    this.floatingStairs(24, 20, 0.2);
    this.clockGrove(0, 0, R() * 6);
    // a statue-plinth of drawers and clocks in the centre
    this.put('Mirror', -4, -6, { rotY: 0.4 });
    this.put('Mirror', 5, -5, { rotY: -0.5 });
    this.put('Frame', 0, -9, { rotY: 0 });
    // palazzi you can walk into, if the town kit is here
    if (this.game.assets.has('B_House')) {
      this.town = new Town(this);
      for (const [name, x, z, rotY] of PIAZZA.buildings) this.town.place(name, x, z, rotY, { y: 0 });
    }
    const trainY = this.heightAt(0, 95);
    this.train = this.decoration('Train', new THREE.Vector3(-120, trainY, 92), Math.PI / 2, 1.6);
    this.door = this.makeDoor(new THREE.Vector3(0, 0, 50), Math.PI);
    { const a = Math.PI / 4, gy = this.heightAt(Math.cos(a) * 44, Math.sin(a) * 44); this.scrapSpots.push(new THREE.Vector3(Math.cos(a) * 44, gy + 6.2, Math.sin(a) * 44)); }
    if (this.stairsTop) this.scrapSpots.push(this.stairsTop);
    this.scrapSpots.push(new THREE.Vector3(0, 3.6, 0).add(this.groveBranch || new THREE.Vector3(2, 0, 0)));
    this.knotSpots = KNOTS.piazza.map((def) => {
      const x = Math.cos(def.a) * 25, z = Math.sin(def.a) * 25;
      return { def, pos: new THREE.Vector3(x, this.groundY(x, z), z), hp: 65, variant: 'golconda' };
    });
    this.waves = [];
    this.objectiveName = 'Free the memories the rain is guarding';
  }

  buildBoss(R) {
    this.spawn = new THREE.Vector3(0, 0.5, -28);
    this.spawnYaw = 0;
    this.bound = 60;
    // ring of mirrors and columns; walls to hide behind
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      const d = 31;
      if (i % 2 === 0) this.put('Mirror', Math.cos(a) * d, Math.sin(a) * d, { rotY: -a - Math.PI / 2 });
      else this.put('Column', Math.cos(a) * d, Math.sin(a) * d, {});
    }
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + 0.3, d = 18;
      this.put('Wall', Math.cos(a) * d, Math.sin(a) * d, { rotY: -a });
    }
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + 0.8, d = 24;
      const x = Math.cos(a) * d, z = Math.sin(a) * d;
      this.put('Platform', x, z, { y: 4 });
      this.put('Anvil', x, z, { y: 4.01 });
      this.put('Pomegranate', x + 1, z, { y: 4.01 });
    }
    this.put('Bed', -8, -20, { rotY: 0.3 });
    this.put('Bed', 10, 16, { rotY: 2.3 });
    this.put('Cloud', 0, -12, { y: 6 });
    this.put('Cloud', 12, 4, { y: 8 });
    this.put('Clock', -6, 6, {}); this.put('Clock', 7, -8, {});
    this.put('Candle', 3, 12, {}); this.put('Candle', -12, -3, {});
    this.put('BowlerHat', -3, 19, {}); this.put('Birdcage', 15, -12, {});
    const pts = [];
    for (let i = 0; i <= 24; i++) { const a = (i / 24) * Math.PI * 2; pts.push(new THREE.Vector3(Math.cos(a) * 27, 3.2 + Math.sin(a * 3) * 1.2, Math.sin(a) * 27)); }
    this.addRail(pts.slice(0, 13));
    this.addRail(pts.slice(12, 25));
    this.put('Frame', -5, -22, { rotY: 0.3 });
    this.put('Frame', 6, 22, { rotY: Math.PI });
    if (this.game.assets.has('Candle')) {
      for (let i = 0; i < 20; i++) {
        const a = (i / 20) * Math.PI * 2 + Math.PI / 20, d = 29.2 + (i % 2) * 0.6;
        const x = Math.cos(a) * d, z = Math.sin(a) * d;
        this.decoration('Candle', new THREE.Vector3(x, this.groundY(x, z), z), R() * 6, 0.9 + R() * 0.5);
      }
    }
    this.bossSpawn = new THREE.Vector3(0, 0, 8);
    { const a = 0.8, d = 24; this.scrapSpots.push(new THREE.Vector3(Math.cos(a) * d, 5.4, Math.sin(a) * d)); }
    { const a = (1 / 10) * Math.PI * 2, d = 31; this.scrapSpots.push(new THREE.Vector3(Math.cos(a) * d, 5.1, Math.sin(a) * d)); }
    this.waves = [];
    this.objectiveName = 'Look away';
  }

  buildSandbox(R) {
    this.spawn = new THREE.Vector3(0, 0.5, -14);
    this.spawnYaw = 0;
    // every property source in a labelled row
    const names = ['Clock', 'Cloud', 'Mirror', 'Candle', 'Anvil', 'Frame', 'Bed', 'BowlerHat', 'Birdcage', 'Pomegranate'];
    names.forEach((n, i) => {
      const x = -18 + i * 4;
      if (n === 'Cloud') this.put(n, x, -6, { y: this.groundY(x, -6) + 2.5 });
      else this.put(n, x, -6, { rotY: Math.PI });
    });
    // walls, columns and drawers to break
    for (let i = 0; i < 4; i++) this.put('Wall', -12 + i * 4.05, 8, { rotY: 0 });
    for (let i = 0; i < 4; i++) this.put('Column', 8 + i * 3, 6, {});
    this.put('Drawers', 6, 0, {}); this.put('Drawers', 8, 0, {});
    // parkour course: wall-run pair, platforms, a rail
    for (let i = 0; i < 3; i++) { this.put('Wall', 18, -6 + i * 4.05, { rotY: Math.PI / 2 }); this.put('Wall', 24, -6 + i * 4.05, { rotY: Math.PI / 2 }); }
    for (let i = 0; i < 5; i++) this.put('Platform', -24 - i * 1.2, -2 + i * 4, { y: this.groundY(-24, 0) + 1.5 + i * 1.5 });
    this.addRail([new THREE.Vector3(-8, 1.6, 16), new THREE.Vector3(0, 3.5, 20), new THREE.Vector3(10, 3.5, 20), new THREE.Vector3(18, 2, 16)]);
    this.clockGrove(-22, 22, 0.5);
    this.anvilGarden(22, 24, 0);
    this.scatterRocks(10, 50, 80);
    this.waves = [];
    this.objectiveName = 'Experiment freely';
    this.dummies = [new THREE.Vector3(-4, 0, 26), new THREE.Vector3(0, 0, 28), new THREE.Vector3(4, 0, 26)];
  }

  makeDoor(pos, rotY) {
    const o = this.game.assets.clone('Door');
    pos.y = this.groundY(pos.x, pos.z);
    o.position.copy(pos); o.rotation.y = rotY;
    o.traverse((m) => { if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } });
    this.group.add(o);
    const leaf = o.getObjectByName('Door_Leaf');
    const light = o.getObjectByName('Door_Light');
    const lightMats = [];
    light?.traverse((m) => { if (m.isMesh) { m.material = m.material.clone(); lightMats.push(m.material); m.material.userData.baseEI = m.material.emissiveIntensity || 4; m.material.emissiveIntensity = 0.3; } });
    // frame collider
    const body = this.game.physics.fixed(pos, o.quaternion);
    this.game.physics.collider(RAPIER.ColliderDesc.cuboid(0.12, 1.25, 0.12).setTranslation(-0.6, 1.25, 0), body, G.WALL, ALL);
    this.game.physics.collider(RAPIER.ColliderDesc.cuboid(0.12, 1.25, 0.12).setTranslation(0.6, 1.25, 0), body, G.WALL, ALL);
    this.bodies.push(body);
    return { o, leaf, leafQ: leaf ? leaf.quaternion.clone() : null, lightMats, pos: pos.clone(), open: 0, glow: null };
  }

  openDoor() {
    if (this.doorOpen || !this.door) return;
    this.doorOpen = true;
    this.game.audio.sfx('pickup');
    this.game.ui.toast('A door has opened somewhere in the dream.', 'good');
    this.door.glow = this.game.render.claim(this.door, 0xffe2a0, 18, 16);
  }

  // ------------------------------------------------------------ runtime
  startWaves() { this.waveIdx = -1; this.waveDelay = 4; this.nextWave(); }
  // knots: each memory with its half-asleep guards; enough freed opens the door
  startKnots() {
    this.knots = this.knotSpots.map((k) => new Knot(this, k.def, k.pos));
    this.knots.forEach((k, i) => k.spawnGuards(this.knotSpots[i].hp + this.game.depth * 5, this.knotSpots[i].variant));
    this.knotsNeeded = Math.min(KNOTS_NEEDED, this.knots.length);
    // patrols: pairs walking loops through the streets between the memories; a lost
    // patrol is replaced, slowly, from somewhere out of sight
    const hub = this.key === 'desert' ? new THREE.Vector3(...DESERT.plaza.slice(0, 1), 0, DESERT.plaza[1]) : new THREE.Vector3();
    // beats run door to door through the plaza: a little short of each memory, never inside a wall
    const near = (k) => k.pos.clone().lerp(hub, 5 / Math.max(5, k.pos.distanceTo(hub)));
    const street = (p) => { for (let i = 0; i < 40 && this.town?.inside(p.x, p.z, 1.5); i++) p.lerp(hub, 0.08); return p; };
    const K = this.knots;
    const routes = this.key === 'desert' && K.length >= 5
      ? [[near(K[0]), hub.clone(), near(K[1]), hub.clone().add(new THREE.Vector3(-3, 0, -3)), near(K[2])], [near(K[3]), hub.clone().add(new THREE.Vector3(3, 0, 6)), near(K[4])]]
      : [[0, 1, 2, 3].map((i) => new THREE.Vector3(Math.cos(i * 1.57 + 0.8) * 33, 0, Math.sin(i * 1.57 + 0.8) * 33)), [0, 1, 2, 3].map((i) => new THREE.Vector3(Math.cos(-i * 1.57 + 2.4) * 16, 0, Math.sin(-i * 1.57 + 2.4) * 16))];
    for (const r of routes) for (const p of r) { street(p); p.y = this.groundY(p.x, p.z); }
    this.patrols = routes.map((route) => ({ route, members: [], wait: 0 }));
    for (const pt of this.patrols) this.spawnPatrol(pt, 0);
  }
  spawnPatrol(pt, at) {
    const hp = 55 + this.game.depth * 5, variant = this.key === 'piazza' ? 'golconda' : undefined;
    for (let i = 0; i < 2; i++) {
      const p = pt.route[at].clone().add(new THREE.Vector3(i * 1.4, 0.1, i * 0.8));
      const e = this.game.spawnEnemy(p.setY(this.groundY(p.x, p.z) + 0.1), { hp, variant, patrol: { route: pt.route, i: Math.min(at + 1, pt.route.length - 1), dir: at + 1 < pt.route.length ? 1 : -1 } });
      if (e) pt.members.push(e);
    }
  }
  // a wave only when something calls it: a memory taken, a scrap found, a lucid threshold crossed
  surge(n, msg) {
    if (this.pendingWave || this.key === 'boss' || this.key === 'sandbox') return;
    this.game.ui.toast(msg, 'warn');
    this.pendingWave = { n, hp: 55 + this.game.depth * 5, rain: this.key === 'piazza', msg: this.key === 'piazza' ? 'It begins to rain men.' : 'They surface from the sand.' };
    this.waveDelay = 2.5;
  }
  get knotsFreed() { return this.knots ? this.knots.filter((k) => k.state === 'taken').length : 0; }
  nextWave() {
    this.waveIdx++;
    if (this.waveIdx >= this.waves.length) { this.openDoor(); return; }
    this.waveDelay = 2.5;
    this.pendingWave = this.waves[this.waveIdx];
  }

  spawnWave(w) {
    const game = this.game;
    const extra = Math.floor(game.lucidity.k * 2.5);
    for (let i = 0; i < w.n + extra; i++) {
      let px, pz, py = null;
      for (let tries = 0; tries < 12; tries++) {
        const a = Math.random() * Math.PI * 2;
        const d = 16 + Math.random() * 14;
        const x = game.player.pos.x + Math.cos(a) * d, z = game.player.pos.z + Math.sin(a) * d;
        const rr = Math.hypot(x, z);
        const k = rr > 40 ? 40 / rr : 1;
        px = x * k; pz = z * k;
        const sp = this.spawnPoints.length && Math.random() < 0.2 ? this.spawnPoints[Math.floor(Math.random() * this.spawnPoints.length)] : null;
        if (sp && sp.distanceTo(game.player.pos) > 10) { px = sp.x; pz = sp.z; py = sp.y; break; }
        if (this.town?.inside(px, pz, 1)) continue;
        if (this.sea && this.heightAt(px, pz) < this.sea.y + 0.2) continue;
        break;
      }
      if (w.rain) {
        game.spawnEnemy(new THREE.Vector3(px, 17 + Math.random() * 6, pz), { falling: true, gravity: 0.12, hp: w.hp, variant: 'golconda' });
      } else {
        const y = py ?? this.groundY(px, pz);
        game.spawnEnemy(new THREE.Vector3(px, y + 0.1, pz), { hp: w.hp });
        game.vfx.dust(new THREE.Vector3(px, y, pz), 1.4);
        game.vfx.ring(new THREE.Vector3(px, y + 0.1, pz), 0.2, 3, 0.8, 0x7ff7ff, 0.8);
      }
    }
    game.ui.toast(w.msg || (w.rain ? 'It begins to rain men.' : 'Anxieties surface from the sand.'), 'warn');
    game.audio.sfx('bossRoar', { gain: 0.25, pitch: 12 });
  }

  enemiesAlive() { let n = 0; for (const e of this.game.entities) if (e.kind === 'enemy' && !e.dead) n++; return n; }

  // footprints pressed into the sand: an instanced ring buffer of soft dents that fade
  footprints(dt) {
    const game = this.game, p = game.player;
    if (!p || (this.key !== 'desert' && this.key !== 'sandbox')) return;
    if (this.sand?.imprints) return; // the sand field presses real footprints
    if (!this.prints) {
      const c = document.createElement('canvas'); c.width = 64; c.height = 128;
      const g = c.getContext('2d');
      const blob = (x, y, rx, ry, a) => { const gr = g.createRadialGradient(x, y, 0, x, y, Math.max(rx, ry)); gr.addColorStop(0, `rgba(255,255,255,${a})`); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.save(); g.translate(x, y); g.scale(rx / Math.max(rx, ry), ry / Math.max(rx, ry)); g.translate(-x, -y); g.fillStyle = gr; g.beginPath(); g.arc(x, y, Math.max(rx, ry), 0, 7); g.fill(); g.restore(); };
      blob(32, 42, 20, 34, 0.9); blob(32, 96, 16, 22, 0.8);
      const tex = new THREE.CanvasTexture(c);
      const N = 160;
      const geo = new THREE.PlaneGeometry(0.16, 0.3); geo.rotateX(-Math.PI / 2);
      const aAlpha = new THREE.InstancedBufferAttribute(new Float32Array(N), 1); aAlpha.setUsage(THREE.DynamicDrawUsage);
      geo.setAttribute('aAlpha', aAlpha);
      const mat = new THREE.ShaderMaterial({
        uniforms: { uMap: { value: tex }, uColor: { value: new THREE.Color('#6b4524') } },
        vertexShader: `attribute float aAlpha; varying float vA; varying vec2 vUv;
          void main(){ vA = aAlpha; vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0); }`,
        fragmentShader: `uniform sampler2D uMap; uniform vec3 uColor; varying float vA; varying vec2 vUv;
          void main(){ float a = texture2D(uMap, vUv).a * vA; if (a < 0.01) discard; gl_FragColor = vec4(uColor, a * 0.32); }`,
        transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3,
      });
      const mesh = new THREE.InstancedMesh(geo, mat, N);
      mesh.frustumCulled = false; mesh.userData.noAO = true; mesh.count = N;
      const zero = new THREE.Matrix4().makeScale(0, 0, 0);
      for (let i = 0; i < N; i++) mesh.setMatrixAt(i, zero);
      this.group.add(mesh);
      this.prints = { mesh, aAlpha, age: new Float32Array(N).fill(1e9), next: 0, dist: 0, side: 1, last: p.pos.clone(), N };
    }
    const P = this.prints;
    const moved = Math.hypot(p.pos.x - P.last.x, p.pos.z - P.last.z);
    P.last.copy(p.pos);
    const onSand = p.grounded && p.state !== 'grind' && moved < 1 && Math.abs(p.pos.y - this.heightAt(p.pos.x, p.pos.z)) < 0.35;
    if (onSand) P.dist += moved;
    if (onSand && P.dist > 0.62) {
      P.dist = 0;
      const dir = new THREE.Vector3(p.vel.x, 0, p.vel.z);
      if (dir.lengthSq() > 0.5) {
        dir.normalize();
        const side = new THREE.Vector3(dir.z, 0, -dir.x).multiplyScalar(0.11 * P.side);
        P.side = -P.side;
        const x = p.pos.x + side.x, z = p.pos.z + side.z;
        const m = new THREE.Matrix4().compose(new THREE.Vector3(x, this.heightAt(x, z) + 0.03, z),
          new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(dir.x, dir.z)), new THREE.Vector3(1, 1, 1));
        P.mesh.setMatrixAt(P.next, m); P.age[P.next] = 0;
        P.next = (P.next + 1) % P.N;
        P.mesh.instanceMatrix.needsUpdate = true;
      }
    }
    const A = P.aAlpha.array;
    for (let i = 0; i < P.N; i++) { P.age[i] += dt; A[i] = Math.max(0, 1 - P.age[i] / 14); }
    P.aAlpha.needsUpdate = true;
  }

  // air that belongs to each layer: glinting sand on the wind, warm pollen in the
  // piazza, slow fireflies around the Unwatched
  ambience(dt) {
    const game = this.game, p = game.player;
    if (!p || game.render.qualityName === 'low') return;
    const A = {
      desert: { rate: 22, color: '#ffe2b0', k: 2.2, size: 0.035, vx: 1.6, vy: 0.05, life: 3.5, spread: 16, low: true },
      sandbox: { rate: 14, color: '#fff0d0', k: 2.0, size: 0.03, vx: 1.0, vy: 0.08, life: 3.5, spread: 14, low: true },
      piazza: { rate: 10, color: '#fff2c0', k: 2.4, size: 0.03, vx: 0.4, vy: -0.08, life: 6, spread: 16 },
      boss: { rate: 12, color: '#c9b0ff', k: 3.2, size: 0.05, vx: 0.2, vy: 0.2, life: 5, spread: 20 },
    }[this.key];
    if (!A) return;
    this._amb = (this._amb || 0) + dt * A.rate;
    const c = new THREE.Color(A.color).multiplyScalar(A.k);
    const rand = this._ambRng || (this._ambRng = mulberry(this.seed ^ 0x5eed)); // own stream: never perturbs gameplay randomness
    while (this._amb >= 1) {
      this._amb -= 1;
      const a = rand() * Math.PI * 2, r = Math.sqrt(rand()) * A.spread;
      const x = p.pos.x + Math.cos(a) * r, z = p.pos.z + Math.sin(a) * r;
      const y = (A.low ? this.heightAt(x, z) + rand() * 1.2 : p.pos.y + rand() * 6) + 0.1;
      game.vfx.add.spawn({ x, y, z, vx: A.vx * (0.6 + rand() * 0.8), vy: A.vy + (rand() - 0.5) * 0.15, vz: (rand() - 0.5) * 0.4,
        color: c, alpha: 0.8, alpha1: 0, size: A.size, size1: A.size * 0.6, life: A.life * (0.6 + rand() * 0.8) });
    }
  }

  // small props far from the camera stop drawing (and casting shadows): they are a
  // few pixels at that range, and the dream is full of ten-thousand-triangle clocks
  cullProps(dt) {
    this._cullT = (this._cullT || 0) - dt;
    if (this._cullT > 0) return;
    this._cullT = 0.25;
    const cam = this.game.render.camera.position;
    for (const e of this.game.entities) {
      if (e.kind === 'enemy' || e.kind === 'boss' || e.dead || !e.obj) continue;
      const r = e._cullR ?? (e._cullR = e.radius ? e.radius() : 1);
      const far = 42 + r * 18;
      const vis = e.obj.position.distanceToSquared(cam) < far * far;
      if (e.obj.visible !== vis && !e.hollowHidden) e.obj.visible = vis;
    }
  }

  update(dt) {
    const game = this.game;
    this.time += dt;
    this.sand?.update(dt);
    for (const d of this.deco) { d.o.rotation.y += d.spin * dt; d.o.position.y += Math.sin(this.time * 0.2 + d.bob) * 0.01; }
    if (this.train && this.trainAxis === 'z') {
      // out of the cliff, past the platform without slowing, and on into the sea
      const t = this.train; t.position.z += dt * 9;
      if (t.position.z > 150) t.position.z = -150;
      t.position.y = this.heightAt(DESERT.trackX, Math.max(-80, Math.min(90, t.position.z))) + 0.1;
      t.visible = t.position.z > -78;
    } else if (this.train) { this.train.position.x += dt * 6; if (this.train.position.x > 140) this.train.position.x = -140; }
    this.town?.update(dt);
    this.sea?.update(dt);
    this.cullProps(dt);
    // the dream lets you wade, not swim
    const pl = game.player;
    if (this.sea && pl && !pl.dead && pl.pos.y < this.sea.y - 1.15) { game.vfx.dust(pl.pos.clone().setY(this.sea.y), 1.2, '#dfeef0'); pl.rescue(); }
    this.ambience(dt);
    this.footprints(dt);
    // waves
    if (this.pendingWave) {
      this.waveDelay -= dt;
      if (this.waveDelay <= 0) { const w = this.pendingWave; this.pendingWave = null; this.spawnWave(w); }
    } else if (this.waveIdx >= 0 && this.waveIdx < this.waves.length && this.enemiesAlive() === 0) {
      this.nextWave();
    }
    const total = this.waves.length;
    if (this.key === 'boss') this.objective = game.boss && !game.boss.dead ? 'Hurt it only while it is unwatched' : '';
    else if (this.key === 'sandbox') this.objective = 'Lucid sandbox · infinite charges · B for the spawn menu';
    else if (this.knots) {
      for (const k of this.knots) k.update(dt);
      for (const pt of this.patrols || []) {
        if (pt.members.some((e) => !e.dead)) { pt.wait = 0; continue; }
        pt.wait += dt;
        if (pt.wait > 45) { // come back from the far end of the route, out of sight
          const pl = game.player;
          let at = 0, far = -1;
          pt.route.forEach((p, i) => { const d = pl ? p.distanceTo(pl.pos) : 0; if (d > far) { far = d; at = i; } });
          if (far > 22) { pt.members = []; pt.wait = 0; this.spawnPatrol(pt, at); }
        }
      }
      const f = this.knotsFreed;
      if (!this.doorOpen && f >= this.knotsNeeded) this.openDoor();
      this.objective = !this.doorOpen ? `${this.objectiveName} · ${f}/${this.knotsNeeded} freed`
        : f < this.knots.length ? `The door in the ${this.key === 'desert' ? 'shallows' : 'square'} is open · ${this.knots.length - f} memories still caught` : 'Every memory is free · step through the door';
    } else if (!this.doorOpen) this.objective = `${this.objectiveName} · wave ${Math.max(1, Math.min(total, this.waveIdx + 1))}/${total} · ${this.enemiesAlive()} remain`;
    else this.objective = 'Find the open door and step through';
    // the door
    const door = this.door;
    if (door) {
      door.open += ((this.doorOpen ? 1 : 0) - door.open) * Math.min(1, dt * 1.5);
      if (door.leaf) door.leaf.quaternion.copy(door.leafQ).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -door.open * 1.9));
      for (const m of door.lightMats) m.emissiveIntensity = 0.3 + door.open * m.userData.baseEI * (1 + Math.sin(this.time * 3) * 0.1);
      if (door.glow) door.glow.position.copy(door.pos).add(new THREE.Vector3(0, 1.4, 0));
      if (this.doorOpen) {
        if (Math.random() < dt * 30) game.vfx.trail(door.pos.clone().add(new THREE.Vector3(rnd(-0.6, 0.6), rnd(0, 2.4), rnd(-0.3, 0.3))), '#ffe2a0', 0.12, 1.2);
        const d = game.player.pos.clone().sub(door.pos); d.y = 0;
        if (d.length() < 1.1 && !game.transitioning) game.descend();
      }
    }
  }

  dispose() {
    const game = this.game;
    if (this.door?.glow) game.render.release(this.door.glow);
    this.sand?.dispose();
    for (const [, l] of this.town?.lit || []) game.render.release(l);
    for (const b of this.bodies) game.physics.remove(b);
    game.scene.remove(this.group);
    this.group.traverse((o) => { if (o.isMesh) { o.geometry.dispose?.(); } });
  }
}

// ---------------------------------------------------------------- bedroom
// UVs in metres for library textures: each face is projected along its own axis
function boxUV(geo) {
  const p = geo.attributes.position, n = geo.attributes.normal, uv = geo.attributes.uv;
  for (let i = 0; i < p.count; i++) {
    const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i)), az = Math.abs(n.getZ(i));
    if (ax >= ay && ax >= az) uv.setXY(i, p.getZ(i), p.getY(i));
    else if (ay >= az) uv.setXY(i, p.getX(i), p.getZ(i));
    else uv.setXY(i, p.getX(i), p.getY(i));
  }
  uv.needsUpdate = true;
  return geo;
}

// a faded wool rug: madder field, ochre borders, a lozenge medallion, worn in the middle
function rugTexture() {
  const W = 512, H = 336, c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d');
  g.fillStyle = '#5e2a25'; g.fillRect(0, 0, W, H);
  const band = (inset, w, col) => { g.strokeStyle = col; g.lineWidth = w; g.strokeRect(inset, inset, W - inset * 2, H - inset * 2); };
  band(14, 16, '#a2825a'); band(30, 5, '#2c3440'); band(44, 10, '#8f6d47'); band(58, 3, '#c4ad86');
  g.save(); g.translate(W / 2, H / 2);
  for (const [s, col] of [[118, '#8f6d47'], [96, '#2c3440'], [70, '#7a3a30'], [40, '#c4ad86'], [16, '#2c3440']]) {
    g.fillStyle = col; g.beginPath(); g.moveTo(-s * 1.4, 0); g.lineTo(0, -s * 0.8); g.lineTo(s * 1.4, 0); g.lineTo(0, s * 0.8); g.closePath(); g.fill();
  }
  g.restore();
  // hooked motifs in the field corners
  g.fillStyle = '#a2825a';
  for (const [x, y] of [[100, 95], [W - 100, 95], [100, H - 95], [W - 100, H - 95]]) { g.beginPath(); g.arc(x, y, 12, 0, Math.PI * 2); g.fill(); }
  // wear: pale patches and fibre noise
  const img = g.getImageData(0, 0, W, H), d = img.data;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4, dx = (x - W * 0.45) / W, dy = (y - H * 0.55) / H;
    const wear = Math.exp(-(dx * dx + dy * dy) * 7) * 0.32 + (vnoise(x / 23, y / 23) - 0.5) * 0.2 + (hash(x * 0.37, y * 0.61) - 0.5) * 0.14 + (hash(Math.floor(x / 3), y) - 0.5) * 0.1;
    const lum = (d[i] + d[i + 1] + d[i + 2]) / 3;
    for (let k = 0; k < 3; k++) d[i + k] = Math.max(0, Math.min(255, (d[i + k] * 0.8 + lum * 0.2) * (1 + wear * 0.5) + wear * 34));
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}

// The waking vignette: the dreamer's room, which fills in with each memory.
export function buildBedroom(game, memories, opts = {}) {
  const g = new THREE.Group();
  const A = game.assets;
  // lime plaster walls, oak boards, painted trim: the same baked materials as the village
  const wallMat = A.libMaterial('plaster', { color: '#fff6ea' });
  const floorMat = A.libMaterial('oak', { color: new THREE.Color(1.7, 1.6, 1.5) });
  const trimMat = new THREE.MeshStandardMaterial({ color: '#efe7da', roughness: 0.55 });
  const box = (mat, sx, sy, sz, x, y, z, shadow = true) => {
    const m = new THREE.Mesh(boxUV(new THREE.BoxGeometry(sx, sy, sz).translate(x, y, z)), mat);
    m.castShadow = shadow; m.receiveShadow = true; g.add(m); return m;
  };
  const floor = new THREE.Mesh(boxUV(new THREE.PlaneGeometry(8, 8).rotateX(-Math.PI / 2)), floorMat); floor.receiveShadow = true; g.add(floor);
  box(wallMat, 8, 3.4, 0.2, 0, 1.7, 2.6, false); // back
  box(wallMat, 0.2, 3.4, 8, -3.2, 1.7, 0);       // left
  // the right wall has a window in it; the sun comes through the mullions onto the boards
  box(wallMat, 0.2, 3.4, 3, 3.2, 1.7, 1.2); box(wallMat, 0.2, 3.4, 3, 3.2, 1.7, -3.1);
  box(wallMat, 0.2, 1.0, 1.6, 3.2, 0.5, -0.95); box(wallMat, 0.2, 0.8, 1.6, 3.2, 3.0, -0.95);
  const wz0 = -1.6, wz1 = -0.3, wy0 = 1.0, wy1 = 2.6, wzc = (wz0 + wz1) / 2;
  box(trimMat, 0.26, wy1 - wy0, 0.07, 3.16, (wy0 + wy1) / 2, wz0 + 0.035); box(trimMat, 0.26, wy1 - wy0, 0.07, 3.16, (wy0 + wy1) / 2, wz1 - 0.035); // jambs
  box(trimMat, 0.26, 0.07, wz1 - wz0, 3.16, wy1 - 0.035, wzc);                            // head
  box(trimMat, 0.36, 0.05, wz1 - wz0 + 0.22, 3.08, wy0 - 0.005, wzc);                     // sill, proud of the wall
  box(trimMat, 0.06, wy1 - wy0, 0.045, 3.2, (wy0 + wy1) / 2, wzc);                        // mullion
  box(trimMat, 0.06, 0.045, wz1 - wz0, 3.2, wy0 + (wy1 - wy0) * 0.62, wzc);               // transom
  // skirting boards
  box(trimMat, 6.2, 0.13, 0.025, 0, 0.065, 2.4875, false);
  box(trimMat, 0.025, 0.13, 6.5, -3.0875, 0.065, -0.75, false);
  box(trimMat, 0.025, 0.13, 2.8, 3.0875, 0.065, 1.1, false); box(trimMat, 0.025, 0.13, 2.4, 3.0875, 0.065, -2.8, false);
  // a worn rug by the bed
  const rug = new THREE.Mesh(new THREE.PlaneGeometry(2.3, 1.5).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: rugTexture(), roughness: 1 }));
  rug.position.set(-0.6, 0.006, -0.35); rug.rotation.y = 0.06; rug.receiveShadow = true; g.add(rug);
  const add = (name, x, y, z, ry = 0, s = 1) => {
    const o = A.clone(name, { uniqueMaterials: false });
    o.position.set(x, y, z); o.rotation.y = ry; o.scale.setScalar(s);
    o.traverse((m) => { if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } });
    g.add(o); return o;
  };
  add('Bed', -1.2, 0, 1.3, Math.PI);
  add('Drawers', 1.6, 0, 2.1, Math.PI);
  add('Apple', 1.5, 1.12, 2.1);
  const clock = add('Clock', -0.2, 2.1, 2.45, Math.PI, 0.6);
  add('Mirror', -2.8, 0, -1.2, Math.PI / 2);
  add('BowlerHat', -2.2, 1.95, 2.0, 0.4);
  if (memories.has('nightlight')) add('Candle', 1.9, 1.12, 2.2);
  if (memories.has('station')) add('BowlerHat', 1.2, 1.12, 2.0, 1.2);
  if (memories.has('pomegranate')) add('Pomegranate', 1.2, 1.12, 2.25, 0, 0.7);
  if (memories.has('birdcage')) add('Birdcage', 2.5, 0, 0.6);
  // the painting, under its sheet, in the corner of the room
  let easel = null;
  if (A.has('Easel')) {
    easel = add('Easel', 0.55, 0, 1.75, Math.PI - 0.35);
    const cv = document.createElement('canvas'); cv.width = 512; cv.height = 640;
    drawPainting(cv, { found: opts.found || new Set(), finished: !!opts.victory, frame: false });
    const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.flipY = false; tex.anisotropy = 8;
    easel.traverse((m) => {
      if (!m.isMesh) return;
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      mats.forEach((mm, i) => {
        if (mm.name === 'Painting') { const c = mm.clone(); c.map = tex; c.color.set('#ffffff'); c.needsUpdate = true; if (Array.isArray(m.material)) m.material[i] = c; else m.material = c; }
      });
    });
    const sheet = easel.getObjectByName('Easel_Sheet');
    if (sheet) sheet.visible = !opts.victory;
  }
  return { group: g, clock, easel };
}
