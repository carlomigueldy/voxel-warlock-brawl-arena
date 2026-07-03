// @vitest-environment jsdom
// RTL coverage for AbilityBar's touch tap-to-select addition (#167/#178 fix
// — see AbilityBar.tsx's own comment for why this bar, not a standalone
// touch-only strip, owns this now). Touch/non-touch is driven by
// `vi.doMock("../touch/detectTouch", ...)` + a dynamic re-import, same
// technique TouchControls.test.tsx and UiRoot.test.tsx use — jsdom always
// defines `window.ontouchstart`, so the negative case isn't reachable by
// mutating the ambient globals alone.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { getInput } from "../../services/registry";
import { CFG } from "../../config.js";

const spellSlots = ["fireball", null, "lightning", null, null, null];

beforeEach(() => {
  vi.restoreAllMocks(); // getInput() is a page-lifetime singleton -- spies from a prior test would otherwise carry over call history
  vi.resetModules();
  getInput().selectedSpell = "fireball";
});

afterEach(() => {
  cleanup();
  vi.doUnmock("../touch/detectTouch");
});

async function renderAbilityBar(touch: boolean) {
  vi.doMock("../touch/detectTouch", () => ({ detectTouch: () => touch }));
  const { AbilityBar } = await import("./AbilityBar");
  return render(<AbilityBar spellSlots={spellSlots} cooldowns={{}} hotkeys={CFG.DEFAULT_SPELL_SLOT_HOTKEYS} />);
}

describe("AbilityBar touch tap-to-select", () => {
  it("on a touch device, tapping an equipped slot selects it via the same channel legacy's slot click uses", async () => {
    await renderAbilityBar(true);
    const setSelectedSpell = vi.spyOn(getInput(), "setSelectedSpell");
    fireEvent.click(screen.getByRole("button", { name: /^Lightning/ }));
    expect(setSelectedSpell).toHaveBeenCalledWith("lightning");
    expect(getInput().selectedSpell).toBe("lightning");
  });

  it("on a touch device, empty slots stay non-interactive (no button, no dataset.spell to select)", async () => {
    await renderAbilityBar(true);
    const bar = screen.getByTestId("ability-bar");
    const emptyLabel = screen.getByLabelText("Spell slot 2: empty");
    expect(emptyLabel.tagName).toBe("DIV");
    // 6 total slots, only the 2 equipped ones (fireball, lightning) are buttons.
    expect(bar.querySelectorAll("button")).toHaveLength(2);
  });

  it("on a non-touch device, slots render as plain divs and tapping never calls setSelectedSpell", async () => {
    await renderAbilityBar(false);
    const bar = screen.getByTestId("ability-bar");
    expect(bar.querySelectorAll("button")).toHaveLength(0);

    const fireballSlot = screen.getByLabelText(/^Fireball/);
    expect(fireballSlot.tagName).toBe("DIV");

    const setSelectedSpell = vi.spyOn(getInput(), "setSelectedSpell");
    fireEvent.click(fireballSlot);
    expect(setSelectedSpell).not.toHaveBeenCalled();
  });

  it("selecting a slot does not add any selection-highlight state (no aria-pressed, no extra class) — the 3D reticle owns that, not this bar", async () => {
    await renderAbilityBar(true);
    const lightningBtn = screen.getByRole("button", { name: /^Lightning/ });
    fireEvent.click(lightningBtn);
    expect(lightningBtn).not.toHaveAttribute("aria-pressed");
  });
});
