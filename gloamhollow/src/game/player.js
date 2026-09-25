// The player: movement, stamina/health, procedural animation of the
// Blender rig, held items, and tool actions.
import * as THREE from 'three';
import { ITEMS, isFish } from '../data/items.js';
import { findPart, approachAngle } from './util.js';
import { clamp, lerp } from '../engine/noise.js';

// Per-action timing (seconds) and stamina cost
const ACTIONS = {
  till: { dur: 0.62, impact: 0.36, cost: 3, move: 0 },
  water: { dur: 0.7, impact: 0.38, cost: 2, move: 0 },
  chop: { dur: 0.62, impact: 0.34, cost: 4, move: 0 },
  mine: { dur: 0.66, impact: 0.36, cost: 4, move: 0 },
  attack: { dur: 0.46, impact: 0.2, cost: 7, move: 0.35 },
  net: { dur: 0.5, impact: 0.24, cost: 2, move: 0.3 },
  cast: { dur: 0.75, impact: 0.46, cost: 4, move: 0 },
  hammer: { dur: 0.5, impact: 0.28, cost: 2, move: 0 },
  plant: { dur: 0.36, impact: 0.18, cost: 0, move: 0 },
  place: { dur: 0.32, impact: 0.12, cost: 0, move: 0 },
  eat: { dur: 1.0, impact: 0.62, cost: 0, move: 0.3 },
  harvest: { dur: 0.4, impact: 0.2, cost: 0, move: 0 },
};

const TOOL_ACTION = {
  tool_hoe: 'till', tool_can: 'water', tool_axe: 'chop', tool_pickaxe: 'mine', tool_sword: 'attack',
  tool_net: 'net', tool_rod: 'cast', tool_hammer: 'hammer',
};

// How each held model sits in the hand (Euler XYZ, radians).  The rig's
// hand sockets are rotated 180° about X, hence the -PI offsets.
const GRIP = {
  default: [Math.PI / 2 - Math.PI, 0, 0],
  tool_can: [-Math.PI, 0, 0],
  tool_rod: [Math.PI / 2 - 0.35 - Math.PI, 0, 0],
  tool_net: [Math.PI / 2 - 0.2 - Math.PI, 0, 0],
  tool_sword: [Math.PI / 2 - Math.PI, 0, 0],
};

export class Player {
  constructor(game) {
    this.game = game;
    const st = game.state.player;
    this.obj = game.lib.clone('player');
    this.obj.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    game.engine.scene.add(this.obj);
    const P = (n) => findPart(this.obj, n);
    this.parts = {
      body: P('body'), head: P('head'), armL: P('arm_l'), armR: P('arm_r'),
      legL: P('leg_l'), legR: P('leg_r'), handR: P('hand_r'), handL: P('hand_l'), cloak: P('cloak'),
    };
    this.rest = {};
    for (const [k, o] of Object.entries(this.parts)) {
      if (o) this.rest[k] = { p: o.position.clone(), r: o.rotation.clone() };
    }
    this.pos = new THREE.Vector3(st.x, 0, st.z);
    this.pos.y = game.world.groundY(this.pos.x, this.pos.z);
    this.vel = new THREE.Vector3();
    this.facing = st.facing || 0;
    this.radius = 0.35;
    this.hp = st.hp ?? 100;
    this.stamina = st.stamina ?? 100;
    this.staminaDelay = 0;
    this.hurtT = 0;
    this.invuln = 0;
    this.action = null;
    this.dodge = null;
    this.walkPhase = 0;
    this.moveAmt = 0;
    this.sprinting = false;
    this.exhausted = false;
    this.fireTime = 0;
    this.dead = false;
    this.deathT = 0;
    this.combo = 0;
    this.heldId = null;
    this.held = null;
    this.stepAcc = 0;
    this.sitting = false;
    this.fishingPose = 0;
    this.lastDamageT = 99;
  }

  // ---- stats ------------------------------------------------------------
  buffTotal(key) {
    let v = 0;
    for (const b of this.game.state.buffs) if (b.mods && b.mods[key]) v += b.mods[key];
    return v;
  }
  get maxHp() { return 100 + this.buffTotal('maxHp'); }
  get maxStamina() { return 100 + this.buffTotal('maxStamina'); }
  hasBuff(id) { return this.game.state.buffs.some((b) => b.id === id); }

