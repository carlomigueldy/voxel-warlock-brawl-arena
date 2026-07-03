// Very-low-frequency reactive session state (main.js module-level `role`,
// `sessionGen`, `inGame`, screen-transition calls). Owns sessionGen — bumped
// on startSession/endSession the same way main.js bumped its module-level
// `sessionGen++` to stop stale rAF loops (useHostLoop/useClientLoop capture
// the generation they were started with and bail once it no longer matches).
//
// This store imports NO net/voice/audio: endSession() only flips the
// reactive half of resetMatchState() (screen → menu, sessionGen bump). The
// imperative teardown (host.destroy()/client.destroy()/voice.teardown()/
// resetSnapshotRef()) lives in the session hook that subscribes to
// sessionGen, per design §7 invariant (1) — snapshotRef writes never set() a
// store, and conversely this store never reaches into snapshotRef/net.
import { create } from "zustand";
import type { Phase } from "../types";

export type Role = "host" | "client" | null;
export type AppScreen = "loading" | "menu" | "lobby" | "game";

export interface SessionState {
  sessionGen: number;
  role: Role;
  screen: AppScreen;
  phase: Phase | null;
  inGame: boolean;
  roomCode: string | null;
  isHost: boolean;
  /** Bumps sessionGen, sets role, clears prior match state. Returns the new
   * generation so the caller (useGameSession) can capture it for its loop. */
  startSession(role: Exclude<Role, null>): number;
  setScreen(s: AppScreen): void;
  setPhase(p: Phase): void;
  setInGame(v: boolean): void;
  setRoom(code: string | null, isHost: boolean): void;
  /** Reactive half of resetMatchState(): bumps sessionGen (stops the running
   * loop) and returns to the menu screen. */
  endSession(): void;
}

export const useSessionStore = create<SessionState>()((set, get) => ({
  sessionGen: 0,
  role: null,
  screen: "loading",
  phase: null,
  inGame: false,
  roomCode: null,
  isHost: false,

  startSession(role) {
    const sessionGen = get().sessionGen + 1;
    set({ sessionGen, role, inGame: false, roomCode: null, isHost: false, phase: null });
    return sessionGen;
  },
  setScreen(screen) {
    if (get().screen !== screen) set({ screen });
  },
  setPhase(phase) {
    if (get().phase !== phase) set({ phase });
  },
  setInGame(inGame) {
    if (get().inGame !== inGame) set({ inGame });
  },
  setRoom(roomCode, isHost) {
    set({ roomCode, isHost });
  },
  endSession() {
    set((state) => ({
      sessionGen: state.sessionGen + 1,
      role: null,
      screen: "menu",
      phase: null,
      inGame: false,
      roomCode: null,
      isHost: false,
    }));
  },
}));
