// Between-run meta: memories (unlocks), the dreamer's waking vignettes,
// settings persistence.
import { PROPS } from './config.js';

const KEY = 'juxtapose.v1';
const BASE = ['melting', 'floating', 'reflecting', 'burning', 'heavy', 'framed'];

// Keepsakes: memories equipped like charms, in a limited number of notches
export const KEEPSAKES = [
  { id: 'nightlight', memory: 'nightlight', name: 'The Night-Light', cost: 1, desc: 'Perfect-deflect window is 60% longer.' },
  { id: 'ticket', memory: 'station', name: 'The Platform Ticket', cost: 2, desc: 'Every dash leaves a decoy of you behind.' },
  { id: 'seed', memory: 'pomegranate', name: 'The Split Seed', cost: 2, desc: 'Deathblows burst like pomegranates.' },
  { id: 'opendoor', memory: 'birdcage', name: 'The Open Door', cost: 1, desc: 'Pogo bounces fly higher and give back your air dash.' },
  { id: 'sketch', memory: 'easel', name: 'The Unfinished Sketch', cost: 2, desc: 'Longer blade reach. Each third slash paints your selected property on its target.' },
  { id: 'loupe', memory: 'clockmaker', name: 'The Loupe', cost: 2, desc: 'A perfect deflect slows time for a heartbeat.' },
  { id: 'letter', memory: 'letter', name: 'The Unsent Letter', cost: 3, desc: 'Once per layer, survive a killing blow.' },
];

// Whims: run upgrades offered three at a time between layers
export const WHIMS = [
  { id: 'edge', name: 'A Sharper Knife', desc: 'Melee damage +30%.', apply: (m) => { m.melee *= 1.3; } },
  { id: 'weight', name: 'Heavy Hand', desc: 'Posture damage +35%.', apply: (m) => { m.posture *= 1.35; } },
  { id: 'pockets', name: 'Deep Pockets', desc: 'Carry 3 more charges of each property.', apply: (m) => { m.maxCharges += 3; } },
  { id: 'calm', name: 'Lucid Discipline', desc: 'Lucidity rises 25% slower.', apply: (m) => { m.lucidGain *= 0.75; } },
  { id: 'vessel', name: 'A Second Vessel', desc: 'Reverie holds one more focus.', apply: (m) => { m.reverieMax += 33; } },
  { id: 'quick', name: 'Quick Hands', desc: 'Fire and slash 20% faster.', apply: (m) => { m.fireRate *= 1.2; m.meleeSpeed *= 1.2; } },
  { id: 'greed', name: 'Light Fingers', desc: 'Taking gives one extra charge.', apply: (m) => { m.takeBonus += 1; } },
  { id: 'feather', name: 'Featherfall', desc: 'One more jump in the air.', apply: (m) => { m.extraJump += 1; } },
  { id: 'glory', name: 'Glory', desc: 'Deathblows heal 15 more.', apply: (m) => { m.gloryHeal += 15; } },
  { id: 'momentum', name: 'Momentum', desc: 'Dash recovers 40% faster.', apply: (m) => { m.dashCD *= 0.6; } },
  { id: 'brittle', name: 'Brittle Dream', desc: 'Explosions are 30% larger.', apply: (m) => { m.explosion *= 1.3; } },
  { id: 'reach', name: 'Long Arm', desc: 'Melee reach +25%.', apply: (m) => { m.meleeRange *= 1.25; } },
  { id: 'patience', name: 'Patience', desc: 'Focus heals 40% faster.', apply: (m) => { m.focusTime *= 0.6; } },
  { id: 'timing', name: 'Good Timing', desc: 'Deflect window +40%.', apply: (m) => { m.deflectWindow *= 1.4; } },
];

export function defaultMods() {
  return { melee: 1, meleeRange: 1, meleeSpeed: 1, posture: 1, maxCharges: 0, lucidGain: 1, reverieMax: 99, fireRate: 1,
    takeBonus: 0, extraJump: 0, dashCD: 1, explosion: 1, gloryHeal: 0, heal: 1, focusTime: 1, deflectWindow: 1 };
}

