// World entities: props, walls/columns/platforms, pickups.  Anything that can
// hold properties derives from Entity.
import * as THREE from 'three';
import { RAPIER, collectPoints } from './physics.js';
import { G, ALL, TUNE } from './config.js';
import { refreshLook, refreshPhysics, updateEntityProps } from './properties.js';

let NEXT_ID = 1;
const _v = new THREE.Vector3();

export class Entity {
  constructor(game, opts) {
    this.game = game;
    this.id = NEXT_ID++;
    this.kind = opts.kind || 'prop';
    this.name = opts.name;
    this.obj = opts.obj;
    this.obj.userData.entity = this;
    this.body = null;
    this.props = new Set();
    this.innate = new Set();
    this.regrow = new Map();
    this.partial = {};
    this.hp = opts.hp ?? Infinity;
    this.maxHp = this.hp;
    this.dead = false;
    this.melt = 0; this.char = 0; this.burnT = 0; this.spreadT = 0;
    this.fuse = 0; this.fuseMax = 1.3;
    this.baseScale = this.obj.scale.x;
    this.baseGravity = opts.gravity ?? 1;
    this.baseDensity = opts.density ?? 1;
    this.baseLinDamp = opts.linDamp ?? 0.05;
    this.group = opts.group ?? G.PROP;
    this.filter = opts.filter ?? ALL;
    this.flammable = !!opts.flammable;
    this.persistent = !!opts.persistent;
    this.anchored = !!opts.anchored;
    this.immutable = !!opts.immutable;
    this.fracture_ = opts.fracture || null;
    this.canSleepFreeze = true;
    this.wasDynamic = !opts.anchored;
    this.popIn = 0;
    this.gravity = 1;
    this.lastHit = 0;
    // local-space bounds for centre / extents
    this.obj.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().copy(this.obj.matrixWorld).invert();
    const bb = new THREE.Box3();
    this.obj.traverse((o) => {
      if (!o.isMesh) return;
      o.geometry.computeBoundingBox();
      const b = o.geometry.boundingBox.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld));
      bb.union(b);
    });
    if (bb.isEmpty()) bb.set(new THREE.Vector3(-0.5, 0, -0.5), new THREE.Vector3(0.5, 1, 0.5));
    this.localBox = bb;
    this.localCenter = bb.getCenter(new THREE.Vector3());
    this.extent = bb.getSize(new THREE.Vector3()).multiplyScalar(0.5 * this.baseScale);
    this._r = Math.max(this.extent.x, this.extent.z, this.extent.y * 0.6);
  }

  center(out = new THREE.Vector3()) { return this.obj.localToWorld(out.copy(this.localCenter)); }
  radius() { return this._r; }
  has(p) { return this.props.has(p); }

  attachBody(body, colliders) {
    this.body = body;
    this.colliders = colliders;
    for (const c of colliders) this.game.physics.setOwner(c, this);
  }

  addProp(p, { quiet = false, innate = false } = {}) {
    if (this.dead || this.immutable) return;
    if (innate) this.innate.add(p);
    if (this.props.has(p)) return;
    this.props.add(p);
    if (p === 'bursting' && !this.innate.has('bursting')) this.fuse = this.fuseMax = 1.3;
    if (p === 'burning') { this.burnT = 0; this.spreadT = 0.3; }
    if ((p === 'floating' || p === 'heavy') && this.anchored && this.body && !innate) this.unanchor();
    if (p === 'hollow' && this.kind === 'enemy') this.hollowT = 10;
    this.onPropsChanged(p, true);
    if (!quiet && !innate) {
      this.game.vfx.propertyBurst(this.center(), p, Math.min(1.6, 0.6 + this.radius() * 0.4));
      this.game.audio.sfx(p, { position: this.center(), quantize: 'loose' });
    }
  }

  removeProp(p, { quiet = false } = {}) {
    if (!this.props.has(p)) return;
    this.props.delete(p);
    if (p === 'burning' && this.fireLight) { this.game.render.release(this.fireLight); this.fireLight = null; }
    if (p === 'bursting') this.obj.scale.setScalar(this.baseScale);
    this.onPropsChanged(p, false);
    if (!quiet) this.game.vfx.propertyBurst(this.center(), p, 0.5);
  }

  onPropsChanged() {
    refreshPhysics(this);
    refreshLook(this);
  }

  unanchor() {
    if (!this.anchored || !this.body) return;
    this.anchored = false;
    this.wasDynamic = true;
    this.body.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
    if (this.kind === 'wall') this.body.setAngularDamping(2.5);
  }

  damage(amount, opts = {}) {
    if (this.dead || amount <= 0) return;
    if (this.props.has('sleeping') && this.kind !== 'enemy') amount *= 1;
    this.hp -= amount;
    this.lastHit = this.game.time;
    if (opts.point && !opts.silent) this.game.vfx.impact(opts.point, opts.dir ? opts.dir.clone().negate() : new THREE.Vector3(0, 1, 0), this.dustColor || '#e8d3a8', 0.7);
    if (this.hp <= 0) {
      if (this.fracture_) this.fracture(opts.point || this.center(), opts.heavy ? 1.4 : 1, opts.dir);
      else this.die(opts);
    }
  }

  fracture(point, strength = 1, dir) {
    if (this.dead) return;
    this.game.destruction.fracture(this, point, strength, dir);
    this.die({ type: 'fracture', silent: true });
  }

  onMelted() {
    // a puddle of whatever it was
    const c = this.center();
    const col = this.meltColor || '#c9a36a';
    const hit = this.game.physics.ray({ x: c.x, y: c.y + 0.5, z: c.z }, { x: 0, y: -1, z: 0 }, 30, G.WORLD);
    if (hit) this.game.vfx.decal(hit.point, hit.normal, Math.max(1.5, this.radius() * 3), this.game.assets.textures.puddle, new THREE.Color(col), 0.9, 45);
    this.game.audio.sfx('melt', { position: c });
    this.die({ type: 'melt', silent: true });
  }

  die(opts = {}) {
    if (this.dead) return;
    this.dead = true;
    if (this.fireLight) { this.game.render.release(this.fireLight); this.fireLight = null; }
    if (this.body) { this.game.physics.remove(this.body); this.body = null; }
    this.obj.parent?.remove(this.obj);
    this.game.onEntityDeath?.(this, opts);
  }

  update(dt) {
    if (this.dead) return;
    const b = this.body;
    if (b && !this.anchored) {
      const t = b.translation(), r = b.rotation();
      this.obj.position.set(t.x, t.y, t.z);
      this.obj.quaternion.set(r.x, r.y, r.z, r.w);
      if (t.y < -40) { this.die({ type: 'void' }); return; }
      // impact detection from sudden velocity changes (sound, dust, heavy smashing)
      const v = b.linvel();
      if (this._pv) {
        const dv = Math.hypot(v.x - this._pv.x, v.y - this._pv.y, v.z - this._pv.z);
        const speed = Math.hypot(this._pv.x, this._pv.y, this._pv.z);
        if (dv > 7 && speed > 6) this.game.destruction.onImpact(this, speed, dv);
      } else this._pv = {};
      this._pv.x = v.x; this._pv.y = v.y; this._pv.z = v.z;
    }
    if (this.popIn > 0 && this.popIn < 1) {
      this.popIn = Math.min(1, this.popIn + dt * 4);
      const k = this.popIn;
      this.obj.scale.setScalar(this.baseScale * (1 + Math.sin(k * Math.PI) * 0.25) * Math.min(1, k * 2));
    }
    // innate properties regrow: the dream reasserts itself
    for (const [p, t] of this.regrow) {
      if (this.game.time > t) { this.regrow.delete(p); if (!this.props.has(p)) { this.addProp(p, { innate: true }); this.game.vfx.propertyBurst(this.center(), p, 0.4); } }
    }
    if (this.hands) {
      const k = 1 - Math.min(0.9, this.melt);
      this.hands[0].rotation.z -= dt * 0.05 * k;
      this.hands[1].rotation.z -= dt * 0.6 * k * (this.props.has('sleeping') ? 0 : 1);
    }
    updateEntityProps(this.game, this, dt);
  }
}

