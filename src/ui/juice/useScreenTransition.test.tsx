// @vitest-environment jsdom
// Unit coverage for the useScreenTransition port of src/screens.js (design
// §9a #168): no MutationObserver anywhere — it reacts to useSessionStore.screen
// directly. Covers the FX/audio-cue trigger, the reduced-motion gate (audio
// kept, visuals skipped), and the lobby -> game round card.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { useSessionStore } from "../../store/useSessionStore";
import { FX } from "../../hooks/useFx";
import { menuCue } from "../../audio";
import { useScreenTransition } from "./useScreenTransition";

vi.mock("../../audio", () => ({ menuCue: vi.fn() }));

function Host() {
  const { roundCard } = useScreenTransition();
  return <div data-testid="host">{roundCard ? "round" : "none"}</div>;
}

beforeEach(() => {
  useSessionStore.setState({ screen: "menu" });
  FX.reducedMotion = false;
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  document.getElementById("fx-layer")?.remove();
});

describe("useScreenTransition", () => {
  it("does nothing on first mount — no prior screen to transition from", () => {
    render(<Host />);
    expect(menuCue).not.toHaveBeenCalled();
  });

  it("fires the transition audio cue + FX flash/burst on a screen change", () => {
    const flashSpy = vi.spyOn(FX, "flash");
    const burstSpy = vi.spyOn(FX, "burst");
    render(<Host />);
    act(() => {
      useSessionStore.getState().setScreen("lobby");
    });
    expect(menuCue).toHaveBeenCalledWith("transition");
    expect(flashSpy).toHaveBeenCalled();
    expect(burstSpy).toHaveBeenCalled();
  });

  it("under reduced motion, skips FX but still fires the audio cue (design §7: never silenced)", () => {
    FX.reducedMotion = true;
    const flashSpy = vi.spyOn(FX, "flash");
    const burstSpy = vi.spyOn(FX, "burst");
    render(<Host />);
    act(() => {
      useSessionStore.getState().setScreen("lobby");
    });
    expect(menuCue).toHaveBeenCalledWith("transition");
    expect(flashSpy).not.toHaveBeenCalled();
    expect(burstSpy).not.toHaveBeenCalled();
  });

  it("shows the round card only on a lobby -> game transition, and auto-clears", () => {
    vi.useFakeTimers();
    useSessionStore.setState({ screen: "lobby" });
    render(<Host />);
    act(() => {
      useSessionStore.getState().setScreen("game");
    });
    expect(screen.getByTestId("host").textContent).toBe("round");
    act(() => {
      vi.advanceTimersByTime(1700);
    });
    expect(screen.getByTestId("host").textContent).toBe("none");
  });

  it("does not show the round card on a menu -> lobby transition", () => {
    render(<Host />);
    act(() => {
      useSessionStore.getState().setScreen("lobby");
    });
    expect(screen.getByTestId("host").textContent).toBe("none");
  });

  it("does not show the round card under reduced motion even lobby -> game", () => {
    FX.reducedMotion = true;
    useSessionStore.setState({ screen: "lobby" });
    render(<Host />);
    act(() => {
      useSessionStore.getState().setScreen("game");
    });
    expect(screen.getByTestId("host").textContent).toBe("none");
  });
});