export const SCRAPS = [
  { id: 1, layer: 0, text: 'Théo, 9: “Odile is a man with a hat and an apple instead of a face. She says it’s art. I say it’s cheating.”', src: 'a child’s note, pinned to a fridge' },
  { id: 2, layer: 0, text: 'Repaired: Mme. Berthier’s carriage clock. Loses four minutes a day. Customer says she doesn’t mind. She likes the extra time.', src: 'the shop ledger, 1961' },
  { id: 3, layer: 0, text: 'The candle burned all night again. The neighbours asked if someone was ill. I said someone was late.', src: 'Odile’s diary' },
  { id: 4, layer: 1, text: 'Dear O. The city is enormous and everyone has the same hat. I painted a thousand of them falling like rain. Nobody bought it. Send the good brushes? T.', src: 'a letter, 1959' },
  { id: 5, layer: 1, text: 'Platform 3, 6:40. I went every morning for a month. I don’t know what I would have said.', src: 'Odile’s diary' },
  { id: 6, layer: 1, text: 'He painted the arches from memory. Long shadows, a train, no people. He said empty squares were the only honest places.', src: 'margin note, a gallery catalogue' },
  { id: 7, layer: 2, text: 'The sheet has not been lifted since 1958. I dust around it.', src: 'Odile’s diary' },
  { id: 8, layer: 2, text: 'Second drawer. Unopened. The stamp is from the south. The handwriting isn’t his.', src: 'a note to herself' },
  { id: 9, layer: 2, text: 'Finish it for me? T.', src: 'the corner of the pomegranate note' },
];

export const MEMORIES = [
  { id: 'nightlight', unlock: 'sleeping', title: 'The night-light in the hallway',
    text: 'A candle in a jar, left burning so no one would be afraid. Someone always forgot to blow it out.' },
  { id: 'station', unlock: 'multiplying', title: 'The crowd at the station',
    text: 'Every man on the platform wore the same hat. For a moment it was impossible to tell which one was leaving.' },
  { id: 'pomegranate', unlock: 'bursting', title: 'The pomegranate on the kitchen table',
    text: 'It split open overnight on its own. Nobody would admit to having dropped it.' },
  { id: 'birdcage', unlock: 'hollow', title: 'The empty birdcage',
    text: 'The door was open when they came home. The cage was kept for years, as if it might remember what it was for.' },
  { id: 'easel', unlock: null, title: 'The unfinished painting',
    text: 'A figure with a bowler hat and a green apple where the face should be. It was never finished. You recognise the hat.' },
  { id: 'clockmaker', unlock: null, title: 'The clockmaker\'s apprentice',
    text: 'Small hands, a loupe, a hundred clocks that all ran slow. The dreamer was very young, and very patient.' },
  { id: 'letter', unlock: null, title: 'The letter in the drawer',
    text: '"When you wake up, I will already be gone." It was never sent. It is still in the second drawer.' },
];

const STARTS = [
  'The dreamer wakes at {time}, one hand still reaching for something.',
  'The dreamer wakes at {time}. The pillow is cold on one side.',
  'At {time} the dreamer sits up too fast and forgets, at once, where they were.',
  'The alarm has been ringing since {time}. The dreamer lets it.',
];
const BY_PROP = {
  melting: 'They hold their coffee cup a little too long, watching the steam soften the air.',
  floating: 'On the stairs, their feet hesitate on every step, as if the floor might let go.',
  reflecting: 'They avoid the mirror in the hall this morning. It seems to be waiting for something.',
  burning: 'They check the stove twice before leaving, then a third time.',
  heavy: 'Their coat feels impossibly heavy. They take it off, then put it back on.',
  sleeping: 'They doze on the bus and miss their stop by exactly one street.',
  multiplying: 'At the station everyone seems to be wearing the same hat. Nobody finds this strange.',
  hollow: 'They open the birdcage by the window, although it has been empty for years.',
  bursting: 'They cut a pomegranate for breakfast and the juice goes everywhere.',
};
const BY_DEPTH = [
  'The dream is already fading, like a word on the tip of the tongue.',
  'Something about a square full of long shadows stays with them all day.',
  'All morning they have the feeling of being watched from behind, by something very large and very patient.',
  'For the first time in months, they slept all the way through.',
];
const BY_LUCID = 'They are sure, for a moment, that they were dreaming on purpose.';
const ENDING = [
  'Odile gets up in the dark and goes to the back bedroom, and lifts the sheet.',
  'A figure in a bowler hat, an apple where the face should be, standing in a desert. Unfinished.',
  'She opens the second drawer and reads the letter. It says what she already knew.',
  'Then she takes out the good brushes, the ones he asked for and never got, and finishes the face.',
  'It was never a man. It was her, at nine, in their father’s hat, making her little brother laugh. She paints the face she had then. It takes until morning.',
  'For the first time in sixty years, she lets the candle go out.',
];

