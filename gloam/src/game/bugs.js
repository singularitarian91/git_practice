// Bugs to catch with the net: they appear by hour, season, weather and
// habitat, flutter / dart / crawl / glow, and flee from a sprinting player.
import * as THREE from 'three';
import { BUGS, ITEMS } from '../data/items.js';
import { ZONES, LOC } from './worldmap.js';
import { inHours, weighted, angleDiff } from './util.js';

export class Bugs {
  constructor(game) {
    this.game = game;
    this.list = [];
    this.spawnT = 1;
    this.group = new THREE.Group();
    game.engine.scene.add(this.group);
    this.scale = new Map();
    this.glintTex = makeGlintTexture();
  }

  eligible() {
    const g = this.game;
    const h = g.hour % 24;
    const out = [];
    for (const [id, b] of Object.entries(BUGS)) {
      if (!b.seasons.includes(g.season)) continue;
      if (!inHours(h, b.hours[0], b.hours[1])) continue;
      if (g.state.weather === 'rain' || g.state.weather === 'storm') { if (b.move !== 'crawl') continue; }
      let w = b.rarity;
      if (b.fogBonus && g.state.weather === 'fog') w *= 2;
      out.push([id, w]);
    }
    return out;
  }

  locate(id) {
    const g = this.game;
    const b = BUGS[id];
    const p = g.player.pos;
    const t = g.engine.terrain;
    const rnd = Math.random;
    const around = (r0, r1) => { const a = rnd() * 6.28, d = r0 + rnd() * (r1 - r0); return { x: p.x + Math.cos(a) * d, z: p.z + Math.sin(a) * d }; };
    switch (b.where) {
      case 'lights': {
        const ls = [...g.engine.lighting.sources].filter((s) => s.enabled && s.current > 0.5 && s.pos.distanceTo(p) < 30 && s.pos.distanceTo(p) > 4);
        if (!ls.length) return null;
        const s = ls[Math.floor(rnd() * ls.length)];
        return { x: s.pos.x, y: s.pos.y + 0.3, z: s.pos.z, r: 0.9 };
      }
      case 'trees': {
        const trees = g.resources.trees.filter((tr) => !tr.felled && Math.hypot(tr.x - p.x, tr.z - p.z) < 22 && Math.hypot(tr.x - p.x, tr.z - p.z) > 5);
        if (!trees.length) return null;
        const tr = trees[Math.floor(rnd() * trees.length)];
        const a = rnd() * 6.28;
        const r = 0.3 * tr.scale;
        return { x: tr.x + Math.cos(a) * r, y: tr.y + 1.2 + rnd() * 0.6, z: tr.z + Math.sin(a) * r, face: Math.atan2(Math.cos(a), Math.sin(a)), r: 0 };
      }
      case 'water': {
        for (let k = 0; k < 10; k++) {
          const c = around(6, 22);
          const h = t.heightAt(c.x, c.z);
          if (h > -0.6 && h < 0.6) return { x: c.x, y: Math.max(h, 0) + 0.7 + rnd() * 0.6, z: c.z, r: 2.5 };
        }
        return null;
      }
      case 'graveyard': {
        if (Math.hypot(p.x - ZONES.graveyard.x, p.z - ZONES.graveyard.z) > 35) return null;
        const c = { x: ZONES.graveyard.x + (rnd() - 0.5) * 24, z: ZONES.graveyard.z + (rnd() - 0.5) * 16 };
        return { x: c.x, y: t.heightAt(c.x, c.z) + 0.05, z: c.z, r: 0, ground: true };
      }
      case 'mistwood': {
        if (Math.hypot(p.x - ZONES.mistwood.x, p.z - ZONES.mistwood.z) > ZONES.mistwood.r + 10) return null;
        const c = around(5, 18);
        return { x: c.x, y: t.heightAt(c.x, c.z) + 1 + rnd(), z: c.z, r: 1.5 };
      }
      case 'forest': {
        for (let k = 0; k < 8; k++) {
          const c = around(5, 20);
          if (t.splatAt(c.x, c.z).forest > 0.3) return { x: c.x, y: t.heightAt(c.x, c.z) + 1 + rnd(), z: c.z, r: 1.5 };
        }
        return null;
      }
      default: { // meadow
        for (let k = 0; k < 8; k++) {
          const c = around(5, 20);
          const h = t.heightAt(c.x, c.z);
          const s = t.splatAt(c.x, c.z);
          if (h > 0.8 && s.path < 0.3 && s.plaza < 0.2 && s.forest < 0.5) return { x: c.x, y: h + 0.5 + rnd() * 1.1, z: c.z, r: 1.8 };
        }
        return null;
      }
    }
  }

