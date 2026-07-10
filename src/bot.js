// Bot AI — BotBrain class, archetype profiles, and skill modules.
// Pure logic module; runs host-side at 30 Hz. Deliberately free of Three.js
// so it can be unit-tested headlessly in Node.
//
// Design goals (see docs/MEMORY.md and the approved plan):
//   • Three distinct playstyles (Brawler / Trickster / Duelist), not just a power knob.
//   • Seeded PRNG keyed off bot id — tests reproduce deterministically.
//   • Skill modules: aimWithLead, dodgeVector, positioning, selectAbility, combo state.
//   • Top tier is hard but FAIR: reaction delay + aimError give real openings.
import { CFG, SPELLS } from "./config.js";
import { idSeed, makePrng } from "./rng.js";

// ── Swept-collision helper (shared with sim.js) ───────────────────────────
// Minimum distance between two linearly-moving points over a unit time step.
// Exported so sim.js can import rather than duplicate.
export function closestApproach(a0x, a0z, a1x, a1z, b0x, b0z, b1x, b1z) {
  const rx = a0x - b0x, rz = a0z - b0z;
  const vx = (a1x - a0x) - (b1x - b0x);
  const vz = (a1z - a0z) - (b1z - b0z);
  const vv = vx * vx + vz * vz;
  let t = vv > 1e-12 ? -(rx * vx + rz * vz) / vv : 0;
  if (t < 0) t = 0; else if (t > 1) t = 1;
  const ax = a0x + (a1x - a0x) * t, az = a0z + (a1z - a0z) * t;
  const bx = b0x + (b1x - b0x) * t, bz = b0z + (b1z - b0z) * t;
  return { dist: Math.hypot(ax - bx, az - bz), t };
}

// ── Archetype profiles ─────────────────────────────────────────────────────
// Replaces the old BOT_SETTINGS flat object. Bots no longer run a separate
// hardcoded fireball timer — fireball is just another weighted candidate in
// abilityWeights, scored by selectAbility() like every other equipped spell.
// The cast-cadence hierarchy expert > brilliant > smart is guaranteed by
// abilityEvery (lower = faster) — the single per-tier cast-gate timer.
export const BOT_PROFILES = {
  /**
   * Brawler — aggressive close-range pressure, telegraphed, approachable.
   * Loses to spacing; the "new player" tier.
   */
  smart: {
    preferredRange: 8,
    retreatRange: 3,
    abilityEvery: 1.0,
    leadFactor: 0.10,      // barely predicts target movement
    aimError: 0.22,        // wide sine-like wobble
    reactionMs: 550,       // slow to perceive threats
    dodgeRange: 0,         // never looks for incoming projectiles
    dodgeChance: 0,
    aggression: 0.9,       // charges toward target most of the time
    loadout: ["berserkerBlade", "swiftBoots"],
    abilityWeights: {
      thrust: 0.5, shield: 0.3, meteor: 0, lightning: 0.3,
      gravity: 0, homing: 0.8, bouncer: 0.5, boomerang: 0.4, fireSpray: 0.6,
      // Kept below homing's effective score (0.7 base * 0.8 = 0.56) so smart
      // bots don't spam fireball exclusively — homing wins the roll whenever
      // it's off cooldown, giving this tier real kit variety (see F1 review).
      fireball: 0.5,
      // Draft-pool weights for the wider DOTA roster, all kept ≤ boomerang's
      // 0.4 so a drafted smart bot's *default* (non-draft) loadout ranking is
      // unaffected — low-finesse brawler avoids telegraphed/channel casts.
      target: 0.35, stun: 0.3, push: 0.35, pull: 0.2, explode: 0.2,
      vacuum: 0.15, swap: 0.1, heal: 0.15, invisible: 0.1,
      teleport: 0.3, windWalk: 0.25, rush: 0.35, blink: 0.25,
    },
  },

  /**
   * Trickster — mid-range kiter, moderate leading, ~55% dodge, combos & baits.
   * Edge-guards opportunistically; countered by aggressive all-ins.
   */
  brilliant: {
    preferredRange: 11,
    retreatRange: 5,
    abilityEvery: 0.65,
    leadFactor: 0.55,
    aimError: 0.10,
    reactionMs: 300,
    dodgeRange: 10,
    dodgeChance: 0.55,
    aggression: 0.5,
    loadout: ["wardingHelm", "swiftBoots"],
    abilityWeights: {
      thrust: 0.4, shield: 0.7, meteor: 0.5, lightning: 0.8,
      gravity: 0.6, homing: 0.6, bouncer: 0.8, boomerang: 0.7, fireSpray: 0.5,
      fireball: 0.8,
      // Draft-pool weights, all kept ≤ homing's 0.6 so a drafted brilliant
      // bot's default (non-draft) loadout ranking is unaffected — trickster
      // leans into control/utility (stun, swap, invisible) more than smart.
      target: 0.55, stun: 0.5, push: 0.45, pull: 0.5, explode: 0.5,
      vacuum: 0.4, swap: 0.45, heal: 0.35, invisible: 0.5,
      teleport: 0.5, windWalk: 0.5, rush: 0.35, blink: 0.55,
    },
  },

  /**
   * Duelist — full pro brain, reliable dodge, disciplined spacing, edge-guard,
   * conserves escapes, chains combos. Hard but has real openings (not frame-perfect).
   */
  expert: {
    preferredRange: 9,
    retreatRange: 5,
    abilityEvery: 0.35,
    leadFactor: 0.90,      // near-correct leading; bounded jitter keeps it human
    aimError: 0.025,
    reactionMs: 175,
    dodgeRange: 14,
    dodgeChance: 0.85,
    aggression: 0.7,
    loadout: ["wardingHelm", "arcaneSigil"],
    abilityWeights: {
      thrust: 0.6, shield: 0.9, meteor: 0.9, lightning: 0.95,
      gravity: 0.85, homing: 0.7, bouncer: 0.7, boomerang: 0.8, fireSpray: 0.4,
      fireball: 0.75,
      // Draft-pool weights, all kept ≤ boomerang's 0.8 so a drafted expert
      // bot's default (non-draft) loadout ranking is unaffected — disciplined
      // pro leans hardest into the highest-value new spells (target, explode).
      target: 0.75, stun: 0.65, push: 0.55, pull: 0.6, explode: 0.75,
      vacuum: 0.45, swap: 0.55, heal: 0.4, invisible: 0.45,
      teleport: 0.6, windWalk: 0.45, rush: 0.4, blink: 0.6,
    },
  },
};

