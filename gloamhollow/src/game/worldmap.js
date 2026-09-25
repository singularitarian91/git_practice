// Hand-authored layout of the isle of Gloamhollow.
// World units are metres. +X is east, +Z is south, y is up.
// A placement's `rot` is a yaw in radians; 0 means the model's front
// (its door / face) points south (+Z).  Use `face(from, to)` to aim one.

export const WORLD = {
  size: 320,          // terrain square edge (m), centred on the origin
  res: 1,             // heightmap cell size (m)
  islandCenter: { x: 2, z: 6 },
  islandRadius: 116,
  seed: 1337,
};

export function face(fx, fz, tx, tz) {
  return Math.atan2(tx - fx, tz - fz);
}

// Key points of interest
export const LOC = {
  hearth: { x: 0, z: 0 },
  croftHut: { x: -40, z: 22 },
  barrow: { x: 0, z: -66 },
  lake: { x: 52, z: 4, r: 18 },
  dock: { x: 22, z: 0 },          // z resolved at runtime to the coastline
  altar: { x: 70, z: -80 },
  meadow: { x: -70, z: -10 },
  mistwood: { x: 62, z: -60 },
  heath: { x: 82, z: 48 },
  stones: { x: -64, z: -58 },
  spawn: { x: -36, z: 24 },       // where a new game starts (just outside the hut door)
};

// Farm field (tillable), in whole metres: tiles x in [x0, x1), z in [z0, z1)
export const FARM = { x0: -60, x1: -44, z0: 27, z1: 42 };

// Terrain flattening pads: height is blended to the pad height inside r,
// fading over `blend` metres.  `h: null` keeps the natural height at the centre.
export const PADS = [
  { x: 0, z: 0, r: 17, blend: 10, h: 6.0 },           // Hollow Green
  { x: -48, z: 30, r: 17, blend: 10, h: 5.2 },        // the croft + field
  { x: 0, z: -64, r: 12, blend: 10, h: 7.0 },         // the Barrow
  { x: -22, z: -6, r: 5, blend: 5, h: 6.0 },          // Bramble
  { x: -12, z: -25, r: 5, blend: 5, h: 6.2 },         // Mothwyn
  { x: 17, z: -26, r: 5, blend: 5, h: 6.6 },          // Grenna
  { x: 70, z: -80, r: 7, blend: 8, h: null },         // altar clearing
  { x: -64, z: -58, r: 8, blend: 8, h: null },        // standing stones hilltop
];

// Buildings & set pieces.  model = asset name in buildings/props.glb
export const BUILDINGS = [
  { id: 'hearth', model: 'hearth_great', x: 0, z: 0, rot: 0 },
  { id: 'shop', model: 'shop_stall', x: 11, z: -7, rot: face(11, -7, 0, 0) },
  { id: 'well', model: 'well', x: -8, z: 8, rot: 0.4 },
  { id: 'notice', model: 'notice_board', x: 7, z: 11, rot: face(7, 11, 0, 0) },
  { id: 'house_bramble', model: 'villager_house_a', x: -22, z: -6, rot: face(-22, -6, 0, 0) },
  { id: 'house_mothwyn', model: 'villager_house_b', x: -12, z: -25, rot: face(-12, -25, 0, 0) },
  { id: 'house_grenna', model: 'villager_house_c', x: 17, z: -26, rot: face(17, -26, 0, 0) },
  { id: 'house_fennick', model: 'villager_house_d', x: 8, z: 80, rot: Math.PI }, // faces north
  { id: 'home', model: 'house_hut', x: -40, z: 22, rot: Math.PI / 2 },           // faces east
  { id: 'barrow', model: 'museum_barrow', x: 0, z: -66, rot: 0 },
  { id: 'altar', model: 'altar_offering', x: 70, z: -80, rot: face(70, -80, 50, -50) },
  { id: 'stones', model: 'standing_stones', x: -64, z: -58, rot: 0.3 },
  { id: 'lake_jetty', model: 'dock', x: 31, z: 5, rot: Math.PI / 2 },            // extends east into the lake
  { id: 'sea_dock', model: 'dock', x: 22, z: null, rot: 0, coast: true },       // extends south into the sea
  { id: 'longship', model: 'longship', x: 29, z: null, rot: 0.06, coast: 'ship' },
  { id: 'bridge', model: 'bridge', x: 55, z: 56, rot: Math.PI / 2 },
  { id: 'ruin1', model: 'ruin_wall', x: 52, z: -48, rot: 0.5 },
  { id: 'ruin2', model: 'ruin_arch', x: 60, z: -58, rot: -0.3 },
  { id: 'ruin3', model: 'ruin_wall', x: 66, z: -52, rot: 1.9 },
  { id: 'ruin4', model: 'ruin_wall', x: 80, z: -70, rot: 1.2 },
  { id: 'grave1', model: 'gravestone_a', x: -9, z: -52, rot: 0.1 },
  { id: 'grave2', model: 'gravestone_b', x: -13, z: -56, rot: -0.2 },
  { id: 'grave3', model: 'gravestone_a', x: 10, z: -53, rot: 0.25 },
  { id: 'grave4', model: 'gravestone_b', x: 14, z: -57, rot: -0.1 },
  { id: 'grave5', model: 'grave_cairn', x: -16, z: -61, rot: 0.6 },
  { id: 'grave6', model: 'gravestone_b', x: 12, z: -61, rot: 0.3 },
];

