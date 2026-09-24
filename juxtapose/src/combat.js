// Combat v2 helpers: posture & stagger (Sekiro), deathblow availability
// (Sekiro/Doom glory kills), and the world-space combat HUD: posture bars,
// the red deathblow mark, and the perilous-attack glyph.
import * as THREE from 'three';

export function initPosture(e, max) {
  e.posture = 0; e.postureMax = max; e.postureT = 10; e.staggered = 0; e.postureShow = 0;
}

export function addPosture(game, e, amount) {
  if (!e || e.dead || e.postureMax === undefined || e.staggered > 0) return;
  e.posture += amount * (game.run?.mods.posture ?? 1);
  e.postureT = 0;
  e.postureShow = 3;
  if (e.posture >= e.postureMax) { e.posture = e.postureMax; stagger(game, e); }
}

export function stagger(game, e) {
  e.staggered = e.kind === 'boss' ? 4.8 : 3.4;
  const c = e.center();
  game.audio.sfx('posture', { position: c });
  game.vfx.ring(c, 0.3, 2.6, 0.5, 0xff4d3d, 1, game.render.camera.getWorldDirection(new THREE.Vector3()).negate());
  game.vfx.impact(c, new THREE.Vector3(0, 1, 0), '#ffd27a', 2);
  game.hitStop(0.09);
  e.onStagger && e.onStagger();
  game.narrator?.event('stagger');
}

export function updatePosture(e, dt) {
  if (e.postureMax === undefined) return;
  e.postureT += dt;
  e.postureShow = Math.max(0, e.postureShow - dt);
  if (e.staggered > 0) {
    e.staggered -= dt;
    if (e.staggered <= 0) { e.staggered = 0; e.posture = e.postureMax * 0.45; }
    return;
  }
  // posture recovers when you stop pressing; badly wounded things recover slowly
  if (e.postureT > 1.6) {
    const hpK = Math.max(0, e.hp / e.maxHp);
    e.posture = Math.max(0, e.posture - dt * e.postureMax * (0.05 + 0.13 * hpK));
  }
}

export function canDeathblow(e) {
  if (!e || e.dead) return false;
  if (e.staggered > 0) return true;
  return e.kind === 'enemy' && e.hp > 0 && e.hp < e.maxHp * 0.2; // glory-kill window
}

