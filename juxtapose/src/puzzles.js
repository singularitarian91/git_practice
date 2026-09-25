// Puzzles: the dream does not only guard its memories with anxieties. Some are
// buried, stranded, or never allowed to arrive, and the gun is the way in: a
// drift that softens away, a boat that forgets it is heavy, a train that finally
// feels its weight, a bell that goes light enough to ring.
//
// A Thing is an entity the gun can give to and take from, but it stays where
// the puzzle put it (fixed or kinematic): properties change what it does, not
// where physics throws it. A Lock ties a puzzle to a knot: until it is solved
// the memory stays caught (or, for some, hidden), and the objective says why.
import * as THREE from 'three';
import { Entity } from './entities.js';
import { RAPIER, collectPoints } from './physics.js';
import { G, ALL } from './config.js';
import { rnd } from './vfx.js';

const UP = new THREE.Vector3(0, 1, 0);
const ease = (k) => k * k * (3 - 2 * k);

// ---------------------------------------------------------------- Thing
export class Thing extends Entity {
  constructor(game, { name, displayName, obj, kinematic = false, shape, group = G.WALL, filter = ALL, refuse = [], hp = Infinity, flammable = false }) {
    game.level.group.add(obj);
    obj.updateMatrixWorld(true);
    super(game, { kind: 'prop', name, obj, hp, anchored: true, group, filter, persistent: true, flammable });
    this.displayName = displayName || name;
    this.puzzle = true;
    this.canSleepFreeze = false;
    this.noCopy = true;
    this.refused = new Set(refuse);
    const p = obj.position, q = obj.quaternion;
    const body = kinematic ? game.physics.kinematic(p) : game.physics.fixed(p, q);
    if (kinematic) body.setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }, true);
    const desc = shape || RAPIER.ColliderDesc.convexHull(collectPoints(obj, 300)) || RAPIER.ColliderDesc.ball(0.6);
    const col = game.physics.collider(desc, body, group, filter, { friction: 0.9 });
    this.attachBody(body, [col]);
    this.kinematic = kinematic;
    this.hooks = [];
    game.entities.add(this);
  }
  // a thing the dream put somewhere stays there
  unanchor() {}
  refuses(p) { return this.refused.has(p); }
  addProp(p, o = {}) {
    if (this.refused.has(p)) return;
    const had = this.props.has(p);
    super.addProp(p, o);
    if (!had && this.props.has(p)) for (const h of this.hooks) h(p, true);
  }
  removeProp(p, o = {}) {
    const had = this.props.has(p);
    super.removeProp(p, o);
    if (had) for (const h of this.hooks) h(p, false);
  }
  on(fn) { this.hooks.push(fn); return this; }
  // move a kinematic thing along with its mesh
  sync() {
    if (!this.kinematic || !this.body || this.dead) return;
    const o = this.obj;
    this.body.setNextKinematicTranslation({ x: o.position.x, y: o.position.y, z: o.position.z });
    this.body.setNextKinematicRotation({ x: o.quaternion.x, y: o.quaternion.y, z: o.quaternion.z, w: o.quaternion.w });
  }
  die(opts) { super.die(opts); this.onDie?.(opts); }
}

// ---------------------------------------------------------------- Lock
// blocks: the memory cannot come loose until it is solved
// hides: the memory is not there at all until it is solved
export class Lock {
  constructor(level, knot, { hint, line, caption, focus, blocks = true, hides = false }) {
    this.level = level; this.game = level.game; this.knot = knot;
    this.hint = hint; this.line = line; this.caption = caption;
    this.focus = focus; // where the camera looks when it gives way
    this.blocks = blocks; this.hides = hides;
    this.solved = false;
    this.told = false;
    knot.lock = this;
    if (hides) knot.hide(true);
  }
  solve() {
    if (this.solved) return;
    this.solved = true;
    const game = this.game, knot = this.knot;
    game.audio.sfx('solve', { position: this.focus });
    game.stats.puzzles = (game.stats.puzzles || 0) + 1;
    game.lucidity.gain(4, 'a dream logic');
    game.gainClarity?.(12, this.focus);
    if (this.hides) knot.hide(false);
    game.narrator?.say('puzzleSolved');
    const p = game.player;
    if (!p || game.state !== 'playing' || game.noCutscenes) { if (this.caption) game.ui.toast(this.caption, 'good'); return; }
    const f = this.focus.clone();
    const dir = p.pos.clone().sub(f).setY(0);
    if (dir.lengthSq() < 1) dir.set(0, 0, 1);
    dir.normalize();
    const cam = f.clone().addScaledVector(dir, 9).add(new THREE.Vector3(0, 4, 0));
    game.playCutscene([
      { dur: 2.8, pos: [cam, f.clone().addScaledVector(dir, 6.5).add(new THREE.Vector3(0, 2.6, 0))], look: f, fov: 48, caption: this.caption },
    ]);
  }
  // near the memory for the first time: the Night-Light says what it sees
  update() {
    if (this.solved || this.told) return;
    const p = this.game.player;
    if (p && !p.dead && this.level.current === this.knot && p.pos.distanceTo(this.knot.pos) < 26) {
      this.told = true;
      if (this.line) this.game.narrator?.say(this.line);
    }
  }
}

