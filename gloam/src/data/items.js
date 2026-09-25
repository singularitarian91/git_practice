// Every item in the game.  `price` is what the tithe crate / Corvin pays.
// cat: material | crop | seed | forage | fish | bug | relic | food | tool | place | decor | special

const I = {};
function def(id, name, cat, price, extra = {}) {
  I[id] = { id, name, cat, price, stack: 99, model: extra.model || `item_${id}`, ...extra };
}

// --- materials ---
def('wood', 'Wood', 'material', 2);
def('stone', 'Stone', 'material', 2);
def('flint', 'Flint', 'material', 6);
def('copper_ore', 'Copper Ore', 'material', 14);
def('iron_ore', 'Iron Ore', 'material', 24);
def('resin', 'Resin', 'material', 6);
def('fiber', 'Fiber', 'material', 1);
def('bone', 'Bone Fragments', 'material', 8);
def('gloam_essence', 'Gloam Essence', 'material', 30);
def('ember', 'Hearth Ember', 'material', 80);
def('leather', 'Leather Scraps', 'material', 12);
def('feather', 'Feather', 'material', 5);
def('coal', 'Coal', 'material', 6);
def('raw_meat', 'Raw Venison', 'material', 18, { model: 'item_meat_raw' });

// --- crops & seeds ---
export const CROPS = {
  turnip: { name: 'Turnip', seasons: ['spring'], days: 4, seed: 20, sell: 45, color: '#b98ac0', eat: [6, 12] },
  carrot: { name: 'Carrot', seasons: ['spring'], days: 5, seed: 25, sell: 58, color: '#d9782d', eat: [8, 14] },
  onion: { name: 'Onion', seasons: ['spring', 'summer'], days: 6, seed: 30, sell: 72, color: '#c89a5a' },
  flax: { name: 'Flax', seasons: ['summer'], days: 5, seed: 25, sell: 50, color: '#6f86b8', extra: { fiber: 3 } },
  barley: { name: 'Barley', seasons: ['summer', 'autumn'], days: 4, seed: 20, sell: 32, color: '#c9a95c' },
  beet: { name: 'Beet', seasons: ['summer', 'autumn'], days: 5, seed: 30, sell: 76, color: '#8d2440', eat: [8, 12] },
  pumpkin: { name: 'Pumpkin', seasons: ['autumn'], days: 8, seed: 60, sell: 230, color: '#d4762a' },
  nightshade: { name: 'Nightshade', seasons: ['autumn'], days: 6, seed: 50, sell: 140, color: '#5a2f80' },
  frostroot: { name: 'Frostroot', seasons: ['winter'], days: 7, seed: 70, sell: 190, color: '#9fd4e8', eat: [10, 20] },
};
for (const [id, c] of Object.entries(CROPS)) {
  def(id, c.name, 'crop', c.sell, c.eat ? { edible: { hp: c.eat[0], stamina: c.eat[1] } } : {});
  def(`seeds_${id}`, `${c.name} Seeds`, 'seed', Math.round(c.seed / 2), { model: 'item_seeds', tint: c.color, crop: id, buy: c.seed });
}

// --- forage ---
def('mushroom_red', 'Red Mushroom', 'forage', 18, { model: 'mushroom_red', edible: { hp: 8, stamina: 10 } });
def('mushroom_yellow', 'Yellow Mushroom', 'forage', 28, { model: 'mushroom_yellow', edible: { hp: 10, stamina: 14 } });
def('mushroom_glow', 'Glowcap', 'forage', 48, { model: 'mushroom_glow' });
def('raspberry', 'Raspberries', 'forage', 10, { edible: { hp: 5, stamina: 9 } });
def('blueberry', 'Blueberries', 'forage', 12, { edible: { hp: 6, stamina: 10 } });
def('thistle', 'Thistle', 'forage', 16, { model: 'thistle' });
def('dandelion', 'Dandelion', 'forage', 9, { model: 'dandelion', edible: { hp: 3, stamina: 6 } });
def('cloudberry', 'Cloudberries', 'forage', 34, { edible: { hp: 10, stamina: 15 } });
def('hazelnut', 'Hazelnut', 'forage', 20, { edible: { hp: 5, stamina: 10 } });

