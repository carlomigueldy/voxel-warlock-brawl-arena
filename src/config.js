// Shared tunable constants and the wire protocol.
// Keeping these in one module guarantees host and clients agree on the rules.

export const CFG = {
  // --- Arena ---
  ARENA_RADIUS: 18,          // starting platform radius (world units)
  ARENA_MIN_RADIUS: 6,       // platform never shrinks below this
  ARENA_SHRINK_PER_SEC: 0.0, // set per-round; see ROUND
  DEFAULT_ARENA_WORLD: "circle",
  DEFAULT_ARENA_LAND_SIZE: "medium",
  ARENA_LAND_SIZES: {
    small: { id: "small", name: "Small", radius: 14 },
    medium: { id: "medium", name: "Medium", radius: 18 },
    large: { id: "large", name: "Large", radius: 24 },
  },
  ARENA_WORLDS: [
    { id: "circle", name: "Classic Circle", top: 0x6c4cff, side: 0x3a2a7a },
    { id: "islands", name: "Twin Islands", top: 0x4cc9ff, side: 0x1f5872 },
    { id: "bridge", name: "Narrow Bridge", top: 0xffd23c, side: 0x805f16 },
    { id: "cross", name: "Arcane Cross", top: 0x7cff5a, side: 0x2e6b25 },
    { id: "ring", name: "Outer Ring", top: 0xff4ca8, side: 0x7a2552 },
  ],
  VOXEL: 1,                  // voxel size
  LAVA_Y: -4,                // height of the lava plane (death below platform top)
  PLATFORM_TOP: 0,           // top surface of the platform

  // --- Warlock movement ---
  MOVE_SPEED: 9,             // units/sec
  PLAYER_RADIUS: 0.6,
  PLAYER_HEIGHT: 1.8,
  FRICTION: 6.0,             // knockback velocity decay per sec (exponential-ish)
  GRAVITY: 22,               // applied once off the platform edge

  // --- Bolt (the core weapon) ---
  BOLT_SPEED: 26,            // units/sec
  BOLT_RADIUS: 0.45,
  BOLT_LIFETIME: 2.2,        // seconds before it fizzles
  BOLT_COOLDOWN: 0.55,       // seconds between shots
  // Knockback model (Smash-style): force scales with the victim's accumulated "charge".
  BOLT_BASE_KNOCKBACK: 6,    // base impulse on hit
  BOLT_CHARGE_GAIN: 0.14,    // how much a hit increases victim's charge multiplier
  KNOCKBACK_CHARGE_SCALE: 9, // extra impulse per unit of charge
  CHARGE_MAX: 4.0,           // cap so it stays playable
  CHARGE_DECAY: 0.05,        // charge bleeds off slowly per sec while alive

  // --- Ability acquisition (rune mode) ---
  RUNE_RADIUS: 0.8,
  RUNE_SPAWN_RADIUS: 13,
  RUNE_MAX_ACTIVE: 2,         // how many runes may exist on the field at once
  RUNE_SPAWN_INTERVAL: 8,     // seconds between timed rune spawns

  // --- Rounds ---
  ROUND: {
    COUNTDOWN: 3,            // seconds before a round begins
    GRACE: 1.5,             // no-shrink grace period at round start
    SHRINK_START_DELAY: 6,  // seconds before platform begins shrinking
    SHRINK_RATE: 0.45,      // units/sec the radius shrinks once shrinking
    POINTS_FOR_WIN: 1,
    POINTS_TO_WIN_MATCH: 5, // first to this many round wins ends the match
    END_DELAY: 3.0,         // seconds to show the round result
  },

  // --- Networking ---
  TICK_RATE: 30,             // host simulation broadcast rate (Hz)
  INPUT_RATE: 30,            // client input send rate (Hz)
  PEER_PREFIX: "vwb-",       // PeerJS id namespace so room codes are short
  MAX_PLAYERS: 6,
  BOT_SKILLS: ["smart", "brilliant", "expert"],

  // Player colors (low-poly palette) assigned by join order.
  COLORS: [0xff5a3c, 0x4cc9ff, 0x7cff5a, 0xffd23c, 0xc04cff, 0xff4ca8],
};

