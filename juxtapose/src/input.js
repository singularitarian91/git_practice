// Keyboard + mouse input with pointer lock (and a graceful unlocked fallback).

// Pad<n> are the buttons of a standard-mapping gamepad (Xbox layout names below)
const BIND = {
  forward: ['KeyW', 'ArrowUp'],
  back: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  jump: ['Space', 'Pad0'],              // A
  dash: ['ShiftLeft', 'ShiftRight', 'Pad1'], // B
  crouch: ['KeyC', 'ControlLeft', 'ControlRight', 'Pad10'], // left stick click
  take: ['KeyQ', 'Pad4'],               // LB
  give: ['KeyE', 'Pad5'],               // RB
  giveSelf: ['KeyZ', 'Pad12'],          // d-pad up
  giveRounds: ['KeyG', 'Pad13'],        // d-pad down
  melee: ['KeyF', 'Pad2'],              // X
  focus: ['KeyX', 'Pad3'],              // Y (hold)
  reload: ['KeyR'],
  wheel: ['Tab'],
  shoulder: ['KeyV', 'Pad11'],          // right stick click
  pause: ['Escape', 'Pad9'],            // Start
  photo: ['KeyP'],
  help: ['KeyH'],
  sandbox: ['KeyB'],
  map: ['KeyM', 'Pad8'],                // View (hold)
};
// triggers stand in for the mouse: RT fires (left button), LT guards (right button)
const PAD_MOUSE = { 0: 7, 2: 6 };
const DEAD = 0.18;
const dz = (v) => (Math.abs(v) < DEAD ? 0 : Math.sign(v) * (Math.abs(v) - DEAD) / (1 - DEAD));

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
    this.pad = null;          // the connected gamepad's state this frame
    this.padPrev = [];        // buttons held last frame
    this.padStick = { x: 0, z: 0 };
    this.padMouse = new Set();
    this.usingPad = false;
    addEventListener('gamepadconnected', (e) => { this.usingPad = true; this.onPad?.(e.gamepad, true); });
    addEventListener('gamepaddisconnected', (e) => { this.onPad?.(e.gamepad, false); });

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

  // read the first gamepad: buttons become key codes (Pad<n>), sticks move and look,
  // triggers are the mouse buttons. In a menu the pad drives focus instead.
  pollPad(dt, inMenu) {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    const gp = [...pads].find((p) => p && p.connected);
    if (!gp) { this.pad = null; return; }
    this.pad = gp;
    const b = gp.buttons.map((x) => x.pressed || x.value > 0.4);
    const was = this.padPrev;
    const any = b.some(Boolean) || gp.axes.some((a) => Math.abs(a) > 0.4);
    if (any) this.usingPad = true;
    if (inMenu) {
      // d-pad / left stick walk the menu, A presses, B goes back
      const key = (code) => { window.dispatchEvent(new KeyboardEvent('keydown', { code, key: code, bubbles: true })); window.dispatchEvent(new KeyboardEvent('keyup', { code, key: code, bubbles: true })); };
      const edge = (i) => b[i] && !was[i];
      const ly = dz(gp.axes[1] || 0), lx = dz(gp.axes[0] || 0);
      this.menuRepeat = Math.max(0, (this.menuRepeat || 0) - dt);
      const stickDir = Math.abs(ly) > 0.6 ? (ly > 0 ? 'ArrowDown' : 'ArrowUp') : Math.abs(lx) > 0.6 ? (lx > 0 ? 'ArrowRight' : 'ArrowLeft') : null;
      if (stickDir && this.menuRepeat <= 0) { key(stickDir); this.menuRepeat = 0.22; }
      if (edge(12)) key('ArrowUp'); if (edge(13)) key('ArrowDown'); if (edge(14)) key('ArrowLeft'); if (edge(15)) key('ArrowRight');
      if (edge(0)) { const el = document.activeElement; if (el && el !== document.body && el.click) el.click(); else document.querySelector('.screen:not([hidden]) .menu button, .screen:not([hidden]) button')?.focus(); }
      if (edge(1)) key('Escape');
      if (edge(9)) key('Escape');
      this.padPrev = b;
      this.padStick.x = 0; this.padStick.z = 0;
      return;
    }
    for (let i = 0; i < b.length; i++) {
      const code = 'Pad' + i;
      if (b[i] && !was[i]) { this.pressed.add(code); this.down.add(code); }
      else if (!b[i] && was[i]) { this.down.delete(code); this.released.add(code); }
    }
    // property cycling on the d-pad's sides
    if (b[14] && !was[14]) this.mouse.wheel -= 1;
    if (b[15] && !was[15]) this.mouse.wheel += 1;
    for (const [mb, pb] of Object.entries(PAD_MOUSE)) {
      const k = +mb;
      if (b[pb] && !was[pb]) this.mousePressed.add(k);
      if (!b[pb] && was[pb]) this.mouseReleased.add(k);
      if (b[pb]) this.padMouse.add(k); else this.padMouse.delete(k);
    }
    this.padStick.x = -dz(gp.axes[0] || 0);
    this.padStick.z = -dz(gp.axes[1] || 0);
    // right stick looks, with a gentle curve so small moves aim finely
    const rx = dz(gp.axes[2] || 0), ry = dz(gp.axes[3] || 0);
    const k = 1150 * dt * (this.padLook || 1);
    this.mouse.dx += Math.sign(rx) * rx * rx * k;
    this.mouse.dy += Math.sign(ry) * ry * ry * k * 0.75;
    this.padPrev = b;
  }

  is(action) { return this.enabled && BIND[action].some((c) => this.down.has(c)); }
  hit(action) { return this.enabled && BIND[action].some((c) => this.pressed.has(c)); }
  up(action) { return BIND[action].some((c) => this.released.has(c)); }
  btn(b) { return this.enabled && ((this.mouse.buttons & (1 << b)) !== 0 || this.padMouse.has(b)); }
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
    if (l > 0) return { x: x / l, z: z / l };
    // the left stick: analogue, so a light push walks
    const px = this.padStick.x, pz = this.padStick.z, pl = Math.hypot(px, pz);
    return pl > 0 ? { x: px / Math.max(1, pl), z: pz / Math.max(1, pl) } : { x: 0, z: 0 };
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
