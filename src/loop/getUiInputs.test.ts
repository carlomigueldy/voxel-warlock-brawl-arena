// @vitest-environment jsdom
// Unit coverage for the design §3 UI-input adapter. P6 deletes the legacy
// `ui.getX()` branch this used to also cover (getUI() no longer exists) —
// only the store-backed read path remains.
import { describe, it, expect, beforeEach } from "vitest";
import { getUiInputs } from "./getUiInputs";
import { useSettingsStore } from "../store/useSettingsStore";
import { useLobbyConfigStore } from "../store/useLobbyConfigStore";
import { useSocialPrefsStore } from "../store/useSocialPrefsStore";

beforeEach(() => {
  localStorage.clear();
  useLobbyConfigStore.getState().reset();
  useSettingsStore.setState({ name: "ReactName", character: "frostbite" });
  useLobbyConfigStore.getState().setBotCount(5);
  useLobbyConfigStore.getState().setBotSkill("brilliant");
  useLobbyConfigStore.getState().setArenaWorld("bridge");
  useLobbyConfigStore.getState().setLandSize("small");
  useLobbyConfigStore.getState().setMobsEnabled(true);
  useSocialPrefsStore.setState({ micEnabled: false, masterVolume: 0.2, showBubbles: true, pttKey: "Backquote" });
});

describe("getUiInputs", () => {
  it("reads name/character from useSettingsStore and bot/arena/mobs/social from the P5a stores", () => {
    const result = getUiInputs();
    expect(result).toEqual({
      name: "ReactName",
      character: "frostbite",
      botSettings: { count: 5, skill: "brilliant" },
      arenaSettings: { arenaWorld: "bridge", landSize: "small", enabledObstacles: useLobbyConfigStore.getState().enabledObstacles },
      mobsEnabled: true,
      socialPrefs: { micEnabled: false, masterVolume: 0.2, showBubbles: true, pttKey: "Backquote" },
    });
  });

  it("reflects live store updates (it's a read, not a snapshot taken once)", () => {
    useLobbyConfigStore.getState().setBotCount(1);
    expect(getUiInputs().botSettings.count).toBe(1);
    useLobbyConfigStore.getState().setBotCount(4);
    expect(getUiInputs().botSettings.count).toBe(4);
  });
});