// ---------------------------------------------------------------------------
// Spawn catalogue: how each template becomes a physical entity
// ---------------------------------------------------------------------------
export const CATALOG = {
  Clock: { innate: ['melting'], hp: 30, density: 0.9, meltColor: '#e9d9a6', dust: '#fff3c4' },
  Cloud: { innate: ['floating'], density: 0.2, linDamp: 3, persistent: true, meltColor: '#dfe9f5', dust: '#ffffff' },
  Mirror: { innate: ['reflecting'], hp: 45, density: 1.2, anchored: true, dust: '#e6f2ff' },
  Candle: { innate: ['burning'], hp: 20, density: 1, flammable: true, dust: '#ffe0b0' },
  Anvil: { innate: ['heavy'], hp: Infinity, density: 7, persistent: true, meltColor: '#555a66', dust: '#9aa3b5' },
  Bed: { innate: ['sleeping'], hp: 90, density: 2.5, flammable: true, bouncy: true, anchored: true, dust: '#f0e8dc' },
  BowlerHat: { innate: ['multiplying'], hp: 15, density: 0.5, flammable: true, dust: '#333' },
  Birdcage: { innate: ['hollow'], hp: 40, density: 0.6, dust: '#d6a84e' },
  Pomegranate: { innate: ['bursting'], hp: 10, density: 0.8, meltColor: '#b3263b', dust: '#ff6a8a' },
  Frame: { innate: ['framed'], hp: 50, anchored: true, dust: '#d6a84e' },
  Drawers: { hp: 45, density: 1.2, flammable: true, fracture: 'Drawers_Fractured', dust: '#8b5a2b' },
  Wall: { kind: 'wall', anchored: true, hp: 160, fracture: 'Wall_Fractured', group: G.WALL, dust: '#e8d5b0', meltColor: '#d9c29a' },
  Column: { kind: 'wall', anchored: true, hp: 120, fracture: 'Column_Fractured', group: G.WALL, dust: '#efe3c8', meltColor: '#e2d3b4' },
  Platform: { kind: 'wall', anchored: true, hp: Infinity, group: G.WORLD, dust: '#c9a36a', meltColor: '#b88a55' },
  Rock_A: { kind: 'wall', anchored: true, hp: Infinity, group: G.WORLD, dust: '#c9a36a' },
  Rock_B: { kind: 'wall', anchored: true, hp: Infinity, group: G.WORLD, dust: '#c9a36a' },
  Rock_C: { kind: 'wall', anchored: true, hp: Infinity, group: G.WORLD, dust: '#c9a36a' },
  DeadTree: { kind: 'wall', anchored: true, hp: 80, flammable: true, group: G.WALL, dust: '#6b4a2c' },
  // a breakable stretch of house wall, slotted into the town's buildings
  TP_Stucco: { kind: 'wall', anchored: true, hp: 140, fracture: 'TP_Stucco_Fractured', group: G.WALL, dust: '#efe6d6', meltColor: '#e2d6c0' },
};

