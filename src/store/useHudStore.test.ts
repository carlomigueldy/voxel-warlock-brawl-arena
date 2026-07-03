// @vitest-environment jsdom
// Store-slice unit tests for useHudStore — design §7 invariant (3) / §8(b):
// publish() double-gates on a time throttle (HUD_HZ) AND content equality.
import { describe, it, expect, beforeEach } from "vitest";
import { useHudStore, HUD_HZ } from "./useHudStore";
import type { Snapshot } from "../types";

function makeSnap(overrides: Partial<Snapshot> = {}): Snapshot {
  return {
    t: 1, phase: "playing", round: 1, timer: 0, playTime: 5, arenaR: 20,
    arenaWorld: "circle", landSize: "medium", enabledObstacles: {}, winner: null,
    matchWinner: null,
    players: [{ id: "p1", hp: 100, mhp: 100, c: 0, ca: 0, cds: {}, spellSlots: [], items: [], k: 0, d: 0, s: 0, al: true } as never],
    bolts: [], meteors: [], runes: [], items: [], mobs: [], spellSlotsEnabled: true, events: [], mapV: 0,
    ...overrides,
  } as Snapshot;
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("useHudStore.publish", () => {
  beforeEach(() => {
    useHudStore.getState().reset();
  });

  it("publishes on the first call regardless of throttle (prev hud is null)", () => {
    useHudStore.getState().publish(makeSnap(), "p1", new Map());
    expect(useHudStore.getState().hud).not.toBeNull();
    expect(useHudStore.getState().hud?.hp).toBe(100);
  });

  it("is throttled: a second call inside the HUD_HZ window is a no-op even if content differs", () => {
    useHudStore.getState().publish(makeSnap(), "p1", new Map());
    const hudAfterFirst = useHudStore.getState().hud;

    useHudStore.getState().publish(
      makeSnap({ players: [{ id: "p1", hp: 50, mhp: 100, c: 0, ca: 0, cds: {}, spellSlots: [], items: [], k: 0, d: 0, s: 0, al: true } as never] }),
      "p1",
      new Map(),
    );
    // Still the pre-change reference — the throttle gate fires before content
    // is even derived, so a same-window change is dropped, not queued.
    expect(useHudStore.getState().hud).toBe(hudAfterFirst);
  });

  it("after the throttle window elapses, identical content is still a no-op (content-equality gate)", async () => {
    useHudStore.getState().publish(makeSnap(), "p1", new Map());
    const hudAfterFirst = useHudStore.getState().hud;
    await wait(1000 / HUD_HZ + 20);
    useHudStore.getState().publish(makeSnap(), "p1", new Map()); // identical snapshot
    expect(useHudStore.getState().hud).toBe(hudAfterFirst);
  });

  it("after the throttle window elapses, changed content publishes a new hud reference", async () => {
    useHudStore.getState().publish(makeSnap(), "p1", new Map());
    const hudAfterFirst = useHudStore.getState().hud;
    await wait(1000 / HUD_HZ + 20);
    useHudStore.getState().publish(
      makeSnap({ players: [{ id: "p1", hp: 50, mhp: 100, c: 0, ca: 0, cds: {}, spellSlots: [], items: [], k: 0, d: 0, s: 0, al: true } as never] }),
      "p1",
      new Map(),
    );
    expect(useHudStore.getState().hud).not.toBe(hudAfterFirst);
    expect(useHudStore.getState().hud?.hp).toBe(50);
  });

  it("rounds the countdown/draft timer (ceil) and the in-round playTime (round) before comparing", () => {
    useHudStore.getState().publish(makeSnap({ phase: "countdown", timer: 2.9 }), "p1", new Map());
    expect(useHudStore.getState().hud?.timer).toBe(3);
  });

  it("reset() clears hud and _lastPublish", () => {
    useHudStore.getState().publish(makeSnap(), "p1", new Map());
    useHudStore.getState().reset();
    expect(useHudStore.getState().hud).toBeNull();
    expect(useHudStore.getState()._lastPublish).toBe(0);
  });
});
