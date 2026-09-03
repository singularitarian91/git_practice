# NEON DYNASTY — One-Shot Build Prompt

Paste everything below the line into a capable coding model in a single message. It is written to produce a complete, playable browser game in one response, using real rigged 3D models loaded from public CDNs and full PS4 (DualShock 4) controller support.

---

You are building **NEON DYNASTY**, a Dynasty Warriors–style "one versus a thousand" action game with a hard cyberpunk aesthetic. Deliver it as **one `index.html`** with inline CSS and JS, an ES-module import map pointing at pinned CDN packages, and real glTF character models streamed from public CDNs. Write the entire game in this one response. Do not stub, do not leave TODOs, do not ask questions. If you must cut scope, cut level count before cutting feel, visuals, or controller support.

## 1. The fantasy

The player is a lone augmented street-samurai cutting through an occupied megacity. Hundreds of enemies flood the screen. Every swing should hit six things. Officers and bosses appear with dramatic name cards and multi-segment health bars. The tone is *Dynasty Warriors 4* pacing wearing a *Blade Runner / Ghost in the Shell / Akira* skin: rain, neon, holograms, kanji signage, chrome, and gore replaced by sparks and coolant.

## 2. Libraries (pinned, ESM, via import map)

Use exactly these. All are on jsDelivr and serve CORS headers, so the file runs from `file://` in Chrome/Edge as well as from a local server.

```html
<script type="importmap">
{ "imports": {
  "three": "https://cdn.jsdelivr.net/npm/three@0.185.1/build/three.module.js",
  "three/addons/": "https://cdn.jsdelivr.net/npm/three@0.185.1/examples/jsm/",
  "postprocessing": "https://cdn.jsdelivr.net/npm/postprocessing@6.39.4/build/index.js",
  "three-mesh-bvh": "https://cdn.jsdelivr.net/npm/three-mesh-bvh@0.9.14/+esm",
  "tone": "https://cdn.jsdelivr.net/npm/tone@15.1.22/+esm"
} }
</script>
```

- **three** + addons: `GLTFLoader`, `DRACOLoader` (decoder path `https://cdn.jsdelivr.net/npm/three@0.185.1/examples/jsm/libs/draco/`), `MeshoptDecoder`, `RGBELoader`, `SkeletonUtils` (for cloning rigged characters), `Reflector` (real planar reflections on the wet ground), `lil-gui` from `three/addons/libs/lil-gui.module.min.js` for the debug panel.
- **postprocessing** (pmndrs): `EffectComposer`, `RenderPass`, `EffectPass`, `BloomEffect`, `ChromaticAberrationEffect`, `VignetteEffect`, `NoiseEffect`, `ScanlineEffect`, `GlitchEffect` (boss intros and HUD corruption), `SMAAEffect`, `DepthOfFieldEffect` (only during cinematics). This library batches effects into one shader pass, so use it instead of three's own EffectComposer.
- **three-mesh-bvh**: accelerate raycasts against the level mesh for ground snapping, lock-on line of sight, and dash collision.
- **tone**: the entire soundtrack and all SFX are synthesized with Tone.js (Synths, NoiseSynth, MembraneSynth, Transport). No audio files.
- No physics engine. Write a lightweight custom system (capsules vs. capsules, capsule vs. BVH world) because 300 agents in Rapier would cost more than it saves.

## 3. Assets — real models, not procedural primitives

Every model below is verified reachable at that exact URL and licensed for this use. Preload all of them on a styled loading screen with a progress bar, then start. **Every asset must have a cheap procedural fallback** so a failed fetch degrades visibly but never breaks the game. Log which fallbacks fired.

Base URLs:

```
THREE_EX = https://cdn.jsdelivr.net/gh/mrdoob/three.js@r185/examples/
KAYKIT_ADV = https://cdn.jsdelivr.net/gh/KayKit-Game-Assets/KayKit-Character-Pack-Adventures-1.0@main/addons/kaykit_character_pack_adventures/Characters/gltf/
KAYKIT_SKEL = https://cdn.jsdelivr.net/gh/KayKit-Game-Assets/KayKit-Character-Pack-Skeletons-1.0@main/addons/kaykit_character_pack_skeletons/Characters/gltf/
```

