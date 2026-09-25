// Crafting & cooking recipes.  `station` says where it is made;
// `unlock` names a save flag that must be set (null = known from the start).
// Ingredients may be an item id or a category: { cat: 'fish', qty: 1 }.

export const RECIPES = [
  // --- workbench: essentials ---
  { id: 'torch_standing', out: ['torch_standing', 1], in: [['wood', 2], ['resin', 1]], station: 'workbench', unlock: null },
  { id: 'campfire', out: ['campfire', 1], in: [['stone', 5], ['wood', 4]], station: 'workbench', unlock: null },
  { id: 'fence_wood', out: ['fence_wood', 2], in: [['wood', 3]], station: 'workbench', unlock: null },
  { id: 'chest', out: ['chest', 1], in: [['wood', 12]], station: 'workbench', unlock: null },
  { id: 'scarecrow', out: ['scarecrow', 1], in: [['wood', 4], ['fiber', 12]], station: 'workbench', unlock: null },
  { id: 'workbench', out: ['workbench', 1], in: [['wood', 12], ['flint', 2]], station: 'workbench', unlock: null },
  { id: 'brazier', out: ['brazier', 1], in: [['stone', 6], ['copper_ore', 2], ['coal', 1]], station: 'workbench', unlock: 'recipe_brazier' },
  { id: 'lantern_post', out: ['lantern_post', 1], in: [['wood', 4], ['copper_ore', 1], ['resin', 2]], station: 'workbench', unlock: 'recipe_lantern' },
  { id: 'rain_totem', out: ['rain_totem', 1], in: [['stone', 12], ['gloam_essence', 1]], station: 'workbench', unlock: 'recipe_rain_totem' },
  { id: 'cauldron', out: ['cauldron', 1], in: [['copper_ore', 6], ['stone', 4]], station: 'workbench', unlock: 'recipe_cauldron' },
  // --- workbench: decor ---
  { id: 'bench', out: ['bench', 1], in: [['wood', 8]], station: 'workbench', unlock: null },
  { id: 'barrel', out: ['barrel', 1], in: [['wood', 8]], station: 'workbench', unlock: null },
  { id: 'wood_pile', out: ['wood_pile', 1], in: [['wood', 15]], station: 'workbench', unlock: null },
  { id: 'planter_box', out: ['planter_box', 1], in: [['wood', 6], ['dandelion', 2]], station: 'workbench', unlock: null },
  { id: 'flower_pot', out: ['flower_pot', 1], in: [['stone', 4], ['dandelion', 1]], station: 'workbench', unlock: null },
  { id: 'skull_pike', out: ['skull_pike', 1], in: [['wood', 3], ['bone', 4]], station: 'workbench', unlock: null },
  { id: 'drying_rack', out: ['drying_rack', 1], in: [['wood', 8], ['fiber', 4]], station: 'workbench', unlock: null },
  { id: 'bed_roll', out: ['bed_roll', 1], in: [['leather', 4], ['fiber', 6]], station: 'workbench', unlock: null },
  { id: 'banner', out: ['banner', 1], in: [['wood', 4], ['leather', 2]], station: 'workbench', unlock: 'decor' },
  { id: 'weapon_rack', out: ['weapon_rack', 1], in: [['wood', 10], ['copper_ore', 1]], station: 'workbench', unlock: 'decor' },
  { id: 'hay_bale', out: ['hay_bale', 1], in: [['fiber', 20]], station: 'workbench', unlock: 'decor' },
  { id: 'crate_stack', out: ['crate_stack', 1], in: [['wood', 12]], station: 'workbench', unlock: 'decor' },
  { id: 'cart', out: ['cart', 1], in: [['wood', 20], ['copper_ore', 2]], station: 'workbench', unlock: 'decor' },
  { id: 'beehive', out: ['beehive', 1], in: [['wood', 6], ['fiber', 10]], station: 'workbench', unlock: 'decor' },
  // --- campfire cooking ---
  { id: 'food_cooked_meat', out: ['food_cooked_meat', 1], in: [['raw_meat', 1]], station: 'campfire', unlock: null },
  { id: 'food_grilled_fish', out: ['food_grilled_fish', 1], in: [[{ cat: 'fish', except: ['fish_sovereign'] }, 1]], station: 'campfire', unlock: null },
  { id: 'food_roast_roots', out: ['food_roast_roots', 1], in: [['turnip', 1], ['carrot', 1]], station: 'campfire', unlock: null },
  { id: 'food_mushroom_skewer', out: ['food_mushroom_skewer', 1], in: [['mushroom_red', 2]], station: 'campfire', unlock: null },
  // --- cauldron (Grenna's recipes) ---
  { id: 'food_stew', out: ['food_stew', 1], in: [['raw_meat', 1], ['carrot', 1], ['onion', 1]], station: 'cauldron', unlock: 'recipe_cauldron' },
  { id: 'food_bread', out: ['food_bread', 1], in: [['barley', 3]], station: 'cauldron', unlock: 'recipe_cauldron' },
  { id: 'food_berry_pie', out: ['food_berry_pie', 1], in: [['raspberry', 3], ['blueberry', 2], ['barley', 1]], station: 'cauldron', unlock: 'recipe_cauldron' },
  { id: 'food_porridge', out: ['food_porridge', 1], in: [['barley', 1], ['blueberry', 2]], station: 'cauldron', unlock: 'recipe_cauldron' },
];

// Tool upgrades at Bramble's forge (level 0 → 1 → 2)
export const UPGRADES = [
  { level: 1, name: 'Copper', coins: 450, ore: ['copper_ore', 6] },
  { level: 2, name: 'Iron', coins: 1400, ore: ['iron_ore', 6] },
];
export const UPGRADABLE = ['tool_hoe', 'tool_can', 'tool_axe', 'tool_pickaxe', 'tool_sword'];
