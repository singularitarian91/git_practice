# Painted art: how it was made

Every image in this folder, and the moving chapter plates in `../plates/`, was made with AI image and video models (through Higgsfield), then cut up and cleaned by script. The game doesn't depend on any of it. If an image is missing or fails to load, the chapter falls back to its drawn version, so you can delete or replace files freely.

This page records the method and the exact prompts, so the art can be remade in a different style. To change the look, keep the layouts and swap the style reference and the style words in each prompt.

## Method

1. **Layout.** A flat capture of the game's own drawn version of the scene, with the people hidden. It's 16:9 for single screens and 21:9 for long scrolling strips. Every object is where the code expects it, so the painting lines up with the walkable ground, the doors and the things you can touch.
2. **Style reference.** The chapter's study from the *Visual Direction* guide, the same image as its title plate. A few prompts also used an earlier mockup as a second reference, to pin down one object (the Anger gate, the Bargaining town).
3. **Repaint.**
   - Whole scenes: nano banana 2 at 2K. It keeps a layout best.
   - Single objects and sprites: GPT Image 2.5 (high quality, 2K) with a transparent background.
4. **Clean up** (numpy and PIL):
   - Resize to stage size.
   - Key out the sky where layers overlap. Anger's middle trees were painted on a flat `#d8d3c9` so they could be cut out.
   - Slice sprite sheets on their transparent gaps, and strip the soft glow some sprites come with.
   - Make fabric, wood and turf tiles seamless by crossfading their edges.
   - Paste only the changed region from an edit, with a feathered mask. The models repaint the whole picture even when asked to change one thing.
5. **Place it in code.** Each chapter lists its images (`Chapter.art`). Its title plate loads them before the chapter starts, and the next chapter's are fetched in the background.
   - Sprites are drawn at world positions measured from the image. For example, the Depression porch is placed so its posts land on the old posts.
   - Small movements are done in code: the moth's flutter, the wagtail's tail, reeds and peas swaying, cloud shadows, window flicker.

A cheap alternative to generating a texture is to cut one from a painting already in the game. `depression/wood.webp` comes from the porch wall, `acceptance/ground.webp` from the foreground of the river-plain painting, and the fence and boardwalk posts are cut from the shelter and porch posts at draw time.

## Shared

| File | Model | Made from |
| --- | --- | --- |
| `shared/chair-ochre.webp` | GPT Image 2.5, transparent, 2:3 | Denial study |
| `shared/chair-grey.webp`, `chair-plum.webp` | (recoloured) | The ochre chair with its throw recoloured by script |
| `shared/fabric-*.webp` | GPT Image 2.5, 1:1 | Acceptance study. One 3×3 sheet, cut into nine seamless 512 px tiles. Figures use them recoloured at load (`P.cloth`). |

> A single old wooden spindle-back kitchen chair, like the chair in the reference painting, seen exactly side-on in strict profile: the backrest with its spindles on the LEFT, the seat and front legs extending to the RIGHT. An ochre knitted throw with a round crocheted patch is draped over the top rail of the backrest and hangs down behind it on the left. Worn dark stained wood with scuffs. Painted in the same gouache and oil style as the reference, soft overcast daylight from the upper left. The whole chair is visible and upright, standing on nothing: no floor, no shadow, no rug, no background, transparent background.

> A textile reference sheet: nine square fabric swatches laid flat in a 3 by 3 grid, each swatch exactly filling its square, separated by thin straight gaps of plain dark grey. Seen straight from above in soft even daylight, no shadows, no folds, no stitching, no labels, no text. Row 1: ochre wool coat cloth; rust-red felted wool; mustard-yellow linen. Row 2: grey herringbone tweed; cream undyed linen; plum boiled wool. Row 3: sage-green wool; faded dusty-rose cotton; oxblood-red cotton. Each has a visible, even, fine weave and slightly worn surface, rendered with the painterly softness of the reference painting.

## Title

`title/room.webp`: nano banana 2, 16:9. Inputs were the title layout and the Denial study.

> Image 1 is the layout of the title screen of a 2D game. Image 2 is the art-direction painting for the same game. Repaint image 1 as a finished painting in the style of image 2: a quiet, dim bedroom at the end of an overcast day, gouache, oil and charcoal over marked paper. On the right, the tall window with a bare tree and a flat grey lake outside, its pale cool light falling in a long soft shaft across old dark floorboards. The wall is weathered plaster with a faded damask print, mostly in deep shadow; the left half of the picture is very dark and plain, almost black, for title lettering. Keep the exact composition of image 1: the same window position and size, the same floor line and the same light shaft. No furniture, no people, no text.