**Player** — `KAYKIT_ADV + Rogue_Hooded.glb` (CC0, rigged, includes melee attack, dodge, hit, death, idle, walk, run clips). Replace its material with a dark PBR material plus emissive cyan seams on the hood and blade; swap its weapon accessory node for a long emissive katana. Alternate skins: `Knight.glb` (heavy chrome), `Barbarian.glb`. Clip names vary between characters, so at load time list every `AnimationClip.name`, log them, and resolve them by case-insensitive substring: `idle`, `walk`, `run`, `attack|slash|chop|slice`, `spin`, `dodge|roll`, `hit`, `death`, `block`. Build the light string from the different one-handed attack clips, the heavies from the two-handed/spin clips, using cross-fades of 0.08 s and clip time-scale of 1.4 to make it feel fast.

**Enemies:**

| Enemy | Model | Notes |
|---|---|---|
| Drone Trooper (grunt) | `THREE_EX + models/gltf/RobotExpressive/RobotExpressive.glb` (CC0) | Clips: `Idle, Walking, Running, Death, Punch, Jump, Wave, No, Yes, ThumbsUp, Dance, Sitting, Standing`. Recolor matte black, emissive red eye. `Punch` is its attack. |
| Hound (fast grunt) | RobotExpressive scaled 0.6, tilted forward, cyan emissive | Lunge uses `Jump`. |
| Ganger (organic grunt) | `KAYKIT_SKEL + Skeleton_Minion.glb`, `Skeleton_Rogue.glb`, `Skeleton_Warrior.glb` (CC0) | Give them neon-jacket materials and a chrome-skull emissive; they read as street trash with cheap implants. Pink hex-particle burst instead of blood. |
| Corpo Merc (shooter) | `THREE_EX + models/gltf/Soldier.glb` | Clips `Idle, Walk, Run, TPose`. Add an SMG prop (box + emissive muzzle) to the right hand bone. |
| Officer (mini-boss) | `KAYKIT_SKEL + Skeleton_Mage.glb` and `KAYKIT_ADV + Knight.glb`, scaled 1.4 | Distinct emissive color per officer. |
| Swarm Drone | Small instanced procedural drones are acceptable here (200+ of them). | |

**Bosses:**

| Boss | Model |
|---|---|
| KIRIN-9, "The Warden" | RobotExpressive scaled 5x with a chrome/emissive re-skin, plus attached thruster and cannon meshes. Its expressive face becomes a police visor. |
| LADY OBSIDIAN | `THREE_EX + models/gltf/Michelle.glb` (rigged human) with an obsidian-black material, magenta rim, retimed clips for blade strings; clones are `SkeletonUtils.clone` with a hologram shader. |
| THE CHOIR | `THREE_EX + models/gltf/PrimaryIonDrive.glb` as the floating core, orbiting shield nodes made from `THREE_EX + models/gltf/DamagedHelmet/glTF/DamagedHelmet.gltf` fragments. |

**World:**

- Hub / district arena: `THREE_EX + models/gltf/LittlestTokyo.glb` (CC-BY 4.0, credit "Littlest Tokyo by Glen Fox" on the title screen). It is a stylized Tokyo diorama with animated trains; scale it up so its streets are walkable, darken and re-light it as a rain-soaked night district. Build the fight arenas around it.
- Final arena: `THREE_EX + models/gltf/space_ship_hallway.glb` re-lit as the data-cathedral corridor leading to THE CHOIR.
- Environment lighting: `THREE_EX + textures/equirectangular/moonless_golf_1k.hdr` via `RGBELoader` for night reflections, with `scene.environmentIntensity` low and neon emissives doing the visible work.
- Fill the streets with additional procedural buildings behind the diorama so the skyline extends to the fog.

**Optional local override (do not require it):** if an `assets/manifest.json` exists next to `index.html`, read it and substitute any model URL. Document in a comment that users can drop in CC0 packs from Quaternius (robots, Ultimate Modular Sci-Fi, Universal Animation Library), Kenney (Sci-Fi kits), or Sketchfab CC0 models, and Mixamo animations, and that local files require serving over http (`npx serve` or `python -m http.server`).

## 4. Rendering a crowd of rigged characters at 60 fps

