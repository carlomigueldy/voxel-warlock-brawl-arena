// @vitest-environment jsdom
// The render-count probe — design §8(b), the Opus merge-gate evidence table.
// Drives pushSnapshot+onNewSnapshot for N ticks with a STABLE roster and
// unchanged phase, and asserts the store subscribers various P4 layers will
// eventually use see zero (or throttle-bounded) extra renders — proving the
// three-tier split (design §0) actually holds: per-frame data never
// triggers a React re-render.
//
// Snapshots here use phase:"lobby" so onNewSnapshot's legacy-UI branch
// (`if (snap.phase !== PHASE.LOBBY) { ui.updateHUD(...) }`) stays a no-op —
// this test exercises the STORE fan-out only, not ui.js's DOM writes (which
// need the full static game DOM P4/P5 don't require here). getInput()/
// getAudio() still get constructed by onNewSnapshot's
// syncLocalSpellSlots/audioTransitions helpers; both are DOM-safe with no
// game markup present (InputController's `_bindTouch()` early-returns when
// #joystick is absent; AudioEngine.play() no-ops until resume() runs).
//
// Every onNewSnapshot() call below runs inside act(): React 19 schedules
// (but does not synchronously flush/commit) a re-render triggered from
// outside a React event handler unless the update is wrapped in act() — the
// underlying Zustand store updates correctly either way, but an un-flushed
// commit would under-count renders here, not over-count them, so omitting
// act() would make this probe a false negative rather than a false positive.
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, cleanup, act } from "@testing-library/react";
import { useRosterStore } from "../store/useRosterStore";
import { useHudStore, HUD_HZ } from "../store/useHudStore";
import { useSessionStore } from "../store/useSessionStore";
import { snapshotRef, resetSnapshotRef } from "../store/snapshotRef";
import { onNewSnapshot } from "./onNewSnapshot";
import type { PlayerMeta, Snapshot } from "../types";

afterEach(() => {
  cleanup();
  resetSnapshotRef();
  useRosterStore.getState().reset();
  useHudStore.getState().reset();
  useSessionStore.setState({
    sessionGen: 0, role: null, screen: "loading", phase: null,
    inGame: false, roomCode: null, isHost: false,
  });
  vi.restoreAllMocks();
});

// useHudStore.publish's throttle is wall-clock-based (performance.now()), but
// a driven test loop executes every tick within microseconds of real time —
// nowhere near HUD_HZ's 100ms window. Stub performance.now() to advance by
// exactly one tick (CFG.TICK_RATE cadence) per onNewSnapshot() call so the
// throttle gate sees the same elapsed time a real rAF-driven loop would.
function stubTickClock(tickMs: number) {
  let now = 0;
  vi.spyOn(performance, "now").mockImplementation(() => now);
  return { advance: () => { now += tickMs; } };
}

function makeSnap(t: number, overrides: Partial<Snapshot> = {}): Snapshot {
  return {
    t, phase: "lobby", round: 1, timer: 0, playTime: t / 30, arenaR: 20,
    arenaWorld: "circle", landSize: "medium", enabledObstacles: {}, winner: null, matchWinner: null,
    players: [{ id: "p1", hp: 100, mhp: 100, c: 0, ca: 0, cds: {}, spellSlots: [], items: [], k: 0, d: 0, s: 0, al: true } as never],
    bolts: [], meteors: [], runes: [], items: [], mobs: [], spellSlotsEnabled: true, events: [], mapV: 0,
    ...overrides,
  } as Snapshot;
}

