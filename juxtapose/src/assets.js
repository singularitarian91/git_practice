// Asset loading (Blender-made GLBs), template cloning, and the per-entity
// "dream material" shader injections (melting droop, lucid wobble).
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { DREAM, inkify } from './render.js';

// Fetch a .glb; hosts that won't serve binary models get a text copy instead:
// gzipped then base64-encoded (about a third of the size), or plain base64
function fromBase64(text) {
  const bin = atob(text.trim());
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
async function fetchModel(url) {
  try {
    const r = await fetch(url);
    if (r.ok) {
      const buf = await r.arrayBuffer();
      const magic = new Uint8Array(buf, 0, 4);
      if (magic[0] === 0x67 && magic[1] === 0x6c && magic[2] === 0x54 && magic[3] === 0x46) return buf; // 'glTF'
    }
  } catch (e) { /* fall through to the text copies */ }
  if (typeof DecompressionStream !== 'undefined') {
    try {
      const r = await fetch(url + '.gz.b64.txt');
      if (r.ok) {
        const gz = fromBase64(await r.text());
        return await new Response(new Blob([gz]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
      }
    } catch (e) { /* fall through to plain base64 */ }
  }
  const r2 = await fetch(url + '.b64.txt');
  if (!r2.ok) throw new Error(`Could not load ${url}`);
  return fromBase64(await r2.text()).buffer;
}

export class Assets {
  constructor() {
    this.loader = new GLTFLoader();
    this.templates = new Map();
    this.textures = {};
  }

  async load(onProgress) {
    // the town kit and street dressing are optional: the game falls back to placeholder shells without them
    const files = [['props', './assets/props.glb'], ['figure', './assets/figure.glb'], ['town', './assets/town.glb', true], ['street', './assets/street.glb', true], ['hero', './assets/hero.glb', true]];
    let done = 0;
    const results = await Promise.all(files.map(async ([k, url, optional]) => {
      let g = null;
      try { g = await this.loader.parseAsync(await fetchModel(url), './assets/'); } catch (e) { if (!optional) throw e; }
      done++; onProgress && onProgress(done / files.length);
      return [k, g];
    }));
    for (const [k, g] of results) this[k] = g;
    await this.loadTextureLibrary();
    // ink edges on anything with a silhouette the player has to read at a glance
    const inkAll = (root, k) => root.traverse((o) => {
      if (!o.isMesh) return;
      for (const m of (Array.isArray(o.material) ? o.material : [o.material])) if (!m.transparent && !(m.emissiveIntensity > 1 && m.emissive?.getHex())) inkify(m, k);
    });
    this.figure.scene.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    inkAll(this.figure.scene, 0.5);
    // index every top-level prop object by name
    for (const child of [...this.props.scene.children]) {
      child.traverse((o) => {
        if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; this.tuneMaterial(o.material); }
      });
      this.templates.set(child.name, child);
    }
    for (const kit of [this.town, this.street]) if (kit) for (const child of [...kit.scene.children]) {
      child.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; this.tuneMaterial(o.material); } });
      this.templates.set(child.name, child);
    }
    this.dressHeroes();
    for (const [name, k] of [['Sleepwalker', 0.75], ['Unwatched', 0.45]]) if (this.templates.has(name)) inkAll(this.templates.get(name), k);
    this.makeTextures();
  }

  // Sculpted replacements (assets/hero.glb, blender/build_hero.py): each hero mesh
  // takes over the look of the procedural template of the same name. The template
  // keeps its moving parts, pivot and size, so colliders and fracture still agree.
  dressHeroes() {
    for (const h of this.hero?.scene.children || []) {
      const t = this.templates.get(h.name);
      if (!t || !h.isMesh) continue;
      h.material.userData.tuned = true;
      if (t.isMesh) { t.geometry = h.geometry; t.material = h.material; }
      else {
        // a multi-material piece loads as a group holding one mesh per material;
        // those go, the named child parts (hands, flame, pillow) stay
        const assoc = this.props.parser.associations;
        for (const c of [...t.children]) if (c.isMesh && assoc.get(c)?.nodes === undefined) t.remove(c);
        const m = new THREE.Mesh(h.geometry, h.material);
        m.name = h.name + '_Hero'; m.castShadow = m.receiveShadow = true;
        t.add(m);
      }
      if (h.material.map) h.material.map.anisotropy = 8;
      for (const n of (h.userData.hide || '').split(',').filter(Boolean)) {
        const c = t.getObjectByName(n);
        if (c) c.visible = false;
      }
      t.userData.hero = true;
    }
  }

  // Baked tileable PBR textures from Blender (assets/tex): any material named
  // TX_<name> gets albedo, normal and ORM maps. UVs are in metres, so repeat = 1 / tile.
  async loadTextureLibrary() {
    this.texlib = null;
    let manifest = null;
    try { const r = await fetch('./assets/tex/manifest.json'); if (r.ok) manifest = await r.json(); } catch (e) { /* no library yet */ }
    if (!manifest) return;
    const loader = new THREE.TextureLoader();
    const load = (url, srgb) => new Promise((res) => loader.load(url, (t) => { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.flipY = false; res(t); }, undefined, () => res(null)));
    this.texlib = {};
    await Promise.all(Object.entries(manifest).map(async ([name, info]) => {
      const [albedo, normal, orm] = await Promise.all([load(`./assets/tex/${name}_albedo.jpg`, true), load(`./assets/tex/${name}_normal.jpg`), load(`./assets/tex/${name}_orm.jpg`)]);
      const rep = 1 / (info.tile || 1);
      for (const t of [albedo, normal, orm]) if (t) t.repeat.set(rep, rep);
      this.texlib[name] = { albedo, normal, orm, info };
    }));
  }

  applyTexture(m) {
    const hit = /^TX_([a-z]+)/.exec(m.name || '');
    const T = hit && this.texlib && this.texlib[hit[1]];
    if (!T) return;
    if (T.albedo) m.map = T.albedo;
    if (T.normal) { m.normalMap = T.normal; m.normalScale = new THREE.Vector2(1, -1); } // glTF normal maps are +Y; flipY is off
    if (T.orm) { m.roughnessMap = T.orm; m.metalnessMap = T.orm; m.aoMap = T.orm; m.roughness = 1; m.metalness = 1; m.aoMapIntensity = 0.8; }
    // interior-only surfaces see less sky: rooms read as rooms, not as outdoors with a ceiling
    if (/^(plaster|oak)$/.test(hit[1])) m.envMapIntensity = 0.45;
    m.needsUpdate = true;
  }

  // a material from the texture library for geometry built in code (UVs in metres)
  libMaterial(name, params = {}) {
    const m = new THREE.MeshStandardMaterial({ roughness: 1, ...params, name: 'TX_' + name });
    this.applyTexture(m);
    return m;
  }

  tuneMaterial(m) {
    if (!m || m.userData.tuned) return;
    m.userData.tuned = true;
    this.applyTexture(m);
    if (m.name === 'MirrorGlass') { m.metalness = 1; m.roughness = 0.03; m.envMapIntensity = 1.6; }
    if (/Flame|Seeds|DoorLight|EnemyCore|Iris/.test(m.name)) { m.toneMapped = true; }
  }

  has(name) { return this.templates.has(name); }

  // deep clone of a named template; materials are cloned so each instance can be tinted/melted
  clone(name, { uniqueMaterials = true } = {}) {
    const t = this.templates.get(name);
    if (!t) return this.placeholder(name);
    const o = SkeletonUtils.clone(t);
    if (uniqueMaterials) {
      o.traverse((m) => {
        if (m.isMesh) m.material = Array.isArray(m.material) ? m.material.map((x) => x.clone()) : m.material.clone();
      });
    }
    return o;
  }

  cloneFigure() {
    const o = SkeletonUtils.clone(this.figure.scene);
    this.figurePlan ??= rigidPlan(this.figure.scene);
    if (!applyRigidPlan(o, this.figurePlan)) o.traverse((m) => { if (m.isMesh) { m.material = m.material.clone(); m.castShadow = true; m.receiveShadow = true; } });
    return o;
  }

  placeholder(name) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: 0xff00ff }));
    m.geometry.translate(0, 0.5, 0);
    m.name = name;
    m.castShadow = true;
    const g = new THREE.Group(); g.add(m); g.name = name;
    return g;
  }

  // procedural sprite textures for particles and decals
  makeTextures() {
    const mk = (size, draw) => {
      const c = document.createElement('canvas'); c.width = c.height = size;
      const g = c.getContext('2d'); draw(g, size);
      const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
    };
    this.textures.soft = mk(64, (g, s) => {
      const gr = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
      gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.35, 'rgba(255,255,255,0.55)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr; g.fillRect(0, 0, s, s);
    });
    this.textures.smoke = mk(128, (g, s) => {
      for (let i = 0; i < 26; i++) {
        const x = s / 2 + (Math.random() - 0.5) * s * 0.4, y = s / 2 + (Math.random() - 0.5) * s * 0.4, r = s * (0.12 + Math.random() * 0.2);
        const gr = g.createRadialGradient(x, y, 0, x, y, r);
        gr.addColorStop(0, 'rgba(255,255,255,0.22)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
        g.fillStyle = gr; g.fillRect(0, 0, s, s);
      }
    });
    this.textures.spark = mk(64, (g, s) => {
      const gr = g.createLinearGradient(0, s / 2, s, s / 2);
      gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.5, 'rgba(255,255,255,1)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr; g.fillRect(0, s * 0.4, s, s * 0.2);
    });
    this.textures.z = mk(64, (g, s) => {
      g.fillStyle = '#fff'; g.font = `bold ${s * 0.8}px Georgia, serif`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('z', s / 2, s / 2);
    });
    this.textures.ring = mk(128, (g, s) => {
      const gr = g.createRadialGradient(s / 2, s / 2, s * 0.3, s / 2, s / 2, s / 2);
      gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.75, 'rgba(255,255,255,0.9)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr; g.fillRect(0, 0, s, s);
    });
    this.textures.scorch = mk(128, (g, s) => {
      const gr = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
      gr.addColorStop(0, 'rgba(10,6,4,0.85)'); gr.addColorStop(0.55, 'rgba(25,14,8,0.55)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = gr; g.fillRect(0, 0, s, s);
      for (let i = 0; i < 40; i++) {
        const a = Math.random() * Math.PI * 2, r = s * (0.2 + Math.random() * 0.28);
        g.strokeStyle = 'rgba(0,0,0,0.25)'; g.lineWidth = 1 + Math.random() * 2;
        g.beginPath(); g.moveTo(s / 2, s / 2); g.lineTo(s / 2 + Math.cos(a) * r, s / 2 + Math.sin(a) * r); g.stroke();
      }
    });
    this.textures.puddle = mk(128, (g, s) => {
      g.fillStyle = 'rgba(255,255,255,0)'; g.fillRect(0, 0, s, s);
      g.beginPath();
      for (let i = 0; i <= 40; i++) {
        const a = (i / 40) * Math.PI * 2, r = s * (0.33 + 0.1 * Math.sin(a * 3) + 0.05 * Math.sin(a * 7));
        const x = s / 2 + Math.cos(a) * r, y = s / 2 + Math.sin(a) * r;
        i ? g.lineTo(x, y) : g.moveTo(x, y);
      }
      g.fillStyle = 'rgba(255,255,255,0.95)'; g.fill();
    });
  }
}

// ---------------------------------------------------------------------------
// The Figment is a wooden mannequin: 57 rigid parts riding its bones, one draw
// call each (and again for shadows). A clone draws them as one skinned mesh per
// material instead. Every part becomes an empty node with the same name and
// transform, so animation and code still move it, and each vertex of the merged
// mesh follows its part's node at full weight. (Not for enemies: their melting
// droop works in object space, which skinning would change.)
// ---------------------------------------------------------------------------
function rigidPlan(template) {
  const parts = [];
  template.traverse((o) => { if (o.isMesh && !o.isSkinnedMesh) parts.push(o); });
  const groups = new Map();
  parts.forEach((m) => {
    const mat = m.material, g = m.geometry;
    const key = mat.uuid + '|' + Object.keys(g.attributes).sort().join() + (g.index ? '|i' : '');
    if (!groups.has(key)) groups.set(key, { mat, parts: [], geos: [] });
    const gr = groups.get(key);
    const n = g.attributes.position.count, si = new Uint16Array(n * 4), sw = new Float32Array(n * 4);
    for (let v = 0; v < n; v++) { si[v * 4] = gr.parts.length; sw[v * 4] = 1; }
    const c = g.clone();
    c.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
    c.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
    gr.parts.push(parts.indexOf(m)); gr.geos.push(c);
  });
  const out = [];
  for (const gr of groups.values()) {
    const geo = gr.geos.length === 1 ? gr.geos[0] : mergeGeometries(gr.geos, false);
    if (!geo) return null;
    out.push({ mat: gr.mat, parts: gr.parts, geo });
  }
  return { count: parts.length, groups: out };
}

function applyRigidPlan(root, plan) {
  if (!plan) return false;
  const parts = [];
  root.traverse((o) => { if (o.isMesh && !o.isSkinnedMesh) parts.push(o); });
  if (parts.length !== plan.count) return false;
  const nodes = parts.map((m) => {
    const n = new THREE.Object3D();
    n.name = m.name; n.position.copy(m.position); n.quaternion.copy(m.quaternion); n.scale.copy(m.scale);
    for (const c of [...m.children]) n.add(c);
    const p = m.parent;
    p.children[p.children.indexOf(m)] = n; n.parent = p; m.parent = null;
    return n;
  });
  for (const g of plan.groups) {
    const bones = g.parts.map((i) => nodes[i]);
    const sm = new THREE.SkinnedMesh(g.geo, g.mat.clone());
    sm.name = 'Figment_' + (g.mat.name || 'part');
    sm.bind(new THREE.Skeleton(bones, bones.map(() => new THREE.Matrix4())), new THREE.Matrix4());
    sm.castShadow = true; sm.receiveShadow = true;
    sm.frustumCulled = false; // it follows the parts, not its own transform
    root.add(sm);
  }
  return true;
}

// ---------------------------------------------------------------------------
// Dream material injection: melting droop + lucid wobble, per material.
// Each melt-able material gets its own uMelt/uBaseY/uHeight uniforms.
// ---------------------------------------------------------------------------
export function makeDreamMaterial(mat, height = 1, baseY = 0) {
  if (mat.userData.dream) return mat.userData.dream;
  const u = {
    uMelt: { value: 0 }, uBaseY: { value: baseY }, uHeight: { value: height },
    uWobble: { value: 0 }, uSeed: { value: Math.random() * 100 },
    uTime: DREAM.uniforms.uTime, uLucid: DREAM.uniforms.uLucid,
  };
  mat.userData.dream = u;
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', `#include <common>
uniform float uMelt, uBaseY, uHeight, uWobble, uSeed, uTime, uLucid;`).replace('#include <begin_vertex>', `#include <begin_vertex>
{
  float h = clamp((transformed.y - uBaseY) / max(uHeight, 0.001), 0.0, 1.2);
  float m = uMelt;
  float drip = sin(transformed.x * 9.0 + uSeed) * 0.5 + sin(transformed.z * 7.0 + uSeed * 1.7) * 0.5;
  transformed.y = mix(transformed.y, uBaseY + (transformed.y - uBaseY) * (1.0 - 0.82 * m), m) - m * h * h * uHeight * 0.1 * (1.0 + drip);
  float spread = 1.0 + m * (1.0 - h) * 0.9 + m * 0.15;
  transformed.x *= spread; transformed.z *= spread;
  transformed.y -= max(0.0, drip) * m * 0.12 * uHeight * (1.0 - h);
  float w = (uWobble + uLucid * uLucid * 0.35);
  transformed += normal * sin(uTime * 2.1 + transformed.y * 3.0 + uSeed) * 0.03 * w;
}`);
  };
  mat.customProgramCacheKey = () => 'dream';
  mat.needsUpdate = true;
  return u;
}

// apply a function to every material in an object
export function eachMaterial(obj, fn) {
  obj.traverse((o) => {
    if (!o.isMesh) return;
    if (Array.isArray(o.material)) o.material.forEach((m) => fn(m, o)); else fn(o.material, o);
  });
}

export function boundsOf(obj) {
  obj.updateMatrixWorld(true);
  return new THREE.Box3().setFromObject(obj);
}
