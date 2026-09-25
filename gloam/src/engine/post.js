// Post-processing chain:
//   scene (HDR + depth, MSAA) → atmospheric pass (height fog, ground mist,
//   light halos in the fog) → bloom → grade (ACES, lift/gamma/gain,
//   saturation, vignette, film grain) → screen.
import * as THREE from 'three';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

export const MAX_HALOS = 8;

const FOG_FRAG = /* glsl */`
  precision highp float;
  uniform sampler2D tColor;
  uniform sampler2D tDepth;
  uniform sampler2D tHeight;
  uniform float uHeightSize;
  uniform mat4 uProjInv;
  uniform mat4 uViewInv;
  uniform vec3 uCamPos;
  uniform vec3 uFogColor;
  uniform vec3 uFogSunColor;
  uniform vec3 uSunDir;
  uniform float uFogDensity;
  uniform float uFogBase;
  uniform float uFogHeight;
  uniform float uFogFalloff;
  uniform float uMist;
  uniform float uTime;
  uniform vec3 uClearPos;
  uniform float uClearRadius;
  uniform vec3 uHaloPos[${MAX_HALOS}];
  uniform vec4 uHaloCol[${MAX_HALOS}];   // rgb * intensity, w = radius
  uniform float uHaloStrength;
  varying vec2 vUv;

  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float vnoise(vec2 p) {
    vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
  }
  float fbm(vec2 p) { return vnoise(p) * 0.55 + vnoise(p * 2.13 + 3.1) * 0.3 + vnoise(p * 4.37 - 1.7) * 0.15; }

  void main() {
    vec3 col = texture2D(tColor, vUv).rgb;
    float depth = texture2D(tDepth, vUv).x;
    vec4 ndc = vec4(vUv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
    vec4 vpos = uProjInv * ndc; vpos /= vpos.w;
    vec3 world = (uViewInv * vpos).xyz;
    vec3 rd = world - uCamPos;
    float dist = length(rd);
    rd /= max(dist, 1e-4);
    bool sky = depth > 0.99999;
    if (sky) dist = 1400.0;

    // analytic exponential height fog along the view ray
    float a = uFogDensity;
    float b = uFogFalloff;
    float c = a * exp(-b * (uCamPos.y - uFogHeight));
    float k = rd.y * b;
    float fogInt = abs(k) > 1e-4 ? c * (1.0 - exp(-dist * k)) / k : c * dist;
    float fog = 1.0 - exp(-(fogInt + dist * uFogBase));

    // clearer air around the Great Hearth
    if (!sky) {
      float cd = length(world.xz - uClearPos.xz);
      fog *= mix(0.45, 1.0, smoothstep(uClearRadius * 0.6, uClearRadius * 1.25, cd));
    }

    // low ground mist hugging the terrain (wispy, drifting): opacity grows
    // with the length of the view ray inside a ~1.8 m layer over the ground
    if (!sky && uMist > 0.0) {
      vec2 huv = (world.xz + uHeightSize * 0.5) / uHeightSize;
      float th = texture2D(tHeight, huv).r;
      float above = max(0.0, world.y - max(th, 0.0));
      float layer = 1.8;
      float inLayer = exp(-above / layer);
      float camAbove = max(uCamPos.y - max(world.y, 0.0), 0.001);
      float path = dist * clamp(layer / camAbove, 0.0, 1.0) * inLayer;
      float n = fbm(world.xz * 0.05 + vec2(uTime * 0.015, uTime * 0.009));
      float mist = 1.0 - exp(-path * 0.05 * uMist * (0.35 + 1.3 * smoothstep(0.3, 0.8, n)));
      float cd = length(world.xz - uClearPos.xz);
      mist *= smoothstep(uClearRadius * 0.5, uClearRadius * 1.1, cd);
      fog = 1.0 - (1.0 - fog) * (1.0 - clamp(mist, 0.0, 0.9));
    }

    float sunAmt = pow(max(dot(rd, uSunDir), 0.0), 6.0);
    vec3 fogCol = uFogColor + uFogSunColor * sunAmt;
    col = mix(col, fogCol, clamp(fog, 0.0, 1.0));

    // light halos: in-scattering from point lights (torches glowing in the mist)
    vec3 halo = vec3(0.0);
    for (int i = 0; i < ${MAX_HALOS}; i++) {
      vec4 hc = uHaloCol[i];
      if (hc.w <= 0.0) continue;
      vec3 lp = uHaloPos[i] - uCamPos;
      float t = clamp(dot(lp, rd), 0.0, dist);
      float d = length(lp - rd * t);
      float r = hc.w;
      float fall = 1.0 / (1.0 + (d * d) / (r * r));
      halo += hc.rgb * fall * fall * smoothstep(0.0, 2.0, t);
    }
    col += halo * uHaloStrength;
    gl_FragColor = vec4(col, 1.0);
  }
`;

