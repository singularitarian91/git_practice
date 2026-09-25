// Shared materials for every Blender-made model.
//
// The Blender scripts tag faces with one of four material slots
// (Mat_Base, Mat_Leaves, Mat_Emit, Mat_Metal) and store colour in vertex
// colours.  Here each slot is swapped for a single shared three.js
// material so hundreds of props batch cheaply and all react to the same
// global uniforms (time, wind, season tint, snow).
import * as THREE from 'three';

export const globalUniforms = {
  uTime: { value: 0 },
  uWind: { value: 1 },               // 0 calm .. 2 storm
  uLeafTint: { value: new THREE.Color(1, 1, 1) },
  uAutumn: { value: 0 },             // 0..1 blend to autumn palette
  uSnow: { value: 0 },               // 0..1 snow on upward faces
  uGrainTex: { value: null },        // tiny tileable noise, nearest-filtered
  uGrain: { value: 0.22 },           // strength of chunky texel noise
  // x, y: player position in drawing-buffer pixels, z: its view depth, w: radius (px)
  uFade: { value: new THREE.Vector4(0, 0, 0, 0) },
  uFadeY: { value: 0 },              // only fade things above this world height
};

// A 32x32 value-noise texture sampled in world space with nearest filtering.
// It gives flat low-poly faces the grainy "big texel" feel of Valheim.
export function makeGrainTexture(size = 32, seed = 7) {
  const data = new Uint8Array(size * size * 4);
  let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < size * size; i++) {
    const v = 110 + Math.floor(rnd() * 90);
    data[i * 4] = v; data[i * 4 + 1] = v; data[i * 4 + 2] = v; data[i * 4 + 3] = 255;
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.needsUpdate = true;
  return tex;
}

const GRAIN_VERT_DECL = /* glsl */`
  varying vec3 vGhWorldPos;
  varying vec3 vGhWorldNormal;
`;
const GRAIN_VERT_MAIN = /* glsl */`
  #ifdef USE_INSTANCING
    vec4 ghWp = modelMatrix * instanceMatrix * vec4(transformed, 1.0);
    vGhWorldNormal = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * objectNormal);
  #else
    vec4 ghWp = modelMatrix * vec4(transformed, 1.0);
    vGhWorldNormal = normalize(mat3(modelMatrix) * objectNormal);
  #endif
  vGhWorldPos = ghWp.xyz;
`;
const GRAIN_FRAG_DECL = /* glsl */`
  uniform vec4 uFade;
  uniform float uFadeY;
  float ghBayer(vec2 p) {
    ivec2 q = ivec2(mod(p, 4.0));
    int i = q.x + q.y * 4;
    float m[16] = float[16](0.0, 8.0, 2.0, 10.0, 12.0, 4.0, 14.0, 6.0, 3.0, 11.0, 1.0, 9.0, 15.0, 7.0, 13.0, 5.0);
    return (m[i] + 0.5) / 16.0;
  }
  uniform sampler2D uGrainTex;
  uniform float uGrain;
  uniform float uSnow;
  varying vec3 vGhWorldPos;
  varying vec3 vGhWorldNormal;
  float ghGrain() {
    // triplanar pick of the dominant axis -> chunky texels ~6cm
    vec3 n = abs(vGhWorldNormal);
    vec2 uv = n.y > max(n.x, n.z) ? vGhWorldPos.xz : (n.x > n.z ? vGhWorldPos.zy : vGhWorldPos.xy);
    float g = texture2D(uGrainTex, uv * 0.55).r;
    return mix(1.0, g * 1.55, uGrain);
  }
`;
// applied right after the vertex colour is multiplied into diffuseColor
const GRAIN_FRAG_MAIN = /* glsl */`
  diffuseColor.rgb *= ghGrain();
  float ghSnow = uSnow * smoothstep(0.55, 0.85, vGhWorldNormal.y);
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.82, 0.86, 0.92), ghSnow);
`;

// Dither away anything standing between the camera and the player
// (tree canopies, roofs) so you never lose sight of yourself.
const FADE_FRAG = /* glsl */`
  if (uFade.w > 0.0) {
    float fd = distance(gl_FragCoord.xy, uFade.xy);
    if (fd < uFade.w && -vViewPosition.z < uFade.z - 1.2 && vGhWorldPos.y > uFadeY) {
      float k = 1.0 - smoothstep(uFade.w * 0.5, uFade.w, fd);
      if (ghBayer(gl_FragCoord.xy) < k * 0.8) discard;
    }
  }
`;

