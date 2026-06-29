// A warlock. The host owns the authoritative state; clients hold a visual
// proxy that is interpolated toward host snapshots.
import { CFG } from "./config.js";

export class Player {
  constructor(id, name, colorIndex) {
    this.id = id;
    this.name = name;
    this.colorIndex = colorIndex;
    this.color = CFG.COLORS[colorIndex % CFG.COLORS.length];

    // Authoritative simulation state
    this.x = 0; this.z = 0; this.y = CFG.PLATFORM_TOP;
    this.vx = 0; this.vz = 0; this.vy = 0; // vy used while falling
    this.aim = 0;            // radians, facing direction
    this.charge = 0;         // accumulated knockback vulnerability (Smash %)
    this.alive = true;
    this.spectating = false;
    this.falling = false;    // off the edge, plummeting to lava
    this.cooldown = 0;
    this.score = 0;          // round wins
    this.roundKills = 0;

    // Latest input from this player's client (host applies it each tick)
    this.input = { move: [0, 0], aim: 0, fire: false, seq: 0 };

    // Internal: round in which a death was already counted.
    this._countedDeath = -1;
  }

  spawn(angle, radius) {
    this.x = Math.cos(angle) * radius;
    this.z = Math.sin(angle) * radius;
    this.y = CFG.PLATFORM_TOP;
    this.vx = this.vz = this.vy = 0;
    this.aim = Math.atan2(-this.z, -this.x); // face center
    this.charge = 0;
    this.alive = true;
    this.spectating = false;
    this.falling = false;
    this.cooldown = 0;
    this.roundKills = 0;
    this.input = { move: [0, 0], aim: this.aim, fire: false, seq: 0 };
  }

  // --- AUTHORITATIVE physics step (host only) ---
  step(dt, arena) {
    if (!this.alive) return;

    if (this.falling) {
      // Plummeting into the lava.
      this.vy -= CFG.GRAVITY * dt;
      this.y += this.vy * dt;
      this.x += this.vx * dt;
      this.z += this.vz * dt;
      if (this.y <= CFG.LAVA_Y) {
        this.alive = false; // burned
      }
      return;
    }

    // Apply player movement intent (only when not heavily knocked back).
    const [mx, mz] = this.input.move;
    const mlen = Math.hypot(mx, mz);
    const knockSpeed = Math.hypot(this.vx, this.vz);

    // Movement control is reduced while being knocked back hard.
    const control = knockSpeed > 2 ? 0.25 : 1.0;
    if (mlen > 0.01) {
      const nx = mx / mlen, nz = mz / mlen;
      this.x += nx * CFG.MOVE_SPEED * control * dt;
      this.z += nz * CFG.MOVE_SPEED * control * dt;
    }
    this.aim = this.input.aim;

    // Apply knockback velocity + friction.
    this.x += this.vx * dt;
    this.z += this.vz * dt;
    const decay = Math.exp(-CFG.FRICTION * dt);
    this.vx *= decay;
    this.vz *= decay;

    // Charge slowly decays while alive.
    this.charge = Math.max(0, this.charge - CFG.CHARGE_DECAY * dt);

    // Cooldown tick.
    this.cooldown = Math.max(0, this.cooldown - dt);

    // Off the edge? Begin falling.
    if (!arena.isOnPlatform(this.x, this.z)) {
      this.falling = true;
      this.vy = 1.5; // small pop as they leave the ledge
    }
  }

  // Apply a bolt hit: knockback scales with current charge (Smash-style),
  // then the hit increases charge so subsequent hits send them further.
  applyHit(dirX, dirZ) {
    const impulse =
      CFG.BOLT_BASE_KNOCKBACK + this.charge * CFG.KNOCKBACK_CHARGE_SCALE;
    const len = Math.hypot(dirX, dirZ) || 1;
    this.vx += (dirX / len) * impulse;
    this.vz += (dirZ / len) * impulse;
    this.charge = Math.min(CFG.CHARGE_MAX, this.charge + CFG.BOLT_CHARGE_GAIN);
  }

  canFire() {
    return this.alive && !this.falling && this.cooldown <= 0;
  }

  // Serialize the bits clients need to render.
  snapshot() {
    return {
      id: this.id,
      x: +this.x.toFixed(3),
      z: +this.z.toFixed(3),
      y: +this.y.toFixed(3),
      a: +this.aim.toFixed(3),
      c: +this.charge.toFixed(2),
      al: this.alive,
      sp: this.spectating,
      f: this.falling,
      s: this.score,
    };
  }
}
