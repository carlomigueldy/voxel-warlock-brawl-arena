// Bolt projectiles. Host-authoritative: only the host integrates motion and
// resolves collisions; clients render snapshots.
import { CFG } from "./config.js";

let _id = 1;

export class Bolt {
  constructor(ownerId, x, z, dir, color) {
    this.id = _id++;
    this.ownerId = ownerId;
    this.x = x;
    this.z = z;
    this.y = CFG.PLATFORM_TOP + 1.1;
    this.dir = dir; // radians
    this.vx = Math.cos(dir) * CFG.BOLT_SPEED;
    this.vz = Math.sin(dir) * CFG.BOLT_SPEED;
    this.life = CFG.BOLT_LIFETIME;
    this.color = color;
    this.dead = false;
    this.mesh = null;
  }

  step(dt, players, arena) {
    this.x += this.vx * dt;
    this.z += this.vz * dt;
    this.life -= dt;

    if (this.life <= 0 || !arena.isOnPlatform(this.x, this.z)) {
      this.dead = true;
      return null;
    }

    // Collision with players (skip owner).
    for (const p of players) {
      if (p.id === this.ownerId || !p.alive || p.falling) continue;
      const dx = p.x - this.x;
      const dz = p.z - this.z;
      const r = CFG.PLAYER_RADIUS + CFG.BOLT_RADIUS;
      if (dx * dx + dz * dz <= r * r) {
        // Knock the victim in the bolt's travel direction.
        p.applyHit(this.vx, this.vz);
        this.dead = true;
        return p.id; // report who was hit
      }
    }
    return null;
  }

  snapshot() {
    return {
      id: this.id,
      o: this.ownerId,
      x: +this.x.toFixed(2),
      z: +this.z.toFixed(2),
      c: this.color,
    };
  }
}
