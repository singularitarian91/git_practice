// Renders every item's 3D model into a small icon (data URL) using a
// throwaway WebGL renderer, so inventory icons match the world exactly.
import * as THREE from 'three';
import { ITEMS } from '../data/items.js';

export class IconFactory {
  constructor(lib, size = 96) {
    this.lib = lib;
    this.size = size;
    this.cache = new Map();
  }

  async renderAll(onProgress = () => {}) {
    const size = this.size;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, preserveDrawingBuffer: true });
    } catch (e) {
      console.warn('icon renderer unavailable', e);
      return;
    }
    renderer.setSize(size, size, false);
    renderer.setClearColor(0x000000, 0);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.35;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    const scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight(0xdfe6f0, 0x3a3226, 1.9));
    const key = new THREE.DirectionalLight(0xfff0dc, 2.6);
    key.position.set(2, 4, 3);
    const rim = new THREE.DirectionalLight(0x9fc0ff, 1.2);
    rim.position.set(-3, 2, -2);
    scene.add(key, rim);
    const cam = new THREE.PerspectiveCamera(28, 1, 0.01, 100);
    const ids = Object.keys(ITEMS);
    let i = 0;
    const done = new Map();
    for (const id of ids) {
      const it = ITEMS[id];
      const modelKey = it.model + (it.tint || '');
      if (done.has(modelKey)) { this.cache.set(id, done.get(modelKey)); continue; }
      const obj = this.lib.clone(it.model);
      if (it.tint) obj.traverse((o) => { if (o.isMesh) { o.material = o.material.clone(); o.material.color = new THREE.Color(it.tint).lerp(new THREE.Color(1, 1, 1), 0.25); } });
      // tools are seen side-on (their blades face forward) and tilted to fill the square
      if (it.cat === 'tool') obj.rotation.set(-Math.PI / 4, 0, 0);
      scene.add(obj);
      obj.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(obj);
      const c = box.getCenter(new THREE.Vector3());
      const s = box.getSize(new THREE.Vector3());
      let r = Math.max(s.x, s.y, s.z) * 0.5 || 0.3;
      if (it.cat === 'tool') {
        // frame the working end (top-right when viewed from +X)
        c.set(c.x, box.max.y - s.y * 0.32, box.min.z + s.z * 0.32);
        r *= 0.66;
      }
      const dist = r / Math.sin(THREE.MathUtils.degToRad(14)) * 1.02;
      const yaw = it.cat === 'tool' ? Math.PI / 2 : 0.45, pitch = it.cat === 'tool' ? 0.12 : 0.5;
      cam.position.set(c.x + Math.sin(yaw) * Math.cos(pitch) * dist, c.y + Math.sin(pitch) * dist, c.z + Math.cos(yaw) * Math.cos(pitch) * dist);
      cam.lookAt(c);
      renderer.render(scene, cam);
      const url = canvas.toDataURL('image/png');
      this.cache.set(id, url);
      done.set(modelKey, url);
      scene.remove(obj);
      i++;
      if (i % 8 === 0) { onProgress(i / ids.length); await new Promise((r2) => setTimeout(r2, 0)); }
    }
    renderer.dispose();
    renderer.forceContextLoss();
    onProgress(1);
  }

  get(id) { return this.cache.get(id) || ''; }
}