// ---------------------------------------------------------------- materials
function sandMaterial(level) {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.96, metalness: 0 });
  const nm = level.sandMat?.normalMap;
  if (nm) { m.normalMap = nm; m.normalScale = new THREE.Vector2(0.6, 0.6); }
  return m;
}
const bronze = () => new THREE.MeshStandardMaterial({ color: '#8a6433', metalness: 0.92, roughness: 0.38, name: 'Bronze' });

// ---------------------------------------------------------------- the drift
// The workshop's memory is under a drift the wind piled against its door. Melting
// softens the sand until it slumps away (burning hurries it).
export function drift(level, knot) {
  const game = level.game, c = knot.pos;
  const geo = new THREE.SphereGeometry(2.3, 56, 22, 0, Math.PI * 2, 0, Math.PI / 2);
  const p = geo.attributes.position, col = new Float32Array(p.count * 3), tmp = new THREE.Color();
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const a = Math.atan2(z, x);
    // wind-combed: long and low to the lee, a crest where it banked up
    const r = 1 + 0.35 * Math.cos(a - 0.8) + 0.08 * Math.sin(a * 5) + 0.05 * Math.sin(a * 11 + y * 3);
    const h = 1.2 + 0.25 * Math.sin(a * 3 + 1.2);
    p.setXYZ(i, x * r, y * h - 0.1, z * r * 0.85);
    level.sandColor(c.x + x * r, c.z + z * r, tmp);
    col[i * 3] = tmp.r; col[i * 3 + 1] = tmp.g; col[i * 3 + 2] = tmp.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, sandMaterial(level));
  mesh.castShadow = true; mesh.receiveShadow = true;
  mesh.position.copy(c);
  const t = new Thing(game, { name: 'Drift', displayName: 'The drift', obj: mesh, refuse: ['multiplying', 'framed'] });
  t.dustColor = '#e8c79c'; t.meltColor = '#d9a86a';
  const lock = new Lock(level, knot, {
    hint: 'buried under a drift · soften it', line: 'puzzleDrift', focus: c.clone().setY(c.y + 1.2),
    caption: 'The drift sighs, and slumps, and there it is.',
  });
  t.onDie = () => { game.vfx.dust(c.clone().setY(c.y + 0.5), 3, '#e8c79c'); lock.solve(); };
  // it takes a little while, so show that it is working
  t.on((prop, on) => { if (on && (prop === 'melting' || prop === 'burning')) game.ui.toast('The sand begins to give.', 'good'); });
  // a clock nearby, in case you arrive with no melting left
  const s = c.clone().add(new THREE.Vector3(4.5, 0, 3));
  level.put('Clock', s.x, s.z, { rotY: rnd(0, 6) });
  return lock;
}

