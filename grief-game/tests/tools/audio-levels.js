#!/usr/bin/env node
/* Records what the player hears in each chapter while it is played, then reports loudness,
 * peaks and how much of the sound sits in bands a phone speaker can't play well.
 * Writes a listenable WAV per chapter to tests/output/audio/.
 *   npm run audio-levels
 * Targets used when mixing: average about -24 dBFS, chapters within about 3 dB of each other,
 * peaks below -3 dBFS.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const lib = require('../lib');
const OUT = path.join(lib.OUTPUT, 'audio');

async function startRecording(g) {
  await g.eval(() => {
    G.audio.unlock();
    const A = G.audio, ac = A.ctx;
    const tap = ac.createScriptProcessor(4096, 2, 2);
    window.__rec = { L: [], R: [], sr: ac.sampleRate };
    tap.onaudioprocess = e => {
      window.__rec.L.push(new Float32Array(e.inputBuffer.getChannelData(0)));
      window.__rec.R.push(new Float32Array(e.inputBuffer.getChannelData(1)));
    };
    A.out.connect(tap);
    const sink = ac.createGain();
    sink.gain.value = 0;
    tap.connect(sink);
    sink.connect(ac.destination);
    window.__tap = tap;
  });
}

// Mono 22.05 kHz 16-bit samples of the recording.
async function stopRecording(g) {
  const b64 = await g.eval(() => {
    const r = window.__rec;
    window.__tap.disconnect();
    const n = r.L.reduce((a, b) => a + b.length, 0);
    const ratio = r.sr / 22050, m = Math.floor(n / ratio), pcm = new Int16Array(m);
    let chunk = 0, off = 0;
    for (let i = 0; i < m; i++) {
      let j = Math.floor(i * ratio) - off;
      while (chunk < r.L.length && j >= r.L[chunk].length) { off += r.L[chunk].length; j -= r.L[chunk].length; chunk++; }
      if (chunk >= r.L.length) break;
      pcm[i] = Math.max(-1, Math.min(1, (r.L[chunk][j] + r.R[chunk][j]) / 2)) * 32767;
    }
    let bin = '';
    const bytes = new Uint8Array(pcm.buffer);
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  });
  const buf = Buffer.from(b64, 'base64');
  return new Int16Array(buf.buffer, buf.byteOffset, buf.length / 2);
}

function writeWav(file, pcm) {
  const data = Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVE', 8); h.write('fmt ', 12);
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(22050, 24);
  h.writeUInt32LE(44100, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(data.length, 40);
  fs.writeFileSync(file, Buffer.concat([h, data]));
}

// In-place radix-2 FFT on 4096-sample frames; returns the share of energy below `lo` Hz and above `hi` Hz.
function bandShares(pcm, sr, lo, hi) {
  const N = 4096, re = new Float64Array(N), im = new Float64Array(N);
  let low = 0, high = 0, all = 0;
  for (let start = 0; start + N <= pcm.length; start += N) {
    for (let i = 0; i < N; i++) { re[i] = (pcm[start + i] / 32768) * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1))); im[i] = 0; }
    for (let i = 1, j = 0; i < N; i++) {
      let bit = N >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
    }
    for (let len = 2; len <= N; len <<= 1) {
      const ang = (-2 * Math.PI) / len, wr = Math.cos(ang), wi = Math.sin(ang);
      for (let i = 0; i < N; i += len) {
        let cr = 1, ci = 0;
        for (let k = 0; k < len / 2; k++) {
          const ar = re[i + k], ai = im[i + k];
          const br = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci, bi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
          re[i + k] = ar + br; im[i + k] = ai + bi;
          re[i + k + len / 2] = ar - br; im[i + k + len / 2] = ai - bi;
          const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t;
        }
      }
    }
    for (let b = 1; b < N / 2; b++) {
      const p = re[b] * re[b] + im[b] * im[b], f = (b * sr) / N;
      all += p;
      if (f < lo) low += p;
      if (f > hi) high += p;
    }
  }
  return { low: (100 * low) / all, high: (100 * high) / all };
}

const db = v => (v > 0 ? 20 * Math.log10(v) : -Infinity).toFixed(1);

const PLAYS = {
  title: { hash: '', run: async g => { await g.sleep(6000); await g.click(120, 530); await g.sleep(3500); } },
  denial: { hash: '#ch1', run: async g => { await g.clickWorld(905, 436); await g.sleep(3500); await g.clickWorld(1160, 430); await g.sleep(6500); await g.clickWorld(905, 436); await g.sleep(4000); } },
  anger: { hash: '#ch2', run: async g => { await g.page.keyboard.down('KeyD'); await g.sleep(16000); await g.page.keyboard.up('KeyD'); } },
  bargaining: {
    hash: '#ch3',
    run: async g => {
      for (const [c, r, n] of [[1, 1, 2], [1, 2, 2], [2, 2, 1], [3, 2, 2], [3, 1, 1], [3, 0, 2], [4, 0, 1]]) {
        for (let i = 0; i < n; i++) { await g.click(265 + c * 150 + 75, 150 + r * 150 + 75); await g.sleep(500); }
      }
      await g.sleep(4000);
    }
  },
  depression: {
    hash: '#ch4',
    run: async g => {
      await g.page.keyboard.down('KeyD'); await g.sleep(5000); await g.page.keyboard.up('KeyD');
      await g.sleep(4500);
      const l = await g.eval(() => G.scene.lives[0] && { x: G.scene.lives[0].item.gx, y: G.scene.lives[0].item.gy });
      if (l) await g.clickWorld(l.x, l.y);
      await g.sleep(6000);
    }
  },
  acceptance: {
    hash: '#ch5',
    run: async g => {
      const s = await g.worldToStage(470, 186);
      const p = await g.stageToPage(s.x, s.y);
      await g.page.mouse.move(p.x, p.y); await g.page.mouse.down(); await g.sleep(4500); await g.page.mouse.up();
      await g.sleep(8000);
    }
  }
};

(async () => {
  await lib.setup();
  fs.mkdirSync(OUT, { recursive: true });
  console.log('scene        | average   | loudest 0.1 s | peak      | below 250 Hz | above 2 kHz');
  for (const [name, play] of Object.entries(PLAYS)) {
    const g = await lib.open({ hash: play.hash });
    await startRecording(g);
    await play.run(g);
    const pcm = await stopRecording(g);
    const win = 2205;
    let sum = 0, peak = 0, loudest = 0;
    for (let i = 0; i + win <= pcm.length; i += win) {
      let s = 0;
      for (let j = i; j < i + win; j++) { const v = pcm[j] / 32768; s += v * v; peak = Math.max(peak, Math.abs(v)); }
      sum += s;
      loudest = Math.max(loudest, Math.sqrt(s / win));
    }
    const avg = Math.sqrt(sum / pcm.length);
    const bands = bandShares(pcm, 22050, 250, 2000);
    writeWav(path.join(OUT, name + '.wav'), pcm);
    console.log(
      name.padEnd(12) + ' | ' + (db(avg) + ' dBFS').padStart(9) + ' | ' + (db(loudest) + ' dBFS').padStart(13) + ' | ' + (db(peak) + ' dBFS').padStart(9) +
      ' | ' + (bands.low.toFixed(0) + '%').padStart(12) + ' | ' + (bands.high.toFixed(0) + '%').padStart(11)
    );
    await lib.closeAll();
  }
  console.log('\nWAV files: ' + OUT);
  await lib.teardown();
})().catch(async e => { console.error(e); await lib.teardown(); process.exit(1); });
