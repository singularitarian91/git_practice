/* world.js: shared side-view world. Walking, things to look at, hold interactions, camera.
 * Chapters build on G.SideScene and add their own painting and rules.
 */
(function () {
  'use strict';
  const G = window.G, M = G.M;

  function SideScene(o) {
    o = o || {};
    this.cam = new G.Camera();
    this.cam.zoom = o.zoom || 1;
    this.cam.y = o.camY == null ? G.H / 2 : o.camY;
    this.minX = o.minX == null ? 0 : o.minX;
    this.maxX = o.maxX == null ? G.W : o.maxX;
    this.groundY = o.groundY || 600;
    this.player = {
      x: o.startX == null ? 200 : o.startX, y: 0, dir: 1, vel: 0, target: null,
      phase: 0, walk: 0, speed: o.speed || 170, s: o.heroScale || 180,
      lean: 0, kneel: 0, reach: null, reachT: 0, carry: false, bow: o.bow || 0,
      loose: o.loose == null ? 0.3 : o.loose, wind: 0, out: {}
    };
    this.player.y = this.ground(this.player.x);
    this.items = [];
    this.pending = null;
    this.holding = null;
    this.pressItem = null;
    this.keyItem = null;
    this.dragWalk = false;
    this.locked = false;
    this.drift = 0;
    this.camLead = o.camLead == null ? 0 : o.camLead;
    this.camMinX = o.camMinX;
    this.camMaxX = o.camMaxX;
    this.follow = o.follow !== false;
    this.glintRange = o.glintRange || 260;
    this.stepSurface = o.surface || 'wood';
    this.t = 0;
  }
  G.SideScene = SideScene;

  SideScene.prototype.ground = function () { return this.groundY; };
  SideScene.prototype.surface = function () { return this.stepSurface; };
  SideScene.prototype.speedMul = function () { return 1; };

  // Things to look at / use. Rect is in world units (x, y = top-left).
  SideScene.prototype.item = function (it) {
    it.w = it.w || 60;
    it.h = it.h || 60;
    if (it.at == null) it.at = it.x + it.w / 2;
    if (it.when == null) it.when = () => true;
    if (it.glint == null) it.glint = true;
    it.lineIndex = 0;
    this.items.push(it);
    return it;
  };
  SideScene.prototype.removeItem = function (it) {
    const i = this.items.indexOf(it);
    if (i >= 0) this.items.splice(i, 1);
    if (this.pending === it) this.pending = null;
    if (this.holding === it) this.holding = null;
  };

  SideScene.prototype.hit = function (wx, wy) {
    const pad = 10 / this.cam.zoom;
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i];
      if (!it.when()) continue;
      const ix = typeof it.x === 'function' ? it.x() : it.x;
      const iy = typeof it.y === 'function' ? it.y() : it.y;
      if (wx >= ix - pad && wx <= ix + it.w + pad && wy >= iy - pad && wy <= iy + it.h + pad) return it;
    }
    return null;
  };

  SideScene.prototype.itemCenter = function (it) {
    const ix = typeof it.x === 'function' ? it.x() : it.x;
    const iy = typeof it.y === 'function' ? it.y() : it.y;
    return { x: it.gx != null ? it.gx : ix + it.w / 2, y: it.gy != null ? it.gy : iy + it.h / 2 };
  };

  SideScene.prototype.itemAt = function (it) {
    return typeof it.at === 'function' ? it.at() : it.at;
  };

  SideScene.prototype.nearest = function () {
    let best = null, bd = 150;
    for (const it of this.items) {
      if (!it.when()) continue;
      const d = Math.abs(this.itemAt(it) - this.player.x);
      if (d < bd) { bd = d; best = it; }
    }
    return best;
  };

  SideScene.prototype.go = function (it) {
    this.pending = it;
    this.player.target = M.clamp(this.itemAt(it), this.minX, this.maxX);
  };

  SideScene.prototype.stopHold = function (done) {
    const it = this.holding;
    this.holding = null;
    if (it && it.holdEnd) it.holdEnd(this, !!done);
  };

  // Show the next of an item's lines.
  SideScene.prototype.sayItem = function (it) {
    const lines = typeof it.say === 'function' ? it.say(this) : it.say;
    if (!lines) return;
    const arr = Array.isArray(lines) ? lines : [lines];
    const line = arr[Math.min(it.lineIndex, arr.length - 1)];
    it.lineIndex++;
    G.ui.say(line);
  };

  SideScene.prototype.reachFor = function (it, secs) {
    const c = this.itemCenter(it);
    this.player.reach = { x: c.x, y: c.y };
    this.player.reachT = secs == null ? 0.9 : secs;
  };

  SideScene.prototype.sideUpdate = function (dt) {
    this.t += dt;
    const inp = G.input, pl = this.player;
    const w = this.cam.toWorld(inp.x, inp.y);

    if (!this.locked) {
      const hover = inp.lastDevice === 'pointer' ? this.hit(w.x, w.y) : null;
      this.hover = hover;
      G.setCursor(hover ? 'pointer' : 'default');
      if (inp.pressed && !inp.consumed) {
        const it = this.hit(w.x, w.y);
        this.stopHold();
        if (it) {
          this.go(it);
          this.pressItem = it;
          this.dragWalk = false;
        } else {
          this.pending = null;
          this.pressItem = null;
          pl.target = M.clamp(w.x, this.minX, this.maxX);
          this.dragWalk = true;
        }
      }
      if (inp.down && this.dragWalk) pl.target = M.clamp(w.x, this.minX, this.maxX);
      if (inp.hit.act) {
        const it = this.nearest();
        if (it) { this.stopHold(); this.go(it); this.keyItem = it; }
      }
    } else {
      this.hover = null;
      G.setCursor('default');
    }
    if (!inp.down) this.dragWalk = false;

    const ax = this.locked ? 0 : inp.axis();
    if (ax) {
      pl.target = null;
      this.pending = null;
      if (this.holding) this.stopHold();
    }
    this.movePlayer(dt, ax);

    // arrival
    const pend = this.pending;
    if (pend && Math.abs(pl.x - this.itemAt(pend)) < 3) {
      this.pending = null;
      // settle exactly on the spot so the last pixels of walking can't turn us around
      pl.x = M.clamp(this.itemAt(pend), this.minX, this.maxX);
      pl.target = null;
      pl.vel = 0;
      const c = this.itemCenter(pend);
      pl.dir = pend.face || (Math.sign(c.x - pl.x) || pl.dir);
      if (!pend.when()) {
        // it changed while we walked
      } else if (pend.hold) {
        const held = (inp.down && this.pressItem === pend) || (inp.keys.act && this.keyItem === pend);
        if (held) this.holding = pend;
        else if (pend.tap) pend.tap(this);
      } else {
        if (pend.reach !== false) this.reachFor(pend);
        if (pend.use) pend.use(this);
        else this.sayItem(pend);
      }
    }

    // holding
    if (this.holding) {
      const it = this.holding;
      const still = (inp.down && this.pressItem === it) || (inp.keys.act && this.keyItem === it);
      if (!still || !it.when()) this.stopHold(false);
      else {
        if (it.reach !== false) { const c = this.itemCenter(it); pl.reach = { x: c.x, y: c.y }; pl.reachT = 0.2; }
        if (it.holdTick && it.holdTick(this, dt)) this.stopHold(true);
      }
    }

    if (pl.reachT > 0) {
      pl.reachT -= dt;
      if (pl.reachT <= 0) pl.reach = null;
    }

    if (this.follow) this.updateCamera(dt);
  };

  SideScene.prototype.movePlayer = function (dt, ax) {
    const pl = this.player;
    let want = 0;
    if (ax) want = ax;
    else if (pl.target != null) {
      const dx = pl.target - pl.x;
      if (Math.abs(dx) > 1.5) want = Math.sign(dx);
      else { pl.target = null; pl.vel = 0; }
    }
    const speed = pl.speed * this.speedMul(want);
    let v = want * speed;
    if (!ax && pl.target != null) {
      const dx = pl.target - pl.x;
      v = Math.sign(dx) * Math.min(speed, Math.abs(dx) * 5 + 18);
    }
    if (this.locked && pl.target == null) v = 0;
    pl.vel = M.damp(pl.vel, v, 12, dt);
    let nx = pl.x + (pl.vel + this.drift) * dt;
    // never overshoot a target
    if (pl.target != null && !ax) {
      if ((pl.x - pl.target) * (nx - pl.target) < 0 && Math.abs(this.drift) < 1) nx = pl.target;
    }
    pl.x = M.clamp(nx, this.minX, this.maxX);
    if (want) pl.dir = want;
    const sp = Math.abs(pl.vel);
    pl.walk = M.damp(pl.walk, M.clamp(sp / (pl.speed * 0.75), 0, 1), 10, dt);
    const stride = pl.s * 0.5;
    const prev = pl.phase;
    pl.phase += dt * sp / stride * Math.PI;
    if (sp > 12 && Math.floor(prev / Math.PI) !== Math.floor(pl.phase / Math.PI)) G.audio.step(this.surface(pl.x));
    pl.y = this.ground(pl.x);
  };

  SideScene.prototype.updateCamera = function (dt, rate) {
    const pl = this.player, cam = this.cam;
    const half = G.W / 2 / cam.zoom;
    let tx = pl.x + this.camLead * pl.dir;
    const lo = this.camMinX == null ? this.minX + half : this.camMinX;
    const hi = this.camMaxX == null ? this.maxX - half : this.camMaxX;
    tx = hi < lo ? (lo + hi) / 2 : M.clamp(tx, lo, hi);
    cam.x = M.damp(cam.x, tx, rate || 2.2, dt);
  };

  SideScene.prototype.snapCamera = function () {
    const r = this.follow;
    this.follow = true;
    this.updateCamera(10, 50);
    this.follow = r;
  };

  SideScene.prototype.drawGlints = function (x) {
    const pl = this.player;
    for (const it of this.items) {
      if (!it.when() || it.glint === false) continue;
      const c = this.itemCenter(it);
      const d = Math.abs(c.x - pl.x);
      let a = M.smoothstep(this.glintRange, this.glintRange * 0.45, d) * 0.55;
      if (this.hover === it) a = 1;
      if (it.glintBoost) a = Math.max(a, it.glintBoost);
      if (this.holding === it) a = 0;
      G.paint.glint(x, c.x, c.y, this.t + c.x * 0.01, a / Math.max(0.6, Math.min(1, this.cam.zoom * 1.4)) * 0.9, it.big);
    }
  };

  SideScene.prototype.drawPlayer = function (x, extra) {
    const pl = this.player;
    const p = {
      x: pl.x, y: pl.y, s: pl.s, dir: pl.dir, t: this.t,
      walk: pl.walk, phase: pl.phase, kneel: pl.kneel, lean: pl.lean,
      wind: pl.wind, loose: pl.loose, bow: pl.bow, reach: pl.reach,
      carry: pl.carry, work: pl.work, out: pl.out, look: G.person.HERO
    };
    if (extra) Object.assign(p, extra);
    G.person.draw(x, p);
  };

  // Where a world point lands on the stage (used by tests and by some UI).
  SideScene.prototype.toScreen = function (wx, wy) { return this.cam.toScreen(wx, wy); };
})();
