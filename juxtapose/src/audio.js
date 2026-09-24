/**
 * Juxtapose — DreamAudio
 * =============================================================================
 * A fully synthesized (Web Audio API only, no files, no libraries) generative
 * score + SFX engine for a surrealist shooter set inside a stranger's dream.
 *
 * "Sound as structure"
 *   • A 16-step lookahead scheduler ("A Tale of Two Clocks") drives five stems —
 *     warm detuned pad, sub bass, music-box arpeggio, brushed percussion and a
 *     glass shimmer — whose presence follows combat intensity (bar-quantized).
 *   • Each dream layer has its own key, mode, progression and instrumentation,
 *     and layers crossfade over ~2 s.
 *   • Lucidity warps the score: tape warble, tempo drag, tape-stop dips,
 *     reversed swells (pre-rendered offline, then reversed), a filter sweep,
 *     comb/flanger smear, a darker/wetter reverb, and — near waking — a
 *     heartbeat and a rising alarm-clock tick.
 *   • Weapons quantize to the 16th grid and take their pitch from the current
 *     chord's scale; every property owns a scale degree and a timbre, and a
 *     ring buffer of recent notes pulls shots toward a stepwise melody.
 *
 * Signal graph
 *   layer buses (per-stem gains) → musicIn → dip → lucFilter ─┬─ dry ─────────┐
 *                                                            └─ comb/flanger ┴→ world
 *   world + stingers + heartbeat/ticks → musicSum → musicVol → pauseGain → pauseLP ─┬→ comp
 *                                                                                   └→ musicRev → reverb
 *   (musicSum … pauseLP → mix)
 *   sfx voices → (StereoPanner) → sfxVol → mix;  voice sends → sfxRev → reverb
 *   reverb: revIn → highpass → convolver → revTone → revOut → mix
 *   mix (trim) → comp → limiter → master → destination
 */

// ─── Small utilities ─────────────────────────────────────────────────────────

const clamp = (v, lo = 0, hi = 1) => (v < lo ? lo : v > hi ? hi : v);
const lerp = (a, b, t) => a + (b - a) * t;
const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
const rand = (a = 0, b = 1) => a + Math.random() * (b - a);
const pick = (arr) => arr[(Math.random() * arr.length) | 0];
const chance = (p) => Math.random() < p;
const mod = (n, m) => ((n % m) + m) % m;
const num = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const smoothstep = (e0, e1, x) => {
  const t = clamp((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};
const weightedIndex = (ws) => {
  let sum = 0;
  for (const w of ws) sum += w;
  if (sum <= 0) return -1;
  let r = Math.random() * sum;
  for (let i = 0; i < ws.length; i++) if ((r -= ws[i]) <= 0) return i;
  return ws.length - 1;
};
const EPS = 0.0001;

// ─── Engine constants ────────────────────────────────────────────────────────

const BASE_BPM = 96;
const STEPS = 16; // 16th-note grid per bar
const BARS_PER_CHORD = 2;
const LOOKAHEAD = 0.12; // seconds scheduled ahead of the audio clock
const TICK_MS = 25; // setInterval fallback period
const MAX_VOICES = 48; // concurrent SFX voices before stealing
const XFADE = 2.0; // layer crossfade (s)
const LOOSE_WINDOW = 0.07; // 'loose' quantize: play now if the next slot is further away
const TAPE_STOP = [1.12, 1.3, 1.55, 1.9]; // step-length multipliers across a tape-stop beat
const STEMS = ['pad', 'bass', 'arp', 'perc', 'shimmer'];
const REV_PAD_MIDI = 60; // reference pitch of the pre-rendered reversed pad
const REV_BELL_MIDI = 72; // reference pitch of the pre-rendered reversed bell

// ─── Musical data ────────────────────────────────────────────────────────────

const MODES = {
  dorian: [0, 2, 3, 5, 7, 9, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
};

/**
 * Dream layers. `prog` lists chord roots as scale degrees (chords are stacked
 * diatonic thirds). Percussion patterns: one char per 16th, '.' = rest,
 * '1'..'9' = velocity/9. Bass entries: [step, lengthSteps, chordToneIndex, velocity].
 */
const LAYERS = [
  {
    name: 'Soft Desert',
    root: 50, // D3, Dorian
    mode: MODES.dorian,
    tempo: 1.0,
    prog: [0, 3, 2, 6], // Dm7 – G7 – Fmaj7 – Cmaj7   (i – IV – III – VII)
    pad: { types: ['sawtooth', 'triangle'], cutoff: 1100, q: 0.5, detune: 8, gain: 0.05, attack: 1.8, oct: 0 },
    arp: { every: 2, pattern: [0, 2, 4, 5, 6, 5, 4, 2], density: 0.75, oct: 0, pizz: false, gain: 0.055 },
    bass: [[0, 10, 0, 1], [10, 6, 2, 0.7]],
    perc: {
      lo: 0.58, hatAt: 0.74, woodAt: 2, snareKind: 'brush', metal: false,
      kick: '7.........5.....', snare: '....6.......6...', hat: '..3...3...3...32', wood: '................',
    },
    shimmer: { p: 0.45, oct: 1 },
    drone: false,
  },
  {
    name: 'Golconda Piazza',
    root: 53, // F3, Lydian
    mode: MODES.lydian,
    tempo: 1.05,
    prog: [0, 1, 5, 1], // Fmaj7 – G7 – Dm7 – G7   (I – II – vi – II)
    pad: { types: ['triangle', 'sawtooth'], cutoff: 2300, q: 0.7, detune: 6, gain: 0.042, attack: 1.2, oct: 0 },
    arp: { every: 1, pattern: [0, 2, 4, 6, 5, 3, 4, 2, 7, 6, 4, 2, 5, 4, 2, 1], density: 0.55, oct: 0, pizz: true, gain: 0.05 },
    bass: [[0, 3, 0, 1], [3, 3, 0, 0.6], [6, 2, 2, 0.8], [8, 3, 0, 0.9], [11, 3, 1, 0.6], [14, 2, 2, 0.7]],
    perc: {
      lo: 0.48, hatAt: 0.6, woodAt: 0.55, snareKind: 'brush', metal: false,
      kick: '8.....5.7.....4.', snare: '....7.......7..3', hat: '4.3.4.3.4.3.4.35', wood: '..5....4..5..4..',
    },
    shimmer: { p: 0.6, oct: 1 },
    drone: false,
  },
  {
    name: 'The Unwatched',
    root: 45, // A2, Phrygian
    mode: MODES.phrygian,
    tempo: 0.97,
    prog: [0, 1, 4, 1], // Am7 – Bbmaj7 – Em7b5 – Bbmaj7   (i – bII – v° – bII)
    pad: { types: ['sawtooth', 'sawtooth'], cutoff: 760, q: 2.2, detune: 14, gain: 0.05, attack: 2.4, oct: 12 },
    arp: { every: 2, pattern: [0, 1, 0, 3, 2, 1, 0, 5], density: 0.85, oct: -12, pizz: false, gain: 0.06 },
    bass: [[0, 2, 0, 1], [2, 2, 0, 0.6], [4, 2, 0, 0.9], [6, 2, 0, 0.6], [8, 2, 0, 1], [10, 2, 0, 0.6], [12, 2, 0, 0.9], [14, 1, 2, 0.7], [15, 1, 1, 0.6]],
    perc: {
      lo: 0.55, hatAt: 0.7, woodAt: 0.8, snareKind: 'tom', metal: true,
      kick: '9...8...9...8.6.', snare: '............5.64', hat: '.3.3.3.3.3.3.3.3', wood: '..........4.....',
    },
    shimmer: { p: 0.35, oct: 1 },
    drone: true,
  },
];

// Pre-parse pattern strings / bass lists into per-step lookup tables.
for (const L of LAYERS) {
  const parse = (s) => Array.from({ length: STEPS }, (_, i) => (s[i] && s[i] !== '.' ? Number(s[i]) / 9 : 0));
  L._perc = { kick: parse(L.perc.kick), snare: parse(L.perc.snare), hat: parse(L.perc.hat), wood: parse(L.perc.wood) };
  L._bass = Array.from({ length: STEPS }, () => null);
  for (const b of L.bass) L._bass[b[0]] = b;
}

/** Each property owns a scale degree (relative to the current chord root) and an octave shift. */
const PROPERTIES = {
  melting: { degree: 4, oct: 0 }, // 5th — downward-bent sine
  floating: { degree: 2, oct: 1 }, // 3rd, high — airy vibrato triangle
  reflecting: { degree: 6, oct: 1 }, // 7th — glassy FM bell
  burning: { degree: 1, oct: 0 }, // 9th — crackly saw
  heavy: { degree: 0, oct: -1 }, // root, low — square
  sleeping: { degree: 5, oct: 0 }, // 6th — muted pluck
  framed: { degree: 3, oct: 1 }, // 4th, high — a hollow glass "window" ping
  multiplying: { degree: 3, oct: 0 }, // 11th — triple-echo blip
  hollow: { degree: 0, oct: 0 }, // root — wood block
  bursting: { degree: 4, oct: 1 }, // 5th, high — noisy rising pop
};

/** Property names double as sfx names (the world reacting to a property being applied). */
const PROPERTY_SFX = {
  melting: 'melt', floating: 'float', reflecting: 'reflect', burning: 'burn', heavy: 'heavy',
  sleeping: 'sleep', multiplying: 'multiply', hollow: 'hollow', bursting: 'burst', framed: 'portal',
};

/** Rate limits: max concurrent voices of that name, min seconds between triggers, steal priority. */
const SFX_LIMITS = {
  debris: { max: 12, gap: 0, prio: 0 },
  footstep: { max: 4, gap: 0.04, prio: 0 },
  grind: { max: 3, gap: 0.045, prio: 0 },
  wallrun: { max: 3, gap: 0.05, prio: 0 },
  uiHover: { max: 2, gap: 0.03, prio: 0 },
  burn: { max: 5, gap: 0.03, prio: 0 },
  enemyHit: { max: 8, gap: 0.012, prio: 1 },
  enemyShoot: { max: 8, gap: 0.02, prio: 1 },
  enemyDie: { max: 6, gap: 0.02, prio: 2 },
  reflect: { max: 6, gap: 0.03, prio: 1 },
  shatter: { max: 5, gap: 0.03, prio: 2 },
  woodBreak: { max: 5, gap: 0.03, prio: 2 },
  heavy: { max: 4, gap: 0.04, prio: 2 },
  fire: { max: 8, gap: 0.015, prio: 2 },
  give: { max: 4, gap: 0.03, prio: 2 },
  take: { max: 3, gap: 0.05, prio: 2 },
  explosion: { max: 6, gap: 0.02, prio: 3 },
  hit: { max: 3, gap: 0.05, prio: 3 },
  bossHit: { max: 4, gap: 0.04, prio: 3 },
  bossRoar: { max: 2, gap: 0.3, prio: 3 },
  groundPound: { max: 3, gap: 0.08, prio: 3 },
  slide: { max: 2, gap: 0.1, prio: 1 },
  reloadSpin: { max: 1, gap: 0.05, prio: 2 },
  land: { max: 3, gap: 0.05, prio: 1 },
  slash: { max: 3, gap: 0.04, prio: 2 },
  slashHit: { max: 4, gap: 0.02, prio: 2 },
  deflect: { max: 3, gap: 0.03, prio: 3 },
  guardHit: { max: 3, gap: 0.04, prio: 2 },
  babble: { max: 2, gap: 0.035, prio: 0 },
  portal: { max: 3, gap: 0.05, prio: 2 },
};
const DEFAULT_LIMIT = { max: 6, gap: 0.01, prio: 1 };
const MELODIC = new Set(['fire', 'give', 'take', 'infuse']); // advance the weapon melody
const UI_SFX = new Set(['uiSelect', 'uiBack', 'uiHover']); // still audible while paused

// ─── DSP helpers ─────────────────────────────────────────────────────────────

/** 0 → peak (linear, `a` s) → silence (exponential, `d` s). Returns the end time. */
function envPerc(p, t, peak, a, d) {
  peak = Math.max(peak, EPS * 2);
  p.setValueAtTime(0, t);
  p.linearRampToValueAtTime(peak, t + a);
  p.exponentialRampToValueAtTime(EPS, t + a + d);
  return t + a + d;
}

/** Freeze a param at time t so new automation starts from its current value. */
function holdParam(p, t) {
  if (p.cancelAndHoldAtTime) {
    p.cancelAndHoldAtTime(t);
  } else {
    const v = p.value;
    p.cancelScheduledValues(t);
    p.setValueAtTime(v, t);
  }
}

function normalize(data, peak = 0.9) {
  let m = 0;
  for (let i = 0; i < data.length; i++) m = Math.max(m, Math.abs(data[i]));
  if (m > 0) for (let i = 0; i < data.length; i++) data[i] *= peak / m;
}

/** Shared noise buffers: white, pink (Kellet) and brown. Created once. */
function makeNoise(ctx, kind, seconds = 2) {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  let b0 = 0, b1 = 0, b2 = 0, last = 0;
  for (let i = 0; i < len; i++) {
    const w = Math.random() * 2 - 1;
    if (kind === 'pink') {
      b0 = 0.99765 * b0 + w * 0.099046;
      b1 = 0.963 * b1 + w * 0.2965164;
      b2 = 0.57 * b2 + w * 1.0526913;
      d[i] = b0 + b1 + b2 + w * 0.1848;
    } else if (kind === 'brown') {
      last = (last + 0.02 * w) / 1.02;
      d[i] = last;
    } else {
      d[i] = w;
    }
  }
  normalize(d, 0.9);
  return buf;
}

/** Stereo noise-decay impulse response with time-varying HF damping and a few early reflections. */
function makeImpulse(ctx, seconds = 3.6, decay = 2.6) {
  const sr = ctx.sampleRate;
  const len = Math.max(1, Math.floor(sr * seconds));
  const buf = ctx.createBuffer(2, len, sr);
  const onset = sr * 0.012;
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    let lp = 0;
    for (let i = 0; i < len; i++) {
      const x = i / len;
      const env = Math.pow(1 - x, decay) * (i < onset ? i / onset : 1);
      const k = lerp(0.85, 0.07, Math.pow(x, 0.6)); // darker as it decays
      lp += (Math.random() * 2 - 1 - lp) * k;
      d[i] = lp * env * (2 - k);
    }
    for (let r = 0; r < 14; r++) {
      const idx = Math.floor(sr * rand(0.007, 0.09));
      if (idx < len) d[idx] += rand(-0.6, 0.6) * (1 - idx / (sr * 0.1));
    }
  }
  return buf;
}

/** Gentle tanh saturation curve for weighty low-end (explosions, boss). */
function makeSatCurve(drive = 2.2) {
  const n = 1024;
  const curve = new Float32Array(n);
  const norm = Math.tanh(drive);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = Math.tanh(x * drive) / norm;
  }
  return curve;
}

function reverseBuffer(buf) {
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const d = buf.getChannelData(c);
    d.reverse();
    normalize(d, 0.8);
  }
  return buf;
}

// ─── Voice: a disposable SFX node graph ──────────────────────────────────────

/**
 * Collects every node created for one sound so the whole graph is disconnected
 * as soon as its last source ends (or when it is stolen). Builder helpers keep
 * sound definitions compact. `rate` applies the sfx `pitch` option to the
 * musical builders (tone / fm / noiseHit / pulses).
 */
class Voice {
  constructor(eng, name, prio, t, dest, pan = null) {
    const ctx = eng._ctx;
    this.eng = eng;
    this.ctx = ctx;
    this.name = name;
    this.prio = prio;
    this.t = t;
    this.born = ctx.currentTime;
    this.end = t + 0.1;
    this.rate = 1;
    this.nodes = [];
    this.live = 0;
    this.dying = false;
    this.dead = false;
    this.out = ctx.createGain();
    this.nodes.push(this.out);
    if (pan !== null) {
      const p = eng._panner(pan);
      p.connect(dest);
      this.nodes.push(p);
      this.out.connect(p);
    } else {
      this.out.connect(dest);
    }
  }

