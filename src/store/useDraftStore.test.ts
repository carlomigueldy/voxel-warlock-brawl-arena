// Store-slice unit tests for useDraftStore (design §3 point 3) — pure
// ephemeral local-player interaction state, no persistence. See the store's
// header for why this never carries other players' picks (that's the
// snapshot-driven authoritative state a sibling adds separately).
import { describe, it, expect, beforeEach } from "vitest";
import { useDraftStore } from "./useDraftStore";

beforeEach(() => {
  useDraftStore.getState().reset();
});

describe("useDraftStore", () => {
  it("defaults to an empty, not-ready, timer-zero, template-less state", () => {
    const s = useDraftStore.getState();
    expect(s.picks).toEqual([]);
    expect(s.timer).toBe(0);
    expect(s.ready).toBe(false);
    expect(s.template).toBeNull();
  });

  it("addPick appends without disturbing existing picks; setPicks replaces wholesale", () => {
    useDraftStore.getState().addPick("fireball");
    useDraftStore.getState().addPick("frostbolt");
    expect(useDraftStore.getState().picks).toEqual(["fireball", "frostbolt"]);

    useDraftStore.getState().setPicks(["arcane-orb"]);
    expect(useDraftStore.getState().picks).toEqual(["arcane-orb"]);
  });

  it("setTimer/setReady/setTemplate set their own field independently", () => {
    useDraftStore.getState().setTimer(12);
    useDraftStore.getState().setReady(true);
    useDraftStore.getState().setTemplate("aggro");

    const s = useDraftStore.getState();
    expect(s.timer).toBe(12);
    expect(s.ready).toBe(true);
    expect(s.template).toBe("aggro");
    expect(s.picks).toEqual([]); // untouched
  });

  it("reset() restores every field to its default", () => {
    useDraftStore.getState().addPick("fireball");
    useDraftStore.getState().setReady(true);
    useDraftStore.getState().reset();

    const s = useDraftStore.getState();
    expect(s.picks).toEqual([]);
    expect(s.ready).toBe(false);
  });
});
