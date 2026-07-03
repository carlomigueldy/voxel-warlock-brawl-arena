// Ephemeral LOCAL-player draft-overlay interaction state — design §3 point 3
// (React UI state that does not belong in a persisted store).
//
// IMPORTANT scope note (documented per the brief's "P5a picks and
// documents"): the AUTHORITATIVE per-player draft result (every player's
// picks + ready flag) is already server-driven data on the snapshot
// (`Snapshot.players[].draftPick`/`draftReady` — see src/types.ts) that
// flows through `onNewSnapshot` like the rest of gameplay state; it is NOT
// duplicated here, and this store must never be treated as the source of
// truth for anyone's picks but the local player's own in-progress
// selection. p5-draft (the sibling that builds the actual overlay) is
// expected to add its own snapshot-driven slice (mirroring useHudStore's
// throttled-publish pattern) for the authoritative multiplayer view, and
// use THIS store only for the local player's optimistic/pre-submit UI
// state below — the fields a snapshot has no concept of because they never
// leave the client (which slot is mid-selection, a client-side countdown
// tick, a loadout template shortcut) or are optimistic mirrors submitted
// via `gameSessionRef.current.draft(action)` ahead of snapshot confirmation.
import { create } from "zustand";

export interface DraftState {
  /** Local player's picks so far, in pick order — optimistic; reconciled
   * against the authoritative `Snapshot.players[].draftPick` once p5-draft's
   * own snapshot slice confirms it. */
  picks: string[];
  /** Client-side countdown display (seconds) the overlay ticks between
   * snapshot updates; p5-draft resyncs it from `Snapshot.timer` on each new
   * snapshot rather than trusting a free-running client clock alone. */
  timer: number;
  /** Whether the local player has clicked "Ready" — optimistic; reconciled
   * against `Snapshot.players[].draftReady`. */
  ready: boolean;
  /** Selected quick-loadout preset, if the overlay offers one (no legacy DOM
   * equivalent — a new UX affordance p5-draft may use or ignore). */
  template: string | null;

  setPicks(picks: string[]): void;
  addPick(id: string): void;
  setTimer(seconds: number): void;
  setReady(ready: boolean): void;
  setTemplate(template: string | null): void;
  reset(): void;
}

function defaults() {
  return { picks: [] as string[], timer: 0, ready: false, template: null as string | null };
}

export const useDraftStore = create<DraftState>()((set, get) => ({
  ...defaults(),

  setPicks(picks) {
    set({ picks });
  },
  addPick(id) {
    set({ picks: [...get().picks, id] });
  },
  setTimer(seconds) {
    set({ timer: seconds });
  },
  setReady(ready) {
    set({ ready });
  },
  setTemplate(template) {
    set({ template });
  },
  reset() {
    set(defaults());
  },
}));