// --- fish ---
export const FISH = {
  fish_perch: { name: 'Bog Perch', where: ['lake'], hours: [6, 20], seasons: ['spring', 'summer', 'autumn'], price: 30, diff: 0.25, rarity: 10, move: 'smooth' },
  fish_pike: { name: 'Old Pike', where: ['lake'], hours: [6, 24], seasons: ['spring', 'autumn', 'winter'], price: 62, diff: 0.5, rarity: 6, move: 'dart' },
  fish_eel: { name: 'Mire Eel', where: ['lake', 'stream'], hours: [18, 2], seasons: ['spring', 'summer', 'autumn', 'winter'], price: 78, diff: 0.6, rarity: 5, move: 'sink', rainBonus: true },
  fish_carp: { name: 'Ghost Carp', where: ['lake'], hours: [22, 2], seasons: ['autumn', 'winter'], price: 160, diff: 0.7, rarity: 2, move: 'mixed' },
  fish_herring: { name: 'Grey Herring', where: ['sea'], hours: [6, 18], seasons: ['spring', 'summer', 'autumn', 'winter'], price: 24, diff: 0.2, rarity: 12, move: 'smooth' },
  fish_cod: { name: 'Rimecod', where: ['sea'], hours: [6, 24], seasons: ['autumn', 'winter'], price: 58, diff: 0.45, rarity: 7, move: 'sink' },
  fish_mackerel: { name: 'Tide Mackerel', where: ['sea'], hours: [6, 18], seasons: ['spring', 'summer'], price: 46, diff: 0.4, rarity: 8, move: 'dart' },
  fish_hagfish: { name: 'Hagfish', where: ['sea'], hours: [18, 6], seasons: ['spring', 'summer', 'autumn', 'winter'], price: 72, diff: 0.55, rarity: 5, move: 'mixed' },
  fish_angler: { name: 'Lantern-Angler', where: ['sea'], hours: [22, 4], seasons: ['spring', 'summer', 'autumn', 'winter'], price: 190, diff: 0.78, rarity: 2, move: 'dart' },
  fish_sovereign: { name: 'Drowned Sovereign', where: ['dock'], hours: [0, 4], seasons: ['winter'], price: 900, diff: 0.92, rarity: 1, move: 'mixed', legendary: true },
};
for (const [id, f] of Object.entries(FISH)) def(id, f.name, 'fish', f.price, { model: id });

// --- bugs ---
export const BUGS = {
  bug_moth: { name: 'Ash Moth', hours: [19, 4], seasons: ['spring', 'summer', 'autumn'], where: 'lights', price: 22, rarity: 10, move: 'flutter' },
  bug_deathshead: { name: "Death's-head Moth", hours: [21, 3], seasons: ['autumn'], where: 'lights', price: 150, rarity: 2, move: 'flutter' },
  bug_firefly: { name: 'Gloam Firefly', hours: [20, 2], seasons: ['summer'], where: 'meadow', price: 45, rarity: 8, move: 'glow' },
  bug_beetle: { name: 'Bark Beetle', hours: [8, 17], seasons: ['spring', 'summer', 'autumn'], where: 'trees', price: 26, rarity: 9, move: 'crawl' },
  bug_grave_beetle: { name: 'Grave Beetle', hours: [19, 5], seasons: ['spring', 'summer', 'autumn', 'winter'], where: 'graveyard', price: 85, rarity: 4, move: 'crawl' },
  bug_dragonfly: { name: 'Fen Dragonfly', hours: [9, 17], seasons: ['summer'], where: 'water', price: 38, rarity: 8, move: 'dart' },
  bug_lanternfly: { name: 'Lanternfly', hours: [17, 21], seasons: ['summer', 'autumn'], where: 'forest', price: 64, rarity: 5, move: 'flutter' },
  bug_mistmoth: { name: 'Mist Moth', hours: [20, 5], seasons: ['autumn', 'winter'], where: 'mistwood', price: 125, rarity: 3, move: 'flutter', fogBonus: true },
};
for (const [id, b] of Object.entries(BUGS)) def(id, b.name, 'bug', b.price, { model: id });

// --- relics ---
export const RELICS = {
  relic_coin: { name: 'Tarnished Coin', price: 60, weight: 10 },
  relic_comb: { name: 'Bone Comb', price: 75, weight: 8 },
  relic_tablet: { name: 'Rune Tablet', price: 140, weight: 4 },
  relic_brooch: { name: 'Bronze Brooch', price: 110, weight: 6 },
  relic_horn: { name: 'Drinking Horn', price: 120, weight: 5 },
  relic_crown: { name: 'Rusted Crown', price: 220, weight: 2 },
  relic_amber: { name: 'Amber Beads', price: 160, weight: 4 },
  relic_idol: { name: 'Carved Idol', price: 130, weight: 5 },
};
for (const [id, r] of Object.entries(RELICS)) def(id, r.name, 'relic', r.price, { model: id });

