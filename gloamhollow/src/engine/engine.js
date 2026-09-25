// Owns the renderer, scene, camera and the world's visual layers
// (terrain, water, sky, atmosphere, lighting, post-processing).
import * as THREE from 'three';
import { Terrain } from './terrain.js';
import { Water } from './water.js';
import { Sky } from './sky.js';
import { Atmosphere } from './atmosphere.js';
import { Lighting } from './lighting.js';
import { PostFX } from './post.js';
import { globalUniforms } from './materials.js';
import { LOC } from '../game/worldmap.js';

export const QUALITY = {
  low: { pixelRatio: 0.75, shadow: 1024, msaa: 0, bloom: false, grass: 0.35, grassR: 35, pool: 4 },
  medium: { pixelRatio: 1.0, shadow: 2048, msaa: 4, bloom: true, grass: 0.7, grassR: 52, pool: 6 },
  high: { pixelRatio: 1.5, shadow: 4096, msaa: 4, bloom: true, grass: 1.0, grassR: 68, pool: 8 },
};

export class Engine {
  constructor(container, quality = 'medium') {
    this.container = container;
    this.qualityName = quality;
    this.q = QUALITY[quality] || QUALITY.medium;

    const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.q.pixelRatio));
    renderer.setSize(container.clientWidth || window.innerWidth, container.clientHeight || window.innerHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.NoToneMapping;
    renderer.autoClear = true;
    container.appendChild(renderer.domElement);
    this.renderer = renderer;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 2000);
    this.camera.position.set(0, 30, 40);
    this.camera.lookAt(0, 0, 0);

    this.terrain = new Terrain();
    this.scene.add(this.terrain.group);
    this.water = new Water(this.terrain, LOC.lake);
    this.scene.add(this.water.mesh);
    this.sky = new Sky();
    this.scene.add(this.sky.group);
    this.atmosphere = new Atmosphere();
    this.lighting = new Lighting(this.scene, { poolSize: this.q.pool, shadowSize: this.q.shadow });
    this.post = new PostFX(renderer, {
      heightTexture: this.terrain.heightTexture,
      heightSize: this.terrain.size,
      samples: this.q.msaa,
    });
    this.post.bloomEnabled = this.q.bloom;

    this.time = 0;
    this.focus = new THREE.Vector3();
    this.env = { hour: 12, weather: 'clear', season: 'spring', hearth: 0, dawn: false, clearRadius: 14 };
    this.flash = 0;
    this.tint = new THREE.Vector3(1, 1, 1);
    this.fade = 0;

    window.addEventListener('resize', () => this.resize());
  }

  resize() {
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    this.post.setSize(size.x, size.y);
  }

  setQuality(name) {
    this.qualityName = name;
    this.q = QUALITY[name] || QUALITY.medium;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.q.pixelRatio));
    this.post.bloomEnabled = this.q.bloom;
    this.resize();
  }

  // Advance visual state and draw one frame.
  frame(dt) {
    this.time += dt;
    const env = this.env;
    const atmo = this.atmosphere.update(env.hour, env.weather, env.season, env.hearth, env.dawn);
    globalUniforms.uTime.value = this.time;
    globalUniforms.uWind.value = atmo.wind;
    // occlusion fade centred on the player (focus + 1 m)
    if (this.fadeTarget) {
      this.camera.updateMatrixWorld();
      const v = this._fv || (this._fv = new THREE.Vector3());
      v.copy(this.fadeTarget);
      v.y += 1.0;
      const depth = v.clone().applyMatrix4(this.camera.matrixWorldInverse).z;
      v.project(this.camera);
      const size = this.renderer.getDrawingBufferSize(this._dbs || (this._dbs = new THREE.Vector2()));
      globalUniforms.uFade.value.set((v.x * 0.5 + 0.5) * size.x, (v.y * 0.5 + 0.5) * size.y, -depth, size.y * 0.2);
      globalUniforms.uFadeY.value = this.fadeTarget.y + 1.1;
    } else globalUniforms.uFade.value.w = 0;

    // sky
    const su = this.sky.uniforms;
    su.uZenith.value.copy(atmo.zenith);
    su.uHorizon.value.copy(atmo.horizon);
    su.uGround.value.copy(atmo.ground);
    su.uSunDir.value.copy(atmo.sunDir);
    su.uSunColor.value.copy(atmo.sunColor);
    su.uSunVis.value = atmo.sunVis;
    su.uMoonDir.value.copy(atmo.moonDir);
    su.uMoonVis.value = atmo.moonVis;
    su.uStars.value = atmo.stars;
    su.uCloudCover.value = atmo.cloudCover;
    su.uCloudLit.value.copy(atmo.cloudLit);
    su.uCloudDark.value.copy(atmo.cloudDark);
    su.uAurora.value = atmo.aurora;
    this.sky.update(this.camera, this.time);

    const halos = this.lighting.update(dt, this.focus, this.camera, atmo);
    this.water.update(this.time, this.camera, atmo, env.weather, halos);

    // post uniforms
    const fu = this.post.fogUniforms;
    fu.uFogColor.value.copy(atmo.fogColor);
    fu.uFogSunColor.value.copy(atmo.fogSunColor);
    fu.uSunDir.value.copy(atmo.sunDir);
    fu.uFogDensity.value = atmo.fogDensity;
    fu.uFogBase.value = atmo.fogBase;
    fu.uFogHeight.value = atmo.fogHeight;
    fu.uFogFalloff.value = atmo.fogFalloff;
    fu.uMist.value = atmo.mist;
    fu.uClearRadius.value = env.clearRadius;
    fu.uHaloStrength.value = 0.035 + atmo.darkness * 0.035;
    this.post.setHalos(halos);
    const gu = this.post.gradeUniforms;
    gu.uExposure.value = atmo.exposure;
    gu.uLift.value.copy(atmo.lift);
    gu.uGain.value.copy(atmo.gain);
    gu.uGamma.value.copy(atmo.gamma);
    gu.uSaturation.value = atmo.saturation;
    this.flash = Math.max(0, this.flash - dt * 3);
    gu.uFlash.value = this.flash;
    gu.uTint.value.copy(this.tint);
    gu.uFade.value = this.fade;

    this.post.render(this.scene, this.camera, this.time);
    return atmo;
  }
}
