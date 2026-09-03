# NEON DYNASTY — One-Shot Build Prompt

Paste everything below the line into a capable coding model in a single message. It is written to produce a complete, playable, single-file browser game in one response.

---

You are building **NEON DYNASTY**, a Dynasty Warriors–style "one versus a thousand" action game with a hard cyberpunk aesthetic. Deliver it as **one self-contained `index.html`** (inline CSS and JS, Three.js loaded from a CDN, no other dependencies, no build step). It must run by double-clicking the file. Write the entire game in this one response; do not stub, do not leave TODOs, do not ask questions. If you must cut scope, cut level count before cutting feel or visuals.

## 1. The fantasy

The player is a lone augmented street-samurai cutting through an occupied megacity. Hundreds of enemies flood the screen. Every swing should hit six things. Officers and bosses appear with dramatic name cards and multi-segment health bars. The tone is *Dynasty Warriors 4* pacing wearing a *Blade Runner / Ghost in the Shell / Akira* skin: rain, neon, holograms, kanji signage, chrome, and gore replaced by sparks and coolant.

## 2. Tech constraints

- Three.js (r160 or newer) via `https://cdnjs.cloudflare.com` or `https://cdn.jsdelivr.net/npm/`. No other libraries.
- All geometry is procedural (boxes, capsules, cylinders, instanced meshes). No external models, textures, or audio files. Audio via Web Audio API synthesis only.
- Use `InstancedMesh` for grunts, bullets, debris, and rain. Target 60 fps with 300+ active enemies on a mid-range laptop. Cap draw calls aggressively.
- Fixed-timestep simulation (60 Hz) decoupled from render. Deterministic seeded RNG (`mulberry32`) so a given seed replays the same wave layout.
- Single ES module `<script type="module">`. Organize code into clearly labeled sections: CONFIG, RNG, AUDIO, INPUT, CAMERA, WORLD, PLAYER, ENEMIES, BOSSES, COMBAT, VFX, HUD, GAME STATE. Every tunable number lives in CONFIG.
- Resize-safe. Pointer lock optional (keyboard + mouse and gamepad both work).

## 3. Controls

