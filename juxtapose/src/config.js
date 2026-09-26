// Shared constants, tuning and the property catalogue.

export const PROPS = ['melting', 'floating', 'reflecting', 'burning', 'heavy', 'framed', 'sleeping', 'multiplying', 'hollow', 'bursting'];

// colour (CSS + three), the object you take it from, one-line description of what it does per target kind
export const PROP_INFO = {
  melting: {
    color: '#ffb347', label: 'Melting', source: 'Clock',
    blurb: 'Softens whatever it touches until it sags into a puddle.',
    target: 'Walls slump into doorways. Enemies drip away.', self: 'You ooze: tiny, fast, slide under anything.', rounds: 'Rounds melt holes and make targets drip.',
  },
  floating: {
    color: '#8fd3ff', label: 'Floating', source: 'Cloud',
    blurb: 'Forgets gravity.',
    target: 'Enemies drift helplessly into the ceiling.', self: 'Low gravity, a third jump, long glides.', rounds: 'Hits lift targets off the ground.',
  },
  reflecting: {
    color: '#e6f2ff', label: 'Reflecting', source: 'Mirror',
    blurb: 'Becomes a mirror.',
    target: 'Shots bounce off it, including enemy shots.', self: 'Enemy shots bounce back at them.', rounds: 'Rounds ricochet, nearly forever.',
  },
  burning: {
    color: '#ff5a1f', label: 'Burning', source: 'Candle',
    blurb: 'Catches fire, and fire spreads.',
    target: 'Burns over time and ignites neighbours. Speeds melting.', self: 'You burn: dash through enemies to ignite them.', rounds: 'Rounds set targets alight.',
  },
  heavy: {
    color: '#9aa3b5', label: 'Heavy', source: 'Anvil',
    blurb: 'Weighs as much as an anvil.',
    target: 'Plummets, crushes and smashes. Cancels floating.', self: 'Earth-shaking ground pounds, dashes smash walls.', rounds: 'Rounds knock things flying and crack walls.',
  },
  framed: {
    color: '#8fe36b', label: 'Framed', source: 'Empty frame',
    blurb: 'Becomes a window onto somewhere else.',
    target: 'Frame two surfaces; step into one, come out of the other. Speed is kept.', self: 'Marks a return point. Use it again to step back through.', rounds: 'Every shot hangs a portal where it lands.',
  },
  sleeping: {
    color: '#a58bff', label: 'Sleeping', source: 'Bed',
    blurb: 'Falls asleep exactly where it is.',
    target: 'Freezes in place, even mid-air. Sleepers take double damage.', self: 'Enemies forget you exist.', rounds: 'Hits put targets to sleep.',
  },
  multiplying: {
    color: '#ffd84a', label: 'Multiplying', source: 'Bowler hat',
    blurb: 'There are suddenly three of it.',
    target: 'Two copies appear, properties included.', self: 'Two decoy selves draw enemy fire.', rounds: 'Every round splits in three.',
  },
  hollow: {
    color: '#5effd0', label: 'Hollow', source: 'Birdcage',
    blurb: 'Empty inside.',
    target: 'Becomes intangible. Hollow enemies are fragile shells.', self: 'Phase through walls and take no damage.', rounds: 'Rounds pierce everything.',
  },
  bursting: {
    color: '#ff2d6f', label: 'Bursting', source: 'Pomegranate',
    blurb: 'Ripe to the point of exploding.',
    target: 'Explodes after a short fuse. Combines with everything.', self: 'Your next jump is a blast jump.', rounds: 'Explosive rounds.',
  },
};