  spend(n) {
    if (n <= 0) return true;
    if (this.stamina < Math.min(n, 4) || this.exhausted) {
      this.game.toast('Too tired…', 'warn');
      this.game.audio.sfx('ui_error');
      return false;
    }
    this.stamina = Math.max(0, this.stamina - n);
    this.staminaDelay = 0.9;
    if (this.stamina <= 0.5) this.exhausted = true;
    return true;
  }

  heal(hp, st) {
    this.hp = Math.min(this.maxHp, this.hp + hp);
    this.stamina = Math.min(this.maxStamina, this.stamina + st);
  }

  damage(amount, fromX, fromZ) {
    if (this.dead || this.invuln > 0 || this.game.cinematic) return false;
    this.hp -= amount;
    this.hurtT = 0.35;
    this.invuln = 0.6;
    this.lastDamageT = 0;
    const dx = this.pos.x - fromX, dz = this.pos.z - fromZ;
    const d = Math.hypot(dx, dz) || 1;
    this.vel.x += (dx / d) * 6; this.vel.z += (dz / d) * 6;
    this.game.audio.sfx('player_hurt');
    this.game.camera.shake(0.35);
    this.game.engine.flash = 0.25;
    this.game.hurtVignette = 1;
    if (this.action && this.action.kind !== 'attack') this.action = null;
    if (this.hp <= 0) {
      this.hp = 0;
      this.dead = true;
      this.deathT = 0;
      this.game.onPlayerDeath();
    }
    return true;
  }

  // ---- held item --------------------------------------------------------
  updateHeld() {
    const sel = this.game.inventory.selected;
    const id = sel ? sel.id : null;
    const show = !this.dead && !this.game.cinematic;
    if (id === this.heldId && this.held) { this.held.visible = show; return; }
    if (this.held) { this.held.removeFromParent(); this.held = null; }
    this.heldId = id;
    if (!id || !this.parts.handR) return;
    const it = ITEMS[id];
    if (!it) return;
    let obj;
    if (it.cat === 'tool') {
      obj = this.game.lib.clone(it.model);
      const g = GRIP[id] || GRIP.default;
      obj.rotation.set(g[0], g[1], g[2]);
    } else {
      // small things are held in the fist, scaled to ~0.3 m
      obj = this.game.lib.clone(it.model);
      const b = this.game.lib.getBounds(it.model).getSize(new THREE.Vector3());
      const k = 0.3 / Math.max(0.05, b.x, b.y, b.z);
      obj.scale.setScalar(Math.min(1, k));
      obj.position.set(0, -0.12, 0.08);
      if (it.tint) obj.traverse((o) => { if (o.isMesh) { o.material = o.material.clone(); o.material.color = new THREE.Color(it.tint).lerp(new THREE.Color(1, 1, 1), 0.35); } });
    }
    obj.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    this.parts.handR.add(obj);
    this.held = obj;
    this.held.visible = show;
  }

  // ---- actions ----------------------------------------------------------
  // Begin using the selected item.  `aim` = world point to face (optional).
  useSelected(aim) {
    if (this.dead || this.action || this.dodge) return;
    const g = this.game;
    const sel = g.inventory.selected;
    if (!sel) {
      // empty hand: harvest / pick if something is in front
      g.tryInteract(true);
      return;
    }
    const it = ITEMS[sel.id];
    let kind = TOOL_ACTION[sel.id];
    if (!kind) {
      if (it.cat === 'seed') kind = 'plant';
      else if (it.place) kind = 'place';
      else if (it.edible) kind = 'eat';
      else { g.tryInteract(true); return; }
    }
    if (kind === 'cast' && g.fishing.active) { g.fishing.reelClick(); return; }
    const A = ACTIONS[kind];
    const target = g.computeTarget(kind, aim);
    if (target && target.face != null) this.facing = target.face;
    if (kind === 'plant' || kind === 'place') {
      if (!target || !target.ok) { g.audio.sfx('ui_error'); if (target && target.why) g.toast(target.why, 'warn'); return; }
    }
    if (kind === 'eat' && this.hp >= this.maxHp && this.stamina >= this.maxStamina - 1 && !it.edible.buff) {
      g.toast("You're not hungry.", 'info');
      return;
    }
    const lvl = g.state.tools[sel.id] || 0;
    const cost = A.cost * (kind === 'attack' ? 1 : lerp(1, 0.7, lvl / 2));
    if (!this.spend(cost)) return;
    if (kind === 'attack') this.combo = (this.combo + 1) % 3;
    this.action = { kind, t: 0, dur: A.dur * (kind === 'attack' && this.combo === 2 ? 1.25 : 1), impact: A.impact, done: false, target, itemId: sel.id, move: A.move, combo: this.combo };
    if (['chop', 'mine', 'till', 'attack', 'net', 'cast', 'hammer'].includes(kind)) g.audio.sfx(kind === 'net' ? 'net_swing' : 'swing', { pitch: kind === 'attack' ? 1.2 : 0.9 });
  }

