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

// ---------------------------------------------------------------------------
// Height fog with sun in-scattering. A THREE.Fog subclass whose near/far
// uniforms carry density and height falloff, so every built-in material gets
// it without per-material patches. Sun direction/colour and the fog floor are
// shared by reference through ShaderLib (plain objects are not cloned).
// ---------------------------------------------------------------------------
export class DreamFog extends THREE.Fog {
  constructor(color, density, falloff) { super(color, density, falloff); }
  get density() { return this.near; }
  set density(v) { this.near = v; }
  get falloff() { return this.far; }
  set falloff(v) { this.far = v; }
}
export const FOG = {
  sunDir: { value: { x: 0, y: 1, z: 0 } },
  sunColor: { value: { x: 0, y: 0, z: 0 } },
  floor: { value: 0 },
};
for (const k in THREE.ShaderLib) {
  const u = THREE.ShaderLib[k].uniforms;
  if (u && u.fogColor) { u.fogSunDir = FOG.sunDir; u.fogSunColor = FOG.sunColor; u.fogFloor = FOG.floor; }
}
THREE.ShaderChunk.fog_pars_vertex = `#ifdef USE_FOG
  varying float vFogDepth;
  varying vec3 vFogRay;
#endif`;
THREE.ShaderChunk.fog_vertex = `#ifdef USE_FOG
  vFogDepth = - mvPosition.z;
  vFogRay = mvPosition.xyz * mat3( viewMatrix ); // world-space offset from the camera
#endif`;
THREE.ShaderChunk.fog_pars_fragment = `#ifdef USE_FOG
  uniform vec3 fogColor;
  varying float vFogDepth;
  varying vec3 vFogRay;
  #ifdef FOG_EXP2
    uniform float fogDensity;
  #else
    uniform float fogNear; // density
    uniform float fogFar;  // height falloff
    uniform vec3 fogSunDir;
    uniform vec3 fogSunColor;
    uniform float fogFloor;
  #endif
#endif`;
THREE.ShaderChunk.fog_fragment = `#ifdef USE_FOG
  #ifdef FOG_EXP2
    float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
    gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );
  #else
    float fogDist = length( vFogRay );
    float fogT = clamp( fogFar * vFogRay.y, -20.0, 20.0 );
    float fogInteg = abs( fogT ) > 1e-3 ? ( 1.0 - exp( - fogT ) ) / fogT : 1.0 - 0.5 * fogT;
    float fogOD = fogNear * fogDist * exp( - fogFar * clamp( cameraPosition.y - fogFloor, -30.0, 200.0 ) ) * fogInteg;
    float fogFactor = clamp( 1.0 - exp( - fogOD * fogOD ), 0.0, 1.0 );
    float fogSun = pow( max( dot( vFogRay / max( fogDist, 1e-3 ), fogSunDir ), 0.0 ), 5.0 );
    gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor + fogSunColor * fogSun, fogFactor );
  #endif
#endif`;
// Painted ink edges: materials with USE_INK darken toward their silhouette,
// so characters read against busy or same-coloured backgrounds.
THREE.ShaderChunk.opaque_fragment = `#ifdef USE_INK
  {
    float inkNdv = abs( dot( normal, geometryViewDir ) );
    float inkK = 1.0 - smoothstep( 0.06, 0.42, inkNdv );
    outgoingLight = mix( outgoingLight, outgoingLight * vec3( 0.16, 0.13, 0.2 ), inkK * INK_K );
  }
#endif
` + THREE.ShaderChunk.opaque_fragment;
export function inkify(material, k = 0.6) {
  if (!material || !material.isMeshStandardMaterial) return;
  material.defines = Object.assign({}, material.defines, { USE_INK: '', INK_K: k.toFixed(2) });
  material.needsUpdate = true;
}

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
uniform vec3 uZenith, uMid, uHorizon, uGround, uSunDir, uSunColor, uCloudColor, uFogColor;
uniform float uTime, uLucid, uCloudAmt, uStars, uHaze;
varying vec3 vDir;
${NOISE_GLSL}
void main(){
  vec3 d = normalize(vDir);
  float h = d.y;
  float hu = clamp(h, 0.0, 1.0);
  vec3 col = mix(uHorizon, uMid, smoothstep(0.0, 0.22, hu));
  col = mix(col, uZenith, smoothstep(0.12, 0.85, hu));
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
  // the horizon dissolves into the same haze the ground fades into
  col = mix(col, uFogColor + uSunColor * pow(s, 5.0) * 0.35, uHaze * (1.0 - smoothstep(0.0, 0.16, abs(h + 0.01))));
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
    uGrain: { value: 0.03 },
    uSat: { value: 1.0 },
    uTint: { value: new THREE.Color(1, 1, 1) },
    uVignette: { value: 0.25 },
    uRes: { value: new THREE.Vector2(1, 1) },
    uSlowmo: { value: 0 },
    uWatched: { value: 0 },
    uLowHp: { value: 0 },    // 0..1, how close to death (drives the heartbeat vignette)
    uComfort: { value: 1 },  // 1 = full dream warp, 0 = no screen warp/aberration (motion comfort)
  },
  vertexShader: /* glsl */`varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */`
