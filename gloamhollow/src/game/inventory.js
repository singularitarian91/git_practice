// Slot-based inventory stored directly in the save state.
import { ITEMS } from '../data/items.js';
import { HOTBAR } from './state.js';

export class Inventory {
  constructor(state) {
    this.state = state;
    this.listeners = new Set();
  }

  get slots() { return this.state.inv; }
  onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  changed() { for (const fn of this.listeners) fn(); }

  stackOf(id) { return (ITEMS[id] && ITEMS[id].stack) || 99; }

  count(id) {
    let n = 0;
    for (const s of this.slots) if (s && s.id === id) n += s.n;
    return n;
  }

  has(id, n = 1) { return this.count(id) >= n; }

  matches(s, ing) {
    if (!s) return false;
    if (typeof ing === 'string') return s.id === ing;
    const it = ITEMS[s.id];
    return it && it.cat === ing.cat && !(ing.except || []).includes(s.id);
  }

  countMatch(ing) {
    let n = 0;
    for (const s of this.slots) if (this.matches(s, ing)) n += s.n;
    return n;
  }

  // Would `n` of `id` fit?
  canAdd(id, n = 1) {
    const max = this.stackOf(id);
    let room = 0;
    for (const s of this.slots) {
      if (!s) room += max;
      else if (s.id === id) room += max - s.n;
      if (room >= n) return true;
    }
    return room >= n;
  }

  // Returns the number that did NOT fit.
  add(id, n = 1) {
    const max = this.stackOf(id);
    let left = n;
    for (const s of this.slots) {
      if (left <= 0) break;
      if (s && s.id === id && s.n < max) {
        const k = Math.min(max - s.n, left);
        s.n += k; left -= k;
      }
    }
    // prefer hotbar slots for tools, backpack for everything else
    const order = [];
    const cat = ITEMS[id] && ITEMS[id].cat;
    const handy = ['tool', 'seed', 'food', 'place', 'decor'].includes(cat);
    for (let i = 0; i < this.slots.length; i++) order.push(i);
    if (!handy) order.sort((a, b) => (a < HOTBAR) - (b < HOTBAR) || a - b);
    // …but fill the hotbar if the backpack is full
    for (const i of order) {
      if (left <= 0) break;
      if (!this.slots[i]) {
        const k = Math.min(max, left);
        this.slots[i] = { id, n: k };
        left -= k;
      }
    }
    if (left !== n) {
      this.state.seen[id] = true;
      this.changed();
    }
    return left;
  }

  remove(id, n = 1) {
    if (this.count(id) < n) return false;
    let left = n;
    for (let i = this.slots.length - 1; i >= 0 && left > 0; i--) {
      const s = this.slots[i];
      if (s && s.id === id) {
        const k = Math.min(s.n, left);
        s.n -= k; left -= k;
        if (s.n <= 0) this.slots[i] = null;
      }
    }
    this.changed();
    return true;
  }

  // Remove by ingredient (item id or category); returns removed ids.
  removeMatch(ing, n = 1) {
    if (typeof ing === 'string') return this.remove(ing, n) ? new Array(n).fill(ing) : null;
    if (this.countMatch(ing) < n) return null;
    const out = [];
    let left = n;
    for (let i = this.slots.length - 1; i >= 0 && left > 0; i--) {
      const s = this.slots[i];
      if (this.matches(s, ing)) {
        const k = Math.min(s.n, left);
        for (let j = 0; j < k; j++) out.push(s.id);
        s.n -= k; left -= k;
        if (s.n <= 0) this.slots[i] = null;
      }
    }
    this.changed();
    return out;
  }

  removeAt(i, n = 1) {
    const s = this.slots[i];
    if (!s) return null;
    const k = Math.min(n, s.n);
    s.n -= k;
    const id = s.id;
    if (s.n <= 0) this.slots[i] = null;
    this.changed();
    return { id, n: k };
  }

  swap(a, b) {
    const s = this.slots;
    if (a === b) return;
    const A = s[a], B = s[b];
    if (A && B && A.id === B.id && A.n < this.stackOf(A.id)) {
      const max = this.stackOf(A.id);
      const k = Math.min(max - B.n, A.n);
      B.n += k; A.n -= k;
      if (A.n <= 0) s[a] = null;
    } else {
      s[a] = B; s[b] = A;
    }
    this.changed();
  }

  get selectedIndex() { return this.state.hotbar; }
  set selectedIndex(i) { this.state.hotbar = ((i % HOTBAR) + HOTBAR) % HOTBAR; this.changed(); }
  get selected() { return this.slots[this.state.hotbar]; }
}