- Load each GLB once; instantiate with `SkeletonUtils.clone`. Share geometry and materials across clones.
- **Animation LOD**: the 60 enemies nearest the camera update their `AnimationMixer` every frame, the next 100 every 2nd frame, everything else every 4th frame with `mixer.timeScale` compensation. Beyond 60 m, replace the skinned mesh with a static posed `InstancedMesh` proxy baked from the model's idle pose.
- Hard cap 220 skinned characters alive + unlimited instanced proxies/drones. Pool everything; never allocate during combat.
- `renderer.shadowMap` on for the player, bosses, and officers only (cast shadow), one directional key light with a tight shadow camera that follows the player. Grunts receive shadows but do not cast.
- Bullets, sparks, debris, rain, and damage numbers are instanced or sprite-based.
- Fixed-timestep simulation (60 Hz) decoupled from render. Seeded RNG (`mulberry32`).
- Organize the module into labeled sections: CONFIG, ASSETS, RNG, AUDIO, INPUT, GAMEPAD, CAMERA, WORLD, PLAYER, ENEMIES, BOSSES, COMBAT, VFX, HUD, GAME STATE. Every tunable number lives in CONFIG and is exposed in the lil-gui debug panel.

## 5. Controls — PS4 controller first-class

The game must be fully playable start to finish on a **DualShock 4** connected by USB or Bluetooth in Chrome or Edge, with no keyboard touch after the page loads. Implement a `GAMEPAD` module:

- Poll `navigator.getGamepads()` every simulation tick. Listen for `gamepadconnected` / `gamepaddisconnected`; show a "CONTROLLER LINKED — DUALSHOCK 4" toast and switch HUD glyphs to PlayStation symbols (✕ ○ □ △, L1/R1/L2/R2) the moment any gamepad input is seen; switch back to keyboard glyphs on any key press.
- On the title screen, "PRESS ANY BUTTON" must accept a gamepad button (browsers only expose a pad after a button press).
- Use the Gamepad API **standard mapping** (`gamepad.mapping === "standard"`). DualShock 4 reports standard mapping in Chrome, Edge, and Safari on Windows, macOS, Linux, and Android:

| Index | DS4 | Action |
|---|---|---|
| button 0 | ✕ Cross | Dash / evade (i-frames, chromatic afterimage). Hold: sprint. |
| button 1 | ○ Circle | **MUSOU / OVERDRIVE** when gauge is full |
| button 2 | □ Square | Light attack (6-hit string) |
| button 3 | △ Triangle | Heavy / charge attack (C1–C6 depending on lights landed first) |
| button 4 | L1 | Cycle lock-on target |
| button 5 | R1 | Lock-on toggle (nearest officer/boss) |
| button 6 | L2 (analog) | Guard. Perfect-timed guard reflects Merc bullets. |
| button 7 | R2 (analog) | Blade Dash: homing strike toward lock-on target; pull strength scales with trigger depth |
| button 8 | Share | Toggle debug overlay |
| button 9 | Options | Pause |
| button 10 / 11 | L3 / R3 | L3: toggle sprint. R3: reset camera behind player |
| button 12–15 | D-pad | Up: use Stim (heal 1 segment, 3 per run). Left/Right: switch blade stance (Ronin = balanced, Reaper = wider slower arcs, Wire = faster shorter). Down: taunt (fills 5% Musou, staggers nearby grunts) |
| button 16 | PS | ignored |
| button 17 | Touchpad click | Toggle minimap size |
| axes 0/1 | Left stick | Move, camera-relative |
| axes 2/3 | Right stick | Camera orbit; pushes lock-on camera offset when locked |

- Radial deadzone 0.15 with re-scaling so movement ramps smoothly from the edge of the deadzone; a walk/run blend driven by stick magnitude.
- Edge detection: fire attacks on button *press*, not while held, but allow a 120 ms input buffer so the next string hit queues during hitstop.
- **Rumble**: feature-detect `gamepad.vibrationActuator` and call `playEffect("dual-rumble", { duration, weakMagnitude, strongMagnitude })`. Light hit 40 ms weak 0.3; heavy 90 ms strong 0.6; kill 60 ms 0.4/0.4; boss segment break 300 ms strong 1.0; Musou continuous pulses; taking damage 150 ms strong 0.8. Never throw if the actuator is missing.
- **Non-standard mapping fallback**: if `mapping !== "standard"` (some Linux/Firefox Bluetooth setups), open a remap wizard ("Press ✕ … Press ○ …") that records indices/axes and saves them to `localStorage`. Include an "Input test" screen in the pause menu that shows live button and axis state.
- Keyboard/mouse remains fully supported in parallel: `WASD` move, `Shift` dash, `J`/LMB light, `K`/RMB heavy, `L`/`Space` Musou, `Q` lock-on, `E` cycle, `Ctrl` guard, `F` blade dash, `1` stim, `Tab` stance, `R` restart, `Esc` pause, backtick debug. Mouse drag orbits the camera.

## 6. Combat feel (non-negotiable)