const BOT_DEFAULT_CAST_RANGE = 16; // fallback for spells without an explicit range

// Spells that reposition the caster — used both by the edge-danger escape
// branch in selectAbility() and by the "always include an escape spell" rule
// in botSpellLoadout()/botDraftPick() below.
const MOBILITY_SPELLS = ["thrust", "teleport", "blink", "windWalk", "rush"];

// New DOTA-roster spells (Step: bot draft-aware kit) worth drafting/casting.
// Kept separate from CFG.SPELLS' full 33 so drag/summon/speed/link/timeShift/
// pocketWatch/projectile/splitter/disable — which need bot-AI handling this
// pass doesn't add (channel-move restrictions, redundant with rush/windWalk,
// or item-like semantics) — are left out of the weighted draft/combat pool.
const VARIETY_SPELLS = ["swap", "pull", "stun", "explode", "target", "push", "vacuum", "heal", "invisible", "blink"];

// ── Skill module: aimWithLead ──────────────────────────────────────────────
// Intercept-aim: adjust angle to lead a target moving at estimated velocity.
// leadFactor ∈ [0,1] scales how much of the prediction is applied.
function aimWithLead(botX, botZ, targetX, targetZ, tvx, tvz, leadFactor) {
  const dx = targetX - botX, dz = targetZ - botZ;
  const dist = Math.hypot(dx, dz) || 1;
  const travelTime = dist / CFG.BOLT_SPEED;
  const predX = targetX + tvx * travelTime * leadFactor;
  const predZ = targetZ + tvz * travelTime * leadFactor;
  return Math.atan2(predZ - botZ, predX - botX);
}

