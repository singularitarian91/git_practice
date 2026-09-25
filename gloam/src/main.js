// Gloam — entry point: load everything, show the title, run the loop.
import * as THREE from 'three';
import { Engine } from './engine/engine.js';
import { ModelLibrary } from './engine/assets.js';
import { Input } from './engine/input.js';
import { IconFactory } from './ui/icons.js';
import { UI } from './ui/ui.js';
import { TouchControls, isTouchDevice } from './ui/touch.js';
import { getMapBase } from './ui/mapbase.js';
import { Game } from './game/game.js';
import { newGameState, loadGame, saveGame, hasSave, deleteSave, loadSettings, seasonOf } from './game/state.js';
import { LOC } from './game/worldmap.js';

const params = new URLSearchParams(location.search);
const loadingEl = document.getElementById('loading');
const fillEl = loadingEl.querySelector('.loading-fill');
const textEl = loadingEl.querySelector('.loading-text');
const setLoading = (frac, text) => {
  fillEl.style.width = `${Math.round(frac * 100)}%`;
  if (text) textEl.textContent = text;
};
const nextFrame = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));

// A silent stand-in used if the audio module fails to load.
const SILENT = new Proxy({}, { get: (t, k) => (k === 'ready' ? false : () => ({ stop() {}, done: Promise.resolve() })) });

async function loadOptional(path) {
  try { return await import(path); } catch (e) { console.warn('[boot] optional module missing:', path, e && e.message); return null; }
}