  modelScale(id) {
    if (this.scale.has(id)) return this.scale.get(id);
    const b = this.game.lib.getBounds(id).getSize(new THREE.Vector3());
    const k = 0.3 / Math.max(0.03, b.x, b.y, b.z);
    this.scale.set(id, k);
    return k;
  }

  spawn() {
    const el = this.eligible();
    if (!el.length) return;
    const id = weighted(el);
    const loc = this.locate(id);
    if (!loc) return;
    const obj = this.game.lib.clone(id);
    obj.scale.setScalar(this.modelScale(id));
    obj.traverse((o) => { if (o.isMesh) o.castShadow = false; });
    this.group.add(obj);
    // a soft twinkle so bugs can be spotted from the camera
    const glint = new THREE.Sprite(new THREE.SpriteMaterial({
      map: this.glintTex, color: 0xffffff, transparent: true, opacity: 0, depthWrite: false,
      depthTest: false, // shines through the leaves over a trunk beetle
    }));
    glint.renderOrder = 2;
    this.group.add(glint);
    const b = { id, B: BUGS[id], obj, glint, anchor: new THREE.Vector3(loc.x, loc.y, loc.z), pos: new THREE.Vector3(loc.x, loc.y, loc.z), r: loc.r, t: Math.random() * 10, fleeing: false, face: loc.face, ground: loc.ground, dartT: 0, dartTo: null };
    this.list.push(b);
  }

  tryCatch(pos, facing) {
    const g = this.game;
    let best = null, bd = 2.3;
    for (const b of this.list) {
      if (b.fleeing) continue;
      const dx = b.pos.x - pos.x, dz = b.pos.z - pos.z;
      const d = Math.hypot(dx, dz);
      if (d > bd) continue;
      if (Math.abs(angleDiff(facing, Math.atan2(dx, dz))) > 1.1 && d > 0.8) continue;
      if (b.pos.y - pos.y > 2.6) continue;
      best = b; bd = d;
    }
    if (!best) return false;
    const chance = best.B.move === 'dart' ? 0.75 : 0.93;
    if (Math.random() > chance) { this.flee(best); g.toast('It slipped through the net!', 'info'); return true; }
    const left = g.inventory.add(best.id, 1);
    if (left) g.drops.spawn(best.id, 1, best.pos.clone());
    g.state.stats.bugs++;
    const first = !g.state.seen['_' + best.id];
    g.state.seen['_' + best.id] = true;
    g.ui.pickup(best.id, 1, first);
    if (first) g.toast(`New bug: ${ITEMS[best.id].name}! (Morrow will… tolerate it.)`, 'new');
    g.audio.sfx('bug_catch');
    g.effects.burst('sparkle', best.pos, { n: 8 });
    this.remove(best);
    return true;
  }

  flee(b) {
    b.fleeing = true;
    b.fleeDir = Math.random() * 6.28;
    b.fleeT = 0;
  }

  remove(b) {
    b.obj.removeFromParent();
    if (b.glint) { b.glint.removeFromParent(); b.glint.material.dispose(); }
    const i = this.list.indexOf(b);
    if (i >= 0) this.list.splice(i, 1);
  }

