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

// Line-of-sight check: returns true when there is an unobstructed path from
// `from` to `to` at mid-body height.  Gracefully returns true when the arena
// has no layout set (null) or the obstaclesBlockingRay method is absent.
function hasLoS(sim, from, to) {
  if (!sim.arena || typeof sim.arena.obstaclesBlockingRay !== "function") return true;
  const y0 = (from.groundY ?? CFG.PLATFORM_TOP) + 1.0;
  const y1 = (to.groundY   ?? CFG.PLATFORM_TOP) + 1.0;
  return !sim.arena.obstaclesBlockingRay(from.x, from.z, y0, to.x, to.z, y1);
}

// Spawn a single projectile with the spell's tuning.
function spawnProjectile(sim, caster, dir, spell, overrides = {}) {
  const ox = caster.x + Math.cos(dir) * (CFG.PLAYER_RADIUS + 0.6);
  const oz = caster.z + Math.sin(dir) * (CFG.PLAYER_RADIUS + 0.6);
  let kb = (spell.kb ?? CFG.BOLT_BASE_KNOCKBACK) * caster.mods.dmgMul;
  if (spell.proj === "fireball") kb *= caster.mods.fireballKbMul;
  const b = new Bolt(caster.id, ox, oz, dir, spell.color || caster.color, {
    proj: spell.proj,
    kb,
    dmg: (spell.dmg ?? CFG.BOLT_BASE_DAMAGE) * caster.mods.dmgMul,
    range: spell.range,
    turn: spell.turn,
    bounces: spell.bounces,
    splitDist: spell.splitDist,
    shards: spell.shards,
    groundY: caster.groundY,  // bolt spawns at caster's current elevation
    // Status payloads — forwarded straight from spell config.
    slow: spell.slow, slowDur: spell.slowDur,
    burn: spell.burn, burnDur: spell.burnDur,
    curse: spell.curse, curseDur: spell.curseDur,
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

// Apply AoE knockback+damage to all enemies within radius of (x,z).
function applyAoE(sim, c, x, z, radius, kb, dmg, opts = {}) {
  for (const p of sim.players.values()) {
    if (p.id === c.id || !p.alive || p.falling || p.spectating) continue;
    const dx = p.x - x, dz = p.z - z, d = Math.hypot(dx, dz);
    if (d > radius) continue;
    let ndx = dx, ndz = dz;
    if (d < 0.001) { ndx = Math.cos(p.aim); ndz = Math.sin(p.aim); }
    const l = Math.hypot(ndx, ndz) || 1;
    if (p.applyHit(ndx / l, ndz / l, kb)) {
      p.applyDamage(dmg, c.id);
      if (opts.burn)  { p.status.burn = opts.burnDur; p.status.burnDps = opts.burn; p.status.burnBy = c.id; }
      if (opts.stun)  { p.status.stunned = Math.max(p.status.stunned, opts.stun);
                        emit(sim, { type: "statusApplied", status: "stun",  x: p.x, z: p.z, victim: p.id }); }
      if (opts.slow)  { p.status.slow = opts.slow; p.status.slowMul = opts.slowMul ?? 1;
                        emit(sim, { type: "statusApplied", status: "slow",  x: p.x, z: p.z, victim: p.id }); }
      if (opts.curse) { p.status.curse = opts.curse; p.status.curseMul = opts.curseMul ?? 1;
                        emit(sim, { type: "statusApplied", status: "curse", x: p.x, z: p.z, victim: p.id }); }
      emit(sim, { type: "hit", x: p.x, z: p.z, victim: p.id, by: c.id });
    }
  }
}

// Nearest enemy within range AND optionally within a forward cone of c.aim.
function aimedEnemy(sim, c, range, halfAngle) {
  let best = null, bestD = range * range;
  for (const p of sim.players.values()) {
    if (p.id === c.id || !p.alive || p.falling || p.spectating) continue;
    const dx = p.x - c.x, dz = p.z - c.z, d = dx * dx + dz * dz;
    if (d > bestD) continue;
    if (halfAngle != null) {
      let da = Math.atan2(dz, dx) - c.aim;
      while (da > Math.PI) da -= 2 * Math.PI;
      while (da < -Math.PI) da += 2 * Math.PI;
      if (Math.abs(da) > halfAngle) continue;
    }
    bestD = d; best = p;
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
    // Primary target: nearest enemy in range with line-of-sight.
    // Cover (obstacles/plateau walls) blocks direct-hit spells; targets without
    // LoS are skipped entirely.
    let target = null;
    {
      let bestD = s.range * s.range;
      for (const p of sim.players.values()) {
        if (p.id === c.id || !p.alive || p.falling || p.spectating) continue;
        const d = (p.x - c.x) ** 2 + (p.z - c.z) ** 2;
        if (d > bestD) continue;
        if (!hasLoS(sim, c, p)) continue;
        bestD = d; target = p;
      }
    }
    if (!target) return; // fizzle but cooldown already consumed
    const chained = new Set([c.id]);
    const segs = [];
    let from = c;
    let hops = s.chains + 1;
    let kb = s.kb * c.mods.dmgMul;
    let dmg = (s.dmg ?? CFG.BOLT_BASE_DAMAGE) * c.mods.dmgMul;
    while (target && hops-- > 0) {
      const dx = target.x - from.x, dz = target.z - from.z;
      const hit = target.applyHit(dx, dz, kb);
      segs.push({ x1: from.x, z1: from.z, x2: target.x, z2: target.z });
      if (hit) {
        target.applyDamage(dmg, c.id);
        emit(sim, { type: "hit", x: target.x, z: target.z, victim: target.id, by: c.id });
        // Apply slow on each chained target.
        if (s.slow) {
          target.status.slow = s.slowDur;
          target.status.slowMul = s.slow;
          emit(sim, { type: "statusApplied", status: "slow", x: target.x, z: target.z, victim: target.id });
        }
      }
      chained.add(target.id);
      kb *= 0.82;
      dmg *= 0.82;
      // Find next chain target near the current one with line-of-sight.
      let next = null, bestD = s.chainRange * s.chainRange;
      for (const p of sim.players.values()) {
        if (chained.has(p.id) || !p.alive || p.falling || p.spectating) continue;
        const d = (p.x - target.x) ** 2 + (p.z - target.z) ** 2;
        if (d > bestD) continue;
        if (!hasLoS(sim, target, p)) continue;
        bestD = d; next = p;
      }
      from = target; target = next;
    }
    emit(sim, { type: "lightning", id: c.id, segs, color: s.color, dir });
    // Also damage the nearest mob in range (lightning arc can arc to a mob if no player chain target).
    sim.damageMobsInRadius(c.x, c.z, s.range, { dmg: (s.dmg ?? CFG.BOLT_BASE_DAMAGE) * c.mods.dmgMul, by: c.id });
  },

  meteor(sim, c, cast) {
    const s = SPELLS.meteor;
    // Land at the target point, clamped to cast range.
    let tx = Number.isFinite(cast.tx) ? cast.tx : c.x + Math.cos(c.aim) * s.range;
    let tz = Number.isFinite(cast.tz) ? cast.tz : c.z + Math.sin(c.aim) * s.range;
    const dx = tx - c.x, dz = tz - c.z;
    const d = Math.hypot(dx, dz);
    if (d > s.range) { tx = c.x + (dx / d) * s.range; tz = c.z + (dz / d) * s.range; }
    // Effective blast radius scales with caster charge — rewarding combos.
    // Coefficient 0.08 keeps max-charge radius near ~9.5u (was 0.12 → 10.8u),
    // preserving a meaningful escape lane even on medium arenas.
    // aoeMul from Blast Tome item further scales the radius.
    const aoeMul = c.mods.aoeMul ?? 1;
    const effRadius = s.radius * aoeMul * (1 + Math.min(c.charge, CFG.CHARGE_MAX) * 0.08);
    sim.meteors.push({
      id: sim._meteorId++, ownerId: c.id, x: tx, z: tz,
      t: s.fall, fall: s.fall, radius: s.radius * aoeMul, effRadius, kb: s.kb * c.mods.dmgMul,
      dmg: (s.dmg ?? CFG.BOLT_BASE_DAMAGE) * c.mods.dmgMul,
      burn: s.burn, burnDur: s.burnDur, burnBy: c.id,
    });
    emit(sim, { type: "meteorCast", id: c.id, x: tx, z: tz, fall: s.fall, radius: effRadius });
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
    // Shockwave: knock nearby enemies away from the dash end point.
    // Estimated end position is ~1.2 units along the dash direction so the
    // check is meaningful even before the velocity fully resolves.
    const ex = c.x + Math.cos(dir) * 1.2;
    const ez = c.z + Math.sin(dir) * 1.2;
    for (const p of sim.players.values()) {
      if (p.id === c.id || !p.alive || p.falling || p.spectating) continue;
      const dx = p.x - ex, dz = p.z - ez;
      if (Math.hypot(dx, dz) <= s.shockRadius) {
        // Guard the hit event on the return value — applyHit returns false when
        // the shield absorbs the blow, matching the pattern used by lightning
        // and other hit-event emitters to avoid spurious VFX/SFX on a block.
        const hit = p.applyHit(dx, dz, s.shockKb);
        if (hit) {
          p.applyDamage(s.dmg, c.id);
          emit(sim, { type: "hit", x: p.x, z: p.z, victim: p.id, by: c.id });
        }
      }
    }
    // Shockwave also damages mobs in the shockwave radius.
    sim.damageMobsInRadius(ex, ez, s.shockRadius, { dmg: s.dmg, kb: s.shockKb * 0.5, by: c.id });
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
    // Charged targets are yanked harder — rewards draining a high-% opponent.
    const dx = c.x - tgt.x, dz = c.z - tgt.z;
    const l = Math.hypot(dx, dz) || 1;
    const effectivePull = s.pull * (1 + tgt.charge * 0.1);
    tgt.vx += (dx / l) * effectivePull;
    tgt.vz += (dz / l) * effectivePull;
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
        p.status.gravX = tx; p.status.gravZ = tz; p.status.gravPull = s.pull; p.status.gravBy = c.id;
        // Clear any stale mob-sourced implosion damage so the fallback to
        // SPELLS.gravity.dmg is used; mob vacuum damage must not bleed into
        // subsequent player-cast gravity wells on the same victim (state-leak fix).
        p.status.gravImplDmg = null;
        // Slow effect — gravity well impairs movement while trapped.
        if (s.slowMul) {
          p.status.slow = s.duration;
          p.status.slowMul = s.slowMul;
          emit(sim, { type: "statusApplied", status: "slow", x: p.x, z: p.z, victim: p.id });
        }
      }
    }
    // Gravity well also damages mobs caught in the field.
    sim.damageMobsInRadius(tx, tz, s.radius, { dmg: s.dmg ?? CFG.BOLT_BASE_DAMAGE, by: c.id });
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

  // ---- Step 3: DOTA-inspired roster ----

  projectile(sim, c, cast) {
    spawnProjectile(sim, c, aimToward(c, cast.tx, cast.tz), SPELLS.projectile);
    emit(sim, { type: "cast", spell: "projectile", id: c.id, x: c.x, z: c.z });
  },

  target(sim, c, cast) {
    const s = SPELLS.target;
    const t = aimedEnemy(sim, c, s.range, null) || nearestEnemy(sim, c.id, c.x, c.z, s.range);
    if (!t) return;
    t.applyDamage(s.dmg * c.mods.dmgMul, c.id);
    if (s.curse) { t.status.curse = s.curseDur; t.status.curseMul = s.curse; emit(sim, { type: "statusApplied", status: "curse", x: t.x, z: t.z, victim: t.id }); }
    emit(sim, { type: "hit", x: t.x, z: t.z, victim: t.id, by: c.id });
    emit(sim, { type: "target", id: c.id, victim: t.id, x: t.x, z: t.z });
    // Doom blast also damages the nearest mob in range.
    sim.damageMobsInRadius(c.x, c.z, s.range, { dmg: s.dmg * c.mods.dmgMul, by: c.id });
  },

  explode(sim, c, cast) {
    const s = SPELLS.explode;
    let tx = Number.isFinite(cast.tx) ? cast.tx : c.x + Math.cos(c.aim) * s.range;
    let tz = Number.isFinite(cast.tz) ? cast.tz : c.z + Math.sin(c.aim) * s.range;
    const dx = tx - c.x, dz = tz - c.z, d = Math.hypot(dx, dz);
    if (d > s.range) { tx = c.x + (dx / d) * s.range; tz = c.z + (dz / d) * s.range; }
    const explodeAoeMul = c.mods.aoeMul ?? 1;
    applyAoE(sim, c, tx, tz, s.radius * explodeAoeMul, s.kb * c.mods.dmgMul, s.dmg * c.mods.dmgMul, { burn: s.burn, burnDur: s.burnDur });
    // Detonate also damages mobs in the blast radius.
    sim.damageMobsInRadius(tx, tz, s.radius * explodeAoeMul, { dmg: s.dmg * c.mods.dmgMul, kb: s.kb * c.mods.dmgMul * 0.25, by: c.id });
    emit(sim, { type: "explode", id: c.id, x: tx, z: tz, radius: s.radius * explodeAoeMul });
  },

  stun(sim, c, cast) {
    const s = SPELLS.stun;
    const t = aimedEnemy(sim, c, s.range, null) || nearestEnemy(sim, c.id, c.x, c.z, s.range);
    if (!t) return;
    const dx = t.x - c.x, dz = t.z - c.z;
    if (t.applyHit(dx, dz, s.kb)) {
      t.applyDamage(s.dmg, c.id);
      t.status.stunned = Math.max(t.status.stunned, s.stunDur);
      emit(sim, { type: "hit", x: t.x, z: t.z, victim: t.id, by: c.id });
      emit(sim, { type: "statusApplied", status: "stun", x: t.x, z: t.z, victim: t.id });
    }
    // Hex Bash also damages the nearest mob in range.
    sim.damageMobsInRadius(c.x, c.z, s.range, { dmg: s.dmg, kb: s.kb * 0.25, by: c.id });
  },

  push(sim, c, cast) {
    const s = SPELLS.push;
    for (const p of sim.players.values()) {
      if (p.id === c.id || !p.alive || p.falling || p.spectating) continue;
      const dx = p.x - c.x, dz = p.z - c.z, d = Math.hypot(dx, dz);
      if (d > s.range) continue;
      let da = Math.atan2(dz, dx) - c.aim;
      while (da > Math.PI) da -= 2 * Math.PI;
      while (da < -Math.PI) da += 2 * Math.PI;
      if (Math.abs(da) > s.cone) continue;
      if (p.applyHit(dx, dz, s.kb)) {
        p.applyDamage(s.dmg, c.id);
        emit(sim, { type: "hit", x: p.x, z: p.z, victim: p.id, by: c.id });
      }
    }
    emit(sim, { type: "push", id: c.id, x: c.x, z: c.z, dir: c.aim, range: s.range });
    // Force Wave also damages mobs in the forward cone.
    sim.damageMobsInRadius(c.x, c.z, s.range, { dmg: s.dmg, kb: s.kb * 0.25, by: c.id });
  },

  pull(sim, c, cast) {
    const s = SPELLS.pull;
    const t = aimedEnemy(sim, c, s.range, 0.6) || nearestEnemy(sim, c.id, c.x, c.z, s.range);
    if (!t) return;
    const dx = c.x - t.x, dz = c.z - t.z, l = Math.hypot(dx, dz) || 1;
    t.vx += (dx / l) * s.pull; t.vz += (dz / l) * s.pull;
    t.applyDamage(s.dmg, c.id);
    emit(sim, { type: "pull", a: c.id, b: t.id, x1: c.x, z1: c.z, x2: t.x, z2: t.z });
    // Hook also damages the nearest mob in range.
    sim.damageMobsInRadius(c.x, c.z, s.range, { dmg: s.dmg, by: c.id });
  },

  invisible(sim, c) {
    c.status.invisible = SPELLS.invisible.duration;
    emit(sim, { type: "invisible", id: c.id });
  },

  speed(sim, c) {
    c.status.haste = SPELLS.speed.duration;
    c.status.hasteMul = SPELLS.speed.hasteMul;
    emit(sim, { type: "speed", id: c.id });
  },

  blink(sim, c, cast) {
    const s = SPELLS.blink;
    let tx = Number.isFinite(cast.tx) ? cast.tx : c.x + Math.cos(c.aim) * s.range;
    let tz = Number.isFinite(cast.tz) ? cast.tz : c.z + Math.sin(c.aim) * s.range;
    const dx = tx - c.x, dz = tz - c.z, d = Math.hypot(dx, dz);
    if (d > s.range) { tx = c.x + (dx / d) * s.range; tz = c.z + (dz / d) * s.range; }
    emit(sim, { type: "teleport", id: c.id, x1: c.x, z1: c.z, x2: tx, z2: tz });
    c.x = tx; c.z = tz; c.vx *= 0.3; c.vz *= 0.3;
  },

  summon(sim, c) {
    if (typeof sim.spawnSummon === "function") sim.spawnSummon(c, SPELLS.summon.summonTtl);
    emit(sim, { type: "summon", id: c.id, x: c.x, z: c.z });
  },
};

// Channel tick handlers — called repeatedly during the channel phase.
// Spells present here but absent from HANDLERS are pure channels (no wind-up effect).
const CHANNEL_TICK = {
  heal(sim, c, ac, dt) {
    c.applyHeal(SPELLS.heal.heal);
    emit(sim, { type: "heal", id: c.id, x: c.x, z: c.z });
  },
  vacuum(sim, c, ac, dt) {
    const s = SPELLS.vacuum;
    for (const p of sim.players.values()) {
      if (p.id === c.id || !p.alive || p.falling || p.spectating) continue;
      const dx = c.x - p.x, dz = c.z - p.z, d = Math.hypot(dx, dz);
      if (d > s.radius) continue;
      const l = d || 1;
      p.vx += (dx / l) * s.pull * dt * 8;
      p.vz += (dz / l) * s.pull * dt * 8;
      p.applyDamage(s.dmg * dt * 4, c.id);
      if (s.slowMul) { p.status.slow = Math.max(p.status.slow, 0.3); p.status.slowMul = s.slowMul; }
    }
    emit(sim, { type: "vacuumTick", id: c.id, x: c.x, z: c.z, radius: s.radius });
  },
  drag(sim, c, ac, dt) {
    const s = SPELLS.drag;
    if (ac.targetId === undefined) {
      const t = aimedEnemy(sim, c, s.range, null) || nearestEnemy(sim, c.id, c.x, c.z, s.range);
      ac.targetId = t ? t.id : null;
    }
    const t = ac.targetId ? sim.players.get(ac.targetId) : null;
    if (!t || !t.alive || t.falling) return;
    const dx = c.x - t.x, dz = c.z - t.z, l = Math.hypot(dx, dz) || 1;
    t.vx += (dx / l) * s.pull; t.vz += (dz / l) * s.pull;
    t.applyDamage(s.dmg, c.id);
    emit(sim, { type: "drag", a: c.id, b: t.id, x1: c.x, z1: c.z, x2: t.x, z2: t.z });
  },
};

// Resolve one cast request from a player. Returns true if it fired (started).
// For cast-time/channel spells: the spell is "fired" at cast-begin (cooldown + rune consumed),
// and advanceCasts() drives the wind-up and channel phases each tick.
export function castSpell(sim, caster, cast) {
  const spell = SPELLS[cast.spell];
  if (!spell) return false;
  if (!caster.canCast(cast.spell)) return false;
  if (!HANDLERS[cast.spell] && !CHANNEL_TICK[cast.spell]) return false;
  const castTime = spell.castTime || 0, channel = spell.channel || 0;
  if (castTime > 0 || channel > 0) {
    // Wind-up or channel spell: begin the cast state machine.
    caster.activeCast = {
      spell: cast.spell, tx: cast.tx, tz: cast.tz,
      castTime, channel,
      interruptible: spell.interruptible !== false,
      t: 0, channeling: castTime <= 0, tickAcc: 0,
      anchorX: caster.x, anchorZ: caster.z,
    };
    caster.startCooldown(cast.spell);
    if (sim.practiceNoCooldown) caster.cooldowns[cast.spell] = 0;
    emit(sim, { type: "castStart", id: caster.id, spell: cast.spell, x: caster.x, z: caster.z, castTime, channel });
    return true;
  }
  // Instant spell: fire immediately.
  HANDLERS[cast.spell](sim, caster, cast);
  caster.startCooldown(cast.spell);
  if (sim.practiceNoCooldown) caster.cooldowns[cast.spell] = 0;
  if (spell.sfx) emit(sim, { type: "sfx", sfx: spell.sfx, x: caster.x, z: caster.z });
  return true;
}

// Advance all active casts (wind-up / channel state machine). Call once per sim
// tick, AFTER p.step() and the cast-resolve loop so stun/disable/move are current.
export function advanceCasts(sim, dt) {
  for (const c of sim.players.values()) {
    const ac = c.activeCast;
    if (!ac) continue;
    if (!c.alive || c.falling) { c.activeCast = null; continue; }
    // Interruptible spells are cancelled by stun or silence.
    if (ac.interruptible && (c.status.stunned > 0 || c.status.disabled > 0)) {
      emit(sim, { type: "castInterrupt", id: c.id, spell: ac.spell, x: c.x, z: c.z, reason: "disable" });
      c.activeCast = null; continue;
    }
    ac.t += dt;
    if (!ac.channeling) {
      // Wind-up phase: wait for castTime to elapse, then fire.
      if (ac.t >= ac.castTime) {
        const spell = SPELLS[ac.spell];
        if (HANDLERS[ac.spell]) HANDLERS[ac.spell](sim, c, ac);
        if (spell.sfx) emit(sim, { type: "sfx", sfx: spell.sfx, x: c.x, z: c.z });
        if (ac.channel > 0) {
          // Transition to channel phase.
          ac.channeling = true; ac.t = 0; ac.tickAcc = 0;
          ac.anchorX = c.x; ac.anchorZ = c.z;
        } else {
          emit(sim, { type: "castFinish", id: c.id, spell: ac.spell, x: c.x, z: c.z });
          c.activeCast = null;
        }
      }
      continue;
    }
    // Channel phase: cancel on movement drift or active move input.
    const moved = Math.hypot(c.x - ac.anchorX, c.z - ac.anchorZ);
    const movingInput = Math.hypot(c.input.move[0], c.input.move[1]) > 0.01;
    if (moved > CFG.CAST_MOVE_CANCEL || movingInput) {
      emit(sim, { type: "castInterrupt", id: c.id, spell: ac.spell, x: c.x, z: c.z, reason: "move" });
      c.activeCast = null; continue;
    }
    // Fire channel ticks at the configured interval.
    const tick = SPELLS[ac.spell].tick || CFG.CAST_TICK_DEFAULT;
    ac.tickAcc += dt;
    while (ac.tickAcc >= tick) { ac.tickAcc -= tick; CHANNEL_TICK[ac.spell]?.(sim, c, ac, tick); }
    if (ac.t >= ac.channel) {
      emit(sim, { type: "castFinish", id: c.id, spell: ac.spell, x: c.x, z: c.z });
      c.activeCast = null;
    }
  }
}

export { HANDLERS, CHANNEL_TICK, applyAoE, nearestEnemy, aimedEnemy };
