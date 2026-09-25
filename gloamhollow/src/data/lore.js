// Gloamhollow — lore, item flavour, museum commentary, narration and signage.
// Plain data, no imports. Dialogue pages are split with '|' (each page <= 150 chars).

// Flavour descriptions (<= 110 chars) for every item id in DESIGN.md.
export const ITEM_TEXT = {
  // ── Materials
  wood: "Split pine and birch, still smelling of the forest. Burns well; builds better.",
  stone: "Grey island stone, cold and patient. The bones of every wall on Gloamhollow.",
  flint: "A black, glassy shard. Strike it on steel and it remembers the sun.",
  copper_ore: "Green-veined ore from the island's rocks. Bramble can coax a shine out of it.",
  iron_ore: "Heavy, rust-red ore. The draugr of the Mistwood hoard it; Bramble covets it.",
  resin: "Golden pine sap. Sticky, fragrant, and the finest firestarter in the north.",
  fiber: "Tough plant strands for twine, rope and netting. Itchy, but honest.",
  bone: "Old bone, bleached by salt and time. Morrow would like a word with it.",
  gloam_essence: "A wisp of cold shadow that shouldn't be solid. It hums faintly, like a held breath.",
  ember: "A coal that refuses to die. Warm in the palm, like a small and loyal sun.",
  leather: "Supple hide, smoked over peat. Good for straps and grips, and for keeping out the damp.",
  feather: "A grey feather, light as a rumour. Corvin insists it isn't one of his.",
  coal: "Black, dusty and eager to burn. Bramble's forge eats it by the sackful.",
  raw_meat: "Fresh and raw. Cook it over a fire first, unless you happen to be a gloamling.",

  // ── Crops
  turnip: "A stout, purple-shouldered root. Humble, hardy, and Grenna's favourite snack.",
  carrot: "A sweet orange root pulled from cold soil. Crunchy, bright, and said to sharpen night eyes.",
  onion: "Layered and pungent. It makes stew into stew, and grown badgers into weepers.",
  flax: "Slender stalks with pale blue flowers. Spun into linen, twisted into lantern wicks.",
  barley: "Whiskery golden grain for bread and porridge, and, if Fennick has his way, for mead.",
  beet: "Deep red and earthy. Grenna swears it makes the blood strong and the spirit stubborn.",
  pumpkin: "A great orange lantern of a squash. Heavy, cheerful, and worth a small fortune in Rotfall.",
  nightshade: "Glossy purple berries on a dark vine. Lovely. Profitable. Do not eat.",
  frostroot: "A pale, glittering root that swells beneath the snow. Bittersweet and stubborn.",

  // ── Seeds
  seeds_turnip: "Turnip seeds. Sow in Thaw; ready in 4 days. Nearly impossible to fail with.",
  seeds_carrot: "Carrot seeds. Sow in Thaw; ready in 5 days. Tiny, but full of ambition.",
  seeds_onion: "Onion sets. Sow in Thaw or Brightwane; ready in 6 days. Already making you teary.",
  seeds_flax: "Flax seeds. Sow in Brightwane; ready in 5 days. Yields fiber as well as flax.",
  seeds_barley: "Barley seed. Sow in Brightwane or Rotfall; ready in 4 days. Quick and dependable.",
  seeds_beet: "Beet seeds. Sow in Brightwane or Rotfall; ready in 5 days. They stain everything red.",
  seeds_pumpkin: "Pumpkin seeds. Sow in Rotfall; ready in 8 days. Patience pays handsomely.",
  seeds_nightshade: "Nightshade seeds. Sow in Rotfall; ready in 6 days. Wash your hands afterwards.",
  seeds_frostroot: "Frostroot seeds. The only crop that grows in Deepfrost; ready in 7 days.",

  // ── Forage
  mushroom_red: "A red cap flecked with white. Grenna says it's for regret. Best cooked.",
  mushroom_yellow: "A buttery yellow mushroom from the forest edge. For luck, says Grenna, who adores them.",
  mushroom_glow: "A mushroom that glows soft blue in the dark. The forest's own little lantern.",
  raspberry: "Tart red berries from the Birchmeadow brambles. They stain your fingers like a guilty secret.",
  blueberry: "Dusky blue berries, sweet as a summer evening.",
  thistle: "A prickly purple flower that grows where nothing else dares. Grenna approves.",
  dandelion: "A little sun on a stalk. Later, a clock of wishes for the wind.",
  cloudberry: "A rare amber berry from the boggy uplands. Tastes like a cold morning with honey.",
  hazelnut: "A smooth brown nut in a frilled husk. Morrow says they are 'excellent for thinking.'",

  // ── Fish
  fish_perch: "Bog Perch. A striped fish of peaty Blackwater. Bites by day, and bites often.",
  fish_pike: "Old Pike. Long, toothy and older than the jetty. Lurks in Blackwater.",
  fish_eel: "Mire Eel. Slithers out of Blackwater's mud at night and in the rain.",
  fish_carp: "Ghost Carp. Pale as candle wax. Rises in Blackwater late on autumn and winter nights.",
  fish_herring: "Grey Herring. Silver-grey and honest. Schools in the grey sea by day.",
  fish_cod: "Rimecod. A fat, frost-flecked sea fish of the autumn and winter waters.",
  fish_mackerel: "Tide Mackerel. Striped, swift and cheeky. Runs the sea in spring and summer.",
  fish_hagfish: "Hagfish. Eyeless, jawless and astonishingly slimy. Found in the sea at night.",
  fish_angler: "Lantern-Angler. A deep-sea fish with a glowing lure. Rare; rises only in the deepest night.",
  fish_sovereign: "The Drowned Sovereign. A crowned king of the deep, taken off the dock's end in winter.",

  // ── Bugs
  bug_moth: "Ash Moth. Soft, grey and drawn to every flame. Mothwyn would rather you let it go.",
  bug_deathshead: "Death's-head Moth. A skull-marked moth that squeaks when held. Very dramatic.",
  bug_firefly: "Gloam Firefly. A tiny green-gold lantern that drifts over the grass after dark.",
  bug_beetle: "Bark Beetle. A glossy little woodworker that carves rune-like tunnels under bark.",
  bug_grave_beetle: "Grave Beetle. A black beetle with a violet sheen. Fond of old stones and quiet places.",
  bug_dragonfly: "Fen Dragonfly. Four glassy wings and a jewelled body. Zips over still water.",
  bug_lanternfly: "Lanternfly. A bug with a softly glowing snout. Mothwyn considers it a kindred spirit.",
  bug_mistmoth: "Mist Moth. Pale and nearly see-through, it drifts where the fog is thickest.",

  // ── Relics
  relic_coin: "Tarnished Coin. A silver penny from a lost realm, worn smooth by a thousand thumbs.",
  relic_comb: "Bone Comb. Carved from antler, its fine teeth still fit to use.",
  relic_tablet: "Rune Tablet. A slate carved with runes that seem to shift when you look away.",
  relic_brooch: "Bronze Brooch. An oval brooch shaped like a curled dragon, green with age.",
  relic_horn: "Drinking Horn. A carved horn rimmed in bronze. Someone once toasted the dawn with it.",
  relic_crown: "Rusted Crown. Iron, pitted by salt. Whoever wore it wore it into the sea.",
  relic_amber: "Amber Beads. A string of amber, each bead holding a spark of ancient sunlight.",
  relic_idol: "Carved Idol. A tiny wooden figure with an antlered head. It feels watched. Or watching.",

  // ── Food
  food_cooked_meat: "Meat seared over a campfire. Simple, hot and filling.",
  food_grilled_fish: "Fish charred on a stick with sea salt. Fennick's idea of a perfect supper.",
  food_roast_roots: "Roasted roots, crisp at the edges. Tastes like the soil has forgiven you.",
  food_mushroom_skewer: "Forest mushrooms grilled on a skewer. Smoky, earthy and (mostly) safe.",
  food_stew: "A thick stew of meat and roots. Bramble's answer to every question.",
  food_bread: "A dense barley loaf, crusty and warm. Smells like a home you almost remember.",
  food_berry_pie: "A pie bursting with berries. Pink inside, like a sunset you can eat.",
  food_porridge: "Warm barley porridge. Grey, plain and deeply comforting. Morrow's favourite.",
  food_mead: "Golden honey mead. Warms the belly and loosens the tongue.",

  // ── Tools
  tool_hoe: "A sturdy hoe for breaking soil. Till the earth, then plant your seeds.",
  tool_can: "A watering can. Crops want water every day, unless the sky obliges.",
  tool_axe: "A woodcutter's axe with a birch handle. Fells trees for wood and resin.",
  tool_pickaxe: "A pick for breaking rock. Yields stone, flint and ore.",
  tool_sword: "A plain, well-balanced sword. Not glorious, but it keeps the Gloam at arm's length.",
  tool_rod: "Fennick's old fishing rod. Cast, wait for the bite, then fight the fish. Gently.",
  tool_net: "A bug net of old lantern gauze, stitched by Mothwyn. Swing gently.",
  tool_hammer: "A builder's hammer, for raising, and razing, the things you build.",

  // ── Placeables (workbench is defined in items.js; DESIGN.md mentions it at the croft)
  torch_standing: "A standing torch. Its circle of light is sanctuary; the Gloam will not enter it.",
  brazier: "An iron fire-bowl on three legs. Wider light, longer burn. A gift of the Kindling rune.",
  campfire: "A ring of stones and a crackling fire. Cook, rest, and keep the dark at bay.",
  cauldron: "A black iron cauldron for stew, bread, pie and porridge. Grenna's recipe. Never lend it out.",
  fence_wood: "A length of split-rail fence. Keeps crops in rows and neighbours honest.",
  chest: "A sturdy wooden chest for your belongings. Smells faintly of pine and secrets.",
  workbench: "A scarred pine workbench. Where timber and stone become torches, fences and chests.",
  scarecrow: "A straw figure in an old coat. Crows ignore it. Corvin finds it personally insulting.",
  rain_totem: "A carved pole strung with shells and feathers. Said to coax the rain to your fields.",
  lantern_post: "A tall post with a glass lantern. Mothwyn will want to give it a name.",

  // ── Decor
  bench: "A split-log bench. For sitting, sighing, and watching the fog roll in.",
  barrel: "A stout oak barrel. Holds rainwater, pickled herring, or Fennick's secrets.",
  crate_stack: "A stack of shipping crates stamped with the marks of faraway ports.",
  hay_bale: "A tight bale of golden hay. Smells of summer, even in Deepfrost.",
  cart: "A wooden handcart with one squeaky wheel. Adds charm; subtracts silence.",
  wood_pile: "A tidy stack of split logs. A promise of warm nights to come.",
  banner: "A black banner stitched with a raven. Corvin insists the likeness is unflattering.",
  skull_pike: "An old stag skull on a pole. Grim, but traditional. Wards off bad luck, allegedly.",
  flower_pot: "A clay pot of hardy herbs. A little green against the grey.",
  drying_rack: "A wooden rack for drying fish and herbs in the smoky air.",
  weapon_rack: "A rack for axes and blades. Bramble approves of well-kept steel.",
  beehive: "A woven straw skep, humming softly. Somewhere inside, mead is being born.",
  planter_box: "A raised wooden planter, for herbs, flowers or stubborn optimism.",
  bed_roll: "A fur bedroll. Not as good as a bed. Better than the ground. Barely.",

  // ── Special
  trophy_stag: "Ashhorn's Antler. Pale as ash, cold as mist. Laid on the Hearth, it calls back the dawn.",
};

