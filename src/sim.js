// Pure, authoritative game simulation. Deliberately free of Three.js so it can
// run on the host and be unit-tested headlessly in Node.
import { CFG, SPELLS, SPELL_ORDER, getArenaLandSize, getArenaWorld, isOnArenaWorld } from "./config.js";
import { Player } from "./player.js";
import { Bolt } from "./bolt.js";
import { castSpell } from "./spells.js";

// Minimum distance between two points moving linearly from (a0->a1) and
// (b0->b1) over a unit time step, plus the midpoint at closest approach. Used
// for swept projectile-vs-projectile collision so fast bolts that cross between
// ticks still register a clash instead of tunneling.
function closestApproach(a0x, a0z, a1x, a1z, b0x, b0z, b1x, b1z) {
  const rx = a0x - b0x, rz = a0z - b0z;          // initial relative position
  const vx = (a1x - a0x) - (b1x - b0x);          // relative velocity over step
  const vz = (a1z - a0z) - (b1z - b0z);
  const vv = vx * vx + vz * vz;
  let t = vv > 1e-12 ? -(rx * vx + rz * vz) / vv : 0;
  if (t < 0) t = 0; else if (t > 1) t = 1;
  const ax = a0x + (a1x - a0x) * t, az = a0z + (a1z - a0z) * t;
  const bx = b0x + (b1x - b0x) * t, bz = b0z + (b1z - b0z) * t;
  return { dist: Math.hypot(ax - bx, az - bz), x: (ax + bx) * 0.5, z: (az + bz) * 0.5 };
}

// A lightweight logical arena (no rendering) used by the sim.
class LogicArena {
  constructor(world, landSize) {
    this.world = world;
    this.landSize = landSize;
    this.radius = landSize.radius;
  }
  isOnPlatform(x, z) { return isOnArenaWorld(this.world.id, this.radius, x, z); }
  reset() { this.radius = this.landSize.radius; }
}

export const PHASE = {
  LOBBY: "lobby",
  COUNTDOWN: "countdown",
  PLAYING: "playing",
  ROUND_END: "roundEnd",
  MATCH_END: "matchEnd",
};

const BOT_PREFIX = "bot:";
const BOT_DEFAULT_CAST_RANGE = 16; // fallback for spells without an explicit handbook range
const BOT_SETTINGS = {
  smart: { preferredRange: 10, retreatRange: 3.2, fireRange: 14, accuracy: 0.22, fireEvery: 0.75, strafe: 0.35, abilityEvery: 4.5 },
  brilliant: { preferredRange: 9, retreatRange: 4, fireRange: 16, accuracy: 0.1, fireEvery: 0.48, strafe: 0.55, abilityEvery: 3.0 },
  expert: { preferredRange: 8, retreatRange: 4.8, fireRange: 30, accuracy: 0.02, fireEvery: 0.28, strafe: 0.75, abilityEvery: 1.7 },
};

function normalizeBotSkill(skill) {
  return CFG.BOT_SKILLS.includes(skill) ? skill : "smart";
}

function botDisplayName(skill, index) {
  return `${skill[0].toUpperCase()}${skill.slice(1)} Bot ${index + 1}`;
}

export class Simulation {
  constructor(options = {}) {
    this.allAbilitiesAtStart = options.allAbilitiesAtStart !== false;
    this.world = getArenaWorld(options.arenaWorld);
    this.landSize = getArenaLandSize(options.landSize);
    this.players = new Map(); // id -> Player
    this.bolts = [];
    this.meteors = [];        // in-flight meteors (delayed AoE)
    this.runes = [];
    this.runeSpawnTimer = 0;  // counts down to the next timed rune spawn
    this.runePool = [];       // remaining spell ids queued to drop as runes
    this._meteorId = 1;
    this._runeId = 1;
    this.arena = new LogicArena(this.world, this.landSize);
    this.phase = PHASE.LOBBY;
    this.round = 0;
    this.phaseTimer = 0;     // counts down within a phase
    this.playTime = 0;       // seconds elapsed in current round
    this.lastWinnerId = null;
    this.matchWinnerId = null;
    this.events = [];        // transient events for the renderer/sound (e.g. hits)
  }

