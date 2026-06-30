// A warlock. The host owns the authoritative state; clients hold a visual
// proxy that is interpolated toward host snapshots.
import { CFG, SPELLS, SPELL_TEMPLATES, ITEMS } from "./config.js";

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
    this.vx = 0; this.vz = 0; this.vy = 0; // vy used while falling/airborne
    this.groundY = CFG.PLATFORM_TOP; // surface height under player (for projectile spawn height)
    this.peakY   = CFG.PLATFORM_TOP; // highest Y reached since last grounding (for fall-stun)
    this.aim = 0;            // radians, facing direction
    this.charge = 0;         // accumulated knockback vulnerability (Smash %)
    this.maxHp = CFG.PLAYER_HP_MAX;
    this.hp = this.maxHp;
    this.alive = true;
    this.spectating = false;
    this.falling = false;    // off the edge, plummeting to lava
    this.score = 0;          // round wins
    this.roundKills = 0;

    // Match-level kill/death tracking.
    this.kills = 0;
    this.deaths = 0;
    // Last attacker id and timestamp (ms) for kill-credit attribution.
    this.lastAttackerId = null;
    this.lastAttackerAt = 0;

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
      gravX: 0, gravZ: 0, gravPull: 0, gravBy: null,
      linkedTo: null,  // id of linked partner
      link: 0,
      stunned: 0,      // fall-stun: blocks move/fire/cast for FALL_STUN_DURATION s
      slow: 0, slowMul: 1,           // movement speed multiplier while slowed
      burn: 0, burnDps: 0, burnBy: null, burnTickAcc: 0, // damage-over-time
      curse: 0, curseMul: 1,         // incoming damage/knockback amplifier
      invisible: 0,    // step-3: Shadow Veil duration
      haste: 0, hasteMul: 1,         // step-3: Haste speed boost
    };
    // Feedback events produced during a physics step (e.g. the gravity
    // implosion burst), drained into the sim event queue after each step.
    this._events = [];
    // Time Shift bookmark (position to rewind to).
    this.timeshift = null;

    // Item-derived modifiers (set by applyItems()).
    this.items = [];
    this.mods = {
      speedMul: 1, kbResist: 0, cdr: 0, lifesteal: 0,
      dmgMul: 1, takenMul: 1, fireballKbMul: 1, lavaGrace: 0,
      aoeMul: 1, regen: 0, maxHpBonus: 0,
    };

    // Latest input from this player's client (host applies it each tick)
    this.input = { move: [0, 0], aim: 0, seq: 0, casts: [] };

    // Step-3: active wind-up / channel state (null = idle).
    this.activeCast = null;

    // Internal: round in which a death was already counted.
    this._countedDeath = -1;
    this._castSeen = -1;      // highest cast id consumed (dedupe)
    this.pendingCasts = [];   // cast requests awaiting resolution next step
    this._nextBotFireAt = 0;
    this._nextBotAbilityAt = 0;
    this._botCastId = 0;
    this._hazardTime = 0;

    // Step 6 — spell draft state (committed to _draftLoadout before beginRound).
    this.draftPick = [];      // ordered spell ids chosen during the draft (≤6, no fireball)
    this.draftReady = false;
    this._draftLoadout = null;
  }

  // Recompute modifiers from the player's item loadout.
  applyItems(itemKeys = []) {
    this.items = itemKeys.filter((k) => ITEMS[k]);
    const m = {
      speedMul: 1, kbResist: 0, cdr: 0, lifesteal: 0,
      dmgMul: 1, takenMul: 1, fireballKbMul: 1, lavaGrace: 0,
      aoeMul: 1, regen: 0, maxHpBonus: 0,
    };
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
        // Step 4 item stat kinds:
        case "maxHp":  m.maxHpBonus += it.value; break;
        case "damage": m.dmgMul     *= it.value; break;
        case "aoe":    m.aoeMul     *= it.value; break;
        case "regen":  m.regen      += it.value; break;
        case "active": /* no stat mod; spell granted in acquireItem() */ break;
      }
    }
    m.kbResist = Math.min(0.75, m.kbResist); // never fully immune
    // Hook for items that raise max HP; clamp current hp.
    this.maxHp = CFG.PLAYER_HP_MAX + (m.maxHpBonus || 0);
    if (this.hp > this.maxHp) this.hp = this.maxHp;
    this.mods = m;
  }

  // Equip a looted item into the first free item slot (cap = ITEM_SLOT_COUNT).
  acquireItem(itemKey) {
    const it = ITEMS[itemKey];
    if (!it) return false;
    // Dedup active items before the slot-cap check: a second copy of an
    // already-owned active item would waste a slot while granting nothing new
    // (the spells.has guard below skips re-granting the spell). Reject it here
    // so the field item is left for another player to pick up.
    if (it.kind === "active" && this.items.includes(itemKey)) return false;
    if (this.items.length >= CFG.ITEM_SLOT_COUNT) return false;   // 4-slot cap
    // Stat items cannot stack — owning the same passive twice is an exploit.
    // Active items keep their existing dup guard (spells.has check below).
    if (it.kind !== "active" && this.items.includes(itemKey)) return false;
    this.applyItems([...this.items, itemKey]);                    // recompute mods
    if (it.kind === "active" && it.grantsSpell && !this.spells.has(it.grantsSpell)) {
      this.spells.add(it.grantsSpell);          // makes canCast() pass
      this.cooldowns[it.grantsSpell] = 0;        // ready immediately
    }
    return true;
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

  // acquireSpell: reserved / superseded by item system (Step 4) — kept for Step-7 tests (spells.test.mjs:344-349, sim.test.mjs:841).
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

  // Assign a full slot loadout (pre-draft default now; Step 6 draft later).
  // Caps at SPELL_SLOT_COUNT, dedupes, and always retains fireball.
  //
  // STEP 6 SEAM NOTE: if fireball is absent from the input list it is prepended,
  // then the list is sliced to SPELL_SLOT_COUNT. A 6-spell list that omits fireball
  // will have fireball inserted at slot 0 and the 6th drafted spell silently dropped
  // (player gets 5 chosen + fireball). To avoid this, any caller passing a full
  // SPELL_SLOT_COUNT list MUST include fireball, OR pass only SPELL_SLOT_COUNT-1
  // spells and let this method fill slot 0. botSpellLoadout() in bot.js already
  // follows the latter convention.
  setLoadout(spellIds = []) {
    this.spellSlots = Array(CFG.SPELL_SLOT_COUNT).fill(null);
    this.spells = new Set();
    const ids = [];
    for (const id of spellIds) {
      if (!SPELLS[id] || ids.includes(id)) continue;
      ids.push(id);
      if (ids.length >= CFG.SPELL_SLOT_COUNT) break;
    }
    if (!ids.includes("fireball")) ids.unshift("fireball");
    ids.slice(0, CFG.SPELL_SLOT_COUNT).forEach((id, i) => {
      this.spellSlots[i] = id;
      this.spells.add(id);
      this.cooldowns[id] = 0;
    });
  }

  // ---- Step 6: spell draft methods ----

  /** Reset draft state at the start of the SPELL_SELECTION phase. */
  beginDraft() {
    this.draftPick = [];
    this.draftReady = false;
  }

  /** Toggle a spell in/out of the draft picks. No-ops when ready, invalid id, fireball, or over cap. */
  toggleDraftSpell(id) {
    if (this.draftReady || !SPELLS[id] || id === "fireball") return;
    const i = this.draftPick.indexOf(id);
    if (i >= 0) { this.draftPick.splice(i, 1); return; }
    if (this.draftPick.length >= CFG.SPELL_SLOT_COUNT) return; // 6-slot cap
    this.draftPick.push(id);
  }

  /** Apply one of the three quick-pick templates (index 0/1/2). No-op when ready or index invalid. */
  applyDraftTemplate(n) {
    if (this.draftReady) return;
    const t = SPELL_TEMPLATES?.[n];
    if (!t) return;
    this.draftPick = t.spells
      .filter((id) => SPELLS[id] && id !== "fireball")
      .slice(0, CFG.SPELL_SLOT_COUNT);
  }

  /** Clear all picks (only when not yet ready). */
  clearDraft() {
    if (!this.draftReady) this.draftPick = [];
  }

  /** Mark this player as ready to start; host transitions out of draft when all players are ready. */
  setDraftReady(v) {
    this.draftReady = !!v;
  }

  /**
   * Commit a drafted loadout: fireball stays the free always-on basic (in spells Set,
   * not in a slot); the 6 slot positions are filled with the provided ids.
   */
  setDraftLoadout(ids = []) {
    this.spells = new Set(["fireball"]);
    this.spellSlots = Array(CFG.SPELL_SLOT_COUNT).fill(null);
    let slot = 0;
    for (const id of ids) {
      if (slot >= CFG.SPELL_SLOT_COUNT) break;
      if (!SPELLS[id] || id === "fireball" || this.spells.has(id)) continue;
      this.spellSlots[slot++] = id;
      this.spells.add(id);
      this.cooldowns[id] = 0;
    }
  }

  canCast(spellId) {
    if (!this.alive || this.falling) return false;
    if (this.status.disabled > 0) return false;
    if (this.status.stunned > 0) return false;
    if (this.activeCast) return false;   // already winding up / channeling
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
    this.groundY = CFG.PLATFORM_TOP;
    this.peakY   = CFG.PLATFORM_TOP;
    this.aim = Math.atan2(-this.z, -this.x); // face center
    this.charge = 0;
    this.hp = this.maxHp;
    this.alive = true;
    this.spectating = false;
    this.falling = false;
    this.cooldowns = {};
    this.roundKills = 0;
    this.lastAttackerId = null;
    this.lastAttackerAt = 0;
    this.timeshift = null;
    this.activeCast = null;
    this.pendingCasts = [];
    this._castSeen = -1;
    this._nextBotFireAt = 0;
    this._nextBotAbilityAt = 0;
    this._botCastId = 0;
    this._hazardTime = 0;
    // Reset bot-brain cross-round state (velocity memory, combo window, etc.)
    if (this._brain) this._brain.reset();
    this.status = {
      windWalk: 0, rush: 0, shield: 0, shieldCharges: 0, disabled: 0,
      gravity: 0, gravX: 0, gravZ: 0, gravPull: 0, gravBy: null, gravImplDmg: null, linkedTo: null, link: 0,
      stunned: 0,
      slow: 0, slowMul: 1, burn: 0, burnDps: 0, burnBy: null, burnTickAcc: 0, curse: 0, curseMul: 1,
      invisible: 0, haste: 0, hasteMul: 1,
    };
    this._events = [];
    this.input = { move: [0, 0], aim: this.aim, seq: 0, casts: [] };
  }

  // --- AUTHORITATIVE physics step (host only) ---
  step(dt, arena) {
    if (!this.alive) return;
    if (this._events.length) this._events.length = 0;

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

    // Item regen: restore HP per second from Phoenix Charm / regen items.
    if (this.mods.regen > 0 && this.hp > 0 && this.hp < this.maxHp) {
      this.hp = Math.min(this.maxHp, this.hp + this.mods.regen * dt);
    }

    // Apply player movement intent (only when not heavily knocked back).
    const [mx, mz] = this.input.move;
    const mlen = Math.hypot(mx, mz);
    const knockSpeed = Math.hypot(this.vx, this.vz);
    const inHazard = !arena.isOnPlatform(this.x, this.z);
    const isStunned = this.status.stunned > 0;

    // Movement control is reduced while being knocked back hard, but Rush and
    // Wind Walk improve mobility per the handbook.
    let speed = CFG.MOVE_SPEED * this.mods.speedMul;
    if (this.status.windWalk > 0) speed *= SPELLS.windWalk.speedMul;
    if (this.status.rush > 0) speed *= SPELLS.rush.speedMul;
    if (this.status.haste > 0) speed *= this.status.hasteMul;
    if (this.status.slow > 0) speed *= this.status.slowMul;
    if (inHazard) speed *= CFG.HAZARD_MOVE_SPEED_MUL;
    const control = knockSpeed > 2 ? 0.25 : 1.0;

    // Save XZ before all displacement (used by collision resolution below).
    const prevX = this.x;
    const prevZ = this.z;

    // Stunned players cannot move under their own control.
    if (!isStunned && mlen > 0.01) {
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

    // Collision resolution against plateau walls and obstacle footprints.
    // Uses current Y as fromY so a player already on top of a feature is
    // never blocked by its sides.  Only resolves when the player moved FROM
    // a clear position INTO a blocked one (prevX/prevZ must be unblocked);
    // degenerate cases (player placed inside geometry) are left to resolve
    // naturally.  Velocity is NOT zeroed — friction decays it over subsequent
    // ticks so players slide against walls rather than stopping dead.
    // A midpoint substep reduces tunnelling when strong knockback carries the
    // player more than one PLAYER_RADIUS in a single tick.
    if (arena.blocksMovement) {
      const _dx = this.x - prevX, _dz = this.z - prevZ;
      // Midpoint substep: when displacement is large, check the halfway point
      // first so a player launched by knockback cannot phase through thin geometry.
      if (Math.hypot(_dx, _dz) > CFG.PLAYER_RADIUS) {
        const mx = prevX + _dx * 0.5, mz = prevZ + _dz * 0.5;
        if (arena.blocksMovement(mx, mz, this.y) &&
            !arena.blocksMovement(prevX, prevZ, this.y)) {
          if (!arena.blocksMovement(mx, prevZ, this.y)) {
            this.x = mx; this.z = prevZ;
          } else if (!arena.blocksMovement(prevX, mz, this.y)) {
            this.x = prevX; this.z = mz;
          } else {
            this.x = prevX; this.z = prevZ;
          }
        }
      }
      // Endpoint check (handles normal-speed movement and any tunnelling the
      // midpoint substep missed).
      if (arena.blocksMovement(this.x, this.z, this.y) &&
          !arena.blocksMovement(prevX, prevZ, this.y)) {
        // Try sliding along x (keep new x, revert z to previous).
        if (!arena.blocksMovement(this.x, prevZ, this.y)) {
          this.z = prevZ;
        // Try sliding along z (keep new z, revert x to previous).
        } else if (!arena.blocksMovement(prevX, this.z, this.y)) {
          this.x = prevX;
        } else {
          // Corner block: revert both axes.
          this.x = prevX;
          this.z = prevZ;
        }
      }
    }

    // Charge slowly decays while alive.
    this.charge = Math.max(0, this.charge - CFG.CHARGE_DECAY * dt);

    // Per-spell cooldown ticks.
    for (const k in this.cooldowns) {
      if (this.cooldowns[k] > 0) this.cooldowns[k] = Math.max(0, this.cooldowns[k] - dt);
    }

    // --- Vertical physics (grounded vs. airborne off a ledge) ---
    // Applies only while on the arena platform; the hazard-zone path is
    // handled below and left unchanged (hazard timer → falling → LAVA_Y → dead).
    if (arena.isOnPlatform(this.x, this.z) && arena.groundHeightAt) {
      const newGroundY = arena.groundHeightAt(this.x, this.z);
      this.groundY = newGroundY;

      // A player standing on a ramp footprint is always grounded: the ramp
      // surface descends smoothly under them, so a lower newGroundY is NOT a
      // ledge fall — it is the ramp geometry changing.  Only go airborne when
      // the player stepped off a real ledge/cliff (NOT on any ramp) AND is
      // meaningfully above the surface below.
      const isOnRamp = arena.onRamp ? arena.onRamp(this.x, this.z) : false;

      if (!isOnRamp && this.y > newGroundY + 0.01) {
        // Airborne over the platform (fell off a ledge): apply gravity and
        // track the peak height for fall-stun distance calculation.
        this.vy -= CFG.GRAVITY * dt;
        this.y += this.vy * dt;
        if (this.y > this.peakY) this.peakY = this.y;
        // Landing: snap to surface; stun if the drop was notable.
        if (this.y <= newGroundY) {
          const drop = this.peakY - newGroundY;
          this.y = newGroundY;
          this.vy = 0;
          if (drop >= CFG.FALL_STUN_MIN_HEIGHT) {
            this.status.stunned = CFG.FALL_STUN_DURATION;
          }
          this.peakY = newGroundY;
        }
      } else {
        // Grounded (including ramp descent): snap Y to the current surface so
        // ramps raise/lower the player smoothly.  Reset vertical state so the
        // next airborne phase (if any) starts with a fresh peakY.
        this.y = newGroundY;
        this.vy = 0;
        this.peakY = newGroundY;
      }
    }

    // Off the edge? Begin falling — Lava Treads grants a brief grace window.
    if (!arena.isOnPlatform(this.x, this.z)) {
      if (this.mods.lavaGrace > 0 && this._lavaGrace === undefined) {
        this._lavaGrace = this.mods.lavaGrace;
      }
      if (this._lavaGrace > 0) {
        this._lavaGrace -= dt;
      } else {
        this._hazardTime += dt;
        if (this._hazardTime >= CFG.HAZARD_DEATH_DELAY) {
          this.falling = true;
          this.vy = 1.5;
        }
      }
    } else {
      this._lavaGrace = undefined;
      this._hazardTime = 0;
    }
  }

  _tickStatus(dt) {
    const s = this.status;
    for (const k of ["windWalk", "rush", "shield", "disabled", "gravity", "link", "stunned", "slow", "curse", "invisible", "haste"]) {
      if (s[k] > 0) {
        const prev = s[k];
        s[k] = Math.max(0, s[k] - dt);
        if (k === "shield" && s[k] === 0) s.shieldCharges = 0;
        if (k === "link" && s[k] === 0) s.linkedTo = null;
        // Gravity implosion burst: when the field expires, fling the player
        // outward from the field origin — setup→payoff combo moment.
        if (k === "gravity" && prev > 0 && s[k] === 0) {
          const ox = this.x - s.gravX;
          const oz = this.z - s.gravZ;
          const dist = Math.hypot(ox, oz);
          // Only burst if still inside the field (player didn't fully escape).
          if (dist <= (SPELLS.gravity.radius ?? 8)) {
            // Dead-centre fallback: if the pull dragged the victim exactly to
            // the origin the direction vector is ~(0,0); fling along the player's
            // current aim instead so the payoff always fires (mirrors meteor logic).
            const dx = dist < 0.001 ? Math.cos(this.aim) : ox;
            const dz = dist < 0.001 ? Math.sin(this.aim) : oz;
            // Guard the feedback event on the hit landing (shield can block it)
            // so the client spark/SFX matches the authoritative result.
            if (this.applyHit(dx, dz, SPELLS.gravity.gravKb ?? 14)) {
              // Prefer mob-sourced implosion damage (set by vacuum ability) over the
              // player Gravity spell's dmg so mob tuning stays decoupled from spell rebalancing.
              this.applyDamage(s.gravImplDmg ?? SPELLS.gravity.dmg ?? CFG.BOLT_BASE_DAMAGE, s.gravBy ?? null);
              this._events.push({ type: "hit", x: this.x, z: this.z, victim: this.id, by: s.gravBy ?? this.id });
            }
          }
        }
      }
    }
    // Burn DoT: deals damage per second and emits visual tick events.
    if (s.burn > 0) {
      this.applyDamage(s.burnDps * dt, s.burnBy);
      s.burn = Math.max(0, s.burn - dt);
      s.burnTickAcc += dt;
      if (s.burnTickAcc >= 0.25) {
        s.burnTickAcc = 0;
        this._events.push({ type: "dotTick", x: this.x, z: this.z, victim: this.id });
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
    if (this.status.curse > 0) impulse *= this.status.curseMul;
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

  // HP damage — SEPARATE from applyHit knockback. Clamps to [0,maxHp]; sets the
  // player dead at 0 (funnels into sim's existing death-detection loop). Records
  // the attacker for kill-credit so an HP kill is attributed even with no hit event.
  applyDamage(amount, byId = null) {
    if (!this.alive || this.falling) return false; // already doomed; ignore
    if (!(amount > 0)) return false;
    if (this.status.curse > 0) amount *= this.status.curseMul;
    this.hp = Math.max(0, this.hp - amount);
    if (byId && byId !== this.id) this.recordAttacker(byId, Date.now());
    if (this.hp <= 0) {
      this.hp = 0;
      this.alive = false; // hp death — death loop counts it next (sim.js)
    }
    return true;
  }

  // Restore HP (step-3 Mend channel). Clamps to maxHp. Returns false when no-op.
  applyHeal(amount) {
    if (!this.alive || this.falling) return false;
    if (!(amount > 0)) return false;
    this.hp = Math.min(this.maxHp, this.hp + amount);
    return true;
  }

  // Record the most recent attacker for kill-credit attribution.
  // `now` is a millisecond timestamp (e.g. Date.now()).
  recordAttacker(attackerId, now) {
    this.lastAttackerId = attackerId;
    this.lastAttackerAt = now;
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
      hp: +this.hp.toFixed(1),
      mhp: this.maxHp,
      al: this.alive,
      sp: this.spectating,
      f: this.falling,
      hz: this._hazardTime > 0 && !this.falling ? +Math.max(0, CFG.HAZARD_DEATH_DELAY - this._hazardTime).toFixed(2) : 0,
      st: this.status.stunned > 0 ? +this.status.stunned.toFixed(2) : 0,
      s: this.score,
      k: this.kills,
      d: this.deaths,
      // status flags for VFX (1/0 to keep the packet small)
      ww: this.status.windWalk > 0 ? 1 : 0,
      ru: this.status.rush > 0 ? 1 : 0,
      sh: this.status.shieldCharges > 0 ? 1 : 0,
      di: this.status.disabled > 0 ? 1 : 0,
      gr: this.status.gravity > 0 ? 1 : 0,
      lk: this.status.linkedTo || null,
      sl: this.status.slow > 0 ? 1 : 0,
      bu: this.status.burn > 0 ? 1 : 0,
      cu: this.status.curse > 0 ? 1 : 0,
      // step-3 status flags
      iv: this.status.invisible > 0 ? 1 : 0,
      hs: this.status.haste > 0 ? 1 : 0,
      // step-3 cast/channel progress bar (null when idle)
      ca: this.activeCast ? {
        p: +Math.min(1, this.activeCast.channeling
          ? this.activeCast.t / (this.activeCast.channel || 1)
          : this.activeCast.t / (this.activeCast.castTime || 1)).toFixed(2),
        s: this.activeCast.spell,
        c: this.activeCast.channeling ? 1 : 0,
      } : 0,
      // per-spell cooldowns for the local HUD bar
      cds: this._cdSnapshot(),
      spells: [...this.spells],
      spellSlots: [...this.spellSlots],
      items: [...this.items],
      // Step 6 draft state (used by the SPELL_SELECTION overlay)
      draftPick: [...this.draftPick],
      draftReady: this.draftReady,
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

// Pure kill-attribution helper — extracted for unit testing without the full sim.
// Returns the attacker id if the attack occurred within the window, or null.
// Parameters:
//   lastAttackerId  - id of the last player that hit the victim (or null)
//   lastAttackerAt  - timestamp (ms) when that hit landed
//   now             - current timestamp (ms)
//   windowSeconds   - attribution window (CFG.KILL_CREDIT_WINDOW)
export function resolveKillCredit(lastAttackerId, lastAttackerAt, now, windowSeconds) {
  if (!lastAttackerId) return null;
  if ((now - lastAttackerAt) >= windowSeconds * 1000) return null;
  return lastAttackerId;
}
