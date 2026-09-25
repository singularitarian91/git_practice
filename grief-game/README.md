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

### Art direction

The guide's form is *cut paper / charcoal / frayed linen / stained wood / gouache / photographic light*. The game holds to one rule built on that: **the places are painted, and the people are cut paper laid on the page.**
- **The pages.** Every place is a painting made from the guide's study for that chapter.
- **The people.** Each figure is a cut-out dressed in painted cloth: ochre wool, plum, sage, linen and tweed. A charcoal line is redrawn around it a few times a second, like a hand-drawn line, and it casts a faint shadow where the paper lifts off the painting. Each chapter's light tints it: window daylight, the grove's shade, rain, the open plain.
- **The torn edge.** From Depression on, the page itself has a torn edge, as in the guide's later studies ("keep the scar in the image").
- **Depression.** It follows the study the guide chose over the earlier cinematic lake: an almost empty far shore, one light a long way off, more negative space and a rougher, marked surface.

The guide names twelve artists and gives each one a use. They're used for principles; none of their work is copied.

| Reference | The guide's use | Where it shows |
| --- | --- | --- |
| Shaun Tan | Grief alters architecture, weather and scale | The bedroom wall gives way into the grove; rooms fold; the person gets smaller as the world grows |
| Tove Jansson | A little domestic warmth inside uneasy spaces | Steam rising from the one cup still warm in the first room; a single lit window far across the lake |
| Katsumi Komagata | Doors, windows and paths as successive reveals | Each door opens onto the next room; Bargaining's rooms lift off the page like card as they turn; the people are cut paper |
| Do Ho Suh | Earlier rooms stay visible inside later levels | Gauze walls with fainter copies of the room behind; translucent sewn walls between the folded rooms; the bedroom window stitched into the shelter's hanging cloth |
| Eyvind Earle | A strong, almost oppressive pattern for the anger grove | Damask-printed trunks in a hard vertical rhythm |
| Matt Nava | A readable route across a large horizon | The last walk along the river as the camera pulls back |
| Claire Mathon | An intimate opening with room for unspoken history | Soft window light in the first room |
| Franz Lustig | Light and small details change on a return | Each return visit's light, and its one new thing |
| Rinko Kawauchi | A flower, reflection or scuff carries a scene | The small lives on the boardwalk; the flower in its light |
| Siân Davey | Hope made visible through shared, ordinary labour | The gardeners hold the cloth, hand over seedlings, walk down to the fence |
| Bode | Visible patches on clothes and shelter | The patched coat and chair throw; the patchwork canopy, its tears open to the sky until they're mended |
| Issey Miyake | The coat gains movement and looseness | Pleats in the coat open a little wider each chapter and with every step |

The chapter plates are short painted loops made from the guide's studies, and the end card is a small painting of the chair by the fence. [`assets/art/README.md`](assets/art/README.md) records how each picture was made, with the prompts, so the look can be redone in another style.

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