function patchGrain(shader, extraVertDecl = '', extraVertMain = '', extraFragDecl = '', extraFragMain = '') {
  shader.uniforms.uGrainTex = globalUniforms.uGrainTex;
  shader.uniforms.uGrain = globalUniforms.uGrain;
  shader.uniforms.uSnow = globalUniforms.uSnow;
  shader.uniforms.uTime = globalUniforms.uTime;
  shader.uniforms.uWind = globalUniforms.uWind;
  shader.uniforms.uLeafTint = globalUniforms.uLeafTint;
  shader.uniforms.uAutumn = globalUniforms.uAutumn;
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\n' + GRAIN_VERT_DECL + extraVertDecl)
    .replace('#include <begin_vertex>', '#include <begin_vertex>\n' + extraVertMain)
    .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\n' + GRAIN_VERT_MAIN);
  shader.uniforms.uFade = globalUniforms.uFade;
  shader.uniforms.uFadeY = globalUniforms.uFadeY;
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <clipping_planes_fragment>', FADE_FRAG + '#include <clipping_planes_fragment>')
    .replace('#include <common>', '#include <common>\n' + GRAIN_FRAG_DECL + extraFragDecl)
    .replace('#include <color_fragment>', '#include <color_fragment>\n' + extraFragMain + GRAIN_FRAG_MAIN);
}

// Wind sway: displacement grows with local height (trunks stay planted).
const SWAY_VERT_DECL = /* glsl */`
  uniform float uTime;
  uniform float uWind;
  varying float vGhHash;
`;
const SWAY_VERT_MAIN = /* glsl */`
  {
    #ifdef USE_INSTANCING
      vec3 ghOrigin = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
    #else
      vec3 ghOrigin = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
    #endif
    vGhHash = fract(sin(dot(ghOrigin.xz, vec2(12.9898, 78.233))) * 43758.5453);
    float h = max(0.0, transformed.y);
    float ph = uTime * 1.4 + ghOrigin.x * 0.21 + ghOrigin.z * 0.17 + transformed.x * 0.4;
    float amp = (0.012 + 0.018 * uWind) * h;
    transformed.x += sin(ph) * amp + sin(ph * 2.7 + transformed.z) * amp * 0.25;
    transformed.z += cos(ph * 0.83) * amp * 0.8;
  }
`;
const LEAF_FRAG_DECL = /* glsl */`
  uniform vec3 uLeafTint;
  uniform float uAutumn;
  varying float vGhHash;
`;
const LEAF_FRAG_MAIN = /* glsl */`
  {
    diffuseColor.rgb *= uLeafTint;
    // autumn: blend towards rust / amber / blood-red per plant
    vec3 a1 = vec3(0.42, 0.14, 0.03);
    vec3 a2 = vec3(0.55, 0.30, 0.04);
    vec3 a3 = vec3(0.30, 0.05, 0.03);
    vec3 autumn = vGhHash < 0.33 ? a1 : (vGhHash < 0.66 ? a2 : a3);
    float lum = dot(diffuseColor.rgb, vec3(0.3, 0.6, 0.1));
    diffuseColor.rgb = mix(diffuseColor.rgb, autumn * (0.6 + lum * 3.0), uAutumn * 0.85);
  }
`;

let cache = null;

export function getSharedMaterials() {
  if (cache) return cache;
  if (!globalUniforms.uGrainTex.value) globalUniforms.uGrainTex.value = makeGrainTexture();

  const base = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0.0 });
  base.onBeforeCompile = (s) => patchGrain(s);
  base.customProgramCacheKey = () => 'gh-base';

  const metal = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.42, metalness: 0.55 });
  metal.onBeforeCompile = (s) => patchGrain(s);
  metal.customProgramCacheKey = () => 'gh-metal';

  const leaves = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0.0, side: THREE.DoubleSide });
  leaves.onBeforeCompile = (s) => patchGrain(s, SWAY_VERT_DECL, SWAY_VERT_MAIN, LEAF_FRAG_DECL, LEAF_FRAG_MAIN);
  leaves.customProgramCacheKey = () => 'gh-leaves';

  const emit = new THREE.MeshBasicMaterial({ vertexColors: true, color: new THREE.Color(2.6, 2.6, 2.6) });
  emit.toneMapped = false;

  base.name = 'Mat_Base'; metal.name = 'Mat_Metal'; leaves.name = 'Mat_Leaves'; emit.name = 'Mat_Emit';
  cache = { Mat_Base: base, Mat_Metal: metal, Mat_Leaves: leaves, Mat_Emit: emit };
  return cache;
}

// Swap Blender material slots for the shared game materials.
export function applyGameMaterials(root, { shadows = true } = {}) {
  const mats = getSharedMaterials();
  root.traverse((o) => {
    if (!o.isMesh) return;
    const name = o.material && o.material.name;
    const key = Object.keys(mats).find((k) => name && name.startsWith(k)) || 'Mat_Base';
    o.material = mats[key];
    o.castShadow = shadows && key !== 'Mat_Emit';
    o.receiveShadow = shadows;
  });
  return root;
}
