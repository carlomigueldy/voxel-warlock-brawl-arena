// Pure placement logic for dungeon-dressing decorations (WS-C).
//
// This module is deliberately THREE-free so it stays importable under plain
// `node test/decorations.test.mjs` — "three" only resolves via index.html's
// browser import map (see scripts/blender/README.md's neighbor concern: the
// same "no bundler resolution in Node" constraint documented for the JS/TS
// migration applies here too). The THREE.Group assembly step that clones
// propModel templates / procedural fallbacks lives in src/decorationsView.js,
// which imports this module's computeDecorationPlacements() and THREE
// separately, exactly so this file can be unit-tested headlessly.
//
// Decorations NEVER affect sim/collision: they are not obstacles, they are
// not registered with mapgen or arena-query, and nothing here reads or
// writes CFG.MAP. They are purely cosmetic dressing built from the map
// layout's own seed so every P2P client renders identical decorations.
import { CFG, isOnArenaWorld } from "./config.js";
import { MAP_CENTER_CLEAR, MAP_SPAWN_RING_CLEAR } from "./mapgen.js";

// ---------------------------------------------------------------------------
// Seeded PRNG — same Mulberry32 recipe as mapgen.js (not imported from there;
// mapgen.js doesn't export it, and decorations run as a wholly separate
// deterministic stream keyed off the same broadcast layout seed).
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

function randRange(rng, lo, hi) { return lo + rng() * (hi - lo); }
function randInt(rng, lo, hi) { return Math.floor(lo + rng() * (hi - lo + 1 - 1e-9)); }

// Weighted random pick from a `[{ prop, weight }]` pool (CFG.DECOR.themes[*].ring/interior).
function weightedPick(rng, pool) {
  const total = pool.reduce((s, e) => s + e.weight, 0);
  let r = rng() * total;
  for (const e of pool) {
    if (r < e.weight) return e.prop;
    r -= e.weight;
  }
  return pool[pool.length - 1].prop;
}

function themeFor(worldId) {
  return CFG.DECOR.themes[worldId] || CFG.DECOR.themes[CFG.DEFAULT_ARENA_WORLD];
}

/**
 * Compute this round's decoration placements — pure function of (seed,
 * worldId, arenaRadius, obstacles). Same inputs always produce the exact
 * same output array (byte-for-byte), so every client renders identical
 * decorations from the host-broadcast mapLayout without exchanging any
 * extra data.
 *
 * @param {number} seed         – mapLayout.seed (the same seed mapgen.generateMap used)
 * @param {string} worldId      – arena world id (e.g. "circle")
 * @param {number} arenaRadius  – the round's starting arena radius (world units)
 * @param {object[]} [obstacles=[]] – mapLayout.obstacles ({ x, z, r, ... })
 * @returns {{prop:string, x:number, z:number, rot:number, scale:number, ring:boolean}[]}
 */
export function computeDecorationPlacements(seed, worldId, arenaRadius, obstacles = []) {
  const D = CFG.DECOR;
  const theme = themeFor(worldId);
  const rng = mulberry32((seed ^ 0x5eed2025) >>> 0);
  const placements = [];

  // --- Ring: purely cosmetic scatter outside the play radius, on the
  // hazard rim. Never culled by arena shrink (see renderer.js integration —
  // these aren't "on the platform" to begin with, so they behave like the
  // existing hazard ambient-detail props, not like obstacles). ---
  const ringCount = Math.min(randInt(rng, D.ringCountMin, D.ringCountMax), D.maxCount);
  for (let i = 0; i < ringCount; i++) {
    const ang = rng() * Math.PI * 2;
    const dist = arenaRadius + randRange(rng, D.ringOffsetMin, D.ringOffsetMax);
    placements.push({
      prop: weightedPick(rng, theme.ring),
      x: Math.cos(ang) * dist,
      z: Math.sin(ang) * dist,
      rot: rng() * Math.PI * 2,
      scale: randRange(rng, 0.85, 1.25),
      ring: true,
    });
  }

  // --- Interior: accents near (never on) obstacles, respecting the same
  // centre/spawn-ring clearance mapgen.js uses for obstacles, plus a minimum
  // gap from every obstacle's own collision circle. Culled by arena shrink
  // exactly like obstacles (see renderer.js's _cullMapMeshes). ---
  const spawnRingR = Math.min(arenaRadius - 3, 12);
  function isValidInterior(x, z) {
    const d = Math.hypot(x, z);
    if (d < MAP_CENTER_CLEAR) return false;
    if (Math.abs(d - spawnRingR) < MAP_SPAWN_RING_CLEAR) return false;
    if (!isOnArenaWorld(worldId, arenaRadius, x, z)) return false;
    for (const ob of obstacles) {
      if (Math.hypot(x - ob.x, z - ob.z) < ob.r + D.interiorClearance) return false;
    }
    return true;
  }

  const budget = Math.max(0, D.maxCount - placements.length);
  const interiorTarget = Math.min(randInt(rng, D.interiorCountMin, D.interiorCountMax), budget);
  const TRIES_PER_PLACEMENT = 20;
  let placed = 0;
  let attempts = 0;
  while (placed < interiorTarget && attempts < interiorTarget * TRIES_PER_PLACEMENT) {
    attempts++;
    let x, z;
    if (obstacles.length > 0 && rng() < 0.7) {
      // Near an obstacle, just outside its clearance ring.
      const ob = obstacles[Math.floor(rng() * obstacles.length)];
      const ang = rng() * Math.PI * 2;
      const dist = ob.r + D.interiorClearance + rng() * 1.5;
      x = ob.x + Math.cos(ang) * dist;
      z = ob.z + Math.sin(ang) * dist;
    } else {
      // Free scatter within the placeable disc.
      const ang = rng() * Math.PI * 2;
      const dist = randRange(rng, MAP_CENTER_CLEAR + 0.5, arenaRadius * 0.85);
      x = Math.cos(ang) * dist;
      z = Math.sin(ang) * dist;
    }

    if (!isValidInterior(x, z)) continue;
    placements.push({
      prop: weightedPick(rng, theme.interior),
      x, z,
      rot: rng() * Math.PI * 2,
      scale: randRange(rng, 0.8, 1.15),
      ring: false,
    });
    placed++;
  }

  return placements;
}
