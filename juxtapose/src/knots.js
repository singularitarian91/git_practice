// Knots and Clarity. The anxieties are not weather: each knot is a memory the
// dream has tangled up, and the anxieties mill around it, half asleep, until
// you come close. Free the memory (silence its guards, walk into it) and you
// get the memory back, a whim, and Clarity. Clarity is kept between nights:
// every anxiety silenced and every memory freed adds to it, and each rank of
// it makes the Figment a little more itself.
import * as THREE from 'three';
import { rnd } from './vfx.js';

// ---------------------------------------------------------------- Clarity
// the ranks of self-actualization; each perk is kept for good once reached
export const RANKS = [
  { at: 0, name: 'Sleeper', perk: '' },
  { at: 30, name: 'Stirring', perk: '+10 Figment', apply: (m) => { m.hpBonus += 10; } },
  { at: 80, name: 'Dreaming', perk: 'Carry 1 more charge of each property', apply: (m) => { m.maxCharges += 1; } },
  { at: 150, name: 'Remembering', perk: 'Focus mends 20% faster', apply: (m) => { m.focusTime *= 0.8; } },
  { at: 240, name: 'Unafraid', perk: 'Posture damage +15%', apply: (m) => { m.posture *= 1.15; } },
  { at: 360, name: 'Composed', perk: 'Deflect window +20%', apply: (m) => { m.deflectWindow *= 1.2; } },
  { at: 500, name: 'Lucid', perk: 'Lucidity rises 10% slower', apply: (m) => { m.lucidGain *= 0.9; } },
  { at: 680, name: 'Whole', perk: '+15 Figment', apply: (m) => { m.hpBonus += 15; } },
  { at: 900, name: 'Awake', perk: 'Blade damage +15%', apply: (m) => { m.melee *= 1.15; } },
  { at: 1160, name: 'Self-possessed', perk: 'Dash recovers 20% faster', apply: (m) => { m.dashCD *= 0.8; } },
  { at: 1460, name: 'Self-actualized', perk: 'Deathblows mend 10 more', apply: (m) => { m.gloryHeal += 10; } },
];
export const CLARITY = { kill: 4, deathblow: 8, knot: 30, boss: 80 };

export function rankOf(xp) {
  let r = 0;
  for (let i = 0; i < RANKS.length; i++) if (xp >= RANKS[i].at) r = i;
  return r;
}
// 0..1 progress toward the next rank
export function rankProgress(xp) {
  const r = rankOf(xp), next = RANKS[r + 1];
  return next ? (xp - RANKS[r].at) / (next.at - RANKS[r].at) : 1;
}
export function applyRanks(mods, xp) {
  const r = rankOf(xp);
  for (let i = 1; i <= r; i++) RANKS[i].apply(mods);
}

// ---------------------------------------------------------------- the knots
// where each layer's memories are caught, and what they were
export const KNOTS = {
  desert: [
    { at: 'B_Workshop', prop: 'Clock', name: 'the unfinished clock', guards: 4, text: 'The regulator in the shop window stopped at twenty to seven. She took it apart three times and never put it back together.', src: 'the workshop, 1962' },
    { at: 'B_Loggia', prop: 'Pomegranate', name: 'the Saturday pomegranate', guards: 3, text: 'Every Saturday he bought one pomegranate at the market and ate it seed by seed on the walk home, to make it last.', src: 'the market loggia' },
    { at: 'B_Chapel', prop: 'Candle', name: 'the Sunday candle', guards: 5, text: 'She lit a candle for Théo every Sunday for a year. Then every other Sunday. Then once, at Christmas, and she felt guilty all night.', src: 'the chapel' },
    { at: 'B_Station', prop: 'BowlerHat', name: 'the hat on the rack', guards: 4, text: 'He left his hat on the rack of the 6:40. The conductor posted it back to the shop. She never opened the parcel.', src: 'the station' },
    { at: 'B_Boathouse', side: -1, prop: 'Birdcage', name: 'the finch', guards: 4, text: 'They kept a finch in the boathouse. He let it go the summer he left. It came back to the empty cage every evening for a month.', src: 'the boathouse' },
  ],
  piazza: [
    { a: 0.25, prop: 'Mirror', name: 'the window crowd', guards: 4, text: 'In the city every window held the same man in the same hat. She looked for Théo in all of them, and in all of them he looked back.', src: 'a letter, unsent' },
    { a: 1.85, prop: 'Drawers', name: 'the second drawer', guards: 4, text: 'His letters, second drawer: eleven of them. The last one only says, The rain here is made of people. Come anyway.', src: 'the chest of drawers' },
    { a: 3.4, prop: 'Clock', name: 'Paris time', guards: 5, text: 'Paris ran an hour ahead of the village. She kept a second clock in the shop set to his time, and wound it every night for nine years.', src: 'the workshop wall' },
    { a: 4.9, prop: 'Frame', name: 'the unfinished portrait', guards: 5, text: 'She began a portrait of him from memory. She could never get the face right. In the end she painted an apple over it and called it finished.', src: 'the easel' },
  ],
};
export const KNOTS_NEEDED = 3;

