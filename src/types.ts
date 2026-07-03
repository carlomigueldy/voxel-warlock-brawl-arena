// Shared domain-type contract for Voxel Warlock Brawl Arena.
//
// This is the P1 type foundation: src/config.ts and every later `.js` → `.ts`
// conversion (sim, player, bolt, mob, renderer, input, net, ...) import these
// shapes. Runtime/wire types below mirror the *exact* wire format emitted
// today — see the snapshot()/events.push() call sites in
// src/sim.js, src/player.js, src/bolt.js, src/mob.js and the
// `_processEvents()` switch in src/renderer.js. Abbreviated keys (x/z/y/a/c/
// hp/mhp/al/...) are intentional: they are the actual network wire keys,
// kept short to save bandwidth over the PeerJS data channel — do not
// "clean them up" here, that would desync host/client wire compat.
//
// GameEvent / Snapshot are a good-faith first cut accurate to the current
// runtime shapes; later P1 sub-issues (sim.js/player.js/bolt.js/mob.js
// conversions) may tighten them further as those modules gain real types.

// ─── Config data shapes (src/config.ts) ────────────────────────────────────

/**
 * A single castable ability definition (CFG-adjacent SPELLS table).
 * Every entry carries the common fields below; the remaining tunables
 * (damage/knockback/geometry/status/etc.) vary per spell `kind` and are
 * read ad hoc by src/spells.js's per-kind handlers — see the `aim` doc
 * comment above SPELLS in config.js for the full tunable vocabulary.
 */
export interface SpellDef {
  name: string;
  key: string;
  cd: number;
  kind: string;
  color: number;
  desc: string;
  sfx?: string;
  aim?: string;
  /** Marks item-granted spells (e.g. pocketWatch) vs. the base spellbook. */
  item?: boolean;
  // Spell-specific tunables: dmg, kb, range, radius, duration, chains,
  // burn, curse, stunDur, castTime, channel, tick, ... — intentionally
  // dynamic per `kind`, so left open here rather than unioned per-kind.
  [tunable: string]: unknown;
}

export interface ItemDef {
  name: string;
  kind: string;
  value?: number;
  shape: string;
  color: number;
  rarity: "common" | "rare" | "unfair";
  desc: string;
  /** Present only for `kind: "active"` items — the spell they bind. */
  grantsSpell?: string;
}

export interface CharacterDef {
  id: string;
  name: string;
  color: number;
  blurb: string;
}

export interface ArenaWorld {
  id: string;
  name: string;
  top: number;
  side: number;
  /** Hazard id — key into CFG.ARENA_HAZARDS. */
  hazard: string;
}

export interface ArenaHazardDetail {
  kind: string;
  count: number;
  color: number;
  size: number;
  rise: number;
}

export interface ArenaHazard {
  id: string;
  name: string;
  style: string;
  color: number;
  glow: number;
  fog: number;
  amp: number;
  speed: number;
  jagged?: boolean;
  detail: ArenaHazardDetail;
}

export interface ArenaLandSize {
  id: string;
  name: string;
  radius: number;
}

export interface Region {
  id: string;
  label: string;
}

/** Stable set of toggleable map-object categories (CFG.OBSTACLE_TYPES ids). */
export type ObstacleTypeId =
  | "tree"
  | "stone"
  | "column"
  | "deadGiant"
  | "dragonBones"
  | "debris"
  | "wall"
  | "boulder";

export interface ObstacleTypeDef {
  id: ObstacleTypeId;
  label: string;
}

/**
 * Per-type mob stat table entry (CFG.MOB_TYPES). Consumed by src/mob.js
 * (physics/brain) and src/sim.js (ability dispatch). Optional fields are
 * only populated for mob types that use the corresponding ability
 * mechanic — see the field-by-field doc comment above CFG.MOB_TYPES in
 * config.js for what each one drives.
 */
