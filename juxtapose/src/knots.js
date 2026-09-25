// Knots and Clarity. The anxieties are not weather: each knot is a memory the
// dream has tangled up, and the anxieties mill around it, half asleep, until
// you come close. Free the memory (silence its guards, walk into it) and you
// get the memory back, a whim, and Clarity. Clarity is kept between nights:
// every anxiety silenced and every memory freed adds to it, and each rank of
// it makes the Figment a little more itself.
import * as THREE from 'three';
import { rnd } from './vfx.js';
import { RAPIER } from './physics.js';
import { G, ALL } from './config.js';
const RAPIER_CUBOID = (x, y, z) => RAPIER.ColliderDesc.cuboid(x, y, z);

// ---------------------------------------------------------------- Clarity
// the ranks of self-actualization: each one reached is a point to spend on the
// tree when you wake, so the Figment becomes the one you choose, not a fixed ladder
export const RANKS = [
  { at: 0, name: 'Sleeper' }, { at: 30, name: 'Stirring' }, { at: 80, name: 'Dreaming' }, { at: 150, name: 'Remembering' },
  { at: 240, name: 'Unafraid' }, { at: 360, name: 'Composed' }, { at: 500, name: 'Lucid' }, { at: 680, name: 'Whole' },
  { at: 900, name: 'Awake' }, { at: 1160, name: 'Self-possessed' }, { at: 1460, name: 'Self-actualized' },
  { at: 1800, name: 'Unafraid of the dark' }, { at: 2200, name: 'Her own' }, { at: 2650, name: 'Finished' },
];
export const CLARITY = { kill: 4, deathblow: 8, knot: 30, boss: 80, puzzle: 12 };

// four branches, each bought in order from the top
export const TREE = {
  blade: { label: 'The blade', nodes: [
    { id: 'b1', name: 'A Keen Edge', desc: 'Blade damage +15%.', apply: (m) => { m.melee *= 1.15; } },
    { id: 'b2', name: 'Weight Behind It', desc: 'Posture damage +20%.', apply: (m) => { m.posture *= 1.2; } },
    { id: 'b3', name: 'Composure', desc: 'Deflect window +25%.', apply: (m) => { m.deflectWindow *= 1.25; } },
    { id: 'b4', name: 'Mercy', desc: 'Deathblows mend 12 more.', apply: (m) => { m.gloryHeal += 12; } },
  ] },
  gun: { label: 'The gun', nodes: [
    { id: 'g1', name: 'Pockets', desc: 'Carry 1 more charge of each property.', apply: (m) => { m.maxCharges += 1; } },
    { id: 'g2', name: 'Quick Draw', desc: 'Fire 12% faster.', apply: (m) => { m.fireRate *= 1.12; } },
    { id: 'g3', name: 'Light Touch', desc: 'Taking gives one extra charge.', apply: (m) => { m.takeBonus += 1; } },
    { id: 'g4', name: 'Deeper Pockets', desc: 'Carry 2 more charges of each property.', apply: (m) => { m.maxCharges += 2; } },
  ] },
  mind: { label: 'The mind', nodes: [
    { id: 'm1', name: 'Steady', desc: 'Lucidity rises 10% slower.', apply: (m) => { m.lucidGain *= 0.9; } },
    { id: 'm2', name: 'Patience', desc: 'Focus mends 20% faster.', apply: (m) => { m.focusTime *= 0.8; } },
    { id: 'm3', name: 'A Wider Vessel', desc: 'Reverie holds one more focus.', apply: (m) => { m.reverieMax += 33; } },
    { id: 'm4', name: 'Stillness', desc: 'Lucidity rises 15% slower.', apply: (m) => { m.lucidGain *= 0.85; } },
  ] },
  legs: { label: 'The legs', nodes: [
    { id: 'l1', name: 'Sound Timber', desc: '+10 Figment.', apply: (m) => { m.hpBonus += 10; } },
    { id: 'l2', name: 'Light Feet', desc: 'Dash recovers 20% faster.', apply: (m) => { m.dashCD *= 0.8; } },
    { id: 'l3', name: 'Seasoned Oak', desc: '+15 Figment.', apply: (m) => { m.hpBonus += 15; } },
    { id: 'l4', name: 'Featherweight', desc: 'One more jump in the air.', apply: (m) => { m.extraJump += 1; } },
  ] },
};
const NODES = Object.values(TREE).flatMap((b) => b.nodes);

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
// points earned (one per rank past the first) and what is left to spend
export function treePoints(meta) {
  const earned = rankOf(meta.data.clarity || 0), spent = (meta.data.tree || []).length;
  return { earned, spent, free: Math.max(0, earned - spent) };
}
// can this node be bought: points free, not owned, the one above it owned
export function canBuy(meta, id) {
  const own = new Set(meta.data.tree || []);
  if (own.has(id) || treePoints(meta).free <= 0) return false;
  for (const b of Object.values(TREE)) {
    const i = b.nodes.findIndex((n) => n.id === id);
    if (i >= 0) return i === 0 || own.has(b.nodes[i - 1].id);
  }
  return false;
}
export function buy(meta, id) {
  if (!canBuy(meta, id)) return false;
  meta.data.tree = [...(meta.data.tree || []), id];
  meta.save();
  return true;
}
// what the Figment has become: every node bought, applied at the start of a night
export function applyRanks(mods, xp, meta) {
  for (const id of meta?.data.tree || []) NODES.find((n) => n.id === id)?.apply(mods);
}

