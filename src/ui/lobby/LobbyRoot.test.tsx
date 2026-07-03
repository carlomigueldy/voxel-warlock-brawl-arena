// @vitest-environment jsdom
// RTL coverage for the React lobby screen (design §9/§8) — these assertions
// are the react-mode replacement for guard.ui.test.mjs's #8 ("host lobby
// exposes bot count and difficulty controls") and #9 ("host menu exposes
// arena world and land size controls"), plus the acceptance criteria in
// issue #162: room code/QR render, player list reflects useRosterStore,
// host controls write useLobbyConfigStore and push gameSessionRef intents,
// the obstacle toggle keeps the existing vwb-map-objects persistence, Start
// Brawl is gated on player count, and a joined client sees the read-only
// view (no host controls, no Start button).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { CFG } from "../../config.js";
import { gameSessionRef, type GameSessionIntents } from "../../loop/useGameSession";
import { useLobbyConfigStore } from "../../store/useLobbyConfigStore";
import { useRosterStore } from "../../store/useRosterStore";
import { useSessionStore } from "../../store/useSessionStore";
import { useUiStore } from "../../store/useUiStore";
import { LobbyRoot } from "./LobbyRoot";

// qrcode's toCanvas needs a real 2D canvas context, which jsdom doesn't
// implement — mock it so QR rendering is a no-op instead of a caught
// rejection (RoomCodeQr.tsx already guards a real rejection, but mocking
// keeps test output clean and lets us assert the canvas element is present
// without depending on jsdom's canvas gap).
vi.mock("qrcode", () => ({ default: { toCanvas: vi.fn().mockResolvedValue(undefined) } }));

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

function syncRoster(players: { id: string; name: string; colorIndex: number; isBot?: boolean }[]) {
  useRosterStore.getState().sync({
    playerIds: players.map((p) => p.id),
    boltIds: [], mobIds: [], meteorIds: [], itemIds: [],
    meta: Object.fromEntries(players.map((p) => [p.id, { name: p.name, colorIndex: p.colorIndex, isBot: p.isBot, userId: null }])),
  });
}

beforeEach(() => {
  localStorage.clear();
  useSessionStore.setState({ screen: "lobby", role: "host", isHost: true, roomCode: "ABC123", sessionGen: 1, phase: null, inGame: false });
  useUiStore.setState({ lobbyStatus: "" });
  useLobbyConfigStore.getState().reset();
  useRosterStore.getState().reset();
  gameSessionRef.current = null;
});

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe("LobbyRoot — room code / QR (host and client)", () => {
  it("renders the room code and a QR canvas encoding the invite link", () => {
    render(<LobbyRoot />);
    expect(screen.getByText("ABC123")).toBeInTheDocument();
    const details = screen.getByText("QR").closest("details");
    expect(details?.querySelector("canvas")).not.toBeNull();
  });

  it("copy code writes the room code to the clipboard and shows a confirmation", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    render(<LobbyRoot />);
    fireEvent.click(screen.getByRole("button", { name: "Copy Code" }));
    expect(writeText).toHaveBeenCalledWith("ABC123");
    await waitFor(() => expect(screen.getByRole("button", { name: "Copied!" })).toBeInTheDocument());
  });
});

describe("LobbyRoot — player roster", () => {
  it("reflects useRosterStore.meta with HOST/BOT badges and the muster count (playerIds[0] is the host)", () => {
    syncRoster([
      { id: "host-1", name: "Ada", colorIndex: 0 },
      { id: "bot:1", name: "Bot Brilliant", colorIndex: 1, isBot: true },
    ]);
    render(<LobbyRoot />);
    expect(screen.getByText("Ada")).toBeInTheDocument();
    expect(screen.getByText("HOST")).toBeInTheDocument();
    expect(screen.getByText("Bot Brilliant")).toBeInTheDocument();
    expect(screen.getByText("BOT")).toBeInTheDocument();
    expect(screen.getByText("2 warlocks mustered")).toBeInTheDocument();
  });
});

describe("LobbyRoot — host bot count/skill controls (guard.ui #8 equivalent)", () => {
  it("the bot count stepper writes useLobbyConfigStore and pushes gameSessionRef.bots()", () => {
    const bots = vi.fn();
    gameSessionRef.current = makeIntents({ bots });
    render(<LobbyRoot />);
    fireEvent.click(screen.getByRole("button", { name: "More bots" }));
    expect(useLobbyConfigStore.getState().botCount).toBe(1);
    expect(bots).toHaveBeenCalledTimes(1);
  });

  it("the bot skill segmented control writes useLobbyConfigStore and pushes gameSessionRef.bots()", () => {
    const bots = vi.fn();
    gameSessionRef.current = makeIntents({ bots });
    render(<LobbyRoot />);
    fireEvent.click(screen.getByRole("radio", { name: "Brilliant" }));
    expect(useLobbyConfigStore.getState().botSkill).toBe("brilliant");
    expect(bots).toHaveBeenCalledTimes(1);
  });

  it("hides bot controls for a joined client", () => {
    useSessionStore.setState({ isHost: false });
    render(<LobbyRoot />);
    expect(screen.queryByLabelText("More bots")).toBeNull();
    expect(screen.queryByRole("radio", { name: "Brilliant" })).toBeNull();
  });
});