// Morrow's commentary when a specimen is donated to the Barrow (2-3 pages each).
export const MUSEUM_TEXT = {
  // ── Fish
  fish_perch: "The Bog Perch! Note the stripes, hoo: seven dark bars, like the bars of a very small prison.|It thrives in the peaty water of Blackwater. Humble, abundant, and the first fish every child on this island catches.",
  fish_pike: "The Old Pike. A lake tyrant with a jaw like a bear trap. This one is thirty winters old at least. Older than the jetty.|The old tales say pike swallow the moon's reflection. Nonsense, of course. Though its belly does look, hoo, rather full.",
  fish_eel: "The Mire Eel. Hoo. It is still moving. Why is it still moving? It is, hoo, very much still moving.|Eels are born in the deep sea and swim all the way to our lake. A long journey to end up in a mud-hole. Relatable.",
  fish_carp: "A Ghost Carp! Pale as candle wax. Its scales are nearly translucent... hoo, I can see its heart beating.|The old folk called them the souls of drowned lanterns. Unscientific. But look at it glow. I understand the urge.",
  fish_herring: "The Grey Herring. Backbone of northern life: salted, smoked, pickled and sung about.|Whole villages were founded on herring. Ours included, I suspect. A plain fish. A crucial one. Like a good index.",
  fish_cod: "The Rimecod! Note the frost-like flecks along the flank. It comes to our waters when the sea turns cold.|Dried cod once fed longship crews for months at sea. They say it tastes like a boot. Fennick says it tastes like home.",
  fish_mackerel: "A Tide Mackerel. Look at that stripe, hoo, like wind moving over water. Swift, restless, forever elsewhere.|Mackerel hunt in schools. I was in a school once. The mackerel were considerably better behaved.",
  fish_hagfish: "Ah. The Hagfish. No jaws, no scales, and, hoo, a great deal of slime. I am choosing to find it fascinating.|Ancient, primitive, and utterly unbothered by the opinions of others. I admire it deeply. From across the room.",
  fish_angler: "The Lantern-Angler! A living lamp in the deep, luring the unwary into the dark. Rather like the Gloam, hoo, with fins.|Sailors mistook them for drowned stars. Mothwyn will want to visit it daily. I shall install a bench.",
  fish_sovereign: "The Drowned Sovereign. Hoo. Hoo. I... I need a moment. The crown upon its head is barnacle and old gold.|Fennick swore it was real. For sixteen years I called him a liar. I shall have to apologise. In writing. Publicly. Hoo.",

  // ── Bugs (Morrow is being very brave)
  bug_moth: "An Ash Moth. Soft, grey, dusty... hoo... it is on my sleeve. It is ON MY SLEEVE. Jar. Jar, please!|...Thank you. Ash Moths are drawn to flame, and so to people. I shall not hold it against Mothwyn's side of the family.",
  bug_deathshead: "A Death's-head Moth. Note the skull pattern on its back. A bone motif! On a bug. I am, hoo, deeply conflicted.|It squeaks when disturbed. So did I. We have that in common, and I shall not examine the matter further.",
  bug_firefly: "A Gloam Firefly. Its abdomen glows by some chemical trickery. I admit it is, hoo, rather lovely. In the jar.|The old folk called them 'lost sparks of the Hearth.' If only more insects had the decency to be sparks.",
  bug_beetle: "A Bark Beetle. It chews tunnels beneath bark in patterns like tiny runes. I have tried to read them. Gibberish.|Please keep the lid on. It has six legs and no respect whatsoever for scholarship. Hoo.",
  bug_grave_beetle: "A Grave Beetle. It lives among my graves. MY graves. I have lived beside it for years. Unaware. Hoo. Hoo.|A tidy insect, I am told, that keeps the old stones clean. I shall nonetheless sleep with a candle lit tonight.",
  bug_dragonfly: "The Fen Dragonfly. Four wings, each moving on its own. Why four? Nobody needs four, hoo, of anything.|An ancient lineage, older than the owls. That is its only redeeming feature. Please ensure it cannot escape.",
  bug_lanternfly: "A Lanternfly. Its snout glows softly, like a lantern carried by a very small and very confusing person.|Mothwyn has asked to visit it. I have agreed. I shall observe from behind the pillar. For, hoo, scholarly perspective.",
  bug_mistmoth: "A Mist Moth. Almost translucent. It drifts through the Mistwood fog like the ghost of a moth. Hoo. I dislike that.|Some say they are born of the Gloam itself. Others say they are merely pale. I have decided they are merely pale.",

  // ── Relics
  relic_coin: "A Tarnished Coin. Silver, stamped with a king's face, worn down to the suggestion of a nose.|Traders came from far south for our furs and amber. Corvin claims they were all ravens. Unverified. Hoo. Highly unverified.",
  relic_comb: "A Bone Comb! Carved from antler, with a knotwork spine. The first settlers were extremely well groomed.|Every comb is a small argument against despair. Someone, in the dark, still wished to look nice. Hoo. Lovely.",
  relic_tablet: "A Rune Tablet! It reads... 'Feed the fire, and the fire shall feed you.' Hoo! One of the first Hearth-rites!|I shall need several days, a magnifying lens and absolutely no interruptions. This is the best day of my year.",
  relic_brooch: "A Bronze Brooch, shaped like a dragon curled around to bite its own tail. It once pinned a cloak at the shoulder.|Its owner was clearly a person of taste. Corvin will want to buy it. Corvin may not. It is, hoo, history.",
  relic_horn: "A Drinking Horn, rimmed in bronze. The settlers carried the first ember over the sea inside a horn like this.|Or they drank mead from it. Most horns saw both duties. The finest, hoo, on the same night.",
  relic_crown: "A Rusted Crown. Iron, salt-pitted. It came out of the sea... or went into it, a very long time ago.|Fennick claims a drowned king wears its twin beneath the dock. Superstition. Hoo. Probably. I shall lock the case.",
  relic_amber: "Amber Beads! Tree resin, hardened over untold ages. Each bead holds a little trapped sunlight.|Hoo. One of them also holds an ancient... insect. How... wonderful. I shall display that bead facing the wall.",
  relic_idol: "A Carved Idol with an antlered head. Hoo. I do not like the way it looks at me. Nor the way it doesn't.|The antlers match the Mist-Stag of the runestones. A warding figure, I believe. Or a warning.",
};

