// Derived HUD, throttled to ~8-10Hz — replaces the per-frame
// ui.updateHUD/updateAbilityBar/updateItemBar field *reads* (the legacy DOM
// writes themselves still run every tick via onNewSnapshot -> ui.* directly;
// this store is the React-facing summary P5 will subscribe to instead).
//
// publish() double-gates: a time throttle (cheap, checked first, avoids
// deriving a view on every 30Hz tick) and a content-equality check (skips
// set() entirely when the derived view didn't actually change even though
// the throttle window elapsed) — see design §7 invariant (3) and §8(b)'s
// "≤ceil(N·dur·HUD_HZ) (0 if view unchanged)" bound.
import { create } from "zustand";
import type { ActiveCastSnap, CooldownMap, Phase, PlayerMeta, Snapshot } from "../types";

export const HUD_HZ = 10;

export interface HudView {
  phase: Phase;
  round: number;
  timer: number;
  aliveCount: number;
  hp: number;
  mhp: number;
  charge: number;
  cast: ActiveCastSnap | null;
  cooldowns: CooldownMap;
  spellSlots: (string | null)[];
  items: string[];
  scoreboard: { id: string; name: string; k: number; d: number; s: number; alive: boolean }[];
}

export interface HudState {
  hud: HudView | null;
  _lastPublish: number;
  publish(snap: Snapshot, localId: string | null, meta: Map<string, PlayerMeta>): void;
  reset(): void;
}

function deriveHudView(snap: Snapshot, localId: string | null, meta: Map<string, PlayerMeta>): HudView {
  const me = snap.players.find((p) => p.id === localId) ?? null;
  // Timer rounded before compare (§3.3) — sub-second float noise would
  // otherwise defeat the content-equality gate on every accepted tick.
  const timer =
    snap.phase === "countdown" || snap.phase === "spellSelection"
      ? Math.ceil(Math.max(0, snap.timer))
      : Math.round(snap.playTime || 0);
  return {
    phase: snap.phase,
    round: snap.round,
    timer,
    aliveCount: snap.players.filter((p) => p.al !== false).length,
    hp: me?.hp ?? 0,
    mhp: me?.mhp ?? 0,
    charge: me?.c ?? 0,
    cast: me?.ca ? me.ca : null,
    cooldowns: me?.cds ?? {},
    spellSlots: me?.spellSlots ?? [],
    items: me?.items ?? [],
    scoreboard: snap.players.map((p) => ({
      id: p.id,
      name: meta.get(p.id)?.name ?? "warlock",
      k: p.k,
      d: p.d,
      s: p.s,
      alive: p.al !== false,
    })),
  };
}

// Plain-data (JSON-safe) equality — HudView has no functions/Dates/Maps, so
// stringify-compare is correct and simple at this call rate (≤HUD_HZ).
function hudViewEqual(a: HudView, b: HudView): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export const useHudStore = create<HudState>()((set, get) => ({
  hud: null,
  _lastPublish: 0,

  publish(snap, localId, meta) {
    const now = performance.now();
    const state = get();
    if (now - state._lastPublish < 1000 / HUD_HZ) return;
    const view = deriveHudView(snap, localId, meta);
    if (state.hud && hudViewEqual(state.hud, view)) return;
    set({ hud: view, _lastPublish: now });
  },
  reset() {
    set({ hud: null, _lastPublish: 0 });
  },
}));
