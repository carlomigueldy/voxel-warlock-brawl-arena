// @vitest-environment jsdom
// Store-slice unit tests for useLobbyConfigStore (design §3) — defaults
// match legacy's own DOM-driven defaults, setters clamp/validate the same
// way ui.js's getBotSettings()/getArenaSettings() did, and enabledObstacles
// is the one field that persists (mirrors ui.js's vwb-map-objects writer).
import { describe, it, expect, beforeEach } from "vitest";
import { CFG } from "../config.js";
import { useLobbyConfigStore } from "./useLobbyConfigStore";

const MAP_OBJECTS_KEY = "vwb-map-objects";

beforeEach(() => {
  localStorage.clear();
  useLobbyConfigStore.getState().reset();
});

describe("useLobbyConfigStore", () => {
  it("defaults match legacy's own DOM defaults (index.html botCount=0, botSkill=smart, CFG arena/land defaults, mobs on)", () => {
    const s = useLobbyConfigStore.getState();
    expect(s.botCount).toBe(0);
    expect(s.botSkill).toBe("smart");
    expect(s.arenaWorld).toBe(CFG.DEFAULT_ARENA_WORLD);
    expect(s.landSize).toBe(CFG.DEFAULT_ARENA_LAND_SIZE);
    expect(s.mobsEnabled).toBe(true);
    expect(s.enabledObstacles).toEqual(CFG.DEFAULT_OBSTACLE_TOGGLES);
  });

  it("setBotCount clamps to [0, MAX_PLAYERS - 1], same as ui.js's getBotSettings()", () => {
    useLobbyConfigStore.getState().setBotCount(-5);
    expect(useLobbyConfigStore.getState().botCount).toBe(0);
    useLobbyConfigStore.getState().setBotCount(999);
    expect(useLobbyConfigStore.getState().botCount).toBe(CFG.MAX_PLAYERS - 1);
    useLobbyConfigStore.getState().setBotCount(2);
    expect(useLobbyConfigStore.getState().botCount).toBe(2);
  });

  it("setBotSkill rejects an invalid skill, falling back to smart", () => {
    useLobbyConfigStore.getState().setBotSkill("brilliant");
    expect(useLobbyConfigStore.getState().botSkill).toBe("brilliant");
    useLobbyConfigStore.getState().setBotSkill("not-a-skill");
    expect(useLobbyConfigStore.getState().botSkill).toBe("smart");
  });

  it("setArenaWorld/setLandSize reject unknown ids, falling back to CFG defaults", () => {
    useLobbyConfigStore.getState().setArenaWorld("islands");
    expect(useLobbyConfigStore.getState().arenaWorld).toBe("islands");
    useLobbyConfigStore.getState().setArenaWorld("not-a-world");
    expect(useLobbyConfigStore.getState().arenaWorld).toBe(CFG.DEFAULT_ARENA_WORLD);

    useLobbyConfigStore.getState().setLandSize("large");
    expect(useLobbyConfigStore.getState().landSize).toBe("large");
    useLobbyConfigStore.getState().setLandSize("not-a-size");
    expect(useLobbyConfigStore.getState().landSize).toBe(CFG.DEFAULT_ARENA_LAND_SIZE);
  });

  it("setMobsEnabled just sets the flag", () => {
    useLobbyConfigStore.getState().setMobsEnabled(false);
    expect(useLobbyConfigStore.getState().mobsEnabled).toBe(false);
  });

  it("setObstacleEnabled updates one key without disturbing the rest, and persists to vwb-map-objects", () => {
    useLobbyConfigStore.getState().setObstacleEnabled("tree", false);
    const s = useLobbyConfigStore.getState();
    expect(s.enabledObstacles.tree).toBe(false);
    expect(s.enabledObstacles.stone).toBe(true); // untouched

    const persisted = JSON.parse(localStorage.getItem(MAP_OBJECTS_KEY) || "{}");
    expect(persisted.tree).toBe(false);
  });

  it("a fresh store read picks up a previously persisted vwb-map-objects override", () => {
    localStorage.setItem(MAP_OBJECTS_KEY, JSON.stringify({ tree: false, boulder: false }));
    useLobbyConfigStore.getState().reset();
    const s = useLobbyConfigStore.getState();
    expect(s.enabledObstacles.tree).toBe(false);
    expect(s.enabledObstacles.boulder).toBe(false);
    expect(s.enabledObstacles.stone).toBe(true); // not in the saved override -> falls back to CFG default
  });

  it("reset() restores every field to its default", () => {
    useLobbyConfigStore.getState().setBotCount(3);
    useLobbyConfigStore.getState().setMobsEnabled(false);
    useLobbyConfigStore.getState().reset();
    const s = useLobbyConfigStore.getState();
    expect(s.botCount).toBe(0);
    expect(s.mobsEnabled).toBe(true);
  });
});