// Runestones scattered across the island, telling its history in order.
export const RUNESTONES = [
  {
    id: 'rs1',
    title: 'The Grey Sails',
    text: "We came in grey ships from the drowned lands, where the sea rose over our fields and the old fires went out.|We carried one ember in a horn and fed it with our breath across nine nights of storm.|On the ninth night the fog opened. An island lay before us, green and silent, with a great ash at its heart. We named it the Hollow.",
  },
  {
    id: 'rs2',
    title: 'The Great Hearth',
    text: "Here we built the Great Hearth, and lit it from the ember in the horn. The mist drew back, and the island let us stay.|Six runes we carved on its stones, for six gifts: of the wood, the soil, the deep, the wild, the dark, and the folk.|Give to the fire what the island gives to you, and the fire will keep the night at bay. This is the rite. Do not forget it.",
  },
  {
    id: 'rs3',
    title: 'The Ash That Holds the Sky',
    text: "In the Mistwood stands the ash whose roots drink the sea and whose branches hold up the hem of the sky.|On its leaves grazes a pale stag. From its antlers falls the dew that fills our wells and rises as the morning mist.|The stag keeps the tree. The tree keeps the island. The Hearth keeps the folk. So the balance is held.",
  },
  {
    id: 'rs4',
    title: 'The Gloam',
    text: "Years passed. The folk grew comfortable. The gifts grew small. The rite was spoken, then mumbled, then forgotten.|The Hearth dimmed, and the stag's thirst turned. It drank not dew but light, and the mist it breathed grew teeth.|From the mist crept the Gloam: gloamlings of twig and shadow, and wraiths that remember faces but not names.",
  },
  {
    id: 'rs5',
    title: 'Ashhorn, the Mist-Stag',
    text: "Beware the stag of the ash, whose antlers are pale as cinders. Ashhorn we name it now, the Drinker of Light.|Where it walks, lamps gutter and memory fades. It sleeps at the old altar in the Mistwood and will not wake for the unready.|Only when six runes burn will the altar call it forth. Meet it with fire. Take its crown of antler. Give it to the Hearth.",
  },
  {
    id: 'rs6',
    title: "Solveig's Stone",
    text: "I, Solveig, carved this. Fifty winters I fed the Hearth, long after the others stopped believing in the rite.|Once I went to the altar before the runes were lit. I was young and proud. The stag broke my lantern and sent me home grey.|To the child of my child: the fire remembers who tends it. So do I. Be braver than me, and wiser. Mind Grenna. Pay Corvin.",
  },
  {
    id: 'rs7',
    title: 'The Dawn Rune',
    text: "When the long gloam is at its darkest, one will come across the grey water, owing much and owning little.|They will feed the six runes, and the Hearth will roar. They will walk into the Mistwood with fire in hand.|The antler will burn upon the stones. The sun will climb the ash again, and the Hollow will wake to morning.",
  },
];

