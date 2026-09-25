// Sky dome: gradient, sun & moon discs, stars, drifting clouds and a winter
// aurora, all in one shader.  Also hosts the distant world-tree silhouette.
import * as THREE from 'three';

const SKY_VERT = /* glsl */`
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    gl_Position = p.xyww; // at the far plane
  }
`;

const SKY_FRAG = /* glsl */`
  precision highp float;
  uniform vec3 uZenith;
  uniform vec3 uHorizon;
  uniform vec3 uGround;
  uniform vec3 uSunDir;
  uniform vec3 uSunColor;
  uniform float uSunVis;
  uniform vec3 uMoonDir;
  uniform float uMoonVis;
  uniform float uStars;
  uniform float uTime;
  uniform float uCloudCover;
  uniform vec3 uCloudLit;
  uniform vec3 uCloudDark;
  uniform float uAurora;
  varying vec3 vDir;

  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float hash3(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
  float vnoise(vec2 p) {
    vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
  }
  float fbm(vec2 p) {
    float s = 0.0, a = 0.5;
    for (int i = 0; i < 5; i++) { s += a * vnoise(p); p = p * 2.03 + 1.7; a *= 0.5; }
    return s;
  }

  void main() {
    vec3 d = normalize(vDir);
    float y = d.y;
    // base gradient
    float t = pow(clamp(y, 0.0, 1.0), 0.55);
    vec3 col = mix(uHorizon, uZenith, t);
    col = mix(col, uGround, smoothstep(0.0, -0.25, y));

    // sun
    float sd = dot(d, uSunDir);
    col += uSunColor * (pow(max(sd, 0.0), 8.0) * 0.25 + pow(max(sd, 0.0), 64.0) * 0.6) * uSunVis;
    col += uSunColor * smoothstep(0.9993, 0.9996, sd) * 6.0 * uSunVis;

    // stars (hash on a direction grid), twinkling
    if (uStars > 0.001 && y > -0.05) {
      vec3 sp = d * 220.0;
      vec3 cell = floor(sp);
      float h = hash3(cell);
      if (h > 0.985) {
        vec3 center = cell + 0.5 + (vec3(hash3(cell + 1.3), hash3(cell + 2.7), hash3(cell + 4.1)) - 0.5) * 0.6;
        float dd = length(sp - center);
        float tw = 0.6 + 0.4 * sin(uTime * (1.0 + h * 3.0) + h * 40.0);
        float star = smoothstep(0.22, 0.0, dd) * tw * (h - 0.985) * 66.0;
        col += vec3(0.8, 0.85, 1.0) * star * uStars * smoothstep(-0.05, 0.25, y);
      }
    }

    // moon: disc with soft maria, and a halo
    float md = dot(d, uMoonDir);
    if (uMoonVis > 0.001) {
      float disc = smoothstep(0.99955, 0.9997, md);
      vec3 tangent = normalize(cross(uMoonDir, vec3(0.0, 1.0, 0.0)));
      vec3 bit = cross(tangent, uMoonDir);
      vec2 muv = vec2(dot(d - uMoonDir, tangent), dot(d - uMoonDir, bit)) * 900.0;
      float maria = vnoise(muv * 0.35) * 0.5 + vnoise(muv * 0.9) * 0.3;
      col += vec3(0.85, 0.88, 0.95) * disc * (1.1 - maria * 0.6) * 2.5 * uMoonVis;
      col += vec3(0.35, 0.42, 0.6) * pow(max(md, 0.0), 180.0) * 0.5 * uMoonVis;
    }

    // aurora curtains (winter nights)
    if (uAurora > 0.001 && y > 0.05) {
      vec2 ap = d.xz / (y + 0.25);
      float band = 0.0;
      for (int i = 0; i < 3; i++) {
        float fi = float(i);
        float wave = sin(ap.x * (1.2 + fi * 0.4) + uTime * 0.12 + fi * 2.0) * 0.6 + vnoise(vec2(ap.x * 2.0 + uTime * 0.05, fi)) * 0.8;
        float dist = abs(ap.y + 0.5 + fi * 0.45 - wave);
        band += smoothstep(0.35, 0.0, dist) * (0.5 + 0.5 * vnoise(vec2(ap.x * 8.0 + uTime * 0.3, fi * 7.0)));
      }
      vec3 ac = mix(vec3(0.1, 0.9, 0.55), vec3(0.45, 0.25, 0.9), smoothstep(0.1, 0.7, y));
      col += ac * band * uAurora * smoothstep(0.05, 0.3, y) * 0.45;
    }

    // clouds on a virtual plane
    if (y > 0.0) {
      vec2 cuv = d.xz / (y + 0.12) * 1.6 + vec2(uTime * 0.006, uTime * 0.0025);
      float n = fbm(cuv);
      float cover = smoothstep(1.0 - uCloudCover, 1.05 - uCloudCover * 0.6, n);
      float lit = pow(max(dot(d, uSunDir), 0.0), 4.0);
      vec3 cc = mix(uCloudDark, uCloudLit, 0.35 + 0.65 * smoothstep(0.35, 0.8, n) * (0.4 + 0.6 * lit));
      col = mix(col, cc, cover * smoothstep(0.0, 0.18, y) * 0.92);
    }
    gl_FragColor = vec4(col, 1.0);
  }
`;

