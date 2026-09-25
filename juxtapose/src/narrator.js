// The Night-Light: the candle Odile kept in the window for sixty years. It
// floats beside you in its jar, teaches you the rules of the dream, and
// comments on your choices in typed subtitles with a tiny babbling voice.
import * as THREE from 'three';

// line banks: each key is a list; lines play in order the first time, then at random
export const LINES = {
  wake0: ["Oh. You're awake. That's new. Usually it's only me down here.",
    "I'm the night-light. I keep watch. I've been keeping watch for a very long time, so please be patient with my conversational skills."],
  wakeN: ["You again. Good. I was starting to talk to the clocks.", "Back already? She's only just drifted off. Try not to wake her this time.",
    "Hello, figment. Same dream, different night. Mind the clocks."],
  hintTake: ["See the clock? Aim at it and press Q. Take its melting. Clocks don't need it. Believe me, I've seen what she does to clocks."],
  hintGive: ["Now give it to something that shouldn't have it. Aim, and press E. A wall, perhaps. Walls are very full of themselves."],
  hintCombat: ["Those are her worries. Faceless, drawers full of things never said. F cuts. Shooting works too, but the knife is kinder."],
  hintDeflect: ["See it wind up? Tap right mouse just as it lunges and you'll turn it right back. Hold it to guard, if you're not feeling brave."],
  hintPerilous: ["When one of them glows red, don't block it. Don't even try. Jump, or dash. Trust me on this."],
  hintFocus: ["Every blow you land fills your reverie. Hold X, somewhere quiet, and it mends you. It's called focus. I'm told it's very healthy."],
  hintDeathblow: ["It's kneeling. The red mark means press F. Finish it. It gives you back everything it was carrying."],
  firstTake: ["There. You took something from the world and it didn't complain. Most things don't. That's how you know it's a dream."],
  firstGive: ["And now the world is wrong in a new way. Marvellous. She'll feel that, you know. Lightly. Like a draft under a door."],
  firstStack: ["Two things at once. Very bold. Very surreal. Very noticeable."],
  lucid50: ["Careful. The more absurd you are, the more she notices. And when she notices, she wakes up. Nobody likes being noticed."],
  lucid75: ["She's stirring. I can feel it in my wick. Calm things down. Focus. Or don't, and we'll both find out what the ceiling tastes like."],
  lucid90: ["This is it. One more strange thing and the whole dream folds up like a letter."],
  deflect: ["Clean.", "Ha. Back where it came from.", "She used to do that with tennis balls. Badly."],
  deathblow: ["Gone. It won't be back tonight.", "That one was about the rent. Good riddance.", "Do you feel lighter? I feel lighter."],
  stagger: ["It's off balance. Now."],
  pogo: ["Bouncing off the heads of her fears. Undignified. Effective."],
  focus: ["Better? Good. I worry. It's my only hobby."],
  portal: ["A frame. Two frames. She always said a painting was just a window that forgot where it opened. Step through."],
  portalPass: ["Speedy thing goes in. Speedy thing comes out. I'm sure someone said that once."],
  scrap: ["A scrap of the painting. She tore it up, you know. Then she saved every piece.", "More of it. Hold on to that.", "Put it with the others. It's starting to look like something."],
  layer1: ["The Soft Desert. Time goes soft here. She mended everyone's clocks and let her own run down."],
  layer2: ["Golconda. The city he left for. She looked for his hat in every crowd for years. Every crowd was the same man."],
  layer3: ["Don't look at it. I mean it. I've been not-looking at it for sixty years and I'm very good at it.",
    "It can only be hurt while you're not watching. Grief is like that. You go around it. You go sideways."],
  bossPhase: ["It's getting desperate. So is she.", "Its worries are showing up. Of course they are. Worries come in crowds."],
  bossDown: ["It closed. Oh. It closed."],
  laststand: ["Not yet. The letter's still in the drawer. You're not finished."],
  death: ["She woke. You died. From down here those look identical.", "Morning. It's always morning eventually.", "Well. There's always tonight."],
  lucidWake: ["Too much. She noticed. Of course she did. You were magnificent."],
  sandbox: ["This is the lucid room. Nothing here can wake her. Break whatever you like. I won't tell."],
  idleHint: ["If you're stuck: take something, give it to something else, and see what happens. That's the whole philosophy.",
    "Walls can be walked on, you know. Briefly. Run alongside one and jump."],
  whim: ["A whim. Take one. Dreams are made of these."],
  puzzleDrift: ["It's under the sand. Of course it is. She buried everything in that shop. Something that softens, perhaps?"],
  puzzleBoat: ["Out on the rock. You can't swim, you're made of wood and good intentions. That boat, though. Boats want to float. Help it."],
  puzzleTrain: ["The 6:40. It has never once stopped here. It doesn't feel the weight of anything. Maybe it should."],
  puzzleBell: ["That bell hasn't rung since the war. Too heavy, they said. Everything's too heavy until it isn't."],
  puzzleEgg: ["The sun comes in low here, and never goes anywhere useful. An egg can't catch the light. A mirror could."],
  puzzleSeal: ["His letters, sealed with his ring. She never broke one. Wax is only stubborn until it's warm."],
  puzzleClock: ["Paris time. It stopped when she stopped winding it. The weight's just painted on, you know. Make it mean it."],
  puzzleVitrine: ["Under glass, like something in a museum. And look: an anvil, being two things at once. Heavy, and not falling. Take away the part that's lying."],
  meet_hush: ["That one's a Hush. It's the quiet after an argument. Nothing works near it. Not the gun, not me. Mostly me."],
  meet_mirror: ["A Mirror. She stopped looking in them after he left. It gives back whatever you give. So give it something that hurts."],
  meet_wardrobe: ["The wardrobe. His coats are still in it. It won't open for bullets. It'll open when it's too tired to hold shut."],
  scrapNear: ["Wait. Up there. That glint. That's a piece of the painting.", "Another scrap, close by. I can feel it. It hums.", "There. Follow the motes. I'm pointing, I just don't have hands."],
  dark: ["Dark in here. Stay close, I'll light it.", "Indoors. She never liked the house after dark. I was always on the landing."],
  tut_take: ["First things first. That clock is soft in the middle. Aim at it and press Q: take its melting. Clocks don't need it, whatever they tell you."],
  tut_blade: ["Oh. One of her worries has come up the dune to see you. Just the one. F cuts it. And when it winds up to lunge, right mouse, just as it comes: turn it back."],
  tut_give: ["Now the gate. Someone has walled it up. You have melting. Aim at the wall, press E, and give it something to think about."],
  puzzleSolved: ["There. The dream has its own logic. You just speak it better than she does.", "See? Wrong in exactly the right way.", "She'd have laughed at that. She used to laugh."],
};

