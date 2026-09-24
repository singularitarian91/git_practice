// Portals ("framed"): ornate gilt oval frames that hang on surfaces. Two frames
// make a linked pair. Each shows a live view out of the other (a virtual camera
// rendered to a texture, with an oblique near-plane clip at the exit), and
// anything that goes into one comes out of the other with its momentum carried
// through the pair's rotation: speedy thing goes in, speedy thing comes out.
//
// A portal's frame: position on the surface (lifted a hair), +Z = the surface
// normal, +Y = "up" (world up projected onto walls; the player's facing on
// floors and ceilings). Going from X to its partner Y maps every point and
// direction through  Y.m * rotY(180) * inverse(X.m).
import * as THREE from 'three';
import { G, ALL } from './config.js';

// ---- shape and tuning -------------------------------------------------------
const RX = 0.6, RY = 1.0;              // the opening: an ellipse 1.2 wide, 2.0 tall
const FX = 0.8, FY = 1.26;             // the frame's outer rim, which must fit on the surface
const LIFT = 0.02;                      // the frame (and the portal plane) stand this far off the surface
const SURFACE = G.WORLD | G.WALL | G.PROP;
const TINTS = ['#ffd27a', '#8fe36b'];   // A warm gold, B cool green (framed's own colour)
const ANCHOR_TINT = '#8fe36b';
const UNFURL = 0.35;                    // seconds for a frame to unfurl
const PLAYER_COOL = 0.2, BODY_COOL = 0.4;
const RIM_SAMPLES = 12;
const STILL = 'Frames only hang on things that stay still.';
const NO_ROOM = 'There isn\'t room to hang a frame there.';
const OVERLAP = 'The two frames would overlap.';

const UP = new THREE.Vector3(0, 1, 0);
const DOWN = new THREE.Vector3(0, -1, 0);
const FLIP = new THREE.Matrix4().makeRotationY(Math.PI);
const QFLIP = new THREE.Quaternion().setFromAxisAngle(UP, Math.PI);
const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _u = new THREE.Vector3(), _c = new THREE.Vector3();
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion();
const _plane = new THREE.Plane(), _clip = new THREE.Vector4(), _cq = new THREE.Vector4();
const _sphere = new THREE.Sphere(), _frustum = new THREE.Frustum(), _size = new THREE.Vector2();

function easeOutBack(k) { const c1 = 1.9, c3 = c1 + 1; return 1 + c3 * (k - 1) ** 3 + c1 * (k - 1) ** 2; }
function angDist(a, b) { return Math.atan2(Math.sin(a - b), Math.cos(a - b)); }
function bump(t, at, w) { const d = angDist(t, at) / w; return Math.exp(-d * d); }

// ---- the view surface shader -----------------------------------------------
const NOISE = /* glsl */`
float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float vnoise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
  return mix(mix(hash12(i), hash12(i+vec2(1,0)), f.x), mix(hash12(i+vec2(0,1)), hash12(i+vec2(1,1)), f.x), f.y); }
float fbm(vec2 p){ float a = 0.5, s = 0.0; for(int i=0;i<4;i++){ s += a*vnoise(p); p = p*2.03 + 17.1; a *= 0.5; } return s; }
`;

