// 2D collision on the ground plane: circles and oriented boxes in a
// spatial hash.  Also "platforms" (dock, bridge) that raise the walkable
// ground over water.

const CELL = 8;

export class Colliders {
  constructor() {
    this.cells = new Map();
    this.all = new Set();
    this.platforms = [];
    this._seen = new Set();
  }

  key(i, j) { return i * 73856093 ^ j * 19349663; }

  cellRange(c) {
    const r = c.type === 'c' ? c.r : Math.hypot(c.hw, c.hd);
    return [Math.floor((c.x - r) / CELL), Math.floor((c.x + r) / CELL), Math.floor((c.z - r) / CELL), Math.floor((c.z + r) / CELL)];
  }

  insert(c) {
    this.all.add(c);
    const [i0, i1, j0, j1] = this.cellRange(c);
    c._cells = [];
    for (let i = i0; i <= i1; i++) {
      for (let j = j0; j <= j1; j++) {
        const k = this.key(i, j);
        let arr = this.cells.get(k);
        if (!arr) { arr = []; this.cells.set(k, arr); }
        arr.push(c);
        c._cells.push(arr);
      }
    }
    return c;
  }

  remove(c) {
    if (!c || !this.all.has(c)) return;
    this.all.delete(c);
    for (const arr of c._cells) {
      const i = arr.indexOf(c);
      if (i >= 0) arr.splice(i, 1);
    }
    c._cells = [];
  }

  circle(x, z, r, owner = null) { return this.insert({ type: 'c', x, z, r, owner }); }

  box(x, z, w, d, rot = 0, owner = null) {
    return this.insert({ type: 'b', x, z, hw: w / 2, hd: d / 2, cos: Math.cos(rot), sin: Math.sin(rot), owner });
  }

  near(x, z, r, fn) {
    const seen = this._seen;
    seen.clear();
    const i0 = Math.floor((x - r) / CELL), i1 = Math.floor((x + r) / CELL);
    const j0 = Math.floor((z - r) / CELL), j1 = Math.floor((z + r) / CELL);
    for (let i = i0; i <= i1; i++) {
      for (let j = j0; j <= j1; j++) {
        const arr = this.cells.get(this.key(i, j));
        if (!arr) continue;
        for (const c of arr) {
          if (seen.has(c)) continue;
          seen.add(c);
          fn(c);
        }
      }
    }
  }

  // Push a circle (pos.x, pos.z, radius) out of every collider. Mutates pos.
  resolve(pos, radius, ignore = null) {
    for (let iter = 0; iter < 2; iter++) {
      this.near(pos.x, pos.z, radius + 4, (c) => {
        if (c.owner && c.owner === ignore) return;
        if (c.type === 'c') {
          const dx = pos.x - c.x, dz = pos.z - c.z;
          const d2 = dx * dx + dz * dz;
          const R = c.r + radius;
          if (d2 < R * R && d2 > 1e-8) {
            const d = Math.sqrt(d2);
            pos.x = c.x + (dx / d) * R;
            pos.z = c.z + (dz / d) * R;
          }
        } else {
          // into box space
          const dx = pos.x - c.x, dz = pos.z - c.z;
          const lx = dx * c.cos - dz * c.sin;
          const lz = dx * c.sin + dz * c.cos;
          const cx = Math.max(-c.hw, Math.min(c.hw, lx));
          const cz = Math.max(-c.hd, Math.min(c.hd, lz));
          let ox = lx - cx, oz = lz - cz;
          const d2 = ox * ox + oz * oz;
          let nx, nz;
          if (d2 > 1e-8) {
            if (d2 >= radius * radius) return;
            const d = Math.sqrt(d2);
            nx = cx + (ox / d) * radius;
            nz = cz + (oz / d) * radius;
          } else {
            // centre inside the box: push out along the shallowest axis
            const px = c.hw - Math.abs(lx), pz = c.hd - Math.abs(lz);
            if (px < pz) { nx = Math.sign(lx || 1) * (c.hw + radius); nz = lz; }
            else { nx = lx; nz = Math.sign(lz || 1) * (c.hd + radius); }
          }
          // back to world
          pos.x = c.x + nx * c.cos + nz * c.sin;
          pos.z = c.z - nx * c.sin + nz * c.cos;
        }
      });
    }
    return pos;
  }

  // Does a circle overlap anything?
  overlaps(x, z, r, ignore = null) {
    let hit = false;
    this.near(x, z, r + 4, (c) => {
      if (hit || (c.owner && c.owner === ignore)) return;
      if (c.type === 'c') {
        const dx = x - c.x, dz = z - c.z;
        if (dx * dx + dz * dz < (c.r + r) ** 2) hit = true;
      } else {
        const dx = x - c.x, dz = z - c.z;
        const lx = dx * c.cos - dz * c.sin, lz = dx * c.sin + dz * c.cos;
        const cx = Math.max(-c.hw, Math.min(c.hw, lx)), cz = Math.max(-c.hd, Math.min(c.hd, lz));
        if ((lx - cx) ** 2 + (lz - cz) ** 2 < r * r) hit = true;
      }
    });
    return hit;
  }

  // Walkable platforms: { x, z, hw, hd, cos, sin, height(lx, lz) }
  addPlatform(x, z, w, d, rot, heightFn) {
    const p = { x, z, hw: w / 2, hd: d / 2, cos: Math.cos(rot), sin: Math.sin(rot), heightFn };
    this.platforms.push(p);
    return p;
  }

  platformAt(x, z) {
    for (const p of this.platforms) {
      const dx = x - p.x, dz = z - p.z;
      const lx = dx * p.cos - dz * p.sin, lz = dx * p.sin + dz * p.cos;
      if (Math.abs(lx) <= p.hw && Math.abs(lz) <= p.hd) return { p, h: p.heightFn(lx, lz) };
    }
    return null;
  }
}
