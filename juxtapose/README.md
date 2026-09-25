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
| `F` | Palette-knife combo (three hits). A **deathblow** when the red mark shows. |
| `F` in the air while holding `C` (or looking down) | **Pogo**: strike down and bounce off whatever you hit |
| Right mouse | Tap to **deflect** (timed). Hold to **guard**. |
| `X` (hold) | **Focus**: spend reverie to heal and calm the dream |
| `Q` | **Take** a property from what you aim at |
| `E` / middle mouse | **Give** the selected property to what you aim at |
| `Z` | Give it to **yourself** |
| `G` | Load it into your **rounds** (up to three at once) |
| Wheel / `1`–`0` / hold `Tab` | Choose a property. `Tab` opens a slow-motion wheel. |
| `R` | Reload (break-open revolver) |
| `V` · `H` · `Esc` | Swap shoulder · help · pause |
| `P` | **Photo mode**: freeze the dream and fly a free camera. Adjust exposure, vignette, grain and FOV, then press `C` to save a PNG. |

**Parkour.** You can wall-run along walls, wall-jump off them, climb a wall by jumping straight at it, mantle up ledges up to 2.5 m, and speed-vault over low cover. Other moves:

- Slide, then slide-jump to keep your momentum.
- Air-dash.
- Ground-pound. It becomes a wall-breaking quake while you're heavy.
- Grind brass rails held up by Dalí crutches.
- Bounce on beds, which are trampolines.
- Blast-jump while you're bursting.
- Step through a pair of **framed** portals with your speed intact.

**Settings** cover field of view, camera shake, dream warp (motion comfort for the lucidity effects), film grain, reduce flashing, and HUD scale. They also cover subtitle size, Night-Light tips (the story lines always play), toggle or hold guard, auto-reload, and separate master, music and effects volumes. Everything applies live and has a reset.

**In-fight feedback:**
- Hit markers distinguish hits, heavy hits, kills, posture breaks and deflects.
- Damage arcs point to whoever hit you.
- Edge chevrons warn of off-screen perilous lunges and incoming orbs.
- A waypoint leads to the open door.
- A heartbeat vignette pulses when you're close to death.

## The five influences, and where they live

| Reference | In Juxtapose |
|---|---|
| **Hollow Knight** | The palette-knife combo. **Pogo** off enemies, props and the boss's knees. **Reverie** fills as you land hits and **Focus** turns it into health. **Keepsakes**, memories worn like charms in limited notches. Lore as **canvas scraps** hidden behind platforming, under shafts of light. |
| **Sekiro** | **Deflect** (tap) and **guard** (hold). Enemy **posture** bars fill from deflects, hits, pogos and explosions, and when one breaks it kneels for a **deathblow**. A red **危** marks a perilous lunge you have to jump or dash away from. The boss can be broken too, and its eye drops within reach. |
| **Doom** | Deathblows double as **glory kills**: they heal, pay out every property the enemy carried plus one more, and a burning kill leaves **armour**. There's no passive regeneration, so you heal by being aggressive (or by focusing). Staggered enemies yield extra charges when you take from them. |
| **Dead Cells** | Short runs down through three layers. Between layers you pick one of three **whims** (run upgrades). Memories are the meta-progression, and each one adds a property to the dream pool. |
| **Portal** | The **framed** property hangs gilt oval picture frames on surfaces. Two make a linked pair you can see and move through, and speed is conserved: fall into a floor frame and you're flung out of a wall. The **Night-Light** is the narrator, a candle in a jar with a dry voice who walks you through the rules. |

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
| Framed | Empty frame on an easel | Hangs a portal frame on a surface; two make a linked pair | Marks a return frame, and pressing Z again steps back through it | Every shot hangs a portal where it lands |

Properties interact through shared channels instead of hand-written pairs, so combinations emerge on their own:

- **Gravity:** floating plus heavy hover in place.
- **Heat:** burning makes melting three times faster and wakes sleepers.
- **Solidity:** hollow things only touch the ground and the sky.
- **Fuse:** a sleeping bomb is a mine, and burning shortens the fuse.
- **Explosion payloads:** a bursting, floating pomegranate makes everything in the blast float.

**A path through the dream.** The Soft Desert leads you rather than leaving you to wander.
- **The way in:** a steep drift ridge closes the village off from the north dunes, so you come in through the gate.
- **The order:** the market loggia, then the clock workshop, then the boathouse, then the station. The chapel is off to the side, for the curious.
- **Ink veils** hold you in one part of the village at a time. Each memory you take back unravels the next stretch.
- **A wisp** of light runs ahead to the next memory.

