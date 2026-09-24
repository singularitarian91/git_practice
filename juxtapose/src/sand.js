// Sand: a deformable, collidable, granular surface for the sand layers.
//
// The field is a square height grid over the play area: the undisturbed base
// shape (level.heightAt) plus a deformation that is always moved, never made or
// destroyed. Everything that touches the sand goes through a few conserving
// operations: dig a disc and push what came out into a rim, throw clumps that
// deposit where they land, press a footprint under a resting body. After any of
// them, slopes steeper than the angle of repose avalanche downhill over a few
// frames, and over minutes the wind blows the scars back to the base shape.
//
// It is drawn as a grid of chunk meshes updated in place (only dirty rows, via
// addUpdateRange) and collides as tiled Rapier heightfields, one per chunk,
// rebuilt a couple per frame with setShape so a tile never disappears under
// anything standing on it. Crisp footprints and slide grooves live in a small
// world-anchored imprint texture that scrolls with the player and is read by
// the sand shader; freshly turned sand is darker and cooler until it dries.
//
// Buildings (lockRect), the border band and anything anchored standing in the sand
// are locked: they never deform and the sand treats them as walls. Nothing piles up
// under a movable body (it would bury it in the heightfield). A melting round that
// lands in the sand opens a patch of quicksand that swallows sleepwalkers.
//
// Contract used by level.js, player.js and destruction.js:
//   new SandField(game, level, { size, cell, center }), .active, .imprints
//   contains(x, z), height(x, z), stamp(x, z, r, depth, opts), crater(x, z, r, depth, opts)
//   lockRect(cx, cz, halfW, halfD, rotY), update(dt), dispose()
// plus the hooks the player calls (onFootstep, onLand, onPound, onDash, visualSink,
// moveFactor, groundVel, surf; the field calls player.sandLift) and destruction calls
// (explosion, impact, debrisImpact), and heap / quicksand / isSand / normalAt.
import * as THREE from 'three';
import { RAPIER } from './physics.js';
import { G, ALL, groups } from './config.js';

const REPOSE = Math.tan(33 * Math.PI / 180); // the steepest slope loose sand holds
const MAX_NODES = 111000;  // grid budget (about 0.45 m cells over 150 m)
const BORDER = 4;          // m: a locked band along the edge that meets the static terrain exactly
const MAX_DIG = 3.3;       // m below base: the static terrain waits 4 m under the field
const TILE = 30;           // m: target size of a collider tile / mesh chunk
const TERRAIN = 260;       // level.buildTerrain's plane: our uvs continue its ripples seamlessly
const DRY = 75;            // s: freshly turned sand dries back to its base colour
const WIND = 170;          // s: e-folding time of the wind filling scars back in
const GRAV = 26;           // the dream's gravity (TUNE.gravity)
const FLOW_EPS = 0.004;    // m of excess slope below which sand stays put
const PRINT_S = 1536;      // imprint texture: texels per side...
const PRINT_T = 0.03;      // ...at 3 cm each: a 46 m window around the player
const PRINT_DEPTH = 0.045; // m: how deep a full-strength imprint reads in the shader
const PRINT_BUCKET = 4;    // s per age code in the imprint texture
const PRINT_LIFE = 300;    // s: imprints are gone well before this and get cleared
const LIFT_PROBES = [[0, 0], [0.6, 0], [-0.6, 0], [0, 0.6], [0, -0.6], [0.85, 0], [-0.85, 0], [0, 0.85], [0, -0.85]];
const FIX = RAPIER.HeightFieldFlags ? RAPIER.HeightFieldFlags.FIX_INTERNAL_EDGES : undefined;

const P_SMOOTH = (q) => { const k = 1 - q * q; return k * k; };  // soft dent, zero slope at the edge
const P_BOWL = (q) => 1 - q * q * q * q;                            // crater: steep walls that then slump
const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const rand = (a, b) => a + Math.random() * (b - a);
const _c = new THREE.Color();
const _c2 = new THREE.Color();
const _n = new THREE.Vector3();
const _n2 = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();

// one imprint texture shared by every field (only one sand layer exists at a time)
let SHARED_PRINT = null;

// ---------------------------------------------------------------- ballistic grains / clumps
// CPU-simulated, drawn as a lit InstancedMesh (sand is matte and does not glow).
class Pool {
  constructor(sand, max, geo, rough) {
    this.sand = sand; this.max = max; this.n = 0;
    this.p = new Float32Array(max * 3); this.v = new Float32Array(max * 3);
    this.c = new Float32Array(max * 3); this.s = new Float32Array(max);
    this.life = new Float32Array(max); this.vol = new Float32Array(max); this.spin = new Float32Array(max);
    // lit like the sand itself (image-based light included), matte, no glow
    const mat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 1, metalness: 0 });
    mat.name = 'SandGrain';
    const mesh = this.mesh = new THREE.InstancedMesh(geo, mat, max);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3);
    mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    mesh.count = 0; mesh.frustumCulled = false; mesh.castShadow = false; mesh.receiveShadow = false;
    mesh.userData.noAO = true;
    this.rough = rough;
    sand.level.group.add(mesh);
  }
  spawn(x, y, z, vx, vy, vz, size, col, life = 2.5, vol = 0) {
    if (this.n >= this.max) return false;
    const i = this.n++, i3 = i * 3;
    this.p[i3] = x; this.p[i3 + 1] = y; this.p[i3 + 2] = z;
    this.v[i3] = vx; this.v[i3 + 1] = vy; this.v[i3 + 2] = vz;
    this.c[i3] = col.r; this.c[i3 + 1] = col.g; this.c[i3 + 2] = col.b;
    this.s[i] = size; this.life[i] = life; this.vol[i] = vol; this.spin[i] = Math.random() * 6.28;
    return true;
  }
  kill(i) { // swap-remove keeps the live set packed for drawing
    const j = --this.n;
    if (i === j) return;
    const i3 = i * 3, j3 = j * 3;
    for (let k = 0; k < 3; k++) { this.p[i3 + k] = this.p[j3 + k]; this.v[i3 + k] = this.v[j3 + k]; this.c[i3 + k] = this.c[j3 + k]; }
    this.s[i] = this.s[j]; this.life[i] = this.life[j]; this.vol[i] = this.vol[j]; this.spin[i] = this.spin[j];
  }
  update(dt, onLand) {
    const S = this.sand, P = this.p, V = this.v, sea = S.seaY;
    const drag = Math.exp(-dt * (this.rough ? 0.25 : 0.9));
    for (let i = this.n - 1; i >= 0; i--) {
      const i3 = i * 3;
      this.life[i] -= dt;
      V[i3 + 1] -= GRAV * dt;
      V[i3] *= drag; V[i3 + 2] *= drag;
      P[i3] += V[i3] * dt; P[i3 + 1] += V[i3 + 1] * dt; P[i3 + 2] += V[i3 + 2] * dt;
      this.spin[i] += dt * 7;
      const gy = S.height(P[i3], P[i3 + 2]);
      if (P[i3 + 1] <= gy || P[i3 + 1] < sea) { if (onLand) onLand(i, Math.max(gy, sea)); this.kill(i); continue; }
      if (this.life[i] <= 0) { if (onLand) onLand(i, gy); this.kill(i); }
    }
    const M = this.mesh.instanceMatrix.array, C = this.mesh.instanceColor.array;
    for (let i = 0; i < this.n; i++) {
      const i3 = i * 3, o = i * 16, s = this.s[i];
      if (this.rough) { // tumbling clods
        _q.setFromAxisAngle(_n.set(0.6, 0.7, 0.38), this.spin[i]);
        _m.compose(_p.set(P[i3], P[i3 + 1], P[i3 + 2]), _q, _s.set(s, s * 0.8, s));
        _m.toArray(M, o);
      } else {
        M[o] = s; M[o + 1] = 0; M[o + 2] = 0; M[o + 3] = 0;
        M[o + 4] = 0; M[o + 5] = s; M[o + 6] = 0; M[o + 7] = 0;
        M[o + 8] = 0; M[o + 9] = 0; M[o + 10] = s; M[o + 11] = 0;
        M[o + 12] = P[i3]; M[o + 13] = P[i3 + 1]; M[o + 14] = P[i3 + 2]; M[o + 15] = 1;
      }
      C[i3] = this.c[i3]; C[i3 + 1] = this.c[i3 + 1]; C[i3 + 2] = this.c[i3 + 2];
    }
    const im = this.mesh.instanceMatrix, ic = this.mesh.instanceColor;
    if (this.n || this.mesh.count) {
      im.clearUpdateRanges(); ic.clearUpdateRanges();
      if (this.n) { im.addUpdateRange(0, this.n * 16); ic.addUpdateRange(0, this.n * 3); }
      im.needsUpdate = true; ic.needsUpdate = true;
    }
    this.mesh.count = this.n;
  }
}