const GRADE_FRAG = /* glsl */`
  precision highp float;
  uniform sampler2D tColor;
  uniform vec2 uRes;
  uniform float uExposure;
  uniform vec3 uLift;
  uniform vec3 uGamma;
  uniform vec3 uGain;
  uniform float uSaturation;
  uniform float uVignette;
  uniform float uGrain;
  uniform float uTime;
  uniform float uFlash;
  uniform vec3 uTint;      // multiplicative screen tint (damage / events)
  uniform float uFade;     // 0 = normal, 1 = black
  varying vec2 vUv;

  vec3 aces(vec3 x) {
    const float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
    return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
  }
  vec3 toSRGB(vec3 c) {
    return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
  }
  float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }

  // FXAA-lite on the HDR buffer (luma-based edge blur)
  vec3 sampleAA(vec2 uv) {
    vec2 px = 1.0 / uRes;
    vec3 cM = texture2D(tColor, uv).rgb;
    vec3 cN = texture2D(tColor, uv + vec2(0.0, px.y)).rgb;
    vec3 cS = texture2D(tColor, uv - vec2(0.0, px.y)).rgb;
    vec3 cE = texture2D(tColor, uv + vec2(px.x, 0.0)).rgb;
    vec3 cW = texture2D(tColor, uv - vec2(px.x, 0.0)).rgb;
    vec3 L = vec3(0.299, 0.587, 0.114);
    float lM = dot(aces(cM), L), lN = dot(aces(cN), L), lS = dot(aces(cS), L), lE = dot(aces(cE), L), lW = dot(aces(cW), L);
    float mn = min(lM, min(min(lN, lS), min(lE, lW)));
    float mx = max(lM, max(max(lN, lS), max(lE, lW)));
    float range = mx - mn;
    if (range < max(0.08, mx * 0.25)) return cM;
    vec2 dir = vec2(-((lN + lS) - (lE + lW)), (lN + lS) - (lE + lW));
    dir = normalize(dir + 1e-5) * px * 0.9;
    vec3 a = texture2D(tColor, uv + dir * 0.5).rgb + texture2D(tColor, uv - dir * 0.5).rgb;
    return mix(cM, a * 0.5, 0.5);
  }

  void main() {
    vec2 uv = vUv;
    vec2 cc = uv - 0.5;
    vec3 col = sampleAA(uv);
    // gentle chromatic fringe toward the corners
    float ca = dot(cc, cc) * 0.006;
    col.r = mix(col.r, texture2D(tColor, uv + cc * ca).r, 0.6);
    col.b = mix(col.b, texture2D(tColor, uv - cc * ca).b, 0.6);
    col *= uExposure * uTint;
    col += uFlash;
    col = aces(col);
    // lift / gamma / gain in display-ish space
    col = clamp(col * uGain + uLift * (1.0 - col), 0.0, 1.0);
    col = pow(col, 1.0 / uGamma);
    float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));
    col = mix(vec3(lum), col, uSaturation);
    // vignette
    float v = smoothstep(0.95, 0.25, length(cc * vec2(1.0, 0.85)));
    col *= mix(1.0 - uVignette, 1.0, v);
    col = toSRGB(clamp(col, 0.0, 1.0));
    // film grain (in display space so it's even)
    float g = hash(uv * uRes + fract(uTime * 7.13) * 100.0) - 0.5;
    col += g * uGrain;
    col *= 1.0 - uFade;
    gl_FragColor = vec4(col, 1.0);
  }
`;

