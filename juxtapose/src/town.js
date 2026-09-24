// The town: static buildings from the Blender kit (assets/town.glb). Each
// building brings its own box/trimesh colliders (children named *_COL*), and
// SLOT_* empties that tell the game where to put the dream's props, breakable
// wall panels, lamps, hidden scraps and enemy spawns. A handful of pooled
// point lights follow the player from lamp to lamp so interiors glow.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RAPIER } from './physics.js';
import { G, ALL } from './config.js';

const PROP_KINDS = new Set(['Clock', 'Candle', 'Mirror', 'Anvil', 'Bed', 'BowlerHat', 'Birdcage', 'Pomegranate', 'Drawers', 'Frame', 'Cloud']);
const _v = new THREE.Vector3(), _q = new THREE.Quaternion(), _s = new THREE.Vector3();

// footprints from the kit spec: used for placeholders until the kit exists
const SPEC = {
  B_Workshop: [12, 8, 6.5], B_Cottage: [8, 8, 4.2], B_House: [8, 12, 7.8], B_Chapel: [10, 18, 9],
  B_Station: [16, 6, 5.5], B_StationPlatform: [30, 5, 1], B_Tower: [6, 6, 14], B_Boathouse: [10, 8, 5.5], B_Loggia: [16, 5, 4.6],
};

export class Town {
  constructor(level) {
    this.level = level;
    this.game = level.game;
    this.rects = [];      // building footprints: sand locks and spawn exclusion
    this.lamps = [];      // interior/street lamp positions
    this.lit = new Map(); // lamp index -> pooled light
    this.lampT = 0;
  }

  // Place a kit piece. opts: { y, lock (default true for buildings), slots (default true) }
  place(name, x, z, rotY = 0, opts = {}) {
    const game = this.game, level = this.level;
    const real = game.assets.has(name);
    const o = real ? this.merged(name).clone(true) : this.placeholder(name);
    // footprint in the piece's own frame, before it is moved
    o.position.set(0, 0, 0); o.rotation.set(0, 0, 0); o.scale.setScalar(opts.scale || 1);
    o.updateMatrixWorld(true);
    const box = new THREE.Box3();
    o.traverse((m) => { if (m.isMesh && !/_COL/.test(m.name)) { m.geometry.computeBoundingBox(); box.union(m.geometry.boundingBox.clone().applyMatrix4(m.matrixWorld)); } });
    const y = opts.y ?? level.heightAt(x, z);
    o.position.set(x, y, z); o.rotation.y = rotY;
    level.group.add(o);
    o.updateMatrixWorld(true);
    // colliders
    const body = game.physics.fixed({ x: 0, y: 0, z: 0 });
    o.traverse((m) => {
      if (!m.isMesh || !/_COL/.test(m.name)) return;
      m.visible = false;
      m.matrixWorld.decompose(_v, _q, _s);
      const g = m.geometry;
      if (/_TRI/.test(m.name)) {
        const p = g.attributes.position, verts = new Float32Array(p.count * 3);
        for (let i = 0; i < p.count; i++) { _v.fromBufferAttribute(p, i).applyMatrix4(m.matrixWorld); verts[i * 3] = _v.x; verts[i * 3 + 1] = _v.y; verts[i * 3 + 2] = _v.z; }
        const idx = g.index ? new Uint32Array(g.index.array) : new Uint32Array(p.count).map((_, i) => i);
        game.physics.collider(RAPIER.ColliderDesc.trimesh(verts, idx), body, G.WORLD, ALL, { friction: 0.8 });
      } else {
        g.computeBoundingBox();
        const bb = g.boundingBox, c = bb.getCenter(new THREE.Vector3()).applyMatrix4(m.matrixWorld);
        const hs = bb.getSize(new THREE.Vector3()).multiply(_s).multiplyScalar(0.5);
        m.matrixWorld.decompose(_v, _q, _s);
        const d = RAPIER.ColliderDesc.cuboid(Math.max(0.02, Math.abs(hs.x)), Math.max(0.02, Math.abs(hs.y)), Math.max(0.02, Math.abs(hs.z)))
          .setTranslation(c.x, c.y, c.z).setRotation({ x: _q.x, y: _q.y, z: _q.z, w: _q.w });
        game.physics.collider(d, body, G.WORLD, ALL, { friction: 0.8 });
      }
    });
    level.bodies.push(body);
    o.traverse((m) => { if (m.isMesh && m.visible && !m.userData.keepShadow) { m.castShadow = true; m.receiveShadow = true; } });
    // footprint rect: sand stays out, enemies do not spawn inside
    if (opts.lock ?? /^(B_|T_)/.test(name)) {
      const cx = (box.min.x + box.max.x) / 2, cz = (box.min.z + box.max.z) / 2;
      const off = new THREE.Vector3(cx, 0, cz).applyAxisAngle(new THREE.Vector3(0, 1, 0), rotY);
      const r = { x: x + off.x, z: z + off.z, hw: (box.max.x - box.min.x) / 2, hd: (box.max.z - box.min.z) / 2, rotY, top: y + box.max.y, name };
      this.rects.push(r);
      level.sand?.lockRect(r.x, r.z, r.hw + 0.3, r.hd + 0.3, rotY);
    }
    if (opts.slots !== false) this.fillSlots(o);
    return o;
  }