// Decorative props (non-interactive, but may collide)
export const DECOR = [
  { model: 'wood_pile', x: -44, z: 17, rot: 0 },
  { model: 'barrel', x: -36.5, z: 19, rot: 0 },
  { model: 'bed_roll', x: -35.5, z: 16.5, rot: 1.2 },
  { model: 'anvil', x: -17.5, z: -9, rot: 0.8 },
  { model: 'barrel', x: -18.2, z: -3.5, rot: 0 },
  { model: 'weapon_rack', x: -25, z: -1.5, rot: 1.2 },
  { model: 'crate_stack', x: 14.5, z: -9.5, rot: -0.9 },
  { model: 'barrel', x: 8, z: -11.5, rot: 0 },
  { model: 'cart', x: 15, z: -3, rot: -1.6 },
  { model: 'banner', x: -6, z: -6, rot: 0.8 },
  { model: 'banner', x: 6, z: 6, rot: -2.4 },
  { model: 'bench', x: -5, z: 5, rot: face(-5, 5, 0, 0) },
  { model: 'bench', x: 5.5, z: -4.5, rot: face(5.5, -4.5, 0, 0) },
  { model: 'hay_bale', x: -52, z: 22, rot: 0.3 },
  { model: 'beehive', x: 21, z: -22, rot: 0 },
  { model: 'drying_rack', x: 13, z: 76, rot: 0.3 },
  { model: 'barrel', x: 4, z: 77, rot: 0 },
  { model: 'flower_pot', x: -9, z: -21.5, rot: 0 },
  { model: 'flower_pot', x: -14.5, z: -21.5, rot: 0 },
  { model: 'planter_box', x: 13.5, z: -22.5, rot: 0.6 },
  { model: 'skull_pike', x: 40, z: -40, rot: 0.8 },
  { model: 'skull_pike', x: 46, z: -36, rot: 0.2 },
  { model: 'skull_pike', x: 64, z: -74, rot: -0.4 },
  { model: 'lantern_post', x: -11, z: 2, rot: 0.5 },
  { model: 'lantern_post', x: 3, z: -13, rot: 0 },
  { model: 'lantern_post', x: 12, z: 5, rot: -1 },
  { model: 'lantern_post', x: -4, z: -40, rot: 0 },
  { model: 'lantern_post', x: -24, z: 12, rot: 0 },
  { model: 'lantern_post', x: 16, z: 40, rot: 0 },
  { model: 'torch_standing', x: -3, z: -58, rot: 0 },
  { model: 'torch_standing', x: 3, z: -58, rot: 0 },
];

// Interactive stations that exist from the start
export const STATIONS = [
  { id: 'crate', model: 'shipping_crate', x: -35.5, z: 25.5, rot: Math.PI / 2 },
  { id: 'workbench', model: 'workbench', x: -41, z: 16.5, rot: Math.PI / 2 },
  { id: 'start_fire', model: 'campfire', x: -33, z: 19, rot: 0 },
];

// Lore runestones and signposts
export const RUNESTONES = [
  { id: 'rs1', model: 'runestone_a', x: -24, z: 15, rot: 0.9 },
  { id: 'rs2', model: 'runestone_b', x: 13, z: 20, rot: -0.4 },
  { id: 'rs3', model: 'runestone_a', x: -7, z: -44, rot: 0.2 },
  { id: 'rs4', model: 'runestone_b', x: 37, z: -33, rot: -0.9 },
  { id: 'rs5', model: 'runestone_a', x: 70, z: 32, rot: 1.8 },
  { id: 'rs6', model: 'runestone_b', x: -82, z: -36, rot: 1.1 },
  { id: 'rs7', model: 'runestone_a', x: 84, z: -76, rot: -1.2 },
];

export const SIGNS = [
  { id: 'home', x: -30, z: 20 },
  { id: 'village', x: -14, z: 9 },
  { id: 'barrow', x: 3, z: -38 },
  { id: 'mistwood', x: 34, z: -26 },
  { id: 'dock', x: 12, z: 36 },
  { id: 'lake', x: 24, z: 6 },
  { id: 'meadow', x: -32, z: -8 },
];

// Paths (polylines) painted as trampled dirt and gently smoothed.
export const PATHS = [
  [[0, 0], [-10, 8], [-22, 13], [-32, 20], [-36, 23]],                 // green -> croft
  [[0, 0], [2, -16], [1, -34], [0, -50], [0, -58]],                     // green -> barrow
  [[0, 0], [12, 3], [22, 5], [31, 5]],                                   // green -> lake jetty
  [[0, 0], [6, 16], [12, 34], [16, 54], [19, 72], [22, 86]],            // green -> sea dock
  [[1, -34], [18, -30], [34, -30], [46, -42], [58, -56], [68, -72]],    // -> mistwood & altar
  [[0, 0], [-14, -4], [-30, -8], [-50, -10], [-66, -12]],               // -> meadow
  [[16, 54], [34, 56], [55, 56], [70, 52], [82, 48]],                    // -> bridge & heath
  [[-50, -10], [-58, -34], [-64, -52]],                                  // -> standing stones
];

// The stream: lake outflow to the sea (centre line, width in metres)
export const STREAM = {
  width: 4.2,
  points: [[54, 20], [58, 34], [53, 48], [55, 60], [52, 76], [49, 94], [48, 118]],
};

// Zones used for scattering and gameplay rules (circles)
export const ZONES = {
  mistwood: { x: 62, z: -60, r: 44 },
  meadow: { x: -70, z: -12, r: 32 },
  heath: { x: 82, z: 48, r: 26 },
  village: { x: 0, z: 0, r: 30 },
  croft: { x: -46, z: 28, r: 24 },
  graveyard: { x: 0, z: -56, r: 18 },
};
