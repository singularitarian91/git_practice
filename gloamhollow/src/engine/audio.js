// Gloamhollow — procedural Web Audio engine.
//
// Everything is synthesised at runtime: there are no audio files.  One
// self-contained ES module, no imports.  Layout of this file:
//
//   1. helpers & DSP tables   noise buffers, reverb impulses, Karplus-Strong
//   2. voice presets          VOICES (animalese personalities)
//   3. node helpers           Voice (a short-lived group of nodes) + Kit
//                             (synth primitives used by every recipe)
//   4. sfx recipes            AudioEngine.sfx(name)
//   5. ambience layers        AudioEngine.setAmbience(levels)
//   6. generative music       AudioEngine.setMusic(mood)
//   7. speech                 AudioEngine.speak(text, voice)
//   8. AudioEngine            the public API + the `audio` singleton
//
// Mixer
//   source -> bus (music | sfx | ambience | voice) -> master -> compressor
//          -> soft clipper -> analyser -> speakers
//   Every bus also feeds two shared convolution reverbs ("room" and "hall")
//   through sends that follow the bus volume, so a slider moves wet and dry
//   together.  Music additionally has a ping-pong echo.
//
// Timing
//   Nothing uses setTimeout for musical timing.  Music, ambience events and
//   speech are planned a little ahead on the AudioContext clock by a
//   lookahead scheduler (_tick), driven by update(dt) and a slow fallback
//   interval so audio keeps flowing even if the game loop stalls.
//
// Conventions
//   World units are metres, +Z is south.  setListener(x, z, yaw) uses the
//   three.js Object3D.rotation.y convention: yaw 0 faces -Z (north), and a
//   positive yaw turns left (counter-clockwise seen from above).
//   Volume sliders map 0..1 to gain as v*v (perceptual).
//   Every public method is a silent no-op until init() succeeds and never
//   throws.  Volumes, the music mood, ambience levels and the listener set
//   before init are remembered and applied once audio starts; one-shots
//   (sfx, speak, thunder) are dropped while the context is not running.
//
// Extras beyond the core API
//   init({ context })  use an existing (Offline)AudioContext (tests)
//   sfx() returns true if the sound played, false if dropped
//   thunder() plays on the ambience bus (weather); sfx('thunder') on sfx
//   SFX_NAMES, MUSIC_MOODS, AMBIENCE_LAYERS  lists for tools and tests
//   _debugLevel() / _debugPeak() / _debugStats()  master output meter

// ---------------------------------------------------------------------------
// 1. Helpers & DSP tables
// ---------------------------------------------------------------------------

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const lerp = (a, b, t) => a + (b - a) * t;
const rand = (a = 0, b = 1) => a + Math.random() * (b - a);
const irand = (a, b) => Math.floor(rand(a, b + 1));
const chance = (p) => Math.random() < p;
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
const num = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const noop = () => {};
const own = (obj, key) => typeof key === 'string' && Object.prototype.hasOwnProperty.call(obj, key);

// Pick an element with the given relative weights.
function weighted(items, weights) {
  let sum = 0;
  for (const w of weights) sum += w;
  let r = Math.random() * sum;
  for (let i = 0; i < items.length; i++) {
    r -= weights[i];
    if (r <= 0) return items[i];
  }
  return items[items.length - 1];
}

// Small deterministic hash for strings (per-letter / per-word pitches).
function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// Seamlessly looping noise.  color: 'white' | 'pink' | 'brown'.
// Normalised to an RMS of 0.25 so recipes can treat colours alike.
function makeNoiseBuffer(ctx, seconds, color) {
  const sr = ctx.sampleRate;
  const len = Math.floor(sr * seconds);
  const fade = 2048;
  const raw = new Float32Array(len + fade);
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, br = 0;
  for (let i = 0; i < raw.length; i++) {
    const w = Math.random() * 2 - 1;
    if (color === 'pink') { // Paul Kellet's refined pink filter
      b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759;
      b2 = 0.969 * b2 + w * 0.153852; b3 = 0.8665 * b3 + w * 0.3104856;
      b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
      raw[i] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362;
      b6 = w * 0.115926;
    } else if (color === 'brown') { // leaky integrator
      br = (br + 0.02 * w) / 1.02;
      raw[i] = br;
    } else raw[i] = w;
  }
  // equal-power crossfade of the overflow into the head -> seamless loop
  for (let i = 0; i < fade; i++) {
    const x = i / fade;
    raw[i] = raw[i] * Math.sqrt(x) + raw[len + i] * Math.sqrt(1 - x);
  }
  let mean = 0;
  for (let i = 0; i < len; i++) mean += raw[i];
  mean /= len;
  let s = 0;
  for (let i = 0; i < len; i++) { raw[i] -= mean; s += raw[i] * raw[i]; }
  const k = 0.25 / Math.sqrt(s / len || 1);
  const buf = ctx.createBuffer(1, len, sr);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = raw[i] * k;
  return buf;
}

// Procedural reverb impulse: stereo noise with an exponential decay whose
// high frequencies die faster (a one-pole low-pass that closes over time),
// plus a handful of early reflections.  t60 = seconds to fall 60 dB.
function makeImpulse(ctx, seconds, t60, { pre = 0.012, bright = 0.85, dark = 0.1 } = {}) {
  const sr = ctx.sampleRate;
  const len = Math.floor(sr * seconds);
  const buf = ctx.createBuffer(2, len, sr);
  const preN = Math.floor(pre * sr);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let lp = 0;
    for (let i = preN; i < len; i++) {
      const t = (i - preN) / sr;
      const env = Math.pow(0.001, t / t60);
      const a = lerp(bright, dark, Math.min(1, t / t60));
      lp += a * ((Math.random() * 2 - 1) - lp);
      d[i] = lp * env;
    }
    // early reflections, different per ear
    for (let r = 0; r < 7; r++) {
      const i = preN + Math.floor(rand(0.004, 0.07) * sr);
      if (i < len) d[i] += (Math.random() < 0.5 ? -1 : 1) * rand(0.2, 0.6) * (1 - r / 8);
    }
    // gentle fade-in (no hard onset) and fade-out (no truncation click)
    const fin = Math.min(len, preN + Math.floor(0.004 * sr));
    for (let i = preN; i < fin; i++) d[i] *= (i - preN) / (fin - preN);
    const fo = Math.floor(len * 0.1);
    for (let i = 0; i < fo; i++) d[len - 1 - i] *= i / fo;
  }
  return buf;
}

// Karplus-Strong plucked string, rendered into a buffer.  A first-order
// all-pass supplies the fractional part of the loop delay so every note is
// in tune.  bright 0..1 shapes the pluck, t60 is the decay time.
function makePluck(ctx, freq, t60, bright) {
  const sr = ctx.sampleRate;
  const len = Math.max(64, Math.floor(sr * t60 * 0.7));
  const out = new Float32Array(len);
  const P = sr / freq;                 // loop period in samples
  let N = Math.floor(P - 0.5);         // integer delay; the 2-tap average adds 0.5
  let frac = P - 0.5 - N;
  if (frac < 0.1) { N -= 1; frac += 1; }
  N = Math.max(2, N);
  const C = (1 - frac) / (1 + frac);   // all-pass coefficient for `frac` samples
  const g = Math.pow(0.001, 1 / (t60 * freq)); // loss per period
  // excitation: one period of low-passed noise with a pick-position comb
  const exc = new Float32Array(N);
  const a = 0.12 + 0.8 * bright;
  let lp = 0, mean = 0;
  for (let i = 0; i < N; i++) { lp += a * ((Math.random() * 2 - 1) - lp); exc[i] = lp; mean += lp; }
  mean /= N;
  const pickPos = Math.max(1, Math.floor(N * 0.13));
  for (let i = N - 1; i >= 0; i--) exc[i] = (exc[i] - mean) - (i >= pickPos ? (exc[i - pickPos] - mean) * 0.6 : 0);
  let apx = 0, apy = 0;
  for (let n = 0; n < len; n++) {
    const d0 = n >= N ? out[n - N] : 0;
    const d1 = n > N ? out[n - N - 1] : 0;
    const avg = 0.5 * (d0 + d1);
    const ap = C * avg + apx - C * apy;
    apx = avg; apy = ap;
    out[n] = g * ap + (n < N ? exc[n] : 0);
  }
  // soften the very first samples, fade the tail, normalise
  const fin = Math.min(len, 24);
  for (let i = 0; i < fin; i++) out[i] *= i / fin;
  const fo = Math.floor(len * 0.2);
  for (let i = 0; i < fo; i++) out[len - 1 - i] *= i / fo;
  let peak = 0;
  for (let i = 0; i < len; i++) peak = Math.max(peak, Math.abs(out[i]));
  const k = peak > 0 ? 0.8 / peak : 1;
  const buf = ctx.createBuffer(1, len, sr);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = out[i] * k;
  return buf;
}

// Pre-rendered loop textures for dense ambience (cheaper than hundreds of
// tiny nodes per second).  All wrap around so they loop seamlessly.
function makeRainTexture(ctx, seconds) {
  const sr = ctx.sampleRate, len = Math.floor(sr * seconds);
  const buf = ctx.createBuffer(2, len, sr);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    const count = Math.floor(seconds * 170);
    for (let i = 0; i < count; i++) {
      const pos = Math.floor(Math.random() * len);
      const f = rand(1800, 7500), amp = Math.pow(Math.random(), 2.2) * 0.9 + 0.05;
      const n = Math.floor(rand(0.0015, 0.007) * sr), tau = n * 0.3, w = (2 * Math.PI * f) / sr;
      for (let j = 0; j < n; j++) d[(pos + j) % len] += amp * Math.sin(w * j) * Math.exp(-j / tau);
    }
  }
  normalizeBuffer(buf, 0.9);
  return buf;
}

function makeCricketTexture(ctx, seconds) {
  const sr = ctx.sampleRate, len = Math.floor(sr * seconds);
  const buf = ctx.createBuffer(2, len, sr);
  const L = buf.getChannelData(0), R = buf.getChannelData(1);
  const crickets = 4;
  for (let c = 0; c < crickets; c++) {
    const fc = rand(3900, 5300), pan = rand(-0.8, 0.8), amp = rand(0.35, 1);
    const gl = Math.sqrt((1 - pan) / 2), gr = Math.sqrt((1 + pan) / 2);
    const period = rand(0.42, 0.95), pulses = irand(2, 4);
    const pulseLen = rand(0.011, 0.017), gap = rand(0.007, 0.012);
    let t = rand(0, period);
    while (t < seconds) {
      if (Math.random() > 0.12) { // crickets sometimes skip a beat
        for (let p = 0; p < pulses; p++) {
          const start = Math.floor((t + p * (pulseLen + gap)) * sr), n = Math.floor(pulseLen * sr);
          const f = fc * rand(0.995, 1.005), w = (2 * Math.PI * f) / sr, a = amp * rand(0.8, 1);
          for (let j = 0; j < n; j++) {
            const e = Math.sin((Math.PI * j) / n);
            const v = a * e * e * Math.sin(w * j);
            const k = (start + j) % len;
            L[k] += v * gl; R[k] += v * gr;
          }
        }
      }
      t += period * rand(0.9, 1.1);
    }
  }
  normalizeBuffer(buf, 0.8);
  return buf;
}

function makeCrackleTexture(ctx, seconds) {
  const sr = ctx.sampleRate, len = Math.floor(sr * seconds);
  const buf = ctx.createBuffer(1, len, sr);
  const d = buf.getChannelData(0);
  let t = 0;
  while (t < seconds) {
    t += -Math.log(1 - Math.random()) / 38; // Poisson, ~38 crackles/s
    const pos = Math.floor(t * sr), n = Math.floor(rand(0.0006, 0.004) * sr);
    const amp = Math.pow(Math.random(), 3) * 0.9 + 0.04;
    const bright = Math.random();
    let prev = 0, lp = 0;
    for (let j = 0; j < n; j++) {
      const w = Math.random() * 2 - 1;
      const hp = w - prev; prev = w;          // differentiated noise = bright snap
      lp += 0.3 * (w - lp);                   // smoothed noise = duller tick
      const v = (bright > 0.5 ? hp : lp) * amp * Math.exp((-4 * j) / n);
      d[(pos + j) % len] += v;
    }
  }
  normalizeBuffer(buf, 0.9);
  return buf;
}

function normalizeBuffer(buf, target) {
  let peak = 0;
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < d.length; i++) peak = Math.max(peak, Math.abs(d[i]));
  }
  if (peak <= 0) return;
  const k = target / peak;
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < d.length; i++) d[i] *= k;
  }
}

// Master safety curve: linear up to 0.75, then a tanh knee that never
// reaches 1.  The shaper is fed at half level, so its [-1, 1] input range
// covers real signals of +-2.
function softClipCurve(n = 4096) {
  const c = new Float32Array(n);
  const th = 0.75, ceil = 0.985;
  for (let i = 0; i < n; i++) {
    const u = ((i / (n - 1)) * 2 - 1) * 2;
    const a = Math.abs(u);
    const y = a <= th ? a : th + (ceil - th) * Math.tanh((a - th) / (ceil - th));
    c[i] = Math.sign(u) * y;
  }
  return c;
}

// Soft, slightly hollow "warm saw" used for pads and drones.
function makeWarmWave(ctx) {
  const n = 28, re = new Float32Array(n), im = new Float32Array(n);
  for (let k = 1; k < n; k++) im[k] = (k % 2 ? 1 : 0.55) / Math.pow(k, 1.3);
  return ctx.createPeriodicWave(re, im);
}

// ---------------------------------------------------------------------------
// 2. Voice presets ("animalese")
// ---------------------------------------------------------------------------
//   base     centre pitch (Hz)          range   pitch spread between letters
//   speed    seconds per character      wave    oscillator type
//   formant  vowel band-pass centre     breath  0..1 airy noise on vowels
//   wobble   random pitch jitter        glide   pitch bend across one blip
//   rough    AM growl depth (croak)     vibrato depth (ratio) at vibRate Hz
//   attack   blip attack (s)            volume  gain multiplier
//   chime    true = one soft bell per word (runestones)
export const VOICES = {
  player:  { base: 245, range: 1.35, speed: 0.055, wave: 'triangle', formant: 1300, breath: 0.06, wobble: 0.025, glide: 0,     attack: 0.005, volume: 1.4 },
  corvin:  { base: 150, range: 1.28, speed: 0.062, wave: 'sawtooth', formant: 950,  breath: 0.05, wobble: 0.015, glide: -0.14, rough: 0.22, attack: 0.006, volume: 1.45 },
  morrow:  { base: 300, range: 1.18, speed: 0.078, wave: 'sine',     formant: 720,  breath: 0.14, wobble: 0.012, glide: -0.09, attack: 0.014, volume: 0.8 },
  bramble: { base: 98,  range: 1.3,  speed: 0.05,  wave: 'sawtooth', formant: 640,  breath: 0.1,  wobble: 0.03,  glide: -0.05, rough: 0.45, attack: 0.004, volume: 1.6 },
  mothwyn: { base: 470, range: 1.3,  speed: 0.06,  wave: 'sine',     formant: 2100, breath: 0.42, wobble: 0.02,  glide: 0.03,  attack: 0.012, volume: 1.25 },
  grenna:  { base: 280, range: 1.22, speed: 0.07,  wave: 'square',   formant: 1050, breath: 0.1,  wobble: 0.02,  glide: -0.03, vibrato: 0.055, vibRate: 9, attack: 0.008, volume: 0.77 },
  fennick: { base: 215, range: 1.5,  speed: 0.046, wave: 'triangle', formant: 1500, breath: 0.07, wobble: 0.03,  glide: 0.07,  attack: 0.004, volume: 1.55 },
  sign:    { base: 587, range: 1,    speed: 0.05,  wave: 'sine',     formant: 2000, breath: 0,    wobble: 0,     glide: 0,     attack: 0.006, volume: 1.26, chime: true },
};

// ---------------------------------------------------------------------------
// 3. Node helpers
// ---------------------------------------------------------------------------

// A Voice owns the nodes of one sound event.  When its last source ends,
// every node is disconnected so the graph never accumulates dead nodes.
class Voice {
  constructor() {
    this.nodes = [];
    this.end = 0;
    this.last = null;
  }

  add(node) {
    this.nodes.push(node);
    return node;
  }

  // start/stop a source and remember which one finishes last
  play(src, t0, t1, offset = 0) {
    this.nodes.push(src);
    if (offset > 0 && src.buffer) src.start(t0, offset % src.buffer.duration);
    else src.start(t0);
    src.stop(t1);
    if (t1 >= this.end) { this.end = t1; this.last = src; }
  }

  done() {
    const nodes = this.nodes;
    const kill = () => {
      for (const n of nodes) { try { n.disconnect(); } catch { /* already gone */ } }
      nodes.length = 0;
    };
    if (this.last) this.last.onended = kill;
    else kill();
  }
}

// Synth primitives shared by sfx recipes, ambience events and jingles.
// Times (`at`, `dur`, `a`, `hold`) are seconds relative to the kit's start
// and are divided by the pitch/rate multiplier; frequencies are multiplied.
class Kit {
  constructor(eng, voice, out, t, pitch = 1, vary = true) {
    this.e = eng;
    this.ctx = eng.ctx;
    this.v = voice;
    this.out = out;
    this.t = t;
    this.p = pitch;
    this.ts = 1 / pitch;
    this.vary = vary;
    this.nyq = eng.ctx.sampleRate / 2;
  }

  r(a, b) { return this.vary ? rand(a, b) : (a + b) / 2; }
  T(at) { return this.t + Math.max(0, at || 0) * this.ts; } // never before the kit start
  F(f) { return clamp(f * this.p, 20, this.nyq - 200); }

  // attack (linear) -> optional hold -> exponential decay; returns end time
  env(param, t, peak, a, d, hold = 0) {
    param.setValueAtTime(0, t);
    param.linearRampToValueAtTime(peak, t + a);
    if (hold > 0) param.setValueAtTime(peak, t + a + hold);
    param.exponentialRampToValueAtTime(0.0001, t + a + hold + d);
    return t + a + hold + d;
  }

  // Grains: several short envelopes on one gain param (crunch, crackle,
  // ratchet...).  list = [[at, dur, amp, freq?]] relative to the kit start.
  grainEnv(param, list, peak, filt, osc, f2ratio) {
    const g = [];
    let prevEnd = -1;
    for (const [at, dur, amp, freq] of [...list].sort((x, y) => x[0] - y[0])) {
      const t = Math.max(this.T(at), prevEnd + 0.0005);
      const d = Math.max(0.004, dur * this.ts);
      g.push([t, d, amp, freq]);
      prevEnd = t + d;
    }
    if (!g.length) return this.t;
    param.setValueAtTime(0, Math.min(this.t, g[0][0])); // gain params default to 1
    for (const [t, d, amp, freq] of g) {
      param.setValueAtTime(0, t);
      param.linearRampToValueAtTime(peak * amp, t + Math.min(0.002, d * 0.3));
      param.exponentialRampToValueAtTime(0.0001, t + d);
      if (freq && filt) filt.frequency.setValueAtTime(this.F(freq), t);
      if (freq && osc) {
        osc.frequency.setValueAtTime(this.F(freq), t);
        if (f2ratio) osc.frequency.exponentialRampToValueAtTime(this.F(freq * f2ratio), t + d);
      }
    }
    return prevEnd;
  }

  // random, sorted grain list: n grains spread over `span` seconds
  grains(n, span, dur = [0.004, 0.012], amp = [0.4, 1], freq = null, fade = 0) {
    const out = [];
    for (let i = 0; i < n; i++) {
      const x = Math.random();
      out.push([x * span, rand(dur[0], dur[1]), rand(amp[0], amp[1]) * (1 - fade * x), freq ? rand(freq[0], freq[1]) : 0]);
    }
    return out;
  }

  // frequency automation along a path of [relTime 0..1, Hz] points
  path(param, t, total, pts) {
    param.setValueAtTime(this.F(pts[0][1]), t);
    for (let i = 1; i < pts.length; i++) param.exponentialRampToValueAtTime(this.F(pts[i][1]), t + pts[i][0] * total);
  }

  // route through an optional panner, return the node to connect into
  dest(o) {
    const to = o.to || this.out;
    if (!o.pan) return to;
    const p = this.v.add(this.e._panner(o.pan));
    p.connect(to);
    return p;
  }

