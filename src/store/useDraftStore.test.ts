// Store-slice unit tests for useDraftStore (design §3 point 3) — pure
// ephemeral local-player interaction state, no persistence. See the store's
// header for why this never carries other players' picks (that's the
// snapshot-driven authoritative state a sibling adds separately).
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { useDraftStore, DRAFT_HZ } from "./useDraftStore";
import type { PlayerSnap, Snapshot } from "../types";

function makePlayer(overrides: Partial<PlayerSnap> = {}): PlayerSnap {
  return {
    id: "p1", x: 0, z: 0, y: 0, a: 0, c: 0, hp: 100, mhp: 100, al: true, sp: false, f: false,
    hz: 0, st: 0, s: 0, k: 0, d: 0, ww: 0, ru: 0, sh: 0, di: 0, gr: 0, lk: null, sl: 0, bu: 0,
    cu: 0, iv: 0, hs: 0, ty: 0, afk: 0, spk: 0, ca: 0, cds: {}, spells: [], spellSlots: [], items: [],
    draftPick: [], draftReady: false,
    ...overrides,
  } as PlayerSnap;
}

function makeSnap(overrides: Partial<Snapshot> = {}, player: Partial<PlayerSnap> = {}): Snapshot {
  return {
    t: 1, phase: "spellSelection", round: 1, timer: 30, playTime: 0, arenaR: 20,
    arenaWorld: "circle", landSize: "medium", enabledObstacles: {}, winner: null, matchWinner: null,
    players: [makePlayer(player)], bolts: [], meteors: [], runes: [], items: [], mobs: [],
    spellSlotsEnabled: true, events: [], mapV: 0,
    ...overrides,
  } as Snapshot;
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

beforeEach(() => {
  useDraftStore.getState().reset();
});

afterEach(() => {
  vi.restoreAllMocks();
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

  it("defaults active to false", () => {
    expect(useDraftStore.getState().active).toBe(false);
  });

  // publish() (design §3 point 3's "own snapshot-driven slice", mirroring
  // useHudStore's throttled publish) — wired into onNewSnapshot.
  describe("publish", () => {
    it("sets active from phase, and picks/ready/timer from the local player's draft fields", () => {
      useDraftStore.getState().publish(makeSnap({ timer: 12.4 }, { draftPick: ["lightning"], draftReady: true }), "p1");
      const s = useDraftStore.getState();
      expect(s.active).toBe(true);
      expect(s.picks).toEqual(["lightning"]);
      expect(s.ready).toBe(true);
      expect(s.timer).toBe(13); // ceil(max(0, 12.4))
    });

    it("active is false outside the spellSelection phase", () => {
      useDraftStore.getState().publish(makeSnap({ phase: "playing" }), "p1");
      expect(useDraftStore.getState().active).toBe(false);
    });

    it("falls back to empty/not-ready when the local player isn't found in the snapshot", () => {
      useDraftStore.getState().publish(makeSnap({}, { draftPick: ["lightning"] }), "someone-else");
      const s = useDraftStore.getState();
      expect(s.picks).toEqual([]);
      expect(s.ready).toBe(false);
    });

    it("throttles to DRAFT_HZ — a second publish within the same window is dropped", async () => {
      useDraftStore.getState().publish(makeSnap({}, { draftPick: ["lightning"] }), "p1");
      useDraftStore.getState().publish(makeSnap({}, { draftPick: ["lightning", "boomerang"] }), "p1");
      expect(useDraftStore.getState().picks).toEqual(["lightning"]); // second call dropped

      await wait(1000 / DRAFT_HZ + 20);
      useDraftStore.getState().publish(makeSnap({}, { draftPick: ["lightning", "boomerang"] }), "p1");
      expect(useDraftStore.getState().picks).toEqual(["lightning", "boomerang"]);
    });

    it("no-ops the actual set() call when nothing changed (content-equality gate)", async () => {
      useDraftStore.getState().publish(makeSnap({ timer: 20 }, { draftPick: ["lightning"] }), "p1");
      await wait(1000 / DRAFT_HZ + 20);
      const before = useDraftStore.getState();
      useDraftStore.getState().publish(makeSnap({ timer: 20 }, { draftPick: ["lightning"] }), "p1");
      const after = useDraftStore.getState();
      // Same content -> only _lastPublish's bookkeeping changes, not the
      // observable fields (mirrors useHudStore's equality-gate rationale).
      expect(after.picks).toBe(before.picks); // same array reference, not replaced
      expect(after.timer).toBe(before.timer);
      expect(after.ready).toBe(before.ready);
    });
  });
});
