// Pure height/collision query layer for map layouts produced by mapgen.js.
// No THREE import — this module runs in Node (headless tests) and in the browser.
//
// Three exported standalone functions accept an explicit `layout` argument:
//   groundHeightAt(x, z, layout)
//   blocksMovement(x, z, fromY, layout)
//   obstaclesBlockingRay(x0, z0, y0, x1, z1, y1, layout)
//
// A MapQuery class wraps a stored layout so callers don't pass it each time.
// Both arena.js (rendering) and sim.js (LogicArena, headless) can hold one.
//
// Layout shape (from mapgen.generateMap):
//   { seed, plateaus, obstacles }
//   plateaus : [{ x, z, w, d, height, ramps:[{ side, x, z, w, d }] }]
//   obstacles: [{ id, type, x, z, r, height, rot }]
//
// Coordinate conventions:
//   X/Z horizontal, Y up. PLATFORM_TOP = 0.
//   Plateau x/z is the CENTRE; w/d are FULL extents.
//   Ramp x/z is the CENTRE; w/d are FULL extents.
//   Ramp sides: 0=+x face, 1=-x face, 2=+z face, 3=-z face.
import { CFG, isOnArenaWorld } from "./config.js";

const BASE_Y = CFG.PLATFORM_TOP; // 0 — the default platform surface

// A plateau (or obstacle) must be more than this many units above fromY to act
// as a wall.  Prevents blocking a player who is already on top of the feature.
const BLOCK_THRESHOLD = 0.3;

// ---------------------------------------------------------------------------
// Ramp helpers
// ---------------------------------------------------------------------------

/** Returns true when (x, z) lies inside a ramp's AABB footprint. */
function inRampBox(x, z, ramp) {
  return x >= ramp.x - ramp.w * 0.5 - 1e-6 &&
         x <= ramp.x + ramp.w * 0.5 + 1e-6 &&
         z >= ramp.z - ramp.d * 0.5 - 1e-6 &&
         z <= ramp.z + ramp.d * 0.5 + 1e-6;
}

/**
 * Interpolated height at (x, z) on a ramp.
 * Returns plateauHeight at the head (plateau edge) and 0 at the foot (ground).
 * Caller must have confirmed (x, z) is inside the ramp footprint.
 *
 * Ramp geometry from mapgen.js (all sides):
 *   side 0 (+x): extends in +x from plateau.  Head at ramp.x - ramp.w/2.
 *   side 1 (-x): extends in -x from plateau.  Head at ramp.x + ramp.w/2.
 *   side 2 (+z): extends in +z from plateau.  Head at ramp.z - ramp.d/2.
 *   side 3 (-z): extends in -z from plateau.  Head at ramp.z + ramp.d/2.
 */
function rampHeightAt(x, z, ramp, plateauHeight) {
  // t = 0 at the head (full height), t = 1 at the foot (ground).
  let t;
  switch (ramp.side) {
    case 0: { const head = ramp.x - ramp.w * 0.5; t = (x - head) / ramp.w; break; }
    case 1: { const head = ramp.x + ramp.w * 0.5; t = (head - x) / ramp.w; break; }
    case 2: { const head = ramp.z - ramp.d * 0.5; t = (z - head) / ramp.d; break; }
    default: { const head = ramp.z + ramp.d * 0.5; t = (head - z) / ramp.d; break; }
  }
  return plateauHeight * (1 - Math.max(0, Math.min(1, t)));
}

// ---------------------------------------------------------------------------
// 2-D geometric helpers (XZ plane)
// ---------------------------------------------------------------------------

/**
 * Liang-Barsky segment/AABB intersection test (XZ only).
 * Returns [tEnter, tExit] (both ∈ [0,1]) or null when the segment misses.
 */
function segmentAABB2D(x0, z0, x1, z1, xMin, xMax, zMin, zMax) {
  let lo = 0, hi = 1;
  const dx = x1 - x0;
  if (Math.abs(dx) < 1e-10) {
    if (x0 < xMin || x0 > xMax) return null;
  } else {
    let t1 = (xMin - x0) / dx, t2 = (xMax - x0) / dx;
    if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
    lo = Math.max(lo, t1);
    hi = Math.min(hi, t2);
    if (lo > hi) return null;
  }
  const dz = z1 - z0;
  if (Math.abs(dz) < 1e-10) {
    if (z0 < zMin || z0 > zMax) return null;
  } else {
    let t1 = (zMin - z0) / dz, t2 = (zMax - z0) / dz;
    if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
    lo = Math.max(lo, t1);
    hi = Math.min(hi, t2);
    if (lo > hi) return null;
  }
  return [lo, hi];
}

/**
 * Parametric segment/circle intersection test (XZ only).
 * Returns the first entry parameter t ∈ [0,1] inside the circle, or null.
 */
