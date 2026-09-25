// One sea-level water plane for the sea, the lake and the stream.
// Depth-tinted using the terrain heightmap, with sky reflection, sun and
// torch glints, shoreline foam, stream flow and rain ripples.
import * as THREE from 'three';
import { MAX_HALOS } from './post.js';

const VERT = /* glsl */`
  varying vec3 vWorld;
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorld = wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

const FRAG = /* glsl */`
  precision highp float;
  uniform float uTime;
  uniform sampler2D uHeight;
  uniform float uHeightSize;
  uniform vec3 uCamPos;
  uniform vec3 uLightDir;
  uniform vec3 uLightColor;
  uniform vec3 uAmbient;
  uniform vec3 uZenith;
  uniform vec3 uHorizon;
  uniform vec3 uDeep;
  uniform vec3 uShallow;
  uniform float uRain;
  uniform float uWind;
  uniform vec3 uLakePos;
  uniform float uLakeR;
  uniform vec3 uGlintPos[${MAX_HALOS}];
  uniform vec4 uGlintCol[${MAX_HALOS}];
  varying vec3 vWorld;

  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float vnoise(vec2 p) {
    vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
  }
  float waves(vec2 p, float t) {
    float h = 0.0;
    h += sin(dot(p, vec2(0.21, 0.13)) * 1.0 + t * 1.1) * 0.5;
    h += sin(dot(p, vec2(-0.17, 0.29)) * 1.3 + t * 1.4) * 0.35;
    h += vnoise(p * 0.9 + vec2(t * 0.35, t * 0.2)) * 0.6;
    h += vnoise(p * 2.7 - vec2(t * 0.6, -t * 0.4)) * 0.25;
    return h;
  }
  float ripples(vec2 p, float t) {
    // expanding rings in random cells (rain)
    vec2 cell = floor(p * 1.3);
    vec2 f = fract(p * 1.3) - 0.5;
    float h = hash(cell);
    float ph = fract(t * 0.9 + h);
    float r = length(f - (vec2(hash(cell + 3.1), hash(cell + 7.7)) - 0.5) * 0.5);
    return sin((r - ph * 0.5) * 40.0) * smoothstep(0.5, 0.0, r) * (1.0 - ph) * smoothstep(0.0, 0.1, ph);
  }

  void main() {
    vec2 huv = (vWorld.xz + uHeightSize * 0.5) / uHeightSize;
    float ground = -6.5;
    if (huv.x > 0.0 && huv.x < 1.0 && huv.y > 0.0 && huv.y < 1.0) ground = texture2D(uHeight, huv).r;
    float depth = max(0.0, -ground);

    // flow: the stream runs south, the sea swells, the lake is calm
    float lakeW = smoothstep(uLakeR * 1.3, uLakeR * 0.8, length(vWorld.xz - uLakePos.xz));
    vec2 flow = vec2(0.0, uTime * 0.6) * smoothstep(3.0, 0.8, depth) * (1.0 - lakeW);
    vec2 p = vWorld.xz * 0.9 + flow;
    float t = uTime * (0.6 + uWind * 0.4);
    float e = 0.15;
    float amp = mix(0.12, 0.05, lakeW) * (0.6 + uWind * 0.5);
    float hC = waves(p, t);
    float hX = waves(p + vec2(e, 0.0), t);
    float hZ = waves(p + vec2(0.0, e), t);
    vec3 n = normalize(vec3(-(hX - hC) / e * amp, 1.0, -(hZ - hC) / e * amp));
    if (uRain > 0.0) {
      float r0 = ripples(vWorld.xz, uTime), rx = ripples(vWorld.xz + vec2(0.05, 0.0), uTime), rz = ripples(vWorld.xz + vec2(0.0, 0.05), uTime);
      n = normalize(n + vec3(-(rx - r0), 0.0, -(rz - r0)) * 6.0 * uRain);
    }

    vec3 V = normalize(uCamPos - vWorld);
    float fres = 0.04 + 0.96 * pow(1.0 - max(dot(n, V), 0.0), 5.0);
    vec3 R = reflect(-V, n);
    vec3 sky = mix(uHorizon, uZenith, pow(clamp(R.y, 0.0, 1.0), 0.6));

    // body colour: shallow→deep, lit by ambient + light
    float dk = 1.0 - exp(-depth * 0.55);
    vec3 body = mix(uShallow, uDeep, dk);
    body *= uAmbient * 0.9 + uLightColor * max(dot(n, uLightDir), 0.0) * 0.35;

    vec3 col = mix(body, sky * 0.7, fres * 0.8);

    // sun/moon glint
    vec3 H = normalize(uLightDir + V);
    col += uLightColor * pow(max(dot(n, H), 0.0), 220.0) * 2.2;
    // torch & window glints dancing on the water
    for (int i = 0; i < ${MAX_HALOS}; i++) {
      vec4 gc = uGlintCol[i];
      if (gc.w <= 0.0) continue;
      vec3 L = uGlintPos[i] - vWorld;
      float d = length(L);
      L /= d;
      vec3 Hh = normalize(L + V);
      float att = 1.0 / (1.0 + d * d * 0.02);
      col += gc.rgb * pow(max(dot(n, Hh), 0.0), 90.0) * att * 3.0;
    }

    // shoreline foam
    float foamN = vnoise(vWorld.xz * 1.6 + vec2(uTime * 0.25, -uTime * 0.18));
    float shore = smoothstep(0.16, 0.0, depth + (foamN - 0.5) * 0.12);
    float band = smoothstep(0.75, 0.95, sin(depth * 22.0 - uTime * 2.2 + foamN * 5.0) * 0.5 + 0.5) * smoothstep(0.55, 0.12, depth) * smoothstep(0.3, 0.6, foamN);
    float foam = clamp(shore * 0.6 + band * 0.35 * (1.0 - lakeW * 0.8), 0.0, 1.0);
    col = mix(col, (uAmbient + uLightColor * 0.4) * 0.7, foam * 0.45);

    float alpha = clamp(0.55 + dk * 0.6 + fres * 0.3, 0.0, 1.0);
    gl_FragColor = vec4(col, alpha);
  }