## 01 Denial

| File | Model | Made from |
| --- | --- | --- |
| `denial/room.webp` | nano banana 2, 16:9 | Room layout (no chair, no people) + Denial study |
| `denial/cupB.webp`, `denial/coat.webp` | nano banana 2, edit | Patches cut from an edit of the room with a cup and the coat removed |
| `denial/gauze.webp` | nano banana 2, edit | The room with one cup and a bare hook, + Denial study |
| `denial/warm.webp` | nano banana 2, edit | Same room, for the return visit |
| `denial/warm-open.webp` | nano banana 2, edit | `warm.webp`, window opened |

The room:

> Image 1 is the layout of a 2D side-view game background. Image 2 is the art-direction painting for the same game. Repaint image 1 as a finished, richly painted game background in the style of image 2: gouache, oil and charcoal over marked paper; weathered, stained plaster walls with a faded damask print, hairline cracks and peeling patches; old dark floorboards with a soft damp sheen; soft cool overcast daylight from the window, a pale shaft of light falling across the bed and floor; muted grey, umber and ochre palette; tactile and imperfect. Keep the exact composition of image 1, the same straight-on side view, the same wall, ceiling and floor lines, and every object in exactly the same position and size: the two closed panelled wooden doors at far left and far right, the window with a bare tree and a grey lake outside, the three framed pressed ferns, the iron bed with a rumpled white sheet and a small folded grey-blue blanket, the striped rug, the dark wooden dresser with two white cups and a grey-green vase of dry stems on top, and the long grey coat hanging on its hook. There is no chair and there are no people. No text.

Removing things (only the right-hand cup and the coat were kept as patches):

> Edit this painting. Remove the two white cups from the top of the dresser. Remove the dry stems from the vase, so the grey-green vase stands empty. Remove the long grey coat from the wall, so only the small brass hook remains on the plaster. Fill those places with the same weathered plaster wall, faded damask and dark wooden dresser top, matching the painting exactly. Keep everything else exactly as it is: same composition, same positions, same style, colours and light.

The cloth walls:

> Edit image 1. The plaster walls and the ceiling of this bedroom have become translucent, sewn linen gauze, as in image 2: long pale panels hanging from the ceiling, joined by visible seams and whipstitches, frayed hems, softly glowing in the grey daylight. Through the thin cloth, fainter and fainter copies of the same bedroom recede into the distance behind the wall (smaller doors, windows, beds and dressers, one inside another). Keep everything else exactly as it is in image 1, in the same place, size and painted style: the dark floorboards, the two panelled doors, the window with the bare tree and lake, the three framed ferns, the iron bed, the rug, the dresser with one cup and the vase of dry stems, the small brass hook. No people, no chair, no text.

The return visit:

> Edit this painting to show the same room on another day, when the light has changed. Warm late-afternoon sun comes through the window in a soft golden shaft across the bed and the floor, and the walls glow faintly warm; the room feels calmer and a little brighter, still worn. The bed is neatly made, the white sheet smooth and the grey-blue blanket folded at its foot. In the vase, a single fresh white flower instead of the dry stems. Keep every object exactly in the same place and size, and the same painted style: the doors, window, framed ferns, bed, rug, dresser with one cup, the vase and the small brass hook. No people, no chair, no text.

> Edit this painting: the window is now open. Its two casements are swung open inward into the room, and a thin, pale linen curtain lifts into the room on the breeze. Through the open window, the same lake, bare tree and warm sky, a little clearer. Keep everything else exactly as it is: the same composition, every object in the same place and size, the same warm late-afternoon light and painted style. No people, no chair, no text.

## 02 Anger

| File | Model | Made from |
| --- | --- | --- |
| `anger/main-0.webp` | nano banana 2, 21:9 | Left half of the level layout + Anger study; sky keyed out |
| `anger/main-1.webp` | nano banana 2, 21:9 | Right half layout + the painted left half + a gate mockup; sky keyed out |
| `anger/far.webp` | nano banana 2, 21:9 | Far layer layout + Anger study |
| `anger/mid.webp` | nano banana 2, 21:9 | Middle trunks on flat `#d8d3c9`, keyed out, made to tile |
| `anger/bramble.webp`, `anger/scarf.webp` | GPT Image 2.5, transparent | Painted left half as reference |

Left half:

> Image 1 is the wide side-view layout of a 2D game level. Image 2 is the art-direction painting for the same game. Repaint image 1 as a finished, richly painted game background in the style of image 2. On the left: the torn edge of a bedroom wall with faded damask wallpaper, a small mirror, an iron bed with a red blanket and broken floorboards. Then a dense, oppressive grove in the manner of Eyvind Earle: tall black trunks and trunks printed with a faded damask pattern, dark leafy canopies with a strong graphic rhythm, a cobbled path with twisting black roots and thorny brambles, and a torn fragment of the bedroom wall with a cracked framed fern standing among the trees. Pale overcast sky between the trunks, painterly texture, visible tension. Keep the exact composition of image 1: the same side view, the same path height and shape, and every trunk, root, wall fragment and the bed in exactly the same position and size. No people, no chair, no cloth ribbons, no text.

Right half (the red ribbons, knots and people are drawn by the game):

> Image 1 is the flat, simplified layout of the right half of a 2D side-view game level. Image 2 is the finished painting of the left half of the same level: match its trunks, colours, light and brushwork so the two halves join seamlessly. Image 3 shows how the stone wall and the gate should be painted. Repaint all of image 1 as a rich, finished painting, nothing left flat: the dense grove of tall black trunks and trunks printed with a faded damask pattern, dark leafy canopies with a strong graphic rhythm in the manner of Eyvind Earle, a cobbled path with twisting black roots and thorny brambles; then a heavy garden wall of rough, mossy, weathered stone blocks, thick with dark glossy ivy, two worn stone pillars topped by stone balls, and between them a tall gate of split, grey-brown weathered planks with a diagonal brace and rusted iron straps, standing shut. Pale overcast sky between the trunks. Keep the exact composition of image 1: the same side view, the same path height and shape, every trunk, the wall, both pillars and the gate in exactly the same position and size. No people, no chair, no cloth ribbons, no text.

The two halves are joined along a minimum-difference seam.

> Image 1 is the far background layer of a 2D side-view game level: sky and distant trees. Image 2 is the art-direction painting for the same game. Repaint image 1 as a finished painting in the style of image 2: a pale, bright overcast sky with soft light, and rows of tall, slim, misty grey-blue tree trunks with dark, stylised leaves in the distance, a strong vertical rhythm in the manner of Eyvind Earle, soft atmospheric perspective, painterly texture. Keep the composition of image 1: the same trunk positions and the same bright area in the sky. No people, no text.

> Image 1 is a middle-distance layer of a 2D side-view game level: a row of dark tree trunks, some printed with a faded damask pattern, with dark leafy canopies at the top, standing in pale mist. Image 2 is the art-direction painting for the same game. Repaint the trunks and leaves as a finished painting in the style of image 2, with a strong graphic rhythm in the manner of Eyvind Earle and painterly bark texture. Keep the trunks in the same positions and widths. Keep everything between the trunks a completely plain, flat, uniform pale grey-beige (#d8d3c9) with no texture and no other trees, so it can be cut out later. No people, no text.

> A dense, low thicket of bramble seen exactly side-on, for a 2D side-view game: black and dark plum thorny stems arching and tangling across the ground, sharp thorns, a few dark ragged leaves, about twice as wide as it is tall, flat along the bottom where it meets the ground. Painted in the same painterly style, colours and light as the reference painting. Only the bramble: no ground, no sky, no other plants, transparent background.

> A long, hand-knitted scarf in faded rust red with a thin mustard stripe near each frayed, fringed end, hanging in a loose, sagging drape as if snagged on something at two points, seen side-on, soft wool texture, slightly worn. Painted in the same painterly style and light as the reference painting. Only the scarf, transparent background, no thorns, no hands.

## 03 Bargaining

| File | Model | Made from |
| --- | --- | --- |
| `bargaining/backdrop.webp` | nano banana 2, 16:9 | Backdrop layout + a Bargaining mockup + the Bargaining study |
| `bargaining/rooms.webp` | GPT Image 2.5, 3:2 | Mockup as reference; a 3×2 sheet cut into 300 px cells |
| `bargaining/letter.webp` | GPT Image 2.5, transparent | Bargaining study |

> Image 1 is the flat layout of the background for a top-down puzzle scene in a 2D game. Images 2 and 3 are the art direction. Repaint image 1 as a finished painting in their style: dusk over a silhouetted town of roofs and chimneys with a few warm lit windows, a purple-grey sky; below, a dark ground of worn stone in deep shadow; on the left, a small weathered stone landing; on the right, a wooden boardwalk leading off into grey daylight; faint arches and a stair in the dark below. Keep the exact composition of image 1: the town silhouette, the landing, the boardwalk and the dark central area in exactly the same positions and sizes. Leave the large central rectangle dark and plain, because the rooms will be placed there. No rooms, no people, no text.

> A sheet of six square room floors for a puzzle game, each seen from directly above, arranged in a 3 by 2 grid separated by thin straight black gaps, each floor filling its square exactly, with no walls and no doors: 1) a round dark wooden table with two white cups, two chairs and a small oil lamp glowing warm, on worn stone flags; 2) a narrow bed with an ochre cover and a white pillow and a chair beside it, on wooden floorboards; 3) a single wooden chair with an ochre knitted throw in a pale square of window light, on old tiles; 4) a narrow wooden stair descending into darkness; 5) a potted plant on a faded red rug over boards; 6) an empty floor of worn boards with a soft patch of pale light. Warm, lamp-lit gouache style of the reference image.