// ---------------------------------------------------------------- the imprint texture
// RG8, world-anchored and toroidal: texel (tx, tz) of the world lives at (tx mod S, tz mod S).
// R holds a signed imprint (128 = untouched, above = pressed in, below = pushed up),
// G the age bucket it was made in, so the shader fades old prints without re-uploads.
class PrintMap {
  constructor() {
    const S = this.S = PRINT_S;
    this.T = PRINT_T;
    this.data = new Uint8Array(S * S * 2);
    this.tex = new THREE.DataTexture(this.data, S, S, THREE.RGFormat, THREE.UnsignedByteType);
    this.tex.wrapS = this.tex.wrapT = THREE.RepeatWrapping;
    this.tex.magFilter = this.tex.minFilter = THREE.LinearFilter;
    this.tex.generateMipmaps = false;
    this.reset();
  }
  reset() {
    const D = this.data;
    for (let i = 0; i < D.length; i += 2) { D[i] = 128; D[i + 1] = 0; }
    this.tex.needsUpdate = true;
    this.ox = null; this.oz = null;
    this.dirty = null;
    this.ring = []; this.head = 0;
  }
  // keep the window centred on the focus; clear the strips that scroll in
  follow(x, z) {
    const S = this.S, step = 128;
    const ox = Math.floor((x / this.T - S / 2) / step) * step, oz = Math.floor((z / this.T - S / 2) / step) * step;
    if (this.ox === null) { this.ox = ox; this.oz = oz; return; }
    if (ox !== this.ox) {
      const a = Math.min(ox, this.ox), b = Math.max(ox, this.ox);
      const from = ox > this.ox ? a : a + S; // the world columns leaving the window
      this.clearCols(from, Math.min(b - a, S));
      this.ox = ox;
    }
    if (oz !== this.oz) {
      const a = Math.min(oz, this.oz), b = Math.max(oz, this.oz);
      const from = oz > this.oz ? a : a + S;
      this.clearRows(from, Math.min(b - a, S));
      this.oz = oz;
    }
  }
  clearCols(tx0, w) {
    const S = this.S, D = this.data;
    for (let k = 0; k < w; k++) {
      const sx = ((tx0 + k) % S + S) % S;
      for (let sz = 0; sz < S; sz++) { const i = (sz * S + sx) * 2; D[i] = 128; D[i + 1] = 0; }
    }
    this.markStore(((tx0 % S) + S) % S, 0, w, S);
  }
  clearRows(tz0, w) {
    const S = this.S, D = this.data;
    for (let k = 0; k < w; k++) {
      const sz = ((tz0 + k) % S + S) % S;
      D.fill(0, sz * S * 2, (sz + 1) * S * 2);
      for (let sx = 0; sx < S; sx++) D[(sz * S + sx) * 2] = 128;
    }
    this.markStore(0, ((tz0 % S) + S) % S, S, w);
  }
  // dirty rects are kept in storage coordinates; a rect may wrap, so split it
  markStore(sx, sz, w, h) {
    const S = this.S;
    const xs = sx + w > S ? [[sx, S - sx], [0, sx + w - S]] : [[sx, w]];
    const zs = sz + h > S ? [[sz, S - sz], [0, sz + h - S]] : [[sz, h]];
    this.dirty = this.dirty || [];
    for (const [x, ww] of xs) for (const [z, hh] of zs) this.dirty.push([x, z, x + ww, z + hh]);
  }
  code(time) { return 1 + (Math.floor(time / PRINT_BUCKET) % 255); }
  // stamp a shape: fn(dx, dz) -> signed strength (-1..1) relative to (cx, cz)
  stamp(cx, cz, ext, fn, time, strength = 1) {
    if (this.ox === null) return;
    const S = this.S, T = this.T, D = this.data;
    const tx0 = Math.max(this.ox, Math.floor((cx - ext) / T)), tx1 = Math.min(this.ox + S - 1, Math.ceil((cx + ext) / T));
    const tz0 = Math.max(this.oz, Math.floor((cz - ext) / T)), tz1 = Math.min(this.oz + S - 1, Math.ceil((cz + ext) / T));
    if (tx0 > tx1 || tz0 > tz1) return;
    const code = this.code(time);
    for (let tz = tz0; tz <= tz1; tz++) {
      const sz = ((tz % S) + S) % S, wz = (tz + 0.5) * T - cz;
      for (let tx = tx0; tx <= tx1; tx++) {
        const s = fn((tx + 0.5) * T - cx, wz) * strength;
        if (s < 0.02 && s > -0.02) continue;
        const i = (sz * S + (((tx % S) + S) % S)) * 2;
        const old = D[i + 1] ? (D[i] - 128) / 127 : 0;
        let ns;
        if (s > 0) ns = Math.max(old, s);               // pressing in wins
        else if (old <= 0) ns = Math.min(old, s);       // a rim only where nothing is pressed
        else continue;
        D[i] = 128 + Math.round(Math.max(-1, Math.min(1, ns)) * 127);
        D[i + 1] = code;
      }
    }
    const sx = ((tx0 % S) + S) % S, sz = ((tz0 % S) + S) % S;
    this.markStore(sx, sz, tx1 - tx0 + 1, tz1 - tz0 + 1);
    this.ring.push({ tx0, tz0, tx1, tz1, code, t: time });
  }
  // prints older than PRINT_LIFE are cleared before their age code wraps around
  expire(time) {
    const S = this.S, D = this.data;
    let n = 0;
    while (this.head < this.ring.length && this.ring[this.head].t < time - PRINT_LIFE && n < 8) {
      const r = this.ring[this.head++]; n++;
      for (let tz = r.tz0; tz <= r.tz1; tz++) {
        const sz = ((tz % S) + S) % S;
        for (let tx = r.tx0; tx <= r.tx1; tx++) {
          const i = (sz * S + (((tx % S) + S) % S)) * 2;
          if (D[i + 1] === r.code) { D[i] = 128; D[i + 1] = 0; }
        }
      }
      this.markStore(((r.tx0 % S) + S) % S, ((r.tz0 % S) + S) % S, r.tx1 - r.tx0 + 1, r.tz1 - r.tz0 + 1);
    }
    if (this.head > 512) { this.ring.splice(0, this.head); this.head = 0; }
  }
  // upload only the touched texels, straight through GL (three's copyTextureToTexture reads back
  // pixel-store state with getParameter, which can stall); falls back to it if internals differ
  flush(renderer) {
    if (!this.dirty || !renderer) return;
    const S = this.S;
    let rects = this.dirty;
    this.dirty = null;
    if (rects.length > 24) rects = [[0, 0, S, S]];
    const props = renderer.properties?.get(this.tex);
    const glTex = props && props.__webglTexture;
    if (!glTex || props.__version !== this.tex.version) { renderer.initTexture(this.tex); return; } // a full upload covers it
    const gl = renderer.getContext();
    if (!renderer.state?.bindTexture || typeof gl.texSubImage2D !== 'function' || !gl.UNPACK_ROW_LENGTH) {
      for (const [x0, z0, x1, z1] of rects) if (x1 > x0 && z1 > z0) renderer.copyTextureToTexture(this.tex, this.tex, new THREE.Box2(new THREE.Vector2(x0, z0), new THREE.Vector2(x1, z1)), new THREE.Vector2(x0, z0));
      return;
    }
    renderer.state.bindTexture(gl.TEXTURE_2D, glTex); // through three's state cache, so it stays truthful
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.pixelStorei(gl.UNPACK_ROW_LENGTH, S);
    for (const [x0, z0, x1, z1] of rects) {
      if (x1 <= x0 || z1 <= z0) continue;
      gl.pixelStorei(gl.UNPACK_SKIP_PIXELS, x0);
      gl.pixelStorei(gl.UNPACK_SKIP_ROWS, z0);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, x0, z0, x1 - x0, z1 - z0, gl.RG, gl.UNSIGNED_BYTE, this.data);
    }
    // three.js assumes these are zero between its own uploads
    gl.pixelStorei(gl.UNPACK_ROW_LENGTH, 0);
    gl.pixelStorei(gl.UNPACK_SKIP_PIXELS, 0);
    gl.pixelStorei(gl.UNPACK_SKIP_ROWS, 0);
  }
}

// imprint shapes (local frame: a = along the direction of travel, b = across)
function footShape(a, b) {
  const heel = Math.hypot((a + 0.115) / 0.078, b / 0.064), toe = Math.hypot((a - 0.06) / 0.12, b / 0.076);
  const q = Math.min(heel, toe * 1.02);
  if (q < 1) return 0.45 + 0.55 * smooth(1, 0.6, q);
  // the rim: sand squeezed up around the print, thrown a little further off the toe
  const rim = a > 0.1 ? 0.55 : 0.35;
  if (q < 1.6) return -rim * (1 - Math.abs(q - 1.22) / 0.38);
  return 0;
}

// ---------------------------------------------------------------- the field
export class SandField {
  // level.heightAt(x, z) is the undisturbed base shape. The field covers a
  // square of side `size` metres centred on `center`, at `cell` metres per cell.
  // It adds its meshes to level.group (cleared with the level) and its colliders
  // to the physics world as G.WORLD (freed with the world).
  constructor(game, level, { size = 150, cell = 0.4, center = new THREE.Vector3() } = {}) {
    const t0 = performance.now();
    this.game = game; this.level = level;
    this.size = size; this.center = center.clone();
    let n = Math.max(8, Math.round(size / cell));
    n = Math.min(n, Math.floor(Math.sqrt(MAX_NODES)) - 1);
    this.n = n; this.V = n + 1;
    this.cell = size / n; this.inv = 1 / this.cell;
    this.x0 = center.x - size / 2; this.z0 = center.z - size / 2;
    this.active = false;   // true once this field owns the surface inside its square
    this.imprints = true;  // real footprints: level.footprints() stands down
    this.time = 0;
    this.windOn = true;
    this.seaY = -1e9;
    this.stats = { ms: 0, peak: 0, colliders: 0, colliderMs: 0, meshMs: 0, lost: 0, frames: 0 };

    const V = this.V, N = V * V;
    this.base = new Float32Array(N);
    this.h = new Float32Array(N);
    this.lock = new Uint8Array(N);        // 1 building footprint, 2 border band, 3 under an anchored thing
    this.fresh = new Float32Array(N).fill(-1e5); // when each node was last turned over
    this.occ = new Uint8Array(N);         // under a dynamic thing this frame: sand may dig out, never pile in
    this.occList = [];
    const bn = Math.round(BORDER * this.inv);
    for (let iz = 0; iz < V; iz++) {
      const z = this.z0 + iz * this.cell;
      for (let ix = 0; ix < V; ix++) {
        const i = iz * V + ix;
        const b = level.heightAt(this.x0 + ix * this.cell, z);
        this.base[i] = b; this.h[i] = b;
        if (ix < bn || iz < bn || ix > n - bn || iz > n - bn) this.lock[i] = 2;
      }
    }

    // tiles: collider + mesh chunk
    const K = Math.max(1, Math.round(size / TILE));
    const tc = this.tc = Math.ceil(n / K);
    this.K = Math.ceil(n / tc);
    this.tiles = [];
    this.body = game.physics.fixed({ x: 0, y: 0, z: 0 });
    level.bodies?.push(this.body);
    this.handles = new Set();
    this.mat = this.makeMaterial();
    for (let tz = 0; tz < this.K; tz++) for (let tx = 0; tx < this.K; tx++) {
      const a0 = tx * tc, a1 = Math.min(n, a0 + tc), b0 = tz * tc, b1 = Math.min(n, b0 + tc);
      const t = { tx, tz, a0, a1, b0, b1, cw: a1 - a0, ch: b1 - b0, dirty: null, colDirty: 0, colErr: 0, scar: false, windT: 0, hf: null, col: null };
      this.tiles.push(t);
      this.buildChunk(t);
      this.buildCollider(t);
    }
    // ray queries (level.groundY while the level is built) see the sand straight away
    game.physics.world.updateSceneQueries?.();

    // grains, clods and the imprint texture
    const low = game.render?.qualityName === 'low';
    this.grains = new Pool(this, low ? 1400 : 2600, new THREE.OctahedronGeometry(1, 0), false);
    this.clumps = new Pool(this, 360, new THREE.DodecahedronGeometry(1, 0), true);
    this.print = SHARED_PRINT || (SHARED_PRINT = new PrintMap());
    this.print.reset();
    this.uniforms.uPrint.value = this.print.tex;
    game.render?.renderer?.initTexture(this.print.tex); // the full upload happens while loading

    this.resleep = [];        // sleepers a collider rebuild will have disturbed for nothing
    this.quick = [];          // quicksand patches (melting rounds in the sand)
    this.victims = new Map(); // enemies it has caught
    this.relax = [];          // regions still avalanching
    this.sinks = new Map();   // body handle -> settling state
    this.rounds = new Map();  // live rounds -> last known flight (to see them hit the sand)
    this.slide = null; this.windCur = 0; this.frame = 0; this.budget = 0;
    this.sink = 0;
    this.active = true;
    this.stats.buildMs = performance.now() - t0;
  }

  // ------------------------------------------------------------ queries
  contains(x, z) {
    const h = this.size / 2;
    return Math.abs(x - this.center.x) < h && Math.abs(z - this.center.z) < h;
  }
  isSand(collider) { return !!collider && this.handles.has(collider.handle); }

  // current surface height (base + deformation), on the same triangles as the collider
  height(x, z) {
    const fx = (x - this.x0) * this.inv, fz = (z - this.z0) * this.inv;
    const n = this.n;
    if (!(fx >= 0 && fz >= 0 && fx <= n && fz <= n)) return this.level.heightAt(x, z);
    let ix = Math.floor(fx), iz = Math.floor(fz);
    if (ix >= n) ix = n - 1; if (iz >= n) iz = n - 1;
    const u = fx - ix, v = fz - iz, V = this.V, H = this.h, i = iz * V + ix;
    // Rapier splits each cell along the (x+1, z)-(x, z+1) diagonal
    if (u + v <= 1) return H[i] + (H[i + 1] - H[i]) * u + (H[i + V] - H[i]) * v;
    const d = H[i + V + 1];
    return d + (H[i + V] - d) * (1 - u) + (H[i + 1] - d) * (1 - v);
  }
  // smoothed surface normal from the grid
  normalAt(x, z, out = new THREE.Vector3()) {
    const e = this.cell;
    return out.set(this.height(x - e, z) - this.height(x + e, z), 2 * e, this.height(x, z - e) - this.height(x, z + e)).normalize();
  }
  lockedAt(x, z) {
    const ix = Math.round((x - this.x0) * this.inv), iz = Math.round((z - this.z0) * this.inv);
    if (ix < 0 || iz < 0 || ix > this.n || iz > this.n) return true;
    return this.lock[iz * this.V + ix] === 1;
  }
  // is the player standing on the sand itself (not a rock, roof, floor or platform)?
  onSand(p) {
    if (!p || !this.contains(p.pos.x, p.pos.z) || p.groundEntity) return false;
    const gap = p.pos.y - this.height(p.pos.x, p.pos.z);
    if (gap < -0.3 || gap > 0.5 || this.lockedAt(p.pos.x, p.pos.z)) return false;
    // on a slope the capsule's round bottom rides higher above the point under its centre
    const ny = this.normalAt(p.pos.x, p.pos.z, _n2).y;
    return gap < 0.17 + (p.r || 0.34) * (1 / Math.max(0.5, ny) - 1);
  }
  // how much deformation the field holds (node-metres, for tests: stays constant without wind)
  volume() {
    let s = 0;
    for (let i = 0; i < this.h.length; i++) s += this.h[i] - this.base[i];
    for (const P of [this.clumps]) for (let k = 0; k < P.n; k++) s += P.vol[k];
    return s;
  }

