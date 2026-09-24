// Thin wrapper around Rapier: world stepping, body creation helpers,
// collider -> entity lookup, queries and contact-force events.
import RAPIER from 'rapier';
import * as THREE from 'three';
import { G, groups, ALL } from './config.js';

export { RAPIER };

const _v = new THREE.Vector3();
const _q = new THREE.Quaternion();

export class Physics {
  static async create() {
    await RAPIER.init();
    return new Physics();
  }

  constructor() {
    this.world = new RAPIER.World({ x: 0, y: -26, z: 0 });
    this.world.numSolverIterations = 6;
    this.events = new RAPIER.EventQueue(true);
    this.owner = new Map();     // collider handle -> entity
    this.forceHandlers = [];    // fn(entityA, entityB, force, colliderA, colliderB)
    this.acc = 0;
    this.step = 1 / 60;
    this.alpha = 0;
  }

  // is this body still in the world? (a JS handle outlives the body it names)
  live(body) { return !!body && this.world.getRigidBody(body.handle) === body; }
  setOwner(collider, entity) { this.owner.set(collider.handle, entity); }
  ownerOf(collider) { return collider ? this.owner.get(collider.handle) : null; }

  update(dt) {
    this.acc += Math.min(dt, 0.1);
    let n = 0;
    while (this.acc >= this.step && n < 4) {
      if (this.beforeStep) this.beforeStep(this.step);
      this.world.timestep = this.step;
      this.world.step(this.events);
      this.acc -= this.step;
      n++;
      // collect, then dispatch: handlers break and kill things (removing bodies), and
      // nothing may throw or touch the world while Rapier is inside the drain
      const ev = this._ev || (this._ev = []);
      ev.length = 0;
      this.events.drainContactForceEvents((e) => { ev.push(e.collider1(), e.collider2(), e.maxForceMagnitude()); });
      for (let k = 0; k < ev.length; k += 3) {
        const c1 = this.world.getCollider(ev[k]), c2 = this.world.getCollider(ev[k + 1]);
        if (!c1 || !c2) continue; // removed by an earlier handler
        const a = this.ownerOf(c1), b = this.ownerOf(c2);
        for (const h of this.forceHandlers) h(a, b, ev[k + 2], c1, c2);
      }
    }
    if (this.acc > this.step) this.acc = 0;
    this.alpha = this.acc / this.step;
  }