  addPlayer(id, name, options = {}) {
    if (this.players.has(id)) return this.players.get(id);
    const idx = this.players.size;
    const p = new Player(id, name, idx, options);
    if (this.allAbilitiesAtStart) p.setAllSpells();
    else p.setStarterSpells();
    if (this.phase !== PHASE.LOBBY) {
      p.alive = false;
      p.spectating = true;
    }
    this.players.set(id, p);
    return p;
  }

  setBotRoster(count, skill = "smart") {
    const botSkill = normalizeBotSkill(skill);
    const humanCount = [...this.players.values()].filter((p) => !p.isBot).length;
    const wanted = Math.max(0, Math.min(CFG.MAX_PLAYERS - humanCount, Number.parseInt(count, 10) || 0));
    for (const id of [...this.players.keys()]) {
      if (this.players.get(id).isBot) this.players.delete(id);
    }
    const bots = [];
    for (let i = 0; i < wanted; i++) {
      bots.push(this.addPlayer(`${BOT_PREFIX}${i + 1}`, botDisplayName(botSkill, i), { isBot: true, botSkill }));
    }
    if (this.phase !== PHASE.LOBBY) this.resolveRoundIfNeeded();
    return bots;
  }

  botPlayers() {
    return [...this.players.values()].filter((p) => p.isBot);
  }

  removePlayer(id) {
    const wasActive = this.phase === PHASE.PLAYING || this.phase === PHASE.COUNTDOWN;
    this.players.delete(id);
    if (wasActive) this.resolveRoundIfNeeded();
  }

  setInput(id, input = {}) {
    const p = this.players.get(id);
    if (!p) return;
    const seq = Number.isFinite(input.seq) ? input.seq : p.input.seq;
    // Guard against stale/old input packets.
    if (seq < p.input.seq) return;
    const move = Array.isArray(input.move) ? input.move : [0, 0];
    const mx = Number.isFinite(move[0]) ? Math.max(-1, Math.min(1, move[0])) : 0;
    const mz = Number.isFinite(move[1]) ? Math.max(-1, Math.min(1, move[1])) : 0;
    // Sanitize cast requests (each: {id, spell, tx, tz}) and queue new ones,
    // deduped by monotonically-increasing id so repeated input packets that
    // still carry an old cast don't fire it twice.
    if (Array.isArray(input.casts)) {
      for (const c of input.casts) {
        if (!c || typeof c.spell !== "string") continue;
        const id = Number.isFinite(c.id) ? c.id : 0;
        if (id <= p._castSeen) continue;
        p._castSeen = id;
        p.pendingCasts.push({
          id,
          spell: c.spell,
          tx: Number.isFinite(c.tx) ? c.tx : NaN,
          tz: Number.isFinite(c.tz) ? c.tz : NaN,
        });
      }
    }
    p.input = {
      move: [mx, mz],
      aim: Number.isFinite(input.aim) ? input.aim : 0,
      fire: !!input.fire,
      seq,
      casts: p.input.casts || [],
    };
  }

  activePlayers() {
    return [...this.players.values()].filter((p) => !p.spectating);
  }

  alivePlayers() {
    return this.activePlayers().filter((p) => p.alive);
  }

  canStartMatch() {
    return this.phase === PHASE.LOBBY && this.players.size >= 2;
  }

  startMatch() {
    if (!this.canStartMatch()) return false;
    for (const p of this.players.values()) p.score = 0;
    this.matchWinnerId = null;
    this.round = 0;
    this.beginRound();
    return true;
  }

  spawnPoint(angle) {
    const offsets = [0, 1, -1, 2, -2, 3, -3, 4, -4, 5, -5, 6, -6, 7, -7, 8];
    const startRadius = this.arena.radius > CFG.ARENA_RADIUS ? this.arena.radius * 0.78 : Math.min(this.arena.radius - 3, 12);
    for (const offset of offsets) {
      const a = angle + offset * (Math.PI / 16);
      for (let r = startRadius; r >= 2; r -= 1) {
        const x = Math.cos(a) * r;
        const z = Math.sin(a) * r;
        if (this.arena.isOnPlatform(x, z)) return { angle: a, radius: r };
      }
    }
    return { angle, radius: 0 };
  }

