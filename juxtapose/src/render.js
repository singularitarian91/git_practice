// Rendering: renderer, dream sky, sun + IBL, soft shadows, point-light pool,
// post-processing (GTAO, bloom, tone mapping, the "dream" grade pass).
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';

// uniforms shared by every "dream" material (melt/wobble shaders read these)
export const DREAM = {
  uniforms: {
    uTime: { value: 0 },
    uLucid: { value: 0 },
  },
};

const NOISE_GLSL = /* glsl */`
float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float vnoise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
  return mix(mix(hash12(i), hash12(i+vec2(1,0)), f.x), mix(hash12(i+vec2(0,1)), hash12(i+vec2(1,1)), f.x), f.y); }
float fbm(vec2 p){ float a = 0.5, s = 0.0; for(int i=0;i<5;i++){ s += a*vnoise(p); p = p*2.03 + 17.1; a *= 0.5; } return s; }
`;

const SKY_VERT = /* glsl */`
varying vec3 vDir;
void main(){ vDir = position; vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_Position = p.xyww; }`;

const SKY_FRAG = /* glsl */`
uniform vec3 uZenith, uHorizon, uGround, uSunDir, uSunColor, uCloudColor;
uniform float uTime, uLucid, uCloudAmt, uStars;
varying vec3 vDir;
${NOISE_GLSL}
void main(){
  vec3 d = normalize(vDir);
  float h = d.y;
  vec3 col = mix(uHorizon, uZenith, pow(clamp(h, 0.0, 1.0), 0.5));
  col = mix(col, uGround, smoothstep(0.0, -0.3, h));
  float s = max(dot(d, uSunDir), 0.0);
  col += uSunColor * (pow(s, 1400.0) * 30.0 + pow(s, 14.0) * 0.45 + pow(s, 3.0) * 0.18);
  // painterly cloud streaks
  vec2 p = d.xz / (max(h, 0.015) + 0.3);
  float n = fbm(p * 0.9 + vec2(uTime * 0.006, uTime * 0.002));
  float n2 = fbm(p * 2.4 - vec2(uTime * 0.01, 0.0));
  float cl = smoothstep(0.52, 0.86, n * 0.75 + n2 * 0.35) * smoothstep(0.0, 0.22, h) * uCloudAmt;
  vec3 cc = uCloudColor * (0.75 + 0.6 * pow(s, 4.0));
  col = mix(col, cc, cl * 0.75);
  // lucidity: the sky starts to swirl and fill with stars
  float L = uLucid * uLucid;
  float ang = atan(d.z, d.x);
  float swirl = sin(ang * 6.0 + h * 14.0 - uTime * 0.6 + fbm(d.xz * 3.0) * 6.0);
  col += vec3(0.45, 0.2, 0.7) * L * 0.35 * smoothstep(0.6, 1.0, swirl) * smoothstep(0.0, 0.5, h);
  float st = step(0.9985 - uStars * 0.002 - L * 0.003, hash12(floor(d.xz / max(h, 0.05) * 90.0)));
  col += vec3(st) * smoothstep(0.05, 0.4, h) * (uStars + L) * 1.5;
  gl_FragColor = vec4(col, 1.0);
}`;

const DreamShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uLucid: { value: 0 },
    uHurt: { value: 0 },
    uWhite: { value: 0 },
    uWhiteColor: { value: new THREE.Color(1, 0.98, 0.94) },
    uGrain: { value: 0.045 },
    uSat: { value: 1.0 },
    uTint: { value: new THREE.Color(1, 1, 1) },
    uVignette: { value: 0.25 },
    uRes: { value: new THREE.Vector2(1, 1) },
    uSlowmo: { value: 0 },
    uWatched: { value: 0 },
  },
  vertexShader: /* glsl */`varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */`
