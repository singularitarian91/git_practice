// The property system: what each property does to things, to you, and to
// your rounds; giving and taking; and the Lucidity meter that rises with
// absurdity.  Properties interact through shared channels (gravity, heat,
// solidity, fuse) rather than hand-written pairs, so combos emerge.
import * as THREE from 'three';
import { PROPS, PROP_INFO, TUNE, G, groups, ALL } from './config.js';
import { RAPIER } from './physics.js';
import { makeDreamMaterial, eachMaterial } from './assets.js';

const up = new THREE.Vector3(0, 1, 0);
const tmp = new THREE.Vector3();

// ---------------------------------------------------------------------------
// Lucidity: the more absurd your combos, the stronger and stranger the dream
// gets - and the closer the dreamer comes to waking.
// ---------------------------------------------------------------------------
export class Lucidity {
  constructor(game) {
    this.game = game;
    this.value = 0;
    this.display = 0;
    this.idle = 0;
    this.seenPairs = new Set();
    this.total = 0;          // "strangeness" earned this run
    this.warned = false;
    this.cap = 100;
  }
  reset() { this.value = 0; this.display = 0; this.idle = 0; this.seenPairs.clear(); this.total = 0; this.warned = false; }
  gain(v, reason) {
    if (v <= 0) return;
    this.value = Math.min(this.cap, this.value + v);
    this.total += v;
    this.idle = 0;
    if (reason) this.game.ui?.lucidPopup(`+${Math.round(v)} ${reason}`);
    if (this.value >= 75 && !this.warned) { this.warned = true; this.game.audio?.stinger('lucidityWarn'); this.game.ui?.toast('The dreamer stirs...', 'warn'); }
    if (this.value < 60) this.warned = false;
  }
  get power() { return 1 + this.value / 100; }   // scales property strength
  get k() { return this.value / 100; }
  update(dt) {
    this.idle += dt;
    if (this.idle > 4) this.value = Math.max(0, this.value - dt * (1.1 + (this.idle - 4) * 0.08));
    this.display += (this.value - this.display) * Math.min(1, dt * 4);
  }
}

// ---------------------------------------------------------------------------
// Visual helpers applied per entity
// ---------------------------------------------------------------------------
function ensureDream(e) {
  if (e._dreamMats) return e._dreamMats;
  e._dreamMats = [];
  e.obj.traverse((o) => {
    if (!o.isMesh) return;
    o.geometry.computeBoundingBox();
    const bb = o.geometry.boundingBox;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of mats) {
      if (!m.isMeshStandardMaterial) continue;
      e._dreamMats.push({ m, u: makeDreamMaterial(m, Math.max(0.2, bb.max.y - bb.min.y), bb.min.y) });
    }
  });
  return e._dreamMats;
}

function snapshotMaterials(e) {
  if (e._matSnap) return;
  e._matSnap = [];
  eachMaterial(e.obj, (m) => {
    e._matSnap.push({ m, color: m.color?.clone(), metal: m.metalness, rough: m.roughness, emissive: m.emissive?.clone(), ei: m.emissiveIntensity,
      opacity: m.opacity, transparent: m.transparent, depthWrite: m.depthWrite, env: m.envMapIntensity });
  });
}

