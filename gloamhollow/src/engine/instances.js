// Instanced rendering for the thousands of static props (trees, rocks,
// plants, crops...).  Every instance is remembered; only the ones near the
// player are written into the GPU buffers, refreshed as the player moves.
import * as THREE from 'three';

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();
const _e = new THREE.Euler();
const WHITE = new THREE.Color(1, 1, 1);

export class InstancePool {
  constructor(library, name, { capacity = 512, castShadow = true, receiveShadow = true, radius = 120, shadowRadius = 48 } = {}) {
    this.name = name;
    this.radius = radius;
    this.shadowRadius = castShadow ? shadowRadius : 0;
    this.items = [];          // { x, y, z, rot, scale, matrix, alive, slot, data }
    const make = (shadow) => library.getParts(name).map(({ geometry, material }) => {
      const im = new THREE.InstancedMesh(geometry, material, capacity);
      im.count = 0;
      im.castShadow = shadow && material.name !== 'Mat_Emit';
      im.receiveShadow = receiveShadow;
      im.frustumCulled = true;
      im.name = `inst_${name}${shadow ? '' : '_far'}`;
      return im;
    });
    // near instances cast shadows; far ones don't (the shadow map only covers ~45 m)
    this.meshes = make(true);
    this.farMeshes = this.shadowRadius > 0 ? make(false) : [];
    this.group = new THREE.Group();
    for (const m of this.meshes) this.group.add(m);
    for (const m of this.farMeshes) this.group.add(m);
    this.capacity = capacity;
    this.dirty = true;
    this.lastCenter = new THREE.Vector3(1e9, 0, 1e9);
    this.visibleItems = [];
  }

  add(x, y, z, rot = 0, scale = 1, data = null, tilt = null) {
    const it = { x, y, z, rot, scale, alive: true, slot: -1, data, matrix: new THREE.Matrix4() };
    this.compose(it, tilt);
    this.items.push(it);
    this.dirty = true;
    return it;
  }

  compose(it, tilt = null) {
    _e.set(tilt ? tilt.x : 0, it.rot, tilt ? tilt.z : 0, 'YXZ');
    _q.setFromEuler(_e);
    const s = typeof it.scale === 'number' ? _s.setScalar(it.scale) : _s.copy(it.scale);
    it.matrix.compose(_p.set(it.x, it.y, it.z), _q, s);
  }

  update(it) { this.compose(it); this.dirty = true; }
  setColor(it, color) { it.color = color; this.colored = true; this.dirty = true; }
  kill(it) { it.alive = false; this.dirty = true; }
  revive(it) { it.alive = true; this.dirty = true; }

  // Rewrite GPU buffers with the living instances within `radius` of center.
  refresh(center, force = false) {
    if (!force && !this.dirty && center.distanceToSquared(this.lastCenter) < 36) return;
    this.lastCenter.copy(center);
    this.dirty = false;
    const r2 = this.radius * this.radius;
    const s2 = this.shadowRadius * this.shadowRadius;
    const vis = this.visibleItems;
    const far = this._far || (this._far = []);
    vis.length = 0;
    far.length = 0;
    for (const it of this.items) {
      it.slot = -1;
      if (!it.alive) continue;
      const dx = it.x - center.x, dz = it.z - center.z;
      const d2 = dx * dx + dz * dz;
      if (d2 > r2) continue;
      if (this.farMeshes.length && d2 > s2) { if (far.length < this.capacity) far.push(it); continue; }
      if (vis.length >= this.capacity) continue;
      it.slot = vis.length;
      vis.push(it);
    }
    const colored = this.colored;
    const write = (meshes, list) => {
      for (const im of meshes) {
        for (let i = 0; i < list.length; i++) {
          im.setMatrixAt(i, list[i].matrix);
          if (colored) im.setColorAt(i, list[i].color || WHITE);
        }
        im.count = list.length;
        im.instanceMatrix.needsUpdate = true;
        if (colored && im.instanceColor) im.instanceColor.needsUpdate = true;
        im.boundingSphere = null; // recomputed lazily by three.js
      }
    };
    write(this.meshes, vis);
    write(this.farMeshes, far);
  }
}

// A registry of pools keyed by model name.
export class InstanceManager {
  constructor(library, scene) {
    this.library = library;
    this.scene = scene;
    this.pools = new Map();
  }

  pool(name, opts = {}) {
    let p = this.pools.get(name);
    if (!p) {
      p = new InstancePool(this.library, name, opts);
      this.pools.set(name, p);
      this.scene.add(p.group);
    }
    return p;
  }

  refresh(center, force = false) {
    for (const p of this.pools.values()) p.refresh(center, force);
  }
}
