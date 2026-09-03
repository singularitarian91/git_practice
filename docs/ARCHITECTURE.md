# Hearthmoor — Milestone 1 Architecture Proposal

**Status: PROPOSAL — waiting for go-ahead.** Nothing in the Unity project is built yet.
Written 2026-09-03. This doc is the standing reference; it gets updated at each milestone.

---

## 0. How we'll work (read this first)

I can write every line of C#, every data-asset definition, the folder layout, git config, and
editor tools. What I can't do from here is open the Unity Editor: I can't press Play, wire up a
scene by clicking, or see your screen. So the loop is:

1. I write code + data + a short, numbered Editor checklist, and push to this repo.
2. You pull, open Unity, follow the checklist, press Play.
3. You tell me what feels wrong — "the dodge feels late", "enemies fly too far" — and I change
   numbers or code.

To keep step 2 tiny, I'll:

- put almost every tunable number in data assets you edit in the Inspector (no code edits to tune);
- write editor menu items (`Tools ▸ Hearthmoor ▸ …`) that create the default assets, prefabs and
  the test scene for you, so you're not hand-building 30 things by clicking;
- build a debug overlay so you can *see* what the combat system is doing (which frame of which
  move, when hitboxes are live, stamina, poise).

## Assumptions (tell me if any are wrong)

- Unity 6 LTS (6000.x) with URP, Cinemachine 3, Input System 1.x. (2022.3 LTS would mostly work
  too; Cinemachine component names differ.)
- Single-player, no networking — this keeps the combat simulation simple.
- PC first; gamepad and keyboard/mouse both supported from day one.
- This repo becomes the Unity project's repo (Unity project root = repo root). See §10.

---

## 1. Project structure

```
Hearthmoor/                     ← Unity project root = git repo root
├─ Assets/
│  ├─ _Hearthmoor/              ← EVERYTHING we make lives here. Third-party assets go elsewhere.
│  │  ├─ Code/
│  │  │  ├─ Runtime/            ← game code (one assembly: Hearthmoor.Runtime)
│  │  │  │  ├─ Core/            ← bootstrap, CombatClock (hitstop / slow-mo), layers, shared helpers
│  │  │  │  ├─ Input/           ← input actions wrapper + the input buffer
│  │  │  │  ├─ Actors/          ← the shared "actor stack": motor, state machine, stamina, health, poise
│  │  │  │  ├─ Combat/          ← moves, movesets, hitboxes, hurtboxes, damage funnel, knockback maths
│  │  │  │  ├─ Feel/            ← hitstop, camera shake, VFX/SFX hooks (juice, kept apart from rules)
│  │  │  │  ├─ AI/              ← enemy senses + brains
│  │  │  │  ├─ World/           ← day/night clock, time-of-day lighting driver, dusk spawner
│  │  │  │  ├─ View/            ← the art/logic bridge (placeholder view now, animator view later)
│  │  │  │  └─ UI/              ← debug HUD, health/stamina bars
│  │  │  ├─ Editor/             ← editor-only tools (Hearthmoor.Editor): asset generators, gizmos, inspectors
│  │  │  └─ Tests/              ← automated checks of the combat maths (Hearthmoor.Tests)
│  │  ├─ Data/                  ← ScriptableObject assets = the game's "spreadsheets"
│  │  │  ├─ Moves/              ← one asset per attack (Sword_Light1, Sword_Launcher, Rusher_Bite …)
│  │  │  ├─ MoveSets/           ← which button + direction → which move (Sword, Rusher, Shieldbearer)
│  │  │  ├─ Actors/             ← per-character stats (Player, Rusher, Shieldbearer)
│  │  │  ├─ Feel/               ← hit-feedback profiles (light hit, heavy hit, launch, parry)
│  │  │  └─ World/              ← time-of-day profile (light colours, fog, sky across 24 h)
│  │  ├─ Prefabs/
│  │  │  ├─ Player/
│  │  │  ├─ Enemies/
│  │  │  ├─ Greybox/            ← placeholder world pieces
│  │  │  └─ VFX/
│  │  ├─ Art/                   ← meshes, materials, textures, animations, shaders. Swappable.
│  │  │  ├─ Placeholder/        ← capsules, flat colours. Deleted when real art lands.
│  │  │  ├─ Characters/
│  │  │  ├─ Environment/
│  │  │  └─ Shaders/            ← cel / painterly shader graphs (end of M1)
│  │  ├─ Audio/
│  │  ├─ Scenes/
│  │  │  ├─ Sandbox_Combat      ← flat arena + training dummies. Where 80 % of M1 tuning happens.
│  │  │  └─ M1_Homestead        ← greybox homestead + forest patch
│  │  ├─ Settings/              ← URP assets, renderer features, post-processing volumes, quality tiers
│  │  └─ Input/                 ← Hearthmoor.inputactions
│  ├─ ThirdParty/               ← asset-store / external packages (never edited by us)
│  └─ Plugins/
├─ Packages/                    ← package manifest (URP, Cinemachine, Input System, Test Framework …)
├─ ProjectSettings/
├─ docs/                        ← design docs like this one
├─ .gitignore  .gitattributes   ← Unity-specific; Git LFS for big binaries
└─ README.md
```