// ── Skill module: dodgeVector ──────────────────────────────────────────────
// Scan incoming hostile bolts/meteors for threats within the reaction window.
// Returns a perpendicular evade vector {x,z}, or null if nothing to dodge.
// O(bolts + meteors) per call.
// Exported so tests can unit-test the dodge logic in isolation.
export function dodgeVector(sim, bot, profile, rand) {
  if (profile.dodgeChance <= 0 || profile.dodgeRange <= 0) return null;

  const reactionSec = profile.reactionMs / 1000;
  const hitThreshold = CFG.PLAYER_RADIUS + CFG.BOLT_RADIUS + 0.4;

  let bestThreat = null;
  let bestDist = Infinity;

  for (const bolt of sim.bolts) {
    if (bolt.dead || bolt.ownerId === bot.id) continue;
    const dxBolt = bolt.x - bot.x, dzBolt = bolt.z - bot.z;
    if (Math.hypot(dxBolt, dzBolt) > profile.dodgeRange) continue;

    // Project bolt's path over the reaction window using its actual velocity.
    const nextBX = bolt.x + bolt.vx * reactionSec;
    const nextBZ = bolt.z + bolt.vz * reactionSec;
    // Bot is treated as stationary (pessimistic / safe assumption).
    const approach = closestApproach(
      bot.x, bot.z, bot.x, bot.z,
      bolt.x, bolt.z, nextBX, nextBZ
    );
    if (approach.dist < hitThreshold && approach.dist < bestDist) {
      // Confirm bolt is heading toward bot (dot product of bolt dir with to-bot vec).
      const bSpeed = Math.hypot(bolt.vx, bolt.vz) || 1;
      const bdx = bolt.vx / bSpeed, bdz = bolt.vz / bSpeed;
      const toBotLen = Math.hypot(-dxBolt, -dzBolt) || 1;
      const dot = (bdx * (-dxBolt) + bdz * (-dzBolt)) / toBotLen;
      if (dot > 0.2) {
        bestDist = approach.dist;
        bestThreat = { bdx, bdz }; // normalized bolt direction
      }
    }
  }

  // Meteors: flee from impact radius.
  for (const meteor of sim.meteors) {
    const d = Math.hypot(meteor.x - bot.x, meteor.z - bot.z);
    if (d < meteor.radius + 2 && d < bestDist) {
      bestDist = d;
      // Encode as "bolt coming from meteor center" so perp logic works uniformly.
      const awayLen = d || 1;
      bestThreat = {
        bdx: -(bot.x - meteor.x) / awayLen,
        bdz: -(bot.z - meteor.z) / awayLen,
      };
    }
  }

  if (!bestThreat) return null;
  if (rand() > profile.dodgeChance) return null; // stochastic skill gate

  // Pick the perpendicular side that keeps bot closer to arena centre.
  const px = -bestThreat.bdz, pz = bestThreat.bdx;
  const d1 = Math.hypot(bot.x + px, bot.z + pz);
  const d2 = Math.hypot(bot.x - px, bot.z - pz);
  return d1 <= d2 ? { x: px, z: pz } : { x: -px, z: -pz };
}

// ── Skill module: positioning ──────────────────────────────────────────────
// Returns [moveX, moveZ] representing this tick's movement intent.
// Replaces the fixed per-bot strafe with intent-driven spacing + kiting.
function positioning(sim, bot, target, profile, dodgeVec) {
  const dx = target.x - bot.x, dz = target.z - bot.z;
  const dist = Math.hypot(dx, dz) || 1;
  const towardX = dx / dist, towardZ = dz / dist;
  const centerDist = Math.hypot(bot.x, bot.z) || 1;
  const edgeDanger = sim.arena.radius - centerDist < 4;

  // Ring-shrink lookahead: bias positioning toward where the ring WILL be a
  // few seconds from now (using the sim's own shrink rate), not just where it
  // is this tick, so bots start drifting inward before they're forced to —
  // mirrors a human anticipating the shrink instead of reacting to it.
  const SHRINK_LOOKAHEAD_SEC = 4;
  const shrinking = !sim.practiceMode && sim.playTime > CFG.ROUND.SHRINK_START_DELAY;
  const projectedRadius = shrinking
    ? Math.max(CFG.ARENA_MIN_RADIUS, sim.arena.radius - CFG.ROUND.SHRINK_RATE * SHRINK_LOOKAHEAD_SEC)
    : sim.arena.radius;
  const projectedEdgeDanger = !edgeDanger && projectedRadius - centerDist < 4;

  let mx = 0, mz = 0;

  // Active dodge takes highest priority.
  if (dodgeVec) {
    mx += dodgeVec.x * 1.6;
    mz += dodgeVec.z * 1.6;
  }

  // Edge retreat is critical and overrides other intents.
  if (edgeDanger) {
    const centerX = -bot.x / centerDist, centerZ = -bot.z / centerDist;
    mx += centerX * 1.5;
    mz += centerZ * 1.5;
  } else {
    if (projectedEdgeDanger) {
      // Gentle preemptive drift toward centre — weaker than the hard
      // edgeDanger pull above, layered with normal spacing rather than
      // overriding it.
      const centerX = -bot.x / centerDist, centerZ = -bot.z / centerDist;
      mx += centerX * 0.5;
      mz += centerZ * 0.5;
    }
    if (!dodgeVec) {
      // Normal intent-driven spacing.
      if (dist > profile.preferredRange) {
        mx += towardX * profile.aggression;
        mz += towardZ * profile.aggression;
      } else if (dist < profile.retreatRange) {
        mx -= towardX;
        mz -= towardZ;
      }
    }
  }

  // Perpendicular strafe whose direction oscillates slowly per bot and
  // playTime so bots aren't synchronised and feel less robotic.
  const strafeAmt = 0.35 + 0.3 * profile.aggression;
  const strafeSign = Math.sin(sim.playTime * 0.9 + bot.colorIndex * 2.3) >= 0 ? 1 : -1;
  mx += -towardZ * strafeAmt * strafeSign;
  mz += towardX * strafeAmt * strafeSign;

  return [mx, mz];
}

