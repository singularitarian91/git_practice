// The game: owns every system and runs the frame loop's gameplay half.
import * as THREE from 'three';
import { ITEMS, CROPS, isFish, isBug, isRelic } from '../data/items.js';
import { OFFERINGS, DEBT_START, LONGHOUSE_COST } from '../data/world_data.js';
import { InstanceManager } from '../engine/instances.js';
import { Effects } from '../engine/effects.js';
import { Grass } from '../engine/grass.js';
import { FollowCamera } from '../engine/camera.js';
import { globalUniforms } from '../engine/materials.js';
import { Colliders } from './colliders.js';
import { World } from './world.js';
import { Resources } from './resources.js';
import { Farm } from './farm.js';
import { Player } from './player.js';
import { Drops } from './drops.js';
import { Inventory } from './inventory.js';
import { Clock } from './clock.js';
import { NPCs } from './npcs.js';
import { Enemies } from './enemies.js';
import { Fishing } from './fishing.js';
import { Bugs } from './bugs.js';
import { Critters } from './critters.js';
import { saveGame, seasonOf, SEASONS, SEASON_DAYS, DAY_START, HOTBAR } from './state.js';
import { mulberry32 } from '../engine/noise.js';
import { FARM, LOC } from './worldmap.js';
import { fmtTime, pick } from './util.js';

const REACH = 2.7;          // how far the cursor may target tiles/objects
const TILE_TOOLS = new Set(['till', 'water', 'plant']);

export class Game {
  constructor({ engine, lib, audio, ui, input, settings, state, content }) {
    this.content = content || {};
    this.engine = engine;
    this.lib = lib;
    this.audio = audio;
    this.ui = ui;
    this.input = input;
    this.settings = settings;
    this.state = state;
    this.paused = false;
    this.cinematic = false;
    this.hurtVignette = 0;
    this.time = 0;
    this.cursor = new THREE.Vector3();
    this.cursorValid = false;
    this.raycaster = new THREE.Raycaster();

    this.inventory = new Inventory(state);
    this.colliders = new Colliders();
    this.inst = new InstanceManager(lib, engine.scene);
    this.effects = new Effects(engine.scene);
    this.camera = new FollowCamera(engine.camera, engine.terrain);
    this.clock = new Clock(this);

    this.world = new World(this);
    this.world.build();
    this.resources = new Resources(this);
    this.resources.scatter();
    this.resources.build();
    this.grass = new Grass(engine.terrain, {
      density: engine.q.grass,
      radius: engine.q.grassR,
      blocked: (x, z) => this.world.blocked(x, z, -0.6) || this.colliders.overlaps(x, z, 0.15),
    });
    engine.scene.add(this.grass.group);
    this.farm = new Farm(this);
    for (const rec of state.placed) this.world.addPlaced(rec);
    this.drops = new Drops(this);
    this.player = new Player(this);
    this.npcs = new NPCs(this);
    this.enemies = new Enemies(this);
    this.fishing = new Fishing(this);
    this.bugs = new Bugs(this);
    this.critters = new Critters(this);

    this.setupStations();
    if (state.house === 'longhouse') this.swapHouse();
    this.makeHighlight();
    this.applySeason();
    this.world.setHearthLevel(state.offeringsDone.length, state.ending);
    this.camera.yawGoal = 0.35;
    this.camera.snap(this.player.pos);
    engine.focus.copy(this.player.pos);
    this.inst.refresh(this.player.pos, true);
    this.effects.setViewport(engine.renderer.domElement.clientHeight || innerHeight, engine.camera.fov);
    window.addEventListener('resize', () => this.effects.setViewport(engine.renderer.domElement.clientHeight || innerHeight, engine.camera.fov));
    this.lastMusic = null;
    this.prompt = null;
    // a small belt lantern so the night is playable (it does not ward off the Gloam)
    this.playerLight = engine.lighting.add({ pos: this.player.pos, color: 0xffb870, intensity: 4, radius: 9, flicker: 0.25, halo: 0.2, nightOnly: true, safe: 0 });
  }

  get season() { return seasonOf(this.state); }
  get hour() { return this.state.time / 60; }
  get darkness() { return this.engine.atmosphere.state.darkness; }

  // ---------------------------------------------------------------------
  // Frame
  update(dt) {
    this.time += dt;
    const blocking = this.ui.blocking || this.cinematic || this.paused;
    this.input.enabled = !blocking;
    if (!this.paused) {
      if (!blocking) this.handleInput(dt);
      this.clock.running = !blocking || this.ui.timeRuns;
      if (!this.ui.blocking || this.ui.timeRuns) this.clock.update(dt);
      const move = blocking ? { x: 0, z: 0 } : this.moveVector();
      this.player.update(dt, move, !blocking && (this.input.isDown('ShiftLeft') || this.input.isDown('ShiftRight') || !!this.input.touchSprint));
      this.npcs.update(dt);
      this.enemies.update(dt);
      this.fishing.update(dt);
      this.bugs.update(dt);
      this.critters.update(dt);
      this.drops.update(dt);
      this.resources.update(dt);
      this.updateBuffs(dt);
      this.updateTargeting();
      this.updatePrompt();
    }
    // visuals
    const env = this.engine.env;
    env.hour = this.hour;
    env.weather = this.state.weather;
    env.season = this.season;
    env.hearth = this.state.offeringsDone.length;
    env.dawn = this.state.ending;
    this.engine.focus.copy(this.player.pos);
    this.engine.fadeTarget = this.player.pos;
    this.playerLight.pos.set(this.player.pos.x, this.player.pos.y + 1.4, this.player.pos.z);
    this.playerLight.intensity = 4 * Math.min(1, this.darkness * 1.4);
    this.camera.handleInput(this.input, dt);
    this.camera.update(this.player.pos, dt);
    this.grass.update(this.player.pos, this.player.pos);
    this.inst.refresh(this.player.pos);
    const atmo = this.engine.atmosphere.state;
    this.effects.rain = (this.state.weather === 'rain' ? 0.7 : this.state.weather === 'storm' ? 1 : 0);
    this.effects.snow = this.state.weather === 'snow' ? 1 : 0;
    this.effects.fireflies = this.season === 'summer' && atmo.darkness > 0.5 ? 1 : this.season !== 'winter' && atmo.darkness > 0.5 ? 0.25 : 0;
    this.effects.update(dt, this.engine.camera, this.player.pos, atmo.darkness, this.engine.terrain);
    this.updateAudio(dt, atmo);
    this.updateStorm(dt);
    this.hurtVignette = Math.max(0, this.hurtVignette - dt * 1.5);
    const low = this.player.hp < this.player.maxHp * 0.25 ? 0.25 + 0.1 * Math.sin(this.time * 5) : 0;
    const red = Math.max(this.hurtVignette * 0.5, low);
    this.engine.tint.set(1 + red * 0.4, 1 - red * 0.35, 1 - red * 0.35);
    this.ui.update(dt);
  }

