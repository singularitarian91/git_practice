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
| □ | Light attack (6-hit string) |
| △ | Charge attack C1–C6, depending on how many lights landed first |
| ✕ | Dash / evade (i-frames). Hold to sprint |
| ○ | Overdrive (Musou) when the gauge is full |
| R1 / L1 | Lock-on / cycle target |
| L2 | Guard. A perfectly timed guard reflects bullets |
| R2 | Blade Dash toward the lock-on target |
| D-pad ↑ | Stim (heal one segment, 3 per run) |
| D-pad ← → | Switch stance: Ronin / Reaper / Wire |
| D-pad ↓ | Taunt (staggers nearby grunts, builds Musou) |
| Options | Pause (input test, remap wizard, volume, restart) |
| Share | Debug overlay and tuning panel |
| L3 / R3 | Sprint lock / reset camera |
| Touchpad | Toggle minimap size |

If a browser reports a non-standard layout (some Bluetooth setups on Linux/Firefox), a remap wizard runs before the game starts and the mapping is saved in the browser.

Keyboard: `WASD` move, `J` light, `K` charge, `Shift` dash, `L`/`Space` Overdrive, `Q` lock, `E` cycle, `Ctrl` guard, `F` blade dash, `1` stim, `Tab` stance, `T` taunt, `Esc` pause, `` ` `` debug, `M` mute. Mouse drag orbits the camera.

### Structure

Four sectors along one street: Streets (waves + officer), Plaza (KIRIN-9), Overpass (LADY OBSIDIAN), Data Cathedral (THE CHOIR). Each boss has a three-segment health bar; emptying a segment triggers a phase transition with a new moveset and arena change.

### Credits

Littlest Tokyo by Glen Fox (CC-BY 4.0). KayKit Adventurers and Skeletons character packs by Kay Lousberg (CC0). RobotExpressive, Soldier, Michelle, PrimaryIonDrive, DamagedHelmet and the spaceship hallway from the three.js examples. Post-processing by pmndrs, audio synthesized with Tone.js.
