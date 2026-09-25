// Time-of-day + weather + season → every lighting/sky/fog/grading parameter.
import * as THREE from 'three';
import { clamp, lerp, smoothstep } from './noise.js';

// Key frames around the clock (colours authored in sRGB hex).
const KEYS = [
  { h: 0.0, zen: '#03050b', hor: '#0b111c', fog: '#0a0f17', sun: '#ff9a6a', sunI: 0.0, hemS: '#22304e', hemG: '#08090c', hemI: 0.7, exp: 1.35, cl: '#1b2233', cd: '#07090e' },
  { h: 4.6, zen: '#04060d', hor: '#121827', fog: '#0e131c', sun: '#ff9a6a', sunI: 0.0, hemS: '#22304e', hemG: '#08090c', hemI: 0.7, exp: 1.35, cl: '#1e2536', cd: '#080a10' },
  { h: 5.6, zen: '#141a2a', hor: '#4a3a44', fog: '#262a36', sun: '#ff9a6a', sunI: 0.15, hemS: '#3a4260', hemG: '#15141a', hemI: 0.65, exp: 1.25, cl: '#6a5058', cd: '#1c1a24' },
  { h: 6.6, zen: '#2d3d58', hor: '#b8785a', fog: '#5c6270', sun: '#ffb07a', sunI: 1.15, hemS: '#7888a4', hemG: '#3a3230', hemI: 0.85, exp: 1.1, cl: '#e0a080', cd: '#4a4250' },
  { h: 8.0, zen: '#3f5878', hor: '#9aa8b4', fog: '#76838f', sun: '#ffe0b8', sunI: 2.1, hemS: '#a6b6cc', hemG: '#4b4638', hemI: 1.0, exp: 1.0, cl: '#c8ccd2', cd: '#5a6068' },
  { h: 12.5, zen: '#48648a', hor: '#a4b0ba', fog: '#7f8b95', sun: '#fff0dc', sunI: 2.6, hemS: '#b0bfd2', hemG: '#524c3c', hemI: 1.1, exp: 1.0, cl: '#d4d8dc', cd: '#646a72' },
  { h: 16.0, zen: '#45597a', hor: '#b0a890', fog: '#7a8288', sun: '#ffd6a0', sunI: 2.25, hemS: '#aab4c4', hemG: '#524a38', hemI: 1.05, exp: 1.0, cl: '#d8ccb4', cd: '#625c5a' },
  { h: 18.3, zen: '#3a4766', hor: '#d08a52', fog: '#686872', sun: '#ff9a52', sunI: 1.45, hemS: '#8c8ca4', hemG: '#43362c', hemI: 0.9, exp: 1.05, cl: '#f0a870', cd: '#584650' },
  { h: 19.4, zen: '#252d48', hor: '#8a4a4c', fog: '#383645', sun: '#ff6a3a', sunI: 0.45, hemS: '#4c4c6c', hemG: '#1e1a1c', hemI: 0.72, exp: 1.15, cl: '#b0605a', cd: '#2e2634' },
  { h: 20.3, zen: '#111829', hor: '#2c3450', fog: '#1c2232', sun: '#ff6a3a', sunI: 0.0, hemS: '#2a3452', hemG: '#0c0c10', hemI: 0.6, exp: 1.3, cl: '#2c3246', cd: '#0e1018' },
  { h: 21.6, zen: '#03050b', hor: '#0b111c', fog: '#0a0f17', sun: '#ff9a6a', sunI: 0.0, hemS: '#22304e', hemG: '#08090c', hemI: 0.7, exp: 1.35, cl: '#1b2233', cd: '#07090e' },
];
const COLOR_KEYS = ['zen', 'hor', 'fog', 'sun', 'hemS', 'hemG', 'cl', 'cd'];
const NUM_KEYS = ['sunI', 'hemI', 'exp'];
// pre-convert hex → linear THREE.Color
for (const k of KEYS) for (const c of COLOR_KEYS) k[c] = new THREE.Color(k[c]);

