// Store-slice unit tests for useSocialRosterStore (design §9 p5-pause-chat)
// — the presence-only slice onNewSnapshot.ts additively feeds (see that
// file's diff + this store's header). Mirrors useRosterStore.test.ts's
// value-gating coverage style (a stable tick produces zero renders).
import { describe, it, expect, beforeEach } from "vitest";
import { useSocialRosterStore } from "./useSocialRosterStore";

beforeEach(() => {
  useSocialRosterStore.getState().reset();
});

describe("useSocialRosterStore", () => {
  it("starts with no presence rows", () => {
    expect(useSocialRosterStore.getState().presence).toEqual({});
  });

  it("sync() derives typing/afk/speaking booleans from the 0|1 wire flags", () => {
    useSocialRosterStore.getState().sync([
      { id: "p1", ty: 1, afk: 0, spk: 1 },
      { id: "p2", ty: 0, afk: 1, spk: 0 },
    ]);
    expect(useSocialRosterStore.getState().presence).toEqual({
      p1: { typing: true, afk: false, speaking: true },
      p2: { typing: false, afk: true, speaking: false },
    });
  });

  it("value-gates: an unchanged tick does not replace the presence object reference", () => {
    useSocialRosterStore.getState().sync([{ id: "p1", ty: 1, afk: 0, spk: 0 }]);
    const first = useSocialRosterStore.getState().presence;
    useSocialRosterStore.getState().sync([{ id: "p1", ty: 1, afk: 0, spk: 0 }]);
    expect(useSocialRosterStore.getState().presence).toBe(first);
  });

  it("a genuine change (e.g. speaking flips on) replaces the reference", () => {
    useSocialRosterStore.getState().sync([{ id: "p1", ty: 0, afk: 0, spk: 0 }]);
    const first = useSocialRosterStore.getState().presence;
    useSocialRosterStore.getState().sync([{ id: "p1", ty: 0, afk: 0, spk: 1 }]);
    const next = useSocialRosterStore.getState().presence;
    expect(next).not.toBe(first);
    expect(next.p1.speaking).toBe(true);
  });

  it("a player leaving the roster drops their presence row", () => {
    useSocialRosterStore.getState().sync([
      { id: "p1", ty: 0, afk: 0, spk: 0 },
      { id: "p2", ty: 0, afk: 0, spk: 0 },
    ]);
    useSocialRosterStore.getState().sync([{ id: "p1", ty: 0, afk: 0, spk: 0 }]);
    expect(useSocialRosterStore.getState().presence).toEqual({ p1: { typing: false, afk: false, speaking: false } });
  });

  it("reset() clears all presence rows", () => {
    useSocialRosterStore.getState().sync([{ id: "p1", ty: 1, afk: 0, spk: 0 }]);
    useSocialRosterStore.getState().reset();
    expect(useSocialRosterStore.getState().presence).toEqual({});
  });
});
