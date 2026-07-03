// @vitest-environment jsdom
// RTL coverage for the P5 in-game HUD (design §9 #163 p5-hud) — the guard.ui
// handoff assertions this PR owns (design §8): #5 ability bar reads
// spellSlots + toggles a locked-equivalent state, #6 rune-mode renders
// CFG.SPELL_SLOT_COUNT slots incl. empty, #10 an item-bar element exists,
// #12 item-bar CSS is positioned + pointer-events:auto. Also honors #1/#2's
// XSS invariant (scoreboard names are never innerHTML-interpolated) and
// proves the store subscription is throttle-bound, not per-frame.
import fs from "node:fs";
import assert from "node:assert";
import { Profiler } from "react";
import { describe, it, test, expect, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, act } from "@testing-library/react";
import { Hud } from "./Hud";
import { useHudStore, HUD_HZ } from "../../store/useHudStore";
import { CFG } from "../../config.js";
import type { PlayerMeta, Snapshot } from "../../types";

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

function makeSnap(overrides: Partial<Snapshot> = {}): Snapshot {
  return {
    t: 1,
    phase: "playing",
    round: 2,
    timer: 0,
    playTime: 65,
    arenaR: 20,
    arenaWorld: "circle",
    landSize: "medium",
    enabledObstacles: {},
    winner: null,
    matchWinner: null,
    players: [
      {
        id: "p1",
        hp: 40,
        mhp: 100,
        c: 2.5,
        ca: 0,
        cds: { fireball: 2.5 },
        spellSlots: ["fireball", null, "lightning", null, null, null],
        items: ["blinkStone", "vitalityCore"],
        k: 3,
        d: 1,
        s: 30,
        al: true,
      } as never,
      { id: "p2", hp: 0, mhp: 100, c: 0, ca: 0, cds: {}, spellSlots: [], items: [], k: 0, d: 3, s: 10, al: false } as never,
    ],
    bolts: [],
    meteors: [],
    runes: [],
    items: [],
    mobs: [],
    spellSlotsEnabled: true,
    events: [],
    mapV: 0,
    ...overrides,
  } as Snapshot;
}

function meta(): Map<string, PlayerMeta> {
  return new Map([
    ["p1", { name: "Ashen Warlock", colorIndex: 0, userId: null }],
    ["p2", { name: "<img src=x onerror=alert(1)>", colorIndex: 1, userId: null }],
  ]);
}

function publish(snap: Snapshot, localId = "p1", m = meta()) {
  act(() => {
    useHudStore.getState().publish(snap, localId, m);
  });
}

beforeEach(() => {
  useHudStore.getState().reset();
});

afterEach(cleanup);