  // Filtered noise burst.
  // { at, dur, a, hold, gain, color, type, f, f2, fpath, Q, rate, grains, pan, to }
  noise(o) {
    const ctx = this.ctx, t = this.T(o.at);
    const a = (o.a ?? 0.004) * this.ts, hold = (o.hold || 0) * this.ts, d = (o.dur ?? 0.1) * this.ts;
    const src = ctx.createBufferSource();
    src.buffer = this.e._noise[o.color || 'white'];
    src.loop = true;
    if (o.rate) src.playbackRate.value = o.rate;
    let head = src, filt = null;
    if (o.type !== 'none') {
      filt = this.v.add(ctx.createBiquadFilter());
      filt.type = o.type || 'bandpass';
      filt.Q.value = o.Q ?? 1;
      if (o.fpath) this.path(filt.frequency, t, a + hold + d, o.fpath);
      else {
        filt.frequency.setValueAtTime(this.F(o.f ?? 1000), t);
        if (o.f2) filt.frequency.exponentialRampToValueAtTime(this.F(o.f2), t + a + hold + d);
      }
      src.connect(filt);
      head = filt;
    }
    const g = this.v.add(ctx.createGain());
    let end;
    if (o.grains) end = this.grainEnv(g.gain, o.grains, o.gain ?? 0.5, filt);
    else end = this.env(g.gain, t, o.gain ?? 0.5, a, d, hold);
    head.connect(g);
    g.connect(this.dest(o));
    const t0 = o.grains ? Math.min(t, this.T(Math.min(...o.grains.map((x) => x[0])))) : t;
    this.v.play(src, t0, end + 0.03, rand(0, 3));
    return end;
  }

  // Oscillator tone with pitch glide/path, optional vibrato and filter.
  // { at, type, f, f2, glide, fpath, dur, a, hold, gain, detune, vib:{rate,depth},
  //   filter:{type,f,Q}, grains, f2ratio, pan, to }
  tone(o) {
    const ctx = this.ctx, t = this.T(o.at);
    const a = (o.a ?? 0.004) * this.ts, hold = (o.hold || 0) * this.ts, d = (o.dur ?? 0.2) * this.ts;
    const total = a + hold + d;
    const osc = ctx.createOscillator();
    if (o.type === 'warm') osc.setPeriodicWave(this.e._warm);
    else osc.type = o.type || 'sine';
    if (o.detune) osc.detune.value = o.detune;
    if (o.fpath) this.path(osc.frequency, t, total, o.fpath);
    else if (!o.grains) {
      osc.frequency.setValueAtTime(this.F(o.f ?? 440), t);
      if (o.f2) osc.frequency.exponentialRampToValueAtTime(this.F(o.f2), t + (o.glide != null ? o.glide * this.ts : total));
    } else osc.frequency.value = this.F(o.f ?? 440);
    let head = osc;
    if (o.filter) {
      const f = this.v.add(ctx.createBiquadFilter());
      f.type = o.filter.type || 'lowpass';
      f.frequency.value = this.F(o.filter.f || 2000);
      f.Q.value = o.filter.Q ?? 0.7;
      head.connect(f);
      head = f;
    }
    let lfo = null;
    if (o.vib) {
      lfo = ctx.createOscillator();
      lfo.frequency.value = o.vib.rate || 5;
      const lg = this.v.add(ctx.createGain());
      lg.gain.value = this.F(o.f ?? 440) * (o.vib.depth || 0.01);
      lfo.connect(lg);
      lg.connect(osc.frequency);
    }
    const g = this.v.add(ctx.createGain());
    let end;
    if (o.grains) end = this.grainEnv(g.gain, o.grains, o.gain ?? 0.3, null, osc, o.f2ratio);
    else end = this.env(g.gain, t, o.gain ?? 0.3, a, d, hold);
    head.connect(g);
    g.connect(this.dest(o));
    const t0 = o.grains ? Math.min(t, this.T(Math.min(...o.grains.map((x) => x[0])))) : t;
    this.v.play(osc, t0, end + 0.02);
    if (lfo) this.v.play(lfo, t0, end + 0.02);
    return end;
  }

  // Additive bell: inharmonic sine partials [ratio, amp, decayScale].
  bell(o) {
    const ctx = this.ctx, t = this.T(o.at);
    const d = (o.dur ?? 1) * this.ts, a = (o.a ?? 0.002) * this.ts;
    const parts = o.partials || [[1, 1, 1], [2.0, 0.3, 0.6], [3.01, 0.12, 0.4], [4.17, 0.07, 0.3], [5.43, 0.04, 0.22]];
    const to = this.dest(o);
    let end = t;
    for (const [ratio, amp, dec] of parts) {
      const f = this.F((o.f ?? 880) * ratio);
      if (f > this.nyq * 0.9) continue;
      const osc = ctx.createOscillator();
      osc.frequency.value = f;
      const g = this.v.add(ctx.createGain());
      const e = this.env(g.gain, t, (o.gain ?? 0.2) * amp, a, d * dec);
      osc.connect(g);
      g.connect(to);
      this.v.play(osc, t, e + 0.02);
      end = Math.max(end, e);
    }
    return end;
  }

  // Two-operator FM (metallic / glassy tones).
  fm(o) {
    const ctx = this.ctx, t = this.T(o.at);
    const a = (o.a ?? 0.002) * this.ts, d = (o.dur ?? 0.4) * this.ts;
    const f = this.F(o.f ?? 440);
    const car = ctx.createOscillator(), mod = ctx.createOscillator();
    car.frequency.value = f;
    mod.frequency.value = f * (o.ratio ?? 2);
    const mg = this.v.add(ctx.createGain());
    mg.gain.setValueAtTime(f * (o.index ?? 2), t);
    mg.gain.exponentialRampToValueAtTime(Math.max(0.01, f * (o.index2 ?? 0.1)), t + a + d);
    mod.connect(mg);
    mg.connect(car.frequency);
    const g = this.v.add(ctx.createGain());
    const end = this.env(g.gain, t, o.gain ?? 0.2, a, d);
    car.connect(g);
    g.connect(this.dest(o));
    this.v.play(car, t, end + 0.02);
    this.v.play(mod, t, end + 0.02);
    return end;
  }

  // Karplus-Strong pluck from the shared cache.  { at, f | midi, gain, bright, dur }
  pluck(o) {
    const ctx = this.ctx, t = this.T(o.at);
    const f = (o.midi != null ? mtof(o.midi) : o.f ?? 440) * this.p;
    const midi = clamp(Math.round(69 + 12 * Math.log2(f / 440)), 24, 108);
    const buf = this.e._pluckBuf(midi, o.bright ?? 0.55);
    if (!buf) return t;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = f / mtof(midi);
    const g = this.v.add(ctx.createGain());
    g.gain.value = o.gain ?? 0.4;
    src.connect(g);
    g.connect(this.dest(o));
    const len = Math.min(buf.duration / src.playbackRate.value, (o.dur ?? 9) * this.ts);
    if (o.dur) {
      g.gain.setValueAtTime(o.gain ?? 0.4, Math.max(t, t + len - 0.06));
      g.gain.linearRampToValueAtTime(0, t + len);
    }
    this.v.play(src, t, t + len);
    return t + len;
  }
}

// ---------------------------------------------------------------------------
// 4. Sound effects
// ---------------------------------------------------------------------------
// Each recipe receives a Kit `k` whose output is already routed (volume,
// distance, pan, reverb sends).  pri: 0 = expendable (steps, hover),
// 1 = normal, 2 = important (UI, rewards, damage).  room/hall = reverb sends.

const SFX = Object.create(null);
function def(name, pri, room, hall, fn) { SFX[name] = { pri, room, hall, fn, vol: 1 }; }

// --- shared building blocks ------------------------------------------------

function thud(k, at, gain = 1, f = 110, dur = 0.12) {
  k.noise({ at, color: 'brown', type: 'lowpass', f: f * 3.5, Q: 0.7, a: 0.003, dur, gain: gain * 1.4 });
  k.tone({ at, f, f2: f * 0.55, dur: dur * 0.9, a: 0.003, gain: gain * 0.4 });
}

function knock(k, at, f = 220, gain = 1, res = 700) {
  k.tone({ at, type: 'triangle', f: f * 1.6, f2: f, glide: 0.025, dur: 0.1, a: 0.001, gain: gain * 0.35 });
  k.noise({ at, color: 'pink', type: 'bandpass', f: res, Q: 5, a: 0.001, dur: 0.1, gain: gain * 2.4 });
  k.noise({ at, color: 'white', type: 'highpass', f: 3000, a: 0.0008, dur: 0.018, gain: gain * 0.35 });
}

function whoosh(k, at, dur, lo, hi, gain = 1, Q = 1.3) {
  k.noise({ at, color: 'pink', type: 'bandpass', fpath: [[0, lo], [0.45, hi], [1, lo * 1.2]], Q, a: dur * 0.45, dur: dur * 0.55, gain: gain * 2.2 });
  k.noise({ at, color: 'white', type: 'highpass', f: hi * 1.8, a: dur * 0.45, dur: dur * 0.4, gain: gain * 0.25 });
}

function jingle(k, at, notes, step, gain = 0.35, bright = 0.6) {
  notes.forEach((m, i) => k.pluck({ at: at + i * step, midi: m, gain: gain * (1 - i * 0.06), bright }));
}

// high glints: two interleaved single-oscillator grain streams (cheap)
function sparkle(k, at, n, span, gain = 0.05, lo = 2600, hi = 5200) {
  for (const s of [0, 1]) {
    const list = [];
    for (let i = s; i < n; i += 2) list.push([at + (i / n) * span + rand(0, span / n / 2), rand(0.12, 0.3), rand(0.5, 1), rand(lo, hi)]);
    if (list.length) k.tone({ type: 'sine', grains: list, gain });
  }
}

function shift(list, at) { return list.map((g) => [g[0] + at, g[1], g[2], g[3]]); }

function coinClinks(k, at, n, span, gain = 0.07) {
  const list = shift(k.grains(n, span, [0.05, 0.12], [0.5, 1], [2600, 4200]), at);
  k.tone({ type: 'sine', grains: list, gain });
  k.tone({ type: 'sine', grains: list.map((g) => [g[0], g[1] * 0.6, g[2] * 0.4, g[3] * 2.76]), gain });
}

function splash(k, at, size) {
  k.noise({ at, color: 'white', type: 'lowpass', f: 6500, f2: 900, a: 0.004, dur: 0.35 * size + 0.1, gain: 1.1 * size });
  k.noise({ at, color: 'pink', type: 'bandpass', f: 420, Q: 1, a: 0.005, dur: 0.22, gain: 1.1 * size });
  k.tone({ at, f: 190, f2: 90, dur: 0.18, a: 0.004, gain: 0.25 * size });
  k.tone({ type: 'sine', grains: shift(k.grains(irand(4, 6), 0.4, [0.02, 0.04], [0.4, 1], [700, 1500]), at + 0.06), f2ratio: 1.6, gain: 0.07 * size });
}

function frameDrum(k, at, vel) {
  k.tone({ at, f: 150, f2: 72, glide: 0.06, dur: 0.5, a: 0.002, gain: 0.5 * vel });
  k.noise({ at, color: 'pink', type: 'lowpass', f: 800, a: 0.002, dur: 0.12, gain: 0.9 * vel });
}

function horn(k, at, f, dur, gain) {
  k.tone({ at, type: 'sawtooth', f, dur: 0.3, hold: dur, a: 0.12, gain, vib: { rate: 4.5, depth: 0.004 }, filter: { type: 'lowpass', f: 900, Q: 0.8 } });
  k.tone({ at, type: 'sawtooth', f, detune: 8, dur: 0.3, hold: dur, a: 0.14, gain: gain * 0.7, filter: { type: 'lowpass', f: 700, Q: 0.7 } });
}

// wood/hinge creak: jittery sawtooth through two resonances, stick-slip grains
function creak(k, at, dur, f0, f1, gain) {
  const ctx = k.ctx, t = k.T(at), d = dur * k.ts;
  const osc = ctx.createOscillator();
  osc.type = 'sawtooth';
  const n = 48, curve = new Float32Array(n);
  let x = 0;
  for (let i = 0; i < n; i++) {
    x = (x + rand(-0.3, 0.3)) * 0.85;
    curve[i] = k.F(lerp(f0, f1, i / (n - 1)) * (1 + x * 0.35));
  }
  osc.frequency.setValueCurveAtTime(curve, t, d);
  const sum = k.v.add(ctx.createGain());
  for (const [f, Q] of [[k.r(650, 900), 7], [k.r(1500, 1900), 6]]) {
    const bp = k.v.add(ctx.createBiquadFilter());
    bp.type = 'bandpass'; bp.frequency.value = k.F(f); bp.Q.value = Q;
    osc.connect(bp); bp.connect(sum);
  }
  const g = k.v.add(ctx.createGain());
  const list = [];
  for (let tt = 0; tt < dur - 0.02;) {
    const gd = rand(0.02, 0.06);
    list.push([at + tt, Math.min(gd, dur - tt), rand(0.4, 1)]);
    tt += gd + rand(0, 0.015);
  }
  const end = k.grainEnv(g.gain, list, gain);
  sum.connect(g);
  g.connect(k.out);
  k.v.play(osc, t, Math.max(end, t + d) + 0.02);
}

// Creature / vocal sound: detuned oscillators on a pitch path, optional
// growl (AM) and vibrato, breath noise, all through a formant bank.
function vocal(k, o) {
  const ctx = k.ctx, t = k.T(o.at);
  const a = (o.a ?? 0.02) * k.ts, hold = (o.hold || 0) * k.ts, d = (o.dur ?? 0.2) * k.ts, total = a + hold + d;
  const sum = k.v.add(ctx.createGain());
  const n = o.voices || 1;
  let vib = null;
  if (o.vib) {
    const lfo = ctx.createOscillator();
    lfo.frequency.value = o.vib.rate;
    vib = k.v.add(ctx.createGain());
    vib.gain.value = k.F(o.f) * o.vib.depth;
    lfo.connect(vib);
    k.v.play(lfo, t, t + total + 0.03);
  }
  for (let i = 0; i < n; i++) {
    const osc = ctx.createOscillator();
    osc.type = o.wave || 'sawtooth';
    osc.detune.value = (i - (n - 1) / 2) * (o.spread || 0) + rand(-4, 4);
    k.path(osc.frequency, t, total, o.path.map(([r, m]) => [r, o.f * m]));
    if (vib) vib.connect(osc.frequency);
    osc.connect(sum);
    k.v.play(osc, t, t + total + 0.03);
  }
  if (o.breath) {
    const src = ctx.createBufferSource();
    src.buffer = k.e._noise.pink;
    src.loop = true;
    const bg = k.v.add(ctx.createGain());
    bg.gain.value = o.breath * 1.6;
    src.connect(bg); bg.connect(sum);
    k.v.play(src, t, t + total + 0.03, rand(0, 3));
  }
  if (o.rough) {
    sum.gain.value = 1 - o.rough.depth / 2;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = o.rough.rate * rand(0.9, 1.1);
    const lg = k.v.add(ctx.createGain());
    lg.gain.value = o.rough.depth / 2;
    lfo.connect(lg); lg.connect(sum.gain);
    k.v.play(lfo, t, t + total + 0.03);
  }
  const g = k.v.add(ctx.createGain());
  for (const [f, Q, amp] of o.formants) {
    const bp = k.v.add(ctx.createBiquadFilter());
    bp.type = 'bandpass'; bp.frequency.value = k.F(f); bp.Q.value = Q;
    const fg = k.v.add(ctx.createGain());
    fg.gain.value = amp;
    sum.connect(bp); bp.connect(fg); fg.connect(g);
  }
  k.env(g.gain, t, o.gain ?? 0.5, a, d, hold);
  let head = g;
  if (o.lp) {
    const lp = k.v.add(ctx.createBiquadFilter());
    lp.type = 'lowpass'; lp.frequency.value = k.F(o.lp);
    g.connect(lp);
    head = lp;
  }
  head.connect(k.dest(o));
}

function owl(k, at, gain) {
  for (const [dt, d] of [[0, 0.3], [0.48, 0.13], [0.66, 0.42]]) {
    const f = k.r(380, 410);
    k.tone({ at: at + dt, f: f * 1.04, f2: f * 0.92, dur: d * 0.6, hold: d * 0.4, a: 0.05, gain: 0.3 * gain });
    k.noise({ at: at + dt, color: 'pink', type: 'bandpass', f: 800, Q: 1.5, dur: d * 0.6, hold: d * 0.4, a: 0.06, gain: 0.25 * gain });
  }
}

// Thunder: close strikes crack, all of them roll.  I ~0.2 (distant) .. 1.5
function thunderRecipe(k, I) {
  I = clamp(I, 0.05, 1.5);
  const close = I > 0.55;
  if (close) {
    k.noise({ color: 'white', type: 'highpass', f: k.r(900, 1500), a: 0.002, dur: 0.35, gain: 1.2 * I });
    k.noise({ at: 0.05, color: 'white', type: 'bandpass', f: 2200, Q: 0.7, grains: k.grains(8, 0.35, [0.01, 0.05], [0.3, 1], [1200, 3500], 0.6), gain: 1.2 * I });
    k.noise({ color: 'brown', type: 'lowpass', f: 900, a: 0.005, dur: 1.0, gain: 1.4 * I });
  }
  const n = irand(4, 7);
  let t = close ? 0.05 : k.r(0.05, 0.3);
  for (let i = 0; i < n; i++) {
    const dur = k.r(1.2, 2.8) * (0.6 + 0.4 * Math.min(1, I));
    k.noise({ at: t, color: 'brown', type: 'lowpass', f: k.r(110, 300) * (0.6 + 0.4 * Math.min(1, I)), Q: 0.7, a: k.r(0.08, 0.5), dur, gain: k.r(1.2, 2.2) * I * (1 - (i / (n + 1)) * 0.5) });
    t += k.r(0.25, 0.9);
  }
  k.tone({ f: 42, f2: 28, a: 0.1, dur: 3, gain: 0.22 * I });
}

// --- footsteps -------------------------------------------------------------

def('step_grass', 0, 0.03, 0, (k) => {
  const f = k.r(1700, 2600);
  k.noise({ color: 'pink', type: 'bandpass', f, Q: 0.8, grains: [[0, k.r(0.05, 0.07), 0.8], [k.r(0.035, 0.05), k.r(0.06, 0.09), 1, f * k.r(1.1, 1.4)]], gain: 1.3 });
  k.noise({ at: 0.02, color: 'white', type: 'highpass', f: k.r(4500, 6500), a: 0.01, dur: 0.06, gain: 0.12 });
  k.tone({ f: k.r(85, 110), f2: 55, dur: 0.06, a: 0.004, gain: 0.18 });
});
def('step_wood', 0, 0.06, 0, (k) => {
  knock(k, 0, k.r(150, 200), 0.8, k.r(450, 650));
  k.noise({ at: 0.004, color: 'brown', type: 'lowpass', f: 400, a: 0.003, dur: 0.08, gain: 0.6 });
});
def('step_stone', 0, 0.06, 0, (k) => {
  k.noise({ color: 'white', type: 'bandpass', f: k.r(2400, 3600), Q: 1.1, grains: [[0, 0.03, 1], [k.r(0.025, 0.04), 0.04, 0.55, k.r(3200, 4800)]], gain: 0.9 });
  k.tone({ f: k.r(120, 150), f2: 70, dur: 0.05, a: 0.002, gain: 0.25 });
});
def('step_snow', 0, 0.02, 0, (k) => {
  k.noise({ color: 'white', type: 'bandpass', f: 2000, Q: 1.3, grains: k.grains(irand(6, 9), 0.11, [0.006, 0.018], [0.5, 1], [1100, 3200]), gain: 1.1 });
  k.noise({ color: 'pink', type: 'lowpass', f: 500, a: 0.012, dur: 0.1, gain: 0.5 });
});
def('step_water', 0, 0.06, 0, (k) => {
  k.noise({ color: 'white', type: 'bandpass', f: k.r(1800, 2600), f2: 650, Q: 2.2, a: 0.006, dur: 0.16, gain: 1.2 });
  k.noise({ color: 'pink', type: 'lowpass', f: 450, a: 0.004, dur: 0.1, gain: 0.5 });
  k.tone({ at: k.r(0.01, 0.05), f: k.r(380, 520), f2: k.r(800, 1000), glide: 0.035, dur: 0.045, a: 0.003, gain: 0.07 });
});

// --- tools & gathering -----------------------------------------------------

