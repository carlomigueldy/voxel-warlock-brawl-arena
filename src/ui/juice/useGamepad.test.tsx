// @vitest-environment jsdom
// Unit coverage for the useGamepad port of src/gamepad.js (design §9a #168):
// a rAF poll loop over navigator.getGamepads() (jsdom has no real Gamepad
// API, so it's stubbed here), translating button presses into synthetic
// keyboard events on document.activeElement — no MutationObserver, and the
// `gamepad-active` class replaces the legacy injected <style> tag's target
// (the CSS itself lives in Juice.module.css's :global() block instead).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { FX } from "../../hooks/useFx";
import { menuCue } from "../../audio";
import { useGamepad } from "./useGamepad";

vi.mock("../../audio", () => ({ menuCue: vi.fn() }));

function Host() {
  const { toast } = useGamepad();
  return <div data-testid="host">{toast ?? "none"}</div>;
}

// jsdom's `Gamepad`/`GamepadButton` lib types declare every field readonly
// (real browsers never let you mutate a live gamepad snapshot either) — this
// repo has no Gamepad API polyfill, so tests need their own freely-mutable
// stand-in shape, cast to `Gamepad` only at the `navigator.getGamepads()`
// boundary the hook actually reads through.
interface MockButton {
  pressed: boolean;
  touched: boolean;
  value: number;
}
interface MockGamepad {
  axes: number[];
  buttons: MockButton[];
  connected: boolean;
  id: string;
  index: number;
  mapping: string;
  timestamp: number;
}

function makeGamepad(): MockGamepad {
  return {
    axes: [0, 0],
    buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })),
    connected: true,
    id: "mock-pad",
    index: 0,
    mapping: "standard",
    timestamp: 0,
  };
}

let pads: (Gamepad | null)[] = [];

beforeEach(() => {
  pads = [];
  Object.defineProperty(navigator, "getGamepads", {
    value: () => pads,
    writable: true,
    configurable: true,
  });
  FX.reducedMotion = false;
  vi.clearAllMocks();
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  document.documentElement.classList.remove("gamepad-active");
  vi.useRealTimers();
  // @ts-expect-error test-only cleanup of the stubbed API
  delete navigator.getGamepads;
});

describe("useGamepad", () => {
  it("toggles the gamepad-active class and shows a toast on connect", () => {
    render(<Host />);
    pads = [makeGamepad() as unknown as Gamepad];
    act(() => {
      window.dispatchEvent(new Event("gamepadconnected"));
    });
    expect(document.documentElement.classList.contains("gamepad-active")).toBe(true);
    expect(screen.getByTestId("host").textContent).toBe("Controller connected");
  });

  it("suppresses the toast under reduced motion but still marks gamepad-active", () => {
    FX.reducedMotion = true;
    render(<Host />);
    pads = [makeGamepad() as unknown as Gamepad];
    act(() => {
      window.dispatchEvent(new Event("gamepadconnected"));
    });
    expect(document.documentElement.classList.contains("gamepad-active")).toBe(true);
    expect(screen.getByTestId("host").textContent).toBe("none");
  });

  it("clears gamepad-active on disconnect once no pad remains", () => {
    render(<Host />);
    pads = [makeGamepad() as unknown as Gamepad];
    act(() => {
      window.dispatchEvent(new Event("gamepadconnected"));
    });
    pads = [];
    act(() => {
      window.dispatchEvent(new Event("gamepaddisconnected"));
    });
    expect(document.documentElement.classList.contains("gamepad-active")).toBe(false);
  });

  it("maps the A button to Enter + a real click on the focused element, and cues confirm", () => {
    const btn = document.createElement("button");
    document.body.appendChild(btn);
    btn.focus();
    const clickSpy = vi.spyOn(btn, "click");

    render(<Host />);
    const pad = makeGamepad();
    pads = [pad as unknown as Gamepad];
    act(() => {
      window.dispatchEvent(new Event("gamepadconnected"));
    });

    pad.buttons[0] = { pressed: true, touched: true, value: 1 };
    act(() => {
      vi.advanceTimersByTime(20);
    });

    expect(clickSpy).toHaveBeenCalled();
    expect(menuCue).toHaveBeenCalledWith("confirm");
    btn.remove();
  });

  it("maps the B button to a synthetic Escape keydown and cues back", () => {
    render(<Host />);
    const pad = makeGamepad();
    pads = [pad as unknown as Gamepad];
    act(() => {
      window.dispatchEvent(new Event("gamepadconnected"));
    });

    const keydownSpy = vi.fn();
    document.addEventListener("keydown", keydownSpy);

    pad.buttons[1] = { pressed: true, touched: true, value: 1 };
    act(() => {
      vi.advanceTimersByTime(20);
    });

    expect(keydownSpy).toHaveBeenCalledWith(expect.objectContaining({ key: "Escape" }));
    expect(menuCue).toHaveBeenCalledWith("back");
    document.removeEventListener("keydown", keydownSpy);
  });

  it("maps a right stick tilt to a synthetic ArrowRight keydown", () => {
    render(<Host />);
    const pad = makeGamepad();
    pads = [pad as unknown as Gamepad];
    act(() => {
      window.dispatchEvent(new Event("gamepadconnected"));
    });

    const keydownSpy = vi.fn();
    document.addEventListener("keydown", keydownSpy);

    pad.axes = [0.9, 0];
    act(() => {
      vi.advanceTimersByTime(20);
    });

    expect(keydownSpy).toHaveBeenCalledWith(expect.objectContaining({ key: "ArrowRight" }));
    document.removeEventListener("keydown", keydownSpy);
  });
});