export function getArenaWorld(id) {
  return CFG.ARENA_WORLDS.find((world) => world.id === id) || CFG.ARENA_WORLDS.find((world) => world.id === CFG.DEFAULT_ARENA_WORLD);
}

export function getArenaLandSize(id) {
  return CFG.ARENA_LAND_SIZES[id] || CFG.ARENA_LAND_SIZES[CFG.DEFAULT_ARENA_LAND_SIZE];
}

export function isOnArenaWorld(worldId, radius, x, z) {
  const r = Math.max(CFG.ARENA_MIN_RADIUS, radius);
  const ax = Math.abs(x);
  const az = Math.abs(z);
  const d = Math.hypot(x, z);
  switch (getArenaWorld(worldId).id) {
    case "islands": {
      const spread = r * 0.45;
      const islandR = r * 0.58;
      return Math.hypot(x + spread, z) <= islandR || Math.hypot(x - spread, z) <= islandR || (ax <= r * 0.18 && az <= r * 0.16);
    }
    case "bridge":
      return (ax <= r && az <= r * 0.22) || (az <= r && ax <= r * 0.18);
    case "cross":
      return d <= r && (ax <= r * 0.32 || az <= r * 0.32 || d <= r * 0.28);
    case "ring":
      return d <= r && (d >= r * 0.42 || ax <= r * 0.18 || az <= r * 0.18);
    default:
      return d <= r;
  }
}

// --- Spellbook ---
// Every ability/item from the Warlock Brawl handbook
// (https://www.warlockbrawl.com/handbook). `key` is the keyboard slot, `cd` the
// cooldown in seconds, `kind` how the simulation resolves it. Tunables that the
// cast handlers (src/spells.js) read live alongside each entry.
export const SPELLS = {
  // ---- Core projectiles ----
  fireball:  { name: "Fireball",  key: "1", cd: 0.55, kind: "projectile", proj: "fireball",  kb: 7,  color: 0xff5a1e, sfx: "fireball" },
  lightning: { name: "Lightning", key: "2", cd: 4.0,  kind: "lightning",  range: 16, kb: 9, chains: 2, chainRange: 7, color: 0x9fe6ff, sfx: "lightning" },
  boomerang: { name: "Boomerang", key: "3", cd: 6.0,  kind: "projectile", proj: "boomerang", kb: 8,  range: 16, color: 0xffe14c, sfx: "whoosh" },
  homing:    { name: "Homing",    key: "4", cd: 8.0,  kind: "projectile", proj: "homing",    kb: 9,  turn: 3.2, color: 0xc04cff, sfx: "homing" },
  fireSpray: { name: "Fire Spray", key: "5", cd: 7.0, kind: "spray",      proj: "fireball",  kb: 5,  count: 7, spread: 0.9, color: 0xff7a2e, sfx: "spray" },
  bouncer:   { name: "Bouncer",   key: "6", cd: 9.0,  kind: "projectile", proj: "bouncer",   kb: 8,  bounces: 4, color: 0x4cff9c, sfx: "whoosh" },
  splitter:  { name: "Splitter",  key: "7", cd: 9.0,  kind: "projectile", proj: "splitter",  kb: 6,  splitDist: 7, shards: 5, color: 0xff4ca8, sfx: "fireball" },
  meteor:    { name: "Meteor",    key: "8", cd: 12.0, kind: "meteor",     range: 18, fall: 1.1, radius: 5, kb: 22, color: 0xff3a1e, sfx: "meteor" },

  // ---- Mobility ----
  teleport:  { name: "Teleport",  key: "Q", cd: 8.0,  kind: "teleport",  range: 14, sfx: "teleport" },
  thrust:    { name: "Thrust",    key: "E", cd: 7.0,  kind: "thrust",    power: 26, sfx: "whoosh" },
  swap:      { name: "Swap",      key: "R", cd: 14.0, kind: "swap",      range: 18, sfx: "teleport" },
  windWalk:  { name: "Wind Walk", key: "F", cd: 16.0, kind: "windwalk",  duration: 4, speedMul: 1.6, sfx: "windwalk" },
  rush:      { name: "Rush",      key: "C", cd: 16.0, kind: "rush",      duration: 5, speedMul: 1.45, kbResist: 0.45, sfx: "rush" },

  // ---- Control / utility ----
  drain:     { name: "Drain",     key: "V", cd: 12.0, kind: "drain",     range: 12, pull: 10, steal: 0.5, sfx: "drain" },
  gravity:   { name: "Gravity",   key: "X", cd: 14.0, kind: "gravity",   range: 16, radius: 6, duration: 2.5, pull: 14, sfx: "gravity" },
  link:      { name: "Link",      key: "Z", cd: 16.0, kind: "link",      range: 16, duration: 4, sfx: "link" },
  disable:   { name: "Disable",   key: "T", cd: 14.0, kind: "disable",   range: 16, duration: 1.6, kb: 4, color: 0xbbbbbb, sfx: "disable" },
  shield:    { name: "Shield",    key: "G", cd: 16.0, kind: "shield",    duration: 4, charges: 1, sfx: "shield" },
  timeShift: { name: "Time Shift", key: "B", cd: 22.0, kind: "timeshift", delay: 3.0, sfx: "timeshift" },
  pocketWatch: { name: "Pocket Watch", key: "H", cd: 40.0, kind: "pocketwatch", item: true, sfx: "watch" },
};