// build the Rapier collider desc(s) for a template, in the entity's local frame
function colliderDescs(name, obj, scale = 1) {
  const C = RAPIER.ColliderDesc;
  if (scale !== 1 && !['Wall', 'Column', 'Platform'].includes(name)) {
    const pts = collectPoints(obj, 200).map((v) => v * scale);
    return [C.convexHull(pts) || C.ball(0.4 * scale)];
  }
  switch (name) {
    case 'Wall': return [C.cuboid(2, 1.5, 0.25).setTranslation(0, 1.5, 0)];
    case 'TP_Stucco': return [C.cuboid(2, 1.8, 0.2).setTranslation(0, 1.8, 0)];
    case 'Column': return [C.cylinder(2, 0.34).setTranslation(0, 2, 0)];
    case 'Platform': return [C.cuboid(1.5, 0.25, 1.5).setTranslation(0, -0.25, 0)];
    case 'Drawers': return [C.cuboid(0.5, 0.55, 0.3).setTranslation(0, 0.55, 0)];
    case 'Mirror': return [C.cuboid(0.55, 1.0, 0.12).setTranslation(0, 1.0, 0)];
    case 'Bed': return [C.cuboid(0.8, 0.3, 1.1).setTranslation(0, 0.3, 0), C.cuboid(0.8, 0.5, 0.06).setTranslation(0, 0.9, -1.05)] // the headboard end;
    case 'DeadTree': return [C.cylinder(1.5, 0.22).setTranslation(0, 1.5, 0)];
    default: {
      const pts = collectPoints(obj, 200);
      const d = C.convexHull(pts);
      return [d || C.ball(0.4)];
    }
  }
}

