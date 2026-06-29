// Pure, authoritative game simulation. Deliberately free of Three.js so it can
// run on the host and be unit-tested headlessly in Node.
import { CFG, SPELLS } from "./config.js";
import { Player } from "./player.js";
import { Bolt } from "./bolt.js";
import { castSpell } from "./spells.js";

// A lightweight logical arena (no rendering) used by the sim.
class LogicArena {
  constructor() { this.radius = CFG.ARENA_RADIUS; }
  isOnPlatform(x, z) { return x * x + z * z <= this.radius * this.radius; }
  reset() { this.radius = CFG.ARENA_RADIUS; }
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
  constructor() {
    this.players = new Map(); // id -> Player
    this.bolts = [];
    this.meteors = [];        // in-flight meteors (delayed AoE)
    this._meteorId = 1;
    this.arena = new LogicArena();
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

  beginRound() {
    this.round++;
    this.bolts = [];
    this.meteors = [];
    this.arena.reset();
    this.playTime = 0;
    this.phase = PHASE.COUNTDOWN;
    this.phaseTimer = CFG.ROUND.COUNTDOWN;

    // Spawn active players evenly around a ring; late joiners enter next round.
    const list = [...this.players.values()];
    const n = Math.max(1, list.length);
    const spawnR = Math.min(CFG.ARENA_RADIUS - 3, 12);
    list.forEach((p, i) => p.spawn((i / n) * Math.PI * 2, spawnR));
  }

  returnToLobby() {
    this.phase = PHASE.LOBBY;
    this.phaseTimer = 0;
    this.playTime = 0;
    this.lastWinnerId = null;
    this.matchWinnerId = null;
    this.bolts = [];
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
        for (const cast of p.pendingCasts) castSpell(this, p, cast);
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
      const res = b.step(dt, playerArr, this.arena);
      if (b._spawn && b._spawn.length) spawned.push(...b._spawn);
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

    // Death detection (falling players that reached lava become !alive in step()).
    for (const p of this.players.values()) {
      if (!p.alive && p._countedDeath !== this.round) {
        p._countedDeath = this.round;
        this.events.push({ type: "death", id: p.id });
      }
    }

    this.resolveRoundIfNeeded();
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
      winner: this.lastWinnerId,
      matchWinner: this.matchWinnerId,
      players: [...this.players.values()].map((p) => p.snapshot()),
      bolts: this.bolts.map((b) => b.snapshot()),
      meteors: this.meteors.map((m) => ({
        id: m.id, x: +m.x.toFixed(2), z: +m.z.toFixed(2),
        t: +m.t.toFixed(2), fall: m.fall, r: m.radius,
      })),
      events: this.events,
    };
  }
}