// Ordering used for the on-screen ability bar.
export const SPELL_ORDER = [
  "fireball", "lightning", "boomerang", "homing", "fireSpray", "bouncer",
  "splitter", "meteor", "teleport", "thrust", "swap", "windWalk", "rush",
  "drain", "gravity", "link", "disable", "shield", "timeShift", "pocketWatch",
];

// --- Items / passives (the rest of the handbook) ---
// Applied as persistent modifiers on each warlock via applyItems().
export const ITEMS = {
  aegis:           { name: "Aegis",            kind: "kbResist", value: 0.18 },
  cape:            { name: "Cape",             kind: "kbResist", value: 0.15 },
  helmet:          { name: "Helmet",           kind: "kbResist", value: 0.12 },
  bootsOfSpeed:    { name: "Boots of Speed",   kind: "speed",    value: 1.18 },
  bloodSword:      { name: "Blood Sword",      kind: "lifesteal", value: 0.25, dmg: 1.2 },
  maskOfDeath:     { name: "Mask of Death",    kind: "lifesteal", value: 0.15, dmg: 1.35 },
  cursedPendant:   { name: "Cursed Pendant",   kind: "glassCannon", dealt: 1.3, taken: 1.25 },
  pendant:         { name: "Pendant",          kind: "cdr",      value: 0.12 },
  stoneOfJordan:   { name: "Stone of Jordan",  kind: "cdr",      value: 0.08, speed: 1.05 },
  lavaTreads:      { name: "Lava Treads",      kind: "lavaGrace", value: 0.6 },
  staffOfFireball: { name: "Staff of Fireball", kind: "empowerFireball", kb: 1.4 },
  warden:          { name: "Warden",           kind: "kbResist", value: 0.2 },
  shieldItem:      { name: "Shield",           kind: "kbResist", value: 0.1 },
};

// Message types exchanged over PeerJS data channels.
export const MSG = {
  // client -> host
  JOIN: "join",          // {name}
  INPUT: "input",        // {seq, move:[x,z], aim, fire, casts:[{id,spell,tx,tz}]}
  // host -> client
  WELCOME: "welcome",    // {id, players, hostName}
  LOBBY: "lobby",        // {players}
  START: "start",        // {round}
  STATE: "state",        // {t, players[], bolts[], arenaR, phase, ...}
  ROUND_END: "roundEnd", // {winnerId, scores}
  MATCH_END: "matchEnd", // {winnerId, scores}
  CHAT: "chat",          // reserved
};

// Deterministic short room code from a peer id suffix.
export function makeRoomCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no ambiguous chars
  let s = "";
  for (let i = 0; i < 6; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

export function codeToPeerId(code) {
  return CFG.PEER_PREFIX + code.toUpperCase();
}
