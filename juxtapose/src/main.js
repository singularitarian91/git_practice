// Juxtapose - boot, game loop and run structure.
import * as THREE from 'three';
import { Renderer, DREAM, suggestQuality } from './render.js';
import { Physics } from './physics.js';
import { Assets, makeDreamMaterial } from './assets.js';
import { Input } from './input.js';
import { VFX } from './vfx.js';
import { DreamAudio } from './audio.js';
import { UI } from './ui.js';
import { Meta } from './meta.js';
import { Lucidity } from './properties.js';
import { Destruction } from './destruction.js';
import { Projectiles } from './projectiles.js';
import { Level, LOOKS, buildBedroom } from './level.js';
import { Player } from './player.js';
import { Sleepwalker } from './enemies.js';
import { Unwatched } from './boss.js';
import { spawnEntity, Pickup, ScrapPickup } from './entities.js';
import { LAYERS, PROPS, PROP_INFO, TUNE } from './config.js';
import { FigureAnimator } from './animator.js';
import { Portals } from './portals.js';
import { Narrator } from './narrator.js';
import { CombatHUD } from './combat.js';
import { defaultMods, SCRAPS, WHIMS } from './meta.js';
import { PhotoMode } from './photo.js';
import { RANKS, CLARITY, rankOf, applyRanks } from './knots.js';

const $ = (s) => document.querySelector(s);
// With "Night-Light tips and asides" off, only these lines still play
const STORY_LINES = new Set(['wake0', 'wakeN', 'layer1', 'layer2', 'layer3', 'bossPhase', 'bossDown', 'death', 'lucidWake', 'scrap', 'laststand']);

class Game {
  constructor() {
    this.run = { mods: defaultMods(), keepsakes: new Set(), whims: [] };
    this.hitStopT = 0; this.slowT = 0; this.slowScale = 1;
    this.state = 'boot';
    this.time = 0;
    this.timeScale = 1;
    this.entities = new Set();
    this.pickups = [];
    this.recentCombos = [];
    this.sandbox = false;
    this.godMode = false;
    this.depth = 0;
    this.transitioning = false;
    this.freezeEnemies = false;
  }

  async init() {
    const fill = $('.load-fill');
    const msg = $('.load-msg');
    this.meta = new Meta();
    const S = this.opts = this.meta.allSettings(); // live settings; player.js reads fov/shake/comfort/guard/reload here
    const chosen = this.meta.data.settings && this.meta.data.settings.quality;
    this.render = new Renderer($('#stage'), chosen || 'medium');
    if (!chosen) {
      const q = suggestQuality(this.render.renderer);
      if (q !== this.render.qualityName) this.render.setQuality(q);
      this.opts.quality = q;
    }
    this.watchContext();
    this.grainBase = this.render.dream.uniforms.uGrain.value;
    this.scene = this.render.scene;
    fill.style.width = '15%';
    msg.textContent = 'Waking the physics...';
    this.physics = await Physics.create();
    fill.style.width = '30%';
    msg.textContent = 'Remembering things that never happened...';
    this.assets = new Assets();
    await this.assets.load((p) => { fill.style.width = (30 + p * 60) + '%'; });
    this.input = new Input(this.render.renderer.domElement);
    this.vfx = new VFX(this.scene, this.assets.textures, this.render);
    this.audio = new DreamAudio();
    this.ui = new UI(this);
    this.lucidity = new Lucidity(this);
    this.destruction = new Destruction(this);
    this.projectiles = new Projectiles(this);
    this.narrator = new Narrator(this);
    this.combatHUD = new CombatHUD(this);
    this.portals = new Portals(this);
    this.photo = new PhotoMode(this);
    this.stats = this.freshStats();
    // the Night-Light's tips and asides can be muted; its story lines can't
    const say = this.narrator.say.bind(this.narrator);
    this.narrator.say = (key, o) => { if (this.opts.tips || STORY_LINES.has(key)) say(key, o); };
    for (const k of Object.keys(this.opts)) if (k !== 'quality') this.applySetting(k, this.opts[k]);
    addEventListener('resize', () => this.applyHudScale());
    this.bindMenus();
    this.bindErrors();
    fill.style.width = '100%';
    this.toTitle();
    this.last = performance.now();
    requestAnimationFrame((t) => this.frame(t));
    if (matchMedia('(pointer: coarse)').matches && !matchMedia('(pointer: fine)').matches) $('#touch-note').hidden = false;
    window.__game = this;
  }