const WEATHER = {
  clear: { sun: 1.0, cloud: 0.32, fog: 1.0, mist: 1.0, grey: 0.0, dark: 1.0, wind: 0.8 },
  overcast: { sun: 0.45, cloud: 0.82, fog: 1.25, mist: 1.1, grey: 0.45, dark: 0.85, wind: 1.0 },
  fog: { sun: 0.4, cloud: 0.9, fog: 1.9, mist: 1.6, grey: 0.5, dark: 0.9, wind: 0.4 },
  rain: { sun: 0.28, cloud: 1.0, fog: 1.6, mist: 1.3, grey: 0.6, dark: 0.7, wind: 1.3 },
  storm: { sun: 0.14, cloud: 1.0, fog: 1.9, mist: 1.2, grey: 0.7, dark: 0.5, wind: 2.0 },
  snow: { sun: 0.5, cloud: 0.9, fog: 1.7, mist: 1.0, grey: 0.55, dark: 0.95, wind: 1.1 },
};

const SEASON_ELEV = { spring: 34, summer: 44, autumn: 30, winter: 20 };

const tmpA = new THREE.Color();
const grey = new THREE.Color();

function sample(hour) {
  // cyclic interpolation between key frames
  const h = ((hour % 24) + 24) % 24;
  let a = KEYS[KEYS.length - 1], b = KEYS[0];
  let ta = a.h - 24, tb = b.h;
  for (let i = 0; i < KEYS.length; i++) {
    const k0 = KEYS[i], k1 = KEYS[(i + 1) % KEYS.length];
    const h1 = i + 1 < KEYS.length ? k1.h : k1.h + 24;
    if (h >= k0.h && h < h1) { a = k0; b = k1; ta = k0.h; tb = h1; break; }
  }
  if (h < KEYS[0].h) { a = KEYS[KEYS.length - 1]; b = KEYS[0]; ta = a.h - 24; tb = b.h; }
  const t = smoothstep(0, 1, (h - ta) / (tb - ta));
  const out = {};
  for (const c of COLOR_KEYS) out[c] = a[c].clone().lerp(b[c], t);
  for (const n of NUM_KEYS) out[n] = lerp(a[n], b[n], t);
  return out;
}

export class Atmosphere {
  constructor() {
    this.state = {
      sunDir: new THREE.Vector3(), moonDir: new THREE.Vector3(),
      lightDir: new THREE.Vector3(), lightColor: new THREE.Color(), lightIntensity: 0,
      hemiSky: new THREE.Color(), hemiGround: new THREE.Color(), hemiIntensity: 1,
      zenith: new THREE.Color(), horizon: new THREE.Color(), ground: new THREE.Color(),
      sunColor: new THREE.Color(), sunVis: 1, moonVis: 0, stars: 0, aurora: 0,
      cloudCover: 0.5, cloudLit: new THREE.Color(), cloudDark: new THREE.Color(),
      fogColor: new THREE.Color(), fogSunColor: new THREE.Color(),
      fogDensity: 0.02, fogBase: 0.002, fogHeight: 4, fogFalloff: 0.07, mist: 0.5,
      exposure: 1, lift: new THREE.Vector3(), gamma: new THREE.Vector3(1, 1, 1), gain: new THREE.Vector3(1, 1, 1),
      saturation: 0.85, darkness: 0, wind: 1, isNight: false,
    };
  }