Keyboard/mouse:
- `WASD` move, `Shift` dash (i-frames, 0.25 s, 0.6 s cooldown, leaves a chromatic afterimage trail)
- `J` / left click: light attack (string of up to 6 hits)
- `K` / right click: heavy attack (charge finisher; pressing heavy after N lights launches a different charge move, exactly like Warriors' "charge attack" system, C1 through C6)
- `L` / `Space`: **MUSOU / OVERDRIVE** when the gauge is full (screen-clearing ultimate, 4 s, invulnerable, time slows 0.3x for the first 0.4 s)
- `Q`: lock-on nearest officer/boss, `E`: cycle target
- `R`: restart, `Esc`: pause

Gamepad: left stick move, `A` light, `X` heavy, `B` dash, `Y` musou, `RB` lock-on. Rumble on hits if supported.

## 4. Combat feel (non-negotiable)

- **Hitstop**: 40 ms freeze on light hits, 90 ms on heavy, 140 ms on kills of officers, 250 ms + full-screen flash on boss segment breaks.
- **Screen shake** scaled by hit weight; trauma-based (shake = trauma²), decays over time.
- **Hit sparks**: instanced additive quads, cyan for robots, hot magenta for organics, white-gold for critical.
- **Knockback and launch**: heavies launch groups, juggles possible, enemies ragdoll-ish via simple physics (velocity, gravity, ground bounce, then despawn into voxel debris).
- **Kill counter** in the top corner ticks up with a scale-pop each kill; milestones (100, 500, 1000) trigger a big animated stamp ("500 KOs — RONIN") with a synth stab.
- Combo counter with decay bar. Combo tiers change the HUD accent color (white → cyan → magenta → gold).
- Attacks have generous forward hitboxes (capsule sweeps), 360° on the last light and on heavies. Crowd-clearing is the point; make it feel unfair in the player's favor.
- Player has HP (5 segments) and a Musou gauge that fills on hits and on taking damage.

## 5. Enemies

All enemies use a shared FSM: `SPAWN → APPROACH → SURROUND → ATTACK → STAGGER → DEAD`. Only a limited "attack token" budget (e.g., 4 at once) can attack the player simultaneously; the rest surround and menace, which is how Warriors keeps 300 enemies survivable.

**Grunts (instanced, hundreds):**
- **Drone Trooper** — humanoid security bot, matte black with a single red eye-bar. Slow melee. Dies into sparking voxel cubes.
- **Hound** — quadruped robot, fast, lunges. Cyan spine light.
- **Ganger** — human, neon jacket, bat or machete. Screams, staggers, flails. Blood is replaced by a pink hex-particle burst.
- **Corpo Merc** — human, exo-armor, SMG. Fires tracer bursts from mid-range. Only enemy that shoots; bullets are dodgeable and can be reflected by heavy attacks.
- **Swarm Drones** — flying, fragile, come in clouds of 20 and explode on contact.

**Officers (mini-bosses, 1–3 per wave):** bigger models, a name plate on approach ("SGT. VESPER — ARASAKA-STYLE SECURITY"), a single 2-segment health bar, one signature attack with a telegraph (red ground decal → attack). Killing one restores 1 HP segment and grants a lot of Musou.

## 6. Bosses — three-part health bars (core requirement)

Bosses are the set pieces. Each has a **three-segment health bar** displayed at the bottom-center of the screen, wide, with the boss's name, title, and a portrait glyph. The bar is three discrete cells separated by chrome dividers; each cell drains left-to-right with a lagging "ghost" red bar behind it. When a cell empties:

1. Hitstop 250 ms, screen flash, boss shouts (synthesized vocoder-ish burst), and shattered-glass VFX across the empty cell.
2. The boss enters a **phase transition**: brief invulnerable animation, arena change (lights go red, rain intensifies, holograms glitch), and its moveset escalates.
3. The bar's accent color shifts: **Phase 1 cyan → Phase 2 magenta → Phase 3 gold-white**, and the segment gets a pulsing warning stripe pattern in its final phase.

Ship at least **three bosses** with distinct silhouettes and phases:

- **KIRIN-9, "The Warden"** — 6 m bipedal police mech. P1: stomps and cannon sweeps. P2: leg jets, jump-slam shockwaves, deploys swarm drones. P3: overheats, chest reactor exposed (weak point ×3 damage), berserk charges, arena floods with ankle-high coolant that slows the player.
- **LADY OBSIDIAN** — human cyber-assassin with mono-molecular wire. P1: fast blade strings, teleport dashes leaving afterimages. P2: summons holographic clones (only one is real; the real one has a slightly brighter rim light). P3: wire-grid arena hazards that sweep the floor, must be dashed through.
- **THE CHOIR** — a floating server-cathedral AI core surrounded by orbiting shield nodes. P1: nodes must be destroyed to expose the core. P2: laser lattice patterns, screen-space "corruption" glitch on the HUD when hit. P3: gravity pulls, then a final desperate "overclock" where it spawns everything.

Each boss must have: an entrance cinematic (2–3 s camera swing, letterboxing, name card slams in with glitch offset), a unique arena tint, telegraphed attacks (decals + audio pre-cue), and a death sequence (slow-mo, white-out, voxel collapse, "TARGET NEUTRALIZED" stamp).

## 7. Level structure

One continuous map is enough: a rain-soaked district with three linked arenas plus connecting streets, ~200 × 200 units. Flow:

1. Streets → wave-based crowd fights (5 waves, escalating mix) → **Officer** intro
2. Plaza → Boss 1 (KIRIN-9)
3. Rooftop / overpass → 4 waves with Mercs and Hounds → Boss 2 (LADY OBSIDIAN)
4. Data-cathedral interior → swarm waves → Boss 3 (THE CHOIR) → victory screen with stats (KOs, max combo, time, damage taken, rank S/A/B/C)

A minimap in the corner shows enemy density as heat blobs and officers/bosses as skull icons. Objective text ("ELIMINATE THE WARDEN") updates in the top-center with a typewriter effect.

## 8. Art direction — make it beautiful

Aesthetic target: *wet neon noir*. Everything reads at a glance from the camera's ¾ elevated view.

- **Palette**: near-black base (`#07070c`), deep indigo shadows, accent trio of **cyan `#19f0ff`**, **magenta `#ff2bd6`**, **acid amber `#ffb400`**; rare warm white for highlights. No pure grays. Fog color tinted violet.
- **Lighting**: physically based materials, ACES filmic tone mapping, exposure ~1.1. Hundreds of emissive signs and strips; only 3–4 real dynamic lights (player weapon, boss, one or two arena keylights). Fake the rest with emissive maps and bloom.
- **Post-processing** (implement with Three's EffectComposer/UnrealBloomPass from the examples/jsm path, or handwritten shaders if simpler): bloom (threshold 0.85, strength 0.9), subtle chromatic aberration that spikes on hits and during Musou, vignette, film grain, and a scanline overlay at 4% opacity. Slight barrel distortion during the boss intros.
- **Rain**: 8,000 instanced streaks falling with slight wind; ground is a reflective wet plane (roughness 0.15, metalness 0.0, envMap from a procedural gradient cubemap) so neon smears in the puddles. Puddle splashes are cheap ring sprites.
- **City**: procedurally extruded buildings with random emissive window grids, holographic billboards that flip through generated glyph textures (draw pseudo-kanji/katakana-like glyphs to a canvas texture), floating ad-drones, steam vents, cables. Distant skyline as a parallax silhouette layer.
- **Player**: sleek capsule-based figure, long coat with a trailing cloth ribbon (a chain of springs), katana with an emissive edge that streaks a persistent trail mesh through attacks. Coat and blade tint shift with combo tier.
- **Enemies**: strong silhouettes, one dominant emissive per type so the crowd is readable in motion. Deaths dissolve into voxel cubes that inherit the enemy's accent color and fade.
- **Camera**: chase camera from behind-and-above with lazy follow, pulls back as crowd density increases, shakes and dollies in on finishers, orbits during boss intros.

## 9. HUD (in DOM, not in the 3D scene)

Style the HUD as a diegetic augmented-reality overlay: thin 1px cyan lines with corner brackets, monospace numerals (use a system monospace stack), glitch/flicker animations on state changes, hex-code decorations. Top-left: player HP segments and Musou gauge (diagonal-striped, animated when full). Top-right: kill counter and combo. Bottom-center: **boss three-segment bar** (hidden until a boss engages). Bottom-left: minimap. Center-top: objective. Everything animates in via CSS keyframes. Pause menu and death screen use the same language ("SYSTEM FAILURE — REBOOT? [R]").

## 10. Audio (synthesized)

- Driving synthwave-style loop: arpeggiated saw bass, sidechained pad, 4-on-the-floor kick, all generated with oscillators and gain envelopes. Tempo ramps and a new layer joins in boss fights; final boss phase adds a distorted lead.
- SFX: blade whoosh (filtered noise sweep), metal hit (short square + noise burst), organic hit (low thud), bullet (click + pitch drop), kill sting, boss segment shatter (glass noise + sub drop), Musou activation (rising sweep into a bass drop).
- Master volume slider in pause, mute on `M`. Audio context starts on first user input.

## 11. Polish checklist (implement all)

- Title screen with animated logo ("NEON DYNASTY" in glitching outlined text), "PRESS ANY KEY", seed display.
- Difficulty select: Rookie / Ronin / Shogun (changes enemy HP, attack tokens, boss aggression).
- Damage numbers as floating sprites, color-coded, crits larger.
- Slow-motion on the killing blow of every boss and on the 1000th KO.
- Result screen with animated stat count-up and rank stamp.
- Persist high score and best rank in `localStorage`.
- Debug overlay toggled with backtick: fps, entity count, draw calls.
- Never softlock: bosses have a 4-minute enrage that triples their damage rather than an unwinnable state.

## 12. Output format

Return exactly one code block containing the full `index.html`. Before the code block, give a 5-line summary of what was built and the controls. After the code block, nothing. The file must be syntactically valid and run without console errors on the first load.