  // ------------------------------------------------------------ robustness
  // Compile every shader a fight can need before the fight: the first hit, kill,
  // explosion, ring or melt must not stall while the driver compiles (on Windows
  // that can take a second). The scene renders into the post chain's target, which
  // selects different shader variants (no tone mapping, linear output) than the
  // canvas does, so that target is bound while compiling.
  warmShaders() {
    const r = this.render.renderer;
    if (!r.compileAsync || this.render.contextLost) return;
    const warm = new THREE.Group();
    warm.position.set(0, -400, 0);
    const pooled = [];
    try {
      warm.add(new THREE.Mesh(this.projectiles.geoRound, this.projectiles.mat('#fff2c8', 5)));
      if (this.projectiles.orbMat) warm.add(new THREE.Mesh(this.projectiles.geoOrb, this.projectiles.orbMat('#7ff7ff')));
      for (const name of ['Wall_Fractured', 'Column_Fractured', 'Drawers_Fractured', 'TP_Stucco_Fractured', 'Sleepwalker', 'Apple']) {
        const t = this.assets.templates.get(name);
        if (t) warm.add(t.clone(true));
      }
      // rings and decals come from pools that outlive the fight
      const ring = this.vfx.ringMesh(), decal = this.vfx.decalMesh();
      pooled.push([this.vfx.ringPool, ring], [this.vfx.decalPool, decal]);
      warm.add(ring, decal);
      // what properties turn materials into mid-fight: see-through (hollow), the melting
      // shader, the hollow wireframe; one of each per distinct material and geometry
      this.warmKeep = [];
      const seen = new Set();
      const variants = (o) => {
        if (!o.isMesh || o.isSkinnedMesh || o.isInstancedMesh) return;
        for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
          if (!m || !m.isMeshStandardMaterial || m.userData.dream) continue;
          const a = o.geometry.attributes;
          const sig = [m.type, m.vertexColors, !!m.map, !!m.normalMap, !!m.roughnessMap, !!m.emissiveMap, !!m.aoMap, m.side, m.transparent, JSON.stringify(m.defines || {}), !!a.color, !!a.uv, !!a.tangent, o.receiveShadow].join('|');
          if (seen.has(sig)) continue;
          seen.add(sig);
          const see = m.clone(); see.transparent = true; see.depthWrite = false;
          const melt = m.clone(); makeDreamMaterial(melt, 1, 0);
          for (const v of [see, melt]) { const w = new THREE.Mesh(o.geometry, v); w.receiveShadow = o.receiveShadow; warm.add(w); this.warmKeep.push(v); }
        }
      };
      for (const e of this.entities) e.obj?.traverse(variants);
      this.assets.templates.get('Sleepwalker')?.traverse(variants);
      const wire = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)), new THREE.LineBasicMaterial({ color: 0x5effd0, transparent: true, opacity: 0.55 }));
      warm.add(wire); this.warmKeep.push(wire.material);
      // the Figment's decoys are see-through skinned copies of it
      const decoy = this.assets.cloneFigure();
      decoy.traverse((m) => { if (m.isMesh) { m.material.transparent = true; m.material.opacity = 0.5; } });
      warm.add(decoy);
      const hud = this.combatHUD.make({ id: '__warm' });
      hud.grp.position.set(0, -400, 0);
      this.scene.add(warm);
      const cleanup = () => {
        this.scene.remove(warm);
        for (const [pool, m] of pooled) { warm.remove(m); pool.push(m); }
        hud.grp.parent?.remove(hud.grp);
        this.combatHUD.items.delete('__warm');
      };
      const target = r.getRenderTarget();
      r.setRenderTarget(this.render.composer?.readBuffer || null);
      const done = r.compileAsync(this.scene, this.render.camera);
      r.setRenderTarget(target);
      done.then(cleanup, cleanup);
    } catch (e) { console.warn('shader warm-up skipped', e); this.scene.remove(warm); }
  }

  // Lost WebGL (a driver reset, the GPU out of memory): pause, wait for it to come
  // back, then rebuild the post chain one quality step lower.
  watchContext() {
    const cv = this.render.renderer.domElement;
    cv.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this.render.contextLost = true;
      if (this.state === 'playing') this.pause();
      this.showError(null, 'The graphics driver dropped the dream. Waiting for it to come back...');
    });
    cv.addEventListener('webglcontextrestored', () => {
      this.render.contextLost = false;
      const q = this.render.qualityName === 'high' ? 'medium' : 'low';
      this.render.setQuality(q);
      this.render.refreshEnvironment();
      this.opts.quality = q;
      this.meta.setSetting('quality', q);
      this.hideError();
      this.ui.toast(`The picture is back. Graphics set to ${q} to keep it steady.`);
    });
  }

  bindErrors() {
    const panel = $('#crash');
    if (!panel) return;
    $('#crash-copy').addEventListener('click', () => {
      const text = panel.dataset.details || '';
      const done = () => { $('#crash-copy').textContent = 'Copied'; };
      try { navigator.clipboard.writeText(text).then(done, () => { $('#crash-text').select?.(); }); } catch (e) { /* select fallback */ }
    });
    $('#crash-close').addEventListener('click', () => this.hideError());
    // only the game's own failures, not the host page's or benign browser notices
    const ours = (x) => /src\/[a-z]+\.js/.test(String((x && (x.stack || x.filename)) || '')) && !/ResizeObserver/.test(String(x && x.message));
    addEventListener('error', (e) => { if (ours(e.error) || ours(e)) this.showError(e.error || e.message); });
    addEventListener('unhandledrejection', (e) => { if (ours(e.reason)) this.showError(e.reason); });
  }
  showError(err, message) {
    const panel = $('#crash');
    if (!panel || (!panel.hidden && !message)) return;
    const gl = this.render?.renderer?.getContext();
    let gpu = '';
    try { const ext = gl.getExtension('WEBGL_debug_renderer_info'); gpu = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : ''; } catch (e) { /* no info */ }
    const details = [
      message || String(err && (err.stack || err.message) || err),
      `state ${this.state} · layer ${this.level?.key || '-'} · quality ${this.render?.qualityName}`,
      `gpu ${gpu || 'unknown'} · ${navigator.userAgent}`,
    ].join('\n');
    panel.dataset.details = details;
    $('#crash-msg').textContent = message || 'Something in the dream broke. It may carry on; if it does not, these details will help fix it.';
    $('#crash-text').value = details;
    panel.hidden = false;
  }
  hideError() { const panel = $('#crash'); if (panel) panel.hidden = true; }

  freshStats() { return { gives: 0, takes: 0, kills: 0, destroyed: 0, explosions: 0, propUse: {}, time: 0 }; }

  // ------------------------------------------------------------ settings
  applySetting(k, v) {
    this.opts[k] = v;
    const du = this.render.dream.uniforms;
    switch (k) {
      case 'quality': if (this.render.qualityName !== v) this.render.setQuality(v); break;
      case 'sens': this.input.sensitivity = 0.0022 * v; break;
      case 'invert': this.input.invertY = !!v; break;
      case 'vol': this.audio.setMasterVolume(v); break;
      case 'music': this.audio.setMusicVolume(v); break;
      case 'sfx': this.audio.setSfxVolume(v); break;
      case 'comfort': du.uComfort.value = v; break;
      case 'grain': du.uGrain.value = this.grainBase * v; break;
      case 'reduceFlash': this.render.flashScale = v ? 0.35 : 1; break;
      case 'hudScale': this.applyHudScale(); break;
      case 'subSize':
        document.body.classList.toggle('sub-small', v === 'small');
        document.body.classList.toggle('sub-large', v === 'large');
        break;
      default: break; // fov, shake, tips, guardToggle, autoReload are read where they are used
    }
  }
  applyHudScale() {
    const v = this.opts.hudScale;
    const fit = Math.min(1.4, Math.max(0.85, 1 + (Math.min(innerWidth / 1280, innerHeight / 720) - 1) * 0.55));
    this.ui.setHudScale(v === 'auto' || !(+v > 0) ? fit : +v);
  }

  // ------------------------------------------------------------ hooks
  explode(pos, opts) { this.destruction.explode(pos, opts); }
  recordCombo(p) {
    this.recentCombos.push(p);
    if (this.recentCombos.length > 6) this.recentCombos.shift();
    this.stats.propUse[p] = (this.stats.propUse[p] || 0) + 1;
  }
  spawnEnemy(pos, opts = {}) {
    if (this.state !== 'playing' && this.state !== 'transition') return null;
    const e = new Sleepwalker(this, pos, { ...opts, fireRate: this.freezeEnemies ? 0 : (opts.fireRate ?? 1 + this.depth * 0.15) });
    this.entities.add(e);
    return e;
  }
  spawnPickup(pos) { this.pickups.push(new Pickup(this, pos)); }
  spawnCopy(e, pos) {
    if (e.kind === 'enemy') {
      const c = new Sleepwalker(this, pos, { variant: e.variant, hp: e.hp, fireRate: this.freezeEnemies ? 0 : 1 });
      this.entities.add(c);
      return c;
    }
    if (e.kind === 'boss') return null;
    const c = spawnEntity(this, e.name, pos, { rotY: e.obj.rotation.y, anchored: e.kind === 'wall' ? true : undefined });
    return c;
  }
  onEntityDeath(e, opts = {}) {
    // removed from the set in the loop; here, only the kill marker
    if (e.kind === 'enemy' && this.state === 'playing' && opts.type !== 'forgotten' && opts.type !== 'void') this.ui.hitMarker('kill');
    if (e.kind === 'enemy' && this.state === 'playing' && opts.type !== 'void') this.gainClarity(opts.type === 'deathblow' || e.deathblown ? CLARITY.deathblow : CLARITY.kill, e.center());
  }
  onPlayerDeath() {
    if (this.sandbox) {
      this.ui.toast('You wake, and fall straight back to sleep.', 'warn');
      setTimeout(() => { if (this.sandbox && this.player) this.respawnPlayer(); }, 2200);
      return;
    }
    this.endRun('death');
  }
  // brief freeze on impact (weight) and short slow-motion (drama)
  hitStop(d) { this.hitStopT = Math.max(this.hitStopT, d); }
  slowMo(d, scale = 0.3) { this.slowT = Math.max(this.slowT, d); this.slowScale = scale; }

  newRun() {
    this.run = { mods: defaultMods(), keepsakes: new Set(this.meta.equipped()), whims: [] };
    applyRanks(this.run.mods, this.meta.data.clarity || 0); // what the Figment has become, it stays
  }

  // Clarity: kept between nights; each rank reached is a permanent perk
  gainClarity(n, at) {
    if (this.sandbox || !n) return;
    const before = this.meta.data.clarity || 0, after = before + n;
    this.meta.data.clarity = after;
    this.stats.clarity = (this.stats.clarity || 0) + n;
    const r0 = rankOf(before), r1 = rankOf(after);
    for (let r = r0 + 1; r <= r1; r++) {
      const R = RANKS[r];
      R.apply(this.run.mods);
      if (R.apply && this.player && this.run.mods.hpBonus) { const add = this.run.mods.hpBonus - (this.player.hpBonusApplied || 0); this.player.maxHp += add; this.player.heal(add); this.player.hpBonusApplied = this.run.mods.hpBonus; }
      this.ui.card('CLARITY', R.name, R.perk);
      this.audio.stinger('memory');
      if (this.player) this.vfx.propertyBurst(this.player.pos.clone().setY(this.player.pos.y + 1.2), 'floating', 1.4);
    }
    if (at && n >= 8) this.vfx.trail(at.clone().setY(at.y + 1.4), '#ffd27a', 0.3, 0.6);
    this.ui.clarity(after);
    this.meta.save();
  }

  // a memory taken back: a whim to choose, and the door once enough are free
  onKnotFreed(knot) {
    this.stats.memoriesFreed = (this.stats.memoriesFreed || 0) + 1;
    const lvl = this.level;
    if (lvl && lvl.knotsFreed === lvl.knotsNeeded) lvl.surge(3 + this.depth, 'The dream notices what you took back. It sends them after you.');
    setTimeout(() => {
      if (this.state !== 'playing' || this.player?.dead || WHIMS.length <= this.run.whims.length) return;
      this.input.exitLock();
      this.state = 'whims';
      this.ui.setHud(false);
      this.ui.showWhims((w) => {
        if (w) { w.apply(this.run.mods); this.run.whims.push(w.id); this.ui.toast(`Whim: ${w.name}`, 'good'); }
        this.ui.hideScreens();
        this.ui.setHud(true);
        this.state = 'playing';
        this.input.requestLock();
      });
    }, 900);
  }

  onBossDefeated() {
    this.gainClarity(CLARITY.boss, this.boss?.center?.());
    this.ui.toast('The eye closes.', 'good');
    this.narrator.say('bossDown', { priority: true });
    this.meta.data.bossKills = (this.meta.data.bossKills || 0) + 1;
    if (this.meta.addScrap(9)) this.ui.loreCard(SCRAPS[8]);
    this.meta.save();
    this.audio.stinger('memory');
    setTimeout(() => { if (this.state === 'playing') this.endRun('victory'); }, 4500);
  }

  // ------------------------------------------------------------ world lifecycle
  clearWorld() {
    this.combatHUD.clear();
    this.narrator.despawn();
    for (const e of this.entities) { e.obj.parent?.remove(e.obj); if (e.fireLight) this.render.release(e.fireLight); }
    this.entities.clear();
    for (const p of this.pickups) p.obj.parent?.remove(p.obj);
    this.pickups = [];
    this.projectiles.clear();
    this.portals.clear();
    for (const d of this.destruction.debris) d.mesh.parent?.remove(d.mesh);
    this.destruction.debris = [];
    this.vfx.clear();
    if (this.player) {
      this.player.visual.parent?.remove(this.player.visual);
      for (const d of this.player.decoys) d.grp.parent?.remove(d.grp);
      for (const [e] of this.player.faded) this.player.setFade(e, 1);
    }
    if (this.level) { this.scene.remove(this.level.group); }
    if (this.bedroom) { this.scene.remove(this.bedroom.group); this.bedroom = null; }
    if (this.attractFig) { this.scene.remove(this.attractFig.grp); this.attractFig = null; }
    for (const l of this.render.lights) this.render.release(l);
    this.boss = null;
    this.player = null;
    this.level = null;
    this.physics.world.free();
    this.physics = new Physics();
    this.physics.forceHandlers = [];
  }

  buildLevel(key, index) {
    this.level = new Level(this, key, { index });
    this.level.build();
    return this.level;
  }

  makePlayer(spawn, yaw, carry) {
    const p = this.player = new Player(this, spawn);
    const bonus = this.run?.mods.hpBonus || 0;
    p.maxHp += bonus; p.hp += bonus; p.hpBonusApplied = bonus;
    p.teleport(spawn, yaw);
    this.physics.beforeStep = (h) => { if (this.player) this.player.fixedUpdate(h); };
    if (carry) {
      p.charges = carry.charges; p.roundProps = carry.roundProps; p.hp = Math.max(40, carry.hp); p.selected = carry.selected;
      p.reverie = carry.reverie || 0; p.armor = carry.armor || 0;
      p.updateVial();
    }
    return p;
  }

  // ------------------------------------------------------------ flows
  toTitle() {
    this.state = 'title';
    this.sandbox = false;
    this.meta.sandboxAll = false;
    this.clearWorld();
    this.buildLevel('desert', 0);
    // a lone figure on the sand for the title shot
    const fig = this.assets.cloneFigure();
    const grp = new THREE.Group(); grp.add(fig);
    const y = this.level.heightAt(0, 0);
    grp.position.set(0, y, 0);
    this.scene.add(grp);
    const anim = new FigureAnimator(fig, this.assets.figure.animations);
    anim.play('Idle', { fade: 0 });
    this.attractFig = { grp, anim };
    this.ui.setHud(false);
    this.ui.show('title');
    this.ui.fade(0, 1.2);
    this.input.exitLock();
    this.audio.setLayer(0);
    this.audio.setIntensity(0);
    this.audio.setLucidity(0);
    this.lucidity.reset();
  }

  startRun() {
    this.audio.start();
    this.sandbox = false;
    this.meta.sandboxAll = false;
    this.depth = 0;
    this.lucidity.reset();
    this.lucidity.cap = 100;
    this.stats = this.freshStats();
    this.scrapsAtStart = this.meta.scraps.size;
    this.recentCombos = [];
    this.newRun();
    this.narrator.reset();
    this.loadLayer(0, { charges: new Map([['melting', 1], ['floating', 1]]), roundProps: new Map(), hp: TUNE.playerHP, selected: 0, reverie: 0, armor: 0 });
    this.audio.stinger('runStart');
    if (this.meta.data.runs === 0) this.narrator.sayAll('wake0'); else this.narrator.say('wakeN');
  }

  startSandbox() {
    this.audio.start();
    this.sandbox = true;
    this.meta.sandboxAll = true;
    this.depth = 0;
    this.lucidity.reset();
    this.lucidity.cap = 99;
    this.stats = this.freshStats();
    this.scrapsAtStart = this.meta.scraps.size;
    this.newRun();
    this.clearWorld();
    const lvl = this.buildLevel('sandbox', 0);
    this.makePlayer(lvl.spawn, lvl.spawnYaw);
    this.player.reverie = 99;
    this.narrator.reset();
    this.narrator.spawn();
    this.narrator.say('sandbox');
    this.state = 'playing';
    for (const p of lvl.dummies) this.spawnEnemy(p.clone().setY(lvl.groundY(p.x, p.z) + 0.1), { fireRate: 0.5 });
    this.enterPlay();
    this.ui.card('LUCID', 'The Lucid Room', 'every property, no waking up');
    $('#layer-name').textContent = 'The Lucid Room';
    this.audio.setLayer(0);
  }

  respawnPlayer() {
    const lvl = this.level;
    const carry = { charges: this.player.charges, roundProps: new Map(), hp: TUNE.playerHP, selected: this.player.selected };
    this.player.visual.parent?.remove(this.player.visual);
    this.physics.remove(this.player.body);
    this.physics.world.removeCharacterController(this.player.kcc);
    this.makePlayer(lvl.spawn, lvl.spawnYaw, carry);
  }

  loadLayer(index, carry) {
    this.clearWorld();
    const key = LAYERS[index].key;
    const lvl = this.buildLevel(key, index);
    const drop = lvl.spawn.clone().setY(lvl.spawn.y + (index === 0 ? 0 : 18));
    this.makePlayer(drop, lvl.spawnYaw, carry);
    this.state = 'playing';
    this.narrator.spawn();
    this.narrator.say('layer' + (index + 1));
    this.layerT = 0;
    const found = this.meta.scraps;
    lvl.scrapSpots.forEach((pos, k) => {
      const sc = SCRAPS.find((s) => s.layer === index && s.id === index * 3 + k + 1);
      if (sc && sc.id !== 9 && !found.has(sc.id)) this.pickups.push(new ScrapPickup(this, pos, sc));
    });
    if (key === 'boss') {
      this.boss = new Unwatched(this, lvl.bossSpawn.clone().setY(lvl.groundY(lvl.bossSpawn.x, lvl.bossSpawn.z)));
      this.entities.add(this.boss);
      this.ui.echo(this.recentCombos.slice(-3));
      setTimeout(() => this.audio.stinger('bossIntro'), 1500);
    } else if (lvl.knotSpots?.length) lvl.startKnots();
    else lvl.startWaves();
    $('#layer-name').textContent = LAYERS[index].name;
    const roman = ['I', 'II', 'III', 'IV'][index];
    this.ui.card(`LAYER ${roman}`, LAYERS[index].name, LAYERS[index].subtitle);
    this.audio.setLayer(Math.min(2, index));
    this.enterPlay();
  }

  enterPlay() {
    this.warmShaders();
    this.helpFromGame = false;
    this.ui.hideScreens();
    this.ui.setHud(true);
    this.ui.fade(0, 1.4);
    this.input.requestLock();
    this.audio.setPaused(false);
  }

  descend() {
    if (this.transitioning) return;
    this.transitioning = true;
    this.audio.stinger('descend');
    this.ui.fade(1, 1.1);
    const p = this.player;
    const carry = { charges: p.charges, roundProps: p.roundProps, hp: p.hp, selected: p.selected, reverie: p.reverie, armor: p.armor };
    this.state = 'transition';
    setTimeout(() => {
      // a whim between layers, then down
      this.input.exitLock();
      this.state = 'whims';
      // the last of the layer, held still and dimmed behind the cards
      this.ui.setHud(false);
      this.ui.fade(0, 0.7);
      this.ui.showWhims((w) => {
        w.apply(this.run.mods);
        this.run.whims.push(w.id);
        this.depth++;
        this.ui.fade(1, 0);
        this.loadLayer(this.depth, carry);
        this.transitioning = false;
        this.ui.toast(`Whim: ${w.name}`, 'good');
      });
    }, 1300);
  }

  endRun(cause) {
    if (this.state === 'waking' || this.state === 'bedroom') return;
    this.state = 'waking';
    this.wakeT = 0;
    this.input.exitLock();
    this.narrator.say(cause === 'lucid' ? 'lucidWake' : cause === 'victory' ? 'bossDown' : 'death', { priority: true, force: true });
    this.audio.stinger('wake');
    this.ui.fade(1, 2.2);
    const top = Object.entries(this.stats.propUse).sort((a, b) => b[1] - a[1])[0];
    const stats = { depth: this.depth, strangeness: this.lucidity.total, kills: this.stats.kills, destroyed: this.stats.destroyed, explosions: this.stats.explosions,
      topProp: top ? top[0] : null, cause, victory: cause === 'victory', clarity: this.stats.clarity || 0, memoriesFreed: this.stats.memoriesFreed || 0 };
    setTimeout(() => this.showBedroom(stats), 2600);
  }

  showBedroom(stats) {
    const memory = this.meta.endRun(stats);
    const lines = this.meta.vignette(stats);
    this.clearWorld();
    this.render.setLook(LOOKS.bedroom);
    this.bedroom = buildBedroom(this, this.meta.memories, { victory: stats.victory, found: this.meta.scraps });
    this.bedroomVictory = !!stats.victory;
    this.scene.add(this.bedroom.group);
    this.state = 'bedroom';
    this.bedT = 0;
    this.ui.setHud(false);
    this.ui.fade(0, 2.5);
    const causeText = stats.cause === 'victory' ? 'The dreamer slept soundly' : stats.cause === 'lucid' ? 'The dream grew too lucid' : 'The dreamer woke';
    this.ui.showWaking({ lines, memory, stats, cause: causeText });
    if (memory) setTimeout(() => this.audio.stinger('memory'), 2800);
    this.audio.setLucidity(0); this.audio.setIntensity(0);
  }

  pause() {
    if (this.state !== 'playing') return;
    this.state = 'paused';
    this.ui.renderPauseSummary();
    this.ui.show('pause');
    this.audio.setPaused(true);
    this.input.exitLock();
    if (this.ui.wheelOpen) this.ui.closeWheel();
  }
  resume() {
    if (this.state !== 'paused') return;
    this.state = 'playing';
    this.helpFromGame = false;
    this.ui.hideScreens();
    this.audio.setPaused(false);
    this.input.requestLock({ soft: true });
  }
  enterPhoto() {
    if (this.sbOpen) { this.sbOpen = false; $('#sandbox-panel').hidden = true; }
    if (this.photo.enter()) this.audio.sfx('uiSelect');
  }

  // ------------------------------------------------------------ menus
  bindMenus() {
    const back = () => {
      if (this.helpFromGame) { this.helpFromGame = false; this.resume(); return; }
      if (this.returnTo) { const r = this.returnTo; this.returnTo = null; this.ui.show(r); return; }
      if (this.state === 'paused') this.ui.show('pause');
      else if (this.state === 'title') this.ui.show('title');
      else this.ui.hideScreens();
    };
    const click = (id, fn) => $(id).addEventListener('click', () => {
      this.audio.start(); this.audio.sfx('uiSelect');
      const b = $(id);
      if (document.activeElement !== b) b.focus({ preventScroll: true }); // so the next screen remembers where we came from
      if (b.closest('#title')) this.meta.uiPref('titleFocus', id.slice(1)); // the title menu remembers across sessions too
      fn();
    });
    click('#btn-run', () => this.startRun());
    click('#btn-sandbox', () => this.startSandbox());
    click('#btn-journal', () => { this.ui.renderJournal(); this.ui.show('journal'); });
    click('#btn-keepsakes', () => { this.ui.renderKeepsakes(); this.ui.show('keepsakes'); });
    click('#btn-wake-journal', () => { this.returnTo = 'waking'; this.ui.renderJournal(); this.ui.show('journal'); });
    click('#btn-wake-keepsakes', () => { this.returnTo = 'waking'; this.ui.renderKeepsakes(); this.ui.show('keepsakes'); });
    click('#btn-controls', () => this.ui.show('controls'));
    click('#btn-settings', () => this.ui.show('settings'));
    click('#btn-resume', () => this.resume());
    click('#btn-photo', () => this.enterPhoto());
    click('#btn-pause-controls', () => this.ui.show('controls'));
    click('#btn-pause-settings', () => this.ui.show('settings'));
    click('#btn-quit', () => { if (this.sandbox) this.toTitle(); else { this.state = 'playing'; this.endRun('death'); } });
    click('#btn-sleep', () => this.startRun());
    click('#btn-wake-title', () => this.toTitle());
    for (const b of document.querySelectorAll('.screen .back')) b.addEventListener('click', () => { this.audio.sfx('uiBack'); back(); });
    for (const b of document.querySelectorAll('.menu button')) b.addEventListener('mouseenter', () => { this.audio.sfx('uiHover'); if (document.activeElement !== b) b.focus({ preventScroll: true }); });
    this.bindSettings();
    // keyboard: arrows walk the open menu, Esc goes back, H closes the help it opened
    addEventListener('keydown', (e) => {
      if (this.state === 'photo' || this.state === 'boot') return;
      const scr = this.ui.visibleScreen();
      if (!scr) return;
      if (e.code === 'KeyH' && scr.id === 'controls' && this.helpFromGame) {
        e.preventDefault(); this.input.pressed.delete('KeyH');
        this.audio.sfx('uiBack'); back();
        return;
      }
      if (e.code === 'Escape') {
        this.input.pressed.delete('Escape');
        if (this.helpFromGame && scr.id === 'controls') { this.helpFromGame = false; this.ui.renderPauseSummary(); this.ui.show('pause'); return; }
        const b = scr.querySelector('.back');
        if (b && b.offsetParent !== null) { e.preventDefault(); b.click(); }
        return;
      }
      this.ui.menuKey(e, scr);
    });
    // canvas click captures the mouse
    this.render.renderer.domElement.addEventListener('mousedown', () => {
      this.render.renderer.domElement.focus({ preventScroll: true });
      this.audio.start();
      if (this.state === 'playing' && !this.sbOpen) this.input.requestLock();
    });
    this.input.onLockChange = (locked) => {
      if (!locked && this.state === 'playing' && !this.sbOpen && !this.input.lockFailed) this.pause();
    };
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.pause(); });
    // sandbox panel
    const spawns = [['Sleepwalker', () => this.spawnEnemy(this.spawnPoint(), {})], ['Golconda man', () => this.spawnEnemy(this.spawnPoint().setY(this.spawnPoint().y + 14), { falling: true, gravity: 0.15, variant: 'golconda' })],
      ...['Clock', 'Cloud', 'Mirror', 'Candle', 'Anvil', 'Frame', 'Bed', 'BowlerHat', 'Birdcage', 'Pomegranate', 'Wall', 'Column', 'Drawers', 'Platform'].map((n) => [n.replace('BowlerHat', 'Bowler hat'), () => this.sandboxSpawn(n)])];
    const grid = $('#sb-spawns');
    grid.innerHTML = spawns.map(([n], i) => `<button data-i="${i}">${n}</button>`).join('');
    grid.addEventListener('click', (e) => { const i = e.target.dataset.i; if (i !== undefined) { spawns[+i][1](); this.audio.sfx('uiSelect'); } });
    $('#sb-god').addEventListener('change', (e) => { this.godMode = e.target.checked; });
    $('#sb-freeze').addEventListener('change', (e) => { this.freezeEnemies = e.target.checked; for (const x of this.entities) if (x.kind === 'enemy') x.fireRate = this.freezeEnemies ? 0 : 1; });
    $('#sb-lucid').addEventListener('input', (e) => { this.lucidity.value = +e.target.value; });
    $('#sb-clear').addEventListener('click', () => {
      for (const x of [...this.entities]) if (x.kind === 'enemy') x.die({ type: 'forgotten' });
      this.destruction.clear();
    });
    $('#sb-reset').addEventListener('click', () => { this.toggleSandboxPanel(false); this.startSandbox(); });
    $('#sb-close').addEventListener('click', () => this.toggleSandboxPanel(false));
  }

  // Settings form: every control carries data-k (the setting) and, for sliders, data-fmt
  bindSettings() {
    const fmt = { deg: (v) => `${Math.round(v)}°`, pct: (v) => `${Math.round(v * 100)}%`, x: (v) => `${v.toFixed(2)}×` };
    const inputs = [...document.querySelectorAll('#settings [data-k]')];
    const label = (el) => { const o = el.parentNode.querySelector('output'); if (o && el.dataset.fmt) o.textContent = fmt[el.dataset.fmt](+el.value); };
    const read = (el) => el.type === 'checkbox' ? el.checked : el.type === 'range' ? +el.value
      : el.hasAttribute('data-bool') ? el.value === '1' : (el.value !== '' && !isNaN(+el.value) ? +el.value : el.value);
    const write = (el, v) => {
      if (el.type === 'checkbox') el.checked = !!v;
      else if (el.hasAttribute('data-bool')) el.value = v ? '1' : '0';
      else el.value = String(v);
      label(el);
    };
    this.syncSettingsForm = () => { for (const el of inputs) write(el, this.opts[el.dataset.k]); };
    for (const el of inputs) {
      el.addEventListener(el.type === 'range' ? 'input' : 'change', () => {
        const k = el.dataset.k, v = read(el);
        this.meta.setSetting(k, v);
        this.applySetting(k, v);
        if (k === 'quality') this.qualityLocked = true;
        label(el);
      });
    }
    this.syncSettingsForm();
    const reset = $('#btn-reset-settings');
    reset.addEventListener('click', () => {
      this.audio.sfx('uiBack');
      this.opts = this.meta.resetSettings();
      for (const k of Object.keys(this.opts)) this.applySetting(k, this.opts[k]);
      this.qualityLocked = false;
      this.syncSettingsForm();
      reset.textContent = 'Restored';
      clearTimeout(this._resetT);
      this._resetT = setTimeout(() => { reset.textContent = 'Reset to defaults'; }, 1500);
    });
  }

  // drop graphics quality automatically if the machine can't keep up
  autoQuality(rdt) {
    if (this.state !== 'playing' || this.qualityLocked) return;
    this.qT = (this.qT || 0) + rdt;
    this.qFrames = (this.qFrames || 0) + 1;
    if (this.qT < 5) return;
    const avg = this.qT / this.qFrames;
    this.qT = 0; this.qFrames = 0;
    const cur = this.render.qualityName;
    if (avg > 0.034 && cur !== 'low') {
      const next = cur === 'high' ? 'medium' : 'low';
      this.render.setQuality(next);
      $('#set-quality').value = next;
      this.ui.toast(`Graphics lowered to ${next} to keep things smooth (Settings to change).`);
    } else this.qualityLocked = true;
  }

  // narrator hints and threshold lines (Portal-style onboarding)
  storyTriggers(dt) {
    if (this.state !== 'playing' || !this.player) return;
    const pl = this.player, n = this.narrator;
    this.layerT = (this.layerT || 0) + dt;
    const L = this.lucidity.value;
    const prev = this._prevLucid || 0;
    for (const th of [50, 75, 90]) if (prev < th && L >= th && !this.sandbox) { n.event('lucid' + th); this.level?.surge(th === 50 ? 2 : th === 75 ? 3 : 4, 'The dream grows lucid, and anxious.'); }
    this._prevLucid = L;
    if (this.sandbox) return;
    if (this.depth === 0 && this.layerT > 7 && this.stats.takes === 0) n.event2('hintTake');
    if (this.stats.takes > 0 && this.stats.gives === 0 && this.layerT > 12) n.event2('hintGive');
    let near = false, stag = false;
    for (const e of this.entities) {
      if (e.kind !== 'enemy' || e.dead) continue;
      if (e.obj.position.distanceTo(pl.pos) < 22) near = true;
      if (e.staggered > 0 || (e.hp < e.maxHp * 0.2)) stag = true;
      if (e.lunge && e.lunge.perilous) n.event('perilous');
    }
    if (near) n.event('enemiesNear');
    if (stag) n.event('staggerSeen');
    if (pl.reverie >= 33 && pl.hp < 65) n.event('reverieFull');
    if (this.layerT > 70 && this.stats.gives < 2) n.event2('idleHint');
  }

  spawnPoint() {
    const p = this.player;
    const f = p.flatForward(new THREE.Vector3());
    let at = p.aimPoint.clone();
    if (at.distanceTo(p.pos) > 25 || !isFinite(at.x)) at = p.pos.clone().addScaledVector(f, 7);
    at.y = this.level.groundY(at.x, at.z) + 0.05;
    return at;
  }
  sandboxSpawn(name) {
    const p = this.player;
    const at = this.spawnPoint();
    const yaw = p.camYaw + Math.PI;
    if (name === 'Cloud') at.y += 2.5;
    if (name === 'Platform') at.y += 2.5;
    const e = spawnEntity(this, name, at, { rotY: name === 'Wall' ? yaw + Math.PI / 2 * 0 : yaw });
    e.popIn = 0.001;
    this.vfx.propertyBurst(e.center(), 'multiplying', 0.5);
  }
  toggleSandboxPanel(on) {
    this.sbOpen = on;
    $('#sandbox-panel').hidden = !on;
    if (on) { this.input.exitLock(); $('#sb-lucid').value = Math.round(this.lucidity.value); }
    else this.input.requestLock();
  }

  // ------------------------------------------------------------ loop
  frame(t) {
    requestAnimationFrame((tt) => this.frame(tt));
    const rdt = Math.min(0.05, (t - this.last) / 1000 || 0.016);
    this.last = t;
    try { this.tick(rdt); this.tickErrors = 0; } catch (err) {
      console.error(err);
      // a frame that keeps throwing freezes the picture; say so instead of dying quietly,
      // and report the first error of the streak: later ones are usually its fallout
      this.tickErrors = (this.tickErrors || 0) + 1;
      if (this.tickErrors === 1) this.firstTickError = err;
      if (this.tickErrors === 3) this.showError(this.firstTickError || err);
      try { if (!this.noRender) this.render.render(); } catch (e) { /* the renderer itself is down */ }
    }
  }

  tick(rdt) {
    const input = this.input;
    if (this.state !== 'photo') this.time += rdt; // photo mode holds the dream still, sky and grain included
    let dt = rdt;
    if (this.state === 'playing' || this.state === 'transition' || this.state === 'waking') {
      // global keys
      if (this.state === 'playing') {
        if (input.hit('pause')) { this.pause(); input.endFrame(); this.render.render(); return; }
        if (input.hit('photo') && !this.player.dead) { this.enterPhoto(); input.endFrame(); this.render.render(); return; }
        if (input.hit('help')) { this.pause(); this.ui.show('controls'); this.helpFromGame = true; }
        this.stats.time += rdt;
        if (input.hit('shoulder')) this.player.shoulder *= -1;
        if (input.hit('sandbox') && this.sandbox) this.toggleSandboxPanel(!this.sbOpen);
        // property wheel: hold Tab, slow time
        if (input.is('wheel') && !this.player.dead) {
          if (!this.ui.wheelOpen) this.ui.openWheel();
          const l = input.takeLook();
          this.ui.updateWheel(l.x / input.sensitivity * 0.5, l.y / input.sensitivity * 0.5);
        } else if (this.ui.wheelOpen) this.ui.closeWheel();
      }
      let ts = this.ui.wheelOpen ? 0.2 : 1;
      if (this.state === 'waking') { this.wakeT += rdt; ts = Math.max(0.15, 1 - this.wakeT); }
      if (this.slowT > 0) { this.slowT -= rdt; ts = Math.min(ts, this.slowScale); }
      this.timeScale += (ts - this.timeScale) * Math.min(1, rdt * 10);
      if (this.hitStopT > 0) { this.hitStopT -= rdt; this.timeScale = Math.min(this.timeScale, 0.04); }
      dt = rdt * this.timeScale;
      const pl = this.player;
      if (pl) pl.readInput(this.sbOpen ? { moveAxis: () => ({ x: 0, z: 0 }), hit: () => false, is: () => false } : input, dt);
      this.physics.update(dt);
      this.autoQuality(rdt);
      if (pl) pl.update(dt, this.sbOpen ? { takeLook: () => ({ x: 0, y: 0 }), takeWheel: () => 0, digit: () => 0, hit: () => false, is: () => false, btn: () => false, click: () => false } : input, this.physics.alpha);
      for (const e of this.entities) {
        e.update(dt);
        if (e.dead) this.entities.delete(e);
      }
      for (const p of this.pickups) p.update(dt);
      this.pickups = this.pickups.filter((p) => !p.dead);
      this.projectiles.update(dt);
      this.portals.update(dt);
      this.destruction.update(dt);
      this.level?.update(dt);
      this.lucidity.update(dt);
      this.combatHUD.update(rdt);
      this.narrator.update(rdt);
      this.storyTriggers(dt);
      if (this.lucidity.value >= 100 && !this.sandbox && this.state === 'playing') this.endRun('lucid');
      // audio
      let near = 0;
      for (const e of this.entities) if ((e.kind === 'enemy' || e.kind === 'boss') && pl && e.obj.position.distanceTo(pl.pos) < 35) near++;
      this.audio.setIntensity(Math.min(1, near * 0.18 + (this.boss && !this.boss.dead ? 0.6 : 0)));
      this.audio.setLucidity(this.lucidity.display / 100);
      const cam = this.render.camera;
      const raw = pl && pl.camRaw;
      this.audio.setListener(raw ? raw.pos : cam.position, raw ? new THREE.Vector3(0, 0, -1).applyQuaternion(raw.quat) : cam.getWorldDirection(new THREE.Vector3()));
      // post uniforms
      DREAM.uniforms.uLucid.value = this.lucidity.display / 100;
      const du = this.render.dream.uniforms;
      du.uHurt.value = pl ? pl.hurtFlash : 0;
      du.uSlowmo.value += ((this.ui.wheelOpen ? 1 : 0) - du.uSlowmo.value) * Math.min(1, rdt * 8);
      du.uWatched.value = this.boss && !this.boss.dead && this.boss.watched ? Math.min(1, 0.3 + this.boss.stare * 0.25) : 0;
    } else if (this.state === 'title') {
      const a = this.time * 0.06;
      const f = this.attractFig;
      const c = f.grp.position;
      const cam = this.render.camera;
      cam.position.set(c.x + Math.sin(a) * 6.5, c.y + 1.9 + Math.sin(this.time * 0.2) * 0.3, c.z + Math.cos(a) * 6.5);
      cam.lookAt(c.x - Math.cos(a) * 1.4, c.y + 1.3, c.z + Math.sin(a) * 1.4);
      cam.fov = 45; cam.updateProjectionMatrix();
      f.grp.rotation.y = a + Math.PI * 0.3;
      f.anim.update(rdt, { localVel: { x: 0, y: 0, z: 0 } });
      this.level.update(rdt);
      this.physics.update(rdt);
      for (const e of this.entities) e.update(rdt);
      DREAM.uniforms.uLucid.value = 0.18 + Math.sin(this.time * 0.3) * 0.05;
    } else if (this.state === 'bedroom') {
      this.bedT += rdt;
      const cam = this.render.camera;
      const k = Math.min(1, this.bedT / 20);
      if (this.bedroom.easel && this.bedroomVictory) {
        cam.position.set(1.2 - k * 0.5, 1.5, -1.6 + k * 1.2);
        cam.lookAt(0.55, 1.25, 1.75);
      } else {
        cam.position.set(1.6 - k * 0.6, 1.55, -2.6 + k * 0.8);
        cam.lookAt(-0.6, 0.9, 1.6);
      }
      cam.fov = 50; cam.updateProjectionMatrix();
      if (this.bedroom.clock) this.bedroom.clock.rotation.z = Math.sin(this.bedT * 0.5) * 0.02;
      DREAM.uniforms.uLucid.value = 0;
      this.render.dream.uniforms.uHurt.value = 0;
    } else if (this.state === 'paused') {
      dt = 0;
    } else if (this.state === 'photo') {
      dt = 0;
      this.photo.update(rdt, input);
    }
    // near death: the heartbeat vignette, only while actually playing
    if (this.state !== 'photo') {
      const du = this.render.dream.uniforms, pl = this.player;
      let low = 0;
      if ((this.state === 'playing' || this.state === 'transition') && pl && !pl.dead) {
        const t = Math.min(1, Math.max(0, (pl.hp / pl.maxHp - 0.35) / (0.1 - 0.35)));
        low = t * t * (3 - 2 * t);
      }
      du.uLowHp.value = this.ui.visibleScreen() ? 0 : du.uLowHp.value + (low - du.uLowHp.value) * Math.min(1, rdt * 4);
    }
    this.vfx.update(dt);
    const focus = this.state === 'photo' ? this.photo.focus() : this.player ? this.player.renderPos : (this.attractFig ? this.attractFig.grp.position : new THREE.Vector3());
    this.render.update(dt, focus, this.time);
    this.audio.update(rdt);
    this.ui.update(rdt);
    if (!this.noRender) { this.portals.beforeRender(); this.render.render(); }
    input.endFrame();
  }

  // test hook: advance the simulation without drawing
  simulate(seconds, step = 1 / 60) {
    const nr = this.noRender;
    this.noRender = true;
    for (let t = 0; t < seconds; t += step) this.tick(step);
    this.noRender = nr;
  }
}

const game = new Game();
game.init().catch((e) => {
  console.error(e);
  $('.load-msg').textContent = 'The dream failed to load: ' + (e && e.message ? e.message : e);
});
