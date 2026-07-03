// @vitest-environment jsdom
// RTL coverage for the first-run Onboarding modal (design §9/§9a) — proves
// the design floor (renders on first run, hidden once onboarded, persists
// through useSettingsStore, modal focus-trap) and issue #91's two
// acceptance criteria: Escape during hotkey capture cancels just the
// capture (not the whole flow), and the hotkey-capture step is skipped
// entirely on touch devices.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { CFG } from "../../config.js";
import { SPELL_SLOT_HOTKEY_STORAGE_KEY } from "../../input.js";
import { useSettingsStore } from "../../store/useSettingsStore";
import { isTouchDevice } from "./isTouchDevice";
import { Onboarding } from "./Onboarding";

// jsdom's `window` satisfies `"ontouchstart" in window` unconditionally, so
// there is no DOM-level way to simulate "non-touch" — mock the module
// directly instead (see isTouchDevice.ts's header for why it's a separate
// module in the first place).
vi.mock("./isTouchDevice", () => ({ isTouchDevice: vi.fn(() => false) }));

function resetSettingsStore() {
  localStorage.clear();
  useSettingsStore.setState({
    name: "",
    character: CFG.DEFAULT_CHARACTER,
    region: "",
    onboarded: false,
    spellSlotHotkeys: [...CFG.DEFAULT_SPELL_SLOT_HOTKEYS],
    itemSlotHotkeys: [...CFG.DEFAULT_ITEM_SLOT_HOTKEYS],
    pttKey: CFG.SOCIAL.PTT_DEFAULT_KEY,
  });
}

beforeEach(() => {
  resetSettingsStore();
  vi.mocked(isTouchDevice).mockReturnValue(false);
});

afterEach(() => {
  cleanup();
});

describe("Onboarding — first-run gating", () => {
  it("renders on first run (onboarded=false)", () => {
    render(<Onboarding />);
    expect(screen.getByRole("dialog", { name: "Prepare for the Arena" })).toBeInTheDocument();
  });

  it("is hidden once onboarded", () => {
    useSettingsStore.setState({ onboarded: true });
    render(<Onboarding />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("Onboarding — modal focus-trap (design floor)", () => {
  it("mounts as a dialog with focus starting inside it", () => {
    render(<Onboarding />);
    const dialog = screen.getByRole("dialog", { name: "Prepare for the Arena" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog.contains(document.activeElement)).toBe(true);
  });
});

describe("Onboarding — steps + persistence", () => {
  it("walks Name -> Character -> Goal -> Hotkeys in order and persists name/character/onboarded on completion", () => {
    render(<Onboarding />);
    expect(screen.getByRole("heading", { name: "Name your warlock" })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Warlock name"), { target: { value: "Carlo" } });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByRole("heading", { name: "Choose your warlock" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("radio", { name: /Frost Mage/ }));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByRole("heading", { name: "Know the arena" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByRole("heading", { name: "Set your hotkeys" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Enter the Arena" }));

    expect(useSettingsStore.getState().onboarded).toBe(true);
    expect(useSettingsStore.getState().name).toBe("Carlo");
    expect(useSettingsStore.getState().character).toBe("frost");
    expect(localStorage.getItem("vwb-onboarded-v1")).toBe("1");
    expect(localStorage.getItem("vwb-name")).toBe("Carlo");
    expect(localStorage.getItem("vwb-character")).toBe("frost");
  });

  it("Skip finishes onboarding from any step", () => {
    render(<Onboarding />);
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.click(screen.getByRole("button", { name: "Skip" }));
    expect(useSettingsStore.getState().onboarded).toBe(true);
  });

  it("Escape (not capturing) finishes onboarding like Skip", () => {
    render(<Onboarding />);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(useSettingsStore.getState().onboarded).toBe(true);
  });
});

describe("Onboarding — hotkeys step + issue #91", () => {
  function openHotkeysStep() {
    render(<Onboarding />);
    fireEvent.click(screen.getByRole("button", { name: "Next" })); // name -> character
    fireEvent.click(screen.getByRole("button", { name: "Next" })); // character -> goal
    fireEvent.click(screen.getByRole("button", { name: "Next" })); // goal -> hotkeys
  }

  it("binds a hotkey by clicking a chip and pressing a key, persisting via useSettingsStore", () => {
    openHotkeysStep();
    const chip = screen.getByRole("button", { name: /Rebind Fireball hotkey/ });
    expect(chip).toHaveTextContent(CFG.DEFAULT_SPELL_SLOT_HOTKEYS[0]);

    fireEvent.click(chip);
    expect(chip).toHaveTextContent("…");

    fireEvent.keyDown(chip, { key: "j", code: "KeyJ" });

    expect(chip).toHaveTextContent("J");
    expect(useSettingsStore.getState().spellSlotHotkeys[0]).toBe("J");
    expect(JSON.parse(localStorage.getItem(SPELL_SLOT_HOTKEY_STORAGE_KEY) || "[]")[0]).toBe("J");
  });

  it("issue #91: Escape during hotkey capture cancels only the capture, not the whole flow", () => {
    openHotkeysStep();
    const chip = screen.getByRole("button", { name: /Rebind Fireball hotkey/ });
    const original = chip.textContent;

    fireEvent.click(chip);
    expect(chip).toHaveTextContent("…");

    fireEvent.keyDown(chip, { key: "Escape", code: "Escape" });

    // Capture is cancelled (chip reverts, still on the hotkeys step)...
    expect(chip).toHaveTextContent(original || "");
    expect(screen.getByRole("heading", { name: "Set your hotkeys" })).toBeInTheDocument();
    // ...and onboarding itself was NOT closed/finished by the same Escape.
    expect(useSettingsStore.getState().onboarded).toBe(false);
  });

  it("issue #91: a reserved key (Enter) during capture shows feedback and cancels the capture", () => {
    openHotkeysStep();
    const chip = screen.getByRole("button", { name: /Rebind Fireball hotkey/ });
    fireEvent.click(chip);
    fireEvent.keyDown(chip, { key: "Enter", code: "Enter" });
    expect(screen.getByText("That key is reserved — pick another.")).toBeInTheDocument();
    expect(chip).not.toHaveTextContent("…");
  });

  it("issue #91: the hotkey-capture step is skipped entirely when isTouch is true", () => {
    vi.mocked(isTouchDevice).mockReturnValue(true);
    render(<Onboarding />);
    fireEvent.click(screen.getByRole("button", { name: "Next" })); // name -> character
    fireEvent.click(screen.getByRole("button", { name: "Next" })); // character -> goal
    expect(screen.getByRole("heading", { name: "Know the arena" })).toBeInTheDocument();
    // Goal is the last step on touch — no "Hotkeys" rail item, and Next
    // reads "Enter the Arena" instead of advancing into a capture UI.
    expect(screen.queryByText("Hotkeys")).toBeNull();
    expect(screen.getByRole("button", { name: "Enter the Arena" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Enter the Arena" }));
    expect(useSettingsStore.getState().onboarded).toBe(true);
  });
});
