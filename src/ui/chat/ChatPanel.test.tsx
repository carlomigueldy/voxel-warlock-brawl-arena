// @vitest-environment jsdom
// RTL coverage for ChatPanel (design §9a Wave-2 / issue #166): gates on
// `screen==="game"`, message list renders names/text as XSS-inert JSX text
// (never innerHTML — same invariant guard.ui #1 enforces on the legacy DOM,
// design §8), the input row gates on `useUiStore.chatOpen`, Enter sends +
// closes, Escape closes without sending, and the PTT indicator reflects the
// page-lifetime InputController's `ptt` field (polled, never the
// single-writer `onPtt` callback — see ChatPanel.tsx's header).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, act, waitFor } from "@testing-library/react";
import { ChatPanel } from "./ChatPanel";
import { useSessionStore } from "../../store/useSessionStore";
import { useUiStore } from "../../store/useUiStore";
import { useChatStore } from "../../store/useChatStore";
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
  useSessionStore.setState({ screen: "game" });
  useUiStore.setState({ chatOpen: false });
  useChatStore.getState().clear();
  getInput().ptt = false;
});

afterEach(() => {
  cleanup();
  gameSessionRef.current = null;
  getInput().ptt = false;
});

describe("ChatPanel — screen gating", () => {
  it("renders nothing outside the game screen", () => {
    useSessionStore.setState({ screen: "menu" });
    const { container } = render(<ChatPanel />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders the panel while in game", () => {
    render(<ChatPanel />);
    expect(screen.getByTestId("chat-panel")).toBeInTheDocument();
  });
});

describe("ChatPanel — message list (XSS-safe)", () => {
  it("renders sender name and text as plain text, never injected markup", () => {
    act(() => {
      useChatStore.getState().addMessage({
        name: "<img src=x onerror=alert(1)>",
        text: "<script>evil()</script> hello",
        color: 0xff5a3c,
        isSelf: false,
      });
    });
    render(<ChatPanel />);
    expect(screen.getByText("<img src=x onerror=alert(1)>")).toBeInTheDocument();
    expect(screen.getByText("<script>evil()</script> hello")).toBeInTheDocument();
    expect(document.querySelector("img")).toBeNull();
    expect(document.querySelector("script[src]")).toBeNull();
  });

  it("marks the local player's own lines with the self class", () => {
    act(() => {
      useChatStore.getState().addMessage({ name: "Ada", text: "hi", color: 0xff5a3c, isSelf: true });
    });
    render(<ChatPanel />);
    const line = screen.getByText("hi").closest("div")!;
    expect(line.className).toMatch(/self/);
  });
});

describe("ChatPanel — input row gating", () => {
  it("shows a toggle button (not the input) while chat is closed", () => {
    render(<ChatPanel />);
    expect(screen.getByRole("button", { name: "Open chat" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Chat message")).toBeNull();
  });

  it("clicking the toggle opens chat and reveals the input", () => {
    render(<ChatPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Open chat" }));
    expect(useUiStore.getState().chatOpen).toBe(true);
    expect(screen.getByLabelText("Chat message")).toBeInTheDocument();
  });

  it("mirrors chatOpen into the page-lifetime InputController's chatting field", () => {
    render(<ChatPanel />);
    act(() => useUiStore.getState().setChatOpen(true));
    expect(getInput().chatting).toBe(true);
    act(() => useUiStore.getState().setChatOpen(false));
    expect(getInput().chatting).toBe(false);
  });
});

describe("ChatPanel — sending", () => {
  it("Enter sends the trimmed text via gameSessionRef.sendChat and closes chat", () => {
    const sendChat = vi.fn();
    mockSession({ sendChat });
    render(<ChatPanel />);
    act(() => useUiStore.getState().setChatOpen(true));
    const input = screen.getByLabelText("Chat message") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "  gg  " } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(sendChat).toHaveBeenCalledWith("gg");
    expect(useUiStore.getState().chatOpen).toBe(false);
  });

  it("Enter with an empty/whitespace-only input does not call sendChat, but still closes", () => {
    const sendChat = vi.fn();
    mockSession({ sendChat });
    render(<ChatPanel />);
    act(() => useUiStore.getState().setChatOpen(true));
    const input = screen.getByLabelText("Chat message") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(sendChat).not.toHaveBeenCalled();
    expect(useUiStore.getState().chatOpen).toBe(false);
  });

  it("Escape closes chat without sending", () => {
    const sendChat = vi.fn();
    mockSession({ sendChat });
    render(<ChatPanel />);
    act(() => useUiStore.getState().setChatOpen(true));
    const input = screen.getByLabelText("Chat message") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "not sent" } });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(sendChat).not.toHaveBeenCalled();
    expect(useUiStore.getState().chatOpen).toBe(false);
  });

  it("typing sends a typing(true) intent, then typing(false) after the idle debounce", async () => {
    vi.useFakeTimers();
    const sendTyping = vi.fn();
    mockSession({ sendTyping });
    render(<ChatPanel />);
    act(() => useUiStore.getState().setChatOpen(true));
    const input = screen.getByLabelText("Chat message") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "h" } });
    expect(sendTyping).toHaveBeenCalledWith(true);
    act(() => vi.advanceTimersByTime(1600));
    expect(sendTyping).toHaveBeenLastCalledWith(false);
    vi.useRealTimers();
  });
});

describe("ChatPanel — PTT indicator", () => {
  it("is hidden while the InputController's ptt field is false", () => {
    render(<ChatPanel />);
    expect(screen.queryByText("MIC")).toBeNull();
  });

  it("appears once the polled ptt field flips true", async () => {
    render(<ChatPanel />);
    act(() => {
      getInput().ptt = true;
    });
    await waitFor(() => expect(screen.getByText("MIC")).toBeInTheDocument(), { timeout: 1000 });
  });
});
