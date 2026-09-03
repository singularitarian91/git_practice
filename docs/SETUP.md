# Setup checklist — Milestone 1, Step 1: project skeleton

**What you'll have at the end:** the repo opens as a Unity project, packages are installed,
layers / physics / time are configured, a greybox sandbox scene exists, and the test runner is
green. Nothing moves yet — the player controller is step 2.

**Time:** about 20 minutes, most of it Unity importing.

---

## One-time: tools

1. **Unity Hub** with a **Unity 6.1 or 6.2** editor installed (any `6000.1.x` / `6000.2.x`).
   The default modules are fine.
2. **Git LFS** — <https://git-lfs.com>. Install it, then in a terminal run `git lfs install` once.
   (GitHub Desktop already includes it.) Big art files go through LFS so the repo stays fast.

## A. Get the branch

3. If you haven't cloned yet:
   `git clone https://github.com/singularitarian91/git_practice.git Hearthmoor`
   (naming the folder `Hearthmoor` keeps things tidy).
4. In that folder: `git checkout claude/hearthmoor-project-setup-a9ditw` then `git pull`.

## B. Let Unity create the project files (once)

Unity Hub can't create a project *inside* an existing folder, so we create one next door and
move three folders over.

5. Unity Hub → **New project** → choose your 6.x editor → template **Universal 3D** →
   name it `HearthmoorTemplate`, location anywhere temporary → **Create project**.
   Wait for the editor to finish opening, then **close it**.
6. In your file browser, open `HearthmoorTemplate`. Copy these three folders into the
   `Hearthmoor` repo folder: **`Assets`**, **`Packages`**, **`ProjectSettings`**.
   If asked to merge `Assets`, say yes — nothing conflicts.
   Do **not** copy `Library`, `Logs`, `Temp` or `UserSettings`.
7. You can delete `HearthmoorTemplate` now.
   (The repo's `docs/`, `tools/` and `archive/` folders are invisible to Unity — it only looks at
   `Assets`, `Packages` and `ProjectSettings`.)

## C. Open it

8. Unity Hub → **Add** → **Add project from disk** → choose the `Hearthmoor` folder → open it.
   The first import takes a few minutes.
9. Menu **Tools ▸ Hearthmoor ▸ 1 · Install Packages**.
   Open the Console (**Window ▸ General ▸ Console**): it lists what it's installing, then Unity
   recompiles (spinner, bottom-right). Wait until the spinner is gone. If it says everything is
   already installed, carry on.
10. Menu **Tools ▸ Hearthmoor ▸ 2 · Configure Project**.
    This adds our layers, sets the collision matrix, 60 Hz physics, fast play-mode entry, checks
    the folder layout, then builds and opens the **Sandbox_Combat** scene. The Console prints a
    report. If the report says **RESTART THE EDITOR**, do that (File ▸ Exit, reopen from the Hub)
    and run step 10 again.
11. Optional but recommended: **Tools ▸ Hearthmoor ▸ 3 · Tidy Template Files** — moves the
    template's settings into `_Hearthmoor/Settings` and deletes its tutorial files.

## D. Check it works

12. **Window ▸ General ▸ Test Runner** → **EditMode** tab → **Run All**.
    Everything should be green (27 tests). Red? Paste me the message.
13. Press **Play** with `Sandbox_Combat` open. You'll see the greybox arena from a fixed camera:
    a stair, two slopes, a brown climbing wall, a tower. Nothing moves yet — that's step 2.
14. **Tools ▸ Hearthmoor ▸ Check Status** prints a summary you can paste to me if anything
    looks off.

## E. Save it to git

15. In a terminal in the `Hearthmoor` folder:
    ```
    git add -A
    git commit -m "Add Unity project files from the Universal 3D template"
    git push
    ```
    (`Library/`, `Temp/`, `Logs/` are ignored automatically.) Or ask your local Claude Code to
    do it for you. Tell me when it's pushed — I'll check the project settings came through and
    start step 2.

---

## If something goes wrong

- **No `Tools ▸ Hearthmoor` menu** → Unity is still compiling, or there's a compile error in
  the Console. Paste me the first red line.
- **Menu 1 is there but menu 2 is missing** → packages aren't installed yet. Run menu 1 and
  wait for the spinner.
- **Pink / magenta objects** → URP isn't active. Check **Edit ▸ Project Settings ▸ Graphics**
  has a URP asset assigned. (Usually means `ProjectSettings` wasn't copied in step 6.)
- **Layers already used** → the report names the slot. Free it under
  **Edit ▸ Project Settings ▸ Tags and Layers** and re-run menu 2.
- **Unity opened in Safe Mode** → click *Ignore* / *Exit Safe Mode*; the setup menu still works.

## Optional: Unity Smart Merge

If you ever merge branches with scene or prefab changes, Unity's merge tool avoids corrupt
files. One-time setup, in the repo folder (adjust the path to your editor):

```
git config merge.unityyamlmerge.name "Unity Smart Merge"
git config merge.unityyamlmerge.driver "'C:/Program Files/Unity/Hub/Editor/6000.2.0f1/Editor/Data/Tools/UnityYAMLMerge.exe' merge -p %O %A %B %A"
```

Skip this until you need it.