def('swing', 1, 0.05, 0, (k) => whoosh(k, 0, k.r(0.2, 0.26), k.r(450, 600), k.r(2000, 2800), 1));
def('chop', 1, 0.1, 0, (k) => {
  k.noise({ color: 'white', type: 'highpass', f: 2500, a: 0.0008, dur: 0.02, gain: 0.7 });
  k.noise({ color: 'pink', type: 'bandpass', f: k.r(520, 760), Q: 6, a: 0.001, dur: 0.2, gain: 3.2 });
  k.tone({ type: 'triangle', f: k.r(250, 320), f2: 170, glide: 0.05, dur: 0.12, a: 0.001, gain: 0.3 });
  thud(k, 0, 0.7, 100, 0.12);
  k.noise({ at: 0.012, color: 'white', type: 'bandpass', f: 3200, Q: 1.5, grains: k.grains(4, 0.1, [0.004, 0.01], [0.3, 0.8], [2500, 4500], 0.6), gain: 0.5 });
});
def('tree_fall', 1, 0.15, 0.25, (k) => {
  creak(k, 0, 1.3, 70, 140, 0.35);
  k.noise({ at: 0.3, color: 'pink', type: 'highpass', f: 2200, a: 0.8, dur: 0.9, gain: 0.35 });
  k.noise({ at: 0.9, color: 'pink', type: 'bandpass', fpath: [[0, 300], [0.7, 1400], [1, 500]], Q: 0.8, a: 0.45, dur: 0.2, gain: 1.4 });
  const hit = 1.45;
  k.noise({ at: hit, color: 'brown', type: 'lowpass', f: 320, a: 0.006, dur: 1.2, gain: 2.2 });
  k.tone({ at: hit, f: 58, f2: 34, dur: 0.9, a: 0.005, gain: 0.55 });
  k.noise({ color: 'white', type: 'bandpass', f: 1800, Q: 1, grains: shift(k.grains(14, 0.7, [0.006, 0.03], [0.3, 1], [900, 3500], 0.7), hit), gain: 0.9 });
  k.noise({ at: hit + 0.05, color: 'pink', type: 'highpass', f: 1500, a: 0.02, dur: 1.1, gain: 0.4 });
});
def('pick_stone', 1, 0.1, 0, (k) => {
  // FM clink: non-integer ratio = inharmonic metal, index decays as it rings
  k.fm({ f: k.r(1700, 2200), ratio: 1.41, index: 3, index2: 0.2, dur: 0.28, a: 0.001, gain: 0.16 });
  k.noise({ color: 'white', type: 'highpass', f: 2800, a: 0.0008, dur: 0.035, gain: 0.8 });
  thud(k, 0, 0.5, 130, 0.08);
  k.noise({ at: 0.015, color: 'white', type: 'bandpass', f: 3000, Q: 1.4, grains: k.grains(5, 0.18, [0.004, 0.012], [0.3, 0.8], [2000, 5000], 0.7), gain: 0.6 });
});
def('rock_break', 1, 0.12, 0.08, (k) => {
  thud(k, 0, 1.1, 85, 0.3);
  k.noise({ color: 'pink', type: 'bandpass', f: 1400, Q: 0.9, grains: k.grains(18, 0.5, [0.008, 0.04], [0.3, 1], [600, 3000], 0.8), gain: 1.4 });
  k.tone({ type: 'sine', grains: shift(k.grains(5, 0.6, [0.02, 0.05], [0.3, 0.7], [3000, 5200]), 0.08), gain: 0.07 });
  k.noise({ at: 0.02, color: 'white', type: 'highpass', f: 2000, a: 0.002, dur: 0.12, gain: 0.5 });
});
def('hoe', 1, 0.06, 0, (k) => {
  k.noise({ color: 'brown', type: 'lowpass', f: k.r(700, 1000), a: 0.004, dur: 0.14, gain: 1.4 });
  k.tone({ f: k.r(120, 150), f2: 65, dur: 0.08, a: 0.003, gain: 0.3 });
  k.noise({ color: 'pink', type: 'bandpass', f: 1800, Q: 1.1, grains: shift(k.grains(6, 0.16, [0.008, 0.025], [0.3, 1], [1200, 2600], 0.6), 0.015), gain: 0.9 });
});
def('water_pour', 1, 0.1, 0, (k) => {
  const ctx = k.ctx, t = k.T(0), d = k.r(0.8, 1) * k.ts;
  const src = ctx.createBufferSource();
  src.buffer = k.e._noise.pink;
  src.loop = true;
  const bp = k.v.add(ctx.createBiquadFilter());
  bp.type = 'bandpass'; bp.Q.value = 3.2;
  const n = 64, curve = new Float32Array(n);
  for (let i = 0; i < n; i++) curve[i] = k.F(rand(650, 1700));
  bp.frequency.setValueCurveAtTime(curve, t, d);
  const g = k.v.add(ctx.createGain());
  k.env(g.gain, t, 2.4, 0.08 * k.ts, 0.3 * k.ts, Math.max(0, d - 0.38 * k.ts));
  src.connect(bp); bp.connect(g); g.connect(k.out);
  k.v.play(src, t, t + d + 0.05, rand(0, 2));
  k.tone({ type: 'sine', grains: k.grains(10, 0.85, [0.02, 0.04], [0.3, 1], [500, 1000]), f2ratio: 1.7, gain: 0.07 });
  k.noise({ color: 'white', type: 'highpass', f: 4000, a: 0.06, hold: 0.5, dur: 0.3, gain: 0.12 });
});
def('plant', 1, 0.05, 0, (k) => {
  k.noise({ color: 'brown', type: 'lowpass', f: 650, a: 0.004, dur: 0.09, gain: 1.2 });
  k.noise({ at: 0.12, color: 'brown', type: 'lowpass', f: 750, a: 0.004, dur: 0.08, gain: 0.9 });
  k.noise({ color: 'pink', type: 'bandpass', f: 2200, Q: 1, grains: shift(k.grains(4, 0.08, [0.005, 0.015], [0.3, 0.7]), 0.005), gain: 0.4 });
  k.tone({ at: 0.14, f: 520, f2: 800, glide: 0.06, dur: 0.12, a: 0.005, gain: 0.07 });
});
def('harvest', 2, 0.08, 0.05, (k) => {
  k.noise({ color: 'pink', type: 'bandpass', f: 380, f2: 2200, Q: 1.6, a: 0.03, dur: 0.1, gain: 1.6 });
  k.noise({ color: 'brown', type: 'lowpass', f: 900, grains: shift(k.grains(5, 0.12, [0.01, 0.03], [0.3, 0.9]), 0.01), gain: 0.9 });
  k.tone({ at: 0.07, type: 'triangle', f: 600, f2: 980, glide: 0.05, dur: 0.1, a: 0.004, gain: 0.16 });
  jingle(k, 0.12, [81, 86], 0.08, 0.28, 0.6);
});
def('dig', 1, 0.06, 0, (k) => {
  k.noise({ color: 'pink', type: 'bandpass', fpath: [[0, 800], [1, 1600]], Q: 2.5, a: 0.03, dur: 0.16, gain: 1.8 });
  thud(k, 0.1, 0.7, 110, 0.12);
  k.noise({ color: 'pink', type: 'bandpass', f: 1600, Q: 1.1, grains: shift(k.grains(7, 0.2, [0.008, 0.025], [0.3, 1], [1000, 2600], 0.6), 0.12), gain: 0.9 });
});

// --- items, shop & UI ------------------------------------------------------

def('pickup', 2, 0.05, 0, (k) => {
  const f = k.r(560, 640);
  k.tone({ f, f2: f * 1.68, glide: 0.07, dur: 0.12, a: 0.004, gain: 0.22 });
  k.tone({ at: 0.012, type: 'triangle', f: f * 2, f2: f * 3, glide: 0.06, dur: 0.08, a: 0.003, gain: 0.05 });
});
def('drop', 1, 0.05, 0, (k) => {
  k.tone({ type: 'triangle', f: 520, f2: 270, glide: 0.09, dur: 0.11, a: 0.003, gain: 0.18 });
  k.noise({ at: 0.07, color: 'brown', type: 'lowpass', f: 550, a: 0.003, dur: 0.07, gain: 0.9 });
});
const COIN = [[1, 1, 1], [2.76, 0.18, 0.4], [5.4, 0.06, 0.25]];
def('coin', 2, 0.1, 0.03, (k) => {
  k.bell({ f: 987.8, dur: 0.14, gain: 0.14, partials: COIN });
  k.bell({ at: 0.075, f: 1318.5, dur: 0.55, gain: 0.16, partials: COIN });
});
def('buy', 2, 0.1, 0.05, (k) => {
  coinClinks(k, 0, 3, 0.12);
  [74, 78, 81, 86].forEach((m, i) => k.bell({ at: 0.1 + i * 0.07, f: mtof(m), dur: i === 3 ? 0.8 : 0.35, gain: 0.1, partials: [[1, 1, 1], [2.0, 0.25, 0.5], [3.0, 0.08, 0.3]] }));
});
def('sell', 2, 0.1, 0.03, (k) => {
  knock(k, 0, 140, 0.6, 450);
  coinClinks(k, 0.03, 6, 0.35, 0.08);
  k.bell({ at: 0.28, f: 1318.5, dur: 0.5, gain: 0.08, partials: [[1, 1, 1], [2.76, 0.15, 0.4]] });
});
def('ui_click', 2, 0.02, 0, (k) => {
  k.tone({ type: 'triangle', f: k.r(900, 980), f2: 700, glide: 0.03, dur: 0.045, a: 0.001, gain: 0.16 });
  k.noise({ color: 'white', type: 'bandpass', f: 3000, Q: 1.2, a: 0.0006, dur: 0.012, gain: 0.35 });
});
def('ui_hover', 0, 0.02, 0, (k) => k.tone({ f: k.r(2100, 2300), f2: 1900, dur: 0.03, a: 0.002, gain: 0.035 }));
def('ui_open', 2, 0.06, 0.04, (k) => {
  k.noise({ color: 'pink', type: 'bandpass', f: 900, f2: 2400, Q: 1, a: 0.06, dur: 0.1, gain: 0.5 });
  k.pluck({ midi: 69, gain: 0.22, bright: 0.5 });
  k.pluck({ at: 0.07, midi: 76, gain: 0.2, bright: 0.5 });
});
def('ui_close', 2, 0.06, 0.04, (k) => {
  k.noise({ color: 'pink', type: 'bandpass', f: 2200, f2: 800, Q: 1, a: 0.05, dur: 0.1, gain: 0.5 });
  k.pluck({ midi: 76, gain: 0.2, bright: 0.45 });
  k.pluck({ at: 0.07, midi: 69, gain: 0.2, bright: 0.45 });
});
def('ui_error', 2, 0.04, 0, (k) => {
  for (const [at, f] of [[0, 233], [0.11, 196]]) {
    k.tone({ at, type: 'triangle', f, f2: f * 0.97, dur: 0.13, a: 0.006, gain: 0.2, filter: { type: 'lowpass', f: 900 } });
  }
});
def('eat', 1, 0.04, 0, (k) => {
  for (let i = 0; i < 3; i++) {
    const at = i * k.r(0.15, 0.19);
    k.noise({ color: 'white', type: 'bandpass', f: 2600, Q: 1.3, grains: shift(k.grains(irand(4, 7), 0.07, [0.006, 0.016], [0.4, 1], [1800, 4000]), at), gain: 1.1 });
    k.noise({ at, color: 'brown', type: 'lowpass', f: 400, a: 0.005, dur: 0.07, gain: 0.5 });
  }
});
def('drink', 1, 0.05, 0, (k) => {
  for (let i = 0; i < 3; i++) {
    const at = i * k.r(0.22, 0.27);
    k.tone({ at, f: k.r(250, 290), f2: 170, glide: 0.08, dur: 0.09, a: 0.01, gain: 0.2 });
    k.noise({ at, color: 'pink', type: 'lowpass', f: 700, a: 0.01, dur: 0.08, gain: 0.5 });
  }
});
def('place', 1, 0.08, 0, (k) => {
  k.tone({ type: 'triangle', f: k.r(170, 200), f2: 105, glide: 0.05, dur: 0.12, a: 0.002, gain: 0.35 });
  k.noise({ color: 'pink', type: 'bandpass', f: k.r(420, 560), Q: 3, a: 0.002, dur: 0.12, gain: 2 });
  thud(k, 0, 0.6, 95, 0.1);
  k.noise({ at: 0.03, color: 'white', type: 'highpass', f: 3500, a: 0.03, dur: 0.15, gain: 0.08 });
});
def('remove', 1, 0.06, 0, (k) => {
  k.noise({ color: 'pink', type: 'bandpass', f: 600, f2: 2500, Q: 1.4, a: 0.05, dur: 0.1, gain: 1.3 });
  k.tone({ at: 0.06, f: 480, f2: 880, glide: 0.06, dur: 0.1, a: 0.004, gain: 0.15 });
});
def('craft', 2, 0.1, 0.06, (k) => {
  for (let i = 0; i < 3; i++) {
    knock(k, i * 0.14, k.r(300, 360), 0.8, k.r(900, 1300));
    k.bell({ at: i * 0.14, f: k.r(1500, 1800), dur: 0.12, gain: 0.03, partials: [[1, 1, 1], [2.4, 0.4, 0.5]] });
  }
  jingle(k, 0.44, [81, 88], 0.08, 0.26, 0.65);
  sparkle(k, 0.46, 4, 0.35, 0.03);
});
def('cook', 1, 0.06, 0, (k) => {
  const ctx = k.ctx, t = k.T(0), d = 1.1 * k.ts;
  const src = ctx.createBufferSource();
  src.buffer = k.e._crackle;
  src.loop = true;
  const hp = k.v.add(ctx.createBiquadFilter());
  hp.type = 'highpass'; hp.frequency.value = 2500;
  const g = k.v.add(ctx.createGain());
  k.env(g.gain, t, 0.5, 0.1 * k.ts, 0.35 * k.ts, d - 0.45 * k.ts);
  src.connect(hp); hp.connect(g); g.connect(k.out);
  k.v.play(src, t, t + d + 0.05, rand(0, 3));
  k.noise({ color: 'white', type: 'highpass', f: 4500, a: 0.1, hold: 0.55, dur: 0.35, gain: 0.2 });
  k.tone({ type: 'sine', grains: k.grains(7, 0.9, [0.03, 0.06], [0.4, 1], [220, 420]), f2ratio: 1.8, gain: 0.1 });
  k.bell({ at: 1.0, f: 2093, dur: 0.5, gain: 0.04, partials: [[1, 1, 1], [2.76, 0.3, 0.5]] });
});
def('door', 1, 0.12, 0.05, (k) => {
  creak(k, 0, 0.45, 95, 150, 0.3);
  thud(k, 0.5, 1, 70, 0.25);
  k.noise({ at: 0.52, color: 'white', type: 'highpass', f: 2500, a: 0.001, dur: 0.02, gain: 0.5 });
  k.bell({ at: 0.53, f: 1750, dur: 0.06, gain: 0.03, partials: [[1, 1, 1], [2.3, 0.5, 0.5]] });
});
def('chest_open', 1, 0.1, 0, (k) => {
  creak(k, 0, 0.28, 130, 210, 0.25);
  knock(k, 0.27, 260, 0.7, 700);
});
def('chest_close', 1, 0.1, 0, (k) => {
  creak(k, 0, 0.14, 200, 130, 0.2);
  knock(k, 0.13, 170, 1, 480);
  thud(k, 0.13, 0.6, 90, 0.12);
  k.noise({ at: 0.16, color: 'white', type: 'highpass', f: 2800, a: 0.001, dur: 0.02, gain: 0.35 });
});
def('gift', 2, 0.06, 0.1, (k) => {
  k.noise({ color: 'white', type: 'highpass', f: 2800, grains: k.grains(10, 0.24, [0.008, 0.025], [0.3, 1]), gain: 0.5 });
  jingle(k, 0.26, [79, 86], 0.12, 0.28, 0.65);
  sparkle(k, 0.34, 5, 0.45, 0.03);
});

// --- combat ----------------------------------------------------------------

def('hit_enemy', 2, 0.1, 0, (k) => {
  k.noise({ color: 'white', type: 'bandpass', f: k.r(1100, 1700), Q: 0.8, a: 0.001, dur: 0.09, gain: 1.9 });
  k.tone({ f: k.r(150, 180), f2: 48, glide: 0.1, dur: 0.14, a: 0.001, gain: 0.55 });
  k.noise({ color: 'pink', type: 'highpass', f: 3500, a: 0.001, dur: 0.05, gain: 0.45 });
  k.noise({ at: 0.02, color: 'pink', type: 'bandpass', f: 1400, f2: 400, Q: 1.5, a: 0.01, dur: 0.18, gain: 0.8 });
});
def('hit_wood', 1, 0.08, 0, (k) => {
  knock(k, 0, k.r(190, 240), 1, k.r(600, 850));
  k.noise({ color: 'white', type: 'highpass', f: 2200, a: 0.001, dur: 0.03, gain: 0.5 });
  k.noise({ color: 'white', type: 'bandpass', f: 3000, Q: 1.5, grains: shift(k.grains(3, 0.07, [0.004, 0.01], [0.3, 0.7], [2400, 4200]), 0.01), gain: 0.4 });
});
def('enemy_die', 1, 0.1, 0.3, (k) => {
  const f = k.r(560, 680);
  k.tone({ type: 'sawtooth', f, f2: f * 0.22, dur: 0.85, a: 0.02, gain: 0.07, vib: { rate: 7, depth: 0.03 }, filter: { type: 'lowpass', f: 1600 } });
  k.tone({ f: f * 1.5, f2: f * 0.33, dur: 0.8, a: 0.03, gain: 0.06 });
  k.noise({ color: 'pink', type: 'lowpass', f: 2800, f2: 250, a: 0.04, dur: 0.7, gain: 1.1 });
  sparkle(k, 0.1, 5, 0.5, 0.035, 2200, 4200);
});
def('player_hurt', 2, 0.08, 0, (k) => {
  k.noise({ color: 'pink', type: 'lowpass', f: 1000, a: 0.002, dur: 0.15, gain: 1.6 });
  k.tone({ f: 120, f2: 55, dur: 0.18, a: 0.002, gain: 0.5 });
  vocal(k, { at: 0.01, f: k.r(190, 220), path: [[0, 1.05], [0.3, 1], [1, 0.72]], a: 0.01, hold: 0.04, dur: 0.12, gain: 0.5, formants: [[640, 4, 1], [1150, 5, 0.5]] });
});
def('player_die', 2, 0.1, 0.45, (k) => {
  thud(k, 0, 1, 90, 0.4);
  k.tone({ type: 'triangle', f: 146.8, f2: 73.4, dur: 2.2, a: 0.05, gain: 0.12 });
  jingle(k, 0.3, [74, 72, 69, 62], 0.34, 0.3, 0.35);
  k.noise({ at: 0.1, color: 'pink', type: 'lowpass', f: 600, f2: 150, a: 0.6, dur: 1.6, gain: 0.5 });
});
def('block', 2, 0.1, 0.05, (k) => {
  const f = k.r(520, 610);
  k.bell({ f, dur: 0.55, gain: 0.13, partials: [[1, 1, 1], [2.32, 0.7, 0.7], [3.1, 0.5, 0.5], [4.53, 0.35, 0.35], [6.1, 0.2, 0.25]] });
  k.fm({ f: f * 2.01, ratio: 2.32, index: 4, index2: 0.3, dur: 0.45, a: 0.001, gain: 0.06 }); // bright "shing"
  k.noise({ color: 'white', type: 'bandpass', f: 2600, Q: 0.9, a: 0.0008, dur: 0.05, gain: 1.1 });
  k.tone({ f: 190, f2: 90, dur: 0.1, a: 0.001, gain: 0.3 });
});
def('dodge', 1, 0.05, 0, (k) => {
  whoosh(k, 0, 0.2, 380, 1600, 0.9, 1.1);
  k.noise({ at: 0.21, color: 'brown', type: 'lowpass', f: 480, a: 0.003, dur: 0.09, gain: 0.8 });
  k.noise({ at: 0.22, color: 'white', type: 'bandpass', f: 1700, Q: 0.9, a: 0.01, dur: 0.12, gain: 0.35 });
});

// --- fishing & bugs --------------------------------------------------------