  // ---- body helpers ------------------------------------------------------
  fixed(pos, rot) {
    const d = RAPIER.RigidBodyDesc.fixed().setTranslation(pos.x, pos.y, pos.z);
    if (rot) d.setRotation({ x: rot.x, y: rot.y, z: rot.z, w: rot.w });
    return this.world.createRigidBody(d);
  }
  dynamic(pos, rot, opts = {}) {
    const d = RAPIER.RigidBodyDesc.dynamic().setTranslation(pos.x, pos.y, pos.z)
      .setLinearDamping(opts.linDamp ?? 0.05).setAngularDamping(opts.angDamp ?? 0.4)
      .setCanSleep(true);
    if (rot) d.setRotation({ x: rot.x, y: rot.y, z: rot.z, w: rot.w });
    if (opts.ccd) d.setCcdEnabled(true);
    if (opts.gravityScale !== undefined) d.setGravityScale(opts.gravityScale);
    return this.world.createRigidBody(d);
  }
  kinematic(pos) {
    return this.world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(pos.x, pos.y, pos.z));
  }
  collider(desc, body, member, filter = ALL, opts = {}) {
    desc.setCollisionGroups(groups(member, filter));
    if (opts.friction !== undefined) desc.setFriction(opts.friction);
    if (opts.restitution !== undefined) desc.setRestitution(opts.restitution);
    if (opts.density !== undefined) desc.setDensity(opts.density);
    if (opts.sensor) desc.setSensor(true);
    if (opts.forceEvents) {
      desc.setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS);
      desc.setContactForceEventThreshold(opts.forceEvents);
    }
    return this.world.createCollider(desc, body);
  }
  remove(body) {
    if (!body) return;
    const n = body.numColliders();
    for (let i = 0; i < n; i++) this.owner.delete(body.collider(i).handle);
    this.world.removeRigidBody(body);
  }

  // ---- queries -----------------------------------------------------------
  // Raycast returning {point, normal, dist, collider, entity}
  ray(origin, dir, maxDist, filterMask = ALL, exclude = null, predicate = null) {
    const r = new RAPIER.Ray(origin, dir);
    const hit = this.world.castRayAndGetNormal(r, maxDist, true, undefined, groups(ALL, filterMask), undefined, exclude, predicate || undefined);
    if (!hit) return null;
    const t = hit.timeOfImpact;
    return {
      point: new THREE.Vector3(origin.x + dir.x * t, origin.y + dir.y * t, origin.z + dir.z * t),
      normal: new THREE.Vector3(hit.normal.x, hit.normal.y, hit.normal.z),
      dist: t,
      collider: hit.collider,
      entity: this.ownerOf(hit.collider),
    };
  }
  // all colliders overlapping a sphere
  overlapSphere(center, radius, filterMask = ALL) {
    const out = [];
    const shape = new RAPIER.Ball(radius);
    this.world.intersectionsWithShape(center, { x: 0, y: 0, z: 0, w: 1 }, shape, (c) => { out.push(c); return true; },
      undefined, groups(ALL, filterMask));
    return out;
  }
  sphereCast(origin, dir, radius, maxDist, filterMask = ALL, excludeBody = null) {
    const shape = new RAPIER.Ball(radius);
    const hit = this.world.castShape(origin, { x: 0, y: 0, z: 0, w: 1 }, dir, shape, 0.0, maxDist, true,
      undefined, groups(ALL, filterMask), undefined, excludeBody || undefined);
    if (!hit) return null;
    return { dist: hit.time_of_impact, normal: new THREE.Vector3(-hit.normal1.x, -hit.normal1.y, -hit.normal1.z), collider: hit.collider, entity: this.ownerOf(hit.collider) };
  }

  static syncObject(obj, body) {
    const t = body.translation(), r = body.rotation();
    obj.position.set(t.x, t.y, t.z);
    obj.quaternion.set(r.x, r.y, r.z, r.w);
  }
}

// Build a convex hull collider desc from an Object3D's geometry (in its own local space, scaled)
const hullCache = new WeakMap();
export function hullFromGeometry(geometry, scale = 1, maxPts = 180) {
  let pts = hullCache.get(geometry);
  if (!pts) {
    const pos = geometry.attributes.position;
    const stride = Math.max(1, Math.floor(pos.count / maxPts));
    const arr = [];
    for (let i = 0; i < pos.count; i += stride) arr.push(pos.getX(i), pos.getY(i), pos.getZ(i));
    pts = new Float32Array(arr);
    hullCache.set(geometry, pts);
  }
  if (scale !== 1) {
    const s = new Float32Array(pts.length);
    for (let i = 0; i < pts.length; i++) s[i] = pts[i] * scale;
    return RAPIER.ColliderDesc.convexHull(s);
  }
  return RAPIER.ColliderDesc.convexHull(pts);
}

// Gather all mesh vertices of an object hierarchy into the object's local frame
export function collectPoints(root, maxPts = 400) {
  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const all = [];
  root.traverse((o) => {
    if (!o.isMesh) return;
    const m = new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld);
    const pos = o.geometry.attributes.position;
    const stride = Math.max(1, Math.floor(pos.count / 120));
    for (let i = 0; i < pos.count; i += stride) {
      _v.fromBufferAttribute(pos, i).applyMatrix4(m);
      all.push(_v.x, _v.y, _v.z);
    }
  });
  if (all.length / 3 > maxPts) {
    const step = Math.ceil(all.length / 3 / maxPts);
    const out = [];
    for (let i = 0; i < all.length / 3; i += step) out.push(all[i * 3], all[i * 3 + 1], all[i * 3 + 2]);
    return new Float32Array(out);
  }
  return new Float32Array(all);
}

export { _q };