// Notices pinned to the board on Hollow Green (the ones Grenna hasn't eaten yet).
export const NOTICE_BOARD = [
  "LOST: one (1) eye. Last seen near a fish the size of a longship. If found, keep it. I've grown fond of the patch. — F.",
  "PLEASE STOP EATING THE NOTICES. This means you. You know who you are. You have horns. — C.",
  "Stew. Forge. Tonight. Bring bowl. — B.",
  "To whoever keeps leaving beetles on the Barrow step: it is not funny. It has never been funny. — Morrow, Keeper",
  "Lantern oil is for LANTERNS, not for Fennick's 'sea tonic'... sorry... thank you... — Mothwyn",
  "CORVIN'S CURIOS: seeds, supplies and curiosities. Credit extended to deserving clients. (Current number of deserving clients: one.)",
  "Remedies for coughs, colds, bad luck and bad company. Results guaranteed, or your complaint will be eaten. — Grenna",
  "The Northern Antiquarian Society meets Thursday at the Barrow. Expected attendance: 1. Refreshments: porridge. — M.",
  "To the kind spirit who mends the lantern posts at night: thank you... I left you a candle by the well... — M. (the other M.)",
  "REMINDER: the Gloam does not respect property lines. Keep a torch lit. Keep two. Torches now on sale. — C.",
];

