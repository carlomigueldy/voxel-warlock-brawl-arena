// @vitest-environment jsdom
// RTL coverage for MenuRoot — spine nav, name validation (port of ui.js's
// `_flagNameError`), and the online/private screens' entry actions
// dispatched via `gameSessionRef` (design §9 sibling contract). Also covers
// guard.ui #11 ("online screen uses queue status instead of a hosted room
// browser") as the RTL replacement for that legacy text guard (design §8).
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { MenuRoot } from "./MenuRoot";
import { useMenuNavStore } from "../../store/useMenuNavStore";
import { useSettingsStore } from "../../store/useSettingsStore";
import { useUiStore } from "../../store/useUiStore";
import { gameSessionRef, type GameSessionIntents } from "../../loop/useGameSession";

function mockSession(overrides: Partial<GameSessionIntents> = {}): GameSessionIntents {
  const intents = {
    hostPrivate: vi.fn(),
    join: vi.fn(),
    quickMatch: vi.fn(),
    leaveMatch: vi.fn(async () => {}),
    practice: vi.fn(),
    resume: vi.fn(),
    cancelQueue: vi.fn(async () => {}),
    draft: vi.fn(),
    spawnDummy: vi.fn(),
    clearDummies: vi.fn(),
    changeLoadout: vi.fn(),
    toggleNoCooldown: vi.fn(),
    bots: vi.fn(),
    configChange: vi.fn(),
    startMatch: vi.fn(),
    sendChat: vi.fn(),
    sendTyping: vi.fn(),
    sendAfk: vi.fn(),
    sendSpeak: vi.fn(),
    toggleMute: vi.fn(),
    clearMutes: vi.fn(),
    socialPrefs: vi.fn(),
    ...overrides,
  };
  gameSessionRef.current = intents;
  return intents;
}

beforeEach(() => {
  useMenuNavStore.setState({ screen: "online" });
  useSettingsStore.setState({ name: "" });
  useUiStore.setState({
    menuStatus: "",
    onlineEnabled: true,
    queue: { searching: false, status: undefined, canCancel: false },
  });
});

afterEach(() => {
  cleanup();
  gameSessionRef.current = null;
});

describe("MenuRoot spine nav", () => {
  it("defaults to the online screen and switches on spine button click", () => {
    render(<MenuRoot />);
    expect(screen.getByRole("region", { name: "Online play" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /PRIVATE/ }));
    expect(screen.getByRole("region", { name: "Private or direct game" })).toBeInTheDocument();
    expect(useMenuNavStore.getState().screen).toBe("private");

    fireEvent.click(screen.getByRole("button", { name: /CHARACTERS/ }));
    expect(screen.getByRole("region", { name: "Choose your warlock" })).toBeInTheDocument();
  });

  it("marks the active spine button with aria-current", () => {
    render(<MenuRoot />);
    expect(screen.getByRole("button", { name: /ONLINE/ })).toHaveAttribute("aria-current", "true");
    fireEvent.click(screen.getByRole("button", { name: /ACCOUNT/ }));
    expect(screen.getByRole("button", { name: /ACCOUNT/ })).toHaveAttribute("aria-current", "true");
    expect(screen.getByRole("button", { name: /ONLINE/ })).toHaveAttribute("aria-current", "false");
  });
});

describe("MenuRoot name validation", () => {
  it("flags an empty name and blocks Host Game", () => {
    mockSession();
    useMenuNavStore.setState({ screen: "private" });
    render(<MenuRoot />);

    fireEvent.click(screen.getByRole("button", { name: "Host Game" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Name your warlock first.");
    expect(gameSessionRef.current!.hostPrivate).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Warlock name")).toHaveAttribute("aria-invalid", "true");
  });

  it("clears the error once a name is typed and allows Host Game to proceed", () => {
    const session = mockSession();
    useMenuNavStore.setState({ screen: "private" });
    render(<MenuRoot />);

    fireEvent.click(screen.getByRole("button", { name: "Host Game" }));
    expect(screen.getByRole("alert")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Warlock name"), { target: { value: "Ember" } });
    expect(screen.queryByRole("alert")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Host Game" }));
    expect(session.hostPrivate).toHaveBeenCalledWith("Ember", expect.objectContaining({ character: expect.any(String) }));
  });
});

describe("MenuRoot online screen (guard.ui #11: queue status, no room browser)", () => {
  it("renders queue status and a cancel affordance instead of a room list", () => {
    useUiStore.setState({ queue: { searching: true, status: "Searching Southeast Asia…", canCancel: true } });
    render(<MenuRoot />);

    expect(screen.getByText("Searching Southeast Asia…")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.queryByRole("list", { name: /rooms/i })).toBeNull();
  });

  it("Quick Match requires a name and dispatches gameSessionRef.quickMatch when valid", () => {
    const session = mockSession();
    render(<MenuRoot />);

    fireEvent.click(screen.getByRole("button", { name: "Quick Match" }));
    expect(session.quickMatch).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Warlock name"), { target: { value: "Frost" } });
    fireEvent.click(screen.getByRole("button", { name: "Quick Match" }));
    expect(session.quickMatch).toHaveBeenCalledTimes(1);
  });

  it("cancel queue dispatches gameSessionRef.cancelQueue", () => {
    const session = mockSession();
    useUiStore.setState({ queue: { searching: true, status: "Searching…", canCancel: true } });
    render(<MenuRoot />);

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(session.cancelQueue).toHaveBeenCalledTimes(1);
  });
});

describe("MenuRoot private screen", () => {
  it("joins by code once a valid name and 4+ char code are entered", () => {
    const session = mockSession();
    useMenuNavStore.setState({ screen: "private" });
    render(<MenuRoot />);

    fireEvent.change(screen.getByLabelText("Warlock name"), { target: { value: "Storm" } });
    fireEvent.change(screen.getByLabelText("Room code"), { target: { value: "abcd" } });
    fireEvent.click(screen.getByRole("button", { name: "Join" }));

    expect(session.join).toHaveBeenCalledWith("Storm", "ABCD", expect.any(String));
  });

  it("rejects a too-short room code without calling join", () => {
    const session = mockSession();
    useMenuNavStore.setState({ screen: "private" });
    render(<MenuRoot />);

    fireEvent.change(screen.getByLabelText("Warlock name"), { target: { value: "Storm" } });
    fireEvent.change(screen.getByLabelText("Room code"), { target: { value: "ab" } });
    fireEvent.click(screen.getByRole("button", { name: "Join" }));

    expect(session.join).not.toHaveBeenCalled();
  });
});