// ---------------------------------------------------------------- the boat
// The canary's memory is caught on a rock out past where you can wade. A boat
// lies beached on the shore; give it floating and it lifts off the sand and
// drifts out to moor between the beach and the rock: a stepping stone.
export function boat(level, knot, { beach, mooring }) {
  const game = level.game, A = game.assets;
  let obj;
  if (A.has('T_Boat')) {
    obj = A.clone('T_Boat');
    obj.traverse((m) => { if (m.isMesh && /_COL/.test(m.name)) m.visible = false; });
  } else {
    obj = new THREE.Group();
    const hull = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.5, 4.2, 12, 1, false, 0, Math.PI).rotateZ(Math.PI / 2).rotateY(Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#7a5634', roughness: 0.8 }));
    hull.position.y = 0.6; obj.add(hull);
  }
  const box = new THREE.Box3();
  obj.traverse((m) => { if (m.isMesh && m.visible) { m.geometry.computeBoundingBox(); box.union(m.geometry.boundingBox.clone().applyMatrix4(m.matrixWorld)); } });
  const size = box.getSize(new THREE.Vector3()), mid = box.getCenter(new THREE.Vector3());
  const ground = level.heightAt(beach.x, beach.z);
  obj.position.set(beach.x, ground - 0.35, beach.z);
  obj.rotation.set(0.08, beach.rotY || 0, -0.12); // listing on the sand
  const shape = RAPIER.ColliderDesc.cuboid(size.x / 2, size.y / 2, size.z / 2).setTranslation(mid.x, mid.y, mid.z);
  const t = new Thing(game, { name: 'Boat', displayName: 'The boat', obj, kinematic: true, shape, refuse: ['multiplying', 'framed'] });
  t.dustColor = '#b9895a';
  const top = size.y + box.min.y;
  const from = obj.position.clone(), fromQ = obj.quaternion.clone();
  const toQ = new THREE.Quaternion().setFromAxisAngle(UP, mooring.rotY || 0);
  const to = new THREE.Vector3(mooring.x, level.sea.y + 0.5 - top * 0.55, mooring.z);
  const lock = new Lock(level, knot, {
    hint: 'out past where you can wade · a boat lies on the beach', line: 'puzzleBoat', blocks: false,
    focus: to.clone().setY(to.y + 1), caption: 'The boat forgets it was ever heavy, and goes out to wait for you.',
  });
  let state = 'beached', k = 0;
  t.on((prop, on) => {
    if (on && prop === 'floating' && state === 'beached') { state = 'rising'; k = 0; game.audio.sfx('float', { position: obj.position }); game.vfx.dust(from, 2.2, '#e8c79c'); }
    if (on && prop === 'heavy' && state === 'beached') game.ui.toast('It sinks a little further into the sand.');
  });
  t.tick = (dt, time) => {
    if (state === 'rising') {
      k = Math.min(1, k + dt / 1.6);
      obj.position.copy(from).setY(from.y + ease(k) * 1.4);
      obj.quaternion.copy(fromQ).slerp(toQ, ease(k) * 0.5);
      if (Math.random() < dt * 30) game.vfx.dust(obj.position.clone().setY(from.y + 0.2), 0.5, '#e8c79c');
      if (k >= 1) { state = 'sailing'; k = 0; lock.solve(); }
    } else if (state === 'sailing') {
      k = Math.min(1, k + dt / 5);
      const lift = from.clone().setY(from.y + 1.4);
      obj.position.copy(lift).lerp(to, ease(k));
      obj.position.y += Math.sin(k * Math.PI) * 0.8;
      obj.quaternion.copy(fromQ).slerp(toQ, 0.5 + ease(k) * 0.5);
      if (k >= 1) state = 'moored';
    } else if (state === 'moored') {
      obj.position.set(to.x, to.y + Math.sin(time * 1.1) * 0.06, to.z);
      obj.quaternion.copy(toQ).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.sin(time * 0.8) * 0.03));
      if (Math.random() < dt * 2) game.vfx.add.spawn({ x: to.x + rnd(-1.5, 1.5), y: level.sea.y + 0.05, z: to.z + rnd(-2, 2), vy: 0.1, color: new THREE.Color('#ffffff'), alpha: 0.5, alpha1: 0, size: 0.2, size1: 0.6, life: 1.2 });
    }
    t.sync();
  };
  lock.tick = t.tick;
  // floating is right there, in the clouds over the beach
  level.put('Cloud', beach.x - 3, beach.z - 5, { y: ground + 3.2 });
  return lock;
}