def('cast', 1, 0.06, 0, (k) => {
  whoosh(k, 0, 0.22, 500, 2600, 0.9, 1.4);
  const list = [];
  for (let t = 0.08, step = 0.018; t < 0.7; t += step, step *= 1.06) list.push([t, 0.006, 1 - t * 0.8]);
  k.noise({ color: 'white', type: 'bandpass', f: 3600, Q: 3, grains: list, gain: 0.8 });
  k.tone({ at: 0.85, f: 700, f2: 260, glide: 0.05, dur: 0.07, a: 0.003, gain: 0.12 });
  k.noise({ at: 0.85, color: 'white', type: 'bandpass', f: 1800, f2: 800, Q: 1.5, a: 0.004, dur: 0.14, gain: 0.5 });
});
def('bite', 2, 0.08, 0, (k) => {
  k.tone({ f: 280, f2: 680, glide: 0.05, dur: 0.08, a: 0.004, gain: 0.3 });
  k.tone({ at: 0.13, f: 240, f2: 560, glide: 0.05, dur: 0.08, a: 0.004, gain: 0.26 });
  k.noise({ color: 'white', type: 'bandpass', f: 2000, f2: 900, Q: 1.6, a: 0.004, dur: 0.14, gain: 0.8 });
});
def('reel', 1, 0.03, 0, (k) => {
  const list = [], rate = k.r(22, 28);
  for (let t = 0; t < 0.42; t += 1 / rate) list.push([t, 0.009, k.r(0.6, 1)]);
  k.noise({ color: 'pink', type: 'bandpass', f: 2600, Q: 1.6, grains: list, gain: 1.2 });
  k.tone({ type: 'triangle', grains: list.map((g) => [g[0], 0.012, g[2] * 0.6, 1400]), gain: 0.08 });
});
def('fish_catch', 2, 0.08, 0.1, (k) => {
  splash(k, 0, 0.9);
  jingle(k, 0.14, [74, 78, 81, 86], 0.075, 0.3, 0.65);
  k.bell({ at: 0.45, f: mtof(90), dur: 0.7, gain: 0.05 });
});
def('fish_escape', 2, 0.08, 0.08, (k) => {
  splash(k, 0, 0.6);
  k.tone({ at: 0.05, type: 'triangle', f: 1900, f2: 800, glide: 0.03, dur: 0.05, a: 0.001, gain: 0.1 });
  k.noise({ at: 0.05, color: 'white', type: 'highpass', f: 3000, a: 0.0008, dur: 0.02, gain: 0.5 });
  jingle(k, 0.25, [69, 65], 0.2, 0.25, 0.35);
});
def('splash', 1, 0.1, 0.05, (k) => splash(k, 0, 1));
def('net_swing', 1, 0.04, 0, (k) => {
  whoosh(k, 0, 0.26, 450, 2000, 0.8, 1.2);
  const list = [];
  for (let t = 0.02; t < 0.26; t += 0.034) list.push([t, 0.022, 0.6 + 0.4 * Math.sin(t * 12)]);
  k.noise({ color: 'pink', type: 'bandpass', f: 900, Q: 0.8, grains: list, gain: 0.7 });
});
def('bug_catch', 2, 0.06, 0.08, (k) => {
  whoosh(k, 0, 0.16, 600, 2400, 0.6, 1.3);
  k.tone({ at: 0.12, f: 700, f2: 1150, glide: 0.04, dur: 0.07, a: 0.003, gain: 0.18 });
  jingle(k, 0.18, [84, 88, 91], 0.06, 0.2, 0.7);
  sparkle(k, 0.2, 4, 0.3, 0.03);
});
def('relic_found', 2, 0.05, 0.5, (k) => {
  k.tone({ type: 'triangle', f: mtof(50), dur: 1.8, a: 0.5, gain: 0.08 });
  k.tone({ type: 'triangle', f: mtof(57), dur: 1.8, a: 0.6, gain: 0.06 });
  [74, 77, 81, 84, 88].forEach((m, i) => k.bell({ at: 0.05 + i * 0.1, f: mtof(m), dur: 1.6, gain: 0.07 }));
  k.noise({ color: 'white', type: 'highpass', f: 6000, a: 0.35, dur: 1.1, gain: 0.12 });
  sparkle(k, 0.4, 6, 1.0, 0.025, 3000, 6000);
});

// --- days, village & rewards -----------------------------------------------

def('sleep', 2, 0.05, 0.4, (k) => {
  for (const m of [62, 65, 69]) k.tone({ type: 'triangle', f: mtof(m), dur: 2.2, a: 0.8, gain: 0.03 });
  jingle(k, 0.1, [81, 77, 74, 69], 0.36, 0.22, 0.35);
  k.bell({ at: 1.6, f: mtof(86), dur: 1.4, gain: 0.03 });
});
def('day_start', 2, 0.05, 0.35, (k) => {
  horn(k, 0, mtof(62), 0.6, 0.09);
  horn(k, 0.55, mtof(69), 0.9, 0.1);
  jingle(k, 0.5, [74, 81, 86], 0.12, 0.22, 0.6);
  k.bell({ at: 0.9, f: mtof(88), dur: 1.2, gain: 0.04 });
  birdCall(k, 1.3, 0.6, 'tweet');
  birdCall(k, 1.8, 0.45, 'feebee');
});
def('friendship', 2, 0.05, 0.1, (k) => {
  k.tone({ f: 620, f2: 1040, glide: 0.06, dur: 0.1, a: 0.004, gain: 0.14 });
  jingle(k, 0.08, [81, 85, 88], 0.07, 0.24, 0.7);
  sparkle(k, 0.2, 4, 0.35, 0.03, 3000, 5500);
});
def('quest_complete', 2, 0.05, 0.3, (k) => {
  jingle(k, 0, [62, 66, 69, 74], 0.08, 0.28, 0.6);
  for (const m of [62, 66, 69]) k.tone({ at: 0.36, type: 'warm', f: mtof(m), dur: 1.6, a: 0.08, gain: 0.03, filter: { type: 'lowpass', f: 1800 } });
  k.pluck({ at: 0.38, midi: 81, gain: 0.3, bright: 0.7 });
  k.bell({ at: 0.42, f: mtof(86), dur: 1.3, gain: 0.06 });
  frameDrum(k, 0.36, 0.5);
  sparkle(k, 0.45, 5, 0.6, 0.025);
});
def('offering', 2, 0.03, 0.6, (k) => {
  frameDrum(k, 0, 0.9);
  choir(k, 0.05, [50, 57, 62, 65], 2.6, 0.05);
  [74, 81, 86].forEach((m, i) => k.bell({ at: 0.5 + i * 0.3, f: mtof(m), dur: 1.8, gain: 0.06 }));
  k.noise({ at: 0.3, color: 'white', type: 'highpass', f: 5000, a: 0.8, dur: 1.4, gain: 0.1 });
});
def('hearth_roar', 2, 0.05, 0.3, (k) => {
  k.noise({ color: 'pink', type: 'lowpass', fpath: [[0, 200], [0.3, 3200], [1, 500]], Q: 0.8, a: 0.4, hold: 0.6, dur: 1.5, gain: 2.2 });
  k.noise({ color: 'brown', type: 'lowpass', f: 170, a: 0.3, hold: 0.5, dur: 1.8, gain: 2.2 });
  k.tone({ f: 46, dur: 1.8, a: 0.3, gain: 0.3 });
  k.noise({ color: 'white', type: 'bandpass', f: 2500, Q: 1.2, grains: shift(k.grains(22, 2.2, [0.004, 0.02], [0.2, 1], [1500, 4500], 0.5), 0.2), gain: 0.9 });
});
def('fire_ignite', 1, 0.05, 0.1, (k) => {
  k.noise({ color: 'pink', type: 'lowpass', fpath: [[0, 200], [0.3, 2800], [1, 900]], Q: 0.9, a: 0.12, hold: 0.15, dur: 0.6, gain: 1.8 });
  k.tone({ f: 70, f2: 48, dur: 0.4, a: 0.03, gain: 0.3 });
  k.noise({ color: 'white', type: 'bandpass', f: 2600, Q: 1.2, grains: shift(k.grains(9, 0.9, [0.004, 0.015], [0.3, 1], [1500, 4200], 0.5), 0.1), gain: 0.8 });
});
def('levelup', 2, 0.05, 0.3, (k) => {
  jingle(k, 0, [74, 78, 81, 86], 0.07, 0.28, 0.7);
  k.bell({ at: 0.3, f: mtof(88), dur: 1.2, gain: 0.06 });
  for (const m of [62, 66, 69, 74]) k.tone({ at: 0.28, type: 'warm', f: mtof(m), dur: 1.3, a: 0.06, gain: 0.025, filter: { type: 'lowpass', f: 2200 } });
  k.noise({ at: 0.25, color: 'white', type: 'highpass', f: 7000, a: 0.2, dur: 0.9, gain: 0.1 });
  sparkle(k, 0.3, 6, 0.8, 0.03);
});
def('notify', 2, 0.05, 0.15, (k) => {
  const P = [[1, 1, 1], [2.0, 0.2, 0.5], [3.0, 0.06, 0.3]];
  k.bell({ f: mtof(81), dur: 0.5, gain: 0.1, partials: P });
  k.bell({ at: 0.12, f: mtof(88), dur: 0.8, gain: 0.09, partials: P });
});

// --- creatures & the Gloam -------------------------------------------------

def('gloam_spawn', 1, 0.05, 0.5, (k) => {
  k.noise({ color: 'white', type: 'bandpass', fpath: [[0, 300], [1, 2400]], Q: 5, a: 1.0, dur: 0.25, gain: 2.6 });
  k.tone({ f: 220, dur: 0.5, a: 0.9, gain: 0.05, detune: -10 });
  k.tone({ type: 'triangle', f: 223, dur: 0.5, a: 0.9, gain: 0.05, detune: 10 });
  k.tone({ at: 0.3, type: 'sawtooth', f: 900, f2: 1350, dur: 0.4, a: 0.5, gain: 0.02, filter: { type: 'bandpass', f: 1200, Q: 6 } });
});
def('wraith_scream', 1, 0.08, 0.5, (k) => {
  vocal(k, {
    f: k.r(760, 960), voices: 3, spread: 18, path: [[0, 0.9], [0.12, 1.15], [0.5, 0.95], [1, 0.55]],
    a: 0.05, hold: 0.3, dur: 0.9, gain: 0.5, vib: { rate: 7, depth: 0.03 },
    formants: [[900, 4, 1], [2400, 6, 0.5], [3200, 8, 0.25]], breath: 0.6, lp: 4500,
  });
});
def('gloamling_growl', 1, 0.08, 0.1, (k) => {
  vocal(k, {
    f: k.r(85, 110), voices: 2, spread: 25, path: [[0, 0.9], [0.3, 1.1], [1, 0.8]],
    a: 0.06, hold: 0.25, dur: 0.3, gain: 0.8, rough: { rate: 32, depth: 0.7 },
    formants: [[450, 2.5, 1], [900, 4, 0.5]], breath: 0.3, lp: 1500,
  });
  k.noise({ color: 'white', type: 'bandpass', f: 2500, Q: 2, grains: shift(k.grains(5, 0.5, [0.004, 0.01], [0.3, 0.9], [1800, 3800]), 0.05), gain: 0.6 });
});
def('draugr_groan', 1, 0.1, 0.3, (k) => {
  vocal(k, {
    f: k.r(56, 66), voices: 2, spread: 20, path: [[0, 1], [0.4, 1.08], [1, 0.82]],
    a: 0.25, hold: 0.6, dur: 0.7, gain: 1.1, rough: { rate: 18, depth: 0.45 },
    formants: [[380, 3, 1], [760, 4, 0.6], [2400, 8, 0.1]], breath: 0.4, lp: 1400,
  });
});
def('stag_roar', 2, 0.1, 0.5, (k) => {
  const f = k.r(72, 82);
  vocal(k, {
    f, voices: 2, spread: 15, path: [[0, 0.9], [0.22, 1.45], [0.6, 1.25], [1, 0.75]],
    a: 0.15, hold: 1.2, dur: 0.9, gain: 1.2, rough: { rate: 24, depth: 0.5 },
    formants: [[320, 3, 1], [750, 4, 0.8], [2300, 6, 0.3]], breath: 0.5, lp: 3200,
  });
  k.tone({ f: f / 2, dur: 0.9, hold: 1.1, a: 0.2, gain: 0.25 });
});
def('crow_caw', 1, 0.08, 0.2, (k) => {
  const n = chance(0.6) ? 2 : 1;
  for (let i = 0; i < n; i++) {
    vocal(k, {
      at: i * 0.3, f: k.r(520, 640), path: [[0, 1], [0.3, 1.1], [1, 0.78]],
      a: 0.012, hold: 0.07, dur: 0.12, gain: 0.7, rough: { rate: 70, depth: 0.5 },
      formants: [[1300, 3, 1], [2600, 4, 0.5]], breath: 0.3, lp: 5000,
    });
  }
});
def('owl_hoot', 1, 0.05, 0.5, (k) => owl(k, 0, 1));
def('deer_flee', 1, 0.08, 0.1, (k) => {
  const list = [];
  for (let c = 0; c < 5; c++) for (const dt of [0, 0.07, 0.14]) list.push([c * 0.3 + dt + rand(0, 0.015), 0.06, 1 - c * 0.17]);
  k.noise({ color: 'brown', type: 'lowpass', f: 500, grains: list, gain: 1.6 });
  k.tone({ type: 'sine', grains: list.map((g) => [g[0], 0.05, g[2], 110]), f2ratio: 0.6, gain: 0.3 });
  k.noise({ color: 'pink', type: 'highpass', f: 2500, a: 0.05, dur: 1.2, gain: 0.3 });
});
def('thunder', 1, 0.05, 0.6, (k) => thunderRecipe(k, 1));

// formant-filtered saws singing "ah" (offering; also used by the music pads)
function choir(k, at, midis, dur, gain) {
  const ctx = k.ctx, t = k.T(at), d = dur * k.ts;
  const sum = k.v.add(ctx.createGain());
  for (const m of midis) {
    for (const det of [-7, 7]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = k.F(mtof(m));
      o.detune.value = det + rand(-3, 3);
      o.connect(sum);
      k.v.play(o, t, t + d + 0.05);
    }
  }
  const g = k.v.add(ctx.createGain());
  for (const [f, Q, a] of [[720, 5, 1], [1150, 6, 0.6], [2700, 8, 0.2]]) {
    const bp = k.v.add(ctx.createBiquadFilter());
    bp.type = 'bandpass'; bp.frequency.value = f; bp.Q.value = Q;
    const fg = k.v.add(ctx.createGain());
    fg.gain.value = a;
    sum.connect(bp); bp.connect(fg); fg.connect(g);
  }
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(gain, t + d * 0.4);
  g.gain.linearRampToValueAtTime(0, t + d);
  g.connect(k.out);
}

// Loudness trims (dB), measured offline so each effect sits at a level that
// suits its role: soft steps and UI, clear tools and rewards, big events.
const SFX_TRIM = {
  step_grass: -1.4, step_wood: -3.7, step_stone: -1.3, step_snow: +1.3, step_water: -2.0,
  swing: -4.4, chop: +1.4, tree_fall: -4.4, pick_stone: +1.7, rock_break: -5.4, hoe: -5.7,
  water_pour: -6.9, plant: -4.3, harvest: +2.9, dig: -2.1, pickup: +2.2, drop: +2.1, coin: +2.5,
  buy: +6.5, sell: +5.6, ui_click: +6.8, ui_hover: +8.6, ui_open: +2.0, ui_close: +3.4,
  ui_error: +1.8, eat: +3.4, drink: -1.2, place: -4.1, remove: +0.3, craft: +3.2, cook: +4.1,
  door: -3.8, chest_open: +3.8, chest_close: -3.2, gift: +7.6, hit_enemy: +0.2, hit_wood: +3.3,
  enemy_die: -3.6, player_hurt: -4.0, player_die: -5.0, block: +2.2, dodge: -3.2, cast: -3.1,
  bite: +3.8, reel: +8.0, fish_catch: -1.0, fish_escape: +2.0, splash: -2.5, net_swing: -3.3,
  bug_catch: +3.1, relic_found: +4.1, sleep: +6.3, day_start: +1.9, friendship: +7.6,
  quest_complete: +2.1, offering: -3.2, hearth_roar: -10.2, fire_ignite: -9.8, levelup: +8.2,
  notify: +4.7, gloam_spawn: +1.4, wraith_scream: -5.8, gloamling_growl: -0.4, draugr_groan: -1.0,
  stag_roar: -0.6, crow_caw: -1.1, owl_hoot: -7.7, deer_flee: -5.8, thunder: +1.0,
};
for (const [n, db] of Object.entries(SFX_TRIM)) if (SFX[n]) SFX[n].vol = Math.pow(10, db / 20);

export const SFX_NAMES = Object.keys(SFX);

// ---------------------------------------------------------------------------
// 5. Ambience
// ---------------------------------------------------------------------------
// A Layer owns persistent looping nodes (built lazily when its level first
// rises above zero, torn down a few seconds after it returns to zero) plus
// events scheduled ahead on the audio clock.  Both a dry and a hall-reverb
// path follow the layer level, so crossfades move everything together.

class Layer {
  constructor(eng, name, spec) {
    this.e = eng;
    this.name = name;
    this.spec = spec;
    this.level = 0;
    this.on = false;
    this.offAt = 0;
    this.nodes = [];
    this.srcs = [];
    this.st = {};
  }

  // Safe to call every frame: automation is only scheduled when the level
  // really moves, and the teardown timer only starts on the way down to 0.
  set(level, now) {
    this.level = level;
    if (level > 0.001 && !this.on) this.start(now);
    if (!this.on) return;
    const silent = level <= 0.001;
    if (Math.abs(level - this.sent) < 0.005 && silent === this.sent <= 0.001) return;
    this.sent = level;
    const v = level * this.spec.vol;
    this.dry.gain.setTargetAtTime(v, now, 0.6);
    this.wet.gain.setTargetAtTime(v, now, 0.6);
    this.offAt = silent ? now + 4 : 0;
  }

  start(now) {
    const ctx = this.e.ctx, bus = this.e.bus.ambience;
    this.dry = ctx.createGain();
    this.wet = ctx.createGain();
    this.dry.gain.value = 0;
    this.wet.gain.value = 0;
    this.dry.connect(bus.in);
    this.wet.connect(bus.hall);
    this.on = true;
    this.st = {};
    this.sent = -1;
    this.now = now;
    this.spec.build(this);
  }

  stop() {
    for (const s of this.srcs) { try { s.stop(); } catch { /* not started */ } }
    for (const n of this.nodes) { try { n.disconnect(); } catch { /* gone */ } }
    try { this.dry.disconnect(); this.wet.disconnect(); } catch { /* gone */ }
    this.nodes = [];
    this.srcs = [];
    this.on = false;
  }

  tick(now, horizon) {
    if (!this.on) return;
    if (this.offAt && now > this.offAt) { this.stop(); return; }
    if (this.level > 0.001 && this.spec.tick) this.spec.tick(this, now, horizon);
  }

  // --- persistent node helpers ---
  node(n) { this.nodes.push(n); return n; }
  loop(buf, rate = 1) {
    const s = this.e.ctx.createBufferSource();
    s.buffer = buf;
    s.loop = true;
    s.playbackRate.value = rate;
    s.start(this.now, rand(0, buf.duration));
    this.srcs.push(s);
    return this.node(s);
  }
  osc(type, f) {
    const o = this.e.ctx.createOscillator();
    o.type = type;
    o.frequency.value = f;
    o.start(this.now);
    this.srcs.push(o);
    return this.node(o);
  }
  filter(type, f, Q = 0.7) {
    const b = this.e.ctx.createBiquadFilter();
    b.type = type;
    b.frequency.value = f;
    b.Q.value = Q;
    return this.node(b);
  }
  gain(v) {
    const g = this.e.ctx.createGain();
    g.gain.value = v;
    return this.node(g);
  }
  pan(p) { return this.node(this.e._panner(p)); }
  chain(...ns) {
    for (let i = 0; i < ns.length - 1; i++) ns[i].connect(ns[i + 1]);
    return ns[ns.length - 1];
  }
  send(node, amount) { node.connect(this.gain(amount)).connect(this.wet); }

  // one-shot event routed into this layer: fn(kit) builds the sound
  ev(t, { pan = 0, wet = 0.3, gain = 1 }, fn) {
    const ctx = this.e.ctx, v = new Voice();
    const out = v.add(ctx.createGain());
    out.gain.value = gain;
    out.connect(this.dry);
    if (wet > 0) {
      const w = v.add(ctx.createGain());
      w.gain.value = wet;
      out.connect(w);
      w.connect(this.wet);
    }
    let head = out;
    if (pan) {
      head = v.add(this.e._panner(pan));
      head.connect(out);
    }
    fn(new Kit(this.e, v, head, t, 1, true));
    v.done();
  }

  // run fn(t) at randomised intervals, planned `horizon` seconds ahead
  every(key, now, horizon, gap, fn) {
    const st = this.st;
    if (st[key] == null || st[key] < now - 1) st[key] = now + gap() * rand(0.1, 0.8);
    let guard = 0;
    while (st[key] < now + horizon && guard++ < 64) {
      const t = st[key];
      fn(Math.max(t, now + 0.01));
      st[key] = t + Math.max(0.04, gap());
    }
  }
}

