// Pure, authoritative game simulation. Deliberately free of Three.js so it can
// run on the host and be unit-tested headlessly in Node.
import { CFG } from "./config.js";
import { Player } from "./player.js";
import { Bolt } from "./bolt.js";

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
  constructor() {
    this.players = new Map(); // id -> Player
    this.bolts = [];
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
    p.input = {
      move: [mx, mz],
      aim: Number.isFinite(input.aim) ? input.aim : 0,
      fire: !!input.fire,
      seq,
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

    // Fire intents -> bolts.
    for (const p of this.players.values()) {
      if (p.input.fire && p.canFire()) this.spawnBolt(p);
    }

    // Step players.
    for (const p of this.players.values()) p.step(dt, this.arena);

    // Step bolts + resolve hits.
    const playerArr = [...this.players.values()];
    for (const b of this.bolts) {
      const hitId = b.step(dt, playerArr, this.arena);
      if (hitId != null) {
        const shooter = this.players.get(b.ownerId);
        this.events.push({ type: "hit", x: b.x, z: b.z, victim: hitId, by: b.ownerId });
        if (shooter) shooter.roundKills += 0; // kills credited on death below
      }
    }
    this.bolts = this.bolts.filter((b) => !b.dead);

    // Death detection (falling players that reached lava become !alive in step()).
    for (const p of this.players.values()) {
      if (!p.alive && p._countedDeath !== this.round) {
        p._countedDeath = this.round;
        this.events.push({ type: "death", id: p.id });
      }
    }

    this.resolveRoundIfNeeded();
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
      events: this.events,
    };
  }
}