const VIEW_VERT = /* glsl */`
varying vec2 vLocal;
void main(){ vLocal = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

// Output is linear HDR, like every other material in the main RenderPass: the
// composer's OutputPass tone-maps it (ACES + sRGB) together with the rest of the
// frame. The portal render targets are linear HDR too, so the view matches.
const VIEW_FRAG = /* glsl */`
uniform sampler2D tView;
uniform vec2 uRes;
uniform vec3 uTint;
uniform float uLive, uTime, uOpen, uSeed;
varying vec2 vLocal;
${NOISE}
// a dim Magritte sky, slowly swirling: what an unpaired frame shows
vec3 painted(vec2 p, float t){
  float rr = length(p * vec2(1.5, 1.0));
  float a = rr * 1.4 + t * 0.07 + sin(t * 0.11 + uSeed) * 0.5;
  vec2 q = mat2(cos(a), -sin(a), sin(a), cos(a)) * p;
  float n = fbm(q * 1.7 + vec2(t * 0.03, -t * 0.02) + uSeed);
  float n2 = fbm(q * 4.2 - vec2(t * 0.05, t * 0.01));
  vec3 col = mix(vec3(0.03, 0.05, 0.13), vec3(0.14, 0.26, 0.55), smoothstep(-1.1, 1.0, p.y + (n - 0.5) * 0.7));
  float cl = smoothstep(0.5, 0.8, n * 0.8 + n2 * 0.35);
  col = mix(col, vec3(0.62, 0.62, 0.7), cl * 0.55);
  col *= 0.8 + 0.2 * vnoise(vec2(p.x * 36.0 + p.y * 9.0, p.y * 5.0 + uSeed));   // brush strokes
  return col * 0.6 + uTint * 0.02;
}
void main(){
  vec2 e = vLocal / vec2(${RX.toFixed(3)}, ${RY.toFixed(3)});
  float r = length(e);
  float ang = atan(e.y, e.x);
  float t = uTime;
  // painterly edge: brush-stroke noise breathing around the rim (tucked under the frame once open)
  float wob = (fbm(vec2(ang * 2.2 + uSeed, t * 0.3)) - 0.5) * 0.09 + sin(ang * 11.0 - t * 1.6) * 0.008;
  if (r > uOpen * (1.1 + wob)) discard;
  // shimmer: near the frame the picture swims a little, like wet paint
  float rim = smoothstep(0.78, 1.0, r + wob * 0.6);
  vec2 sw = vec2(fbm(vLocal * 3.1 + vec2(t * 0.45, uSeed)), fbm(vLocal * 3.1 + vec2(7.3, -t * 0.4))) - 0.5;
  vec2 suv = gl_FragCoord.xy / uRes + sw * 0.014 * rim;
  vec3 col = uLive > 0.5 ? texture2D(tView, suv).rgb : painted(vLocal, t);
  // unfurling: the fresh paint glows at the spreading edge
  float fresh = (1.0 - smoothstep(0.85, 1.0, uOpen)) * smoothstep(uOpen * 0.7, uOpen * 1.1, r);
  // a thin glowing rim in this frame's accent colour
  float glow = rim * rim * (0.75 + 0.25 * sin(ang * 5.0 + t * 2.3 + wob * 20.0));
  col = mix(col, uTint, glow * 0.28 + fresh * 0.6);
  col += uTint * (pow(rim, 8.0) * 0.5 + fresh * 1.5);
  gl_FragColor = vec4(col, 1.0);
}`;

// ---- geometry (built once, shared by every frame) ---------------------------
// Moulding cross-section: [outward offset from the opening, height off the plane].
// Sight-edge bead, a cove, a flat, a gadrooned torus, then down to the wall.
const PROFILE = [
  [-0.004, -0.004], [-0.004, 0.016], [0.002, 0.028], [0.010, 0.034], [0.019, 0.031], [0.025, 0.024],
  [0.032, 0.026], [0.042, 0.037], [0.054, 0.047], [0.068, 0.053], [0.084, 0.054], [0.096, 0.058],
  [0.106, 0.068], [0.118, 0.078], [0.132, 0.081], [0.146, 0.075], [0.156, 0.060], [0.163, 0.036],
  [0.167, 0.008], [0.168, -0.026],
];

class EllipseLoop extends THREE.Curve {
  constructor(a, b, z) { super(); this.a = a; this.b = b; this.z = z; }
  getPoint(t, out = new THREE.Vector3()) { const u = t * Math.PI * 2; return out.set(Math.cos(u) * this.a, Math.sin(u) * this.b, this.z); }
}

let SHARED = null;
function shared() {
  if (SHARED) return SHARED;
  // the moulding: the profile swept around the ellipse, spaced by arc length
  const N = 360, M = PROFILE.length;
  const table = [0];
  const S = 2048;
  for (let i = 1; i <= S; i++) {
    const a = (i - 1) / S * Math.PI * 2, b = i / S * Math.PI * 2;
    table.push(table[i - 1] + Math.hypot(RX * (Math.cos(b) - Math.cos(a)), RY * (Math.sin(b) - Math.sin(a))));
  }
  const L = table[S];
  const pos = new Float32Array(N * M * 3);
  let k = 0, j0 = 0;
  for (let i = 0; i < N; i++) {
    const want = L * i / N;
    while (j0 < S && table[j0 + 1] < want) j0++;
    const f = (want - table[j0]) / Math.max(1e-9, table[j0 + 1] - table[j0]);
    const t = (j0 + f) / S * Math.PI * 2;
    const c = Math.cos(t), s = Math.sin(t);
    let nx = RY * c, ny = RX * s;
    const nl = Math.hypot(nx, ny); nx /= nl; ny /= nl;
    const arc = i / N;
    // ornament: a cartouche crest at the top, a smaller one at the foot, bosses at the sides
    const crest = bump(t, Math.PI / 2, 0.28), foot = bump(t, -Math.PI / 2, 0.22), side = bump(t, 0, 0.3) + bump(t, Math.PI, 0.3);
    const gadroon = Math.max(0, Math.sin(arc * Math.PI * 2 * 44)) ** 2;
    const bead = 0.5 + 0.5 * Math.cos(arc * Math.PI * 2 * 72);
    for (let j = 0; j < M; j++) {
      const [s0, z0] = PROFILE[j];
      const outer = THREE.MathUtils.smoothstep(s0, 0.03, 0.12);
      const torus = Math.max(0, 1 - Math.abs(s0 - 0.13) / 0.032);
      const beadW = Math.max(0, 1 - Math.abs(s0 - 0.010) / 0.012);
      const so = s0 + (crest * 0.045 + foot * 0.022 + side * 0.008) * outer;
      let z = z0 + (crest * 0.024 + foot * 0.012 + side * 0.006) * outer * (1 - THREE.MathUtils.smoothstep(s0, 0.15, 0.168));
      z += gadroon * 0.009 * torus + bead * 0.004 * beadW;
      pos[k++] = RX * c + nx * so; pos[k++] = RY * s + ny * so; pos[k++] = z;
    }
  }
  const idx = [];
  for (let i = 0; i < N; i++) {
    const i2 = (i + 1) % N;
    for (let j = 0; j < M - 1; j++) {
      const a = i * M + j, b = i2 * M + j, c = i2 * M + j + 1, d = i * M + j + 1;
      idx.push(a, d, c, a, c, b);
    }
  }
  const moulding = new THREE.BufferGeometry();
  moulding.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  moulding.setIndex(idx);
  moulding.computeVertexNormals();
  moulding.computeBoundingSphere();
  // crest shell, scroll volutes and a pendant knob
  const orn = [];
  const blob = (sx, sy, sz, x, y, z) => { const g = new THREE.SphereGeometry(1, 18, 12); g.scale(sx, sy, sz); g.translate(x, y, z); orn.push(g); };
  blob(0.1, 0.075, 0.04, 0, RY + 0.2, 0.05);
  blob(0.04, 0.04, 0.03, -0.13, RY + 0.16, 0.055); blob(0.04, 0.04, 0.03, 0.13, RY + 0.16, 0.055);
  blob(0.045, 0.05, 0.03, 0, -RY - 0.19, 0.05);
  blob(0.03, 0.045, 0.025, -RX - 0.19, 0, 0.05); blob(0.03, 0.045, 0.025, RX + 0.19, 0, 0.05);
  const ornament = mergeGeometries(orn);
  // shell ribs: a fan of thin rods over the crest
  const ribs = [];
  for (let r = -3; r <= 3; r++) {
    const a = r * 0.3;
    const g = new THREE.CylinderGeometry(0.006, 0.009, 0.14, 5);
    g.rotateZ(a); g.translate(-Math.sin(a) * 0.06, RY + 0.2 + Math.cos(a) * 0.06, 0.082);
    ribs.push(g);
  }
  const ribGeo = mergeGeometries(ribs);
  const gold = new THREE.MeshStandardMaterial({ color: '#d29d3f', metalness: 1, roughness: 0.25, name: 'PortalGilt' });
  const bead = new THREE.TubeGeometry(new EllipseLoop(RX + 0.0, RY + 0.0, 0.022), 220, 0.0075, 6, true);
  const s2 = new THREE.Shape();
  s2.absellipse(0, 0, RX * 1.14, RY * 1.14, 0, Math.PI * 2, false, 0);
  const disc = new THREE.ShapeGeometry(s2, 64);
  SHARED = { moulding, ornament, ribGeo, gold, bead, disc };
  return SHARED;
}

// minimal geometry merge (position + normal) for the ornament pieces
function mergeGeometries(list) {
  const pos = [], nor = [], idx = [];
  let base = 0;
  for (const g of list) {
    const p = g.attributes.position, n = g.attributes.normal;
    for (let i = 0; i < p.count; i++) { pos.push(p.getX(i), p.getY(i), p.getZ(i)); nor.push(n.getX(i), n.getY(i), n.getZ(i)); }
    if (g.index) for (let i = 0; i < g.index.count; i++) idx.push(base + g.index.getX(i));
    else for (let i = 0; i < p.count; i++) idx.push(base + i);
    base += p.count;
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  out.setIndex(idx);
  out.computeBoundingSphere();
  return out;
}

// ---------------------------------------------------------------------------
export class Portals {
  constructor(game) {
    this.game = game;
    this.slots = [null, null];     // [A, B]
    this.closing = [];             // frames folding away
    this.linked = false;
    this.anchor = null;            // "give framed to yourself" return point
    this.bodyLast = new Map();     // rigid body handle -> game time of its last trip
    this.seq = 0;
    this.pHH = 0.56;               // player's capsule half-height, cached for the predicate
    this.lastWarp = null;          // { from, to, speedIn, speedOut, time } (debug / tests)
    this.uTime = { value: 0 };
    this.uRes = { value: new THREE.Vector2(1, 1) };
    this.vcam = new THREE.PerspectiveCamera();
    this.vcam.matrixAutoUpdate = false;
    this.dummy = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
    this.dummy.needsUpdate = true;
    // Kinematic character controller filter: true = collide. While the player is
    // lined up with a linked portal, the surface it hangs on stops existing for
    // them. Called from inside Rapier, so it touches no Rapier objects, and it must
    // never throw: an exception unwinding through Rapier leaves the world locked.
    this.playerPredicate = (collider) => {
      try {
        if (!this.linked || !collider) return true;
        const h = collider.handle;
        const A = this.slots[0], B = this.slots[1];
        if (!A || !B || (h !== A.handle && h !== B.handle)) return true;
        const pl = this.game.player;
        if (!pl) return true;
        if (h === A.handle && this.linedUp(A, pl)) return false;
        if (h === B.handle && this.linedUp(B, pl)) return false;
      } catch (e) { /* fall through: collide as normal */ }
      return true;
    };
  }

  // ---- public state -------------------------------------------------------
  get list() { return this.slots.filter(Boolean); }
  get pair() { return this.list; }          // 0-2 of { pos, normal, up, tint, label, linked, ... }
  get hasAnchor() { return !!this.anchor; }

  // is this world point inside a linked portal's opening (for parkour probes etc.)
  portalAt(point, slack = 0.3) {
    if (!this.linked) return null;
    for (const X of this.slots) {
      _v.subVectors(point, X.pos);
      const d = _v.dot(X.normal);
      if (d < -slack || d > slack) continue;
      const lx = _v.dot(X.right) / RX, ly = _v.dot(X.up) / RY;
      if (lx * lx + ly * ly <= 1) return X;
    }
    return null;
  }

  // is the player lined up to go through a linked frame (so parkour probes should
  // treat the wall as a doorway, not a ledge or something to climb)
  playerInFrame(pl) {
    if (!this.linked || !pl) return null;
    for (const X of this.slots) if (this.linedUp(X, pl)) return X;
    return null;
  }

  // A chase camera whose boom (pivot -> camera) passes into a linked frame should
  // look back out through its partner. Returns { m, q } to apply to the camera, or null.
  cameraThrough(from, to) {
    if (!this.linked) return null;
    for (const X of this.slots) {
      const n = X.normal;
      const d0 = _v.subVectors(from, X.pos).dot(n), d1 = _w.subVectors(to, X.pos).dot(n);
      if (!(d0 > 0 && d1 < 0)) continue;
      _c.lerpVectors(from, to, d0 / (d0 - d1)).sub(X.pos);
      const lx = _c.dot(X.right) / RX, ly = _c.dot(X.up) / RY;
      if (lx * lx + ly * ly <= 1) return { m: X.toOther, q: X.qOther, portal: X };
    }
    return null;
  }

  // ---- placing --------------------------------------------------------------
  place(hit, source = 'give') {
    const game = this.game;
    const fail = (msg) => {
      if (msg) game.ui?.toast(msg);
      if (hit && hit.point) this.fizzle(hit.point, hit.normal || UP);
      return false;
    };
    if (!hit || !hit.point || !hit.normal || hit.normal.lengthSq() < 0.5) return fail('Aim at a wall or the ground to hang a frame.');
    const e = hit.entity || null;
    const col = hit.collider && hit.collider.isValid && hit.collider.isValid() ? hit.collider : null;
    const body = col ? col.parent() : null;
    if (e && (e.dead || e.kind === 'enemy' || e.kind === 'boss')) return fail(STILL);
    if (body && !body.isFixed()) return fail(STILL);
    if (e && e.melt > 0.15) return fail('It\'s too soft to hold a frame.');
    if (!col || !((col.collisionGroups() >>> 16) & SURFACE)) return fail('There\'s nothing there to hang a frame on.');
    const n = hit.normal.clone().normalize();
    const up = this.upFor(n);
    const slot = this.nextSlot();
    const fit = this.fit(hit.point, n, up, col, this.slots[1 - slot]);
    if (!fit.ok) return fail(fit.reason);
    const old = this.slots[slot];
    if (old) this.remove(old, { quiet: true });
    const X = this.create(slot, fit.center, n, up, col, e, body);
    if (source === 'round') game.audio.sfx('give', { property: 'framed', position: X.pos, quantize: 'loose' });
    game.vfx.ring(X.pos.clone().addScaledVector(n, 0.03), 0.15, 1.5, 0.45, X.color, 0.9, n);
    return true;
  }

  // floors and ceilings take "up" from where the player faces; walls stand upright
  upFor(n) {
    const up = new THREE.Vector3();
    if (Math.abs(n.y) > 0.7) {
      const pl = this.game.player;
      if (pl) pl.camForward(up); else up.set(0, 0, 1);
      up.addScaledVector(n, -up.dot(n));
      if (up.lengthSq() < 1e-4 && pl) { pl.flatForward(up); up.addScaledVector(n, -up.dot(n)); }
      if (up.lengthSq() < 1e-4) up.set(0, 0, 1).addScaledVector(n, -n.z);
    } else {
      up.copy(UP).addScaledVector(n, -n.y);
    }
    return up.normalize();
  }

  // first A, then B, then always the older of the two
  nextSlot() {
    const [A, B] = this.slots;
    if (!A) return 0;
    if (!B) return 1;
    return A.born < B.born ? 0 : 1;
  }

  // Ray back into the surface from just in front of p. A ray running exactly down a
  // trimesh edge can slip between triangles, so a miss is retried a hair to the side.
  probe(p, n, back, right, up) {
    const ph = this.game.physics;
    const o = _c;
    for (let i = 0; i < 3; i++) {
      const j = i * 0.004;
      o.copy(p).addScaledVector(n, 0.3).addScaledVector(right, j).addScaledVector(up, j * 0.7);
      const h = ph.ray(o, back, 0.6, SURFACE);
      if (h) { if (j) h.point.addScaledVector(right, -j).addScaledVector(up, -j * 0.7); return h; }
    }
    return null;
  }

  // Does a frame fit here? Rim samples must all land on the same collider at about
  // the same depth; failing samples push the centre away from the edge (up to ~1 m).
  fit(point, n, up, col, other) {
    const ph = this.game.physics;
    const right = new THREE.Vector3().crossVectors(up, n).normalize();
    const handle = col.handle;
    const c = point.clone();
    const o = new THREE.Vector3(), rp = new THREE.Vector3(), dir = new THREE.Vector3(), push = new THREE.Vector2();
    const back = n.clone().negate();
    let moved = 0, overlapped = false;
    for (let iter = 0; iter < 12; iter++) {
      // seat the centre on the surface
      const h0 = this.probe(c, n, back, right, up);
      if (!h0 || h0.collider.handle !== handle || h0.normal.dot(n) < 0.8) break;
      c.copy(h0.point);
      const fails = [], good = [];
      let prot = Math.max(0, 0.3 - h0.dist);
      for (let k = 0; k < RIM_SAMPLES; k++) {
        const a = k / RIM_SAMPLES * Math.PI * 2;
        const ox = Math.cos(a) * FX, oy = Math.sin(a) * FY;
        rp.copy(c).addScaledVector(right, ox).addScaledVector(up, oy);
        const h = this.probe(rp, n, back, right, up);
        const ok = h && h.collider.handle === handle && Math.abs(h.dist - 0.3) <= 0.15 && h.normal.dot(n) > 0.8;
        if (ok) { prot = Math.max(prot, 0.3 - h.dist); good.push([ox, oy]); } else fails.push([ox, oy]);
      }
      // nothing may stand in the frame's way along the surface (the ground under a wall frame, a jutting wall...)
      if (!fails.length) {
        const lift = prot + 0.1;
        o.copy(c).addScaledVector(n, lift);
        for (const [ox, oy] of good) {
          rp.copy(c).addScaledVector(right, ox).addScaledVector(up, oy).addScaledVector(n, lift);
          dir.subVectors(rp, o);
          const len = dir.length();
          if (ph.ray(o, dir.multiplyScalar(1 / len), len, SURFACE)) fails.push([ox, oy]);
        }
      }
      // the other frame counts as a failing edge, so we slide away from it
      if (other) {
        for (let k = 0; k < RIM_SAMPLES; k++) {
          const a = k / RIM_SAMPLES * Math.PI * 2;
          const ox = Math.cos(a) * FX, oy = Math.sin(a) * FY;
          rp.copy(c).addScaledVector(right, ox).addScaledVector(up, oy);
          if (this.overlaps(other, rp)) { fails.push([ox, oy]); overlapped = true; }
        }
        if (this.overlaps(other, c)) {
          overlapped = true;
          _v.subVectors(other.pos, c);
          const lx = _v.dot(right), ly = _v.dot(up);
          if (Math.hypot(lx, ly) < 1e-3) break;
          fails.push([lx, ly]);
        }
      }
      if (!fails.length) {
        return { ok: true, center: c.clone().addScaledVector(n, LIFT + prot) };
      }
      if (fails.length >= RIM_SAMPLES - 1 || moved >= 1.0) break;
      push.set(0, 0);
      for (const [ox, oy] of fails) { const l = Math.hypot(ox / FX, oy / FY) || 1; push.x -= ox / FX / l; push.y -= oy / FY / l; }
      if (push.lengthSq() < 1e-6) break;
      push.normalize();
      const step = Math.min(0.12, 1.0 - moved + 1e-6);
      c.addScaledVector(right, push.x * step).addScaledVector(up, push.y * step);
      moved += step;
    }
    return { ok: false, reason: overlapped ? OVERLAP : NO_ROOM };
  }

  // is p (a world point) on the other frame's footprint?
  overlaps(X, p) {
    _w.subVectors(p, X.pos);
    const d = _w.dot(X.normal);
    if (d < -0.3 || d > 0.3) return false;
    const lx = _w.dot(X.right) / FX, ly = _w.dot(X.up) / FY;
    return lx * lx + ly * ly < 1;
  }

  create(slot, center, n, up0, col, entity, body) {
    const game = this.game;
    const normal = n.clone();
    const right = new THREE.Vector3().crossVectors(up0, normal).normalize();
    const up = new THREE.Vector3().crossVectors(normal, right).normalize();
    const m = new THREE.Matrix4().makeBasis(right, up, normal).setPosition(center);
    const q = new THREE.Quaternion().setFromRotationMatrix(m);
    const tint = TINTS[slot];
    const color = new THREE.Color(tint);
    const group = new THREE.Group();
    group.name = 'Portal' + 'AB'[slot];
    group.position.copy(center);
    group.quaternion.copy(q);
    group.scale.setScalar(0.001);
    const frame = this.makeFrame(color);
    const mat = this.makeViewMaterial(color, slot + this.seq * 0.37);
    const surface = new THREE.Mesh(shared().disc, mat);
    surface.name = 'PortalView';
    group.add(frame, surface);
    game.scene.add(group);
    const b = body || (entity && entity.body) || null;
    const t = b ? b.translation() : null;
    const X = {
      slot, label: 'AB'[slot], tint, color,
      pos: center.clone(), normal, up, right, m, inv: m.clone().invert(), q,
      collider: col, handle: col.handle, entity, body: b, bodyAt: t ? new THREE.Vector3(t.x, t.y, t.z) : null,
      group, frame, surface, mat, rt: null,
      born: ++this.seq, age: 0, cool: 0, burst: false, linked: false,
      other: null, toOther: null, qOther: null,
    };
    this.slots[slot] = X;
    this.relink();
    return X;
  }

  makeFrame(color) {
    const game = this.game;
    const grp = new THREE.Group();
    const S = shared();
    if (game.assets && game.assets.has && game.assets.has('PortalRing')) {
      const f = game.assets.clone('PortalRing');
      f.position.set(0, 0, 0);                                  // authored at the ellipse centre, facing +Z
      f.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
      grp.add(f);
      grp.userData.ownsMaterials = f;
    } else {
      for (const geo of [S.moulding, S.ornament, S.ribGeo]) {
        const mesh = new THREE.Mesh(geo, S.gold);
        mesh.castShadow = true; mesh.receiveShadow = true;
        grp.add(mesh);
      }
    }
    // the accent glow: a thin bead of light at the sight edge (never on the gilt)
    const bead = new THREE.Mesh(S.bead, new THREE.MeshBasicMaterial({ color: color.clone().multiplyScalar(1.25) }));
    bead.name = 'PortalGlow';
    grp.add(bead);
    grp.userData.bead = bead;
    return grp;
  }

  makeViewMaterial(color, seed) {
    return new THREE.ShaderMaterial({
      vertexShader: VIEW_VERT, fragmentShader: VIEW_FRAG,
      uniforms: {
        tView: { value: this.dummy }, uRes: this.uRes, uTime: this.uTime,
        uTint: { value: color.clone() }, uLive: { value: 0 }, uOpen: { value: 0 }, uSeed: { value: seed * 3.7 },
      },
      fog: false, toneMapped: false,
    });
  }

  relink() {
    const [A, B] = this.slots;
    this.linked = !!(A && B);
    for (const X of this.slots) if (X) { X.linked = this.linked; X.other = null; }
    if (!this.linked) return;
    A.other = B; B.other = A;
    A.toOther = new THREE.Matrix4().multiplyMatrices(B.m, FLIP).multiply(A.inv);
    B.toOther = new THREE.Matrix4().multiplyMatrices(A.m, FLIP).multiply(B.inv);
    A.qOther = B.q.clone().multiply(QFLIP).multiply(A.q.clone().invert());
    B.qOther = A.q.clone().multiply(QFLIP).multiply(B.q.clone().invert());
  }

  remove(X, { quiet = false } = {}) {
    if (!X || this.slots[X.slot] !== X) return;
    if (this.linked) this.evictPlayer(X);
    this.slots[X.slot] = null;
    X.closing = 0;
    X.closeFrom = X.group.scale.x;
    this.closing.push(X);
    if (!quiet) {
      this.game.vfx.propertyBurst(X.pos, 'framed', 0.5);
      this.game.vfx.impact(X.pos, X.normal, X.tint, 0.8);
    }
    this.relink();
  }

  dispose(X) {
    X.group.parent?.remove(X.group);
    X.mat.dispose();
    X.frame.userData.bead?.material.dispose();
    X.frame.userData.ownsMaterials?.traverse((o) => { if (o.isMesh) (Array.isArray(o.material) ? o.material : [o.material]).forEach((mm) => mm.dispose()); });
    if (X.rt) { X.rt.dispose(); X.rt = null; }
  }

  // anyone halfway through a frame that's closing is pushed back out the way they came
  evictPlayer(X) {
    const pl = this.game.player;
    if (!pl || !pl.body) return;
    const hh = pl.halfHNow(), need = pl.r + hh * Math.abs(X.normal.y);
    const t = pl.body.translation();
    _c.set(t.x, t.y, t.z);
    _v.subVectors(_c, X.pos);
    const d = _v.dot(X.normal);
    const lx = _v.dot(X.right) / RX, ly = _v.dot(X.up) / RY;
    if (lx * lx + ly * ly > 1.6 || d >= need - 0.02 || d < -need - 0.6) return;
    _c.addScaledVector(X.normal, need + 0.05 - d);
    pl.portalWarp(_c.clone(), new THREE.Quaternion());
  }

  fizzle(point, normal) {
    const vfx = this.game.vfx;
    vfx.impact(point, normal, '#cfd3da', 0.5);
    vfx.ring(point.clone().addScaledVector(normal, 0.03), 0.1, 0.6, 0.3, new THREE.Color('#8fe36b'), 0.5, normal);
  }

  // ---- per frame ------------------------------------------------------------
  update(dt) {
    const game = this.game;
    this.uTime.value = game.time;
    for (const X of this.slots) {
      if (!X) continue;
      X.age += dt;
      X.cool = Math.max(0, X.cool - dt);
      const k = Math.min(1, X.age / UNFURL);
      X.group.scale.setScalar(Math.max(0.001, k >= 1 ? 1 : easeOutBack(k)));
      X.frame.rotation.z = -0.9 * (1 - k) * (1 - k);                  // a twist as it unfurls
      X.mat.uniforms.uOpen.value = THREE.MathUtils.smoothstep(X.age, 0.05, UNFURL * 1.6);
      if (!X.burst && k >= 1) { X.burst = true; game.vfx.propertyBurst(X.pos.clone().addScaledVector(X.normal, 0.05), 'framed', 0.8); }
      if (this.surfaceGone(X)) this.remove(X);
    }
    for (let i = this.closing.length - 1; i >= 0; i--) {
      const X = this.closing[i];
      X.closing += dt;
      const k = Math.min(1, X.closing / 0.22);
      X.group.scale.setScalar(Math.max(0.001, X.closeFrom * (1 - k) * (1 - k)));
      X.mat.uniforms.uOpen.value = 1 - k;
      if (k >= 1) { this.dispose(X); this.closing.splice(i, 1); }
    }
    if (this.anchor) {
      const A = this.anchor;
      A.age += dt;
      const k = Math.min(1, A.age / UNFURL);
      A.group.scale.setScalar(0.32 * Math.max(0.003, k >= 1 ? 1 : easeOutBack(k)));
      A.mat.uniforms.uOpen.value = THREE.MathUtils.smoothstep(A.age, 0.05, UNFURL * 1.6);
      A.group.position.y = A.pos.y + 0.03 + Math.sin(game.time * 2.1) * 0.015;
      if (Math.random() < dt * 5) game.vfx.trail(A.pos.clone().add(_v.set((Math.random() - 0.5) * 0.4, 0.05, (Math.random() - 0.5) * 0.4)), ANCHOR_TINT, 0.07, 0.8);
    }
    if (this.linked) this.carryBodies(dt);
    if (this.bodyLast.size > 256) for (const [h, t] of this.bodyLast) if (game.time - t > 3) this.bodyLast.delete(h);
  }

  // the wall it hangs on was smashed, melted, or floated away
  surfaceGone(X) {
    const e = X.entity;
    if (e && (e.dead || e.melt > 0.2)) return true;
    if (!X.collider.isValid()) return true;
    const b = X.body;
    if (b) {
      if (!b.isValid()) return true;
      if (X.bodyAt) {
        const t = b.translation();
        const dx = t.x - X.bodyAt.x, dy = t.y - X.bodyAt.y, dz = t.z - X.bodyAt.z;
        if (dx * dx + dy * dy + dz * dz > 0.01) return true;
      }
    }
    return false;
  }

  // ---- the player -----------------------------------------------------------
  // capsule centre over the opening, and near it on the front side (or already partly through)
  linedUp(X, pl) {
    const hh = this.pHH;
    const p = pl.pos, n = X.normal;
    const cx = p.x - X.pos.x, cy = p.y + hh + pl.r - X.pos.y, cz = p.z - X.pos.z;
    const d = cx * n.x + cy * n.y + cz * n.z;
    const v = pl.vel;
    const vn = v.x * n.x + v.y * n.y + v.z * n.z;
    const reach = 1.2 + Math.max(0, -vn) * (2 / 60);          // a fast fall reaches further in one step
    if (d > reach || d < -(hh + pl.r + 0.5)) return false;
    const lx = (cx * X.right.x + cy * X.right.y + cz * X.right.z) / RX;
    const ly = (cx * X.up.x + cy * X.up.y + cz * X.up.z) / RY;
    return lx * lx + ly * ly <= 1;
  }

  afterPlayerMove(pl, prev, next) {
    this.pHH = pl.halfHNow();
    if (!this.linked) return false;
    for (const X of this.slots) {
      const n = X.normal;
      const d0 = _v.subVectors(prev, X.pos).dot(n);
      const d1 = _w.subVectors(next, X.pos).dot(n);
      if (!(d0 > 0 && d1 <= 0)) continue;
      if (X.cool > 0 && d0 < 0.05) continue;                 // just came out: ignore grazing re-entry
      const s = d0 / (d0 - d1);
      _c.lerpVectors(prev, next, s).sub(X.pos);
      const lx = _c.dot(X.right) / RX, ly = _c.dot(X.up) / RY;
      if (lx * lx + ly * ly > 1.1) continue;
      return this.warpPlayer(pl, X, next);
    }
    this.funnel(pl, next);
    return false;
  }

  warpPlayer(pl, X, next) {
    const game = this.game;
    const Y = X.other;
    const nc = next.clone().applyMatrix4(X.toOther);
    // out far enough that the capsule clears the exit surface
    const hh = pl.halfHNow();
    const need = pl.r + hh * Math.abs(Y.normal.y) + 0.06;
    const z = _v.subVectors(nc, Y.pos).dot(Y.normal);
    if (z < need) nc.addScaledVector(Y.normal, need - z);
    // and clear of the ground (or ceiling) around a wall exit
    const half = hh + pl.r;
    const down = game.physics.ray(nc, DOWN, half + 0.02, SURFACE);
    if (down && Y.normal.y < 0.7) nc.y += half + 0.02 - down.dist;
    else {
      const upH = game.physics.ray(nc, UP, half + 0.02, SURFACE);
      if (upH && Y.normal.y > -0.7) nc.y -= half + 0.02 - upH.dist;
    }
    Y.cool = PLAYER_COOL;
    // the controller presses grounded players down at a constant -3 m/s to hug slopes;
    // that isn't motion, so it doesn't get flung out of the other side
    if ((pl.state === 'ground' || pl.state === 'slide') && pl.vel.y < 0) pl.vel.y = 0;
    const speedIn = pl.vel.length();
    pl.portalWarp(nc, X.qOther.clone());
    this.pHH = pl.halfHNow();
    this.lastWarp = { what: 'player', from: X.label, to: Y.label, speedIn, speedOut: pl.vel.length(), time: game.time };
    game.audio.sfx('framed', { position: nc, gain: 0.8 });
    game.vfx.ring(Y.pos.clone().addScaledVector(Y.normal, 0.04), 0.3, 1.3, 0.3, Y.color, 0.6, Y.normal);
    game.vfx.ring(X.pos.clone().addScaledVector(X.normal, 0.04), 0.3, 1.1, 0.25, X.color, 0.4, X.normal);
    return true;
  }

  // Once partly through an opening, its rim holds you in: the capsule can't slide
  // sideways into the wall it has half-entered. On floors, gravity takes over.
  funnel(pl, next) {
    const hh = this.pHH;
    for (const X of this.slots) {
      const n = X.normal;
      const need = pl.r + hh * Math.abs(n.y);
      _v.subVectors(next, X.pos);
      const d = _v.dot(n);
      if (d >= need - 0.05 || d < -0.05) continue;
      const lx = _v.dot(X.right), ly = _v.dot(X.up);
      const e2 = (lx / RX) ** 2 + (ly / RY) ** 2;
      if (e2 > 1.8) continue;
      const lim = 0.9;
      if (e2 > lim * lim) {
        const k = lim / Math.sqrt(e2);
        const nx = lx * k, ny = ly * k;
        _c.copy(X.pos).addScaledVector(X.right, nx).addScaledVector(X.up, ny).addScaledVector(n, d);
        pl.body.setNextKinematicTranslation({ x: _c.x, y: _c.y, z: _c.z });
        pl.pos.set(_c.x, _c.y - hh - pl.r, _c.z);
        next.copy(_c);
        // lose the velocity pushing out against the rim
        _w.set(nx / (RX * RX), ny / (RY * RY), 0).normalize();
        const vr = pl.vel.dot(X.right), vu = pl.vel.dot(X.up);
        const out = vr * _w.x + vu * _w.y;
        if (out > 0) pl.vel.addScaledVector(X.right, -out * _w.x).addScaledVector(X.up, -out * _w.y);
      }
      if (n.y > 0.5 && pl.state === 'ground') {
        pl.state = 'air'; pl.grounded = false; pl.coyote = 0;
        pl.anim?.play('Fall', { fade: 0.2 });
      }
      return;
    }
  }

  // ---- projectiles ----------------------------------------------------------
  passProjectile(p, dt) {
    if (!this.linked || !p || p.type === 'shot') return false;
    const vx = p.vel.x * dt, vy = p.vel.y * dt, vz = p.vel.z * dt;
    for (const X of this.slots) {
      const n = X.normal;
      const d0 = _v.subVectors(p.pos, X.pos).dot(n);
      if (d0 <= 0) continue;
      const d1 = d0 + vx * n.x + vy * n.y + vz * n.z;
      if (d1 > 0) continue;
      const s = d0 / (d0 - d1);
      _c.set(p.pos.x + vx * s, p.pos.y + vy * s, p.pos.z + vz * s);
      _v.subVectors(_c, X.pos);
      const lx = _v.dot(X.right) / RX, ly = _v.dot(X.up) / RY;
      if (lx * lx + ly * ly > 1) continue;
      // something in the way before the frame? let the projectile hit that instead
      const len = Math.hypot(vx, vy, vz) * s;
      if (len > 1e-4) {
        const mask = p.type === 'round' ? (ALL & ~G.PLAYER & ~G.GHOST) : (G.WORLD | G.WALL | G.PROP | G.CEIL);
        _w.set(vx, vy, vz).normalize();
        if (this.game.physics.ray(p.pos, _w, len, mask)) return false;
      }
      const Y = X.other;
      p.pos.copy(_c).applyMatrix4(X.toOther).addScaledVector(Y.normal, 0.04);
      p.vel.applyQuaternion(X.qOther);
      this.game.vfx.trail(p.pos, Y.tint, 0.3, 0.3);
      this.lastWarp = { what: p.type, from: X.label, to: Y.label, speedIn: p.vel.length(), speedOut: p.vel.length(), time: this.game.time };
      return true;
    }
    return false;
  }

  // ---- rigid bodies (enemies, props, debris) --------------------------------
  // Contacts would stop a body at the wall behind a frame, so bodies go through
  // by proximity: close to the opening, over it, and heading in.
  carryBodies(dt) {
    const game = this.game;
    const now = game.time;
    for (const e of game.entities) {
      if (e.dead || !e.body || e.kind === 'boss') continue;
      if (!e.body.isDynamic()) continue;
      const r = e.radius();
      if (r > 0.95) continue;                                  // too big for the opening
      this.carry(e.body, r, e, null, dt, now);
    }
    const deb = game.destruction && game.destruction.debris;
    if (deb) for (const d of deb) if (d.body && d.body.isDynamic()) this.carry(d.body, 0.3, null, d, dt, now);
  }

  carry(b, r, e, d, dt, now) {
    const last = this.bodyLast.get(b.handle);
    if (last !== undefined && now - last < BODY_COOL) return false;
    const c = b.worldCom();
    for (const X of this.slots) {
      const dx = c.x - X.pos.x, dy = c.y - X.pos.y, dz = c.z - X.pos.z;
      if (dx * dx + dy * dy + dz * dz > 16) continue;
      const n = X.normal;
      const dist = dx * n.x + dy * n.y + dz * n.z;
      if (dist < -0.05) continue;
      const v = b.linvel();
      const vn = v.x * n.x + v.y * n.y + v.z * n.z;
      // how far the body reaches toward the frame: sleepwalkers are tall upright capsules
      const ext = e && e.kind === 'enemy' ? 0.34 + 0.55 * Math.abs(n.y) : r;
      if (dist > ext + 0.35 + Math.max(0, -vn) * Math.min(dt, 0.1) * 1.5) continue;
      // heading in, or lying still on a floor frame (which gravity would pull through)
      const resting = n.y > 0.7 && v.x * v.x + v.y * v.y + v.z * v.z < 0.36 && (last === undefined || now - last > 1.5);
      if (vn > -0.15 && !resting) continue;
      const lx = (dx * X.right.x + dy * X.right.y + dz * X.right.z) / RX;
      const ly = (dx * X.up.x + dy * X.up.y + dz * X.up.z) / RY;
      if (lx * lx + ly * ly > 1) continue;
      this.warpBody(b, X, c, dist, ext, v, e, d, now);
      return true;
    }
    return false;
  }

  warpBody(b, X, c, dist, r, v, e, d, now) {
    const game = this.game;
    const Y = X.other, q = X.qOther;
    const nc = _c.set(c.x, c.y, c.z).applyMatrix4(X.toOther);
    // the mapped centre sits behind the exit; bring it out the same distance (with room)
    const z = _v.subVectors(nc, Y.pos).dot(Y.normal);
    nc.addScaledVector(Y.normal, Math.max(dist, r + 0.12) - z);
    const locked = e && e.kind === 'enemy';                   // upright capsules stay upright
    const rot = b.rotation();
    _q.set(rot.x, rot.y, rot.z, rot.w);
    if (!locked) _q.premultiply(q);
    const lc = b.localCom();
    const off = _v.set(lc.x, lc.y, lc.z).applyQuaternion(_q);
    const speedIn = Math.hypot(v.x, v.y, v.z);
    b.setTranslation({ x: nc.x - off.x, y: nc.y - off.y, z: nc.z - off.z }, true);
    if (!locked) b.setRotation({ x: _q.x, y: _q.y, z: _q.z, w: _q.w }, true);
    const nv = _w.set(v.x, v.y, v.z).applyQuaternion(q);
    b.setLinvel({ x: nv.x, y: nv.y, z: nv.z }, true);
    const av = b.angvel();
    const na = _u.set(av.x, av.y, av.z).applyQuaternion(q);
    b.setAngvel({ x: na.x, y: na.y, z: na.z }, true);
    this.bodyLast.set(b.handle, now);
    const t = b.translation();
    if (e) {
      e._pv = { x: nv.x, y: nv.y, z: nv.z };                 // a trip isn't an impact
      if (locked) {
        if (e.maxVy !== undefined) e.maxVy = Math.min(0, nv.y); // nor a fall
        const f = _u.set(Math.sin(e.yaw), 0, Math.cos(e.yaw)).applyQuaternion(q);
        if (f.x * f.x + f.z * f.z > 0.01) e.yaw = Math.atan2(f.x, f.z);
        e.obj.quaternion.setFromAxisAngle(UP, e.yaw);
      } else e.obj.quaternion.copy(_q);
      e.obj.position.set(t.x, t.y, t.z);
    }
    if (d) {
      d.pv = { x: nv.x, y: nv.y, z: nv.z };
      d.mesh.position.set(t.x, t.y, t.z);
      d.mesh.quaternion.copy(_q);
    }
    this.lastWarp = { what: e ? e.name : 'debris', from: X.label, to: Y.label, speedIn, speedOut: nv.length(), time: now };
    if (e) {
      game.audio.sfx('framed', { position: nc, gain: 0.5 });
      game.vfx.ring(Y.pos.clone().addScaledVector(Y.normal, 0.04), 0.3, 1.2, 0.3, Y.color, 0.5, Y.normal);
    }
  }

  // ---- "give framed to yourself": a return point ----------------------------
  anchorPlayer(player) {
    const game = this.game;
    this.dropAnchor();
    const at = player.pos.clone();
    const color = new THREE.Color(ANCHOR_TINT);
    const group = new THREE.Group();
    group.name = 'PortalAnchor';
    const frame = this.makeFrame(color);
    const mat = this.makeViewMaterial(color, 7.3);
    group.add(frame, new THREE.Mesh(shared().disc, mat));
    // lying on its back, the top of the oval pointing where you face
    const f = player.flatForward(new THREE.Vector3());
    const right = new THREE.Vector3().crossVectors(f, UP).normalize();
    group.quaternion.setFromRotationMatrix(_m.makeBasis(right, f, UP));
    group.position.copy(at).addScaledVector(UP, 0.03);
    group.scale.setScalar(0.001);
    game.scene.add(group);
    this.anchor = { pos: at, group, frame, mat, age: 0 };
    game.vfx.propertyBurst(at.clone().setY(at.y + 0.3), 'framed', 0.6);
    return true;
  }

  recallPlayer(player) {
    const A = this.anchor;
    if (!A) return false;
    const game = this.game;
    const from = player.pos.clone();
    const c = A.pos.clone();
    c.y += player.halfHNow() + player.r;
    player.portalWarp(c, new THREE.Quaternion());
    this.pHH = player.halfHNow();
    game.vfx.propertyBurst(from.setY(from.y + 1), 'framed', 0.7);
    game.vfx.propertyBurst(A.pos.clone().setY(A.pos.y + 1), 'framed', 0.9);
    game.audio.sfx('framed', { position: c, gain: 0.9 });
    this.dropAnchor();
    return true;
  }

  dropAnchor() {
    const A = this.anchor;
    if (!A) return;
    A.group.parent?.remove(A.group);
    A.mat.dispose();
    A.frame.userData.bead?.material.dispose();
    A.frame.userData.ownsMaterials?.traverse((o) => { if (o.isMesh) (Array.isArray(o.material) ? o.material : [o.material]).forEach((mm) => mm.dispose()); });
    this.anchor = null;
  }

  clear() {
    for (const X of this.slots) if (X) this.dispose(X);
    for (const X of this.closing) this.dispose(X);
    this.slots = [null, null];
    this.closing = [];
    this.linked = false;
    this.dropAnchor();
    this.bodyLast.clear();
    this.lastWarp = null;
  }

  // ---- rendering ------------------------------------------------------------
  // Draw what each visible frame of a linked pair looks out onto, into its own
  // render target, just before the main (composer) render.
  beforeRender() {
    const game = this.game;
    const R = game.render;
    const r = R.renderer;
    this.uTime.value = game.time;
    r.getDrawingBufferSize(_size);
    this.uRes.value.copy(_size);
    for (const X of this.slots) if (X) { X.mat.uniforms.uLive.value = 0; X.mat.uniforms.tView.value = this.dummy; }
    if (!this.linked) return;
    const cam = R.camera;
    cam.updateMatrixWorld();
    _frustum.setFromProjectionMatrix(_m.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse));
    const eye = _u.setFromMatrixPosition(cam.matrixWorld);
    const vis = [];
    for (const X of this.slots) {
      const s = X.group.scale.x;
      if (s < 0.02) continue;
      if (_v.subVectors(eye, X.pos).dot(X.normal) <= 0.002) continue;   // behind it: nothing to see
      _sphere.center.copy(X.pos); _sphere.radius = 1.35 * Math.max(1, s);
      if (!_frustum.intersectsSphere(_sphere)) continue;
      vis.push(X);
    }
    if (!vis.length) return;
    // half the drawing buffer, capped at 1024 on the long side
    let w = _size.x * 0.5, h = _size.y * 0.5;
    const cap = 1024 / Math.max(w, h);
    if (cap < 1) { w *= cap; h *= cap; }
    w = Math.max(16, Math.round(w)); h = Math.max(16, Math.round(h));
    // save what we touch
    const prevTarget = r.getRenderTarget();
    const prevAuto = r.autoClear;
    const prevShadow = r.shadowMap.autoUpdate;
    const sky = R.sky;
    const prevSky = sky ? sky.position.clone() : null;
    try {
      r.autoClear = true;
      if (R.sun && R.sun.shadow && R.sun.shadow.map) r.shadowMap.autoUpdate = false;   // reuse last frame's shadows
      for (const X of vis) {
        const Y = X.other;
        this.ensureTarget(X, w, h);
        this.aimVirtualCamera(cam, X, Y);
        // no recursion: the exit's own view is hidden, and this frame shows its painted sky
        Y.surface.visible = false;
        if (sky) sky.position.setFromMatrixPosition(this.vcam.matrixWorld);
        r.setRenderTarget(X.rt);
        r.render(R.scene, this.vcam);
        Y.surface.visible = true;
      }
    } finally {
      r.setRenderTarget(prevTarget);
      r.autoClear = prevAuto;
      r.shadowMap.autoUpdate = prevShadow;
      if (sky) sky.position.copy(prevSky);
      for (const X of this.slots) if (X) X.surface.visible = true;
    }
    for (const X of vis) { X.mat.uniforms.tView.value = X.rt.texture; X.mat.uniforms.uLive.value = 1; }
  }

  ensureTarget(X, w, h) {
    if (!X.rt) {
      // linear HDR, like the composer's own buffer: the OutputPass tone-maps it once, with the rest
      X.rt = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, depthBuffer: true });
      X.rt.texture.colorSpace = THREE.LinearSRGBColorSpace;
      X.rt.texture.name = 'PortalView' + X.label;
    } else if (X.rt.width !== w || X.rt.height !== h) X.rt.setSize(w, h);
  }

  // the main camera carried through X and out of Y, clipped at Y's surface
  aimVirtualCamera(cam, X, Y) {
    const v = this.vcam;
    v.matrix.multiplyMatrices(X.toOther, cam.matrixWorld);
    v.matrix.decompose(v.position, v.quaternion, v.scale);
    v.matrixWorld.copy(v.matrix);
    v.matrixWorldInverse.copy(v.matrixWorld).invert();
    v.projectionMatrix.copy(cam.projectionMatrix);
    v.near = cam.near; v.far = cam.far; v.fov = cam.fov; v.aspect = cam.aspect;
    // Lengyel's oblique near plane: the exit surface becomes the near clip plane,
    // so the wall the exit hangs on (and anything behind it) is never drawn.
    _plane.setFromNormalAndCoplanarPoint(Y.normal, Y.pos).applyMatrix4(v.matrixWorldInverse);
    _clip.set(_plane.normal.x, _plane.normal.y, _plane.normal.z, _plane.constant);
    if (_clip.w < -1e-3) {
      const e = v.projectionMatrix.elements;
      _cq.set((Math.sign(_clip.x) + e[8]) / e[0], (Math.sign(_clip.y) + e[9]) / e[5], -1, (1 + e[10]) / e[14]);
      _clip.multiplyScalar(2 / _clip.dot(_cq));
      e[2] = _clip.x; e[6] = _clip.y; e[10] = _clip.z + 1; e[14] = _clip.w;
    }
    v.projectionMatrixInverse.copy(v.projectionMatrix).invert();
  }
}