  hz(f) {
    return this.eng._fq(f * this.rate);
  }

  // ── primitive nodes ──
  g(v = 1, dest = this.out) {
    const n = this.ctx.createGain();
    n.gain.value = v;
    if (dest) n.connect(dest);
    this.nodes.push(n);
    return n;
  }

  f(type, freq, Q = 0.707, dest = this.out) {
    const n = this.ctx.createBiquadFilter();
    n.type = type;
    n.frequency.value = this.eng._fq(freq);
    n.Q.value = Q;
    if (dest) n.connect(dest);
    this.nodes.push(n);
    return n;
  }

  pan(p, dest = this.out) {
    const n = this.eng._panner(p);
    n.connect(dest);
    this.nodes.push(n);
    return n;
  }

  shaper(dest = this.out) {
    const n = this.ctx.createWaveShaper();
    n.curve = this.eng._sat;
    n.connect(dest);
    this.nodes.push(n);
    return n;
  }

  /** Feedback echo. Returns the input node. */
  delay(time, fb, wet, dest = this.out) {
    const d = this.ctx.createDelay(2);
    d.delayTime.value = time;
    this.nodes.push(d);
    d.connect(this.g(fb, d));
    d.connect(this.g(wet, dest));
    return d;
  }

  send(amount, bus = this.eng._sfxRev) {
    if (!(amount > 0) || !bus) return;
    const s = this.g(amount, bus);
    this.out.connect(s);
  }

  // ── sources ──
  run(src, t0, t1, offset) {
    src._src = true;
    src._t0 = t0;
    this.nodes.push(src);
    this.live++;
    src.onended = () => {
      if (--this.live <= 0) this.free();
    };
    if (offset !== undefined) src.start(t0, offset);
    else src.start(t0);
    src.stop(t1);
    if (t1 > this.end) this.end = t1;
    return src;
  }

  osc(type, freq, t0, t1, dest = this.out) {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    if (dest) o.connect(dest);
    return this.run(o, t0, t1);
  }

  noise(kind, t0, t1, dest = this.out, rate = 1) {
    const s = this.ctx.createBufferSource();
    s.buffer = this.eng._noise[kind] || this.eng._noise.white;
    s.loop = true;
    s.playbackRate.value = rate;
    if (dest) s.connect(dest);
    return this.run(s, t0, t1, Math.random() * (s.buffer.duration - 0.05));
  }

  /** Keeps the voice alive (e.g. for echo tails) until t1. */
  keep(t1) {
    if (!this.ctx.createConstantSource) return;
    const c = this.ctx.createConstantSource();
    c.offset.value = 0;
    c.connect(this.out);
    this.run(c, this.t, t1);
  }

  // ── compound builders ──
  /** Oscillator + percussive envelope, with optional exponential glide `to`. */
  tone(type, freq, t, peak, a, d, o = {}) {
    const env = this.g(0, o.dest || this.out);
    const end = envPerc(env.gain, t, peak, a, d);
    const osc = this.osc(type, this.hz(freq), t, end + 0.02, env);
    if (o.to) {
      osc.frequency.setValueAtTime(this.hz(freq), t);
      osc.frequency.exponentialRampToValueAtTime(this.hz(o.to), t + (o.glide || a + d));
    }
    if (o.detune) osc.detune.value = o.detune;
    return osc;
  }

  /** Filtered noise burst with optional filter sweep `to`. */
  noiseHit(kind, t, peak, a, d, o = {}) {
    const env = this.g(0, o.dest || this.out);
    const end = envPerc(env.gain, t, peak, a, d);
    const fl = this.f(o.type || 'bandpass', this.hz(o.f || 1000), o.Q ?? 0.9, env);
    if (o.to) {
      fl.frequency.setValueAtTime(this.hz(o.f || 1000), t);
      fl.frequency.exponentialRampToValueAtTime(this.hz(o.to), t + (o.glide || a + d));
    }
    this.noise(kind, t, end + 0.02, fl, (o.rate || 1) * this.rate);
    return fl;
  }

  /** Two-operator FM bell/tine. Returns the carrier oscillator. */
  fm(freq, t, peak, a, d, o = {}) {
    const f = this.hz(freq);
    const env = this.g(0, o.dest || this.out);
    const end = envPerc(env.gain, t, peak, a, d);
    const car = this.osc('sine', f, t, end + 0.02, env);
    const idx = this.g(0, car.frequency);
    const index = o.index ?? 1.5;
    idx.gain.setValueAtTime(f * index, t);
    idx.gain.exponentialRampToValueAtTime(f * index * 0.04 + 0.01, t + a + d * (o.bright ?? 0.5));
    this.osc('sine', f * (o.ratio || 3.5), t, end + 0.02, idx);
    return car;
  }

  /** Many short clicks from a single noise source (ratchets, crackles, clatter). */
  pulses(kind, times, amps, decay, o = {}) {
    if (!times.length) return null;
    const env = this.g(0, o.dest || this.out);
    const fl = this.f(o.type || 'bandpass', this.hz(o.f || 3000), o.Q ?? 2, env);
    const t0 = times[0];
    let last = t0;
    env.gain.setValueAtTime(0, t0);
    for (let i = 0; i < times.length; i++) {
      const tt = Math.max(times[i], last);
      env.gain.setValueAtTime(Math.max(0, amps[i] ?? amps[0]), tt);
      env.gain.setTargetAtTime(0, tt + 0.001, decay * rand(0.6, 1.4));
      last = tt + 0.0005;
    }
    this.noise(kind, t0, last + decay * 7 + 0.02, fl, (o.rate || 1) * this.rate);
    return fl;
  }

  /** Vibrato: LFO (Hz) with depth (Hz) fading in over `rise` seconds. */
  vib(osc, rate, depth, t, rise, t1 = this.end) {
    const g = this.g(0, osc.frequency);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(depth, t + rise);
    this.osc('sine', rate, t, t1, g);
  }

  // ── lifetime ──
  kill(at) {
    if (this.dying || this.dead) return;
    this.dying = true;
    this.dieAt = at;
    try {
      holdParam(this.out.gain, at);
      this.out.gain.setTargetAtTime(0, at, 0.012);
    } catch (_) { /* ignore */ }
    for (const n of this.nodes) {
      if (!n._src) continue;
      try { n.stop(Math.max(at + 0.06, n._t0 || 0)); } catch (_) { /* ignore */ }
    }
  }

  free() {
    if (this.dead) return;
    this.dead = true;
    for (const n of this.nodes) {
      if (n._src) n.onended = null;
      try { n.disconnect(); } catch (_) { /* ignore */ }
    }
    this.nodes.length = 0;
    this.eng._release(this);
  }
}

// ─── DreamAudio ──────────────────────────────────────────────────────────────

export class DreamAudio {
  /**
   * @param {object} [options]
   * @param {number} [options.masterVolume=0.9]
   * @param {number} [options.musicVolume=0.8]
   * @param {number} [options.sfxVolume=0.9]
   * @param {BaseAudioContext} [options.context] inject a context (e.g. OfflineAudioContext for tests)
   * @param {boolean} [options.debug] log swallowed errors with console.warn
   */
  constructor(options = {}) {
    const o = options && typeof options === 'object' ? options : {};
    this._opts = o;
    this._debug = !!o.debug;
    this._ctx = null;
    this._ready = false;
    this._offline = false;

    // User-facing state (stored before start(), applied once the graph exists).
    this._vol = {
      master: clamp(num(o.masterVolume, 0.9)),
      music: clamp(num(o.musicVolume, 0.8)),
      sfx: clamp(num(o.sfxVolume, 0.9)),
    };
    this._layer = 0;
    this._intTarget = 0;
    this._int = 0;
    this._lucTarget = 0;
    this._luc = 0;
    this._paused = false;
    this._listener = { px: 0, py: 0, pz: 0, fx: 0, fy: 0, fz: -1 };
    this._beatCbs = [];

    // Scheduler state.
    this._step = 0;
    this._nextStep = 0;
    this._stepDur = 60 / BASE_BPM / 4;
    this._baseStepDur = this._stepDur;
    this._tempoMul = 1;
    this._layerBar = 0;
    this._beatCount = 0;
    this._beats = [];
    this._tapeStop = 0;
    this._arpPos = 0;
    this._chordDeg = 0;
    this._chordTones = [0, 3, 7, 10];
    this._stemTarget = { pad: 1, bass: 0, arp: 0, perc: 0, shimmer: 1 };
    this._bus = null;
    this._worldFaded = false;

    // Weapon melody: ring buffer of absolute scale indices + current direction.
    this._ring = [];
    this._dir = 1;

    // SFX bookkeeping.
    this._voices = [];
    this._lastPlayed = new Map();

    // Timers / listeners.
    this._timer = null;
    this._lastTick = 0;
    this._lastParam = -1;
    this._appliedLuc = -1;
    this._onVis = null;
    this._unlock = null;
  }

  // ─── Public API ────────────────────────────────────────────────────────────

  /** Create/resume the AudioContext (call from a user gesture) and start the score. Idempotent. */
  async start() {
    try {
      if (this._ctx) {
        await this._resume();
        return this._ready;
      }
      const W = typeof window !== 'undefined' ? window : globalThis;
      let ctx = this._opts.context || null;
      if (!ctx) {
        const AC = W.AudioContext || W.webkitAudioContext;
        if (!AC) return false;
        try { ctx = new AC({ latencyHint: 'interactive' }); } catch (_) { ctx = new AC(); }
      }
      this._ctx = ctx;
      this._offline = typeof OfflineAudioContext !== 'undefined' && ctx instanceof OfflineAudioContext;
      const resuming = this._resume(); // must be requested synchronously inside the gesture
      this._build();
      this._startScore();
      this._ready = true;
      if (!this._offline) {
        this._timer = setInterval(() => {
          try { this._tick(); } catch (e) { this._warn(e); }
        }, TICK_MS);
        this._armListeners();
      }
      this._prerender().catch((e) => this._warn(e));
      await resuming;
      return true;
    } catch (e) {
      this._warn(e);
      return false;
    }
  }

  get started() {
    return this._ready;
  }

  get context() {
    return this._ctx;
  }

  /** Per-frame hook. Scheduling is driven by the audio clock, so `dt` is informational. */
  update(dt) {
    try { this._tick(); } catch (e) { this._warn(e); }
  }

  setLayer(index) {
    try {
      const i = clamp(Math.round(num(index, 0)), 0, LAYERS.length - 1);
      if (!this._ready) { this._layer = i; return; }
      this._restoreWorld();
      if (i === this._layer && this._bus) return;
      this._layer = i;
      this._switchLayer(i);
    } catch (e) { this._warn(e); }
  }

  setIntensity(v) {
    this._intTarget = clamp(num(v, 0));
  }

  setLucidity(v) {
    this._lucTarget = clamp(num(v, 0));
  }

  setPaused(paused) {
    this._paused = !!paused;
    if (!this._ready) return;
    try {
      const t = this._ctx.currentTime;
      this._pauseGain.gain.setTargetAtTime(this._paused ? 0.2 : 1, t, 0.12);
      this._pauseLP.frequency.setTargetAtTime(this._fq(this._paused ? 650 : 20000), t, this._paused ? 0.1 : 0.25);
    } catch (e) { this._warn(e); }
  }

  setMasterVolume(v) {
    this._vol.master = clamp(num(v, this._vol.master));
    this._applyVolumes();
  }

  setMusicVolume(v) {
    this._vol.music = clamp(num(v, this._vol.music));
    this._applyVolumes();
  }

  setSfxVolume(v) {
    this._vol.sfx = clamp(num(v, this._vol.sfx));
    this._applyVolumes();
  }

  /** position / forward: {x,y,z}. Used for cheap stereo panning + distance attenuation. */
  setListener(position, forward) {
    const L = this._listener;
    if (position) {
      L.px = num(position.x, L.px);
      L.py = num(position.y, L.py);
      L.pz = num(position.z, L.pz);
    }
    if (forward) {
      L.fx = num(forward.x, L.fx);
      L.fy = num(forward.y, L.fy);
      L.fz = num(forward.z, L.fz);
    }
  }

  /**
   * Play a sound effect. Never throws.
   * opts: { quantize?: boolean|'loose', pitch?: semitones, gain?: 0..2, position?: {x,y,z}, property?: string }
   */
  sfx(name, opts = {}) {
    try {
      if (!this._ready) return;
      const key = PROPERTY_SFX[name] || name;
      const def = SFX[key];
      if (!def) return;
      const ctx = this._ctx;
      if (!this._offline && ctx.state !== 'running') return;
      if (this._paused && !UI_SFX.has(key)) return;
      const o = opts && typeof opts === 'object' ? opts : {};
      const lim = SFX_LIMITS[key] || DEFAULT_LIMIT;
      const now = ctx.currentTime;
      const last = this._lastPlayed.get(key);
      if (last !== undefined && now >= last && now - last < lim.gap) return;

      const g = clamp(num(o.gain, 1), 0, 2);
      let level = g;
      let pan = null;
      let dist = 0;
      if (o.position && typeof o.position === 'object') {
        const sp = this._spatial(o.position);
        level *= sp.gain;
        pan = sp.pan;
        dist = sp.dist;
      }
      if (level < 0.003) return;
      if (!this._allocVoice(key, lim, now)) return;

      const q = this._slotTime(o.quantize);
      const prop = typeof o.property === 'string' && PROPERTIES[o.property] ? o.property : null;
      const pitch = clamp(num(o.pitch, 0), -48, 48);
      const x = { g, prop, strong: q.strong, pitch, n: 0, m: 0, dist };
      if (MELODIC.has(key)) {
        x.n = this._melodyIndex(prop, q.strong);
        x.m = this._scaleMidi(x.n) + pitch;
      } else {
        x.m = this._ct(0);
      }

      const v = new Voice(this, key, lim.prio, q.t, this._sfxBus, pan);
      if (!MELODIC.has(key) && pitch) v.rate = Math.pow(2, pitch / 12);
      v.out.gain.value = level;
      def(this, v, q.t, x);
      if (dist > 6) v.send(clamp((dist - 6) / 50) * 0.3); // distant sounds sit further back in the room
      if (v.live === 0) { v.free(); return; }
      this._voices.push(v);
      this._lastPlayed.set(key, now);
    } catch (e) { this._warn(e); }
  }

  /** Bar-synced musical one-shots: descend, wake, bossIntro, memory, lucidityWarn, runStart. */
  stinger(name) {
    try {
      if (!this._ready) return;
      const fn = STINGERS[name];
      if (!fn) return;
      if (!this._offline && this._ctx.state !== 'running') return;
      // Big events land on the next downbeat; small cues on the next beat to stay responsive.
      const t = name === 'memory' || name === 'lucidityWarn' ? this._gridTime(4) : this._gridTime(STEPS);
      const v = new Voice(this, 'stinger:' + name, 9, t, this._stingerBus);
      fn(this, v, t);
      if (v.live === 0) v.free();
    } catch (e) { this._warn(e); }
  }

  /** callback(beatIndex, time) on every quarter note (setTimeout aligned to audio time). Returns an unsubscribe fn. */
  onBeat(callback) {
    if (typeof callback !== 'function') return () => {};
    this._beatCbs.push(callback);
    return () => {
      const i = this._beatCbs.indexOf(callback);
      if (i >= 0) this._beatCbs.splice(i, 1);
    };
  }

  /** 0..1 phase within the current beat, from the audio clock. */
  get beatPhase() {
    if (!this._ready) return 0;
    const now = this._ctx.currentTime;
    for (let i = this._beats.length - 1; i >= 0; i--) {
      const b = this._beats[i];
      if (b.t <= now) return clamp((now - b.t) / b.dur, 0, 0.9999);
    }
    return 0;
  }