  startDodge(dirX, dirZ) {
    if (this.dead || this.dodge || (this.action && this.action.kind !== 'attack')) return;
    if (!this.spend(15)) return;
    let dx = dirX, dz = dirZ;
    if (Math.hypot(dx, dz) < 0.1) { dx = Math.sin(this.facing); dz = Math.cos(this.facing); }
    const d = Math.hypot(dx, dz);
    this.action = null;
    this.dodge = { t: 0, dur: 0.5, dx: dx / d, dz: dz / d };
    this.facing = Math.atan2(dx, dz);
    this.invuln = 0.4;
    this.game.audio.sfx('dodge');
    this.game.effects.burst('dust', this.pos, { n: 5 });
  }

  // ---- per-frame --------------------------------------------------------
  update(dt, move, sprint) {
    const g = this.game;
    this.updateHeld();
    this.invuln = Math.max(0, this.invuln - dt);
    this.hurtT = Math.max(0, this.hurtT - dt);
    this.lastDamageT += dt;

    // stamina & health regeneration
    this.staminaDelay -= dt;
    const regenMul = (this.hasBuff('rested') ? 1.5 : 1) + this.buffTotal('regen');
    if (this.staminaDelay <= 0 && !this.sprinting) this.stamina = Math.min(this.maxStamina, this.stamina + 20 * regenMul * dt);
    if (this.exhausted && this.stamina > 25) this.exhausted = false;
    if (this.lastDamageT > 5 && !this.dead) {
      const hpRegen = (this.hasBuff('wellfed') ? 1.6 : 0.5) * (this.hasBuff('rested') ? 2 : 1);
      this.hp = Math.min(this.maxHp, this.hp + hpRegen * dt);
    }
    this.hp = Math.min(this.hp, this.maxHp);

    if (this.dead) {
      this.deathT += dt;
      this.animate(dt, 0);
      return;
    }

    // desired velocity
    let speed = 0;
    const want = new THREE.Vector3(move.x, 0, move.z);
    const mlen = want.length();
    if (mlen > 1) want.divideScalar(mlen);
    this.sprinting = false;
    if (this.dodge) {
      const D = this.dodge;
      D.t += dt;
      const k = 1 - D.t / D.dur;
      this.vel.set(D.dx * 11 * Math.max(0.2, k), 0, D.dz * 11 * Math.max(0.2, k));
      if (D.t >= D.dur) this.dodge = null;
    } else {
      const acting = this.action;
      const moveMul = acting ? acting.move : 1;
      if (mlen > 0.05 && moveMul > 0) {
        this.sprinting = sprint && this.stamina > 1 && !this.exhausted && !acting;
        speed = (this.sprinting ? 6.8 : 4.4) * moveMul * (this.exhausted ? 0.7 : 1);
        if (this.sprinting) { this.stamina = Math.max(0, this.stamina - 11 * dt); this.staminaDelay = 0.6; if (this.stamina <= 0) this.exhausted = true; }
        if (!acting) this.facing = approachAngle(this.facing, Math.atan2(want.x, want.z), dt * 12);
      }
      const k = 1 - Math.exp(-dt * (mlen > 0.05 ? 14 : 10));
      this.vel.x += (want.x * speed - this.vel.x) * k;
      this.vel.z += (want.z * speed - this.vel.z) * k;
    }

    // integrate with collision; the sea and deep water stop you
    const next = this.pos.clone().addScaledVector(this.vel, dt);
    g.colliders.resolve(next, this.radius);
    const plat = g.colliders.platformAt(next.x, next.z);
    const th = g.engine.terrain.heightAt(next.x, next.z);
    if (!plat && th < -0.5) {
      // try sliding along each axis
      const nx = new THREE.Vector3(next.x, 0, this.pos.z), nz = new THREE.Vector3(this.pos.x, 0, next.z);
      if (g.engine.terrain.heightAt(nx.x, nx.z) >= -0.5 || g.colliders.platformAt(nx.x, nx.z)) { next.x = nx.x; next.z = this.pos.z; }
      else if (g.engine.terrain.heightAt(nz.x, nz.z) >= -0.5 || g.colliders.platformAt(nz.x, nz.z)) { next.z = nz.z; next.x = this.pos.x; }
      else { next.x = this.pos.x; next.z = this.pos.z; }
    }
    const moved = Math.hypot(next.x - this.pos.x, next.z - this.pos.z);
    this.pos.x = next.x; this.pos.z = next.z;
    const gy = g.world.groundY(this.pos.x, this.pos.z);
    this.pos.y += (Math.max(gy, -0.45) - this.pos.y) * Math.min(1, dt * 18);
    if (dt > 0) this.moveAmt = lerp(this.moveAmt, clamp(moved / dt / 6.8, 0, 1.2), 1 - Math.exp(-dt * 10));

    // footsteps
    if (this.moveAmt > 0.08 && !this.dodge) {
      this.stepAcc += moved;
      const stride = this.sprinting ? 1.5 : 1.1;
      if (this.stepAcc > stride) {
        this.stepAcc = 0;
        const surf = plat ? 'wood' : g.engine.terrain.surfaceAt(this.pos.x, this.pos.z);
        const snd = { wood: 'step_wood', rock: 'step_stone', plaza: 'step_stone', water: 'step_water', sand: 'step_grass' }[surf] || (g.season === 'winter' ? 'step_snow' : 'step_grass');
        g.audio.sfx(snd, { volume: this.sprinting ? 0.8 : 0.55 });
        if (surf === 'water' || th < 0.05) g.effects.burst('water', this.pos, { n: 4 });
      }
    }

    // action progress
    if (this.action) {
      const a = this.action;
      a.t += dt;
      if (!a.done && a.t >= a.impact) { a.done = true; g.onActionImpact(a); }
      if (a.t >= a.dur) this.action = null;
    }

    // rested: linger near a fire
    const nearFire = g.nearFire(this.pos.x, this.pos.z, 6);
    if (nearFire) {
      this.fireTime += dt;
      if (this.fireTime > 12 && !this.hasBuff('rested')) g.addBuff('rested', 300, {});
    } else this.fireTime = 0;

    this.animate(dt, speed);
  }

