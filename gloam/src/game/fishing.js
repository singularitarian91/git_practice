// Fishing: cast a bobber, wait for a bite, click to hook, then win the
// reeling minigame (drawn by the UI).  Which fish bites depends on the
// water, hour, season and weather.
import * as THREE from 'three';
import { FISH, ITEMS } from '../data/items.js';
import { LOC, STREAM } from './worldmap.js';
import { inHours, weighted } from './util.js';

function distToPolyline(px, pz, pts) {
  let d = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
    const vx = bx - ax, vz = bz - az, wx = px - ax, wz = pz - az;
    const L = vx * vx + vz * vz;
    const t = Math.max(0, Math.min(1, (wx * vx + wz * vz) / L));
    d = Math.min(d, Math.hypot(wx - vx * t, wz - vz * t));
  }
  return d;
}

export class Fishing {
  constructor(game) {
    this.game = game;
    this.active = false;
    this.phase = null;
    this.reeling = false;
    // bobber
    const g = new THREE.SphereGeometry(0.09, 10, 8);
    const colors = [];
    const pos = g.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const top = pos.getY(i) > 0;
      colors.push(top ? 0.75 : 0.9, top ? 0.12 : 0.88, top ? 0.1 : 0.82);
    }
    g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    this.bobber = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5 }));
    this.bobber.visible = false;
    // line
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(16 * 3), 3));
    this.line = new THREE.Line(lg, new THREE.LineBasicMaterial({ color: 0xd8d0c0, transparent: true, opacity: 0.6 }));
    this.line.visible = false;
    this.line.frustumCulled = false;
    game.engine.scene.add(this.bobber, this.line);
    this.target = new THREE.Vector3();
    this.from = new THREE.Vector3();
  }

  waterType(x, z) {
    const g = this.game;
    const dock = g.world.buildings.get('sea_dock');
    const end = dock && dock.obj.userData.deckEnd;
    const p = g.player.pos;
    if (end && Math.hypot(p.x - end.x, p.z - end.z) < 3.5) return 'dock';
    if (Math.hypot(x - LOC.lake.x, z - LOC.lake.z) < LOC.lake.r * 1.4) return 'lake';
    if (distToPolyline(x, z, STREAM.points) < STREAM.width * 2.2) return 'stream';
    return 'sea';
  }

  cast(pos, facing) {
    const g = this.game;
    if (this.active) return;
    const dx = Math.sin(facing), dz = Math.cos(facing);
    let land = null;
    for (let d = 3; d <= 9; d += 0.5) {
      const x = pos.x + dx * d, z = pos.z + dz * d;
      const h = g.engine.terrain.heightAt(x, z);
      if (h < -0.35 && !g.colliders.platformAt(x, z)) { land = new THREE.Vector3(x, 0, z); if (d >= 5) break; }
    }
    if (!land) { g.toast('Cast toward open water.', 'info'); return; }
    this.active = true;
    this.phase = 'fly';
    this.t = 0;
    this.from.copy(g.player.handWorld());
    this.target.copy(land);
    this.bobber.visible = true;
    this.line.visible = true;
    this.where = this.waterType(land.x, land.z);
    g.audio.sfx('cast');
  }

  pickFish() {
    const g = this.game;
    const h = g.hour % 24;
    const season = g.season;
    const rain = g.state.weather === 'rain' || g.state.weather === 'storm';
    const where = this.where;
    const pool = [];
    for (const [id, f] of Object.entries(FISH)) {
      const okWhere = f.where.includes(where) || (where === 'dock' && f.where.includes('sea')) || (where === 'stream' && f.where.includes('lake') && id !== 'fish_carp');
      if (!okWhere) continue;
      if (!f.seasons.includes(season)) continue;
      if (!inHours(h, f.hours[0], f.hours[1] === 24 ? 24 : f.hours[1])) continue;
      let w = f.rarity;
      if (f.rainBonus && rain) w *= 2.5;
      if (f.legendary && g.state.museum[id]) w *= 0.3;
      pool.push([id, w]);
    }
    if (!pool.length) pool.push([where === 'sea' || where === 'dock' ? 'fish_herring' : 'fish_perch', 1]);
    return weighted(pool);
  }

  reelClick() {
    const g = this.game;
    if (!this.active) return;
    if (this.phase === 'bite') {
      this.phase = 'game';
      this.reeling = true;
      const fish = this.fishId;
      g.audio.sfx('reel');
      const lvl = g.state.flags.bone_rod ? 1 : 0;
      g.ui.fishingGame(FISH[fish], lvl).then((ok) => this.finish(ok));
    } else if (this.phase === 'wait' || this.phase === 'fly') {
      // reel in early
      this.cancel();
      g.audio.sfx('reel', { volume: 0.5 });
    }
  }

  finish(ok) {
    const g = this.game;
    this.reeling = false;
    const id = this.fishId;
    if (ok) {
      const left = g.inventory.add(id, 1);
      if (left) g.drops.spawn(id, 1, g.player.pos.clone().add(new THREE.Vector3(0, 1, 0)));
      g.state.stats.fish++;
      const first = !g.state.seen['_' + id];
      g.state.seen['_' + id] = true;
      g.ui.pickup(id, 1, first);
      g.audio.sfx('fish_catch');
      g.effects.burst('splash', this.target.clone());
      if (first) g.toast(`New catch: ${ITEMS[id].name}! Morrow would want to see this.`, 'new');
      if (FISH[id].legendary) g.toast('A LEGEND! The Drowned Sovereign!', 'new');
    } else {
      g.audio.sfx('fish_escape');
      g.toast('It got away…', 'info');
    }
    this.cancel();
  }

  cancel() {
    this.active = false;
    this.phase = null;
    this.reeling = false;
    this.bobber.visible = false;
    this.line.visible = false;
    this.game.ui.fishingCancel && this.game.ui.fishingCancel();
  }

  update(dt) {
    if (!this.active) return;
    const g = this.game;
    this.t += dt;
    const hand = g.player.handWorld(new THREE.Vector3());
    // rod tip: a bit beyond the hand, in front
    const f = g.player.facing;
    const tip = hand.clone().add(new THREE.Vector3(Math.sin(f) * 1.4, 1.1, Math.cos(f) * 1.4));
    // walking away / swimming cancels
    if (g.player.moveAmt > 0.25 && this.phase !== 'game') { this.cancel(); return; }
    if (this.phase === 'fly') {
      const u = Math.min(1, this.t / 0.6);
      this.bobber.position.lerpVectors(tip, this.target, u);
      this.bobber.position.y += Math.sin(u * Math.PI) * 2.5;
      if (u >= 1) {
        this.phase = 'wait';
        this.t = 0;
        const rain = g.state.weather === 'rain' || g.state.weather === 'storm';
        this.waitFor = (2.5 + Math.random() * 7) * (rain ? 0.7 : 1);
        this.nibbles = 0;
        g.audio.sfx('splash', { x: this.target.x, z: this.target.z, volume: 0.5 });
        g.effects.burst('water', this.target, { n: 8 });
      }
    } else if (this.phase === 'wait') {
      this.bobber.position.set(this.target.x, Math.sin(this.t * 2.5) * 0.03, this.target.z);
      // little nibbles before the real bite
      if (this.t > this.waitFor * 0.5 && this.nibbles < 2 && Math.random() < dt * 0.8) {
        this.nibbles++;
        this.bobber.position.y -= 0.05;
        g.effects.burst('water', this.target, { n: 3 });
      }
      if (this.t > this.waitFor) {
        this.phase = 'bite';
        this.t = 0;
        this.fishId = this.pickFish();
        g.audio.sfx('bite');
        g.effects.burst('splash', this.target, { n: 10 });
        g.ui.biteAlert && g.ui.biteAlert();
      }
    } else if (this.phase === 'bite') {
      this.bobber.position.set(this.target.x, -0.12 + Math.sin(this.t * 30) * 0.03, this.target.z);
      if (this.t > 1.0) {
        g.toast('Too slow — the fish spat the hook.', 'info');
        this.phase = 'wait';
        this.t = 0;
        this.waitFor = 3 + Math.random() * 5;
      }
    } else if (this.phase === 'game') {
      this.bobber.position.set(this.target.x + Math.sin(this.t * 7) * 0.3, -0.05, this.target.z + Math.cos(this.t * 5) * 0.3);
      if (Math.random() < dt * 4) g.effects.burst('water', this.bobber.position, { n: 2 });
    }
    // sagging line
    const P = this.line.geometry.attributes.position;
    const b = this.bobber.position;
    for (let i = 0; i < 16; i++) {
      const u = i / 15;
      const sag = Math.sin(u * Math.PI) * (this.phase === 'game' ? 0.1 : 0.5);
      P.setXYZ(i, tip.x + (b.x - tip.x) * u, tip.y + (b.y - tip.y) * u - sag, tip.z + (b.z - tip.z) * u);
    }
    P.needsUpdate = true;
  }
}
