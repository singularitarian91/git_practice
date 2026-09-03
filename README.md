# git_practice

## NEON DYNASTY (`index.html`)

A Dynasty Warriors–style crowd brawler with a cyberpunk skin, in a single HTML file. Real rigged glTF characters stream from public CDNs (KayKit CC0 packs, three.js example models, the Littlest Tokyo diorama), with procedural fallbacks so the game still runs offline. Built from `CYBERPUNK_WARRIORS_PROMPT.md`.

### Run

Open `index.html` in Chrome or Edge. Everything loads from jsDelivr, so the file works straight from disk; if a model fails to load you get a labelled fallback figure instead of a crash.

For local model overrides, serve the folder (`npx serve` or `python -m http.server`) and add `assets/manifest.json` mapping asset names to your own GLB files, for example `{ "rogue": "assets/my_samurai.glb" }`. Asset names are listed in `ASSET_LIST` near the top of the script.

Add `?lowfx` to the URL for weaker machines: no planar reflections or shadows, less rain, 1x pixel ratio.

### DualShock 4

Connect by USB or Bluetooth, press any button on the title screen. Chrome and Edge expose the pad with the standard mapping; the HUD switches to PlayStation glyphs and rumble is enabled automatically.

| Button | Action |
|---|---|
| Left stick | Move (walk/run by stick magnitude) |
| Right stick | Orbit camera |
| □ | Light attack (6-hit string; fast unarmed jabs while the blade is thrown) |
| △ | Charge attack C1–C6, depending on how many lights landed first. Recalls the blade if it's out |
| ✕ | Roll: invincible for the first two thirds, vulnerable recovery after. Hold to sprint |
| L2 | Guard. Tap as an enemy's white flash lands to **deflect**; hold to block. Red attacks break guard, so roll them |
| R2 | Blade throw / recall. Reaper stance sticks it in the target and bleeds it; Wire stance lashes and pulls a line of enemies |
| L1 | Blade Dash toward the lock-on target (unlocked after the first officer) |
| R1 / R3 | Lock-on / cycle target |
| ○ | Overdrive (Musou) when the gauge is full |
| D-pad ↓ | EMP bomb: arcing grenade, big blast, stuns robots, hammers boss posture |
| D-pad ↑ | Stim (heal one segment) |
| D-pad ← → | Switch stance: Ronin / Reaper / Wire |
| Options | Pause (input test, remap wizard, volume, restart) |
| Share | Debug overlay and tuning panel |
| L3 | Sprint lock |
| Touchpad | Toggle minimap size |

**Combat rhythm.** Every enemy swing shows a cue over the attacker: cyan `!` means deflectable, red `!!` means perilous. The attacker flashes white on the deflect frame. A deflect costs you nothing, cracks the attacker's posture, and keeps your combo alive. Break their posture and they kneel with an amber marker; the next hit is a deathblow (instant on grunts, a large chunk on officers, 15% of the current segment on a boss). Enemies are open to bonus "punish" damage right after they swing. Rolling through an attack at the right moment triggers a slow-motion slip.

If a browser reports a non-standard layout (some Bluetooth setups on Linux/Firefox), a remap wizard runs before the game starts and the mapping is saved in the browser.

Keyboard: `WASD` move, `J` light, `K` charge, `Shift` roll, `Ctrl` deflect/guard, `G` throw/recall, `B` bomb, `L`/`Space` Overdrive, `Q` lock, `E` cycle, `F` blade dash, `1` stim, `Tab` stance, `T` taunt, `Esc` pause, `` ` `` debug, `M` mute. Mouse drag orbits the camera.

### Story

Kōgen District, 2099. Meridian Corp's civic AI, THE CHOIR, has begun broadcasting a hymn through every implant in the district; anyone who listens stops being themselves. You play SABLE, an ex-Meridian blade whose partner Ilse Varga went into the Cathedral to stop it and came out singing. WREN, a netrunner, burned your link before the hymn reached it and rides comms while you cut through the district. Story is delivered through intro and epilogue cards, in-game comms triggered by what you do, and boss exchanges (KIRIN-9 is the mech that ended the Ward Nine riots; LADY OBSIDIAN is Ilse).

### Structure and progression

Four sectors along one street: Streets (waves, then an officer), Meridian Plaza (KIRIN-9), the Overpass (destroy three Choir relays, two officers, LADY OBSIDIAN), the Data Cathedral (THE CHOIR). Each boss has a three-segment health bar; emptying a segment triggers a phase transition with a new moveset and arena change.

You start with the light string, charges C1–C3, dash, guard, Overdrive, and one stance. Abilities unlock as the story does:

- First officer down: **Blade Dash** (homing strike on the lock-on target).
- KIRIN-9 down: **Reaper stance** and charge finishers **C4–C5**.
- LADY OBSIDIAN down: **Wire stance** and **C6**.

Kills feed a **SYNC** level (10 levels) that raises damage and Overdrive gain. After each sector an uplink offers a choice of one of three **augments** (chain-reaction kills, a sixth health segment, a cutting dash trail, wave projectiles on the string finisher, faster Overdrive, and more), so each run builds differently. Stims start at one and grow by one per sector.

### Credits

Littlest Tokyo by Glen Fox (CC-BY 4.0). KayKit Adventurers and Skeletons character packs by Kay Lousberg (CC0). RobotExpressive, Soldier, Michelle, PrimaryIonDrive, DamagedHelmet and the spaceship hallway from the three.js examples. Post-processing by pmndrs, audio synthesized with Tone.js.
