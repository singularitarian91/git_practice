// HUD minimap: the island around you, turned so "up" is where the camera
// looks (or north up), with villagers, the Gloam, home, and the reach of
// firelight after dark.  Click it for the full map; scroll over it to zoom.
import { getMapBase, homePos } from './mapbase.js';

const TAU = Math.PI * 2;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export class Minimap {
  constructor(ui) {
    this.ui = ui;
    this.el = document.createElement('div');
    this.el.className = 'minimap interactive';
    this.el.title = 'Map (M) · scroll to zoom';
    this.el.innerHTML = '<canvas></canvas><div class="mm-zone"></div>';
    this.cv = this.el.querySelector('canvas');
    this.zoneEl = this.el.querySelector('.mm-zone');
    this.range = 44; // metres from the centre to the rim
    this.t = 1;
    this.zone = null;
    // keep clicks here out of the world (and out of dialogue advancing)
    this.el.addEventListener('pointerdown', (e) => e.stopPropagation());
    this.el.addEventListener('click', () => { if (ui.game && !ui.blocking) ui.open('map'); });
    this.el.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.range = clamp(this.range * (e.deltaY > 0 ? 1.15 : 1 / 1.15), 22, 110);
      this.t = 1;
    }, { passive: false });
  }

  get mode() {
    const m = this.ui.game && this.ui.game.settings.minimap;
    return m === 'off' || m === 'north' ? m : 'rotate';
  }

  update(dt) {
    const g = this.ui.game;
    if (!g) return;
    const on = this.mode !== 'off';
    this.el.classList.toggle('off', !on);
    this.ui.hud.classList.toggle('has-minimap', on);
    if (!on) return;
    if (this.ui.zoneName !== this.zone) { this.zone = this.ui.zoneName; this.zoneEl.textContent = this.zone || ''; }
    this.t += dt;
    if (this.t < 1 / 24) return;
    this.t = 0;
    this.draw(g);
  }

  draw(g) {
    const base = getMapBase(g);
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const N = Math.max(32, Math.round((this.el.clientWidth || 148) * dpr));
    const cv = this.cv;
    if (cv.width !== N) cv.width = cv.height = N;
    const c = cv.getContext('2d');
    const R = N / 2;
    const m2px = R / this.range;
    const p = g.player.pos;
    const turn = this.mode === 'rotate' ? g.camera.yaw : 0;
    const cos = Math.cos(turn), sin = Math.sin(turn);
    // world (x, z) -> canvas, rotated about the player
    const at = (x, z) => {
      const dx = (x - p.x) * m2px, dz = (z - p.z) * m2px;
      return [R + dx * cos - dz * sin, R + dx * sin + dz * cos];
    };
    const inside = (x, y, pad = 0) => (x - R) ** 2 + (y - R) ** 2 < (R - pad) ** 2;

    c.save();
    c.clearRect(0, 0, N, N);
    c.beginPath(); c.arc(R, R, R, 0, TAU); c.clip();
    c.fillStyle = '#0e1418';
    c.fillRect(0, 0, N, N);
    // the ground, turned with the view
    c.save();
    c.translate(R, R);
    c.rotate(turn);
    const [bx, by] = base.toPx(p.x, p.z);
    const rb = this.range * base.k; // rim radius in map pixels
    const s = m2px / base.k;
    c.imageSmoothingEnabled = true;
    c.drawImage(base.canvas, bx - rb, by - rb, rb * 2, rb * 2, -rb * s, -rb * s, rb * 2 * s, rb * 2 * s);
    c.restore();

    // after dark: dim the land and show where firelight keeps the Gloam away
    const dark = g.darkness;
    if (dark > 0.05) {
      c.fillStyle = `rgba(6, 8, 18, ${0.36 * dark})`;
      c.fillRect(0, 0, N, N);
      c.globalCompositeOperation = 'lighter';
      for (const src of g.engine.lighting.sources) {
        if (!src.enabled || !src.safe) continue;
        const [x, y] = at(src.pos.x, src.pos.z);
        const r = src.safe * m2px;
        if ((x - R) ** 2 + (y - R) ** 2 > (R + r) ** 2) continue;
        const grd = c.createRadialGradient(x, y, 0, x, y, r);
        grd.addColorStop(0, `rgba(255, 175, 85, ${0.5 * dark})`);
        grd.addColorStop(1, 'rgba(255, 150, 60, 0.04)');
        c.fillStyle = grd;
        c.beginPath(); c.arc(x, y, r, 0, TAU); c.fill();
        // the edge the Gloam won't cross
        c.lineWidth = dpr; c.strokeStyle = `rgba(255, 190, 110, ${0.3 * dark})`; c.stroke();
      }
      c.globalCompositeOperation = 'source-over';
    }

    // rim shading
    const rim = c.createRadialGradient(R, R, R * 0.7, R, R, R);
    rim.addColorStop(0, 'rgba(0, 0, 0, 0)');
    rim.addColorStop(1, 'rgba(0, 0, 0, 0.45)');
    c.fillStyle = rim;
    c.fillRect(0, 0, N, N);

    const dot = (x, y, r, fill) => {
      c.beginPath(); c.arc(x, y, r, 0, TAU);
      c.fillStyle = fill; c.fill();
      c.lineWidth = dpr; c.strokeStyle = 'rgba(12, 8, 4, 0.9)'; c.stroke();
    };
    // home: pinned to the rim when it's out of view, so you can find your bed
    const hp = homePos(g);
    let [hx, hy] = at(hp.x, hp.z);
    const pad = 9 * dpr;
    const away = !inside(hx, hy, pad);
    if (away) {
      const a = Math.atan2(hy - R, hx - R);
      hx = R + Math.cos(a) * (R - pad); hy = R + Math.sin(a) * (R - pad);
    }
    this.house(c, hx, hy, 4.5 * dpr, away);
    // villagers and the Gloam
    for (const n of g.npcs.list) {
      if (!n.visible) continue;
      const [x, y] = at(n.pos.x, n.pos.z);
      if (inside(x, y, 3 * dpr)) dot(x, y, 3.2 * dpr, '#e6a44a');
    }
    for (const e of g.enemies.list) {
      if (!e.alive) continue;
      const [x, y] = at(e.pos.x, e.pos.z);
      if (inside(x, y, 3 * dpr)) dot(x, y, (e === g.enemies.boss ? 5 : 3) * dpr, '#d8453a');
    }
    // you, facing the way you face
    c.save();
    c.translate(R, R);
    c.rotate(turn + Math.PI - g.player.facing);
    c.beginPath();
    c.moveTo(0, -7 * dpr); c.lineTo(5 * dpr, 5.5 * dpr); c.lineTo(0, 3 * dpr); c.lineTo(-5 * dpr, 5.5 * dpr); c.closePath();
    c.fillStyle = '#fff4d0'; c.fill();
    c.lineWidth = dpr; c.strokeStyle = 'rgba(12, 8, 4, 0.95)'; c.stroke();
    c.restore();
    // north
    const nr = R - 8 * dpr;
    c.font = `700 ${10 * dpr}px Cinzel, Georgia, serif`;
    c.textAlign = 'center'; c.textBaseline = 'middle';
    c.lineWidth = 3 * dpr; c.strokeStyle = 'rgba(8, 6, 4, 0.9)';
    c.strokeText('N', R + Math.sin(turn) * nr, R - Math.cos(turn) * nr);
    c.fillStyle = '#e6a44a';
    c.fillText('N', R + Math.sin(turn) * nr, R - Math.cos(turn) * nr);
    c.restore();
  }

  // a little house: upright whatever way the map is turned
  house(c, x, y, r, dim) {
    c.save();
    c.translate(x, y);
    c.beginPath();
    c.moveTo(0, -r * 1.25); c.lineTo(r, -r * 0.2); c.lineTo(r * 0.75, -r * 0.2); c.lineTo(r * 0.75, r);
    c.lineTo(-r * 0.75, r); c.lineTo(-r * 0.75, -r * 0.2); c.lineTo(-r, -r * 0.2); c.closePath();
    c.fillStyle = dim ? 'rgba(241, 230, 205, 0.8)' : '#f1e6cd';
    c.fill();
    c.lineWidth = Math.max(1, r * 0.25); c.strokeStyle = 'rgba(12, 8, 4, 0.9)';
    c.stroke();
    c.restore();
  }
}