describe("LobbyRoot — host arena/land/mobs/obstacle controls (guard.ui #9 equivalent)", () => {
  it("arena world cards write useLobbyConfigStore.arenaWorld and push configChange()", () => {
    const configChange = vi.fn();
    gameSessionRef.current = makeIntents({ configChange });
    render(<LobbyRoot />);
    fireEvent.click(screen.getByRole("radio", { name: /Twin Islands/ }));
    expect(useLobbyConfigStore.getState().arenaWorld).toBe("islands");
    expect(configChange).toHaveBeenCalledTimes(1);
  });

  it("the land size segmented control writes useLobbyConfigStore.landSize and pushes configChange()", () => {
    const configChange = vi.fn();
    gameSessionRef.current = makeIntents({ configChange });
    render(<LobbyRoot />);
    fireEvent.click(screen.getByRole("radio", { name: "Large" }));
    expect(useLobbyConfigStore.getState().landSize).toBe("large");
    expect(configChange).toHaveBeenCalledTimes(1);
  });

  it("an obstacle toggle flips useLobbyConfigStore.enabledObstacles and persists to vwb-map-objects (single-writer path)", () => {
    const configChange = vi.fn();
    gameSessionRef.current = makeIntents({ configChange });
    render(<LobbyRoot />);
    expect(useLobbyConfigStore.getState().enabledObstacles.tree).toBe(true);
    fireEvent.click(screen.getByLabelText("Trees"));
    expect(useLobbyConfigStore.getState().enabledObstacles.tree).toBe(false);
    expect(configChange).toHaveBeenCalledTimes(1);
    const persisted = JSON.parse(localStorage.getItem("vwb-map-objects") || "{}");
    expect(persisted.tree).toBe(false);
  });

  it("the mobs toggle writes useLobbyConfigStore.mobsEnabled and pushes configChange()", () => {
    const configChange = vi.fn();
    gameSessionRef.current = makeIntents({ configChange });
    render(<LobbyRoot />);
    const mobsSwitch = screen.getByRole("switch", { name: "Mob spawns" });
    expect(mobsSwitch).toHaveAttribute("aria-checked", "true");
    fireEvent.click(mobsSwitch);
    expect(useLobbyConfigStore.getState().mobsEnabled).toBe(false);
    expect(configChange).toHaveBeenCalledTimes(1);
  });

  it("a joined client sees a read-only Match Setup summary instead of editable fields", () => {
    useSessionStore.setState({ isHost: false });
    render(<LobbyRoot />);
    expect(screen.queryByRole("radiogroup", { name: "Arena world" })).toBeNull();
    expect(screen.queryByRole("radiogroup", { name: "Land size" })).toBeNull();
    expect(screen.queryByRole("group", { name: "Map object types" })).toBeNull();
    expect(screen.getByText("Match Setup")).toBeInTheDocument();
    expect(screen.getByText("Land size")).toBeInTheDocument();
  });
});

describe("LobbyRoot — Start Brawl gating", () => {
  it("is disabled below 2 warlocks and hidden for a joined client", () => {
    syncRoster([{ id: "host-1", name: "Ada", colorIndex: 0 }]);
    render(<LobbyRoot />);
    expect(screen.getByRole("button", { name: "Start Brawl" })).toBeDisabled();

    cleanup();
    useSessionStore.setState({ isHost: false });
    render(<LobbyRoot />);
    expect(screen.queryByRole("button", { name: "Start Brawl" })).toBeNull();
  });

  it("is enabled at 2+ warlocks and calls gameSessionRef.startMatch() on click", () => {
    const startMatch = vi.fn();
    gameSessionRef.current = makeIntents({ startMatch });
    syncRoster([
      { id: "host-1", name: "Ada", colorIndex: 0 },
      { id: "p2", name: "Beatrix", colorIndex: 1 },
    ]);
    render(<LobbyRoot />);
    const btn = screen.getByRole("button", { name: "Start Brawl" });
    expect(btn).toBeEnabled();
    fireEvent.click(btn);
    expect(startMatch).toHaveBeenCalledTimes(1);
  });
});

describe("LobbyRoot — lobby status", () => {
  it("renders useUiStore.lobbyStatus", () => {
    useUiStore.setState({ lobbyStatus: "Opponent connected. Starting match..." });
    render(<LobbyRoot />);
    expect(screen.getByText("Opponent connected. Starting match...")).toBeInTheDocument();
  });
});

// Sanity check the fixture assumption used above (host is always the first
// entry a snapshot ever carries) actually matches CFG's world/skill ids.
describe("LobbyRoot — fixture sanity", () => {
  it("CFG has the ids this suite exercises", () => {
    expect(CFG.ARENA_WORLDS.some((w) => w.id === "islands")).toBe(true);
    expect(CFG.BOT_SKILLS).toContain("brilliant");
  });
});
