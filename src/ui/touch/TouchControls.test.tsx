// @vitest-environment jsdom
// RTL coverage for the P5 touch/mobile control layer (design §9 #167
// p5-touch). Covers: renders under emulated touch, hidden on non-touch, and
// its controls dispatch the same InputController intents legacy's
// `#touch-controls` does (design §2/§167: "do NOT invent a new input
// channel" — asserted directly against the real `getInput()` singleton, not
// a mock, so this proves the actual wiring). Ability-select coverage moved
// to AbilityBar.test.tsx (#178's fix) — this file no longer owns that UI.
//
// The touch/non-touch split is driven by `vi.doMock("./detectTouch", ...)` +
// a dynamic re-import (same technique UiRoot.test.tsx uses for `CAPTURE`),
// not by mutating the real jsdom `window`/`navigator` — jsdom always defines
// `window.ontouchstart` (unlike a real non-touch browser), so the "false"
// branch of detectTouch() isn't reachable by mutating the ambient globals
// alone; see detectTouch.ts's own comment. (getInput()'s InputController is
// exempt from the module-reset staleness concern — services/registry.ts
// keys it off globalThis precisely so it survives module resets, per its
// own comment.)
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { getInput } from "../../services/registry";

beforeEach(() => {
  vi.resetModules();
  getInput().touchMove = [0, 0];
  getInput().selectedSpell = "fireball";
});

afterEach(() => {
  cleanup();
  vi.doUnmock("./detectTouch");
});

async function renderTouchControls(touch: boolean) {
  vi.doMock("./detectTouch", () => ({ detectTouch: () => touch }));
  const { TouchControls } = await import("./TouchControls");
  return render(<TouchControls />);
}

describe("TouchControls", () => {
  it("renders nothing on a non-touch device", async () => {
    const { container } = await renderTouchControls(false);
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByTestId("touch-controls")).toBeNull();
  });

  it("renders the joystick and fire button under emulated touch", async () => {
    await renderTouchControls(true);
    expect(screen.getByTestId("touch-controls")).toBeInTheDocument();
    expect(screen.getByTestId("touch-joystick")).toBeInTheDocument();
    expect(screen.getByTestId("touch-fire")).toBeInTheDocument();
  });

  it("dragging the joystick sets InputController.touchMove, normalized and clamped to its own radius", async () => {
    await renderTouchControls(true);
    const joystick = screen.getByTestId("touch-joystick");
    // 100x100 square centered at (150,150) -> radius 50, origin (150,150).
    vi.spyOn(joystick, "getBoundingClientRect").mockReturnValue({
      left: 100, top: 100, width: 100, height: 100, right: 200, bottom: 200, x: 100, y: 100, toJSON() {},
    });
    (joystick as HTMLElement & { setPointerCapture: () => void }).setPointerCapture = vi.fn();

    fireEvent.pointerDown(joystick, { pointerId: 1, clientX: 150, clientY: 150 });
    // Drag straight right, past the radius -> clamped to [1, 0].
    fireEvent.pointerMove(joystick, { pointerId: 1, clientX: 250, clientY: 150 });
    expect(getInput().touchMove[0]).toBeCloseTo(1);
    expect(getInput().touchMove[1]).toBeCloseTo(0);

    // Halfway up-left -> both axes negative, magnitude under the radius (unclamped).
    fireEvent.pointerMove(joystick, { pointerId: 1, clientX: 125, clientY: 125 });
    expect(getInput().touchMove[0]).toBeCloseTo(-0.5);
    expect(getInput().touchMove[1]).toBeCloseTo(-0.5);

    fireEvent.pointerUp(joystick, { pointerId: 1, clientX: 125, clientY: 125 });
    expect(getInput().touchMove).toEqual([0, 0]);
  });

  it("tapping Fire queues a cast for whatever spell is currently selected", async () => {
    await renderTouchControls(true);
    getInput().selectedSpell = "lightning";

    const queueCast = vi.spyOn(getInput(), "queueCast");
    fireEvent.click(screen.getByTestId("touch-fire"));
    expect(queueCast).toHaveBeenCalledWith("lightning");
  });
});
