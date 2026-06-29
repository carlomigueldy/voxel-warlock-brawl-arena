// Projectiles. Host-authoritative: only the host integrates motion and resolves
// collisions; clients render snapshots. A single class covers every projectile
// the handbook needs (fireball, boomerang, homing, bouncer, splitter, meteor
// shards, fire-spray pellets) so the renderer can treat them uniformly.
import { CFG } from "./config.js";

let _id = 1;
export function _resetBoltIds() { _id = 1; } // test helper

export class Bolt {
  // opts: { proj, kb, color, range, turn, bounces, splitDist, shards, life }
  constructor(ownerId, x, z, dir, color, opts = {}) {
    this.id = _id++;
    this.ownerId = ownerId;
    this.x = x;
    this.z = z;
    this.y = CFG.PLATFORM_TOP + 1.1;
    this.dir = dir; // radians
    this.proj = opts.proj || "fireball";
    this.speed = opts.speed || CFG.BOLT_SPEED;
    this.vx = Math.cos(dir) * this.speed;
    this.vz = Math.sin(dir) * this.speed;
    this.life = opts.life || CFG.BOLT_LIFETIME;
    this.color = color;
    this.kb = opts.kb ?? CFG.BOLT_BASE_KNOCKBACK;
    this.dead = false;

    // Per-type state.
    this.range = opts.range || 16;     // boomerang turnaround distance
    this.turn = opts.turn || 0;        // homing turn rate (rad/sec)
    this.bounces = opts.bounces || 0;  // bouncer wall bounces left
    this.splitDist = opts.splitDist || 0; // splitter: distance before it splits
    this.shards = opts.shards || 0;
    this.distance = 0;
    this.returning = false;
    this._origX = x;
    this._origZ = z;
    this._splitDone = false;
    this._spawn = [];                  // child projectiles produced this step
    this.mesh = null;
  }

  // Returns: { hit: victimId|null, split: bool } and queues children in _spawn.
  step(dt, players, arena) {
    this._spawn = [];
    const prevLife = this.life;
    this.life -= dt;

    // Homing: steer toward nearest non-owner alive target.
    if (this.proj === "homing" && this.turn > 0) {
      const tgt = this._nearestTarget(players);
      if (tgt) {
        const want = Math.atan2(tgt.z - this.z, tgt.x - this.x);
        let da = want - this.dir;
        while (da > Math.PI) da -= Math.PI * 2;
        while (da < -Math.PI) da += Math.PI * 2;
        const max = this.turn * dt;
        this.dir += Math.max(-max, Math.min(max, da));
        this.vx = Math.cos(this.dir) * this.speed;
        this.vz = Math.sin(this.dir) * this.speed;
      }
    }

    // Boomerang: fly out then curve back to the thrower.
    if (this.proj === "boomerang") {
      this.distance += this.speed * dt;
      if (!this.returning && this.distance >= this.range) this.returning = true;
      if (this.returning) {
        const owner = players.find((p) => p.id === this.ownerId);
        if (owner) {
          this.dir = Math.atan2(owner.z - this.z, owner.x - this.x);
          this.vx = Math.cos(this.dir) * this.speed;
          this.vz = Math.sin(this.dir) * this.speed;
          const dx = owner.x - this.x, dz = owner.z - this.z;
          if (dx * dx + dz * dz < 1.2 * 1.2) { this.dead = true; return { hit: null }; }
        }
      }
    }

    this.x += this.vx * dt;
    this.z += this.vz * dt;

    // Bouncer: reflect off the circular arena rim instead of dying.
    if (this.proj === "bouncer" && !arena.isOnPlatform(this.x, this.z) && this.bounces > 0) {
      const nx = this.x, nz = this.z;
      const len = Math.hypot(nx, nz) || 1;
      const ndx = nx / len, ndz = nz / len; // outward normal
      const dot = this.vx * ndx + this.vz * ndz;
      this.vx -= 2 * dot * ndx;
      this.vz -= 2 * dot * ndz;
      this.dir = Math.atan2(this.vz, this.vx);
      // Nudge back inside.
      this.x = ndx * (arena.radius - 0.5);
      this.z = ndz * (arena.radius - 0.5);
      this.bounces--;
    }

    // Splitter: after travelling its split distance, fan out into shards.
    if (this.proj === "splitter" && !this._splitDone && this.shards > 0) {
      this.distance += this.speed * dt;
      if (this.distance >= (this.splitDist || 7)) {
        this._splitDone = true;
        const spread = 0.7;
        for (let i = 0; i < this.shards; i++) {
          const a = this.dir + (i - (this.shards - 1) / 2) * (spread / this.shards) * 2;
          const child = new Bolt(this.ownerId, this.x, this.z, a, this.color, {
            proj: "fireball", kb: this.kb, life: 0.9,
          });
          this._spawn.push(child);
        }
        this.dead = true;
        return { hit: null, split: true };
      }
    }

    if (this.life <= 0) { this.dead = true; return { hit: null }; }

    // Collision with players (skip owner).
    for (const p of players) {
      if (p.id === this.ownerId || !p.alive || p.falling) continue;
      const dx = p.x - this.x;
      const dz = p.z - this.z;
      const r = CFG.PLAYER_RADIUS + CFG.BOLT_RADIUS;
      if (dx * dx + dz * dz <= r * r) {
        p.applyHit(this.vx, this.vz, this.kb);
        // Boomerang/bouncer pass through after a hit (don't die) for combo play.
        if (this.proj !== "boomerang" && this.proj !== "bouncer") this.dead = true;
        return { hit: p.id };
      }
    }
    return { hit: null };
  }

  _nearestTarget(players) {
    let best = null, bestD = Infinity;
    for (const p of players) {
      if (p.id === this.ownerId || !p.alive || p.falling) continue;
      const d = (p.x - this.x) ** 2 + (p.z - this.z) ** 2;
      if (d < bestD) { bestD = d; best = p; }
    }
    return best;
  }

  snapshot() {
    return {
      id: this.id,
      o: this.ownerId,
      x: +this.x.toFixed(2),
      z: +this.z.toFixed(2),
      y: +this.y.toFixed(2),
      c: this.color,
      k: this.proj, // kind, so renderer can pick a mesh/VFX
    };
  }
}