const RULES = {
  // event -> [lineKey, once, cooldownSeconds, chance]
  firstTake: ['firstTake', true], firstGive: ['firstGive', true], firstStack: ['firstStack', true],
  deflect: ['deflect', false, 25, 0.35], deathblow: ['deathblow', false, 30, 0.45], stagger: ['stagger', true],
  pogo: ['pogo', true], focus: ['focus', true], portal: ['portal', true], portalPass: ['portalPass', true],
  lucid50: ['lucid50', false, 60, 1], lucid75: ['lucid75', false, 60, 1], lucid90: ['lucid90', false, 60, 1],
  perilous: ['hintPerilous', true], enemiesNear: ['hintCombat', true], staggerSeen: ['hintDeathblow', true],
  reverieFull: ['hintFocus', true], lungeSeen: ['hintDeflect', true],
};

export class Narrator {
  constructor(game) {
    this.game = game;
    this.el = document.querySelector('#narrator');
    this.textEl = this.el.querySelector('.nl-text');
    this.queue = [];
    this.cur = null;
    this.cool = {};
    this.done = new Set();
    this.seq = {};
    this.gap = 0;
    this.obj = null;
    this.vel = new THREE.Vector3();
    this.light = null;
    this.muted = false;
    this.pointed = new Set(); // scraps it has already shown you
    this.point = null;        // { to, t }: motes running from the jar to something worth finding
    this.lookT = 0;
  }

