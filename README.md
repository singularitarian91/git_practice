# git_practice

Single-file browser experiments. Open any `.html` file directly — no build, no
dependencies, no network required.

## Neon Drift — `game.html`

A neon vector arcade survival shooter on canvas 2D.

- **Fly** with WASD / arrow keys, **aim** with the mouse
- **Fire** by holding click or Space
- **Dash** with Shift — a burst of speed with brief invulnerability
- **Bomb** with E or right-click — clears the screen
- **P** pauses, **M** mutes

On touch devices the left half of the screen is a floating stick and the right
half aims and fires, with on-screen dash and bomb buttons.

Four enemy types with distinct behaviour (drifters weave in, seekers home,
orbiters circle and shoot, bruisers tank hits and split on death), escalating
waves, five power-ups, a kill-chain multiplier that decays if you stop scoring,
and a high score saved to `localStorage`.

Every fifth wave sends a **Monolith**: a boss whose core is invulnerable until
you destroy the shield nodes orbiting it, then fires radial bursts, aimed
volleys, and — below half health — a rotating spiral stream.

## Psychedelic Particle Visualizer — `visualizer.html`

WebGL particle system with five physics modes.