  beginRound() {
    this.round++;
    this.bolts = [];
    this.meteors = [];
    this.runes = [];
    this.runePool = [];
    this.runeSpawnTimer = 0;
    this.arena.reset();
    this.playTime = 0;
    this.phase = PHASE.COUNTDOWN;
    this.phaseTimer = CFG.ROUND.COUNTDOWN;

    // Spawn active players evenly around a ring; late joiners enter next round.
    const list = [...this.players.values()];
    const n = Math.max(1, list.length);
    list.forEach((p, i) => {
      const spawn = this.spawnPoint((i / n) * Math.PI * 2);
      p.spawn(spawn.angle, spawn.radius);
      if (this.allAbilitiesAtStart) p.setAllSpells();
      else p.setStarterSpells();
    });
    if (!this.allAbilitiesAtStart) this.spawnRunes();
  }

  // Initialise rune mode: fill a shuffled pool of acquirable spells and seed the
  // field up to the active cap. Remaining spells drip out over time.
  spawnRunes() {
    this.runes = [];
    this.runePool = this._shuffle(SPELL_ORDER.filter((id) => id !== "fireball"));
    this.runeSpawnTimer = CFG.RUNE_SPAWN_INTERVAL;
    const seed = Math.min(CFG.RUNE_MAX_ACTIVE, this.runePool.length);
    for (let i = 0; i < seed; i++) this.spawnNextRune();
  }

  // Pop the next spell from the pool and drop it as a rune at a random spot.
  spawnNextRune() {
    if (this.runes.length >= CFG.RUNE_MAX_ACTIVE) return null;
    if (!this.runePool.length) return null;
    const spell = this.runePool.shift();
    const angle = Math.random() * Math.PI * 2;
    const ring = Math.min(CFG.RUNE_SPAWN_RADIUS, this.arena.radius * 0.72) * (0.5 + 0.4 * Math.random());
    const rune = {
      id: this._runeId++,
      spell,
      x: +(Math.cos(angle) * ring).toFixed(3),
      z: +(Math.sin(angle) * ring).toFixed(3),
    };
    this.runes.push(rune);
    return rune;
  }