// ── Mob-awareness helpers (used by selectAbility) ──────────────────────────

// A big mob's active telegraph channel covers the ground it's about to hit;
// firing a long-cooldown single-target/general-zoning spell at a player
// standing inside it is often wasted — the mob's own attack lands first (or
// displaces them) for free. Returns true when (x,z) sits in any live channel.
function mobTelegraphCovers(sim, x, z) {
  for (const mob of sim.mobs) {
    if (!mob.alive || !mob.channel) continue;
    const r = mob.channel.r ?? 0;
    if (Math.hypot(x - mob.channel.tx, z - mob.channel.tz) <= r) return true;
  }
  return false;
}

// Nearest live, fully-arrived big mob (skips minions and mid-entrance mobs,
// neither of which are valid AoE targets yet) — a legitimate displacement/
// damage target in its own right, not just a hazard to dodge.
function nearestBigMob(sim, bot) {
  let best = null, bestDist = Infinity;
  for (const mob of sim.mobs) {
    if (!mob.alive || mob.entering > 0 || mob.parentId) continue;
    const d = Math.hypot(mob.x - bot.x, mob.z - bot.z);
    if (d < bestDist) { bestDist = d; best = mob; }
  }
  return best ? { mob: best, dist: bestDist } : null;
}

// True when a mob sits roughly on the bot→target line, "blocking the path"
// even when it isn't strictly closer than the player target itself.
function mobBlocksPath(bot, target, mob) {
  const dx = target.x - bot.x, dz = target.z - bot.z;
  const len2 = dx * dx + dz * dz || 1;
  let t = ((mob.x - bot.x) * dx + (mob.z - bot.z) * dz) / len2;
  t = Math.max(0, Math.min(1, t));
  const px = bot.x + dx * t, pz = bot.z + dz * t;
  return Math.hypot(mob.x - px, mob.z - pz) < 3.5;
}

// Displacement spells (push/pull/swap) score higher when the projected
// result lands the victim further past the arena rim — mirrors a human
// "ring out" read. The displacement math is a rough KB-magnitude estimate
// (no wall/ground collision), which is precise enough for AI scoring.
function edgePlayBonus(spellId, bot, target) {
  const outward = Math.hypot(target.x, target.z) || 1;
  let dispX = 0, dispZ = 0;
  if (spellId === "push") {
    const dx = target.x - bot.x, dz = target.z - bot.z;
    const d = Math.hypot(dx, dz) || 1;
    dispX = (dx / d) * 6; dispZ = (dz / d) * 6;
  } else if (spellId === "pull") {
    dispX = (bot.x - target.x) * 0.6; dispZ = (bot.z - target.z) * 0.6;
  } else if (spellId === "swap") {
    dispX = bot.x - target.x; dispZ = bot.z - target.z;
  } else {
    return 0;
  }
  const projected = Math.hypot(target.x + dispX, target.z + dispZ);
  return Math.max(0, projected - outward) * 0.12;
}

