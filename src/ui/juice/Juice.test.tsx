// @vitest-environment jsdom
// Integration coverage for <Juice/> (design §9a #168) — the single decorator
// mounted at UiRoot's root. Also the sub-issue's explicit anti-pattern guard:
// legacy screens.js/nav-feel.js/gamepad.js/credits.js each injected a
// <style> tag and/or ran a MutationObserver; this suite asserts the React
// port does neither, across every screen it renders under.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { useSessionStore } from "../../store/useSessionStore";
import { useMenuNavStore } from "../../store/useMenuNavStore";
import { Juice } from "./Juice";

vi.mock("../../audio", () => ({ menuCue: vi.fn() }));

beforeEach(() => {
  useSessionStore.setState({ screen: "menu" });
  useMenuNavStore.setState({ screen: "online" });
});

afterEach(() => {
  cleanup();
  document.getElementById("fx-layer")?.remove();
});

describe("Juice", () => {
  it("mounts without crashing on the menu screen and renders the credits trigger", () => {
    render(<Juice />);
    expect(screen.getByRole("button", { name: "Open credits" })).toBeInTheDocument();
  });

  it("mounts without crashing on the lobby/game screens too (credits trigger hidden)", () => {
    useSessionStore.setState({ screen: "lobby" });
    const { rerender } = render(<Juice />);
    expect(screen.queryByRole("button", { name: "Open credits" })).toBeNull();
    useSessionStore.setState({ screen: "game" });
    rerender(<Juice />);
    expect(screen.queryByRole("button", { name: "Open credits" })).toBeNull();
  });

  it("never constructs a MutationObserver (the legacy DOM-observing anti-pattern P5 removes)", () => {
    const ObserverSpy = vi.fn();
    const original = window.MutationObserver;
    window.MutationObserver = ObserverSpy as unknown as typeof MutationObserver;
    render(<Juice />);
    useSessionStore.getState().setScreen("lobby");
    useMenuNavStore.getState().setScreen("private");
    expect(ObserverSpy).not.toHaveBeenCalled();
    window.MutationObserver = original;
  });

  it("never injects a <style> tag (legacy's document.createElement('style') pattern)", () => {
    const before = document.querySelectorAll("style").length;
    render(<Juice />);
    useSessionStore.getState().setScreen("lobby");
    useMenuNavStore.getState().setScreen("private");
    expect(document.querySelectorAll("style").length).toBe(before);
  });
});
