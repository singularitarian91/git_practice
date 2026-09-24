// Juxtapose - boot, game loop and run structure.
import * as THREE from 'three';
import { Renderer, DREAM } from './render.js';
import { Physics } from './physics.js';
import { Assets } from './assets.js';
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
import { spawnEntity, Pickup } from './entities.js';
import { LAYERS, PROPS, PROP_INFO, TUNE } from './config.js';
import { FigureAnimator } from './animator.js';

const $ = (s) => document.querySelector(s);

class Game {
  constructor() {
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
    const S = this.meta.settings();
    this.render = new Renderer($('#stage'), S.quality || 'high');
    this.scene = this.render.scene;
    fill.style.width = '15%';
    msg.textContent = 'Waking the physics...';
    this.physics = await Physics.create();
    fill.style.width = '30%';
    msg.textContent = 'Remembering things that never happened...';
    this.assets = new Assets();
    await this.assets.load((p) => { fill.style.width = (30 + p * 60) + '%'; });
    this.input = new Input(this.render.renderer.domElement);
    this.input.sensitivity = 0.0022 * (S.sens ?? 1);
    this.input.invertY = !!S.invert;
    this.vfx = new VFX(this.scene, this.assets.textures, this.render);
    this.audio = new DreamAudio();
    this.audio.setMasterVolume(S.vol ?? 0.8);
    this.audio.setMusicVolume(S.music ?? 0.7);
    this.ui = new UI(this);
    this.lucidity = new Lucidity(this);
    this.destruction = new Destruction(this);
    this.projectiles = new Projectiles(this);
    this.stats = this.freshStats();
    this.bindMenus();
    fill.style.width = '100%';
    this.toTitle();
    this.last = performance.now();
    requestAnimationFrame((t) => this.frame(t));
    if (matchMedia('(pointer: coarse)').matches && !matchMedia('(pointer: fine)').matches) $('#touch-note').hidden = false;
    window.__game = this;
  }

  freshStats() { return { gives: 0, takes: 0, kills: 0, destroyed: 0, explosions: 0, propUse: {} }; }

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
  onEntityDeath(e) { /* removed from the set in the loop */ }
  onPlayerDeath() {
    if (this.sandbox) {
      this.ui.toast('You wake, and fall straight back to sleep.', 'warn');
      setTimeout(() => { if (this.sandbox && this.player) this.respawnPlayer(); }, 2200);
      return;
    }
    this.endRun('death');
  }
  onBossDefeated() {
    this.ui.toast('The eye closes.', 'good');
    this.audio.stinger('memory');
    setTimeout(() => { if (this.state === 'playing') this.endRun('victory'); }, 4500);
  }