export class Meta {
  constructor() {
    this.data = { memories: [], runs: 0, bestDepth: 0, settings: {}, seen: {}, scraps: [], equipped: [], bossKills: 0 };
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) Object.assign(this.data, JSON.parse(raw));
    } catch (e) { /* storage unavailable: play without persistence */ }
    this.sandboxAll = false;
  }
  save() { try { localStorage.setItem(KEY, JSON.stringify(this.data)); } catch (e) { /* ignore */ } }

  // ---- keepsakes
  get notches() { return 3 + (this.data.bossKills > 0 ? 1 : 0) + (this.sandboxAll ? 3 : 0); }
  keepsakeUnlocked(k) { return this.sandboxAll || this.data.memories.includes(k.memory); }
  equipped() { return (this.data.equipped || []).filter((id) => { const k = KEEPSAKES.find((x) => x.id === id); return k && this.keepsakeUnlocked(k); }); }
  usedNotches() { return this.equipped().reduce((s, id) => s + KEEPSAKES.find((k) => k.id === id).cost, 0); }
  toggleKeepsake(id) {
    const k = KEEPSAKES.find((x) => x.id === id);
    if (!k || !this.keepsakeUnlocked(k)) return false;
    const eq = this.equipped();
    if (eq.includes(id)) this.data.equipped = eq.filter((x) => x !== id);
    else if (this.usedNotches() + k.cost <= this.notches) this.data.equipped = [...eq, id];
    else return false;
    this.save();
    return true;
  }

  // ---- canvas scraps
  get scraps() { return new Set(this.data.scraps || []); }
  addScrap(id) { if (!this.data.scraps.includes(id)) { this.data.scraps.push(id); this.save(); return true; } return false; }

  get memories() { return new Set(this.data.memories); }
  unlockedProps() {
    if (this.sandboxAll) return PROPS.slice();
    const set = new Set(BASE);
    for (const m of MEMORIES) if (m.unlock && this.data.memories.includes(m.id)) set.add(m.unlock);
    return PROPS.filter((p) => set.has(p));
  }
  settings() { return this.data.settings; }
  setSetting(k, v) { this.data.settings[k] = v; this.save(); }

  // one memory per run that went deep enough or got strange enough
  endRun(stats) {
    this.data.runs++;
    this.data.bestDepth = Math.max(this.data.bestDepth, stats.depth);
    let earned = null;
    const qualifies = stats.depth >= 1 || stats.strangeness >= 60 || this.data.runs === 1;
    if (qualifies) {
      earned = MEMORIES.find((m) => !this.data.memories.includes(m.id)) || null;
      if (earned) this.data.memories.push(earned.id);
    }
    this.save();
    return earned;
  }

  // the dreamer's name surfaces once enough of her life has
  get knowsName() { return this.data.memories.length >= 3 || (this.data.scraps || []).length >= 3; }

  vignette(stats) {
    if (stats.victory) return ENDING.slice();
    const h = 5 + Math.floor(Math.random() * 3), m = Math.floor(Math.random() * 60);
    const time = `${h}:${String(m).padStart(2, '0')}`;
    const who = this.knowsName ? 'Odile' : 'The dreamer';
    const lines = [STARTS[this.data.runs % STARTS.length].replace('{time}', time).replace('The dreamer', who)];
    if (stats.topProp && BY_PROP[stats.topProp]) lines.push(BY_PROP[stats.topProp]);
    lines.push(BY_DEPTH[Math.min(BY_DEPTH.length - 1, stats.victory ? 3 : stats.depth)]);
    if (stats.cause === 'lucid') lines.push(BY_LUCID);
    return lines;
  }
}
