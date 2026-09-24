// Dream layers: terrain, looks, procedural set-piece layouts from the
// Blender kit, grind rails, the exit door, enemy waves, and the waking bedroom.
import * as THREE from 'three';
import { RAPIER } from './physics.js';
import { G, ALL, TUNE, LAYERS, PROPS } from './config.js';
import { spawnEntity } from './entities.js';
import { rnd } from './vfx.js';
import { drawPainting } from './painting.js';

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
    fog: '#d3c890', fogDensity: 0.0048, fogFalloff: 0.05, fogSun: '#ffcf80', fogSunAmt: 0.55,
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
  }

  heightAt(x, z) {
    const r = Math.hypot(x, z);
    switch (this.key) {
      case 'desert': case 'sandbox': {
        let h = (fbm(x * 0.035 + 11, z * 0.035 - 7, 4) - 0.5) * 1.4;
        const dune = Math.sin(x * 0.045 + fbm(x * 0.01, z * 0.01) * 6) * 0.5 + 0.5;
        h += ss(46, 90, r) * (5 + dune * 9 + fbm(x * 0.02, z * 0.02) * 8);
        h -= ss(108, 125, r) * 60;
        if (this.key === 'sandbox') h *= 0.2 + 0.8 * ss(54, 70, r); // flat floor that rises smoothly into the dunes
        return h;
      }
      case 'piazza': {
        let h = r < 64 ? 0 : (r - 64) * 0.15 + (fbm(x * 0.04, z * 0.04) - 0.5) * 2;
        h -= ss(100, 118, r) * 60;
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

  buildTerrain() {
    const game = this.game;
    const size = 260, seg = 170;
    const geo = new THREE.PlaneGeometry(size, size, seg, seg);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    const cols = new Float32Array(pos.count * 3);
    const look = LOOKS[this.key];
    const pal = (look.sand || ['#c9a36a', '#b88a55', '#d8b27a']).map((c) => new THREE.Color(c));
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      const y = this.heightAt(x, z);
      pos.setY(i, y);
      const n = fbm(x * 0.06, z * 0.06, 3);
      const c = pal[0].clone().lerp(pal[1], ss(0.35, 0.7, n)).lerp(pal[2], ss(0.6, 0.9, fbm(x * 0.2 + 3, z * 0.2, 2)) * 0.5);
      cols[i * 3] = c.r; cols[i * 3 + 1] = c.g; cols[i * 3 + 2] = c.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
    geo.computeVertexNormals();
    let mat;
    if (this.key === 'piazza' || this.key === 'boss') {
      const map = pavingTextures();
      map.repeat.set(size / 8, size / 8);
      mat = new THREE.MeshStandardMaterial({ map, vertexColors: true, roughness: 0.82, metalness: 0 });
      if (this.key === 'boss') mat.color.set('#8a7aa6');
    } else {
      const nm = sandNormalMap();
      nm.repeat.set(size / 11, size / 11);
      mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.94, metalness: 0, normalMap: nm, normalScale: new THREE.Vector2(0.5, 0.5) });
      fadeNormalWithDistance(mat);
    }
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
    this.buildTerrain();
    this.skyDressing();
    const R = this.rng;
    if (this.key === 'desert') this.buildDesert(R);
    else if (this.key === 'piazza') this.buildPiazza(R);
    else if (this.key === 'boss') this.buildBoss(R);
    else if (this.key === 'sandbox') this.buildSandbox(R);
  }

  buildDesert(R) {
    this.spawn = new THREE.Vector3(0, this.heightAt(0, -34) + 0.5, -34);
    this.spawnYaw = 0;
    const pieces = [this.clockGrove, this.ruins, this.floatingStairs, this.bedroomOutdoors, this.anvilGarden, this.ruins];
    const slots = 6;
    const off = R() * 6.28;
    for (let i = 0; i < slots; i++) {
      const a = off + (i / slots) * Math.PI * 2;
      const d = 20 + R() * 10;
      pieces[i].call(this, Math.cos(a) * d, Math.sin(a) * d, a + Math.PI / 2);
    }
    // a long sweeping rail through the middle of the dunes
    const pts = [];
    for (let i = 0; i < 7; i++) {
      const a = off + 0.5 + i * 0.42;
      const d = 42 + Math.sin(i * 1.3) * 4;
      const x = Math.cos(a) * d, z = Math.sin(a) * d;
      pts.push(new THREE.Vector3(x, this.heightAt(x, z) + 2.2 + Math.sin(i * 0.9) * 1.6, z));
    }
    this.addRail(pts);
    this.scatterRocks(16, 48, 85);
    this.decoration('Train', new THREE.Vector3(60, this.heightAt(60, 95), 95), -0.4, 1.4);
    this.door = this.makeDoor(new THREE.Vector3(0, 0, 44), Math.PI);
    for (const s of [this.stairsTop, this.ruinsTop, this.gardenTop]) if (s) this.scrapSpots.push(s);
    this.waves = [
      { n: 3, hp: 55 }, { n: 4, hp: 60 }, { n: 5, hp: 65 },
    ];
    this.objectiveName = 'Silence the anxieties';
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
    const trainY = this.heightAt(0, 95);
    this.train = this.decoration('Train', new THREE.Vector3(-120, trainY, 92), Math.PI / 2, 1.6);
    this.door = this.makeDoor(new THREE.Vector3(0, 0, 50), Math.PI);
    { const a = Math.PI / 4, gy = this.heightAt(Math.cos(a) * 44, Math.sin(a) * 44); this.scrapSpots.push(new THREE.Vector3(Math.cos(a) * 44, gy + 6.2, Math.sin(a) * 44)); }
    if (this.stairsTop) this.scrapSpots.push(this.stairsTop);
    this.scrapSpots.push(new THREE.Vector3(0, 3.6, 0).add(this.groveBranch || new THREE.Vector3(2, 0, 0)));
    this.waves = [
      { n: 4, hp: 60, rain: true }, { n: 6, hp: 65, rain: true }, { n: 7, hp: 70, rain: true },
    ];
    this.objectiveName = 'Weather the rain of men';
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
      const a = Math.random() * Math.PI * 2;
      const d = 16 + Math.random() * 14;
      const x = game.player.pos.x + Math.cos(a) * d, z = game.player.pos.z + Math.sin(a) * d;
      const rr = Math.hypot(x, z);
      const k = rr > 40 ? 40 / rr : 1;
      const px = x * k, pz = z * k;
      if (w.rain) {
        game.spawnEnemy(new THREE.Vector3(px, 17 + Math.random() * 6, pz), { falling: true, gravity: 0.12, hp: w.hp, variant: 'golconda' });
      } else {
        const y = this.groundY(px, pz);
        game.spawnEnemy(new THREE.Vector3(px, y + 0.1, pz), { hp: w.hp });
        game.vfx.dust(new THREE.Vector3(px, y, pz), 1.4);
        game.vfx.ring(new THREE.Vector3(px, y + 0.1, pz), 0.2, 3, 0.8, 0x7ff7ff, 0.8);
      }
    }
    game.ui.toast(w.rain ? 'It begins to rain men.' : 'Anxieties surface from the sand.', 'warn');
    game.audio.sfx('bossRoar', { gain: 0.25, pitch: 12 });
  }

  enemiesAlive() { let n = 0; for (const e of this.game.entities) if (e.kind === 'enemy' && !e.dead) n++; return n; }

  // footprints pressed into the sand: an instanced ring buffer of soft dents that fade
  footprints(dt) {
    const game = this.game, p = game.player;
    if (!p || (this.key !== 'desert' && this.key !== 'sandbox')) return;
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

  update(dt) {
    const game = this.game;
    this.time += dt;
    for (const d of this.deco) { d.o.rotation.y += d.spin * dt; d.o.position.y += Math.sin(this.time * 0.2 + d.bob) * 0.01; }
    if (this.train) { this.train.position.x += dt * 6; if (this.train.position.x > 140) this.train.position.x = -140; }
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
    else if (!this.doorOpen) this.objective = `${this.objectiveName} · wave ${Math.max(1, Math.min(total, this.waveIdx + 1))}/${total} · ${this.enemiesAlive()} remain`;
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
    for (const b of this.bodies) game.physics.remove(b);
    game.scene.remove(this.group);
    this.group.traverse((o) => { if (o.isMesh) { o.geometry.dispose?.(); } });
  }
}

