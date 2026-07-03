// @vitest-environment jsdom
// RTL coverage for SocialSettingsModal (design §9a Wave-2 / issue #166):
// mic/volume/bubbles persist through useSocialPrefsStore (vwb-social-prefs),
// the PTT key picker is sourced from useSettingsStore (vwb-ptt-key) NOT
// useSocialPrefsStore — design §7b nit 3 — and the mute-list roster
// toggles/clears via social.ts + gameSessionRef intents.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, act } from "@testing-library/react";
import { SocialSettingsModal } from "./SocialSettingsModal";
import { useSocialPrefsStore } from "../../store/useSocialPrefsStore";
import { useSettingsStore } from "../../store/useSettingsStore";
import { useRosterStore } from "../../store/useRosterStore";
import { useSocialRosterStore } from "../../store/useSocialRosterStore";
import { gameSessionRef, type GameSessionIntents } from "../../loop/useGameSession";
import * as social from "../../social.js";

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

function syncRoster(players: { id: string; name: string; colorIndex: number; userId?: string | null }[]) {
  useRosterStore.getState().sync({
    playerIds: players.map((p) => p.id),
    boltIds: [], mobIds: [], meteorIds: [], itemIds: [],
    meta: Object.fromEntries(players.map((p) => [p.id, { name: p.name, colorIndex: p.colorIndex, userId: p.userId ?? null }])),
  });
}

beforeEach(() => {
  localStorage.clear();
  useSettingsStore.setState({ pttKey: "Backquote" });
  useRosterStore.getState().reset();
  useSocialRosterStore.getState().reset();
});

afterEach(() => {
  cleanup();
  gameSessionRef.current = null;
  localStorage.clear();
});

describe("SocialSettingsModal — mic/volume/bubbles persist via useSocialPrefsStore", () => {
  it("toggling voice chat writes the store and pushes a socialPrefs intent", () => {
    const socialPrefs = vi.fn();
    mockSession({ socialPrefs });
    render(<SocialSettingsModal open onClose={() => {}} onReadConduct={() => {}} />);
    fireEvent.click(screen.getByRole("switch", { name: "Voice chat (push-to-talk)" }));
    expect(useSocialPrefsStore.getState().micEnabled).toBe(true);
    expect(socialPrefs).toHaveBeenCalledWith({ micEnabled: true });
    expect(JSON.parse(localStorage.getItem("vwb-social-prefs") || "{}").micEnabled).toBe(true);
  });

  it("the volume slider writes 0-1 into the store and pushes a socialPrefs intent", () => {
    const socialPrefs = vi.fn();
    mockSession({ socialPrefs });
    render(<SocialSettingsModal open onClose={() => {}} onReadConduct={() => {}} />);
    fireEvent.change(screen.getByLabelText("Voice volume"), { target: { value: "40" } });
    expect(useSocialPrefsStore.getState().masterVolume).toBe(0.4);
    expect(socialPrefs).toHaveBeenCalledWith({ masterVolume: 0.4 });
  });

  it("show-chat-bubbles is local-only (no socialPrefs intent) but persists", () => {
    const socialPrefs = vi.fn();
    mockSession({ socialPrefs });
    render(<SocialSettingsModal open onClose={() => {}} onReadConduct={() => {}} />);
    fireEvent.click(screen.getByRole("switch", { name: "Show chat bubbles" }));
    expect(useSocialPrefsStore.getState().showBubbles).toBe(false);
    expect(socialPrefs).not.toHaveBeenCalled();
  });
});

describe("SocialSettingsModal — PTT key sourced from useSettingsStore (design §7b nit 3)", () => {
  it("displays the current useSettingsStore.pttKey, not useSocialPrefsStore's inert field", () => {
    useSettingsStore.setState({ pttKey: "KeyV" });
    useSocialPrefsStore.setState({ pttKey: "Backquote" }); // deliberately different/stale
    render(<SocialSettingsModal open onClose={() => {}} onReadConduct={() => {}} />);
    expect(screen.getByRole("button", { name: "Rebind push-to-talk key" })).toHaveTextContent("V");
  });

  it("rebinding writes useSettingsStore.setPttKey (vwb-ptt-key), not useSocialPrefsStore", () => {
    render(<SocialSettingsModal open onClose={() => {}} onReadConduct={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Rebind push-to-talk key" }));
    // KeyD is free (not a movement key's spell-cast code — see config.ts's
    // SPELLS table; W/A/S/D themselves are movement, not spell hotkeys).
    fireEvent.keyDown(window, { code: "KeyD" });
    expect(useSettingsStore.getState().pttKey).toBe("KeyD");
    expect(localStorage.getItem("vwb-ptt-key")).toBe("KeyD");
  });

  it("rejects a reserved code (Escape) and keeps the previous key", () => {
    render(<SocialSettingsModal open onClose={() => {}} onReadConduct={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Rebind push-to-talk key" }));
    fireEvent.keyDown(window, { code: "Escape" });
    expect(useSettingsStore.getState().pttKey).toBe("Backquote");
  });
});

describe("SocialSettingsModal — mute list", () => {
  it("lists other players and toggles mute via gameSessionRef.toggleMute", () => {
    const toggleMute = vi.fn();
    mockSession({ toggleMute });
    syncRoster([{ id: "p2", name: "Beatrix", colorIndex: 1 }]);
    render(<SocialSettingsModal open onClose={() => {}} onReadConduct={() => {}} />);
    expect(screen.getByText("Beatrix")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Mute Beatrix" }));
    expect(toggleMute).toHaveBeenCalledWith("p2");
  });

  it("Clear Mute List calls social.clearMuteList() and gameSessionRef.clearMutes(roster)", () => {
    const clearMutes = vi.fn();
    mockSession({ clearMutes });
    const clearSpy = vi.spyOn(social, "clearMuteList");
    syncRoster([{ id: "p2", name: "Beatrix", colorIndex: 1 }]);
    render(<SocialSettingsModal open onClose={() => {}} onReadConduct={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Clear Mute List" }));
    expect(clearSpy).toHaveBeenCalled();
    expect(clearMutes).toHaveBeenCalledWith(["p2"]);
    clearSpy.mockRestore();
  });

  it("shows presence glyphs (speaking/typing/afk) from useSocialRosterStore", () => {
    syncRoster([{ id: "p2", name: "Beatrix", colorIndex: 1 }]);
    act(() => useSocialRosterStore.getState().sync([{ id: "p2", ty: 1, afk: 0, spk: 1 }]));
    render(<SocialSettingsModal open onClose={() => {}} onReadConduct={() => {}} />);
    expect(screen.getByLabelText("Speaking").className).toMatch(/glyphActive/);
    expect(screen.getByLabelText("Typing").className).toMatch(/glyphActive/);
    expect(screen.getByLabelText("AFK").className).not.toMatch(/glyphActive/);
  });
});

describe("SocialSettingsModal — Re-read the Code", () => {
  it("clicking it calls onReadConduct", () => {
    const onReadConduct = vi.fn();
    render(<SocialSettingsModal open onClose={() => {}} onReadConduct={onReadConduct} />);
    fireEvent.click(screen.getByRole("button", { name: "Re-read the Code" }));
    expect(onReadConduct).toHaveBeenCalledTimes(1);
  });
});
