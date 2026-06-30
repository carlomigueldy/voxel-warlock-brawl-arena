// src/mob.js — Mob entity, MobBrain AI, spawnMob factory, seeded PRNG.
// Pure logic module: no Three.js imports.  Headless-testable.
// Mirrors bot.js conventions; runs host-side in sim.js at 30 Hz.
//
// Public exports:
//   makeMobPrng(seed)         → seeded PRNG function (used by sim._mobRand)
//   stepMobPhysics(mob,dt,arena) → collision-slide + terrain + hazard fall
//   class Mob                 → entity data model + snapshot()
//   class MobBrain            → simplified nearest-target AI
//   spawnMob(id,type,x,z,parentId?) → factory

import { CFG } from "./config.js";

// ── Seeded PRNG (Mulberry32) ─ same pattern as bot.js:14-32 ─────────────────
// Never use Math.random() in mob logic so simulations are always reproducible.

function idSeed(id) {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function makePrng(seed) {
  let s = seed >>> 0;
  return function next() {
    s += 0x6d2b79f5;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Create a deterministic PRNG for mob-level decisions.
 * sim.js stores this as `this._mobRand` and reseeds it each round via
 * `this._mobRand = makeMobPrng(matchSeed)`.
 */
export function makeMobPrng(seed) {
  return makePrng(seed >>> 0);
}

// ── Shared physics helper ─────────────────────────────────────────────────────
/**
 * Advance one mob's physics by `dt` seconds.
 * Replicates the collision-slide + terrain-follow + hazard-fall block from
 * Player.step (player.js:181-349) so mobs respect plateaus/obstacles and ring
 * out at CFG.LAVA_Y exactly like players.
 *
 * Required arena interface:
 *   isOnPlatform(x, z)           → boolean
 *   groundHeightAt?(x, z)        → number  (optional — skipped if absent)
 *   blocksMovement?(x, z, y)     → boolean (optional — skipped if absent)
 *   onRamp?(x, z)                → boolean (optional)
 *
 * Mob fields read/written:
 *   x, z, y, vx, vz, vy, groundY, falling, _hazardTime,
 *   _moveX, _moveZ  (movement intent set by MobBrain each tick)
 *
 * Caller (sim.stepMobs) checks `mob.y <= CFG.LAVA_Y` after this returns while
 * mob.falling is true and calls killMob(mob, "lava") accordingly.
 */
export function stepMobPhysics(mob, dt, arena) {
  // ── Falling path (off the edge, plummeting toward lava) ─────────────────
  if (mob.falling) {
    mob.vy -= CFG.GRAVITY * dt;
    mob.y  += mob.vy * dt;
    mob.x  += mob.vx * dt;
    mob.z  += mob.vz * dt;
    return; // caller handles LAVA_Y death check
  }

  const typeCfg = CFG.MOB_TYPES[mob.type];
  const prevX = mob.x, prevZ = mob.z;

  // ── Movement intent (set by MobBrain.think()) ───────────────────────────
  const mlen = Math.hypot(mob._moveX, mob._moveZ);
  if (mlen > 0.01) {
    const nx = mob._moveX / mlen, nz = mob._moveZ / mlen;
    mob.x += nx * typeCfg.speed * dt;
    mob.z += nz * typeCfg.speed * dt;
  }

  // ── Knockback velocity + friction decay ─────────────────────────────────
  mob.x += mob.vx * dt;
  mob.z += mob.vz * dt;
  const decay = Math.exp(-CFG.FRICTION * dt);
  mob.vx *= decay;
  mob.vz *= decay;

  // ── Collision-slide against plateau walls and obstacles ─────────────────
  // Mirrors player.js:248-281.  Uses mob.y so mobs on top of features are
  // never blocked by the feature's own side faces.
  if (arena.blocksMovement) {
    const dx = mob.x - prevX, dz = mob.z - prevZ;
    // Midpoint substep: prevents tunnelling when strong knockback carries the
    // mob more than one PLAYER_RADIUS in a single tick.
    if (Math.hypot(dx, dz) > CFG.PLAYER_RADIUS) {
      const mx = prevX + dx * 0.5, mz = prevZ + dz * 0.5;
      if (arena.blocksMovement(mx, mz, mob.y) &&
          !arena.blocksMovement(prevX, prevZ, mob.y)) {
        if (!arena.blocksMovement(mx, prevZ, mob.y)) {
          mob.x = mx; mob.z = prevZ;
        } else if (!arena.blocksMovement(prevX, mz, mob.y)) {
          mob.x = prevX; mob.z = mz;
        } else {
          mob.x = prevX; mob.z = prevZ;
        }
      }
    }
    // Endpoint slide check.
    if (arena.blocksMovement(mob.x, mob.z, mob.y) &&
        !arena.blocksMovement(prevX, prevZ, mob.y)) {
      if (!arena.blocksMovement(mob.x, prevZ, mob.y)) {
        mob.z = prevZ;
      } else if (!arena.blocksMovement(prevX, mob.z, mob.y)) {
        mob.x = prevX;
      } else {
        mob.x = prevX; mob.z = prevZ;
      }
    }
  }

  // ── Vertical physics: terrain-follow and airborne-over-ledge ─────────────
  // Mirrors player.js:295-330.
  if (arena.isOnPlatform(mob.x, mob.z) && arena.groundHeightAt) {
    const newGroundY = arena.groundHeightAt(mob.x, mob.z);
    mob.groundY = newGroundY;
    const isOnRamp = arena.onRamp ? arena.onRamp(mob.x, mob.z) : false;
    if (!isOnRamp && mob.y > newGroundY + 0.01) {
      // Airborne over a ledge: apply gravity.
      mob.vy -= CFG.GRAVITY * dt;
      mob.y  += mob.vy * dt;
      if (mob.y <= newGroundY) {
        mob.y  = newGroundY;
        mob.vy = 0;
        // (No fall-stun for mobs — they're tough.)
      }
    } else {
      // Grounded (or descending a ramp): snap to surface.
      mob.y  = newGroundY;
      mob.vy = 0;
    }
  }

  // ── Off the edge → accumulate hazard time → begin falling ──────────────
  // Mirrors player.js:333-349.  Mobs have no Lava Treads grace.
  if (!arena.isOnPlatform(mob.x, mob.z)) {
    mob._hazardTime += dt;
    if (mob._hazardTime >= CFG.HAZARD_DEATH_DELAY) {
      mob.falling = true;
      mob.vy = 1.5;
    }
  } else {
    mob._hazardTime = 0;
  }
}

// ── Mob ───────────────────────────────────────────────────────────────────────
export class Mob {
  /**
   * @param {string}      id       Unique mob id, e.g. "mob:1" (assigned by sim)
   * @param {string}      type     Key of CFG.MOB_TYPES
   * @param {number}      x        Spawn X (world units)
   * @param {number}      z        Spawn Z (world units)
   * @param {string|null} parentId Set for minions; null for big mobs
   */
  constructor(id, type, x, z, parentId = null) {
    const typeCfg = CFG.MOB_TYPES[type];
    if (!typeCfg) throw new Error(`Unknown mob type: "${type}"`);

    this.id   = id;
    this.type = type;

    // Position / velocity
    this.x = x;  this.z = z;  this.y = 0; // y snapped to groundY by sim
    this.vx = 0; this.vz = 0; this.vy = 0;
    this.groundY = 0;
    this.aim     = 0;

    // Health (hit-count — no HP, smash-style)
    this.maxHits       = typeCfg.maxHits;
    this.hitsRemaining = typeCfg.maxHits;

    // Lifecycle
    this.alive       = true;
    this.falling     = false;
    this._hazardTime = 0;

    // Targeting + action cooldowns
    this.targetId   = null;
    this.meleeCd    = 0;
    this.rangedCd   = 0;
    // Start ability on cooldown so it can't fire the instant spawn-invuln expires.
    this.abilityCd  = typeCfg.abilityEvery ?? 0;
    // Big mobs wait a full cycle before spawning their first minion.
    this.minionCd   = typeCfg.canSpawnMinions ? (CFG.MOB_MINION_CD || 15) : 0;

    // Parenting (minion chain)
    this.parentId   = parentId;
    this.childCount = 0; // counts live children; only meaningful for big mobs

    // Post-spawn grace window: mob moves but deals no damage / fires no ranged.
    this.spawnInvuln = CFG.MOB_SPAWN_INVULN;

    // Cinematic entrance window: big mobs are frozen in place and cannot be
    // targeted or damaged until the entrance animation completes.
    // Minions (parentId set OR type === "minion") skip the entrance entirely.
    this.entering = (parentId !== null || type === "minion") ? 0 : CFG.MOB_ENTRANCE;

    // Movement intent set each tick by MobBrain.think(); consumed by stepMobPhysics.
    this._moveX = 0;
    this._moveZ = 0;

    // Active telegraphed-ability channel (null = idle / no channel).
    // Set by sim._startMobChannel(); ticked and cleared by sim.stepMobs().
    this.channel = null;
  }

  /**
   * Serialisable snapshot consumed by renderer.apply() and sim snapshot().
   * Matches the shape specified in the plan §8.
   */
  snapshot() {
    return {
      id:    this.id,
      type:  this.type,
      x:     +this.x.toFixed(2),
      z:     +this.z.toFixed(2),
      y:     +this.y.toFixed(2),
      a:     +this.aim.toFixed(2),
      hp:    this.hitsRemaining,
      max:   this.maxHits,
      color: CFG.MOB_TYPES[this.type].color,
      f:     this.falling ? 1 : 0,
      ent:   +this.entering.toFixed(2),
      // Active channel summary for client telegraph rendering under packet loss.
      // null when idle; compact object when a telegraphed ability is winding up.
      ch:    this.channel
        ? { a: this.channel.ability, t: +this.channel.t.toFixed(2),
            r: this.channel.r, x: +this.channel.tx.toFixed(2), z: +this.channel.tz.toFixed(2) }
        : null,
    };
  }
}

// ── MobBrain ──────────────────────────────────────────────────────────────────
/**
 * Simplified mob AI — slower and dumber than BotBrain.
 * Nearest-target pursuit only; no leading, no team logic, no dodging.
 *
 * think() returns an action object each tick; caller (sim.stepMobs) applies
 * the side effects.  The brain also sets mob._moveX / mob._moveZ in-place so
 * stepMobPhysics can read them immediately after.
 *
 * Action shapes:
 *   { kind: "idle" }                        no target or invuln active
 *   { kind: "move" }                        moving toward target, no attack yet
 *   { kind: "melee",  target }              strike adjacent player
 *   { kind: "ranged", target }              fire a bolt at player
 *   { kind: "ability", target }             trigger signature ability
 *   { kind: "spawnMinion", x, z }           spawn a minion at (x,z)
 */
export class MobBrain {
  constructor(mobId) {
    // Each brain gets its own reproducible PRNG so per-mob stochastic decisions
    // (e.g. minion placement angle) don't corrupt the shared sim._mobRand.
    this._rand = makePrng(idSeed("brain:" + mobId));
  }

  /**
   * Main entry point — called once per sim tick.
   *
   * @param {Mob}      mob     The mob being driven
   * @param {Array}    players Array of Player/Bot instances in the sim (all, not just alive)
   * @param {number}   dt      Elapsed seconds this tick
   * @returns {object}         Action descriptor (see shapes above)
   */
  think(mob, players, dt) {
    if (!mob.alive) return { kind: "idle" };

    const typeCfg = CFG.MOB_TYPES[mob.type];

    // ── Tick down cooldowns ──────────────────────────────────────────────
    mob.meleeCd    = Math.max(0, mob.meleeCd    - dt);
    mob.rangedCd   = Math.max(0, mob.rangedCd   - dt);
    mob.minionCd   = Math.max(0, mob.minionCd   - dt);
    mob.spawnInvuln = Math.max(0, mob.spawnInvuln - dt);
    if (typeCfg.abilityEvery != null) {
      mob.abilityCd = Math.max(0, mob.abilityCd - dt);
    }

    // ── Cinematic entrance lock ──────────────────────────────────────────
    // Big mobs are frozen and silent while their entrance animation plays.
    // Caller (sim.stepMobs) reads mob.entering to suppress damage and to
    // emit the mobArrive event when it transitions 0+ → 0.
    if (mob.entering > 0) {
      mob.entering = Math.max(0, mob.entering - dt);
      mob._moveX = 0;
      mob._moveZ = 0;
      return { kind: "idle" };
    }

    // ── Mid-channel hold: rooted at cast point, no new actions ──────────
    // While a telegraphed ability is winding up the mob is frozen in place;
    // keep facing the locked cast point so the telegraph reads clearly.
    if (mob.channel) {
      mob._moveX = 0;
      mob._moveZ = 0;
      mob.aim = Math.atan2(mob.channel.tz - mob.z, mob.channel.tx - mob.x);
      return { kind: "idle" };
    }

    // ── Find nearest alive player / bot ──────────────────────────────────
    // Player-summoned minions (mob.ownerPlayerId set) must never target their
    // own caster — exclude the owner so the minion harries foes, not the summoner.
    const targets = players.filter(p => p.alive && !p.falling && p.id !== mob.ownerPlayerId);
    if (!targets.length) {
      mob._moveX = 0; mob._moveZ = 0;
      mob.targetId = null;
      return { kind: "idle" };
    }

    let nearest = null, nearestDist = Infinity;
    for (const p of targets) {
      const d = Math.hypot(p.x - mob.x, p.z - mob.z);
      if (d < nearestDist) { nearestDist = d; nearest = p; }
    }

    mob.targetId = nearest.id;
    const dx = nearest.x - mob.x;
    const dz = nearest.z - mob.z;
    mob.aim = Math.atan2(dz, dx);

    // ── Movement intent: walk toward target, stop at contact radius ───────
    const contactR = typeCfg.bodyR + CFG.PLAYER_RADIUS;
    if (nearestDist > contactR) {
      mob._moveX = dx;
      mob._moveZ = dz;
    } else {
      mob._moveX = 0;
      mob._moveZ = 0;
    }

    // ── Spawn invulnerability: move only, no combat actions ───────────────
    if (mob.spawnInvuln > 0) return { kind: "move" };

    // ── Signature ability (highest combat priority) ───────────────────────
    if (typeCfg.abilityEvery != null && mob.abilityCd <= 0 && nearestDist < 20) {
      mob.abilityCd = typeCfg.abilityEvery;
      return { kind: "ability", target: nearest };
    }

    // ── Minion spawn ──────────────────────────────────────────────────────
    if (typeCfg.canSpawnMinions &&
        mob.childCount < CFG.MOB_MAX_CHILDREN &&
        mob.minionCd <= 0) {
      mob.minionCd = CFG.MOB_MINION_CD;
      // Random angle around parent so minions fan out, not stack.
      const angle = this._rand() * Math.PI * 2;
      const dist  = typeCfg.bodyR + 1.5;
      return {
        kind: "spawnMinion",
        x: mob.x + Math.cos(angle) * dist,
        z: mob.z + Math.sin(angle) * dist,
      };
    }

    // ── Ranged attack ─────────────────────────────────────────────────────
    if (typeCfg.attack === "ranged" &&
        mob.rangedCd <= 0 &&
        nearestDist <= typeCfg.rangedRange) {
      mob.rangedCd = typeCfg.rangedEvery;
      return { kind: "ranged", target: nearest };
    }

    // ── Melee attack ──────────────────────────────────────────────────────
    // Allow a small extra reach (0.5 u) so the mob doesn't need pixel-perfect
    // contact, matching how player melee/push interactions work.
    if (mob.meleeCd <= 0 && nearestDist <= contactR + 0.5) {
      mob.meleeCd = typeCfg.meleeEvery;
      return { kind: "melee", target: nearest };
    }

    return { kind: "move" };
  }
}

// ── Factory ───────────────────────────────────────────────────────────────────
/**
 * Construct and return a new Mob.
 *
 * `id` is provided by sim.js as the string `"mob:" + this._mobId++` so the
 * simulation controls numbering and the id is guaranteed unique per match.
 *
 * @param {string}      id       Unique id string (e.g. "mob:3")
 * @param {string}      type     Key of CFG.MOB_TYPES
 * @param {number}      x        Spawn X
 * @param {number}      z        Spawn Z
 * @param {string|null} parentId Parent mob id for minions, null otherwise
 * @returns {Mob}
 */
export function spawnMob(id, type, x, z, parentId = null) {
  const mob = new Mob(id, type, x, z, parentId);
  mob._brain = new MobBrain(id);
  return mob;
}