  moveVector() {
    const f = this.camera.forward(new THREE.Vector3());
    const r = this.camera.right(new THREE.Vector3());
    let x = 0, z = 0;
    const I = this.input;
    if (I.isDown('KeyW')) { x += f.x; z += f.z; }
    if (I.isDown('KeyS')) { x -= f.x; z -= f.z; }
    if (I.isDown('KeyD')) { x += r.x; z += r.z; }
    if (I.isDown('KeyA')) { x -= r.x; z -= r.z; }
    if (I.touchMove && I.enabled) {
      x += r.x * I.touchMove.x - f.x * I.touchMove.y;
      z += r.z * I.touchMove.x - f.z * I.touchMove.y;
    }
    return { x, z };
  }

  handleInput(dt) {
    const I = this.input;
    // hotbar
    for (let i = 0; i < HOTBAR; i++) {
      const code = i === 9 ? 'Digit0' : `Digit${i + 1}`;
      if (I.pressed(code)) { this.inventory.selectedIndex = i; this.audio.sfx('ui_click', { volume: 0.4 }); }
    }
    if (I.pressed('KeyQ')) { this.inventory.selectedIndex = this.inventory.selectedIndex - 1; this.audio.sfx('ui_click', { volume: 0.3 }); }
    if (I.pressed('KeyR')) { this.inventory.selectedIndex = this.inventory.selectedIndex + 1; this.audio.sfx('ui_click', { volume: 0.3 }); }
    // a click that just closed a dialogue/panel shouldn't also act in the world:
    // mouse input stays latched until that button is released (keys are
    // already consumed by the UI while it is open)
    if (this.ui.mouseLatch && !I.mouseDown(0)) this.ui.mouseLatch = false;
    const fresh = this.ui.mouseLatch;
    const aim = I.touchMode ? null : (this.cursorValid ? this.cursor : null);
    if (I.pressed('Space')) {
      const m = this.moveVector();
      this.player.startDodge(m.x, m.z);
    }
    if (I.pressed('KeyE') || I.pressed('KeyF')) this.tryInteract(false);
    if (I.mousePressed(0) && !fresh) {
      if (this.fishing.active) this.fishing.reelClick();
      else this.player.useSelected(aim);
    }
    // hold to keep swinging tools (not for single-use items)
    else if (I.mouseDown(0) && !fresh && !this.player.action && !this.fishing.active) {
      const sel = this.inventory.selected;
      if (sel && ['tool_axe', 'tool_pickaxe', 'tool_hoe', 'tool_sword', 'tool_can'].includes(sel.id)) this.player.useSelected(aim);
    }
    if (I.pressed('Tab') || I.pressed('KeyI')) this.ui.open('inventory');
    if (I.pressed('KeyC')) this.ui.open('crafting', { station: this.nearStation('workbench') ? 'workbench' : null });
    if (I.pressed('KeyM')) this.ui.open('map');
    if (I.pressed('KeyJ')) this.ui.open('journal');
    if (I.pressed('KeyT')) this.ui.open('help');
  }

  // ---------------------------------------------------------------------
  // Cursor & targeting
  updateTargeting() {
    const cam = this.engine.camera;
    this.raycaster.setFromCamera(this.input.mouse.ndc, cam);
    const hit = this.engine.terrain.raycast(this.raycaster.ray.origin, this.raycaster.ray.direction, 250, this.cursor);
    this.cursorValid = !!hit && this.input.mouse.inside;
    if (this.cursorValid) {
      const plat = this.colliders.platformAt(this.cursor.x, this.cursor.z);
      if (plat) this.cursor.y = plat.h;
    }
    // highlight the tile / placement ghost for the selected item
    const sel = this.inventory.selected;
    const it = sel && ITEMS[sel.id];
    let kind = null;
    if (it) {
      if (sel.id === 'tool_hoe') kind = 'till';
      else if (sel.id === 'tool_can') kind = 'water';
      else if (it.cat === 'seed') kind = 'plant';
      else if (it.place) kind = 'place';
    }
    const hl = this.highlight;
    if (!kind || this.player.action || this.ui.blocking) { hl.tile.visible = false; this.setGhost(null); return; }
    const tgt = this.computeTarget(kind, this.cursorValid ? this.cursor : null, true);
    if (!tgt || !tgt.tile) { hl.tile.visible = false; this.setGhost(null); return; }
    if (kind === 'place') {
      hl.tile.visible = false;
      this.setGhost(sel.id, tgt.point, tgt.ok, tgt.rot);
    } else {
      this.setGhost(null);
      hl.tile.visible = true;
      const { x, z } = tgt.tile;
      hl.tile.position.set(x + 0.5, this.engine.terrain.heightAt(x + 0.5, z + 0.5) + 0.08, z + 0.5);
      hl.mat.color.set(tgt.ok ? 0xf2e3b6 : 0xb84a3a);
      hl.mat.opacity = 0.55 + 0.25 * Math.sin(this.time * 6);
    }
  }

  makeHighlight() {
    const g = new THREE.EdgesGeometry(new THREE.PlaneGeometry(0.96, 0.96).rotateX(-Math.PI / 2));
    const mat = new THREE.LineBasicMaterial({ color: 0xf2e3b6, transparent: true, opacity: 0.7, depthTest: true });
    const tile = new THREE.LineSegments(g, mat);
    tile.renderOrder = 5;
    tile.visible = false;
    this.engine.scene.add(tile);
    this.highlight = { tile, mat, ghost: null, ghostId: null };
  }