// ── Skill module: selectAbility ────────────────────────────────────────────
// Situational scoring instead of a fixed spell priority ladder.
// Returns { spell, tx, tz } or null.
function selectAbility(sim, bot, target, dist, profile) {
  if (bot.status.disabled > 0) return null;

  const reach = (id) => {
    const s = SPELLS[id];
    return s && Number.isFinite(s.range) ? s.range : BOT_DEFAULT_CAST_RANGE;
  };

  const edgeDanger = sim.arena.radius - Math.hypot(bot.x, bot.z) < 4;
  const targetEdgeDist = sim.arena.radius - Math.hypot(target.x, target.z);
  const targetHighCharge = target.charge > 1.5;
  const botHighCharge = bot.charge > 1.2;
  const w = profile.abilityWeights || {};

  // ── Emergency escape: any owned mobility spell, aimed toward arena centre
  // (world origin) so blink/teleport/thrust actually relocate the bot away
  // from the rim; windWalk/rush are self-buffs and ignore tx/tz harmlessly.
  // Generalizes the old thrust/teleport-only check so drafted kits — which
  // may carry blink/windWalk/rush instead — can always escape.
  if (edgeDanger) {
    for (const id of MOBILITY_SPELLS) {
      if (bot.canCast(id)) return { spell: id, tx: 0, tz: 0 };
    }
    // No reposition spell available — invisibility at least denies aim while
    // the bot walks back toward centre (positioning() already pulls inward).
    if (bot.canCast("invisible")) return { spell: "invisible", tx: 0, tz: 0 };
  }

  const candidates = [];
  const tryAdd = (spell, base, aim) => {
    if (!bot.canCast(spell)) return;
    const weight = w[spell] ?? 0.5;
    if (weight <= 0) return;
    candidates.push({ spell, score: base * weight, aim: aim || null });
  };

  // ── KO burst: target is near edge AND has high charge ──────────────────
  if (targetHighCharge && targetEdgeDist < 8) {
    if (dist <= reach("meteor")) tryAdd("meteor", 2.5);
    if (dist <= reach("lightning")) tryAdd("lightning", 2.2);
    if (dist <= reach("gravity")) tryAdd("gravity", 1.8);
    // Offensive thrust when adjacent (and not on the edge ourselves).
    if (dist < 7 && !edgeDanger) tryAdd("thrust", 1.5);
  }

  // ── Self-defence: shield/heal when own charge or HP is a liability ──────
  if (botHighCharge && dist < 16) tryAdd("shield", 2.0);
  // Heal is a 2s channel — only worth starting with breathing room, not
  // mid-exchange where it just eats a hit for free.
  if (bot.hp < bot.maxHp * 0.35 && dist > profile.preferredRange) tryAdd("heal", 1.2);

  // ── Mob awareness ────────────────────────────────────────────────────────
  // A nearby, fully-arrived big mob is a legitimate AoE target in its own
  // right when it's closer than the player (or blocking the path to them) —
  // don't waste area spells swinging at empty space across the arena.
  const mobThreat = nearestBigMob(sim, bot);
  const mobIsBetterAoeTarget = !!mobThreat && (mobThreat.dist < dist || mobBlocksPath(bot, target, mobThreat.mob));
  // Don't waste a long-cooldown general-zoning cast on a player a mob is
  // about to blast anyway — the mob does that work for free.
  const zoneDamp = mobTelegraphCovers(sim, target.x, target.z) ? 0.4 : 1;

  // ── General zoning / combat ────────────────────────────────────────────
  if (dist <= reach("lightning")) tryAdd("lightning", 1.0 * zoneDamp);
  if (dist <= reach("fireball")) tryAdd("fireball", 0.85 * zoneDamp);
  if (dist <= reach("meteor")) {
    const useMob = mobIsBetterAoeTarget && mobThreat.dist <= reach("meteor");
    tryAdd("meteor", useMob ? 1.0 : 0.9 * zoneDamp, useMob ? mobThreat.mob : null);
  }
  if (dist <= reach("gravity")) tryAdd("gravity", 0.8 * zoneDamp);
  if (dist <= reach("homing")) tryAdd("homing", 0.7 * zoneDamp);
  if (dist <= reach("boomerang")) tryAdd("boomerang", 0.7 * zoneDamp);
  if (dist <= reach("bouncer")) tryAdd("bouncer", 0.6 * zoneDamp);
  if (dist <= reach("fireSpray")) tryAdd("fireSpray", 0.55 * zoneDamp);
  if (dist <= reach("drain")) tryAdd("drain", 0.5 * zoneDamp);
  if (dist <= reach("disable")) tryAdd("disable", 0.55 * zoneDamp);
  // ── DOTA-roster spells (see VARIETY_SPELLS / BOT_PROFILES abilityWeights) ─
  if (dist <= reach("target")) tryAdd("target", 0.85 * zoneDamp);
  if (dist <= reach("stun")) tryAdd("stun", 0.6 * zoneDamp);
  if (dist <= reach("push")) tryAdd("push", 0.5 * zoneDamp + edgePlayBonus("push", bot, target));
  if (dist <= reach("pull")) tryAdd("pull", 0.5 * zoneDamp + edgePlayBonus("pull", bot, target));
  if (dist <= reach("explode")) {
    const useMob = mobIsBetterAoeTarget && mobThreat.dist <= reach("explode");
    tryAdd("explode", useMob ? 0.85 : 0.75 * zoneDamp, useMob ? mobThreat.mob : null);
  }
  if (dist <= (SPELLS.vacuum?.radius ?? 8) + 2) tryAdd("vacuum", 0.45 * zoneDamp);
  if (dist <= reach("swap")) tryAdd("swap", 0.3 * zoneDamp + edgePlayBonus("swap", bot, target));
  // Defensive shield fallback — low-priority, and only worth considering when
  // the target is close enough to plausibly threaten the bot soon (own high
  // charge is already covered above). Without this gate bots would shield
  // uselessly while the enemy is clear across the arena.
  if (dist <= BOT_DEFAULT_CAST_RANGE) tryAdd("shield", 0.35);

  if (!candidates.length) return null;
  candidates.sort((a, b) => b.score - a.score);
  const best = candidates[0];

  // Gravity well aimed at the target's own position produces zero net pull
  // (gravX - target.x ≈ 0, so gl = 0 falls back to 1 and the term is ~0).
  // Place the well outward along the target-from-centre axis so the pull
  // drags the target toward the rim.
  if (best.spell === 'gravity') {
    const m = Math.hypot(target.x, target.z) || 1;
    const outward = 4; // units past the target toward the arena edge
    const gwx = target.x + (target.x / m) * outward;
    const gwz = target.z + (target.z / m) * outward;
    const gravRange = reach('gravity');
    const rawDist = Math.hypot(gwx - bot.x, gwz - bot.z);
    const scale = rawDist > gravRange ? gravRange / rawDist : 1;
    return { spell: 'gravity', tx: bot.x + (gwx - bot.x) * scale, tz: bot.z + (gwz - bot.z) * scale };
  }

  return { spell: best.spell, tx: best.aim?.x ?? target.x, tz: best.aim?.z ?? target.z };
}

