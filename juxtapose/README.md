# Juxtapose

*A surrealist third-person shooter-roguelike set inside a stranger's dream.*

You play a figment: a wooden de Chirico mannequin in a Magritte bowler hat, with an apple hovering where its face should be. You fight your way down through the layers of someone's sleep before they wake. Your weapon is the **Juxtaposition Gun**, which has two barrels. One **takes** a property from something, and the other **gives** that property to something else.

This folder is a playable prototype for testing the mechanics. All art is built procedurally in Blender (headless `bpy`), the game runs in the browser on three.js, and physics runs on Rapier.

## Run it

It's a static site. Serve this folder and open it in a desktop browser (Chrome, Edge or Firefox):

```bash
cd juxtapose
python3 -m http.server 8000
# then open http://localhost:8000
```

Opening `index.html` straight from disk won't work, because browsers block ES modules and `.glb` fetches over `file://`. Everything else is vendored (`vendor/`), so no install or build step is needed. The only network request is for the UI web fonts, which fall back gracefully if they can't load.

Choose **Lucid sandbox** on the title screen to test mechanics freely. It has every property, infinite charges, no waking up, and a spawn menu on `B`. Choose **Begin the night** for a real run.

## Controls

| | |
|---|---|
| `W A S D` | Run. Keep running and you break into a sprint. |
| `Space` | Jump. Press again in the air for a flip, or near a wall to wall-jump. |
| `Shift` | Dash (one air dash per jump) |
| `C` / `Ctrl` | Slide while running. Ground-pound in the air. |
| Mouse | Chase camera, Ratchet & Clank style |
| Left mouse | Fire dream rounds |
| Right mouse | **Take** a property from what you aim at |
| `E` / middle mouse | **Give** the selected property to what you aim at |
| `Q` | Give it to **yourself** |
| `F` | Load it into your **rounds** (up to three at once) |
| Wheel / `1`–`9` / hold `Tab` | Choose a property. `Tab` opens a slow-motion wheel. |
| `R` | Reload (break-open revolver) |
| `V` · `H` · `Esc` | Swap shoulder · help · pause |

**Parkour.** You can wall-run along walls, wall-jump off them, climb a wall by jumping straight at it, mantle up ledges up to 2.5 m, and speed-vault over low cover. Other moves:

- Slide, then slide-jump to keep your momentum.
- Air-dash.
- Ground-pound. It becomes a wall-breaking quake while you're heavy.
- Grind brass rails held up by Dalí crutches.
- Bounce on beds, which are trampolines.
- Blast-jump while you're bursting.

## The properties

| Property | Take it from | Given to a thing | Given to yourself | Loaded into rounds |
|---|---|---|---|---|
| Melting | Clock | Walls slump into doorways and enemies drip away | You ooze low and fast under anything | Rounds melt holes |
| Floating | Cloud | Enemies drift into the dream's ceiling and are crushed by the sky | Low gravity, a third jump, gliding | Hits lift targets |
| Reflecting | Mirror | Shots bounce off it, including enemy shots | Enemy orbs bounce back at their shooter | Rounds ricochet up to 14 times |
| Burning | Candle | Burns, spreads to neighbours, and speeds up melting | Burning dashes ignite enemies | Hits ignite |
| Heavy | Anvil | Plummets, crushes and smashes. Cancels floating into a hover. | Wall-breaking dashes and ground pounds | Knockback that cracks walls |
| Sleeping | Bed | Freezes exactly where it is, even mid-air. Sleepers take double damage. | Enemies lose track of you | Hits put targets to sleep |
| Multiplying | Bowler hat | Two copies appear, properties included | Two decoys draw fire | Every round splits in three |
| Hollow | Birdcage | Becomes intangible. Hollow enemies fade away. | Phase through walls, take no damage | Rounds pierce everything |
| Bursting | Pomegranate | Explodes after a short fuse and spreads its other properties to everything in the blast | Your next jump is a blast jump | Explosive rounds |