  setGhost(id, pos, ok, rot = 0) {
    const hl = this.highlight;
    if (hl.ghostId !== id) {
      if (hl.ghost) hl.ghost.removeFromParent();
      hl.ghost = null;
      hl.ghostId = id;
      if (id) {
        const it = ITEMS[id];
        const g = this.lib.clone(it.place);
        this.ghostMat = this.ghostMat || new THREE.MeshBasicMaterial({ color: 0x9fe0a0, transparent: true, opacity: 0.45, depthWrite: false });
        g.traverse((o) => { if (o.isMesh) { o.material = this.ghostMat; o.castShadow = false; } });
        this.engine.scene.add(g);
        hl.ghost = g;
      }
    }
    if (hl.ghost && pos) {
      hl.ghost.position.copy(pos);
      hl.ghost.rotation.y = rot;
      this.ghostMat.color.set(ok ? 0x9fe0a0 : 0xe07060);
    }
  }

  // Figure out what an action will affect.  Returns { tile, point, face, ok, why }
  computeTarget(kind, aim, preview = false) {
    const p = this.player.pos;
    let point;
    if (aim && Math.hypot(aim.x - p.x, aim.z - p.z) <= REACH) point = aim.clone();
    else {
      const f = this.player.facing;
      point = new THREE.Vector3(p.x + Math.sin(f) * 1.25, p.y, p.z + Math.cos(f) * 1.25);
      if (aim && !preview) {
        // face toward a far cursor, act in front
        const a = Math.atan2(aim.x - p.x, aim.z - p.z);
        point.set(p.x + Math.sin(a) * 1.25, p.y, p.z + Math.cos(a) * 1.25);
      }
    }
    const face = Math.hypot(point.x - p.x, point.z - p.z) > 0.2 ? Math.atan2(point.x - p.x, point.z - p.z) : this.player.facing;
    const tile = { x: Math.floor(point.x), z: Math.floor(point.z) };
    const out = { tile, point, face, ok: true, why: null };
    if (kind === 'till') {
      out.ok = this.farm.canTill(tile.x, tile.z) || !!this.resources.digAt(point.x, point.z, 1.2) || !!(this.farm.tile(tile.x, tile.z) || {}).dead;
    } else if (kind === 'water') {
      out.ok = !!this.farm.tile(tile.x, tile.z) || this.engine.terrain.heightAt(point.x, point.z) < -0.1;
    } else if (kind === 'plant') {
      const t = this.farm.tile(tile.x, tile.z);
      const crop = ITEMS[this.inventory.selected.id].crop;
      if (!t) { out.ok = false; out.why = 'Seeds need tilled soil. Use the hoe in your field.'; }
      else if (t.crop) { out.ok = false; out.why = 'Something is already growing there.'; }
      else if (!CROPS[crop].seasons.includes(this.season)) { out.ok = false; out.why = `${CROPS[crop].name} won't grow in this season.`; }
    } else if (kind === 'place') {
      const id = this.inventory.selected.id;
      const snap = new THREE.Vector3(tile.x + 0.5, 0, tile.z + 0.5);
      snap.y = this.engine.terrain.heightAt(snap.x, snap.z);
      out.point = snap;
      out.rot = Math.round(face / (Math.PI / 2)) * (Math.PI / 2) + Math.PI;
      if (id === 'fence_wood') out.rot = Math.round(face / (Math.PI / 2)) * (Math.PI / 2) + Math.PI / 2;
      out.ok = this.world.canPlace(id, snap.x, snap.z) && Math.hypot(snap.x - p.x, snap.z - p.z) > 0.9 && !this.farm.tile(tile.x, tile.z);
      if (!out.ok) out.why = "You can't place that there.";
    }
    return out;
  }

