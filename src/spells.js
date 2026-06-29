// Spell resolution. Pure host-side logic so it can be unit-tested headlessly.
// Each handler mutates the simulation (`sim`) and pushes transient `events`
// the renderer/audio layer turns into VFX/SFX. Every ability/item listed in the
// Warlock Brawl handbook (https://www.warlockbrawl.com/handbook) is handled
// here or via persistent item modifiers in Player.applyItems().
import { CFG, SPELLS } from "./config.js";
import { Bolt } from "./bolt.js";

// Direction helper from a caster toward a target point (falls back to aim).
function aimToward(caster, tx, tz) {
  if (Number.isFinite(tx) && Number.isFinite(tz)) {
    return Math.atan2(tz - caster.z, tx - caster.x);
  }
  return caster.aim;
}

function emit(sim, ev) { sim.events.push(ev); }

// Spawn a single projectile with the spell's tuning.
function spawnProjectile(sim, caster, dir, spell, overrides = {}) {
  const ox = caster.x + Math.cos(dir) * (CFG.PLAYER_RADIUS + 0.6);
  const oz = caster.z + Math.sin(dir) * (CFG.PLAYER_RADIUS + 0.6);
  let kb = (spell.kb ?? CFG.BOLT_BASE_KNOCKBACK) * caster.mods.dmgMul;
  if (spell.proj === "fireball") kb *= caster.mods.fireballKbMul;
  const b = new Bolt(caster.id, ox, oz, dir, spell.color || caster.color, {
    proj: spell.proj,
    kb,
    range: spell.range,
    turn: spell.turn,
    bounces: spell.bounces,
    splitDist: spell.splitDist,
    shards: spell.shards,
    ...overrides,
  });
  sim.bolts.push(b);
  return b;
}

// Find the closest valid target within `range` of (x,z).
function nearestEnemy(sim, casterId, x, z, range) {
  let best = null, bestD = range * range;
  for (const p of sim.players.values()) {
    if (p.id === casterId || !p.alive || p.falling || p.spectating) continue;
    const d = (p.x - x) ** 2 + (p.z - z) ** 2;
    if (d <= bestD) { bestD = d; best = p; }
  }
  return best;
}

