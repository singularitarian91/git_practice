// Between-run meta: memories (unlocks), the dreamer's waking vignettes,
// settings persistence.
import { PROPS } from './config.js';

const KEY = 'juxtapose.v1';
const BASE = ['melting', 'floating', 'reflecting', 'burning', 'heavy'];

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

export class Meta {
  constructor() {
    this.data = { memories: [], runs: 0, bestDepth: 0, settings: {}, seen: {} };
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) Object.assign(this.data, JSON.parse(raw));
    } catch (e) { /* storage unavailable: play without persistence */ }
    this.sandboxAll = false;
  }
  save() { try { localStorage.setItem(KEY, JSON.stringify(this.data)); } catch (e) { /* ignore */ } }

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

  vignette(stats) {
    const h = 5 + Math.floor(Math.random() * 3), m = Math.floor(Math.random() * 60);
    const time = `${h}:${String(m).padStart(2, '0')}`;
    const lines = [STARTS[this.data.runs % STARTS.length].replace('{time}', time)];
    if (stats.topProp && BY_PROP[stats.topProp]) lines.push(BY_PROP[stats.topProp]);
    lines.push(BY_DEPTH[Math.min(BY_DEPTH.length - 1, stats.victory ? 3 : stats.depth)]);
    if (stats.cause === 'lucid') lines.push(BY_LUCID);
    return lines;
  }
}
