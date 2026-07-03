// Transient, non-reactive per-frame data — the "P3a #1 rule" of the whole
// React shell: this module is a plain mutable singleton, NEVER a Zustand
// store. main.js ran sim(30Hz) + render/HUD(display rate) out of one rAF and
// read `latestSnapshot`/renderer.e.target directly; naive React state here
// would re-render every frame (unshippable). snapshotRef relocates that
// per-frame read/write surface — <PlayerEntity>/<CameraRig> (P4) and
// LegacyRendererBridge (P3a) read it inside their own rAF/useFrame, never via
// a React re-render. See design §2 / §7 invariant (1): snapshotRef writes
// NEVER set() a store.
import type { Snapshot, PlayerSnap, PlayerMeta, GameEvent } from "../types";

/** Reticle/targeting cache — resolved ON DEMAND against the attached renderer
 * (see aimBridge.ts), not a per-frame input source of truth (design §10 risk 6). */
export interface AimCache {
  cursorX: number;
  cursorY: number;
  spellId: string | null;
  angle: number;
  point: { x: number; z: number } | null;
  target: { x: number; z: number } | null;
}

export interface SnapshotRef {
  current: Snapshot | null;
  prev: Snapshot | null;
  byId: Map<string, PlayerSnap>;
  meta: Map<string, PlayerMeta>;
  lastEventsT: number;
  localId: string | null;
  shake: number;
  aim: AimCache;
}

export const snapshotRef: SnapshotRef = {
  current: null,
  prev: null,
  byId: new Map(),
  meta: new Map(),
  lastEventsT: -1,
  localId: null,
  shake: 0,
  aim: { cursorX: 0, cursorY: 0, spellId: null, angle: 0, point: null, target: null },
};

// Dup-guard on snap.t (a host may re-broadcast/replay the same tick); rebuilds
// the id-keyed lookup map every call — cheap (player count is small) and
// keeps <PlayerEntity>/<MobsLayer> per-frame reads O(1) instead of O(n) scans.
export function pushSnapshot(snap: Snapshot): void {
  if (snapshotRef.current && snap.t === snapshotRef.current.t) return;
  snapshotRef.prev = snapshotRef.current;
  snapshotRef.current = snap;
  snapshotRef.byId.clear();
  for (const p of snap.players) snapshotRef.byId.set(p.id, p);
}

export function setLocalId(id: string | null): void {
  snapshotRef.localId = id;
}

// Full teardown between matches (endSession / leaveMatch) — mirrors the
// reactive half's useSessionStore.endSession(), see design §7 invariant (1)
// and §3.1: this is the imperative half of resetMatchState().
export function resetSnapshotRef(): void {
  snapshotRef.current = null;
  snapshotRef.prev = null;
  snapshotRef.byId.clear();
  snapshotRef.meta.clear();
  snapshotRef.lastEventsT = -1;
  snapshotRef.localId = null;
  snapshotRef.shake = 0;
  snapshotRef.aim = { cursorX: 0, cursorY: 0, spellId: null, angle: 0, point: null, target: null };
}

const EMPTY_EVENTS: GameEvent[] = [];

// One-shot event drain for R3F (P4): mirrors renderer.js's `_lastSnapT`
// per-snapshot dedupe so events are processed exactly once regardless of how
// many consumers call this per frame.
export function consumeEvents(): GameEvent[] {
  const cur = snapshotRef.current;
  if (!cur || cur.t === snapshotRef.lastEventsT) return EMPTY_EVENTS;
  snapshotRef.lastEventsT = cur.t;
  return cur.events;
}