// Recompute the material look from the entity's current properties
export function refreshLook(e) {
  snapshotMaterials(e);
  const P = e.props;
  for (const s of e._matSnap) {
    const m = s.m;
    if (!m.color) continue;
    m.color.copy(s.color); m.metalness = s.metal; m.roughness = s.rough;
    if (m.emissive) { m.emissive.copy(s.emissive); m.emissiveIntensity = s.ei; }
    m.opacity = s.opacity; m.transparent = s.transparent; m.depthWrite = s.depthWrite; m.envMapIntensity = s.env ?? 1;
    if (P.has('reflecting') && !(e.innate.has('reflecting'))) {
      m.color.lerp(new THREE.Color('#dfe8f0'), 0.8); m.metalness = 1; m.roughness = 0.04; m.envMapIntensity = 1.8;
    }
    if (P.has('heavy') && !e.innate.has('heavy')) {
      m.color.multiplyScalar(0.45); m.metalness = Math.max(m.metalness, 0.75); m.roughness = Math.min(m.roughness, 0.4);
    }
    if (P.has('sleeping') && !e.innate.has('sleeping')) {
      m.color.lerp(new THREE.Color('#6a5acd'), 0.35);
    }
    if (P.has('hollow') && !e.innate.has('hollow')) {
      m.transparent = true; m.opacity = 0.22; m.depthWrite = false;
      if (m.emissive) { m.emissive.set('#5effd0'); m.emissiveIntensity = 0.35; }
    }
    if (P.has('burning')) {
      if (m.emissive) { m.emissive.set('#ff4a10'); m.emissiveIntensity = 0.15; }
      m.color.multiplyScalar(1 - Math.min(0.6, e.char * 0.6));
    }
    if (P.has('bursting') && !e.innate.has('bursting')) {
      if (m.emissive) { m.emissive.set('#ff2d6f'); m.emissiveIntensity = 0.2; }
    }
    m.needsUpdate = true;
  }
  // wire overlay for hollow things so they stay readable
  if (P.has('hollow') && !e.innate.has('hollow')) {
    if (!e._wire) {
      e._wire = [];
      e.obj.traverse((o) => {
        if (!o.isMesh || o.userData.isWire) return;
        const w = new THREE.LineSegments(new THREE.EdgesGeometry(o.geometry, 30), new THREE.LineBasicMaterial({ color: 0x5effd0, transparent: true, opacity: 0.55 }));
        w.userData.isWire = true;
        o.add(w); e._wire.push(w);
      });
    }
  } else if (e._wire) {
    for (const w of e._wire) { w.parent?.remove(w); w.geometry.dispose(); }
    e._wire = null;
  }
}

// ---------------------------------------------------------------------------
// Physics consequences of the property set
// ---------------------------------------------------------------------------
export function refreshPhysics(e) {
  const b = e.body;
  if (!b) return;
  const P = e.props;
  // gravity channel: floating lifts, heavy pulls, together they cancel into a hover
  let g = e.baseGravity;
  if (P.has('heavy')) g += 2;
  if (P.has('floating')) g -= P.has('heavy') ? 3 : 1.6;
  if (e.innate.has('floating') && P.has('floating') && !P.has('heavy')) g = 0;
  if (b.isDynamic()) b.setGravityScale(g, true);
  e.gravity = g;
  // mass channel
  const dens = (e.baseDensity ?? 1) * (P.has('heavy') ? 9 : 1) * (P.has('hollow') ? 0.25 : 1);
  for (let i = 0; i < b.numColliders(); i++) b.collider(i).setDensity(dens);
  b.setLinearDamping(P.has('floating') ? 0.9 : (P.has('sleeping') && e.kind === 'enemy' ? 4 : e.baseLinDamp ?? 0.05));
  // solidity channel: hollow things only touch the ground and the sky
  const hollow = P.has('hollow') && !e.innate.has('hollow');
  for (let i = 0; i < b.numColliders(); i++) {
    const c = b.collider(i);
    if (hollow) c.setCollisionGroups(groups(G.GHOST, G.WORLD | G.CEIL));
    else c.setCollisionGroups(groups(e.group, e.filter ?? ALL));
  }
  // sleeping freezes props exactly where they are (even mid-air)
  if (e.kind === 'prop' && e.canSleepFreeze) {
    const frozen = P.has('sleeping') && !e.innate.has('sleeping');
    if (frozen && b.isDynamic()) { b.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, true); }
    else if (!frozen && !b.isDynamic() && e.wasDynamic) { b.setBodyType(RAPIER.RigidBodyType.Dynamic, true); b.setGravityScale(g, true); }
  }
  b.wakeUp();
}

