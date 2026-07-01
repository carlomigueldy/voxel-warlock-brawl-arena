// Pure, framework-free animation logic shared by the GLB rig path
// (character.js) and the procedural voxel fallback (voxel.js).
//
// The simulation already emits transient `events` describing every ability the
// moment it resolves (see spells.js). Rather than author a bespoke clip per
// ability — 20 abilities x 4 characters is neither affordable nor maintainable —
// we group the handbook into a small set of cast *archetypes*. Each archetype is
// a distinct upper/whole-body action layered on top of the locomotion clips
// (idle/walk/run from the Meshy rig). This keeps the system data-driven and
// fully unit-testable with no Three.js dependency.

// The cast animation archetypes. Auto-attack and all projectile casts share
// "attack"; the rest group by play-feel.
export const ARCHETYPES = ["attack", "slam", "dash", "buff", "channel"];

// Every handbook ability (config.js SPELLS) mapped to one archetype.
export const ABILITY_ARCHETYPE = {
  // Auto-attack + projectiles + instant strikes
  fireball: "attack",
  boomerang: "attack",
  homing: "attack",
  bouncer: "attack",
  splitter: "attack",
  fireSpray: "attack",
  disable: "attack",
  lightning: "attack",
  // Area / ground-targeted slams
  meteor: "slam",
  gravity: "slam",
  // Mobility dashes / blinks
  teleport: "dash",
  thrust: "dash",
  swap: "dash",
  // Self-buffs / utility on self
  shield: "buff",
  rush: "buff",
  windWalk: "buff",
  timeShift: "buff",
  pocketWatch: "buff",
  // Targeted channels (pull/bind a foe)
  drain: "channel",
  link: "channel",
  // Step 3 DOTA-inspired roster
  projectile: "attack",
  target: "attack",
  stun: "attack",
  push: "slam",
  explode: "slam",
  blink: "dash",
  pull: "channel",
  drag: "channel",
  vacuum: "channel",
  heal: "channel",
  invisible: "buff",
  speed: "buff",
  summon: "buff",
};

// How long each archetype plays before locomotion fully takes back over.
export const ARCHETYPE_DURATION = {
  attack: 0.45,
  slam: 0.8,
  dash: 0.5,
  buff: 0.7,
  channel: 0.9,
};

export function archetypeForAbility(spellId) {
  return ABILITY_ARCHETYPE[spellId] || null;
}

// Map a simulation event (from a snapshot) to {id, archetype} for the caster,
// or null if the event should not trigger a cast animation. The caster id field
// varies per event type, mirroring spells.js emissions.
const EVENT_ARCHETYPE = {
  meteorCast: "slam",
  gravity: "slam",
  teleport: "dash",
  thrust: "dash",
  swap: "dash",
  shield: "buff",
  windwalk: "buff",
  rush: "buff",
  timeshift: "buff",
  pocketwatch: "buff",
  drain: "channel",
  link: "channel",
  lightning: "attack",
  // Step 3 events
  target: "attack",
  stun: "attack",
  explode: "slam",
  push: "slam",
  pull: "channel",
  drag: "channel",
  vacuumTick: "channel",
  invisible: "buff",
  speed: "buff",
  summon: "buff",
};

export function archetypeForEvent(ev) {
  if (!ev || !ev.type) return null;

  // Generic projectile/auto-attack casts carry the spell id explicitly.
  if (ev.type === "cast") {
    const archetype = archetypeForAbility(ev.spell) || "attack";
    return ev.id != null ? { id: ev.id, archetype } : null;
  }

  // Cast wind-up / channel start: trigger the spell's archetype pose.
  if (ev.type === "castStart") {
    const archetype = archetypeForAbility(ev.spell) || "channel";
    return ev.id != null ? { id: ev.id, archetype } : null;
  }

  const archetype = EVENT_ARCHETYPE[ev.type];
  if (!archetype) return null;

  // swap/drain/link identify the caster as `a`; the rest use `id`.
  const id = ev.id != null ? ev.id : ev.a;
  if (id == null) return null;
  return { id, archetype };
}

// Speed (world units/s) above which a player's velocity reads as "being
// flung" rather than moving under their own power. Mirrors the movement-
// control reduction threshold already used in player.js's tick() (control =
// knockSpeed > 2 ? 0.25 : 1.0) so the visual and the physics agree on what
// counts as a hard knockback.
export const KNOCKBACK_SPEED_THRESHOLD = 2;

