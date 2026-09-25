// On-screen controls for touch devices: a floating joystick on the left,
// action buttons on the right, drag-to-orbit and pinch-to-zoom camera, and
// shortcut buttons for the menus.  Buttons reuse the keyboard paths by
// feeding the Input object (and synthetic key events for the menus).
const h = (tag, cls, html) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;
  return e;
};

export function isTouchDevice() {
  try {
    return (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) || navigator.maxTouchPoints > 0 && !window.matchMedia('(pointer: fine)').matches;
  } catch { return false; }
}

export class TouchControls {
  constructor(root, input, canvas) {
    this.input = input;
    this.canvas = canvas;
    input.touchMode = true;
    input.touchMove = { x: 0, y: 0 };
    this.el = h('div', 'touch');
    this.el.innerHTML = `
      <div class="joy"><div class="joy-knob"></div></div>
      <div class="tbtns">
        <button class="tb tb-use interactive" aria-label="Use tool">⚒</button>
        <button class="tb tb-act interactive" aria-label="Interact">E</button>
        <button class="tb tb-roll interactive" aria-label="Dodge">⤳</button>
      </div>
      <div class="ttop">
        <button class="tt interactive" data-k="Tab">Pack</button>
        <button class="tt interactive" data-k="KeyC">Craft</button>
        <button class="tt interactive" data-k="KeyJ">Journal</button>
        <button class="tt interactive" data-k="KeyM">Map</button>
        <button class="tt interactive" data-k="Escape">☰</button>
      </div>`;
    root.appendChild(this.el);
    this.joy = this.el.querySelector('.joy');
    this.knob = this.el.querySelector('.joy-knob');
    this.pointers = new Map(); // id -> { role, x0, y0, x, y }
    this.pinch = null;

    const press = (code) => {
      window.dispatchEvent(new KeyboardEvent('keydown', { code, key: code === 'Escape' ? 'Escape' : code, bubbles: true }));
      setTimeout(() => window.dispatchEvent(new KeyboardEvent('keyup', { code, bubbles: true })), 60);
    };
    const hold = (btn, down, up) => {
      btn.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); btn.classList.add('on'); down(); });
      const end = (e) => { btn.classList.remove('on'); if (up) up(); };
      btn.addEventListener('pointerup', end);
      btn.addEventListener('pointercancel', end);
      btn.addEventListener('pointerleave', end);
    };
    hold(this.el.querySelector('.tb-use'), () => { input.buttons[0] = true; input.btnPressed[0] = true; }, () => { input.buttons[0] = false; });
    hold(this.el.querySelector('.tb-act'), () => press('KeyE'));
    hold(this.el.querySelector('.tb-roll'), () => press('Space'));
    this.el.querySelectorAll('.tt').forEach((b) => b.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); press(b.dataset.k); }));

    // joystick & camera on the canvas
    canvas.style.touchAction = 'none';
    canvas.addEventListener('pointerdown', (e) => this.down(e));
    window.addEventListener('pointermove', (e) => this.move(e));
    window.addEventListener('pointerup', (e) => this.up(e));
    window.addEventListener('pointercancel', (e) => this.up(e));
  }

  down(e) {
    if (e.pointerType === 'mouse') return;
    e.preventDefault(); // no synthetic mouse events (they would swing tools)
    const left = e.clientX < window.innerWidth * 0.45;
    const role = left && ![...this.pointers.values()].some((p) => p.role === 'joy') ? 'joy' : 'cam';
    this.pointers.set(e.pointerId, { role, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY });
    if (role === 'joy') {
      this.joy.style.left = `${e.clientX}px`;
      this.joy.style.top = `${e.clientY}px`;
      this.joy.classList.add('on');
    }
    const cams = [...this.pointers.values()].filter((p) => p.role === 'cam');
    if (cams.length === 2) this.pinch = Math.hypot(cams[0].x - cams[1].x, cams[0].y - cams[1].y);
  }

  move(e) {
    const p = this.pointers.get(e.pointerId);
    if (!p) return;
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    p.x = e.clientX; p.y = e.clientY;
    if (p.role === 'joy') {
      const R = 52;
      let jx = (p.x - p.x0) / R, jy = (p.y - p.y0) / R;
      const L = Math.hypot(jx, jy);
      if (L > 1) { jx /= L; jy /= L; }
      this.input.touchMove.x = jx;
      this.input.touchMove.y = jy;
      this.input.touchSprint = L > 1.25; // drag past the ring to run
      this.joy.classList.toggle('run', L > 1.25);
      this.knob.style.transform = `translate(${jx * R}px, ${jy * R}px)`;
    } else {
      const cams = [...this.pointers.values()].filter((q) => q.role === 'cam');
      if (cams.length === 2) {
        const d = Math.hypot(cams[0].x - cams[1].x, cams[0].y - cams[1].y);
        if (this.pinch) this.input.wheel += (this.pinch - d) * 0.02;
        this.pinch = d;
      } else {
        this.input.drag.dx += dx * 1.2;
        this.input.drag.dy += dy * 1.2;
      }
    }
  }

  up(e) {
    const p = this.pointers.get(e.pointerId);
    if (!p) return;
    this.pointers.delete(e.pointerId);
    if (p.role === 'joy') {
      this.input.touchMove.x = 0;
      this.input.touchMove.y = 0;
      this.input.touchSprint = false;
      this.knob.style.transform = '';
      this.joy.classList.remove('on', 'run');
    }
    this.pinch = null;
  }
}