  // ------------------------------------------------------------ world lifecycle
  clearWorld() {
    for (const e of this.entities) { e.obj.parent?.remove(e.obj); if (e.fireLight) this.render.release(e.fireLight); }
    this.entities.clear();
    for (const p of this.pickups) p.obj.parent?.remove(p.obj);
    this.pickups = [];
    this.projectiles.clear();
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
    p.teleport(spawn, yaw);
    this.physics.beforeStep = (h) => { if (this.player) this.player.fixedUpdate(h); };
    if (carry) {
      p.charges = carry.charges; p.roundProps = carry.roundProps; p.hp = Math.max(40, carry.hp); p.selected = carry.selected;
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
    this.recentCombos = [];
    this.loadLayer(0, { charges: new Map([['melting', 1], ['floating', 1]]), roundProps: new Map(), hp: TUNE.playerHP, selected: 0 });
    this.audio.stinger('runStart');
  }

  startSandbox() {
    this.audio.start();
    this.sandbox = true;
    this.meta.sandboxAll = true;
    this.depth = 0;
    this.lucidity.reset();
    this.lucidity.cap = 99;
    this.stats = this.freshStats();
    this.clearWorld();
    const lvl = this.buildLevel('sandbox', 0);
    this.makePlayer(lvl.spawn, lvl.spawnYaw);
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
    if (key === 'boss') {
      this.boss = new Unwatched(this, lvl.bossSpawn.clone().setY(lvl.groundY(lvl.bossSpawn.x, lvl.bossSpawn.z)));
      this.entities.add(this.boss);
      this.ui.echo(this.recentCombos.slice(-3));
      setTimeout(() => this.audio.stinger('bossIntro'), 1500);
    } else lvl.startWaves();
    $('#layer-name').textContent = LAYERS[index].name;
    const roman = ['I', 'II', 'III', 'IV'][index];
    this.ui.card(`LAYER ${roman}`, LAYERS[index].name, LAYERS[index].subtitle);
    this.audio.setLayer(Math.min(2, index));
    this.enterPlay();
  }

  enterPlay() {
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
    const carry = { charges: p.charges, roundProps: p.roundProps, hp: p.hp, selected: p.selected };
    this.state = 'transition';
    setTimeout(() => {
      this.depth++;
      this.loadLayer(this.depth, carry);
      this.transitioning = false;
    }, 1300);
  }

  endRun(cause) {
    if (this.state === 'waking' || this.state === 'bedroom') return;
    this.state = 'waking';
    this.wakeT = 0;
    this.input.exitLock();
    this.audio.stinger('wake');
    this.ui.fade(1, 2.2);
    const top = Object.entries(this.stats.propUse).sort((a, b) => b[1] - a[1])[0];
    const stats = { depth: this.depth, strangeness: this.lucidity.total, kills: this.stats.kills, destroyed: this.stats.destroyed, explosions: this.stats.explosions,
      topProp: top ? top[0] : null, cause, victory: cause === 'victory' };
    setTimeout(() => this.showBedroom(stats), 2600);
  }

  showBedroom(stats) {
    const memory = this.meta.endRun(stats);
    const lines = this.meta.vignette(stats);
    this.clearWorld();
    this.render.setLook(LOOKS.bedroom);
    this.bedroom = buildBedroom(this, this.meta.memories);
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
    this.ui.show('pause');
    this.audio.setPaused(true);
    this.input.exitLock();
    if (this.ui.wheelOpen) this.ui.closeWheel();
  }
  resume() {
    if (this.state !== 'paused') return;
    this.state = 'playing';
    this.ui.hideScreens();
    this.audio.setPaused(false);
    this.input.requestLock();
  }

  // ------------------------------------------------------------ menus
  bindMenus() {
    const back = () => {
      if (this.state === 'paused') this.ui.show('pause');
      else if (this.state === 'title') this.ui.show('title');
      else this.ui.hideScreens();
    };
    const click = (id, fn) => $(id).addEventListener('click', () => { this.audio.start(); this.audio.sfx('uiSelect'); fn(); });
    click('#btn-run', () => this.startRun());
    click('#btn-sandbox', () => this.startSandbox());
    click('#btn-memories', () => { this.ui.renderMemories(); this.ui.show('memories'); });
    click('#btn-controls', () => this.ui.show('controls'));
    click('#btn-settings', () => this.ui.show('settings'));
    click('#btn-resume', () => this.resume());
    click('#btn-pause-controls', () => this.ui.show('controls'));
    click('#btn-pause-settings', () => this.ui.show('settings'));
    click('#btn-quit', () => { if (this.sandbox) this.toTitle(); else { this.state = 'playing'; this.endRun('death'); } });
    click('#btn-sleep', () => this.startRun());
    click('#btn-wake-title', () => this.toTitle());
    for (const b of document.querySelectorAll('.screen .back')) b.addEventListener('click', () => { this.audio.sfx('uiBack'); back(); });
    for (const b of document.querySelectorAll('.menu button')) b.addEventListener('mouseenter', () => this.audio.sfx('uiHover'));
    // settings
    const S = this.meta.settings();
    const q = $('#set-quality'); q.value = S.quality || 'high';
    q.addEventListener('change', () => { this.meta.setSetting('quality', q.value); this.render.setQuality(q.value); this.qualityLocked = true; });
    const sens = $('#set-sens'); sens.value = S.sens ?? 1;
    sens.addEventListener('input', () => { this.input.sensitivity = 0.0022 * +sens.value; this.meta.setSetting('sens', +sens.value); });
    const vol = $('#set-vol'); vol.value = S.vol ?? 0.8;
    vol.addEventListener('input', () => { this.audio.setMasterVolume(+vol.value); this.meta.setSetting('vol', +vol.value); });
    const mus = $('#set-music'); mus.value = S.music ?? 0.7;
    mus.addEventListener('input', () => { this.audio.setMusicVolume(+mus.value); this.meta.setSetting('music', +mus.value); });
    const inv = $('#set-invert'); inv.checked = !!S.invert;
    inv.addEventListener('change', () => { this.input.invertY = inv.checked; this.meta.setSetting('invert', inv.checked); });
    // canvas click captures the mouse
    this.render.renderer.domElement.addEventListener('mousedown', () => {
      this.audio.start();
      if (this.state === 'playing' && !this.sbOpen) this.input.requestLock();
    });
    this.input.onLockChange = (locked) => {
      if (!locked && this.state === 'playing' && !this.sbOpen && !this.input.lockFailed) this.pause();
    };
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.pause(); });
    // sandbox panel
    const spawns = [['Sleepwalker', () => this.spawnEnemy(this.spawnPoint(), {})], ['Golconda man', () => this.spawnEnemy(this.spawnPoint().setY(this.spawnPoint().y + 14), { falling: true, gravity: 0.15, variant: 'golconda' })],
      ...['Clock', 'Cloud', 'Mirror', 'Candle', 'Anvil', 'Bed', 'BowlerHat', 'Birdcage', 'Pomegranate', 'Wall', 'Column', 'Drawers', 'Platform'].map((n) => [n.replace('BowlerHat', 'Bowler hat'), () => this.sandboxSpawn(n)])];
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
    try { this.tick(rdt); } catch (err) { console.error(err); }
  }

  tick(rdt) {
    const input = this.input;
    this.time += rdt;
    let dt = rdt;
    if (this.state === 'playing' || this.state === 'transition' || this.state === 'waking') {
      // global keys
      if (this.state === 'playing') {
        if (input.hit('pause')) { this.pause(); input.endFrame(); this.render.render(); return; }
        if (input.hit('help')) { this.pause(); this.ui.show('controls'); }
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
      this.timeScale += (ts - this.timeScale) * Math.min(1, rdt * 10);
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
      this.destruction.update(dt);
      this.level?.update(dt);
      this.lucidity.update(dt);
      if (this.lucidity.value >= 100 && !this.sandbox && this.state === 'playing') this.endRun('lucid');
      // audio
      let near = 0;
      for (const e of this.entities) if ((e.kind === 'enemy' || e.kind === 'boss') && pl && e.obj.position.distanceTo(pl.pos) < 35) near++;
      this.audio.setIntensity(Math.min(1, near * 0.18 + (this.boss && !this.boss.dead ? 0.6 : 0)));
      this.audio.setLucidity(this.lucidity.display / 100);
      const cam = this.render.camera;
      this.audio.setListener(cam.position, cam.getWorldDirection(new THREE.Vector3()));
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
      cam.position.set(1.6 - k * 0.6, 1.55, -2.6 + k * 0.8);
      cam.lookAt(-0.6, 0.9, 1.6);
      cam.fov = 50; cam.updateProjectionMatrix();
      if (this.bedroom.clock) this.bedroom.clock.rotation.z = Math.sin(this.bedT * 0.5) * 0.02;
      DREAM.uniforms.uLucid.value = 0;
      this.render.dream.uniforms.uHurt.value = 0;
    } else if (this.state === 'paused') {
      dt = 0;
    }
    this.vfx.update(dt);
    const focus = this.player ? this.player.renderPos : (this.attractFig ? this.attractFig.grp.position : new THREE.Vector3());
    this.render.update(dt, focus, this.time);
    this.audio.update(rdt);
    this.ui.update(rdt);
    if (!this.noRender) this.render.render();
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