  // ---------------------------------------------------------------------
  // What happens at the moment a swing lands
  onActionImpact(a) {
    const p = this.player.pos;
    const f = this.player.facing;
    const tgt = a.target || this.computeTarget(a.kind, null);
    const pt = tgt.point;
    const lvl = this.state.tools[a.itemId] || 0;
    const fx = Math.sin(f), fz = Math.cos(f);
    const front = new THREE.Vector3(p.x + fx * 1.2, p.y, p.z + fz * 1.2);
    switch (a.kind) {
      case 'till': {
        const d = this.resources.digAt(pt.x, pt.z, 1.2);
        if (d) { this.resources.dig(d); this.audio.sfx('dig'); break; }
        const tiles = this.areaTiles(tgt.tile, f, lvl);
        let any = false;
        for (const t of tiles) if (this.farm.till(t.x, t.z)) {
          any = true;
          this.effects.burst('dirt', new THREE.Vector3(t.x + 0.5, this.engine.terrain.heightAt(t.x + 0.5, t.z + 0.5), t.z + 0.5), { n: 5 });
        }
        this.audio.sfx('hoe', { pitch: any ? 1 : 0.8 });
        if (!any) {
          const inField = this.farm.inField(tgt.tile.x, tgt.tile.z);
          this.effects.burst('dirt', pt, { n: 3 });
          if (!inField && !this._tillHint) { this._tillHint = true; this.toast('The soil is only good for crops in your croft field.', 'info'); }
        }
        break;
      }
      case 'water': {
        const water = this.engine.terrain.heightAt(pt.x, pt.z) < -0.1 || this.engine.terrain.heightAt(front.x, front.z) < -0.1;
        const cap = [20, 40, 70][lvl];
        if (water) {
          this.state.canWater = cap;
          this.audio.sfx('splash');
          this.effects.burst('splash', pt.y < 0 ? new THREE.Vector3(pt.x, 0, pt.z) : front);
          this.toast('Watering can refilled.', 'info');
          break;
        }
        if (this.state.canWater <= 0) { this.toast('The can is empty — refill it at the lake, stream or well.', 'warn'); this.audio.sfx('ui_error'); break; }
        const tiles = this.areaTiles(tgt.tile, f, lvl);
        let used = false;
        for (const t of tiles) {
          if (this.state.canWater <= 0) break;
          const ok = this.farm.water(t.x, t.z);
          this.effects.burst('water', new THREE.Vector3(t.x + 0.5, this.engine.terrain.heightAt(t.x + 0.5, t.z + 0.5) + 0.2, t.z + 0.5), { n: 8 });
          if (ok) used = true;
        }
        this.state.canWater -= 1;
        this.audio.sfx('water_pour');
        if (!used && !this.farm.tile(tgt.tile.x, tgt.tile.z)) this.effects.burst('water', front);
        break;
      }
      case 'chop': {
        const power = [1, 1.6, 2.4][lvl];
        const tr = this.resources.treeAt(pt.x, pt.z, 1.4) || this.resources.treeAt(front.x, front.z, 1.6);
        if (tr) { this.resources.hitTree(tr, power, p.x, p.z); break; }
        const fern = this.resources.fernAt(pt.x, pt.z, 1.2) || this.resources.fernAt(front.x, front.z, 1.2);
        if (fern) { this.resources.cutFern(fern); break; }
        if (this.enemies.hitArc(p, f, 2.2, 1.2, 8 + lvl * 4)) break;
        this.audio.sfx('swing', { pitch: 0.7, volume: 0.4 });
        break;
      }
      case 'mine': {
        const power = [1, 1.6, 2.4][lvl];
        const rk = this.resources.rockAt(pt.x, pt.z, 1.4) || this.resources.rockAt(front.x, front.z, 1.6);
        if (rk) { this.resources.hitRock(rk, power, lvl); break; }
        const d = this.resources.digAt(pt.x, pt.z, 1.2);
        if (d) { this.resources.dig(d); this.audio.sfx('dig'); break; }
        if (this.enemies.hitArc(p, f, 2.2, 1.2, 8 + lvl * 4)) break;
        this.effects.burst('dirt', front, { n: 3 });
        this.audio.sfx('pick_stone', { pitch: 0.7, volume: 0.35 });
        break;
      }
      case 'attack': {
        const base = [15, 22, 32][lvl] + (this.state.flags.ember_blade ? 12 : 0);
        const dmg = base * (a.combo === 2 ? 1.6 : 1);
        const hit = this.enemies.hitArc(p, f, 2.5, 1.25, dmg, a.combo === 2 ? 9 : 5);
        const crit = this.critters.hitArc(p, f, 2.4, 1.2, dmg);
        const fern = this.resources.fernAt(front.x, front.z, 1.3);
        if (fern) this.resources.cutFern(fern);
        if (!hit && !crit && !fern) this.audio.sfx('swing', { pitch: 1.3, volume: 0.3 });
        break;
      }
      case 'net': {
        if (!this.bugs.tryCatch(p, f)) {
          const fern = this.resources.fernAt(front.x, front.z, 1.0);
          if (fern) this.resources.cutFern(fern);
        }
        break;
      }
      case 'cast': this.fishing.cast(p, f); break;
      case 'hammer': {
        const pl = this.world.placedNear(pt.x, pt.z, 1.4) || this.world.placedNear(front.x, front.z, 1.5);
        if (!pl) { this.audio.sfx('swing', { pitch: 0.8, volume: 0.3 }); break; }
        const chest = this.state.chests[pl.rec.uid];
        if (chest && chest.some((s) => s)) { this.toast('Empty the chest before taking it apart.', 'warn'); this.audio.sfx('ui_error'); break; }
        this.world.removePlaced(pl.rec.uid);
        this.state.placed.splice(this.state.placed.indexOf(pl.rec), 1);
        delete this.state.chests[pl.rec.uid];
        this.drops.spawn(pl.rec.id, 1, new THREE.Vector3(pl.rec.x, p.y + 0.4, pl.rec.z), { up: 3 });
        this.effects.burst('wood', new THREE.Vector3(pl.rec.x, p.y + 0.5, pl.rec.z));
        this.audio.sfx('remove');
        break;
      }
      case 'plant': {
        const sel = this.inventory.selected;
        if (!sel || sel.id !== a.itemId) break;
        const crop = ITEMS[sel.id].crop;
        const r = this.farm.plant(tgt.tile.x, tgt.tile.z, crop);
        if (r === 'ok') {
          this.inventory.remove(sel.id, 1);
          this.audio.sfx('plant');
          this.effects.burst('dirt', new THREE.Vector3(tgt.tile.x + 0.5, p.y + 0.05, tgt.tile.z + 0.5), { n: 4 });
        }
        break;
      }
      case 'place': {
        const sel = this.inventory.selected;
        if (!sel || sel.id !== a.itemId || !tgt.ok) break;
        const rec = { uid: `p${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`, id: sel.id, x: tgt.point.x, z: tgt.point.z, rot: tgt.rot || 0 };
        this.inventory.remove(sel.id, 1);
        this.state.placed.push(rec);
        this.world.addPlaced(rec);
        if (sel.id === 'chest') this.state.chests[rec.uid] = new Array(20).fill(null);
        this.audio.sfx('place');
        this.effects.burst('dust', tgt.point, { n: 5 });
        if (ITEMS[sel.id].light) this.audio.sfx('fire_ignite', { x: rec.x, z: rec.z });
        break;
      }
      case 'eat': {
        const sel = this.inventory.selected;
        if (!sel || sel.id !== a.itemId) break;
        const e = ITEMS[sel.id].edible;
        this.inventory.remove(sel.id, 1);
        if (e.buff) this.addBuff(e.buff[0], e.buff[1], e.buff[2]);
        this.player.heal(e.hp || 0, e.stamina || 0);
        this.audio.sfx(sel.id === 'food_mead' ? 'drink' : 'eat');
        this.effects.burst('heal', new THREE.Vector3(p.x, p.y + 1.2, p.z));
        break;
      }
    }
  }