export interface MobType {
  name: string;
  attack: "melee" | "ranged";
  speed: number;
  meleeKb: number;
  meleeEvery: number;
  maxHits: number;
  bodyR: number;
  /** GLB model target height (m); collision still uses bodyR. */
  height?: number;
  color: number;
  abilityEvery: number | null;
  ability: string | null;
  dmg: number;
  boltToKb: number;
  canSpawnMinions: boolean;
  // Ranged attack tunables.
  rangedKb?: number;
  rangedEvery?: number;
  rangedRange?: number;
  // Signature-ability tunables (telegraphed channel state machine).
  abilityKb?: number;
  abilityRadius?: number;
  abilityDmg?: number;
  telegraphR?: number;
  castTime?: number;
  stunDur?: number;
  slowDur?: number;
  slowMul?: number;
  curseDur?: number;
  curseMul?: number;
  burn?: number;
  burnDur?: number;
  pull?: number;
  channelTime?: number;
  stages?: number;
  stageDelay?: number;
  stageR?: number;
  /** Cinematic spawn descriptor consumed by renderer + sim. */
  entrance?: {
    kind: "shatter" | "storm" | "summon" | "meteor";
    kb?: number;
    radius?: number;
  };
}

export interface MobShrinkCapStep {
  at: number;
  cap: number;
}

export interface SpellTemplate {
  id: string;
  name: string;
  desc: string;
  spells: string[];
}

// ─── Procedural map layout (src/mapgen.js / src/arena-query.js) ───────────

/** A single ramp footprint attached to a plateau (src/mapgen.js generateMap). */
export interface MapRamp {
  /** Which plateau face the ramp connects to: 0=+x, 1=-x, 2=+z, 3=-z. */
  side: 0 | 1 | 2 | 3;
  x: number;
  z: number;
  w: number;
  d: number;
}

/** A raised rectangular platform with 1-2 ramps down to ground level. */
export interface MapPlateau {
  x: number;
  z: number;
  w: number;
  d: number;
  height: number;
  ramps: MapRamp[];
}

/** A circular-footprint blocking prop (tree/stone/column/etc). */
export interface MapObstacle {
  id: number;
  type: ObstacleTypeId;
  x: number;
  z: number;
  r: number;
  height: number;
  rot: number;
}

/** Full procedural layout returned by src/mapgen.js generateMap() and
 * broadcast host->clients as Snapshot.mapLayout. */
export interface MapLayout {
  seed: number;
  worldId: string;
  plateaus: MapPlateau[];
  obstacles: MapObstacle[];
}

// ─── Runtime / wire snapshot shapes ─────────────────────────────────────────

/** Sim phase (src/sim.js PHASE) — kept literal here since sim.js isn't
 * converted yet; sim.ts should re-export/align with this union in P1b. */
export type Phase =
  | "lobby"
  | "spellSelection"
  | "countdown"
  | "playing"
  | "roundEnd"
  | "matchEnd";

/** Active per-slot spell cooldowns; keys are spell ids present in SPELLS. */
export type CooldownMap = Record<string, number>;

/** In-flight cast/channel progress bar (player.js snapshot() `ca` field). */
export interface ActiveCastSnap {
  /** progress 0..1 */
  p: number;
  /** spell id */
  s: string;
  /** 1 = channeling, 0 = winding up */
  c: 0 | 1;
}

export interface PlayerSnap {
  id: string;
  x: number;
  z: number;
  y: number;
  /** aim angle (radians) */
  a: number;
  /** knockback charge */
  c: number;
  hp: number;
  mhp: number;
  al: boolean;
  sp: boolean;
  f: boolean;
  /** hazard death countdown; 0 when not standing on the hazard */
  hz: number;
  /** stun remaining (seconds) */
  st: number;
  s: number;
  k: number;
  d: number;
  // Status flags for VFX — 1/0 to keep the packet small.
  ww: 0 | 1;
  ru: 0 | 1;
  sh: 0 | 1;
  di: 0 | 1;
  gr: 0 | 1;
  /** linked-to player id (Link spell tether), or null */
  lk: string | null;
  sl: 0 | 1;
  bu: 0 | 1;
  cu: 0 | 1;
  iv: 0 | 1;
  hs: 0 | 1;
  // Social flags — non-authoritative, 1/0 to keep the packet small.
  ty: 0 | 1;
  afk: 0 | 1;
  spk: 0 | 1;
  /** cast/channel progress bar; 0 (falsy) when idle */
  ca: ActiveCastSnap | 0;
  cds: CooldownMap;
  spells: string[];
  spellSlots: (string | null)[];
  items: string[];
  /** Step-6 draft state (SPELL_SELECTION overlay) */
  draftPick: string[];
  draftReady: boolean;
}