// ---------------------------------------------------------------- the train
// The 6:40 runs through the village and never stops. Make it heavy and it feels
// every metre of track: it brakes, screaming, and stands at the platform, and
// what he left on the rack comes back.
export function train(level, knot, { stopZ }) {
  const game = level.game, obj = level.train;
  if (!obj) return null;
  obj.updateMatrixWorld(true);
  const box = new THREE.Box3();
  const inv = new THREE.Matrix4().copy(obj.matrixWorld).invert();
  obj.traverse((m) => { if (m.isMesh) { m.geometry.computeBoundingBox(); box.union(m.geometry.boundingBox.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld))); } });
  const size = box.getSize(new THREE.Vector3()).multiplyScalar(obj.scale.x), mid = box.getCenter(new THREE.Vector3()).multiplyScalar(obj.scale.x);
  // it passes through people like a memory: the gun can reach it, bodies cannot
  const shape = RAPIER.ColliderDesc.cuboid(size.x / 2, size.y / 2, size.z / 2).setTranslation(mid.x, mid.y, mid.z);
  level.group.remove(obj);
  const t = new Thing(game, { name: 'Train', displayName: 'The 6:40', obj, kinematic: true, shape, group: G.PROP, filter: G.WORLD, refuse: ['multiplying', 'framed', 'melting', 'hollow', 'bursting'] });
  t.dustColor = '#6d665e';
  level.trainThing = t;
  const lock = new Lock(level, knot, {
    hint: 'the 6:40 never stops · weigh it down', line: 'puzzleTrain', hides: true,
    focus: new THREE.Vector3(level.trainX, level.heightAt(level.trainX, stopZ) + 1.5, stopZ), caption: 'For once, the 6:40 stops. Someone has left a hat on the rack.',
  });
  // the train's centre, where its length is measured from
  const centre = mid.z;
  let v = 9, braking = false;
  t.on((prop, on) => {
    if (prop === 'floating' && on) game.ui.toast('It lifts off the rails a little, and carries on regardless.');
    if (prop === 'sleeping' && on) game.ui.toast('It runs on asleep. Trains are good at that.');
  });
  level.trainMove = (dt) => {
    const z = obj.position.z + centre, gap = stopZ - z;
    if (!lock.solved && t.has('heavy') && gap > 0 && gap < 42) {
      if (!braking) { braking = true; game.audio.sfx('brake', { position: obj.position }); }
      v = Math.min(9, Math.sqrt(Math.max(0, 2 * 1.05 * (gap - 0.4))));
      if (Math.random() < dt * 60) {
        const s = Math.random() < 0.5 ? -0.75 : 0.75;
        game.vfx.sparks.spawn({ x: level.trainX + s, y: obj.position.y + 0.3, z: obj.position.z + rnd(-size.z / 2, size.z / 2) * 0.8 + centre, vx: s * 3, vy: rnd(1, 4), vz: -rnd(2, 6), color: new THREE.Color('#ffb347').multiplyScalar(5), alpha: 1, alpha1: 0, size: 0.06, life: 0.4, stretch: 0.04, drag: 2 });
      }
      if (v < 0.05) {
        v = 0;
        lock.solve();
        game.vfx.trail(new THREE.Vector3(level.trainX, obj.position.y + 2, z), '#ffd27a', 0.3, 1);
      }
    } else if (lock.solved) v = 0;
    else { braking = false; v = 9; }
    obj.position.z += dt * v;
    if (obj.position.z > 150) obj.position.z = -150;
    obj.position.y = level.heightAt(level.trainX, Math.max(-80, Math.min(90, obj.position.z))) + 0.1;
    obj.visible = obj.position.z > -78;
    t.sync();
  };
  // an anvil on the platform, for anyone who came without heavy
  const ax = level.trainX - 3.2;
  level.put('Anvil', ax, stopZ + 9, { y: level.groundY(ax, stopZ + 9) });
  return lock;
}