  // ---- procedural animation -------------------------------------------
  animate(dt, speed) {
    const P = this.parts;
    const R = this.rest;
    const set = (k, rx, ry, rz, py) => {
      const o = P[k];
      if (!o) return;
      const r = R[k].r;
      o.rotation.set(r.x + (rx || 0), r.y + (ry || 0), r.z + (rz || 0));
      if (py != null) o.position.y = R[k].p.y + py;
    };
    const t = performance.now() / 1000;
    this.walkPhase += dt * (4 + this.moveAmt * 9);
    const w = Math.min(1, this.moveAmt * 1.6);
    const s = Math.sin(this.walkPhase), c = Math.cos(this.walkPhase);
    const run = this.sprinting ? 1.35 : 1;
    let legL = s * 0.65 * w * run, legR = -s * 0.65 * w * run;
    let armL = -s * 0.5 * w * run, armR = s * 0.5 * w * run;
    let armLz = 0.06, armRz = -0.06;
    let bodyX = (this.sprinting ? 0.18 : 0.05) * w, bodyY = 0, bodyZ = c * 0.04 * w;
    let bob = Math.abs(c) * 0.05 * w + Math.sin(t * 2) * 0.008 * (1 - w);
    let headX = 0, headY = 0;
    let rootX = 0;

    const a = this.action;
    if (a) {
      const u = a.t / a.dur;
      const ui = Math.min(1, a.t / a.impact);           // 0..1 until impact
      const uo = a.t > a.impact ? (a.t - a.impact) / (a.dur - a.impact) : 0; // recovery 0..1
      const ease = (x) => x * x * (3 - 2 * x);
      switch (a.kind) {
        case 'chop': case 'mine': case 'till': case 'hammer': {
          const up = a.kind === 'till' ? -2.6 : -2.75;
          const hit = a.kind === 'till' ? -0.35 : a.kind === 'hammer' ? -0.9 : -0.75;
          let ang;
          if (ui < 0.6) ang = lerp(0, up, ease(ui / 0.6));
          else if (ui < 1) ang = lerp(up, hit, ease((ui - 0.6) / 0.4));
          else ang = lerp(hit, 0, ease(uo));
          armR = ang; armL = ang * 0.8; armLz = 0.25; armRz = -0.25;
          bodyX = ui >= 1 ? lerp(0.3, 0, uo) : lerp(-0.12, 0.3, ui);
          bodyY = 0;
          legL = 0.15; legR = -0.2;
          break;
        }
        case 'water': {
          armR = -1.25 * ease(Math.min(1, u * 3)) * (1 - ease(Math.max(0, (u - 0.8) / 0.2)));
          bodyX = 0.12;
          if (this.held) this.held.rotation.x = (GRIP.tool_can[0]) + Math.sin(Math.min(1, u * 2) * Math.PI) * 0.9;
          break;
        }
        case 'attack': case 'net': {
          const dir = a.combo % 2 === 0 ? 1 : -1;
          const heavy = a.combo === 2;
          const sweep = ui < 1 ? lerp(-1.2, 1.1, ease(ui)) : lerp(1.1, 0.4, uo);
          armR = heavy ? (ui < 1 ? lerp(-2.8, -0.6, ease(ui)) : lerp(-0.6, 0, uo)) : -1.35;
          armRz = heavy ? -0.1 : -0.35 - 0.2 * dir;
          bodyY = heavy ? 0 : sweep * 0.55 * dir;
          bodyX = heavy ? lerp(-0.1, 0.35, ui) : 0.1;
          legL = 0.25; legR = -0.3;
          break;
        }
        case 'cast': {
          const ang = ui < 0.7 ? lerp(-0.6, -2.9, ease(ui / 0.7)) : ui < 1 ? lerp(-2.9, -1.1, ease((ui - 0.7) / 0.3)) : -1.1;
          armR = ang; armL = -0.5;
          bodyX = ui < 0.7 ? -0.12 : 0.15;
          break;
        }
        case 'plant': case 'harvest': case 'place': {
          const k = Math.sin(Math.min(1, u) * Math.PI);
          armR = -0.9 * k; bodyX = 0.45 * k; bob -= 0.12 * k; headX = 0.3 * k;
          legL = 0.25 * k; legR = 0.25 * k;
          break;
        }
        case 'eat': {
          const k = Math.sin(Math.min(1, u) * Math.PI);
          armR = -2.1 * k; headX = 0.15 * Math.sin(t * 18) * k;
          break;
        }
      }
    } else if (this.game.fishing && this.game.fishing.active) {
      armR = -1.0 + Math.sin(t * 2.2) * 0.04; armL = -0.8; armLz = -0.3; bodyX = 0.05;
      if (this.game.fishing.reeling) armR += Math.sin(t * 22) * 0.06;
    }
    if (this.dodge) {
      const u = this.dodge.t / this.dodge.dur;
      rootX = u * Math.PI * 2;
      legL = 1.2; legR = 1.2; armL = -1.4; armR = -1.4; bob = 0.3 * Math.sin(u * Math.PI);
    }
    if (this.hurtT > 0) bodyX -= this.hurtT * 0.9;
    if (this.dead) {
      const u = Math.min(1, this.deathT / 0.8);
      rootX = -Math.PI / 2 * u * u;
      armL = -0.3; armR = -0.3;
    }
    if (!a || a.kind !== 'water') {
      if (this.held && this.heldId === 'tool_can') this.held.rotation.x = GRIP.tool_can[0];
    }

    set('legL', legL, 0, 0);
    set('legR', legR, 0, 0);
    set('armL', armL, 0, armLz);
    set('armR', armR, 0, armRz);
    set('body', bodyX, bodyY, bodyZ, bob);
    set('head', headX - bodyX * 0.5, headY, 0);
    if (P.cloak) set('cloak', 0.15 * w + Math.sin(t * 3) * 0.03, 0, 0);

    this.obj.position.copy(this.pos);
    this.obj.rotation.set(0, this.facing, 0);
    if (rootX) {
      // roll/fall around the local right axis, pivoting near the hips
      this.obj.rotateX(rootX);
      if (this.dead) this.obj.position.y += 0.15;
      else this.obj.position.y += 0.45 * Math.sin(Math.min(1, rootX / (Math.PI * 2)) * Math.PI);
    }
  }

  // Positions of the character's feet and hand for effects
  handWorld(out = new THREE.Vector3()) {
    if (this.parts.handR) return this.parts.handR.getWorldPosition(out);
    return out.copy(this.pos).add(new THREE.Vector3(0, 1, 0));
  }

  save() {
    const st = this.game.state.player;
    st.x = this.pos.x; st.z = this.pos.z; st.facing = this.facing;
    st.hp = this.hp; st.stamina = this.stamina;
  }
}

export { TOOL_ACTION };
export const itemIsFish = isFish;