export interface BoltSnap {
  id: number;
  /** owner player id (or a mob id, "mob:N", for mob-fired bolts) */
  o: string;
  x: number;
  z: number;
  y: number;
  c: number;
  /** projectile kind, so renderer can pick a mesh/VFX ("disable" is special-cased) */
  k: string;
}

export interface MobChannelSnap {
  /** ability id */
  a: string;
  /** channel elapsed/remaining time */
  t: number;
  /** telegraph radius */
  r: number;
  x: number;
  z: number;
}

export interface MobSnap {
  id: string;
  type: string;
  x: number;
  z: number;
  y: number;
  /** aim angle (radians) */
  a: number;
  hp: number;
  max: number;
  color: number;
  f: 0 | 1;
  /** practice-mode passive dummy target */
  dummy: 0 | 1;
  /** entrance-cinematic countdown remaining (seconds) */
  ent: number;
  /** active telegraphed-ability summary; null when idle */
  ch: MobChannelSnap | null;
}

export interface MeteorSnap {
  id: number;
  x: number;
  z: number;
  t: number;
  fall: number;
  r: number;
}

/** Reserved / superseded by the item system (Step 4); kept for wire compat.
 * `this.runes` is currently always empty at runtime — id type is left loose
 * since no live call site populates it. */
export interface RuneSnap {
  id: number | string;
  spell: string;
  x: number;
  z: number;
  c: number;
}

export interface ItemSnap {
  id: number;
  itemKey: string;
  kind: string;
  shape: string;
  c: number;
  rarity: string;
  name: string;
  x: number;
  z: number;
}

/** One chain-lightning hop segment (src/spells.js lightning handler). */
export interface LightningSegment {
  x1: number;
  z1: number;
  x2: number;
  z2: number;
}

/**
 * Every event the sim emits over a tick, broadcast in Snapshot.events and
 * consumed by renderer.js's `_processEvents()` switch (VFX/SFX/screenshake
 * dispatch) — enumerated from every `events.push`/`emit(sim, ...)` call site
 * across sim.js, player.js, and spells.js, plus the renderer's switch cases
 * (a few — runePickup/jump/runeDestroyed — are legacy cases the renderer
 * still handles but nothing currently emits; kept for wire/back-compat).
 */