  /** Stop timers, remove listeners and close the context. (Extra; not required by the game.) */
  dispose() {
    try {
      if (this._timer) clearInterval(this._timer);
      this._timer = null;
      this._removeListeners();
      for (const v of this._voices.slice()) v.free();
      if (this._ctx && !this._offline && this._ctx.close) this._ctx.close().catch(() => {});
    } catch (e) { this._warn(e); }
    this._ready = false;
    this._ctx = null;
  }

  // ─── Lifecycle helpers ─────────────────────────────────────────────────────

  _warn(e) {
    if (this._debug) console.warn('[DreamAudio]', e);
  }

  _resume() {
    const ctx = this._ctx;
    if (!ctx || this._offline || ctx.state === 'running') return Promise.resolve();
    if (typeof document !== 'undefined' && document.hidden) return Promise.resolve();
    // resume() stays pending until a user gesture; never block the caller forever.
    return Promise.race([ctx.resume().catch(() => {}), new Promise((r) => setTimeout(r, 1500))]);
  }

  _armListeners() {
    if (typeof document !== 'undefined' && document.addEventListener) {
      this._onVis = () => {
        const ctx = this._ctx;
        if (!ctx || this._offline) return;
        if (document.hidden) {
          if (ctx.state === 'running') ctx.suspend().catch(() => {});
        } else if (this._ready) {
          ctx.resume().catch(() => {});
        }
      };
      document.addEventListener('visibilitychange', this._onVis);
    }
    if (typeof window !== 'undefined' && window.addEventListener) {
      // If start() ran without a real gesture, the first gesture unlocks audio.
      this._unlock = () => {
        const ctx = this._ctx;
        if (!ctx) return;
        if (ctx.state !== 'running' && !(typeof document !== 'undefined' && document.hidden)) ctx.resume().catch(() => {});
      };
      for (const ev of ['pointerdown', 'keydown', 'touchend']) window.addEventListener(ev, this._unlock, true);
    }
  }

  _removeListeners() {
    if (this._onVis && typeof document !== 'undefined') document.removeEventListener('visibilitychange', this._onVis);
    if (this._unlock && typeof window !== 'undefined') {
      for (const ev of ['pointerdown', 'keydown', 'touchend']) window.removeEventListener(ev, this._unlock, true);
    }
    this._onVis = this._unlock = null;
  }

  _applyVolumes() {
    if (!this._ready && !this._master) return;
    try {
      const t = this._ctx.currentTime;
      this._master.gain.setTargetAtTime(this._vol.master, t, 0.04);
      this._musicVol.gain.setTargetAtTime(this._vol.music, t, 0.04);
      this._sfxBus.gain.setTargetAtTime(this._vol.sfx, t, 0.04);
      this._sfxRev.gain.setTargetAtTime(this._vol.sfx, t, 0.04);
    } catch (e) { this._warn(e); }
  }

  /** Clamp a filter frequency to a safe range below Nyquist. */
  _fq(f) {
    return clamp(num(f, 1000), 10, (this._nyq || 22050) * 0.95);
  }

  _panner(p) {
    const ctx = this._ctx;
    if (ctx.createStereoPanner) {
      const n = ctx.createStereoPanner();
      n.pan.value = clamp(num(p, 0), -1, 1);
      return n;
    }
    return ctx.createGain();
  }

  /** A constant (DC) source for the tape-warp offset, with a buffer fallback. */
  _constantSource() {
    const ctx = this._ctx;
    if (ctx.createConstantSource) {
      const c = ctx.createConstantSource();
      c.offset.value = 0;
      c.start();
      return { node: c, param: c.offset };
    }
    const buf = ctx.createBuffer(1, 128, ctx.sampleRate);
    buf.getChannelData(0).fill(1);
    const s = ctx.createBufferSource();
    s.buffer = buf;
    s.loop = true;
    const g = ctx.createGain();
    g.gain.value = 0;
    s.connect(g);
    s.start();
    return { node: g, param: g.gain };
  }

  // ─── Graph construction ────────────────────────────────────────────────────

  _build() {
    const ctx = this._ctx;
    const G = (v = 1) => {
      const n = ctx.createGain();
      n.gain.value = v;
      return n;
    };
    const F = (type, f, Q = 0.707) => {
      const n = ctx.createBiquadFilter();
      n.type = type;
      n.frequency.value = this._fq(f);
      n.Q.value = Q;
      return n;
    };
    this._nyq = ctx.sampleRate / 2;

    // Shared resources (created once).
    this._noise = { white: makeNoise(ctx, 'white'), pink: makeNoise(ctx, 'pink'), brown: makeNoise(ctx, 'brown') };
    this._sat = makeSatCurve(2.2);

    // Master: glue compressor → brickwall-ish limiter → master gain.
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -20;
    comp.knee.value = 14;
    comp.ratio.value = 3;
    comp.attack.value = 0.006;
    comp.release.value = 0.25;
    const lim = ctx.createDynamicsCompressor();
    lim.threshold.value = -2.5;
    lim.knee.value = 0;
    lim.ratio.value = 20;
    lim.attack.value = 0.002;
    lim.release.value = 0.12;
    const master = G(this._vol.master);
    // Everything sums into `mix`; the trim offsets the compressor's automatic makeup gain.
    const mix = G(0.5);
    mix.connect(comp);
    comp.connect(lim);
    lim.connect(master);
    master.connect(ctx.destination);
    this._comp = comp;
    this._master = master;

    // Shared reverb: noise-decay impulse through a convolver (IR generated once).
    const revIn = G(1);
    const revHp = F('highpass', 140, 0.5);
    const conv = ctx.createConvolver();
    conv.normalize = true;
    conv.buffer = makeImpulse(ctx, 3.8, 2.6);
    const revTone = F('lowpass', 7500, 0.5);
    const revOut = G(0.85);
    revIn.connect(revHp);
    revHp.connect(conv);
    conv.connect(revTone);
    revTone.connect(revOut);
    revOut.connect(mix);
    this._revIn = revIn;
    this._revTone = revTone;
    this._revOut = revOut;

    // Music chain: musicIn → dip → lucidity filter → (dry | comb/flanger) → world → musicSum.
    const musicIn = G(1);
    const dip = G(1);
    const lucFilter = F('lowpass', 18000, 0.7);
    const sweepLfo = ctx.createOscillator();
    sweepLfo.frequency.value = 0.07;
    const sweepDepth = G(0);
    sweepLfo.connect(sweepDepth);
    sweepDepth.connect(lucFilter.frequency);
    sweepLfo.start();

    const dry = G(1);
    const flDelay = ctx.createDelay(0.05);
    flDelay.delayTime.value = 0.006;
    const flLfo = ctx.createOscillator();
    flLfo.frequency.value = 0.21;
    const flDepth = G(0.0012);
    flLfo.connect(flDepth);
    flDepth.connect(flDelay.delayTime);
    flLfo.start();
    const flFb = G(0.15);
    const flWet = G(0);
    const world = G(1);

    musicIn.connect(dip);
    dip.connect(lucFilter);
    lucFilter.connect(dry);
    dry.connect(world);
    lucFilter.connect(flDelay);
    flDelay.connect(flFb);
    flFb.connect(flDelay);
    flDelay.connect(flWet);
    flWet.connect(world);

    const musicSum = G(1);
    const stingerBus = G(0.9);
    const fxBus = G(1); // heartbeat / ticking: not filtered by lucidity
    world.connect(musicSum);
    stingerBus.connect(musicSum);
    fxBus.connect(musicSum);

    const musicVol = G(this._vol.music);
    const pauseGain = G(this._paused ? 0.2 : 1);
    const pauseLP = F('lowpass', this._paused ? 650 : 20000, 0.5);
    const musicRev = G(0.22);
    musicSum.connect(musicVol);
    musicVol.connect(pauseGain);
    pauseGain.connect(pauseLP);
    pauseLP.connect(mix);
    pauseLP.connect(musicRev);
    musicRev.connect(revIn);

    Object.assign(this, {
      _musicIn: musicIn, _dip: dip, _lucFilter: lucFilter, _sweepLfo: sweepLfo, _sweepDepth: sweepDepth,
      _flDepth: flDepth, _flFb: flFb, _flWet: flWet, _world: world, _stingerBus: stingerBus, _fxBus: fxBus,
      _musicVol: musicVol, _pauseGain: pauseGain, _pauseLP: pauseLP, _musicRev: musicRev,
    });

    // SFX buses.
    const sfxBus = G(this._vol.sfx);
    const sfxRev = G(this._vol.sfx);
    sfxBus.connect(mix);
    sfxRev.connect(revIn);
    this._sfxBus = sfxBus;
    this._sfxRev = sfxRev;

    // Tape warp (cents): DC offset for tape-stops + slow wow + fast flutter + drift.
    // Every pitched music source connects this to its `detune`.
    const warp = G(1);
    const off = this._constantSource();
    off.node.connect(warp);
    this._warpOffset = off.param;
    const wow = ctx.createOscillator();
    wow.frequency.value = 0.31;
    const wowDepth = G(3);
    wow.connect(wowDepth);
    wowDepth.connect(warp);
    wow.start();
    const drift = ctx.createOscillator();
    drift.frequency.value = 0.053;
    const driftDepth = G(4);
    drift.connect(driftDepth);
    driftDepth.connect(warp);
    drift.start();
    const flutter = ctx.createOscillator();
    flutter.frequency.value = 5.3;
    const flutterDepth = G(0.8);
    flutter.connect(flutterDepth);
    flutterDepth.connect(warp);
    flutter.start();
    Object.assign(this, { _warp: warp, _wow: wow, _wowDepth: wowDepth, _flutterDepth: flutterDepth });
  }

  /**
   * Pre-render one pad note and one bell note (with a short reverb tail) in an
   * OfflineAudioContext, then reverse the channel data: reversed swells.
   */
  async _prerender() {
    const W = typeof window !== 'undefined' ? window : globalThis;
    const OAC = W.OfflineAudioContext || W.webkitOfflineAudioContext;
    if (!OAC || !this._ctx) return;
    const sr = this._ctx.sampleRate;
    const render = async (secs, build) => {
      const oc = new OAC(2, Math.ceil(secs * sr), sr);
      const out = oc.createGain();
      const wet = oc.createGain();
      const conv = oc.createConvolver();
      conv.buffer = makeImpulse(oc, secs * 0.8, 2.2);
      out.connect(oc.destination);
      out.connect(conv);
      conv.connect(wet);
      wet.gain.value = 0.7;
      wet.connect(oc.destination);
      build(oc, out);
      const buf = await oc.startRendering();
      return reverseBuffer(buf);
    };
    const t = 0.004;

    this._revPad = await render(2.6, (oc, out) => {
      const f = mtof(REV_PAD_MIDI);
      const env = oc.createGain();
      env.gain.setValueAtTime(0, t);
      env.gain.linearRampToValueAtTime(0.5, t + 0.03);
      env.gain.exponentialRampToValueAtTime(EPS, t + 1.9);
      const lp = oc.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.setValueAtTime(2600, t);
      lp.frequency.exponentialRampToValueAtTime(500, t + 1.8);
      lp.connect(env);
      env.connect(out);
      for (const [ratio, det] of [[1, -9], [1, 8], [1.5, -4], [2, 5]]) {
        const o = oc.createOscillator();
        o.type = ratio === 1 ? 'sawtooth' : 'triangle';
        o.frequency.value = f * ratio;
        o.detune.value = det;
        o.connect(lp);
        o.start(t);
        o.stop(t + 2);
      }
    });

    this._revBell = await render(2.2, (oc, out) => {
      const f = mtof(REV_BELL_MIDI);
      const env = oc.createGain();
      env.gain.setValueAtTime(0, t);
      env.gain.linearRampToValueAtTime(0.5, t + 0.002);
      env.gain.exponentialRampToValueAtTime(EPS, t + 1.6);
      env.connect(out);
      const car = oc.createOscillator();
      car.frequency.value = f;
      const idx = oc.createGain();
      idx.gain.setValueAtTime(f * 2, t);
      idx.gain.exponentialRampToValueAtTime(f * 0.05, t + 0.8);
      const modu = oc.createOscillator();
      modu.frequency.value = f * 3.5;
      modu.connect(idx);
      idx.connect(car.frequency);
      car.connect(env);
      car.start(t);
      modu.start(t);
      car.stop(t + 1.7);
      modu.stop(t + 1.7);
    });
  }

  // ─── Score state: layers, chords, stems ────────────────────────────────────

  get _L() {
    return LAYERS[this._layer];
  }

  _startScore() {
    const ctx = this._ctx;
    const t = ctx.currentTime + 0.06;
    const L = this._L;
    this._nextStep = t;
    this._step = 0;
    this._layerBar = 0;
    this._tempoMul = L.tempo;
    this._int = this._intTarget;
    this._luc = this._lucTarget;
    this._lastTick = ctx.currentTime;
    this._setChord(L.prog[0]);
    this._bus = this._makeBus(this._layer, t, 0.8);
    this._applyStems(t, true);
    this._applyLucidity(ctx.currentTime, true);
  }

  /** A layer bus: one gain per stem → out (the crossfade gain) → musicIn. */
  _makeBus(index, t, fade) {
    const ctx = this._ctx;
    const out = ctx.createGain();
    out.gain.setValueAtTime(0, t);
    out.gain.linearRampToValueAtTime(1, t + fade);
    out.connect(this._musicIn);
    const stems = {};
    for (const k of STEMS) {
      const g = ctx.createGain();
      g.gain.value = 0;
      g.connect(out);
      stems[k] = g;
    }
    const bus = { index, out, stems, drones: [] };
    if (LAYERS[index].drone) this._startDrone(bus, t, LAYERS[index]);
    return bus;
  }

  _retireBus(bus, t) {
    holdParam(bus.out.gain, t);
    bus.out.gain.linearRampToValueAtTime(0, t + XFADE);
    for (const d of bus.drones) {
      try { d.stop(t + XFADE + 0.1); } catch (_) { /* ignore */ }
    }
    setTimeout(() => {
      try {
        bus.out.disconnect();
        for (const k of STEMS) bus.stems[k].disconnect();
      } catch (_) { /* ignore */ }
    }, (XFADE + 6) * 1000);
  }

  _switchLayer(i) {
    const t = this._ctx.currentTime + 0.03;
    if (this._bus) this._retireBus(this._bus, t);
    this._bus = this._makeBus(i, t, XFADE);
    const L = LAYERS[i];
    // The new progression restarts on the next downbeat; a tonic "bridge" pad fills until then.
    const stepsToBar = mod(STEPS - mod(this._step, STEPS), STEPS);
    this._layerBar = Math.floor((this._step + stepsToBar) / STEPS);
    this._setChord(L.prog[0]);
    this._applyStems(t, true);
    if (stepsToBar > 2) this._padChord(t, stepsToBar * this._stepDur + 0.3, L, this._bus.stems.pad, true);
  }

  _tonesFor(deg) {
    const m = this._L.mode;
    return [0, 2, 4, 6].map((k) => m[mod(deg + k, 7)] + 12 * Math.floor((deg + k) / 7));
  }

  _setChord(deg) {
    this._chordDeg = deg;
    this._chordTones = this._tonesFor(deg);
  }

  /** Keep a chord's root near the tonic register (drop an octave if it sits above the 5th). */
  _norm(tones) {
    return tones[0] > 7 ? tones.map((x) => x - 12) : tones;
  }

