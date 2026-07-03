// Ephemeral UI intents — NOT persisted (see useSettingsStore for the 8
// persisted keys). P3a wires this store to legacy ui.js via
// wireLegacyUiToStores (store -> ui.set*/render* on subscribe); P5 swaps the
// legacy DOM subscribers for React components reading this store directly.
import { create } from "zustand";
import type { AppUser, LeaderboardMetric, LeaderboardRow } from "../types";

export interface QueueState {
  searching: boolean;
  status?: string;
  canCancel: boolean;
}

export type LeaderboardScope = "global" | "region";

export interface LeaderboardState {
  rows: LeaderboardRow[];
  metric: LeaderboardMetric;
  scope: LeaderboardScope;
}

export interface UiState {
  menuStatus: string;
  lobbyStatus: string;
  onlineEnabled: boolean;
  queue: QueueState;
  paused: boolean;
  chatOpen: boolean;
  authView: AppUser | null;
  leaderboard: LeaderboardState;

  setMenuStatus(s: string): void;
  setLobbyStatus(s: string): void;
  setOnlineEnabled(v: boolean): void;
  setQueue(q: Partial<QueueState>): void;
  setPaused(v: boolean): void;
  setChatOpen(v: boolean): void;
  setAuthView(user: AppUser | null): void;
  setLeaderboard(rows: LeaderboardRow[], meta: { metric: LeaderboardMetric; scope: LeaderboardScope }): void;
}

export const useUiStore = create<UiState>()((set, get) => ({
  menuStatus: "",
  lobbyStatus: "",
  onlineEnabled: false,
  queue: { searching: false, status: undefined, canCancel: false },
  paused: false,
  chatOpen: false,
  authView: null,
  leaderboard: { rows: [], metric: "wins", scope: "global" },

  setMenuStatus(menuStatus) { set({ menuStatus }); },
  setLobbyStatus(lobbyStatus) { set({ lobbyStatus }); },
  setOnlineEnabled(onlineEnabled) { set({ onlineEnabled }); },
  setQueue(patch) { set({ queue: { ...get().queue, ...patch } }); },
  setPaused(paused) { set({ paused }); },
  setChatOpen(chatOpen) { set({ chatOpen }); },
  setAuthView(authView) { set({ authView }); },
  setLeaderboard(rows, { metric, scope }) { set({ leaderboard: { rows, metric, scope } }); },
}));