uniform sampler2D tDiffuse;
uniform float uTime, uLucid, uHurt, uWhite, uGrain, uSat, uVignette, uSlowmo, uWatched;
uniform vec3 uTint, uWhiteColor;
uniform vec2 uRes;
varying vec2 vUv;
${NOISE_GLSL}
vec3 hueShift(vec3 c, float a){ const vec3 k = vec3(0.57735); float ca = cos(a); return c*ca + cross(k, c)*sin(a) + k*dot(k, c)*(1.0-ca); }
void main(){
  float L = uLucid * uLucid;
  vec2 uv = vUv;
  vec2 c = uv - 0.5;
  float r2 = dot(c, c);
  uv += vec2(sin(uv.y * 11.0 + uTime * 1.3), cos(uv.x * 9.0 + uTime * 1.1)) * 0.003 * L;
  uv = 0.5 + c * (1.0 + r2 * 0.22 * L * sin(uTime * 0.6)) ;
  float ab = (0.0008 + 0.0035 * L + uHurt * 0.006 + uSlowmo * 0.004) * (0.3 + r2 * 3.0);
  vec2 dir = normalize(c + 1e-5);
  vec3 col;
  col.r = texture2D(tDiffuse, uv + dir * ab).r;
  col.g = texture2D(tDiffuse, uv).g;
  col.b = texture2D(tDiffuse, uv - dir * ab).b;
  float l = dot(col, vec3(0.299, 0.587, 0.114));
  col = mix(vec3(l), col, uSat + L * 0.25 - uSlowmo * 0.5);
  col = hueShift(col, L * 0.32 * sin(uTime * 0.21));
  col *= uTint;
  float vig = smoothstep(0.95, 0.25, length(c) * (1.0 + uVignette));
  col *= mix(1.0, vig, 0.6);
  col = mix(col, vec3(0.55, 0.02, 0.06), uHurt * (1.0 - vig) * 0.75);
  // tearing light at the edge of waking
  float edge = smoothstep(0.3, 0.8, length(c)) * smoothstep(0.72, 1.0, uLucid);
  col += vec3(1.0, 0.94, 0.82) * edge * (0.45 + 0.35 * sin(uTime * 3.0 + uv.y * 24.0 + fbm(uv * 6.0 + uTime) * 5.0));
  // the watched eye: faint violet pressure at the edges
  col += vec3(0.35, 0.1, 0.45) * uWatched * (1.0 - vig) * 0.5;
  // film grain + canvas weave
  col += (hash12(uv * uRes + fract(uTime) * 100.0) - 0.5) * uGrain;
  vec2 cw = uv * uRes / 3.0;
  col *= 1.0 - 0.03 * (sin(cw.x) * sin(cw.y) * 0.5 + 0.5) * (0.6 + 0.4 * vnoise(uv * 40.0));
  col = mix(col, uWhiteColor, uWhite);
  gl_FragColor = vec4(col, 1.0);
}`,
};

export const QUALITY = {
  low: { pixelRatio: 0.85, shadows: 1024, bloom: true, ao: false, samples: 0 },
  medium: { pixelRatio: 1.0, shadows: 2048, bloom: true, ao: false, samples: 2 },
  high: { pixelRatio: 1.25, shadows: 4096, bloom: true, ao: true, samples: 4 },
};

export class Renderer {
  constructor(container, quality = 'high') {
    this.container = container;
    const r = this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance', stencil: false });
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.0;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(r.domElement);
    r.domElement.tabIndex = 0;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(70, 1, 0.08, 1200);
    this.scene.add(this.camera);

    // sky dome
    this.skyUniforms = {
      uZenith: { value: new THREE.Color() }, uHorizon: { value: new THREE.Color() }, uGround: { value: new THREE.Color() },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uSunColor: { value: new THREE.Color() }, uCloudColor: { value: new THREE.Color() },
      uTime: DREAM.uniforms.uTime, uLucid: DREAM.uniforms.uLucid, uCloudAmt: { value: 1 }, uStars: { value: 0 },
    };
    const skyMat = new THREE.ShaderMaterial({ vertexShader: SKY_VERT, fragmentShader: SKY_FRAG, uniforms: this.skyUniforms, side: THREE.BackSide, depthWrite: false, fog: false });
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(1000, 48, 24), skyMat);
    this.sky.frustumCulled = false;
    this.sky.renderOrder = -10;
    this.scene.add(this.sky);
    this.envScene = new THREE.Scene();
    this.envSky = new THREE.Mesh(new THREE.SphereGeometry(100, 48, 24), skyMat);
    this.envScene.add(this.envSky);
    this.pmrem = new THREE.PMREMGenerator(r);

    // lights
    this.sun = new THREE.DirectionalLight(0xffffff, 3);
    this.sun.castShadow = true;
    this.sun.shadow.bias = -0.00025;
    this.sun.shadow.normalBias = 0.035;
    const sc = this.sun.shadow.camera;
    sc.left = -38; sc.right = 38; sc.top = 38; sc.bottom = -38; sc.near = 1; sc.far = 220;
    this.scene.add(this.sun, this.sun.target);
    this.sunDir = new THREE.Vector3(0.5, 0.35, 0.3).normalize();
    this.hemi = new THREE.HemisphereLight(0xbfd6ff, 0x6b4a2c, 0.6);
    this.scene.add(this.hemi);
    this.scene.fog = new THREE.FogExp2(0xd8b38a, 0.006);

    // pooled point lights (fixed count so shaders never recompile)
    this.lights = [];
    for (let i = 0; i < 8; i++) {
      const l = new THREE.PointLight(0xffffff, 0, 10, 2);
      l.userData = { ttl: 0, life: 1, base: 0, owner: null, flicker: 0 };
      this.scene.add(l);
      this.lights.push(l);
    }

    this.dream = new ShaderPass(DreamShader);
    this.setQuality(quality);
    addEventListener('resize', () => this.resize());
    this.resize();
  }

  setQuality(q) {
    this.qualityName = q;
    const Q = this.quality = QUALITY[q] || QUALITY.high;
    const r = this.renderer;
    r.setPixelRatio(Math.min(devicePixelRatio || 1, Q.pixelRatio * (devicePixelRatio > 1 ? 1.3 : 1)));
    this.sun.shadow.mapSize.set(Q.shadows, Q.shadows);
    if (this.sun.shadow.map) { this.sun.shadow.map.dispose(); this.sun.shadow.map = null; }
    const size = r.getDrawingBufferSize(new THREE.Vector2());
    const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: Q.samples });
    if (this.composer) this.composer.dispose();
    const c = this.composer = new EffectComposer(r, rt);
    c.addPass(new RenderPass(this.scene, this.camera));
    this.gtao = null;
    if (Q.ao) {
      this.gtao = new GTAOPass(this.scene, this.camera, size.x, size.y);
      this.gtao.output = GTAOPass.OUTPUT.Default;
      this.gtao.blendIntensity = 0.85;
      this.gtao.updateGtaoMaterial({ radius: 0.6, distanceExponent: 1.5, thickness: 1.2, scale: 1.0, samples: 12 });
      this.gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 4, rings: 2, samples: 12 });
      c.addPass(this.gtao);
    }
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.55, 0.55, 0.88);
    if (Q.bloom) c.addPass(this.bloom);
    c.addPass(new OutputPass());
    c.addPass(this.dream);
    this.resize();
  }

  resize() {
    const w = this.container.clientWidth || innerWidth, h = this.container.clientHeight || innerHeight;
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    const pr = this.renderer.getPixelRatio();
    if (this.composer) {
      this.composer.setPixelRatio(pr);
      this.composer.setSize(w, h);
    }
    this.dream.uniforms.uRes.value.set(w * pr, h * pr);
  }

  // Configure the look of a dream layer
  setLook(look) {
    const u = this.skyUniforms;
    u.uZenith.value.set(look.zenith);
    u.uHorizon.value.set(look.horizon);
    u.uGround.value.set(look.ground);
    u.uCloudColor.value.set(look.cloud || '#ffffff');
    u.uCloudAmt.value = look.clouds ?? 1;
    u.uStars.value = look.stars ?? 0;
    this.sunDir.set(...look.sunDir).normalize();
    u.uSunDir.value.copy(this.sunDir);
    u.uSunColor.value.set(look.sunColor);
    this.sun.color.set(look.sunColor);
    this.sun.intensity = look.sunIntensity;
    this.hemi.color.set(look.hemiSky);
    this.hemi.groundColor.set(look.hemiGround);
    this.hemi.intensity = look.hemiIntensity;
    this.scene.fog.color.set(look.fog);
    this.scene.fog.density = look.fogDensity;
    this.renderer.toneMappingExposure = look.exposure ?? 1;
    this.dream.uniforms.uTint.value.set(look.tint || '#ffffff');
    this.dream.uniforms.uSat.value = look.saturation ?? 1;
    this.baseLook = look;
    this.refreshEnvironment();
  }

  refreshEnvironment() {
    if (this.envRT) this.envRT.dispose();
    this.envRT = this.pmrem.fromScene(this.envScene, 0.02, 0.1, 500);
    this.scene.environment = this.envRT.texture;
    this.scene.environmentIntensity = this.baseLook?.envIntensity ?? 0.8;
  }

  // ---- point light pool -------------------------------------------------
  flash(pos, color, intensity, distance, ttl, flicker = 0) {
    let best = null;
    for (const l of this.lights) {
      if (l.userData.ttl <= 0 && !l.userData.owner) { best = l; break; }
    }
    if (!best) {
      let lowest = Infinity;
      for (const l of this.lights) {
        if (l.userData.owner) continue;
        if (l.intensity < lowest) { lowest = l.intensity; best = l; }
      }
    }
    if (!best) return null;
    best.position.copy(pos);
    best.color.set(color);
    best.distance = distance;
    best.userData.ttl = ttl; best.userData.life = ttl; best.userData.base = intensity; best.userData.flicker = flicker;
    best.intensity = intensity;
    return best;
  }
  // persistent light owned by something (burning entity, candle)
  claim(owner, color, intensity, distance) {
    const l = this.flash(new THREE.Vector3(), color, intensity, distance, 1e9, 0.35);
    if (l) l.userData.owner = owner;
    return l;
  }
  release(l) {
    if (!l) return;
    l.userData.owner = null; l.userData.ttl = 0; l.intensity = 0;
  }

  update(dt, focus, time) {
    DREAM.uniforms.uTime.value = time;
    this.dream.uniforms.uTime.value = time;
    this.dream.uniforms.uLucid.value = DREAM.uniforms.uLucid.value;
    // shadow frustum follows the focus, snapped to texels to avoid shimmer
    const ext = this.sun.shadow.camera.right * 2;
    const texel = ext / this.sun.shadow.mapSize.x;
    const fx = Math.round(focus.x / texel) * texel, fz = Math.round(focus.z / texel) * texel;
    this.sun.target.position.set(fx, focus.y, fz);
    this.sun.position.set(fx + this.sunDir.x * 100, focus.y + this.sunDir.y * 100, fz + this.sunDir.z * 100);
    this.sky.position.copy(this.camera.position);
    for (const l of this.lights) {
      const u = l.userData;
      if (u.owner) {
        l.intensity = u.base * (1 - u.flicker * 0.5 + Math.random() * u.flicker);
        continue;
      }
      if (u.ttl > 0) {
        u.ttl -= dt;
        const k = Math.max(0, u.ttl / u.life);
        l.intensity = u.base * k * k * (1 - u.flicker * 0.5 + Math.random() * u.flicker);
        if (u.ttl <= 0) l.intensity = 0;
      }
    }
  }

  render() { this.composer.render(); }
}
