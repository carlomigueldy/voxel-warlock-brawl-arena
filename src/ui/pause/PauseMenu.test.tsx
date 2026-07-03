// @vitest-environment jsdom
// RTL coverage for PauseMenu (design §9a Wave-2 / issue #166): gates on
// `useUiStore.paused`, Resume/Leave dispatch the right gameSessionRef
// intents, the global Escape/Enter hotkeys this component owns (see its
// header point 1) toggle pause / open chat, and PTT sourcing (§7b nit 3) is
// exercised indirectly via SocialSettingsModal.test.tsx (the component that
// actually renders the PTT picker).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, act } from "@testing-library/react";
import { PauseMenu } from "./PauseMenu";
import { useSessionStore } from "../../store/useSessionStore";
import { useUiStore } from "../../store/useUiStore";
import { gameSessionRef, type GameSessionIntents } from "../../loop/useGameSession";
import { getInput } from "../../services/registry";

function mockSession(overrides: Partial<GameSessionIntents> = {}): GameSessionIntents {
  const intents = {
    hostPrivate: vi.fn(), join: vi.fn(), quickMatch: vi.fn(), leaveMatch: vi.fn(async () => {}),
    practice: vi.fn(), resume: vi.fn(), cancelQueue: vi.fn(async () => {}), draft: vi.fn(),
    spawnDummy: vi.fn(), clearDummies: vi.fn(), changeLoadout: vi.fn(), toggleNoCooldown: vi.fn(),
    bots: vi.fn(), configChange: vi.fn(), startMatch: vi.fn(), sendChat: vi.fn(), sendTyping: vi.fn(),
    sendAfk: vi.fn(), sendSpeak: vi.fn(), toggleMute: vi.fn(), clearMutes: vi.fn(), socialPrefs: vi.fn(),
    ...overrides,
  };
  gameSessionRef.current = intents;
  return intents;
}

beforeEach(() => {
  localStorage.clear();
  // Suppress the auto-conduct-modal effect for these tests unless a test
  // explicitly wants it (own describe block below) — most assertions here
  // are about the pause Modal itself.
  localStorage.setItem("vwb-social-conduct-v1", "1");
  useSessionStore.setState({ screen: "game", inGame: true, phase: "playing" });
  useUiStore.setState({ paused: false, chatOpen: false });
  getInput().paused = false;
  getInput().chatting = false;
});

afterEach(() => {
  cleanup();
  gameSessionRef.current = null;
  localStorage.clear();
});

describe("PauseMenu — gating on useUiStore.paused", () => {
  it("renders nothing outside the game screen", () => {
    useSessionStore.setState({ screen: "menu" });
    const { container } = render(<PauseMenu />);
    expect(container).toBeEmptyDOMElement();
  });

  it("the Battle Menu dialog is hidden while paused=false", () => {
    render(<PauseMenu />);
    expect(screen.queryByRole("dialog", { name: "Battle Menu" })).toBeNull();
  });

  it("the Battle Menu dialog appears once useUiStore.paused flips true", () => {
    render(<PauseMenu />);
    act(() => useUiStore.getState().setPaused(true));
    expect(screen.getByRole("dialog", { name: "Battle Menu" })).toBeInTheDocument();
  });
});

describe("PauseMenu — Resume / Leave actions", () => {
  it("Resume Game calls gameSessionRef.resume() and closes the menu", () => {
    const resume = vi.fn();
    mockSession({ resume });
    render(<PauseMenu />);
    act(() => useUiStore.getState().setPaused(true));
    fireEvent.click(screen.getByRole("button", { name: "Resume Game" }));
    expect(resume).toHaveBeenCalledTimes(1);
    expect(useUiStore.getState().paused).toBe(false);
  });

  it("Leave Match calls gameSessionRef.leaveMatch() and closes the menu + chat", () => {
    const leaveMatch = vi.fn(async () => {});
    mockSession({ leaveMatch });
    useUiStore.setState({ chatOpen: true });
    render(<PauseMenu />);
    act(() => useUiStore.getState().setPaused(true));
    fireEvent.click(screen.getByRole("button", { name: "Leave Match" }));
    expect(leaveMatch).toHaveBeenCalledTimes(1);
    expect(useUiStore.getState().paused).toBe(false);
    expect(useUiStore.getState().chatOpen).toBe(false);
  });
});

describe("PauseMenu — defensive reset when the screen leaves the game", () => {
  it("clears paused/chatOpen once screen transitions away from 'game'", () => {
    useUiStore.setState({ paused: true, chatOpen: true });
    const { rerender } = render(<PauseMenu />);
    act(() => useSessionStore.setState({ screen: "menu" }));
    rerender(<PauseMenu />);
    expect(useUiStore.getState().paused).toBe(false);
    expect(useUiStore.getState().chatOpen).toBe(false);
  });
});

describe("PauseMenu — global Escape/Enter hotkeys (react-mode equivalent of wireLegacyUiToStores)", () => {
  it("Escape toggles paused on/off while in a match and mirrors getInput().paused", () => {
    render(<PauseMenu />);
    fireEvent.keyDown(window, { code: "Escape" });
    expect(useUiStore.getState().paused).toBe(true);
    expect(getInput().paused).toBe(true);

    fireEvent.keyDown(window, { code: "Escape" });
    expect(useUiStore.getState().paused).toBe(false);
    expect(getInput().paused).toBe(false);
  });

  it("Escape is a no-op outside a live match (lobby/spellSelection phase, or not inGame)", () => {
    useSessionStore.setState({ phase: "lobby" });
    render(<PauseMenu />);
    fireEvent.keyDown(window, { code: "Escape" });
    expect(useUiStore.getState().paused).toBe(false);
  });

  it("Enter opens chat while in a match and neither paused nor chat is already open", () => {
    render(<PauseMenu />);
    fireEvent.keyDown(window, { code: "Enter" });
    expect(useUiStore.getState().chatOpen).toBe(true);
  });

  it("Enter is a no-op while paused", () => {
    render(<PauseMenu />);
    act(() => useUiStore.getState().setPaused(true));
    fireEvent.keyDown(window, { code: "Enter" });
    expect(useUiStore.getState().chatOpen).toBe(false);
  });

  it("Escape is swallowed while the social settings dialog is open (does not also toggle pause)", () => {
    render(<PauseMenu />);
    act(() => useUiStore.getState().setPaused(true));
    fireEvent.click(screen.getByRole("button", { name: "Voice & Chat" }));
    expect(screen.getByRole("dialog", { name: "Voice & Chat" })).toBeInTheDocument();
    fireEvent.keyDown(window, { code: "Escape" });
    // Modal's own Escape handler closes the social dialog; PauseMenu's global
    // handler must not ALSO flip paused back off underneath it.
    expect(useUiStore.getState().paused).toBe(true);
  });
});

describe("PauseMenu — auto-conduct on first game entry", () => {
  it("shows the Code disclaimer once per vwb-social-conduct-v1, not on repeat entries", () => {
    localStorage.removeItem("vwb-social-conduct-v1");
    useSessionStore.setState({ screen: "loading" });
    render(<PauseMenu />);
    act(() => useSessionStore.setState({ screen: "game" }));
    expect(screen.getByRole("dialog", { name: "The Warlock's Code" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Enter the Arena" }));
    expect(screen.queryByRole("dialog", { name: "The Warlock's Code" })).toBeNull();
    expect(localStorage.getItem("vwb-social-conduct-v1")).toBe("1");
  });
});
