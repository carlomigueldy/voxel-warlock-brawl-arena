// Imperative trigger + position bus — the R3F replacement for legacy
// renderer.js reaching into `playerMeshes.get(id).group.userData.character`
// to fire a cast/reaction animation or read an interpolated position.
//
// Entities register themselves on mount and unregister on unmount (design
// §2), keeping mount/unmount declarative while per-frame dispatch
// (CameraRig/LightPool/EffectsLayer reading positions, EffectsLayer/mob
// telegraphs firing triggers) stays non-reactive — none of this touches a
// Zustand store or React state, so it never causes a re-render.
//
// `pos` is a mutable position bus, not a getter: the owning entity
// (PlayerEntity/MobEntity, both future issues) writes its OWN interpolated
// x/z into the same object every frame inside its own useFrame; readers
// (CameraRig, LightPool, AimBridge, EffectsLayer) just read the current
// x/z off the object they already hold a reference to — no per-frame
// allocation, no re-registration.

export interface Vec2 {
  x: number;
  z: number;
}

export interface PlayerRegistryEntry {
  /** Fire a cast-animation overlay by archetype (design §6 CastAnimator). */
  triggerCast(archetype: string): void;
  /** Fire a reaction (hit-flinch) animation overlay by archetype. */
  triggerReaction(archetype: string): void;
  /** Interpolated world position — owner mutates x/z in place each frame. */
  pos: Vec2;
}

export interface MobRegistryEntry {
  type: string;
  /** Fire the mob's melee/ranged attack animation. */
  triggerAttack(): void;
  /** Interpolated world position — owner mutates x/z in place each frame. */
  pos: Vec2;
}

const players = new Map<string, PlayerRegistryEntry>();
const mobs = new Map<string, MobRegistryEntry>();

export function registerPlayer(id: string, entry: PlayerRegistryEntry): void {
  players.set(id, entry);
}

export function unregisterPlayer(id: string): void {
  players.delete(id);
}

export function player(id: string): PlayerRegistryEntry | undefined {
  return players.get(id);
}

/** Convenience read used by CameraRig/AimBridge — INTERPOLATED position, not
 * the raw snapshot x/z (design §0/§2 parity trap: legacy's _updateCamera
 * follows `playerMeshes.get(localId)`'s smoothed rx/rz, never the wire pos
 * directly). Returns undefined until the local player's entity has mounted. */
export function playerPos(id: string | null | undefined): Vec2 | undefined {
  return id ? players.get(id)?.pos : undefined;
}

export function registerMob(id: string, entry: MobRegistryEntry): void {
  mobs.set(id, entry);
}

export function unregisterMob(id: string): void {
  mobs.delete(id);
}

export function mob(id: string): MobRegistryEntry | undefined {
  return mobs.get(id);
}

// Mirrors legacy renderer.js's _triggerMobAttackModelNear lookup half (the
// trigger call itself is left to the caller — e.g. EffectsLayer's
// triggerMobAttackNear ctx helper — so this stays a pure lookup).
export function nearestMob(type: string, x: number, z: number): string | null {
  let best: string | null = null;
  let bestD = Infinity;
  for (const [id, e] of mobs) {
    if (e.type !== type) continue;
    const d = Math.hypot(e.pos.x - x, e.pos.z - z);
    if (d < bestD) { bestD = d; best = id; }
  }
  return best;
}
