// Keyboard + mouse state with per-frame edge detection.
import * as THREE from 'three';

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.down = new Set();
    this.pressedSet = new Set();
    this.releasedSet = new Set();
    this.mouse = { x: 0, y: 0, ndc: new THREE.Vector2(), inside: false };
    this.buttons = [false, false, false];
    this.btnPressed = [false, false, false];
    this.btnReleased = [false, false, false];
    this.wheel = 0;
    this.drag = { dx: 0, dy: 0 };
    this.enabled = true;
    this.typing = false; // true while a text field has focus

    window.addEventListener('keydown', (e) => {
      if (this.isTypingTarget(e.target)) return;
      if (['Tab', 'Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
      if (!this.down.has(e.code)) this.pressedSet.add(e.code);
      this.down.add(e.code);
    });
    window.addEventListener('keyup', (e) => {
      this.down.delete(e.code);
      this.releasedSet.add(e.code);
    });
    window.addEventListener('blur', () => { this.down.clear(); this.buttons = [false, false, false]; });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('mousedown', (e) => {
      canvas.focus && canvas.focus();
      this.buttons[e.button] = true;
      this.btnPressed[e.button] = true;
    });
    window.addEventListener('mouseup', (e) => {
      if (this.buttons[e.button]) this.btnReleased[e.button] = true;
      this.buttons[e.button] = false;
    });
    window.addEventListener('mousemove', (e) => {
      const r = canvas.getBoundingClientRect();
      const nx = e.clientX - r.left, ny = e.clientY - r.top;
      if (this.buttons[2] || this.buttons[1]) {
        this.drag.dx += e.movementX || 0;
        this.drag.dy += e.movementY || 0;
      }
      this.mouse.x = nx; this.mouse.y = ny;
      this.mouse.ndc.set((nx / r.width) * 2 - 1, -(ny / r.height) * 2 + 1);
      this.mouse.inside = true;
    });
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.wheel += Math.sign(e.deltaY) * Math.min(3, Math.abs(e.deltaY) / 60 + 0.5);
    }, { passive: false });
  }

  isTypingTarget(t) {
    return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
  }

  isDown(code) { return this.enabled && this.down.has(code); }
  pressed(code) { return this.enabled && this.pressedSet.has(code); }
  // raw edge regardless of `enabled` (for UI hotkeys such as Esc)
  pressedRaw(code) { return this.pressedSet.has(code); }
  mousePressed(b = 0) { return this.enabled && this.btnPressed[b]; }
  mouseDown(b = 0) { return this.enabled && this.buttons[b]; }
  mouseReleased(b = 0) { return this.btnReleased[b]; }

  consumeKey(code) { this.pressedSet.delete(code); }
  consumeMouse(b = 0) { this.btnPressed[b] = false; }

  // Call at the end of every frame.
  endFrame() {
    this.pressedSet.clear();
    this.releasedSet.clear();
    this.btnPressed = [false, false, false];
    this.btnReleased = [false, false, false];
    this.wheel = 0;
    this.drag.dx = 0; this.drag.dy = 0;
  }
}