**Why this shape**

- **One `_Hearthmoor` folder.** The underscore sorts it to the top, and it means "if it's not in
  here, we didn't write it." Asset Store packages love to dump folders at the top level; this keeps
  them from mixing with ours.
- **Code is split by *system*, not by *type*** (no `Scripts/Managers`, `Scripts/Controllers`).
  When something's wrong with dodging, everything about dodging is in one place.
- **Only three assemblies** (Runtime, Editor, Tests). Assembly definitions make Unity recompile
  only what changed — a big iteration-speed win — but too many of them create confusing
  "can't see that type" errors. Three is the sweet spot for a project this size.
- **Data lives beside code, not inside prefabs.** Every attack, enemy and feel profile is a
  ScriptableObject asset you can open and tune. Prefabs just *reference* the data.
- **Art is quarantined.** `Art/Placeholder` gets deleted later without touching a line of code.
  How that works is in §7.

### Project hygiene we set up on day one

- **Git:** Unity `.gitignore`; `.gitattributes` routing `.png .fbx .wav .psd .blend …` through
  **Git LFS**; Unity's **Smart Merge** (`UnityYAMLMerge`) so scene/prefab merges don't corrupt.
  Project Settings ▸ Editor: *Visible Meta Files* + *Force Text* (default in Unity 6; we confirm).
- **Editor speed:** Enter Play Mode Options with *Reload Domain* off — turns the 5–10 s wait when
  pressing Play into ~0.5 s. Costs one coding discipline (no static state that assumes a fresh
  start), which I'll follow.
- **Physics layers** defined once as constants: `Player`, `Enemy`, `PlayerHitbox`, `EnemyHitbox`,
  `Hurtbox`, `Ground`, `Climbable`, `Water`, `Interactable`, `Projectile`. The collision matrix is
  set so hitboxes only ever "see" hurtboxes.
- **Timing:** physics at 60 Hz; game logic runs per-frame with all combat timings *authored in
  frames at 60* (explained in Decision C).

---

## 2. The big decisions (plain English)

These are the choices that are expensive to change later. Each one: what I'm proposing, why, and
what we're *not* doing.

### Decision A — The player and the enemies are the same kind of thing

**Proposal.** One "actor stack" — Motor + State Machine + Health/Stamina/Poise + Combat + View —
used by the player *and* every enemy. The only difference is who feeds it inputs: a human with a
gamepad, or an AI brain producing fake stick-and-button presses.

**Why.** You asked for enemies that get juggled, staggered, parried, launched and hit midair — all
things that happen to the *player* too. If enemies and the player share one system, knockback,
hitstun, launching and stagger are written once and behave identically. Enemy attacks also get
real telegraph/active/recovery frames for free, using the exact same move data as your sword.

**Not doing.** Separate `PlayerController` and `EnemyController` scripts that slowly diverge.
That's the most common way action-game codebases rot.

### Decision B — Movement runs on a hand-written kinematic motor, not Rigidbody physics

**Proposal.** Characters are moved by our own code every frame ("kinematic", built on Unity's
`CharacterController`); Unity's physics only tells us what we bumped into. Knockback and launches
are velocities we set explicitly and simulate with our own gravity.

**Why.** Smash, Zelda and every Souls-like do this. Physics-driven characters feel floaty, fight
with slopes, and make precise frame-based combat impossible. A kinematic motor gives total control:
exact jump heights, exact launch arcs, exact landing frames. Climbing and gliding are just
different rules for the same motor.