// Resolve the locomotion clip from movement + status flags. Priority (highest
// first): death (never resumes locomotion) > falling (plummeting off a ledge)
// > stunned (fall-stun punish window) > knockback (flung by a hit) > run/walk/
// idle from raw movement speed. Each higher-priority state fully overrides the
// ones below it so a stunned, knocked-back player doesn't flicker between poses.
export function locomotionState({
  speed = 0,
  maxSpeed = 9,
  falling = false,
  alive = true,
  stunned = false,
  knockSpeed = 0,
} = {}) {
  if (!alive) return "death";
  if (falling) return "fall";
  if (stunned) return "stun";
  if (knockSpeed > KNOCKBACK_SPEED_THRESHOLD) return "knockback";
  const gait = maxSpeed > 0 ? speed / maxSpeed : 0;
  if (gait >= 0.6) return "run";
  if (gait >= 0.12) return "walk";
  return "idle";
}

// Hit-reaction overlay: a short flinch layered on top of locomotion, exactly
// like CastAnimator layers cast archetypes, but triggered by the *victim* of a
// "hit" event rather than the caster (so it deliberately does not reuse
// ARCHETYPES/CastAnimator — a hit reaction is not a cast).
export const REACTION_DURATION = { hit: 0.25 };

// Map a simulation "hit" event to the victim's id + reaction, or null. Mirrors
// archetypeForEvent's shape but reads `victim` (who got hit) instead of `id`/
// `a` (who cast the ability) — those are different players.
export function reactionForEvent(ev) {
  if (!ev || ev.type !== "hit") return null;
  if (ev.victim == null) return null;
  return { id: ev.victim, reaction: "hit" };
}

// Tracks the currently-playing hit-reaction overlay and its 0..1 blend
// weight, identical state-machine shape to CastAnimator (ease in / hold /
// ease out) but scoped to REACTION_DURATION instead of ARCHETYPE_DURATION.
export class ReactionAnimator {
  constructor() {
    this.active = false;
    this.reaction = null;
    this.weight = 0;
    this._t = 0;
    this._dur = 0;
  }

  trigger(reaction) {
    if (!REACTION_DURATION[reaction]) return;
    this.reaction = reaction;
    this.active = true;
    this._t = 0;
    this._dur = REACTION_DURATION[reaction];
  }

  update(dt) {
    if (!this.active) {
      this.weight = Math.max(0, this.weight - dt * 6);
      return;
    }
    this._t += dt;
    const k = this._dur > 0 ? this._t / this._dur : 1;
    // Snappier ease in/out than CastAnimator — a flinch reads best as a quick
    // punctuation, not a held pose.
    let target;
    if (k < 0.2) target = k / 0.2;
    else if (k > 0.6) target = Math.max(0, (1 - k) / 0.4);
    else target = 1;
    this.weight += (target - this.weight) * Math.min(1, dt * 24);
    this.weight = Math.max(0, Math.min(1, this.weight));
    if (this._t >= this._dur) {
      this.active = false;
      this.reaction = null;
    }
  }
}

// A tiny state machine that tracks the currently-playing cast archetype and a
// 0..1 blend weight. The renderer layers this over locomotion: weight ramps up
// when an archetype fires, holds, then ramps down as the timer expires.
export class CastAnimator {
  constructor() {
    this.active = false;
    this.archetype = null;
    this.weight = 0;
    this._t = 0;
    this._dur = 0;
  }

  trigger(archetype) {
    if (!ARCHETYPES.includes(archetype)) return;
    this.archetype = archetype;
    this.active = true;
    this._t = 0;
    this._dur = ARCHETYPE_DURATION[archetype] || 0.5;
  }

  update(dt) {
    if (!this.active) {
      this.weight = Math.max(0, this.weight - dt * 4);
      return;
    }
    this._t += dt;
    const k = this._dur > 0 ? this._t / this._dur : 1;
    // Ease in over the first 25%, hold, ease out over the last 35%.
    let target;
    if (k < 0.25) target = k / 0.25;
    else if (k > 0.65) target = Math.max(0, (1 - k) / 0.35);
    else target = 1;
    this.weight += (target - this.weight) * Math.min(1, dt * 18);
    this.weight = Math.max(0, Math.min(1, this.weight));
    if (this._t >= this._dur) {
      this.active = false;
      this.archetype = null;
    }
  }
}