  /** Intensity → stem levels, applied on bar boundaries. */
  _applyStems(t, immediate = false) {
    const i = this._int;
    const L = this._L;
    const tgt = {
      pad: 1 - 0.2 * i,
      shimmer: 0.9 - 0.35 * i,
      arp: smoothstep(0.2, 0.34, i),
      bass: smoothstep(0.42, 0.56, i),
      perc: smoothstep(L.perc.lo, L.perc.lo + 0.14, i),
    };
    this._stemTarget = tgt;
    if (!this._bus) return;
    for (const k of STEMS) {
      const p = this._bus.stems[k].gain;
      if (immediate) {
        holdParam(p, t);
        p.linearRampToValueAtTime(tgt[k], t + 0.05);
      } else {
        p.setTargetAtTime(tgt[k], t, 0.45);
      }
    }
  }

  _restoreWorld() {
    if (!this._worldFaded || !this._ready) return;
    this._worldFaded = false;
    const t = this._ctx.currentTime;
    holdParam(this._world.gain, t);
    this._world.gain.linearRampToValueAtTime(1, t + 1.5);
  }

  _fadeWorld(t, dur) {
    this._worldFaded = true;
    holdParam(this._world.gain, t);
    this._world.gain.linearRampToValueAtTime(0, t + dur);
  }

  _dipMusic(t, depth, dur) {
    const p = this._dip.gain;
    holdParam(p, t);
    p.linearRampToValueAtTime(depth, t + Math.min(0.4, dur * 0.3));
    p.linearRampToValueAtTime(1, t + dur);
  }

  /** Lucidity → warble, filter sweep, comb smear, reverb darkness/wetness. Throttled. */
  _applyLucidity(now, force = false) {
    const l = this._luc;
    if (!force && Math.abs(l - this._appliedLuc) < 0.003) return;
    this._appliedLuc = l;
    const tc = force ? 0.01 : 0.25;
    const set = (p, v) => p.setTargetAtTime(v, now, tc);
    const wake = clamp((l - 0.85) / 0.15);
    set(this._wowDepth.gain, 3 + 42 * Math.pow(l, 1.6) + 20 * wake);
    set(this._wow.frequency, 0.28 + 0.9 * l);
    set(this._flutterDepth.gain, 0.8 + 6 * l * l);
    const cut = 18000 * Math.pow(1500 / 18000, Math.pow(l, 0.85));
    set(this._lucFilter.frequency, this._fq(cut));
    set(this._lucFilter.Q, 0.7 + 2.2 * l * l);
    set(this._sweepDepth.gain, cut * 0.5 * smoothstep(0.1, 0.8, l));
    set(this._sweepLfo.frequency, 0.06 + 0.14 * l);
    set(this._flWet.gain, 0.6 * smoothstep(0.15, 0.9, l));
    set(this._flFb.gain, 0.15 + 0.6 * l);
    set(this._flDepth.gain, 0.0012 + 0.0028 * l);
    set(this._musicRev.gain, 0.22 + 0.5 * l);
    set(this._revTone.frequency, lerp(7500, 1700, l));
    set(this._revOut.gain, 0.85 + 0.5 * l);
  }

  // ─── Scheduler ("A Tale of Two Clocks") ────────────────────────────────────

  /** Called by update() and by the setInterval fallback. Idempotent: never double-schedules. */
  _tick() {
    const ctx = this._ctx;
    if (!ctx || !this._ready) return;
    const now = ctx.currentTime;
    const dt = clamp(now - this._lastTick, 0, 0.25);
    this._lastTick = now;
    if (dt > 0) {
      const ti = this._intTarget > this._int ? 1.0 : 2.5;
      this._int += (this._intTarget - this._int) * (1 - Math.exp(-dt / ti));
      this._luc += (this._lucTarget - this._luc) * (1 - Math.exp(-dt / 1.2));
    }
    if (now - this._lastParam > 0.05 || now < this._lastParam) {
      this._lastParam = now;
      this._applyLucidity(now);
      this._sweepVoices(now);
    }
    this._schedule(now);
  }

  _schedule(now) {
    if (!this._offline && this._ctx.state !== 'running') return;
    // After a long stall, skip missed steps (keeping bar alignment) instead of bursting them out.
    if (this._nextStep < now - 0.2) {
      const miss = Math.ceil((now - this._nextStep) / this._stepDur);
      this._step += miss;
      this._nextStep += miss * this._stepDur;
    }
    let guard = 0;
    while (this._nextStep < now + LOOKAHEAD && guard++ < 64) {
      try { this._scheduleStep(this._step, this._nextStep); } catch (e) { this._warn(e); }
      this._nextStep += this._computeStepDur();
      this._step++;
    }
  }

  /** Tempo: layer tempo (smoothed) × lucidity drag (up to −25 %) × tape-stop slowdown. */
  _computeStepDur() {
    this._tempoMul += (this._L.tempo - this._tempoMul) * 0.03;
    const drag = 1 - 0.25 * Math.pow(this._luc, 1.25);
    let d = 60 / (BASE_BPM * this._tempoMul * drag) / 4;
    this._baseStepDur = d;
    if (this._tapeStop > 0) {
      d *= TAPE_STOP[TAPE_STOP.length - this._tapeStop];
      this._tapeStop--;
    }
    this._stepDur = d;
    return d;
  }

  _scheduleStep(step, t) {
    const s = mod(step, STEPS);
    const bar = Math.floor(step / STEPS);
    const L = this._L;
    const bus = this._bus;
    const d = this._stepDur;

    if (s === 0) {
      const rel = bar - this._layerBar;
      if (rel >= 0 && rel % BARS_PER_CHORD === 0) {
        this._setChord(L.prog[Math.floor(rel / BARS_PER_CHORD) % L.prog.length]);
        this._padChord(t, d * STEPS * BARS_PER_CHORD, L, bus.stems.pad);
      }
      this._applyStems(t);
    }
    if (s % 4 === 0) this._beat(t, d * 4);

    const T = this._stemTarget;
    if (T.bass > 0.01 && L._bass[s]) this._bassNote(t, L._bass[s], d, L, bus.stems.bass);
    if (T.arp > 0.01) this._arpStep(s, t, L, bus.stems.arp);
    if (T.perc > 0.01) this._percStep(s, t, L, bus.stems.perc);
    if (T.shimmer > 0.01 && s % 4 === 2 && chance(L.shimmer.p)) this._shimmerNote(t, L, bus.stems.shimmer);
    this._lucidityStep(s, t, L, bus, bar);
  }

  _beat(t, dur) {
    const idx = this._beatCount++;
    this._beats.push({ t, dur });
    if (this._beats.length > 8) this._beats.shift();
    if (!this._beatCbs.length || this._offline) return;
    const delay = Math.max(0, (t - this._ctx.currentTime) * 1000);
    setTimeout(() => {
      for (const cb of this._beatCbs.slice()) {
        try { cb(idx, t); } catch (e) { this._warn(e); }
      }
    }, delay);
  }

  /** Lucidity events on the grid: reversed swells, tape-stops, heartbeat + ticking. */
  _lucidityStep(s, t, L, bus, bar) {
    const l = this._luc;
    const d = this._baseStepDur;

    // Reversed pad swell that blooms into the next downbeat.
    if (s === 8 && this._revPad && chance(0.05 + 0.75 * Math.pow(l, 1.4))) {
      const rel = bar + 1 - this._layerBar;
      const deg = rel >= 0 && rel % BARS_PER_CHORD === 0 ? L.prog[Math.floor(rel / BARS_PER_CHORD) % L.prog.length] : this._chordDeg;
      const tones = this._norm(this._tonesFor(deg));
      const base = L.root + L.pad.oct + 12;
      this._reverseSwell(t, t + 8 * d, [base + tones[0], base + tones[2]], 'pad', bus.stems.pad, 0.14 + 0.16 * l);
    }
    // Reversed bell a beat before the downbeat at higher lucidity.
    if (s === 12 && this._revBell && l > 0.35 && chance(l * 0.5)) {
      this._reverseSwell(t, t + 4 * d, [this._ct(pick([0, 1, 2]), 0)], 'bell', bus.stems.shimmer, 0.12 + 0.1 * l);
    }
    // Tape-stop: pitch sags and the last beat of the bar drags, then snaps back on the downbeat.
    if (s === 12 && l > 0.55 && this._tapeStop === 0 && chance((l - 0.55) * 0.45)) {
      this._tapeStop = TAPE_STOP.length;
      const span = TAPE_STOP.reduce((a, m) => a + m, 0) * d;
      const p = this._warpOffset;
      holdParam(p, t);
      p.setTargetAtTime(-(250 + 950 * l), t, span * 0.4);
      p.setTargetAtTime(0, t + span, 0.025);
      this._dipMusic(t, 0.6, span + 0.1);
    }
    // The dreamer is waking: heartbeat on the beat, alarm-clock ticks that quicken.
    const w = clamp((l - 0.85) / 0.15);
    if (w > 0.001) {
      if (s % 4 === 0) this._heartbeat(t, w);
      const every = w > 0.66 ? 1 : 2;
      if (s % every === 0) this._clockTick(t, w, s);
    }
  }

  // ─── Music instruments ─────────────────────────────────────────────────────
  // Every note is a small group of nodes; the group disconnects itself when its
  // last source ends. Pitched sources are routed through the tape-warp bus.

  _grp() {
    return { nodes: [], live: 0 };
  }

  _play(grp, src, t0, t1, warp = true, offset) {
    grp.live++;
    const w = warp && src.detune ? this._warp : null;
    if (w) w.connect(src.detune);
    src.onended = () => {
      if (w) { try { w.disconnect(src.detune); } catch (_) { /* ignore */ } }
      try { src.disconnect(); } catch (_) { /* ignore */ }
      if (--grp.live <= 0) for (const n of grp.nodes) { try { n.disconnect(); } catch (_) { /* ignore */ } }
    };
    if (offset !== undefined) src.start(t0, offset);
    else src.start(t0);
    if (t1 !== Infinity) src.stop(t1);
    return src;
  }

  _mGain(grp, v, dest) {
    const g = this._ctx.createGain();
    g.gain.value = v;
    if (dest) g.connect(dest);
    grp.nodes.push(g);
    return g;
  }

  _mFilter(grp, type, f, Q, dest) {
    const n = this._ctx.createBiquadFilter();
    n.type = type;
    n.frequency.value = this._fq(f);
    n.Q.value = Q;
    n.connect(dest);
    grp.nodes.push(n);
    return n;
  }

  _mPan(grp, p, dest) {
    const n = this._panner(p);
    n.connect(dest);
    grp.nodes.push(n);
    return n;
  }

  _mOsc(grp, type, freq, t0, t1, dest, detune = 0, warp = true) {
    const o = this._ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    o.detune.value = detune;
    o.connect(dest);
    return this._play(grp, o, t0, t1, warp);
  }

  /** Filtered noise hit inside a music group. */
  _mHit(grp, kind, t, peak, a, d, type, f, Q, dest) {
    const env = this._mGain(grp, 0, dest);
    const end = envPerc(env.gain, t, peak, a, d);
    const fl = this._mFilter(grp, type, f, Q, env);
    const s = this._ctx.createBufferSource();
    s.buffer = this._noise[kind];
    s.loop = true;
    s.connect(fl);
    this._play(grp, s, t, end + 0.02, false, Math.random() * 1.5);
    return env;
  }

  /** Warm detuned pad: two oscillators per voice split L/R, a breathing lowpass, slow swell. */
  _padChord(t, dur, L, dest, bridge = false) {
    const P = L.pad;
    const tones = this._norm(this._chordTones);
    const base = L.root + P.oct;
    const voicing = [tones[0], tones[2], tones[1] + 12, tones[3] + 12].map((x) => base + x);
    const atk = bridge ? Math.min(1.2, dur * 0.5) : Math.min(P.attack, dur * 0.4);
    const rel = 2.2;
    const end = t + dur + rel + 0.05;
    const grp = this._grp();
    const env = this._mGain(grp, 0, dest);
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(P.gain, t + atk);
    env.gain.setValueAtTime(P.gain, t + dur);
    env.gain.exponentialRampToValueAtTime(EPS, t + dur + rel);
    const lp = this._mFilter(grp, 'lowpass', P.cutoff * 0.45, P.q, env);
    lp.frequency.setValueAtTime(this._fq(P.cutoff * 0.45), t);
    lp.frequency.linearRampToValueAtTime(this._fq(P.cutoff), t + atk + 0.5);
    lp.frequency.linearRampToValueAtTime(this._fq(P.cutoff * 0.7), t + dur + rel);
    const pl = this._mPan(grp, -0.45, lp);
    const pr = this._mPan(grp, 0.45, lp);
    for (let i = 0; i < voicing.length; i++) {
      const f = mtof(voicing[i]);
      this._mOsc(grp, P.types[0], f, t, end, pl, -P.detune + rand(-2, 2));
      this._mOsc(grp, P.types[1], f, t, end, pr, P.detune + rand(-2, 2));
    }
    this._mOsc(grp, 'sine', mtof(voicing[0] - 12), t, end, lp, 0); // body
  }

  /** Boss-layer drone: low detuned saws + fifth under a slowly breathing lowpass, plus a high tritone whisper. */
  _startDrone(bus, t, L) {
    const grp = this._grp();
    const env = this._mGain(grp, 0, bus.stems.pad);
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(0.07, t + 3);
    const lp = this._mFilter(grp, 'lowpass', 240, 3, env);
    const lfoG = this._mGain(grp, 110, lp.frequency);
    const f = mtof(L.root - 12);
    const srcs = [
      this._mOsc(grp, 'sawtooth', f, t, Infinity, lp, -9),
      this._mOsc(grp, 'sawtooth', f, t, Infinity, lp, 7),
      this._mOsc(grp, 'square', f * 1.5, t, Infinity, this._mGain(grp, 0.25, lp), 3),
      this._mOsc(grp, 'sine', 0.05, t, Infinity, lfoG, 0, false),
    ];
    const whisper = this._mGain(grp, 0.05, env);
    const trem = this._mGain(grp, 0.04, whisper.gain);
    srcs.push(this._mOsc(grp, 'sine', mtof(L.root + 30), t, Infinity, whisper, 0));
    srcs.push(this._mOsc(grp, 'sine', 0.23, t, Infinity, trem, 0, false));
    bus.drones.push(...srcs);
  }

  _bassNote(t, [, len, ti, vel], d, L, dest) {
    const tones = this._norm(this._chordTones);
    const f = mtof(L.root - 12 + tones[ti]);
    const dur = len * d;
    const pizz = L === LAYERS[1];
    const peak = 0.26 * vel;
    const end = t + dur + 0.14;
    const grp = this._grp();
    const env = this._mGain(grp, 0, dest);
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(peak, t + 0.012);
    env.gain.setTargetAtTime(peak * (pizz ? 0.35 : 0.7), t + 0.012, pizz ? 0.08 : 0.2);
    env.gain.setTargetAtTime(0, t + dur, 0.025);
    const lp = this._mFilter(grp, 'lowpass', pizz ? 900 : 340, L.drone ? 1.6 : 0.8, env);
    if (pizz) {
      lp.frequency.setValueAtTime(900, t);
      lp.frequency.exponentialRampToValueAtTime(260, t + 0.2);
    }
    this._mOsc(grp, 'sine', f, t, end, lp);
    this._mOsc(grp, 'triangle', f * 2, t, end, this._mGain(grp, 0.18, lp), 4);
  }

  _arpStep(s, t, L, dest) {
    const A = L.arp;
    if (s % A.every !== 0) return;
    const k = A.pattern[this._arpPos++ % A.pattern.length];
    if (!chance(A.density * (0.65 + 0.35 * this._int))) return; // generative gaps
    const tones = this._norm(this._chordTones);
    let midi = L.root + 24 + A.oct + tones[k % 4] + 12 * Math.floor(k / 4);
    if (chance(0.07)) midi += 12;
    const vel = (s % 4 === 0 ? 1 : 0.72) * rand(0.85, 1);
    if (A.pizz && s % 2 === 1) this._pizz(t, midi - 12, vel, dest);
    else this._musicBox(t, midi, A.gain * vel, dest);
  }

