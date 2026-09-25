// The first night's lesson, in the Dunes above the village. One idea at a time:
// take a property, meet a single slow anxiety with the blade (and, once, a lunge
// in slow motion to deflect), then give what you took to the wall that bars the
// gate. Nothing in the village wakes until you are through. After the first
// time, the Dunes are just the Dunes.
import * as THREE from 'three';

const V = (x, y, z) => new THREE.Vector3(x, y, z);

export class Tutorial {
  constructor(level) {
    this.level = level; this.game = level.game;
    this.step = -1; this.t = 0;
    this.walls = [];
  }

  // set the pieces out before the player arrives: a clock on the path, the gate walled up
  build() {
    const L = this.level, s = L.spawn;
    this.clock = L.put('Clock', s.x + 1.5, s.z + 6, { rotY: Math.PI });
    for (const x of [-2.03, 2.03]) this.walls.push(L.put('Wall', x, -27.6, { rotY: 0 }));
    for (const w of this.walls) { w.tutorial = true; w.hp = 1e9; }
  }

  get objective() { return this.step >= 0 && this.step < STEPS.length ? STEPS[this.step].obj : null; }
  get done() { return this.step >= STEPS.length; }

  start() {
    const p = this.game.player;
    p.charges = new Map(); // an empty gun: the first thing you learn is where properties come from
    p.updateVial?.();
    this.next();
  }
  next() {
    this.step++; this.t = 0;
    const s = STEPS[this.step];
    if (!s) { this.finish(); return; }
    s.at?.(this);
    if (s.line) this.game.narrator.say(s.line, { priority: true });
    this.game.audio.sfx('uiSelect');
  }
  finish() {
    const g = this.game;
    g.meta.data.tutorialDone = true; g.meta.save();
    g.saveProgress?.();
    g.ui.toast('The gate is open. The village is below; the first memory is in the market.', 'good');
    const first = this.level.current;
    if (first) this.level.guide(g.player.pos.clone(), first.pos);
  }

  update(dt) {
    if (this.done || this.step < 0) return;
    this.t += dt;
    const s = STEPS[this.step];
    if (s.check(this)) this.next();
    s.tick?.(this, dt);
  }
}

const STEPS = [
  { // 1. take
    obj: 'Aim at the clock and take its melting · Q',
    line: 'tut_take',
    check: (T) => T.game.player.chargesOf('melting') > 0,
  },
  { // 2. one anxiety, the blade, and a lunge to deflect
    obj: 'One of her worries · F cuts · right mouse as it lunges deflects',
    line: 'tut_blade',
    at: (T) => {
      const g = T.game, p = g.player, f = p.flatForward();
      const at = p.pos.clone().addScaledVector(f, 11).add(V(f.z * 3, 0, -f.x * 3));
      at.y = T.level.groundY(at.x, at.z) + 0.1;
      T.foe = g.spawnEnemy(at, { hp: 40, tier: 0, fireRate: 0 });
      if (T.foe) { T.foe.lungeCool = 3; T.foe.perilK = 0; g.vfx.dust(at, 1.4); }
    },
    tick: (T) => {
      const e = T.foe, g = T.game;
      // the first lunge: the dream slows so you can see the moment to deflect
      if (e && !e.dead && e.lunge && e.lunge.phase === 'wind' && !T.slowed) {
        T.slowed = true;
        g.slowMo(1.1, 0.22);
        g.ui.toast('Now: right mouse, as it lunges.', 'warn');
      }
    },
    check: (T) => !T.foe || T.foe.dead,
  },
  { // 3. give
    obj: 'Give melting to the wall across the gate · E',
    line: 'tut_give',
    check: (T) => T.walls.some((w) => w.dead || w.melt > 0.97),
  },
];