// Bird call templates (day ambience, day_start jingle).
function birdCall(k, at, gain = 1, kind) {
  kind = kind || pick(['tweet', 'tweet', 'trill', 'feebee', 'warble', 'chip']);
  if (kind === 'tweet') {
    const n = irand(2, 4), f = rand(2800, 4200), gap = rand(0.1, 0.16);
    k.tone({ grains: Array.from({ length: n }, (_, i) => [at + i * gap, rand(0.045, 0.07), rand(0.7, 1), f * rand(1.1, 1.2)]), f2ratio: 0.72, gain: 0.21 * gain });
  } else if (kind === 'trill') {
    const n = irand(8, 14), f = rand(3600, 5000), step = rand(0.028, 0.04);
    k.tone({ grains: Array.from({ length: n }, (_, i) => [at + i * step, step * 0.8, 0.5 + 0.5 * Math.sin((i / n) * Math.PI), f * (i % 2 ? 0.9 : 1.05)]), f2ratio: 0.95, gain: 0.15 * gain });
  } else if (kind === 'feebee') {
    const f = rand(2500, 3200);
    k.tone({ at, f, f2: f * 0.98, dur: 0.12, hold: 0.14, a: 0.03, gain: 0.15 * gain });
    k.tone({ at: at + 0.32, f: f * 0.84, f2: f * 0.8, dur: 0.14, hold: 0.16, a: 0.03, gain: 0.135 * gain });
  } else if (kind === 'warble') {
    const f = rand(2700, 3500);
    k.tone({ at, f, f2: f * rand(0.9, 1.15), dur: 0.2, hold: rand(0.2, 0.35), a: 0.03, gain: 0.12 * gain, vib: { rate: rand(14, 22), depth: 0.08 } });
  } else {
    const f = rand(4000, 5200);
    k.tone({ at, f, f2: f * 0.7, dur: 0.035, a: 0.002, gain: 0.18 * gain });
  }
}

function seaWave(k) {
  const swell = rand(2.2, 3.4), fall = rand(3, 4.5);
  k.noise({ color: 'pink', type: 'lowpass', fpath: [[0, 250], [swell / (swell + fall), rand(900, 1500)], [1, 350]], Q: 0.6, a: swell, dur: fall, gain: 1.4 });
  k.noise({ at: swell - 0.25, color: 'white', type: 'highpass', f: 1600, a: 0.35, dur: rand(1.8, 2.6), gain: 0.35 });
}

const AMB = {
  wind: {
    vol: 1.4,
    build(L) {
      L.gusts = [];
      for (const side of [-1, 1]) {
        const bp = L.filter('bandpass', 500, 1.0), g = L.gain(0.6), p = L.pan(side * 0.55);
        L.chain(L.loop(L.e._noise.pink, rand(0.9, 1.1)), bp, g, p, L.dry);
        L.send(p, 0.25);
        L.gusts.push({ bp, g });
      }
      const wbp = L.filter('bandpass', 900, 14), wg = L.gain(0);
      L.chain(L.loop(L.e._noise.white), wbp, wg, L.dry);
      L.send(wg, 0.4);
      L.whistle = { bp: wbp, g: wg };
    },
    tick(L, now, h) {
      L.every('gust', now, h, () => rand(1.2, 4), (t) => {
        const lv = L.level;
        for (const c of L.gusts) {
          c.bp.frequency.setTargetAtTime(rand(260, 700) * (1 + lv * 0.9), t, rand(0.7, 2));
          c.g.gain.setTargetAtTime(rand(0.15, 1), t, rand(0.5, 1.8));
        }
        L.whistle.bp.frequency.setTargetAtTime(rand(550, 1500), t, 2);
        L.whistle.g.gain.setTargetAtTime(chance(0.45) ? rand(1.5, 4) * lv * lv : 0, t, 1.2);
      });
    },
  },

  rain: {
    vol: 0.55,
    build(L) {
      L.hiss = [];
      for (const side of [-1, 1]) {
        const lp = L.filter('lowpass', 5000, 0.5), p = L.pan(side * 0.5);
        L.chain(L.loop(L.e._noise.pink, rand(0.95, 1.05)), L.filter('highpass', 450, 0.5), lp, L.gain(0.8), p, L.dry);
        L.send(p, 0.2);
        L.hiss.push(lp);
      }
      L.texG = L.gain(0.5);
      L.chain(L.loop(L.e._tex('rain')), L.texG, L.dry);
    },
    tick(L, now, h) {
      if (L.st.lv !== L.level) { // drizzle -> downpour: brighter and denser
        L.st.lv = L.level;
        for (const lp of L.hiss) lp.frequency.setTargetAtTime(2500 + 5000 * L.level, now, 1);
        L.texG.gain.setTargetAtTime(0.25 + 0.5 * L.level, now, 1);
      }
      L.every('drip', now, h, () => rand(0.12, 0.7) / (0.3 + L.level), (t) => L.ev(t, { pan: rand(-0.9, 0.9), wet: 0.3, gain: rand(0.3, 1) }, (k) => {
        const f = rand(1400, 3000);
        k.tone({ f, f2: f * 1.7, glide: 0.02, dur: 0.035, a: 0.002, gain: 0.08 });
      }));
    },
  },

  night: {
    vol: 0.6,
    build(L) {
      L.chain(L.loop(L.e._noise.brown), L.filter('lowpass', 320, 0.5), L.gain(0.35), L.dry);
      const g1 = L.gain(0.5), g2 = L.gain(0.3);
      L.chain(L.loop(L.e._tex('crickets'), 1), g1, L.dry);
      L.chain(L.loop(L.e._tex('crickets'), 0.93), g2, L.dry);
      L.send(g1, 0.3);
      L.send(g2, 0.5);
      L.chorus = [g1, g2];
    },
    tick(L, now, h) {
      L.every('owl', now, h, () => rand(14, 38), (t) => {
        if (chance(0.7)) L.ev(t, { pan: rand(-0.8, 0.8), wet: 1.2, gain: rand(0.25, 0.5) }, (k) => owl(k, 0, 1));
      });
      L.every('chorus', now, h, () => rand(3, 8), (t) => { // crickets swell and hush
        L.chorus[0].gain.setTargetAtTime(rand(0.3, 0.6), t, 1.5);
        L.chorus[1].gain.setTargetAtTime(rand(0.1, 0.4), t, 1.5);
      });
    },
  },

  day: {
    vol: 0.9,
    build(L) {
      L.rustle = L.gain(0.1);
      L.chain(L.loop(L.e._noise.pink), L.filter('bandpass', 2600, 0.6), L.rustle, L.dry);
    },
    tick(L, now, h) {
      L.every('bird', now, h, () => rand(1.0, 4.5) / (0.4 + L.level), (t) => L.ev(t, { pan: rand(-0.85, 0.85), wet: 0.35, gain: rand(0.35, 1) }, (k) => birdCall(k, 0, 1)));
      L.every('rustle', now, h, () => rand(1.5, 4), (t) => L.rustle.gain.setTargetAtTime(rand(0.03, 0.16), t, 1.2));
    },
  },

  sea: {
    vol: 0.6,
    build(L) {
      L.chain(L.loop(L.e._noise.brown), L.filter('lowpass', 220, 0.5), L.gain(0.6), L.dry);
    },
    tick(L, now, h) {
      L.every('wave', now, h, () => rand(3.5, 7), (t) => L.ev(t, { pan: rand(-0.5, 0.5), wet: 0.25, gain: rand(0.5, 1) }, seaWave));
    },
  },

  fire: {
    vol: 0.45,
    build(L) {
      const rlp = L.filter('lowpass', 200, 0.7), rg = L.gain(0.9);
      L.chain(L.loop(L.e._noise.brown), rlp, rg, L.dry);
      L.hissG = L.gain(0.12);
      L.chain(L.loop(L.e._noise.pink), L.filter('bandpass', 1500, 0.7), L.hissG, L.dry);
      const cg = L.gain(0.45);
      L.chain(L.loop(L.e._crackle), L.filter('highpass', 700, 0.7), cg, L.dry);
      L.send(cg, 0.15);
      L.roar = { lp: rlp, g: rg };
    },
    tick(L, now, h) {
      L.every('flicker', now, h, () => rand(0.15, 0.5), (t) => {
        L.roar.g.gain.setTargetAtTime(rand(0.5, 1.1), t, 0.12);
        L.roar.lp.frequency.setTargetAtTime(rand(140, 340), t, 0.15);
        L.hissG.gain.setTargetAtTime(rand(0.06, 0.16), t, 0.2);
      });
      L.every('pop', now, h, () => rand(0.35, 2.2), (t) => L.ev(t, { pan: rand(-0.4, 0.4), wet: 0.15, gain: rand(0.4, 1) }, (k) => {
        k.noise({ color: 'white', type: 'bandpass', f: rand(1200, 3600), Q: 1.4, a: 0.001, dur: rand(0.02, 0.06), gain: 1.4 });
        if (chance(0.3)) k.tone({ f: rand(90, 140), f2: 60, dur: 0.05, a: 0.002, gain: 0.15 });
        if (chance(0.12)) k.noise({ at: 0.03, color: 'white', type: 'highpass', f: 4000, a: 0.05, dur: rand(0.3, 0.7), gain: 0.12 });
      }));
    },
  },

  storm: {
    vol: 0.8,
    build(L) {
      L.rumble = L.gain(0.8);
      L.chain(L.loop(L.e._noise.brown), L.filter('lowpass', 95, 0.7), L.rumble, L.dry);
      L.roarBp = L.filter('bandpass', 320, 0.5);
      L.roarG = L.gain(0.35);
      L.chain(L.loop(L.e._noise.pink, 0.9), L.roarBp, L.roarG, L.dry);
      L.send(L.roarG, 0.3);
    },
    tick(L, now, h) {
      L.every('swell', now, h, () => rand(2, 5), (t) => {
        L.rumble.gain.setTargetAtTime(rand(0.4, 1.1), t, 1.2);
        L.roarG.gain.setTargetAtTime(rand(0.15, 0.45), t, 1);
        L.roarBp.frequency.setTargetAtTime(rand(220, 480), t, 1.5);
      });
      L.every('thunder', now, h, () => rand(10, 28) / Math.max(0.3, L.level), (t) => {
        if (L.level > 0.15) L.ev(t, { pan: rand(-0.7, 0.7), wet: 0.9, gain: 1 }, (k) => thunderRecipe(k, rand(0.15, 0.45)));
      });
    },
  },

  mist: {
    vol: 0.25,
    build(L) {
      const lp = L.filter('lowpass', 420, 0.7), breathe = L.gain(0.8), g = L.gain(0.1);
      for (const [f, type] of [[73.42, 'sine'], [73.42 * 1.0071, 'sine'], [110, 'triangle'], [220.5, 'sine']]) L.osc(type, f).connect(lp);
      L.chain(lp, breathe, g, L.dry);
      L.send(g, 0.6);
      L.chain(L.osc('sine', rand(0.05, 0.08)), L.gain(0.3)).connect(breathe.gain);
      const n = L.loop(L.e._noise.white), b1 = L.filter('bandpass', 700, 9), b2 = L.filter('bandpass', 1900, 9);
      const wg = L.gain(0), wp = L.pan(0);
      n.connect(b1); n.connect(b2); b1.connect(wg); b2.connect(wg);
      L.chain(wg, wp, L.dry);
      L.send(wp, 0.8);
      L.wh = { b1, b2, g: wg, p: wp };
    },
    tick(L, now, h) {
      L.every('whisper', now, h, () => rand(0.8, 2.5), (t) => {
        L.wh.b1.frequency.setTargetAtTime(rand(450, 950), t, 0.6);
        L.wh.b2.frequency.setTargetAtTime(rand(1400, 2700), t, 0.6);
        L.wh.g.gain.setTargetAtTime(Math.pow(Math.random(), 2) * 2.5, t, 0.5);
        L.wh.p.pan.setTargetAtTime(rand(-0.8, 0.8), t, 1.5);
      });
      L.every('sigh', now, h, () => rand(8, 20), (t) => L.ev(t, { pan: rand(-0.8, 0.8), wet: 1, gain: rand(0.3, 0.7) }, (k) => {
        const f = rand(500, 800);
        k.noise({ color: 'pink', type: 'bandpass', fpath: [[0, f], [1, f * 0.7]], Q: 6, a: rand(0.6, 1), dur: rand(0.8, 1.4), gain: 1.5 });
        k.tone({ f: rand(880, 1320), f2: rand(700, 900), a: 0.8, dur: 1.2, gain: 0.008 });
      }));
    },
  },

  cave: {
    vol: 0.5,
    build(L) {
      const g = L.gain(0.9);
      L.chain(L.loop(L.e._noise.brown), L.filter('bandpass', 110, 1.4), g, L.dry);
      L.send(g, 0.4);
    },
    tick(L, now, h) {
      L.every('drip', now, h, () => rand(0.6, 2.8), (t) => L.ev(t, { pan: rand(-0.7, 0.7), wet: 1.3, gain: rand(0.4, 1) }, (k) => {
        const f = rand(1100, 2400);
        k.tone({ f, f2: f * 1.9, glide: 0.018, dur: 0.07, a: 0.002, gain: 0.12 });
      }));
    },
  },
};

// ---------------------------------------------------------------------------
// 6. Generative music
// ---------------------------------------------------------------------------
// Each mood is played by a Performer: it plans one bar at a time (chords
// from a progression pool, phrase-based melodies, drums, bass, occasional
// bells and bowed notes) into a small event queue, and dispatches those
// events just before they are due.  Moods crossfade by ramping the
// performers' output gains.