// ---------------------------------------------------------------------------
// Per-frame effects on a world entity
// ---------------------------------------------------------------------------
export function updateEntityProps(game, e, dt) {
  const P = e.props;
  if (!P.size && e.melt <= 0) return;
  const pw = game.lucidity.power;
  const pos = e.center();
  // melting: progress toward a puddle (burning speeds it up)
  if (P.has('melting')) {
    const cap = e.innate.has('melting') && P.size === 1 ? 0.35 : e.innate.has('melting') ? 0.45 : 1.05;
    const rate = (e.kind === 'enemy' ? 0.2 : 0.16) * pw * (P.has('burning') ? 3 : 1) * (P.has('heavy') ? 1.4 : 1);
    e.melt = Math.min(cap, e.melt + rate * dt);
    if (e.kind === 'enemy') e.damage(6 * pw * dt, { type: 'melt', silent: true });
  } else if (e.melt > 0 && !e.meltPermanent) {
    e.melt = Math.max(e.kind === 'wall' ? e.melt : 0, e.melt - dt * 0.2);   // walls stay slumped
  }
  if (e._dreamMats || e.melt > 0) {
    for (const d of ensureDream(e)) d.u.uMelt.value = e.melt;
  }
  if (e.melt >= 1 && !e.dead) e.onMelted();

  // burning: damage, spread, char, burn out
  if (P.has('burning') && e.innate.has('burning')) {
    // a candle's flame: lights whatever touches it, but stays put
    if (Math.random() < dt * 3) game.vfx.add.spawn({ x: pos.x, y: pos.y + e.extent.y, z: pos.z, vy: 0.8, color: new THREE.Color('#ffb04a').multiplyScalar(4), alpha: 1, alpha1: 0, size: 0.06, life: 0.6 });
  } else if (P.has('burning')) {
    e.burnT += dt;
    e.char = Math.min(1, e.char + dt * 0.08);
    if (e.kind === 'enemy' || e.kind === 'boss') e.damage((e.kind === 'boss' ? 14 : 7) * pw * dt, { type: 'fire', silent: true });
    else if (e.flammable) e.damage(8 * dt, { type: 'fire', silent: true });
    if (P.has('sleeping')) e.removeProp('sleeping');
    e.spreadT -= dt;
    if (e.spreadT <= 0) {
      e.spreadT = 0.45;
      for (const o of game.entities) {
        if (o === e || o.dead || o.props.has('burning') || !(o.flammable || o.kind === 'enemy')) continue;
        if (o.center().distanceToSquared(pos) < (1.8 + e.radius() + o.radius()) ** 2 && Math.random() < 0.35 * pw) o.addProp('burning', { quiet: true });
      }
      if (game.player && game.player.pos.distanceTo(pos) < 1.4 + e.radius() && Math.random() < 0.25) game.player.hurt(6, { type: 'fire', from: pos });
    }
    const burnLife = e.innate.has('burning') ? Infinity : (e.flammable ? 14 : 7);
    if (e.burnT > burnLife) e.removeProp('burning');
    if (!e.fireLight && e.kind !== 'wall') e.fireLight = game.render.claim(e, 0xff7a2a, 7 * (0.6 + e.radius()), 7);
    if (e.fireLight) e.fireLight.position.set(pos.x, pos.y + e.extent.y * 0.6, pos.z);
    if (Math.random() < dt * 1.5) { e._charDirty = true; }
    if (e._charDirty) { e._charDirty = false; refreshLook(e); }
  }

  // bursting: the fuse
  if (P.has('bursting') && !e.innate.has('bursting')) {
    if (!P.has('sleeping')) e.fuse -= dt * (P.has('burning') ? 2.2 : 1);
    const k = 1 - Math.max(0, e.fuse) / e.fuseMax;
    const throb = 1 + Math.sin(game.time * (10 + k * 40)) * 0.04 * k;
    e.obj.scale.setScalar(e.baseScale * throb);
    if (e.fuse <= 0 && !e.dead) {
      e.removeProp('bursting', { quiet: true });
      game.explode(pos, {
        radius: 4.2 * pw * (P.has('heavy') ? 1.5 : 1) * (e.kind === 'wall' ? 1.2 : 1),
        damage: 70 * pw, implode: P.has('hollow'), shards: P.has('reflecting'), ignite: P.has('burning'),
        source: e, carry: [...P].filter((p) => p !== 'bursting' && p !== 'multiplying'),
      });
      if (e.kind === 'enemy' || (e.kind === 'prop' && !e.persistent)) e.die({ type: 'burst' });
      else if (e.kind === 'wall') e.fracture(pos, 1.2);
    }
  }

  // floating things pressed against the dream's ceiling are crushed by the sky
  if (P.has('floating') && e.body && e.kind === 'enemy') {
    const t = e.body.translation();
    if (t.y > TUNE.ceiling - 3.2) e.damage(12 * dt * pw, { type: 'sky', silent: true });
  }

  // heavy things falling fast crush what they land on
  if (P.has('heavy') && e.body && e.body.isDynamic()) {
    const v = e.body.linvel();
    if (v.y < -7) {
      for (const o of game.entities) {
        if (o === e || o.dead || (o.kind !== 'enemy' && o.kind !== 'boss')) continue;
        const oc = o.center();
        if (Math.abs(oc.x - pos.x) < e.radius() + 0.5 && Math.abs(oc.z - pos.z) < e.radius() + 0.5 && oc.y < pos.y && pos.y - oc.y < 2.5) {
          o.damage(-v.y * 7, { type: 'crush', dir: new THREE.Vector3(0, -1, 0) });
          game.vfx.dust(oc, 1.2);
        }
      }
    }
  }

  // ambient visual emitters
  for (const p of P) {
    if (e.innate.has(p)) continue;
    game.vfx.emitFor(p, pos, e.extent, dt, e.kind === 'wall' ? 2 : 1);
  }
}