const VERT = /* glsl */`
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

export class PostFX {
  constructor(renderer, { heightTexture, heightSize, samples = 4 } = {}) {
    this.renderer = renderer;
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    this.width = size.x;
    this.height = size.y;

    this.depthTexture = new THREE.DepthTexture(size.x, size.y);
    this.depthTexture.type = THREE.UnsignedIntType;
    this.sceneRT = new THREE.WebGLRenderTarget(size.x, size.y, {
      type: THREE.HalfFloatType,
      samples,
      depthTexture: this.depthTexture,
      depthBuffer: true,
    });
    this.fogRT = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, depthBuffer: false });

    const haloPos = [];
    const haloCol = [];
    for (let i = 0; i < MAX_HALOS; i++) { haloPos.push(new THREE.Vector3()); haloCol.push(new THREE.Vector4(0, 0, 0, 0)); }

    this.fogUniforms = {
      tColor: { value: this.sceneRT.texture },
      tDepth: { value: this.depthTexture },
      tHeight: { value: heightTexture || null },
      uHeightSize: { value: heightSize || 320 },
      uProjInv: { value: new THREE.Matrix4() },
      uViewInv: { value: new THREE.Matrix4() },
      uCamPos: { value: new THREE.Vector3() },
      uFogColor: { value: new THREE.Color(0.2, 0.22, 0.25) },
      uFogSunColor: { value: new THREE.Color(0.3, 0.2, 0.1) },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uFogDensity: { value: 0.02 },
      uFogBase: { value: 0.002 },
      uFogHeight: { value: 4 },
      uFogFalloff: { value: 0.08 },
      uMist: { value: 0.5 },
      uTime: { value: 0 },
      uClearPos: { value: new THREE.Vector3() },
      uClearRadius: { value: 16 },
      uHaloPos: { value: haloPos },
      uHaloCol: { value: haloCol },
      uHaloStrength: { value: 0.05 },
    };
    this.fogQuad = new FullScreenQuad(new THREE.ShaderMaterial({
      uniforms: this.fogUniforms, vertexShader: VERT, fragmentShader: FOG_FRAG, depthTest: false, depthWrite: false,
    }));

    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.55, 0.6, 1.05);

    this.gradeUniforms = {
      tColor: { value: this.fogRT.texture },
      uRes: { value: new THREE.Vector2(size.x, size.y) },
      uExposure: { value: 1.0 },
      uLift: { value: new THREE.Vector3(0.02, 0.02, 0.035) },
      uGamma: { value: new THREE.Vector3(1.0, 1.0, 1.0) },
      uGain: { value: new THREE.Vector3(1.0, 0.98, 0.95) },
      uSaturation: { value: 0.85 },
      uVignette: { value: 0.38 },
      uGrain: { value: 0.035 },
      uTime: { value: 0 },
      uFlash: { value: 0 },
      uTint: { value: new THREE.Vector3(1, 1, 1) },
      uFade: { value: 0 },
    };
    this.gradeQuad = new FullScreenQuad(new THREE.ShaderMaterial({
      uniforms: this.gradeUniforms, vertexShader: VERT, fragmentShader: GRADE_FRAG, depthTest: false, depthWrite: false,
    }));
    this.enabled = true;
    this.bloomEnabled = true;
  }

  setSize(w, h) {
    this.width = w; this.height = h;
    this.sceneRT.setSize(w, h);
    this.fogRT.setSize(w, h);
    this.bloom.setSize(w, h);
    this.gradeUniforms.uRes.value.set(w, h);
  }

  setHalos(list) {
    const P = this.fogUniforms.uHaloPos.value;
    const C = this.fogUniforms.uHaloCol.value;
    for (let i = 0; i < MAX_HALOS; i++) {
      const h = list[i];
      if (h) { P[i].copy(h.pos); C[i].set(h.color.r * h.intensity, h.color.g * h.intensity, h.color.b * h.intensity, h.radius); }
      else C[i].w = 0;
    }
  }

  render(scene, camera, time) {
    const r = this.renderer;
    const fu = this.fogUniforms;
    camera.updateMatrixWorld();
    fu.uProjInv.value.copy(camera.projectionMatrixInverse);
    fu.uViewInv.value.copy(camera.matrixWorld);
    fu.uCamPos.value.setFromMatrixPosition(camera.matrixWorld);
    fu.uTime.value = time;
    this.gradeUniforms.uTime.value = time;

    r.setRenderTarget(this.sceneRT);
    r.clear();
    r.render(scene, camera);

    r.setRenderTarget(this.fogRT);
    this.fogQuad.render(r);

    if (this.bloomEnabled) this.bloom.render(r, null, this.fogRT, 0, false);

    r.setRenderTarget(null);
    this.gradeQuad.render(r);
  }
}