// ---------------------------------------------------------------- the knots
// where each layer's memories are caught, and what they were
export const KNOTS = {
  desert: [
    // in the order the village gives them up; the chapel's is off the path, for the curious
    { at: 'B_Loggia', tier: 0, prop: 'Pomegranate', name: 'the Saturday pomegranate', nl: 'She always saved the last seed for him. He never once noticed. She never once stopped.', guards: 2, text: 'Every Saturday he bought one pomegranate at the market and ate it seed by seed on the walk home, to make it last.', src: 'the market loggia' },
    { at: 'B_Workshop', tier: 1, elite: ['hush'], prop: 'Clock', name: 'the unfinished clock', nl: 'Twenty to seven. The time the train left. Of course that is where it stopped.', guards: 3, text: 'The regulator in the shop window stopped at twenty to seven. She took it apart three times and never put it back together.', src: 'the workshop, 1962' },
    { at: 'B_Boathouse', side: -1, tier: 2, elite: ['mirror'], prop: 'Birdcage', name: 'the canary', nl: 'She told everyone Pip flew south. Pip was a canary. Pip did not fly south.', guards: 3, text: 'Pip flew out of the door Théo left open. She kept the cage, and for a month she left its little door open too, every evening, just in case.', src: 'the boathouse' },
    { at: 'B_Station', tier: 3, elite: ['wardrobe'], prop: 'BowlerHat', name: 'the hat on the rack', nl: 'She did open the parcel, you know. Years later. She put the hat on and stood in the hall for an hour.', guards: 4, text: 'He left his hat on the rack of the 6:40. The conductor posted it back to the shop. She never opened the parcel.', src: 'the station' },
    { at: 'B_Chapel', optional: true, tier: 3, elite: ['hush', 'mirror'], prop: 'Candle', name: 'the Sunday candle', nl: "I'm that candle, in case you were wondering. Well. I'm what's left of it.", guards: 5, text: 'She lit a candle for Théo every Sunday for a year. Then every other Sunday. Then once, at Christmas, and she felt guilty all night.', src: 'the chapel' },
  ],
  piazza: [
    // one to a quarter of the square, in the order the ink gives them up
    { a: -1.38, tier: 2, elite: ['mirror'], prop: 'Mirror', name: 'the window crowd', nl: "By the end she wasn't looking for him in the windows. She was looking for anyone who'd look back.", guards: 3, text: 'In the city every window held the same man in the same hat. She looked for Théo in all of them, and in all of them he looked back.', src: 'a letter, unsent' },
    { a: 0.25, tier: 3, elite: ['wardrobe'], prop: 'Drawers', name: 'the second drawer', nl: 'Eleven letters. She answered every one. She just never posted them.', guards: 4, text: 'His letters, second drawer: eleven of them. The last one only says, The rain here is made of people. Come anyway.', src: 'the chest of drawers' },
    { a: 1.85, tier: 4, elite: ['hush', 'mirror'], prop: 'Clock', name: 'Paris time', nl: "Nine years of winding a clock for a city she never saw. That isn't grief. That's devotion. They're cousins.", guards: 5, text: 'Paris ran an hour ahead of the village. She kept a second clock in the shop set to his time, and wound it every night for nine years.', src: 'the workshop wall' },
    { a: 3.4, tier: 5, elite: ['wardrobe', 'hush', 'mirror'], prop: 'Frame', name: 'the unfinished portrait', nl: "The apple isn't covering his face. It's covering that she couldn't remember it.", guards: 5, text: 'She began a portrait of him from memory. She could never get the face right. In the end she painted an apple over it and called it finished.', src: 'the easel' },
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
    this.lock = null;    // a puzzle that holds it (puzzles.js)
    this.guardAt = null; // where its guards stand, if not around it (a memory out on a rock)
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

  // the dream's resistance grows region by region: more of them, tougher, quicker to fight
  get tier() { return this.def.tier ?? 2; }
  spawnGuards(hp, variant) {
    const n = this.def.guards || 4, c = this.guardAt || this.pos;
    const elite = this.def.elite || [];
    hp *= 1 + 0.18 * this.tier;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + rnd(-0.3, 0.3), d = rnd(3, 6);
      const x = c.x + Math.cos(a) * d, z = c.z + Math.sin(a) * d;
      const e = this.game.spawnEnemy(new THREE.Vector3(x, this.level.groundY(x, z) + 0.1, z), { hp, variant: elite[i] || variant, guard: this, tier: this.tier });
      if (e) this.guards.push(e);
    }
  }

  // a memory that is not there yet (the train has not brought it)
  hide(on) {
    this.hidden = on;
    this.relic.visible = this.tangle.visible = !on;
    if (!on) this.game.vfx.propertyBurst(this.pos.clone().setY(this.pos.y + 1.35), 'floating', 1.2);
  }

  wake() {
    if (this.state !== 'dormant') return;
    this.state = 'awake';
    const game = this.game;
    // early on they come one at a time, so a first fight is a lesson, not a mob
    const gap = this.tier <= 0 ? 5 : this.tier === 1 ? 2.5 : 0;
    this.guards.forEach((e, i) => { if (gap && i) e.wakeAt = game.time + i * gap; else e.dormant = false; });
    // the more lucid the dream, the more come to defend it (not in the first regions)
    const extra = this.tier >= 2 ? Math.floor((game.lucidity?.k || 0) * 3) : 0;
    for (let i = 0; i < extra; i++) {
      const c = this.guardAt || this.pos, a = Math.random() * Math.PI * 2, x = c.x + Math.cos(a) * 7, z = c.z + Math.sin(a) * 7;
      const e = game.spawnEnemy(new THREE.Vector3(x, this.level.groundY(x, z) + 0.1, z), { hp: this.guards[0]?.maxHp || 60, variant: this.guards[0]?.variant, tier: this.tier });
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
    // the memory you're meant to find next burns bright; the others are only a smudge on the sky
    if (this.state !== 'taken') this.beam.material.uniforms.uA.value = THREE.MathUtils.smoothstep(cd, 5, 16) * (this.lit ? 1 : 0.15) * (this.hidden ? 0.35 : 1);
    this.relic.rotation.y += dt * 0.6;
    this.relic.position.y = 1.35 + Math.sin(this.t * 1.3) * 0.08;
    for (const c of this.tangle.children) c.rotation.y += c.userData.spin * dt;
    // the memory you're after wakes its guards as you approach; the others only if you walk right up to them,
    // so the next region's fight never spills into this one
    if (this.state === 'dormant' && pl && !pl.dead && pl.pos.distanceTo(this.guardAt || this.pos) < (this.lit ? this.wakeR : 7)) this.wake();
    if ((this.state === 'dormant' || this.state === 'awake') && this.guards.length && this.guards.every((e) => e.dead)) {
      // the anxieties are gone, but a puzzle can still hold it
      const held = this.lock && !this.lock.solved && (this.lock.blocks || this.lock.hides);
      if (!held) this.free();
      else if (!this.heldSaid) { this.heldSaid = true; game.ui.toast(`Its guards are gone, but ${this.def.name} is still caught: ${this.lock.hint}.`, 'warn'); }
    }
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

// A veil: a curtain of the dream's ink across a street. It holds you in the part
// of the village the dream is showing you, and unravels when a memory comes back.
const veilMat = () => new THREE.ShaderMaterial({
  uniforms: { uTime: { value: 0 }, uGone: { value: 0 } },
  vertexShader: 'varying vec2 vUv; varying vec3 vW; void main(){ vUv = uv; vW = (modelMatrix * vec4(position, 1.0)).xyz; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `uniform float uTime, uGone; varying vec2 vUv; varying vec3 vW;
    float h(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    float n(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y); }
    float fbm(vec2 p){ float s = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { s += a * n(p); p = p * 2.1 + 3.7; a *= 0.5; } return s; }
    void main(){
      vec2 p = vec2(vW.x + vW.z, vW.y) * 0.35;
      float f = fbm(p + vec2(0.0, -uTime * 0.12)) + 0.35 * fbm(p * 2.3 + vec2(uTime * 0.07, 0.0));
      if (f < uGone * 1.4) discard;
      float edge = smoothstep(uGone * 1.4 + 0.12, uGone * 1.4, f) * step(0.001, uGone);
      float top = smoothstep(1.0, 0.55, vUv.y), foot = smoothstep(0.0, 0.08, vUv.y);
      vec3 ink = mix(vec3(0.05, 0.03, 0.08), vec3(0.28, 0.15, 0.45), f * f);
      ink += vec3(1.0, 0.8, 0.45) * edge * 2.5;
      gl_FragColor = vec4(ink, (0.55 + 0.4 * f) * top * foot + edge);
    }`,
  transparent: true, depthWrite: false, side: THREE.DoubleSide,
});

export class Veil {
  constructor(level, a, b, h = 7) {
    this.level = level; this.game = level.game;
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    const y = Math.min(level.groundY(a.x, a.z), level.groundY(b.x, b.z), level.heightAt((a.x + b.x) / 2, (a.z + b.z) / 2)) - 0.6;
    this.center = new THREE.Vector3((a.x + b.x) / 2, y, (a.z + b.z) / 2);
    const rot = -Math.atan2(b.z - a.z, b.x - a.x);
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(len, h, 1, 1), veilMat());
    this.mesh.position.set(this.center.x, y + h / 2, this.center.z);
    this.mesh.rotation.y = rot;
    this.mesh.renderOrder = 4;
    this.mesh.userData.noAO = true;
    level.group.add(this.mesh);
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rot);
    this.body = this.game.physics.fixed({ x: this.center.x, y: y + h / 2, z: this.center.z }, q);
    this.game.physics.collider(RAPIER_CUBOID(len / 2, h / 2, 0.35), this.body, G.WALL, ALL);
    level.bodies.push(this.body);
    this.gone = 0; this.opening = false;
  }
  open() {
    if (this.opening) return;
    this.opening = true;
    this.game.physics.remove(this.body);
    this.game.audio.sfx('lore', { position: this.center });
  }
  update(dt, time) {
    const u = this.mesh.material.uniforms;
    u.uTime.value = time;
    if (this.opening && this.gone < 1) {
      this.gone = Math.min(1, this.gone + dt * 0.45);
      u.uGone.value = this.gone;
      if (Math.random() < dt * 30) {
        const s = Math.random() - 0.5, m = this.mesh;
        const p = new THREE.Vector3(s * m.geometry.parameters.width, (Math.random() - 0.5) * 6, 0).applyQuaternion(m.quaternion).add(m.position);
        this.game.vfx.add.spawn({ x: p.x, y: p.y, z: p.z, vy: 1.2, color: new THREE.Color('#ffcf8a').multiplyScalar(3), alpha: 1, alpha1: 0, size: 0.12, size1: 0.02, life: 1.2 });
      }
      if (this.gone >= 1) this.mesh.visible = false;
    }
  }
}
