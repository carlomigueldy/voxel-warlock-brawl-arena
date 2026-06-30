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

// Resolve the locomotion clip from movement. Falling always wins so a knocked-off
// warlock reads as plummeting rather than running in mid-air.
export function locomotionState({ speed = 0, maxSpeed = 9, falling = false } = {}) {
  if (falling) return "fall";
  const gait = maxSpeed > 0 ? speed / maxSpeed : 0;
  if (gait >= 0.6) return "run";
  if (gait >= 0.12) return "walk";
  return "idle";
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
