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
// Replaces the old BOT_SETTINGS flat object. The fire-cadence hierarchy
// expert > brilliant > smart is guaranteed by fireEvery values.
export const BOT_PROFILES = {
  /**
   * Brawler — aggressive close-range pressure, telegraphed, approachable.
   * Loses to spacing; the "new player" tier.
   */
  smart: {
    preferredRange: 8,
    retreatRange: 3,
    fireRange: 14,
    fireEvery: 0.75,
    abilityEvery: 4.5,
    leadFactor: 0.10,      // barely predicts target movement
    aimError: 0.22,        // wide sine-like wobble
    reactionMs: 550,       // slow to perceive threats
    dodgeRange: 0,         // never looks for incoming projectiles
    dodgeChance: 0,
    aggression: 0.9,       // charges toward target most of the time
    loadout: ["bloodSword", "bootsOfSpeed"],
    abilityWeights: {
      thrust: 0.5, shield: 0.3, meteor: 0, lightning: 0.3,
      gravity: 0, homing: 0.8, bouncer: 0.5, boomerang: 0.4, fireSpray: 0.6,
    },
  },

  /**
   * Trickster — mid-range kiter, moderate leading, ~55% dodge, combos & baits.
   * Edge-guards opportunistically; countered by aggressive all-ins.
   */
  brilliant: {
    preferredRange: 11,
    retreatRange: 5,
    fireRange: 18,
    fireEvery: 0.48,
    abilityEvery: 3.0,
    leadFactor: 0.55,
    aimError: 0.10,
    reactionMs: 300,
    dodgeRange: 10,
    dodgeChance: 0.55,
    aggression: 0.5,
    loadout: ["cape", "stoneOfJordan"],
    abilityWeights: {
      thrust: 0.4, shield: 0.7, meteor: 0.5, lightning: 0.8,
      gravity: 0.6, homing: 0.6, bouncer: 0.8, boomerang: 0.7, fireSpray: 0.5,
    },
  },

  /**
   * Duelist — full pro brain, reliable dodge, disciplined spacing, edge-guard,
   * conserves escapes, chains combos. Hard but has real openings (not frame-perfect).
   */
  expert: {
    preferredRange: 9,
    retreatRange: 5,
    fireRange: 28,
    fireEvery: 0.28,
    abilityEvery: 1.7,
    leadFactor: 0.90,      // near-correct leading; bounded jitter keeps it human
    aimError: 0.025,
    reactionMs: 175,
    dodgeRange: 14,
    dodgeChance: 0.85,
    aggression: 0.7,
    loadout: ["aegis", "pendant"],
    abilityWeights: {
      thrust: 0.6, shield: 0.9, meteor: 0.9, lightning: 0.95,
      gravity: 0.85, homing: 0.7, bouncer: 0.7, boomerang: 0.8, fireSpray: 0.4,
    },
  },
};

const BOT_DEFAULT_CAST_RANGE = 16; // fallback for spells without an explicit range

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
  } else if (!dodgeVec) {
    // Normal intent-driven spacing.
    if (dist > profile.preferredRange) {
      mx += towardX * profile.aggression;
      mz += towardZ * profile.aggression;
    } else if (dist < profile.retreatRange) {
      mx -= towardX;
      mz -= towardZ;
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

  // ── Emergency escape: thrust/teleport only when genuinely edge-endangered ─
  if (edgeDanger) {
    if (bot.canCast("thrust")) return { spell: "thrust", tx: 0, tz: 0 };
    if (bot.canCast("teleport")) return { spell: "teleport", tx: 0, tz: 0 };
  }

  const candidates = [];
  const tryAdd = (spell, base) => {
    if (!bot.canCast(spell)) return;
    const weight = w[spell] ?? 0.5;
    if (weight <= 0) return;
    candidates.push({ spell, score: base * weight });
  };

  // ── KO burst: target is near edge AND has high charge ──────────────────
  if (targetHighCharge && targetEdgeDist < 8) {
    if (dist <= reach("meteor")) tryAdd("meteor", 2.5);
    if (dist <= reach("lightning")) tryAdd("lightning", 2.2);
    if (dist <= reach("gravity")) tryAdd("gravity", 1.8);
    // Offensive thrust when adjacent (and not on the edge ourselves).
    if (dist < 7 && !edgeDanger) tryAdd("thrust", 1.5);
  }

  // ── Self-defence: shield when own charge is high ────────────────────────
  if (botHighCharge && dist < 16) tryAdd("shield", 2.0);

  // ── General zoning / combat ────────────────────────────────────────────
  if (dist <= reach("lightning")) tryAdd("lightning", 1.0);
  if (dist <= reach("meteor")) tryAdd("meteor", 0.9);
  if (dist <= reach("gravity")) tryAdd("gravity", 0.8);
  if (dist <= reach("homing")) tryAdd("homing", 0.7);
  if (dist <= reach("boomerang")) tryAdd("boomerang", 0.7);
  if (dist <= reach("bouncer")) tryAdd("bouncer", 0.6);
  if (dist <= reach("fireSpray")) tryAdd("fireSpray", 0.55);
  if (dist <= reach("drain")) tryAdd("drain", 0.5);
  if (dist <= reach("disable")) tryAdd("disable", 0.55);
  tryAdd("shield", 0.35); // fallback defensive option

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

  return { spell: best.spell, tx: target.x, tz: target.z };
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
      return { move: [0, 0], aim: bot.input.aim, fire: false, seq: bot.input.seq + 1, casts: [] };
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

    // ── Fire decision (standard bolt) ─────────────────────────────────────
    // _botFireCooldown tells spawnBolt how long to set bot.cooldown.
    bot._botFireCooldown = profile.fireEvery;
    const fire =
      dist <= profile.fireRange &&
      bot.canFire() &&
      (bot._nextBotFireAt ?? 0) <= sim.playTime;
    if (fire) bot._nextBotFireAt = sim.playTime + profile.fireEvery;

    // ── Ability selection ──────────────────────────────────────────────────
    const casts = [];
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
          // Without this override, _nextBotAbilityAt = +abilityEvery (≥ 1.7 s) which
          // always exceeds comboWindow, making the follow-up unreachable dead code.
          bot._nextBotAbilityAt = sim.playTime + 0.6;
        }
      }
    }

    // Tick down combo window.
    if (this.comboWindow > 0) {
      this.comboWindow = Math.max(0, this.comboWindow - dt);
      if (this.comboWindow === 0) this.comboSpell = null;
    }

    return { move: [moveX, moveZ], aim, fire, seq: bot.input.seq + 1, casts };
  }
}
