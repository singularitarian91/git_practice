// Loads the Blender-made .glb files and hands out models by name.
// Missing models fall back to a labelled placeholder so the game still runs.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { applyGameMaterials, getSharedMaterials } from './materials.js';

export const MODEL_FILES = ['characters', 'enemies', 'nature', 'crops', 'items', 'buildings', 'props'];

export class ModelLibrary {
  constructor() {
    this.templates = new Map();
    this.parts = new Map();
    this.missing = new Set();
    this.bounds = new Map();
  }

  async load(baseUrl = 'assets/models/', onProgress = () => {}) {
    const loader = new GLTFLoader();
    let done = 0;
    const results = await Promise.all(MODEL_FILES.map(async (f) => {
      try {
        const gltf = await loader.loadAsync(`${baseUrl}${f}.glb`);
        return { f, gltf };
      } catch (e) {
        console.warn(`[assets] could not load ${f}.glb`, e && e.message);
        return { f, gltf: null };
      } finally {
        done++;
        onProgress(done / MODEL_FILES.length, f);
      }
    }));
    for (const { gltf } of results) {
      if (!gltf) continue;
      for (const child of [...gltf.scene.children]) {
        applyGameMaterials(child);
        child.updateMatrixWorld(true);
        this.templates.set(child.name, child);
      }
    }
    return this;
  }

  has(name) { return this.templates.has(name); }

  template(name) {
    let t = this.templates.get(name);
    if (!t) {
      t = makePlaceholder(name);
      this.templates.set(name, t);
      this.missing.add(name);
      console.warn(`[assets] missing model "${name}" – using placeholder`);
    }
    return t;
  }

  // A fresh copy (shares geometry & materials).  Custom props → userData.
  clone(name) {
    const t = this.template(name);
    const c = t.clone(true);
    c.userData = { ...t.userData };
    return c;
  }

  // Geometry+material pairs baked into the root's space, for instancing.
  getParts(name) {
    if (this.parts.has(name)) return this.parts.get(name);
    const t = this.template(name);
    t.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().copy(t.matrixWorld).invert();
    const byMat = new Map();
    t.traverse((o) => {
      if (!o.isMesh) return;
      const g = o.geometry.clone();
      g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld));
      const key = o.material.uuid;
      if (!byMat.has(key)) byMat.set(key, { material: o.material, geos: [] });
      byMat.get(key).geos.push(g);
    });
    const parts = [];
    for (const { material, geos } of byMat.values()) {
      parts.push({ material, geometry: geos.length === 1 ? geos[0] : mergeSimple(geos) });
    }
    this.parts.set(name, parts);
    return parts;
  }

  // Axis-aligned bounds of a model in its own space (cached).
  getBounds(name) {
    if (this.bounds.has(name)) return this.bounds.get(name);
    const t = this.template(name);
    const b = new THREE.Box3().setFromObject(t);
    // setFromObject uses world matrices; templates sit at the origin
    this.bounds.set(name, b);
    return b;
  }

  // Find named child nodes (sockets such as light, door, hand_r).
  static sockets(root, prefix) {
    const out = [];
    root.traverse((o) => { if (o.name === prefix || o.name.startsWith(prefix + '_') || o.name.startsWith(prefix + '.')) out.push(o); });
    return out;
  }
}

// Merge non-indexed/indexed geometries with identical attribute sets.
function mergeSimple(geos) {
  const ng = geos.map((g) => (g.index ? g.toNonIndexed() : g));
  const names = Object.keys(ng[0].attributes).filter((n) => ng.every((g) => g.attributes[n]));
  const out = new THREE.BufferGeometry();
  for (const n of names) {
    const item = ng[0].attributes[n].itemSize;
    const total = ng.reduce((s, g) => s + g.attributes[n].count, 0);
    const arr = new Float32Array(total * item);
    let off = 0;
    for (const g of ng) {
      const a = g.attributes[n];
      for (let i = 0; i < a.count; i++) {
        for (let k = 0; k < item; k++) arr[off++] = a.getComponent(i, k);
      }
    }
    out.setAttribute(n, new THREE.BufferAttribute(arr, item));
  }
  out.computeBoundingSphere();
  return out;
}

// Grey box with a rough size guess from the name, so a missing asset is obvious.
function makePlaceholder(name) {
  let size = [0.6, 0.6, 0.6];
  if (/^tree_/.test(name)) size = [1, 7, 1];
  else if (/^(house|villager_house|museum|shop|hearth|longship|dock|bridge)/.test(name)) size = [4, 3, 4];
  else if (/^(npc_|player|enemy_|critter_deer)/.test(name)) size = [0.6, 1.6, 0.5];
  else if (/^boss/.test(name)) size = [1.5, 3, 3];
  else if (/^(rock|ore|cliff)/.test(name)) size = [1, 0.8, 1];
  const mats = getSharedMaterials();
  const g = new THREE.BoxGeometry(size[0], size[1], size[2]);
  g.translate(0, size[1] / 2, 0);
  const colors = new Float32Array(g.attributes.position.count * 3).fill(0.5);
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const m = new THREE.Mesh(g, mats.Mat_Base);
  m.castShadow = true;
  m.receiveShadow = true;
  const root = new THREE.Group();
  root.name = name;
  root.add(m);
  root.userData.placeholder = true;
  return root;
}
