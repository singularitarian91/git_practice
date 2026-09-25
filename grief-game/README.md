# A World the Size of Grief

A short, quiet browser game in five chapters, built from the *Grief Game: Visual Direction* guide. You start in one room, and the world grows around you until it's an open river plain.

These chapters are fiction, not a prescribed sequence for real grief.

## Play

Open `index.html` in a browser. There's no build step and nothing to install. For the nicest result, serve the folder so the fonts load:

```sh
cd grief-game
python3 -m http.server 8000
# then open http://localhost:8000
```

| Action | Mouse / touch | Keyboard |
| --- | --- | --- |
| Walk | Click or tap the ground (hold to keep walking) | A / D or ← / → |
| Look at or use something | Click it | E, Space or Enter near it |
| Pull, untie, sew | Press and hold on it | Hold E / Space |
| Remember how the room was (chapter 1) | Hold the round button | Hold R |
| Turn a room (chapter 3) | Click the room | Arrows to choose, Space to turn |
| Pause | Pause icon, top right | Esc |
| Sound | Speaker icon, top right | M |

On a phone held upright, the game turns sideways to fill the screen, so turn the phone to play (this works with rotation lock on). On iPhone, sound follows the silent switch.

Progress is saved in the browser. After you finish, **Return to a chapter** lets you revisit any chapter. Each one comes back with different light and details, but the loss is still there.

## The five chapters

| # | Chapter | From the guide | What you do |
| --- | --- | --- | --- |
| 01 | Denial | *The room repeats before it can be left.* | The door stays shut ("Not yet.") until you've looked around the bedroom. Then it leads back into the same room, each copy more see-through, with nested copies behind the cloth walls. Hold to remember how the room was, and find the one thing that changed (one cup, the bare hook, the turned chair). Pull the thread out of the sewn doorway, with the grove waiting behind the gauze. |
| 02 | Anger | *The garden resists being crossed.* | Cross a grove of damask-patterned trunks against gusting wind. The wind takes the chair and tumbles it down to what's left of the wall. A bramble catches at you and slows you, and their scarf is snagged in it. The screen darkens and the grove rustles before each gust. Untie the gate's three knots between gusts; pulling during a gust tightens them. |
| 03 | Bargaining | *Every doorway offers another version.* | Turn fold-out rooms (seen from above) to break the red thread's loop and lead it out to the boardwalk. Each lit room you turn away puts its lamp out for good, and each "if only" matches the room you turned. |
| 04 | Depression | *The world is large and hard to reach.* | Walk a long boardwalk under a huge overcast sky. Stand still and small living things appear close by (a moth, a snail, a wagtail, moss); notice them. The last is the lone white flower. |
| 05 | Acceptance | *The missing place remains within a shared world.* | Mend the patched shelter while a gardener holds the other end of the cloth. Kneel to plant as the elder hands you each seedling. Then carry the empty chair to the fence overlooking the river, and the two of them walk down with you. The path along the river opens and the camera pulls back. |

### Their things

The missing person is never named. Each chapter has one thing of theirs you can pick up and look at before putting it back:
- the coat on the hook (Denial)
- their scarf, snagged in the thorns; once freed you wear it for the rest of the journey (Anger)
- a letter in their handwriting (Bargaining)
- their muddy boots by the step (Depression)
- a seed packet in the chair's throw, in their hand: *Sweet peas, by the fence* (Acceptance)

### Coming back

After the end, each chapter can be revisited. The loss is the same, but each return has one new thing, and a line to go with it:

| Chapter | On a return visit |
| --- | --- |
| Denial | Warm afternoon light, and the window can be opened |
| Anger | No gusts, the gate stands open, the chair waits by the wall, and the brambles are flowering |
| Bargaining | Someone has lit the lamps along the way through |
| Depression | Lighter; the step is empty because you're wearing their boots ("They nearly fit.") |
| Acceptance | The garden has come up, and sweet peas flower along the fence by the chair |

### How the guide's shared grammar shows up

