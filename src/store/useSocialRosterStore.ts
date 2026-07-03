// Reactive home for per-player PRESENCE (typing/afk/speaking) — design §9's
// p5-pause-chat scope (the roster status glyphs inside the mute-list panel,
// ui.js's `.rs-speak/.rs-type/.rs-afk`). Deliberately separate from
// `useRosterStore` (frozen, design §2 — its `PlayerMeta` shape has no room
// for these, and it's structural membership only) and from `useHudStore`
// (frozen; `Scoreboard.tsx`'s own header explicitly hands this off: "Mute/
// typing/speaking/AFK indicators are not rendered ... that's pause-chat/
// roster territory, not this HUD").
//
// Fed the same way `useDraftStore`'s header documents as the EXPECTED
// pattern for a sibling that needs its own snapshot-driven slice ("mirroring
// useHudStore's throttled-publish pattern"): `onNewSnapshot.ts` (the single
// per-tick fan-out point every other snapshot-driven store already goes
// through) gains ONE additive line calling `sync()` here, immediately next
// to its existing `useRosterStore.sync(...)` / `useHudStore.publish(...)`
// calls — see that file for the exact diff. `PlayerSnap.ty/afk/spk` (design
// types.ts) are already broadcast to every peer; this store just gives React
// a reactive place to read them from instead of the untouchable snapshotRef
// singleton (design §2: "P5 UI does NOT touch this").
import { create } from "zustand";
import type { PlayerSnap } from "../types";

export interface PresenceRow {
  typing: boolean;
  afk: boolean;
  speaking: boolean;
}

export interface SocialRosterState {
  presence: Record<string, PresenceRow>;
  sync(players: Pick<PlayerSnap, "id" | "ty" | "afk" | "spk">[]): void;
  reset(): void;
}

function presenceEqual(a: Record<string, PresenceRow>, b: Record<string, PresenceRow>): boolean {
  if (a === b) return true;
  const ak = Object.keys(a);
  const bk = Object.keys(b);
  if (ak.length !== bk.length) return false;
  for (const k of ak) {
    const pa = a[k];
    const pb = b[k];
    if (!pb || pa.typing !== pb.typing || pa.afk !== pb.afk || pa.speaking !== pb.speaking) return false;
  }
  return true;
}

export const useSocialRosterStore = create<SocialRosterState>()((set, get) => ({
  presence: {},

  sync(players) {
    const next: Record<string, PresenceRow> = {};
    for (const p of players) {
      next[p.id] = { typing: !!p.ty, afk: !!p.afk, speaking: !!p.spk };
    }
    // Value-gate like useRosterStore.sync — a stable roster with unchanged
    // presence produces zero renders even though this runs every tick.
    if (presenceEqual(get().presence, next)) return;
    set({ presence: next });
  },
  reset() {
    set({ presence: {} });
  },
}));