  update(dt) {
    const g = this.game;
    const p = g.player.pos;
    this.spawnT -= dt;
    if (this.spawnT <= 0) {
      this.spawnT = 1.8;
      if (this.list.length < 7) this.spawn();
    }
    const el = new Set(this.eligible().map((e) => e[0]));
    for (let i = this.list.length - 1; i >= 0; i--) {
      const b = this.list[i];
      b.t += dt;
      const dist = Math.hypot(b.pos.x - p.x, b.pos.z - p.z);
      if (dist > 38 || (!el.has(b.id) && dist > 12)) { this.remove(b); continue; }
      if (!b.fleeing && dist < 4.5 && g.player.sprinting) this.flee(b);
      if (b.fleeing) {
        b.fleeT += dt;
        b.pos.x += Math.cos(b.fleeDir) * 6 * dt;
        b.pos.z += Math.sin(b.fleeDir) * 6 * dt;
        b.pos.y += 3 * dt;
        if (b.fleeT > 2.5) { this.remove(b); continue; }
      } else {
        const m = b.B.move;
        if (m === 'crawl') {
          b.pos.copy(b.anchor);
          b.pos.y += Math.sin(b.t * 0.7) * 0.15;
          if (b.ground) { b.pos.x += Math.sin(b.t * 0.5) * 0.3; b.pos.z += Math.cos(b.t * 0.4) * 0.3; }
        } else if (m === 'dart') {
          b.dartT -= dt;
          if (b.dartT <= 0 || !b.dartTo) {
            b.dartT = 0.8 + Math.random() * 1.6;
            b.dartTo = b.anchor.clone().add(new THREE.Vector3((Math.random() - 0.5) * 2 * b.r, (Math.random() - 0.3) * 0.6, (Math.random() - 0.5) * 2 * b.r));
          }
          b.pos.lerp(b.dartTo, 1 - Math.exp(-dt * 7));
        } else {
          const r = b.r;
          const k = m === 'glow' ? 0.35 : 1;
          b.pos.set(
            b.anchor.x + Math.sin(b.t * 1.3 * k) * r + Math.sin(b.t * 3.1) * 0.15,
            b.anchor.y + Math.sin(b.t * 2.3 * k) * 0.3 + Math.sin(b.t * 9) * 0.05,
            b.anchor.z + Math.cos(b.t * 1.1 * k) * r + Math.cos(b.t * 2.7) * 0.15,
          );
        }
      }
      b.obj.position.copy(b.pos);
      if (b.glint) {
        const pulse = 0.5 + 0.5 * Math.sin(b.t * 2.6 + i * 1.7);
        // a little toward the camera so a tree trunk doesn't hide it
        const cam = g.engine.camera.position;
        const d = Math.max(0.001, cam.distanceTo(b.pos));
        b.glint.position.set(b.pos.x + (cam.x - b.pos.x) / d * 0.3, b.pos.y + 0.1 + (cam.y - b.pos.y) / d * 0.3, b.pos.z + (cam.z - b.pos.z) / d * 0.3);
        b.glint.scale.setScalar(0.55 + pulse * 0.35);
        b.glint.material.opacity = b.fleeing ? Math.max(0, 0.8 - b.fleeT) : 0.35 + 0.6 * pulse * pulse;
      }
      if (b.face != null && b.B.move === 'crawl') b.obj.rotation.set(0, b.face, 0);
      else b.obj.rotation.set(Math.sin(b.t * 20) * 0.15, b.t * 1.5 + i, Math.sin(b.t * 17) * 0.2);
    }
  }
}

// A small four-point sparkle with a warm halo.
function makeGlintTexture() {
  const S = 64;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const x = c.getContext('2d');
  const g = x.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  g.addColorStop(0, 'rgba(255, 255, 240, 1)');
  g.addColorStop(0.14, 'rgba(255, 226, 140, 0.9)');
  g.addColorStop(0.4, 'rgba(255, 196, 90, 0.28)');
  g.addColorStop(1, 'rgba(255, 180, 70, 0)');
  x.fillStyle = g;
  x.fillRect(0, 0, S, S);
  // four-point star, tapering to the tips
  x.fillStyle = 'rgba(255, 252, 230, 0.95)';
  for (const r of [0, Math.PI / 2]) {
    x.save(); x.translate(S / 2, S / 2); x.rotate(r);
    x.beginPath(); x.moveTo(-S * 0.46, 0); x.lineTo(0, -2.2); x.lineTo(S * 0.46, 0); x.lineTo(0, 2.2); x.closePath(); x.fill();
    x.restore();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