const MODES = {
  dorian: [0, 2, 3, 5, 7, 9, 10],
  aeolian: [0, 2, 3, 5, 7, 8, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
};
// chord shapes in scale steps above the chord root
const CHORDS = { tri: [0, 2, 4], sus2: [0, 1, 4], sus4: [0, 3, 4], add9: [0, 2, 4, 8], sev: [0, 2, 4, 6], pow: [0, 4, 7] };

function degMidi(key, mode, deg) {
  const n = mode.length, o = Math.floor(deg / n);
  return key + 12 * o + mode[deg - o * n];
}
const pc7 = (d) => ((d % 7) + 7) % 7;
const isTone = (deg, tones) => tones.includes(pc7(deg));
function nearestTone(deg, tones) {
  for (const d of [0, 1, -1, 2, -2, 3, -3]) if (isTone(deg + d, tones)) return deg + d;
  return deg;
}
// melodic step: mostly stepwise, leaps are followed by a step back
function pickStep(last, deg, center) {
  if (Math.abs(last) >= 3) return -Math.sign(last) * weighted([1, 2], [0.7, 0.3]);
  let s = weighted([-1, 1, -2, 2, 0, -3, 3, -4, 4], [0.3, 0.3, 0.12, 0.12, 0.03, 0.045, 0.045, 0.02, 0.02]);
  if (deg - center > 3 && s > 0 && chance(0.5)) s = -s;
  if (center - deg > 3 && s < 0 && chance(0.5)) s = -s;
  return s;
}
// phrase ending: "answers" land on the tonic, "questions" on the 5th/2nd
function cadenceDeg(deg, tones, answer, lo, hi) {
  let pc;
  if (answer) pc = tones.includes(0) ? 0 : tones.includes(2) ? 2 : tones[0];
  else pc = tones.includes(4) ? 4 : tones.includes(1) ? 1 : tones.find((t) => t !== 0) ?? tones[0];
  let best = deg, bd = 1e9;
  for (let o = -3; o <= 3; o++) {
    const c = pc + 7 * o;
    if (c < lo - 1 || c > hi + 1) continue;
    if (Math.abs(c - deg) < bd) { bd = Math.abs(c - deg); best = c; }
  }
  return best;
}

// rhythm cells in beats (negative = rest); CADENCE cells end a phrase
const CELLS = {
  slow: [[2, 2], [3, 1], [4], [2, -1, 1], [1.5, 0.5, 2], [-2, 2], [1, 1, 2], [-1, 1, 2]],
  flow: [[1, 1, 1, 1], [1.5, 0.5, 1, 1], [2, 1, 1], [1, 0.5, 0.5, 2], [0.5, 0.5, 1, 2], [1, 1, 2], [-1, 1, 1, 1], [1.5, 0.5, 2]],
  sparse: [[4], [-2, 2], [3, -1], [-1, 3], [2, 2], [-4]],
  drive: [[0.5, 0.5, 1, 0.5, 0.5, 1], [1, 0.5, 0.5, 1, 1], [0.5, 0.5, 0.5, 0.5, 2], [1.5, 0.5, 1.5, 0.5], [1, 1, 0.5, 0.5, 1]],
};
const CADENCE = {
  slow: [[2, 2], [4], [1, 3]],
  flow: [[1, 1, 2], [2, 2], [1.5, 0.5, 2], [4]],
  sparse: [[4], [-2, 2]],
  drive: [[1, 1, 2], [0.5, 0.5, 1, 2], [2, 2]],
};

// Mood table.  key = MIDI tonic; lyre/bells degrees are relative to key+oct.
const MOODS = {
  title: {
    key: 57, mode: 'aeolian', bpm: 58, chordBars: 2, phrase: 4, phraseRest: 0.3, fade: 4, hall: 0.7, echo: 0.3,
    prog: [
      [[0, 'add9'], [5, 'sev'], [2, 'tri'], [6, 'sus2']],
      [[0, 'tri'], [3, 'sev'], [5, 'sev'], [4, 'sus4']],
      [[5, 'sev'], [6, 'tri'], [0, 'add9'], [0, 'sus2']],
    ],
    drone: { gain: 0.05, notes: [-24, -17], type: 'sine', cutoff: 500 },
    pad: { gain: 0.032, center: 55, attack: 4, release: 4, cutoff: 900, wave: 'warm', choir: 0.35 },
    lyre: { gain: 0.84, oct: 12, lo: -3, hi: 8, cells: 'slow', bright: 0.3, hall: 0.8, echo: 0.45 },
    bells: { gain: 0.18, every: [6, 14], degs: [0, 2, 4, 7], oct: 24 },
    bow: { gain: 0.08, every: [4, 8], len: [4, 8], lo: -7, hi: 2 },
  },
  day: {
    key: 62, mode: 'dorian', bpm: 78, chordBars: 1, phrase: 4, phraseRest: 0.2, fade: 3, hall: 0.45, echo: 0.2,
    prog: [
      [[0, 'tri'], [3, 'tri'], [0, 'sus2'], [6, 'tri']],
      [[0, 'tri'], [2, 'tri'], [6, 'tri'], [3, 'tri']],
      [[0, 'add9'], [4, 'tri'], [6, 'tri'], [0, 'tri']],
      [[2, 'sev'], [3, 'tri'], [0, 'sus4'], [0, 'tri']],
    ],
    drone: { gain: 0.056, notes: [-24, -17], type: 'triangle', cutoff: 450 },
    pad: { gain: 0.036, center: 57, attack: 1.8, release: 2.5, cutoff: 1100, wave: 'warm' },
    lyre: { gain: 0.95, oct: 0, lo: -2, hi: 9, cells: 'flow', bright: 0.55 },
    arp: { gain: 0.34, oct: -12, prob: 0.55, bright: 0.45, patterns: [[0, 1, 2, 1, 3, 1, 2, 1], [0, 2, 1, 2, 3, 2, 1, 2], [0, -1, 1, 2, 3, -1, 2, 1]] },
    bass: { type: 'pluck', gain: 0.4, oct: -24, steps: 8, pattern: [0, null, null, null, null, 7, null, null] },
    drums: { gain: 0.5, every: 2, boom: [0.6, 0, 0, 0.35, 0, 0, 0, 0, 0.4, 0, 0, 0, 0, 0, 0, 0] },
    bells: { gain: 0.15, every: [10, 20], degs: [0, 2, 4, 7, 9], oct: 12 },
    bow: { gain: 0.066, every: [8, 16], len: [3, 6], lo: -5, hi: 2 },
  },
  dusk: {
    key: 64, mode: 'phrygian', bpm: 66, chordBars: 2, phrase: 4, phraseRest: 0.35, fade: 4, hall: 0.6, echo: 0.3,
    prog: [
      [[0, 'tri'], [1, 'tri'], [0, 'sus4'], [6, 'tri']],
      [[0, 'tri'], [3, 'tri'], [1, 'sev'], [0, 'tri']],
      [[5, 'tri'], [1, 'tri'], [6, 'tri'], [0, 'tri']],
    ],
    drone: { gain: 0.05, notes: [-24, -17], type: 'sine', cutoff: 400 },
    pad: { gain: 0.033, center: 59, attack: 3, release: 3, cutoff: 650, wave: 'triangle' },
    lyre: { gain: 0.8, oct: 0, lo: -3, hi: 7, cells: 'slow', bright: 0.35 },
    bells: { gain: 0.12, every: [12, 24], degs: [0, 1, 4, 6, 7], oct: 12 },
    bow: { gain: 0.08, every: [4, 8], len: [4, 7], lo: -7, hi: 1 },
  },
  night: {
    key: 57, mode: 'aeolian', bpm: 54, chordBars: 4, phrase: 4, phraseRest: 0.6, fade: 5, hall: 0.8, echo: 0.4,
    prog: [[[0, 'add9'], [5, 'sev'], [3, 'sev'], [4, 'sus4']]],
    drone: { gain: 0.042, notes: [-24, -17, -12], type: 'sine', cutoff: 380 },
    pad: { gain: 0.017, center: 57, attack: 5, release: 5, cutoff: 600, wave: 'warm' },
    lyre: { gain: 0.55, oct: 12, lo: 0, hi: 9, cells: 'sparse', bright: 0.3 },
    bells: { gain: 0.14, every: [3, 9], degs: [0, 2, 3, 4, 6, 7], oct: 24 },
    bow: { gain: 0.065, every: [4, 10], len: [5, 10], lo: -7, hi: 0 },
    drums: { gain: 0.3, every: 8, prob: 0.4, boom: [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
  },
  combat: {
    key: 50, mode: 'aeolian', bpm: 120, chordBars: 1, phrase: 2, phraseRest: 0.25, fade: 0.8, hall: 0.25, echo: 0.12,
    prog: [
      [[0, 'pow'], [0, 'pow'], [5, 'pow'], [6, 'pow']],
      [[0, 'pow'], [6, 'pow'], [5, 'pow'], [6, 'pow']],
      [[0, 'pow'], [3, 'pow'], [5, 'pow'], [4, 'pow']],
    ],
    drone: { gain: 0.05, notes: [-12], type: 'sawtooth', cutoff: 300 },
    pad: { gain: 0.04, center: 50, attack: 0.25, release: 0.6, cutoff: 1000, wave: 'sawtooth', low: false },
    lyre: { gain: 0.8, oct: 12, lo: -2, hi: 8, cells: 'drive', bright: 0.7 },
    bass: { type: 'saw', gain: 0.24, oct: -12, steps: 8, len: 0.7, pattern: [0, 0, 12, 0, 7, 0, 12, 7] },
    drums: {
      gain: 1.0,
      boom: [1, 0, 0, 0, 0, 0, 0.7, 0, 1, 0, 0, 0, 0, 0, 0.6, 0],
      tak: [0, 0, 0.5, 0, 0.9, 0, 0, 0.4, 0, 0, 0.5, 0, 0.9, 0, 0.3, 0.5],
      fill: [0, 0, 0.5, 0, 0.9, 0, 0.4, 0.4, 0.6, 0, 0.6, 0.5, 0.9, 0.6, 0.8, 1],
    },
    bow: { gain: 0.075, every: [2, 4], len: [3, 6], lo: -7, hi: 0 },
  },
  boss: {
    key: 50, mode: 'phrygian', bpm: 138, chordBars: 1, phrase: 2, phraseRest: 0.35, fade: 0.6, hall: 0.3, echo: 0.1,
    prog: [
      [[0, 'pow'], [1, 'pow'], [0, 'pow'], [6, 'pow']],
      [[0, 'pow'], [5, 'pow'], [1, 'pow'], [0, 'pow']],
    ],
    drone: { gain: 0.085, notes: [-24, -12], type: 'sawtooth', cutoff: 250 },
    pad: { gain: 0.05, center: 50, attack: 0.4, release: 0.8, cutoff: 900, wave: 'sawtooth', choir: 0.6, low: false },
    lyre: { gain: 0.75, oct: 12, lo: -3, hi: 6, cells: 'drive', bright: 0.8 },
    bass: { type: 'saw', gain: 0.27, oct: -12, steps: 16, len: 0.8, pattern: [0, 0, 12, 0, 0, 0, 12, 0, 0, 0, 12, 0, 7, 0, 12, 7] },
    drums: {
      gain: 0.55,
      boom: [1, 0, 0.5, 0, 0.8, 0, 0.5, 0, 1, 0, 0.5, 0, 0.8, 0.4, 0.6, 0.5],
      tak: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0.6],
      taiko: [1, 0, 0, 0, 0, 0, 0, 0, 0.8, 0, 0, 0, 0, 0, 0, 0],
      fill: [0, 0, 0.5, 0, 1, 0, 0.5, 0, 0.7, 0.5, 0.7, 0.5, 1, 0.7, 0.9, 1],
    },
    bow: { gain: 0.1, every: [2, 3], len: [3, 7], lo: -7, hi: 3 },
  },
  victory: {
    key: 62, mode: 'mixolydian', bpm: 72, chordBars: 2, phrase: 4, phraseRest: 0.35, fade: 1.2, hall: 0.55, echo: 0.25,
    prog: [
      [[0, 'tri'], [3, 'tri'], [0, 'sus2'], [6, 'tri']],
      [[0, 'add9'], [3, 'tri'], [6, 'tri'], [0, 'tri']],
      [[0, 'tri'], [4, 'sev'], [3, 'tri'], [0, 'sus4']],
    ],
    drone: { gain: 0.048, notes: [-24, -17], type: 'triangle', cutoff: 450 },
    pad: { gain: 0.034, center: 57, attack: 2, release: 3, cutoff: 1200, wave: 'warm', choir: 0.25 },
    lyre: { gain: 0.72, oct: 0, lo: -2, hi: 9, cells: 'slow', bright: 0.55 },
    bells: { gain: 0.14, every: [8, 16], degs: [0, 2, 4, 7, 9], oct: 12 },
    // fanfare: bVI - bVII - I (Bb - C - D) before the generative part settles in
    script(P, t) {
      const B = P.beat, bar = P.barDur;
      const seq = [
        { chord: [46, 50, 53, 58], arp: [58, 62, 65, 70] },
        { chord: [48, 52, 55, 60], arp: [60, 64, 67, 72] },
        { chord: [50, 54, 57, 62], arp: [62, 66, 69, 74] },
      ];
      seq.forEach((s, i) => {
        const t0 = t + i * bar;
        P.q(t0, (tt) => P.pad(tt, { notes: s.chord, low: s.chord[0] - 12 }, i === 2 ? bar * 2 : bar));
        s.arp.forEach((m, j) => P.q(t0 + j * B * 0.5, (tt) => P.pluckTo(tt, m, 0.55 * (1 - j * 0.05), 0.6, P.ch.lyre)));
      });
      const tD = t + 2 * bar;
      P.q(tD, (tt) => P.drum(tt, 'boom', 0.45));
      P.q(tD + 2 * B, (tt) => P.pluckTo(tt, 81, 0.6, 0.65, P.ch.lyre));
      P.q(tD + 3 * B, (tt) => P.pluckTo(tt, 86, 0.55, 0.65, P.ch.lyre));
      P.q(tD + 2 * B, (tt) => P.bell(tt, 90, 0.9));
      return 4;
    },
  },
};

class Performer {
  constructor(eng, name, t0) {
    const ctx = eng.ctx, m = MOODS[name];
    this.e = eng;
    this.ctx = ctx;
    this.name = name;
    this.m = m;
    this.mode = MODES[m.mode];
    this.beat = 60 / m.bpm;
    this.barDur = this.beat * 4;
    this.dead = false;
    this.killAt = Infinity;
    this.srcs = [];
    this.persist = [];
    // crossfade gains: dry, hall send, echo send
    const bus = eng.bus.music;
    this.fades = [ctx.createGain(), ctx.createGain(), ctx.createGain()];
    this.fades[0].connect(bus.in);
    this.fades[1].connect(bus.hall);
    this.fades[2].connect(eng._echoIn);
    for (const f of this.fades) {
      f.gain.setValueAtTime(0, t0);
      f.gain.setTargetAtTime(1, t0, m.fade / 3);
    }
    // per-instrument channel strips: [dry, hall, echo]
    const L = m.lyre || {};
    const strips = {
      lyre: [1, L.hall ?? m.hall, L.echo ?? m.echo], arp: [1, m.hall * 0.8, m.echo * 0.3],
      pad: [1, m.hall, m.echo * 0.3], drone: [1, m.hall * 0.6, 0], drum: [1, m.hall * 0.5, 0],
      bass: [1, m.hall * 0.3, 0], bow: [1, m.hall, m.echo * 0.5], bell: [1, m.hall * 1.3, m.echo * 1.5],
    };
    this.ch = {};
    for (const [k, [dry, hall, echo]] of Object.entries(strips)) this.ch[k] = this.strip(dry, hall, echo);
    // score state
    this.bar = 0;
    this.next = t0 + 0.08;
    this.queue = [];
    this.dirty = false;
    this.timeline = [];
    this.prog = null;
    this.melDeg = 0;
    this.phraseNo = 0;
    this.phrase = null;
    this.lastVoicing = null;
    this.nextBell = t0 + (m.bells ? rand(m.bells.every[0], m.bells.every[1]) * 0.5 : 0);
    this.nextBowBar = m.bow ? irand(1, m.bow.every[1]) : Infinity;
    this.scriptBars = 0;
    if (m.drone) this.startDrone(t0);
    if (m.script) {
      this.scriptBars = m.script(this, this.next);
      for (let i = 0; i < this.scriptBars; i++) this.timeline.push({ deg: 0, type: 'tri', start: 0, len: this.scriptBars, tones: [0, 2, 4] });
    }
    this.warm();
  }

  strip(dry, hall, echo) {
    const ctx = this.ctx, inp = ctx.createGain();
    this.persist.push(inp);
    [[dry, 0], [hall, 1], [echo, 2]].forEach(([lvl, i]) => {
      if (!(lvl > 0)) return;
      const g = ctx.createGain();
      g.gain.value = lvl;
      inp.connect(g);
      g.connect(this.fades[i]);
      this.persist.push(g);
    });
    return inp;
  }

  // queue pluck buffers this mood will need so they render between frames
  warm() {
    const m = this.m, notes = new Set();
    if (m.lyre) for (let d = m.lyre.lo; d <= m.lyre.hi; d++) notes.add([degMidi(m.key + m.lyre.oct, this.mode, d), m.lyre.bright]);
    if (m.arp) for (let d = 0; d < 10; d++) notes.add([degMidi(m.key + m.arp.oct, this.mode, d), m.arp.bright]);
    this.e._warmPlucks([...notes]);
  }

  q(t, fn) {
    this.queue.push({ t, fn });
    this.dirty = true;
  }

  tick(now, horizon) {
    if (this.dead) return;
    if (this.next < now - 1) this.next = now + 0.05; // fell far behind: skip ahead
    let guard = 0;
    while (this.next < now + horizon + 0.1 && guard++ < 4) {
      this.planBar(this.bar, this.next);
      this.bar++;
      this.next += this.barDur;
    }
    if (this.dirty) {
      this.queue.sort((a, b) => a.t - b.t);
      this.dirty = false;
    }
    let i = 0;
    while (i < this.queue.length && this.queue[i].t < now + horizon) {
      const ev = this.queue[i++];
      if (ev.t > now - 0.06) {
        try { ev.fn(Math.max(ev.t, now + 0.003)); } catch (e) { this.e._warn(e); }
      }
    }
    if (i) this.queue.splice(0, i);
  }

  fadeOut(now, dur) {
    if (this.dead) return;
    this.dead = true;
    this.queue.length = 0;
    for (const f of this.fades) {
      f.gain.cancelScheduledValues(now);
      f.gain.setValueAtTime(f.gain.value, now);
      f.gain.linearRampToValueAtTime(0, now + dur);
    }
    this.killAt = now + dur + 0.3;
  }

  // undo a fade-out still in progress (e.g. combat <-> night flapping)
  revive(now, dur) {
    this.dead = false;
    this.killAt = Infinity;
    for (const f of this.fades) {
      f.gain.cancelScheduledValues(now);
      f.gain.setValueAtTime(f.gain.value, now);
      f.gain.linearRampToValueAtTime(1, now + dur);
    }
  }

  dispose() {
    for (const s of this.srcs) { try { s.stop(); } catch { /* not started */ } }
    for (const n of [...this.persist, ...this.fades]) { try { n.disconnect(); } catch { /* gone */ } }
    this.srcs = [];
    this.persist = [];
  }

  // --- score ---------------------------------------------------------------

  chordAt(bar) {
    let guard = 0;
    while (this.timeline.length <= bar && guard++ < 64) this.extend();
    return this.timeline[Math.min(bar, this.timeline.length - 1)];
  }

  extend() {
    const m = this.m;
    if (!this.prog || !chance(0.5)) this.prog = pick(m.prog);
    for (const [deg, type] of this.prog) {
      const c = { deg, type, start: this.timeline.length, len: m.chordBars, tones: CHORDS[type].filter((s) => s < 7).map((s) => pc7(deg + s)) };
      for (let i = 0; i < m.chordBars; i++) this.timeline.push(c);
    }
  }

  planBar(bar, t) {
    const m = this.m, B = this.beat;
    if (m.bells && bar >= this.scriptBars) { // free-running bells (not over a scripted fanfare)
      if (this.nextBell < t - 1) this.nextBell = t + rand(0, m.bells.every[0]);
      while (this.nextBell < t + this.barDur) {
        const bt = Math.max(this.nextBell, t);
        const midi = degMidi(m.key + m.bells.oct, this.mode, pick(m.bells.degs));
        this.q(bt, (tt) => this.bell(tt, midi, rand(0.6, 1)));
        this.nextBell += rand(m.bells.every[0], m.bells.every[1]);
      }
    }
    if (bar < this.scriptBars) return;
    const ch = this.chordAt(bar);
    if (ch.start === bar && m.pad) {
      const v = this.voicing(ch), dur = ch.len * this.barDur;
      this.q(t, (tt) => this.pad(tt, v, dur));
    }
    if (m.lyre) {
      if ((bar - this.scriptBars) % m.phrase === 0) this.phrase = this.phraseNo > 0 && chance(m.phraseRest) ? null : this.makePhrase(bar, m.phrase);
      if (this.phrase) {
        for (const n of this.phrase) {
          if (n.bar !== bar) continue;
          const midi = degMidi(m.key + m.lyre.oct, this.mode, n.deg);
          this.q(t + n.beat * B + rand(-0.008, 0.008), (tt) => this.pluckTo(tt, midi, m.lyre.gain * n.vel, m.lyre.bright, this.ch.lyre, rand(-0.2, 0.2)));
        }
      }
    }
    if (m.arp && chance(m.arp.prob)) this.planArp(t, ch);
    if (m.bass) this.planBass(t, ch);
    if (m.drums) this.planDrums(bar, t);
    if (m.bow && bar >= this.nextBowBar) {
      this.planBow(t, ch);
      this.nextBowBar = bar + irand(m.bow.every[0], m.bow.every[1]);
    }
  }

  makePhrase(bar0, nBars) {
    const L = this.m.lyre, cells = CELLS[L.cells], cads = CADENCE[L.cells];
    const rA = pick(cells), rB = pick(cells), rEnd = pick(cads);
    const rhythm = nBars >= 4 ? [rA, rB, rA, rEnd] : nBars === 2 ? [rA, rEnd] : [rEnd];
    const answer = this.phraseNo++ % 2 === 1;
    const center = (L.lo + L.hi) / 2;
    const notes = [], motif = [];
    let deg = clamp(this.melDeg, L.lo, L.hi), last = 0;
    for (let b = 0; b < nBars; b++) {
      const bar = bar0 + b, ch = this.chordAt(bar), cell = rhythm[b];
      const reuse = nBars >= 4 && b === 2 ? motif.slice() : null; // bar 3 echoes bar 1's contour
      const heads = cell.filter((d) => d > 0).length;
      let beat = 0, idx = 0;
      for (const dur of cell) {
        if (dur < 0) { beat -= dur; continue; }
        const strong = beat % 2 === 0;
        const final = b === nBars - 1 && idx === heads - 1;
        const prev = deg;
        if (!notes.length) deg = nearestTone(deg, ch.tones);
        else if (reuse && idx > 0 && reuse.length) deg += reuse.shift();
        else {
          const step = pickStep(last, deg, center);
          deg += step;
          if ((strong || idx === 0) && !isTone(deg, ch.tones) && chance(0.75)) {
            deg = nearestTone(deg, ch.tones);
            // snapping must not collapse the step into a repeated note
            if (deg === prev && step !== 0) for (let d = 1; d <= 3; d++) if (isTone(prev + Math.sign(step) * d, ch.tones)) { deg = prev + Math.sign(step) * d; break; }
          }
        }
        if (deg > L.hi) deg -= 2;
        if (deg < L.lo) deg += 2;
        deg = clamp(deg, L.lo, L.hi);
        if (final) deg = cadenceDeg(deg, ch.tones, answer, L.lo, L.hi);
        if (b === 0 && idx > 0) motif.push(deg - prev);
        last = deg - prev;
        notes.push({ bar, beat, dur, deg, vel: (strong ? 0.9 : 0.68) * rand(0.9, 1.05) });
        beat += dur;
        idx++;
      }
    }
    // approach the final note by step (from above if it was a repeat)
    if (notes.length >= 2) {
      const f = notes[notes.length - 1], p = notes[notes.length - 2];
      if (Math.abs(p.deg - f.deg) > 2 || p.deg === f.deg) p.deg = f.deg + (p.deg >= f.deg ? 1 : -1);
    }
    if (notes.length) this.melDeg = notes[notes.length - 1].deg;
    return notes;
  }

  // voice-led pad chord near pad.center (+ optional low root)
  voicing(ch) {
    const m = this.m, P = m.pad;
    let notes = CHORDS[ch.type].map((s) => degMidi(m.key, this.mode, ch.deg + s));
    while (notes[0] > P.center) notes = notes.map((n) => n - 12);
    while (notes[0] < P.center - 12) notes = notes.map((n) => n + 12);
    const cands = [];
    for (let r = 0; r < notes.length; r++) {
      const c = notes.map((n, i) => (i < r ? n + 12 : n)).sort((a, b) => a - b);
      if (new Set(c).size === c.length) cands.push(c, c.map((n) => n - 12)); // no doubled notes
    }
    const prev = this.lastVoicing;
    let best = notes, bd = Infinity;
    for (const c of cands) {
      if (c[0] < P.center - 10 || c[c.length - 1] > P.center + 12) continue;
      const mid = c.reduce((a, n) => a + n, 0) / c.length;
      const d = (prev ? c.reduce((s, n, i) => s + Math.abs(n - (prev[i] ?? prev[prev.length - 1])), 0) : 0) + Math.abs(mid - P.center) * 2;
      if (d < bd) { bd = d; best = c; }
    }
    this.lastVoicing = best;
    let low = degMidi(m.key, this.mode, ch.deg);
    while (low > P.center - 12) low -= 12;
    while (low < P.center - 24) low += 12;
    return { notes: best, low: P.low === false ? null : low };
  }

  planArp(t, ch) {
    const A = this.m.arp, m = this.m;
    const tones = CHORDS[ch.type].filter((s) => s < 7).map((s) => degMidi(m.key + A.oct, this.mode, ch.deg + s));
    tones.push(tones[0] + 12);
    pick(A.patterns).forEach((ix, i) => {
      if (ix < 0) return;
      const midi = tones[ix % tones.length];
      this.q(t + i * this.beat * 0.5 + rand(-0.006, 0.006), (tt) => this.pluckTo(tt, midi, A.gain * (i % 2 ? 0.75 : 1) * rand(0.85, 1), A.bright, this.ch.arp, rand(-0.35, 0.35)));
    });
  }

  planBass(t, ch) {
    const Bs = this.m.bass, m = this.m, stepDur = this.barDur / Bs.steps;
    let root = degMidi(m.key + Bs.oct, this.mode, ch.deg);
    while (root > m.key + Bs.oct + 6) root -= 12;
    Bs.pattern.forEach((semi, i) => {
      if (semi == null) return;
      const midi = root + semi, accent = i % 4 === 0 ? 1 : 0.78;
      this.q(t + i * stepDur, (tt) => {
        if (Bs.type === 'pluck') this.pluckTo(tt, midi, Bs.gain * accent, 0.35, this.ch.bass);
        else this.bassNote(tt, midi, stepDur * (Bs.len || 0.8), Bs.gain * accent);
      });
    });
  }

  planDrums(bar, t) {
    const D = this.m.drums, step = this.barDur / 16;
    if (D.every && bar % D.every !== 0) return;
    if (D.prob != null && !chance(D.prob)) return;
    const tak = D.fill && bar % 4 === 3 ? D.fill : D.tak;
    for (let i = 0; i < 16; i++) {
      const tt = t + i * step + rand(-0.004, 0.004);
      const b = D.boom?.[i] || 0, k = tak?.[i] || 0, tk = D.taiko?.[i] || 0;
      if (b) this.q(tt, (x) => this.drum(x, 'boom', b * D.gain * rand(0.85, 1)));
      if (k) this.q(tt, (x) => this.drum(x, 'tak', k * D.gain * rand(0.8, 1)));
      if (tk) this.q(tt, (x) => this.drum(x, 'taiko', tk * D.gain));
    }
  }

  planBow(t, ch) {
    const B = this.m.bow, m = this.m;
    const deg = nearestTone(irand(B.lo, B.hi), ch.tones);
    const beats = irand(B.len[0], B.len[1]);
    this.q(t + pick([0, 1, 2]) * this.beat, (tt) => this.bow(tt, degMidi(m.key, this.mode, deg), beats * this.beat, rand(0.7, 1)));
  }

  // --- instruments -----------------------------------------------------------

  kit(t, dest) { return new Kit(this.e, new Voice(), dest, t, 1, false); }

  pluckTo(t, midi, gain, bright, dest, pan = 0) {
    const k = this.kit(t, dest);
    k.pluck({ midi, gain, bright, pan });
    k.v.done();
  }

  pad(t, v, dur) {
    const ctx = this.ctx, P = this.m.pad, voice = new Voice();
    if (!P) return;
    const a = Math.min(P.attack, dur), r = P.release, hold = t + Math.max(a, dur), end = hold + r + 0.05;
    const lp = voice.add(ctx.createBiquadFilter());
    lp.type = 'lowpass';
    lp.Q.value = 0.5;
    lp.frequency.setValueAtTime(P.cutoff * 0.5, t);
    lp.frequency.linearRampToValueAtTime(P.cutoff, t + a);
    lp.frequency.linearRampToValueAtTime(P.cutoff * 0.7, end);
    const g = voice.add(ctx.createGain());
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(P.gain, t + a);
    g.gain.setValueAtTime(P.gain, hold);
    g.gain.linearRampToValueAtTime(0, hold + r);
    const sum = voice.add(ctx.createGain());
    sum.connect(lp);
    lp.connect(g);
    g.connect(this.ch.pad);
    for (const n of v.notes) for (const det of [-6, 6]) this.osc(voice, P.wave, mtof(n), det + rand(-2, 2), sum, t, end, 1);
    if (v.low != null) this.osc(voice, 'triangle', mtof(v.low), 0, sum, t, end, 0.7);
    if (P.choir) { // formant path singing "ah" on the same oscillators
      const cg = voice.add(ctx.createGain());
      cg.gain.value = P.choir * 2.5;
      for (const [f, Q, amp] of [[720, 5, 1], [1150, 6, 0.6]]) {
        const bp = voice.add(ctx.createBiquadFilter());
        bp.type = 'bandpass'; bp.frequency.value = f; bp.Q.value = Q;
        const fg = voice.add(ctx.createGain());
        fg.gain.value = amp;
        sum.connect(bp); bp.connect(fg); fg.connect(cg);
      }
      cg.connect(g);
    }
    voice.done();
  }

  osc(voice, wave, f, det, dest, t0, t1, level) {
    const o = this.ctx.createOscillator();
    if (wave === 'warm') o.setPeriodicWave(this.e._warm);
    else o.type = wave;
    o.frequency.value = f;
    o.detune.value = det;
    let node = o;
    if (level !== 1) {
      node = voice.add(this.ctx.createGain());
      node.gain.value = level;
      o.connect(node);
    }
    node.connect(dest);
    voice.play(o, t0, t1);
  }

  startDrone(t) {
    const ctx = this.ctx, D = this.m.drone;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = D.cutoff || 600;
    const breathe = ctx.createGain();
    breathe.gain.value = 0.75;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(D.gain, t + 5);
    lp.connect(breathe);
    breathe.connect(g);
    g.connect(this.ch.drone);
    this.persist.push(lp, breathe, g);
    for (const s of D.notes) {
      for (const det of [-4, 4]) {
        const o = ctx.createOscillator();
        o.type = D.type || 'sine';
        o.frequency.value = mtof(this.m.key + s);
        o.detune.value = det + rand(-1.5, 1.5);
        o.connect(lp);
        o.start(t);
        this.srcs.push(o);
        this.persist.push(o);
      }
    }
    const lfo = ctx.createOscillator(), lg = ctx.createGain();
    lfo.frequency.value = rand(0.04, 0.08);
    lg.gain.value = 0.25;
    lfo.connect(lg);
    lg.connect(breathe.gain);
    lfo.start(t);
    this.srcs.push(lfo);
    this.persist.push(lfo, lg);
  }

  bell(t, midi, vel) {
    const k = this.kit(t, this.ch.bell);
    k.bell({ f: mtof(midi), dur: 3.5, a: 0.004, gain: (this.m.bells?.gain ?? 0.04) * vel, partials: [[1, 1, 1], [2.0, 0.35, 0.7], [3.01, 0.12, 0.45], [4.17, 0.08, 0.35], [5.43, 0.04, 0.25]] });
    k.v.done();
  }

  drum(t, kind, vel) {
    const k = this.kit(t, this.ch.drum);
    if (kind === 'boom') {
      k.tone({ f: 140, f2: 68, glide: 0.07, dur: 0.45, a: 0.002, gain: 0.7 * vel });
      k.noise({ color: 'pink', type: 'lowpass', f: 700, a: 0.002, dur: 0.1, gain: 1.0 * vel });
    } else if (kind === 'tak') {
      k.noise({ color: 'white', type: 'bandpass', f: 1900, Q: 1.1, a: 0.001, dur: 0.06, gain: 1.3 * vel });
      k.tone({ type: 'triangle', f: 420, f2: 300, dur: 0.07, a: 0.001, gain: 0.25 * vel });
    } else {
      k.tone({ f: 110, f2: 50, glide: 0.1, dur: 0.8, a: 0.003, gain: 0.9 * vel });
      k.noise({ color: 'brown', type: 'lowpass', f: 300, a: 0.003, dur: 0.3, gain: 1.4 * vel });
    }
    k.v.done();
  }

  bassNote(t, midi, dur, gain) {
    const ctx = this.ctx, v = new Voice(), f = mtof(midi), end = t + dur + 0.12;
    const lp = v.add(ctx.createBiquadFilter());
    lp.type = 'lowpass';
    lp.Q.value = 3;
    lp.frequency.setValueAtTime(1300, t);
    lp.frequency.exponentialRampToValueAtTime(280, t + 0.14);
    const g = v.add(ctx.createGain());
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.005);
    g.gain.setValueAtTime(gain, t + dur * 0.6);
    g.gain.exponentialRampToValueAtTime(0.0001, end);
    const o1 = ctx.createOscillator(), o2 = ctx.createOscillator(), g2 = v.add(ctx.createGain());
    o1.type = 'sawtooth';
    o2.type = 'square';
    o1.frequency.value = f;
    o2.frequency.value = f;
    o2.detune.value = -8;
    g2.gain.value = 0.4;
    o1.connect(lp);
    o2.connect(g2);
    g2.connect(lp);
    lp.connect(g);
    g.connect(this.ch.bass);
    v.play(o1, t, end);
    v.play(o2, t, end);
    v.done();
  }

  // tagelharpa-like bowed note with a quiet drone string and bow noise
  bow(t, midi, dur, vel) {
    const ctx = this.ctx, v = new Voice(), f = mtof(midi);
    const a = Math.min(0.8, dur * 0.3), r = 0.9, end = t + dur + r;
    const sum = v.add(ctx.createGain());
    const vib = ctx.createOscillator(), vg = v.add(ctx.createGain());
    vib.frequency.value = rand(4.6, 5.6);
    vg.gain.setValueAtTime(0, t);
    vg.gain.linearRampToValueAtTime(f * 0.006, t + a + 0.4);
    vib.connect(vg);
    v.play(vib, t, end);
    for (const det of [-5, 5]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = f;
      o.detune.value = det;
      vg.connect(o.frequency);
      o.connect(sum);
      v.play(o, t, end);
    }
    let dm = this.m.key;
    while (dm > midi - 5) dm -= 12;
    const d = ctx.createOscillator(), dg = v.add(ctx.createGain());
    d.type = 'sawtooth';
    d.frequency.value = mtof(dm);
    dg.gain.value = 0.3;
    d.connect(dg);
    dg.connect(sum);
    v.play(d, t, end);
    const n = ctx.createBufferSource(), nbp = v.add(ctx.createBiquadFilter()), ng = v.add(ctx.createGain());
    n.buffer = this.e._noise.pink;
    n.loop = true;
    nbp.type = 'bandpass'; nbp.frequency.value = 2400; nbp.Q.value = 1.2;
    ng.gain.value = 0.25;
    n.connect(nbp); nbp.connect(ng); ng.connect(sum);
    v.play(n, t, end, rand(0, 3));
    const pk = v.add(ctx.createBiquadFilter()), lp = v.add(ctx.createBiquadFilter()), g = v.add(ctx.createGain());
    pk.type = 'peaking'; pk.frequency.value = 420; pk.Q.value = 1.2; pk.gain.value = 6;
    lp.type = 'lowpass'; lp.frequency.value = 1700; lp.Q.value = 0.6;
    const peak = vel * this.m.bow.gain;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + a);
    g.gain.linearRampToValueAtTime(peak * 0.8, t + dur);
    g.gain.linearRampToValueAtTime(0, end);
    sum.connect(pk); pk.connect(lp); lp.connect(g); g.connect(this.ch.bow);
    v.done();
  }
}

