// The whole mutable game state lives in one plain object so saving is a
// JSON.stringify away.
import { DEBT_START, VILLAGERS } from '../data/world_data.js';
import { LOC } from './worldmap.js';

export const SAVE_KEY = 'gloamhollow.save.v1';
export const SETTINGS_KEY = 'gloamhollow.settings.v1';
export const INV_SIZE = 30;
export const HOTBAR = 10;
export const DAY_START = 6 * 60;     // 06:00
export const DAY_END = 26 * 60;      // 02:00 next morning
export const SEASONS = ['spring', 'summer', 'autumn', 'winter'];
export const SEASON_DAYS = 10;

export function newGameState(name = 'Wanderer') {
  const inv = new Array(INV_SIZE).fill(null);
  const start = [
    ['tool_hoe', 1], ['tool_can', 1], ['tool_axe', 1], ['tool_pickaxe', 1], ['tool_sword', 1],
    ['seeds_turnip', 15], ['torch_standing', 3], ['tool_hammer', 1],
  ];
  start.forEach(([id, n], i) => { inv[i] = { id, n }; });
  const npcs = {};
  for (const id of Object.keys(VILLAGERS)) {
    npcs[id] = { fp: 0, met: false, talkedDay: 0, giftDay: 0, request: null, requestDay: 0 };
  }
  return {
    version: 1,
    name,
    created: Date.now(),
    day: 1,                 // day of season, 1..SEASON_DAYS
    seasonIndex: 0,
    year: 1,
    totalDays: 1,
    time: DAY_START,        // minutes since midnight of the current day
    weather: 'overcast',
    tomorrowWeather: 'clear',
    coins: 250,
    debt: DEBT_START,
    player: { x: LOC.spawn.x, z: LOC.spawn.z, hp: 100, stamina: 100, facing: Math.PI / 2 },
    inv,
    hotbar: 0,
    tools: { tool_hoe: 0, tool_can: 0, tool_axe: 0, tool_pickaxe: 0, tool_sword: 0, tool_rod: 0 },
    canWater: 20,
    flags: {},
    farm: {},               // "x,z" -> tile
    placed: [],             // player-built objects
    chests: {},             // placed id -> slot array
    res: { trees: {}, rocks: {}, bushes: {}, ferns: {}, forage: [], digs: [] },
    npcs,
    museum: {},
    offerings: {},          // offering id -> { itemId: count }
    offeringsDone: [],
    crate: [],              // items waiting to be sold overnight
    stats: { fish: 0, bugs: 0, relics: 0, kills: 0, earned: 0, crops: 0, shipped: {} },
    seen: {},               // item ids ever obtained (collection log)
    buffs: [],
    house: 'hut',
    houseUpgradeDay: 0,
    ending: false,
    bossDefeated: false,
    log: [],                // recent notable events (for the journal)
  };
}

export function seasonOf(state) { return SEASONS[state.seasonIndex % 4]; }

export function saveGame(state) {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(state));
    return true;
  } catch (e) {
    console.warn('save failed', e);
    return false;
  }
}

export function loadGame() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw);
    if (!s || s.version !== 1) return null;
    // forwards-compatible defaults
    const fresh = newGameState(s.name);
    for (const k of Object.keys(fresh)) if (!(k in s)) s[k] = fresh[k];
    for (const id of Object.keys(fresh.npcs)) if (!s.npcs[id]) s.npcs[id] = fresh.npcs[id];
    return s;
  } catch (e) {
    console.warn('load failed', e);
    return null;
  }
}

export function hasSave() {
  try { return !!localStorage.getItem(SAVE_KEY); } catch { return false; }
}

export function deleteSave() {
  try { localStorage.removeItem(SAVE_KEY); } catch { /* ignore */ }
}

export const DEFAULT_SETTINGS = {
  master: 0.8, music: 0.5, sfx: 0.8, ambience: 0.6, voice: 0.7,
  quality: 'medium', dayLength: 'normal', showTips: true,
};

export function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    return { ...DEFAULT_SETTINGS, ...(raw ? JSON.parse(raw) : {}) };
  } catch { return { ...DEFAULT_SETTINGS }; }
}

export function saveSettings(s) {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch { /* ignore */ }
}

// Real seconds per in-game minute
export const DAY_LENGTHS = { short: 0.4, normal: 0.55, long: 0.8 };