// ---------------------------------------------------------------- the bell
// A bell under an arch before the chapel, far too heavy to swing. Give it
// floating and it lifts in its yoke and rings, and the chapel lets go of its memory.
function bellGeometry() {
  const prof = [[0, 1.15], [0.12, 1.15], [0.2, 1.12], [0.3, 1.02], [0.36, 0.86], [0.4, 0.6], [0.46, 0.38], [0.56, 0.18], [0.66, 0.06], [0.7, 0], [0.64, 0.02], [0.52, 0.12], [0.42, 0.3], [0.34, 0.55], [0.3, 0.84], [0.22, 1.02], [0, 1.06]];
  const g = new THREE.LatheGeometry(prof.map(([r, y]) => new THREE.Vector2(r, y)), 40);
  g.translate(0, -1.25, 0); // hangs from its crown at the origin
  return g;
}
export function bell(level, knot, { at, rotY = 0 }) {
  const game = level.game;
  const gy = level.groundY(at.x, at.z);
  let pivotY = gy + 4.1;
  if (game.assets.has('Arch')) {
    const arch = level.staticPiece('Arch', new THREE.Vector3(at.x, gy, at.z), rotY);
    const bb = new THREE.Box3().setFromObject(arch);
    pivotY = Math.min(bb.max.y - 0.7, gy + 4.4);
  }
  const g = new THREE.Group();
  const shell = new THREE.Mesh(bellGeometry(), bronze());
  shell.castShadow = true; shell.receiveShadow = true;
  const clapper = new THREE.Mesh(new THREE.SphereGeometry(0.1, 12, 8).translate(0, -1.05, 0), bronze());
  const yoke = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.18, 0.22), new THREE.MeshStandardMaterial({ color: '#3b2a1c', roughness: 0.85 }));
  yoke.position.y = 0.05; yoke.castShadow = true;
  g.add(shell, clapper, yoke);
  g.position.set(at.x, pivotY, at.z);
  g.rotation.y = rotY;
  const shape = RAPIER.ColliderDesc.ball(0.62).setTranslation(0, -0.65, 0);
  const t = new Thing(game, { name: 'Bell', displayName: 'The bell', obj: g, kinematic: true, shape, refuse: ['multiplying', 'framed'] });
  t.dustColor = '#d6a84e';
  const lock = new Lock(level, knot, {
    hint: 'the bell is too heavy to ring', line: 'puzzleBell', focus: g.position.clone().setY(pivotY - 0.6),
    caption: 'The bell forgets its weight, and rings for her the way it rang on Sundays.',
  });
  let swing = 0, phase = 0, rings = 0, lastSide = 0, lift = 0;
  const base = g.quaternion.clone(), axis = new THREE.Vector3(1, 0, 0);
  // a knock with nothing to swing it is only a clonk
  const hit = t.damage.bind(t);
  t.damage = (amount, o = {}) => { hit(amount, o); if (!t.has('floating') && o.type === 'round' && Math.random() < 0.5) game.audio.sfx('bell', { position: g.position, gain: 0.25, pitch: -12 }); };
  t.tick = (dt) => {
    const fl = t.has('floating');
    lift += ((fl ? 1 : 0) - lift) * Math.min(1, dt * 2);
    swing += ((fl ? 0.95 : 0) - swing) * Math.min(1, dt * (fl ? 0.7 : 0.4));
    phase += dt * 2.6;
    const a = Math.sin(phase) * swing;
    g.position.y = pivotY + lift * 0.35;
    g.quaternion.copy(base).multiply(new THREE.Quaternion().setFromAxisAngle(axis, a));
    clapper.rotation.x = -a * 0.6;
    const side = Math.sign(Math.sin(phase));
    if (swing > 0.4 && side !== lastSide && side !== 0) {
      game.audio.sfx('bell', { position: g.position, gain: 0.9 });
      game.vfx.ring(g.position.clone().setY(g.position.y - 0.7), 0.4, 6, 0.8, 0xffd27a, 0.6);
      if (++rings >= 3) lock.solve();
    }
    lastSide = side;
    t.sync();
  };
  lock.tick = t.tick;
  const c = at.clone().add(new THREE.Vector3(Math.cos(rotY) * 4, 0, -Math.sin(rotY) * 4));
  level.put('Cloud', c.x, c.z, { y: gy + 2.6 });
  return lock;
}

