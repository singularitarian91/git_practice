# git_practice

## Psychedelic Particle Visualizer

An audio-reactive 3D particle system in a single self-contained HTML file.
No build step, no dependencies — open `visualizer.html` in a browser.

```
xdg-open visualizer.html      # or just double-click it
```

### Hooking up your music

On the start screen, pick one of:

| Source | How it works | Notes |
|---|---|---|
| **System / Tab audio** | `getDisplayMedia({audio:true})` | Best quality. Chrome/Edge. Pick a **tab** (Spotify, YouTube) and tick **"Also share tab audio"**. For everything at once choose **Entire Screen + share system audio** (Windows/ChromeOS only — macOS doesn't expose system audio). |
| **Microphone** | `getUserMedia({audio:true})` | Works in every browser; just listens to your speakers. |
| **No audio** | — | Falls back to a synthesized 120 BPM groove so it still moves. |

Audio is analyzed locally and never leaves the page — the stream is wired into
an `AnalyserNode` only, and is deliberately *not* connected to the output, so
there's no echo or feedback.

### How the audio drives the visuals

A 2048-point FFT is split into six bands plus twelve log-spaced bins:

- **Sub / bass** — vortex rotation speed, helix radius, particle size, radial thrust
- **Mids** — attractor drift, barrel-roll rate, camera spin, saturation swing
- **Treble** — turbulence, hue shimmer, chromatic aberration
- **Spectral centroid** — global hue rotation (bright music sweeps the palette)
- **Beat detection** — adaptive threshold on low-end energy against a 50-frame
  rolling mean/variance. Each beat fires a particle shockwave, an FOV punch,
  camera shake, a frame-warp, and a white flash. Inter-onset intervals give a
  live BPM readout.

### Modes

`Vortex` · `Nebula` · `Tunnel` · `Spectrum` · `Helix` · `Chaos` · `Supernova`

`Spectrum` arranges particles into twelve wedges whose height tracks their
frequency bin; `Tunnel` flies you through a ring whose radius is modulated by
the spectrum.

### Rendering

Custom WebGL — no three.js. Particles are drawn additively as shader-generated
glowing orbs into a ping-ponged trail buffer with a slow rotational smear, then
put through a bright-pass → separable Gaussian bloom (two iterations at half
res) and composited with chromatic aberration, beat-driven barrel warp,
vignette, filmic tone mapping, and dither grain.

Up to 60k particles with CPU-side physics, governed by an adaptive quality
throttle that backs off emission if the frame rate drops below ~50fps.

### Controls

| Input | Action |
|---|---|
| Drag | Orbit camera |
| Scroll | Zoom |
| Click | Drop a temporary gravity attractor |
| `Space` | Manual shockwave |
| `H` | Hide/show UI |