// ---------------------------------------------------------------------------
// 7. Speech ("animalese")
// ---------------------------------------------------------------------------
// One short pitched blip per letter.  Vowels are formant-filtered tones
// (each vowel moves the formant), consonants are shorter blips with a noise
// tick (hiss for s/z, click for plosives, breath for f/h).  Sentences get a
// gentle intonation contour: statements fall, questions rise at the end,
// exclamations sit higher and louder.  Punctuation pauses; spaces are gaps.

const VOWEL_SHAPE = { a: [1.0, 1.0], e: [1.06, 1.3], i: [1.12, 1.65], o: [0.95, 0.72], u: [0.9, 0.58], y: [1.1, 1.45] }; // [pitch, formant]
const PAUSE = { ',': 3, ';': 3, ':': 3, '.': 5, '!': 5, '?': 5, '…': 7, '-': 1.5, '–': 2, '—': 2.5, '\n': 4 };
const CONS = {};
for (const c of 'szxcj') CONS[c] = 'sib';
for (const c of 'pbtdkgq0123456789') CONS[c] = 'plo';
for (const c of 'mn') CONS[c] = 'nas';
for (const c of 'lrwv') CONS[c] = 'liq';
for (const c of 'fh') CONS[c] = 'fri';
const SIGN_SCALE = [0, 3, 5, 7, 10, 12, 15]; // minor pentatonic, for runestone chimes

// Merge a (possibly partial or hand-made) preset over the defaults and
// clamp every field to a sane range, so odd values can never break a blip.
const VOICE_RANGES = {
  base: [40, 2000, 245], range: [1, 3, 1.3], speed: [0.02, 0.3, 0.055], formant: [200, 6000, 1300],
  breath: [0, 1, 0], wobble: [0, 0.3, 0], glide: [-0.8, 0.8, 0], rough: [0, 1, 0], vibrato: [0, 0.3, 0],
  vibRate: [0.5, 20, 8], attack: [0.001, 0.05, 0.005], volume: [0, 3, 1],
};
function voicePreset(v) {
  const p = { ...VOICES.player, ...(v && typeof v === 'object' ? v : {}) };
  for (const [k, [lo, hi, def]] of Object.entries(VOICE_RANGES)) p[k] = clamp(num(p[k], def), lo, hi);
  if (!['sine', 'triangle', 'square', 'sawtooth'].includes(p.wave)) p.wave = 'triangle';
  p.chime = !!p.chime;
  return p;
}

function parseSpeech(text, P) {
  const chars = Array.from(text.normalize('NFD').replace(/[̀-ͯ]/g, ''));
  const n = chars.length, kind = new Array(n), pos = new Array(n);
  // sentence type and position of each character within its sentence
  for (let i = 0, s = 0; i <= n; i++) {
    const c = chars[i];
    if (i === n || c === '.' || c === '!' || c === '?' || c === '…' || c === '\n') {
      const k = c === '?' ? 'q' : c === '!' ? 'x' : 's', len = Math.max(1, i - s);
      for (let j = s; j < i; j++) { kind[j] = k; pos[j] = (j - s) / len; }
      s = i + 1;
    }
  }
  const sp = clamp(num(P.speed, 0.055), 0.02, 0.3);
  const ev = [];
  // at[i]: when character i is reached, so text can be revealed in step
  const at = new Float32Array(n + 1);
  let t = 0, inWord = false, lastChime = -1;
  for (let i = 0; i < n; i++) {
    const raw = chars[i], c = raw.toLowerCase();
    at[i] = t;
    if (PAUSE[c] != null) { // collapse runs like "?!" or "..."
      let p = PAUSE[c], j = i;
      while (j + 1 < n && PAUSE[chars[j + 1]] != null) { j++; at[j] = t; p = Math.max(p, PAUSE[chars[j]]); }
      if (j > i && c === '.') p = Math.max(p, 7);
      t += p * sp;
      i = j;
      inWord = false;
      continue;
    }
    if (/\s/.test(c)) { t += sp * 0.55; inWord = false; continue; }
    const vowelShape = VOWEL_SHAPE[c];
    let cls = CONS[c];
    if (!vowelShape && !cls) {
      if (!/\p{L}/u.test(c)) continue; // other symbols are silent
      cls = 'liq';                    // letters from other scripts: soft blip
    }
    if (P.chime) { // runestones: one chime per word, timed like reading
      if (!inWord) {
        let w = '';
        for (let j = i; j < n && /[\p{L}\p{N}']/u.test(chars[j]); j++) w += chars[j].toLowerCase();
        let idx = hashStr(w) % SIGN_SCALE.length;
        if (idx === lastChime) idx = (idx + 2) % SIGN_SCALE.length;
        lastChime = idx;
        ev.push({ t, chime: true, f: P.base * Math.pow(2, SIGN_SCALE[idx] / 12), g: 1 });
      }
      inWord = true;
      t += sp;
      continue;
    }
    inWord = true;
    const x = pos[i] ?? 0.5, k = kind[i] || 's';
    const contour = k === 'q' ? (x < 0.6 ? 1 - 0.04 * x : 1 + (x - 0.6) * 0.45) : k === 'x' ? 1.1 - 0.06 * x : 1.03 - 0.08 * x;
    const upper = raw !== c && raw === raw.toUpperCase();
    const off = ((c.codePointAt(0) * 37) % 11) / 10 - 0.5; // stable per letter
    const f = P.base * Math.pow(P.range || 1.3, off) * contour * (upper ? 1.05 : 1) *
      (1 + rand(-1, 1) * (P.wobble || 0)) * (vowelShape ? vowelShape[0] : 1);
    ev.push({ t, v: !!vowelShape, cls, f, fm: vowelShape ? vowelShape[1] : cls === 'nas' ? 0.55 : 0.85, g: (k === 'x' ? 1.15 : 1) * (upper ? 1.15 : 1) });
    t += sp * (vowelShape ? 1 : 0.9) * rand(0.94, 1.06);
  }
  at[n] = t;
  return { ev, dur: t, at };
}

class Utterance {
  constructor(eng, text, preset) {
    const ctx = eng.ctx, bus = eng.bus.voice;
    const P = (this.P = voicePreset(preset));
    this.e = eng;
    const parsed = parseSpeech(text, P);
    this.ev = parsed.ev;
    this.i = 0;
    this.t0 = ctx.currentTime + 0.03;
    this.end = this.t0 + parsed.dur + (P.chime ? 1.5 : 0.25); // let chimes ring out
    this.finished = false;
    this.done = new Promise((res) => { this._resolve = res; });
    // per-utterance chain: voiceIn -> formant + dry -> mix (-> growl AM) -> lowpass -> out
    const nodes = (this.nodes = []);
    const mk = (n) => { nodes.push(n); return n; };
    this.out = mk(ctx.createGain());
    this.out.gain.value = clamp(num(P.volume, 1), 0, 3);
    this.out.connect(bus.in);
    const room = mk(ctx.createGain());
    room.gain.value = P.chime ? 0.1 : 0.14;
    this.out.connect(room);
    room.connect(bus.room);
    if (P.chime) {
      const hall = mk(ctx.createGain());
      hall.gain.value = 0.45;
      this.out.connect(hall);
      hall.connect(bus.hall);
    }
    this.voiceIn = mk(ctx.createGain());
    this.form = mk(ctx.createBiquadFilter());
    this.form.type = 'bandpass';
    this.form.frequency.value = clamp(num(P.formant, 1200), 200, 8000);
    this.form.Q.value = 2.2;
    const dry = mk(ctx.createBiquadFilter()), dryG = mk(ctx.createGain());
    dry.type = 'lowpass';
    const buzzy = P.wave === 'sawtooth' || P.wave === 'square'; // keep gruff voices soft-edged
    dry.frequency.value = clamp(num(P.formant, 1200) * (buzzy ? 1.5 : 2.5), 300, 12000);
    dryG.gain.value = 0.55;
    const mix = mk(ctx.createGain());
    this.nf = mk(ctx.createBiquadFilter());
    this.nf.type = 'bandpass';
    this.nf.Q.value = 1.2;
    const lp = mk(ctx.createBiquadFilter());
    lp.type = 'lowpass';
    lp.frequency.value = 5200;
    this.voiceIn.connect(this.form);
    this.voiceIn.connect(dry);
    this.form.connect(mix);
    dry.connect(dryG);
    dryG.connect(mix);
    this.nf.connect(mix);
    mix.connect(lp);
    lp.connect(this.out);
    if (P.rough > 0) { // croak / growl
      mix.gain.value = 1 - P.rough / 2;
      const lfo = ctx.createOscillator(), lg = mk(ctx.createGain());
      lfo.frequency.value = 38;
      lg.gain.value = P.rough / 2;
      lfo.connect(lg);
      lg.connect(mix.gain);
      lfo.start(this.t0);
      lfo.stop(this.end + 0.2);
      mk(lfo);
    }
    if (!this.ev.length) this.finish();
  }

  pump(now, horizon) {
    if (this.finished) return;
    while (this.i < this.ev.length && this.t0 + this.ev[this.i].t < now + horizon) {
      const e = this.ev[this.i++], t = Math.max(this.t0 + e.t, now + 0.004);
      if (e.chime) this.chime(t, e);
      else this.blip(t, e);
    }
    if (this.i >= this.ev.length && now > this.end) this.finish();
  }

  blip(t, e) {
    const ctx = this.e.ctx, P = this.P, v = new Voice();
    const dur = P.speed * (e.v ? 0.78 : 0.55), f = e.f, glide = P.glide || 0;
    const osc = ctx.createOscillator();
    osc.type = P.wave;
    if (P.vibrato > 0) { // quaver continuous across blips
      const N = 16, curve = new Float32Array(N);
      for (let j = 0; j < N; j++) {
        const x = j / (N - 1);
        curve[j] = f * (1 + glide * (x - 0.5)) * (1 + P.vibrato * Math.sin(2 * Math.PI * (P.vibRate || 8) * (t - this.t0 + x * dur)));
      }
      osc.frequency.setValueCurveAtTime(curve, t, dur);
    } else {
      osc.frequency.setValueAtTime(f * (1 - glide / 2), t);
      osc.frequency.linearRampToValueAtTime(f * (1 + glide / 2), t + dur);
    }
    const g = v.add(ctx.createGain());
    const peak = 0.4 * e.g * (e.v ? 1 : e.cls === 'nas' || e.cls === 'liq' ? 0.7 : 0.45);
    const a = clamp(num(P.attack, 0.005), 0.001, dur * 0.4);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + a);
    g.gain.setValueAtTime(peak, t + Math.max(a, dur * 0.45));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g);
    g.connect(this.voiceIn);
    v.play(osc, t, t + dur + 0.01);
    this.form.frequency.setValueAtTime(clamp(P.formant * e.fm * Math.pow(f / P.base, 0.25), 200, 8000), t);
    // noise part: consonant tick / hiss, or breath on vowels
    let amt = 0, nf = 0, nd = 0;
    if (!e.v) {
      if (e.cls === 'sib') { amt = 0.5; nf = 5500; nd = dur * 0.8; }
      else if (e.cls === 'plo') { amt = 0.6; nf = 2200; nd = 0.014; }
      else if (e.cls === 'fri') { amt = 0.35; nf = 3200; nd = dur * 0.6; }
    } else if (P.breath > 0) { amt = P.breath * 0.7; nf = P.formant * 1.6; nd = dur; }
    if (amt > 0) {
      const src = ctx.createBufferSource(), ng = v.add(ctx.createGain());
      src.buffer = this.e._noise.white;
      src.loop = true;
      ng.gain.setValueAtTime(0, t);
      ng.gain.linearRampToValueAtTime(amt * e.g, t + 0.003);
      ng.gain.exponentialRampToValueAtTime(0.0001, t + Math.max(0.01, nd));
      this.nf.frequency.setValueAtTime(clamp(nf, 200, 9000), t);
      src.connect(ng);
      ng.connect(this.nf);
      v.play(src, t, t + nd + 0.02, rand(0, 2));
    }
    v.done();
  }

  chime(t, e) {
    const v = new Voice(), k = new Kit(this.e, v, this.out, t, 1, false);
    k.bell({ f: e.f, dur: 1.4, a: 0.006, gain: 0.12, partials: [[1, 1, 1], [2.0, 0.22, 0.6], [3.0, 0.07, 0.4], [4.2, 0.03, 0.3]] });
    v.done();
  }

  stop() {
    if (this.finished) return;
    const now = this.e.ctx.currentTime, g = this.out.gain;
    g.cancelScheduledValues(now);
    g.setValueAtTime(g.value, now);
    g.linearRampToValueAtTime(0, now + 0.04);
    this.i = this.ev.length;
    this.finish(0.1);
  }

  finish(delay = 0.05) {
    if (this.finished) return;
    this.finished = true;
    const nodes = this.nodes;
    this.e._later(delay, () => { for (const n of nodes) { try { n.disconnect(); } catch { /* gone */ } } });
    this._resolve();
  }
}