- **Hitstop**: 40 ms on light hits, 90 ms heavy, 140 ms on officer kills, 250 ms + full-screen flash on boss segment breaks. Pause mixers during hitstop.
- **Screen shake**, trauma-based (shake = trauma²), decays over time, plus matching rumble.
- **Hit sparks**: instanced additive quads. Cyan for robots, hot magenta for organics, white-gold for critical.
- **Knockback and launch**: heavies launch groups; simple velocity/gravity/bounce with ragdoll-ish limb flail via the model's `Death`/`hit` clip played at 2x, then dissolve into voxel debris that inherits the enemy's accent color.
- **Blade trail**: a persistent ribbon mesh through every swing, emissive, fades in 0.25 s.
- **Kill counter** in the top corner ticks up with a scale-pop; milestones (100, 500, 1000) trigger a big animated stamp ("500 KOs — RONIN") with a synth stab and a rumble burst.
- Combo counter with decay bar. Combo tiers shift the HUD accent, the player's emissive seams, and the blade color: white → cyan → magenta → gold.
- Generous forward capsule-sweep hitboxes; 360° on the last light and on heavies. Crowd-clearing is the point; make it feel unfair in the player's favor.
- Player HP (5 segments), Musou gauge fills on hits and on taking damage.

## 7. Enemy AI

Shared FSM: `SPAWN → APPROACH → SURROUND → ATTACK → STAGGER → DEAD`. Only a limited **attack-token budget** (4 simultaneous attackers on Ronin difficulty) can strike the player; the rest orbit at 2–4 m and menace, which is how Warriors keeps 300 enemies survivable. Grunts flock with cheap separation. Mercs keep 8–12 m and fire 3-round bursts with visible tracers that can be dodged, guarded, or reflected. Swarm drones come in clouds of 20 and explode on contact.

**Officers** (1–3 per wave): name plate slams in on approach ("SGT. VESPER — ARASAKA-STYLE SECURITY"), a 2-segment health bar, one telegraphed signature attack (red ground decal → strike). Killing one restores 1 HP segment and grants a lot of Musou.

## 8. Bosses — three-part health bars (core requirement)

Bosses are the set pieces. Each has a **three-segment health bar** at the bottom-center of the screen: wide, with name, title, and a portrait glyph. Three discrete cells separated by chrome dividers, each draining left-to-right with a lagging "ghost" red bar. When a cell empties:

1. Hitstop 250 ms, screen flash, glitch pass spike, a synthesized vocoder-ish shout, shattered-glass VFX across the empty cell, strong rumble.
2. **Phase transition**: brief invulnerable animation, arena change (lights go red, rain intensifies, holograms glitch), moveset escalates.
3. Accent color shifts **Phase 1 cyan → Phase 2 magenta → Phase 3 gold-white**, with a pulsing warning-stripe pattern in the final phase.

Ship three bosses with distinct silhouettes and phases:

- **KIRIN-9, "The Warden"** — 6 m police mech. P1: stomps and cannon sweeps. P2: leg jets, jump-slam shockwaves, deploys swarm drones. P3: overheats, chest reactor exposed (weak point ×3 damage), berserk charges, ankle-high coolant floods the arena and slows the player.
- **LADY OBSIDIAN** — cyber-assassin with mono-molecular wire. P1: fast blade strings, teleport dashes leaving afterimages. P2: holographic clones (only one is real; the real one has a slightly brighter rim). P3: wire-grid floor hazards that sweep the arena and must be dashed through.
- **THE CHOIR** — floating server-cathedral AI core with orbiting shield nodes. P1: destroy nodes to expose the core. P2: laser lattice patterns; HUD corruption glitch when hit. P3: gravity pulls, then a final "overclock" that spawns everything.

Each boss has an entrance cinematic (2–3 s camera swing with depth of field, letterboxing, name card with glitch offset, controller rumble swell), a unique arena tint, telegraphed attacks (decals + audio pre-cue), and a death sequence (slow-mo, white-out, voxel collapse, "TARGET NEUTRALIZED" stamp).

## 9. Level structure

One continuous map built around the Littlest Tokyo diorama and the spaceship hallway:

1. Streets → 5 escalating waves → Officer intro
2. Plaza → Boss 1 (KIRIN-9)
3. Overpass / rooftops → 4 waves with Mercs and Hounds → Boss 2 (LADY OBSIDIAN)
4. Data-cathedral corridor → swarm waves → Boss 3 (THE CHOIR) → victory screen with stats (KOs, max combo, time, damage taken, rank S/A/B/C)