// The six Hearth offerings, plus the final rite.
export const OFFERINGS_TEXT = {
  kindling: {
    name: 'Kindling',
    blurb: "Wood, stone and resin: the bones of every fire. Give the Hearth something to stand on.",
    complete: "The Kindling rune flares amber. Warmth rolls across the green and the fog steps back. You've learned to build a brazier.",
  },
  soil: {
    name: 'Soil',
    blurb: "Turnips, carrots and onions from your own croft. The island feeds the fire that shelters it.",
    complete: "The Soil rune glows green-gold, and the fields seem to sigh. You receive two rain totems, and the knowledge to carve more.",
  },
  deep: {
    name: 'The Deep',
    blurb: "Perch, pike, herring and eel, from lake and sea. The dark waters remember the fire too.",
    complete: "The Deep rune shimmers like light on water. Down on Greyshore, the old ship's bell rings once. You receive a bone-hook rod.",
  },
  wild: {
    name: 'The Wild',
    blurb: "Red mushrooms, raspberries, thistles and dandelions. What grows untended, freely given.",
    complete: "The Wild rune blooms with the scent of wet moss. Grenna nods, just once. You've learned to make a cauldron.",
  },
  dark: {
    name: 'The Dark',
    blurb: "Gloam essence, bone and copper ore: spoils won from the night. Even the dark must pay its due.",
    complete: "The Dark rune burns cold violet, then warm. From the ashes you draw the Ember Blade, its edge aglow like a coal.",
  },
  tithe: {
    name: 'The Tithe',
    blurb: "Coin, given to the fire in the old way. Every Hearth is kept by the folk who pay its keep.",
    complete: "The Tithe rune rings like a struck coin. Corvin dabs his eye with a wingtip. His decor catalogue is now open to you.",
  },
  final: {
    name: 'The Dawn Rite',
    blurb: "Six runes burn. The altar in the Mistwood has woken. Defeat Ashhorn, and lay its antler on the Hearth.",
    complete: "The antler catches. The Great Hearth roars white and gold, and far above the mist, the sun remembers the way.",
  },
};