  // Tiles affected by upgraded hoes / cans: 1, a line of 3, or 3x3
  areaTiles(tile, facing, lvl) {
    if (!lvl) return [tile];
    const fx = Math.round(Math.sin(facing)), fz = Math.round(Math.cos(facing));
    const out = [];
    if (lvl === 1) for (let i = 0; i < 3; i++) out.push({ x: tile.x + fx * i, z: tile.z + fz * i });
    else for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) out.push({ x: tile.x + i, z: tile.z + j });
    return out;
  }

  // ---------------------------------------------------------------------
  // Interaction (E): the thing in front of the player
  candidates() {
    const p = this.player.pos;
    const f = this.player.facing;
    const front = { x: p.x + Math.sin(f) * 1.1, z: p.z + Math.cos(f) * 1.1 };
    const list = [];
    // ripe crop at the cursor tile (if near) or in front
    const cand = [];
    if (this.cursorValid && Math.hypot(this.cursor.x - p.x, this.cursor.z - p.z) < REACH) cand.push({ x: Math.floor(this.cursor.x), z: Math.floor(this.cursor.z) });
    cand.push({ x: Math.floor(front.x), z: Math.floor(front.z) });
    for (const c of cand) {
      const t = this.farm.tile(c.x, c.z);
      if (this.farm.isRipe(t)) {
        list.push({ label: `Harvest ${CROPS[t.crop].name}`, act: () => this.doHarvest(c.x, c.z), d: 0 });
        break;
      }
    }
    const fo = this.resources.forageAt(front.x, front.z, 1.3) || this.resources.forageAt(p.x, p.z, 1.2);
    if (fo) list.push({ label: `Pick ${ITEMS[fo.rec.id].name}`, act: () => { this.player.action = { kind: 'harvest', t: 0, dur: 0.4, impact: 0.2, done: true, move: 0 }; this.resources.pickForage(fo); }, d: 0.1 });
    const bu = this.resources.bushAt(front.x, front.z, 1.5) || this.resources.bushAt(p.x, p.z, 1.4);
    if (bu) list.push({ label: `Pick ${bu.kind === 'bush_raspberry' ? 'raspberries' : 'blueberries'}`, act: () => { this.player.action = { kind: 'harvest', t: 0, dur: 0.4, impact: 0.2, done: true, move: 0 }; this.resources.pickBush(bu); }, d: 0.2 });
    const wi = this.world.findInteractable(p.x, p.z, f);
    if (wi) list.push({ label: typeof wi.label === 'function' ? wi.label() : wi.label, act: () => wi.act(), d: 0.3 });
    return list;
  }

  doHarvest(x, z) {
    this.player.action = { kind: 'harvest', t: 0, dur: 0.4, impact: 0.2, done: true, move: 0 };
    this.player.facing = Math.atan2(x + 0.5 - this.player.pos.x, z + 0.5 - this.player.pos.z);
    this.farm.harvest(x, z);
  }

  tryInteract(fromClick) {
    if (this.player.action || this.player.dead) return false;
    const c = this.candidates();
    if (!c.length) return false;
    c[0].act();
    return true;
  }

  updatePrompt() {
    if (this.player.action || this.ui.blocking) { this.ui.setPrompt(null); return; }
    const c = this.candidates();
    this.ui.setPrompt(c.length ? c[0].label : null);
  }

  nearStation(kind, r = 3.5) {
    const p = this.player.pos;
    for (const [id, b] of this.world.buildings) {
      if (b.def.model === kind && Math.hypot(b.x - p.x, b.z - p.z) < r) return b;
    }
    for (const pl of this.world.placed.values()) {
      if (ITEMS[pl.rec.id].station === kind && Math.hypot(pl.rec.x - p.x, pl.rec.z - p.z) < r) return pl;
    }
    return null;
  }

  nearFire(x, z, r) {
    for (const s of this.engine.lighting.sources) {
      if (!s.enabled || !s.safe || s.nightOnly) continue;
      if ((s.pos.x - x) ** 2 + (s.pos.z - z) ** 2 < r * r) return true;
    }
    return false;
  }

  // ---------------------------------------------------------------------
  // Buffs
  addBuff(id, seconds, mods) {
    const b = this.state.buffs.find((x) => x.id === id);
    if (b) { b.t = Math.max(b.t, seconds); b.mods = mods; }
    else this.state.buffs.push({ id, t: seconds, mods });
    const names = { rested: 'Rested', wellfed: 'Well Fed', hearty: 'Hearty', mead: 'Mead-warmed' };
    this.toast(`${names[id] || id}!`, 'buff');
    this.audio.sfx('levelup', { volume: 0.4 });
  }

  updateBuffs(dt) {
    const bs = this.state.buffs;
    for (let i = bs.length - 1; i >= 0; i--) {
      bs[i].t -= dt;
      if (bs[i].t <= 0) bs.splice(i, 1);
    }
  }

  // ---------------------------------------------------------------------
  // Notifications
  toast(msg, kind = 'info') { this.ui.toast(msg, kind); }

  onPickup(id, n) {
    const first = !this.state.seen['_' + id];
    this.state.seen['_' + id] = true;
    this.state.seen[id] = true;
    this.ui.pickup(id, n, first && (isFish(id) || isBug(id) || isRelic(id)));
    this.audio.sfx(isRelic(id) ? 'relic_found' : 'pickup', { pitch: 0.95 + Math.random() * 0.1 });
    this.npcs && this.npcs.onItemGained && this.npcs.onItemGained(id, n);
  }

  // ---------------------------------------------------------------------
  // Time events
  onTenMinutes() {
    // keep the can fill and other slow things tidy; lanterns etc. are driven by darkness
  }

  onHour(h) {
    if (h === 18 && !this.state.flags.dusk_warned) {
      this.state.flags.dusk_warned = true;
      this.toast('Dusk falls. The Gloam wakes after dark — stay near firelight.', 'warn');
    }
    if (h === 0) this.toast("It's midnight. You should get home to sleep before 2am.", 'warn');
    if (h === 1) this.toast("You're getting very tired…", 'warn');
    this.npcs.onHour(h);
  }

  updateAudio(dt, atmo) {
    const a = this.audio;
    const p = this.player.pos;
    a.setListener(p.x, p.z, this.camera.yaw);
    const w = this.state.weather;
    const nearSea = Math.max(0, 1 - (Math.max(0, 60 - Math.hypot(p.x, p.z - 90)) === 0 ? 1 : Math.hypot(p.x - 20, p.z - 100) / 60));
    const fire = this.nearFire(p.x, p.z, 9) ? 0.8 : 0;
    const inMist = Math.hypot(p.x - LOC.mistwood.x, p.z - LOC.mistwood.z) < 45 ? 1 : 0;
    a.setAmbience({
      wind: 0.35 + atmo.wind * 0.25,
      rain: w === 'rain' ? 0.7 : w === 'storm' ? 1 : 0,
      storm: w === 'storm' ? 0.8 : 0,
      night: atmo.darkness,
      day: (1 - atmo.darkness) * (w === 'clear' || w === 'overcast' ? 1 : 0.4),
      sea: Math.min(1, nearSea),
      fire,
      mist: inMist * 0.6 + (w === 'fog' ? 0.4 : 0),
    });
    let mood = atmo.darkness > 0.75 ? 'night' : this.hour >= 17.5 && this.hour < 21 ? 'dusk' : 'day';
    if (this.enemies.inCombat()) mood = this.enemies.bossActive ? 'boss' : 'combat';
    if (this.ui.musicOverride) mood = this.ui.musicOverride;
    if (mood !== this.lastMusic) { this.lastMusic = mood; a.setMusic(mood); }
    a.update(dt);
  }

  updateStorm(dt) {
    if (this.state.weather !== 'storm') return;
    this._thunder = (this._thunder ?? 8) - dt;
    if (this._thunder <= 0) {
      this._thunder = 7 + Math.random() * 14;
      this.engine.flash = 0.9;
      setTimeout(() => this.audio.thunder(0.6 + Math.random() * 0.4), 300 + Math.random() * 1500);
    }
  }

  applySeason() {
    const s = this.season;
    const snow = s === 'winter' ? 1 : 0;
    globalUniforms.uSnow.value = snow * 0.85;
    globalUniforms.uAutumn.value = s === 'autumn' ? 1 : 0;
    const tint = { spring: [1.05, 1.1, 0.95], summer: [0.95, 1.0, 0.85], autumn: [1, 1, 1], winter: [0.8, 0.85, 0.85] }[s];
    globalUniforms.uLeafTint.value.setRGB(tint[0], tint[1], tint[2]);
    this.grass.setSeason(s, snow);
    const tu = this.engine.terrain.uniforms;
    const G = { spring: ['#5d7034', '#44562a'], summer: ['#66702f', '#4b5627'], autumn: ['#7a6a38', '#5a4c2a'], winter: ['#6a6e62', '#55594e'] }[s];
    tu.uGrassColor.value.set(G[0]);
    tu.uGrassColor2.value.set(G[1]);
  }

  // ---------------------------------------------------------------------
  // Day transitions
  async sleep() {
    if (this.ending) return;
    const h = this.hour;
    if (h < 18 && h >= 6) {
      const ok = await this.ui.confirm('Go to bed now? It is still early.', 'Sleep', 'Not yet');
      if (!ok) return;
    }
    await this.endDay('sleep');
  }

  passOut() {
    if (this._ending) return;
    this.toast('You collapse from exhaustion…', 'warn');
    this.endDay('passout');
  }

  onPlayerDeath() {
    if (this._ending) return;
    this.audio.sfx('player_die');
    setTimeout(() => this.endDay('death'), 1600);
  }

  async endDay(reason) {
    if (this._ending) return;
    this._ending = true;
    this.cinematic = true;
    this.ui.closeAll && this.ui.closeAll();
    this.fishing.cancel();
    await this.ui.fade(1, reason === 'sleep' ? 1.2 : 2.0);
    this.audio.sfx('sleep');
    const summary = this.processNight(reason);
    await this.ui.daySummary(summary);
    this.player.dead = false;
    this.player.action = null;
    this.player.pos.set(LOC.spawn.x, 0, LOC.spawn.z);
    this.player.pos.y = this.world.groundY(LOC.spawn.x, LOC.spawn.z);
    this.player.facing = Math.PI / 2;
    this.player.vel.set(0, 0, 0);
    this.camera.snap(this.player.pos);
    this.inst.refresh(this.player.pos, true);
    this.player.save();
    saveGame(this.state);
    this.clock.running = true;
    this.clock.lastTen = -1;
    this.cinematic = false;
    this._ending = false;
    await this.ui.fade(0, 1.5);
    this.audio.sfx('day_start');
    this.ui.morning(summary);
  }

  // Everything that happens overnight.  Returns a summary for the UI.
  processNight(reason) {
    const st = this.state;
    const rnd = mulberry32((st.totalDays * 7919 + st.created) >>> 0);
    const summary = { reason, sold: [], earned: 0, lost: 0, events: [] };
    // sell the tithe crate
    for (const { id, n } of st.crate) {
      const price = (ITEMS[id] ? ITEMS[id].price : 0) * n;
      summary.sold.push({ id, n, price });
      summary.earned += price;
      st.stats.shipped[id] = (st.stats.shipped[id] || 0) + n;
    }
    st.crate = [];
    st.coins += summary.earned;
    st.stats.earned += summary.earned;
    if (reason === 'death' || reason === 'passout') {
      const lost = Math.min(reason === 'death' ? 500 : 250, Math.floor(st.coins * (reason === 'death' ? 0.1 : 0.05)));
      st.coins -= lost;
      summary.lost = lost;
    }
    // advance the calendar
    const prevSeason = seasonOf(st);
    st.day += 1;
    st.totalDays += 1;
    if (st.day > SEASON_DAYS) {
      st.day = 1;
      st.seasonIndex = (st.seasonIndex + 1) % 4;
      if (st.seasonIndex === 0) st.year += 1;
      summary.events.push(`A new season begins: ${seasonOf(st)}.`);
    }
    const season = seasonOf(st);
    st.weather = st.tomorrowWeather;
    if (season === 'winter' && st.weather === 'rain') st.weather = 'snow';
    if (season !== 'winter' && st.weather === 'snow') st.weather = 'rain';
    st.tomorrowWeather = Clock.rollWeather(season, rnd);
    if (st.day === 1 && st.seasonIndex === 0 && st.year > 1) st.weather = 'clear';
    st.time = DAY_START;
    st.buffs = st.buffs.filter((b) => b.id === 'wellfed' && false);
    // world
    const farm = this.farm.newDay(season, st.weather);
    if (farm.eaten) summary.events.push(`Crows pecked away ${farm.eaten} of your crops. A scarecrow would help.`);
    this.resources.newDay(rnd);
    this.npcs.newDay(rnd);
    this.enemies.clearAll();
    this.drops.clear();
    if (season !== prevSeason) this.applySeason();
    // house upgrade completes overnight
    if (st.houseUpgradeDay && st.totalDays >= st.houseUpgradeDay && st.house !== 'longhouse') {
      st.house = 'longhouse';
      this.swapHouse();
      summary.events.push('Your new longhouse stands ready!');
    }
    this.player.hp = this.player.maxHp * (reason === 'sleep' ? 1 : 0.6);
    this.player.stamina = this.player.maxStamina;
    st.flags.dusk_warned = false;
    summary.day = st.day; summary.season = season; summary.year = st.year; summary.weather = st.weather;
    return summary;
  }

  swapHouse() {
    const b = this.world.buildings.get('home');
    if (!b) return;
    this.world.removeModel(b.obj);
    const model = this.state.house === 'longhouse' ? 'house_longhouse' : 'house_hut';
    b.obj = this.world.placeModel(model, b.x - (model === 'house_longhouse' ? 2 : 0), b.z, b.rot);
    this.mapBase = null; // redraw the map with the new house
    this.npcs.refreshDoors && this.npcs.refreshDoors();
    this.homeDoorChanged && this.homeDoorChanged();
  }

  // ---------------------------------------------------------------------
  // Economy helpers used by the UI
  sellNow(slotIndex, n) {
    const s = this.inventory.slots[slotIndex];
    if (!s) return 0;
    const it = ITEMS[s.id];
    if (!it || it.cat === 'tool' || it.cat === 'special') return 0;
    const r = this.inventory.removeAt(slotIndex, n);
    const coins = it.price * r.n;
    this.state.coins += coins;
    this.state.stats.earned += coins;
    this.audio.sfx('sell');
    return coins;
  }

  shipToCrate(slotIndex, n) {
    const s = this.inventory.slots[slotIndex];
    if (!s) return false;
    const it = ITEMS[s.id];
    if (!it || it.cat === 'tool' || it.cat === 'special' || !it.price) return false;
    const r = this.inventory.removeAt(slotIndex, n);
    const ex = this.state.crate.find((c) => c.id === r.id);
    if (ex) ex.n += r.n; else this.state.crate.push({ id: r.id, n: r.n });
    this.audio.sfx('drop');
    return true;
  }

  fmtClock() { return fmtTime(this.state.time); }

  // ---------------------------------------------------------------------
  // Interactive stations & set pieces
  setupStations() {
    const W = this.world;
    const L = (this.content && this.content.LORE) || {};
    const at = (id) => W.buildings.get(id);
    const add = (b, r, label, act, extra = {}) => {
      if (!b) return;
      const d = b.obj.userData.doorPos;
      W.addInteractable({ x: d ? d.x : b.x, z: d ? d.z : b.z, r, label, act, ...extra });
    };
    add(at('crate'), 1.3, 'Open the tithe crate', () => { this.audio.sfx('chest_open'); this.ui.open('crate'); });
    add(at('workbench'), 1.6, 'Use the workbench', () => this.ui.open('crafting', { station: 'workbench' }));
    add(at('start_fire'), 1.4, 'Cook at the campfire', () => this.ui.open('crafting', { station: 'campfire' }));
    const hearth = at('hearth');
    if (hearth) W.addInteractable({ x: hearth.x, z: hearth.z, r: 3.2, label: () => 'Tend the Great Hearth', act: () => this.openHearth() });
    const well = at('well');
    add(well, 1.6, 'Draw water (refill can)', () => {
      this.state.canWater = [20, 40, 70][this.state.tools.tool_can || 0];
      this.audio.sfx('water_pour');
      this.toast('You fill your watering can at the well.', 'info');
    });
    add(at('notice'), 1.6, 'Read the notice board', () => {
      const notes = L.NOTICE_BOARD || ['(The notices are too weathered to read.)'];
      const pick1 = notes[Math.floor(Math.random() * notes.length)];
      this.ui.say('Notice board', pick1.split('|'), 'sign');
    });
    for (const rs of ['rs1', 'rs2', 'rs3', 'rs4', 'rs5', 'rs6', 'rs7']) {
      const b = at(rs);
      const lore = (L.RUNESTONES || []).find((x) => x.id === rs);
      add(b, 1.5, 'Read the runestone', () => {
        this.state.flags['read_' + rs] = true;
        if (lore) this.ui.say(lore.title, lore.text.split('|'), 'sign');
        else this.ui.say('Runestone', ['The runes are worn smooth by rain and time.'], 'sign');
      });
    }
    for (const [id, b] of W.buildings) {
      if (!id.startsWith('sign_')) continue;
      const text = (L.SIGNS && L.SIGNS[b.def.id]) || `→ ${b.def.id}`;
      add(b, 1.3, 'Read the signpost', () => this.ui.say('Signpost', text.split('|'), 'sign'));
    }
    const altar = at('altar');
    if (altar) W.addInteractable({
      x: altar.x, z: altar.z, r: 2.4,
      label: () => (this.state.offeringsDone.length >= 6 && !this.state.bossDefeated ? 'Wake the altar' : 'Examine the altar'),
      act: () => this.useAltar(),
    });
    // placed stations (chests, campfires, cauldrons, extra workbenches)
    this._placedHooks = new Map();
    const hook = (rec) => {
      const st = ITEMS[rec.id].station;
      if (!st) return;
      const i = W.addInteractable({
        x: rec.x, z: rec.z, r: 1.3,
        label: () => ({ chest: 'Open chest', campfire: 'Cook at the campfire', cauldron: 'Cook at the cauldron', workbench: 'Use the workbench' }[st]),
        act: () => {
          if (st === 'chest') { this.audio.sfx('chest_open'); this.ui.open('chest', { uid: rec.uid, onClose: () => this.audio.sfx('chest_close') }); }
          else this.ui.open('crafting', { station: st });
        },
      });
      this._placedHooks.set(rec.uid, i);
    };
    for (const rec of this.state.placed) hook(rec);
    const origAdd = W.addPlaced.bind(W), origRemove = W.removePlaced.bind(W);
    W.addPlaced = (rec) => { const o = origAdd(rec); hook(rec); return o; };
    W.removePlaced = (uid) => { const i = this._placedHooks.get(uid); if (i) W.removeInteractable(i); this._placedHooks.delete(uid); return origRemove(uid); };
  }

  openHearth() {
    if (!this.state.flags.offerings_known) {
      this.ui.say('The Great Hearth', ['The great fire gutters low, its runestones dark and cold.', 'Perhaps one of the villagers knows the old rites… Grenna, the herbalist?'], 'sign');
      return;
    }
    this.ui.open('hearth');
  }

  offer(o) {
    const st = this.state;
    const prog = st.offerings[o.id] || (st.offerings[o.id] = {});
    let gave = 0;
    if (o.coins) {
      const need = o.coins - (prog.coins || 0);
      const k = Math.min(need, st.coins);
      if (k > 0) { st.coins -= k; prog.coins = (prog.coins || 0) + k; gave += k; }
    }
    for (const [id, n] of o.items) {
      const need = n - (prog[id] || 0);
      const k = Math.min(need, this.inventory.count(id));
      if (k > 0) { this.inventory.remove(id, k); prog[id] = (prog[id] || 0) + k; gave += k; }
    }
    if (!gave) return;
    this.audio.sfx('offering');
    const hearth = this.world.buildings.get('hearth');
    this.effects.burst('ember', new THREE.Vector3(hearth.x, 7.5, hearth.z), { n: 20 });
    const complete = (!o.coins || (prog.coins || 0) >= o.coins) && o.items.every(([id, n]) => (prog[id] || 0) >= n);
    if (complete && !st.offeringsDone.includes(o.id)) {
      st.offeringsDone.push(o.id);
      this.world.setHearthLevel(st.offeringsDone.length, st.ending);
      this.audio.sfx('hearth_roar');
      this.camera.shake(0.3);
      this.effects.burst('ember', new THREE.Vector3(hearth.x, 7.5, hearth.z), { n: 60 });
      this.grantReward(o.reward);
      const T = (this.content && this.content.LORE && this.content.LORE.OFFERINGS_TEXT) || {};
      const t = T[o.id];
      this.ui.close();
      const pages = t && t.complete ? t.complete.split('|') : ['A rune on the Hearth flares to life.'];
      this.ui.say('The Great Hearth', pages, 'sign').then(() => {
        if (st.offeringsDone.length >= 6) {
          const fin = (T.final && T.final.blurb) || 'Deep in the Mistwood, something old has woken.';
          this.ui.say('The Great Hearth', ['Six runes blaze. The whole isle seems to hold its breath…', ...fin.split('|')], 'sign');
          this.toast('The altar in the Mistwood has woken.', 'quest');
        }
      });
    }
  }

  grantReward(r) {
    const st = this.state;
    const give = (id, n) => { const left = this.inventory.add(id, n); if (left) this.drops.spawn(id, left, this.player.pos.clone()); this.ui.pickup(id, n, true); };
    switch (r) {
      case 'recipe_brazier': st.flags.recipe_brazier = true; st.coins += 200; this.toast('Learned: Iron Brazier. +200 coins from the villagers.', 'quest'); break;
      case 'rain_totems': st.flags.recipe_rain_totem = true; give('rain_totem', 2); this.toast('Learned: Rain Totem.', 'quest'); break;
      case 'bone_rod': st.flags.bone_rod = true; this.toast('Fennick fits your rod with a bone hook: fishing is easier.', 'quest'); break;
      case 'recipe_cauldron': st.flags.recipe_cauldron = true; this.toast("Learned: Cauldron and Grenna's recipes.", 'quest'); break;
      case 'ember_blade': st.flags.ember_blade = true; this.toast('Bramble forges your sword into an Ember Blade (+12 damage).', 'quest'); break;
      case 'decor': st.flags.decor = true; this.toast("Corvin's decor catalogue is open.", 'quest'); break;
    }
  }

  async useAltar() {
    const st = this.state;
    if (st.offeringsDone.length < 6) {
      await this.ui.say('The Old Altar', ['An antlered skull stares from the mossy slab. The candles are cold.', 'It feels as though it is waiting for the Hearth to burn again.'], 'sign');
      return;
    }
    if (st.bossDefeated) {
      await this.ui.say('The Old Altar', ['The altar is only stone now. The mist here is thin and clean.'], 'sign');
      return;
    }
    if (this.enemies.bossActive) return;
    const ok = await this.ui.confirm('Something vast stirs beneath the altar. Wake it?', 'Wake it', 'Not yet');
    if (!ok) return;
    this.enemies.summonBoss();
  }

  async finalRite() {
    const st = this.state;
    if (!this.inventory.has('trophy_stag')) return;
    this.inventory.remove('trophy_stag', 1);
    this.cinematic = true;
    this.ui.musicOverride = 'victory';
    const hearth = this.world.buildings.get('hearth');
    this.audio.sfx('hearth_roar');
    this.camera.shake(0.8);
    for (let i = 0; i < 6; i++) setTimeout(() => this.effects.burst('ember', new THREE.Vector3(hearth.x, 7.5, hearth.z), { n: 60 }), i * 300);
    st.ending = true;
    this.world.setHearthLevel(6, true);
    await this.ui.fade(1, 2.5);
    await this.showEnding();
    st.weather = 'clear';
    st.tomorrowWeather = 'clear';
    saveGame(st);
    this.ui.musicOverride = null;
    this.cinematic = false;
    await this.ui.fade(0, 2.5);
    this.toast('Dawn has returned to Gloamhollow. Life goes on — and so can you.', 'quest');
  }

  showEnding() {
    const pages = (this.content && this.content.LORE && this.content.LORE.ENDING) || ['The antler catches, and the Hearth roars white-gold.', 'Across the isle the mist lifts like a held breath let go.', 'Dawn returns to Gloamhollow.'];
    return this.ui.narrate(pages, 'The End… and a beginning');
  }

  quitToTitle() {
    location.reload();
  }
}
