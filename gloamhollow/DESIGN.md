# Gloamhollow — design document

*A dark, cozy life-sim.* Stardew Valley's farming and seasons, Animal
Crossing's animal neighbours, museum and island-paying-off loop, and
Valheim's Nordic gloom, stamina, fires and night-time monsters — in 3D,
in the browser.

> Tend the soil. Keep the fires lit. Pay the Raven.

## Premise

You wash ashore on **Gloamhollow**, a fog-bound isle at the edge of the
northern sea, where the sun never climbs high and the mist swallows the
forest each night. Your late grandmother left you her croft here. Your
passage (and her unpaid dues) were covered by **Corvin**, a courteous and
faintly sinister raven merchant — so you start **3 000 coins in debt**.

At the heart of the village stands the **Great Hearth**. It is dying. As
it dims, the mist creeps closer and the **Gloam** — twig-limbed gloamlings
and drifting wraiths — grow bold in the dark. The villagers ask you to
rekindle it with **six offerings** of the island's bounty. Complete them,
and the old altar in the Mistwood wakes: **Ashhorn, the Mist-Stag**, the
thing that has been drinking the light. Defeat it, lay its antler on the
Hearth, and dawn returns to Gloamhollow.

## Core loop

Day (06:00 → 02:00, ~10 real minutes, configurable)
* Farm: till (hoe) → plant seeds → water daily → harvest. Crops are seasonal.
* Gather: chop trees (wood, resin), mine rocks (stone, flint, ore), forage.
* Fish in the black lake and the grey sea (timing minigame).
* Catch bugs with the net; dig up relics at glinting cracks.
* Sell anything by dropping it in the **tithe crate** (paid overnight).
* Talk to villagers, give gifts, fulfil their requests; donate to the Barrow.
* Craft at the workbench, cook at a campfire / cauldron, place builds.

Night (after ~20:00)
* The Gloam hunts outside of firelight. Torches, braziers, lanterns and the
  Great Hearth create safe light. Fight with the sword, dodge-roll, eat.
* Sleep at your house door to end the day (autosave). Past 02:00 you
  collapse and lose some coins; dying also wakes you at home, poorer.

Progression
* Pay off the debt to Corvin → he offers the **Longhouse** upgrade.
* Six **Hearth Offerings** (bundles) → each relights a rune on the Hearth,
  widens the village's safe light, thins the fog and gives a reward.
* Friendship (0–10 hearts) with each villager: gifts, chats, requests.
* Collections: fish, bugs, relics donated to Morrow at the Barrow.
* Tool upgrades at Bramble's forge (copper, then iron).

## Time, seasons, weather

* Season length: **10 days** (configurable). Year: Spring (Thaw), Summer
  (Brightwane), Autumn (Rotfall), Winter (Deepfrost).
* Weather rolled daily: clear, overcast, fog, rain, storm, snow (winter).
  Rain waters every crop. Fog and storms embolden the Gloam.
* Autumn tints leaves; winter covers the island in snow, only frostroot
  grows.

## Stats

* Health 100 (max rises with food buffs). Stamina 100 — Valheim-style: it
  regenerates quickly when not spending it; tools, sprinting, attacks and
  dodges cost stamina. Standing near a fire for 20 s grants **Rested**
  (faster regen). Cooked food heals and may grant **Well Fed** (+max HP).

## Villagers