// ---------------------------------------------------------------- bedroom
// The waking vignette: the dreamer's room, which fills in with each memory.
export function buildBedroom(game, memories, opts = {}) {
  const g = new THREE.Group();
  const A = game.assets;
  const wallMat = new THREE.MeshStandardMaterial({ color: '#e9dcc6', roughness: 0.92 });
  const floorMat = new THREE.MeshStandardMaterial({ color: '#8a6446', roughness: 0.7 });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(8, 8), floorMat); floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; g.add(floor);
  const back = new THREE.Mesh(new THREE.BoxGeometry(8, 3.4, 0.2), wallMat); back.position.set(0, 1.7, 2.6); back.receiveShadow = true; g.add(back);
  const side = new THREE.Mesh(new THREE.BoxGeometry(0.2, 3.4, 8), wallMat); side.position.set(-3.2, 1.7, 0); side.receiveShadow = true; side.castShadow = true; g.add(side);
  // window in the right wall: two panels leaving a gap for the sunlight
  const r1 = new THREE.Mesh(new THREE.BoxGeometry(0.2, 3.4, 3), wallMat); r1.position.set(3.2, 1.7, 1.2); r1.castShadow = true; g.add(r1);
  const r2 = new THREE.Mesh(new THREE.BoxGeometry(0.2, 3.4, 3), wallMat); r2.position.set(3.2, 1.7, -3.1); r2.castShadow = true; g.add(r2);
  const r3 = new THREE.Mesh(new THREE.BoxGeometry(0.2, 1.0, 1.6), wallMat); r3.position.set(3.2, 0.5, -0.95); r3.castShadow = true; g.add(r3);
  const r4 = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.8, 1.6), wallMat); r4.position.set(3.2, 3.0, -0.95); r4.castShadow = true; g.add(r4);
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
