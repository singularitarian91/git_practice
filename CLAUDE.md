# Hearthmoor — notes for Claude Code sessions

Read this before touching anything. It is the memory that survives between sessions.

## Who you are working with

- The project owner is **not a programmer**. Explain every decision in plain English, one
  milestone (and inside M1, one step) at a time, and **check before big architectural choices**.
- They test in the Unity Editor; you usually can't. Every step must end with a numbered, click-by-click
  Editor checklist in `docs/SETUP.md` and something they can press **Play** on.
- Feedback arrives as feel ("dodge feels late", "enemies fly too far"). Turn it into data-asset
  numbers first, code second.

## Read first

1. `docs/ARCHITECTURE.md` — the standing design (decisions A–G, the actor stack, combat data model,
   the M1 build order in §9). Update it when a decision changes; never let it drift from the code.
2. `docs/SETUP.md` — the Editor checklist for the *current* step. Rewrite it for each step.
3. `README.md` — one-paragraph status. Keep the **Status** line current.

## Project facts

- Unity 6 (`6000.1+`), URP, Input System ≥ 1.7, Cinemachine 3, Unity Test Framework.
  Repo root = Unity project root. `Packages/` and `ProjectSettings/` come from the owner's
  template project (see `docs/SETUP.md` §B) and are committed once they exist.
- Everything we make lives in `Assets/_Hearthmoor/`. Third-party goes in `Assets/ThirdParty/`.
- Assemblies: `Hearthmoor.Runtime`, `Hearthmoor.Editor`, `Hearthmoor.Tests.EditMode`, and
  `Hearthmoor.Setup` (dependency-free; only holds the package installer + status menu).
  Runtime / Editor / Tests compile only once Input System and Cinemachine are installed
  (`defineConstraints` in the `.asmdef` files) — that is deliberate.
- Editor menus live under **Tools ▸ Hearthmoor ▸ …** (install packages, configure project, tidy
  template, rebuild sandbox, check status). Prefer adding a menu item over asking the owner to click
  through ten Inspector fields.

## Conventions that must hold

- **Frames, not seconds.** Combat timings are authored in frames at 60 (`Core/Frames.cs`) and
  converted at the edges.
- **One clock.** Gameplay code reads `CombatClock.DeltaTime` / `CombatClock.Elapsed`, never
  `Time.deltaTime`, so hitstop and slow-mo stay in sync everywhere.
- **Layers by constant.** `HmLayers.*`, never a hand-typed layer name or index.
- **Art/logic split.** Logic root vs a `View` child that implements `IActorView`; placeholders live
  in `Art/Placeholder` and can be deleted without touching code.
- **Data in ScriptableObjects** under `Data/`. Tuning happens in the Inspector, not in code.
- **Domain reload is off** (fast Play). No static state that assumes a fresh start; reset statics
  with `[RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]`.
- **Pure C# where possible.** Rules and maths go in plain classes with no `UnityEngine.Object`
  dependency so they get EditMode tests. Add tests for every new piece of combat maths.
- Namespaces: `Hearthmoor.Core / Controls / Actors / Combat / Feel / AI / World / View / UI`,
  editor code in `Hearthmoor.EditorTools`, bootstrap in `Hearthmoor.Setup`, tests in `Hearthmoor.Tests`.
- Style: `.editorconfig` (4 spaces, Allman braces). Log messages start with `[Hearthmoor]`.
  Every public type gets a one-paragraph `<summary>` a non-programmer could follow.

## Workflow for a step

1. Code + data + tests.
2. Rewrite `docs/SETUP.md` as the checklist for this step; update the README status line.
3. Verify what you can without Unity: `tools/logic-check/run.sh` compiles the pure-logic runtime files
   and the EditMode tests against small stubs and runs them (needs the .NET SDK). It is a smoke test,
   not a substitute for Unity's Test Runner.
4. Commit with a message that names the step; push. Never commit `Library/`, `Temp/`, `Logs/`.
5. The owner runs the checklist and reports back. Fix, then move on.

## Where we are

See the **Status** line in `README.md` and §9 of `docs/ARCHITECTURE.md` for the M1 step list.
