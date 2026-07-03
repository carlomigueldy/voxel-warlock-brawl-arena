// @vitest-environment jsdom
// RTL coverage for the P5 spell draft overlay (design §9 #164 p5-draft) —
// gating on the phase-driven snapshot slice, the four draft(action) intents
// (toggle/template/ready/clear), the modal focus-trap/Escape-clears-not-
// closes behavior, and the draft-juice lock-in/celebration side effects.
import { afterEach, beforeEach, describe, expect, it, test, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import fs from "node:fs";
import assert from "node:assert";
import { CFG } from "../../config.js";
import { gameSessionRef, type GameSessionIntents } from "../../loop/useGameSession";
import { useDraftStore, DRAFT_HZ } from "../../store/useDraftStore";
import { FX } from "../../hooks/useFx";
import type { PlayerSnap, Snapshot } from "../../types";
import { DraftOverlay } from "./DraftOverlay";

function makeIntents(overrides: Partial<GameSessionIntents> = {}): GameSessionIntents {
  const noop = vi.fn();
  return {
    hostPrivate: noop, join: noop, quickMatch: noop, leaveMatch: noop, practice: noop, resume: noop,
    cancelQueue: noop, draft: noop, spawnDummy: noop, clearDummies: noop, changeLoadout: noop,
    toggleNoCooldown: noop, bots: noop, configChange: noop, startMatch: noop, sendChat: noop,
    sendTyping: noop, sendAfk: noop, sendSpeak: noop, toggleMute: noop, clearMutes: noop, socialPrefs: noop,
    ...overrides,
  } as GameSessionIntents;
}

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

function publish(snap: Snapshot, localId = "p1") {
  act(() => {
    useDraftStore.getState().publish(snap, localId);
  });
}

// useDraftStore.publish is throttled to DRAFT_HZ (mirrors useHudStore) — a
// second publish in the same test needs to clear that window first, same as
// Hud.test.tsx's own `wait(1000 / HUD_HZ + 20)` pattern.
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const nextPublishWindow = () => wait(1000 / DRAFT_HZ + 20);

beforeEach(() => {
  useDraftStore.getState().reset();
  gameSessionRef.current = null;
  FX.reducedMotion = false;
});

afterEach(() => {
  cleanup();
  document.getElementById("fx-layer")?.remove();
  vi.restoreAllMocks();
});

describe("DraftOverlay", () => {
  it("renders nothing while the store isn't active (no spellSelection snapshot published yet)", () => {
    const { container } = render(<DraftOverlay />);
    expect(container).toBeEmptyDOMElement();
  });

  it("opens as a dialog with the title/timer once a spellSelection snapshot publishes", () => {
    render(<DraftOverlay />);
    publish(makeSnap());
    const dialog = screen.getByRole("dialog", { name: "Spell Draft" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(screen.getByText("Spell Draft")).toBeInTheDocument();
    expect(screen.getByText("30")).toBeInTheDocument();
  });

  it("closes (renders nothing) once the phase leaves spellSelection", async () => {
    render(<DraftOverlay />);
    publish(makeSnap());
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    await nextPublishWindow();
    publish(makeSnap({ phase: "countdown", timer: 3 }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("marks the timer urgent at 8s and below, not above", async () => {
    render(<DraftOverlay />);
    publish(makeSnap({ timer: 9 }));
    expect(screen.getByText("9").className).not.toMatch(/timerUrgent/);
    await nextPublishWindow();
    publish(makeSnap({ timer: 8 }));
    expect(screen.getByText("8").className).toMatch(/timerUrgent/);
  });

  it("renders CFG.SPELL_SLOT_COUNT slot pips, filled ones showing the picked spell's name", () => {
    render(<DraftOverlay />);
    publish(makeSnap({}, { draftPick: ["lightning", "boomerang"] }));
    const list = screen.getByRole("listbox", { name: "Available spells" });
    expect(list).toBeInTheDocument();
    // guard.ui #6 parity spirit — 6 slot cells always render, filled or not.
    const pips = screen.getByTestId("draft-slots").children;
    expect(pips.length).toBe(CFG.SPELL_SLOT_COUNT);
    const filled = [...pips].filter((el) => el.textContent);
    expect(filled.map((el) => el.textContent)).toEqual(["Lightning", "Boomerang"]);
  });

  it("clicking a spell card dispatches draft({action:'toggle', spell}) via gameSessionRef", () => {
    const draft = vi.fn();
    gameSessionRef.current = makeIntents({ draft });
    render(<DraftOverlay />);
    publish(makeSnap());
    fireEvent.click(screen.getByRole("option", { name: /Lightning/ }));
    expect(draft).toHaveBeenCalledWith({ action: "toggle", spell: "lightning" });
  });

  it("clicking a template quick-pick dispatches draft({action:'template', template})", () => {
    const draft = vi.fn();
    gameSessionRef.current = makeIntents({ draft });
    render(<DraftOverlay />);
    publish(makeSnap());
    fireEvent.click(screen.getByRole("button", { name: /Burst template/ }));
    expect(draft).toHaveBeenCalledWith({ action: "template", template: 0 });
  });

  it("Ready dispatches draft({action:'ready'}); once the snapshot confirms ready, the button locks and disables", async () => {
    const draft = vi.fn();
    gameSessionRef.current = makeIntents({ draft });
    render(<DraftOverlay />);
    publish(makeSnap());
    fireEvent.click(screen.getByRole("button", { name: "Ready" }));
    expect(draft).toHaveBeenCalledWith({ action: "ready" });

    await nextPublishWindow();
    publish(makeSnap({}, { draftReady: true }));
    const btn = screen.getByRole("button", { name: "Locked In" });
    expect(btn).toBeDisabled();
  });

  it("Escape dispatches draft({action:'clear'}) instead of closing the dialog (mandatory draft, no dismiss)", () => {
    const draft = vi.fn();
    gameSessionRef.current = makeIntents({ draft });
    render(<DraftOverlay />);
    publish(makeSnap());
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(draft).toHaveBeenCalledWith({ action: "clear" });
    expect(screen.getByRole("dialog")).toBeInTheDocument(); // still open — draft can't be dismissed
  });

  it("does not render a close (X) button — the draft overlay is not dismissible", () => {
    render(<DraftOverlay />);
    publish(makeSnap());
    expect(screen.queryByRole("button", { name: "Close" })).toBeNull();
  });

  it("draft-juice: a newly-filled pick fires an FX burst (school-colored particles)", async () => {
    render(<DraftOverlay />);
    publish(makeSnap());
    expect(document.querySelectorAll(".fx-particle").length).toBe(0);
    await nextPublishWindow();
    publish(makeSnap({}, { draftPick: ["lightning"] }));
    expect(document.querySelectorAll(".fx-particle").length).toBeGreaterThan(0);
  });

  it("draft-juice: filling all slots triggers the all-locked celebration class on the panel", async () => {
    render(<DraftOverlay />);
    publish(makeSnap());
    const sixPicks = ["lightning", "boomerang", "homing", "fireSpray", "bouncer", "splitter"];
    expect(sixPicks.length).toBe(CFG.SPELL_SLOT_COUNT);
    await nextPublishWindow();
    publish(makeSnap({}, { draftPick: sixPicks }));
    const dialog = screen.getByRole("dialog");
    expect(dialog.className).toMatch(/allLocked/);
  });

  it("no client-side optimism: clicking a card does not locally toggle the pip before the snapshot confirms it", () => {
    gameSessionRef.current = makeIntents({ draft: vi.fn() });
    render(<DraftOverlay />);
    publish(makeSnap());
    fireEvent.click(screen.getByRole("option", { name: /Lightning/ }));
    // The intent fired (asserted above in the toggle test); the picks view
    // itself must still read empty until the next publish() confirms it.
    expect(screen.getByRole("option", { name: /Lightning/ })).toHaveAttribute("aria-selected", "false");
  });
});

// Source guards, same technique as Hud.test.tsx / test/guard.ui.test.mjs —
// durable against regressing back to DOM observation or the 30Hz singleton.
test("DraftOverlay never imports snapshotRef (must read the throttled store, not the raw 30Hz singleton)", () => {
  const src = fs.readFileSync("src/ui/draft/DraftOverlay.tsx", "utf8");
  assert.doesNotMatch(src, /from\s+["'][^"']*snapshotRef["']/);
});

test("draft components never use a MutationObserver or inject a <style> tag (design §9: read store state directly)", () => {
  for (const file of ["DraftOverlay.tsx", "DraftSlots.tsx", "DraftSpellCard.tsx", "DraftTemplates.tsx"]) {
    const src = fs.readFileSync(`src/ui/draft/${file}`, "utf8");
    assert.doesNotMatch(src, /new\s+MutationObserver\(/);
    assert.doesNotMatch(src, /createElement\(\s*["']style["']\s*\)/);
  }
});

test("DraftOverlay.module.css degrades every draft animation under prefers-reduced-motion", () => {
  const css = fs.readFileSync("src/ui/draft/DraftOverlay.module.css", "utf8");
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  const reducedBlock = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce)"));
  assert.match(reducedBlock, /animation:\s*none\s*!important/);
});
