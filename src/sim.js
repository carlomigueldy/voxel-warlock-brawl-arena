// Pure, authoritative game simulation. Deliberately free of Three.js so it can
// run on the host and be unit-tested headlessly in Node.
import { CFG, SPELLS, SPELL_ORDER, getArenaLandSize, getArenaWorld, isOnArenaWorld } from "./config.js";
import { MapQuery } from "./arena-query.js";
import { generateMap } from "./mapgen.js";
import { Player, resolveKillCredit } from "./player.js";
import { Bolt } from "./bolt.js";
import { castSpell } from "./spells.js";
import { BotBrain, BOT_PROFILES, closestApproach as _closestApproach } from "./bot.js";
import { makePrng } from "./rng.js";

// Re-wrap so the local call sites keep their original shape (returns .x/.z midpoint too).
function closestApproach(a0x, a0z, a1x, a1z, b0x, b0z, b1x, b1z) {
  const r = _closestApproach(a0x, a0z, a1x, a1z, b0x, b0z, b1x, b1z);
  // Compute midpoint at closest-approach time for the clash-event position.
  const vv0 = (a1x - a0x), vv1 = (a1z - a0z);
  const t = r.t ?? 0;
  const ax = a0x + vv0 * t, az = a0z + vv1 * t;
  const bx = b0x + (b1x - b0x) * t, bz = b0z + (b1z - b0z) * t;
  return { dist: r.dist, x: (ax + bx) * 0.5, z: (az + bz) * 0.5 };
}

// A lightweight logical arena (no rendering) used by the sim.
// Holds a MapQuery so player.step() can call groundHeightAt/blocksMovement.
class LogicArena {
  constructor(world, landSize) {
    this.world = world;
    this.landSize = landSize;
    this.radius = landSize.radius;
    this._query = new MapQuery(null);
  }
  isOnPlatform(x, z) { return isOnArenaWorld(this.world.id, this.radius, x, z); }
  // Keep the query layer's active radius in sync with the (shrinking) arena so
  // off-platform plateaus/obstacles stop blocking movement and rays.
  _sync()                          { this._query.setActiveRadius(this.radius); }
  groundHeightAt(x, z)             { this._sync(); return this._query.groundHeightAt(x, z); }
  blocksMovement(x, z, fromY)      { this._sync(); return this._query.blocksMovement(x, z, fromY); }
  obstaclesBlockingRay(x0,z0,y0,x1,z1,y1) { this._sync(); return this._query.obstaclesBlockingRay(x0,z0,y0,x1,z1,y1); }
  onRamp(x, z)                     { this._sync(); return this._query.onRamp(x, z); }
  setLayout(layout)                { this._query.setLayout(layout); }
  reset() {
    this.radius = this.landSize.radius;
    this._query.setLayout(null); // clear layout; caller sets it again at round start
  }
}

export const PHASE = {
  LOBBY: "lobby",
  COUNTDOWN: "countdown",
  PLAYING: "playing",
  ROUND_END: "roundEnd",
  MATCH_END: "matchEnd",
};

const BOT_PREFIX = "bot:";

function normalizeBotSkill(skill) {
  return CFG.BOT_SKILLS.includes(skill) ? skill : "smart";
}

function botDisplayName(skill, index) {
  return `${skill[0].toUpperCase()}${skill.slice(1)} Bot ${index + 1}`;
}

