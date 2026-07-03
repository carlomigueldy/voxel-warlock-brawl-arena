// @vitest-environment jsdom
// Unit coverage for the design §3 UI-input adapter — both branches. The
// legacy branch is exercised against a stubbed getUI() (constructing the
// real `UI` class pulls in the whole DOM-heavy legacy engine, which is not
// what this adapter-routing test is about) rather than reloading flags.ts
// against a different `location.search`; see the store/mode reset helpers
// below for why each test gets a clean slate.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { getUiInputs } from "./getUiInputs";
import { useSettingsStore } from "../store/useSettingsStore";
import { useLobbyConfigStore } from "../store/useLobbyConfigStore";
import { useSocialPrefsStore } from "../store/useSocialPrefsStore";
import * as registry from "../services/registry";

const legacyUiStub = {
  getName: vi.fn(() => "LegacyName"),
  getCharacter: vi.fn(() => "ember"),
  getBotSettings: vi.fn(() => ({ count: 3, skill: "expert" })),
  getArenaSettings: vi.fn(() => ({ arenaWorld: "islands", landSize: "large", enabledObstacles: { tree: false } })),
  mobsEnabled: vi.fn(() => false),
  getSocialPrefs: vi.fn(() => ({ micEnabled: true, masterVolume: 0.7, showBubbles: false, pttKey: "KeyQ" })),
};

beforeEach(() => {
  vi.restoreAllMocks();
  for (const fn of Object.values(legacyUiStub)) fn.mockClear();
  vi.spyOn(registry, "getUI").mockReturnValue(legacyUiStub as unknown as ReturnType<typeof registry.getUI>);
  localStorage.clear();

  useLobbyConfigStore.getState().reset();
  useDraftlessReset();
});

// Keeps the reactive stores at a known, non-default state so a "legacy mode
// ignores the react stores entirely" assertion is meaningful (if the adapter
// ever accidentally read the wrong source, these values would leak through).
function useDraftlessReset() {
  useSettingsStore.setState({ name: "ReactName", character: "frostbite" });
  useLobbyConfigStore.getState().setBotCount(5);
  useLobbyConfigStore.getState().setBotSkill("brilliant");
  useLobbyConfigStore.getState().setArenaWorld("bridge");
  useLobbyConfigStore.getState().setLandSize("small");
  useLobbyConfigStore.getState().setMobsEnabled(true);
  useSocialPrefsStore.setState({ micEnabled: false, masterVolume: 0.2, showBubbles: true, pttKey: "Backquote" });
}

describe("getUiInputs", () => {
  it("legacy mode reads every field from getUI(), untouched by react-store state", () => {
    const result = getUiInputs("legacy");
    expect(result).toEqual({
      name: "LegacyName",
      character: "ember",
      botSettings: { count: 3, skill: "expert" },
      arenaSettings: { arenaWorld: "islands", landSize: "large", enabledObstacles: { tree: false } },
      mobsEnabled: false,
      socialPrefs: { micEnabled: true, masterVolume: 0.7, showBubbles: false, pttKey: "KeyQ" },
    });
    expect(legacyUiStub.getName).toHaveBeenCalled();
    expect(legacyUiStub.getBotSettings).toHaveBeenCalled();
  });

  it("react mode reads name/character from useSettingsStore and bot/arena/mobs/social from the P5a stores, never touching getUI()", () => {
    const result = getUiInputs("react");
    expect(result).toEqual({
      name: "ReactName",
      character: "frostbite",
      botSettings: { count: 5, skill: "brilliant" },
      arenaSettings: { arenaWorld: "bridge", landSize: "small", enabledObstacles: useLobbyConfigStore.getState().enabledObstacles },
      mobsEnabled: true,
      socialPrefs: { micEnabled: false, masterVolume: 0.2, showBubbles: true, pttKey: "Backquote" },
    });
    expect(legacyUiStub.getName).not.toHaveBeenCalled();
    expect(legacyUiStub.getBotSettings).not.toHaveBeenCalled();
  });

  it("react mode reflects live store updates (it's a read, not a snapshot taken once)", () => {
    useLobbyConfigStore.getState().setBotCount(1);
    expect(getUiInputs("react").botSettings.count).toBe(1);
    useLobbyConfigStore.getState().setBotCount(4);
    expect(getUiInputs("react").botSettings.count).toBe(4);
  });

  it("defaults to the real UI_MODE flag when no mode argument is given", () => {
    // This repo's default flags.ts resolution (no ?ui= param) is "legacy" —
    // the same default useGameSession's real (unparameterized) call site
    // relies on.
    const result = getUiInputs();
    expect(result.name).toBe("LegacyName");
    expect(legacyUiStub.getName).toHaveBeenCalled();
  });
});
