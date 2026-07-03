// @vitest-environment jsdom
// Store-slice unit tests for useRosterStore — design §8(d): "rosterStore.sync
// ref-stability on identical sync, mount/unmount on change." jsdom only
// because Zustand's React bindings assume a DOM global exists; the store
// itself has no DOM dependency (see file header note in useRosterStore.ts).
import { describe, it, expect, beforeEach } from "vitest";
import { useRosterStore, deriveRoster } from "./useRosterStore";
import type { Snapshot } from "../types";

const EMPTY_META = { name: "warlock", colorIndex: 0, userId: null };

function makeSnap(overrides: Partial<Snapshot> = {}): Snapshot {
  return {
    t: 1, phase: "playing", round: 1, timer: 0, playTime: 0, arenaR: 20,
    arenaWorld: "circle", landSize: "medium", enabledObstacles: {}, winner: null,
    matchWinner: null, players: [], bolts: [], meteors: [], runes: [], items: [],
    mobs: [], spellSlotsEnabled: true, events: [], mapV: 0,
    ...overrides,
  } as Snapshot;
}

describe("useRosterStore.sync", () => {
  beforeEach(() => {
    useRosterStore.getState().reset();
  });

  it("is a no-op (skips set() entirely) when the derived roster is unchanged", () => {
    const meta = new Map([["p1", EMPTY_META]]);
    const snap = makeSnap({ players: [{ id: "p1" } as never] });
    useRosterStore.getState().sync(deriveRoster(snap, meta));
    const afterFirst = useRosterStore.getState();

    // Same ids, same meta contents (a fresh but element-identical array/object
    // each tick, exactly like onNewSnapshot's real call pattern) -> sync()
    // must not touch playerIds/meta's references.
    useRosterStore.getState().sync(deriveRoster(makeSnap({ players: [{ id: "p1" } as never] }), meta));
    const afterSecond = useRosterStore.getState();

    expect(afterSecond.playerIds).toBe(afterFirst.playerIds); // same reference — no set()
    expect(afterSecond.meta).toBe(afterFirst.meta);
  });

  it("fires exactly once when a player id is added (mount) and again when removed (unmount)", () => {
    const meta = new Map([["p1", EMPTY_META]]);
    let renders = 0;
    const unsub = useRosterStore.subscribe(() => { renders++; });

    useRosterStore.getState().sync(deriveRoster(makeSnap({ players: [{ id: "p1" } as never] }), meta));
    expect(renders).toBe(1);
    // Unchanged roster: still just 1.
    useRosterStore.getState().sync(deriveRoster(makeSnap({ players: [{ id: "p1" } as never] }), meta));
    expect(renders).toBe(1);

    // A second player joins (mount).
    meta.set("p2", EMPTY_META);
    useRosterStore.getState().sync(
      deriveRoster(makeSnap({ players: [{ id: "p1" } as never, { id: "p2" } as never] }), meta),
    );
    expect(renders).toBe(2);
    expect(useRosterStore.getState().playerIds).toEqual(["p1", "p2"]);

    // p2 leaves (unmount).
    meta.delete("p2");
    useRosterStore.getState().sync(deriveRoster(makeSnap({ players: [{ id: "p1" } as never] }), meta));
    expect(renders).toBe(3);
    expect(useRosterStore.getState().playerIds).toEqual(["p1"]);

    unsub();
  });

  it("gates each array field independently — a bolt spawning doesn't touch playerIds' reference", () => {
    const meta = new Map([["p1", EMPTY_META]]);
    useRosterStore.getState().sync(deriveRoster(makeSnap({ players: [{ id: "p1" } as never] }), meta));
    const playerIdsBefore = useRosterStore.getState().playerIds;

    useRosterStore.getState().sync(
      deriveRoster(makeSnap({ players: [{ id: "p1" } as never], bolts: [{ id: 1 } as never] }), meta),
    );
    expect(useRosterStore.getState().playerIds).toBe(playerIdsBefore); // untouched
    expect(useRosterStore.getState().boltIds).toEqual([1]); // this one did change
  });

  it("reset() clears every field back to empty", () => {
    const meta = new Map([["p1", EMPTY_META]]);
    useRosterStore.getState().sync(deriveRoster(makeSnap({ players: [{ id: "p1" } as never] }), meta));
    useRosterStore.getState().reset();
    const s = useRosterStore.getState();
    expect(s.playerIds).toEqual([]);
    expect(s.boltIds).toEqual([]);
    expect(s.mobIds).toEqual([]);
    expect(s.meteorIds).toEqual([]);
    expect(s.itemIds).toEqual([]);
    expect(s.meta).toEqual({});
  });
});