**Cost.** Characters don't automatically shove physics objects (crates, boulders). We add that
explicitly when M3's physics sandbox arrives — a small, well-understood piece of code. A boulder
rolling *into* the player works fine already (the boulder is a Rigidbody; the player reacts to
being hit).

**Escape hatch.** The motor is one file. If we outgrow it, the paid *Kinematic Character
Controller* asset is the standard upgrade and slots in behind the same interface.

### Decision C — Timings are authored in frames (at 60/s), and one clock owns time

**Proposal.** A move is described the way fighting-game designers describe it: "startup 6 frames,
active 8–11, recovery to 24, can cancel into Heavy from frame 14." Internally we convert frames to
seconds so the game runs at any framerate. One `CombatClock` hands out the time delta every
gameplay system uses, so **hitstop** (freezing both fighters for 4 frames on impact) and
**perfect-dodge slow-mo** are one line each: "clock, freeze 4", "clock, run at 0.25× for 60".

**Why.** "Smash Bros feel" is mostly *timing*, and frames are the language for tuning it. A single
clock means hitstop can't desync systems (the classic bug where the camera keeps moving while the
fight freezes).

**Not doing.** Fully deterministic fixed-tick simulation with visual interpolation. That's what
real fighting games do for rollback netcode. We're single-player; it would double the complexity
for no gain.

### Decision D — Hitboxes are data and physics *queries*, not colliders