- **Empty chair**: in every chapter, in a new place each time (by the window, knocked over, in the folded rooms, on the porch, by the fence). No one ever sits in it.
- **Sewn cloth**: seams, whipstitches and patches on the coat, the walls, the gate knots, the thread in chapter 3, and the shelter.
- **Doorway**: works differently in every chapter. It loops, then it's tied shut, then it turns, then there's no door at all, then the path is open.
- **Small life**: dust in the window light, the moth, snail and flower, the seedlings.
- **Scale**: the hero is largest in the bedroom and smallest on the open plain at the end (ROOM → OPEN WORLD).
- **Light**: overcast daylight throughout. Clear warm light is saved for earned moments (the flower, the chair's place).

### The painted look

The scenery is painted, following the guide's studies:
- Denial's room and its gauze walls
- the Anger grove with its gate
- the dusk town and lamp-lit rooms of Bargaining
- the Depression lake, porch and reeds
- the Acceptance river plain and shelter

The figures are drawn in code but dressed in painted cloth (ochre wool, plum, sage, linen), cut-paper style. The empty chair is a painting in every chapter. The chapter plates move: gauze stirs, ribbons whip in the wind, rain rings the lake, the canopy billows. The end card is a small painting of the chair by the fence. [`assets/art/README.md`](assets/art/README.md) describes how each picture was made, with the prompts, so the look can be redone in another style.

## Files

```
index.html            page shell
js/core.js            stage, loop, input, camera, math, save data
js/paint.js           paper grain, torn edges, stitches, damask, skies, water, gauze, the chair
js/person.js          the protagonist (patched ochre coat) and the two gardeners
js/audio.js           procedural sound (Web Audio): wind, rain, water, drone, chimes
js/ui.js              thought lines, hints, HUD, pause menu, page-tear transition
js/world.js           shared side-view walking and interaction
js/scenes.js          title, chapter plates, return menu, end card, chapter flow
js/chapters/*.js      the five chapters
assets/art/           painted scenery, sprites and cloth, by chapter (see assets/art/README.md)
assets/plates/        chapter title plates: stills (.jpg) and short painted loops (.mp4, .webm)
tests/                automated playthroughs (see Tests)
```

Jump straight to a chapter while testing with `#ch1` … `#ch5` (for example `index.html#ch3`). Add `r` for its Return version (`#ch3r`).

## Tests

The tests play every chapter from start to finish in a real browser (Chromium, through Playwright), using the same mouse, keyboard and touch input a player would. A test fails if a chapter can't be finished or the page reports an error.

```sh
cd grief-game
npm install
npx playwright install chromium
npm test              # everything, about 6 minutes
npm test -- anger     # only tests whose name contains "anger"
```

| File | What it checks |
| --- | --- |
| `01`–`05` | Each chapter, played through to the next chapter's plate or the end card, including each chapter's new moments (looking around before the first door, remembering, the chair in the wind, the bramble, lamps going out, the boots, the gardeners' help) |
| `06-flow` | The title, a plate's painted loop and the painted end card, continuing from saved progress, the pause menu, pause holding text and timers, Return |
| `07-phone` | An upright phone: the turned stage, taps, holding to walk and to untie |
| `08-return` | Each chapter's Return version |

Screenshots from a run go to `tests/output/`, which isn't committed. The tests block all network access, so the game runs with its fallback fonts.

Two tools repeat the checks behind the current performance and sound mix. They're useful after changing the look or the audio:

- `npm run perf`: frame times per chapter on an emulated phone with a slowed CPU. Headless Chrome has no GPU, so treat the numbers as a worst case and compare before and after.
- `npm run audio-levels`: loudness, peaks, and how much sound sits in bands phone speakers play badly, per chapter, plus a WAV of each for listening. The current mix aims for about −24 dBFS per chapter, within about 3 dB of each other, with peaks below −3 dBFS.

## Credits

- The chapter plates are the level studies from the *Grief Game: Visual Direction* PDF, which describes them as original concept studies made for this game. Their moving versions were made from those studies with an image-to-video model.
- The painted scenery, sprites and cloth in `assets/art/` were made with AI image models (nano banana 2 and GPT Image 2.5, through Higgsfield), each from a layout of the game's own drawn scene plus the guide's study for that chapter. The prompts are in `assets/art/README.md`.
- Everything else (the figures' shapes and movement, effects, sound) is generated in code.
- Visual references named in the guide: Shaun Tan, Tove Jansson, Katsumi Komagata, Do Ho Suh, Eyvind Earle, Matt Nava, Claire Mathon, Franz Lustig, Rinko Kawauchi, Siân Davey, Bode, Issey Miyake. These are references only; none of their work is used.
- Type: IM Fell English and Alegreya Sans from Google Fonts, falling back to Georgia and system sans when offline.