Minimap shows enemy density as heat blobs and officers/bosses as skull icons. Objective text ("ELIMINATE THE WARDEN") updates top-center with a typewriter effect.

## 10. Art direction — make it beautiful

Aesthetic target: *wet neon noir*. Everything reads at a glance from the ¾ elevated chase camera.

- **Palette**: near-black base `#07070c`, deep indigo shadows, accent trio **cyan `#19f0ff`**, **magenta `#ff2bd6`**, **acid amber `#ffb400`**, rare warm white for highlights. No pure grays. Fog tinted violet.
- **Lighting**: PBR materials, ACES filmic tone mapping, exposure ~1.1, the HDR environment for reflections. Hundreds of emissive signs and strips, but only 3–4 real dynamic lights (player weapon, boss, one or two arena keys). Fake the rest with emissives and bloom.
- **Post** (pmndrs): bloom (luminance threshold 0.85, intensity 0.9, mipmap blur), chromatic aberration that spikes on hits and during Musou, vignette, film grain, 4% scanlines, SMAA, glitch during boss intros and HUD corruption, depth of field only in cinematics.
- **Rain**: 8,000 instanced streaks with wind. Ground uses `Reflector` (planar reflection) blended with a wet-asphalt normal map generated on a canvas, so neon signs smear across puddles. Splashes are cheap ring sprites.
- **City**: the diorama re-lit for night, plus procedural extruded towers behind it with emissive window grids, holographic billboards cycling generated pseudo-kanji glyph textures drawn to canvas, floating ad-drones, steam vents, hanging cables, and a parallax skyline silhouette at the fog line.
- **Player**: hooded rogue re-skinned in matte black with cyan seams, a long emissive katana with a ribbon trail, and a coat-tail ribbon simulated as a spring chain attached to the spine bone.
- **Enemies**: one dominant emissive per type so the crowd reads in motion. Deaths dissolve into voxel cubes that inherit the accent color.
- **Camera**: behind-and-above with lazy follow, pulls back as crowd density rises, dollies in on finishers, orbits during boss intros; right-stick orbit with auto-recenter.

## 11. HUD (DOM, not 3D)

Diegetic augmented-reality overlay: thin 1px cyan lines with corner brackets, monospace numerals, glitch/flicker on state changes, hex-code decorations. Top-left: HP segments and Musou gauge (diagonal-striped, animated when full). Top-right: kill counter and combo. Bottom-center: **boss three-segment bar**, hidden until a boss engages. Bottom-left: minimap. Top-center: objective. Button prompts use PlayStation glyphs whenever a controller is active. Pause menu, input test, remap wizard, and death screen share the language ("SYSTEM FAILURE — REBOOT? [○]").

## 12. Audio (Tone.js)

- Driving synthwave loop: arpeggiated saw bass, sidechained pad, four-on-the-floor kick, all from Tone synths on the Transport. Tempo ramps and a new layer joins in boss fights; final phase adds a distorted lead.
- SFX: blade whoosh (filtered noise sweep), metal hit, organic thud, bullet, kill sting, boss segment shatter (glass noise + sub drop), Musou activation (rising sweep into a bass drop), UI blips.
- `Tone.start()` on first input, including a gamepad button. Volume slider in pause, mute on `M` or Share + Options.

## 13. Polish checklist (implement all)

- Loading screen with per-asset progress and a glitching "NEON DYNASTY" logo; asset credits line (Littlest Tokyo by Glen Fox, CC-BY 4.0; KayKit and three.js example models).
- Title screen: "PRESS ANY BUTTON", seed display, controller-detected indicator.
- Difficulty select: Rookie / Ronin / Shogun (enemy HP, attack tokens, boss aggression).
- Floating damage numbers, color-coded, crits larger.
- Slow-motion on every boss's killing blow and on the 1000th KO.
- Result screen with animated stat count-up and rank stamp.
- `localStorage` for high score, best rank, controller remap, and volume.
- Debug overlay: fps, skinned/instanced counts, draw calls, mixers updated this frame, fallback assets in use.
- Never softlock: bosses enrage after 4 minutes (triple damage) instead of becoming unwinnable.

## 14. Output format

Return exactly one code block containing the full `index.html`. Before it, give a 6-line summary: what was built, the DualShock 4 controls, and how to run it (double-click in Chrome/Edge, or `npx serve` for local asset overrides). After the code block, nothing. The file must be syntactically valid and load without console errors, and it must remain playable if every remote model fails to load.