> A folded letter on thin cream paper, slightly creased and worn at the folds, half open, seen from directly above, with a few lines of looping handwriting in faded brown ink visible but not legible, painted in the gouache style of the reference. Only the letter, transparent background.

## 04 Depression

| File | Model | Made from |
| --- | --- | --- |
| `depression/backdrop.webp` | nano banana 2, 16:9 | Sky, lake and far-shore layout + Depression study |
| `depression/porch.webp` | GPT Image 2.5, transparent | Porch layout + Depression study |
| `depression/moth`, `snail`, `bird`, `moss`, `flower.webp` | GPT Image 2.5, transparent | One sheet of five, sliced |
| `depression/reeds-0…4.webp` | GPT Image 2.5, transparent | One sheet of five clumps, sliced |
| `depression/boots.webp` | GPT Image 2.5, transparent | Depression study |
| `depression/wood.webp` | (cut) | Porch wall, turned sideways, lighting evened out, made to tile |

> Image 1 is the flat layout of the background for a 2D side-view game scene. Image 2 is the art direction. Repaint image 1 as a finished painting in the style of image 2: a huge, brooding overcast sky of layered grey clouds with one paler break, a flat grey lake below a low horizon, a far shore of dark low hills with a few small houses with warm lit windows, soft reflections on the water, fine rain, deep negative space, oil and watercolour on marked paper. Keep the horizon, the far shore and the houses exactly where they are in image 1. No boardwalk, no jetty, no reeds in the foreground, no people, no boats, no text.

That first version had a row of lit houses on the far shore. That is closer to the guide's earlier "cinematic lake" than to the "marked paper" study it chose. So it was edited (nano banana 2, with the first version and the Depression study as references):

> Edit image 1 so it follows the revised, marked-paper direction of image 2. Remove the row of little houses on the far shore, with all their lit windows and their reflections: the far shore becomes only a faint, low, dark line of trees and hills that barely separates lake from sky. Keep one single, very small, warm light far away on the right-hand shore, with the faintest reflection beneath it. More emptiness: the grey sky and the flat lake stay wide, quiet and open. Rougher surface, as in image 2: marked paper with charcoal smudges, dry-brush strokes and scuffs in the sky, faint stains and visible paper grain. Keep the same composition: the horizon at exactly the same height, the pale break in the clouds, the fine rain and the soft reflections on the water. No boardwalk, no jetty, no reeds, no people, no boats, no text.

> A ruined wooden lakeside porch seen exactly side-on for a 2D side-view game, matching the shapes and proportions of image 1: a back wall of weathered vertical grey boards on the left, two tall dark posts, a diagonal brace, and a broken, sagging plank roof with a torn edge and drips of rain, damp grey-brown wood. Painted in the oil and watercolour style of image 2. No floor, no chair, no people, no water, no sky: transparent background.

> Five small, separate painted details for a 2D side-view game, spaced apart in a row with empty space around each, seen side-on: a pale grey-brown moth with its wings open; a snail with a brown spiral shell; a small brown-and-white wagtail standing; a low clump of bright green moss; a single white windflower with a yellow centre on a slender green stem with one leaf. Delicate and luminous, painted in the style of the reference. Transparent background.

> Five separate clumps of dry reeds and cattails in a row with space between them, seen side-on for a 2D game, pale tan, ochre and dark brown, some stems bent or broken, each clump cut off flat along the bottom as if standing in water, painted in the style of the reference. Transparent background.