| id | name | species | role / home | personality |
|---|---|---|---|---|
| `corvin` | Corvin | raven | Merchant & moneylender; *Corvin's Curios* stall | Courteous, velvet-voiced, mercantile, secretly sentimental. Speaks formally, drops "caw" when flustered. Knows more about the Gloam than he admits. |
| `morrow` | Morrow | owl | Keeper of the Barrow (museum) | Scholarly, gloomy, pedantic, delighted by bones and old things. **Detests bugs** (but accepts them for the collection, shuddering). Says "hoo" mid-sentence. |
| `bramble` | Bramble | badger | Smith; forge-house | Gruff, terse, soft-hearted, loves hard work and stew. "Hrm." Upgrades tools. |
| `mothwyn` | Mothwyn | moth | Lamplighter; lantern cottage | Shy, dreamy, poetic, afraid of the dark (ironically), adores lights and flames. Lights the village lanterns at dusk. Gives you the **bug net**. |
| `grenna` | Grenna | goat | Herbalist / hedge-witch; herb hut | Ancient, cryptic, dry humour, knows the old rites, blunt. "Baaah." Teaches cooking (cauldron). |
| `fennick` | Fennick | fox | Ex-sailor fisherman; boat-hut by the shore | Roguish, warm, tall tales, lost an eye to "a fish the size of a longship". Gives you the **fishing rod**. |

Gift tastes (item ids): `loved` +80, `liked` +45, `neutral` +20,
`disliked` −20; one gift per villager per day; chatting daily +10;
completing a request +60. 100 points = 1 heart.

| id | loved | liked | disliked |
|---|---|---|---|
| corvin | ember, relic_amber, relic_brooch, relic_coin | nightshade, fish_herring, raspberry, gloam_essence, food_berry_pie | stone, fiber, turnip, bone |
| morrow | relic_tablet, relic_idol, mushroom_glow, food_porridge | fish_perch, food_bread, bone, relic_horn, hazelnut | all bugs, nightshade |
| bramble | iron_ore, food_stew, food_mead | copper_ore, coal, food_cooked_meat, bone, flint | dandelion, flower items, fiber, raspberry |
| mothwyn | ember, flax, food_berry_pie, mushroom_glow | dandelion, thistle, resin, blueberry, cloudberry | bug_moth, bug_mistmoth, gloam_essence, coal |
| grenna | thistle, mushroom_yellow, nightshade, frostroot | dandelion, onion, turnip, beet, hazelnut | all fish, raw_meat, food_cooked_meat |
| fennick | fish_sovereign, fish_angler, food_grilled_fish, food_mead | all fish, food_cooked_meat, relic_horn, cloudberry | fiber, stone, turnip |

Daily schedules (hours; outside these they are indoors):
* Corvin: stall 08–20 (shop open). Morrow: at the Barrow door always.
* Bramble: forge 08–17, hearth square 17–21. Mothwyn: meadow 08–12,
  cottage 12–18, walks the lantern posts 18–23. Grenna: forest edge 07–12,
  herb hut 12–19, hearth 19–22. Fennick: dock 05–11, beach/village 11–17,
  hearth or longship 17–22.

## Items (ids are used everywhere: code, gifts, requests, dialogue)

Materials: `wood`, `stone`, `flint`, `copper_ore`, `iron_ore`, `resin`,
`fiber`, `bone`, `gloam_essence`, `ember`, `leather`, `feather`, `coal`,
`raw_meat`.

Crops (seed id = `seeds_<crop>`):

| crop | season | days | seed price | sell |
|---|---|---|---|---|
| turnip | spring | 4 | 20 | 45 |
| carrot | spring | 5 | 25 | 58 |
| onion | spring, summer | 6 | 30 | 72 |
| flax | summer | 5 | 25 | 50 (+fiber) |
| barley | summer, autumn | 4 | 20 | 32 |
| beet | summer, autumn | 5 | 30 | 76 |
| pumpkin | autumn | 8 | 60 | 230 |
| nightshade | autumn | 6 | 50 | 140 |
| frostroot | winter | 7 | 70 | 190 |

Forage: `mushroom_red`, `mushroom_yellow`, `mushroom_glow`, `raspberry`,
`blueberry`, `thistle`, `dandelion`, `cloudberry`, `hazelnut`.

Fish: `fish_perch` (Bog Perch, lake, day), `fish_pike` (Old Pike, lake),
`fish_eel` (Mire Eel, lake, night/rain), `fish_carp` (Ghost Carp, lake,
late night, autumn/winter, rare), `fish_herring` (Grey Herring, sea, day),
`fish_cod` (Rimecod, sea, autumn/winter), `fish_mackerel` (Tide Mackerel,
sea, spring/summer), `fish_hagfish` (Hagfish, sea, night),
`fish_angler` (Lantern-Angler, sea, deep night, rare),
`fish_sovereign` (Drowned Sovereign, dock end, winter 00–04, legendary).