export class Sky {
  constructor() {
    this.uniforms = {
      uZenith: { value: new THREE.Color(0.05, 0.07, 0.12) },
      uHorizon: { value: new THREE.Color(0.25, 0.27, 0.3) },
      uGround: { value: new THREE.Color(0.05, 0.05, 0.06) },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uSunColor: { value: new THREE.Color(1, 0.8, 0.6) },
      uSunVis: { value: 1 },
      uMoonDir: { value: new THREE.Vector3(0, -1, 0) },
      uMoonVis: { value: 0 },
      uStars: { value: 0 },
      uTime: { value: 0 },
      uCloudCover: { value: 0.5 },
      uCloudLit: { value: new THREE.Color(0.5, 0.5, 0.52) },
      uCloudDark: { value: new THREE.Color(0.2, 0.21, 0.24) },
      uAurora: { value: 0 },
    };
    const geo = new THREE.SphereGeometry(900, 48, 24);
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: SKY_VERT,
      fragmentShader: SKY_FRAG,
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: false,
      fog: false,
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.name = 'sky';
    this.mesh.renderOrder = -1000;
    this.mesh.frustumCulled = false;
    this.group = new THREE.Group();
    this.group.add(this.mesh);
    this.treeMaterial = new THREE.MeshBasicMaterial({ color: 0x223, depthWrite: false, depthTest: false, fog: false });
    this.tree = null;
  }

  setWorldTree(model) {
    if (!model) return;
    const t = model.clone();
    t.traverse((o) => {
      if (o.isMesh) {
        o.material = this.treeMaterial;
        o.renderOrder = -999;
        o.castShadow = false;
        o.receiveShadow = false;
        o.frustumCulled = false;
      }
    });
    t.scale.setScalar(11);
    this.tree = t;
    this.treeOffset = new THREE.Vector3(-260, -30, -780);
    this.group.add(t);
  }

  // Keep the dome (and the distant tree) centred on the camera.
  update(camera, time) {
    this.uniforms.uTime.value = time;
    this.mesh.position.copy(camera.position);
    if (this.tree) {
      this.tree.position.copy(camera.position).add(this.treeOffset);
      this.tree.position.y = this.treeOffset.y;
      const hz = this.uniforms.uHorizon.value;
      const zn = this.uniforms.uZenith.value;
      // silhouette a touch darker than the sky behind it
      this.treeMaterial.color.setRGB(
        (hz.r * 0.55 + zn.r * 0.45) * 0.62,
        (hz.g * 0.55 + zn.g * 0.45) * 0.62,
        (hz.b * 0.55 + zn.b * 0.45) * 0.66,
      );
    }
  }
}