**Proposal.** Each move lists its hitboxes as shapes in data ("sphere, radius 0.6, at socket
WeaponTip, active frames 8–11"). On active frames we ask Unity "which hurtboxes overlap this sphere
right now?", sweeping between last frame's and this frame's position so fast swings can't tunnel
through enemies.

**Why.** Trigger colliders that toggle on and off are timing-bug magnets (they fire a frame late,
stay on, miss when both objects are moving). Queries are exact, draw perfectly as debug gizmos, and
make "one move hits each target once" trivial. They also work with capsule placeholders that have
no bones yet — hitboxes attach to named *sockets*, and the placeholder just has sockets at sensible
positions.

### Decision E — Knockback grows with poise damage (Smash's percent, remapped to stagger)

**Proposal.** Every hit deals *health* damage and *poise* damage.
`knockback = base + growth × poiseLostSoFar`. While an actor still has poise, hits mostly stagger
them in place; once poise breaks they **launch**, become juggle-able, and stay vulnerable until they
recover. Poise regenerates when not being hit. Heavy attacks and the Light-Light-Heavy launcher deal
big poise damage.

**Why.** This is *exactly* Smash's "knockback grows with percent" — the thing that makes juggling
work — disguised as an action-RPG stagger meter, which gives you the stagger states and the
readable Zelda "he's open, go" moment. Light enemies (Rusher) have low poise and fly early; the
Shieldbearer has high poise and must be worn down or parried.

### Decision F — Animation follows the code; it never drives it

**Proposal.** The state machine decides what a character is doing; the *View* (mesh + animator +
VFX) just listens and shows it. A move's hit frames live in the move asset, not in animation events.

**Why.** You'll be swapping placeholder capsules for Blender/Meshy models. If gameplay depended on
animation clips, every swap would break combat. This way the capsule version and the final model
play *identically* — the model just looks better. It also means we build and tune the whole combat
system in M1 with zero animations.

### Decision G — Unity's own tools where they're good; no third-party frameworks

**Proposal.** Cinemachine 3 for the camera, the Input System for controls, ScriptableObjects for
data, the Test Framework for maths checks. No behaviour-tree assets, no event-bus assets.

**Why.** Cinemachine gives us a polished third-person orbit camera, lock-on framing, and *impulse*
(screen shake) in an afternoon instead of a fortnight. Input System gives gamepad + keyboard
rebinding for free. Avoiding big third-party frameworks keeps every line of the project something I
can explain to you.

---

## 3. Movement architecture

### The actor stack (every character has this)

```
   Player: gamepad / keyboard ─→ InputBuffer ─┐
   Enemy:  AI brain ─→ "virtual gamepad"     ─┤
                                              ▼
  ┌──────────────────────── ActorStateMachine ──────────────────────────┐
  │ Grounded · Airborne · Climb · Glide · Dodge · Attack · Hitstun ·     │
  │ Launched · Stagger · Guard · Dead                                    │
  └───────────┬───────────────────────┬──────────────────────┬──────────┘
              ▼                       ▼                      ▼
       KinematicMotor            Combat                  Resources
       move · slopes ·           moves · hitboxes ·      Health · Stamina · Poise
       gravity · knockback       damage funnel
              │                       │                      │
              └───────────── events ──┴──────────────────────┘
                                      ▼
                     ActorView  (placeholder capsule now; animator + real model later)
```

**ActorStateMachine.** One "current state" object at a time; each state is a small class with
`Enter / Tick / Exit` and a list of what it's allowed to change into. M1 states:

| State | What it does | Leaves via |
|---|---|---|
| Grounded | Run, sprint, turn, idle. Coyote time: you can still jump for 6 frames after walking off a ledge. | jump → Airborne · attack → Attack · dodge → Dodge · wall + push → Climb · hit → Hitstun |
| Airborne | Jump/fall with variable height (release early = shorter). Aerial attacks allowed. | land → Grounded · hold jump → Glide · wall → Climb |
| Climb | Sticks to any surface steeper than ~50° on the Climbable layer, moves along it, drains stamina per second, mantles ledges. Rain later multiplies drain and adds slip. | stamina 0 or jump → Airborne · top → Grounded (mantle) |
| Glide | Reduced gravity, forward drift, steerable, slow stamina drain. | land, stamina 0, or release |
| Dodge | Fixed-length roll/dash, invulnerable frames 1–10, direction locked at start. Cancels attacks inside their cancel window. | ends → Grounded / Airborne |
| Attack | Plays a Move: counts frames, applies authored root motion, runs hitboxes on active frames, reads the InputBuffer during cancel windows for the next combo step. | cancel / finish / hit |
| Hitstun | Frozen for N frames after a hit (no control). Short knockback. | timer → Grounded |
| Launched | Airborne from a big hit; can be hit again (juggle); no control until recovery. | lands → Stagger or Grounded |
| Stagger | Poise broken: long, vulnerable stumble. | timer → Grounded |
| Guard | Shield up. Hits are blocked (chip damage, stamina cost). First 8 frames = parry window. | release |
| Dead | Fall + despawn / respawn. | — |

**KinematicMotor.** The one piece that moves the body. Takes a desired velocity from the current
state; handles ground detection, slope sliding, step-up, gravity, and an *impulse* channel for
knockback that decays over time. Player and enemies use the same one.

**Stamina.** One component, one meter that climbing, gliding, sprinting and dodging draw from.
Shrines in M3 just raise `maxStamina`. (Whether attacks cost stamina is an open question, §10.)

**InputBuffer.** Every button press is stored with a timestamp for ~10 frames. States *consume*
presses from it. This is why pressing attack a few frames early during a swing still chains — the
invisible secret of games that feel responsive.

**Camera.** Cinemachine 3: a free-look orbit camera by default; on lock-on, a *target group*
camera that frames player + enemy. An impulse source for shake, driven by the Feel layer. The camera
never touches gameplay code.

---

## 4. Combat architecture

### Data: `Move` — one asset per attack

```
Sword_Light2   (a ScriptableObject)
  totalFrames     22
  hitboxes        [ { shape: sphere, radius 0.55, socket: WeaponTip, active: 7–10,
                      damage 8, poiseDamage 12, knockbackBase 4, knockbackGrowth 0.6,
                      angle 30°, hitstun 12, hitstop 3, element: none, launches: false } ]
  rootMotion      curve: 1.2 m forward over frames 3–9   (works with no animation at all)
  cancelWindows   [ { frames 12–22 → Light, Heavy, Dodge, Jump },
                    { frames 16–22 → Guard } ]
  input           Light · direction Neutral · context Grounded · comboStep 2
  view            animation "Sword_Light2" · trail on · swing SFX at frame 5
```

### Data: `MoveSet` — one per weapon or enemy type

A table: **(button, stick direction, grounded/airborne, combo step) → Move**. The sword gets:
Light ×3 chain · Forward+Light lunge · Up+Light uppercut · Down+Light sweep · Heavy (chargeable) ·
Forward+Heavy thrust · Light-Light-Heavy **launcher** · Air Light · Air Down+Heavy plunge.
Hammer and spear later are *just new MoveSet assets* — no new code.

### Runtime flow of one swing

1. The `Attack` state starts a Move, frame counter at 0.
2. Each frame: apply the root-motion curve to the motor; if inside an active window,
   `HitboxRunner` runs one overlap query per hitbox, skipping targets this move already hit.
3. A hit produces a `HitInfo` (attacker, move, hitbox, contact point, direction, element …) and
   calls **`Damageable.ReceiveHit(HitInfo)`** on the target — the *single funnel* every point of
   damage in the game passes through.
4. `Damageable` decides: parried? blocked? invulnerable (dodge i-frames)? Then applies health and
   poise damage, works out knockback (Decision E), asks the target's state machine to enter
   Hitstun / Launched / Stagger, and raises an `OnHit` event.
5. The **Feel** layer hears `OnHit` and does the juice: hitstop on both actors via `CombatClock`,
   camera impulse, hit VFX, SFX, controller rumble — using a `HitFeedbackProfile` asset (light /
   heavy / launch / parry / blocked) so you can tune the punch without touching the rules.
6. Meanwhile the `InputBuffer` is watched during cancel windows; a buffered press that's allowed in
   the window starts the next Move immediately — that's a combo.

### Defensive options

- **Dodge.** 10 invulnerable frames from data. If a hitbox *would have* hit during frames 1–6 →
  **perfect dodge** → `CombatClock` at 0.25× for 60 frames; the player's next attack is tagged
  "flurry" (faster cancels, bonus poise damage). Costs a little stamina.
- **Guard / Parry.** Shield up = Guard state. A hit inside the first 8 frames = **parry**: attacker
  staggered, projectiles reflected (the projectile's owner is swapped and its velocity mirrored).
  After 8 frames it's a plain block: chip damage, stamina drain, no parry.
- Enemies use the same `Damageable`. The Shieldbearer literally holds Guard when facing you.

### Elements — prepared in M1, built in M3

`HitInfo.element` exists from day one and `Damageable` has one hook for element reactions. In M3
the physics system subscribes to that hook (fire → ignite grass; ice → freeze water). Nothing in
combat changes then.

---

## 5. Enemy AI — two types for M1

Enemies use the *same* actor stack; the brain just produces fake stick/button inputs plus a chosen
Move. Sensors (sight cone with line-of-sight, hearing radius, "last seen" memory) feed a small
state machine:

```
Idle / Patrol ─(sees player)→ Alert → Chase ─(in range)→ pick a Move → Attack → Recover / Reposition → Chase …
any state ─(hit)→ Hitstun / Launched / Stagger → back to Chase        │        Dead
```

- **Rusher** — fast, low health, low poise. Lunge bite with an 18-frame windup (the telegraph).
  Circles you while you're mid-attack. Flies satisfyingly when launched. Teaches the combo system.
- **Shieldbearer** — slow, high poise, holds Guard while facing you, shield-bash attack. Only takes
  real damage from behind, from a launcher once its poise is broken, or when parried. Teaches heavy
  attacks, positioning and parry.

Telegraphs are just the Move's startup frames with a *view* cue (a flash or colour shift on the
placeholder, an animation later). Every enemy attack is tuned in the same Move assets as the
player's.

---

## 6. Day/night and the lighting hook

- `WorldClock` — normalised time of day (0–1), day length in real minutes (default 20), events at
  dawn / dusk / midnight. Everything else *reads* this; nobody else keeps time.
- `TimeOfDayProfile` (data asset) — gradients and curves across the 24 h: sun colour / intensity /
  angle, moon, ambient, fog colour and density, skybox blend, post-processing weight.
- `TimeOfDayDriver` — reads clock + profile and sets lights / fog / volumes every frame.
- `DuskSpawner` — listens for dusk and wakes the forest's spawn points; dawn despawns stragglers.

This is why the lighting pass can come *last*: the code is done early, and the end-of-M1 pass is
painting curves in the profile, writing the cel/painterly shader, and tuning the URP volume (bloom,
colour grading, SSAO).

**One honest flag:** URP has no built-in volumetric fog or god rays (HDRP does). We'll get the
Valheim look with either a fog-shaft render feature I write or a small third-party asset; I'll bring
options at the lighting pass. Staying on URP is still the right call for stylized art and
performance.

---

## 7. Art/logic separation — your placeholder → real-asset swap

Every character prefab is two halves:

```
Player (prefab)
├─ [logic root]  CharacterController, KinematicMotor, ActorStateMachine, Health, Stamina, Poise,
│                Damageable, HitboxRunner, PlayerInputReader        ← no meshes, no materials
├─ Hurtboxes     simple colliders on the Hurtbox layer
├─ Sockets       empty transforms: WeaponTip, Hand_R, Chest, Head   ← hitboxes attach here
└─ View          ← the ONLY thing you replace
   └─ PlaceholderActorView   capsule + cone "nose"; squash/stretch on jump, colour flash on hit,
                             tint during telegraphs, a trail on swings.   implements IActorView
```

`IActorView` has a handful of calls — `PlayMove(move)`, `SetLocomotion(speed, grounded)`,
`OnHit(info)`, `SetGuard(bool)` … When your Blender model arrives we add an `AnimatorActorView`
that implements the same calls with real animations, drop it in as the new `View` child, and
re-point the sockets to bones. Nothing under the logic root changes.

---

## 8. Debug tooling — a real M1 deliverable, not a nice-to-have

- **Frame HUD:** current state, move name + frame number, an ACTIVE badge while hitboxes are live, a
  cancel-window indicator, stamina / poise numbers, current clock speed.
- **Gizmos:** hitboxes (red while active), hurtboxes, ground probe, climb probe — drawn in the
  Scene view during Play.
- **Frame step:** a key to pause and advance one frame at a time. The single most useful tool for
  tuning feel.
- **Training dummy:** an actor with no brain; toggles for infinite poise / no poise /
  attacks-back-every-3-s.
- **Automated tests** for the maths (knockback formula, cancel windows, buffer expiry, frames ↔
  seconds) so tuning changes can't silently break the rules.

---

## 9. Milestone 1 build order

Each step ends with something you can press Play on.

1. **Skeleton** — folders, assemblies, git/LFS, packages, layers, input actions, `Sandbox_Combat`
   scene, `Tools ▸ Hearthmoor ▸ Setup Project`.
2. **Move** — motor, Grounded/Airborne, camera, sprint, jump, coyote time, stamina meter + HUD.
3. **Climb & glide** — Climb/Glide states, stamina drain, mantle, glider cloak.
4. **Hit things** — Move/MoveSet data, HitboxRunner, Damageable funnel, training dummy, gizmos,
   frame HUD, frame step.
5. **Combos & defence** — light chain, directional variants, launcher, aerials, input buffer,
   dodge / i-frames, perfect-dodge slow-mo, guard / parry.
6. **Weight** — poise & knockback growth, Launched/Stagger states, juggling, hitstop, camera impulse,
   feedback profiles. *(The "does it feel like Smash yet?" step — expect several tuning rounds.)*
7. **Enemies** — sensors, brain, Rusher, Shieldbearer, telegraphs, death.
8. **Day/night** — WorldClock, profile, driver, dusk spawner.
9. **Homestead & forest greybox + lighting pass** — layout, landmarks, cel/painterly shader, post
   volume, fog / god-ray solution, wind on placeholder foliage.

---

## 10. Open questions before I start

1. **Where does the Unity project live?** Recommended: this repo *is* the Unity project (repo root
   = project root). It currently holds a couple of unrelated practice files (`README.txt`,
   `visualizer.html`) — OK to remove?
2. **Unity version?** Assumed Unity 6 LTS (6000.x).
3. **Do attacks cost stamina?** BOTW: no (only special moves). Valheim: everything does. For
   "Smash feel" I recommend **no** — attacks free, dodge costs a little, climbing / gliding /
   sprinting cost stamina. Combat stays fast; exploration stays tense.
4. **Lock-on style?** Zelda soft-lock (camera frames the target, you still move freely) vs. Souls
   hard-lock (you strafe around them). Recommend Zelda-style — it suits Smash-like mobility.

---

## 11. Risks I want you to know about now

- **Feel takes iteration.** Steps 5–6 will need several rounds of "try it, tell me." That's
  normal — it's the whole game.
- **URP volumetrics** — see §6.
- **Animation later.** When real models arrive, moves keep their frame data, but you'll want
  animations authored to match (a 22-frame swing needs a ~22-frame clip). I'll export a "frame
  sheet" per move so an animator (or you in Blender) has the numbers.
- **Seamless open world** needs streaming / LOD work eventually. Not in M1 — the greybox is small —
  but the folder layout and the WorldClock are built so nothing has to be torn out when we get
  there.