export function spawnEntity(game, name, pos, opts = {}) {
  const def = CATALOG[name] || {};
  const obj = game.assets.clone(name);
  obj.position.copy(pos);
  if (opts.rotY !== undefined) obj.rotation.y = opts.rotY;
  if (opts.quat) obj.quaternion.copy(opts.quat);
  if (opts.scale) obj.scale.setScalar(opts.scale);
  game.scene.add(obj);
  const e = new Entity(game, {
    kind: def.kind || 'prop', name, obj, hp: def.hp, gravity: def.gravity, density: def.density, linDamp: def.linDamp,
    group: def.group, flammable: def.flammable, persistent: def.persistent, fracture: def.fracture,
    anchored: opts.anchored ?? def.anchored, immutable: opts.immutable,
  });
  e.bouncy = !!def.bouncy;
  if (name === 'Clock') {
    const h = obj.getObjectByName('Clock_HandHour'), m = obj.getObjectByName('Clock_HandMinute');
    if (h && m) { e.hands = [h, m]; h.rotation.z = -Math.random() * 6; m.rotation.z = -Math.random() * 6; }
  }
  e.meltColor = def.meltColor;
  e.dustColor = def.dust;
  const q = obj.quaternion;
  const body = e.anchored ? game.physics.fixed(pos, q) : game.physics.dynamic(pos, q, { linDamp: def.linDamp ?? 0.05, angDamp: 0.5, gravityScale: def.gravity ?? 1, ccd: name === 'Anvil' });
  const cols = colliderDescs(name, obj, obj.scale.x).map((d) => game.physics.collider(d, body, e.group, ALL, {
    friction: 0.7, restitution: def.bouncy ? 0.2 : 0.05, density: def.density ?? 1,
  }));
  e.attachBody(body, cols);
  for (const p of def.innate || []) e.addProp(p, { innate: true });
  if (opts.props) for (const p of opts.props) e.addProp(p, { quiet: true });
  game.entities.add(e);
  return e;
}

// ---------------------------------------------------------------------------
// Pickups (apples heal, memory shards unlock)
// ---------------------------------------------------------------------------
export class Pickup {
  constructor(game, pos, type = 'apple') {
    this.game = game; this.type = type; this.dead = false;
    this.obj = game.assets.clone('Apple');
    this.obj.scale.setScalar(2.2);
    this.obj.position.copy(pos);
    this.base = pos.clone();
    game.scene.add(this.obj);
    this.t = Math.random() * 6;
    this.light = null;
  }
  update(dt) {
    this.t += dt;
    this.obj.position.y = this.base.y + 0.6 + Math.sin(this.t * 2.2) * 0.12;
    this.obj.rotation.y += dt * 1.4;
    const p = this.game.player;
    if (Math.random() < dt * 6) this.game.vfx.trail(this.obj.position, '#b6ff6a', 0.1, 0.5);
    if (p && p.pos.distanceTo(this.obj.position) < 1.3) {
      p.heal(25);
      this.game.audio.sfx('pickup', { quantize: 'loose' });
      this.game.vfx.propertyBurst(this.obj.position, 'floating', 0.5);
      this.dead = true;
      this.obj.parent?.remove(this.obj);
    }
  }
}