  /** Music-box / celesta tine: FM sine (ratio 3.5, fast-decaying index) + a faint high partial. */
  _musicBox(t, midi, peak, dest, dur = 1.3) {
    const f = mtof(midi);
    const grp = this._grp();
    const pan = this._mPan(grp, rand(-0.35, 0.35), dest);
    const env = this._mGain(grp, 0, pan);
    const end = envPerc(env.gain, t, peak, 0.002, dur) + 0.03;
    const car = this._mOsc(grp, 'sine', f, t, end, env);
    const idx = this._mGain(grp, 0, car.frequency);
    idx.gain.setValueAtTime(f * 1.2, t);
    idx.gain.exponentialRampToValueAtTime(f * 0.03, t + 0.3);
    this._mOsc(grp, 'sine', f * 3.5, t, end, idx);
    const ping = this._mGain(grp, 0, pan);
    envPerc(ping.gain, t, peak * 0.18, 0.001, 0.16);
    this._mOsc(grp, 'sine', f * 4.02, t, t + 0.2, ping);
  }

  /** Pizzicato: triangle + a little saw through a snapping lowpass. */
  _pizz(t, midi, vel, dest) {
    const f = mtof(midi);
    const grp = this._grp();
    const pan = this._mPan(grp, rand(-0.5, 0.5), dest);
    const env = this._mGain(grp, 0, pan);
    const end = envPerc(env.gain, t, 0.09 * vel, 0.003, 0.33) + 0.03;
    const lp = this._mFilter(grp, 'lowpass', f * 6, 2, env);
    lp.frequency.setValueAtTime(this._fq(f * 6), t);
    lp.frequency.exponentialRampToValueAtTime(this._fq(f * 1.4), t + 0.18);
    this._mOsc(grp, 'triangle', f, t, end, lp);
    this._mOsc(grp, 'sawtooth', f, t, end, this._mGain(grp, 0.3, lp), 5);
  }

  _percStep(s, t, L, dest) {
    const P = L._perc;
    const i = this._int;
    const hum = () => t + rand(0, 0.006);
    if (P.kick[s]) this._kick(hum(), P.kick[s], dest, !!L.drone);
    if (P.snare[s]) {
      if (L.perc.snareKind === 'tom') this._tom(hum(), P.snare[s], dest);
      else this._brush(hum(), P.snare[s], dest);
    }
    if (P.hat[s] && i > L.perc.hatAt) this._hat(hum(), P.hat[s], dest, L.perc.metal);
    if (P.wood[s] && i > L.perc.woodAt) this._wood(hum(), P.wood[s], dest);
  }

  /** Soft felt kick: sine pitch-drop + a muffled transient. */
  _kick(t, vel, dest, heavy) {
    const grp = this._grp();
    const env = this._mGain(grp, 0, dest);
    envPerc(env.gain, t, (heavy ? 0.55 : 0.42) * vel, 0.003, heavy ? 0.42 : 0.3);
    const o = this._mOsc(grp, 'sine', heavy ? 140 : 115, t, t + 0.5, env, 0, false);
    o.frequency.setValueAtTime(heavy ? 140 : 115, t);
    o.frequency.exponentialRampToValueAtTime(heavy ? 38 : 46, t + 0.14);
    this._mHit(grp, 'white', t, 0.07 * vel, 0.001, 0.014, 'lowpass', 1400, 0.7, dest);
  }

  /** Brushed snare: slow-attack band-passed swish + a small slap. */
  _brush(t, vel, dest) {
    const grp = this._grp();
    this._mHit(grp, 'white', t, 0.075 * vel, 0.018, 0.22, 'bandpass', 2600, 0.6, dest);
    this._mHit(grp, 'pink', t, 0.06 * vel, 0.002, 0.06, 'bandpass', 1300, 1, dest);
  }

  _tom(t, vel, dest) {
    const grp = this._grp();
    const env = this._mGain(grp, 0, dest);
    envPerc(env.gain, t, 0.34 * vel, 0.003, 0.38);
    const o = this._mOsc(grp, 'sine', 96, t, t + 0.45, env, 0, false);
    o.frequency.setValueAtTime(96, t);
    o.frequency.exponentialRampToValueAtTime(58, t + 0.25);
    this._mHit(grp, 'brown', t, 0.14 * vel, 0.002, 0.08, 'lowpass', 600, 0.7, dest);
  }

  _hat(t, vel, dest, metal) {
    const grp = this._grp();
    if (metal) this._mHit(grp, 'white', t, 0.06 * vel, 0.001, 0.045, 'bandpass', 6400, 5, dest);
    else this._mHit(grp, 'white', t, 0.045 * vel, 0.002, 0.035, 'highpass', 7200, 0.7, dest);
  }

  /** Wood block pitched to the chord. */
  _wood(t, vel, dest) {
    const tones = this._norm(this._chordTones);
    const f = mtof(this._L.root + 36 + pick([tones[0], tones[1], tones[2]]));
    const grp = this._grp();
    const env = this._mGain(grp, 0, dest);
    envPerc(env.gain, t, 0.07 * vel, 0.001, 0.06);
    this._mOsc(grp, 'sine', f, t, t + 0.1, env);
    this._mOsc(grp, 'triangle', f * 1.49, t, t + 0.1, this._mGain(grp, 0.3, env));
  }

  /** Glass-harmonica shimmer: slow-bloom sine + a slightly beating octave partial. */
  _shimmerNote(t, L, dest) {
    const tones = this._norm(this._chordTones);
    let midi = L.root + 36 + 12 * (L.shimmer.oct - 1) + pick([tones[1], tones[2], tones[3], tones[0] + 12]);
    if (L.drone && chance(0.3)) midi += 1; // eerie semitone rub in the boss layer
    const f = mtof(midi);
    const dur = rand(2.6, 4.2);
    const peak = 0.03 * rand(0.7, 1);
    const grp = this._grp();
    const pan = this._mPan(grp, rand(-0.7, 0.7), dest);
    const env = this._mGain(grp, 0, pan);
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(peak, t + 0.7);
    env.gain.exponentialRampToValueAtTime(EPS, t + dur);
    this._mOsc(grp, 'sine', f, t, t + dur + 0.05, env);
    this._mOsc(grp, 'sine', f * 2.003, t, t + dur + 0.05, this._mGain(grp, 0.22, env));
  }

  /** Play a pre-rendered reversed buffer so that its peak lands exactly on `end`. */
  _reverseSwell(t, end, midis, kind, dest, peak) {
    const buf = kind === 'bell' ? this._revBell : this._revPad;
    if (!buf || !dest) return;
    const ref = kind === 'bell' ? REV_BELL_MIDI : REV_PAD_MIDI;
    const now = this._ctx.currentTime;
    const grp = this._grp();
    const g = this._mGain(grp, peak, dest);
    for (const m of midis) {
      const rate = Math.pow(2, (m - ref) / 12);
      let start = Math.max(t, now + 0.01);
      let offset = buf.duration - (end - start) * rate;
      if (offset < 0) {
        start = end - buf.duration / rate;
        offset = 0;
      }
      if (end - start < 0.1) continue;
      const src = this._ctx.createBufferSource();
      src.buffer = buf;
      src.playbackRate.value = rate;
      src.connect(g);
      this._play(grp, src, start, end + 0.05, true, offset);
    }
    if (grp.live === 0) g.disconnect();
  }

  /** Lub-dub. */
  _heartbeat(t, w) {
    const grp = this._grp();
    for (const [dt, k] of [[0, 1], [0.17, 0.7]]) {
      const env = this._mGain(grp, 0, this._fxBus);
      envPerc(env.gain, t + dt, 0.5 * w * k, 0.004, 0.17);
      const o = this._mOsc(grp, 'sine', 64, t + dt, t + dt + 0.25, env, 0, false);
      o.frequency.setValueAtTime(64, t + dt);
      o.frequency.exponentialRampToValueAtTime(38, t + dt + 0.12);
      this._mHit(grp, 'brown', t + dt, 0.12 * w * k, 0.003, 0.06, 'lowpass', 220, 0.7, this._fxBus);
    }
  }

  /** Alarm-clock tick/tock; pitch and level rise as the dreamer wakes. */
  _clockTick(t, w, s) {
    const tock = s % 4 === 2;
    const f = (tock ? 1900 : 2600) * (1 + 0.35 * w);
    const grp = this._grp();
    this._mHit(grp, 'white', t, 0.05 + 0.1 * w, 0.0005, 0.025, 'bandpass', f, 6, this._fxBus);
    const env = this._mGain(grp, 0, this._fxBus);
    envPerc(env.gain, t, 0.015 + 0.03 * w, 0.0005, 0.03);
    this._mOsc(grp, 'sine', f * 0.5, t, t + 0.05, env, 0, false);
  }

  // ─── Melody & harmony helpers ──────────────────────────────────────────────

  /** Absolute scale index → MIDI in the current layer's key/mode. */
  _scaleMidi(n) {
    const L = this._L;
    return L.root + L.mode[mod(n, 7)] + 12 * Math.floor(n / 7);
  }

  /** Chord tone i (0..3, higher i wraps up octaves) around octave 5 of the layer, plus `oct` octaves. */
  _ct(i, oct = 0) {
    const tones = this._norm(this._chordTones);
    return this._L.root + 24 + tones[mod(i, 4)] + 12 * (Math.floor(i / 4) + oct);
  }

  /**
   * Next weapon note (absolute scale index). Properties land on their own scale
   * degree of the current chord (nearest octave to the previous note); plain
   * shots walk stepwise, favouring chord tones on strong 16ths and continuing
   * the current direction.
   */
  _melodyIndex(prop, strong) {
    const lo = 14;
    const hi = 27;
    const deg = this._chordDeg;
    const ring = this._ring;
    const last = ring.length ? ring[ring.length - 1] : lo + mod(deg, 7);
    let n;
    if (prop) {
      const r = mod(deg + PROPERTIES[prop].degree, 7);
      n = last - mod(last - r, 7);
      if (last - n > 3) n += 7;
      while (n < lo) n += 7;
      while (n > hi) n -= 7;
    } else {
      const steps = [-3, -2, -1, 0, 1, 2, 3];
      const base = [0.35, 1.2, 3, 0.5, 3, 1.2, 0.35];
      const ws = steps.map((st, i) => {
        const c = last + st;
        if (c < lo || c > hi) return 0;
        let w = base[i];
        if (st === 0 && ring.length >= 2 && ring[ring.length - 2] === last) w = 0;
        if (st * this._dir > 0) w *= 1.7;
        const r = mod(c - deg, 7);
        if (r === 0 || r === 2 || r === 4) w *= strong ? 3 : 1.5;
        return w;
      });
      const k = weightedIndex(ws);
      n = k < 0 ? lo + mod(deg, 7) : last + steps[k];
    }
    if (n !== last) this._dir = n > last ? 1 : -1;
    if (chance(0.1)) this._dir = -this._dir; // phrase turns
    ring.push(n);
    if (ring.length > 8) ring.shift();
    return n;
  }

  /** Next grid slot for quantized sfx. true → next 16th; 'loose' → now if the slot is > 70 ms away. */
  _slotTime(q) {
    const now = this._ctx.currentTime;
    if (!q) return { t: now, strong: false };
    const d = this._stepDur;
    const k = Math.floor((this._nextStep - (now + 0.004)) / d);
    if (k < 0 || d <= 0) return { t: now, strong: false };
    const t = this._nextStep - k * d;
    if (q === 'loose' && t - now > LOOSE_WINDOW) return { t: now, strong: false };
    return { t, strong: mod(this._step - k, 4) === 0 };
  }

  /** Time of the next grid boundary that is a multiple of `unit` steps (4 = beat, 16 = bar). */
  _gridTime(unit) {
    const now = this._ctx.currentTime + 0.01;
    const d = this._stepDur;
    let t = this._nextStep;
    let step = this._step;
    while (t - d > now && step > 0) { t -= d; step--; }
    while (t < now) { t += d; step++; }
    return t + mod(unit - mod(step, unit), unit) * d;
  }

  // ─── SFX infrastructure ────────────────────────────────────────────────────

  /** Cheap 3D: pan from the horizontal angle to the listener's right vector, plus distance rolloff. */
  _spatial(p) {
    const L = this._listener;
    const dx = num(p.x, L.px) - L.px;
    const dy = num(p.y, L.py) - L.py;
    const dz = num(p.z, L.pz) - L.pz;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    let fx = L.fx;
    let fz = L.fz;
    const fl = Math.hypot(fx, fz);
    if (fl < 1e-6) { fx = 0; fz = -1; } else { fx /= fl; fz /= fl; }
    const hl = Math.hypot(dx, dz);
    let pan = 0;
    let front = 1;
    if (hl > 1e-4) {
      pan = (dx * -fz + dz * fx) / hl; // right vector = forward × up
      front = (dx * fx + dz * fz) / hl;
    }
    pan *= 0.8 * clamp(dist / 2.5); // sources at the listener sit centred
    const REF = 4;
    const MAXD = 90;
    let gain = REF / (REF + 1.1 * Math.max(0, dist - REF));
    gain *= 1 - clamp((dist - MAXD * 0.7) / (MAXD * 0.3));
    if (front < 0) gain *= 1 + 0.2 * front; // slightly duller behind
    return { pan: clamp(pan, -1, 1), gain, dist };
  }

  /** Enforce per-name caps and the global cap (stealing the lowest-priority, oldest voice). */
  _allocVoice(name, lim, now) {
    let same = 0;
    let oldest = null;
    for (const v of this._voices) {
      if (v.dying || v.dead || v.name !== name) continue;
      same++;
      if (!oldest || v.born < oldest.born) oldest = v;
    }
    if (lim.max && same >= lim.max) {
      if (!oldest || now - oldest.born < 0.03) return false; // same-frame burst: drop the newcomer
      oldest.kill(now);
    }
    let alive = 0;
    let victim = null;
    for (const v of this._voices) {
      if (v.dying || v.dead) continue;
      alive++;
      if (!victim || v.prio < victim.prio || (v.prio === victim.prio && v.born < victim.born)) victim = v;
    }
    if (alive < MAX_VOICES) return true;
    if (!victim || victim.prio > lim.prio) return false;
    if (victim.prio === lim.prio && now - victim.born < 0.03) return false;
    victim.kill(now);
    return true;
  }

  _release(v) {
    const i = this._voices.indexOf(v);
    if (i >= 0) this._voices.splice(i, 1);
  }

  /** Safety net for voices whose `ended` events never arrived. */
  _sweepVoices(now) {
    for (const v of this._voices.slice()) {
      if (v.dead) this._release(v);
      else if (now > v.end + 2 || (v.dying && now > v.dieAt + 0.6)) v.free();
    }
  }

