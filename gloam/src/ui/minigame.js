// Stardew-style reeling minigame: hold the mouse (or Space) to lift the
// green catch zone and keep the fish inside it until the meter fills.
const h = (tag, cls, html) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;
  return e;
};

export class FishingGame {
  constructor(ui) {
    this.ui = ui;
    this.active = false;
    this.el = h('div', 'fishgame');
    this.el.innerHTML = `
      <div class="fg-track"><div class="fg-zone"></div><img class="fg-fish" alt=""><div class="fg-water"></div></div>
      <div class="fg-meter"><div class="fg-fill"></div></div>
      <div class="fg-hint">Hold <b>mouse</b> or <kbd>Space</kbd></div>`;
    ui.root.appendChild(this.el);
    this.zoneEl = this.el.querySelector('.fg-zone');
    this.fishEl = this.el.querySelector('.fg-fish');
    this.fillEl = this.el.querySelector('.fg-fill');
    this.hold = false;
    window.addEventListener('pointerdown', (e) => { if (this.active && e.button === 0) this.hold = true; });
    window.addEventListener('pointerup', (e) => { if (e.button === 0) this.hold = false; });
    window.addEventListener('pointercancel', () => { this.hold = false; });
    window.addEventListener('keydown', (e) => { if (this.active && e.code === 'Space') { this.hold = true; e.preventDefault(); } });
    window.addEventListener('keyup', (e) => { if (e.code === 'Space') this.hold = false; });
  }

  start(fish, rodLevel = 0) {
    return new Promise((resolve) => {
      this.resolve = resolve;
      this.fish = fish;
      const d = fish.diff;
      this.zh = Math.max(0.16, 0.3 + rodLevel * 0.07 - d * 0.1);
      this.zy = 0;
      this.zv = 0;
      this.fy = 0.35;
      this.fv = 0;
      this.ty = 0.5;
      this.tT = 0;
      this.p = 0.3;
      this.mode = fish.move;
      this.active = true;
      this.hold = false;
      this.ui.overlayBusy = true;
      this.ui.timeRuns = true;
      this.fishEl.src = this.ui.icons.get(this.ui.game.fishing.fishId) || '';
      this.el.querySelector('.fg-hint').innerHTML = document.body.classList.contains('is-touch')
        ? 'Hold a finger <b>anywhere</b>' : 'Hold <b>mouse</b> or <kbd>Space</kbd>';
      this.el.classList.add('show');
    });
  }

  stop(ok) {
    if (!this.active) return;
    this.active = false;
    this.el.classList.remove('show');
    this.ui.overlayBusy = false;
    this.ui.timeRuns = false;
    const r = this.resolve;
    this.resolve = null;
    if (r) r(ok);
  }

  update(dt) {
    if (!this.active) return;
    dt = Math.min(dt, 0.05);
    const d = this.fish.diff;
    // zone physics
    this.zv += (this.hold ? 3.4 : -2.8) * dt;
    this.zv *= Math.exp(-dt * 1.2);
    this.zy += this.zv * dt;
    if (this.zy < 0) { this.zy = 0; this.zv *= -0.35; }
    if (this.zy > 1 - this.zh) { this.zy = 1 - this.zh; this.zv *= -0.35; }
    // fish behaviour
    this.tT -= dt;
    if (this.tT <= 0) {
      let mode = this.mode;
      if (mode === 'mixed') mode = ['smooth', 'dart', 'sink', 'float'][Math.floor(Math.random() * 4)];
      if (mode === 'smooth') { this.ty = Math.min(0.95, Math.max(0.05, this.fy + (Math.random() - 0.5) * 0.6)); this.tT = 0.8 + Math.random(); }
      else if (mode === 'dart') { this.ty = 0.05 + Math.random() * 0.9; this.tT = 0.35 + Math.random() * 0.8 * (1.2 - d); }
      else if (mode === 'sink') { this.ty = Math.random() * 0.45; this.tT = 0.6 + Math.random(); }
      else { this.ty = 0.55 + Math.random() * 0.4; this.tT = 0.6 + Math.random(); }
    }
    const spd = 0.9 + d * 3.2;
    this.fv += (this.ty - this.fy) * spd * dt * 6;
    this.fv *= Math.exp(-dt * (4 - d * 1.5));
    this.fy = Math.min(0.98, Math.max(0.02, this.fy + this.fv * dt));
    // progress
    const inZone = this.fy >= this.zy && this.fy <= this.zy + this.zh;
    this.p += inZone ? 0.27 * dt : -0.19 * dt * (0.7 + d);
    this.zoneEl.classList.toggle('on', inZone);
    // draw
    this.zoneEl.style.bottom = `${this.zy * 100}%`;
    this.zoneEl.style.height = `${this.zh * 100}%`;
    this.fishEl.style.bottom = `calc(${this.fy * 100}% - 14px)`;
    this.fillEl.style.transform = `scaleY(${Math.max(0, Math.min(1, this.p))})`;
    this.fillEl.style.background = this.p < 0.25 ? '#b84a3a' : this.p < 0.6 ? '#d9b44a' : '#8fbf6a';
    if (inZone && Math.random() < dt * 6 && this.ui.game) this.ui.game.audio.sfx('reel', { volume: 0.25, pitch: 1.2 });
    if (this.p >= 1) this.stop(true);
    else if (this.p <= 0) this.stop(false);
  }
}
