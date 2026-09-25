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
import { drawPainting } from './painting.js';
import { Player } from './player.js';
import { Sleepwalker } from './enemies.js';
import { Unwatched } from './boss.js';
import { spawnEntity, Pickup, ScrapPickup } from './entities.js';
import { LAYERS, PROPS, PROP_INFO, TUNE } from './config.js';
import { FigureAnimator } from './animator.js';
import { Portals } from './portals.js';
import { Narrator } from './narrator.js';
import { CombatHUD } from './combat.js';
import { defaultMods, SCRAPS, WHIMS, DIFFICULTY } from './meta.js';
import { PhotoMode } from './photo.js';
import { RANKS, CLARITY, rankOf, applyRanks } from './knots.js';
import { Cutscene, orbit } from './cutscene.js';

const $ = (s) => document.querySelector(s);
// With "Night-Light tips and asides" off, only these lines still play
const STORY_LINES = new Set(['wake0', 'wakeN', 'layer1', 'layer2', 'layer3', 'bossPhase', 'bossDown', 'death', 'lucidWake', 'scrap', 'laststand']);
const TIP_GAP = 16; // seconds between the Night-Light's tips

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
    // the Night-Light's tips and asides can be muted; its story lines can't. Tips are
    // spaced out, one idea at a time: a tip that comes too soon waits its turn, and
    // one that waits too long is dropped (the moment for it has passed)
    const say = this.narrator.say.bind(this.narrator);
    this.tipQueue = []; this.lastTip = -99;
    this.narrator.say = (key, o) => {
      if (STORY_LINES.has(key) || key.startsWith('puzzle') || key.startsWith('meet_')) { say(key, o); return; }
      if (!this.opts.tips) return;
      if (this.time - this.lastTip >= TIP_GAP && !this.narrator.cur && !this.narrator.queue.length) { this.lastTip = this.time; say(key, o); }
      else if (!this.tipQueue.some((t) => t.key === key)) this.tipQueue.push({ key, o, at: this.time });
    };
    this.flushTips = () => {
      this.tipQueue = this.tipQueue.filter((t) => this.time - t.at < 50);
      if (!this.tipQueue.length || this.time - this.lastTip < TIP_GAP || this.narrator.cur || this.narrator.queue.length || this.state !== 'playing') return;
      const t = this.tipQueue.shift();
      this.lastTip = this.time; say(t.key, t.o);
    };
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
      case 'difficulty': this.diff = DIFFICULTY[v] || DIFFICULTY.dream; break;
      case 'renderScale': this.render.renderScale = v; this.render.setQuality(this.render.qualityName); break;
      case 'padSens': this.input.padLook = v; break;
      default: break; // fov, shake, tips, guardToggle, autoReload, drawDistance are read where they are used
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
    this.lastGiven = p;
    this.recentCombos.push(p);
    if (this.recentCombos.length > 6) this.recentCombos.shift();
    this.stats.propUse[p] = (this.stats.propUse[p] || 0) + 1;
  }
  spawnEnemy(pos, opts = {}) {
    if (this.state !== 'playing' && this.state !== 'transition') return null;
    const e = new Sleepwalker(this, pos, { ...opts, hp: (opts.hp ?? 60) * (this.sandbox ? 1 : this.diff?.hp ?? 1), fireRate: this.freezeEnemies ? 0 : (opts.fireRate ?? 1 + this.depth * 0.15) });
    this.entities.add(e);
    return e;
  }
  spawnPickup(pos) { this.pickups.push(new Pickup(this, pos)); }
  spawnCopy(e, pos) {
    if (e.kind === 'enemy') {
      const c = new Sleepwalker(this, pos, { variant: e.variant, hp: e.hp / (e.K?.hp || 1), fireRate: this.freezeEnemies ? 0 : 1 });
      this.entities.add(c);
      return c;
    }
    if (e.kind === 'boss' || e.noCopy) return null;
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
    applyRanks(this.run.mods, this.meta.data.clarity || 0, this.meta); // what the Figment has become, it stays
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
      this.ui.card('CLARITY', R.name, 'A point to spend on who you are, when you wake');
      this.audio.stinger('memory');
      if (this.player) this.vfx.propertyBurst(this.player.pos.clone().setY(this.player.pos.y + 1.2), 'floating', 1.4);
    }
    if (at && n >= 8) this.vfx.trail(at.clone().setY(at.y + 1.4), '#ffd27a', 0.3, 0.6);
    this.ui.clarity(after);
    this.meta.save();
  }

  // ------------------------------------------------------------ cutscenes
  playCutscene(shots, opts = {}) {
    if (this.noCutscenes) { const c = new Cutscene(this, shots); c.skip(); opts.onEnd?.(); return; }
    this.cut = new Cutscene(this, shots, opts);
    this.cutAfter = opts.after || 'playing'; // the state to go back to (the bedroom, for the ending)
    this.state = 'cutscene';
    this.ui.setHud(false);
    this.ui.letterbox(true);
  }
  endCutscene() {
    const cb = this.cut?.onEnd;
    this.cut = null;
    this.ui.letterbox(false);
    this.state = this.cutAfter || 'playing';
    if (this.state === 'playing') this.ui.setHud(true);
    cb?.();
  }
  // arriving in a layer: the dream shows you where you are before it hands you the controls
  playIntro() {
    const lvl = this.level, p = this.player;
    if (!lvl || !p || !lvl.knots) return;
    const V = (x, y, z) => new THREE.Vector3(x, y, z);
    const eye = p.pos.clone().add(V(0, 1.6, 0)), first = lvl.current;
    const shots = lvl.key === 'desert' ? [
      { dur: 4.2, pos: [V(-70, 34, 95), V(-20, 26, 78)], look: [V(0, 4, 10), V(0, 3, -6)], fov: 50, caption: 'A fishing village, sunk in soft sand. The dream keeps its memories here.' },
      first && { dur: 3.2, pos: [first.pos.clone().add(V(-12, 9, 14)), first.pos.clone().add(V(-7, 5, 9))], look: first.pos.clone().add(V(0, 2, 0)), fov: 48, caption: `First, ${first.def.name}.` },
      { dur: 3, pos: [V(0, 14, -12), eye.clone().add(V(0, 2.2, -5))], look: [V(0, 1, -27), eye], fov: [50, 60] },
    ] : [
      { dur: 4, pos: orbit(V(0, 0, 0), 60, 30, 0.6, 1.8), look: V(0, 4, 0), fov: 50, caption: 'The city he left for, where every crowd is the same man.' },
      first && { dur: 3, pos: [first.pos.clone().add(V(10, 8, 10)), first.pos.clone().add(V(6, 4, 6))], look: first.pos.clone().add(V(0, 2, 0)), fov: 48, caption: `First, ${first.def.name}.` },
      this.narrator.obj && { dur: 3.6, pos: [this.narrator.obj.position.clone().add(V(1.4, 0.3, 1.4)), this.narrator.obj.position.clone().add(V(0.9, 0.1, 0.9))], look: this.narrator.obj.position.clone(), fov: 38, caption: 'Night-Light: He came here to be nobody in particular. It worked. Keep your eyes open.' },
      { dur: 2.6, pos: [V(0, 12, -20), eye.clone().add(V(0, 2.2, -5))], look: eye, fov: [50, 60] },
    ];
    this.playCutscene(shots, { onEnd: () => first && lvl.guide(p.pos.clone(), first.pos) });
  }
  // the last room: the ring of mirrors, the candles, and the eye, which opens
  playBossIntro() {
    const lvl = this.level, p = this.player, b = this.boss;
    if (!lvl || !p || !b) return;
    const V = (x, y, z) => new THREE.Vector3(x, y, z);
    const eyeAt = b.center(), eye = p.pos.clone().add(V(0, 1.6, 0));
    const lids = (k) => { // 1 shut, 0 open
      const q = new THREE.Quaternion(), X = V(1, 0, 0);
      if (b.lidTop) b.lidTop.quaternion.copy(b.rest.UW_LidTop.q).multiply(q.setFromAxisAngle(X, k * 0.42));
      if (b.lidBot) b.lidBot.quaternion.copy(b.rest.UW_LidBottom.q).multiply(q.setFromAxisAngle(X, -k * 0.42));
      for (const m of b.irisMats) m.emissiveIntensity = m.userData.baseEI * (0.2 + (1 - k) * 3.5);
    };
    // frame the eye from the side it looks out of
    const toCam = new THREE.Vector3(0, 0, 1).applyQuaternion(b.obj.quaternion).setY(0).normalize();
    const shots = [
      { dur: 5, pos: orbit(V(0, 0, 0), 36, 11, -2.2, -0.9), look: V(0, 3, 0), fov: 50, caption: 'The last room of the dream. Mirrors, and candles, and something she has never once looked at directly.', at: () => lids(1) },
      { dur: 4.5, pos: [eyeAt.clone().addScaledVector(toCam, 16).add(V(3, -2, 0)), eyeAt.clone().addScaledVector(toCam, 7).add(V(1, -0.6, 0))], look: eyeAt, fov: [44, 34], caption: 'It has waited sixty years for her to turn around.', tick: (dt, k) => lids(1 - Math.max(0, (k - 0.55) / 0.45)) },
      { dur: 3, pos: [eyeAt.clone().addScaledVector(toCam, 9).add(V(0, 0.4, 0)), eyeAt.clone().addScaledVector(toCam, 7.5).add(V(0, 0.2, 0))], look: eyeAt, fov: 36, caption: 'The Unwatched. It can only be hurt while you are not looking at it.',
        at: () => { lids(0); this.audio.sfx('bossRoar', { position: eyeAt, gain: 0.9 }); } },
      { dur: 2.6, pos: [eyeAt.clone().addScaledVector(toCam, 10).add(V(0, 4, 0)), eye.clone().addScaledVector(toCam, 4.5).add(V(0, 1.8, 0))], look: [eyeAt, eye], fov: [50, 60] },
    ];
    this.playCutscene(shots, { onEnd: () => { b.intro = Math.max(b.intro, 1.2); this.meta.data.seenBoss = (this.meta.data.seenBoss || 0) + 1; this.meta.save(); } });
  }

  // the first night: who is dreaming, who you are, and what you're for. Skippable, replayable from the title.
  playPrologue() {
    const lvl = this.level, p = this.player;
    if (!lvl || !p) return;
    const V = (x, y, z) => new THREE.Vector3(x, y, z);
    const eye = p.pos.clone().add(V(0, 1.5, 0)), fwd = p.flatForward();
    const bed = V(-40, lvl.groundY(-40, 20) + 0.8, 20), first = lvl.current;
    const shots = [
      { dur: 5.5, pos: [V(30, 60, 120), V(10, 30, 70)], look: [V(0, 40, -40), V(0, 4, 0)], fov: 55, caption: 'Odile Vautrin has mended every clock on the Rue des Horloges for sixty years. She has let her own run down.' },
      { dur: 5.5, pos: orbit(bed, 6, 2.6, 0.4, 1.4), look: bed, fov: 45, caption: 'On a December morning in 1958 her brother Théo caught the 6:40 train. He left a note under a split pomegranate: When you wake up, I will already be gone.' },
      { dur: 5, pos: [bed.clone().add(V(3, 5, 9)), bed.clone().add(V(1, 3, 5))], look: bed, fov: 40, caption: 'He left a painting too, unfinished. She put it under a sheet in the back bedroom, and has not looked at it since.' },
      { dur: 5.5, pos: [eye.clone().addScaledVector(fwd, 5).add(V(fwd.z * 2.5, 0.4, -fwd.x * 2.5)), eye.clone().addScaledVector(fwd, 2.4).add(V(fwd.z * 1.2, 0, -fwd.x * 1.2))], look: eye, fov: 40, caption: 'Tonight, in her dream, the figure from that painting gets up. A wooden man in a bowler hat, an apple where his face should be. You.',
        at: () => p.anim.play('Idle', { fade: 0.2 }) },
      { dur: 5, pos: [eye.clone().addScaledVector(fwd, -2.2).add(V(1.2, 0.3, 0)), eye.clone().addScaledVector(fwd, -1.6).add(V(0.9, 0.1, 0))], look: eye.clone().addScaledVector(fwd, 6), fov: 50, caption: 'Your gun takes a quality from one thing and gives it to another. Clocks melt. Anvils float. Fears fall asleep.',
        at: () => { p.anim.trigger?.('Infuse', { speed: 0.8 }); this.vfx.propertyBurst(eye.clone().addScaledVector(fwd, 5), 'melting', 1.2); } },
      first && { dur: 5.5, pos: [first.pos.clone().add(V(-14, 10, 14)), first.pos.clone().add(V(-8, 5, 8))], look: first.pos.clone().add(V(0, 2, 0)), fov: 48, caption: 'Her anxieties keep what she cannot bear to remember, tangled in ink. Take her memories back, and the dream will let you deeper.', at: () => lvl.relight() },
      { dur: 5, pos: [V(-6, 5, 70), V(-3, 3, 60)], look: [V(0, 2, 55), V(0, 1.5, 50)], fov: 50, caption: 'Somewhere below is the painting. Reach it before the dream grows too strange, and she wakes.' },
      { dur: 2.6, pos: [V(0, 14, -12), eye.clone().add(V(0, 2.2, -5))], look: [V(0, 1, -27), eye], fov: [50, 60] },
    ];
    this.playCutscene(shots, { onEnd: () => { this.meta.data.seenPrologue = true; this.meta.save(); if (first) lvl.guide(p.pos.clone(), first.pos); } });
  }

  // the first time the Figment meets one of the new anxieties, the dream stops to introduce it
  introduceEnemy(e) {
    const K = e.K;
    if (!K || this.sandbox || this.state !== 'playing' || this.cut) return;
    const seen = this.meta.data.seenEnemies || (this.meta.data.seenEnemies = {});
    if (seen[e.variant]) return;
    seen[e.variant] = true; this.meta.save();
    const V = (x, y, z) => new THREE.Vector3(x, y, z);
    const c = e.center().add(V(0, 0.4 * e.size, 0)), p = this.player;
    const dir = p.pos.clone().sub(c).setY(0).normalize(), a0 = Math.atan2(dir.z, dir.x);
    const r = 3.6 * e.size;
    this.playCutscene([
      { dur: 3.6, pos: orbit(c, r, 0.3 * e.size, a0 - 0.5, a0 + 0.35), look: c, fov: 40, caption: `${K.title}. ${K.line}`, at: () => this.audio.sfx('perilous', { position: c, gain: 0.5 }) },
    ]);
    this.narrator.say('meet_' + e.variant);
  }

  // a translucent Figment acting out a memory beside the thing it's about
  memoryGhost(knot) {
    const fig = this.assets.cloneFigure();
    fig.traverse((m) => { if (m.isMesh) { m.material.transparent = true; m.material.opacity = 0.32; m.material.depthWrite = false; m.material.emissive = new THREE.Color('#ffd9a0'); m.material.emissiveIntensity = 0.5; } });
    const g = new THREE.Group(); g.add(fig);
    const side = new THREE.Vector3(1.5, 0, 0.6);
    g.position.copy(knot.pos).add(side);
    g.rotation.y = Math.atan2(-side.x, -side.z);
    const anim = new FigureAnimator(fig, this.assets.figure.animations);
    anim.play(['Focus', 'Idle', 'Guard'][Math.floor(Math.random() * 2)], { fade: 0 });
    return { show: () => this.scene.add(g), update: (dt) => anim.update(dt, { localVel: { x: 0, y: 0, z: 0 } }), remove: () => this.scene.remove(g) };
  }

  // a memory taken back: see it again, see the way open, then choose a whim
  onKnotFreed(knot) {
    this.stats.memoriesFreed = (this.stats.memoriesFreed || 0) + 1;
    const lvl = this.level, p = this.player;
    const V = (x, y, z) => new THREE.Vector3(x, y, z);
    const optional = !!knot.def.optional, stage = lvl.stage, next = lvl.current;
    const opening = optional ? [] : lvl.veilsFor(stage);
    const doorNow = !optional && lvl.chain && stage === lvl.knotsNeeded && !lvl.doorOpen;
    const c = knot.pos.clone().setY(knot.pos.y + 1.3), a0 = Math.atan2(p.pos.z - c.z, p.pos.x - c.x);
    const ghost = this.memoryGhost(knot);
    const back = (target, d, h) => { const dir = p.pos.clone().sub(target).setY(0); if (dir.lengthSq() < 1) dir.set(0, 0, 1); dir.normalize(); return target.clone().addScaledVector(dir, d).setY(target.y + h); };
    const shots = [
      { dur: 4, pos: orbit(c, 4.4, 0.8, a0, a0 + 1.2), look: c, fov: 42, caption: knot.def.text, at: ghost.show, tick: ghost.update, end: ghost.remove },
    ];
    if (opening.length) {
      const v = opening[0], vc = v.center.clone().setY(v.center.y + 3);
      shots.push({ dur: 3.4, pos: [back(vc, 16, 5), back(vc, 11, 3)], look: vc, fov: 52, caption: 'The dream lets you further in.', at: () => opening.forEach((o) => o.open()) });
    }
    if (next && !optional) {
      const nc = next.pos.clone().setY(next.pos.y + 2);
      shots.push({ dur: 3, pos: [back(nc, 20, 10), back(nc, 14, 6)], look: [nc.clone().setY(nc.y + 8), nc], fov: 50, caption: `Next: ${next.def.name}.`, at: () => lvl.relight() });
    }
    if (doorNow && lvl.door) {
      const d = lvl.door.pos.clone().setY(lvl.door.pos.y + 2);
      const city = lvl.key === 'piazza';
      shots.push(city
        ? { dur: 5, pos: [d.clone().add(V(-30, 8, -26)), d.clone().add(V(-8, 4, -16))], look: [d.clone().add(V(-30, 0, 0)), d], fov: 48, caption: 'The 6:40 comes round the hill, and this time it stops for you.', at: () => lvl.openDoor() }
        : { dur: 3.4, pos: [d.clone().add(V(-6, 4, -14)), d.clone().add(V(-2, 2.5, -8))], look: d, fov: 48, caption: 'A door has opened in the shallows.', at: () => lvl.openDoor() });
    }
    // the Night-Light has the last word on it, close up
    const nl = this.narrator.obj;
    if (nl && knot.def.nl) {
      const at = nl.position.clone(), side = p.flatLeft(new THREE.Vector3());
      shots.push({ dur: 3.8, pos: [at.clone().addScaledVector(side, 1.6).add(V(0, 0.2, 0)).addScaledVector(p.flatForward(), 1.2), at.clone().addScaledVector(side, 1.1).addScaledVector(p.flatForward(), 0.8)], look: at, fov: 38, caption: `Night-Light: ${knot.def.nl}` });
    }
    this.playCutscene(shots, {
      onEnd: () => {
        lvl.relight(); lvl.startPatrols();
        lvl.guide(knot.pos, next && !optional ? next.pos : doorNow ? lvl.door.pos : null);
        if (doorNow) lvl.surge(3 + this.depth, 'The dream notices what you took back. It sends them after you.');
        this.offerWhim();
      },
    });
  }
  offerWhim() {
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
  }


  // The end: Odile lifts the sheet. The painting finishes itself as she remembers,
  // the apple the Figment wore for a face falls away, and she lets the candle go out.
  playEnding(lines, done) {
    const V = (x, y, z) => new THREE.Vector3(x, y, z);
    const B = this.bedroom, easel = B.easel, A = this.assets;
    easel.updateMatrixWorld(true);
    const at = (x, y, z) => easel.localToWorld(V(x, y, z));
    const face = at(0, 1.49, 0.34), mid = at(0, 1.2, 0.3), front = at(0, 1.2, 1.4).sub(mid).setY(0).normalize();
    const sheet = easel.getObjectByName('Easel_Sheet');
    const sheet0 = sheet ? { p: sheet.position.clone(), r: sheet.rotation.clone() } : null;
    // the finished canvas, waiting
    const cv = document.createElement('canvas'); cv.width = 512; cv.height = 640;
    drawPainting(cv, { found: this.meta.scraps, finished: true, frame: false });
    const done2 = new THREE.CanvasTexture(cv); done2.colorSpace = THREE.SRGBColorSpace; done2.flipY = false; done2.anisotropy = 8;
    let painting = null;
    easel.traverse((m) => { if (m.isMesh) for (const mm of Array.isArray(m.material) ? m.material : [m.material]) if (mm.name === 'Painting') painting = mm; });
    // the candle on the drawers, lit
    let candle = null;
    B.group.traverse((o) => { if (o.name === 'Candle' && !candle) candle = o; });
    if (!candle && A.has('Candle')) { candle = A.clone('Candle', { uniqueMaterials: false }); candle.position.set(1.9, 1.12, 2.2); B.group.add(candle); }
    const flame = candle?.getObjectByName('Candle_Flame');
    const cLight = new THREE.PointLight(0xffb865, 1.4, 4); if (candle) { cLight.position.copy(candle.position).add(V(0, 0.65, 0)); B.group.add(cLight); }
    // the apple
    const apple = A.has('Apple') ? A.clone('Apple') : new THREE.Mesh(new THREE.SphereGeometry(0.05, 12, 8), new THREE.MeshStandardMaterial({ color: '#7dbb3c' }));
    apple.scale.setScalar(1.3); apple.visible = false;
    apple.traverse((m) => { if (m.isMesh) m.castShadow = true; });
    B.group.add(apple);
    const fall = { p: face.clone().addScaledVector(front, 0.08), v: front.clone().multiplyScalar(0.5).setY(0.6), spin: 0, rest: false };
    const lift = (k) => { if (!sheet || !sheet0) return; sheet.position.copy(sheet0.p).add(V(0, k * 1.2, 0)); sheet.rotation.set(sheet0.r.x - k * 0.9, sheet0.r.y, sheet0.r.z + k * 0.3); sheet.visible = k < 0.98; };
    const finish = () => { if (painting && painting.map !== done2) { painting.map = done2; painting.needsUpdate = true; this.vfx.propertyBurst(face, 'floating', 0.9); this.audio.stinger('memory'); } };
    const drop = (dt) => {
      apple.visible = true;
      if (fall.rest) return;
      fall.v.y -= 9.8 * dt; fall.p.addScaledVector(fall.v, dt); fall.spin += dt * 6;
      if (fall.p.y < 0.05) { fall.p.y = 0.05; if (Math.abs(fall.v.y) < 0.6) { fall.rest = true; fall.v.set(0, 0, 0); } else { fall.v.y *= -0.35; fall.v.x *= 0.6; fall.v.z *= 0.6; this.audio.sfx('land', { gain: 0.4 }); } }
      apple.position.copy(fall.p); apple.rotation.set(fall.spin, 0, fall.spin * 0.6);
    };
    const settle = () => { apple.visible = true; fall.p.y = 0.05; fall.rest = true; if (fall.p.distanceTo(face) < 0.3) fall.p.addScaledVector(front, 0.5); apple.position.copy(fall.p); };
    const snuff = () => { if (flame && flame.visible) { flame.visible = false; cLight.intensity = 0; const f = candle.position.clone().add(V(0, 0.6, 0)); for (let i = 0; i < 14; i++) this.vfx.smoke?.spawn?.({ x: f.x, y: f.y, z: f.z, vx: (Math.random() - 0.5) * 0.05, vy: 0.25 + Math.random() * 0.15, vz: (Math.random() - 0.5) * 0.05, color: new THREE.Color('#cfc8c0'), alpha: 0.35, alpha1: 0, size: 0.05, size1: 0.3, life: 2.5 + Math.random() }); } };
    const E = lines;
    const view = (d, h) => mid.clone().addScaledVector(front, d).add(V(0, h, 0));
    const shots = [
      { dur: 6, pos: [V(2.3, 1.75, -3.0), V(2.0, 1.65, -2.4)], look: [mid.clone().add(V(0, -0.2, 0)), mid], fov: 50, caption: E[0], at: () => lift(0) },
      { dur: 5, pos: [view(2.6, 0.35), view(2.1, 0.25)], look: mid, fov: 42, caption: E[1], tick: (dt, k) => lift(Math.max(0, (k - 0.25) / 0.6)), end: () => lift(1) },
      { dur: 5.5, pos: [view(1.4, 0.3), view(1.05, 0.28)], look: [mid, face], fov: 38, caption: E[2] },
      { dur: 6, pos: [view(1.05, 0.28), view(1.25, 0.1)], look: [face, face.clone().add(V(0, -0.5, 0))], fov: 38, caption: E[3], at: finish, tick: (dt, k) => { if (k > 0.25) drop(dt); }, end: settle },
      { dur: 7, pos: [view(1.6, 0.35), view(2.4, 0.4)], look: [face, mid], fov: [36, 42], caption: E[4], at: () => { finish(); settle(); } },
      candle && { dur: 5.5, pos: [candle.position.clone().add(V(-0.6, 0.75, -0.9)), candle.position.clone().add(V(-0.45, 0.7, -0.65))], look: candle.position.clone().add(V(0, 0.55, 0)), fov: 40, caption: E[5], tick: (dt, k) => { if (k > 0.6) snuff(); }, end: snuff },
      { dur: 4, pos: [V(1.9, 1.6, -2.2), V(1.4, 1.5, -1.4)], look: [mid, mid], fov: 50, at: () => { lift(1); finish(); settle(); snuff(); } },
    ];
    this.playCutscene(shots, { after: 'bedroom', onEnd: done });
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
    this.ui.refreshContinue();
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
    if (key === 'boss' && !this.sandbox) setTimeout(() => { if (this.state === 'playing' && this.level === lvl) this.playBossIntro(); }, 900);
    if (lvl.knots && !this.sandbox) setTimeout(() => {
      if (this.state !== 'playing' || this.level !== lvl) return;
      if (index === 0 && (this.forcePrologue || !this.meta.data.seenPrologue)) { this.forcePrologue = false; this.playPrologue(); } else this.playIntro();
    }, 700);
    $('#layer-name').textContent = LAYERS[index].name;
    this.saveCheckpoint(index, carry);
    const roman = ['I', 'II', 'III', 'IV'][index];
    this.ui.card(`LAYER ${roman}`, LAYERS[index].name, LAYERS[index].subtitle);
    this.audio.setLayer(Math.min(2, index));
    this.enterPlay();
  }

  // a night can be left and continued: each layer you reach is remembered, with
  // what you carried into it (the layer itself starts over)
  saveCheckpoint(index, carry) {
    if (this.sandbox || !carry) return;
    this.meta.data.checkpoint = {
      depth: index, whims: [...this.run.whims], lucid: Math.round(this.lucidity.value), stats: { ...this.stats, propUse: { ...this.stats.propUse } },
      carry: { charges: [...(carry.charges || [])], roundProps: [...(carry.roundProps || [])], hp: Math.round(carry.hp || TUNE.playerHP), selected: carry.selected || 0, reverie: carry.reverie || 0, armor: carry.armor || 0 },
      at: Date.now(),
    };
    this.meta.save();
    this.ui.refreshContinue?.();
  }
  continueRun() {
    const cp = this.meta.data.checkpoint;
    if (!cp) { this.startRun(); return; }
    this.audio.start();
    this.sandbox = false; this.meta.sandboxAll = false;
    this.lucidity.reset(); this.lucidity.cap = 100;
    this.newRun();
    for (const id of cp.whims || []) { const w = WHIMS.find((x) => x.id === id); if (w) { w.apply(this.run.mods); this.run.whims.push(id); } }
    this.stats = { ...this.freshStats(), ...(cp.stats || {}) };
    this.scrapsAtStart = this.meta.scraps.size;
    this.recentCombos = [];
    this.depth = cp.depth;
    this.narrator.reset();
    const c = cp.carry;
    this.loadLayer(cp.depth, { charges: new Map(c.charges), roundProps: new Map(c.roundProps), hp: c.hp, selected: c.selected, reverie: c.reverie, armor: c.armor });
    this.lucidity.value = Math.min(70, cp.lucid || 0);
    this.ui.toast('The dream picks up where it left you.', 'good');
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
    delete this.meta.data.checkpoint; // a night that ends is over
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
    // the ending starts with the sheet still on and the face still missing; the cutscene finishes both
    this.bedroom = buildBedroom(this, this.meta.memories, { victory: false, found: this.meta.scraps });
    this.bedroomVictory = !!stats.victory;
    this.scene.add(this.bedroom.group);
    this.state = 'bedroom';
    this.bedT = 0;
    this.ui.setHud(false);
    this.ui.fade(0, 2.5);
    const causeText = stats.cause === 'victory' ? 'The dreamer slept soundly' : stats.cause === 'lucid' ? 'The dream grew too lucid' : 'The dreamer woke';
    const waking = () => this.ui.showWaking({ lines, memory, stats, cause: causeText });
    if (stats.victory && this.bedroom.easel) this.playEnding(lines, () => waking());
    else waking();
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
    click('#btn-continue', () => this.continueRun());
    click('#btn-prologue', () => { this.forcePrologue = true; this.startRun(); });
    click('#btn-sandbox', () => this.startSandbox());
    click('#btn-journal', () => { this.ui.renderJournal(); this.ui.show('journal'); });
    click('#btn-keepsakes', () => { this.ui.renderKeepsakes(); this.ui.show('keepsakes'); });
    click('#btn-wake-journal', () => { this.returnTo = 'waking'; this.ui.renderJournal(); this.ui.show('journal'); });
    click('#btn-wake-keepsakes', () => { this.returnTo = 'waking'; this.ui.renderKeepsakes(); this.ui.show('keepsakes'); });
    click('#btn-clarity', () => { this.ui.renderClarity(); this.ui.show('clarity'); });
    click('#btn-wake-clarity', () => { this.returnTo = 'waking'; this.ui.renderClarity(); this.ui.show('clarity'); });
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
      ['Hush', () => this.spawnEnemy(this.spawnPoint(), { variant: 'hush' })], ['Mirror', () => this.spawnEnemy(this.spawnPoint(), { variant: 'mirror' })], ['Wardrobe', () => this.spawnEnemy(this.spawnPoint(), { variant: 'wardrobe' })],
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
      else if (e.lunge && e.lunge.phase === 'wind' && e.obj.position.distanceTo(pl.pos) < 8) n.event('lungeSeen');
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
    input.pollPad(rdt, !!this.ui.visibleScreen() || this.state === 'title' || this.state === 'bedroom');
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
        this.ui.showMap(input.is('map') && !this.player.dead);
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
      this.flushTips();
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
    } else if (this.state === 'cutscene') {
      this.cut.update(rdt, input);
      this.level?.update(rdt);
      DREAM.uniforms.uLucid.value = this.lucidity.display / 100;
      if (this.cut.done) this.endCutscene();
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
