// @vitest-environment jsdom
// Store-slice unit tests for useSettingsStore — design §8(d): "settingsStore
// round-trips each of the 8 keys to the EXACT legacy string." This store
// carries 7 of them (see the file header for why vwb-mute-list is out of
// scope for this frozen interface — it's owned by src/social.ts, already
// covered by test/social.test.mjs).
import { describe, it, expect, beforeEach, vi } from "vitest";
import { useSettingsStore } from "./useSettingsStore";
import { CFG } from "../config.js";

describe("useSettingsStore — exact legacy key round-trip", () => {
  beforeEach(() => {
    localStorage.clear();
    useSettingsStore.setState({
      name: "", character: CFG.DEFAULT_CHARACTER, region: "", onboarded: false,
      spellSlotHotkeys: [...CFG.DEFAULT_SPELL_SLOT_HOTKEYS],
      itemSlotHotkeys: [...CFG.DEFAULT_ITEM_SLOT_HOTKEYS],
      pttKey: CFG.SOCIAL.PTT_DEFAULT_KEY,
    });
  });

  it("vwb-name: raw string", () => {
    useSettingsStore.getState().setName("Carlo");
    expect(localStorage.getItem("vwb-name")).toBe("Carlo");
    expect(useSettingsStore.getState().name).toBe("Carlo");
  });

  it("vwb-character: raw string", () => {
    useSettingsStore.getState().setCharacter("frostbite");
    expect(localStorage.getItem("vwb-character")).toBe("frostbite");
    expect(useSettingsStore.getState().character).toBe("frostbite");
  });

  it("vwb-region: raw string (delegates to region.ts's setRegion)", () => {
    useSettingsStore.getState().setRegion("euw");
    expect(localStorage.getItem("vwb-region")).toBe("euw");
    expect(useSettingsStore.getState().region).toBe("euw");
  });

  it("vwb-onboarded-v1: raw \"1\"", () => {
    useSettingsStore.getState().setOnboarded(true);
    expect(localStorage.getItem("vwb-onboarded-v1")).toBe("1");
    expect(useSettingsStore.getState().onboarded).toBe(true);
  });

  it("vwb-ptt-key: raw KeyboardEvent.code", () => {
    const ok = useSettingsStore.getState().setPttKey("KeyD");
    expect(ok).toBe(true);
    expect(localStorage.getItem("vwb-ptt-key")).toBe("KeyD");
    expect(useSettingsStore.getState().pttKey).toBe("KeyD");
  });

  it("vwb-ptt-key: rejects a reserved code and does not persist it", () => {
    const before = localStorage.getItem("vwb-ptt-key");
    const ok = useSettingsStore.getState().setPttKey("Escape");
    expect(ok).toBe(false);
    expect(localStorage.getItem("vwb-ptt-key")).toBe(before);
  });

  it("vwb-spell-slot-hotkeys: JSON string[], normalized to uppercase per-index", () => {
    useSettingsStore.getState().setSpellSlotHotkey(0, "t");
    const stored = JSON.parse(localStorage.getItem("vwb-spell-slot-hotkeys") || "[]");
    expect(stored[0]).toBe("T");
    expect(stored).toHaveLength(CFG.SPELL_SLOT_COUNT);
    // Untouched slots fall back to CFG.DEFAULT_SPELL_SLOT_HOTKEYS.
    expect(stored[1]).toBe(CFG.DEFAULT_SPELL_SLOT_HOTKEYS[1]);
    expect(useSettingsStore.getState().spellSlotHotkeys).toEqual(stored);
  });

  it("vwb-item-slot-hotkeys: JSON string[], normalized to uppercase per-index", () => {
    useSettingsStore.getState().setItemSlotHotkey(0, "y");
    const stored = JSON.parse(localStorage.getItem("vwb-item-slot-hotkeys") || "[]");
    expect(stored[0]).toBe("Y");
    expect(stored).toHaveLength(CFG.ITEM_SLOT_COUNT);
    expect(useSettingsStore.getState().itemSlotHotkeys).toEqual(stored);
  });

  it("module init reads back whatever was in localStorage at import time (the actual round-trip)", async () => {
    localStorage.setItem("vwb-name", "Zeta");
    localStorage.setItem("vwb-character", "voidling");
    localStorage.setItem("vwb-region", "euw");
    localStorage.setItem("vwb-onboarded-v1", "1");
    localStorage.setItem("vwb-ptt-key", "KeyS");
    localStorage.setItem("vwb-spell-slot-hotkeys", JSON.stringify(["T", "E", "R", "Z", "X", "V"]));
    localStorage.setItem("vwb-item-slot-hotkeys", JSON.stringify(["Y", "8", "9", "0"]));

    vi.resetModules();
    const { useSettingsStore: freshStore } = await import("./useSettingsStore");
    const s = freshStore.getState();
    expect(s.name).toBe("Zeta");
    expect(s.character).toBe("voidling");
    expect(s.region).toBe("euw");
    expect(s.onboarded).toBe(true);
    expect(s.pttKey).toBe("KeyS");
    expect(s.spellSlotHotkeys[0]).toBe("T");
    expect(s.itemSlotHotkeys[0]).toBe("Y");
  });
});
