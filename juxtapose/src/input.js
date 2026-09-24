// Keyboard + mouse input with pointer lock (and a graceful unlocked fallback).

const BIND = {
  forward: ['KeyW', 'ArrowUp'],
  back: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  jump: ['Space'],
  dash: ['ShiftLeft', 'ShiftRight'],
  crouch: ['KeyC', 'ControlLeft', 'ControlRight'],
  take: ['KeyQ'],
  give: ['KeyE'],
  giveSelf: ['KeyZ'],
  giveRounds: ['KeyG'],
  melee: ['KeyF'],
  focus: ['KeyX'],
  reload: ['KeyR'],
  wheel: ['Tab'],
  shoulder: ['KeyV'],
  pause: ['Escape'],
  photo: ['KeyP'],
  help: ['KeyH'],
  sandbox: ['KeyB'],
};

export class Input {
  constructor(el) {
    this.el = el;
    this.down = new Set();
    this.pressed = new Set();   // edge-triggered this frame
    this.released = new Set();
    this.mouse = { dx: 0, dy: 0, x: 0, y: 0, buttons: 0, wheel: 0 };
    this.mousePressed = new Set();
    this.mouseReleased = new Set();
    this.locked = false;
    this.lockFailed = false;
    this.sensitivity = 0.0022;
    this.invertY = false;
    this.enabled = true;
    this.onLockChange = null;

    addEventListener('keydown', (e) => {
      // Tab, Space and the arrows belong to the game, except while a menu or
      // panel is open: there they move focus, press buttons and nudge sliders.
      if ((e.code === 'Tab' || e.code === 'Space' || e.code.startsWith('Arrow')) && !Input.inMenu(e.target)) e.preventDefault();
      if (!this.down.has(e.code)) this.pressed.add(e.code);
      this.down.add(e.code);
      if (/^Digit[0-9]$/.test(e.code)) this.pressed.add(e.code);
    });
    addEventListener('keyup', (e) => {
      this.down.delete(e.code);
      this.released.add(e.code);
    });
    addEventListener('blur', () => { this.down.clear(); this.mouse.buttons = 0; });
    el.addEventListener('mousedown', (e) => {
      this.mouse.buttons |= 1 << e.button;
      this.mousePressed.add(e.button);
      e.preventDefault();
    });
    addEventListener('mouseup', (e) => {
      this.mouse.buttons &= ~(1 << e.button);
      this.mouseReleased.add(e.button);
    });
    addEventListener('mousemove', (e) => {
      this.mouse.x = e.clientX; this.mouse.y = e.clientY;
      if (this.locked) {
        this.mouse.dx += e.movementX; this.mouse.dy += e.movementY;
      } else if (this.lockFailed && this.enabled && (this.mouse.buttons & 1 || this.mouse.buttons & 4 || this.freeLook)) {
        this.mouse.dx += e.movementX; this.mouse.dy += e.movementY;
      }
    });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    addEventListener('wheel', (e) => { this.mouse.wheel += Math.sign(e.deltaY); }, { passive: true });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === el;
      if (this.locked) this.softPending = false;
      this.onLockChange && this.onLockChange(this.locked);
    });
    document.addEventListener('pointerlockerror', () => {
      if (this.softPending) { this.softPending = false; return; }
      this.lockFailed = true; this.freeLook = true;
    });
  }

  // soft: a failure (say, no user gesture behind the request) is not taken as
  // "this browser has no pointer lock"; the next click on the dream retries.
  requestLock({ soft = false, onFail = null } = {}) {
    if (this.locked) return;
    this.softPending = soft;
    const fail = () => { if (!soft) { this.lockFailed = true; this.freeLook = true; } if (onFail) onFail(); };
    try {
      const p = this.el.requestPointerLock && this.el.requestPointerLock();
      if (p && p.catch) p.catch(fail);
    } catch (e) { fail(); }
  }
  // true while a menu, panel or form control has the keyboard
  static inMenu(target) {
    if (target && target.closest && target.closest('.screen, #sandbox-panel, #photo-panel, input, select, button, textarea')) return true;
    return !!document.querySelector('.screen:not([hidden]), #photo-panel:not([hidden])');
  }
  exitLock() { if (document.pointerLockElement) document.exitPointerLock(); }

  is(action) { return this.enabled && BIND[action].some((c) => this.down.has(c)); }
  hit(action) { return this.enabled && BIND[action].some((c) => this.pressed.has(c)); }
  up(action) { return BIND[action].some((c) => this.released.has(c)); }
  btn(b) { return this.enabled && (this.mouse.buttons & (1 << b)) !== 0; }
  click(b) { return this.enabled && this.mousePressed.has(b); }
  digit() {
    for (let i = 1; i <= 9; i++) if (this.pressed.has('Digit' + i)) return i;
    if (this.pressed.has('Digit0')) return 10;
    return 0;
  }
  moveAxis() {
    let x = 0, z = 0;
    if (this.is('forward')) z += 1;
    if (this.is('back')) z -= 1;
    if (this.is('left')) x += 1;
    if (this.is('right')) x -= 1;
    const l = Math.hypot(x, z);
    return l > 0 ? { x: x / l, z: z / l } : { x: 0, z: 0 };
  }
  takeLook() {
    const d = { x: this.mouse.dx * this.sensitivity, y: this.mouse.dy * this.sensitivity * (this.invertY ? -1 : 1) };
    this.mouse.dx = 0; this.mouse.dy = 0;
    return this.enabled ? d : { x: 0, y: 0 };
  }
  takeWheel() { const w = this.mouse.wheel; this.mouse.wheel = 0; return this.enabled ? w : 0; }
  endFrame() {
    this.pressed.clear(); this.released.clear();
    this.mousePressed.clear(); this.mouseReleased.clear();
  }
}
