// Asset loading (Blender-made GLBs), template cloning, and the per-entity
// "dream material" shader injections (melting droop, lucid wobble).
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { DREAM } from './render.js';

// Fetch a .glb; hosts that won't serve binary models get a base64 text copy instead
async function fetchModel(url) {
  try {
    const r = await fetch(url);
    if (r.ok) {
      const buf = await r.arrayBuffer();
      const magic = new Uint8Array(buf, 0, 4);
      if (magic[0] === 0x67 && magic[1] === 0x6c && magic[2] === 0x54 && magic[3] === 0x46) return buf; // 'glTF'
    }
  } catch (e) { /* fall through to the text copy */ }
  const r2 = await fetch(url + '.b64.txt');
  if (!r2.ok) throw new Error(`Could not load ${url}`);
  const bin = atob((await r2.text()).trim());
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}

export class Assets {
  constructor() {
    this.loader = new GLTFLoader();
    this.templates = new Map();
    this.textures = {};
  }

  async load(onProgress) {
    const files = [['props', './assets/props.glb'], ['figure', './assets/figure.glb']];
    let done = 0;
    const results = await Promise.all(files.map(async ([k, url]) => {
      const buf = await fetchModel(url);
      const g = await this.loader.parseAsync(buf, './assets/');
      done++; onProgress && onProgress(done / files.length);
      return [k, g];
    }));
    for (const [k, g] of results) this[k] = g;
    this.figure.scene.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    // index every top-level prop object by name
    for (const child of [...this.props.scene.children]) {
      child.traverse((o) => {
        if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; this.tuneMaterial(o.material); }
      });
      this.templates.set(child.name, child);
    }
    this.makeTextures();
  }

  tuneMaterial(m) {
    if (!m || m.userData.tuned) return;
    m.userData.tuned = true;
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
    o.traverse((m) => { if (m.isMesh) { m.material = m.material.clone(); m.castShadow = true; m.receiveShadow = true; } });
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