// ── botSpellLoadout ────────────────────────────────────────────────────────
// Derive a spell loadout for a bot from its abilityWeights profile.
// Takes the top (slotCount - 1) spells by weight (weight > 0, must exist in
// SPELLS, excluding fireball). fireball itself now competes as a normal
// weighted candidate inside selectAbility() (see abilityWeights above), but
// its equip slot is left to Player.setLoadout(), which already guarantees
// fireball occupies a slot on every player — so it is deliberately excluded
// from this ranked pool rather than special-cased/prepended here (prepending
// it here too would double-count it and risks silently dropping the lowest-
// ranked chosen spell once setLoadout dedupes/caps at SPELL_SLOT_COUNT).
// Always guarantees at least one escape spell (thrust or teleport) so the
// edge-danger branch in selectAbility can fire; if neither appears in the
// top-N by weight, the last chosen slot is replaced with thrust.
// Used by sim.js setBotRoster and stored as p._spawnLoadout so beginRound can
// re-apply the correct loadout each round rather than falling back to DEFAULT.
export function botSpellLoadout(profile, slotCount = CFG.SPELL_SLOT_COUNT) {
  const w = profile.abilityWeights || {};
  const chosen = Object.entries(w)
    .filter(([id, v]) => v > 0 && id !== "fireball" && SPELLS[id])
    .sort(([, a], [, b]) => b - a)
    .map(([id]) => id)
    .slice(0, slotCount - 1); // leave one slot for fireball (guaranteed by setLoadout)
  // Guarantee an escape spell so selectAbility's edge-danger branch can always fire.
  const ESCAPE = ["thrust", "teleport"];
  if (chosen.length > 0 && !ESCAPE.some((id) => chosen.includes(id))) {
    const escapeId = ESCAPE.find((id) => SPELLS[id]) || "thrust";
    chosen[chosen.length - 1] = escapeId; // swap out the lowest-ranked chosen spell
  }
  return chosen;
}