// The big dispatch table: spellId -> handler(sim, caster, cast).
const HANDLERS = {
  fireball(sim, c, cast) {
    spawnProjectile(sim, c, aimToward(c, cast.tx, cast.tz), SPELLS.fireball);
    emit(sim, { type: "cast", spell: "fireball", id: c.id, x: c.x, z: c.z });
  },

  boomerang(sim, c, cast) {
    spawnProjectile(sim, c, aimToward(c, cast.tx, cast.tz), SPELLS.boomerang);
    emit(sim, { type: "cast", spell: "boomerang", id: c.id, x: c.x, z: c.z });
  },

  homing(sim, c, cast) {
    spawnProjectile(sim, c, aimToward(c, cast.tx, cast.tz), SPELLS.homing);
    emit(sim, { type: "cast", spell: "homing", id: c.id, x: c.x, z: c.z });
  },

  bouncer(sim, c, cast) {
    spawnProjectile(sim, c, aimToward(c, cast.tx, cast.tz), SPELLS.bouncer);
    emit(sim, { type: "cast", spell: "bouncer", id: c.id, x: c.x, z: c.z });
  },

  splitter(sim, c, cast) {
    spawnProjectile(sim, c, aimToward(c, cast.tx, cast.tz), SPELLS.splitter);
    emit(sim, { type: "cast", spell: "splitter", id: c.id, x: c.x, z: c.z });
  },

  fireSpray(sim, c, cast) {
    const s = SPELLS.fireSpray;
    const base = aimToward(c, cast.tx, cast.tz);
    for (let i = 0; i < s.count; i++) {
      const a = base + (i - (s.count - 1) / 2) * (s.spread / s.count) * 2;
      spawnProjectile(sim, c, a, { ...s, proj: "fireball" }, { life: 1.2 });
    }
    emit(sim, { type: "cast", spell: "fireSpray", id: c.id, x: c.x, z: c.z });
  },

  lightning(sim, c, cast) {
    const s = SPELLS.lightning;
    const dir = aimToward(c, cast.tx, cast.tz);
    // Primary target: nearest enemy roughly along aim, else nearest in range.
    let target = nearestEnemy(sim, c.id, c.x, c.z, s.range);
    if (!target) return; // fizzle but cooldown already consumed
    const chained = new Set([c.id]);
    const segs = [];
    let from = c;
    let hops = s.chains + 1;
    let kb = s.kb * c.mods.dmgMul;
    while (target && hops-- > 0) {
      const dx = target.x - from.x, dz = target.z - from.z;
      const hit = target.applyHit(dx, dz, kb);
      segs.push({ x1: from.x, z1: from.z, x2: target.x, z2: target.z });
      if (hit) emit(sim, { type: "hit", x: target.x, z: target.z, victim: target.id, by: c.id });
      chained.add(target.id);
      kb *= 0.7;
      // Find next chain target near the current one.
      let next = null, bestD = s.chainRange * s.chainRange;
      for (const p of sim.players.values()) {
        if (chained.has(p.id) || !p.alive || p.falling || p.spectating) continue;
        const d = (p.x - target.x) ** 2 + (p.z - target.z) ** 2;
        if (d <= bestD) { bestD = d; next = p; }
      }
      from = target; target = next;
    }
    emit(sim, { type: "lightning", id: c.id, segs, color: s.color, dir });
  },

  meteor(sim, c, cast) {
    const s = SPELLS.meteor;
    // Land at the target point, clamped to cast range.
    let tx = Number.isFinite(cast.tx) ? cast.tx : c.x + Math.cos(c.aim) * s.range;
    let tz = Number.isFinite(cast.tz) ? cast.tz : c.z + Math.sin(c.aim) * s.range;
    const dx = tx - c.x, dz = tz - c.z;
    const d = Math.hypot(dx, dz);
    if (d > s.range) { tx = c.x + (dx / d) * s.range; tz = c.z + (dz / d) * s.range; }
    sim.meteors.push({
      id: sim._meteorId++, ownerId: c.id, x: tx, z: tz,
      t: s.fall, fall: s.fall, radius: s.radius, kb: s.kb * c.mods.dmgMul,
    });
    emit(sim, { type: "meteorCast", id: c.id, x: tx, z: tz, fall: s.fall, radius: s.radius });
  },

  teleport(sim, c, cast) {
    const s = SPELLS.teleport;
    let tx = Number.isFinite(cast.tx) ? cast.tx : c.x + Math.cos(c.aim) * s.range;
    let tz = Number.isFinite(cast.tz) ? cast.tz : c.z + Math.sin(c.aim) * s.range;
    const dx = tx - c.x, dz = tz - c.z;
    const d = Math.hypot(dx, dz);
    if (d > s.range) { tx = c.x + (dx / d) * s.range; tz = c.z + (dz / d) * s.range; }
    emit(sim, { type: "teleport", id: c.id, x1: c.x, z1: c.z, x2: tx, z2: tz });
    c.x = tx; c.z = tz; c.vx *= 0.3; c.vz *= 0.3;
  },

  thrust(sim, c, cast) {
    const s = SPELLS.thrust;
    const dir = aimToward(c, cast.tx, cast.tz);
    c.vx += Math.cos(dir) * s.power;
    c.vz += Math.sin(dir) * s.power;
    emit(sim, { type: "thrust", id: c.id, x: c.x, z: c.z, dir });
  },

  swap(sim, c, cast) {
    const s = SPELLS.swap;
    const tgt = nearestEnemy(sim, c.id, c.x, c.z, s.range);
    if (!tgt) return;
    const px = c.x, pz = c.z;
    c.x = tgt.x; c.z = tgt.z;
    tgt.x = px; tgt.z = pz;
    emit(sim, { type: "swap", a: c.id, b: tgt.id, ax: c.x, az: c.z, bx: tgt.x, bz: tgt.z });
  },

  drain(sim, c, cast) {
    const s = SPELLS.drain;
    const tgt = nearestEnemy(sim, c.id, c.x, c.z, s.range);
    if (!tgt) return;
    // Pull the target toward the caster and steal some of their charge.
    const dx = c.x - tgt.x, dz = c.z - tgt.z;
    const l = Math.hypot(dx, dz) || 1;
    tgt.vx += (dx / l) * s.pull;
    tgt.vz += (dz / l) * s.pull;
    const stolen = tgt.charge * s.steal;
    tgt.charge = Math.max(0, tgt.charge - stolen);
    c.charge = Math.max(0, c.charge - stolen * 0.5); // drain heals the caster's %
    emit(sim, { type: "drain", a: c.id, b: tgt.id, x1: c.x, z1: c.z, x2: tgt.x, z2: tgt.z });
  },

  gravity(sim, c, cast) {
    const s = SPELLS.gravity;
    let tx = Number.isFinite(cast.tx) ? cast.tx : c.x + Math.cos(c.aim) * s.range;
    let tz = Number.isFinite(cast.tz) ? cast.tz : c.z + Math.sin(c.aim) * s.range;
    const dx = tx - c.x, dz = tz - c.z;
    const d = Math.hypot(dx, dz);
    if (d > s.range) { tx = c.x + (dx / d) * s.range; tz = c.z + (dz / d) * s.range; }
    // Apply a pulling field to all enemies in the radius for the duration.
    for (const p of sim.players.values()) {
      if (p.id === c.id || !p.alive || p.spectating) continue;
      const pd = Math.hypot(p.x - tx, p.z - tz);
      if (pd <= s.radius) {
        p.status.gravity = s.duration;
        p.status.gravX = tx; p.status.gravZ = tz; p.status.gravPull = s.pull;
      }
    }
    emit(sim, { type: "gravity", id: c.id, x: tx, z: tz, radius: s.radius, duration: s.duration });
  },

  link(sim, c, cast) {
    const s = SPELLS.link;
    const tgt = nearestEnemy(sim, c.id, c.x, c.z, s.range);
    if (!tgt) return;
    c.status.link = s.duration; c.status.linkedTo = tgt.id;
    tgt.status.link = s.duration; tgt.status.linkedTo = c.id;
    emit(sim, { type: "link", a: c.id, b: tgt.id });
  },

  disable(sim, c, cast) {
    const s = SPELLS.disable;
    // Travels as a brief projectile that silences on hit.
    spawnProjectile(sim, c, aimToward(c, cast.tx, cast.tz),
      { ...s, proj: "fireball" }, { life: 1.0 });
    // Tag the projectile so the sim applies the silence on contact.
    sim.bolts[sim.bolts.length - 1].disable = s.duration;
    emit(sim, { type: "cast", spell: "disable", id: c.id, x: c.x, z: c.z });
  },

  shield(sim, c, cast) {
    const s = SPELLS.shield;
    c.status.shield = s.duration;
    c.status.shieldCharges = s.charges;
    emit(sim, { type: "shield", id: c.id });
  },

  windWalk(sim, c, cast) {
    c.status.windWalk = SPELLS.windWalk.duration;
    emit(sim, { type: "windwalk", id: c.id });
  },

  rush(sim, c, cast) {
    c.status.rush = SPELLS.rush.duration;
    emit(sim, { type: "rush", id: c.id });
  },

  timeShift(sim, c, cast) {
    // Bookmark current position/charge; restored after `delay` seconds.
    c.timeshift = {
      x: c.x, z: c.z, charge: c.charge, t: SPELLS.timeShift.delay,
    };
    emit(sim, { type: "timeshift", id: c.id, x: c.x, z: c.z });
  },

  pocketWatch(sim, c, cast) {
    // Item active: reset all of the caster's own spell cooldowns.
    c.cooldowns = {};
    emit(sim, { type: "pocketwatch", id: c.id });
  },
};

// Resolve one cast request from a player. Returns true if it fired.
export function castSpell(sim, caster, cast) {
  const spellId = cast.spell;
  const spell = SPELLS[spellId];
  if (!spell) return false;
  if (!caster.canCast(spellId)) return false;
  const handler = HANDLERS[spellId];
  if (!handler) return false;
  handler(sim, caster, cast);
  caster.startCooldown(spellId);
  if (spell.sfx) emit(sim, { type: "sfx", sfx: spell.sfx, x: caster.x, z: caster.z });
  return true;
}

export { HANDLERS };