async function boot() {
  if (!window.WebGL2RenderingContext) throw new Error('This game needs a browser with WebGL 2.');
  const settings = loadSettings();
  const touch = isTouchDevice();
  // phones and tablets start on the light preset unless the player chose otherwise
  if (touch && !settings.qualityChosen) settings.quality = 'low';
  if (params.get('quality')) settings.quality = params.get('quality');
  setLoading(0.03, 'Raising the isle from the sea…');
  await nextFrame();
  const container = document.getElementById('game');
  const engine = new Engine(container, settings.quality);

  setLoading(0.2, 'Carving models…');
  const lib = new ModelLibrary();
  await lib.load('assets/models/', (f, name) => setLoading(0.2 + f * 0.35, `Carving models… (${name})`));

  setLoading(0.56, 'Gathering tales…');
  const [dlg, lore, audioMod] = await Promise.all([
    loadOptional('./data/dialogue.js'), loadOptional('./data/lore.js'), loadOptional('./engine/audio.js'),
  ]);
  const content = { DIALOGUE: dlg ? dlg.DIALOGUE : {}, LORE: lore || {} };
  const audio = (audioMod && audioMod.audio) || SILENT;
  const unlockAudio = () => { try { audio.init(); audio.setVolumes(settings); } catch { /* ignore */ } };
  window.addEventListener('pointerdown', unlockAudio, { once: false });
  window.addEventListener('keydown', unlockAudio, { once: false });

  setLoading(0.6, 'Painting icons…');
  const icons = new IconFactory(lib);
  await icons.renderAll((f) => setLoading(0.6 + f * 0.2, 'Painting icons…'));

  const input = new Input(engine.renderer.domElement);
  const ui = new UI(document.getElementById('ui'), { audio, icons, content });
  ui.input = input;
  if (touch || params.has('touch')) { new TouchControls(document.getElementById('ui'), input, engine.renderer.domElement); document.body.classList.add('is-touch'); }

  // pick the state: a live-reload snapshot, a pending "new game" from the
  // title, a save, or fresh
  let pendingNew = null;
  try { pendingNew = sessionStorage.getItem('gh_new'); sessionStorage.removeItem('gh_new'); } catch { /* storage blocked */ }
  const hot = window.claude && window.claude.hot && window.claude.hot.data && window.claude.hot.data.state;
  const saved = hot || (pendingNew ? null : loadGame());
  const state = saved || newGameState(pendingNew || 'Wanderer');

  setLoading(0.82, 'Planting the forests…');
  await nextFrame();
  const game = new Game({ engine, lib, audio, ui, input, settings, state, content });
  ui.attach(game);
  setLoading(0.94, 'Charting the isle…');
  await nextFrame();
  getMapBase(game);
  window.__gh = { engine, game, THREE, ready: false };
  // keep the session across a republish of this page (Claude artifact hot reload)
  try {
    if (window.claude && window.claude.hot && window.claude.hot.snapshot) {
      window.claude.hot.snapshot(() => { game.player.save(); return { state: game.state }; });
    }
  } catch { /* not in an artifact */ }
  // test hook: advance the simulation without rendering (headless playtests)
  window.__gh.sim = (seconds, step = 1 / 30) => {
    for (let t = 0; t < seconds; t += step) { game.update(step); input.endFrame(); }
  };

  // title-screen camera orbit (the world plays behind the menu)
  let mode = 'title';
  const titleCam = { a: 0.6 };
  const titleUpdate = (dt) => {
    titleCam.a += dt * 0.035;
    const c = new THREE.Vector3(LOC.hearth.x, 6, LOC.hearth.z);
    const cam = engine.camera;
    cam.position.set(c.x + Math.sin(titleCam.a) * 34, 17, c.z + Math.cos(titleCam.a) * 34);
    cam.lookAt(c.x, 7.5, c.z);
    engine.env.hour = 19.1;
    engine.env.weather = 'clear';
    engine.env.season = seasonOf(game.state);
    engine.env.hearth = game.state.offeringsDone.length;
    engine.env.dawn = game.state.ending;
    engine.focus.set(c.x, c.y, c.z);
    game.npcs.update(dt);
    game.grass.update(c, game.player.pos);
    game.inst.refresh(c);
    game.effects.update(dt, cam, c, 0.6, engine.terrain);
  };

  const start = async (isNew) => {
    mode = 'play';
    ui.hideHud(false);
    unlockAudio();
    if (isNew) {
      await ui.fade(1, 0.01);
      const intro = content.LORE.INTRO;
      if (intro && intro.length && !params.has('skipintro')) await ui.narrate(intro, 'The Isle of Gloamhollow');
      saveGame(game.state);
      await ui.fade(0, 1.6);
      ui.toast('Talk to Corvin the raven, just outside your hut. (E to talk)', 'quest');
      ui.toast('Press T at any time for help. Esc pauses.', 'info');
    } else {
      ui.morning({ reason: 'load' });
    }
  };

  setLoading(1, 'Kindling the fires…');
  await nextFrame();
  loadingEl.classList.add('hidden');
  ui.hideHud(true);

  if (pendingNew) {
    start(true);
  } else if (hot) {
    start(false);
  } else if (params.has('play')) {
    // debug / screenshot mode: jump straight in
    if (params.has('hour')) game.state.time = Number(params.get('hour')) * 60;
    if (params.has('weather')) game.state.weather = params.get('weather');
    if (params.has('season')) { game.state.seasonIndex = ['spring', 'summer', 'autumn', 'winter'].indexOf(params.get('season')); game.applySeason(); }
    if (params.has('at')) { const [x, z] = params.get('at').split(',').map(Number); game.player.pos.set(x, game.world.groundY(x, z), z); game.camera.snap(game.player.pos); }
    mode = 'play';
    ui.hideHud(false);
  } else {
    const info = saved ? `${saved.name} · ${['Thaw', 'Brightwane', 'Rotfall', 'Deepfrost'][saved.seasonIndex % 4]} day ${saved.day}` : '';
    ui.title({
      hasSave: !!saved,
      saveInfo: info,
      onContinue: () => start(false),
      onNew: (name) => {
        if (saved || hasSave()) {
          deleteSave();
          try { sessionStorage.setItem('gh_new', name); location.reload(); return; } catch { /* fall through */ }
        }
        game.state.name = name;
        start(true);
      },
    });
  }

  let last = performance.now();
  let frames = 0;
  const loop = (now) => {
    const dt = Math.max(0.0005, Math.min(0.05, (now - last) / 1000));
    last = now;
    try {
      if (mode === 'title') titleUpdate(dt);
      else game.update(dt);
      engine.frame(dt);
    } catch (e) {
      console.error(e);
    }
    input.endFrame();
    frames++;
    if (frames === 4) window.__gh.ready = true;
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
  document.addEventListener('visibilitychange', () => { if (document.hidden) audio.suspend && audio.suspend(); else audio.resume && audio.resume(); });
}

boot().catch((e) => {
  console.error(e);
  textEl.textContent = 'Failed to start: ' + (e && e.message ? e.message : e);
  textEl.style.color = '#e07a60';
});