export type GameEvent =
  | { type: "hit"; x: number; z: number; victim: string; by: string }
  | { type: "boltFizzle"; x: number; z: number; y: number; c: number; by: string }
  | { type: "projectileClash"; x: number; z: number }
  | { type: "death"; id: string }
  | { type: "cast"; spell: string; id: string; x: number; z: number }
  | { type: "lightning"; id: string; segs: LightningSegment[]; color: number; dir: number }
  | { type: "teleport"; id: string; x1: number; z1: number; x2: number; z2: number }
  | { type: "thrust"; id: string; x: number; z: number; dir: number }
  | { type: "swap"; a: string; b: string; ax: number; az: number; bx: number; bz: number }
  | { type: "drain"; a: string; b: string; x1: number; z1: number; x2: number; z2: number }
  | { type: "gravity"; id: string; x: number; z: number; radius: number; duration: number }
  | { type: "meteorCast"; id: string; x: number; z: number; fall: number; radius: number }
  | { type: "meteorImpact"; x: number; z: number; radius: number; by: string }
  | { type: "castStart"; id: string; spell: string; x: number; z: number; castTime: number; channel: number }
  | { type: "castInterrupt"; id: string; spell: string; x: number; z: number; reason: "disable" | "move" }
  | { type: "castFinish"; id: string; spell: string; x: number; z: number }
  | { type: "explode"; id: string; x: number; z: number; radius: number }
  | { type: "vacuumTick"; id: string; x: number; z: number; radius: number }
  | { type: "pull"; a: string; b: string; x1: number; z1: number; x2: number; z2: number }
  | { type: "drag"; a: string; b: string; x1: number; z1: number; x2: number; z2: number }
  | { type: "push"; id: string; x: number; z: number; dir: number; range: number }
  | { type: "target"; id: string; victim: string; x: number; z: number }
  | { type: "heal"; id: string; x: number; z: number }
  | { type: "link"; a: string; b: string }
  | { type: "pocketwatch"; id: string }
  | { type: "timeshiftReturn"; id: string; x: number; z: number }
  | { type: "invisible"; id: string }
  | { type: "speed"; id: string }
  | { type: "summon"; id: string; x: number; z: number }
  | { type: "shield"; id: string }
  | { type: "windwalk"; id: string }
  | { type: "rush"; id: string }
  | { type: "timeshift"; id: string; x: number; z: number }
  | { type: "runePickup"; x: number; z: number }
  | { type: "itemPickup"; id: string; itemKey: string; x: number; z: number }
  | { type: "jump"; x: number; z: number }
  | { type: "land"; id: string; x: number; z: number; hard: boolean }
  | { type: "footstep"; id: string; x: number; z: number }
  | { type: "lowHealth"; id: string; x: number; z: number }
  | { type: "shieldBlock"; x: number; z: number; victim: string; by: string }
  | { type: "runeDestroyed"; x: number; z: number }
  | { type: "statusApplied"; status: "slow" | "burn" | "curse" | "stun"; x: number; z: number; victim: string }
  | { type: "dotTick"; x: number; z: number; victim: string }
  | { type: "sfx"; sfx: string; x: number; z: number }
  | { type: "mobSpawn"; id: string; mobType: string; x: number; z: number; parentId: string; color: number }
  | { type: "mobIncoming"; id: string; mobType: string; x: number; z: number; color: number; entrance: "shatter" | "storm" | "summon" | "meteor" | "none"; duration: number }
  | { type: "mobArrive"; id: string; mobType: string; x: number; z: number; radius: number }
  | { type: "mobHit"; id: string; hp: number; max: number; x: number; z: number }
  | { type: "mobTelegraph"; id: string; mobType: string; ability: string; x: number; z: number; radius: number; castTime: number; color: number }
  | { type: "mobAbility"; mobType: string; ability: string; x: number; z: number; radius: number; color: number }
  | { type: "mobDeath"; id: string; mobType: string; cause: string; x: number; z: number; color: number };

/**
 * Full snapshot the host broadcasts to clients each tick (sim.js
 * `snapshot()`). `mapLayout` is produced by src/mapgen.js.
 */
export interface Snapshot {
  t: number;
  phase: Phase;
  round: number;
  timer: number;
  playTime: number;
  arenaR: number;
  arenaWorld: string;
  landSize: string;
  enabledObstacles: Partial<Record<ObstacleTypeId, boolean>>;
  winner: string | null;
  matchWinner: string | null;
  players: PlayerSnap[];
  bolts: BoltSnap[];
  meteors: MeteorSnap[];
  runes: RuneSnap[];
  items: ItemSnap[];
  mobs: MobSnap[];
  spellSlotsEnabled: true;
  events: GameEvent[];
  /** Procedural map layout (src/mapgen.js); omitted when unchanged since the
   * last broadcast (bandwidth gate) — see sim.js snapshot() doc comment. */
  mapLayout?: MapLayout;
  mapV: number;
}

// ─── Input / net wire shapes ────────────────────────────────────────────────

/** A single queued spell cast (src/input.js queueCast()). */
export interface CastCmd {
  id: number;
  spell: string;
  tx: number;
  tz: number;
}

/** Per-tick input snapshot sent client -> host (src/input.js sample()). */
export interface InputState {
  move: [number, number];
  aim: number;
  seq: number;
  casts: CastCmd[];
}

/** Per-player identity metadata (src/main.js `playerMeta`), keyed by player id. */
export interface PlayerMeta {
  name: string;
  colorIndex: number;
  character?: string;
  userId: string | null;
  isBot?: boolean;
}

/** Message types exchanged over PeerJS data channels (CFG.MSG values). */
export type WireMsg =
  | "join"
  | "input"
  | "welcome"
  | "lobby"
  | "start"
  | "state"
  | "roundEnd"
  | "matchEnd"
  | "draft"
  | "chat"
  | "typing"
  | "afk"
  | "speak"
  | "roster";
