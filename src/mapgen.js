// Pure-data procedural map layout generator.
// No THREE import — output is a plain-data object that the host stores on the
// Simulation and broadcasts to clients so both sides build from identical data.
//
// Output shape:
//   { seed, worldId, plateaus, obstacles }
//   plateaus : [{ x, z, w, d, height, ramps:[{ side, x, z, w, d }] }]
//   obstacles: [{ id, type, x, z, r, height, rot }]
//
// Coordinate conventions (match the sim/arena):
//   • X/Z are the horizontal plane.  Y is up.
//   • Plateau x/z is the CENTRE of the footprint; w/d are the FULL extents.
//   • Ramp  x/z is the CENTRE of the ramp footprint; w/d are the FULL extents.
//     `side` tells which plateau face the ramp connects to:
//     0 = +x face, 1 = -x face, 2 = +z face, 3 = -z face.
//   • Obstacle x/z is the centre; r is the collision radius.
import { CFG, isOnArenaWorld } from "./config.js";

// --- Placement guard distances (exported so tests and other modules can use them) ---

/** Minimum distance from the arena centre (0,0) for any geometry centre. */
export const MAP_CENTER_CLEAR   = 3.5;
/** Clearance band around the player-spawn ring so geometry doesn't obstruct spawning. */
export const MAP_SPAWN_RING_CLEAR = 1.5;

