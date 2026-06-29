// A warlock. The host owns the authoritative state; clients hold a visual
// proxy that is interpolated toward host snapshots.
import { CFG, SPELLS, ITEMS } from "./config.js";

export class Player {
  constructor(id, name, colorIndex, options = {}) {
    this.id = id;
    this.name = name;
    this.colorIndex = colorIndex;
    this.color = CFG.COLORS[colorIndex % CFG.COLORS.length];
    this.isBot = !!options.isBot;
    this.botSkill = options.botSkill || null;

    // Authoritative simulation state
    this.x = 0; this.z = 0; this.y = CFG.PLATFORM_TOP;
    this.vx = 0; this.vz = 0; this.vy = 0; // vy used while falling
    this.aim = 0;            // radians, facing direction
    this.charge = 0;         // accumulated knockback vulnerability (Smash %)
    this.alive = true;
    this.spectating = false;
    this.falling = false;    // off the edge, plummeting to lava
    this.cooldown = 0;       // legacy fireball cooldown (kept for tests)
    this.score = 0;          // round wins
    this.roundKills = 0;

    // Per-spell cooldown timers (id -> seconds remaining).
    this.cooldowns = {};
    this.spells = new Set(["fireball"]);
    this.spellSlots = Array(CFG.SPELL_SLOT_COUNT).fill(null);

    // Active status effects with remaining durations.
    this.status = {
      windWalk: 0,     // invisible + faster
      rush: 0,         // faster + knockback resist
      shield: 0,       // blocks the next hit
      shieldCharges: 0,
      disabled: 0,     // silenced: cannot cast
      gravity: 0,      // pulled toward a gravity well
      gravX: 0, gravZ: 0, gravPull: 0,
      linkedTo: null,  // id of linked partner
      link: 0,
    };
    // Time Shift bookmark (position to rewind to).
    this.timeshift = null;

    // Item-derived modifiers (set by applyItems()).
    this.items = [];
    this.mods = {
      speedMul: 1, kbResist: 0, cdr: 0, lifesteal: 0,
      dmgMul: 1, takenMul: 1, fireballKbMul: 1, lavaGrace: 0,
    };

    // Latest input from this player's client (host applies it each tick)
    this.input = { move: [0, 0], aim: 0, fire: false, seq: 0, casts: [] };

    // Internal: round in which a death was already counted.
    this._countedDeath = -1;
    this._castSeen = -1;      // highest cast id consumed (dedupe)
    this.pendingCasts = [];   // cast requests awaiting resolution next step
    this._nextBotFireAt = 0;
    this._nextBotAbilityAt = 0;
    this._botCastId = 0;
  }

  // Recompute modifiers from the player's item loadout.
  applyItems(itemKeys = []) {
    this.items = itemKeys.filter((k) => ITEMS[k]);
    const m = { speedMul: 1, kbResist: 0, cdr: 0, lifesteal: 0, dmgMul: 1, takenMul: 1, fireballKbMul: 1, lavaGrace: 0 };
    for (const key of this.items) {
      const it = ITEMS[key];
      switch (it.kind) {
        case "kbResist": m.kbResist += it.value; break;
        case "speed": m.speedMul *= it.value; break;
        case "cdr": m.cdr += it.value; if (it.speed) m.speedMul *= it.speed; break;
        case "lifesteal": m.lifesteal += it.value; m.dmgMul *= it.dmg; break;
        case "glassCannon": m.dmgMul *= it.dealt; m.takenMul *= it.taken; break;
        case "lavaGrace": m.lavaGrace += it.value; break;
        case "empowerFireball": m.fireballKbMul *= it.kb; break;
      }
    }
    m.kbResist = Math.min(0.75, m.kbResist); // never fully immune
    this.mods = m;
  }

  // Cooldown for a spell after applying cooldown-reduction items.
  spellCooldown(spellId) {
    const s = SPELLS[spellId];
    if (!s) return 0;
    return s.cd * (1 - this.mods.cdr);
  }

  hasSpell(spellId) {
    return this.spells.has(spellId);
  }

  acquireSpell(spellId) {
    if (!SPELLS[spellId]) return false;
    if (this.spells.has(spellId)) return true;
    const slot = this.spellSlots.indexOf(null);
    if (slot < 0) return false;
    this.spellSlots[slot] = spellId;
    this.spells.add(spellId);
    this.cooldowns[spellId] = 0;
    return true;
  }

  removeSpell(spellId) {
    if (spellId === "fireball") return;
    this.spells.delete(spellId);
    const slot = this.spellSlots.indexOf(spellId);
    if (slot >= 0) this.spellSlots[slot] = null;
  }

  setAllSpells() {
    this.spells = new Set(Object.keys(SPELLS));
    this.spellSlots = [];
  }

  setStarterSpells() {
    this.spells = new Set(["fireball"]);
    this.spellSlots = Array(CFG.SPELL_SLOT_COUNT).fill(null);
  }

  canCast(spellId) {
    if (!this.alive || this.falling) return false;
    if (this.status.disabled > 0) return false;
    if (!this.hasSpell(spellId)) return false;
    return (this.cooldowns[spellId] || 0) <= 0;
  }