  /** A property's signature timbre at `midi`, inside voice v. */
  _propTone(v, prop, t, midi, peak = 0.2) {
    const P = PROPERTIES[prop];
    if (!P) return;
    const f = mtof(midi + 12 * P.oct);
    switch (prop) {
      case 'melting':
        v.tone('sine', f, t, peak, 0.006, 0.55, { to: f * 0.78, glide: 0.5 });
        v.tone('triangle', f * 2, t, peak * 0.2, 0.004, 0.2, { to: f * 1.5 });
        break;
      case 'floating': {
        const o = v.tone('triangle', f, t, peak, 0.04, 0.75);
        v.vib(o, 6.2, f * 0.025, t, 0.5, t + 0.85);
        v.noiseHit('pink', t, peak * 0.2, 0.08, 0.5, { type: 'highpass', f: 5000 });
        break;
      }
      case 'reflecting':
        v.fm(f, t, peak, 0.001, 0.9, { ratio: 3.5, index: 2.4 });
        v.tone('sine', f * 2.005, t, peak * 0.3, 0.001, 0.6);
        break;
      case 'burning': {
        const bp = v.f('bandpass', f * 2, 1.4);
        v.tone('sawtooth', f, t, peak * 1.1, 0.004, 0.32, { dest: bp });
        const times = [0, 0.04, 0.09, 0.15, 0.22].map((x) => t + x + rand(0, 0.02));
        v.pulses('white', times, times.map(() => peak * rand(0.4, 0.9)), 0.004, { f: 3500, Q: 1 });
        break;
      }
      case 'heavy': {
        const lp = v.f('lowpass', f * 3, 1.2);
        v.tone('square', f / 2, t, peak * 0.5, 0.004, 0.42, { dest: lp });
        v.tone('sine', f / 4, t, peak * 0.8, 0.004, 0.5);
        break;
      }
      case 'sleeping': {
        const lp = v.f('lowpass', f * 3, 0.8);
        lp.frequency.setValueAtTime(this._fq(f * 3), t);
        lp.frequency.exponentialRampToValueAtTime(this._fq(f * 0.9), t + 0.3);
        v.tone('triangle', f, t, peak * 1.1, 0.005, 0.38, { dest: lp });
        break;
      }
      case 'framed':
        v.fm(f, t, peak * 0.8, 0.002, 0.7, { ratio: 1.5, index: 1.8 });
        v.tone('sine', f * 1.5, t + 0.05, peak * 0.4, 0.004, 0.5);
        break;
      case 'multiplying':
        [0, 0.085, 0.17].forEach((dt, i) => v.tone('sine', f, t + dt, peak * [1, 0.55, 0.3][i], 0.002, 0.09));
        break;
      case 'hollow': {
        const bp = v.f('bandpass', f, 9);
        v.tone('square', f, t, peak * 1.6, 0.001, 0.12, { dest: bp });
        v.tone('sine', f * 2.4, t, peak * 0.25, 0.001, 0.05);
        break;
      }
      case 'bursting':
        v.noiseHit('white', t, peak * 0.8, 0.003, 0.16, { type: 'bandpass', f, to: f * 3.5, Q: 4 });
        v.tone('sine', f * 0.5, t, peak * 0.7, 0.002, 0.09, { to: f * 2 });
        break;
      default:
        break;
    }
  }
}

// ─── SFX library ─────────────────────────────────────────────────────────────
// Each entry: (engine, voice, startTime, x) where x = { g, prop, strong, pitch, n, m, dist }.
// x.m is the melody note for MELODIC sounds, else the current chord root (octave 5).
// Levels inside a definition are relative; the voice output carries gain × distance.

const times = (t, n, span, curve = 1) => Array.from({ length: n }, (_, i) => t + span * Math.pow(i / Math.max(1, n - 1), curve));