// Opening narration (one page per entry).
export const INTRO = [
  "Cold water. Grey light. The hush of waves on shingle, and somewhere far off, the slow tolling of a ship's bell.",
  "You wake on a shore of black stones. The fog is so thick the sea seems to end an arm's length away.",
  "In your coat, a letter, salt-stained but dry. The hand is your grandmother's. 'To the child of my child.'",
  "'The croft is yours now. Tend the soil. Keep the fires lit. Mind the goat. And pay the Raven. He is not as cold as he pretends.'",
  "'The Hearth is failing, my love, and I am too tired to feed it. I am sorry to leave you this. I am glad to leave you this.'",
  "Beyond the dunes, through the drifting mist, a single great fire burns low at the heart of a village. Gloamhollow.",
  "Something with black wings settles on a post beside you, smooths its feathers, and politely clears its throat.",
];

// Ending narration after Ashhorn falls (one page per entry).
export const ENDING = [
  "Ashhorn sinks to its knees among the pines. The mist around it shivers and thins, and for a moment looks almost like dew.",
  "Its antler comes away in your hands, pale and cold and lighter than it should be. Somewhere deep in the Mistwood, a great tree sighs.",
  "You carry it home through the hushed forest. The Gloam does not follow. Behind you, the old altar goes dark and still.",
  "On the Great Hearth, the antler catches like dry birch. The fire roars up white and gold, and all six runes blaze as one.",
  "The fog lifts from the green, from the fields, from the grey sea. One by one, the villagers step out of their doors, blinking.",
  "And over the rim of the world, slow and astonished, the sun climbs clear of the mist over Gloamhollow, as it has not for a lifetime.",
  "It is not the end of the dark, only the end of the long night. The island still asks for tending. You will not tend it alone.",
  "Dawn has returned to Gloamhollow. The story continues...",
];