// ================================================================ Golconda Piazza
// A shaft of light, as a mesh: bright where it lands, fading along its length
function shaft(color, width = 0.35) {
  const mat = new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(color) }, uA: { value: 0 }, uTime: { value: 0 } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `uniform vec3 uColor; uniform float uA, uTime; varying vec2 vUv;
      void main(){ float edge = pow(sin(vUv.x * 3.14159), 2.0); float motes = 0.8 + 0.2 * sin(vUv.y * 60.0 - uTime * 4.0);
        gl_FragColor = vec4(uColor * 2.5, edge * motes * uA * (0.35 + 0.65 * vUv.y)); }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false,
  });
  const m = new THREE.Mesh(new THREE.CylinderGeometry(width, width, 1, 12, 1, true).translate(0, 0.5, 0).rotateX(Math.PI / 2), mat);
  m.userData.noAO = true; m.renderOrder = 6; m.frustumCulled = false;
  return m;
}
function aim(m, a, b) { m.position.copy(a); m.lookAt(b); m.scale.set(1, 1, a.distanceTo(b)); }

// the window crowd: a shaft of low sun falls on a Dali egg. Make the egg a mirror
// and the light turns, and burns the ink off the memory.
export function sunEgg(level, knot, { at }) {
  const game = level.game;
  const gy = level.groundY(at.x, at.z);
  const plinth = level.staticPiece('Column', new THREE.Vector3(at.x, gy - 2.6, at.z), 0);
  plinth.scale.set(2.2, 1, 2.2);
  let obj;
  if (game.assets.has('T_Egg')) { obj = game.assets.clone('T_Egg'); obj.traverse((m) => { if (m.isMesh && /_COL/.test(m.name)) m.visible = false; }); obj.scale.setScalar(1.25); }
  else obj = new THREE.Mesh(new THREE.SphereGeometry(0.6, 32, 20).scale(1, 1.35, 1).translate(0, 0.8, 0), new THREE.MeshStandardMaterial({ color: '#efe6d6', roughness: 0.4 }));
  obj.position.set(at.x, gy + 1.4, at.z);
  obj.traverse((m) => { if (m.isMesh) { m.castShadow = true; m.material = m.material.clone(); } });
  const t = new Thing(game, { name: 'Egg', displayName: 'The egg', obj, refuse: ['multiplying', 'framed'] });
  t.dustColor = '#efe6d6';
  const egg = t.center();
  const sun = new THREE.Vector3(...(level.look?.sunDir || [0.85, 0.11, 0.25])).normalize();
  const src = egg.clone().addScaledVector(sun, 70);
  const inBeam = shaft('#ffe0a0', 0.5), outBeam = shaft('#fff2c8', 0.3);
  level.group.add(inBeam, outBeam);
  aim(inBeam, src, egg);
  const target = knot.pos.clone().setY(knot.pos.y + 1.35);
  aim(outBeam, egg, target);
  const lock = new Lock(level, knot, {
    hint: 'a shaft of sun falls on an egg · turn the light', line: 'puzzleEgg', focus: target.clone(),
    caption: 'The egg becomes a mirror, and the sun turns and finds her.',
  });
  let burn = 0;
  lock.tick = (dt, time) => {
    inBeam.material.uniforms.uA.value = 0.55; inBeam.material.uniforms.uTime.value = time;
    const on = t.has('reflecting');
    const u = outBeam.material.uniforms;
    u.uA.value += ((on ? 0.9 : 0) - u.uA.value) * Math.min(1, dt * 4); u.uTime.value = time;
    if (on && !lock.solved) {
      burn += dt;
      if (Math.random() < dt * 40) game.vfx.add.spawn({ x: target.x + rnd(-0.4, 0.4), y: target.y + rnd(-0.4, 0.4), z: target.z + rnd(-0.4, 0.4), vy: 1.2, color: new THREE.Color('#ffcf8a').multiplyScalar(4), alpha: 1, alpha1: 0, size: 0.14, size1: 0.02, life: 0.8 });
      if (burn > 1.8) lock.solve();
    }
  };
  return lock;
}

// the second drawer: sealed in red wax. Wax gives to heat (burning, or melting).
export function waxSeal(level, knot, { at, rotY = 0 }) {
  const game = level.game;
  const gy = level.groundY(at.x, at.z);
  const g = new THREE.Group();
  const wax = new THREE.MeshStandardMaterial({ color: '#8e1a1f', roughness: 0.35, metalness: 0.05, name: 'Wax' });
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 0.9, 0.22, 40).rotateX(Math.PI / 2), wax);
  disc.position.y = 1.6;
  // the stamp: a ring and his initial, pressed in
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.6, 0.05, 8, 40), wax); ring.position.set(0, 1.6, 0.12);
  const T = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.1, 0.06), wax); T.position.set(0, 1.83, 0.13);
  const T2 = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.5, 0.06), wax); T2.position.set(0, 1.55, 0.13);
  // a ribbon down to the ground, tying the memory in
  const ribbon = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.6, 0.03), new THREE.MeshStandardMaterial({ color: '#b8423a', roughness: 0.8 }));
  ribbon.position.set(0, 0.8, -0.02);
  g.add(disc, ring, T, T2, ribbon);
  g.traverse((m) => { if (m.isMesh) m.castShadow = true; });
  g.position.set(at.x, gy, at.z); g.rotation.y = rotY;
  const t = new Thing(game, { name: 'Seal', displayName: 'The wax seal', obj: g, hp: 36, flammable: true, refuse: ['multiplying', 'framed'] });
  t.dustColor = '#8e1a1f'; t.meltColor = '#8e1a1f';
  const lock = new Lock(level, knot, {
    hint: 'sealed in red wax · wax gives to heat', line: 'puzzleSeal', focus: g.position.clone().setY(gy + 1.5),
    caption: 'The seal runs, and the drawer comes open.',
  });
  t.onDie = () => { game.vfx.propertyBurst(g.position.clone().setY(gy + 1.5), 'burning', 1.2); lock.solve(); };
  // the knot's anxieties will not let a stray round do it; only heat
  const dmg = t.damage.bind(t);
  t.damage = (amount, o = {}) => { if (o.type === 'fire' || o.type === 'melt') dmg(amount, o); };
  const c = at.clone().add(new THREE.Vector3(Math.cos(rotY) * 2.5, 0, -Math.sin(rotY) * 2.5));
  level.put('Candle', c.x, c.z, {});
  return lock;
}

// Paris time: a clock on a pillar, stopped because its weight is only painted
// on. Make the weight heavy and it runs down, the clock starts, and strikes.
export function counterweight(level, knot, { at }) {
  const game = level.game;
  const gy = level.groundY(at.x, at.z);
  // a tall pillar, the clock face on top of it facing the memory
  const face = knot.pos.clone().sub(at).setY(0).normalize(), rotY = Math.atan2(face.x, face.z);
  for (let i = 0; i < 2; i++) level.staticPiece('Column', new THREE.Vector3(at.x, gy + i * 4, at.z), 0).scale.set(1.5, 1, 1.5);
  const clock = game.assets.has('Clock') ? game.assets.clone('Clock') : new THREE.Group();
  clock.scale.setScalar(2.6);
  clock.position.set(at.x + face.x * 0.6, gy + 6.4, at.z + face.z * 0.6); clock.rotation.y = rotY;
  clock.traverse((m) => { if (m.isMesh) m.castShadow = true; });
  level.group.add(clock);
  const hands = [clock.getObjectByName('Clock_HandHour'), clock.getObjectByName('Clock_HandMinute')].filter(Boolean);
  // the weight hangs on a chain beside the pillar
  const side = new THREE.Vector3(face.z, 0, -face.x);
  const top = new THREE.Vector3(at.x, gy + 7.2, at.z).addScaledVector(side, 1.1).addScaledVector(face, 0.3);
  const chain = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 1, 6).translate(0, -0.5, 0), new THREE.MeshStandardMaterial({ color: '#4a4238', metalness: 0.9, roughness: 0.4 }));
  chain.position.copy(top); level.group.add(chain);
  const w = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 1.1, 20), bronze());
  const cap = new THREE.Mesh(new THREE.SphereGeometry(0.28, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), bronze()); cap.position.y = 0.55;
  const wg = new THREE.Group(); wg.add(w, cap);
  wg.traverse((m) => { if (m.isMesh) m.castShadow = true; });
  const hang0 = 2.4, hang1 = 5.6; // how far below the top it hangs, stopped and run down
  wg.position.copy(top).setY(top.y - hang0);
  const t = new Thing(game, { name: 'Weight', displayName: 'The clock weight', obj: wg, kinematic: true, shape: RAPIER.ColliderDesc.cylinder(0.6, 0.32), refuse: ['multiplying', 'framed'] });
  t.dustColor = '#d6a84e';
  const lock = new Lock(level, knot, {
    hint: 'a stopped clock · its weight is painted on', line: 'puzzleClock', focus: clock.position.clone(),
    caption: 'The weight remembers what it is for. Paris time, again.',
  });
  let drop = 0, struck = false;
  t.on((prop, on) => { if (prop === 'floating' && on) game.ui.toast('The weight drifts up its chain, and the hands turn backwards a little.'); });
  lock.tick = (dt) => {
    const heavy = t.has('heavy') || lock.solved;
    if (heavy) drop = Math.min(1, drop + dt * 0.35);
    else if (t.has('floating')) drop = Math.max(-0.4, drop - dt * 0.2);
    const h = hang0 + (hang1 - hang0) * Math.max(0, drop) + Math.min(0, drop) * 2;
    wg.position.y = top.y - h;
    chain.scale.y = Math.max(0.1, h - 0.6);
    const run = heavy ? 1 : t.has('floating') ? -0.3 : 0;
    if (hands.length === 2) { hands[0].rotation.z -= dt * 0.3 * run; hands[1].rotation.z -= dt * 3.6 * run; }
    if (drop >= 1 && !struck) { struck = true; game.audio.sfx('chime', { position: clock.position }); lock.solve(); }
    t.sync();
  };
  // anvils in the square, for the weight
  const a = at.clone().addScaledVector(side, -3).addScaledVector(face, 2);
  level.put('Anvil', a.x, a.z, {});
  return lock;
}

// the unfinished portrait: under glass. Above the case an anvil hangs in the air,
// heavy and floating at once, which cancel. Take its floating away.
export function vitrine(level, knot) {
  const game = level.game, c = knot.pos;
  const glass = new THREE.MeshPhysicalMaterial({ color: '#e8f4f6', roughness: 0.05, metalness: 0, transmission: 0, transparent: true, opacity: 0.22, envMapIntensity: 1.4, depthWrite: false, name: 'VitrineGlass' });
  const brass = new THREE.MeshStandardMaterial({ color: '#b58a3c', metalness: 0.95, roughness: 0.3 });
  const g = new THREE.Group();
  const W = 1.5, H = 2.7;
  const pane = new THREE.Mesh(new THREE.BoxGeometry(W * 2, H, W * 2), glass); pane.position.y = H / 2 + 0.25; pane.userData.noAO = true;
  const base = new THREE.Mesh(new THREE.BoxGeometry(W * 2 + 0.2, 0.25, W * 2 + 0.2), new THREE.MeshStandardMaterial({ color: '#2b2622', roughness: 0.6 }));
  base.position.y = 0.125; base.castShadow = true; base.receiveShadow = true;
  g.add(pane, base);
  for (const [x, z] of [[-W, -W], [W, -W], [-W, W], [W, W]]) { const e = new THREE.Mesh(new THREE.BoxGeometry(0.06, H, 0.06), brass); e.position.set(x, H / 2 + 0.25, z); e.castShadow = true; g.add(e); }
  for (const y of [0.25, H + 0.25]) for (const [x, z, sx, sz] of [[0, -W, W * 2, 0.06], [0, W, W * 2, 0.06], [-W, 0, 0.06, W * 2], [W, 0, 0.06, W * 2]]) { const e = new THREE.Mesh(new THREE.BoxGeometry(sx, 0.06, sz), brass); e.position.set(x, y, z); g.add(e); }
  g.position.set(c.x, c.y, c.z);
  const t = new Thing(game, { name: 'Vitrine', displayName: 'The glass case', obj: g, shape: RAPIER.ColliderDesc.cuboid(W, H / 2 + 0.12, W).setTranslation(0, H / 2 + 0.13, 0), refuse: ['multiplying', 'framed', 'floating', 'heavy'] });
  t.dustColor = '#e6f2ff';
  const lock = new Lock(level, knot, {
    hint: 'under glass · an anvil hangs over it', line: 'puzzleVitrine', focus: c.clone().setY(c.y + 2),
    caption: 'The anvil remembers the ground. The glass does not survive the conversation.',
  });
  // the anvil: heavy and floating cancel into a hover
  const hover = c.clone().setY(c.y + H + 4.2);
  const anvil = level.put('Anvil', hover.x, hover.z, { y: hover.y, props: ['floating'] });
  anvil.puzzle = true;
  let broke = false;
  const smash = () => {
    if (broke) return;
    broke = true;
    game.audio.sfx('shatter', { position: g.position });
    game.audio.sfx('heavy', { position: g.position });
    for (let i = 0; i < 90; i++) {
      const p = g.position.clone().add(new THREE.Vector3(rnd(-W, W), rnd(0.3, H), rnd(-W, W)));
      game.vfx.sparks.spawn({ x: p.x, y: p.y, z: p.z, vx: rnd(-5, 5), vy: rnd(1, 6), vz: rnd(-5, 5), color: new THREE.Color('#dff6ff').multiplyScalar(3), alpha: 1, alpha1: 0, size: 0.08, life: rnd(0.5, 1.2), grav: 18, stretch: 0.03 });
    }
    game.vfx.dust(g.position, 2, '#e6f2ff');
    game.hitStop?.(0.08);
    t.die({ type: 'shatter', silent: true });
    lock.solve();
  };
  // a big enough blast does it too
  t.damage = (amount) => { if (amount >= 50) smash(); };
  lock.tick = (dt) => {
    if (broke || anvil.dead || !anvil.body) return;
    const b = anvil.body, p = b.translation(), v = b.linvel();
    // while it hovers it keeps to its place over the case
    if (anvil.has('floating') && anvil.has('heavy')) {
      const k = Math.min(1, dt * 2);
      b.setLinvel({ x: v.x + ((hover.x - p.x) * 1.5 - v.x) * k, y: v.y + ((hover.y - p.y) * 1.5 - v.y) * k, z: v.z + ((hover.z - p.z) * 1.5 - v.z) * k }, true);
    }
    if (Math.abs(p.x - c.x) < W + 0.3 && Math.abs(p.z - c.z) < W + 0.3 && p.y < c.y + H + 1.2 && v.y < -4) smash();
  };
  return lock;
}
