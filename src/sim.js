// Pure, authoritative game simulation. Deliberately free of Three.js so it can
// run on the host and be unit-tested headlessly in Node.
import { CFG, SPELLS, SPELL_ORDER } from "./config.js";
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

export class Simulation {
  constructor(options = {}) {
    this.allAbilitiesAtStart = options.allAbilitiesAtStart !== false;
    this.players = new Map(); // id -> Player
    this.bolts = [];
    this.meteors = [];        // in-flight meteors (delayed AoE)
    this.runes = [];
    this._meteorId = 1;
    this._runeId = 1;
    this.arena = new LogicArena();
    this.phase = PHASE.LOBBY;
    this.round = 0;
    this.phaseTimer = 0;     // counts down within a phase
    this.playTime = 0;       // seconds elapsed in current round
    this.lastWinnerId = null;
    this.matchWinnerId = null;
    this.events = [];        // transient events for the renderer/sound (e.g. hits)
  }

  addPlayer(id, name) {
    if (this.players.has(id)) return this.players.get(id);
    const idx = this.players.size;
    const p = new Player(id, name, idx);
    if (this.allAbilitiesAtStart) p.setAllSpells();
    else p.setStarterSpells();
    if (this.phase !== PHASE.LOBBY) {
      p.alive = false;
      p.spectating = true;
    }
    this.players.set(id, p);
    return p;
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
    this.runes = [];
    this.arena.reset();
    this.playTime = 0;
    this.phase = PHASE.COUNTDOWN;
    this.phaseTimer = CFG.ROUND.COUNTDOWN;

    // Spawn active players evenly around a ring; late joiners enter next round.
    const list = [...this.players.values()];
    const n = Math.max(1, list.length);
    const spawnR = Math.min(CFG.ARENA_RADIUS - 3, 12);
    list.forEach((p, i) => {
      p.spawn((i / n) * Math.PI * 2, spawnR);
      if (this.allAbilitiesAtStart) p.setAllSpells();
      else p.setStarterSpells();
    });
    if (!this.allAbilitiesAtStart) this.spawnRunes();
  }

  spawnRunes() {
    const spells = SPELL_ORDER.filter((id) => id !== "fireball");
    this.runes = spells.map((spell, i) => {
      const angle = (i / spells.length) * Math.PI * 2;
      const ring = CFG.RUNE_SPAWN_RADIUS * (0.65 + 0.35 * ((i % 3) / 2));
      return {
        id: this._runeId++,
        spell,
        x: +(Math.cos(angle) * ring).toFixed(3),
        z: +(Math.sin(angle) * ring).toFixed(3),
      };
    });
  }

  returnToLobby() {
    this.phase = PHASE.LOBBY;
    this.phaseTimer = 0;
    this.playTime = 0;
    this.lastWinnerId = null;
    this.matchWinnerId = null;
    this.bolts = [];
    this.runes = [];
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
    owner.cooldown = CFG.BOLT_COOLDOWN;
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

  resolveRunePickups() {
    if (this.allAbilitiesAtStart || !this.runes.length) return;
    const remaining = [];
    for (const rune of this.runes) {
      let picked = false;
      for (const p of this.players.values()) {
        if (!p.alive || p.falling || p.spectating || p.hasSpell(rune.spell)) continue;
        const d = Math.hypot(p.x - rune.x, p.z - rune.z);
        if (d <= CFG.RUNE_RADIUS + CFG.PLAYER_RADIUS) {
          p.acquireSpell(rune.spell);
          this.events.push({ type: "runePickup", id: p.id, spell: rune.spell, x: rune.x, z: rune.z });
          picked = true;
          break;
        }
      }
      if (!picked) remaining.push(rune);
    }
    this.runes = remaining;
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
      runes: this.runes.map((r) => ({ id: r.id, spell: r.spell, x: r.x, z: r.z, c: SPELLS[r.spell]?.color || 0xffffff })),
      events: this.events,
    };
  }
}