**Cutscenes.** They are letterboxed, captioned and skippable (Space, Escape or a click).
- **The prologue** plays on your first night and can be replayed from the title screen. It tells who is dreaming, who you are, what your gun does, and why the night ends when she wakes.
- **On arrival in a layer,** the dream shows you where you are.
- **Taking back a memory** shows it: the camera circles it while a translucent Figment acts it out. Then the next veils unravel, the next memory's column ignites, and at the end the door opens in the shallows.

**Memories and Clarity.** The anxieties don't come in waves. They guard *knots*: memories the dream has tangled up, each marked by a violet column of dusk and a waypoint.
- **In the desert:** the unfinished clock at the workshop, the Saturday pomegranate at the loggia, the Sunday candle at the chapel, the hat on the rack at the station, and the finch at the boathouse.
- **In the piazza:** four memories of the city he left for.
- **Guards:** they idle half-asleep around the knot until you come close, or until one of them is hit. The more lucid the dream, the more come to its defence.
- **Patrols:** pairs of anxieties walk beats through the streets between the memories, and turn on you when you cross their path. A lost patrol is replaced slowly, from out of sight.
- **Surges:** waves come only when something provokes them. Taking back the memory that opens the door, picking up a lore scrap, or pushing Lucidity past 50, 75 or 90 each makes the dream send them after you, with a warning first.
- **Freeing a memory:** silence its guards and walk into it. You get the memory's story back, a whim, and Clarity. Free three and the door opens.

**Clarity** is kept between nights. Every anxiety silenced adds to it, deathblows more, and freed memories and the boss most of all. Each rank is a small permanent perk, from *Stirring* (+10 Figment) to *Self-actualized* (deathblows mend more).

**Lucidity** rises with absurdity: stacking properties, new pairings, or giving things to yourself. Higher Lucidity makes every property stronger, warps the picture (FOV dolly zoom, chromatic smear, swirling sky, tempo drag in the score), and brings more anxieties. At 100 the dreamer wakes and the run ends.

## The story

You are the **Figment**, the wooden lay figure from *L'Homme au Chapeau*. Théo Vautrin began that painting in 1958 and abandoned it when he caught the 6:40 train and never came back. His sister **Odile**, a 78-year-old clock restorer, has kept it under a sheet for sixty years. You wake up inside her dreams, and each night you fight down toward the one thing she won't look at. The **Night-Light**, the candle she kept burning in the window, floats beside you and narrates.

The full story bible is in [`docs/STORY.md`](docs/STORY.md) and the character sheet renders are in [`docs/character/`](docs/character/). It contains spoilers.

## Run structure

1. **The Soft Desert** (Dalí): a fishing village half-buried in sand, modelled on Port Lligat. It sits in a valley closed by schist cliffs and opens south onto the sea. The layer stands for the time she let run down.
   - **Buildings you can enter:** Odile's clock workshop, cottages with roof terraces and Dalí eggs, a two-storey house, a chapel whose bell tower you can climb, a leaning watchtower, a boathouse, and a market loggia.
   - **The railway:** track comes out of a tunnel in the cliff, runs past the station where Théo caught the 6:40, and carries on into the sea. The train never stops.
   - **The sand is real.** It deforms, craters and avalanches under you, and fills back in over time.
   - **The rest of the dream:** melting clocks hang on dead trees on the beach, stairs float up toward the tower, grind rails run between the rooftops, and the way out is a door standing in the shallows.
2. **Golconda Piazza** (de Chirico and Magritte): long shadows, arcades with rails along their tops, a train on the horizon, and men in bowler hats raining from the sky. It is the city he left for, where every crowd was the same man.
3. **The Unwatched**, the boss: a giant eye on four impossible legs, animated with procedural two-bone IK stepping. You can only hurt it while you are *not* looking at it, and it only moves when you look away. Stare too long and it looks back. It attacks with orbs carrying your last three combos. Break its posture and it kneels for a deathblow.

When you die, the dreamer wakes. A short, quiet vignette of her morning follows, and its details depend on how deep you got and which property you leaned on. Runs that go deep enough or strange enough leave behind a **memory**. A memory unlocks a property, becomes a **keepsake**, and adds a new object to the dreamer's bedroom, so the room fills in as the mystery does. Nine **canvas scraps** reassemble the painting in the **Journal**. Beating the boss finishes it.

## How it's built