Bugs: `bug_moth` (Ash Moth), `bug_deathshead` (Death's-head Moth),
`bug_firefly` (Gloam Firefly), `bug_beetle` (Bark Beetle),
`bug_grave_beetle` (Grave Beetle), `bug_dragonfly` (Fen Dragonfly),
`bug_lanternfly` (Lanternfly), `bug_mistmoth` (Mist Moth).

Relics: `relic_coin` (Tarnished Coin), `relic_comb` (Bone Comb),
`relic_tablet` (Rune Tablet), `relic_brooch` (Bronze Brooch),
`relic_horn` (Drinking Horn), `relic_crown` (Rusted Crown),
`relic_amber` (Amber Beads), `relic_idol` (Carved Idol).

Food: `food_cooked_meat`, `food_grilled_fish`, `food_roast_roots`,
`food_mushroom_skewer` (campfire); `food_stew`, `food_bread`,
`food_berry_pie`, `food_porridge` (cauldron); `food_mead` (bought).

Tools: `tool_hoe`, `tool_can`, `tool_axe`, `tool_pickaxe`, `tool_sword`,
`tool_rod`, `tool_net`, `tool_hammer`.

Placeables: `torch_standing`, `brazier`, `campfire`, `cauldron`,
`fence_wood`, `chest`, `scarecrow`, `rain_totem`, `lantern_post`, and decor
(`bench`, `barrel`, `crate_stack`, `hay_bale`, `cart`, `wood_pile`,
`banner`, `skull_pike`, `flower_pot`, `drying_rack`, `weapon_rack`,
`beehive`, `planter_box`, `bed_roll`).

Special: `trophy_stag` (Ashhorn's Antler).

## Hearth offerings

1. **Kindling** — 30 wood, 20 stone, 5 resin → Hearth relit; brazier recipe.
2. **Soil** — 5 turnip, 5 carrot, 3 onion → 2 rain totems + recipe.
3. **Deep** — perch, pike, herring, eel → bone-hook rod (easier fishing).
4. **Wild** — 3 red mushroom, 5 raspberry, 3 thistle, 3 dandelion →
   cauldron recipe (Grenna's cooking).
5. **Dark** — 5 gloam essence, 5 bone, 5 copper ore → Ember Blade.
6. **Tithe** — 1 500 coins → Corvin's decor catalogue.

All six → the altar in the Mistwood wakes → **Ashhorn** → place
`trophy_stag` on the Hearth → *Dawn Returns* (ending; play continues).

## Enemies

* **Gloamling** – night, anywhere dark. 30 HP, claw 8. Drops gloam essence,
  resin, bone.
* **Wraith** – deep night / fog, Mistwood and beyond. 60 HP, fast, 15 dmg.
  Drops gloam essence, sometimes ember.
* **Draugr** – Mistwood ruins & graveyard, day and night. 90 HP, 18 dmg.
  Drops bone, iron ore.
* **Ashhorn, the Mist-Stag** – boss, 900 HP, charges, antler sweeps,
  summons gloamlings.
* Light is sanctuary: the Gloam will not enter a lit fire's radius.

## Map (island ~240 m across, world units = metres, +Z = south)

* **Hollow Green** (centre): Great Hearth, Corvin's stall, well, notice
  board, villager homes around the green.
* **Your croft** (south-west): hut, farm field, tithe crate, workbench.
* **The Barrow** (north): Morrow's museum mound, graveyard.
* **Blackwater** (east): the lake with a small jetty.
* **Greyshore** (south/south-east): beach, dock, the longship; Fennick's hut.
* **Birchmeadow** (west): meadow, berries, bugs, flowers.
* **Mistwood** (north-east): dark pines, ruins, ore, draugr, the altar.
* Runestones with lore are scattered across the island.