  // hour: 0..24, weather: key of WEATHER, season: spring..winter,
  // hearth: 0..6 offerings done, dawn: bool (ending reached)
  update(hour, weather = 'clear', season = 'spring', hearth = 0, dawn = false) {
    const s = this.state;
    const W = WEATHER[weather] || WEATHER.clear;
    const k = sample(hour);
    const maxElev = THREE.MathUtils.degToRad(SEASON_ELEV[season] || 32) * (dawn ? 1.15 : 1);

    // sun path: rises east (+x) 6:00, south (+z) at noon, sets west 20:00
    const dayFrac = (hour - 6) / 14;
    const az = Math.PI * dayFrac;
    const el = Math.sin(Math.PI * clamp(dayFrac, -0.3, 1.3)) * maxElev;
    s.sunDir.set(Math.cos(az) * Math.cos(el), Math.sin(el), Math.sin(az) * Math.cos(el)).normalize();
    const nightFrac = (((hour - 20) % 24) + 24) % 24 / 10;
    const maz = Math.PI * nightFrac + 0.4;
    const mel = Math.sin(Math.PI * clamp(nightFrac, -0.2, 1.2)) * THREE.MathUtils.degToRad(48);
    s.moonDir.set(Math.cos(maz) * Math.cos(mel), Math.sin(mel), Math.sin(maz) * Math.cos(mel) - 0.25).normalize();

    // weather greying of the sky
    const g = W.grey * (dawn ? 0.5 : 1);
    grey.copy(k.fog).multiplyScalar(0.9);
    s.zenith.copy(k.zen).lerp(grey, g * 0.7).multiplyScalar(lerp(1, W.dark, 0.6));
    s.horizon.copy(k.hor).lerp(grey, g).multiplyScalar(lerp(1, W.dark, 0.5));
    s.ground.copy(k.fog).multiplyScalar(0.35);
    s.sunColor.copy(k.sun);
    s.sunVis = clamp(1 - W.cloud * 0.7, 0.1, 1) * smoothstep(-0.08, 0.02, s.sunDir.y);
    s.cloudCover = W.cloud;
    s.cloudLit.copy(k.cl).multiplyScalar(W.dark);
    s.cloudDark.copy(k.cd).multiplyScalar(W.dark);

    const nightness = 1 - smoothstep(-0.12, 0.08, s.sunDir.y);
    s.stars = nightness * clamp(1.15 - W.cloud, 0, 1);
    s.moonVis = smoothstep(-0.05, 0.1, s.moonDir.y) * clamp(1.2 - W.cloud * 0.8, 0.15, 1) * nightness;
    s.aurora = season === 'winter' || dawn ? nightness * clamp(1.1 - W.cloud, 0, 1) * (season === 'winter' ? 1 : 0.5) : 0;

    // directional light: sun by day, moon by night (cross-fade at the horizon)
    const sunUp = smoothstep(-0.02, 0.1, s.sunDir.y);
    if (sunUp > 0.001) {
      s.lightDir.copy(s.sunDir);
      s.lightColor.copy(k.sun);
      s.lightIntensity = k.sunI * 1.5 * W.sun * sunUp * (dawn ? 1.25 : 1);
    } else {
      s.lightDir.copy(s.moonDir.y > 0.05 ? s.moonDir : tmpA.set(0.3, 0.8, 0.2));
      s.lightColor.set('#8fa6d6');
      s.lightIntensity = 0.6 * smoothstep(0.0, 0.2, s.moonDir.y) * clamp(1.1 - W.cloud * 0.6, 0.3, 1);
    }
    if (s.lightDir.y < 0.08) s.lightDir.y = 0.08;
    s.lightDir.normalize();

    s.hemiSky.copy(k.hemS).lerp(grey, g * 0.4);
    s.hemiGround.copy(k.hemG);
    s.hemiIntensity = k.hemI * 1.45 * lerp(1, W.dark, 0.5) * (weather === 'snow' ? 1.2 : 1);

    // fog
    s.fogColor.copy(k.fog).lerp(grey, g * 0.3).multiplyScalar(lerp(1, W.dark, 0.5) * 0.42);
    if (weather === 'snow') s.fogColor.lerp(tmpA.set(0.55, 0.6, 0.68), 0.35 * (1 - nightness * 0.8));
    s.fogSunColor.copy(k.sun).multiplyScalar(0.22 * s.sunVis * Math.min(1, k.sunI));
    const morningMist = smoothstep(5, 6.5, hour) * (1 - smoothstep(7.5, 10, hour));
    const clearing = (1 - hearth * 0.07) * (dawn ? 0.55 : 1);
    s.fogDensity = (0.011 + nightness * 0.008 + morningMist * 0.012) * W.fog * clearing;
    s.fogBase = (0.0014 + nightness * 0.0012) * W.fog * clearing;
    s.fogHeight = 3.5 + morningMist * 1.5;
    s.fogFalloff = 0.075;
    s.mist = (0.45 + morningMist * 0.45 + nightness * 0.25) * W.mist * clearing;

    // grading
    s.exposure = k.exp * 1.5 * (weather === 'storm' ? 1.1 : 1);
    const golden = smoothstep(17, 18.5, hour) * (1 - smoothstep(19.2, 20, hour)) + smoothstep(5.8, 6.6, hour) * (1 - smoothstep(7, 8.5, hour));
    s.lift.set(lerp(0.012, 0.004, nightness), lerp(0.014, 0.012, nightness), lerp(0.022, 0.04, nightness));
    s.gain.set(lerp(1.02, 0.86, nightness) + golden * 0.06, lerp(1.0, 0.94, nightness), lerp(0.96, 1.12, nightness) - golden * 0.05);
    s.gamma.set(1, 1, 1);
    s.saturation = lerp(0.9, 0.72, nightness) * (weather === 'fog' ? 0.85 : 1) * (dawn ? 1.08 : 1);
    s.darkness = nightness;
    s.isNight = nightness > 0.6;
    s.wind = W.wind;
    return s;
  }
}
