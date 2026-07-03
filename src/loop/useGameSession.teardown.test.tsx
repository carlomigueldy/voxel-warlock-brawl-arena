// @vitest-environment jsdom
// Regression coverage for #182 finding F1: teardown() must reset the four
// snapshot-driven reactive stores (roster/hud/draft/socialRoster), not just
// snapshotRef + useChatStore — otherwise a finished match's entities stay
// mounted on the always-mounted <GameCanvas/> and the next match's reused
// numeric bolt/meteor/item ids reuse the previous match's mounted entity
// (see useGameSession.ts's teardown()).
//
// Drives the REAL production path (intents.practice() -> intents.leaveMatch()
// -> teardown()) rather than calling reset() directly, so this also proves
// the four reset()s have a production caller. Host construction reads the
// bare `Peer` global (net.ts's _initPeer); stubbed here the same way
// guard.net.test.mjs's FakePeer does, so no real PeerJS network I/O runs.
// The stub never fires an "open" event — teardown() doesn't need one, and
// skipping it keeps this test free of rAF/timer flakiness (useHostLoop only
// starts ticking once engines.host/sim are set, which happens synchronously
// regardless of "open").
import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { useGameSession, type GameSessionIntents } from "./useGameSession";
import { useRosterStore } from "../store/useRosterStore";
import { useHudStore, type HudView } from "../store/useHudStore";
import { useDraftStore } from "../store/useDraftStore";
import { useSocialRosterStore } from "../store/useSocialRosterStore";
import { useSessionStore } from "../store/useSessionStore";

class FakePeer {
  id: string;
  constructor(id: string) { this.id = id; }
  on(): void { /* no-op: no "open"/"connection"/"error" needed for this test */ }
  destroy(): void {}
}

function GameSessionHost({ onIntents }: { onIntents: (intents: GameSessionIntents) => void }) {
  onIntents(useGameSession());
  return null;
}

const FAKE_HUD_VIEW: HudView = {
  phase: "playing", round: 1, timer: 30, aliveCount: 1, hp: 80, mhp: 100, charge: 0,
  cast: null, cooldowns: {}, spellSlots: [], items: [],
  scoreboard: [{ id: "p1", name: "Tester", k: 0, d: 0, s: 0, alive: true }],
};

describe("useGameSession teardown — #182 F1 (stale-store regression)", () => {
  const originalPeer = (globalThis as { Peer?: unknown }).Peer;

  afterEach(() => {
    cleanup();
    (globalThis as { Peer?: unknown }).Peer = originalPeer;
    useRosterStore.getState().reset();
    useHudStore.getState().reset();
    useDraftStore.getState().reset();
    useSocialRosterStore.getState().reset();
    useSessionStore.setState({
      sessionGen: 0, role: null, screen: "loading", phase: null,
      inGame: false, roomCode: null, isHost: false,
    });
  });

  it("empties roster/hud/draft/socialRoster on leaveMatch(), not just snapshotRef/chat", async () => {
    (globalThis as { Peer?: unknown }).Peer = FakePeer;

    let intents!: GameSessionIntents;
    render(<GameSessionHost onIntents={(i) => { intents = i; }} />);

    act(() => { intents.practice("Tester"); });

    // Simulate a finished match having populated the reactive stores (a real
    // match drives these every tick via onNewSnapshot; teardown() must clear
    // them regardless of how they got populated).
    act(() => {
      useRosterStore.getState().sync({
        playerIds: ["p1"], boltIds: [1], mobIds: ["m1"], meteorIds: [2], itemIds: [3],
        meta: { p1: { name: "Tester", colorIndex: 0, userId: null } },
      });
      useHudStore.setState({ hud: FAKE_HUD_VIEW });
      useDraftStore.setState({ active: true, picks: ["ember-bolt"], ready: true, timer: 5 });
      useSocialRosterStore.getState().sync([{ id: "p1", ty: 1, afk: 0, spk: 0 }]);
    });

    expect(useRosterStore.getState().playerIds).toEqual(["p1"]);
    expect(useHudStore.getState().hud).not.toBeNull();
    expect(useDraftStore.getState().active).toBe(true);
    expect(useSocialRosterStore.getState().presence).not.toEqual({});

    await act(async () => { await intents.leaveMatch(); });

    expect(useRosterStore.getState()).toMatchObject({
      playerIds: [], boltIds: [], mobIds: [], meteorIds: [], itemIds: [], meta: {},
    });
    expect(useHudStore.getState().hud).toBeNull();
    expect(useDraftStore.getState()).toMatchObject({ active: false, picks: [], ready: false, timer: 0 });
    expect(useSocialRosterStore.getState().presence).toEqual({});
  });
});