// ── botDraftPick ────────────────────────────────────────────────────────────
// Deterministic, seeded, weighted sample-without-replacement over the wide
// spell roster (CFG.SPELLS, 33 spells) producing a legal 6-spell draft pick
// for a bot — the same shape a human commits via toggleDraftSpell/
// applyDraftTemplate (fireball excluded; always ≤ SPELL_SLOT_COUNT unique
// ids). Candidate weights come straight from the profile's abilityWeights so
// a drafted bot can actually cast whatever it picks (selectAbility scores
// every candidate spell by this same table) — no separate scoring table to
// keep in sync. `rand` must be a seeded PRNG (see makePrng/idSeed in rng.js);
// never Math.random, so two sims with the same bot id + profile draft
// identically (see sim.js setBotRoster).
function draftCandidateWeights(profile) {
  const w = profile.abilityWeights || {};
  const table = {};
  for (const [id, weight] of Object.entries(w)) {
    if (id === "fireball" || weight <= 0 || !SPELLS[id]) continue;
    table[id] = weight;
  }
  // Safety net: guarantee every mobility spell is draftable even if a future
  // profile omits one, so the "always include an escape spell" rule below
  // always has a pool to draw from.
  for (const id of MOBILITY_SPELLS) {
    if (!(id in table) && SPELLS[id]) table[id] = 0.35;
  }
  return table;
}

// Weighted sample of `count` unique ids from `weights` without replacement.
function weightedSampleWithoutReplacement(weights, count, rand) {
  const pool = Object.entries(weights).map(([id, w]) => ({ id, w }));
  const picked = [];
  while (picked.length < count && pool.length) {
    const total = pool.reduce((s, c) => s + c.w, 0);
    let r = rand() * total;
    let idx = pool.length - 1;
    for (let i = 0; i < pool.length; i++) {
      r -= pool[i].w;
      if (r <= 0) { idx = i; break; }
    }
    picked.push(pool[idx].id);
    pool.splice(idx, 1);
  }
  return picked;
}

export function botDraftPick(profile, rand) {
  const table = draftCandidateWeights(profile);
  const slotCount = CFG.SPELL_SLOT_COUNT;
  const picks = weightedSampleWithoutReplacement(table, slotCount, rand);

  // Guarantee at least one mobility/escape spell, mirroring botSpellLoadout's
  // rule — draft picks must always leave selectAbility's edge-danger branch
  // reachable, whatever the weighted roll produced.
  if (!picks.some((id) => MOBILITY_SPELLS.includes(id))) {
    const mobilityPool = {};
    for (const id of MOBILITY_SPELLS) {
      if (SPELLS[id]) mobilityPool[id] = table[id] ?? 0.35;
    }
    const [chosenMobility] = weightedSampleWithoutReplacement(mobilityPool, 1, rand);
    if (chosenMobility) {
      // Replace the lowest-weighted pick (last-ranked by draft weight).
      let worstIdx = 0, worstW = Infinity;
      picks.forEach((id, i) => {
        const wgt = table[id] ?? 0;
        if (wgt < worstW) { worstW = wgt; worstIdx = i; }
      });
      picks[worstIdx] = chosenMobility;
    }
  }
  return picks;
}

// ── BotBrain ───────────────────────────────────────────────────────────────
export class BotBrain {
  constructor(botId, skill) {
    this.skill = skill;
    this.profile = BOT_PROFILES[skill] || BOT_PROFILES.smart;
    this.rand = makePrng(idSeed(botId));
    // Opponent velocity estimation via EMA of position deltas.
    this._prevTarget = null;
    this._targetVx = 0;
    this._targetVz = 0;
    // Combo-follow-up state (boomerang/bouncer pass-through).
    this.comboWindow = 0;
    this.comboSpell = null;
  }