// Loading / sleep-screen tips. Controls referenced: WASD, Shift, Space, E, left click,
// right-drag camera, mouse wheel zoom, 1-0, Tab, C, M, Esc.
export const TIPS = [
  "WASD to walk. Hold Shift to sprint, but mind your stamina.",
  "Press Space to dodge-roll out of harm's way. It costs a little stamina.",
  "Press E to talk to villagers and interact with the world around you.",
  "Left click uses whatever tool or item is in your hand.",
  "Keys 1 to 0 pick items from your hotbar.",
  "Tab opens your inventory. C opens crafting. M unrolls the island map.",
  "Hold the right mouse button and drag to turn the camera. Use the mouse wheel to zoom.",
  "Press Esc to pause and catch your breath.",
  "The Gloam will not enter a lit fire's light. When in doubt, stand by a flame.",
  "Linger near a fire for a little while to become Rested. Your stamina will recover faster.",
  "Cooked food heals you, and a hearty meal can leave you Well Fed, raising your maximum health.",
  "Water your crops every day. When it rains, the sky does it for you.",
  "Drop anything you want to sell into the tithe crate by your door. Corvin pays overnight.",
  "Sleep at your house door to end the day. Your progress is saved while you sleep.",
  "Stay up past 2 am and you'll collapse where you stand, then wake at home with a lighter purse.",
  "Fog and storms embolden the Gloam. Carry a torch, or better yet, place a few.",
  "Chat with villagers daily, and give each of them one gift a day. Friendship grows like frostroot: slowly, but surely.",
  "Glinting cracks in the earth hide relics. Dig them up and bring them to Morrow at the Barrow.",
  "Bramble can upgrade your tools at the forge, first to copper, then to iron.",
  "Crops only grow in their own season. In Deepfrost, only frostroot will brave the snow.",
];

