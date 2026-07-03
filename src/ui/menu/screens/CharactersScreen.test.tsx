// @vitest-environment jsdom
// RTL coverage for CharactersScreen — guard.ui #4 ("menu exposes a
// character-select UI with cards and a live preview") RTL replacement
// (design §8): a radiogroup of CFG.CHARACTERS cards plus a live-preview
// slot, wired to useSettingsStore.setCharacter.
import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { CharactersScreen } from "./CharactersScreen";
import { useSettingsStore } from "../../../store/useSettingsStore";
import { CFG } from "../../../config.js";

beforeEach(() => {
  useSettingsStore.setState({ character: CFG.DEFAULT_CHARACTER });
});

afterEach(cleanup);

describe("CharactersScreen", () => {
  it("renders a radiogroup card per CFG.CHARACTERS and a live preview slot", () => {
    render(<CharactersScreen />);
    const group = screen.getByRole("radiogroup", { name: "Choose your warlock" });
    expect(group).toBeInTheDocument();
    for (const ch of CFG.CHARACTERS) {
      expect(screen.getByRole("radio", { name: new RegExp(ch.name) })).toBeInTheDocument();
    }
    expect(screen.getByTestId("char-preview")).toBeInTheDocument();
  });

  it("marks the current character as checked and selecting a card persists it", () => {
    render(<CharactersScreen />);
    const first = CFG.CHARACTERS[0];
    const second = CFG.CHARACTERS[1];
    expect(screen.getByRole("radio", { name: new RegExp(first.name) })).toHaveAttribute("aria-checked", "true");

    fireEvent.click(screen.getByRole("radio", { name: new RegExp(second.name) }));
    expect(useSettingsStore.getState().character).toBe(second.id);
    expect(screen.getByRole("radio", { name: new RegExp(second.name) })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("radio", { name: new RegExp(first.name) })).toHaveAttribute("aria-checked", "false");
  });
});
