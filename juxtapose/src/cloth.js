// Cloth for the Figment's suit. Each garment arrives as a skinned sheet
// (blender/build_figure_v3.py); the skinned pose is where the cloth wants to be.
// Every particle may stray from that pose by its own reach, painted per vertex
// in Blender (_maxd: nothing at the yoke and the waistband, most at the hems,
// sleeve mouths and scarf ends). Within that reach it is simulated: Verlet in
// world space, so running trails the coat and stopping swings it; edge and bend
// lengths held by position-based constraints; pushed out of capsules on the body.
// The reach is what keeps game cloth stable: nothing can tunnel, tangle or
// explode further than the painter allowed.
//
// It steps from the scene's render hook (after world matrices are final, before
// geometry is uploaded), once per advance of the game clock, so it always sees
// the frame's final pose whoever moved the figure, holds still while paused, and
// does not step again for the extra passes portals render.
import * as THREE from 'three';

const _m = new THREE.Matrix4(), _inv = new THREE.Matrix4();
const GRAV = -9.8;

// every live garment; the scene steps the ones that are in it
const LIVE = new Set();
export function stepCloth(scene) {
  for (const c of LIVE) {
    let o = c.mesh, shown = true;
    while (o && o !== scene) { if (!o.visible) { shown = false; break; } o = o.parent; }
    if (o === scene && shown) c.step(); else c.last = null; // off stage: start from the pose when it returns
  }
}

// body capsules, by bone: [from, to, radius, torso]. Limbs push any cloth they meet; the
// torso only pushes the loose cloth (what is pinned already lies on it by design)
const CAPSULES = [
  ['hips', 'chest', 0.13, true], ['chest', 'neck', 0.13, true],
  ['thighL', 'shinL', 0.085], ['thighR', 'shinR', 0.085],
  ['shinL', 'footL', 0.06], ['shinR', 'footR', 0.06],
  ['upperarmL', 'forearmL', 0.056], ['upperarmR', 'forearmR', 0.056],
  ['forearmL', 'handL', 0.045], ['forearmR', 'handR', 0.045],
];

const WANTS = { Hakama: /thigh|shin|forearm/, Inner: /arm/, Scarf: /arm|thigh/ };
// garments that lie on the torso and never wrap an arm: an arm pressing them always has them under it
const UNDER = { Inner: true, Scarf: true };