Properties interact through shared channels instead of hand-written pairs, so combinations emerge on their own:

- **Gravity:** floating plus heavy hover in place.
- **Heat:** burning makes melting three times faster and wakes sleepers.
- **Solidity:** hollow things only touch the ground and the sky.
- **Fuse:** a sleeping bomb is a mine, and burning shortens the fuse.
- **Explosion payloads:** a bursting, floating pomegranate makes everything in the blast float.

**Lucidity** rises with absurdity: stacking properties, new pairings, or giving things to yourself. Higher Lucidity makes every property stronger, warps the picture (FOV dolly zoom, chromatic smear, swirling sky, tempo drag in the score), and brings more anxieties. At 100 the dreamer wakes and the run ends.

## Run structure

1. **The Soft Desert** (Dalí): melting clocks on dead trees, ruined corridors built for wall-running, floating stairs, a four-poster bed in the sand, and rails on crutches.
2. **Golconda Piazza** (de Chirico and Magritte): long shadows, arcades with rails along their tops, a train on the horizon, and men in bowler hats raining from the sky.
3. **The Unwatched**, the boss: a giant eye on four impossible legs, animated with procedural two-bone IK stepping. You can only hurt it while you are *not* looking at it, and it only moves when you look away. Stare at it too long and it looks back. It attacks with orbs carrying your last three combos.

When you die, the dreamer wakes. A short, quiet vignette of their morning follows, and its details depend on how deep you got and which property you leaned on. Runs that go deep enough or strange enough leave behind a **memory**, which unlocks new properties and adds a new object to the dreamer's bedroom. The room fills in as the mystery does.

## How it's built

```
juxtapose/
  index.html, style.css      HUD and menus (DOM overlay)
  src/
    main.js                  boot, game loop, run structure, sandbox
    render.js                renderer, painted sky, PMREM IBL, soft shadows, light pool,
                             GTAO + bloom + ACES + "dream" grade pass (lucidity warp)
    physics.js               Rapier wrapper (fixed 60 Hz step, queries, groups)
    player.js                kinematic character controller + parkour, chase camera, the gun
    animator.js              two-layer animation (locomotion / upper-body overlays), procedural additives
    properties.js            the property system + Lucidity
    entities.js              props, walls, pickups, spawn catalogue
    destruction.js           Voronoi chunk swapping, debris, explosions, heavy impacts
    enemies.js / boss.js     sleepwalkers (porcelain shatter) and the Unwatched (IK legs)
    projectiles.js           rounds (ricochet, pierce, split), property orbs, enemy orbs
    level.js                 procedural dream layers from the Blender kit, rails, the bedroom
    vfx.js                   instanced billboard particles, decals, shockwaves
    audio.js                 generative, fully synthesized score + beat-quantized SFX
    ui.js, meta.js, input.js, config.js
  blender/
    build_figure.py          the player: model, armature, 32 procedural animation clips, export
    figure_anims.py          the animation library (run, sprint, strafe, slide, wall-run, mantle,
                             vault, flips, grind, ground-pound, reload, take/give...)
    build_props.py           every prop, the environment kit, enemies, boss, Voronoi-fractured walls
    render_previews.py       Cycles contact sheets -> docs/previews/
  assets/figure.glb, assets/props.glb
  vendor/                    three.js r170 (+ addons), Rapier 0.14 (compat build)
```

Rebuild the art with Blender's Python module (`pip install bpy==4.2.0`, Python 3.11):

```bash
python3 juxtapose/blender/build_figure.py            # add --preview for pose sheets
python3 juxtapose/blender/build_props.py
```

**Sound as structure.** The score is synthesized live with Web Audio: stems for pad, bass, music-box arpeggio, percussion and glass shimmer. It follows the chord progression of each layer, adds stems as combat intensifies, and warbles, drags and reverses as Lucidity rises. Weapon sounds snap to the 16th-note grid and are pitched to the current scale, so a good fight plays like a melody.
