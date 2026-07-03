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
//
// p5-draft's snapshot-driven slice (additive, below `publish`): legacy's own
// draft overlay has NO client-side optimism either — `showSpellDraft`/
// `_refreshDraftOverlay` redraw straight from the snapshot every frame, so a
// non-host client's toggle only visibly lands once the host's next broadcast
// round-trips back. DraftOverlay ports that same zero-optimism behavior
// (avoids a flicker where an optimistic local toggle gets clobbered by a
// slightly-stale in-flight snapshot for a non-host client) — `picks`/`ready`/
// `timer` above are therefore ALSO the fields `publish()` below writes,
// throttled/equality-gated exactly like useHudStore's publish. The pre-submit
// setters (setPicks/addPick/setReady) stay available (existing, tested) for
// any future optimistic-UI use; DraftOverlay itself only reads what publish()
// populates. `timer` is the CEILED display value (matches HudView's own
// rounding rationale — sub-second float noise would defeat the equality
// gate), and urgency (`timer <= 8`) is evaluated against that same ceiled
// value the user actually sees.
import { create } from "zustand";
import type { Snapshot } from "../types";

export const DRAFT_HZ = 10; // matches useHudStore's HUD_HZ throttle cadence

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

  /** True while `Snapshot.phase === "spellSelection"` — the "your draft
   * store/snapshot flag" DraftOverlay gates its render on (design §9). */
  active: boolean;
  _lastPublish: number;

  setPicks(picks: string[]): void;
  addPick(id: string): void;
  setTimer(seconds: number): void;
  setReady(ready: boolean): void;
  setTemplate(template: string | null): void;
  /** Throttled (DRAFT_HZ) + equality-gated snapshot publish — mirrors
   * useHudStore.publish. Called from onNewSnapshot (one additive line,
   * design §3 point 3's "own snapshot-driven slice"). */
  publish(snap: Snapshot, localId: string | null): void;
  reset(): void;
}

function defaults() {
  return {
    picks: [] as string[],
    timer: 0,
    ready: false,
    template: null as string | null,
    active: false,
    _lastPublish: 0,
  };
}

function picksEqual(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((id, i) => id === b[i]);
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
  publish(snap, localId) {
    const now = performance.now();
    const state = get();
    if (now - state._lastPublish < 1000 / DRAFT_HZ) return;
    const active = snap.phase === "spellSelection";
    const me = snap.players.find((p) => p.id === localId);
    const picks = me?.draftPick ?? [];
    const ready = me?.draftReady ?? false;
    const timer = Math.ceil(Math.max(0, snap.timer));
    if (state.active === active && state.ready === ready && state.timer === timer && picksEqual(state.picks, picks)) {
      set({ _lastPublish: now });
      return;
    }
    set({ active, picks, ready, timer, _lastPublish: now });
  },
  reset() {
    set(defaults());
  },
}));