uniform sampler2D tDiffuse;
uniform float uTime, uLucid, uHurt, uWhite, uGrain, uSat, uVignette, uSlowmo, uWatched, uLowHp, uComfort;
uniform vec3 uTint, uWhiteColor;
uniform vec2 uRes;
varying vec2 vUv;
${NOISE_GLSL}
vec3 hueShift(vec3 c, float a){ const vec3 k = vec3(0.57735); float ca = cos(a); return c*ca + cross(k, c)*sin(a) + k*dot(k, c)*(1.0-ca); }
void main(){
  float L = uLucid * uLucid;
  float W = L * uComfort;
  vec2 uv = vUv;
  vec2 c = uv - 0.5;
  float r2 = dot(c, c);
  uv += vec2(sin(uv.y * 11.0 + uTime * 1.3), cos(uv.x * 9.0 + uTime * 1.1)) * 0.003 * W;
  uv = 0.5 + c * (1.0 + r2 * 0.22 * W * sin(uTime * 0.6)) ;
  float ab = (0.0008 + 0.0035 * W + uHurt * 0.006 + uSlowmo * 0.004) * (0.3 + r2 * 3.0) * mix(0.35, 1.0, uComfort);
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
  // near death: a slow double-beat pulse at the edges and the colour drains
  float beat = pow(max(0.0, sin(uTime * 7.4)), 12.0) + 0.6 * pow(max(0.0, sin(uTime * 7.4 - 0.9)), 12.0);
  float lowEdge = smoothstep(0.25, 0.75, length(c));
  col = mix(col, vec3(dot(col, vec3(0.299, 0.587, 0.114))), uLowHp * 0.45);
  col = mix(col, vec3(0.32, 0.02, 0.05), uLowHp * lowEdge * (0.35 + 0.35 * beat));
  // tearing light at the edge of waking
  float edge = smoothstep(0.3, 0.8, length(c)) * smoothstep(0.72, 1.0, uLucid);
  col += vec3(1.0, 0.94, 0.82) * edge * (0.45 + 0.35 * sin(uTime * 3.0 + uv.y * 24.0 + fbm(uv * 6.0 + uTime) * 5.0));
  // the watched eye: faint violet pressure at the edges
  col += vec3(0.35, 0.1, 0.45) * uWatched * (1.0 - vig) * 0.5;
  // film grain + canvas weave
  float gl = dot(col, vec3(0.299, 0.587, 0.114));
  col += (hash12(uv * uRes + fract(uTime) * 100.0) - 0.5) * uGrain * (0.45 + 1.2 * gl * (1.0 - gl));
  vec2 cw = uv * uRes / 3.0;
  col *= 1.0 - 0.018 * (sin(cw.x) * sin(cw.y) * 0.5 + 0.5) * (0.6 + 0.4 * vnoise(uv * 40.0));
  col = mix(col, uWhiteColor, uWhite);
  gl_FragColor = vec4(col, 1.0);
}`,
};

export const QUALITY = {
  low: { pixelRatio: 0.85, shadows: 1024, bloom: true, ao: false, samples: 0 },
  medium: { pixelRatio: 1.0, shadows: 2048, bloom: true, ao: false, samples: 2 },
  high: { pixelRatio: 1.25, shadows: 4096, bloom: true, ao: true, samples: 2 },
};

// NaN or Inf anywhere in the HDR buffer (a specular spike past half-float range,
// a degenerate normal) gets smeared by bloom into big black squares. Scrub it first.
const SanitizeShader = {
  uniforms: { tDiffuse: { value: null } },
  vertexShader: /* glsl */`varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */`
uniform sampler2D tDiffuse; varying vec2 vUv;
void main(){
  vec4 c = texture2D(tDiffuse, vUv);
  if (any(isnan(c)) || any(isinf(c))) c = vec4(0.0, 0.0, 0.0, 1.0);
  gl_FragColor = vec4(clamp(c.rgb, 0.0, 64.0), c.a);
}`,
};

