// Projectiles: the gun's dream rounds (with property infusions), the
// take/give property orbs, and enemy / boss orbs.
import * as THREE from 'three';
import { G, ALL, TUNE, PROP_INFO, groups } from './config.js';
import { roundImpact } from './properties.js';
import { RAPIER } from './physics.js';
import { addPosture } from './combat.js';

const _d = new THREE.Vector3();
const _r = new THREE.Vector3();

export class Projectiles {
  constructor(game) {
    this.game = game;
    this.list = [];
    this.geoRound = new THREE.SphereGeometry(0.065, 10, 8);
    this.geoOrb = new THREE.IcosahedronGeometry(0.22, 2);
    this.mats = new Map();
  }
  mat(color, strength = 4) {
    const k = color + strength;
    let m = this.mats.get(k);
    if (!m) {
      m = new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(strength), toneMapped: true });
      this.mats.set(k, m);
    }
    return m;
  }
  clear() { for (const p of this.list) p.mesh.parent?.remove(p.mesh); this.list = []; }

  roundColor(props) {
    if (!props.size) return '#fff2c8';
    const cols = [...props].map((p) => new THREE.Color(PROP_INFO[p].color));
    const c = cols.reduce((a, b) => a.add(b), new THREE.Color(0, 0, 0)).multiplyScalar(1 / cols.length);
    return '#' + c.getHexString();
  }

  fireRound(origin, dir, props, opts = {}) {
    const speed = opts.speed || TUNE.roundSpeed;
    const vel = dir.clone().normalize().multiplyScalar(speed);
    const spawn = (v) => {
      const color = this.roundColor(props);
      const mesh = new THREE.Mesh(this.geoRound, this.mat(color, 5));
      mesh.position.copy(origin);
      this.game.scene.add(mesh);
      this.list.push({ type: 'round', owner: 'player', pos: origin.clone(), vel: v, props: new Set(props), mesh, color, life: props.has('reflecting') ? 4 : 1.6,
        bounces: 0, maxBounces: props.has('reflecting') ? 14 : 0, pierced: new Set() });
    };
    if (props.has('multiplying') && !opts.split) {
      const right = new THREE.Vector3().crossVectors(vel, new THREE.Vector3(0, 1, 0)).normalize();
      for (const k of [-1, 0, 1]) spawn(vel.clone().addScaledVector(right, k * speed * 0.07));
    } else spawn(vel);
  }

  // an orb that travels to a point and calls back on arrival (take/give visuals)
  propertyShot(from, to, color, speed, onArrive, followTarget = null) {
    const mesh = new THREE.Mesh(this.geoOrb, this.mat(color, 6));
    mesh.scale.setScalar(0.6);
    mesh.position.copy(from);
    this.game.scene.add(mesh);
    this.list.push({ type: 'shot', pos: from.clone(), to: to.clone(), speed, onArrive, mesh, color, follow: followTarget, life: 3 });
  }

  enemyOrb(origin, vel, opts = {}) {
    const color = opts.color || '#7ff7ff';
    const mesh = new THREE.Mesh(this.geoOrb, this.mat(color, 5));
    mesh.scale.setScalar(opts.size || 1);
    mesh.position.copy(origin);
    this.game.scene.add(mesh);
    this.list.push({ type: 'orb', owner: 'enemy', pos: origin.clone(), vel: vel.clone(), mesh, color, life: opts.life || 6, damage: opts.damage || 12,
      props: opts.props || [], homing: opts.homing || 0, shooter: opts.shooter || null, radius: 0.28 * (opts.size || 1), bounces: 0 });
  }

  clearNear(pos, R, owner) {
    for (const p of this.list) if (p.owner === owner && p.type === 'orb' && p.pos.distanceTo(pos) < R) { p.life = 0; this.game.vfx.impact(p.pos, new THREE.Vector3(0, 1, 0), p.color, 0.5); }
  }

  update(dt) {
    const game = this.game;
    for (let i = this.list.length - 1; i >= 0; i--) {
      const p = this.list[i];
      p.life -= dt;
      let alive = p.life > 0;
      if (alive) {
        if (p.type === 'round') alive = this.stepRound(p, dt);
        else if (p.type === 'shot') alive = this.stepShot(p, dt);
        else alive = this.stepOrb(p, dt);
      }
      if (!alive) { p.mesh.parent?.remove(p.mesh); this.list.splice(i, 1); continue; }
      p.mesh.position.copy(p.pos);
    }
  }

  stepRound(p, dt) {
    const game = this.game;
    if (game.portals && game.portals.passProjectile(p, dt)) return true;
    const len = p.vel.length() * dt;
    _d.copy(p.vel).normalize();
    let mask = ALL & ~G.PLAYER & ~G.GHOST;
    game.vfx.trail(p.pos, p.color, p.props.size ? 0.11 : 0.07, 0.12);
    if (p.props.has('hollow')) {
      // pierce: damage everything along the segment, never stop
      const r = new RAPIER.Ray(p.pos, _d);
      game.physics.world.intersectionsWithRay(r, len, true, (hit) => {
        const e = game.physics.ownerOf(hit.collider);
        if (e && !p.pierced.has(e.id)) {
          p.pierced.add(e.id);
          const pt = p.pos.clone().addScaledVector(_d, hit.timeOfImpact);
          if (e.kind === 'boss') e.hitByRound(p, { point: pt, normal: _d.clone().negate(), entity: e });
          else roundImpact(game, p, { point: pt, normal: _d.clone().negate(), entity: e });
        }
        return true;
      }, undefined, groups(ALL, G.ENEMY | G.PROP | G.WALL | G.WORLD | G.DEBRIS));
      p.pos.addScaledVector(p.vel, dt);
      return true;
    }
    const hit = game.physics.ray(p.pos, _d, len, mask);
    if (!hit) { p.pos.addScaledVector(p.vel, dt); return true; }
    const e = hit.entity;
    if (p.props.has('framed') && game.portals) {
      // framed rounds hang a portal wherever they land
      game.portals.place({ point: hit.point, normal: hit.normal, entity: e, collider: hit.collider }, 'round');
      return false;
    }
    const mirror = e && (e.props.has('reflecting'));
    if ((p.props.has('reflecting') || mirror) && p.bounces < Math.max(p.maxBounces, mirror ? 8 : 0)) {
      if (e && !mirror) {
        if (e.kind === 'boss') e.hitByRound(p, hit); else roundImpact(game, p, hit);
      }
      if (e && e.kind === 'boss' && mirror) e.hitByRound(p, hit);
      p.bounces++;
      _r.copy(p.vel).reflect(hit.normal);
      p.vel.copy(_r);
      p.pos.copy(hit.point).addScaledVector(hit.normal, 0.03);
      p.life = Math.max(p.life, 0.8);
      game.vfx.impact(hit.point, hit.normal, '#e6f2ff', 0.4);
      if (p.bounces % 2 === 0) game.audio.sfx('reflect', { position: hit.point, quantize: 'loose', gain: 0.5 });
      return true;
    }
    if (e && e.kind === 'boss') e.hitByRound(p, hit);
    else {
      roundImpact(game, p, hit);
      if (!e) game.vfx.impact(hit.point, hit.normal, '#e0c79a', 0.6);
    }
    if (hit.collider && hit.collider.parent() && hit.collider.parent().isDynamic() && !e) {
      hit.collider.parent().applyImpulseAtPoint(_d.clone().multiplyScalar(0.6), hit.point, true);
    }
    return false;
  }

  stepShot(p, dt) {
    if (p.follow) p.to.copy(p.follow());
    const d = _d.copy(p.to).sub(p.pos);
    const dist = d.length();
    const step = p.speed * dt;
    this.game.vfx.trail(p.pos, p.color, 0.22, 0.3);
    if (dist <= step) { p.pos.copy(p.to); p.onArrive && p.onArrive(); return false; }
    p.pos.addScaledVector(d.normalize(), step);
    p.mesh.rotation.x += dt * 8; p.mesh.rotation.y += dt * 6;
    return true;
  }

  stepOrb(p, dt) {
    const game = this.game;
    if (game.portals && game.portals.passProjectile(p, dt)) return true;
    const pl = game.player;
    if (p.owner === 'enemy' && p.homing && pl && !pl.dead && !pl.self.has('sleeping')) {
      const to = pl.pos.clone().setY(pl.pos.y + 1).sub(p.pos).normalize().multiplyScalar(p.vel.length());
      p.vel.lerp(to, Math.min(1, p.homing * dt));
    }
    game.vfx.trail(p.pos, p.color, 0.25, 0.35);
    const len = p.vel.length() * dt;
    _d.copy(p.vel).normalize();
    // player hit?
    if (p.owner === 'enemy' && pl && !pl.dead) {
      const c = pl.pos.clone(); c.y += 0.9;
      const segDist = distPointSegment(c, p.pos, p.pos.clone().addScaledVector(_d, len));
      if (segDist < 0.55 + p.radius) {
        const res = pl.self.has('reflecting') || pl.self.has('hollow') ? 'skip' : pl.incoming('orb', p.damage, p.pos.clone(), { type: 'orb', props: p.props, shooter: p.shooter });
        if (res === 'deflect') {
          pl.reflectOrb(p);
          return true;
        } else if (res === 'guard' || res === 'hit') {
          game.vfx.impact(p.pos, _d.clone().negate(), p.color, res === 'guard' ? 0.6 : 1);
          return false;
        } else if (res === 'ignore') { /* passes through */ }
        else if (pl.self.has('hollow')) { /* passes through */ }
        else if (pl.self.has('reflecting')) {
          p.owner = 'player';
          const target = p.shooter && !p.shooter.dead ? p.shooter.center() : p.pos.clone().sub(p.vel);
          p.vel.copy(target.sub(p.pos).normalize().multiplyScalar(p.vel.length() * 1.4));
          p.life = 4;
          game.audio.sfx('reflect', { position: p.pos, quantize: 'loose' });
          game.vfx.impact(p.pos, _d.clone().negate(), '#e6f2ff', 1);
          return true;
        }
      }
    }
    const mask = p.owner === 'enemy' ? (G.WORLD | G.WALL | G.PROP | G.CEIL) : (G.WORLD | G.WALL | G.PROP | G.ENEMY | G.CEIL);
    const hit = game.physics.ray(p.pos, _d, len + p.radius * 0.5, mask);
    if (hit) {
      const e = hit.entity;
      if (p.owner === 'player' && e && (e.kind === 'enemy' || e.kind === 'boss')) {
        if (e.kind === 'boss') { e.damage(p.damage * 3, { type: 'reflected', point: hit.point, force: true }); e.addPosture(p.deflected ? 28 : 15); }
        else { e.damage(p.damage * 2.5, { type: 'reflected', point: hit.point }); addPosture(game, e, p.deflected ? 30 : 18); }
        game.vfx.impact(hit.point, hit.normal, p.color, 1.2);
        return false;
      }
      if (e && e.props.has('reflecting') && p.bounces < 4) {
        p.bounces++;
        p.vel.reflect(hit.normal);
        p.pos.copy(hit.point).addScaledVector(hit.normal, 0.05);
        game.audio.sfx('reflect', { position: hit.point, gain: 0.6 });
        return true;
      }
      game.vfx.impact(hit.point, hit.normal, p.color, 0.8);
      if (p.props && p.props.includes && p.props.includes('bursting')) game.explode(hit.point, { radius: 2.8, damage: 20, source: 'boss' });
      return false;
    }
    p.pos.addScaledVector(p.vel, dt);
    p.mesh.rotation.y += dt * 4;
    return true;
  }
}

function distPointSegment(p, a, b) {
  const ab = b.clone().sub(a);
  const t = Math.max(0, Math.min(1, p.clone().sub(a).dot(ab) / Math.max(1e-6, ab.lengthSq())));
  return a.clone().addScaledVector(ab, t).distanceTo(p);
}