export class Simulation {
  constructor(options = {}) {
    // Injectable RNG: pass options.seed (number) for a deterministic PRNG;
    // omit it (or pass undefined/null) to keep the default random behaviour.
    this._rng = typeof options.seed === "number" ? makePrng(options.seed) : Math.random;
    this.allAbilitiesAtStart = options.allAbilitiesAtStart !== false;
    this.world = getArenaWorld(options.arenaWorld);
    this.landSize = getArenaLandSize(options.landSize);
    // Sanitize enabledObstacles: only keep recognised type ids; map explicit false
    // to false, everything else (true / absent) to true so the default is all-on.
    const rawToggles = options.enabledObstacles || {};
    this.enabledObstacles = {};
    for (const { id } of CFG.OBSTACLE_TYPES) {
      this.enabledObstacles[id] = rawToggles[id] !== false;
    }
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
    // Procedural map layout generated at each round start and broadcast to clients.
    this.mapLayout = null;
    this.mapVersion = 0;     // increments each round so clients detect new layouts
    this._lastSentMapV = -1; // last mapVersion included in a snapshot (for bandwidth gate)
    this._matchSeed = 0;     // re-randomised in startMatch(); base for per-round seeds
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
    const profile = BOT_PROFILES[botSkill] || BOT_PROFILES.smart;
    const bots = [];
    for (let i = 0; i < wanted; i++) {
      const botId = `${BOT_PREFIX}${i + 1}`;
      const bot = this.addPlayer(botId, botDisplayName(botSkill, i), { isBot: true, botSkill });
      bot._brain = new BotBrain(botId, botSkill);
      bot.applyItems(profile.loadout);
      bots.push(bot);
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
    for (const p of this.players.values()) {
      p.score = 0;
      p.kills = 0;
      p.deaths = 0;
      p.lastAttackerId = null;
      p.lastAttackerAt = 0;
    }
    this.matchWinnerId = null;
    this.round = 0;
    // New random base seed for the whole match; each round mixes it with the
    // round number so every round gets a distinct but reproducible layout.
    this._matchSeed = Math.floor(this._rng() * 0xffffffff);
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
    this.arena.reset(); // clears radius and layout
    this.playTime = 0;
    this.phase = PHASE.COUNTDOWN;
    this.phaseTimer = CFG.ROUND.COUNTDOWN;

    // Generate a deterministic procedural layout for this round.
    // Seed mixes the per-match base seed with the round number so each round
    // has a distinct layout but is 100% reproducible from the same match seed.
    const mapSeed = (this._matchSeed ^ (this.round * 0x9e3779b9)) >>> 0;
    this.mapLayout = generateMap(this.world.id, this.landSize.radius, mapSeed, this.enabledObstacles);
    this.mapVersion++;
    this.arena.setLayout(this.mapLayout);

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
    const angle = this._rng() * Math.PI * 2;
    const ring = Math.min(CFG.RUNE_SPAWN_RADIUS, this.arena.radius * 0.72) * (0.5 + 0.4 * this._rng());
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
      const j = Math.floor(this._rng() * (i + 1));
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
    this.mapLayout = null;
    this.arena.reset();
    for (const p of this.players.values()) {
      p.alive = true;
      p.spectating = false;
      p.falling = false;
      p.vx = p.vz = p.vy = 0;
      p.charge = 0;
      p._hazardTime = 0;
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
    // Pass groundY so the auto-attack spawns at the shooter's elevation and
    // honors terrain/obstacle cover (coverEnabled), same as cast projectiles.
    this.bolts.push(new Bolt(owner.id, ox, oz, owner.aim, owner.color, { groundY: owner.groundY }));
    this.events.push({ type: "cast", spell: "fireball", id: owner.id, x: owner.x, z: owner.z });
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

    // Step players, draining any feedback events they produced (e.g. the
    // gravity implosion burst, which fires from within the status tick).
    for (const p of this.players.values()) {
      p.step(dt, this.arena);
      if (p._events.length) { for (const ev of p._events) this.events.push(ev); }
    }

    // Resolve Time Shift rewinds.
    for (const p of this.players.values()) {
      if (p.timeshift) {
        p.timeshift.t -= dt;
        if (p.timeshift.t <= 0) {
          if (p.alive) {
            p.x = p.timeshift.x; p.z = p.timeshift.z;
            p.charge = p.timeshift.charge;
            p.vx = p.vz = 0; p.falling = false; p.vy = 0; p._hazardTime = 0;
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
      const mres = b.step(dt, playerArr, this.arena, { movementOnly: true });
      // Projectile dispersed against terrain/obstacle cover → impact VFX.
      if (mres && mres.blocked) {
        this.events.push({ type: "boltFizzle", x: +b.x.toFixed(2), z: +b.z.toFixed(2), y: +b.y.toFixed(2), c: b.color, by: b.ownerId });
      }
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
      // During the final ~0.3s before detonation, gently drag players inward
      // as a visual telegraph and to make dodging a skill check.
      if (m.t > 0 && m.t <= 0.3) {
        const dragStrength = 6; // units/s inward nudge
        // Mirror the detonation fallback so a meteor without effRadius (e.g.
        // deserialised/replicated state) still applies the drag consistently.
        const dragR = m.effRadius ?? m.radius;
        for (const p of this.players.values()) {
          if (!p.alive || p.falling || p.spectating) continue;
          const dx = m.x - p.x, dz = m.z - p.z;
          const dist = Math.hypot(dx, dz);
          if (dist > 0.001 && dist <= dragR) {
            p.vx += (dx / dist) * dragStrength * dt;
            p.vz += (dz / dist) * dragStrength * dt;
          }
        }
      }
      if (m.t <= 0) {
        // Use effRadius for AoE so the charged-up blast matches the telegraph.
        const blastR = m.effRadius ?? m.radius;
        for (const p of this.players.values()) {
          if (!p.alive || p.falling || p.spectating) continue;
          const dx = p.x - m.x, dz = p.z - m.z;
          const d = Math.hypot(dx, dz);
          if (d <= blastR) {
            const falloff = 1 - d / blastR;
            // Players caught dead-centre are flung in their current facing
            // (or a default) so the impact always imparts knockback.
            let ndx = dx, ndz = dz;
            if (d < 0.001) { ndx = Math.cos(p.aim); ndz = Math.sin(p.aim); }
            const l = Math.hypot(ndx, ndz) || 1;
            // Raised knockback floor (0.55 instead of 0.4) so edge-caught
            // players still get flung meaningfully.
            const meteorHit = p.applyHit((ndx / l), (ndz / l), m.kb * (0.55 + 0.45 * falloff));
            // Record the attacker for kill-credit attribution (meteors do not
            // emit per-victim hit events, so we record here directly).
            if (meteorHit && m.ownerId && m.ownerId !== p.id) {
              p.recordAttacker(m.ownerId, Date.now());
            }
          }
        }
        this.events.push({ type: "meteorImpact", x: m.x, z: m.z, radius: blastR, by: m.ownerId });
        m.dead = true;
      }
    }
    this.meteors = this.meteors.filter((m) => !m.dead);

    this.stepRunes(dt);
    this.resolveRuneDestruction();
    this.resolveRunePickups();

    // Record the latest attacker for each victim from all hit events emitted this
    // frame — covers bolt hits, lightning, thrust, gravity implosion, and any
    // other spell that emits {type:"hit", victim, by}.  Meteor hits are recorded
    // directly in the meteor processing loop above (no per-victim hit event there).
    const _hitNow = Date.now();
    for (const ev of this.events) {
      if (ev.type === "hit" && ev.by && ev.victim && ev.by !== ev.victim) {
        const victim = this.players.get(ev.victim);
        if (victim) victim.recordAttacker(ev.by, _hitNow);
      }
    }

    // Death detection (falling players that reached lava become !alive in step()).
    for (const p of this.players.values()) {
      if (!p.alive && p._countedDeath !== this.round) {
        p._countedDeath = this.round;
        p.deaths++;
        // Credit the kill to the last attacker if within the attribution window.
        const killerId = resolveKillCredit(p.lastAttackerId, p.lastAttackerAt, Date.now(), CFG.KILL_CREDIT_WINDOW);
        if (killerId) {
          const killer = this.players.get(killerId);
          if (killer) killer.kills++;
        }
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
    for (const bot of this.alivePlayers().filter((p) => p.isBot)) {
      if (bot._brain) {
        bot.input = bot._brain.think(this, bot);
        // Ability casts from think() arrive as bot.input.casts; move them to
        // pendingCasts so the sim's spell-resolution loop picks them up.
        if (bot.input.casts?.length) {
          for (const c of bot.input.casts) bot.pendingCasts.push(c);
        }
      }
    }
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
  // mapLayout is included only when it changed since the last broadcast snapshot
  // (identified by mapVersion) or when it is null (lobby / round reset) so
  // clients know to clear their map meshes.  mapV is always present so clients
  // can detect version changes even when the layout body is omitted.
  //
  // The broadcast loop calls snapshot() (trackSend defaults true) and is the
  // SOLE consumer of the bandwidth gate (`_lastSentMapV`).  Out-of-band callers
  // — e.g. the late-join welcome — MUST pass { trackSend: false } so they never
  // consume the gate; otherwise a peer joining between a round's beginRound() and
  // the next broadcast would flip the flag and the broadcast would omit the new
  // layout, leaving already-connected peers without geometry.  A non-tracking
  // snapshot always carries the full current layout (no override needed), but
  // main.js also sets `mapLayout: sim.mapLayout` explicitly for clarity.
  snapshot(opts = {}) {
    const trackSend = opts.trackSend !== false;
    const layoutChanged = this.mapVersion !== this._lastSentMapV;
    // Include layout when: (a) this is an out-of-band welcome (always send the
    // full layout), (b) version ticked (round start), OR (c) layout is null
    // (lobby/reset) so the client clears stale meshes.
    const includeLayout = !trackSend || layoutChanged || this.mapLayout === null;
    // Only the broadcast path advances the gate; welcomes leave it untouched.
    if (trackSend && includeLayout) this._lastSentMapV = this.mapVersion;

    return {
      t: Date.now(),
      phase: this.phase,
      round: this.round,
      timer: +this.phaseTimer.toFixed(2),
      playTime: +this.playTime.toFixed(2),
      arenaR: +this.arena.radius.toFixed(2),
      arenaWorld: this.world.id,
      landSize: this.landSize.id,
      enabledObstacles: this.enabledObstacles,
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
      // undefined is omitted by JSON.stringify, saving bandwidth on unchanged frames.
      mapLayout: includeLayout ? this.mapLayout : undefined,
      mapV: this.mapVersion,
    };
  }
}
