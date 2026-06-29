// Shared tunable constants and the wire protocol.
// Keeping these in one module guarantees host and clients agree on the rules.

export const CFG = {
  // --- Arena ---
  ARENA_RADIUS: 18,          // starting platform radius (world units)
  ARENA_MIN_RADIUS: 6,       // platform never shrinks below this
  ARENA_SHRINK_PER_SEC: 0.0, // set per-round; see ROUND
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

  // Player colors (low-poly palette) assigned by join order.
  COLORS: [0xff5a3c, 0x4cc9ff, 0x7cff5a, 0xffd23c, 0xc04cff, 0xff4ca8],
};

// Message types exchanged over PeerJS data channels.
export const MSG = {
  // client -> host
  JOIN: "join",          // {name}
  INPUT: "input",        // {seq, move:[x,z], aim, fire}
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