  startCooldown(spellId) {
    this.cooldowns[spellId] = this.spellCooldown(spellId);
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
    this.cooldowns = {};
    this.roundKills = 0;
    this.timeshift = null;
    this.pendingCasts = [];
    this._castSeen = -1;
    this._nextBotFireAt = 0;
    this._nextBotAbilityAt = 0;
    this._botCastId = 0;
    this.status = {
      windWalk: 0, rush: 0, shield: 0, shieldCharges: 0, disabled: 0,
      gravity: 0, gravX: 0, gravZ: 0, gravPull: 0, linkedTo: null, link: 0,
    };
    this.input = { move: [0, 0], aim: this.aim, fire: false, seq: 0, casts: [] };
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

    // Tick down status effects.
    this._tickStatus(dt);

    // Apply player movement intent (only when not heavily knocked back).
    const [mx, mz] = this.input.move;
    const mlen = Math.hypot(mx, mz);
    const knockSpeed = Math.hypot(this.vx, this.vz);

    // Movement control is reduced while being knocked back hard, but Rush and
    // Wind Walk improve mobility per the handbook.
    let speed = CFG.MOVE_SPEED * this.mods.speedMul;
    if (this.status.windWalk > 0) speed *= SPELLS.windWalk.speedMul;
    if (this.status.rush > 0) speed *= SPELLS.rush.speedMul;
    const control = knockSpeed > 2 ? 0.25 : 1.0;
    if (mlen > 0.01) {
      const nx = mx / mlen, nz = mz / mlen;
      this.x += nx * speed * control * dt;
      this.z += nz * speed * control * dt;
    }
    this.aim = this.input.aim;

    // Gravity well pulls the player toward its centre while active.
    if (this.status.gravity > 0) {
      const gx = this.status.gravX - this.x;
      const gz = this.status.gravZ - this.z;
      const gl = Math.hypot(gx, gz) || 1;
      this.x += (gx / gl) * this.status.gravPull * dt;
      this.z += (gz / gl) * this.status.gravPull * dt;
    }

    // Apply knockback velocity + friction.
    this.x += this.vx * dt;
    this.z += this.vz * dt;
    const decay = Math.exp(-CFG.FRICTION * dt);
    this.vx *= decay;
    this.vz *= decay;

    // Charge slowly decays while alive.
    this.charge = Math.max(0, this.charge - CFG.CHARGE_DECAY * dt);

    // Cooldown ticks (legacy fireball + per-spell).
    this.cooldown = Math.max(0, this.cooldown - dt);
    for (const k in this.cooldowns) {
      if (this.cooldowns[k] > 0) this.cooldowns[k] = Math.max(0, this.cooldowns[k] - dt);
    }

    // Off the edge? Begin falling — Lava Treads grants a brief grace window.
    if (!arena.isOnPlatform(this.x, this.z)) {
      if (this.mods.lavaGrace > 0 && this._lavaGrace === undefined) {
        this._lavaGrace = this.mods.lavaGrace;
      }
      if (this._lavaGrace > 0) {
        this._lavaGrace -= dt;
      } else {
        this.falling = true;
        this.vy = 1.5; // small pop as they leave the ledge
      }
    } else {
      this._lavaGrace = undefined;
    }
  }

  _tickStatus(dt) {
    const s = this.status;
    for (const k of ["windWalk", "rush", "shield", "disabled", "gravity", "link"]) {
      if (s[k] > 0) {
        s[k] = Math.max(0, s[k] - dt);
        if (k === "shield" && s[k] === 0) s.shieldCharges = 0;
        if (k === "link" && s[k] === 0) s.linkedTo = null;
      }
    }
  }

  // Apply a bolt hit: knockback scales with current charge (Smash-style),
  // then the hit increases charge so subsequent hits send them further.
  // `base` lets each spell scale its raw knockback; items/statuses modify it.
  applyHit(dirX, dirZ, base = CFG.BOLT_BASE_KNOCKBACK) {
    // Shield blocks the next incoming hit entirely.
    if (this.status.shieldCharges > 0) {
      this.status.shieldCharges--;
      if (this.status.shieldCharges <= 0) this.status.shield = 0;
      return false;
    }
    let impulse = base + this.charge * CFG.KNOCKBACK_CHARGE_SCALE;
    impulse *= this.mods.takenMul;
    // Knockback resistance from items / Rush.
    let resist = this.mods.kbResist;
    if (this.status.rush > 0) resist += SPELLS.rush.kbResist;
    impulse *= (1 - Math.min(0.85, resist));
    const len = Math.hypot(dirX, dirZ) || 1;
    this.vx += (dirX / len) * impulse;
    this.vz += (dirZ / len) * impulse;
    this.charge = Math.min(CFG.CHARGE_MAX, this.charge + CFG.BOLT_CHARGE_GAIN);
    return true;
  }

  canFire() {
    return this.alive && !this.falling && this.cooldown <= 0 && this.status.disabled <= 0;
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
      // status flags for VFX (1/0 to keep the packet small)
      ww: this.status.windWalk > 0 ? 1 : 0,
      ru: this.status.rush > 0 ? 1 : 0,
      sh: this.status.shieldCharges > 0 ? 1 : 0,
      di: this.status.disabled > 0 ? 1 : 0,
      gr: this.status.gravity > 0 ? 1 : 0,
      lk: this.status.linkedTo || null,
      // per-spell cooldowns for the local HUD bar
      cds: this._cdSnapshot(),
      spells: [...this.spells],
      spellSlots: [...this.spellSlots],
    };
  }

  _cdSnapshot() {
    const out = {};
    for (const k in this.cooldowns) {
      if (this.cooldowns[k] > 0) out[k] = +this.cooldowns[k].toFixed(2);
    }
    return out;
  }
}