describe("render-count probe — zero per-frame React re-renders (design §8b)", () => {
  it("N stable ticks: zero roster/session renders, zero non-subscribing renders, hud bounded by HUD_HZ", () => {
    const renders = { roster: 0, hud: 0, session: 0, nonSubscribing: 0 };

    function RosterProbe() { useRosterStore((s) => s.playerIds); renders.roster++; return null; }
    function HudProbe() { useHudStore((s) => s.hud); renders.hud++; return null; }
    function SessionProbe() { useSessionStore((s) => s.phase); renders.session++; return null; }
    // No store subscription at all — reads the non-reactive snapshotRef
    // singleton directly. If this ever re-renders on its own, something is
    // wrong upstream of React (nothing should be able to force it).
    function NonSubscribingProbe() { renders.nonSubscribing++; void snapshotRef.current; return null; }

    render(
      <>
        <RosterProbe />
        <HudProbe />
        <SessionProbe />
        <NonSubscribingProbe />
      </>,
    );

    const meta: [string, PlayerMeta][] = [["p1", { name: "warlock", colorIndex: 0, userId: null }]];
    for (const [id, m] of meta) snapshotRef.meta.set(id, m);

    const tickMs = 1000 / 30; // CFG.TICK_RATE
    const clock = stubTickClock(tickMs);

    // Prime with one tick so the roster/session/hud stores are already
    // populated (playerIds [] -> ["p1"] and phase null -> "lobby" are each a
    // legitimate one-time mount transition, not part of what "stable" means
    // below) before counting renders for the N "stable" ticks that follow.
    act(() => { clock.advance(); onNewSnapshot(makeSnap(0), "p1"); });
    renders.roster = 0; renders.hud = 0; renders.session = 0; renders.nonSubscribing = 0;

    const N = 60; // 2s of ticks at CFG.TICK_RATE (30Hz)
    act(() => {
      for (let i = 1; i <= N; i++) {
        clock.advance();
        onNewSnapshot(makeSnap(i), "p1");
      }
    });

    expect(renders.roster).toBe(0); // stable roster -> useRosterStore.sync never calls set()
    expect(renders.session).toBe(0); // phase stays "lobby" for every driven tick
    expect(renders.nonSubscribing).toBe(0); // no store subscription -> literally cannot re-render

    // HUD_HZ throttle bound: at most ceil(duration * HUD_HZ) publishes, +1
    // slack for the always-fires first publish (prev hud is null).
    const durSec = N / 30;
    expect(renders.hud).toBeLessThanOrEqual(Math.ceil(durSec * HUD_HZ) + 1);
    expect(renders.hud).toBeGreaterThan(0); // playTime does change every tick, so at least one publish lands
  });

  it("flipping one bolt id: exactly one additional BoltsLayer-scope render; roster (players) selector unaffected", () => {
    const renders = { bolts: 0, playerIds: 0 };
    function BoltsLayerProbe() { useRosterStore((s) => s.boltIds); renders.bolts++; return null; }
    function PlayerIdsProbe() { useRosterStore((s) => s.playerIds); renders.playerIds++; return null; }

    render(
      <>
        <BoltsLayerProbe />
        <PlayerIdsProbe />
      </>,
    );

    snapshotRef.meta.set("p1", { name: "warlock", colorIndex: 0, userId: null });

    // Prime (playerIds [] -> ["p1"] is a legitimate one-time mount, not part
    // of "stable") before counting.
    act(() => { onNewSnapshot(makeSnap(0), "p1"); });
    renders.bolts = 0; renders.playerIds = 0;

    // A few stable ticks first (no bolts) — neither probe should re-render.
    act(() => {
      for (let i = 1; i <= 5; i++) onNewSnapshot(makeSnap(i), "p1");
    });
    expect(renders.bolts).toBe(0);
    expect(renders.playerIds).toBe(0);

    // One tick introduces a bolt.
    const bolt = { id: 1, o: "p1", x: 0, z: 0, y: 0, c: 0, k: "fireball" };
    act(() => {
      onNewSnapshot(makeSnap(6, { bolts: [bolt as never] }), "p1");
    });
    expect(renders.bolts).toBe(1);
    expect(renders.playerIds).toBe(0); // playerIds' reference is untouched by a bolt spawning

    // Subsequent ticks with the SAME bolt id (unchanged) — no further renders.
    act(() => {
      for (let i = 7; i <= 10; i++) {
        onNewSnapshot(makeSnap(i, { bolts: [bolt as never] }), "p1");
      }
    });
    expect(renders.bolts).toBe(1);
  });
});