// ---------------------------------------------------------------------------
// 8. AudioEngine — public API
// ---------------------------------------------------------------------------

const MAX_VOICES = 24;           // simultaneous sfx (important ones get +8)
const BUS_NAMES = ['music', 'sfx', 'ambience', 'voice'];
const BUS_TRIM = { music: 1, sfx: 1, ambience: 1, voice: 1 }; // internal mix calibration
const THUNDER_VOL = 1.6;         // weather thunder vs sfx('thunder'): ambience bus is quieter by default
const volCurve = (v) => v * v;   // slider 0..1 -> gain (perceptual)

export const MUSIC_MOODS = ['title', 'day', 'dusk', 'night', 'combat', 'boss', 'victory', 'none'];
export const AMBIENCE_LAYERS = Object.keys(AMB);

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this._failed = false;
    this._offline = false;
    this._paused = false;
    this._vol = { master: 0.8, music: 0.5, sfx: 0.8, ambience: 0.6, voice: 0.7 };
    this._amb = Object.fromEntries(Object.keys(AMB).map((k) => [k, 0]));
    this._mood = 'none';
    this._lis = { x: 0, z: 0, yaw: 0 };
    this._perf = null;
    this._dying = [];
    this._layers = {};
    this._utt = null;
    this._active = [];
    this._lastByName = new Map();
    this._laterQ = [];
    this._plucks = new Map();
    this._warmQ = [];
    this._texCache = {};
    this._warned = 0;
    this._timer = null;
    this._lastTick = 0;
  }

  // true once the context exists and is actually producing sound
  get ready() {
    try {
      return !!this.ctx && !this._failed && (this._offline || this.ctx.state === 'running');
    } catch {
      return false;
    }
  }

  // Create (once) and unlock the AudioContext.  Call from a user gesture;
  // calling again later just resumes a suspended context.  For tests an
  // existing (Offline)AudioContext can be supplied: init({ context }).
  init(opts) {
    try {
      if (this._failed) return false;
      if (this.ctx) {
        if (!this._offline && !this._paused && this.ctx.state !== 'running' && this.ctx.state !== 'closed') this.ctx.resume().catch(noop);
        return this.ready;
      }
      const given = opts && opts.context;
      const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
      if (!given && !AC) return false;
      if (given) this.ctx = given;
      else {
        try { this.ctx = new AC({ latencyHint: 'interactive' }); } catch { this.ctx = new AC(); } // old Safari: no options
      }
      this._offline = typeof OfflineAudioContext !== 'undefined' && this.ctx instanceof OfflineAudioContext;
      try {
        this._build();
      } catch (e) {
        this._warn(e);
        this._failed = true;
        if (!given) this.ctx.close?.().catch(noop);
        return false;
      }
      if (!this._offline) {
        if (this.ctx.state !== 'running') this.ctx.resume().catch(noop);
        this._armUnlock();
        this._timer = setInterval(() => { try { this._tick(true); } catch (e) { this._warn(e); } }, 100);
      }
      // apply anything the game asked for before init
      this.setAmbience(this._amb);
      const mood = this._mood;
      this._mood = 'none';
      this.setMusic(mood);
      return this.ready;
    } catch (e) {
      this._warn(e);
      return false;
    }
  }

  setVolumes(v) {
    try {
      if (!v || typeof v !== 'object') return;
      for (const k of Object.keys(this._vol)) if (Number.isFinite(v[k])) this._vol[k] = clamp(v[k], 0, 1);
      if (!this._live()) return;
      this._applyVolumes(false);
    } catch (e) { this._warn(e); }
  }

  setListener(x, z, yaw) {
    if (Number.isFinite(x)) this._lis.x = x;
    if (Number.isFinite(z)) this._lis.z = z;
    if (Number.isFinite(yaw)) this._lis.yaw = yaw;
  }

  // Play a one-shot effect.  Returns true if it was played.
  sfx(name, opts) {
    try {
      if (!this._canPlay()) return false;
      const spec = SFX[name];
      if (!spec) return false;
      const o = opts && typeof opts === 'object' ? opts : {};
      const ctx = this.ctx, now = ctx.currentTime;
      // the same sound retriggered within a few ms only adds phasing/loudness
      const last = this._lastByName.get(name);
      if (last != null && now - last < (spec.pri === 0 ? 0.03 : 0.018)) return false;
      let vol = clamp(num(o.volume, 1), 0, 4) * spec.vol;
      let pan = 0, att = 1, cutoff = 20000;
      const spatial = Number.isFinite(o.x) && Number.isFinite(o.z);
      if (spatial) {
        const dx = o.x - this._lis.x, dz = o.z - this._lis.z, d = Math.hypot(dx, dz), yaw = this._lis.yaw;
        att = 1 / (1 + d / 6);
        if (d > 1e-3) {
          const side = (dx * Math.cos(yaw) - dz * Math.sin(yaw)) / d;     // + = to the right
          const front = (-dx * Math.sin(yaw) - dz * Math.cos(yaw)) / d;   // + = ahead
          pan = clamp(side * Math.min(1, d / 2) * 0.85, -0.85, 0.85);
          cutoff = clamp(20000 / (1 + d / 18), 1500, 20000) * (front < -0.3 ? 0.65 : 1);
        }
        vol *= att;
      }
      if (vol < 0.004) return false;
      this._active = this._active.filter((end) => end > now);
      if (this._active.length >= (spec.pri >= 2 ? MAX_VOICES + 8 : MAX_VOICES)) return false;
      const vary = o.variation !== false;
      const pitch = clamp(num(o.pitch, 1), 0.25, 4) * (vary ? rand(0.965, 1.035) : 1);
      const v = new Voice(), bus = this.bus.sfx;
      const out = v.add(ctx.createGain());
      out.gain.value = vol;
      let tail = out;
      if (spatial) {
        if (cutoff < 19000) {
          const lp = v.add(ctx.createBiquadFilter());
          lp.type = 'lowpass';
          lp.frequency.value = cutoff;
          lp.Q.value = 0.5;
          tail.connect(lp);
          tail = lp;
        }
        // equal-power panner always (no level jump near centre); +3 dB so a
        // centred positional sound matches the calibrated non-positional level
        const p = v.add(this._panner(pan));
        tail.connect(p);
        tail = p;
        out.gain.value = vol * Math.SQRT2;
      }
      tail.connect(bus.in);
      const wetBoost = spatial ? Math.min(3, 1 / Math.sqrt(att)) : 1; // distant = wetter
      for (const [amt, dest] of [[spec.room, bus.room], [spec.hall, bus.hall]]) {
        if (!(amt > 0)) continue;
        const s = v.add(ctx.createGain());
        s.gain.value = amt * wetBoost;
        tail.connect(s);
        s.connect(dest);
      }
      spec.fn(new Kit(this, v, out, now + 0.005, pitch, vary));
      v.done();
      this._active.push(v.end);
      this._lastByName.set(name, now);
      return true;
    } catch (e) {
      this._warn(e);
      return false;
    }
  }

  setAmbience(levels) {
    try {
      if (!levels || typeof levels !== 'object') return;
      const changed = [];
      for (const k of Object.keys(AMB)) {
        if (!Number.isFinite(levels[k])) continue;
        this._amb[k] = clamp(levels[k], 0, 1);
        changed.push(k);
      }
      if (!this._live()) return;
      const now = this.ctx.currentTime;
      for (const k of changed) {
        if (this._amb[k] > 0 || this._layers[k]) this._layer(k).set(this._amb[k], now);
      }
    } catch (e) { this._warn(e); }
  }

  setMusic(mood) {
    try {
      if (mood !== 'none' && !own(MOODS, mood)) return; // unknown: ignore
      if (!this._live()) { this._mood = mood; return; }
      if (mood === this._mood && (mood === 'none' || (this._perf && this._perf.name === mood))) return;
      this._mood = mood;
      const now = this.ctx.currentTime, next = MOODS[mood];
      if (this._perf) {
        const out = next ? (next.fade < 1.5 ? 1.0 : Math.min(3.5, next.fade)) : 2.5;
        this._perf.fadeOut(now, out);
        this._dying.push(this._perf);
        this._perf = null;
      }
      if (next) {
        const back = this._dying.findIndex((p) => p.name === mood);
        if (back >= 0) { // still fading out: bring it back rather than restarting
          this._perf = this._dying.splice(back, 1)[0];
          this._perf.revive(now, Math.min(1.5, next.fade));
        } else this._perf = new Performer(this, mood, now);
        this._perf.tick(now, 0.35);
      }
    } catch (e) { this._warn(e); }
  }

  speak(text, voice) {
    const silent = { stop: noop, done: Promise.resolve() };
    try {
      this.stopSpeak();
      if (!this._canPlay()) return silent;
      const str = text == null ? '' : String(text);
      if (!str.trim()) return silent;
      const preset = typeof voice === 'string' ? (own(VOICES, voice) ? VOICES[voice] : VOICES.player)
        : voice && typeof voice === 'object' ? voice : VOICES.player;
      const u = new Utterance(this, str.slice(0, 4000), preset);
      this._utt = u;
      u.pump(this.ctx.currentTime, 0.3);
      return { stop: () => { try { u.stop(); } catch (e) { this._warn(e); } }, done: u.done };
    } catch (e) {
      this._warn(e);
      return silent;
    }
  }

  // How a line would be paced when spoken: { at, dur } where at[i] is the
  // time (s) character i is reached.  Pure; works before init() and muted.
  speechTimeline(text, voice) {
    try {
      const str = (text == null ? '' : String(text)).slice(0, 4000);
      const preset = typeof voice === 'string' ? (own(VOICES, voice) ? VOICES[voice] : VOICES.player)
        : voice && typeof voice === 'object' ? voice : VOICES.player;
      const { at, dur } = parseSpeech(str, voicePreset(preset));
      return { at, dur };
    } catch (e) {
      this._warn(e);
      return null;
    }
  }

  stopSpeak() {
    try {
      if (this._utt) this._utt.stop();
      this._utt = null;
    } catch (e) { this._warn(e); }
  }

  // Rolling thunder through the ambience bus (weather). 0 = silent, 1 = close strike.
  thunder(intensity = 1) {
    try {
      if (!this._canPlay()) return;
      const I = clamp(num(intensity, 1), 0, 1.5);
      if (I <= 0.01) return;
      const ctx = this.ctx, v = new Voice(), bus = this.bus.ambience;
      const out = v.add(ctx.createGain()), p = v.add(this._panner(rand(-0.5, 0.5))), s = v.add(ctx.createGain());
      out.gain.value = THUNDER_VOL * SFX.thunder.vol * Math.SQRT2; // panned: compensate pan law
      s.gain.value = 0.7;
      out.connect(p);
      p.connect(bus.in);
      p.connect(s);
      s.connect(bus.hall);
      thunderRecipe(new Kit(this, v, out, ctx.currentTime + 0.01, 1, true), I);
      v.done();
    } catch (e) { this._warn(e); }
  }

  update(dt) {
    try { this._tick(false); } catch (e) { this._warn(e); }
  }

  suspend() {
    try {
      this._paused = true;
      if (this.ctx && !this._offline && this.ctx.state === 'running') this.ctx.suspend().catch(noop);
    } catch (e) { this._warn(e); }
  }

  resume() {
    try {
      this._paused = false;
      if (this.ctx && !this._offline && this.ctx.state !== 'running' && this.ctx.state !== 'closed') this.ctx.resume().catch(noop);
    } catch (e) { this._warn(e); }
  }

  // --- debug helpers (tests, the audio test page) ---------------------------

  _debugLevel() { return this._debugStats().rms; }
  _debugPeak() { return this._debugStats().peak; }
  _debugStats() {
    const s = { rms: 0, peak: 0, voices: 0, mood: this._mood, state: this.ctx ? this.ctx.state : 'none', layers: [], plucks: this._plucks.size };
    try {
      if (!this._an) return s;
      const buf = this._anBuf;
      this._an.getFloatTimeDomainData(buf);
      let sum = 0, pk = 0;
      for (let i = 0; i < buf.length; i++) {
        const x = buf[i];
        sum += x * x;
        if (x > pk) pk = x;
        else if (-x > pk) pk = -x;
      }
      s.rms = Math.sqrt(sum / buf.length);
      s.peak = pk;
      const now = this.ctx.currentTime;
      s.voices = this._active.filter((e) => e > now).length;
      s.layers = Object.values(this._layers).filter((l) => l.on).map((l) => l.name);
    } catch { /* keep zeros */ }
    return s;
  }

  // --- internals -------------------------------------------------------------

  _live() { return !!this.ctx && !this._failed; }
  _canPlay() { return this._live() && (this._offline || this.ctx.state === 'running'); }

  _warn(e) {
    if (this._warned++ < 8 && typeof console !== 'undefined') console.warn('[audio]', e);
  }

  _build() {
    const ctx = this.ctx;
    this._noise = {
      white: makeNoiseBuffer(ctx, 3, 'white'),
      pink: makeNoiseBuffer(ctx, 3, 'pink'),
      brown: makeNoiseBuffer(ctx, 4, 'brown'),
    };
    this._crackle = makeCrackleTexture(ctx, 4);
    this._warm = makeWarmWave(ctx);
    // master: gain -> gentle limiter -> soft clip -> analyser -> out
    this.master = ctx.createGain();
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -6;
    comp.knee.value = 6;
    comp.ratio.value = 12;
    comp.attack.value = 0.002;
    comp.release.value = 0.15;
    const pre = ctx.createGain();
    pre.gain.value = 0.5;
    const clip = ctx.createWaveShaper();
    clip.curve = softClipCurve();
    clip.oversample = 'none';
    this._an = ctx.createAnalyser();
    this._an.fftSize = 2048;
    this._anBuf = new Float32Array(this._an.fftSize);
    this.master.connect(comp);
    comp.connect(pre);
    pre.connect(clip);
    clip.connect(this._an);
    this._an.connect(ctx.destination);
    // shared reverbs
    this._room = this._reverb(makeImpulse(ctx, 1.4, 1.0, { pre: 0.008, bright: 0.9, dark: 0.2 }));
    this._hall = this._reverb(makeImpulse(ctx, 4.2, 3.4, { pre: 0.025, bright: 0.7, dark: 0.06 }));
    // buses: dry input + room/hall sends, all scaled by the bus volume
    this.bus = {};
    for (const name of BUS_NAMES) {
      const b = { in: ctx.createGain(), vol: ctx.createGain(), room: ctx.createGain(), roomVol: ctx.createGain(), hall: ctx.createGain(), hallVol: ctx.createGain() };
      b.in.connect(b.vol);
      b.vol.connect(this.master);
      b.room.connect(b.roomVol);
      b.roomVol.connect(this._room);
      b.hall.connect(b.hallVol);
      b.hallVol.connect(this._hall);
      this.bus[name] = b;
    }
    // music ping-pong echo (post-fader: feeds the music bus input)
    this._echoIn = ctx.createGain();
    const dl = ctx.createDelay(2), dr = ctx.createDelay(2);
    dl.delayTime.value = 0.39;
    dr.delayTime.value = 0.39;
    const mkLp = (f) => { const b = ctx.createBiquadFilter(); b.type = 'lowpass'; b.frequency.value = f; return b; };
    const lpl = mkLp(2600), lpr = mkLp(2200);
    const fbl = ctx.createGain(), fbr = ctx.createGain(), echoHall = ctx.createGain();
    fbl.gain.value = 0.38;
    fbr.gain.value = 0.38;
    echoHall.gain.value = 0.3;
    const pl = this._panner(-0.6), pr = this._panner(0.6), music = this.bus.music;
    this._echoIn.connect(dl);
    dl.connect(lpl); lpl.connect(pl); pl.connect(music.in);
    lpl.connect(fbl); fbl.connect(dr);
    dr.connect(lpr); lpr.connect(pr); pr.connect(music.in);
    lpr.connect(fbr); fbr.connect(dl);
    pl.connect(echoHall); pr.connect(echoHall); echoHall.connect(music.hall);
    this._applyVolumes(true);
  }

  _reverb(ir) {
    const c = this.ctx.createConvolver();
    c.normalize = true;
    c.buffer = ir;
    c.connect(this.master);
    return c;
  }

  _applyVolumes(immediate) {
    const now = this.ctx.currentTime;
    const set = (param, val) => {
      if (immediate) { param.value = val; return; }
      param.cancelScheduledValues(now);
      param.setTargetAtTime(val, now, 0.04);
    };
    set(this.master.gain, volCurve(this._vol.master));
    for (const name of BUS_NAMES) {
      const g = volCurve(this._vol[name]) * BUS_TRIM[name], b = this.bus[name];
      set(b.vol.gain, g);
      set(b.roomVol.gain, g);
      set(b.hallVol.gain, g);
    }
  }

  _panner(p) {
    const ctx = this.ctx;
    if (!ctx.createStereoPanner) return ctx.createGain();
    const n = ctx.createStereoPanner();
    n.pan.value = clamp(p, -1, 1);
    return n;
  }

  _layer(name) {
    return this._layers[name] || (this._layers[name] = new Layer(this, name, AMB[name]));
  }

  _tex(name) {
    if (!this._texCache[name]) {
      this._texCache[name] = name === 'rain' ? makeRainTexture(this.ctx, 4) : makeCricketTexture(this.ctx, 5);
    }
    return this._texCache[name];
  }

  // cached Karplus-Strong note (LRU, bucketed brightness)
  _pluckBuf(midi, bright) {
    const b = bright < 0.43 ? 0 : bright < 0.68 ? 1 : 2;
    const key = midi * 4 + b;
    let buf = this._plucks.get(key);
    if (buf) {
      this._plucks.delete(key);
      this._plucks.set(key, buf);
      return buf;
    }
    buf = makePluck(this.ctx, mtof(midi), clamp(3.4 - (midi - 48) * 0.055, 0.8, 3.6), [0.3, 0.55, 0.8][b]);
    this._plucks.set(key, buf);
    if (this._plucks.size > 64) this._plucks.delete(this._plucks.keys().next().value);
    return buf;
  }

  _warmPlucks(list) {
    for (const [m, b] of list) this._warmQ.push([m, b]);
    if (this._warmQ.length > 96) this._warmQ.splice(0, this._warmQ.length - 96);
  }

  // run fn after `delay` seconds of audio-clock time (disposal etc.)
  _later(delay, fn) { this._laterQ.push({ at: this.ctx.currentTime + delay, fn }); }

  // Lookahead scheduler: plans music/ambience/speech a little ahead of the
  // audio clock.  Driven by update() and a slow fallback interval.
  _tick(fromTimer) {
    if (!this._live()) return;
    const wall = typeof performance !== 'undefined' ? performance.now() : Date.now();
    if (fromTimer && wall - this._lastTick < 45) return;
    this._lastTick = wall;
    const now = this.ctx.currentTime;
    const hidden = typeof document !== 'undefined' && document.hidden;
    const horizon = this._offline ? 0.3 : hidden ? 2.5 : 0.35;
    if (this._perf) this._perf.tick(now, horizon);
    for (const k in this._layers) this._layers[k].tick(now, horizon);
    if (this._utt) {
      this._utt.pump(now, Math.min(horizon, 0.3));
      if (this._utt.finished) this._utt = null;
    }
    if (this._dying.length) {
      this._dying = this._dying.filter((p) => {
        if (now < p.killAt) return true;
        p.dispose();
        return false;
      });
    }
    if (this._laterQ.length) {
      const due = this._laterQ.filter((x) => x.at <= now);
      if (due.length) {
        this._laterQ = this._laterQ.filter((x) => x.at > now);
        for (const x of due) { try { x.fn(); } catch (e) { this._warn(e); } }
      }
    }
    for (let i = 0; i < 2 && this._warmQ.length; i++) {
      const [m, b] = this._warmQ.shift();
      this._pluckBuf(m, b);
    }
  }

  _armUnlock() {
    if (this._unlockArmed || typeof window === 'undefined' || !window.addEventListener) return;
    this._unlockArmed = true;
    const kick = () => {
      try {
        if (this.ctx && !this._paused && this.ctx.state !== 'running' && this.ctx.state !== 'closed') this.ctx.resume().catch(noop);
      } catch { /* ignore */ }
    };
    for (const ev of ['pointerdown', 'keydown', 'touchend', 'mousedown']) window.addEventListener(ev, kick, { capture: true, passive: true });
  }
}

export const audio = new AudioEngine();
