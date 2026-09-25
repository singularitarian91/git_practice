/* audio.js: procedural sound. Wind, rain, water, room tone, a slow drone, and small sounds.
 * Nothing is loaded from files. Audio starts on the first click or key press.
 */
(function () {
  'use strict';
  const G = window.G, M = G.M;

  const A = (G.audio = {
    ctx: null,
    ready: false,
    muted: false,
    levels: { wind: 0, rain: 0, water: 0, room: 0, drone: 0 },
    targets: { wind: 0, rain: 0, water: 0, room: 0, drone: 0 },
    gust: 0,
    pending: null
  });

  const mtof = m => 440 * Math.pow(2, (m - 69) / 12);
  const MASTER = 1.5; // overall level (measured against recordings of each chapter)

  function noiseBuffer(ac, seconds, brown) {
    const len = Math.floor(ac.sampleRate * seconds);
    const buf = ac.createBuffer(1, len, ac.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      if (brown) {
        last = (last + 0.02 * w) / 1.02;
        d[i] = last * 3.5;
      } else d[i] = w;
    }
    return buf;
  }

  function impulse(ac, seconds, decay) {
    const len = Math.floor(ac.sampleRate * seconds);
    const buf = ac.createBuffer(2, len, ac.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
    return buf;
  }

  function loop(ac, buf) {
    const s = ac.createBufferSource();
    s.buffer = buf;
    s.loop = true;
    s.start(0, Math.random() * buf.duration);
    return s;
  }

  function build() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ac = (A.ctx = new AC());
    A.master = ac.createGain();
    A.master.gain.value = A.muted ? 0 : MASTER;
    const comp = ac.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.ratio.value = 3;
    A.master.connect(comp);
    comp.connect(ac.destination);
    A.out = comp;

    A.verb = ac.createConvolver();
    A.verb.buffer = impulse(ac, 3.2, 2.6);
    A.verbIn = ac.createGain();
    A.verbIn.gain.value = 0.5;
    A.verbIn.connect(A.verb);
    A.verb.connect(A.master);

    const white = (A.white = noiseBuffer(ac, 3, false));
    const brown = noiseBuffer(ac, 4, true);

    // wind: two bands of noise, moved by the gust value
    A.windBand = ac.createBiquadFilter();
    A.windBand.type = 'bandpass';
    A.windBand.frequency.value = 500;
    A.windBand.Q.value = 0.7;
    A.windGain = ac.createGain();
    A.windGain.gain.value = 0;
    loop(ac, white).connect(A.windBand);
    A.windBand.connect(A.windGain);
    A.windGain.connect(A.master);
    A.windLow = ac.createBiquadFilter();
    A.windLow.type = 'lowpass';
    A.windLow.frequency.value = 260;
    A.windLowGain = ac.createGain();
    A.windLowGain.gain.value = 0;
    loop(ac, brown).connect(A.windLow);
    A.windLow.connect(A.windLowGain);
    A.windLowGain.connect(A.master);

    // rain
    const rhp = ac.createBiquadFilter();
    rhp.type = 'highpass';
    rhp.frequency.value = 1400;
    const rlp = ac.createBiquadFilter();
    rlp.type = 'lowpass';
    rlp.frequency.value = 4500;
    A.rainGain = ac.createGain();
    A.rainGain.gain.value = 0;
    loop(ac, white).connect(rhp);
    rhp.connect(rlp);
    rlp.connect(A.rainGain);
    A.rainGain.connect(A.master);

    // water lapping
    const wlp = ac.createBiquadFilter();
    wlp.type = 'lowpass';
    wlp.frequency.value = 420;
    A.waterGain = ac.createGain();
    A.waterGain.gain.value = 0;
    A.waterLfo = ac.createGain();
    A.waterLfo.gain.value = 0;
    const lfo = ac.createOscillator();
    lfo.frequency.value = 0.23;
    lfo.connect(A.waterLfo);
    A.waterLfo.connect(A.waterGain.gain);
    lfo.start();
    loop(ac, brown).connect(wlp);
    wlp.connect(A.waterGain);
    A.waterGain.connect(A.master);

    // room tone
    const rlo = ac.createBiquadFilter();
    rlo.type = 'lowpass';
    rlo.frequency.value = 420;
    const rhi = ac.createBiquadFilter();
    rhi.type = 'highpass';
    rhi.frequency.value = 120;
    A.roomGain = ac.createGain();
    A.roomGain.gain.value = 0;
    loop(ac, brown).connect(rhi);
    rhi.connect(rlo);
    rlo.connect(A.roomGain);
    A.roomGain.connect(A.master);

    // drone: three slow voices plus the root an octave up (so small speakers can play it)
    A.droneGain = ac.createGain();
    A.droneGain.gain.value = 0;
    const dlp = ac.createBiquadFilter();
    dlp.type = 'lowpass';
    dlp.frequency.value = 1400;
    A.droneGain.connect(dlp);
    dlp.connect(A.master);
    const dsend = ac.createGain();
    dsend.gain.value = 0.35;
    dlp.connect(dsend);
    dsend.connect(A.verbIn);
    A.voices = [];
    for (let i = 0; i < 4; i++) {
      const o = ac.createOscillator();
      o.type = i === 0 || i === 3 ? 'sine' : 'triangle';
      o.frequency.value = mtof(i === 3 ? 62 : 50 + i * 7);
      const g = ac.createGain();
      g.gain.value = [0.24, 0.18, 0.18, 0.22][i];
      const vib = ac.createOscillator();
      vib.frequency.value = 0.1 + i * 0.07;
      const vg = ac.createGain();
      vg.gain.value = 1.2;
      vib.connect(vg);
      vg.connect(o.detune);
      vib.start();
      o.connect(g);
      g.connect(A.droneGain);
      o.start();
      A.voices.push(o);
    }
    A.ready = true;
    if (A.pending) { A.scene(A.pending); A.pending = null; }
  }

  // Quiet when the tab or app is in the background; the next tap wakes it if needed.
  document.addEventListener('visibilitychange', () => {
    if (!A.ctx) return;
    const p = document.hidden ? A.ctx.suspend() : A.ctx.resume();
    if (p && p.catch) p.catch(() => { /* the next tap resumes it */ });
  });

  A.unlock = function () {
    if (!A.ctx) {
      try { build(); } catch (e) { A.ctx = null; return; }
    }
    if (A.ctx && A.ctx.state === 'suspended') {
      const p = A.ctx.resume();
      if (p && p.catch) p.catch(() => { /* blocked until a gesture */ });
    }
  };

  A.setMuted = function (m) {
    A.muted = m;
    if (A.master) A.master.gain.setTargetAtTime(m ? 0 : MASTER, A.ctx.currentTime, 0.1);
  };

  // Ambience per scene: {wind, rain, water, room, drone: [midi...], droneLevel}
  A.scene = function (o) {
    for (const key of ['wind', 'rain', 'water', 'room']) A.targets[key] = o[key] || 0;
    A.targets.drone = o.droneLevel == null ? 0.25 : o.droneLevel;
    if (!A.ready) { A.pending = o; return; }
    if (o.drone) A.chord(o.drone, 4);
  };

  A.chord = function (notes, glide) {
    if (!A.ready) return;
    const t = A.ctx.currentTime;
    A.voices.forEach((v, i) => v.frequency.setTargetAtTime(mtof(i === 3 ? notes[0] + 12 : notes[i % notes.length]), t, glide || 2));
  };

  A.update = function (dt) {
    if (!A.ready) return;
    const t = A.ctx.currentTime;
    for (const key in A.levels) A.levels[key] = M.damp(A.levels[key], A.targets[key], 1.2, dt);
    const L = A.levels;
    const g = A.gust;
    A.windGain.gain.setTargetAtTime(L.wind * (0.06 + g * 0.26), t, 0.08);
    A.windLowGain.gain.setTargetAtTime(L.wind * (0.08 + g * 0.24), t, 0.1);
    A.windBand.frequency.setTargetAtTime(380 + g * 900 + Math.sin(G.time * 0.7) * 80, t, 0.15);
    A.rainGain.gain.setTargetAtTime(L.rain * 0.06, t, 0.2);
    A.waterGain.gain.setTargetAtTime(L.water * 0.18, t, 0.2);
    A.waterLfo.gain.setTargetAtTime(L.water * 0.1, t, 0.2);
    A.roomGain.gain.setTargetAtTime(L.room * 0.16, t, 0.2);
    A.droneGain.gain.setTargetAtTime(L.drone * 0.16, t, 0.3);
  };

  // --------------------------------------------------------------- small sounds
  function env(g, t, a, peak, d) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
  }
  function burst(freq, q, dur, vol, type, when) {
    if (!A.ready || A.muted) return;
    const ac = A.ctx, t = ac.currentTime + (when || 0);
    const s = ac.createBufferSource();
    s.buffer = A.white;
    const f = ac.createBiquadFilter();
    f.type = type || 'bandpass';
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ac.createGain();
    env(g, t, 0.004, vol, dur);
    s.connect(f);
    f.connect(g);
    g.connect(A.master);
    s.start(t, Math.random() * 2);
    s.stop(t + dur + 0.05);
  }

  // Soft bell / kalimba note for moments of noticing.
  A.chime = function (midi, vol, when) {
    if (!A.ready || A.muted) return;
    const ac = A.ctx, t = ac.currentTime + (when || 0);
    const f = mtof(midi);
    const out = ac.createGain();
    out.gain.value = vol == null ? 0.2 : vol;
    out.connect(A.master);
    out.connect(A.verbIn);
    [[1, 1, 2.4], [2.01, 0.35, 0.9], [3.98, 0.12, 0.4]].forEach(([mul, amp, dec]) => {
      const o = ac.createOscillator();
      o.type = 'sine';
      o.frequency.value = f * mul;
      const g = ac.createGain();
      env(g, t, 0.006, amp, dec);
      o.connect(g);
      g.connect(out);
      o.start(t);
      o.stop(t + dec + 0.1);
    });
  };
  A.arp = function (notes, gap, vol) {
    notes.forEach((n, i) => A.chime(n, vol == null ? 0.14 : vol, i * (gap || 0.18)));
  };

  // Footsteps: 'wood', 'stone', 'grass', 'wet'
  A.step = function (surface) {
    const r = Math.random();
    if (surface === 'stone') burst(1500 + r * 500, 1.5, 0.05, 0.05);
    else if (surface === 'grass') burst(3200 + r * 800, 0.8, 0.07, 0.025, 'highpass');
    else if (surface === 'wet') { burst(650 + r * 150, 1.8, 0.07, 0.07); burst(4200, 1, 0.05, 0.015, 'highpass', 0.01); }
    else burst(780 + r * 220, 2.2, 0.06, 0.07);
  };

  A.thud = function (vol) {
    if (!A.ready || A.muted) return;
    const ac = A.ctx, t = ac.currentTime;
    burst(180, 0.8, 0.25, (vol || 1) * 0.35, 'lowpass');
    const o = ac.createOscillator();
    o.frequency.setValueAtTime(80, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.3);
    const g = ac.createGain();
    env(g, t, 0.005, (vol || 1) * 0.35, 0.35);
    o.connect(g);
    g.connect(A.master);
    o.start(t);
    o.stop(t + 0.45);
  };

  A.stitch = function () {
    burst(3600, 2, 0.02, 0.08, 'highpass');
    if (!A.ready || A.muted) return;
    const ac = A.ctx, t = ac.currentTime;
    const o = ac.createOscillator();
    o.frequency.value = 1400 + Math.random() * 300;
    const g = ac.createGain();
    env(g, t, 0.002, 0.03, 0.03);
    o.connect(g);
    g.connect(A.master);
    o.start(t);
    o.stop(t + 0.06);
  };

  A.tear = function (dur) {
    const d = dur || 0.8;
    for (let i = 0; i < 34; i++) {
      const w = (i / 34) * d + Math.random() * 0.02;
      burst(1300 + Math.random() * 2400, 1.2, 0.02 + Math.random() * 0.03, 0.05 + Math.random() * 0.07, 'bandpass', w);
    }
  };

  A.rustle = function (vol) { burst(2600, 0.6, 0.35, vol || 0.05, 'highpass'); };

  A.creak = function () {
    if (!A.ready || A.muted) return;
    const ac = A.ctx, t = ac.currentTime;
    const o = ac.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(70, t);
    o.frequency.linearRampToValueAtTime(96, t + 0.35);
    o.frequency.linearRampToValueAtTime(64, t + 0.6);
    const f = ac.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 700;
    f.Q.value = 4;
    const g = ac.createGain();
    env(g, t, 0.05, 0.05, 0.6);
    o.connect(f);
    f.connect(g);
    g.connect(A.master);
    o.start(t);
    o.stop(t + 0.75);
  };

  A.bird = function () {
    if (!A.ready || A.muted) return;
    const ac = A.ctx;
    const n = 2 + Math.floor(Math.random() * 3);
    const base = 2600 + Math.random() * 1400;
    for (let i = 0; i < n; i++) {
      const t = ac.currentTime + i * (0.12 + Math.random() * 0.05);
      const o = ac.createOscillator();
      o.frequency.setValueAtTime(base, t);
      o.frequency.exponentialRampToValueAtTime(base * (1.3 + Math.random() * 0.4), t + 0.05);
      o.frequency.exponentialRampToValueAtTime(base * 0.9, t + 0.09);
      const g = ac.createGain();
      env(g, t, 0.01, 0.018, 0.09);
      o.connect(g);
      g.connect(A.master);
      g.connect(A.verbIn);
      o.start(t);
      o.stop(t + 0.14);
    }
  };
})();
