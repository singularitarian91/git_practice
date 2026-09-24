// The sea south of the village: one large plane with two scrolling ripple
// normal maps, sky reflections from the environment, sun glitter, and a band
// of foam where it laps the sand (from a depth ramp baked into vertex alpha).
import * as THREE from 'three';

function rippleNormals(S = 256) {
  const c = document.createElement('canvas'); c.width = c.height = S;
  const g = c.getContext('2d'), img = g.createImageData(S, S);
  const H = new Float32Array(S * S);
  const TAU = Math.PI * 2;
  // a sum of periodic waves in several directions, so it tiles
  const waves = [[3, 1, 0.5], [-2, 3, 0.35], [5, -2, 0.2], [1, 7, 0.12], [-7, -4, 0.1], [9, 5, 0.06]];
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    let h = 0;
    for (const [a, b, k] of waves) h += Math.sin(((a * x + b * y) / S) * TAU + a * 1.3) * k;
    H[y * S + x] = h;
  }
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const hx = H[y * S + ((x + 1) % S)] - H[y * S + ((x - 1 + S) % S)];
    const hy = H[((y + 1) % S) * S + x] - H[((y - 1 + S) % S) * S + x];
    const n = new THREE.Vector3(-hx * 3, -hy * 3, 1).normalize();
    const i = (y * S + x) * 4;
    img.data[i] = (n.x * 0.5 + 0.5) * 255; img.data[i + 1] = (n.y * 0.5 + 0.5) * 255; img.data[i + 2] = (n.z * 0.5 + 0.5) * 255; img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8;
  return t;
}

export class Sea {
  // level: for heightAt (shore depth); y: water level
  constructor(level, { y = -1.2, color = '#1c5a6b', deep = '#0d2f45', size = 900 } = {}) {
    this.level = level;
    this.y = y;
    const geo = new THREE.PlaneGeometry(size, size, 120, 120);
    geo.rotateX(-Math.PI / 2);
    // vertex depth -> foam near the shoreline, shallow colour over the sand
    const pos = geo.attributes.position, depth = new Float32Array(pos.count);
    for (let i = 0; i < pos.count; i++) depth[i] = Math.max(0, y - level.heightAt(pos.getX(i), pos.getZ(i)));
    geo.setAttribute('aDepth', new THREE.BufferAttribute(depth, 1));
    const n1 = rippleNormals(), n2 = n1.clone();
    n1.repeat.set(size / 14, size / 14); n2.repeat.set(size / 37, size / 37);
    this.maps = [n1, n2];
    const mat = new THREE.MeshStandardMaterial({ color: new THREE.Color(color), roughness: 0.06, metalness: 0.0, normalMap: n1, normalScale: new THREE.Vector2(0.35, 0.35), envMapIntensity: 1.2, transparent: true });
    this.uTime = { value: 0 };
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = this.uTime;
      sh.uniforms.uMap2 = { value: n2 };
      sh.uniforms.uDeep = { value: new THREE.Color(deep) };
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float aDepth;\nvarying float vDepth;\nvarying vec2 vWorldUv;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvDepth = aDepth;\nvWorldUv = (modelMatrix * vec4(position, 1.0)).xz;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uTime;\nuniform sampler2D uMap2;\nuniform vec3 uDeep;\nvarying float vDepth;\nvarying vec2 vWorldUv;')
        // a second, slower ripple layer crossing the first
        .replace('#include <normal_fragment_maps>', `
          vec3 mapN = texture2D( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0;
          vec3 mapN2 = texture2D( uMap2, vWorldUv / 37.0 + vec2(-uTime * 0.006, uTime * 0.004) ).xyz * 2.0 - 1.0;
          mapN = normalize(vec3(mapN.xy + mapN2.xy, mapN.z * mapN2.z));
          mapN.xy *= normalScale;
          normal = normalize( tbn * mapN );`)
        // deep water darkens; the shallows show sand through them; foam at the lip
        .replace('#include <color_fragment>', `#include <color_fragment>
          float shallow = 1.0 - smoothstep(0.0, 2.2, vDepth);
          diffuseColor.rgb = mix(uDeep, diffuseColor.rgb, 0.35 + 0.65 * smoothstep(0.0, 6.0, 6.0 - vDepth));
          float foamLine = smoothstep(0.35, 0.0, abs(vDepth - 0.18 - 0.12 * sin(uTime * 0.9 + vWorldUv.x * 0.15)));
          float foam = foamLine * (0.55 + 0.45 * sin(vWorldUv.x * 1.7 + vWorldUv.y * 2.3 + uTime * 1.3));
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.93, 0.95, 0.92), clamp(foam, 0.0, 1.0));
          diffuseColor.a = mix(0.55, 0.96, smoothstep(0.0, 1.6, vDepth)) + foam * 0.3;`);
    };
    mat.customProgramCacheKey = () => 'sea';
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.position.y = y;
    this.mesh.receiveShadow = true;
    this.mesh.renderOrder = 1;
    this.mesh.userData.noAO = true;
    level.group.add(this.mesh);
  }
  update(dt) {
    this.uTime.value += dt;
    const t = this.uTime.value;
    this.maps[0].offset.set(t * 0.011, t * 0.007);
  }
}
