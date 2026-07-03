// Reactive home for the host-lobby config inputs `useGameSession` reads via
// `ui.getBotSettings()/getArenaSettings()/mobsEnabled()` under `?ui=legacy`
// (design §3 — the P5a store extension additive to P3a). Under `?ui=react`,
// getUiInputs() (src/loop/getUiInputs.ts) reads THIS store instead.
//
// Only `enabledObstacles` is persisted — it mirrors legacy `ui.js`'s
// `_getEnabledObstacles()`/`_saveMapObjects()` single-writer over the
// `vwb-map-objects` key (design §0's "4 keys NOT yet on a store"). bot
// count/skill and arena world/land size are NOT persisted in legacy either
// (`getBotSettings()`/`getArenaSettings()` read live DOM form state, not
// localStorage) — this store's defaults below match those same legacy
// defaults (index.html's `#bot-count` value="0", `#bot-skill`'s first
// option "smart", `CFG.DEFAULT_ARENA_WORLD`/`DEFAULT_ARENA_LAND_SIZE`), so
// switching `?ui=react` on for the first time starts from an identical
// lobby config. Deliberately NO Zustand persist middleware — same reasoning
// as useSettingsStore (a persist envelope would double-serialize the one key
// that already has a single writer).
import { create } from "zustand";
import { CFG } from "../config.js";
import type { ObstacleTypeId } from "../types";

const MAP_OBJECTS_KEY = "vwb-map-objects";

function loadEnabledObstacles(): Record<ObstacleTypeId, boolean> {
  let saved: Partial<Record<ObstacleTypeId, boolean>> = {};
  try {
    saved = JSON.parse(localStorage.getItem(MAP_OBJECTS_KEY) || "{}");
  } catch {
    saved = {};
  }
  return { ...CFG.DEFAULT_OBSTACLE_TOGGLES, ...saved };
}

function persistEnabledObstacles(state: Record<ObstacleTypeId, boolean>): void {
  try {
    localStorage.setItem(MAP_OBJECTS_KEY, JSON.stringify(state));
  } catch {
    // Ignore storage errors (private browsing, quota, ...) — matches every
    // other single-writer helper in this codebase.
  }
}

export interface LobbyConfigState {
  botCount: number;
  botSkill: string;
  arenaWorld: string;
  landSize: string;
  mobsEnabled: boolean;
  enabledObstacles: Record<ObstacleTypeId, boolean>;

  setBotCount(count: number): void;
  setBotSkill(skill: string): void;
  setArenaWorld(worldId: string): void;
  setLandSize(landSizeId: string): void;
  setMobsEnabled(enabled: boolean): void;
  setObstacleEnabled(id: ObstacleTypeId, enabled: boolean): void;
  reset(): void;
}

function defaults() {
  return {
    botCount: 0,
    botSkill: "smart",
    arenaWorld: CFG.DEFAULT_ARENA_WORLD,
    landSize: CFG.DEFAULT_ARENA_LAND_SIZE,
    mobsEnabled: true,
    enabledObstacles: loadEnabledObstacles(),
  };
}

export const useLobbyConfigStore = create<LobbyConfigState>()((set, get) => ({
  ...defaults(),

  setBotCount(count) {
    // Mirrors ui.js's getBotSettings() clamp: [0, CFG.MAX_PLAYERS - 1].
    const clamped = Math.max(0, Math.min(CFG.MAX_PLAYERS - 1, Math.trunc(count) || 0));
    set({ botCount: clamped });
  },
  setBotSkill(skill) {
    set({ botSkill: CFG.BOT_SKILLS.includes(skill) ? skill : "smart" });
  },
  setArenaWorld(worldId) {
    set({ arenaWorld: CFG.ARENA_WORLDS.some((w) => w.id === worldId) ? worldId : CFG.DEFAULT_ARENA_WORLD });
  },
  setLandSize(landSizeId) {
    set({ landSize: CFG.ARENA_LAND_SIZES[landSizeId] ? landSizeId : CFG.DEFAULT_ARENA_LAND_SIZE });
  },
  setMobsEnabled(enabled) {
    set({ mobsEnabled: enabled });
  },
  setObstacleEnabled(id, enabled) {
    const next = { ...get().enabledObstacles, [id]: enabled };
    persistEnabledObstacles(next);
    set({ enabledObstacles: next });
  },
  reset() {
    set(defaults());
  },
}));
