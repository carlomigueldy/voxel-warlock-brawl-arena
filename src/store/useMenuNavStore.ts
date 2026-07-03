// Ephemeral menu spine sub-screen — design §3 point 3: React UI state that
// does NOT belong in a persisted store (no legacy `vwb-*` key backs this;
// legacy `ui.js` tracks the same thing as a private `_menuScreen` field,
// default "online" — see `_showMenuScreen`/the constructor). p5-menu (the
// sibling that builds the actual nav rail + screens) reads/writes this
// instead of adding its own ad-hoc component state, so the "which sub-screen
// is active" question has exactly one answer regardless of which component
// asks.
import { create } from "zustand";

export type MenuScreen = "online" | "private" | "characters" | "leaderboards" | "account" | "tutorial";

export interface MenuNavState {
  screen: MenuScreen;
  setScreen(screen: MenuScreen): void;
}

export const useMenuNavStore = create<MenuNavState>()((set) => ({
  screen: "online",
  setScreen(screen) {
    set({ screen });
  },
}));