const SFX = {
  // ── Gun ────────────────────────────────────────────────────────────────────
  take(e, v, t, x) {
    // Inhaling reverse-suction: pink noise through a rising, narrowing band that swells then snaps shut.
    const T = 0.34;
    const env = v.g(0);
    env.gain.setValueAtTime(EPS, t);
    env.gain.exponentialRampToValueAtTime(0.55, t + T * 0.92);
    env.gain.linearRampToValueAtTime(0, t + T);
    const bp = v.f('bandpass', 350, 0.9, env);
    bp.frequency.setValueAtTime(350, t);
    bp.frequency.exponentialRampToValueAtTime(3800, t + T);
    bp.Q.setValueAtTime(0.9, t);
    bp.Q.linearRampToValueAtTime(4, t + T);
    v.noise('pink', t, t + T + 0.02, bp);
    const target = mtof(x.m - 12);
    v.tone('sine', target * 0.35, t, 0.12, T * 0.85, 0.06, { to: target, glide: T });
    if (x.prop) e._propTone(v, x.prop, t + T - 0.02, x.m, 0.2);
    else v.fm(mtof(x.m), t + T - 0.02, 0.08, 0.003, 0.35, { ratio: 3.5, index: 1.2 });
    v.send(0.18);
  },

  give(e, v, t, x) {
    // Exhale "thwip" + a chime in the property's timbre.
    v.noiseHit('white', t, 0.45, 0.004, 0.14, { type: 'bandpass', f: 3200, to: 700, Q: 1.2 });
    v.tone('sine', 1400, t, 0.18, 0.002, 0.07, { to: 380 });
    const tc = t + 0.045;
    if (x.prop) e._propTone(v, x.prop, tc, x.m, 0.28);
    else v.fm(mtof(x.m), tc, 0.12, 0.003, 0.6, { ratio: 3.5, index: 1.5 });
    v.send(0.25);
  },

  fire(e, v, t, x) {
    // Punchy soft-transient "pew" that settles onto the scale note, a felt thump and a click.
    const f = mtof(x.m);
    v.tone('triangle', f * 2.5, t, 0.3, 0.002, 0.16, { to: f, glide: 0.045 });
    v.tone('sine', f, t, 0.16, 0.004, 0.28);
    v.tone('sine', 150, t, 0.34, 0.002, 0.09, { to: 55 });
    v.noiseHit('white', t, 0.2, 0.0005, 0.012, { type: 'highpass', f: 3500 });
    if (x.prop) e._propTone(v, x.prop, t + 0.01, x.m, 0.1);
    v.send(0.12);
  },

  fireEmpty(e, v, t) {
    v.noiseHit('white', t, 0.5, 0.0005, 0.01, { type: 'bandpass', f: 3800, Q: 3 });
    v.noiseHit('white', t + 0.028, 0.3, 0.0005, 0.018, { type: 'bandpass', f: 2200, Q: 4 });
    v.tone('square', 2600, t, 0.035, 0.0005, 0.008);
  },

  reloadStart(e, v, t) {
    // Cylinder unlatch: click, metallic ring, clack.
    v.noiseHit('white', t, 0.35, 0.0005, 0.015, { type: 'bandpass', f: 2800, Q: 3 });
    v.fm(1850, t, 0.07, 0.001, 0.14, { ratio: 1.414, index: 2.2 });
    v.noiseHit('white', t + 0.075, 0.4, 0.0005, 0.03, { type: 'bandpass', f: 1300, Q: 6 });
    v.tone('sine', 420, t + 0.075, 0.12, 0.001, 0.05, { to: 260 });
  },

  reloadSpin(e, v, t) {
    // Ratcheting cylinder: clicks that decelerate over ~0.4 s, over a soft whir.
    const ts = [];
    let tt = t;
    let gap = 0.021;
    while (tt < t + 0.4 && ts.length < 16) { ts.push(tt); tt += gap; gap *= 1.09; }
    v.pulses('white', ts, ts.map((_, i) => 0.36 * (1 - i / 20)), 0.004, { f: 4200, Q: 4 });
    v.noiseHit('pink', t, 0.08, 0.08, 0.3, { type: 'bandpass', f: 800, to: 500, Q: 1.5 });
    v.fm(2400, t + 0.38, 0.03, 0.001, 0.12, { ratio: 1.41, index: 1 });
  },

  reloadEnd(e, v, t, x) {
    // Snap shut + a tiny chime on the chord.
    v.tone('sine', 210, t, 0.45, 0.001, 0.08, { to: 70 });
    v.noiseHit('white', t, 0.4, 0.0005, 0.02, { type: 'bandpass', f: 3000, Q: 2 });
    v.noiseHit('pink', t, 0.2, 0.001, 0.06, { type: 'lowpass', f: 900 });
    v.fm(mtof(x.m + 12), t + 0.06, 0.07, 0.002, 0.45, { ratio: 3.5, index: 1 });
    v.send(0.12);
  },

  swapProperty(e, v, t, x) {
    // Glass vial clink-clink with a small slosh.
    const f = x.prop ? mtof(e._ct(0, 0) + PROPERTIES[x.prop].degree + 24) : 2600;
    for (const [dt, pk] of [[0, 0.16], [0.055, 0.1]]) {
      v.fm(f, t + dt, pk, 0.001, 0.35, { ratio: 2.76, index: 0.8 });
      v.tone('sine', f * 1.5, t + dt, pk * 0.35, 0.001, 0.2);
    }
    v.noiseHit('pink', t, 0.06, 0.04, 0.14, { type: 'bandpass', f: 600, to: 900, Q: 2 });
    v.send(0.2);
  },

  infuse(e, v, t, x) {
    // Shimmering rising arpeggio (stacked scale thirds from the melody note) + air + swell.
    const steps = [0, 2, 4, 7, 9, 11];
    steps.forEach((k, i) => {
      const m = e._scaleMidi(x.n + k) + x.pitch;
      const tt = t + i * 0.05;
      if (x.prop) e._propTone(v, x.prop, tt, m, 0.11 * (1 - i * 0.08));
      else v.fm(mtof(m), tt, 0.09 * (1 - i * 0.08), 0.002, 0.6, { ratio: 3.5, index: 1.2 });
    });
    v.noiseHit('pink', t, 0.07, 0.25, 0.4, { type: 'highpass', f: 7000 });
    v.tone('sine', mtof(x.m - 12), t, 0.05, 0.3, 0.3, { to: mtof(x.m) });
    v.send(0.35);
  },

  // ── Movement ───────────────────────────────────────────────────────────────
  footstep(e, v, t) {
    // Soft sand crunch: a few noise grains in a randomized band + a tiny thump.
    const env = v.g(0);
    const bp = v.f('bandpass', v.hz(rand(800, 1500)), 0.9, env);
    let tt = t;
    env.gain.setValueAtTime(0, t);
    for (let i = 0; i < 3; i++) {
      env.gain.setValueAtTime(rand(0.15, 0.3), tt);
      env.gain.setTargetAtTime(0, tt + 0.002, rand(0.006, 0.012));
      tt += rand(0.012, 0.025);
    }
    v.noise(chance(0.5) ? 'white' : 'pink', t, tt + 0.08, bp, rand(0.8, 1.2) * v.rate);
    v.tone('sine', rand(95, 120), t, 0.12, 0.002, 0.05, { to: 55 });
  },

  jump(e, v, t) {
    v.noiseHit('pink', t, 0.25, 0.01, 0.16, { type: 'bandpass', f: 500, to: 1900, Q: 1.2 });
    v.tone('sine', 110, t, 0.18, 0.002, 0.06, { to: 70 });
    v.tone('sine', mtof(e._ct(0, -1)), t, 0.05, 0.01, 0.12, { to: mtof(e._ct(2, -1)) });
  },

  doubleJump(e, v, t) {
    // Airy flutter (wing-flaps of filtered noise) + a small bell.
    const flaps = times(t, 5, 0.22);
    v.pulses('pink', flaps, flaps.map((_, i) => 0.28 * (1 - i * 0.15)), 0.018, { f: 1400, Q: 1 });
    v.fm(mtof(e._ct(2, 1)), t + 0.02, 0.07, 0.002, 0.5, { ratio: 3.5, index: 1 });
    v.send(0.2);
  },

  land(e, v, t, x) {
    // Thud whose weight (depth + length) scales with gain.
    const w = clamp(x.g, 0.15, 2);
    v.tone('sine', 90 + 40 * w, t, 0.5, 0.002, 0.08 + 0.16 * w, { to: 38 });
    v.noiseHit('brown', t, 0.35, 0.002, 0.06 + 0.12 * w, { type: 'lowpass', f: 300 + 500 * w });
    v.noiseHit('white', t, 0.1, 0.001, 0.04, { type: 'bandpass', f: 1200, Q: 0.8 });
  },

  dash(e, v, t) {
    // Whoosh that passes across the stereo field.
    const T = 0.32;
    const p = v.pan(0.5);
    p.pan?.setValueAtTime(0.5, t);
    p.pan?.linearRampToValueAtTime(-0.5, t + T);
    const bp = v.noiseHit('pink', t, 0.5, 0.05, T, { type: 'bandpass', f: 500, to: 2600, Q: 1.3, glide: T * 0.45, dest: p });
    bp.frequency.exponentialRampToValueAtTime(v.hz(700), t + T);
    v.tone('sine', 180, t, 0.08, 0.02, 0.2, { to: 90, dest: p });
  },

  slide(e, v, t) {
    // Sustained sand scrape (~0.6 s) with a gritty tremolo.
    const T = 0.6;
    const env = v.g(0);
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(0.35, t + 0.04);
    env.gain.setValueAtTime(0.3, t + T - 0.15);
    env.gain.linearRampToValueAtTime(0, t + T);
    const bp = v.f('bandpass', v.hz(1600), 0.7, env);
    const grit = v.g(0.6, bp);
    const lfo = v.g(0.4, grit.gain);
    v.osc('square', rand(24, 32), t, t + T + 0.02, lfo);
    v.noise('white', t, t + T + 0.02, grit, v.rate);
    const body = v.g(0);
    body.gain.setValueAtTime(0, t);
    body.gain.linearRampToValueAtTime(0.3, t + 0.05);
    body.gain.linearRampToValueAtTime(0, t + T);
    v.noise('brown', t, t + T + 0.02, v.f('lowpass', 500, 0.7, body));
  },

  wallrun(e, v, t) {
    for (const dt of [0, 0.065]) {
      v.noiseHit('white', t + dt, 0.22, 0.001, 0.03, { type: 'bandpass', f: rand(900, 1500), Q: 1.4 });
      v.tone('sine', rand(150, 190), t + dt, 0.14, 0.001, 0.04, { to: 80 });
    }
  },

  wallJump(e, v, t) {
    v.tone('sine', 160, t, 0.35, 0.001, 0.08, { to: 60 });
    v.noiseHit('white', t, 0.2, 0.001, 0.04, { type: 'bandpass', f: 1100, Q: 1 });
    v.noiseHit('pink', t, 0.25, 0.03, 0.22, { type: 'bandpass', f: 600, to: 2400, Q: 1.5 });
    v.fm(mtof(e._ct(1, 1)), t + 0.03, 0.05, 0.002, 0.35, { ratio: 3.5, index: 1 });
  },

  mantle(e, v, t) {
    // Cloth rustle + a thump as you pull up.
    const rs = times(t, 7, 0.22).map((x) => x + rand(0, 0.015));
    v.pulses('pink', rs, rs.map(() => rand(0.08, 0.2)), 0.02, { f: 2300, Q: 0.6 });
    v.tone('sine', 120, t + 0.2, 0.32, 0.002, 0.1, { to: 55 });
    v.noiseHit('brown', t + 0.2, 0.25, 0.002, 0.08, { type: 'lowpass', f: 400 });
  },

  grindStart(e, v, t) {
    v.noiseHit('white', t, 0.3, 0.01, 0.4, { type: 'bandpass', f: 5200, to: 3800, Q: 2.5 });
    v.fm(1230, t, 0.08, 0.002, 0.5, { ratio: 1.41, index: 3 });
    v.fm(1830, t + 0.01, 0.05, 0.002, 0.35, { ratio: 1.33, index: 2 });
    const sp = times(t, 6, 0.3).map((x) => x + rand(0, 0.03));
    v.pulses('white', sp, sp.map(() => rand(0.1, 0.25)), 0.003, { type: 'highpass', f: 6000, Q: 0.7 });
  },

  grind(e, v, t) {
    // Very cheap: one noise grain through a resonant high band.
    v.noiseHit('white', t, 0.3, 0.002, 0.035, { type: 'bandpass', f: rand(5200, 6800), Q: 2 });
  },

  grindEnd(e, v, t) {
    v.noiseHit('white', t, 0.25, 0.005, 0.25, { type: 'bandpass', f: 5000, to: 1500, Q: 2 });
    v.fm(2400, t + 0.02, 0.06, 0.001, 0.2, { ratio: 1.41, index: 1.5 });
  },

  groundPound(e, v, t, x) {
    const w = clamp(x.g, 0.5, 2);
    const sat = v.shaper(v.g(0.8));
    v.tone('sine', 75, t, 0.8, 0.003, 0.7 + 0.2 * w, { to: 28, glide: 0.7, dest: sat });
    v.tone('triangle', 50, t, 0.3, 0.003, 0.6, { to: 30 });
    v.noiseHit('pink', t, 0.35, 0.01, 0.3, { type: 'bandpass', f: 1800, to: 250, Q: 1 });
    v.noiseHit('white', t, 0.3, 0.001, 0.08, { type: 'lowpass', f: 2500 });
    v.noiseHit('brown', t + 0.05, 0.2, 0.05, 0.9, { type: 'lowpass', f: 400 });
    v.send(0.3);
  },

  bounce(e, v, t) {
    // Boing: springy pitch overshoot with a decaying wobble, plus a twang.
    const f = mtof(e._ct(0, -1));
    const o = v.tone('sine', f * 0.6, t, 0.35, 0.005, 0.45);
    o.frequency.setValueAtTime(v.hz(f * 0.6), t);
    o.frequency.exponentialRampToValueAtTime(v.hz(f * 1.6), t + 0.08);
    o.frequency.exponentialRampToValueAtTime(v.hz(f * 1.25), t + 0.4);
    const vg = v.g(0, o.frequency);
    vg.gain.setValueAtTime(f * 0.15, t + 0.05);
    vg.gain.exponentialRampToValueAtTime(1, t + 0.45);
    v.osc('sine', 14, t, t + 0.48, vg);
    v.tone('triangle', f * 2, t, 0.08, 0.002, 0.2, { to: f * 2.4 });
    v.tone('sine', 120, t, 0.25, 0.002, 0.08, { to: 60 });
  },

  // ── Combat & world ─────────────────────────────────────────────────────────
  explosion(e, v, t, x) {
    // Low boom (saturated) + sub, noise crack, debris rumble tail and scattered crackles; scales with gain.
    const w = clamp(x.g, 0.3, 2);
    const L = 0.9 + 0.8 * w;
    const sat = v.shaper(v.g(0.7));
    v.tone('sine', 95, t, 0.9, 0.002, 0.9 * L, { to: 30, glide: 0.8 * L, dest: sat });
    v.tone('sine', 48, t, 0.5, 0.004, L, { to: 26 });
    v.noiseHit('white', t, 0.7, 0.001, 0.28, { type: 'bandpass', f: 2400, to: 500, Q: 0.7 });
    v.noiseHit('brown', t, 0.45, 0.05, 1.8 * L, { type: 'lowpass', f: 500 + 200 * w, to: 110, Q: 0.8 });
    const n = Math.round(6 + 4 * w);
    const cr = Array.from({ length: n }, () => t + rand(0.08, 0.7 + 0.6 * w)).sort((a, b) => a - b);
    v.pulses('white', cr, cr.map(() => rand(0.08, 0.25)), 0.008, { f: 2000, Q: 1.5 });
    v.send(0.35 + 0.1 * w);
  },

  shatter(e, v, t) {
    // Stucco/stone: crunchy staggered bursts, a low crunch, a clatter tail.
    for (let i = 0; i < 4; i++) {
      v.noiseHit('white', t + rand(0, 0.06), rand(0.25, 0.45), 0.001, rand(0.02, 0.05), { type: 'bandpass', f: rand(900, 3200), Q: 1.5 });
    }
    v.tone('sine', 160, t, 0.35, 0.002, 0.1, { to: 60 });
    const ts = [];
    let tt = t + 0.05;
    for (let i = 0; i < 11; i++) { ts.push(tt); tt += 0.02 + i * i * 0.004 + rand(0, 0.02); }
    v.pulses('white', ts, ts.map((_, i) => 0.3 * (1 - i / 13)), 0.006, { f: 3500, Q: 3 });
    v.send(0.2);
  },

  woodBreak(e, v, t) {
    v.noiseHit('white', t, 0.5, 0.001, 0.04, { type: 'bandpass', f: 1600, Q: 1.8 });
    for (const f of [210, 340, 520]) {
      const r = f * rand(0.9, 1.1);
      v.tone('triangle', r, t, 0.16, 0.001, 0.12, { to: r * 0.92 });
    }
    const sp = times(t + 0.03, 7, 0.3, 1.4).map((x) => x + rand(0, 0.02));
    v.pulses('white', sp, sp.map(() => rand(0.1, 0.3)), 0.006, { f: 2500, Q: 2 });
    v.send(0.15);
  },

  debris(e, v, t) {
    // Very cheap: one randomized chunk impact.
    const tt = t + rand(0, 0.012);
    v.noiseHit(chance(0.5) ? 'white' : 'pink', tt, rand(0.5, 0.9), 0.001, rand(0.015, 0.05), { type: 'bandpass', f: rand(700, 3000), Q: 1.2 });
    if (chance(0.3)) v.tone('sine', rand(120, 220), tt, 0.12, 0.001, 0.04, { to: 70 });
  },

  hit(e, v, t) {
    // Player hurt: muffled thump + a dissonant (m2 + tritone) chord blip that sags.
    v.tone('sine', 130, t, 0.6, 0.002, 0.2, { to: 45 });
    v.noiseHit('brown', t, 0.3, 0.002, 0.08, { type: 'lowpass', f: 350 });
    const r = e._ct(0, -1);
    const lp = v.f('lowpass', 1400, 0.7);
    for (const iv of [0, 1, 6]) {
      const f = mtof(r + iv);
      v.tone('sawtooth', f, t + 0.01, 0.06, 0.005, 0.28, { to: f * 0.94, detune: rand(-8, 8), dest: lp });
    }
  },

  enemyHit(e, v, t) {
    // Ceramic tick.
    v.fm(rand(2800, 3600), t, 0.18, 0.0008, 0.07, { ratio: 2.41, index: 1.5 });
    v.noiseHit('white', t, 0.15, 0.0005, 0.01, { type: 'highpass', f: 4000 });
  },

  enemyDie(e, v, t) {
    // Porcelain crack + ring, then a sigh-like downward glide through a vowel formant.
    v.noiseHit('white', t, 0.4, 0.0005, 0.03, { type: 'bandpass', f: 4200, Q: 2 });
    v.noiseHit('white', t + 0.02, 0.3, 0.0005, 0.04, { type: 'bandpass', f: 2600, Q: 2 });
    const r = rand(0.92, 1.08);
    for (const [f, d] of [[2150, 0.4], [3310, 0.3], [4730, 0.22]]) v.tone('sine', f * r, t, 0.05, 0.001, d);
    const formant = v.f('bandpass', 900, 4);
    formant.frequency.setValueAtTime(900, t + 0.06);
    formant.frequency.exponentialRampToValueAtTime(420, t + 0.9);
    v.tone('sawtooth', 520, t + 0.06, 0.16, 0.08, 0.8, { to: 170, glide: 0.85, dest: formant });
    v.noiseHit('pink', t + 0.06, 0.08, 0.1, 0.6, { type: 'bandpass', f: 1200, to: 500, Q: 1 });
    v.send(0.3);
  },

  enemyShoot(e, v, t) {
    // Eerie tritone "fwoop", distinct from the player's shot.
    const f = mtof(e._ct(0, 0) + 6);
    const lp = v.f('lowpass', 2200, 1);
    v.tone('square', f * 2, t, 0.12, 0.002, 0.14, { to: f * 0.7, dest: lp });
    v.tone('sine', f / 2, t, 0.1, 0.004, 0.2, { to: f * 0.4 });
    v.noiseHit('pink', t, 0.18, 0.002, 0.08, { type: 'bandpass', f: 1500, to: 600, Q: 1.2 });
    v.send(0.1);
  },

  bossHit(e, v, t) {
    // Deep resonant gong (inharmonic partials) + a flesh squish.
    const f0 = mtof(e._ct(0, -3));
    v.fm(f0, t, 0.5, 0.004, 2.4, { ratio: 1.47, index: 2.5 });
    v.tone('sine', f0 * 2.76, t, 0.12, 0.004, 1.6);
    v.tone('sine', f0 * 5.4, t, 0.06, 0.004, 0.9);
    v.noiseHit('brown', t, 0.4, 0.002, 0.15, { type: 'lowpass', f: 800 });
    v.noiseHit('pink', t, 0.35, 0.01, 0.22, { type: 'bandpass', f: 900, to: 280, Q: 3 });
    const o = v.tone('sine', 180, t, 0.15, 0.005, 0.2, { to: 90 });
    v.vib(o, 30, 25, t, 0.05, t + 0.25);
    v.send(0.4);
  },

  bossRoar(e, v, t) {
    // ~1.5 s low, detuned, groaning drone with a moving vowel formant and growl AM.
    const f0 = mtof(LAYERS[2].root - 12);
    const T = 1.5;
    const env = v.g(0);
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(0.45, t + 0.25);
    env.gain.setValueAtTime(0.45, t + 1.0);
    env.gain.exponentialRampToValueAtTime(EPS, t + T);
    const growl = v.g(0.65, env);
    const am = v.g(0.35, growl.gain);
    v.osc('sine', 26, t, t + T + 0.05, am);
    const lp = v.f('lowpass', 1200, 0.7, growl);
    const formant = v.f('bandpass', 320, 5, lp);
    formant.frequency.setValueAtTime(320, t);
    formant.frequency.linearRampToValueAtTime(720, t + 0.6);
    formant.frequency.linearRampToValueAtTime(380, t + T);
    const sat = v.shaper(formant);
    for (const dc of [-14, 0, 11]) {
      const o = v.osc('sawtooth', v.hz(f0 * 1.05), t, t + T + 0.05, sat);
      o.detune.value = dc;
      o.frequency.setValueAtTime(v.hz(f0 * 1.05), t);
      o.frequency.exponentialRampToValueAtTime(v.hz(f0 * 0.82), t + T);
    }
    v.noiseHit('pink', t, 0.12, 0.2, 1.2, { type: 'bandpass', f: 500, Q: 1 });
    v.tone('sine', f0 / 2, t, 0.3, 0.2, 1.2, { to: f0 * 0.4 });
    v.send(0.4);
  },

  burn(e, v, t) {
    const cr = Array.from({ length: 10 }, () => t + rand(0, 0.3)).sort((a, b) => a - b);
    v.pulses('white', cr, cr.map(() => rand(0.1, 0.35)), 0.003, { f: 3000, Q: 1 });
    v.noiseHit('pink', t, 0.08, 0.02, 0.3, { type: 'highpass', f: 2000 });
    v.noiseHit('brown', t, 0.15, 0.03, 0.2, { type: 'lowpass', f: 300 });
  },

  melt(e, v, t) {
    // Gloopy downward slide with a wobble, and a few bubble blips.
    const lp = v.f('lowpass', 900, 1.5);
    const o = v.tone('triangle', 720, t, 0.28, 0.02, 0.7, { to: 160, glide: 0.65, dest: lp });
    v.vib(o, 7, 18, t, 0.2, t + 0.75);
    for (const dt of [0.15, 0.3, 0.45]) v.tone('sine', 300 * rand(0.9, 1.2), t + dt, 0.08, 0.004, 0.05, { to: 600 });
    v.send(0.15);
  },

  float(e, v, t) {
    v.noiseHit('pink', t, 0.14, 0.3, 0.6, { type: 'bandpass', f: 1200, to: 4000, Q: 2 });
    [1, 2, 3].forEach((k, i) => {
      const f = mtof(e._ct(k, 0));
      const o = v.tone('sine', f, t + i * 0.07, 0.06, 0.2, 0.7, { to: f * 1.12 });
      v.vib(o, 5.5, f * 0.01, t, 0.3, t + 1);
    });
    v.send(0.45);
  },

  reflect(e, v, t) {
    const f = mtof(e._ct(pick([1, 2, 3]), 1));
    v.fm(f, t, 0.2, 0.001, 0.9, { ratio: 3.5, index: 2.2 });
    v.tone('sine', f * 2.01, t, 0.06, 0.001, 0.6);
    v.noiseHit('white', t, 0.08, 0.0005, 0.006, { type: 'highpass', f: 6000 });
    v.send(0.35);
  },

  sleep(e, v, t) {
    // Yawn: a saw through a rising-then-closing vowel formant, plus a faint lullaby bell.
    const env = v.g(0);
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(0.18, t + 0.3);
    env.gain.setValueAtTime(0.18, t + 0.6);
    env.gain.exponentialRampToValueAtTime(EPS, t + 1.1);
    const lp = v.f('lowpass', 2000, 0.7, env);
    const formant = v.f('bandpass', 450, 3, lp);
    formant.frequency.setValueAtTime(450, t);
    formant.frequency.linearRampToValueAtTime(1100, t + 0.4);
    formant.frequency.linearRampToValueAtTime(380, t + 1.1);
    const o = v.osc('sawtooth', v.hz(200), t, t + 1.15, formant);
    o.frequency.setValueAtTime(v.hz(200), t);
    o.frequency.exponentialRampToValueAtTime(v.hz(150), t + 1.1);
    v.vib(o, 5, 4, t, 0.4, t + 1.15);
    v.fm(mtof(e._ct(2, 1)), t + 0.5, 0.04, 0.01, 0.9, { ratio: 2, index: 0.6 });
    v.send(0.3);
  },

  multiply(e, v, t) {
    // Quick 3-note blip up the chord, echoed.
    const lp = v.f('lowpass', 2500, 0.8);
    [0, 1, 2].forEach((k, i) => {
      const f = mtof(e._ct(k, 0));
      v.tone('square', f, t + i * 0.07, 0.07, 0.002, 0.06, { dest: lp });
      v.tone('square', f, t + i * 0.07 + 0.18, 0.03, 0.002, 0.06, { dest: lp });
    });
  },

  hollow(e, v, t) {
    // Thin hollow wooden knock with a cavity resonance.
    const f = mtof(e._ct(0, 0));
    const bp = v.f('bandpass', v.hz(f), 12);
    v.tone('square', f, t, 0.5, 0.0008, 0.06, { dest: bp });
    v.tone('sine', f * 2.3, t, 0.1, 0.0005, 0.03);
    v.tone('sine', f * 0.5, t, 0.08, 0.002, 0.15);
    v.noiseHit('white', t, 0.12, 0.0005, 0.008, { type: 'bandpass', f: 2500, Q: 2 });
  },

  burst(e, v, t) {
    // Fuse fizz (~0.5 s): fluttering high noise that intensifies, a rising whine, sparks.
    const T = 0.5;
    const env = v.g(0);
    env.gain.setValueAtTime(0, t);
    for (let tt = t; tt < t + T; tt += 0.012) env.gain.setValueAtTime(rand(0.3, 1) * (0.08 + 0.22 * ((tt - t) / T)), tt);
    env.gain.setValueAtTime(0, t + T);
    v.noise('white', t, t + T + 0.02, v.f('highpass', v.hz(3500), 0.7, env), v.rate);
    v.tone('sine', 900, t, 0.04, 0.3, 0.2, { to: 1800, glide: T });
    const sp = Array.from({ length: 6 }, () => t + rand(0, T)).sort((a, b) => a - b);
    v.pulses('white', sp, sp.map(() => rand(0.1, 0.25)), 0.003, { f: 5000, Q: 2 });
  },

  heavy(e, v, t) {
    // Deep metallic clang.
    const f0 = mtof(e._ct(0, -2));
    v.fm(f0, t, 0.4, 0.002, 1.2, { ratio: 1.41, index: 3.5 });
    v.fm(f0 * 2.63, t, 0.15, 0.002, 0.7, { ratio: 1.73, index: 1.5 });
    v.noiseHit('white', t, 0.3, 0.0005, 0.03, { type: 'bandpass', f: 1800, Q: 1 });
    v.tone('sine', 70, t, 0.4, 0.002, 0.3, { to: 45 });
    v.send(0.3);
  },


  // ── Combat v2 ──────────────────────────────────────────────────────────────
  slash(e, v, t) {
    // Blade whoosh: band-passed noise sweeping down + a thin metallic swish.
    v.noiseHit('pink', t, 0.5, 0.01, 0.16, { type: 'bandpass', f: 4200, to: 900, Q: 1.4 });
    v.noiseHit('white', t + 0.02, 0.18, 0.004, 0.08, { type: 'highpass', f: 6000 });
    v.fm(rand(2400, 2900), t + 0.03, 0.04, 0.002, 0.18, { ratio: 1.41, index: 0.8 });
  },
  slashHit(e, v, t) {
    // Meaty porcelain thunk.
    v.tone('sine', 190, t, 0.5, 0.002, 0.12, { to: 70 });
    v.noiseHit('brown', t, 0.4, 0.001, 0.07, { type: 'lowpass', f: 1200 });
    v.fm(rand(3000, 3800), t, 0.14, 0.0008, 0.09, { ratio: 2.41, index: 1.4 });
  },
  deflect(e, v, t) {
    // The clang: bright inharmonic ring + spark crackle, pitched to the chord.
    const f = mtof(e._ct(0, 1) + 12);
    v.fm(f, t, 0.5, 0.0005, 1.1, { ratio: 2.76, index: 3.2 });
    v.fm(f * 1.5, t, 0.22, 0.0005, 0.8, { ratio: 3.9, index: 2 });
    v.tone('sine', f * 4.2, t, 0.08, 0.0005, 0.4);
    v.noiseHit('white', t, 0.5, 0.0003, 0.05, { type: 'highpass', f: 5000 });
    const times2 = [0.01, 0.03, 0.05, 0.08].map((x) => t + x);
    v.pulses('white', times2, times2.map(() => rand(0.1, 0.25)), 0.004, { f: 7000, Q: 2 });
    v.send(0.35);
  },
  guardHit(e, v, t) {
    // Blocked, not deflected: duller clank.
    v.fm(rand(700, 900), t, 0.3, 0.001, 0.25, { ratio: 1.9, index: 2 });
    v.noiseHit('pink', t, 0.35, 0.001, 0.08, { type: 'bandpass', f: 1500, Q: 1 });
    v.tone('sine', 110, t, 0.3, 0.002, 0.1, { to: 60 });
  },
  posture(e, v, t) {
    // Posture broken: a struck gong with a falling tail.
    const f0 = mtof(e._ct(0, -1));
    v.fm(f0, t, 0.5, 0.002, 2.0, { ratio: 1.4, index: 3 });
    v.tone('sine', f0 * 2.02, t, 0.2, 0.002, 1.4, { to: f0 * 1.9 });
    v.noiseHit('white', t, 0.3, 0.001, 0.2, { type: 'bandpass', f: 3000, to: 900, Q: 2 });
    v.send(0.45);
  },
  perilous(e, v, t) {
    // Warning: a low minor-second stab and a high bell.
    const r = e._ct(0, -2);
    for (const iv of [0, 1]) v.tone('sawtooth', mtof(r + iv), t, 0.12, 0.004, 0.35, { dest: v.f('lowpass', 900, 1) });
    v.fm(mtof(r + 36), t, 0.12, 0.001, 0.5, { ratio: 3.5, index: 2 });
  },
  deathblow(e, v, t) {
    // Heavy impact, a rip, and a deep boom with a bright chord bloom.
    v.tone('sine', 110, t, 0.9, 0.002, 0.35, { to: 38 });
    v.noiseHit('brown', t, 0.7, 0.002, 0.3, { type: 'lowpass', f: 700 });
    v.noiseHit('white', t + 0.12, 0.35, 0.02, 0.18, { type: 'bandpass', f: 2500, to: 600, Q: 1.5 });
    const r = e._ct(0, 0);
    [0, 7, 12, 16].forEach((iv, i) => v.fm(mtof(r + iv + 12), t + 0.2 + i * 0.03, 0.08, 0.004, 1.2, { ratio: 2, index: 1 }));
    v.send(0.5);
  },
  pogo(e, v, t) {
    // Springy clink off something's head.
    v.fm(1800, t, 0.25, 0.0008, 0.18, { ratio: 1.5, index: 2 });
    v.tone('triangle', 420, t, 0.2, 0.002, 0.18, { to: 900 });
  },
  focus(e, v, t) {
    // Breath-like swell resolving into a warm chord.
    v.noiseHit('pink', t, 0.25, 0.5, 0.4, { type: 'bandpass', f: 600, to: 1800, Q: 1 });
    const r = e._ct(0, 0);
    [0, 4, 7, 11].forEach((iv, i) => v.tone('sine', mtof(r + iv + 12), t + 0.5 + i * 0.05, 0.08, 0.02, 1.2));
    v.send(0.5);
  },
  lore(e, v, t) {
    // A page turned + a music-box figure.
    v.noiseHit('pink', t, 0.3, 0.01, 0.12, { type: 'highpass', f: 2500 });
    const r = e._ct(0, 1);
    [0, 7, 4, 12, 11].forEach((iv, i) => v.fm(mtof(r + iv + 12), t + 0.1 + i * 0.13, 0.08, 0.002, 0.6, { ratio: 3, index: 1.2 }));
    v.send(0.4);
  },
  babble(e, v, t, x) {
    // The Night-Light's voice: a tiny formant syllable (pitch via opts.pitch).
    const f = 520 * Math.pow(2, x.pitch / 12) * rand(0.94, 1.06);
    const bp = v.f('bandpass', rand(900, 1600), 3);
    v.tone('triangle', f, t, 0.12, 0.006, 0.07, { to: f * rand(0.9, 1.1), dest: bp });
    v.tone('sine', f * 2, t, 0.03, 0.004, 0.05);
  },
  portal(e, v, t) {
    // Passing through a frame: a rushing whoosh with a glass shimmer.
    v.noiseHit('pink', t, 0.5, 0.02, 0.4, { type: 'bandpass', f: 400, to: 3000, Q: 1 });
    v.fm(mtof(e._ct(0, 1) + 24), t + 0.05, 0.08, 0.004, 0.8, { ratio: 1.5, index: 2 });
    v.send(0.4);
  },

  pickup(e, v, t) {
    [0, 1, 2, 4].forEach((k, i) => {
      const f = mtof(e._ct(k, 1));
      const d = i === 3 ? 0.5 : 0.15;
      v.tone('triangle', f, t + i * 0.055, 0.12, 0.002, d);
      v.tone('sine', f * 2, t + i * 0.055, 0.04, 0.002, d * 0.6);
    });
    v.noiseHit('pink', t + 0.15, 0.05, 0.05, 0.3, { type: 'highpass', f: 7000 });
    v.send(0.25);
  },

  // ── UI ─────────────────────────────────────────────────────────────────────
  uiSelect(e, v, t) {
    v.tone('triangle', mtof(e._ct(2, 0)), t, 0.1, 0.002, 0.1);
    v.tone('triangle', mtof(e._ct(4, 0)), t + 0.05, 0.1, 0.002, 0.18);
  },

  uiBack(e, v, t) {
    v.tone('triangle', mtof(e._ct(2, 0)), t, 0.09, 0.002, 0.1);
    v.tone('triangle', mtof(e._ct(0, 0)), t + 0.05, 0.09, 0.002, 0.16);
  },

  uiHover(e, v, t) {
    v.tone('sine', mtof(e._ct(1, 1)), t, 0.04, 0.001, 0.025);
  },
};

