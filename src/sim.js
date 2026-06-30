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
import { makeMobPrng, stepMobPhysics, spawnMob } from "./mob.js";

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
    // Mob state
    this.mobs = [];
    this.mobSpawnTimer = 0;
    this._mobId = 1;
    this._mobRand = null;
    this.mobsEnabled = options.mobsEnabled !== false;
    // Big-mob roster for the current round (shuffled order; each type spawns once).
    this._mobRoster = [];
    this._mobRosterIdx = 0;
    // Arena radius at the moment the PLAYING phase begins; used by _mobAliveCap().
    this._arenaStartR = 0;
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
    this.mobs = [];
    this.mobSpawnTimer = CFG.MOB_SPAWN_MIN; // grace window before first mob spawn
    this._mobId = 1;
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
    // Seed the per-round mob PRNG (mix matchSeed + round so every round differs).
    const mobSeed = (this._matchSeed ^ (this.round * 0x517cc1b7)) >>> 0;
    this._mobRand = makeMobPrng(mobSeed);

    // Build a shuffled big-mob roster so each type appears exactly once per round
    // in a deterministic but varied order (Fisher-Yates over the seeded PRNG).
    this._mobRoster = ["stoneGiant", "stormingVortex", "giantDwarf", "fireElemental"];
    for (let i = this._mobRoster.length - 1; i > 0; i--) {
      const j = Math.floor(this._mobRand() * (i + 1));
      const tmp = this._mobRoster[i]; this._mobRoster[i] = this._mobRoster[j]; this._mobRoster[j] = tmp;
    }
    this._mobRosterIdx = 0;
    // Fallback start radius; true value is captured at the COUNTDOWN→PLAYING transition.
    this._arenaStartR = this.arena.radius;

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
    this.mobs = [];
    this.mobSpawnTimer = 0;
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
        // Capture the true start radius now that the round is live; used by
        // _mobAliveCap() to track shrink progress for the dynamic mob cap.
        this._arenaStartR = this.arena.radius;
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
    this.resolveMobHits(); // bolt hits mob OR player, not both
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

    if (this.mobsEnabled) this.stepMobs(dt);

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

  // ── Mob system ──────────────────────────────────────────────────────────────

  // How many big mobs may be alive simultaneously given the current shrink
  // progress.  Increases in steps from 1 up to MOB_MAX_ALIVE as the arena
  // contracts, so late-round fights become progressively more chaotic.
  _mobAliveCap() {
    const span = Math.max(0.001, this._arenaStartR - CFG.ARENA_MIN_RADIUS);
    const s = Math.min(1, Math.max(0, (this._arenaStartR - this.arena.radius) / span));
    let cap = 1;
    for (const step of CFG.MOB_SHRINK_CAP_STEPS) if (s >= step.at) cap = step.cap;
    return Math.min(cap, CFG.MOB_MAX_ALIVE);
  }

  // Pick a random on-platform position away from all players.
  _mobSpawnPos() {
    for (let attempt = 0; attempt < 20; attempt++) {
      const angle = this._mobRand() * Math.PI * 2;
      const ring = (0.5 + this._mobRand() * 0.45) * Math.min(this.arena.radius * 0.8, CFG.RUNE_SPAWN_RADIUS);
      const x = Math.cos(angle) * ring;
      const z = Math.sin(angle) * ring;
      if (!this.arena.isOnPlatform(x, z)) continue;
      // Keep away from players (at least 5 units).
      const tooClose = this.alivePlayers().some(p => Math.hypot(p.x - x, p.z - z) < 5);
      if (tooClose) continue;
      return { x, z };
    }
    return null; // couldn't place this tick — skip
  }

  stepMobs(dt) {
    if (this.phase !== PHASE.PLAYING) return;

    // ── Spawn ────────────────────────────────────────────────────────────────
    this.mobSpawnTimer -= dt;
    const bigAlive = this.mobs.filter(m => m.alive && m.type !== "minion").length;
    // Big mobs: roster-driven, one alive at a time (scaled by shrink cap).
    // Each type from the shuffled roster spawns at most once per round.
    // When the roster is exhausted no further big mobs spawn this round.
    if (
      this.mobSpawnTimer <= 0 &&
      bigAlive < this._mobAliveCap() &&
      this._mobRosterIdx < this._mobRoster.length &&
      this.alivePlayers().length
    ) {
      const pos = this._mobSpawnPos();
      if (pos) {
        const type = this._mobRoster[this._mobRosterIdx++];
        const id = "mob:" + this._mobId++;
        const mob = spawnMob(id, type, pos.x, pos.z);
        // Health scaling: base * (MIN_FACTOR + PER_PLAYER * max(0, players - 2)).
        const n = this.alivePlayers().length;
        const factor = CFG.MOB_HP_MIN_FACTOR + CFG.MOB_HP_PER_PLAYER * Math.max(0, n - 2);
        mob.maxHits = mob.hitsRemaining = Math.max(1, Math.round(CFG.MOB_TYPES[type].maxHits * factor));
        mob.entering = CFG.MOB_ENTRANCE; // already set by constructor; made explicit here
        this.mobs.push(mob);
        this.events.push({
          type: "mobIncoming",
          id: mob.id,
          mobType: type,
          x: pos.x,
          z: pos.z,
          color: CFG.MOB_TYPES[type].color,
          entrance: CFG.MOB_TYPES[type].entrance.kind,
          duration: CFG.MOB_ENTRANCE,
        });
      }
      this.mobSpawnTimer = CFG.MOB_SPAWN_MIN + this._mobRand() * (CFG.MOB_SPAWN_MAX - CFG.MOB_SPAWN_MIN);
    }

    // ── AI + physics ─────────────────────────────────────────────────────────
    const playerArr = [...this.players.values()];
    for (const mob of this.mobs) {
      if (!mob.alive) continue;

      // Capture pre-think entering value so we can detect when the cinematic
      // window transitions to zero (think() decrements mob.entering).
      const wasEntering = mob.entering;
      const action = mob._brain.think(mob, playerArr, dt);
      stepMobPhysics(mob, dt, this.arena);

      // Ring-out: fell to lava.
      if (mob.falling && mob.y <= CFG.LAVA_Y) {
        this.killMob(mob, "lava");
        continue;
      }

      // Entrance completion: first tick where the cinematic window closes.
      // Emit mobArrive, then apply AoE knockback for entrance kinds that have it.
      if (wasEntering > 0 && mob.entering <= 0) {
        const ec = CFG.MOB_TYPES[mob.type].entrance;
        this.events.push({ type: "mobArrive", id: mob.id, mobType: mob.type, x: mob.x, z: mob.z, radius: ec.radius || 0 });
        if (ec.kb) {
          for (const p of this.players.values()) {
            if (!p.alive || p.falling || p.spectating) continue;
            const d = Math.hypot(p.x - mob.x, p.z - mob.z);
            if (d <= ec.radius) {
              const ndx = d < 0.001 ? Math.cos(mob.aim) : (p.x - mob.x) / d;
              const ndz = d < 0.001 ? Math.sin(mob.aim) : (p.z - mob.z) / d;
              p.applyHit(ndx, ndz, ec.kb);
              this.events.push({ type: "hit", x: p.x, z: p.z, victim: p.id, by: mob.id });
            }
          }
        }
      }

      // Apply action effects.
      if (action.kind === "melee" && action.target) {
        const victim = action.target;
        if (victim.alive && !victim.falling) {
          const dx = victim.x - mob.x, dz = victim.z - mob.z;
          victim.applyHit(dx, dz, CFG.MOB_TYPES[mob.type].meleeKb);
          this.events.push({ type: "hit", x: victim.x, z: victim.z, victim: victim.id, by: mob.id });
        }
      } else if (action.kind === "ranged" && action.target) {
        const typeCfg = CFG.MOB_TYPES[mob.type];
        const ox = mob.x + Math.cos(mob.aim) * (typeCfg.bodyR + 0.6);
        const oz = mob.z + Math.sin(mob.aim) * (typeCfg.bodyR + 0.6);
        const bolt = new Bolt(mob.id, ox, oz, mob.aim, typeCfg.color, { kb: typeCfg.rangedKb });
        this.bolts.push(bolt);
      } else if (action.kind === "ability" && action.target) {
        this._fireMobAbility(mob, action.target);
      } else if (action.kind === "spawnMinion") {
        const totalMinions = this.mobs.filter(m => m.alive && m.parentId === mob.id).length;
        if (totalMinions < CFG.MOB_MAX_CHILDREN) {
          const minionId = "mob:" + this._mobId++;
          const minion = spawnMob(minionId, "minion", action.x, action.z, mob.id);
          // Ensure minion is on platform; if not, just don't spawn.
          if (this.arena.isOnPlatform(action.x, action.z)) {
            mob.childCount++;
            this.mobs.push(minion);
            this.events.push({ type: "mobSpawn", id: minion.id, mobType: "minion", x: action.x, z: action.z, parentId: mob.id, color: CFG.MOB_TYPES.minion.color });
          }
        }
      }
    }

    // Remove dead mobs.
    this.mobs = this.mobs.filter(m => m.alive);
  }

  _fireMobAbility(mob, target) {
    const typeCfg = CFG.MOB_TYPES[mob.type];
    const ability = typeCfg.ability;
    if (!ability) return;

    this.events.push({ type: "mobAbility", mobType: mob.type, ability, x: mob.x, z: mob.z, radius: typeCfg.abilityRadius, color: typeCfg.color });

    if (ability === "groundSlam" || ability === "stomp") {
      // Meteor-style AoE: immediate detonation (1 s telegraph via existing meteor pipeline).
      this.meteors.push({
        id: this._meteorId++,
        ownerId: mob.id,
        x: mob.x, z: mob.z,
        t: 1.0, fall: 1.0,
        radius: typeCfg.abilityRadius,
        effRadius: typeCfg.abilityRadius,
        kb: typeCfg.abilityKb,
      });
    } else if (ability === "cyclone") {
      // Gravity-well pull then outward fling — applied instantly.
      const r = typeCfg.abilityRadius;
      const kb = typeCfg.abilityKb;
      for (const p of this.players.values()) {
        if (!p.alive || p.falling || p.spectating) continue;
        const d = Math.hypot(p.x - mob.x, p.z - mob.z);
        if (d <= r) {
          // Pull in for 0.4 s (status), then schedule outward burst via velocity.
          p.status.gravity = 0.4;
          p.status.gravX = mob.x; p.status.gravZ = mob.z;
          p.status.gravPull = 25; p.status.gravBy = mob.id;
          // Also apply the outward fling now (mirrors gravity's gravKb).
          const ndx = d < 0.001 ? Math.cos(mob.aim) : (p.x - mob.x) / d;
          const ndz = d < 0.001 ? Math.sin(mob.aim) : (p.z - mob.z) / d;
          p.applyHit(ndx, ndz, kb);
          this.events.push({ type: "hit", x: p.x, z: p.z, victim: p.id, by: mob.id });
        }
      }
    } else if (ability === "eruption") {
      // Fan of 8 bolts + central blast.
      const r = typeCfg.abilityRadius;
      const kb = typeCfg.abilityKb;
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        const ox = mob.x + Math.cos(a) * 1.2;
        const oz = mob.z + Math.sin(a) * 1.2;
        this.bolts.push(new Bolt(mob.id, ox, oz, a, CFG.MOB_TYPES.fireElemental.color, { kb: kb * 0.5 }));
      }
      // Central burst.
      for (const p of this.players.values()) {
        if (!p.alive || p.falling || p.spectating) continue;
        const d = Math.hypot(p.x - mob.x, p.z - mob.z);
        if (d <= r) {
          const ndx = d < 0.001 ? 1 : (p.x - mob.x) / d;
          const ndz = d < 0.001 ? 0 : (p.z - mob.z) / d;
          p.applyHit(ndx, ndz, kb);
          this.events.push({ type: "hit", x: p.x, z: p.z, victim: p.id, by: mob.id });
        }
      }
    }
  }

  // Bolt hits a mob OR a player — not both. Inserted BETWEEN resolveProjectileClashes
  // and the player-hit bolt loop so mob bolts cannot farm players AND player bolts
  // cannot double-dip a mob and a player on the same tick.
  resolveMobHits() {
    if (!this.mobs.length || !this.bolts.length) return;
    for (const b of this.bolts) {
      if (b.dead) continue;
      // Mob-owned bolts never damage other mobs.
      if (b.ownerId && b.ownerId.startsWith("mob:")) continue;
      for (const mob of this.mobs) {
        if (!mob.alive) continue;
        // Honour the post-spawn invulnerability window — mob moves but cannot
        // be damaged until spawnInvuln expires (mirrors plan §2 spec).
        // Also guard the cinematic entrance window: mob cannot be hit while entering.
        if (mob.spawnInvuln > 0 || mob.entering > 0) continue;
        const d = Math.hypot(b.x - mob.x, b.z - mob.z);
        if (d <= CFG.BOLT_RADIUS + CFG.MOB_TYPES[mob.type].bodyR) {
          // Shove the mob slightly toward lava (boltToKb).
          const boltToKb = CFG.MOB_TYPES[mob.type].boltToKb;
          if (boltToKb > 0) {
            const l = d < 0.001 ? 1 : d;
            mob.vx += ((mob.x - b.x) / l) * boltToKb;
            mob.vz += ((mob.z - b.z) / l) * boltToKb;
          }
          mob.hitsRemaining--;
          b.dead = true;
          this.events.push({ type: "mobHit", id: mob.id, hp: mob.hitsRemaining, max: mob.maxHits, x: mob.x, z: mob.z });
          if (mob.hitsRemaining <= 0) this.killMob(mob, "hits");
          break; // bolt consumed — stop checking mobs
        }
      }
    }
  }

  killMob(mob, cause) {
    mob.alive = false;
    // Decrement parent's child count if this was a minion.
    if (mob.parentId) {
      const parent = this.mobs.find(m => m.id === mob.parentId);
      if (parent) parent.childCount = Math.max(0, parent.childCount - 1);
    }
    // Only big mobs drop runes — minions are 3-hit helpers and grant no reward
    // on their own; the parent big mob is the rewarded target.
    if (mob.type !== "minion") this.dropRune(mob.x, mob.z);
    this.events.push({ type: "mobDeath", id: mob.id, mobType: mob.type, cause, x: mob.x, z: mob.z, color: CFG.MOB_TYPES[mob.type].color });
  }

  // Drop a rune with a random spell from SPELL_ORDER (minus fireball), picked
  // via the seeded _mobRand so drops are deterministic and testable.
  dropRune(x, z) {
    const eligible = SPELL_ORDER.filter(id => id !== "fireball");
    const spell = eligible[Math.floor(this._mobRand() * eligible.length)];
    const rune = {
      id: this._runeId++,
      spell,
      x: +x.toFixed(3),
      z: +z.toFixed(3),
      _fromMob: true,  // marker so tests can identify mob drops
    };
    this.runes.push(rune);
    return rune;
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
        // Mob bolts and player bolts never cancel each other — mob bolts are
        // resolved separately in resolveMobHits() and must reach their targets.
        const aMob = typeof a.ownerId === "string" && a.ownerId.startsWith("mob:");
        const bMob = typeof b.ownerId === "string" && b.ownerId.startsWith("mob:");
        if (aMob !== bMob) continue;
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
    if (!this.runes.length || !this.bolts.length) return;
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
    if (!this.runes.length) return;
    const remaining = [];
    for (const rune of this.runes) {
      let picked = false;
      for (const p of this.players.values()) {
        if (!p.alive || p.falling || p.spectating) continue;
        const d = Math.hypot(p.x - rune.x, p.z - rune.z);
        if (d <= CFG.RUNE_RADIUS + CFG.PLAYER_RADIUS) {
          if (!this.allAbilitiesAtStart) {
            // Rune-only mode: grant the randomized spell (existing path).
            if (p.hasSpell(rune.spell)) continue;
            if (!p.acquireSpell(rune.spell)) continue;
            this.events.push({ type: "runePickup", id: p.id, spell: rune.spell, x: rune.x, z: rune.z });
          } else {
            // All-abilities mode: pocketWatch-style cooldown reset + brief Rush buff.
            p.cooldowns = {};
            p.status.rush = SPELLS.rush.duration;
            this.events.push({ type: "runePickup", id: p.id, spell: rune.spell, x: rune.x, z: rune.z, buff: true });
          }
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
      mobs: this.mobs.filter(m => m.alive).map(m => m.snapshot()),
      spellSlotsEnabled: !this.allAbilitiesAtStart,
      events: this.events,
      // undefined is omitted by JSON.stringify, saving bandwidth on unchanged frames.
      mapLayout: includeLayout ? this.mapLayout : undefined,
      mapV: this.mapVersion,
    };
  }
}