`;

export class Water {
  constructor(terrain, lake) {
    const glintPos = [], glintCol = [];
    for (let i = 0; i < MAX_HALOS; i++) { glintPos.push(new THREE.Vector3()); glintCol.push(new THREE.Vector4()); }
    this.uniforms = {
      uTime: { value: 0 },
      uHeight: { value: terrain.heightTexture },
      uHeightSize: { value: terrain.size },
      uCamPos: { value: new THREE.Vector3() },
      uLightDir: { value: new THREE.Vector3(0, 1, 0) },
      uLightColor: { value: new THREE.Color(1, 1, 1) },
      uAmbient: { value: new THREE.Color(0.3, 0.3, 0.35) },
      uZenith: { value: new THREE.Color() },
      uHorizon: { value: new THREE.Color() },
      uDeep: { value: new THREE.Color('#061216') },
      uShallow: { value: new THREE.Color('#23403c') },
      uRain: { value: 0 },
      uWind: { value: 1 },
      uLakePos: { value: new THREE.Vector3(lake.x, 0, lake.z) },
      uLakeR: { value: lake.r },
      uGlintPos: { value: glintPos },
      uGlintCol: { value: glintCol },
    };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: true,
    });
    const geo = new THREE.PlaneGeometry(1400, 1400, 1, 1);
    geo.rotateX(-Math.PI / 2);
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.name = 'water';
    this.mesh.renderOrder = 1;
    this.mesh.frustumCulled = false;
  }

  update(time, camera, atmo, weather, glints) {
    const u = this.uniforms;
    u.uTime.value = time;
    u.uCamPos.value.copy(camera.position);
    this.mesh.position.set(Math.round(camera.position.x / 10) * 10, 0, Math.round(camera.position.z / 10) * 10);
    u.uLightDir.value.copy(atmo.lightDir);
    u.uLightColor.value.copy(atmo.lightColor).multiplyScalar(atmo.lightIntensity * 0.6);
    u.uAmbient.value.copy(atmo.hemiSky).multiplyScalar(atmo.hemiIntensity * 0.55);
    u.uZenith.value.copy(atmo.zenith);
    u.uHorizon.value.copy(atmo.horizon);
    u.uRain.value = weather === 'rain' || weather === 'storm' ? 1 : 0;
    u.uWind.value = atmo.wind;
    for (let i = 0; i < MAX_HALOS; i++) {
      const g = glints[i];
      if (g) {
        u.uGlintPos.value[i].copy(g.pos);
        u.uGlintCol.value[i].set(g.color.r * g.intensity * 0.12, g.color.g * g.intensity * 0.12, g.color.b * g.intensity * 0.12, 1);
      } else u.uGlintCol.value[i].w = 0;
    }
  }
}