  // ------------------------------------------------------------ building
  makeMaterial() {
    const src = this.level.sandMat;
    const mat = src ? src.clone() : new THREE.MeshStandardMaterial({ roughness: 0.94, metalness: 0 });
    mat.vertexColors = true;
    // where the field overlaps the static terrain's edge band, the field wins
    mat.polygonOffset = true; mat.polygonOffsetFactor = -1; mat.polygonOffsetUnits = -2;
    const U = this.uniforms = {
      uSandTime: { value: 0 }, uPrint: { value: null },
      uPrintWin: { value: new THREE.Vector4(0, 0, PRINT_S * PRINT_T, PRINT_S) }, uPrintCode: { value: 1 }, uQuick: { value: [0, 1, 2, 3].map(() => new THREE.Vector4()) },
    };
    mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, U);
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', `#include <common>
          attribute float aFresh; uniform float uSandTime; varying float vFresh; varying vec3 vSandW;`)
        .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
          vSandW = (modelMatrix * vec4(transformed, 1.0)).xyz;
          vFresh = exp(-max(uSandTime - aFresh, 0.0) / ${DRY.toFixed(1)});`);
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>
          uniform sampler2D uPrint; uniform vec4 uPrintWin; uniform float uPrintCode; uniform vec4 uQuick[4]; uniform float uSandTime;
          varying float vFresh; varying vec3 vSandW;`)
        .replace('#include <color_fragment>', `#include <color_fragment>
          // imprints: sampled once here, used for colour now and for the normal below
          float sandPS = 0.0; vec2 sandPG = vec2(0.0);
          {
            vec2 rel = vSandW.xz - uPrintWin.xy;
            float edge = min(min(rel.x, rel.y), min(uPrintWin.z - rel.x, uPrintWin.z - rel.y));
            float vis = smoothstep(0.0, 2.0, edge) * (1.0 - smoothstep(13.0, 23.0, length(vViewPosition)));
            if (vis > 0.001) {
              vec2 uv = vSandW.xz / uPrintWin.z;
              float du = 1.0 / uPrintWin.w;
              vec4 c0 = texture2D(uPrint, uv);
              float code = c0.g * 255.0;
              float age = mod(uPrintCode - code + 255.0, 255.0) * ${PRINT_BUCKET.toFixed(1)};
              float fade = vis * (1.0 - smoothstep(45.0, 220.0, age)) * smoothstep(0.2, 0.8, code);
              float k = 255.0 / 127.0;
              sandPS = (c0.r * 255.0 - 128.0) / 127.0 * fade;
              sandPG = vec2(texture2D(uPrint, uv + vec2(du, 0.0)).r - texture2D(uPrint, uv - vec2(du, 0.0)).r,
                            texture2D(uPrint, uv + vec2(0.0, du)).r - texture2D(uPrint, uv - vec2(0.0, du)).r)
                       * k / (2.0 * ${PRINT_T.toFixed(3)}) * fade;
            }
          }
          // freshly turned sand is darker and cooler until it dries; prints are pressed darker
          diffuseColor.rgb *= mix(vec3(1.0), vec3(0.74, 0.77, 0.86), vFresh * 0.9);
          diffuseColor.rgb *= mix(vec3(1.0), vec3(0.66, 0.66, 0.7), max(sandPS, 0.0)) * (1.0 + 0.1 * max(-sandPS, 0.0));
          // quicksand (melted sand): a dark wet patch that turns slowly, like a drain
          float sandQ = 0.0; vec2 sandQN = vec2(0.0);
          for (int k = 0; k < 4; k++) {
            vec4 Q = uQuick[k];
            if (Q.w <= 0.0) continue;
            vec2 d = vSandW.xz - Q.xy;
            float r = length(d) / Q.z;
            if (r > 1.25) continue;
            float w = Q.w * (1.0 - smoothstep(0.75, 1.2, r));
            float a = atan(d.y, d.x) * 3.0 + r * 9.0 - uSandTime * 2.2;
            sandQN += vec2(cos(a), sin(a)) * w * 0.35 * (1.0 - r * 0.6);
            sandQ = max(sandQ, w);
          }
          diffuseColor.rgb *= mix(vec3(1.0), vec3(0.5, 0.47, 0.44), sandQ);`)
        .replace('#include <normal_fragment_maps>',
          // distant ripples resolve into flat sand (as the static terrain does), then the imprint relief
          THREE.ShaderChunk.normal_fragment_maps.replace('mapN.xy *= normalScale;', 'mapN.xy *= normalScale * (1.0 - 0.85 * smoothstep(16.0, 70.0, length(vViewPosition)));')
          + `
          normal = normalize(normal + mat3(viewMatrix) * vec3(sandPG.x * ${PRINT_DEPTH.toFixed(3)} + sandQN.x, 0.0, sandPG.y * ${PRINT_DEPTH.toFixed(3)} + sandQN.y));
          roughnessFactor = mix(roughnessFactor, 0.45, sandQ * 0.8);`);
    };
    mat.customProgramCacheKey = () => 'sandfield-1';
    return mat;
  }

  buildChunk(t) {
    const { a0, b0, cw, ch } = t, W = cw + 1, H = ch + 1, NV = W * H;
    const pos = new Float32Array(NV * 3), nrm = new Float32Array(NV * 3), col = new Float32Array(NV * 3), uv = new Float32Array(NV * 2), fr = new Float32Array(NV);
    let lo = Infinity, hi = -Infinity;
    for (let lz = 0; lz < H; lz++) for (let lx = 0; lx < W; lx++) {
      const ix = a0 + lx, iz = b0 + lz, i = iz * this.V + ix, v = lz * W + lx;
      const x = this.x0 + ix * this.cell, z = this.z0 + iz * this.cell;
      pos[v * 3] = x; pos[v * 3 + 1] = this.h[i]; pos[v * 3 + 2] = z;
      uv[v * 2] = (x + TERRAIN / 2) / TERRAIN; uv[v * 2 + 1] = (TERRAIN / 2 - z) / TERRAIN;
      this.level.sandColor(x, z, _c);
      col[v * 3] = _c.r; col[v * 3 + 1] = _c.g; col[v * 3 + 2] = _c.b;
      fr[v] = this.fresh[i];
      lo = Math.min(lo, this.base[i]); hi = Math.max(hi, this.base[i]);
    }
    const idx = new (NV > 65535 ? Uint32Array : Uint16Array)(cw * ch * 6);
    let k = 0;
    for (let lz = 0; lz < ch; lz++) for (let lx = 0; lx < cw; lx++) {
      const a = lz * W + lx, b = a + 1, c = a + W, d = c + 1;
      idx[k++] = a; idx[k++] = c; idx[k++] = b; // same diagonal as the collider
      idx[k++] = b; idx[k++] = c; idx[k++] = d;
    }
    const geo = new THREE.BufferGeometry();
    const P = new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage);
    const Nn = new THREE.BufferAttribute(nrm, 3).setUsage(THREE.DynamicDrawUsage);
    const F = new THREE.BufferAttribute(fr, 1).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', P); geo.setAttribute('normal', Nn); geo.setAttribute('aFresh', F);
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3)); geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    // bounds cover everything the sand can become, so culling never needs recomputing
    geo.boundingBox = new THREE.Box3(new THREE.Vector3(pos[0], lo - MAX_DIG, pos[2]), new THREE.Vector3(pos[(NV - 1) * 3], hi + 3, pos[(NV - 1) * 3 + 2]));
    geo.boundingSphere = geo.boundingBox.getBoundingSphere(new THREE.Sphere());
    const mesh = new THREE.Mesh(geo, this.mat);
    mesh.receiveShadow = true; mesh.castShadow = false;
    mesh.name = 'SandField';
    this.level.group.add(mesh);
    Object.assign(t, { geo, mesh, P, N: Nn, F, W });
    this.writeChunk(t, 0, 0, cw, ch);
    P.clearUpdateRanges(); Nn.clearUpdateRanges(); F.clearUpdateRanges(); // the first upload sends it all
  }

  // copy heights, normals and freshness for a rect of the chunk (chunk-local vertex coords)
  writeChunk(t, lx0, lz0, lx1, lz1) {
    const V = this.V, H = this.h, n = this.n, e2 = 2 * this.cell, W = t.W;
    const P = t.P.array, N = t.N.array, F = t.F.array;
    for (let lz = lz0; lz <= lz1; lz++) {
      const iz = t.b0 + lz;
      for (let lx = lx0; lx <= lx1; lx++) {
        const ix = t.a0 + lx, i = iz * V + ix, v = lz * W + lx;
        P[v * 3 + 1] = H[i];
        const hl = H[ix > 0 ? i - 1 : i], hr = H[ix < n ? i + 1 : i], hd = H[iz > 0 ? i - V : i], hu = H[iz < n ? i + V : i];
        let nx = hl - hr, ny = e2, nz = hd - hu;
        const l = 1 / Math.sqrt(nx * nx + ny * ny + nz * nz);
        N[v * 3] = nx * l; N[v * 3 + 1] = ny * l; N[v * 3 + 2] = nz * l;
        F[v] = this.fresh[i];
      }
    }
    const s = lz0 * W + lx0, c = lz1 * W + lx1 - s + 1;
    t.P.addUpdateRange(s * 3, c * 3); t.N.addUpdateRange(s * 3, c * 3); t.F.addUpdateRange(s, c);
    t.P.needsUpdate = true; t.N.needsUpdate = true; t.F.needsUpdate = true;
  }

  buildCollider(t) {
    const { a0, b0, cw, ch } = t, V = this.V, R = ch + 1;
    const hf = t.hf || (t.hf = new Float32Array((cw + 1) * (ch + 1)));
    for (let lx = 0; lx <= cw; lx++) for (let lz = 0; lz <= ch; lz++) hf[lz + lx * R] = this.h[(b0 + lz) * V + a0 + lx];
    const scale = { x: cw * this.cell, y: 1, z: ch * this.cell };
    if (!t.col) {
      const cx = this.x0 + (a0 + cw / 2) * this.cell, cz = this.z0 + (b0 + ch / 2) * this.cell;
      t.col = this.game.physics.collider(RAPIER.ColliderDesc.heightfield(ch, cw, hf, scale, FIX).setTranslation(cx, 0, cz), this.body, G.WORLD, ALL, { friction: 0.9 });
      this.handles.add(t.col.handle);
    } else {
      t.col.setShape(new RAPIER.Heightfield(ch, cw, hf, scale, FIX)); // same collider, new heights: never a gap
    }
  }

  // the surface a tile's collider currently has (its last-built heights), or null outside it
  tileHeight(t, x, z) {
    const fx = (x - this.x0) * this.inv - t.a0, fz = (z - this.z0) * this.inv - t.b0;
    if (!t.hf || fx < 0 || fz < 0 || fx > t.cw || fz > t.ch) return null;
    let lx = Math.floor(fx), lz = Math.floor(fz);
    if (lx >= t.cw) lx = t.cw - 1; if (lz >= t.ch) lz = t.ch - 1;
    const u = fx - lx, v = fz - lz, R = t.ch + 1, H = t.hf;
    const h00 = H[lz + lx * R], h10 = H[lz + (lx + 1) * R], h01 = H[lz + 1 + lx * R], h11 = H[lz + 1 + (lx + 1) * R];
    if (u + v <= 1) return h00 + (h10 - h00) * u + (h01 - h00) * v;
    return h11 + (h01 - h11) * (1 - u) + (h10 - h11) * (1 - v);
  }

  // a building footprint: never deforms, and sand treats it as a wall
  lockRect(cx, cz, halfW, halfD, rotY = 0) {
    const c = Math.cos(rotY), s = Math.sin(rotY), r = Math.hypot(halfW, halfD);
    const [ix0, iz0, ix1, iz1] = this.range(cx, cz, r);
    for (let iz = iz0; iz <= iz1; iz++) for (let ix = ix0; ix <= ix1; ix++) {
      const dx = this.x0 + ix * this.cell - cx, dz = this.z0 + iz * this.cell - cz;
      const lx = dx * c - dz * s, lz = dx * s + dz * c;
      if (Math.abs(lx) <= halfW && Math.abs(lz) <= halfD) { const i = iz * this.V + ix; if (!this.lock[i]) this.lock[i] = 1; }
    }
  }

  // anchored things standing in the sand (walls, columns, rocks, mirrors...) hold the sand under
  // them: it neither digs out from under them nor flows beneath. Refreshed every second, so a
  // wall that is smashed or knocked loose lets go of its footprint.
  lockAnchors() {
    const L = this.lock, A = this.anchorNodes || (this.anchorNodes = []);
    for (const i of A) if (L[i] === 3) L[i] = 0;
    A.length = 0;
    const inv = new THREE.Matrix4(), c = new THREE.Vector3(), lo = new THREE.Vector3(), hi = new THREE.Vector3();
    for (const e of this.game.entities) {
      if (e.dead || !e.body || !e.body.isFixed || !e.body.isFixed() || !e.localBox || e.kind === 'enemy' || e.kind === 'boss') continue;
      const o = e.obj;
      o.updateMatrixWorld(true);
      const bb = e.localBox;
      lo.set(Infinity, Infinity, Infinity); hi.set(-Infinity, -Infinity, -Infinity);
      for (let k = 0; k < 8; k++) {
        c.set(k & 1 ? bb.max.x : bb.min.x, k & 2 ? bb.max.y : bb.min.y, k & 4 ? bb.max.z : bb.min.z).applyMatrix4(o.matrixWorld);
        lo.min(c); hi.max(c);
      }
      const cx = (lo.x + hi.x) / 2, cz = (lo.z + hi.z) / 2;
      if (!this.contains(cx, cz) || lo.y > this.height(cx, cz) + 0.35) continue; // not standing in the sand
      inv.copy(o.matrixWorld).invert();
      const [ix0, iz0] = this.range(lo.x, lo.z, 0), [, , ix1, iz1] = this.range(hi.x, hi.z, 0);
      const m = 0.12 / Math.max(0.01, o.scale.x);
      for (let iz = iz0; iz <= iz1; iz++) for (let ix = ix0; ix <= ix1; ix++) {
        const i = iz * this.V + ix;
        if (L[i]) continue;
        c.set(this.x0 + ix * this.cell, this.base[i], this.z0 + iz * this.cell).applyMatrix4(inv);
        if (c.x > bb.min.x - m && c.x < bb.max.x + m && c.z > bb.min.z - m && c.z < bb.max.z + m) { L[i] = 3; A.push(i); }
      }
    }
  }

  // Nodes under movable things (props, anvils, sleepwalkers) take no sand in: a rim or an
  // avalanche piling up around an anvil's ends would bury them in the heightfield, and a body
  // caught inside a heightfield can be pushed out through the bottom. Digging under them is fine.
  markOccupied() {
    const O = this.occ, list = this.occList;
    for (const i of list) O[i] = 0;
    list.length = 0;
    for (const e of this.game.entities) {
      if (e.dead || !e.body || !e.body.isDynamic() || !e.center) continue;
      const c = e.center(_p);
      if (!this.contains(c.x, c.z)) continue;
      const ey = e.extent ? e.extent.y : 0.5, top = this.height(c.x, c.z);
      if (c.y + ey < top - 0.15 && !this.victims.has(e) && !this.lockedAt(c.x, c.z)) {
        // wholly under the sand (tunnelled, or buried by a rebuild): back on top of it
        const q = e.body.translation(), v = e.body.linvel();
        e.body.setTranslation({ x: q.x, y: q.y + (top - (c.y - ey)) + 0.05, z: q.z }, true);
        e.body.setLinvel({ x: v.x * 0.3, y: 0, z: v.z * 0.3 }, true);
        this.stats.rescues = (this.stats.rescues || 0) + 1;
        continue;
      }
      if (c.y - ey - top > 1.0) continue;
      const r = Math.min(1.6, e.radius() * 0.9);
      const [ix0, iz0, ix1, iz1] = this.range(c.x, c.z, r);
      const fx = (c.x - this.x0) * this.inv, fz = (c.z - this.z0) * this.inv, rr = (r * this.inv) ** 2;
      for (let iz = iz0; iz <= iz1; iz++) for (let ix = ix0; ix <= ix1; ix++) {
        if ((ix - fx) ** 2 + (iz - fz) ** 2 > rr) continue;
        const i = iz * this.V + ix;
        if (!O[i]) { O[i] = 1; list.push(i); }
      }
    }
  }

  // ------------------------------------------------------------ core operations (all conserve sand)
  range(x, z, r) {
    const fx = (x - this.x0) * this.inv, fz = (z - this.z0) * this.inv, rr = r * this.inv;
    return [Math.max(0, Math.ceil(fx - rr)), Math.max(0, Math.ceil(fz - rr)), Math.min(this.n, Math.floor(fx + rr)), Math.min(this.n, Math.floor(fz + rr))];
  }
  // lower a disc by depth * profile; returns the node-metres removed
  dig(x, z, r, depth, prof = P_SMOOTH) {
    const [ix0, iz0, ix1, iz1] = this.range(x, z, r);
    if (ix0 > ix1 || iz0 > iz1) return 0;
    const fx = (x - this.x0) * this.inv, fz = (z - this.z0) * this.inv, ir2 = 1 / (r * this.inv) ** 2;
    const H = this.h, B = this.base, L = this.lock, V = this.V;
    let vol = 0;
    for (let iz = iz0; iz <= iz1; iz++) for (let ix = ix0; ix <= ix1; ix++) {
      const q = ((ix - fx) ** 2 + (iz - fz) ** 2) * ir2;
      if (q >= 1) continue;
      const i = iz * V + ix;
      if (L[i]) continue;
      const d = Math.min(depth * prof(Math.sqrt(q)), H[i] - (B[i] - MAX_DIG));
      if (d <= 0) continue;
      H[i] -= d; vol += d;
    }
    if (vol > 0) this.touch(ix0, iz0, ix1, iz1);
    return vol;
  }
  // press a disc down to (ref - depth * profile) where it stands higher: a resting object's footprint
  press(x, z, r, ref, depth) {
    const [ix0, iz0, ix1, iz1] = this.range(x, z, r);
    if (ix0 > ix1 || iz0 > iz1) return 0;
    const fx = (x - this.x0) * this.inv, fz = (z - this.z0) * this.inv, ir2 = 1 / (r * this.inv) ** 2;
    const H = this.h, B = this.base, L = this.lock, V = this.V;
    let vol = 0;
    for (let iz = iz0; iz <= iz1; iz++) for (let ix = ix0; ix <= ix1; ix++) {
      const q = ((ix - fx) ** 2 + (iz - fz) ** 2) * ir2;
      if (q >= 1) continue;
      const i = iz * V + ix;
      if (L[i]) continue;
      const target = Math.max(B[i] - MAX_DIG, ref - depth * (1 - smooth(0.7, 1, Math.sqrt(q))));
      const d = H[i] - target;
      if (d <= 0) continue;
      H[i] -= d; vol += d;
    }
    if (vol > 0) this.touch(ix0, iz0, ix1, iz1);
    return vol;
  }
  // spread vol over an annulus (a rim), optionally biased to the sides of a direction of travel;
  // returns whatever found no unlocked sand to land on
  deposit(x, z, rIn, rOut, vol, dir = null, side = 0) {
    if (vol <= 0) return 0;
    const [ix0, iz0, ix1, iz1] = this.range(x, z, rOut);
    if (ix0 > ix1 || iz0 > iz1) return vol;
    const fx = (x - this.x0) * this.inv, fz = (z - this.z0) * this.inv;
    const ri = rIn * this.inv, ro = rOut * this.inv, rp = ri + (ro - ri) * 0.3;
    const L = this.lock, V = this.V, H = this.h;
    const w = (ix, iz) => {
      const dx = ix - fx, dz = iz - fz, d = Math.sqrt(dx * dx + dz * dz);
      if (d >= ro || d <= ri * 0.7) return 0;
      let k = d < rp ? smooth(ri * 0.7, rp, d) : 1 - smooth(rp, ro, d);
      if (dir && d > 1e-4) { const cr = (dx * dir.z - dz * dir.x) / d; k *= 1 - side + side * 2 * cr * cr; }
      return k;
    };
    const O = this.occ;
    let sum = 0;
    for (let iz = iz0; iz <= iz1; iz++) for (let ix = ix0; ix <= ix1; ix++) { const i = iz * V + ix; if (!L[i] && !O[i]) sum += w(ix, iz); }
    if (sum <= 1e-6) return vol;
    const k = vol / sum;
    for (let iz = iz0; iz <= iz1; iz++) for (let ix = ix0; ix <= ix1; ix++) {
      const i = iz * V + ix;
      if (!L[i] && !O[i]) H[i] += k * w(ix, iz);
    }
    this.touch(ix0, iz0, ix1, iz1);
    return 0;
  }
  // a mound of vol centred on (x, z): where clumps land. Looks further out if it lands on a lock.
  blob(x, z, rad, vol) {
    if (vol <= 0) return 0;
    for (let r = Math.max(rad, this.cell * 1.3), tries = 0; tries < 4; r *= 2, tries++) {
      const [ix0, iz0, ix1, iz1] = this.range(x, z, r);
      if (ix0 > ix1 || iz0 > iz1) break;
      const fx = (x - this.x0) * this.inv, fz = (z - this.z0) * this.inv, ir2 = 1 / (r * this.inv) ** 2;
      let sum = 0;
      for (let iz = iz0; iz <= iz1; iz++) for (let ix = ix0; ix <= ix1; ix++) {
        const q = ((ix - fx) ** 2 + (iz - fz) ** 2) * ir2;
        const i = iz * this.V + ix;
        if (q < 1 && !this.lock[i] && !this.occ[i]) sum += P_SMOOTH(Math.sqrt(q));
      }
      if (sum <= 1e-6) continue;
      const k = vol / sum;
      for (let iz = iz0; iz <= iz1; iz++) for (let ix = ix0; ix <= ix1; ix++) {
        const q = ((ix - fx) ** 2 + (iz - fz) ** 2) * ir2, i = iz * this.V + ix;
        if (q < 1 && !this.lock[i] && !this.occ[i]) this.h[i] += k * P_SMOOTH(Math.sqrt(q));
      }
      this.touch(ix0, iz0, ix1, iz1);
      this.relaxAdd(ix0 - 2, iz0 - 2, ix1 + 2, iz1 + 2);
      return 0;
    }
    this.stats.lost += vol;
    return vol;
  }
  // mark nodes changed: mesh rows to upload, a collider tile to rebuild, a scar for the wind
  touch(ix0, iz0, ix1, iz1, urgent = 2, amount = Infinity) {
    ix0 = Math.max(0, ix0 - 1); iz0 = Math.max(0, iz0 - 1); ix1 = Math.min(this.n, ix1 + 1); iz1 = Math.min(this.n, iz1 + 1);
    const tc = this.tc, K = this.K;
    const tx0 = Math.max(0, Math.floor((ix0 - 1) / tc)), tx1 = Math.min(K - 1, Math.floor(ix1 / tc));
    const tz0 = Math.max(0, Math.floor((iz0 - 1) / tc)), tz1 = Math.min(K - 1, Math.floor(iz1 / tc));
    for (let tz = tz0; tz <= tz1; tz++) for (let tx = tx0; tx <= tx1; tx++) {
      const t = this.tiles[tz * K + tx];
      const lx0 = Math.max(0, ix0 - t.a0), lx1 = Math.min(t.cw, ix1 - t.a0), lz0 = Math.max(0, iz0 - t.b0), lz1 = Math.min(t.ch, iz1 - t.b0);
      if (lx0 > lx1 || lz0 > lz1) continue;
      const d = t.dirty;
      if (!d) t.dirty = [lx0, lz0, lx1, lz1];
      else { d[0] = Math.min(d[0], lx0); d[1] = Math.min(d[1], lz0); d[2] = Math.max(d[2], lx1); d[3] = Math.max(d[3], lz1); }
      if (urgent === 2) { // where the collider will really change: only bodies there need waking (the wind's millimetres don't)
        const c = t.cbox;
        if (!c) t.cbox = [ix0, iz0, ix1, iz1];
        else { c[0] = Math.min(c[0], ix0); c[1] = Math.min(c[1], iz0); c[2] = Math.max(c[2], ix1); c[3] = Math.max(c[3], iz1); }
      }
      if (amount !== Infinity && urgent === 2) { // an avalanche step: rebuild once it adds up
        t.colErr += amount;
        t.colDirty = Math.max(t.colDirty, t.colErr >= 0.012 ? 2 : 1);
      } else t.colDirty = Math.max(t.colDirty, urgent);
      if (urgent === 2) t.scar = true;
    }
  }
  // freshly turned sand: strength 1 is a crater's worth, a footstep is a pinch
  freshen(x, z, r, strength = 1) {
    const [ix0, iz0, ix1, iz1] = this.range(x, z, r);
    const fx = (x - this.x0) * this.inv, fz = (z - this.z0) * this.inv, ir2 = 1 / (r * this.inv) ** 2;
    for (let iz = iz0; iz <= iz1; iz++) for (let ix = ix0; ix <= ix1; ix++) {
      const q = ((ix - fx) ** 2 + (iz - fz) ** 2) * ir2;
      if (q >= 1) continue;
      const s = strength * (1 - q * 0.7);
      if (s <= 0.01) continue;
      const i = iz * this.V + ix, st = this.time + DRY * Math.log(s);
      if (st > this.fresh[i]) this.fresh[i] = st;
    }
    this.touch(ix0, iz0, ix1, iz1, 0);
  }

  // ------------------------------------------------------------ public deformation
  // generic deformation: push `depth` metres of sand out of a disc, conserving mass into a rim.
  // opts: rim (fraction to the rim, the rest is thrown as clumps), dir + side (banks to the sides of
  // a direction of travel), throwDir, profile, fresh, spray
  stamp(x, z, radius, depth, opts = {}) {
    if (!this.active || !this.contains(x, z) || radius <= 0 || depth <= 0) return 0;
    const vol = this.dig(x, z, radius, depth, opts.profile || P_SMOOTH);
    if (vol <= 0) return 0;
    const rimFrac = opts.rim === undefined ? 1 : Math.max(0, Math.min(1, +opts.rim || 0));
    let left = vol * (1 - rimFrac);
    left += this.deposit(x, z, radius * 0.9, radius * (opts.rimOut || 1.8), vol * rimFrac, opts.dir, opts.side || 0);
    if (left > 1e-6) this.throwClumps(x, z, radius, left, opts);
    this.freshen(x, z, radius * 1.7, opts.fresh ?? 0.5);
    this.relaxAround(x, z, radius * 2.2);
    return vol;
  }
  // explosions and ground pounds: a steep bowl whose walls then slump, half the sand in a rim
  // and half thrown out in clumps that land as scatter
  crater(x, z, radius, depth, opts = {}) {
    if (!this.active || !this.contains(x, z)) return 0;
    const vol = this.stamp(x, z, radius, depth, { profile: P_BOWL, rim: 1 - (opts.ejecta ?? 0.45), rimOut: 1.75, fresh: 1, speed: opts.speed, big: true });
    this.wake(x, z, radius * 2.2);
    this.spray(x, this.height(x, z), z, 0, 1, 0, Math.round(opts.grains ?? (60 + radius * 55)), { speed: [3, 7 + radius * 1.8], cone: 1.1, size: [0.026, 0.065], radius: radius * 0.8 });
    this.dust(x, this.height(x, z), z, radius, Math.round(4 + radius * 3));
    return vol;
  }
  // an implosion draws sand in: an annulus falls away into a heap in the middle
  heap(x, z, radius, height) {
    if (!this.active || !this.contains(x, z)) return 0;
    let vol = 0;
    const [ix0, iz0, ix1, iz1] = this.range(x, z, radius * 1.6);
    const fx = (x - this.x0) * this.inv, fz = (z - this.z0) * this.inv, rr = radius * this.inv;
    for (let iz = iz0; iz <= iz1; iz++) for (let ix = ix0; ix <= ix1; ix++) {
      const i = iz * this.V + ix;
      const d = Math.hypot(ix - fx, iz - fz) / rr;
      if (this.lock[i] || d < 0.6 || d > 1.6) continue;
      const take = Math.min(height * 0.35 * Math.sin((d - 0.6) * Math.PI), this.h[i] - (this.base[i] - MAX_DIG));
      if (take > 0) { this.h[i] -= take; vol += take; }
    }
    this.touch(ix0, iz0, ix1, iz1);
    this.blob(x, z, radius * 0.7, vol);
    this.freshen(x, z, radius * 1.6, 0.8);
    this.relaxAround(x, z, radius * 2);
    return vol;
  }

  // ------------------------------------------------------------ granular behaviour
  relaxAround(x, z, r) { const [a, b, c, d] = this.range(x, z, r); this.relaxAdd(a, b, c, d); }
  relaxAdd(ix0, iz0, ix1, iz1) {
    ix0 = Math.max(0, ix0); iz0 = Math.max(0, iz0); ix1 = Math.min(this.n, ix1); iz1 = Math.min(this.n, iz1);
    if (ix0 > ix1 || iz0 > iz1) return;
    for (const R of this.relax) {
      if (ix0 <= R[2] + 2 && ix1 >= R[0] - 2 && iz0 <= R[3] + 2 && iz1 >= R[1] - 2) {
        R[0] = Math.min(R[0], ix0); R[1] = Math.min(R[1], iz0); R[2] = Math.max(R[2], ix1); R[3] = Math.max(R[3], iz1); R[4] = 0; R[5] = Math.min(R[5], this.time);
        return;
      }
    }
    this.relax.push([ix0, iz0, ix1, iz1, 0, this.time]);
  }
  // angle-of-repose relaxation over the dirty regions only. A drop is allowed if it is no steeper
  // than the repose angle OR no steeper than the base shape itself there, so the designed dunes,
  // cliff feet and plot edges never erode; only disturbed sand moves. Locks are walls.
  relaxStep() {
    const H = this.h, B = this.base, L = this.lock, O = this.occ, V = this.V, n = this.n;
    const c1 = REPOSE * this.cell, c2 = REPOSE * this.cell * Math.SQRT2, rate = 0.22;
    const nb = [[1, 0, c1], [0, 1, c1], [1, 1, c2], [-1, 1, c2]];
    for (let r = this.relax.length - 1; r >= 0; r--) {
      const R = this.relax[r];
      let moved = 0, bx0 = 1e9, bz0 = 1e9, bx1 = -1, bz1 = -1;
      for (let pass = 0; pass < 2; pass++) {
        for (let iz = R[1]; iz <= R[3]; iz++) for (let ix = R[0]; ix <= R[2]; ix++) {
          const i = iz * V + ix;
          if (L[i] || O[i]) continue;
          for (let k = 0; k < 4; k++) {
            const jx = ix + nb[k][0], jz = iz + nb[k][1];
            if (jx < 0 || jx > n || jz > n) continue;
            const j = jz * V + jx;
            if (L[j] || O[j]) continue;
            const dh = H[i] - H[j], db = B[i] - B[j], lim = nb[k][2];
            let m = 0;
            if (dh > 0) { const ex = dh - (db > lim ? db : lim); if (ex > FLOW_EPS) m = ex * rate; } else { const ex = -dh - (-db > lim ? -db : lim); if (ex > FLOW_EPS) m = -ex * rate; }
            if (m === 0) continue;
            H[i] -= m; H[j] += m;
            const am = m > 0 ? m : -m;
            if (am > moved) moved = am;
            if (ix < bx0) bx0 = ix; if (ix > bx1) bx1 = ix; if (iz < bz0) bz0 = iz; if (iz > bz1) bz1 = iz;
            if (jx < bx0) bx0 = jx; if (jx > bx1) bx1 = jx; if (jz > bz1) bz1 = jz;
          }
        }
      }
      if (bx1 >= 0) {
        this.touch(bx0, bz0, bx1, bz1, 2, moved * 2);
        // flow reached the region's edge: let the avalanche run on
        if (bx0 <= R[0]) R[0] = Math.max(0, R[0] - 2); if (bx1 >= R[2]) R[2] = Math.min(n, R[2] + 2);
        if (bz0 <= R[1]) R[1] = Math.max(0, R[1] - 2); if (bz1 >= R[3]) R[3] = Math.min(n, R[3] + 2);
      }
      R[4] = moved < 2e-4 ? R[4] + 1 : 0;
      // settled, or running on too long / too wide (a steep face shedding a thin film): let it rest
      if (R[4] >= 3 || this.time - R[5] > 8 || (R[2] - R[0]) * (R[3] - R[1]) > 48000) this.relax.splice(r, 1);
    }
  }
  // the wind fills scars back in over minutes: one scarred tile per frame, softening then healing;
  // only the rows and columns that actually moved are re-uploaded
  windStep() {
    if (!this.windOn) return;
    const T = this.tiles, V = this.V, H = this.h, B = this.base, L = this.lock, n = this.n;
    for (let k = 0; k < T.length; k++) {
      this.windCur = (this.windCur + 1) % T.length;
      const t = T[this.windCur];
      if (!t.scar || t.dirty) continue;
      const el = this.time - t.windT;
      if (el < 1.5) continue;
      t.windT = this.time;
      if (el > 8) continue; // first visit after a quiet spell: just start the clock
      const f = Math.exp(-el / WIND), soft = Math.min(0.35, el / 25);
      let maxD = 0, maxC = 0, x0 = 1e9, z0 = 1e9, x1 = -1, z1 = -1;
      for (let iz = t.b0; iz <= t.b1; iz++) for (let ix = t.a0; ix <= t.a1; ix++) {
        const i = iz * V + ix;
        if (L[i]) continue;
        const d = H[i] - B[i];
        if (d < 1e-4 && d > -1e-4) { if (d !== 0) H[i] = B[i]; continue; }
        const nb = (ix > 0 ? H[i - 1] - B[i - 1] : d) + (ix < n ? H[i + 1] - B[i + 1] : d) + (iz > 0 ? H[i - V] - B[i - V] : d) + (iz < n ? H[i + V] - B[i + V] : d);
        const nd = (d + (nb * 0.25 - d) * soft) * f;
        const ad = nd > 0 ? nd : -nd, ac = d - nd > 0 ? d - nd : nd - d;
        if (ad > maxD) maxD = ad;
        if (ac > maxC) maxC = ac;
        if (ix < x0) x0 = ix; if (ix > x1) x1 = ix; if (iz < z0) z0 = iz; if (iz > z1) z1 = iz;
        H[i] = B[i] + nd;
      }
      if (maxD < 0.003) { // healed: snap back to the base shape exactly
        for (let iz = t.b0; iz <= t.b1; iz++) for (let ix = t.a0; ix <= t.a1; ix++) { const i = iz * V + ix; if (!L[i]) H[i] = B[i]; }
        t.scar = false; maxC = Math.max(maxC, 0.003);
      }
      if (maxC > 5e-4 && x1 >= 0) {
        this.touch(x0, z0, x1, z1, 1);
        t.colErr += maxC; // the collider catches up once this is worth a rebuild
      }
      return;
    }
  }

  // ------------------------------------------------------------ bodies
  wake(x, z, r) {
    const ph = this.game.physics;
    for (const col of ph.overlapSphere({ x, y: this.height(x, z), z }, r)) { const b = col.parent(); if (b && b.isDynamic()) b.wakeUp(); }
  }
  // dynamic bodies resting on sand press in: light things a little, heavy things a lot, with a rim
  settle(dt) {
    // a slice of the tiles each frame: every tile is looked at about five times a second
    const world = this.game.physics.world, ph = this.game.physics;
    const T = this.tiles, per = Math.max(1, Math.ceil(T.length / 12));
    const seen = this.settleSeen || (this.settleSeen = new Set());
    for (let k = 0; k < per; k++) {
      this.settleCur = ((this.settleCur ?? -1) + 1) % T.length;
      if (this.settleCur === 0) seen.clear();
      const t = T[this.settleCur];
      const step = Math.min(0.5, this.time - (t.settleT ?? this.time - 0.2));
      t.settleT = this.time;
      world.contactPairsWith(t.col, (other) => { try {
        if (!other) return; // removed this frame; the narrow phase forgets it at the next step
        const b = other.parent();
        if (!b || !b.isDynamic() || seen.has(b.handle)) return;
        seen.add(b.handle);
        const e = ph.ownerOf(other);
        if (e && e.kind === 'enemy') return; // sleepwalkers leave prints instead (see strollers)
        const v = b.linvel();
        if (v.x * v.x + v.y * v.y + v.z * v.z > 0.08) return;
        let n = 0, sx = 0, sz = 0, miny = Infinity;
        const pts = [];
        world.contactPair(t.col, other, (m) => {
          for (let k = 0; k < m.numSolverContacts(); k++) { const p = m.solverContactPoint(k); pts.push(p); sx += p.x; sz += p.z; miny = Math.min(miny, p.y); n++; }
        });
        if (!n) return;
        const cx = sx / n, cz = sz / n;
        let S = this.sinks.get(b.handle);
        if (!S || Math.hypot(S.x - cx, S.z - cz) > 0.3) { S = { x: cx, z: cz, y0: miny, seen: 0, last: miny, pressed: 0, stall: 0, done: false }; this.sinks.set(b.handle, S); }
        S.seen = this.time;
        if (S.done) return;
        let spread = 0;
        for (const p of pts) spread = Math.max(spread, Math.hypot(p.x - cx, p.z - cz));
        const heavy = !!(e && e.props && e.props.has('heavy'));
        const mass = b.mass();
        const maxSink = heavy ? 0.11 : Math.min(0.05, 0.015 + mass * 0.0005);
        const rate = heavy ? 0.3 : 0.06;
        // did the last press let it down? if not (still waiting on its tile, or propped up), give up soon
        if (S.pressed > 0) S.stall = S.last - miny < S.pressed * 0.3 ? S.stall + 1 : 0;
        const dd = Math.min(maxSink - (S.y0 - miny), rate * step);
        if (dd < 0.004 || S.stall >= 3) { S.done = true; return; }
        const R = Math.max(0.3, Math.min(1.6, spread * 1.25 + 0.2));
        const vol = this.press(cx, cz, R, miny, dd);
        S.last = miny; S.pressed = dd;
        if (vol <= 0) return;
        const left = this.deposit(cx, cz, R * 0.95, R * (heavy ? 2.0 : 1.6), vol);
        if (left > 0) this.blob(cx, cz, R * 2, left);
        this.freshen(cx, cz, R * 1.5, heavy ? 0.55 : 0.2);
        this.relaxAround(cx, cz, R * 2.2);
        b.wakeUp();
        if (heavy && dd > 0.02 && Math.random() < 0.5) this.spray(cx, miny, cz, 0, 1, 0, 5, { speed: [0.6, 1.6], cone: 1.3, size: [0.02, 0.04], radius: R });
      } catch (err) { console.warn('sand settle skipped', err); } }); // nothing may unwind through Rapier
    }
    if (this.settleCur === T.length - 1) for (const [h, S] of this.sinks) if (this.time - S.seen > 3) this.sinks.delete(h);
  }

  // ------------------------------------------------------------ what you see move
  sandTint(x, z, out, k = 1) {
    this.level.sandColor(x, z, out);
    return out.multiplyScalar(k);
  }
  // cosmetic grains from (x, y, z) around direction (dx, dy, dz)
  spray(x, y, z, dx, dy, dz, count, o = {}) {
    if (y < this.seaY + 0.05) return;
    const low = this.game.render?.qualityName === 'low';
    count = Math.round(count * (low ? 0.6 : 1));
    const [s0, s1] = o.speed || [2, 5], [z0, z1] = o.size || [0.018, 0.04], cone = o.cone ?? 0.6, rad = o.radius || 0;
    this.sandTint(x, z, _c2, o.dark ? 0.82 : 1);
    const dl = Math.hypot(dx, dy, dz) || 1;
    for (let i = 0; i < count; i++) {
      // a random direction inside the cone around (dx, dy, dz)
      let rx = (Math.random() - 0.5) * 2, ry = (Math.random() - 0.5) * 2, rz = (Math.random() - 0.5) * 2;
      let vx = dx / dl + rx * cone, vy = dy / dl + ry * cone * 0.5 + (o.lift ?? 0.2), vz = dz / dl + rz * cone;
      if (o.radial) { const a = Math.random() * 6.283; vx = Math.cos(a); vz = Math.sin(a); vy = o.lift ?? 0.8; }
      const l = Math.hypot(vx, vy, vz) || 1, sp = rand(s0, s1);
      vx = vx / l * sp; vy = Math.abs(vy / l * sp); vz = vz / l * sp;
      const a = Math.random() * 6.283, r = Math.sqrt(Math.random()) * rad;
      const px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
      const k = rand(0.82, 1.12);
      _c.setRGB(_c2.r * k, _c2.g * k, _c2.b * k);
      this.grains.spawn(px, Math.max(y, this.height(px, pz)) + 0.03, pz, vx, vy, vz, rand(z0, z1), _c, rand(1.2, 2.4));
    }
  }
  // sand-coloured dust (not additive: sand does not glow)
  dust(x, y, z, r, count, o = {}) {
    if (y < this.seaY + 0.05) return;
    const sm = this.game.vfx?.smoke;
    if (!sm) return;
    this.sandTint(x, z, _c2, 1.05);
    const light = _c2.clone().lerp(new THREE.Color('#f2e6cf'), 0.35);
    for (let i = 0; i < count; i++) {
      const a = Math.random() * 6.283, d = Math.random() * r;
      const px = x + Math.cos(a) * d, pz = z + Math.sin(a) * d;
      sm.spawn({ x: px, y: y + rand(0.1, 0.5), z: pz, vx: Math.cos(a) * rand(0.5, 2.2) * (o.spread ?? 1) + (o.vx || 0), vy: rand(0.3, 1.4) * (o.up ?? 1), vz: Math.sin(a) * rand(0.5, 2.2) * (o.spread ?? 1) + (o.vz || 0),
        color: _c2, color1: light, alpha: o.alpha ?? 0.4, alpha1: 0, size: rand(0.4, 0.8) * (o.size ?? 1), size1: rand(1.4, 2.6) * (o.size ?? 1), life: rand(1.2, 2.4), drag: 2.4, spin: rand(-0.4, 0.4), grav: -0.15 });
    }
  }
  // clumps carry real sand: vol node-metres split between them, landing as scatter
  throwClumps(x, z, radius, vol, o = {}) {
    const m3 = vol * this.cell * this.cell;
    const n = Math.max(1, Math.min(o.big ? 90 : 6, Math.round(m3 / 0.008), this.clumps.max - this.clumps.n));
    const each = vol / n;
    const y = this.height(x, z);
    let lost = vol;
    for (let i = 0; i < n; i++) {
      const a = o.throwDir ? Math.atan2(o.throwDir.z, o.throwDir.x) + rand(-0.7, 0.7) : Math.random() * 6.283;
      const r0 = radius * rand(0.2, 0.8);
      const range = o.throwDir ? rand(0.6, 2.2) : radius * rand(1.4, 4.2);
      const el = rand(0.75, 1.2);
      const sp = Math.sqrt(range * GRAV / Math.sin(2 * el));
      const px = x + Math.cos(a) * r0, pz = z + Math.sin(a) * r0;
      this.sandTint(px, pz, _c, rand(0.8, 0.95));
      const size = Math.max(0.045, Math.min(0.13, Math.cbrt(each * this.cell * this.cell) * 0.55));
      if (this.clumps.spawn(px, y + 0.1, pz, Math.cos(a) * Math.cos(el) * sp, Math.sin(el) * sp, Math.sin(a) * Math.cos(el) * sp, size, _c, 4, each)) lost -= each;
    }
    if (lost > 1e-6) this.blob(x, z, radius * 2, lost); // no room in the air: it falls in the rim
  }
  landClump(i, gy) {
    const P = this.clumps, i3 = i * 3;
    const x = P.p[i3], z = P.p[i3 + 2];
    const vol = P.vol[i];
    if (vol > 0) {
      if (this.contains(x, z)) this.blob(x, z, Math.max(0.32, P.s[i] * 2.6), vol);
      else this.stats.lost += vol;
      this.freshen(x, z, 0.7, 1);
    }
    if (gy > this.seaY + 0.05 && Math.random() < 0.6) {
      this.spray(x, gy, z, P.v[i3] * 0.2, 1, P.v[i3 + 2] * 0.2, 4, { speed: [0.8, 2.2], cone: 1, size: [0.016, 0.03] });
      if (Math.random() < 0.25) this.dust(x, gy, z, 0.2, 1, { alpha: 0.25, size: 0.6 });
    }
  }

  // ------------------------------------------------------------ the player
  // footprints are pressed where the foot plants; the sand remembers them for a few minutes
  onFootstep(p, foot) {
    if (!this.active || !this.onSand(p)) return;
    const b = p.bones && p.bones[foot ? 'footR' : 'footL'];
    const hs = p.hspeed();
    let dx = p.vel.x, dz = p.vel.z;
    const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
    let x, z;
    // the bone's pose is this frame's, the figure's root is where it was drawn last frame
    if (b) { b.getWorldPosition(_p); x = _p.x - p.visual.position.x + p.renderPos.x; z = _p.z - p.visual.position.z + p.renderPos.z; }
    else { const s = foot ? -0.11 : 0.11; x = p.pos.x + dz * s; z = p.pos.z - dx * s; }
    const sprint = Math.min(1, hs / 11);
    this.print.stamp(x, z, 0.36, (ax, az) => footShape(ax * dx + az * dz, -ax * dz + az * dx), this.time, 0.85 + 0.15 * sprint);
    // the grid is too coarse for a print: the trail only darkens a little (and never costs a collider)
    this.freshen(x, z, 0.5, 0.22 + 0.1 * sprint);
    const y = this.height(x, z);
    this.spray(x, y, z, -dx, 0.6, -dz, 2 + Math.round(sprint * 4), { speed: [0.8, 2 + sprint * 2.5], cone: 0.5, size: [0.012, 0.026] });
    if (sprint > 0.75 && Math.random() < 0.35) this.dust(x, y, z, 0.15, 1, { alpha: 0.2, size: 0.4, vx: -dx, vz: -dz });
  }
  // a landing splashes a dent: deeper and wider from higher
  onLand(p, fall) {
    if (!this.active || !this.onSand(p)) return;
    const x = p.pos.x, z = p.pos.z;
    const f = Math.max(0, fall);
    const r = Math.min(1.0, 0.45 + f * 0.035), d = Math.min(0.25, 0.04 + f * 0.014);
    this.stamp(x, z, r, d, { rim: 1, fresh: Math.min(0.9, 0.3 + f * 0.05) });
    const fx = Math.sin(p.yaw), fz = Math.cos(p.yaw);
    for (const s of [-1, 1]) this.print.stamp(x + fz * 0.15 * s, z - fx * 0.15 * s, 0.36, (ax, az) => footShape(ax * fx + az * fz, -ax * fz + az * fx), this.time, 1);
    this.print.stamp(x, z, r * 1.2, (ax, az) => { const q = Math.hypot(ax, az) / r; return q < 1.15 && q > 0.75 ? -0.35 * (1 - Math.abs(q - 0.95) / 0.2) : 0; }, this.time, 1);
    const y = this.height(x, z);
    this.spray(x, y, z, 0, 1, 0, Math.min(90, 8 + f * 5), { radial: true, lift: 0.9, speed: [1.5, 2.5 + f * 0.35], size: [0.016, 0.034], radius: r * 0.8 });
    if (f > 2) this.dust(x, y, z, r, Math.min(8, Math.round(f * 0.6)), { alpha: 0.3 });
    return true;
  }
  onPound(p, heavy) {
    if (!this.active || !this.onSand(p)) return;
    this.crater(p.pos.x, p.pos.z, heavy ? 2.5 : 1.35, heavy ? 0.85 : 0.32, { ejecta: heavy ? 0.45 : 0.3, grains: heavy ? 260 : 110 });
  }
  // a dash scuffs the sand and throws a fan of it behind
  onDash(p) {
    if (!this.active || !this.contains(p.pos.x, p.pos.z)) return;
    const above = p.pos.y - this.height(p.pos.x, p.pos.z);
    if (above > 1.6 || above < -0.3 || (above > 0.2 && p.groundEntity) || this.lockedAt(p.pos.x, p.pos.z)) return;
    const d = p.dashDir, x = p.pos.x - d.x * 0.3, z = p.pos.z - d.z * 0.3, y = this.height(x, z);
    const back = { x: -d.x, z: -d.z };
    if (above < 0.35) this.stamp(x, z, 0.55, 0.07, { rim: 0.7, dir: d, side: 0.7, throwDir: back, fresh: 0.6 });
    const k = above < 0.35 ? 1 : 0.5;
    this.spray(x, y, z, -d.x, 0.55, -d.z, Math.round(55 * k), { speed: [3, 8], cone: 0.55, size: [0.016, 0.04] });
    this.dust(x, y, z, 0.4, Math.round(5 * k), { alpha: 0.35, vx: -d.x * 3, vz: -d.z * 3 });
  }
  // how far the figure sinks into the sand, visually (the capsule rides on top)
  visualSink(p, dt) {
    let target = 0;
    if (this.active && (p.state === 'ground' || p.state === 'slide') && this.onSand(p)) {
      const gap = Math.max(0, Math.min(0.08, p.renderPos.y - this.height(p.renderPos.x, p.renderPos.z)));
      target = gap + (p.state === 'slide' ? 0.06 : p.hspeed() > 1 ? 0.035 : 0.05) + 0.16 * this.quickAt(p.pos.x, p.pos.z);
    }
    this.sink += (target - this.sink) * Math.min(1, dt * 12);
    return this.sink;
  }
  // soft sand: running uphill is a touch slower (about 14% on a 15 degree face, 27% at repose)
  moveFactor(p, wish) {
    if (!this.active || !this.onSand(p)) return 1;
    const wl = Math.hypot(wish.x, wish.z);
    if (wl < 0.1) return 1;
    const n = this.normalAt(p.pos.x, p.pos.z, _n);
    const up = -(n.x * wish.x + n.z * wish.z) / wl; // sine of the climb, > 0 going uphill
    return (1 - Math.min(0.3, Math.max(0, up) * 0.52)) * (1 - 0.55 * this.quickAt(p.pos.x, p.pos.z));
  }
  // the ground velocity's vertical part on sand: along the slope plus a light press. A flat
  // push into the ground (the controller's default -3) makes Rapier slide the figure back down
  // any slope near the angle of repose, so crater walls and rims would trap it.
  groundVel(p) {
    if (!this.active || !this.onSand(p)) return undefined;
    const n = this.normalAt(p.pos.x, p.pos.z, _n);
    if (n.y < 0.5) return undefined;
    const along = -(n.x * p.vel.x + n.z * p.vel.z) / n.y;
    return Math.max(-12, Math.min(9, along - 0.6));
  }
  // sand-surfing: 0..1, how hard the slide is running down a steep dune face
  surf(p) {
    if (!this.active || !this.onSand(p)) return 0;
    const n = this.normalAt(p.pos.x, p.pos.z, _n);
    const s = Math.hypot(n.x, n.z);
    const hs = p.hspeed();
    if (s < 0.2 || hs < 2) return 0;
    const along = (n.x * p.vel.x + n.z * p.vel.z) / (s * hs);
    return smooth(0.22, 0.45, s) * smooth(0.15, 0.6, along);
  }
  // sliding carves a trough with banks (by distance, so the depth does not depend on speed),
  // cuts a crisp groove into the imprint map and throws a rooster tail
  trail(dt) {
    const p = this.game.player;
    if (!p || p.dead || p.state !== 'slide' || !this.onSand(p)) { this.slide = null; return; }
    const S = this.slide || (this.slide = { x: p.pos.x, z: p.pos.z, d: 0, px: p.pos.x - p.vel.x / (p.hspeed() || 1) * 0.7, pz: p.pos.z - p.vel.z / (p.hspeed() || 1) * 0.7 });
    const hs = p.hspeed();
    const surf = this.surf(p);
    const dx = p.vel.x / (hs || 1), dz = p.vel.z / (hs || 1);
    const moved = Math.hypot(p.pos.x - S.x, p.pos.z - S.z);
    S.x = p.pos.x; S.z = p.pos.z;
    if (moved > 2) { S.px = p.pos.x - dx * 0.7; S.pz = p.pos.z - dz * 0.7; return; } // teleported
    S.d += moved;
    const step = 0.24, r = 0.6;
    const D = (0.13 + Math.min(0.06, hs * 0.005)) * (1 + surf * 0.6);
    while (S.d >= step) {
      S.d -= step;
      const k = S.d / Math.max(moved, 1e-3);
      // carved just behind the body: the slider rides the leading edge of its own trough
      // instead of forever climbing out of the dip it digs
      const back = r + 0.1;
      const x = p.pos.x - dx * (k * moved + back), z = p.pos.z - dz * (k * moved + back);
      // depth per stamp so that overlapping stamps sum to D along the centre line
      this.stamp(x, z, r, D * step / (r * 16 / 15), { rim: 0.86, dir: { x: dx, z: dz }, side: 1, throwDir: { x: -dx, z: -dz }, fresh: 0.75, rimOut: 1.9 });
      const x0 = S.px, z0 = S.pz, lx = x - x0, lz = z - z0, L2 = lx * lx + lz * lz || 1;
      const w = 0.24;
      this.print.stamp((x0 + x) / 2, (z0 + z) / 2, Math.sqrt(L2) / 2 + w * 1.6, (ax, az) => {
        const px = ax + (x - x0) / 2, pz = az + (z - z0) / 2; // relative to (x0, z0)
        const t = Math.max(0, Math.min(1, (px * lx + pz * lz) / L2));
        const q = Math.hypot(px - lx * t, pz - lz * t) / w;
        return q < 1 ? 0.5 + 0.5 * smooth(1, 0.35, q) : q < 1.6 ? -0.4 * (1 - Math.abs(q - 1.3) / 0.3) : 0;
      }, this.time, 1);
      S.px = x; S.pz = z;
    }
    // rooster tail
    this.tailAcc = (this.tailAcc || 0) + dt * (30 + hs * 7) * (1 + surf);
    const y = this.height(p.pos.x, p.pos.z);
    const n = Math.floor(this.tailAcc);
    if (n > 0) {
      this.tailAcc -= n;
      this.spray(p.pos.x - dx * 0.35, y, p.pos.z - dz * 0.35, -dx * 0.8, 1.1, -dz * 0.8, n, { speed: [2, 3 + hs * 0.35], cone: 0.35, size: [0.016, 0.036], lift: 0.4 });
      if (Math.random() < dt * (3 + surf * 6)) this.dust(p.pos.x - dx * 0.8, y, p.pos.z - dz * 0.8, 0.3, 1, { alpha: 0.28, vx: -dx * 2, vz: -dz * 2, size: 0.7 });
    }
  }

  // sleepwalkers crossing the sand leave prints too (checked a few times a second)
  strollers(dt) {
    this.strollT = (this.strollT || 0) - dt;
    if (this.strollT > 0) return;
    this.strollT = 0.1;
    const W = this.walkers || (this.walkers = new WeakMap());
    for (const e of this.game.entities) {
      if (e.kind !== 'enemy' || e.dead || !e.body) continue;
      const t = e.body.translation(), v = e.body.linvel();
      const hs = Math.hypot(v.x, v.z);
      let w = W.get(e);
      if (!w) { w = { x: t.x, z: t.z, d: 0, side: 1 }; W.set(e, w); }
      const moved = Math.hypot(t.x - w.x, t.z - w.z);
      w.x = t.x; w.z = t.z;
      if (hs < 0.6 || moved > 3 || !this.contains(t.x, t.z)) continue;
      const gap = t.y - this.height(t.x, t.z);
      if (gap > 0.15 || gap < -0.3 || this.lockedAt(t.x, t.z)) continue;
      w.d += moved;
      if (w.d < 0.62) continue;
      w.d = 0; w.side = -w.side;
      const dx = v.x / hs, dz = v.z / hs, x = t.x + dz * 0.12 * w.side, z = t.z - dx * 0.12 * w.side;
      this.print.stamp(x, z, 0.36, (ax, az) => footShape(ax * dx + az * dz, -ax * dz + az * dx), this.time, 0.75);
    }
  }

  // ------------------------------------------------------------ the world hitting the sand
  // destruction.explode: returns true if the blast bit into the sand
  explosion(pos, R, o = {}) {
    if (!this.active || !this.contains(pos.x, pos.z)) return false;
    const hs = this.height(pos.x, pos.z), above = pos.y - hs;
    if (above > R * 0.8 || above < -1.5) return false;
    // only if the sand is what lies under the blast (not a roof, a floor or a platform)
    const hit = this.game.physics.ray({ x: pos.x, y: pos.y + 0.5, z: pos.z }, { x: 0, y: -1, z: 0 }, Math.max(0, above) + 2, G.WORLD | G.WALL);
    if (hit && !this.isSand(hit.collider)) return false;
    if (this.lockedAt(pos.x, pos.z)) return false;
    const k = 1 - Math.max(0, above) / (R * 0.8);
    if (o.implode) { this.heap(pos.x, pos.z, R * 0.45, R * 0.25 * k); return true; }
    const small = o.small ? 0.75 : 1;
    this.crater(pos.x, pos.z, R * 0.55 * (0.55 + 0.45 * k) * small, R * 0.3 * k * small, { ejecta: 0.45, grains: (90 + R * 70) * k });
    return true;
  }
  // a thrown or falling entity hit the sand (destruction.onImpact)
  impact(e, speed, dv) {
    if (!this.active || !e) return;
    const c = e.center();
    if (!this.contains(c.x, c.z)) return;
    const bottom = c.y - (e.extent ? e.extent.y : 0.5), gy = this.height(c.x, c.z);
    if (Math.abs(bottom - gy) > 0.6 || this.lockedAt(c.x, c.z)) return;
    const hit = this.game.physics.ray({ x: c.x, y: c.y, z: c.z }, { x: 0, y: -1, z: 0 }, (c.y - gy) + 0.5, G.WORLD | G.WALL);
    if (hit && !this.isSand(hit.collider)) return;
    const heavy = e.props && e.props.has('heavy');
    const r = Math.max(0.3, Math.min(1.5, e.radius() * 0.9)) * (heavy ? 1.25 : 1);
    const d = Math.min(heavy ? 0.15 : 0.12, speed * (heavy ? 0.01 : 0.008));
    if (heavy && speed > 9) this.crater(c.x, c.z, r * 1.2, d, { ejecta: 0.3, grains: 40 + speed * 5 });
    else {
      this.stamp(c.x, c.z, r, d, { rim: 1, fresh: 0.7 });
      this.spray(c.x, gy, c.z, 0, 1, 0, Math.min(70, 6 + dv * 3), { radial: true, lift: 0.7, speed: [1, 2 + dv * 0.25], size: [0.016, 0.035], radius: r * 0.7 });
    }
    this.wake(c.x, c.z, r * 2);
    if (dv > 8) this.dust(c.x, gy, c.z, r, Math.min(6, Math.round(dv * 0.4)), { alpha: 0.3 });
  }
  // a fracture chunk thudding down (destruction.update); budgeted
  debrisImpact(pos, dv) {
    if (!this.active || this.budget < 1 || !this.contains(pos.x, pos.z)) return;
    const gy = this.height(pos.x, pos.z);
    if (pos.y - gy > 0.7 || this.lockedAt(pos.x, pos.z)) return;
    this.budget -= 1;
    this.stamp(pos.x, pos.z, 0.4, Math.min(0.06, dv * 0.005), { rim: 1, fresh: 0.4 });
    this.spray(pos.x, gy, pos.z, 0, 1, 0, Math.min(18, 3 + dv), { radial: true, lift: 0.8, speed: [0.8, 1.5 + dv * 0.15], size: [0.014, 0.03] });
  }
  // rounds are seen in flight; when one vanishes, check whether it ended in the sand
  watchRounds() {
    const list = this.game.projectiles?.list;
    if (!list) return;
    const f = ++this.frame;
    for (const r of list) {
      if (r.type !== 'round') continue;
      let o = this.rounds.get(r);
      if (!o) { o = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, b: r.bounces || 0, f, melt: !!(r.props && r.props.has('melting')) }; this.rounds.set(r, o); }
      else if ((r.bounces || 0) !== o.b) { this.roundHit(o, this.dt * 1.6); o.b = r.bounces || 0; } // ricochet off the sand
      o.x = r.pos.x; o.y = r.pos.y; o.z = r.pos.z; o.vx = r.vel.x; o.vy = r.vel.y; o.vz = r.vel.z; o.f = f;
    }
    for (const [r, o] of this.rounds) if (o.f !== f) { this.rounds.delete(r); this.roundHit(o, this.dt * 1.6); }
  }
  roundHit(o, reach) {
    const sp = Math.hypot(o.vx, o.vy, o.vz);
    if (sp < 1 || !this.contains(o.x, o.z)) return;
    const d = { x: o.vx / sp, y: o.vy / sp, z: o.vz / sp };
    const hit = this.game.physics.ray(o, d, sp * reach, ALL & ~G.PLAYER & ~G.GHOST & ~G.DEBRIS);
    if (!hit || !this.isSand(hit.collider)) return;
    const p = hit.point;
    this.stats.roundHits = (this.stats.roundHits || 0) + 1;
    this.stamp(p.x, p.z, 0.28, 0.035, { rim: 1, fresh: 0.45 });
    // a spurt back up along the reflection
    const rx = d.x - 2 * (d.x * hit.normal.x + d.y * hit.normal.y + d.z * hit.normal.z) * hit.normal.x;
    const rz = d.z - 2 * (d.x * hit.normal.x + d.y * hit.normal.y + d.z * hit.normal.z) * hit.normal.z;
    this.spray(p.x, p.y, p.z, rx * 0.6, 1, rz * 0.6, 16, { speed: [2, 5], cone: 0.5, size: [0.014, 0.03] });
    this.dust(p.x, p.y, p.z, 0.1, 1, { alpha: 0.3, size: 0.45, up: 0.6 });
    if (o.melt) this.quicksand(p.x, p.z);
  }

  // ------------------------------------------------------------ quicksand
  // a melting round turns a patch of sand to slow quicksand for a while: it sags into a soft
  // funnel, slows whoever wades in, and swallows the sleepwalkers it catches
  quicksand(x, z, r = 2.3, life = 12) {
    if (!this.active || !this.contains(x, z) || this.lockedAt(x, z)) return null;
    for (const Q of this.quick) if (Math.hypot(Q.x - x, Q.z - z) < Q.r * 0.8) { Q.life = Math.max(Q.life, Q.t + life * 0.6); return Q; } // feeding it keeps it open
    if (this.quick.length >= 4) this.quick.shift();
    const Q = { x, z, r, t: 0, life };
    this.quick.push(Q);
    this.stamp(x, z, r * 0.75, 0.28, { rim: 1, fresh: 1 });
    this.game.audio?.sfx('melt', { position: { x, y: this.height(x, z), z } });
    this.dust(x, this.height(x, z), z, r * 0.6, 4, { alpha: 0.3 });
    return Q;
  }
  quickAt(x, z) {
    let k = 0;
    for (const Q of this.quick) { const d = Math.hypot(x - Q.x, z - Q.z) / Q.r; if (d < 1) k = Math.max(k, this.quickK(Q) * (1 - d * d * 0.5)); }
    return k;
  }
  quickK(Q) { return Math.min(1, Q.t / 0.8) * (1 - smooth(Q.life - 2, Q.life, Q.t)); } // fades in and out
  quickStep(dt) {
    const U = this.uniforms.uQuick.value;
    for (let i = this.quick.length - 1; i >= 0; i--) { const Q = this.quick[i]; Q.t += dt; if (Q.t >= Q.life) this.quick.splice(i, 1); }
    for (let k = 0; k < 4; k++) { const Q = this.quick[k]; if (Q) U[k].set(Q.x, Q.z, Q.r, this.quickK(Q)); else U[k].set(0, 0, 1, 0); }
    if (!this.quick.length && !this.victims.size) return;
    for (const e of this.game.entities) {
      if (e.kind !== 'enemy' || e.dead || !e.body) continue;
      const t = e.body.translation();
      let v = this.victims.get(e);
      let Q = null;
      for (const q of this.quick) if (Math.hypot(t.x - q.x, t.z - q.z) < q.r) { Q = q; break; }
      if (!v) {
        if (!Q || t.y - this.height(t.x, t.z) > 0.4) continue; // flying things stay clear
        v = { t: 0, sink: 0, x: Q.x, z: Q.z, top: this.height(t.x, t.z), cols: null };
        this.victims.set(e, v);
      }
      if (!Q && v.sink === 0) { this.victims.delete(e); continue; } // got out before it took hold
      v.t += dt;
      const b = e.body, lv = b.linvel();
      const dx = v.x - t.x, dz = v.z - t.z, dl = Math.hypot(dx, dz) || 1;
      const pull = Math.min(1.4, dl * 1.2), keep = Math.exp(-dt * 5);
      if (v.t > 0.9 && v.sink === 0) { // it has them: the ground no longer holds them up
        v.cols = (e.colliders || []).map((c) => [c, c.collisionGroups()]);
        for (const [c] of v.cols) c.setCollisionGroups(groups(G.ENEMY, ALL & ~G.WORLD & ~G.DEBRIS));
        b.setGravityScale(0, true);
        v.top = this.height(t.x, t.z);
      }
      if (v.t > 0.9) {
        v.sink += dt * 0.5;
        b.setLinvel({ x: lv.x * keep + dx / dl * pull * 0.5, y: -0.5, z: lv.z * keep + dz / dl * pull * 0.5 }, true);
        if (Math.random() < dt * 14) this.spray(t.x, v.top, t.z, 0, 1, 0, 3, { radial: true, lift: 1.2, speed: [0.6, 1.4], size: [0.016, 0.03], radius: 0.4 });
        if (v.sink > 1.4) { // under: swallowed
          this.victims.delete(e);
          e.obj.position.y = v.top;
          e.damage(99999, { type: 'melt', silent: true });
          this.spray(t.x, v.top, t.z, 0, 1, 0, 30, { radial: true, lift: 1, speed: [1, 3], size: [0.02, 0.04], radius: 0.3 });
          this.dust(t.x, v.top, t.z, 0.4, 3, { alpha: 0.35 });
        }
      } else b.setLinvel({ x: lv.x * keep + dx / dl * pull, y: lv.y, z: lv.z * keep + dz / dl * pull }, true);
    }
    for (const [e] of this.victims) if (e.dead) this.victims.delete(e);
  }

  // ------------------------------------------------------------ per frame
  update(dt) {
    if (!this.active) return;
    const t0 = performance.now();
    this.time += dt; this.dt = dt;
    this.seaY = this.level.sea ? this.level.sea.y : -1e9;
    this.budget = Math.min(6, this.budget + dt * 12);
    if (this.resleep.length) { // the step after a rebuild has run: undisturbed sleepers go back to sleep
      const bodies = this.game.physics.world.bodies;
      for (const h of this.resleep) {
        const b = bodies.get(h);
        if (!b || !b.isDynamic() || b.isSleeping()) continue;
        const v = b.linvel(), w = b.angvel();
        if (v.x * v.x + v.y * v.y + v.z * v.z < 0.01 && w.x * w.x + w.y * w.y + w.z * w.z < 0.01) b.sleep();
      }
      this.resleep.length = 0;
    }
    this.markOccupied();
    this.anchorT = (this.anchorT ?? 0) - dt;
    if (this.anchorT <= 0) { this.anchorT = 1; this.lockAnchors(); }
    if (dt > 0) {
      const P = this.prof; // per-phase timings, only when a test asks for them
      let tp = P ? performance.now() : 0;
      const lap = P ? (k) => { const t = performance.now(); const e = P[k] || (P[k] = { sum: 0, max: 0 }); e.sum += t - tp; e.max = Math.max(e.max, t - tp); tp = t; } : () => {};
      this.trail(dt); lap('trail');
      this.settle(dt); lap('settle');
      this.watchRounds(); lap('rounds');
      this.strollers(dt); lap('strollers');
      this.quickStep(dt); lap('quick');
      this.grains.update(dt); lap('grains');
      this.clumps.update(dt, (i, gy) => this.landClump(i, gy)); lap('clumps');
      this.relaxStep(); lap('relax');
      this.windStep(); lap('wind');
    }
    const t1 = performance.now();
    // mesh rows
    for (const t of this.tiles) if (t.dirty) { const d = t.dirty; t.dirty = null; this.writeChunk(t, d[0], d[1], d[2], d[3]); }
    const t2 = performance.now();
    if (this.prof) { const e = this.prof.mesh || (this.prof.mesh = { sum: 0, max: 0 }); e.sum += t2 - t1; e.max = Math.max(e.max, t2 - t1); }
    this.rebuildColliders();
    // imprints follow the player
    const p = this.game.player;
    const focus = p ? p.pos : this.center;
    this.print.follow(focus.x, focus.z);
    this.print.expire(this.time);
    const t4 = performance.now();
    this.print.flush(this.game.render?.renderer);
    if (this.prof) { const e = this.prof.print || (this.prof.print = { sum: 0, max: 0 }); const d = performance.now() - t4; e.sum += d; e.max = Math.max(e.max, d); }
    const U = this.uniforms;
    U.uSandTime.value = this.time;
    U.uPrintCode.value = this.print.code(this.time);
    U.uPrintWin.value.set(this.print.ox * PRINT_T, this.print.oz * PRINT_T, PRINT_S * PRINT_T, PRINT_S);
    const ms = performance.now() - t0, S = this.stats;
    S.ms = S.ms * 0.95 + ms * 0.05; S.peak = Math.max(S.peak * 0.995, ms); S.frames++;
    S.meshMs = S.meshMs * 0.95 + (t2 - t1) * 0.05;
    S.last = ms;
  }

  // throttled: at most two tiles a frame, the player's own first; if the sand rose under the
  // player's feet, step them up onto it so the capsule never starts a step inside the ground
  rebuildColliders() {
    let best = null, second = null, bs = -Infinity, ss = -Infinity;
    const p = this.game.player;
    for (const t of this.tiles) {
      if (t.colDirty < 1 || (t.colDirty === 1 && t.colErr < 0.012)) continue;
      const cx = this.x0 + (t.a0 + t.cw / 2) * this.cell, cz = this.z0 + (t.b0 + t.ch / 2) * this.cell;
      const d = p ? Math.max(Math.abs(p.pos.x - cx) - t.cw * this.cell / 2, Math.abs(p.pos.z - cz) - t.ch * this.cell / 2) : 1e9;
      // the wind's slow drift only matters under the player's feet; elsewhere it waits for the
      // tile's next real change (a rebuild wakes whatever rests on the tile)
      if (t.colDirty === 1 && d > 10) continue;
      let s = t.colDirty * 1000;
      if (p) s -= Math.hypot(p.pos.x - cx, p.pos.z - cz);
      if (s > bs) { second = best; ss = bs; best = t; bs = s; } else if (s > ss) { second = t; ss = s; }
    }
    if (!best) { // quiet frame: now and then catch up a tile a spent avalanche left a little out
      if ((this.frame % 60) !== 0) return;
      let e = 0.006;
      for (const t of this.tiles) {
        if (t.colDirty !== 1 || t.colErr <= e || !p) continue;
        const cx = this.x0 + (t.a0 + t.cw / 2) * this.cell, cz = this.z0 + (t.b0 + t.ch / 2) * this.cell;
        if (Math.max(Math.abs(p.pos.x - cx) - t.cw * this.cell / 2, Math.abs(p.pos.z - cz) - t.ch * this.cell / 2) < 10) { e = t.colErr; best = t; }
      }
      if (!best) return;
    }
    const t0 = performance.now();
    const world = this.game.physics.world;
    for (const t of [best, second]) {
      if (!t) continue;
      // under the player? note the old collider surface at a few points under the capsule
      let probes = null;
      if (p && !p.dead && typeof p.sandLift === 'function' && p.state !== 'grind' && p.state !== 'mantle' && p.state !== 'vault') {
        const x = p.pos.x, z = p.pos.z, r = p.r || 0.34;
        if (x >= this.x0 + t.a0 * this.cell - r && x <= this.x0 + t.a1 * this.cell + r && z >= this.z0 + t.b0 * this.cell - r && z <= this.z0 + t.b1 * this.cell + r && this.onSand(p)) {
          probes = [];
          for (const [ox, oz] of LIFT_PROBES) { const px = x + ox * r, pz = z + oz * r, o = this.tileHeight(t, px, pz); if (o !== null) probes.push(px, pz, o); }
        }
      }
      const soft = t.colDirty === 1; // only the wind's drift: nothing here needs to wake
      this.buildCollider(t);
      t.colDirty = 0; t.colErr = 0;
      this.stats.colliders++;
      // bodies resting where the surface changed wake to find it; the rest sleep on
      // (Rapier wakes everything touching a reshaped collider on its next step; the sleepers
      // outside the changed box are put back to sleep once that step is done)
      const cb = t.cbox;
      t.cbox = null;
      const m = 1.2, bx0 = cb ? this.x0 + cb[0] * this.cell - m : 1, bx1 = cb ? this.x0 + cb[2] * this.cell + m : 0;
      const bz0 = cb ? this.z0 + cb[1] * this.cell - m : 1, bz1 = cb ? this.z0 + cb[3] * this.cell + m : 0;
      world.contactPairsWith(t.col, (o) => { try {
        if (!o) return;
        const b = o.parent();
        if (!b || !b.isDynamic()) return;
        const e = this.game.physics.ownerOf(o);
        if (e && e.center && !this.victims.has(e)) {
          const c = e.center(_p), top = this.height(c.x, c.z);
          if (c.y < top) { const q = b.translation(); b.setTranslation({ x: q.x, y: q.y + top - c.y + (e.extent ? e.extent.y : 0.3) * 0.5, z: q.z }, true); this.stats.rescues = (this.stats.rescues || 0) + 1; return; }
        }
        if (soft) { const v = b.linvel(); if (b.isSleeping() || v.x * v.x + v.y * v.y + v.z * v.z < 0.04) this.resleep.push(b.handle); return; }
        if (!b.isSleeping()) return;
        const q = b.translation();
        if (q.x > bx0 && q.x < bx1 && q.z > bz0 && q.z < bz1) b.wakeUp();
        else this.resleep.push(b.handle);
      } catch (err) { console.warn('sand contact skipped', err); } }); // nothing may unwind through Rapier
      // if the sand rose under the capsule, step the player up by as much, so the next move
      // never starts inside the ground (lowering needs nothing: they just settle)
      if (probes && probes.length) {
        let rise = 0;
        for (let k = 0; k < probes.length; k += 3) rise = Math.max(rise, this.height(probes[k], probes[k + 1]) - probes[k + 2]);
        if (rise > 0.004 && rise < 1.5) { p.sandLift(rise + 0.005); this.stats.lifts = (this.stats.lifts || 0) + 1; }
      }
    }
    world.updateSceneQueries?.();
    const ms = performance.now() - t0;
    this.stats.colLast = ms;
    this.stats.colliderMs = this.stats.colliderMs * 0.9 + ms * 0.1;
    this.stats.colliderPeak = Math.max(this.stats.colliderPeak || 0, ms);
  }

  dispose() {
    this.active = false;
    for (const t of this.tiles) { t.mesh.parent?.remove(t.mesh); t.geo.dispose(); }
    for (const P of [this.grains, this.clumps]) { P.mesh.parent?.remove(P.mesh); P.mesh.geometry.dispose(); P.mesh.material.dispose(); P.mesh.dispose?.(); }
    this.mat.dispose();
  }
}