// Shown when you wake at home after being claimed by the Gloam.
export const DEATH_LINES = [
  "The Gloam let you go, this time. You wake at home, cold to the bone, with fewer coins than you remember.",
  "You dreamed of mist and pale antlers. You wake in your own bed. Someone left a lantern burning by the door.",
  "Somehow you're home. The fire is low, your purse is lighter, and the dark outside is pretending it did nothing.",
  "You wake with frost in your hair and the taste of ash in your mouth. The Gloam took some coin, but none of your courage.",
  "Grey light. Your own ceiling. A goat-shaped shadow at the window, and then it's gone. You're alive. Poorer, but alive.",
];

// Shown when you collapse after 2 am.
export const PASSOUT_LINES = [
  "You collapse in a heap. Someone carried you home. Your purse is lighter. Corvin sends his regards, and an invoice.",
  "Past two in the morning, the island simply switches you off. You wake at home, missing some coins and most of your dignity.",
  "You fell asleep standing up. Bramble found you, grunted, and carried you home. Your purse came back lighter than you did.",
  "Your legs give out. You wake in bed, tucked in with suspicious care. A note on the pillow: 'Sleep, sprat. — F.'",
  "You wake at home with no memory of the walk. A few coins are gone. On your pillow lies a single black feather.",
];

// Cozy lines for the end-of-day screen.
export const SLEEP_LINES = [
  "The fire crackles low. Outside, the mist presses at the shutters, and cannot come in.",
  "You fall asleep to the hush of the sea and the far-off tolling of the ship's bell.",
  "Peat smoke, wool blankets, the tick of cooling embers. Tomorrow can wait until tomorrow.",
  "Across the green, Mothwyn's lanterns keep their watch through the night.",
  "Your hands smell of soil and woodsmoke. It's a good smell. A home smell.",
  "The Hearth glows through the fog like a slow heartbeat. You count its pulses, and sleep.",
  "Rain taps on the turf roof. Out in the field, the seeds drink deep and dream of sun.",
  "Your grandmother's old quilt still smells faintly of heather. You sleep soundly beneath it.",
];

export const SEASON_NAMES = { spring: 'Thaw', summer: 'Brightwane', autumn: 'Rotfall', winter: 'Deepfrost' };

// Wooden signpost texts.
export const SIGNS = {
  home: "SOLVEIG'S CROFT|Beneath the old name, in fresh and careful carving: 'and now her grandchild's.'",
  village: "HOLLOW GREEN — The Great Hearth.|North: the Barrow. North-east: the Mistwood. East: Blackwater. South: Greyshore. West: Birchmeadow.|South-west: the old croft.",
  barrow: "THE BARROW — Museum of Gloamhollow. Keeper: Morrow. Always open.|Fish, relics and insects gratefully received. Insects less gratefully.",
  mistwood: "THE MISTWOOD. Turn back after dusk.|Scratched below in another hand: 'Turn back before dusk, too.'",
  dock: "GREYSHORE DOCK. Fishing welcome. Swimming unwise.|Do not wake the Sovereign. — F.",
  lake: "BLACKWATER. Deep, cold and full of opinions.|Perch by day, eels in the rain. Fish at your own risk.",
  meadow: "BIRCHMEADOW. Berries, blossoms and bugs.|Please do not pick the lanterns... — M.",
};