// ---------------------------------------------------------------------------
// World-space combat HUD
// ---------------------------------------------------------------------------
function glyphTexture(ch, color) {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(64, 64, 10, 64, 64, 62);
  gr.addColorStop(0, 'rgba(255,40,30,0.55)'); gr.addColorStop(1, 'rgba(255,40,30,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  // a red diamond with a bold "!" reads everywhere; the kanji sits faintly behind it where fonts allow
  g.save(); g.translate(64, 64); g.rotate(Math.PI / 4);
  g.fillStyle = 'rgba(160,10,10,0.9)'; g.strokeStyle = color; g.lineWidth = 6;
  g.fillRect(-30, -30, 60, 60); g.strokeRect(-30, -30, 60, 60); g.restore();
  g.fillStyle = 'rgba(255,255,255,0.28)'; g.font = 'bold 70px "Hiragino Mincho ProN", "Yu Mincho", "Noto Serif JP", "MS Mincho", serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(ch, 64, 66);
  g.fillStyle = '#fff'; g.font = 'bold 56px Georgia, serif';
  g.shadowColor = 'rgba(0,0,0,0.6)'; g.shadowBlur = 6;
  g.fillText('!', 64, 68);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

export class CombatHUD {
  constructor(game) {
    this.game = game;
    this.items = new Map();
    this.geo = new THREE.PlaneGeometry(1, 1);
    this.markTex = game.assets.textures.soft;
    this.perilTex = glyphTexture('危', '#ff3b2f');
  }
  clear() { for (const it of this.items.values()) it.grp.parent?.remove(it.grp); this.items.clear(); }

  make(e) {
    const mat = (color, op = 1) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity: op, depthTest: false, depthWrite: false, toneMapped: false, fog: false });
    const grp = new THREE.Group();
    grp.renderOrder = 20;
    const bg = new THREE.Mesh(this.geo, mat(0x0c0a10, 0.55)); bg.scale.set(1.06, 0.1, 1);
    const post = new THREE.Mesh(this.geo, mat(0xffb347)); post.scale.set(0.001, 0.07, 1); post.position.z = 0.001;
    const hpbg = new THREE.Mesh(this.geo, mat(0x0c0a10, 0.55)); hpbg.scale.set(1.06, 0.045, 1); hpbg.position.y = -0.1;
    const hp = new THREE.Mesh(this.geo, mat(0xefe4cf)); hp.scale.set(1, 0.025, 1); hp.position.set(0, -0.1, 0.001);
    for (const m of [bg, post, hpbg, hp]) { m.renderOrder = 20; grp.add(m); }
    const mark = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.markTex, color: 0xff2a1a, depthTest: false, transparent: true, toneMapped: false, fog: false }));
    mark.scale.setScalar(0.75); mark.position.y = 0.45; mark.renderOrder = 21; grp.add(mark);
    const peril = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.perilTex, depthTest: false, transparent: true, toneMapped: false, fog: false }));
    peril.scale.setScalar(0.9); peril.position.y = 0.95; peril.renderOrder = 21; grp.add(peril);
    this.game.scene.add(grp);
    const it = { grp, post, hp, mark, peril };
    this.items.set(e.id, it);
    return it;
  }

  update(dt) {
    const game = this.game;
    const cam = game.render.camera;
    const seen = new Set();
    for (const e of game.entities) {
      if ((e.kind !== 'enemy' && e.kind !== 'boss') || e.dead || e.postureMax === undefined) continue;
      const lunging = e.lunge && e.lunge.perilous && e.lunge.phase === 'wind';
      const show = e.postureShow > 0 || e.staggered > 0 || canDeathblow(e) || lunging || game.player?.aimEntity === e || e.hp < e.maxHp;
      if (!show || e.kind === 'boss') {
        // the boss's posture lives in the top HUD bar; only its deathblow mark is drawn in the world
        if (e.kind !== 'boss' || !(e.staggered > 0)) continue;
      }
      seen.add(e.id);
      const it = this.items.get(e.id) || this.make(e);
      it.grp.visible = true;
      const c = e.center();
      const top = e.kind === 'boss' ? c.clone().add(new THREE.Vector3(0, 2.2, 0)) : c.clone().add(new THREE.Vector3(0, e.extent.y + 0.45, 0));
      it.grp.position.copy(top);
      it.grp.quaternion.copy(cam.quaternion);
      const d = cam.position.distanceTo(top);
      it.grp.scale.setScalar(THREE.MathUtils.clamp(d * 0.085, 1.0, 3.2));
      const k = e.posture / e.postureMax;
      it.post.scale.x = Math.max(0.001, k);
      it.post.material.color.setRGB(1, 0.7 - 0.55 * k, 0.28 - 0.2 * k);
      it.hp.scale.x = Math.max(0.001, e.hp / e.maxHp);
      it.hp.position.x = -(1 - it.hp.scale.x) / 2;
      const barsOn = e.kind !== 'boss';
      for (const m of [it.grp.children[0], it.post, it.grp.children[2], it.hp]) m.visible = barsOn;
      const db = canDeathblow(e);
      it.mark.visible = db;
      if (db) { it.mark.material.opacity = 0.8 + Math.sin(game.time * 12) * 0.2; it.mark.material.color.setRGB(1.6, 0.08, 0.05); }
      it.peril.visible = !!lunging;
      if (lunging) it.peril.material.opacity = 0.6 + Math.sin(game.time * 20) * 0.4;
    }
    for (const [id, it] of this.items) if (!seen.has(id)) { it.grp.visible = false; if (![...game.entities].some((e) => e.id === id)) { it.grp.parent?.remove(it.grp); this.items.delete(id); } }
  }
}

// A sweeping slash arc of stretched sparks around `origin`, from angle a0 to a1 about `up`
export function slashArc(game, origin, forward, a0, a1, radius, color = '#fff0c8', tilt = 0) {
  const up = new THREE.Vector3(0, 1, 0);
  const right = new THREE.Vector3().crossVectors(forward, up).normalize();
  const tiltQ = new THREE.Quaternion().setFromAxisAngle(forward, tilt);
  const col = new THREE.Color(color).multiplyScalar(4);
  const n = 16;
  for (let i = 0; i < n; i++) {
    const a = a0 + (a1 - a0) * (i / (n - 1));
    const dir = forward.clone().multiplyScalar(Math.cos(a)).addScaledVector(right, -Math.sin(a)).applyQuaternion(tiltQ);
    const p = origin.clone().addScaledVector(dir, radius);
    const tang = forward.clone().multiplyScalar(-Math.sin(a)).addScaledVector(right, -Math.cos(a)).applyQuaternion(tiltQ).multiplyScalar(Math.sign(a1 - a0) * 9);
    game.vfx.sparks.spawn({ x: p.x, y: p.y, z: p.z, vx: tang.x, vy: tang.y, vz: tang.z, color: col, alpha: 0.9, alpha1: 0, size: 0.16, life: 0.12 + i * 0.006, stretch: 0.05, drag: 6 });
  }
}
