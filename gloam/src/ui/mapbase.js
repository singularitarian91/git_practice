// The island drawn once from the terrain (ground layers, hill shading,
// water depth) with building footprints on top.  Shared by the map panel
// and the HUD minimap; call getMapBase(game) again after the map changes
// (clear game.mapBase first).
import * as THREE from 'three';
import { LOC, BUILDINGS } from '../game/worldmap.js';

export const MAP_LABELS = [
  ['Hollow Green', LOC.hearth], ['Croft', { x: -52, z: 30 }], ['The Barrow', LOC.barrow], ['Blackwater', LOC.lake],
  ['Mistwood', LOC.mistwood], ['Birchmeadow', LOC.meadow], ['Greyshore', { x: 20, z: 96 }], ['Stones', LOC.stones], ['Altar', LOC.altar], ['Heath', LOC.heath],
];

const WOOD = new Set(['dock', 'bridge', 'longship']);
const STONE = /^(ruin|grave|standing|altar)/;

function paintGround(t, S, W) {
  const img = new ImageData(S, S);
  const d = img.data;
  const step = W / S;
  for (let j = 0; j < S; j++) {
    const z = -W / 2 + (j + 0.5) * step;
    for (let i = 0; i < S; i++) {
      const x = -W / 2 + (i + 0.5) * step;
      const hh = t.heightAt(x, z);
      let r, g, b;
      if (hh < -0.1) {
        const dep = Math.min(1, -hh / 6);
        r = 30 - dep * 16; g = 48 - dep * 22; b = 58 - dep * 20;
        if (hh > -0.7) { r += 16; g += 18; b += 16; } // shallows along the shore
      } else {
        const sp = t.splatAt(x, z);
        r = 88; g = 100; b = 60;
        if (sp.forest > 0.5) { r = 52; g = 64; b = 44; }
        if (sp.sand > 0.5) { r = 150; g = 136; b = 104; }
        if (sp.rock > 0.5) { r = 110; g = 110; b = 106; }
        if (sp.path > 0.5) { r = 120; g = 96; b = 66; }
        if (sp.plaza > 0.5) { r = 128; g = 120; b = 110; }
        if (sp.farm > 0.5) { r = 96; g = 70; b = 46; }
        // hill shading, lit from the north-west
        const slope = Math.max(-0.4, Math.min(0.4, (t.heightAt(x + 1, z + 1) - t.heightAt(x - 1, z - 1)) * 0.1));
        const shade = (0.78 + Math.min(0.35, hh / 30)) * (1 + slope);
        r *= shade; g *= shade; b *= shade;
      }
      const o = (j * S + i) * 4;
      d[o] = r; d[o + 1] = g; d[o + 2] = b; d[o + 3] = 255;
    }
  }
  return img;
}

// footprint of a placed model in its own frame: centre offset and size (m)
function footprint(obj) {
  const rot = obj.rotation.y;
  obj.rotation.y = 0;
  obj.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(obj);
  obj.rotation.y = rot;
  obj.updateMatrixWorld(true);
  if (box.isEmpty()) return null;
  return {
    ox: (box.min.x + box.max.x) / 2 - obj.position.x, oz: (box.min.z + box.max.z) / 2 - obj.position.z,
    sx: box.max.x - box.min.x, sz: box.max.z - box.min.z, rot,
  };
}

function paintBuildings(c, game, k, W) {
  for (const def of BUILDINGS) {
    const b = game.world.buildings.get(def.id);
    if (!b || !b.obj) continue;
    const f = footprint(b.obj);
    if (!f) continue;
    const model = def.model;
    c.save();
    c.translate((b.obj.position.x + W / 2) * k, (b.obj.position.z + W / 2) * k);
    c.rotate(-f.rot);
    const cx = f.ox * k, cy = f.oz * k, w = f.sx * k, h = f.sz * k;
    const round = (rx, ry) => { c.beginPath(); c.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2); };
    c.strokeStyle = 'rgba(20, 14, 10, 0.85)';
    c.lineWidth = 1;
    if (model === 'hearth_great') {
      round(w * 0.42, h * 0.42); c.fillStyle = '#6f6861'; c.fill();
      round(w * 0.18, h * 0.18); c.fillStyle = '#f0a040'; c.fill();
    } else if (model === 'museum_barrow') {
      round(w / 2, h / 2); c.fillStyle = '#5b6a3e'; c.fill(); c.stroke();
    } else if (model === 'standing_stones') {
      round(w * 0.42, h * 0.42); c.strokeStyle = '#9a968b'; c.lineWidth = 2; c.stroke();
    } else if (model === 'well') {
      round(w / 2, h / 2); c.fillStyle = '#7d766d'; c.fill(); c.stroke();
    } else {
      c.fillStyle = WOOD.has(model) ? '#7a5634' : STONE.test(model) ? '#8b877c' : '#54402f';
      c.fillRect(cx - w / 2, cy - h / 2, w, h);
      c.strokeRect(cx - w / 2 + 0.5, cy - h / 2 + 0.5, Math.max(0, w - 1), Math.max(0, h - 1));
    }
    c.restore();
  }
}

export function getMapBase(game, S = 640) {
  if (game.mapBase) return game.mapBase;
  const t = game.engine.terrain;
  const W = t.size;
  const k = S / W; // map pixels per metre
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = S;
  const c = canvas.getContext('2d');
  c.putImageData(paintGround(t, S, W), 0, 0);
  paintBuildings(c, game, k, W);
  game.mapBase = { canvas, S, W, k, toPx: (x, z) => [(x + W / 2) * k, (z + W / 2) * k] };
  return game.mapBase;
}

// where the player sleeps (the door of the hut or longhouse)
export function homePos(game) {
  const b = game.world.buildings.get('home');
  const d = b && b.obj && b.obj.userData.doorPos;
  return d ? { x: d.x, z: d.z } : LOC.croftHut;
}