> A pair of old, muddy, well-worn brown leather lace-up boots standing side by side, seen from the side, one slightly slumped, laces loose, painted in the style of the reference. Transparent background.

## 05 Acceptance

| File | Model | Made from |
| --- | --- | --- |
| `acceptance/backdrop.webp` | nano banana 2, 21:9 | Far-background layout + Acceptance study; torn edges cropped, paper stains painted out |
| `acceptance/shelter.webp` | GPT Image 2.5, transparent | Shelter layout + Acceptance study |
| `acceptance/packet.webp` | GPT Image 2.5, transparent | Acceptance study |
| `acceptance/peas.webp` | GPT Image 2.5, transparent | Prompt only |
| `acceptance/ground.webp` | (cut) | The backdrop's foreground slope, evened out and made to tile |

Painted ground strips for this chapter were also tried, but the model turned them into deep perspective fields, so the ground is the cut texture instead.

> Image 1 is the flat layout of the far background of a 2D side-view game scene. Image 2 is the art direction. Repaint image 1 as a finished painting in the style of image 2: a vast overcast river plain seen from a hillside, a wide sky of heavy grey clouds with a thin paler band near the horizon, layers of low blue-grey hills, fields in muted greens and ochres, and a pale river winding from the near left into the far distance, with bare trees along its banks. Oil paint on marked paper, soft and atmospheric. Keep the composition of image 1: the same horizon, hills and course of the river. No people, no buildings, no fences, no text.

> The weathered wooden frame of a small garden shelter seen exactly side-on for a 2D side-view game, matching the shapes and positions of image 1: three rough wooden posts and one long cross-beam, a hanging length of pale patched linen at the far left, a small wooden crate, a dented metal watering can, three terracotta pots and a trowel on the ground under the beam. Painted in the style of image 2. No roof cloth, no ground, no grass, no people: transparent background.

> A small, worn paper seed packet seen straight on, soft and creased, with a simple old printed illustration of pink and violet sweet pea flowers, and handwritten in pencil across the bottom, clearly legible: "Sweet peas - by the fence". Painted realistically in the style of the reference. Only the packet, transparent background.

> Isolated game sprite on a fully transparent background: a short length of rustic fence wire with sweet pea vines climbing along it, delicate curling tendrils, pale green leaves, and clusters of sweet pea flowers in soft pink, dusty mauve, deep purple and cream white. Painterly gouache and watercolour illustration style with visible brush texture, muted overcast daylight, gentle shading, no cast shadow, no ground, no fence posts, no text, no border. The vines run horizontally across the whole width, loosely draped, with flowers spaced irregularly.

## Moving chapter plates (`../plates/*.mp4`, `*.webm`)

These were made with MiniMax H3 Max as 5-second clips at 768p. Each clip's start and end frame are both its guide study, so it loops without a jump. The audio track was dropped, and each clip was encoded to 1280×720 as both H.264 and VP9. The plate screen shows the still until the loop is playing, then fades it in.

> Denial: Static camera, no zoom, no cuts. The painting comes gently alive: the sheer gauze curtains and cloth walls sway slightly in a draught, pale window light flickers softly, a few dust motes drift. The woman by the wall stays still, breathing gently. Keep the painted texture and colours exactly. No new objects or people. Seamless loop back to the first frame.

> Anger: Static camera, no zoom, no cuts. A strong wind: the long red ribbons whip and flutter between the trees, leaves and branches toss, torn wallpaper edges tremble. The figure strains against the gate, their coat blowing. Keep the painted texture and colours exactly. No new objects or people. Seamless loop back to the first frame.

> Bargaining: Static camera, no zoom, no cuts. The painting comes gently alive: the hanging cloth walls stir slightly, lamplight flickers warmly in the little rooms, the dusk sky shifts slowly. The small figure in the yellow coat stands still. Keep the painted texture and colours exactly. No new objects or people. Seamless loop back to the first frame.

> Depression: Static camera, no zoom, no cuts. The painting comes gently alive: light rain falls, small rings spread on the grey lake, low clouds drift slowly, the dry reeds sway a little, the white flower trembles. The figure on the boardwalk stays still, only their coat stirs. Keep the painted texture and colours exactly. No new objects or people. Seamless loop back to the first frame.

> Acceptance: Static camera, no zoom, no cuts. The patched cloth canopy billows gently in the wind, grass and bare branches sway, clouds drift slowly over the river valley, the two gardeners keep working slowly. Keep the painted texture and colours exactly. No new objects or people. Seamless loop back to the first frame.