const beamMat = (color) => new THREE.ShaderMaterial({
  uniforms: { uColor: { value: new THREE.Color(color) }, uTime: { value: 0 }, uA: { value: 1 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `uniform vec3 uColor; uniform float uTime, uA; varying vec2 vUv;
    void main(){ float fall = pow(1.0 - vUv.y, 1.6); float edge = sin(vUv.x * 6.2832) * 0.5 + 0.5;
      float drift = 0.75 + 0.25 * sin(vUv.y * 22.0 - uTime * 1.7 + vUv.x * 12.0);
      gl_FragColor = vec4(uColor, fall * drift * (0.35 + 0.65 * edge) * 0.32 * uA); }`,
  transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
});

export class Knot {
  constructor(level, def, pos) {
    this.level = level; this.game = level.game; this.def = def;
    this.pos = pos.clone();
    this.state = 'dormant'; // dormant -> awake -> freed -> taken
    this.guards = [];
    this.wakeR = 15;
    this.t = Math.random() * 10;
    const g = this.group = new THREE.Group();
    g.position.copy(pos);
    // the memory itself, floating, caught in ink
    const A = this.game.assets;
    this.relic = A.has(def.prop) ? A.clone(def.prop) : new THREE.Mesh(new THREE.IcosahedronGeometry(0.3, 1), new THREE.MeshStandardMaterial({ color: '#ffd978' }));
    const bb = new THREE.Box3().setFromObject(this.relic), size = bb.getSize(new THREE.Vector3());
    const k = 0.9 / Math.max(0.3, size.x, size.y, size.z);
    this.relic.scale.setScalar(Math.min(1.4, k));
    this.relic.position.y = 1.35;
    this.relic.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.material = o.material.clone(); o.material.emissive = new THREE.Color('#2a1a40'); o.material.emissiveIntensity = 0.6; } });
    g.add(this.relic);
    // the tangle: dark tendrils looping around it
    const ink = new THREE.MeshStandardMaterial({ color: '#150f1c', roughness: 0.35, metalness: 0.2, emissive: new THREE.Color('#3a1f5c'), emissiveIntensity: 0.5 });
    this.tangle = new THREE.Group();
    for (let i = 0; i < 6; i++) {
      const pts = [], r = 0.55 + i * 0.05, tilt = rnd(-0.9, 0.9), ph = rnd(0, 6.28);
      for (let j = 0; j <= 24; j++) {
        const a = (j / 24) * Math.PI * 2 + ph;
        pts.push(new THREE.Vector3(Math.cos(a) * r, Math.sin(a) * r * tilt + Math.sin(a * 3 + ph) * 0.12, Math.sin(a) * r));
      }
      const tube = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, true), 48, 0.022 + Math.random() * 0.02, 5, true), ink);
      tube.rotation.set(rnd(0, 3), rnd(0, 3), rnd(0, 3));
      tube.userData.spin = rnd(-0.8, 0.8);
      this.tangle.add(tube);
    }
    this.tangle.position.y = 1.35;
    g.add(this.tangle);
    // a column of dusk you can see from anywhere in the layer
    this.beam = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 1.6, 46, 20, 1, true), beamMat('#8a5cff'));
    this.beam.position.y = 23;
    this.beam.renderOrder = 5;
    this.beam.userData.noAO = true;
    g.add(this.beam);
    level.group.add(g);
  }

  spawnGuards(hp, variant) {
    const n = this.def.guards || 4;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + rnd(-0.3, 0.3), d = rnd(3, 6);
      const x = this.pos.x + Math.cos(a) * d, z = this.pos.z + Math.sin(a) * d;
      const e = this.game.spawnEnemy(new THREE.Vector3(x, this.level.groundY(x, z) + 0.1, z), { hp, variant, guard: this });
      if (e) this.guards.push(e);
    }
  }

  wake() {
    if (this.state !== 'dormant') return;
    this.state = 'awake';
    for (const e of this.guards) e.dormant = false;
    const game = this.game;
    // the more lucid the dream, the more come to defend it
    const extra = Math.floor((game.lucidity?.k || 0) * 3);
    for (let i = 0; i < extra; i++) {
      const a = Math.random() * Math.PI * 2, x = this.pos.x + Math.cos(a) * 7, z = this.pos.z + Math.sin(a) * 7;
      const e = game.spawnEnemy(new THREE.Vector3(x, this.level.groundY(x, z) + 0.1, z), { hp: this.guards[0]?.maxHp || 60, variant: this.guards[0]?.variant });
      if (e) { this.guards.push(e); game.vfx.dust(e.obj.position, 1.2); }
    }
    game.audio.sfx('perilous', { position: this.pos });
    game.vfx.ring(this.pos.clone().setY(this.pos.y + 0.1), 0.5, 9, 0.9, 0x8a5cff, 0.9);
    game.ui.toast(`The anxieties around ${this.def.name} wake.`, 'warn');
  }

  update(dt) {
    const game = this.game, pl = game.player;
    this.t += dt;
    this.beam.material.uniforms.uTime.value = this.t;
    // a landmark from afar, gone up close (the camera inside it would wash the screen)
    const cd = Math.hypot(game.render.camera.position.x - this.pos.x, game.render.camera.position.z - this.pos.z);
    if (this.state !== 'taken') this.beam.material.uniforms.uA.value = THREE.MathUtils.smoothstep(cd, 5, 16);
    this.relic.rotation.y += dt * 0.6;
    this.relic.position.y = 1.35 + Math.sin(this.t * 1.3) * 0.08;
    for (const c of this.tangle.children) c.rotation.y += c.userData.spin * dt;
    if (this.state === 'dormant' && pl && !pl.dead && pl.pos.distanceTo(this.pos) < this.wakeR) this.wake();
    if ((this.state === 'dormant' || this.state === 'awake') && this.guards.length && this.guards.every((e) => e.dead)) this.free();
    if (this.state === 'freed') {
      // the tangle unravels, the column turns gold, the memory waits to be taken
      const s = Math.max(0, this.tangle.scale.x - dt * 1.2);
      this.tangle.scale.setScalar(s);
      if (s === 0) this.tangle.visible = false;
      if (pl && !pl.dead && pl.pos.distanceTo(this.pos) < 2.2) this.take();
    }
    if (this.state === 'taken') {
      this.beam.material.uniforms.uA.value = Math.max(0, this.beam.material.uniforms.uA.value - dt * 0.5);
      this.relic.scale.multiplyScalar(Math.max(0, 1 - dt * 2.5));
      if (this.beam.material.uniforms.uA.value <= 0) this.group.visible = false;
    }
  }

  free() {
    this.state = 'freed';
    const game = this.game;
    this.beam.material.uniforms.uColor.value.set('#ffd27a');
    this.relic.traverse((o) => { if (o.isMesh) { o.material.emissive.set('#ffcf7a'); o.material.emissiveIntensity = 0.35; } });
    game.vfx.propertyBurst(this.pos.clone().setY(this.pos.y + 1.35), 'floating', 1.2);
    game.audio.sfx('pickup', { position: this.pos });
    game.ui.toast(`${this.def.name[0].toUpperCase() + this.def.name.slice(1)} is loose. Go and take it back.`, 'good');
  }

  take() {
    this.state = 'taken';
    const game = this.game;
    game.vfx.propertyBurst(this.pos.clone().setY(this.pos.y + 1.35), 'floating', 1.6);
    game.audio.stinger('memory');
    game.ui.loreCard({ text: this.def.text, src: this.def.src });
    game.gainClarity(CLARITY.knot, this.pos);
    game.onKnotFreed(this);
  }
}