// --- food ---
def('food_cooked_meat', 'Cooked Venison', 'food', 45, { model: 'food_cooked_meat', edible: { hp: 35, stamina: 10, buff: ['wellfed', 240, { maxHp: 25 }] } });
def('food_grilled_fish', 'Grilled Fish', 'food', 50, { model: 'food_grilled_fish', edible: { hp: 30, stamina: 25 } });
def('food_roast_roots', 'Roasted Roots', 'food', 110, { model: 'food_roast_roots', edible: { hp: 25, stamina: 45 } });
def('food_mushroom_skewer', 'Mushroom Skewer', 'food', 40, { model: 'food_mushroom_skewer', edible: { hp: 20, stamina: 30 } });
def('food_stew', 'Hearty Stew', 'food', 180, { model: 'food_stew', edible: { hp: 60, stamina: 40, buff: ['wellfed', 360, { maxHp: 40 }] } });
def('food_bread', 'Barley Bread', 'food', 70, { model: 'food_bread', edible: { hp: 15, stamina: 50, buff: ['hearty', 300, { maxStamina: 25 }] } });
def('food_berry_pie', 'Berry Pie', 'food', 160, { model: 'food_berry_pie', edible: { hp: 50, stamina: 50, buff: ['wellfed', 300, { maxHp: 30, maxStamina: 20 }] } });
def('food_porridge', 'Barley Porridge', 'food', 90, { model: 'food_porridge', edible: { hp: 40, stamina: 30, buff: ['hearty', 300, { maxStamina: 20 }] } });
def('food_mead', 'Honey Mead', 'food', 60, { model: 'food_mead', buy: 120, edible: { hp: 10, stamina: 60, buff: ['mead', 240, { regen: 0.5 }] } });

// --- tools (never stack; upgrade levels live in the save) ---
export const TOOLS = ['tool_hoe', 'tool_can', 'tool_axe', 'tool_pickaxe', 'tool_sword', 'tool_rod', 'tool_net', 'tool_hammer'];
const TOOL_NAMES = {
  tool_hoe: 'Hoe', tool_can: 'Watering Can', tool_axe: 'Axe', tool_pickaxe: 'Pickaxe', tool_sword: 'Sword',
  tool_rod: 'Fishing Rod', tool_net: 'Bug Net', tool_hammer: 'Hammer',
};
for (const t of TOOLS) def(t, TOOL_NAMES[t], 'tool', 0, { stack: 1, model: t });

// --- placeables & decor ---
const PLACE = {
  torch_standing: ['Standing Torch', 12, { light: { color: 0xff9a40, intensity: 7, radius: 8, safe: 7 } }],
  brazier: ['Iron Brazier', 40, { light: { color: 0xff8a30, intensity: 10, radius: 11, safe: 10 } }],
  campfire: ['Campfire', 15, { light: { color: 0xff8a3a, intensity: 9, radius: 9, safe: 8 }, station: 'campfire' }],
  cauldron: ['Cauldron', 60, { light: { color: 0xff7a30, intensity: 5, radius: 6, safe: 5 }, station: 'cauldron' }],
  lantern_post: ['Lantern Post', 45, { light: { color: 0xffc070, intensity: 7, radius: 10, safe: 9 } }],
  rain_totem: ['Rain Totem', 90, { light: { color: 0x6fd0ff, intensity: 1.5, radius: 3 } }],
  scarecrow: ['Scarecrow', 30, {}],
  fence_wood: ['Wooden Fence', 3, {}],
  chest: ['Storage Chest', 25, { station: 'chest' }],
  workbench: ['Workbench', 25, { station: 'workbench' }],
};
for (const [id, [name, price, extra]] of Object.entries(PLACE)) def(id, name, 'place', price, { model: id, place: id, ...extra });
const DECOR = {
  bench: 'Log Bench', barrel: 'Barrel', crate_stack: 'Stacked Crates', hay_bale: 'Hay Bale', cart: 'Hand Cart',
  wood_pile: 'Woodpile', banner: 'Raven Banner', skull_pike: 'Skull Ward', flower_pot: 'Herb Pot',
  drying_rack: 'Drying Rack', weapon_rack: 'Weapon Rack', beehive: 'Skep Hive', planter_box: 'Planter Box', bed_roll: 'Fur Bedroll',
};
for (const [id, name] of Object.entries(DECOR)) def(id, name, 'decor', 20, { model: id, place: id });

// --- special ---
def('trophy_stag', "Ashhorn's Antler", 'special', 0, { stack: 1, model: 'item_trophy_stag' });

export const ITEMS = I;
export const item = (id) => I[id];
export const isFish = (id) => id && id.startsWith('fish_');
export const isBug = (id) => id && id.startsWith('bug_');
export const isRelic = (id) => id && id.startsWith('relic_');