  /** Reset cross-round state; called by Player.spawn() on each round start. */
  reset() {
    this._prevTarget = null;
    this._targetVx = 0;
    this._targetVz = 0;
    this.comboWindow = 0;
    this.comboSpell = null;
  }

  /**
   * Main entry point — called once per tick by sim.updateBotInputs().
   * Returns { move:[x,z], aim, fire, seq, casts:[{id,spell,tx,tz},...] }.
   */
  think(sim, bot) {
    const dt = 1 / CFG.TICK_RATE;
    const profile = this.profile;

    // ── Perception: find nearest living enemy, estimate its velocity ───────
    const living = sim.alivePlayers();
    const target = living
      .filter((p) => p.id !== bot.id)
      .sort(
        (a, b) =>
          Math.hypot(a.x - bot.x, a.z - bot.z) -
          Math.hypot(b.x - bot.x, b.z - bot.z)
      )[0];

    if (!target) {
      return { move: [0, 0], aim: bot.input.aim, seq: bot.input.seq + 1, casts: [] };
    }

    // EMA velocity estimation from position delta (α=0.5 = moderate smoothing).
    if (this._prevTarget?.id === target.id) {
      const alpha = 0.5;
      this._targetVx = alpha * (target.x - this._prevTarget.x) / dt + (1 - alpha) * this._targetVx;
      this._targetVz = alpha * (target.z - this._prevTarget.z) / dt + (1 - alpha) * this._targetVz;
    } else {
      this._targetVx = 0;
      this._targetVz = 0;
    }
    this._prevTarget = { id: target.id, x: target.x, z: target.z };

    const dx = target.x - bot.x, dz = target.z - bot.z;
    const dist = Math.hypot(dx, dz) || 1;

    // ── Aim with lead + bounded jitter ───────────────────────────────────
    const baseAim = aimWithLead(
      bot.x, bot.z, target.x, target.z,
      this._targetVx, this._targetVz,
      profile.leadFactor
    );
    const jitter = (this.rand() * 2 - 1) * profile.aimError;
    const aim = baseAim + jitter;

    // ── Dodge ─────────────────────────────────────────────────────────────
    const dodge = dodgeVector(sim, bot, profile, this.rand);

    // ── Movement ──────────────────────────────────────────────────────────
    const [moveX, moveZ] = positioning(sim, bot, target, profile, dodge);

    const casts = [];

    // ── Ability selection (fireball now competes here as a normal weighted
    //    candidate — see abilityWeights.fireball on each BOT_PROFILES tier) ──
    if ((bot._nextBotAbilityAt ?? 0) <= sim.playTime) {
      let chosen = null;

      // Combo follow-up takes priority over situational selection.
      if (this.comboWindow > 0 && this.comboSpell && bot.canCast(this.comboSpell)) {
        chosen = { spell: this.comboSpell, tx: target.x, tz: target.z };
        this.comboWindow = 0;
        this.comboSpell = null;
      } else {
        chosen = selectAbility(sim, bot, target, dist, profile);
      }

      if (chosen) {
        casts.push({
          id: ++bot._botCastId,
          spell: chosen.spell,
          tx: chosen.tx ?? target.x,
          tz: chosen.tz ?? target.z,
        });
        bot._nextBotAbilityAt = sim.playTime + profile.abilityEvery;

        // Queue a follow-up combo for pass-through spells.
        if (chosen.spell === "boomerang" || chosen.spell === "bouncer") {
          this.comboWindow = 1.5;
          this.comboSpell = "lightning";
          // Re-open the ability gate inside the combo window (0.6 s < comboWindow 1.5 s)
          // so the follow-up cast is actually reachable for every profile tier.
          // Without this override a slow tier's abilityEvery (up to 1.0 s for smart)
          // could exceed comboWindow, making the follow-up unreachable dead code.
          bot._nextBotAbilityAt = sim.playTime + 0.6;
        }
      }
    }

    // Tick down combo window.
    if (this.comboWindow > 0) {
      this.comboWindow = Math.max(0, this.comboWindow - dt);
      if (this.comboWindow === 0) this.comboSpell = null;
    }

    return { move: [moveX, moveZ], aim, seq: bot.input.seq + 1, casts };
  }
}