// ---------------------------------------------------------------------------
// Seeded PRNG — Mulberry32 (public domain, Bob Jenkins variant).
// Produces a float in [0, 1) from a uint32 seed.
// ---------------------------------------------------------------------------
function mulberry32(seed) {
  let s = seed >>> 0;
  return function rng() {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// randRange — uniform float in [lo, hi).
function randRange(rng, lo, hi) { return lo + rng() * (hi - lo); }
// randInt  — integer in [lo, hi] inclusive.
function randInt(rng, lo, hi)   { return Math.floor(lo + rng() * (hi - lo + 1 - 1e-9)); }

// Fisher-Yates shuffle in-place using the seeded RNG.
function shuffle(rng, arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// ---------------------------------------------------------------------------
// generateMap
// ---------------------------------------------------------------------------
/**
 * Generate a deterministic map layout.
 *
 * @param {string}  worldId           – arena world id (e.g. "circle", "islands")
 * @param {number}  radius            – starting arena radius for the round (world units)
 * @param {number}  seed              – integer seed supplied by the host; broadcast to clients
 * @param {Object}  [enabledObstacles={}] – map of obstacle type id -> boolean;
 *   explicit `false` skips that type entirely (no RNG draws consumed for it so
 *   other types' placement is unaffected).  Absent/undefined keys still spawn
 *   (back-compat with callers that omit the argument).
 * @returns {{ seed:number, plateaus:object[], obstacles:object[] }}
 */
export function generateMap(worldId, radius, seed, enabledObstacles = {}) {
  const rng = mulberry32(seed);
  const m   = CFG.MAP;

  // Geometry spreads across the whole STARTING disc, not just the centre.
  // Placement is validated against the starting radius; as the arena shrinks,
  // features whose centre leaves the platform are made inert by the query layer
  // (arena-query.js) and hidden by the renderer, so nothing floats over the
  // hazard.  We keep a small margin in from the rim so footprints sit on solid
  // ground at round start.
  const placeRadius = Math.max(CFG.ARENA_MIN_RADIUS, radius * m.PLACEMENT_RADIUS_FRAC);

  // Player spawn ring radius (mirrors the formula in sim.js spawnPoint()).
  const spawnRingR = Math.min(radius - 3, 12);

  // ------------------------------------------------------------------
  // Helpers
  // ------------------------------------------------------------------

  // True when (x,z) is acceptable as a geometry centre:
  //   • not inside the centre clear zone
  //   • not inside the spawn-ring clearance band
  //   • on solid ground at minimum arena radius
  function isValidCenter(x, z) {
    const d = Math.hypot(x, z);
    if (d < MAP_CENTER_CLEAR) return false;
    if (Math.abs(d - spawnRingR) < MAP_SPAWN_RING_CLEAR) return false;
    return isOnArenaWorld(worldId, placeRadius, x, z);
  }

  // True when the rectangular footprint (centre x/z, half-extents hw×hd) does
  // not overlap any already-placed rectangle by less than the plateau clearance.
  function rectClear(x, z, hw, hd, placed) {
    const gap = m.PLATEAU_CLEARANCE;
    for (const p of placed) {
      if (Math.abs(x - p.x) < hw + p.hw + gap &&
          Math.abs(z - p.z) < hd + p.hd + gap) return false;
    }
    return true;
  }

  // True when a circle (x,z,r) clears all already-placed circles by the
  // configured minimum gap (keeps obstacles spaced out, not bunched).
  function circleClear(x, z, r, placed) {
    const gap = m.OBS_MIN_GAP ?? 0.5;
    for (const p of placed) {
      if (Math.hypot(x - p.x, z - p.z) < r + p.r + gap) return false;
    }
    return true;
  }

  // True when the circle (x,z,r) doesn't overlap any plateau AABB.
  function circleClearOfPlateaus(x, z, r) {
    for (const pl of placed_rects) {
      // Closest point on AABB to circle centre:
      const cx = Math.max(pl.x - pl.hw, Math.min(x, pl.x + pl.hw));
      const cz = Math.max(pl.z - pl.hd, Math.min(z, pl.z + pl.hd));
      if (Math.hypot(x - cx, z - cz) < r + 0.4) return false;
    }
    return true;
  }

  const TRIES = 45; // placement attempts per object before giving up

  // ------------------------------------------------------------------
  // 1. Plateaus
  // ------------------------------------------------------------------
  // Usually one high ground; a small chance of a second placed far away.
  const plateauCount = m.PLATEAU_BASE_COUNT + (rng() < m.PLATEAU_SECOND_CHANCE ? 1 : 0);
  const plateaus     = [];
  const placed_rects = []; // { x, z, hw, hd } — for clearance bookkeeping

  for (let i = 0; i < plateauCount; i++) {
    placed: for (let t = 0; t < TRIES; t++) {
      const w  = randRange(rng, m.PLATEAU_W_MIN, m.PLATEAU_W_MAX);
      const d  = randRange(rng, m.PLATEAU_D_MIN, m.PLATEAU_D_MAX);
      const hw = w / 2;
      const hd = d / 2;

      // Bounding circle of the plateau rectangle (conservative footprint bound).
      const halfExt = Math.hypot(hw, hd);
      const distMin = MAP_CENTER_CLEAR + 0.1;
      const distMax = placeRadius - halfExt - 0.05;
      if (distMin > distMax) continue; // footprint too large to fit on the disc

      const ang  = rng() * Math.PI * 2;
      const dist = randRange(rng, distMin, distMax);
      const px   = Math.cos(ang) * dist;
      const pz   = Math.sin(ang) * dist;

      if (!isValidCenter(px, pz)) continue;
      if (!rectClear(px, pz, hw, hd, placed_rects)) continue;
      // Keep multiple high grounds far apart so they sit on opposite sides.
      if (placed_rects.some((p) => Math.hypot(px - p.x, pz - p.z) < m.PLATEAU_MIN_SEPARATION)) continue;

      const height = randRange(rng, m.PLATEAU_HEIGHT_MIN, m.PLATEAU_HEIGHT_MAX);

      // Ramps — one or two, on distinct sides, chosen randomly.
      // Ramp footprint: the sloped surface extends outward from a plateau face.
      //   rampLen = height (gives a 45° max slope — comfortable to walk).
      //   rampWidth = min(1.5, 45 % of the relevant plateau side).
      const rampCount = randInt(rng, 1, 2);
      const sides     = shuffle(rng, [0, 1, 2, 3]);
      const ramps     = [];
      const rampLen   = Math.max(height, 1.0);
      const rampWide  = Math.min(1.5, Math.min(w, d) * 0.45);

      for (let r = 0; r < rampCount; r++) {
        const side = sides[r];
        let rx, rz, rw, rd;
        if (side === 0) {        // +x face → ramp extends in +x
          rx = px + hw + rampLen / 2;  rz = pz;
          rw = rampLen;                rd = rampWide;
        } else if (side === 1) { // -x face → ramp extends in -x
          rx = px - hw - rampLen / 2;  rz = pz;
          rw = rampLen;                rd = rampWide;
        } else if (side === 2) { // +z face → ramp extends in +z
          rx = px;                      rz = pz + hd + rampLen / 2;
          rw = rampWide;               rd = rampLen;
        } else {                 // -z face → ramp extends in -z
          rx = px;                      rz = pz - hd - rampLen / 2;
          rw = rampWide;               rd = rampLen;
        }
        ramps.push({ side, x: rx, z: rz, w: rw, d: rd });
      }

      plateaus.push({ x: px, z: pz, w, d, height, ramps });
      placed_rects.push({ x: px, z: pz, hw, hd });
      break placed; // eslint-disable-line no-labels
    }
  }

  // ------------------------------------------------------------------
  // 2. Obstacles
  // ------------------------------------------------------------------
  // Each spec defines the obstacle type, collision-radius range, height range,
  // and count range (driven by CFG.MAP tunables).
  const OBS_SPECS = [
    { type: "tree",       rLo: 0.4, rHi: 0.7,  hLo: 2.0, hHi: 3.5, cLo: m.OBS_TREE_MIN,        cHi: m.OBS_TREE_MAX },
    { type: "stone",      rLo: 0.5, rHi: 0.9,  hLo: 0.8, hHi: 1.6, cLo: m.OBS_STONE_MIN,       cHi: m.OBS_STONE_MAX },
    { type: "column",     rLo: 0.3, rHi: 0.6,  hLo: 2.0, hHi: 3.0, cLo: m.OBS_COLUMN_MIN,      cHi: m.OBS_COLUMN_MAX },
    { type: "debris",     rLo: 0.4, rHi: 0.8,  hLo: 0.6, hHi: 1.2, cLo: m.OBS_DEBRIS_MIN,      cHi: m.OBS_DEBRIS_MAX },
    { type: "wall",       rLo: 0.3, rHi: 0.5,  hLo: 1.5, hHi: 2.5, cLo: m.OBS_WALL_MIN,        cHi: m.OBS_WALL_MAX },
    { type: "boulder",    rLo: 0.5, rHi: 1.0,  hLo: 1.0, hHi: 2.0, cLo: m.OBS_BOULDER_MIN,     cHi: m.OBS_BOULDER_MAX },
    { type: "deadGiant",  rLo: 0.8, rHi: 1.2,  hLo: 1.5, hHi: 2.5, cLo: m.OBS_DEADGIANT_MIN,   cHi: m.OBS_DEADGIANT_MAX },
    { type: "dragonBones",rLo: 0.8, rHi: 1.2,  hLo: 1.0, hHi: 2.0, cLo: m.OBS_DRAGONBONES_MIN, cHi: m.OBS_DRAGONBONES_MAX },
  ];

  let obsId = 0;
  const obstacles   = [];
  const circ_placed = []; // { x, z, r } — for obstacle-vs-obstacle clearance

  for (const spec of OBS_SPECS) {
    // Skip disabled types before any RNG draw. NOTE: this means disabling a
    // type DOES shift the RNG stream seen by every later type — enabled types
    // will land at different positions than in a fully-enabled run. That is
    // intentional and acceptable: the guarantee is only that identical
    // seed + identical toggle set always produces an identical layout
    // (intra-run determinism). Multiplayer is safe because every client
    // renders the host-broadcast mapLayout rather than regenerating locally.
    if (enabledObstacles[spec.type] === false) continue;
    const count = randInt(rng, spec.cLo, spec.cHi);
    for (let i = 0; i < count; i++) {
      placed: for (let t = 0; t < TRIES; t++) {
        const r      = randRange(rng, spec.rLo, spec.rHi);
        const distMin = MAP_CENTER_CLEAR + 0.1;
        const distMax = placeRadius - r - 0.05;
        if (distMin > distMax) break placed; // type's r too large for the disc

        const ang  = rng() * Math.PI * 2;
        const dist = randRange(rng, distMin, distMax);
        const x    = Math.cos(ang) * dist;
        const z    = Math.sin(ang) * dist;

        if (!isValidCenter(x, z)) continue;
        if (!circleClear(x, z, r, circ_placed)) continue;
        if (!circleClearOfPlateaus(x, z, r)) continue;

        const height = randRange(rng, spec.hLo, spec.hHi);
        const rot    = rng() * Math.PI * 2;
        obstacles.push({ id: obsId++, type: spec.type, x, z, r, height, rot });
        circ_placed.push({ x, z, r });
        break placed; // eslint-disable-line no-labels
      }
    }
  }

  // worldId is stored on the layout so the query layer (arena-query.js) can
  // decide which features are still on the platform as the arena shrinks.
  return { seed, worldId, plateaus, obstacles };
}