// ---------------------------------------------------------------------------
// Giving and taking
// ---------------------------------------------------------------------------
const NATURAL_KIND = {
  // which properties would be *expected* on a thing - giving anything else is more absurd
  Clock: ['melting'], Cloud: ['floating'], Mirror: ['reflecting'], Candle: ['burning'], Anvil: ['heavy'],
  Bed: ['sleeping'], BowlerHat: ['multiplying'], Birdcage: ['hollow'], Pomegranate: ['bursting'],
};

export function lucidityForGive(game, target, prop) {
  const L = game.lucidity;
  let v = 3;
  const reasons = [];
  const others = target === 'self' ? [...game.player.self.keys()] : target === 'rounds' ? [...game.player.roundProps.keys()] : [...target.props].filter((p) => p !== prop);
  if (others.length) { v += others.length * 4; reasons.push('stacked'); }
  for (const o of others) {
    const key = [o, prop].sort().join('+');
    if (!L.seenPairs.has(key)) { L.seenPairs.add(key); v += 6; reasons.push('new combo'); }
  }
  if (target === 'self') { v += 5; reasons.push('on yourself'); }
  else if (target === 'rounds') { v += 3; }
  else {
    const nat = NATURAL_KIND[target.name] || [];
    if (!nat.includes(prop)) { v += 3; }
    if (target.kind === 'wall') v += 1;
    if (target.kind === 'boss') v += 6;
  }
  return { v, reason: reasons.length ? reasons[reasons.length - 1] : 'absurdity' };
}

export function giveTo(game, target, prop) {
  if (!target || target.dead) return false;
  if (target.kind === 'boss' && prop === 'multiplying') { game.ui.toast('It refuses to be more than one.'); return false; }
  if (target.props.has(prop) && !target.innate.has(prop)) {
    // re-giving restarts the effect (e.g. a fresh fuse) but earns little
    if (prop === 'bursting') target.fuse = target.fuseMax;
    return true;
  }
  const { v, reason } = lucidityForGive(game, target, prop);
  if (target.innate.has(prop)) { target.innate.delete(prop); target.props.delete(prop); } // wake a dormant property (a ripe pomegranate)
  target.addProp(prop, { given: true });
  game.lucidity.gain(v, reason);
  game.stats.gives++;
  game.recordCombo(prop);
  if (prop === 'multiplying') multiply(game, target);
  return true;
}