describe("Hud", () => {
  it("renders nothing while no snapshot has published yet", () => {
    const { container } = render(<Hud />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders round/phase, timer, and alive count from the published hud view", () => {
    render(<Hud />);
    publish(makeSnap());
    expect(screen.getByText("Round 2 — Brawl!")).toBeInTheDocument();
    expect(screen.getByText("1:05")).toBeInTheDocument();
    expect(screen.getByText("1 alive")).toBeInTheDocument();
  });

  // guard.ui #1/#2 handoff: scoreboard names must never be innerHTML-
  // interpolated (React JSX text children escape automatically).
  it("renders scoreboard player names as text, not injected markup", () => {
    render(<Hud />);
    publish(makeSnap());
    expect(screen.getByText("<img src=x onerror=alert(1)>")).toBeInTheDocument();
    expect(document.querySelector("img")).toBeNull();
  });

  it("marks eliminated players as dead in the scoreboard", () => {
    render(<Hud />);
    publish(makeSnap());
    const deadRow = screen.getByText("<img src=x onerror=alert(1)>").closest("div")!;
    expect(deadRow.className).toMatch(/dead/);
  });

  it("shows the countdown center message and hides it once playing", async () => {
    render(<Hud />);
    publish(makeSnap({ phase: "countdown", timer: 3 }));
    expect(screen.getByTestId("center-msg")).toHaveTextContent("3");

    // Outside the HUD_HZ throttle window so this second publish is accepted
    // (a same-window second call would otherwise be dropped — see the
    // re-render-count test below and useHudStore.test.ts).
    await wait(1000 / HUD_HZ + 20);
    publish(makeSnap({ phase: "playing" }));
    expect(screen.queryByTestId("center-msg")).toBeNull();
  });

  it("shows a generic (nameless) round/match-end message — HudView has no winner id", () => {
    render(<Hud />);
    publish(makeSnap({ phase: "roundEnd" }));
    expect(screen.getByTestId("center-msg")).toHaveTextContent("Round Over");
  });

  // guard.ui #5/#6 handoff: ability bar reads me.spellSlots and always
  // renders CFG.SPELL_SLOT_COUNT (rune-mode, 6) slots including empty ones,
  // which carry the React "locked" equivalent (data-locked, see SpellSlot.tsx).
  it("ability bar renders CFG.SPELL_SLOT_COUNT slots and marks empty ones locked", () => {
    render(<Hud />);
    publish(makeSnap());
    const bar = screen.getByTestId("ability-bar");
    const slots = [...bar.querySelectorAll<HTMLElement>("[data-empty]")];
    expect(slots).toHaveLength(CFG.SPELL_SLOT_COUNT);
    const lockedCount = slots.filter((el) => el.dataset.locked === "true").length;
    // spellSlots = ["fireball", null, "lightning", null, null, null] -> 4 empty.
    expect(lockedCount).toBe(4);
    expect(slots.some((el) => el.getAttribute("aria-label")?.startsWith("Fireball"))).toBe(true);
  });

  // guard.ui #10/#12 handoff: item-bar element exists and (Hud.module.css
  // .itemBar, asserted below) is positioned with pointer-events:auto.
  it("renders CFG.ITEM_SLOT_COUNT item-bar slots", () => {
    render(<Hud />);
    publish(makeSnap());
    const bar = screen.getByTestId("item-bar");
    const slots = [...bar.querySelectorAll<HTMLElement>("[data-empty]")];
    expect(slots).toHaveLength(CFG.ITEM_SLOT_COUNT);
  });

  it("only re-renders when the throttled hud view actually changes, never per-frame", async () => {
    let commits = 0;
    render(
      <Profiler id="hud-test" onRender={() => { commits++; }}>
        <Hud />
      </Profiler>,
    );
    expect(commits).toBe(1); // initial mount (hud still null)

    publish(makeSnap());
    expect(commits).toBe(2); // first accepted publish

    // Simulate a 30Hz sim loop hammering publish() within the same HUD_HZ
    // throttle window — the store gate (useHudStore.test.ts) already proves
    // these are dropped; this proves the component doesn't commit for them.
    for (let i = 0; i < 20; i++) {
      publish(makeSnap({ playTime: 65 + i }));
    }
    expect(commits).toBe(2);

    await wait(1000 / HUD_HZ + 20);
    publish(makeSnap({ playTime: 99 }));
    expect(commits).toBe(3); // exactly one more commit after the window elapses
  });
});

// Source guard, same technique as test/guard.ui.test.mjs — durable against a
// future regression back to reading the 30Hz snapshotRef singleton directly.
// (Matches an actual import, not this file's own explanatory prose about it.)
test("Hud never imports snapshotRef (would re-render React at the 30Hz sim tick, not HUD_HZ)", () => {
  const src = fs.readFileSync("src/ui/hud/Hud.tsx", "utf8");
  assert.doesNotMatch(src, /from\s+["'][^"']*snapshotRef["']/);
});

// guard.ui #12 handoff, applied to the React CSS module rather than
// style.css (same regex technique test/guard.ui.test.mjs uses on the legacy
// #item-bar rule).
test("item-bar CSS module rule is positioned with pointer-events auto", () => {
  const css = fs.readFileSync("src/ui/hud/Hud.module.css", "utf8");
  assert.match(css, /\.itemBar\s*\{[\s\S]*?position:\s*fixed[\s\S]*?pointer-events:\s*auto/);
});