  _shuffle(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  // Advance the rune spawn timer and refill the pool so abilities keep flowing.
  stepRunes(dt) {
    if (this.allAbilitiesAtStart) return;
    if (!this.runePool.length && !this.runes.length) {
      // All spells distributed/consumed for now — recycle the pool so the
      // round keeps offering fresh abilities to fight over.
      this.runePool = this._shuffle(SPELL_ORDER.filter((id) => id !== "fireball"));
    }
    if (this.runes.length >= CFG.RUNE_MAX_ACTIVE) return;
    this.runeSpawnTimer -= dt;
    if (this.runeSpawnTimer <= 0) {
      this.spawnNextRune();
      this.runeSpawnTimer = CFG.RUNE_SPAWN_INTERVAL;
    }
  }

  returnToLobby() {
    this.phase = PHASE.LOBBY;
    this.phaseTimer = 0;
    this.playTime = 0;
    this.lastWinnerId = null;
    this.matchWinnerId = null;
    this.bolts = [];
    this.runes = [];
    this.runePool = [];
    this.runeSpawnTimer = 0;
    this.arena.reset();
    for (const p of this.players.values()) {
      p.alive = true;
      p.spectating = false;
      p.falling = false;
      p.vx = p.vz = p.vy = 0;
      p.charge = 0;
    }
  }

  resolveRoundIfNeeded() {
    if (this.phase !== PHASE.PLAYING && this.phase !== PHASE.COUNTDOWN) return;
    const active = this.activePlayers();
    if (active.length < 2) {
      this.returnToLobby();
      return;
    }
    const alive = this.alivePlayers();
    if (alive.length <= 1) this.endRound(alive[0] || null);
  }

  spawnBolt(owner) {
    const ox = owner.x + Math.cos(owner.aim) * (CFG.PLAYER_RADIUS + 0.6);
    const oz = owner.z + Math.sin(owner.aim) * (CFG.PLAYER_RADIUS + 0.6);
    this.bolts.push(new Bolt(owner.id, ox, oz, owner.aim, owner.color));
    owner.cooldown = owner.isBot && Number.isFinite(owner._botFireCooldown)
      ? owner._botFireCooldown
      : CFG.BOLT_COOLDOWN;
  }

  // Advance the whole simulation by dt seconds (host authoritative).
  step(dt) {
    this.events = [];

    if (this.phase === PHASE.COUNTDOWN) {
      this.phaseTimer -= dt;
      if (this.phaseTimer <= 0) {
        this.phase = PHASE.PLAYING;
        this.playTime = 0;
      }
      return;
    }

    if (this.phase === PHASE.ROUND_END || this.phase === PHASE.MATCH_END) {
      this.phaseTimer -= dt;
      if (this.phase === PHASE.ROUND_END && this.phaseTimer <= 0) {
        if (this.matchWinnerId != null) {
          this.phase = PHASE.MATCH_END;
          this.phaseTimer = 999;
        } else {
          this.beginRound();
        }
      }
      return;
    }

    if (this.phase !== PHASE.PLAYING) return;

    this.playTime += dt;

    // Shrink the arena after a delay to force confrontation.
    if (this.playTime > CFG.ROUND.SHRINK_START_DELAY) {
      this.arena.radius = Math.max(
        CFG.ARENA_MIN_RADIUS,
        this.arena.radius - CFG.ROUND.SHRINK_RATE * dt
      );
    }

    this.updateBotInputs();

    // Fire intents -> default fireball (holding fire / Space).
    for (const p of this.players.values()) {
      if (p.input.fire && p.canFire()) this.spawnBolt(p);
    }

    // Resolve queued spell casts (one shot per cast id).
    for (const p of this.players.values()) {
      if (p.pendingCasts.length) {
        for (const cast of p.pendingCasts) {
          const fired = castSpell(this, p, cast);
          // In rune mode, abilities are single-use: casting consumes the spell
          // (Fireball is the permanent starter weapon and is never consumed).
          if (fired && !this.allAbilitiesAtStart && cast.spell !== "fireball") {
            p.removeSpell(cast.spell);
            this.events.push({ type: "spellConsumed", id: p.id, spell: cast.spell });
          }
        }
        p.pendingCasts = [];
      }
    }

    // Step players.
    for (const p of this.players.values()) p.step(dt, this.arena);

    // Resolve Time Shift rewinds.
    for (const p of this.players.values()) {
      if (p.timeshift) {
        p.timeshift.t -= dt;
        if (p.timeshift.t <= 0) {
          if (p.alive) {
            p.x = p.timeshift.x; p.z = p.timeshift.z;
            p.charge = p.timeshift.charge;
            p.vx = p.vz = 0; p.falling = false; p.vy = 0;
            this.events.push({ type: "timeshiftReturn", id: p.id, x: p.x, z: p.z });
          }
          p.timeshift = null;
        }
      }
    }

    // Step bolts + resolve hits.
    const playerArr = [...this.players.values()];
    const spawned = [];
    for (const b of this.bolts) {
      b.step(dt, playerArr, this.arena, { movementOnly: true });
      if (b._spawn && b._spawn.length) spawned.push(...b._spawn);
    }
    this.resolveProjectileClashes();
    for (const b of this.bolts) {
      if (b.dead) continue;
      const res = b.step(0, playerArr, this.arena);
      if (res && res.hit != null) {
        const shooter = this.players.get(b.ownerId);
        const victim = this.players.get(res.hit);
        // Disable projectiles silence their victim.
        if (b.disable && victim) victim.status.disabled = b.disable;
        // Lifesteal items reduce the shooter's own charge on a landed hit.
        if (shooter && shooter.mods.lifesteal > 0) {
          shooter.charge = Math.max(0, shooter.charge - shooter.mods.lifesteal);
        }
        this.events.push({ type: "hit", x: b.x, z: b.z, victim: res.hit, by: b.ownerId });
      }
    }
    if (spawned.length) this.bolts.push(...spawned);
    this.bolts = this.bolts.filter((b) => !b.dead);

    // Step meteors (delayed AoE impacts).
    for (const m of this.meteors) {
      m.t -= dt;
      if (m.t <= 0) {
        for (const p of this.players.values()) {
          if (!p.alive || p.falling || p.spectating) continue;
          const dx = p.x - m.x, dz = p.z - m.z;
          const d = Math.hypot(dx, dz);
          if (d <= m.radius) {
            const falloff = 1 - d / m.radius;
            // Players caught dead-centre are flung in their current facing
            // (or a default) so the impact always imparts knockback.
            let ndx = dx, ndz = dz;
            if (d < 0.001) { ndx = Math.cos(p.aim); ndz = Math.sin(p.aim); }
            const l = Math.hypot(ndx, ndz) || 1;
            p.applyHit((ndx / l), (ndz / l), m.kb * (0.4 + 0.6 * falloff));
          }
        }
        this.events.push({ type: "meteorImpact", x: m.x, z: m.z, radius: m.radius, by: m.ownerId });
        m.dead = true;
      }
    }
    this.meteors = this.meteors.filter((m) => !m.dead);

    this.stepRunes(dt);
    this.resolveRuneDestruction();
    this.resolveRunePickups();

    // Death detection (falling players that reached lava become !alive in step()).
    for (const p of this.players.values()) {
      if (!p.alive && p._countedDeath !== this.round) {
        p._countedDeath = this.round;
        this.events.push({ type: "death", id: p.id });
      }
    }

    this.resolveRoundIfNeeded();
  }

  resolveProjectileClashes() {
    if (this.bolts.length < 2) return;
    const r = CFG.BOLT_RADIUS * 2;
    for (let i = 0; i < this.bolts.length; i++) {
      const a = this.bolts[i];
      if (a.dead) continue;
      for (let j = i + 1; j < this.bolts.length; j++) {
        const b = this.bolts[j];
        if (b.dead || a.ownerId === b.ownerId) continue;
        // Swept test against this tick's travel segments so fast projectiles
        // that cross between ticks still clash instead of tunneling through.
        const hit = closestApproach(
          a.prevX, a.prevZ, a.x, a.z,
          b.prevX, b.prevZ, b.x, b.z,
        );
        if (hit.dist <= r) {
          a.dead = true;
          b.dead = true;
          this.events.push({ type: "projectileClash", x: +hit.x.toFixed(2), z: +hit.z.toFixed(2) });
          break;
        }
      }
    }
  }

  // Players can shoot a rune to destroy it, denying the ability to rivals.
  resolveRuneDestruction() {
    if (this.allAbilitiesAtStart || !this.runes.length || !this.bolts.length) return;
    const remaining = [];
    for (const rune of this.runes) {
      let destroyed = false;
      for (const b of this.bolts) {
        if (b.dead) continue;
        const d = Math.hypot(b.x - rune.x, b.z - rune.z);
        if (d <= CFG.RUNE_RADIUS + CFG.BOLT_RADIUS) {
          destroyed = true;
          b.dead = true;
          this.events.push({ type: "runeDestroyed", spell: rune.spell, by: b.ownerId, x: rune.x, z: rune.z });
          break;
        }
      }
      if (!destroyed) remaining.push(rune);
    }
    this.runes = remaining;
    this.bolts = this.bolts.filter((b) => !b.dead);
  }

  resolveRunePickups() {
    if (this.allAbilitiesAtStart || !this.runes.length) return;
    const remaining = [];
    for (const rune of this.runes) {
      let picked = false;
      for (const p of this.players.values()) {
        if (!p.alive || p.falling || p.spectating || p.hasSpell(rune.spell)) continue;
        const d = Math.hypot(p.x - rune.x, p.z - rune.z);
        if (d <= CFG.RUNE_RADIUS + CFG.PLAYER_RADIUS && p.acquireSpell(rune.spell)) {
          this.events.push({ type: "runePickup", id: p.id, spell: rune.spell, x: rune.x, z: rune.z });
          picked = true;
          break;
        }
      }
      if (!picked) remaining.push(rune);
    }
    this.runes = remaining;
  }

  updateBotInputs() {
    const living = this.alivePlayers();
    for (const bot of living.filter((p) => p.isBot)) {
      const target = living
        .filter((p) => p.id !== bot.id)
        .sort((a, b) => Math.hypot(a.x - bot.x, a.z - bot.z) - Math.hypot(b.x - bot.x, b.z - bot.z))[0];
      if (!target) continue;
      bot.input = this.planBotInput(bot, target);
    }
  }

  planBotInput(bot, target) {
    const settings = BOT_SETTINGS[normalizeBotSkill(bot.botSkill)];
    const dx = target.x - bot.x;
    const dz = target.z - bot.z;
    const dist = Math.hypot(dx, dz) || 1;
    const towardX = dx / dist;
    const towardZ = dz / dist;
    const centerDist = Math.hypot(bot.x, bot.z) || 1;
    const centerX = -bot.x / centerDist;
    const centerZ = -bot.z / centerDist;
    const edgeDanger = this.arena.radius - centerDist < 4;
    let moveX = 0;
    let moveZ = 0;
    if (edgeDanger) {
      moveX += centerX * 1.4;
      moveZ += centerZ * 1.4;
    } else if (dist > settings.preferredRange) {
      moveX += towardX;
      moveZ += towardZ;
    } else if (dist < settings.retreatRange) {
      moveX -= towardX;
      moveZ -= towardZ;
    }
    const side = bot.id.charCodeAt(bot.id.length - 1) % 2 === 0 ? 1 : -1;
    moveX += -towardZ * settings.strafe * side;
    moveZ += towardX * settings.strafe * side;
    const aim = Math.atan2(dz, dx) + settings.accuracy * Math.sin(this.playTime * 3 + bot.colorIndex);
    bot._botFireCooldown = settings.fireEvery;
    const fire = dist <= settings.fireRange && bot.canFire() && (bot._nextBotFireAt ?? 0) <= this.playTime;
    if (fire) bot._nextBotFireAt = this.playTime + settings.fireEvery;
    this.queueBotAbility(bot, target, dist, settings);
    return { move: [moveX, moveZ], aim, fire, seq: bot.input.seq + 1, casts: [] };
  }

  queueBotAbility(bot, target, dist, settings) {
    if ((bot._nextBotAbilityAt ?? 0) > this.playTime || bot.status.disabled > 0) return;
    const skill = normalizeBotSkill(bot.botSkill);
    const edgeDanger = this.arena.radius - Math.hypot(bot.x, bot.z) < 4;
    // Some spells (fireball, homing) have no explicit `range` in the handbook;
    // fall back to a generous default so the comparison is never `dist <= undefined`
    // (which is always false and would silently disable those branches).
    const reach = (id) => (Number.isFinite(SPELLS[id].range) ? SPELLS[id].range : BOT_DEFAULT_CAST_RANGE);
    let spell = null;
    let tx = target.x;
    let tz = target.z;
    if (edgeDanger && bot.canCast("thrust")) {
      spell = "thrust"; tx = 0; tz = 0;
    } else if (bot.charge > 1.6 && bot.canCast("shield")) {
      spell = "shield";
    } else if (skill === "expert" && dist <= reach("meteor") && bot.canCast("meteor")) {
      spell = "meteor";
    } else if (skill !== "smart" && dist <= reach("lightning") && bot.canCast("lightning")) {
      spell = "lightning";
    } else if (skill === "expert" && dist <= reach("gravity") && bot.canCast("gravity")) {
      spell = "gravity";
    } else if (dist <= reach("homing") && bot.canCast("homing")) {
      spell = "homing";
    } else if (dist <= reach("fireball") && bot.canCast("fireball")) {
      spell = "fireball";
    }
    if (!spell) return;
    bot.pendingCasts.push({ id: ++bot._botCastId, spell, tx, tz });
    bot._nextBotAbilityAt = this.playTime + settings.abilityEvery;
  }

  endRound(winner) {
    this.lastWinnerId = winner ? winner.id : null;
    if (winner) {
      winner.score += CFG.ROUND.POINTS_FOR_WIN;
      if (winner.score >= CFG.ROUND.POINTS_TO_WIN_MATCH) {
        this.matchWinnerId = winner.id;
      }
    }
    this.phase = PHASE.ROUND_END;
    this.phaseTimer = CFG.ROUND.END_DELAY;
  }

  // Full snapshot the host broadcasts to clients each tick.
  snapshot() {
    return {
      t: Date.now(),
      phase: this.phase,
      round: this.round,
      timer: +this.phaseTimer.toFixed(2),
      playTime: +this.playTime.toFixed(2),
      arenaR: +this.arena.radius.toFixed(2),
      arenaWorld: this.world.id,
      landSize: this.landSize.id,
      winner: this.lastWinnerId,
      matchWinner: this.matchWinnerId,
      players: [...this.players.values()].map((p) => p.snapshot()),
      bolts: this.bolts.map((b) => b.snapshot()),
      meteors: this.meteors.map((m) => ({
        id: m.id, x: +m.x.toFixed(2), z: +m.z.toFixed(2),
        t: +m.t.toFixed(2), fall: m.fall, r: m.radius,
      })),
      runes: this.runes.map((r) => ({ id: r.id, spell: r.spell, x: r.x, z: r.z, c: SPELLS[r.spell]?.color || 0xffffff })),
      spellSlotsEnabled: !this.allAbilitiesAtStart,
      events: this.events,
    };
  }
}
