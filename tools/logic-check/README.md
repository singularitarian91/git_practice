# logic-check

A tiny harness so a Claude Code session **without the Unity Editor** can still compile the
pure-logic parts of the game (clocks, frames, input buffer, layer tables) together with the
EditMode tests, and run them.

```
tools/logic-check/run.sh
```

It uses stand-ins for the handful of `UnityEngine` and `NUnit` members those files touch
(`Stubs/`). It is a smoke test for typos and broken maths — **Unity's Test Runner is the real
check** (`Window ▸ General ▸ Test Runner ▸ EditMode ▸ Run All`).

When a new runtime file is pure logic, add it to `LogicCheck.csproj`. When a test needs a Unity
type the stubs don't have, add the smallest possible stand-in to `Stubs/UnityStubs.cs`.

Unity ignores this folder: it only imports `Assets/` and `Packages/`.
