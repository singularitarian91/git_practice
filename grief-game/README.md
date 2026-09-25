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
| Turn a room (chapter 3) | Click the room | Arrows to choose, Space to turn |
| Pause | Pause icon, top right | Esc |
| Sound | Speaker icon, top right | M |

Progress is saved in the browser. After you finish, **Return to a chapter** lets you revisit any chapter. Each one comes back with different light and details, but the loss is still there.

## The five chapters

| # | Chapter | From the guide | What you do |
| --- | --- | --- | --- |
| 01 | Denial | *The room repeats before it can be left.* | Walk through the door and come back into the same bedroom, each copy more see-through, with nested copies showing behind the cloth walls. Find the one thing that changed (one cup, the bare hook, the turned chair), then pull the thread out of the sewn doorway. |
| 02 | Anger | *The garden resists being crossed.* | Cross a grove of damask-patterned trunks against gusting wind. Untie the three knots on the gate between gusts; pulling during a gust tightens them. |
| 03 | Bargaining | *Every doorway offers another version.* | Turn fold-out rooms (seen from above) to break the red thread's loop through the lamp-lit rooms and lead it out to the boardwalk. Each turn offers an "if only". |
| 04 | Depression | *The world is large and hard to reach.* | Walk a long boardwalk under a huge overcast sky. Stand still and small living things appear close by; notice them. The last is the lone white flower. |
| 05 | Acceptance | *The missing place remains within a shared world.* | Mend the patched shelter and plant seedlings with two gardeners, then carry the empty chair to the fence overlooking the river. The path along the river opens and the camera pulls back. |

### How the guide's shared grammar shows up

- **Empty chair**: in every chapter, in a new place each time (by the window, knocked over, in the folded rooms, on the porch, by the fence). No one ever sits in it.
- **Sewn cloth**: seams, whipstitches and patches on the coat, the walls, the gate knots, the thread in chapter 3, and the shelter.
- **Doorway**: works differently in every chapter. It loops, then it's tied shut, then it turns, then there's no door at all, then the path is open.
- **Small life**: dust in the window light, the moth, snail and flower, the seedlings.
- **Scale**: the hero is largest in the bedroom and smallest on the open plain at the end (ROOM → OPEN WORLD).
- **Light**: overcast daylight throughout. Clear warm light is saved for earned moments (the flower, the chair's place).

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
assets/plates/*.jpg   chapter title plates
```

Jump straight to a chapter while testing with `#ch1` … `#ch5` (for example `index.html#ch3`). Add `r` for its Return version (`#ch3r`).

## Credits

- The chapter plates are the level studies from the *Grief Game: Visual Direction* PDF, which describes them as original concept studies made for this game.
- Everything else (drawings, character, sound) is generated in code.
- Visual references named in the guide: Shaun Tan, Tove Jansson, Katsumi Komagata, Do Ho Suh, Eyvind Earle, Matt Nava, Claire Mathon, Franz Lustig, Rinko Kawauchi, Siân Davey, Bode, Issey Miyake. These are references only; none of their work is used.
- Type: IM Fell English and Alegreya Sans from Google Fonts, falling back to Georgia and system sans when offline.