// ---------------------------------------------------------------------------
// Canvas scraps: torn pieces of the painting, hidden behind parkour and combos.
// A shaft of warm light marks each one.
// ---------------------------------------------------------------------------
export class ScrapPickup {
  constructor(game, pos, scrap) {
    this.game = game; this.scrap = scrap; this.dead = false;
    this.obj = new THREE.Group();
    this.obj.position.copy(pos);
    this.base = pos.clone();
    let piece;
    if (game.assets.has('CanvasScrap')) piece = game.assets.clone('CanvasScrap');
    else piece = new THREE.Mesh(new THREE.PlaneGeometry(0.45, 0.32), new THREE.MeshStandardMaterial({ color: 0xd9cdb2, side: THREE.DoubleSide }));
    piece.scale.setScalar(1.7);
    this.piece = piece;
    this.obj.add(piece);
    // a soft shaft of dusty light: bright at the scrap, fading upward, feathered at the edges
    const beamMat = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Color('#ffc978') }, uOpacity: { value: 0.16 }, uTime: { value: 0 } },
      vertexShader: `varying vec2 vUv; varying vec3 vN; varying vec3 vV;
        void main(){ vUv = uv; vec4 mv = modelViewMatrix * vec4(position, 1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `uniform vec3 uColor; uniform float uOpacity, uTime; varying vec2 vUv; varying vec3 vN; varying vec3 vV;
        void main(){
          float edge = pow(abs(dot(normalize(vN), normalize(vV))), 2.2);
          float up = pow(1.0 - vUv.y, 1.6) * smoothstep(0.0, 0.04, vUv.y);
          float motes = 0.75 + 0.25 * sin(vUv.y * 40.0 - uTime * 2.0 + vUv.x * 18.0);
          gl_FragColor = vec4(uColor * 2.2, edge * up * motes * uOpacity);
        }`,
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false,
    });
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(1.0, 0.4, 12, 24, 1, true), beamMat); // widens toward the sky it falls from
    beam.position.y = 5.6;
    beam.userData.noAO = true;
    this.beam = beam;
    this.obj.add(beam);
    game.scene.add(this.obj);
    this.t = Math.random() * 6;
  }
  update(dt) {
    const game = this.game;
    this.t += dt;
    this.obj.position.y = this.base.y + Math.sin(this.t * 1.6) * 0.1;
    this.piece.rotation.y += dt * 0.9;
    this.piece.rotation.z = Math.sin(this.t * 1.1) * 0.15;
    this.beam.material.uniforms.uOpacity.value = 0.5 + Math.sin(this.t * 2.3) * 0.12;
    this.beam.material.uniforms.uTime.value = this.t;
    if (Math.random() < dt * 10) game.vfx.add.spawn({ x: this.obj.position.x + (Math.random() - 0.5) * 0.6, y: this.obj.position.y - 0.3, z: this.obj.position.z + (Math.random() - 0.5) * 0.6, vy: 0.9, color: new THREE.Color('#ffd27a').multiplyScalar(3), alpha: 0.9, alpha1: 0, size: 0.06, life: 1.4 });
    const p = game.player;
    if (p && !p.dead && p.pos.clone().setY(p.pos.y + 0.9).distanceTo(this.obj.position) < 1.5) {
      this.dead = true;
      this.obj.parent?.remove(this.obj);
      if (game.meta.addScrap(this.scrap.id)) {
        game.ui.loreCard(this.scrap);
        game.narrator.say('scrap');
        game.audio.sfx('lore');
        game.vfx.propertyBurst(this.obj.position, 'multiplying', 1.2);
        game.stats.scraps = (game.stats.scraps || 0) + 1;
      }
    }
  }
}