  // ---------------------------------------------------------------- body
  spawn() {
    const game = this.game;
    this.despawn();
    let o;
    if (game.assets.has('NightLight')) o = game.assets.clone('NightLight');
    else {
      o = new THREE.Group();
      const jar = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.22, 16), new THREE.MeshPhysicalMaterial({ color: 0xdff6ff, roughness: 0.05, transparent: true, opacity: 0.3 }));
      const fl = new THREE.Mesh(new THREE.SphereGeometry(0.03, 8, 6), new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffb04a').multiplyScalar(6) }));
      fl.name = 'NightLight_Flame';
      o.add(jar, fl);
    }
    o.scale.setScalar(1.15);
    // a lantern, not a lighthouse: thin glass, a modest flame, and nothing that blooms into a blob
    o.traverse((m) => {
      if (!m.isMesh) return;
      m.castShadow = false;
      m.material = m.material.clone();
      const mm = m.material;
      if (mm.name === 'JarGlass') { mm.opacity = 0.16; mm.roughness = 0.12; mm.envMapIntensity = 0.6; m.userData.noAO = true; }
      if (mm.name === 'Tin' || mm.name === 'Wire') { mm.roughness = Math.max(mm.roughness, 0.5); mm.envMapIntensity = 0.5; }
      if (mm.name === 'Flame' || m.name === 'NightLight_Flame') { mm.emissiveIntensity = Math.min(mm.emissiveIntensity || 2, 2.2); }
    });
    this.flame = o.getObjectByName('NightLight_Flame');
    game.scene.add(o);
    this.obj = o;
    const p = game.player;
    if (p) o.position.copy(p.pos).add(new THREE.Vector3(0.8, 2.1, 0));
    this.light = game.render.claim(this, 0xffb865, 2.4, 5);
  }
  despawn() {
    if (this.obj) { this.obj.parent?.remove(this.obj); this.obj = null; }
    if (this.light) { this.game.render.release(this.light); this.light = null; }
  }

  // ---------------------------------------------------------------- speech
  say(key, { priority = false, force = false } = {}) {
    const bank = LINES[key];
    if (!bank || this.muted) return;
    const i = this.seq[key] || 0;
    const line = i < bank.length ? bank[i] : bank[Math.floor(Math.random() * bank.length)];
    this.seq[key] = i + 1;
    if (priority) this.queue.unshift(line); else this.queue.push(line);
    if (force && this.cur) { this.cur = null; }
  }
  sayAll(key) { const bank = LINES[key] || []; for (let i = 0; i < bank.length; i++) this.say(key); }

  event(name) {
    const r = RULES[name];
    if (!r) return;
    const [key, once, cd = 0, chance = 1] = r;
    if (once && this.done.has(name)) return;
    const now = this.game.time;
    if (this.cool[name] && now < this.cool[name]) return;
    if (Math.random() > chance) return;
    this.done.add(name);
    this.cool[name] = now + cd;
    this.say(key);
  }

  // it notices scraps of the painting nearby, says so once, and sends motes their way
  seek(dt, p) {
    const game = this.game;
    this.lookT -= dt;
    if (this.lookT <= 0) {
      this.lookT = 1;
      let best = null, bd = 26;
      for (const k of game.pickups) {
        if (!k.scrap || k.dead || this.pointed.has(k.scrap.id)) continue;
        const d = k.obj.position.distanceTo(p.pos);
        if (d < bd) { bd = d; best = k; }
      }
      if (best && game.state === 'playing') { this.pointed.add(best.scrap.id); this.point = { to: best.obj.position, t: 6 }; this.say('scrapNear'); }
    }
    if (this.point) {
      this.point.t -= dt;
      if (this.point.t <= 0) { this.point = null; return; }
      if (Math.random() < dt * 14) {
        const from = this.obj.position, d = this.point.to.clone().sub(from), L = d.length();
        d.normalize();
        game.vfx.add.spawn({ x: from.x, y: from.y, z: from.z, vx: d.x * Math.min(9, L), vy: d.y * Math.min(9, L), vz: d.z * Math.min(9, L), color: new THREE.Color('#ffd27a').multiplyScalar(4), alpha: 1, alpha1: 0, size: 0.09, size1: 0.03, life: Math.min(1.2, L / 9) });
      }
    }
  }

  // one-shot line by key (no rule table needed)
  event2(key) { if (this.done.has('k:' + key)) return; this.done.add('k:' + key); this.say(key); }

  reset() { this.queue = []; this.cur = null; this.el.hidden = true; }

  update(dt) {
    const game = this.game;
    // speech
    if (!this.cur && this.queue.length && this.gap <= 0) {
      const text = this.queue.shift();
      this.cur = { text, shown: 0, t: 0, hold: 2.2 + text.length * 0.045 };
      this.el.hidden = false;
      this.el.classList.remove('out');
    }
    this.gap = Math.max(0, this.gap - dt);
    if (this.cur) {
      const c = this.cur;
      c.t += dt;
      const target = Math.min(c.text.length, Math.floor(c.t * 42));
      if (target > c.shown) {
        const prev = c.shown;
        c.shown = target;
        this.textEl.textContent = c.text.slice(0, c.shown);
        if (Math.floor(prev / 3) !== Math.floor(c.shown / 3) && /[a-z]/i.test(c.text[c.shown - 1] || '')) {
          game.audio.sfx('babble', { pitch: (c.text.charCodeAt(c.shown - 1) % 7) - 2, gain: 0.5 });
        }
      }
      if (c.shown >= c.text.length && c.t > c.text.length / 42 + c.hold) {
        this.el.classList.add('out');
        if (c.t > c.text.length / 42 + c.hold + 0.4) { this.cur = null; this.el.hidden = true; this.gap = 0.6; }
      }
    }
    // body: float at the player's left shoulder, lagging like a balloon
    const p = game.player;
    if (this.obj && p) {
      const left = p.flatLeft(new THREE.Vector3());
      const want = p.renderPos.clone().addScaledVector(left, 0.85).add(new THREE.Vector3(0, 2.05 + Math.sin(game.time * 1.7) * 0.08, 0));
      if (p.state === 'deathblow' || p.focusing) want.addScaledVector(left, 0.6).y += 0.4;
      const d = want.sub(this.obj.position);
      this.vel.addScaledVector(d, dt * 26).multiplyScalar(Math.exp(-dt * 7));
      this.obj.position.addScaledVector(this.vel, dt);
      this.obj.rotation.set(Math.sin(game.time * 1.3) * 0.12 - this.vel.z * 0.05, game.time * 0.4, this.vel.x * 0.05);
      const talking = !!this.cur && this.cur.shown < this.cur.text.length;
      if (this.flame) this.flame.scale.setScalar(1 + Math.sin(game.time * 23) * 0.08 + (talking ? Math.sin(game.time * 40) * 0.25 : 0));
      // the light sits outside the jar, between it and the Figment: it warms the figure
      // without searing the glass it lives in
      // indoors it turns itself up: the lamp on the landing, all over again
      const inside = !!game.level?.town?.inside(p.pos.x, p.pos.z, -0.6);
      if (inside && !this.wasInside) { this.darkT = (this.darkT || 0) + 1; if (this.darkT === 1 || Math.random() < 0.15) this.say('dark'); }
      this.wasInside = inside;
      this.glow = (this.glow || 0) + ((inside ? 1 : 0) - (this.glow || 0)) * Math.min(1, dt * 2);
      if (this.light) {
        this.light.position.copy(this.obj.position).lerp(p.renderPos, 0.35);
        this.light.position.y = this.obj.position.y - 0.3;
        this.light.userData.base = (talking ? 3.2 : 2.2) + this.glow * 3.5;
        this.light.distance = 5 + this.glow * 7;
      }
      if (this.flame) this.flame.scale.multiplyScalar(1 + this.glow * 0.4);
      this.seek(dt, p);
      // fade out if the camera swings right up to it
      const camD = this.obj.position.distanceTo(game.render.camera.position);
      this.obj.visible = camD > 0.7;
      if (Math.random() < dt * 4) game.vfx.add.spawn({ x: this.obj.position.x, y: this.obj.position.y + 0.12, z: this.obj.position.z, vy: 0.3, color: new THREE.Color('#ffc070').multiplyScalar(3), alpha: 0.8, alpha1: 0, size: 0.04, life: 0.8 });
    }
  }
}