// SVG glyphs (24x24 viewBox, stroke-based) for HUD icons
export const PROP_ICON = {
  melting: '<path d="M4 8a8 6 0 0 1 16 0c0 3-2 4-3 4v5a1.5 1.5 0 0 1-3 0v-3c0-1-1-1-1 0v6a1.5 1.5 0 0 1-3 0v-7c0-1-1-1-1 0v2a1.5 1.5 0 0 1-3 0v-3c-1 0-2-1-2-4z"/><path d="M12 5v3l2 1"/>',
  floating: '<path d="M6 17h11a4 4 0 0 0 .5-8 5.5 5.5 0 0 0-10.6 1.2A3.5 3.5 0 0 0 6 17z"/><path d="M9 21l1-2M14 21l1-2"/>',
  reflecting: '<path d="M12 2l7 10-7 10-7-10z"/><path d="M9 9l3-3M9 13l5-5"/>',
  burning: '<path d="M12 22c4 0 7-3 7-7 0-5-5-7-5-12-3 2-4 5-4 7-1-1-2-2-2-4-2 2-3 5-3 9 0 4 3 7 7 7z"/><path d="M12 22c-2 0-3-1.5-3-3.5S12 14 12 14s3 2.5 3 4.5-1 3.5-3 3.5z"/>',
  heavy: '<path d="M3 9h14l4-3v3l-4 3H6z"/><path d="M8 12v5h8v-5M5 20h14"/>',
  framed: '<ellipse cx="12" cy="12" rx="6.5" ry="9"/><ellipse cx="12" cy="12" rx="3.8" ry="6"/><path d="M12 1.5v1.5"/>',
  sleeping: '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/><path d="M15 3h4l-4 4h4"/>',
  multiplying: '<circle cx="8" cy="10" r="4"/><circle cx="16" cy="10" r="4"/><circle cx="12" cy="16" r="4"/>',
  hollow: '<circle cx="12" cy="12" r="8" stroke-dasharray="3 3"/><circle cx="12" cy="12" r="3"/>',
  bursting: '<path d="M12 2v5M12 17v5M2 12h5M17 12h5M5 5l3.5 3.5M15.5 15.5L19 19M5 19l3.5-3.5M15.5 8.5L19 5"/><circle cx="12" cy="12" r="2.5"/>',
};

export function propIconSVG(p, size = 22, color) {
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="${color || PROP_INFO[p].color}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${PROP_ICON[p]}</svg>`;
}

// Rapier collision groups (membership bits)
export const G = {
  WORLD: 0x0001,   // terrain, static geometry
  WALL: 0x0002,    // walls/columns (hollow self can phase through these)
  PROP: 0x0004,    // dynamic props
  DEBRIS: 0x0008,  // fracture chunks
  ENEMY: 0x0010,
  PLAYER: 0x0020,
  GHOST: 0x0040,   // hollow things
  CEIL: 0x0080,    // the dream ceiling
  GLASS: 0x0100,   // window glass: stops bodies, not the gun's aim
};
export function groups(member, filter) { return ((member & 0xffff) << 16) | (filter & 0xffff); }
export const ALL = 0xffff;

// Movement is paced like Ratchet & Clank: a gentler run that builds and bleeds momentum, and
// long, floaty jumps. Gravity is lower (18, was 26) and every launch speed is scaled by
// LIFT = sqrt(18/26) so each jump, bounce and hop reaches the height the levels were built
// for; run speeds drop by about as much as airtime grows, so jump distances hold too.
const G_BUILT = 26, G_NOW = 18;
export const LIFT = Math.sqrt(G_NOW / G_BUILT);

export const TUNE = {
  gravity: G_NOW,
  runSpeed: 7.2,
  sprintSpeed: 9.4,
  sprintAfter: 1.1,
  groundAccel: 34,
  groundDecel: 24,
  airAccel: 15,
  jumpVel: 10.2 * LIFT,
  doubleJumpVel: 9.6 * LIFT,
  coyote: 0.14,
  jumpBuffer: 0.16,
  maxFall: 42 * LIFT,
  slideBoost: 3.2,
  slideFriction: 4.5,
  slideTime: 1.2,
  dashSpeed: 20,
  dashTime: 0.2,
  dashCooldown: 0.45,
  wallRunTime: 1.5,
  wallRunMinSpeed: 4.5,
  wallJumpOut: 8.5 * LIFT,
  wallJumpUp: 9.5 * LIFT,
  mantleMax: 2.5,
  vaultMax: 1.25,
  grindMinSpeed: 10,
  poundSpeed: 38 * LIFT,
  bedBounce: 19 * LIFT,
  fireRate: 0.13,
  magazine: 8,
  reloadTime: 1.1,
  roundSpeed: 90,
  roundDamage: 14,
  playerHP: 100,
  ceiling: 26,
  selfDuration: 12,
  roundsInfusion: 24,
  maxCharges: 6,
  takeCharges: 2,
};

export const LAYERS = [
  { name: 'The Soft Desert', subtitle: 'where the clocks come to rest', key: 'desert' },
  { name: 'Golconda Piazza', subtitle: 'it has been raining men all afternoon', key: 'piazza' },
  { name: 'The Back Bedroom', subtitle: 'the room she will not go into', key: 'room' },
  { name: 'The Unwatched', subtitle: 'it only moves when you look away', key: 'boss' },
];