export class ClothGarment {
  // sm: a skinned garment already bound to the figure's bones; clock: () => game seconds
  constructor(sm, root, clock, opts = {}) {
    this.root = root; this.clock = clock;
    this.iters = opts.iters ?? 3;
    this.damp = opts.damp ?? 0.975;
    this.skeleton = sm.skeleton;
    const g = sm.geometry;
    const pos = g.attributes.position, sw = g.attributes.skinWeight, si = g.attributes.skinIndex;
    const maxd = g.attributes._maxd;
    const n = pos.count;
    // weld UV seams: one particle per distinct bind position
    const key = new Map(), vp = new Int32Array(n), rep = [];
    for (let i = 0; i < n; i++) {
      const k = `${Math.round(pos.getX(i) * 2e4)},${Math.round(pos.getY(i) * 2e4)},${Math.round(pos.getZ(i) * 2e4)}`;
      let p = key.get(k);
      if (p === undefined) { p = rep.length; key.set(k, p); rep.push(i); }
      vp[i] = p;
    }
    const P = this.count = rep.length;
    this.vp = vp;
    this.bind = new Float32Array(P * 3);
    this.sidx = new Uint16Array(P * 4); this.swt = new Float32Array(P * 4);
    this.reach = new Float32Array(P).fill(1e9);
    for (let p = 0; p < P; p++) {
      const i = rep[p];
      this.bind[p * 3] = pos.getX(i); this.bind[p * 3 + 1] = pos.getY(i); this.bind[p * 3 + 2] = pos.getZ(i);
      for (let j = 0; j < 4; j++) { this.sidx[p * 4 + j] = si.getComponent(i, j); this.swt[p * 4 + j] = sw.getComponent(i, j); }
    }
    for (let i = 0; i < n; i++) this.reach[vp[i]] = Math.min(this.reach[vp[i]], maxd ? maxd.getX(i) : 0);
    // constraints: every edge, plus the vertex across each shared edge (bending)
    const idx = g.index.array, edges = new Map(), opp = new Map();
    const addE = (a, b, o) => {
      if (a === b) return;
      const k = a < b ? a * P + b : b * P + a;
      if (!edges.has(k)) edges.set(k, [a, b]);
      if (!opp.has(k)) opp.set(k, [o]); else opp.get(k).push(o);
    };
    const tris = [];
    for (let t = 0; t < idx.length; t += 3) {
      const a = vp[idx[t]], b = vp[idx[t + 1]], c = vp[idx[t + 2]];
      tris.push(a, b, c);
      addE(a, b, c); addE(b, c, a); addE(c, a, b);
    }
    this.tris = new Uint32Array(tris);
    const len = (a, b) => Math.hypot(this.bind[a * 3] - this.bind[b * 3], this.bind[a * 3 + 1] - this.bind[b * 3 + 1], this.bind[a * 3 + 2] - this.bind[b * 3 + 2]);
    const cons = [];
    for (const [a, b] of edges.values()) cons.push(a, b, len(a, b), 1);
    // bending only where the cloth can actually swing
    for (const os of opp.values()) if (os.length === 2 && os[0] !== os[1] && Math.min(this.reach[os[0]], this.reach[os[1]]) > 0.03) cons.push(os[0], os[1], len(os[0], os[1]), 0.35);
    // only constraints touching a free particle matter
    const keep = [];
    for (let c = 0; c < cons.length; c += 4) if (this.reach[cons[c]] > 0 || this.reach[cons[c + 1]] > 0) keep.push(cons[c], cons[c + 1], cons[c + 2], cons[c + 3]);
    this.cA = new Uint32Array(keep.length / 4); this.cB = new Uint32Array(keep.length / 4);
    this.cL = new Float32Array(keep.length / 4); this.cK = new Float32Array(keep.length / 4);
    for (let c = 0, j = 0; c < keep.length; c += 4, j++) { this.cA[j] = keep[c]; this.cB[j] = keep[c + 1]; this.cL[j] = keep[c + 2]; this.cK[j] = keep[c + 3]; }
    this.x = new Float32Array(P * 3); this.xp = new Float32Array(P * 3); this.t = new Float32Array(P * 3);
    this.nrm = new Float32Array(P * 3);
    // each garment meets the limbs that can reach it (the torso pair always first: the side rule uses it)
    const want = WANTS[sm.name.replace(/^Figment_/, '')] || /./;
    this.caps = CAPSULES.filter(([a], k) => k < 2 || want.test(a))
      .map(([a, b, r, torso]) => ({ a: root.getObjectByName(a), b: b && root.getObjectByName(b), r, torso: !!torso })).filter((c) => c.a && (c.b || c.b === null));
    this.capBuf = new Float32Array(this.caps.length * 7);
    this.capTorso = this.caps.map((c) => c.torso);
    this.capArm = this.caps.map((c) => /arm|hand/.test(c.a.name));
    this.under = !!UNDER[sm.name.replace(/^Figment_/, '')];
    this.last = null;
    this.ready = false;

    // the drawn mesh: plain, in the figure root's space, written each step
    const geo = new THREE.BufferGeometry();
    geo.setIndex(g.index);
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(n * 3), 3).setUsage(THREE.DynamicDrawUsage));
    if (g.attributes.uv) geo.setAttribute('uv', g.attributes.uv);
    this.mesh = new THREE.Mesh(geo, sm.material);
    this.mesh.name = sm.name + '_Cloth';
    this.mesh.castShadow = true; this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false;
    LIVE.add(this);
  }

  dispose() { LIVE.delete(this); }

  // world-space skinned targets for every particle
  targets() {
    const bones = this.skeleton.bones, inv = this.skeleton.boneInverses, B = this.bm || (this.bm = new Float32Array(bones.length * 16));
    for (let b = 0; b < bones.length; b++) {
      _m.multiplyMatrices(bones[b].matrixWorld, inv[b]);
      B.set(_m.elements, b * 16);
    }
    const T = this.t, X = this.bind, I = this.sidx, W = this.swt;
    for (let p = 0; p < this.count; p++) {
      const x = X[p * 3], y = X[p * 3 + 1], z = X[p * 3 + 2];
      let ox = 0, oy = 0, oz = 0;
      for (let j = 0; j < 4; j++) {
        const w = W[p * 4 + j];
        if (w === 0) continue;
        const e = I[p * 4 + j] * 16;
        ox += w * (B[e] * x + B[e + 4] * y + B[e + 8] * z + B[e + 12]);
        oy += w * (B[e + 1] * x + B[e + 5] * y + B[e + 9] * z + B[e + 13]);
        oz += w * (B[e + 2] * x + B[e + 6] * y + B[e + 10] * z + B[e + 14]);
      }
      T[p * 3] = ox; T[p * 3 + 1] = oy; T[p * 3 + 2] = oz;
    }
  }

  snap() {
    this.x.set(this.t); this.xp.set(this.t);
    this.ready = true;
  }

  step() {
    const now = this.clock();
    if (now === this.last) return;
    const dt = this.last === null ? 0 : now - this.last;
    // world matrices are this frame's already: the scene's render hook runs after its update
    this.targets();
    // a long gap (off screen, a cutscene cut, a teleport): start again from the pose
    if (!this.ready || this.last === null || dt > 0.25 || dt <= 0) { this.last = now; this.snap(); this.write(); return; }
    this.last = now;
    const X = this.x, XP = this.xp, T = this.t, R = this.reach;
    // capsule endpoints this frame
    const cb = this.capBuf;
    this.caps.forEach((c, i) => {
      const a = c.a.matrixWorld.elements, b = (c.b || c.a).matrixWorld.elements;
      cb[i * 7] = a[12]; cb[i * 7 + 1] = a[13]; cb[i * 7 + 2] = a[14]; cb[i * 7 + 3] = b[12]; cb[i * 7 + 4] = b[13]; cb[i * 7 + 5] = b[14]; cb[i * 7 + 6] = c.r;
    });
    const subs = dt > 1 / 40 ? 2 : 1, h = dt / subs;
    for (let s = 0; s < subs; s++) {
      // integrate the free particles; the pinned ones ride the pose
      const g = GRAV * h * h, damp = this.damp;
      for (let p = 0; p < this.count; p++) {
        const i = p * 3;
        if (R[p] <= 0) { XP[i] = X[i] = T[i]; XP[i + 1] = X[i + 1] = T[i + 1]; XP[i + 2] = X[i + 2] = T[i + 2]; continue; }
        const vx = (X[i] - XP[i]) * damp, vy = (X[i + 1] - XP[i + 1]) * damp, vz = (X[i + 2] - XP[i + 2]) * damp;
        XP[i] = X[i]; XP[i + 1] = X[i + 1]; XP[i + 2] = X[i + 2];
        X[i] += vx; X[i + 1] += vy + g; X[i + 2] += vz;
      }
      // the body has the last word: the leash may pull cloth back toward the pose, but never
      // into a limb, so a limb that meets the cloth pushes it aside rather than through it
      for (let it = 0; it < this.iters; it++) {
        this.solveEdges();
        this.leash();
        this.collide(cb);
      }
    }
    this.write();
  }

  solveEdges() {
    const X = this.x, R = this.reach, A = this.cA, B = this.cB, L = this.cL, K = this.cK;
    for (let c = 0; c < A.length; c++) {
      const a = A[c] * 3, b = B[c] * 3;
      const wa = R[A[c]] > 0 ? 1 : 0, wb = R[B[c]] > 0 ? 1 : 0, ws = wa + wb;
      if (ws === 0) continue;
      const dx = X[b] - X[a], dy = X[b + 1] - X[a + 1], dz = X[b + 2] - X[a + 2];
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (d < 1e-9) continue;
      const k = K[c] * (d - L[c]) / (d * ws);
      X[a] += dx * k * wa; X[a + 1] += dy * k * wa; X[a + 2] += dz * k * wa;
      X[b] -= dx * k * wb; X[b + 1] -= dy * k * wb; X[b + 2] -= dz * k * wb;
    }
  }

  // Push particles out of the body capsules, toward the side of the limb where the particle's
  // own pose lies. A thin strip a limb crosses (the scarf on the chest, the hakama's front) then
  // moves as one to that side instead of splitting round the limb and staying pierced.
  // Pinned cloth is moved by limbs only: what is pinned already lies on the torso by design.
  collide(cb) {
    const X = this.x, T = this.t, R = this.reach, nc = this.caps.length, torso = this.capTorso, armCap = this.capArm;
    // the torso's axis, hips to neck (the first two capsules)
    const hx = cb[0], hy = cb[1], hz = cb[2], nx = cb[10] - hx, ny = cb[11] - hy, nz = cb[12] - hz, nn = nx * nx + ny * ny + nz * nz || 1;
    for (let p = 0; p < this.count; p++) {
      const i = p * 3, pinned = R[p] <= 0;
      for (let c = 0; c < nc; c++) {
        if (pinned && torso[c]) continue;
        const o = c * 7, r = cb[o + 6] + 0.012;
        const ax = cb[o], ay = cb[o + 1], az = cb[o + 2];
        const ex = cb[o + 3] - ax, ey = cb[o + 4] - ay, ez = cb[o + 5] - az;
        const ee = ex * ex + ey * ey + ez * ez;
        let t = ee > 0 ? ((X[i] - ax) * ex + (X[i + 1] - ay) * ey + (X[i + 2] - az) * ez) / ee : 0;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const qx = ax + ex * t, qy = ay + ey * t, qz = az + ez * t;
        const dx = X[i] - qx, dy = X[i + 1] - qy, dz = X[i + 2] - qz;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 >= r * r) continue;
        // which side. Cloth that lies on the body (its pose within a hand of the torso's axis)
        // goes under an arm, between arm and torso, as it does when an arm folds across a
        // chest; everything else (legs in their hakama, loose cloth) goes to its pose's side.
        let tt = ((T[i] - hx) * nx + (T[i + 1] - hy) * ny + (T[i + 2] - hz) * nz) / nn;
        tt = tt < 0 ? 0 : tt > 1 ? 1 : tt;
        const bx = hx + nx * tt, by = hy + ny * tt, bz = hz + nz * tt;
        // (only cloth lying between the arm and the torso: a sleeve round its own arm, or anything
        // on the arm's far side, keeps to its own side)
        const tb2 = (T[i] - bx) ** 2 + (T[i + 1] - by) ** 2 + (T[i + 2] - bz) ** 2;
        let ut = ((qx - hx) * nx + (qy - hy) * ny + (qz - hz) * nz) / nn;
        ut = ut < 0 ? 0 : ut > 1 ? 1 : ut;
        const ax2 = hx + nx * ut - qx, ay2 = hy + ny * ut - qy, az2 = hz + nz * ut - qz;
        const onBody = armCap[c] && tb2 < 0.22 * 0.22 && (this.under || tb2 < ax2 * ax2 + ay2 * ay2 + az2 * az2);
        let sx, sy, sz;
        if (onBody) {
          sx = ax2; sy = ay2; sz = az2;
        } else { sx = T[i] - qx; sy = T[i + 1] - qy; sz = T[i + 2] - qz; }
        const along = (sx * ex + sy * ey + sz * ez) / (ee || 1);
        sx -= ex * along; sy -= ey * along; sz -= ez * along;   // square to the axis
        let sl = Math.sqrt(sx * sx + sy * sy + sz * sz);
        if (sl < 1e-6) { sx = dx; sy = dy; sz = dz; sl = Math.sqrt(d2); }
        if (sl < 1e-9) continue;
        X[i] = qx + sx / sl * r; X[i + 1] = qy + sy / sl * r; X[i + 2] = qz + sz / sl * r;
      }
    }
  }

  // never further from the pose than the painter allowed
  leash() {
    const X = this.x, T = this.t, R = this.reach;
    for (let p = 0; p < this.count; p++) {
      const r = R[p];
      if (r <= 0) continue;
      const i = p * 3;
      const dx = X[i] - T[i], dy = X[i + 1] - T[i + 1], dz = X[i + 2] - T[i + 2];
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 <= r * r) continue;
      const k = r / Math.sqrt(d2);
      X[i] = T[i] + dx * k; X[i + 1] = T[i + 1] + dy * k; X[i + 2] = T[i + 2] + dz * k;
    }
  }

  // particles -> drawn vertices, in the figure root's space, with fresh normals
  write() {
    _inv.copy(this.mesh.parent ? this.mesh.parent.matrixWorld : this.root.matrixWorld).invert();
    const e = _inv.elements, X = this.x, N = this.nrm, tr = this.tris;
    N.fill(0);
    for (let t = 0; t < tr.length; t += 3) {
      const a = tr[t] * 3, b = tr[t + 1] * 3, c = tr[t + 2] * 3;
      const ux = X[b] - X[a], uy = X[b + 1] - X[a + 1], uz = X[b + 2] - X[a + 2];
      const vx = X[c] - X[a], vy = X[c + 1] - X[a + 1], vz = X[c + 2] - X[a + 2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      N[a] += nx; N[a + 1] += ny; N[a + 2] += nz; N[b] += nx; N[b + 1] += ny; N[b + 2] += nz; N[c] += nx; N[c + 1] += ny; N[c + 2] += nz;
    }
    const pos = this.mesh.geometry.attributes.position, nrm = this.mesh.geometry.attributes.normal;
    const PA = pos.array, NA = nrm.array, vp = this.vp;
    for (let v = 0; v < vp.length; v++) {
      const i = vp[v] * 3, x = X[i], y = X[i + 1], z = X[i + 2];
      PA[v * 3] = e[0] * x + e[4] * y + e[8] * z + e[12];
      PA[v * 3 + 1] = e[1] * x + e[5] * y + e[9] * z + e[13];
      PA[v * 3 + 2] = e[2] * x + e[6] * y + e[10] * z + e[14];
      const nx = N[i], ny = N[i + 1], nz = N[i + 2];
      const rx = e[0] * nx + e[4] * ny + e[8] * nz, ry = e[1] * nx + e[5] * ny + e[9] * nz, rz = e[2] * nx + e[6] * ny + e[10] * nz;
      const l = Math.hypot(rx, ry, rz) || 1;
      NA[v * 3] = rx / l; NA[v * 3 + 1] = ry / l; NA[v * 3 + 2] = rz / l;
    }
    pos.needsUpdate = true; nrm.needsUpdate = true;
  }
}