// choose which property a take would steal
export function takeCandidate(target) {
  if (!target || target.dead) return null;
  const list = [...target.props];
  if (!list.length) return null;
  const given = list.filter((p) => !target.innate.has(p));
  return (given.length ? given : list)[(given.length ? given : list).length - 1];
}

export function takeFrom(game, target) {
  const p = takeCandidate(target);
  if (!p) return null;
  const wasInnate = target.innate.has(p);
  target.removeProp(p, { taken: true });
  if (wasInnate) { target.innate.delete(p); target.regrow.set(p, game.time + 22); }
  if (target.kind === 'boss' && game.boss) game.boss.onTaken(p);
  return p;
}

function multiply(game, e) {
  e.removeProp('multiplying', { quiet: true });
  if (game.entities.size > 170) { game.ui.toast('The dream is too crowded to hold more.'); return; }
  const carry = [...e.props].filter((p) => p !== 'multiplying');
  const c = e.center();
  for (let i = 0; i < 2; i++) {
    const off = new THREE.Vector3(i ? -1 : 1, 0, 0);
    if (e.kind === 'wall') off.applyQuaternion(e.obj.quaternion).multiplyScalar(4.1);
    else off.applyAxisAngle(up, Math.random() * 6.28).multiplyScalar(e.radius() * 2 + 0.8);
    const pos = e.obj.position.clone().add(off);
    if (e.kind !== 'wall') pos.y += 0.4 + i * 0.3;
    const copy = game.spawnCopy(e, pos);
    if (!copy) continue;
    copy.innate = new Set(e.innate);
    for (const p of carry) copy.addProp(p, { quiet: true, given: !e.innate.has(p) });
    if (copy.kind === 'enemy') { copy.hp = copy.maxHp = Math.max(20, e.hp * 0.5); }
    copy.popIn = 0.001;
    game.vfx.propertyBurst(copy.center(), 'multiplying', 0.7);
  }
  if (e.kind === 'enemy') e.hp = e.maxHp = Math.max(20, e.hp * 0.5);
  game.audio.sfx('multiply', { position: c, quantize: 'loose' });
}

// ---------------------------------------------------------------------------
// Rounds: property infusions change what a round does on impact
// ---------------------------------------------------------------------------
export function roundImpact(game, round, hit) {
  const e = hit.entity;
  const P = round.props;
  const pw = game.lucidity.power;
  let dmg = TUNE.roundDamage * (P.has('heavy') ? 1.6 : 1);
  if (e && !e.dead && e !== game.player) {
    for (const p of P) {
      if (p === 'reflecting' || p === 'multiplying' || p === 'hollow') continue;
      const need = p === 'bursting' ? 99 : (p === 'melting' || p === 'floating') ? 3 : 2;
      e.partial[p] = (e.partial[p] || 0) + 1;
      if (e.partial[p] >= need && !e.props.has(p)) { e.partial[p] = 0; e.addProp(p, { given: true }); game.lucidity.gain(1); }
    }
    if (P.has('floating') && e.body && e.body.isDynamic()) e.body.applyImpulse({ x: 0, y: 3 * e.body.mass(), z: 0 }, true);
    if (P.has('heavy') && e.body && e.body.isDynamic()) {
      const d = round.vel.clone().normalize().multiplyScalar(6 * e.body.mass() * pw);
      e.body.applyImpulseAtPoint(d, hit.point, true);
    }
    e.damage(dmg, { type: 'round', point: hit.point, dir: round.vel.clone().normalize(), heavy: P.has('heavy') });
  }
  if (P.has('bursting')) {
    game.explode(hit.point.clone().addScaledVector(hit.normal, 0.2), { radius: 2.2 * pw, damage: 26 * pw, small: true, source: 'player-round' });
  }
}

export { PROPS, PROP_INFO };
