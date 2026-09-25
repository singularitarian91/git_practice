// Shop stock, hearth offerings, villager configuration, dig tables.

// Corvin's Curios.  `season` limits seeds; `unlock` needs a save flag.
export const SHOP = [
  { id: 'seeds_turnip', season: ['spring'] },
  { id: 'seeds_carrot', season: ['spring'] },
  { id: 'seeds_onion', season: ['spring', 'summer'] },
  { id: 'seeds_flax', season: ['summer'] },
  { id: 'seeds_barley', season: ['summer', 'autumn'] },
  { id: 'seeds_beet', season: ['summer', 'autumn'] },
  { id: 'seeds_pumpkin', season: ['autumn'] },
  { id: 'seeds_nightshade', season: ['autumn'] },
  { id: 'seeds_frostroot', season: ['winter'] },
  { id: 'torch_standing', price: 45 },
  { id: 'resin', price: 20 },
  { id: 'food_mead', price: 120 },
  { id: 'food_bread', price: 150 },
  { id: 'recipe_lantern', price: 300, recipe: 'recipe_lantern', name: 'Recipe: Lantern Post' },
  { id: 'bench', price: 160, unlock: 'decor' },
  { id: 'barrel', price: 140, unlock: 'decor' },
  { id: 'banner', price: 220, unlock: 'decor' },
  { id: 'flower_pot', price: 90, unlock: 'decor' },
  { id: 'hay_bale', price: 120, unlock: 'decor' },
  { id: 'cart', price: 480, unlock: 'decor' },
  { id: 'skull_pike', price: 150, unlock: 'decor' },
  { id: 'beehive', price: 260, unlock: 'decor' },
  { id: 'bed_roll', price: 200, unlock: 'decor' },
];

export const DEBT_START = 3000;
export const LONGHOUSE_COST = 9000;

// Hearth offerings (Stardew bundles).  `coins` for the tithe.
export const OFFERINGS = [
  { id: 'kindling', items: [['wood', 30], ['stone', 20], ['resin', 5]], reward: 'recipe_brazier' },
  { id: 'soil', items: [['turnip', 5], ['carrot', 5], ['onion', 3]], reward: 'rain_totems' },
  { id: 'deep', items: [['fish_perch', 1], ['fish_pike', 1], ['fish_herring', 1], ['fish_eel', 1]], reward: 'bone_rod' },
  { id: 'wild', items: [['mushroom_red', 3], ['raspberry', 5], ['thistle', 3], ['dandelion', 3]], reward: 'recipe_cauldron' },
  { id: 'dark', items: [['gloam_essence', 5], ['bone', 5], ['copper_ore', 5]], reward: 'ember_blade' },
  { id: 'tithe', coins: 1500, items: [], reward: 'decor' },
];

// Villagers.  Schedules: [fromHour, toHour, place, behaviour]; hours may wrap.
// Places are resolved to coordinates by the NPC system.
export const VILLAGERS = {
  corvin: {
    name: 'Corvin', model: 'npc_corvin', voice: 'corvin', house: 'shop', title: 'Merchant',
    schedule: [[8, 20, 'shop', 'stand']],
    loved: ['ember', 'relic_amber', 'relic_brooch', 'relic_coin'],
    liked: ['nightshade', 'fish_herring', 'raspberry', 'gloam_essence', 'food_berry_pie'],
    disliked: ['stone', 'fiber', 'turnip', 'bone'],
    requests: ['fish_herring', 'raspberry', 'resin', 'copper_ore', 'mushroom_red', 'flax', 'beet'],
  },
  morrow: {
    name: 'Morrow', model: 'npc_morrow', voice: 'morrow', house: 'barrow', title: 'Keeper of the Barrow',
    schedule: [[0, 24, 'barrow', 'stand']],
    loved: ['relic_tablet', 'relic_idol', 'mushroom_glow', 'food_porridge'],
    liked: ['fish_perch', 'food_bread', 'bone', 'relic_horn', 'hazelnut'],
    disliked: [{ cat: 'bug' }, 'nightshade'],
    requests: ['bone', 'fish_perch', 'hazelnut', 'flint', 'mushroom_yellow', 'coal'],
  },
  bramble: {
    name: 'Bramble', model: 'npc_bramble', voice: 'bramble', house: 'house_bramble', title: 'Smith',
    schedule: [[8, 17, 'forge', 'work'], [17, 21, 'green', 'wander']],
    loved: ['iron_ore', 'food_stew', 'food_mead'],
    liked: ['copper_ore', 'coal', 'food_cooked_meat', 'bone', 'flint'],
    disliked: ['dandelion', 'fiber', 'raspberry', 'thistle'],
    requests: ['coal', 'copper_ore', 'wood', 'stone', 'flint', 'raw_meat', 'onion'],
  },
  mothwyn: {
    name: 'Mothwyn', model: 'npc_mothwyn', voice: 'mothwyn', house: 'house_mothwyn', title: 'Lamplighter',
    schedule: [[8, 12, 'meadow', 'wander'], [12, 18, 'home_yard', 'wander'], [18, 23, 'lanterns', 'lanterns']],
    loved: ['ember', 'flax', 'food_berry_pie', 'mushroom_glow'],
    liked: ['dandelion', 'thistle', 'resin', 'blueberry', 'cloudberry'],
    disliked: ['bug_moth', 'bug_mistmoth', 'gloam_essence', 'coal'],
    requests: ['resin', 'dandelion', 'blueberry', 'flax', 'fiber', 'thistle'],
  },
  grenna: {
    name: 'Grenna', model: 'npc_grenna', voice: 'grenna', house: 'house_grenna', title: 'Herbalist',
    schedule: [[7, 12, 'forest_edge', 'wander'], [12, 19, 'home_yard', 'wander'], [19, 22, 'green', 'hearth']],
    loved: ['thistle', 'mushroom_yellow', 'nightshade', 'frostroot'],
    liked: ['dandelion', 'onion', 'turnip', 'beet', 'hazelnut'],
    disliked: [{ cat: 'fish' }, 'raw_meat', 'food_cooked_meat'],
    requests: ['thistle', 'dandelion', 'mushroom_red', 'turnip', 'carrot', 'onion', 'beet'],
  },
  fennick: {
    name: 'Fennick', model: 'npc_fennick', voice: 'fennick', house: 'house_fennick', title: 'Fisherman',
    schedule: [[5, 11, 'sea_dock', 'fish'], [11, 17, 'beach', 'wander'], [17, 22, 'green', 'hearth']],
    loved: ['fish_sovereign', 'fish_angler', 'food_grilled_fish', 'food_mead'],
    liked: [{ cat: 'fish' }, 'food_cooked_meat', 'relic_horn', 'cloudberry'],
    disliked: ['fiber', 'stone', 'turnip'],
    requests: ['fish_perch', 'fish_herring', 'fish_mackerel', 'fish_eel', 'food_grilled_fish', 'wood', 'fiber'],
  },
};

// What a hoe turns up at a glinting dig spot.
export const DIG_TABLE = [
  ['relic', 55], ['flint', 12], ['bone', 10], ['coal', 8], ['copper_ore', 6], ['stone', 9],
];

// Weather odds per season (weights).
export const WEATHER_ODDS = {
  spring: { clear: 3, overcast: 3, fog: 2, rain: 3, storm: 1 },
  summer: { clear: 5, overcast: 2, fog: 1, rain: 2, storm: 1 },
  autumn: { clear: 2, overcast: 3, fog: 3, rain: 3, storm: 1 },
  winter: { clear: 2, overcast: 3, fog: 2, snow: 4, storm: 1 },
};