  // A kit building arrives as ~100 small meshes. Merge them once per template, by
  // material, into a few big ones (hundreds of draw calls become a dozen), and let
  // only the big pieces cast sun shadows. Colliders and slots are carried over as-is.
  merged(name) {
    const assets = this.game.assets;
    const tpl = assets.templates.get(name);
    if (tpl.userData.merged) return tpl.userData.merged;
    const root = new THREE.Group();
    root.name = name;
    tpl.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().copy(tpl.matrixWorld).invert();
    const groups = new Map();
    const rel = (o) => new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld);
    tpl.traverse((o) => { // the root itself may be the mesh (a cliff, a street prop)
      if (o.isMesh && /_COL/.test(o.name)) {
        const c = new THREE.Mesh(o.geometry, o.material);
        c.name = o.name; rel(o).decompose(c.position, c.quaternion, c.scale);
        root.add(c);
      } else if (o.isMesh) {
        const g = o.geometry.clone();
        g.applyMatrix4(rel(o));
        g.computeBoundingSphere();
        const small = g.boundingSphere.radius < (/^T_/.test(name) ? 0.35 : 1.1); // street props are few and short: let them cast
        const sig = Object.keys(g.attributes).sort().join() + (g.index ? '|i' : '|n');
        const key = o.material.uuid + sig + (small ? '|s' : '|l');
        if (!groups.has(key)) groups.set(key, { mat: o.material, small, geos: [] });
        groups.get(key).geos.push(g);
      } else if (/^SLOT_/.test(o.name)) {
        const e = new THREE.Object3D();
        e.name = o.name; rel(o).decompose(e.position, e.quaternion, e.scale);
        root.add(e);
      }
    });
    for (const { mat, small, geos } of groups.values()) {
      const g = geos.length === 1 ? geos[0] : mergeGeometries(geos, false);
      const list = g ? [g] : geos; // attributes that refuse to merge stay separate
      for (const gg of list) {
        const m = new THREE.Mesh(gg, mat);
        m.castShadow = !small; m.receiveShadow = true;
        m.userData.keepShadow = true;
        root.add(m);
      }
    }
    tpl.userData.merged = root;
    return root;
  }

  fillSlots(o) {
    const level = this.level;
    const slots = [];
    o.traverse((m) => { if (/^SLOT_/.test(m.name)) slots.push(m); });
    const R = level.rng || Math.random;
    let props = 0;
    for (const s of slots) {
      const kind = s.name.split('_')[1];
      // the kit offers more prop spots than a room needs; fill about half, at least one per building
      if (PROP_KINDS.has(kind) && props > 0 && R() < 0.5) continue;
      if (PROP_KINDS.has(kind)) props++;
      s.getWorldPosition(_v);
      s.getWorldQuaternion(_q);
      const rotY = new THREE.Euler().setFromQuaternion(_q, 'YXZ').y;
      const p = _v.clone();
      if (PROP_KINDS.has(kind)) {
        const high = p.y - o.position.y > 1.3 && kind !== 'Cloud';
        level.put(kind, p.x, p.z, { y: p.y, rotY, anchored: high || undefined });
      } else if (kind === 'panel') { if (this.game.assets.has('TP_Stucco')) level.put('TP_Stucco', p.x, p.z, { y: p.y, rotY }); }
      else if (kind === 'light') this.lamps.push(p);
      else if (kind === 'scrap') level.scrapSpots.push(p.add(new THREE.Vector3(0, 0.9, 0)));
      else if (kind === 'spawn') level.spawnPoints.push(p);
    }
  }

  // is (x, z) inside any building footprint (plus margin)?
  inside(x, z, margin = 0.5) {
    for (const r of this.rects) {
      const dx = x - r.x, dz = z - r.z, c = Math.cos(-r.rotY), s = Math.sin(-r.rotY);
      const lx = dx * c + dz * s, lz = -dx * s + dz * c;
      if (Math.abs(lx) < r.hw + margin && Math.abs(lz) < r.hd + margin) return r;
    }
    return null;
  }

  // lamps: the nearest few borrow a pooled light, handed on as the player moves
  update(dt) {
    const game = this.game, p = game.player;
    if (!p || !this.lamps.length) return;
    this.lampT -= dt;
    if (this.lampT > 0) return;
    this.lampT = 0.4;
    const want = this.lamps.map((l, i) => [i, l.distanceToSquared(p.pos)]).filter(([, d]) => d < 28 * 28).sort((a, b) => a[1] - b[1]).slice(0, 3).map(([i]) => i);
    for (const [i, l] of this.lit) if (!want.includes(i)) { game.render.release(l); this.lit.delete(i); }
    for (const i of want) {
      if (this.lit.has(i)) continue;
      const l = game.render.claim(this, 0xffb867, 5, 9);
      if (!l) break;
      l.position.copy(this.lamps[i]);
      l.userData.flicker = 0.08;
      this.lit.set(i, l);
    }
  }

  // until the Blender kit lands: a plain shell with a doorway and a walkable roof
  placeholder(name) {
    const [w, d, h] = SPEC[name] || [6, 6, 4];
    const g = new THREE.Group();
    g.name = name;
    const mat = new THREE.MeshStandardMaterial({ color: '#efe6d6', roughness: 0.9 });
    const add = (sx, sy, sz, x, y, z) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), mat);
      m.position.set(x, y, z);
      g.add(m);
      const c = m.clone(); c.name = name + '_COL_' + g.children.length; g.add(c);
    };
    if (name === 'B_StationPlatform') { add(w, h, d, 0, h / 2, 0); return g; }
    const t = 0.4, door = 1.6;
    add(w, 0.3, d, 0, 0.15, 0);                                   // floor
    add(w, t, d, 0, h - t / 2, 0);                                // roof
    add(t, h, d, -w / 2 + t / 2, h / 2, 0); add(t, h, d, w / 2 - t / 2, h / 2, 0); // sides
    add(w, h, t, 0, h / 2, -d / 2 + t / 2);                       // back
    const side = (w - door) / 2;
    add(side, h, t, -w / 2 + side / 2, h / 2, d / 2 - t / 2);     // front, either side of the door
    add(side, h, t, w / 2 - side / 2, h / 2, d / 2 - t / 2);
    add(door, h - 2.6, t, 0, 2.6 + (h - 2.6) / 2, d / 2 - t / 2); // lintel
    // a threshold ramp up onto the floor slab (the controller will not step it)
    const ramp = new THREE.Mesh(new THREE.BoxGeometry(door, 0.12, 1.2), mat);
    ramp.position.set(0, 0.12, d / 2 + 0.5); ramp.rotation.x = 0.28;
    g.add(ramp); const rc = ramp.clone(); rc.name = name + '_COL_ramp'; g.add(rc);
    return g;
  }
}