```
juxtapose/
  index.html, style.css      HUD and menus (DOM overlay)
  src/
    main.js                  boot, game loop, run structure, sandbox
    render.js                renderer, painted three-stop sky, PMREM IBL, soft shadows, light pool,
                             sun-scattered height fog, ink-edge shading for characters,
                             GTAO + bloom + ACES + "dream" grade pass (lucidity warp, near-death pulse)
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
    combat.js                posture/stagger, deathblow rules, world-space posture bars and marks
    portals.js               framed portals: placement, render-to-texture views, momentum transfer
    narrator.js              the Night-Light: companion lantern, typed subtitles, babble voice
    painting.js              L'Homme au Chapeau drawn procedurally (torn / finished)
    town.js                  places the Blender town kit: box/trimesh colliders, SLOT_* props, breakable panels, lamp lights
    sand.js                  deformable sand: tiled heightfield colliders, craters, trails, avalanches, sand spray
    sea.js                   the sea: layered ripples, sky reflection, shallows and foam
    photo.js                 photo mode: frozen sim, free camera, exposure/vignette/grain, PNG capture
    ui.js, meta.js, input.js, config.js
  blender/
    build_figure.py          the player: model, armature, 42 procedural animation clips, export (--sheet renders the character sheet)
    character_sheet.py       Cycles hero portrait, turnaround, moveset and gun renders -> docs/character/
    figure_anims.py          the animation library (run, sprint, strafe, slide, wall-run, mantle,
                             vault, flips, grind, ground-pound, reload, take/give...)
    build_props.py           every prop, the environment kit, enemies, boss, Voronoi-fractured walls
    render_previews.py       Cycles contact sheets -> docs/previews/
    texlib.py                tileable PBR texture library (stucco, plaster, stone, terracotta, roof tile,
                             painted wood, oak, schist, marble, sandstone, iron) -> assets/tex/
    build_town.py            the village kit: nine enterable buildings with interiors, colliders and
                             SLOT_* markers, baked ambient occlusion -> assets/town.glb
    pack_glb.py              post-export: moves the AO bake into COLOR_0, quantizes normals, strips colliders
    render_town.py           Cycles previews of the kit -> docs/previews/town_*.png
    build_street.py          street dressing: well, lamps, benches, carts, garden walls, gate, boats,
                             cypresses, olives, Dalí eggs -> assets/street.glb
    render_street.py         Cycles contact sheet of the street props -> docs/previews/street_props.png
  assets/figure.glb, assets/props.glb, assets/town.glb, assets/street.glb, assets/tex/
  vendor/                    three.js r170 (+ addons), Rapier 0.14 (compat build)
```

Rebuild the art with Blender's Python module (`pip install bpy==4.2.0`, Python 3.11):

```bash
python3 juxtapose/blender/build_figure.py            # add --preview (poses), --combat (combat poses), --sheet (character sheet)
python3 juxtapose/blender/build_props.py
python3 juxtapose/blender/texlib.py           # textures first: the kit and props use them by name (TX_<name>)
python3 juxtapose/blender/build_town.py      # exports, packs and verifies assets/town.glb
python3 juxtapose/blender/build_street.py    # imports build_town's helpers; exports assets/street.glb
```

Hosts that won't serve binary `.glb` files can serve `<name>.glb.gz.b64.txt` instead (`gzip -9 -n -c x.glb | base64 -w0`): the loader falls back to it, and to plain `<name>.glb.b64.txt` after that. Gzip takes the town kit from 10.5 MB to about 2.5 MB.

**Sound as structure.** The score is synthesized live with Web Audio: stems for pad, bass, music-box arpeggio, percussion and glass shimmer. It follows the chord progression of each layer, adds stems as combat intensifies, and warbles, drags and reverses as Lucidity rises. Weapon sounds snap to the 16th-note grid and are pitched to the current scale, so a good fight plays like a melody.

**Keeping it smooth.**
- **Draw calls:**
  - Each kit building's hundred-odd pieces are merged by material the first time it is placed, and only the big pieces cast sun shadows.
  - Props beyond view distance are hidden.
  - The Figment's 57 rigid parts are drawn as one skinned mesh per material. They still ride their bones, and animation is unaffected.
- **No shader stalls in a fight:** every shader a fight can need is compiled while each layer fades in. That covers enemies, debris, rings, decals, and the see-through and melting variants of every material. The warm-up compiles against the post chain's render target, because that target selects different shader variants than the canvas. Ring and decal materials are pooled rather than disposed, so a compiled program is never thrown away and rebuilt mid-fight.
- **Crash handling:** quality defaults to what the GPU can handle, a lost WebGL context is recovered one quality step lower, and a frame that keeps failing shows its error instead of freezing silently.