function segmentCircle2D(x0, z0, x1, z1, cx, cz, r) {
  const dx = x1 - x0, dz = z1 - z0;
  const fx = x0 - cx, fz = z0 - cz;
  const a = dx * dx + dz * dz;
  const b = 2 * (fx * dx + fz * dz);
  const c = fx * fx + fz * fz - r * r;
  const disc = b * b - 4 * a * c;
  if (disc < 0 || a < 1e-12) return null;
  const sq = Math.sqrt(disc);
  const inv2a = 1 / (2 * a);
  const t1 = (-b - sq) * inv2a;
  const t2 = (-b + sq) * inv2a;
  if (t1 >= 0 && t1 <= 1) return t1;
  if (t2 >= 0 && t2 <= 1) return t2;
  return null;
}

// ---------------------------------------------------------------------------
// Public standalone functions
// ---------------------------------------------------------------------------

/**
 * Ground height at (x, z) given the map layout.
 *
 * Priority:
 *   1. Ramp footprint   → linearly interpolated from 0 (foot) to height (head).
 *   2. Plateau top box  → BASE_Y + plateau.height (flat top surface).
 *   3. Base platform    → BASE_Y (0).
 *
 * @param {number} x
 * @param {number} z
 * @param {{ plateaus:object[], obstacles:object[] }|null} layout
 * @returns {number}
 */
export function groundHeightAt(x, z, layout) {
  if (!layout) return BASE_Y;
  for (const pl of layout.plateaus) {
    // Ramps are checked first: they lie outside the plateau box and transition
    // the height smoothly, so they take priority at their footprint.
    for (const ramp of pl.ramps) {
      if (inRampBox(x, z, ramp)) {
        return BASE_Y + rampHeightAt(x, z, ramp, pl.height);
      }
    }
    // Plateau top (the elevated flat surface).
    const hw = pl.w * 0.5, hd = pl.d * 0.5;
    if (x >= pl.x - hw - 1e-6 && x <= pl.x + hw + 1e-6 &&
        z >= pl.z - hd - 1e-6 && z <= pl.z + hd + 1e-6) {
      return BASE_Y + pl.height;
    }
  }
  return BASE_Y;
}

/**
 * Returns true when (x, z) is inside a blocked region given fromY.
 *
 * A plateau wall blocks if:
 *   • (x, z) is inside the plateau's AABB box, AND
 *   • the plateau top is more than BLOCK_THRESHOLD above fromY, AND
 *   • (x, z) is NOT inside any of the plateau's ramp footprints
 *     (ramps are accessible transitions, not walls).
 *
 * An obstacle blocks if:
 *   • (x, z) is within the obstacle's circle footprint, AND
 *   • the obstacle height is more than BLOCK_THRESHOLD above fromY.
 *
 * @param {number} x
 * @param {number} z
 * @param {number} fromY  – the mover's current ground height
 * @param {{ plateaus:object[], obstacles:object[] }|null} layout
 * @returns {boolean}
 */
export function blocksMovement(x, z, fromY, layout) {
  if (!layout) return false;

  for (const pl of layout.plateaus) {
    const plateauTop = BASE_Y + pl.height;
    if (plateauTop <= fromY + BLOCK_THRESHOLD) continue; // mover is already near plateau height
    const hw = pl.w * 0.5, hd = pl.d * 0.5;
    if (x >= pl.x - hw - 1e-6 && x <= pl.x + hw + 1e-6 &&
        z >= pl.z - hd - 1e-6 && z <= pl.z + hd + 1e-6) {
      // Inside plateau box — check if a ramp at this position makes it passable.
      let onRamp = false;
      for (const ramp of pl.ramps) {
        if (inRampBox(x, z, ramp)) { onRamp = true; break; }
      }
      if (!onRamp) return true;
    }
  }

  for (const ob of layout.obstacles) {
    if (ob.height <= fromY + BLOCK_THRESHOLD) continue;
    if (Math.hypot(x - ob.x, z - ob.z) < ob.r - 1e-6) return true;
  }

  return false;
}

/**
 * Returns true when the line segment from (x0,z0,y0) to (x1,z1,y1) is blocked
 * by a plateau wall or an obstacle in the layout.
 *
 * Blocking rules:
 *   Plateau: the XZ segment enters the plateau AABB, AND the ray's Y at the
 *     intersection overlaps [BASE_Y, BASE_Y + plateau.height] (it hits the wall,
 *     not just passes above the plateau top or below the ground plane).
 *   Obstacle: the XZ segment passes within obstacle.r of the obstacle centre,
 *     AND the ray's Y at the entry point is below obstacle.height.
 *
 * @param {number} x0 @param {number} z0 @param {number} y0  – segment start
 * @param {number} x1 @param {number} z1 @param {number} y1  – segment end
 * @param {{ plateaus:object[], obstacles:object[] }|null} layout
 * @returns {boolean}
 */