// ─── Stingers ────────────────────────────────────────────────────────────────
// (engine, voice, t) with t already on the grid. Routed to the stinger bus
// (music volume, pause duck and music reverb, but not the lucidity warp).

const STINGERS = {
  /** Layer transition: a falling harp glissando, a long glide into the depths and a whoosh (~3 s). */
  descend(e, v, t) {
    const p = v.pan(0.6);
    p.pan?.setValueAtTime(0.6, t);
    p.pan?.linearRampToValueAtTime(-0.6, t + 1.3);
    let tt = t;
    for (let i = 0; i < 17; i++) {
      const f = mtof(e._scaleMidi(24 - i));
      v.tone('triangle', f, tt, 0.07 * (1 - i / 26), 0.002, 0.9, { dest: p });
      v.tone('sine', f * 2, tt, 0.02, 0.002, 0.5, { dest: p });
      tt += lerp(0.085, 0.05, i / 16);
    }
    const lp = v.f('lowpass', 1800, 0.5);
    v.tone('sine', 1100, t, 0.08, 0.4, 2.4, { to: 70, glide: 2.8, dest: lp });
    v.tone('triangle', 550, t + 0.1, 0.05, 0.5, 2.2, { to: 45, glide: 2.7, dest: lp });
    v.noiseHit('pink', t, 0.3, 0.9, 2.0, { type: 'bandpass', f: 3500, to: 180, Q: 1.4, glide: 2.9 });
    v.tone('sine', 95, t + 1.0, 0.35, 0.3, 1.8, { to: 32, glide: 2.0 });
    e._dipMusic(t, 0.45, 2.8);
  },

  /** The dreamer wakes: an alarm bell that dissolves into a bright major chord while the world fades. */
  wake(e, v, t) {
    const env = v.g(0);
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(0.2, t + 0.02);
    env.gain.setValueAtTime(0.2, t + 1.0);
    env.gain.linearRampToValueAtTime(0, t + 2.6);
    const lp = v.f('lowpass', 9000, 0.8, env);
    lp.frequency.setValueAtTime(9000, t + 0.9);
    lp.frequency.exponentialRampToValueAtTime(500, t + 2.6);
    // Hammer: an inverted sawtooth LFO gives strike-then-decay amplitude at ~15 Hz.
    const ring = v.g(0.5, lp);
    const hammer = v.g(-0.5, ring.gain);
    v.osc('sawtooth', 15, t, t + 2.7, hammer);
    for (const [f, r] of [[2093, 1.41], [2637, 1.33]]) {
      const car = v.osc('sine', f, t, t + 2.7, ring);
      car.detune.setValueAtTime(0, t + 0.9);
      car.detune.linearRampToValueAtTime(-500, t + 2.6);
      const idx = v.g(f * 1.2, car.frequency);
      v.osc('sine', f * r, t, t + 2.7, idx);
    }
    // Bright major (maj9) on the dream's tonic — a Picardy sunrise.
    const R = e._L.root + 12;
    const chord = [0, 4, 7, 11, 14, 19].map((x) => R + x);
    const tc = t + 1.1;
    const pad = v.g(0);
    pad.gain.setValueAtTime(0, tc);
    pad.gain.linearRampToValueAtTime(0.07, tc + 1.4);
    pad.gain.setValueAtTime(0.07, tc + 4);
    pad.gain.exponentialRampToValueAtTime(EPS, tc + 7.5);
    const plp = v.f('lowpass', 3500, 0.6, pad);
    for (const m of chord) {
      v.osc('triangle', mtof(m), tc, tc + 7.6, plp).detune.value = rand(-6, 6);
      v.osc('sine', mtof(m + 12), tc, tc + 7.6, plp);
    }
    chord.forEach((m, i) => v.fm(mtof(m + 12), tc + 0.25 + i * 0.12, 0.05, 0.002, 2.5, { ratio: 3.5, index: 1.2 }));
    v.noiseHit('pink', tc, 0.05, 1.2, 3, { type: 'highpass', f: 6000 });
    e._fadeWorld(tc, 3.5);
  },

  /** Boss entrance: taiko hits under a swelling dissonant brass cluster, cut by a gong + boom. */
  bossIntro(e, v, t) {
    const beat = e._stepDur * 4;
    const r = LAYERS[2].root - 12;
    const tf = t + 4 * beat;
    for (const b of [0, 1.5, 2, 3]) {
      const th = t + b * beat;
      v.tone('sine', 110, th, 0.5, 0.003, 0.5, { to: 48, glide: 0.2 });
      v.noiseHit('brown', th, 0.35, 0.002, 0.18, { type: 'lowpass', f: 700 });
    }
    const env = v.g(0);
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(0.1, tf - 0.05);
    env.gain.linearRampToValueAtTime(0, tf + 0.02);
    const sat = v.shaper(env);
    const lp = v.f('lowpass', 250, 2, sat);
    lp.frequency.setValueAtTime(250, t);
    lp.frequency.exponentialRampToValueAtTime(3200, tf);
    for (const [iv, dc] of [[0, -8], [1, 6], [6, -4], [12, 9], [13, -11]]) {
      v.osc('sawtooth', mtof(r + 12 + iv), t, tf + 0.1, lp).detune.value = dc;
    }
    v.fm(mtof(r), tf, 0.4, 0.004, 3.2, { ratio: 1.47, index: 3 });
    v.tone('sine', mtof(r) * 2.76, tf, 0.12, 0.004, 2.2);
    v.tone('sine', 70, tf, 0.7, 0.003, 1.4, { to: 30 });
    v.noiseHit('white', tf, 0.3, 0.002, 0.4, { type: 'bandpass', f: 1500, to: 300, Q: 0.7 });
  },

  /** A memory unlocked: a gentle music-box motif with a dotted echo. */
  memory(e, v, t) {
    const beat = e._stepDur * 4;
    const st = beat / 2;
    const deg = e._chordDeg;
    const motif = [4, 2, 0, 2, 4, 7, 6, 4];
    const mix = v.g(1);
    mix.connect(v.delay(st * 1.5, 0.35, 0.4));
    motif.forEach((k, i) => {
      const last = i === motif.length - 1;
      const f = mtof(e._scaleMidi(14 + deg + k));
      const tt = t + i * st + (last ? st * 0.25 : 0);
      v.fm(f, tt, 0.09, 0.002, last ? 2.4 : 1.2, { ratio: 3.5, index: 1.1, dest: mix });
      v.tone('sine', f * 4.02, tt, 0.012, 0.001, 0.15, { dest: mix });
    });
    v.tone('sine', mtof(e._ct(0, -2)), t, 0.05, 0.8, 2.5);
    v.keep(t + motif.length * st + 4);
  },

  /** The meter crosses 75 %: a reversed swell into a wobbling tritone chime, clock ticks, a heartbeat. */
  lucidityWarn(e, v, t) {
    const beat = e._stepDur * 4;
    const r = e._ct(0, 0);
    const now = e._ctx.currentTime;
    e._reverseSwell(Math.max(now + 0.02, t - 0.9), t, [r + 6], 'bell', e._stingerBus, 0.25);
    const wob = v.g(25, null);
    v.osc('sine', 5.5, t, t + 2.6, wob);
    const b1 = v.fm(mtof(r + 6), t, 0.12, 0.002, 1.6, { ratio: 2, index: 1.4 });
    const b2 = v.fm(mtof(r), t + beat / 2, 0.12, 0.002, 2.0, { ratio: 2, index: 1.4 });
    wob.connect(b1.detune);
    wob.connect(b2.detune);
    for (let i = 0; i < 4; i++) {
      v.noiseHit('white', t + (i * beat) / 2, 0.1, 0.0005, 0.02, { type: 'bandpass', f: i % 2 ? 1900 : 2600, Q: 6 });
    }
    v.tone('sine', 60, t, 0.35, 0.004, 0.18, { to: 38 });
    v.tone('sine', 55, t + 0.17, 0.25, 0.004, 0.18, { to: 36 });
  },

  /** A new run: the world returns, a reversed swell blooms into a rising chime flourish. */
  runStart(e, v, t) {
    e._restoreWorld();
    const now = e._ctx.currentTime;
    const deg = e._chordDeg;
    e._reverseSwell(Math.max(now + 0.02, t - 1.2), t, [e._ct(0, -1), e._ct(2, -1)], 'pad', e._stingerBus, 0.3);
    [0, 2, 4, 7, 9, 11, 14].forEach((k, i) => {
      v.fm(mtof(e._scaleMidi(14 + deg + k)), t + i * 0.07, 0.08 * (1 - i * 0.06), 0.002, 1.4, { ratio: 3.5, index: 1.3 });
    });
    v.tone('sine', 120, t, 0.45, 0.003, 0.35, { to: 45, glide: 0.15 });
    v.noiseHit('pink', t, 0.06, 0.3, 1.2, { type: 'highpass', f: 5000 });
  },
};

export default DreamAudio;
