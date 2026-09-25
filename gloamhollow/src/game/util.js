// Small shared helpers.
import * as THREE from 'three';

// Blender dedups names as "body.001" and GLTFLoader strips the dot
// ("body001") or appends "_1"; match the base name with any numeric suffix.
export function partRe(name) { return new RegExp(`^${name}(_?\\d+)?$`); }

export function findPart(root, name) {
  const re = partRe(name);
  let found = null;
  root.traverse((o) => { if (!found && o !== root && re.test(o.name)) found = o; });
  return found;
}

export function findParts(root, prefix) {
  const re = new RegExp(`^${prefix}(_?\\d+)?$`);
  const out = [];
  root.traverse((o) => { if (o !== root && re.test(o.name)) out.push(o); });
  return out;
}

export function worldPos(obj, out = new THREE.Vector3()) {
  obj.updateWorldMatrix(true, false);
  return out.setFromMatrixPosition(obj.matrixWorld);
}

export const TAU = Math.PI * 2;

export function angleDiff(a, b) {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
}

export function approachAngle(a, b, maxStep) {
  const d = angleDiff(a, b);
  return a + Math.max(-maxStep, Math.min(maxStep, d));
}

export function pick(arr, rnd = Math.random) { return arr[Math.floor(rnd() * arr.length)]; }

export function weighted(pairs, rnd = Math.random) {
  const total = pairs.reduce((s, p) => s + p[1], 0);
  let r = rnd() * total;
  for (const [v, w] of pairs) { r -= w; if (r <= 0) return v; }
  return pairs[pairs.length - 1][0];
}

export function fmtTime(minutes) {
  const m = Math.floor(minutes) % (24 * 60);
  let h = Math.floor(m / 60);
  const mm = Math.floor((m % 60) / 10) * 10;
  const ampm = h >= 12 ? 'pm' : 'am';
  h = h % 12; if (h === 0) h = 12;
  return `${h}:${String(mm).padStart(2, '0')} ${ampm}`;
}

// Is hour h inside [a, b) where the range may wrap past midnight?
export function inHours(h, a, b) {
  h = ((h % 24) + 24) % 24;
  return a <= b ? h >= a && h < b : h >= a || h < b;
}

export function fillTokens(text, tokens) {
  return text.replace(/\{(\w+)\}/g, (m, k) => (k in tokens ? tokens[k] : m));
}
