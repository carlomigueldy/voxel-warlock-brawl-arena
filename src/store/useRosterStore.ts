// Structural membership only (spawn/despawn) — holds ID SETS, not positions.
// Positions/rotations/etc. live in snapshotRef (non-reactive, read every
// frame in useFrame/legacy rAF); this store fires a React update only when
// something mounts or unmounts (a bolt fired, a player joined, a mob died,
// ...), which in a typical tick is a no-op. Runs at sim tick rate (30/s) via
// onNewSnapshot, but set() fires roughly once per spawn/despawn event —
// see design §7 invariant (2).
//
// Subscribers (P4): <PlayersLayer>/<MobsLayer>/<BoltsLayer>/<MeteorsLayer>/
// <ItemsLayer> map ids to <Entity key={id}/>, and the scoreboard reads
// `meta`. Entities read snapshotRef.byId per frame for position — they do
// NOT subscribe to this store for motion.
import { create } from "zustand";
import type { PlayerMeta, Snapshot } from "../types";

export interface RosterSync {
  playerIds: string[];
  boltIds: number[];
  mobIds: string[];
  meteorIds: number[];
  itemIds: number[];
  meta: Record<string, PlayerMeta>;
}

export interface RosterState extends RosterSync {
  /** Value-gates every field independently; calls set() only for the fields
   * that actually changed (and not at all if nothing changed) — the whole
   * point being that a 30Hz tick with a stable roster produces zero renders. */
  sync(next: RosterSync): void;
  reset(): void;
}

function arraysEqual<T>(a: readonly T[], b: readonly T[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function metaEqual(a: Record<string, PlayerMeta>, b: Record<string, PlayerMeta>): boolean {
  if (a === b) return true;
  const ak = Object.keys(a);
  const bk = Object.keys(b);
  if (ak.length !== bk.length) return false;
  for (const k of ak) if (a[k] !== b[k]) return false;
  return true;
}

const EMPTY: RosterSync = { playerIds: [], boltIds: [], mobIds: [], meteorIds: [], itemIds: [], meta: {} };

export const useRosterStore = create<RosterState>()((set, get) => ({
  ...EMPTY,

  sync(next) {
    const state = get();
    const patch: Partial<RosterSync> = {};
    let changed = false;
    if (!arraysEqual(state.playerIds, next.playerIds)) { patch.playerIds = next.playerIds; changed = true; }
    if (!arraysEqual(state.boltIds, next.boltIds)) { patch.boltIds = next.boltIds; changed = true; }
    if (!arraysEqual(state.mobIds, next.mobIds)) { patch.mobIds = next.mobIds; changed = true; }
    if (!arraysEqual(state.meteorIds, next.meteorIds)) { patch.meteorIds = next.meteorIds; changed = true; }
    if (!arraysEqual(state.itemIds, next.itemIds)) { patch.itemIds = next.itemIds; changed = true; }
    if (!metaEqual(state.meta, next.meta)) { patch.meta = next.meta; changed = true; }
    // Deliberately skip set() entirely when nothing changed — calling
    // set({}) would still bump the store's top-level object reference and
    // notify every vanilla `.subscribe()` listener even though no field
    // actually differs.
    if (changed) set(patch);
  },
  reset() {
    set({ ...EMPTY });
  },
}));

/** Pure helper: reduces a full sim Snapshot + the meta map to the shape
 * useRosterStore.sync() expects. Called from onNewSnapshot every tick. */
export function deriveRoster(snap: Snapshot, meta: Map<string, PlayerMeta>): RosterSync {
  return {
    playerIds: snap.players.map((p) => p.id),
    boltIds: snap.bolts.map((b) => b.id),
    mobIds: snap.mobs.map((m) => m.id),
    meteorIds: snap.meteors.map((m) => m.id),
    itemIds: snap.items.map((i) => i.id),
    meta: Object.fromEntries(meta),
  };
}