// Probe the GPU once: software renderers and integrated chips start at a gentler setting
export function suggestQuality(renderer) {
  try {
    const gl = renderer.getContext();
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const name = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : '';
    if (/SwiftShader|llvmpipe|Software|Basic Render/i.test(name)) return 'low';
    if (/NVIDIA|GeForce|Quadro|RTX|Radeon RX|Radeon Pro|AMD Radeon\(TM\) RX|Apple M[1-9] (Pro|Max|Ultra)/i.test(name)) return 'high';
    return 'medium';
  } catch (e) { return 'medium'; }
}

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
      uZenith: { value: new THREE.Color() }, uMid: { value: new THREE.Color() }, uHorizon: { value: new THREE.Color() }, uGround: { value: new THREE.Color() },
      uFogColor: { value: null }, uHaze: { value: 0.6 },
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
    this.scene.fog = new DreamFog(0xd8b38a, 0.006, 0.03);
    this.skyUniforms.uFogColor.value = this.scene.fog.color;

    // pooled point lights (fixed count so shaders never recompile)
    this.lights = [];
    for (let i = 0; i < 8; i++) {
      const l = new THREE.PointLight(0xffffff, 0, 10, 2);
      l.userData = { ttl: 0, life: 1, base: 0, owner: null, flicker: 0 };
      this.scene.add(l);
      this.lights.push(l);
    }

    this.dream = new ShaderPass(DreamShader);
    this.flashScale = 1; // <1 softens explosion/impact light flashes (photosensitivity setting)
    this.setQuality(quality);
    addEventListener('resize', () => this.resize());
    this.resize();
  }

  setQuality(q) {
    this.qualityName = q;
    const Q = this.quality = QUALITY[q] || QUALITY.high;
    const r = this.renderer;
    r.setPixelRatio(Math.min(devicePixelRatio || 1, Q.pixelRatio)); // never pay for a retina screen twice over
    this.sun.shadow.mapSize.set(Q.shadows, Q.shadows);
    if (this.sun.shadow.map) { this.sun.shadow.map.dispose(); this.sun.shadow.map = null; }
    const size = r.getDrawingBufferSize(new THREE.Vector2());
    const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: Q.samples });
    if (this.composer) this.composer.dispose();
    // the old passes hold their own render targets; free them or every quality change leaks VRAM
    if (this.gtao) { this.gtao.dispose(); this.gtao = null; }
    if (this.bloom) { this.bloom.dispose(); this.bloom = null; }
    const c = this.composer = new EffectComposer(r, rt);
    c.addPass(new RenderPass(this.scene, this.camera));
    this.gtao = null;
    if (Q.ao) {
      this.gtao = new GTAOPass(this.scene, this.camera, size.x, size.y);
      this.gtao.output = GTAOPass.OUTPUT.Default;
      this.gtao.blendIntensity = 0.85;
      this.gtao.updateGtaoMaterial({ radius: 0.6, distanceExponent: 1.5, thickness: 1.2, scale: 1.0, samples: 12 });
      this.gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 4, rings: 2, samples: 12 });
      // only solid, depth-writing surfaces should occlude: glass, glows, sprites and
      // particle quads otherwise stamp dark boxes into the AO
      const cache = this.gtao._visibilityCache;
      this.gtao.overrideVisibility = function () {
        this.scene.traverse((o) => {
          cache.set(o, o.visible);
          if (o.isPoints || o.isLine || o.isSprite) { o.visible = false; return; }
          const m = o.material;
          if (m && !Array.isArray(m) && ((m.transparent && (m.opacity < 0.95 || !m.depthWrite)) || m.blending === THREE.AdditiveBlending || o.userData.noAO)) o.visible = false;
        });
      };
      c.addPass(this.gtao);
    }
    c.addPass(new ShaderPass(SanitizeShader));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.45, 0.5, 0.92);
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
    u.uMid.value.set(look.mid || look.horizon);
    u.uHaze.value = look.haze ?? 0.6;
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
    this.scene.fog.falloff = look.fogFalloff ?? 0.03;
    FOG.floor.value = look.fogFloor ?? 0;
    const sd = FOG.sunDir.value; sd.x = this.sunDir.x; sd.y = this.sunDir.y; sd.z = this.sunDir.z;
    const sc = new THREE.Color(look.fogSun || look.sunColor).multiplyScalar(look.fogSunAmt ?? 0.35);
    const sv = FOG.sunColor.value; sv.x = sc.r; sv.y = sc.g; sv.z = sc.b;
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
    const k = ttl < 1e8 ? this.flashScale : 1; // owned (persistent) lights are not flashes
    best.userData.ttl = ttl; best.userData.life = ttl; best.userData.base = intensity * k; best.userData.flicker = flicker;
    best.intensity = intensity * k;
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