export function obstaclesBlockingRay(x0, z0, y0, x1, z1, y1, layout) {
  if (!layout) return false;

  const dy = y1 - y0;

  // Plateau side check: treat each plateau as a solid box from BASE_Y to its top.
  for (const pl of layout.plateaus) {
    const hw = pl.w * 0.5, hd = pl.d * 0.5;
    const hit = segmentAABB2D(x0, z0, x1, z1,
      pl.x - hw, pl.x + hw, pl.z - hd, pl.z + hd);
    if (!hit) continue;
    const [tEnter, tExit] = hit;
    // Y range of the segment while it's inside the plateau's XZ footprint.
    const yEnter = y0 + dy * tEnter;
    const yExit  = y0 + dy * tExit;
    const yLo = Math.min(yEnter, yExit);
    const yHi = Math.max(yEnter, yExit);
    const plateauTop = BASE_Y + pl.height;
    // Blocked if the Y band overlaps the plateau wall region [BASE_Y, plateauTop].
    if (yLo < plateauTop && yHi > BASE_Y - 0.1) return true;
  }

  // Obstacle check: circle footprint in XZ, height cap in Y.
  for (const ob of layout.obstacles) {
    const t = segmentCircle2D(x0, z0, x1, z1, ob.x, ob.z, ob.r);
    if (t === null) continue;
    const yAtEntry = y0 + dy * t;
    if (yAtEntry < ob.height) return true;
  }

  return false;
}

/**
 * Returns true when (x, z) lies inside ANY ramp footprint in the layout.
 *
 * Used by player.js vertical physics to distinguish a ramp descent
 * (smooth surface change — player stays grounded, no stun) from a real
 * ledge/cliff fall (player goes airborne, stun may apply on landing).
 *
 * @param {number} x
 * @param {number} z
 * @param {{ plateaus:object[], obstacles:object[] }|null} layout
 * @returns {boolean}
 */
export function onRamp(x, z, layout) {
  if (!layout) return false;
  for (const pl of layout.plateaus) {
    for (const ramp of pl.ramps) {
      if (inRampBox(x, z, ramp)) return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// MapQuery — a stateful wrapper so callers don't pass layout on every call.
// Arena (rendering) and LogicArena (sim, headless) both hold one of these.
// ---------------------------------------------------------------------------

export class MapQuery {
  constructor(layout = null) {
    /** @type {{ worldId?:string, plateaus:object[], obstacles:object[] }|null} */
    this.layout = layout;
    // Active-radius filtering: as the arena shrinks, features whose CENTRE has
    // left the platform are inert. activeRadius = Infinity means "no shrink
    // filtering" (the default, so headless tests see the full layout).
    this.activeRadius = Infinity;
    this._activeLayout = layout;   // cached filtered view
    this._activeKey = null;        // quantized radius the cache was built for
  }

  /** Replace the stored layout (call at round start after generateMap). */
  setLayout(layout) {
    this.layout = layout;
    this.activeRadius = Infinity;
    this._activeLayout = layout;
    this._activeKey = null;
  }

  /**
   * Update the current (shrinking) arena radius. Features whose centre is off
   * the platform at this radius stop blocking movement/rays and report base
   * ground height. Cheap: the filtered view is rebuilt only when the radius
   * crosses a 0.25-unit bucket.
   */
  setActiveRadius(radius) {
    this.activeRadius = radius;
    if (!this.layout || !Number.isFinite(radius)) { this._activeLayout = this.layout; this._activeKey = null; return; }
    const key = Math.round(radius * 4); // 0.25-unit buckets
    if (key === this._activeKey) return;
    this._activeKey = key;
    const worldId = this.layout.worldId ?? CFG.DEFAULT_ARENA_WORLD;
    const onPlat = (cx, cz) => isOnArenaWorld(worldId, radius, cx, cz);
    this._activeLayout = {
      worldId,
      plateaus:  this.layout.plateaus.filter((pl) => onPlat(pl.x, pl.z)),
      obstacles: this.layout.obstacles.filter((ob) => onPlat(ob.x, ob.z)),
    };
  }

  /** Is the feature whose centre is (cx,cz) still on the platform? */
  isActiveAt(cx, cz) {
    if (!Number.isFinite(this.activeRadius) || !this.layout) return true;
    const worldId = this.layout.worldId ?? CFG.DEFAULT_ARENA_WORLD;
    return isOnArenaWorld(worldId, this.activeRadius, cx, cz);
  }

  groundHeightAt(x, z)                              { return groundHeightAt(x, z, this._activeLayout); }
  blocksMovement(x, z, fromY)                        { return blocksMovement(x, z, fromY, this._activeLayout); }
  obstaclesBlockingRay(x0, z0, y0, x1, z1, y1)      { return obstaclesBlockingRay(x0, z0, y0, x1, z1, y1, this._activeLayout); }
  onRamp(x, z)                                       { return onRamp(x, z, this._activeLayout); }
}
