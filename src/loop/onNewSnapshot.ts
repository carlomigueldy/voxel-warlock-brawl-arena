// Per-snapshot fan-out — ports main.js's hostLoop/clientLoop per-tick body
// (lines 391-405 / 513-519) minus the actual render() call, which now lives
// in its own rAF inside LegacyRendererBridge (design §5.2) / R3F (P4).
// Called once per new snapshot by useHostLoop (after every broadcast) and
// useClientLoop's net hook (after the staleness gate). Wrapped in try/catch
// so a fan-out bug can never block the next host.broadcast — the loop that
// calls this must keep running regardless (design §6.3 / a Hard rule: the
// authoritative loop's sim.step + broadcast are never inside this guard).
import { PHASE } from "../sim.js";
import type { Snapshot } from "../types";
import { snapshotRef, pushSnapshot } from "../store/snapshotRef";
import { useRosterStore, deriveRoster } from "../store/useRosterStore";
import { useHudStore } from "../store/useHudStore";
import { useDraftStore } from "../store/useDraftStore";
import { useSocialRosterStore } from "../store/useSocialRosterStore";
import { useSessionStore } from "../store/useSessionStore";
import { getUI, getAudio, getInput } from "../services/registry";

function syncLocalSpellSlots(snap: Snapshot, localId: string | null): void {
  const me = snap.players.find((p) => p.id === localId);
  if (!me) return;
  const input = getInput();
  if (me.spellSlots) input.setSpellSlots(me.spellSlots);
  if (me.items) input.setItemSlots(me.items);
}

// Module-scoped transition-cue state — mirrors main.js's module-level
// `_lastPhase`/`_lastCount` (one game session's worth of "have we already
// played this cue" bookkeeping; reset implicitly by page reload / next
// session's first snapshot naturally re-triggering since these start null).
let _lastPhase: Snapshot["phase"] | null = null;
let _lastCount: number | null = null;

function audioTransitions(snap: Snapshot, localId: string | null): void {
  const audio = getAudio();
  if (snap.phase === PHASE.COUNTDOWN) {
    const c = Math.ceil(snap.timer);
    if (c !== _lastCount && c > 0) {
      audio.play("countdown");
      _lastCount = c;
    }
  } else if (_lastPhase === PHASE.COUNTDOWN && snap.phase === PHASE.PLAYING) {
    audio.play("go");
    _lastCount = null;
  }
  if (snap.phase !== _lastPhase) {
    if (snap.phase === PHASE.ROUND_END) {
      audio.play(snap.winner === localId ? "win" : "lose");
    } else if (snap.phase === PHASE.MATCH_END) {
      audio.play(snap.matchWinner === localId ? "win" : "lose");
    }
    _lastPhase = snap.phase;
  }
}

export function onNewSnapshot(snap: Snapshot, localId: string | null): void {
  try {
    pushSnapshot(snap);
    useRosterStore.getState().sync(deriveRoster(snap, snapshotRef.meta));
    useHudStore.getState().publish(snap, localId, snapshotRef.meta);
    useDraftStore.getState().publish(snap, localId);
    // Presence-only slice (typing/afk/speaking) for the pause-chat roster's
    // status glyphs — useRosterStore.meta/useHudStore.scoreboard have no room
    // for these (see useSocialRosterStore.ts's header); same fan-out point,
    // same value-gated sync() pattern as the two calls above.
    useSocialRosterStore.getState().sync(snap.players);
    if (snap.phase !== useSessionStore.getState().phase) {
      useSessionStore.getState().setPhase(snap.phase);
    }
    syncLocalSpellSlots(snap, localId);
    audioTransitions(snap, localId);

    // Legacy-UI-only: drives the actual DOM (ui.js owns display; useHudStore
    // above is the React-facing summary P5 will subscribe to instead).
    if (snap.phase !== PHASE.LOBBY) {
      const ui = getUI();
      ui.updateHUD(snap, localId, snapshotRef.meta);
      ui.handleEvents(snap.events, snap.t);
      ui.updateAbilityBar(snap, localId);
      ui.updateItemBar(snap, localId);
    }
  } catch (err) {
    console.error("[onNewSnapshot] fan-out error (continuing):", err);
  }
}
