// @vitest-environment jsdom
// RTL coverage for AccountScreen — auth tab wiring (guest/signIn/signUp/
// upgrade/signOut dispatched to src/auth.ts, mirroring wireLegacyUiToStores'
// legacy-mode equivalents) and guard.ui #7 ("spell slot hotkeys are
// configurable and persisted") RTL replacement (design §8): rebind picker ->
// useSettingsStore.setSpellSlotHotkey/setItemSlotHotkey persistence.
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { AccountScreen } from "./AccountScreen";
import { useSettingsStore } from "../../../store/useSettingsStore";
import { useUiStore } from "../../../store/useUiStore";
import * as auth from "../../../auth.js";

beforeEach(() => {
  useUiStore.setState({ onlineEnabled: true, authView: null });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("AccountScreen auth", () => {
  it("signs in as guest and reflects the resulting identity", async () => {
    const guestUser = { id: "g1", email: null, username: "Guest123", isGuest: true };
    vi.spyOn(auth, "signInAsGuest").mockResolvedValue(guestUser);
    vi.spyOn(auth, "getUser").mockReturnValue(guestUser);

    render(<AccountScreen />);
    // "Play as Guest" labels both the tab button and (once selected) the
    // submit button — disambiguate by `type` rather than accessible name.
    fireEvent.click(screen.getByRole("button", { name: "Play as Guest" }));
    const submitBtn = screen.getAllByRole("button", { name: "Play as Guest" }).find((b) => b.getAttribute("type") === "submit")!;
    fireEvent.click(submitBtn);

    await waitFor(() => expect(useUiStore.getState().authView).toEqual(guestUser));
    expect(screen.getByText("Playing as Guest")).toBeInTheDocument();
  });

  it("signs out and clears authView", async () => {
    useUiStore.setState({ authView: { id: "u1", email: "a@b.com", username: "Warlock", isGuest: false } });
    vi.spyOn(auth, "signOut").mockResolvedValue(null);

    render(<AccountScreen />);
    fireEvent.click(screen.getByRole("button", { name: "Sign Out" }));

    await waitFor(() => expect(useUiStore.getState().authView).toBeNull());
  });

  it("surfaces a sign-in error inline without crashing", async () => {
    vi.spyOn(auth, "signInEmail").mockRejectedValue(new Error("bad credentials"));
    render(<AccountScreen />);

    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "a@b.com" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "x" } });
    // "Sign In" labels both the (already-active) tab button and the submit
    // button — disambiguate by `type` rather than accessible name.
    const submitBtn = screen.getAllByRole("button", { name: "Sign In" }).find((b) => b.getAttribute("type") === "submit")!;
    fireEvent.click(submitBtn);

    expect(await screen.findByText(/Sign in failed: bad credentials/)).toBeInTheDocument();
  });

  it("hides the auth form entirely when Supabase is not configured", () => {
    useUiStore.setState({ onlineEnabled: false });
    render(<AccountScreen />);
    expect(screen.queryByRole("button", { name: "Sign In" })).toBeNull();
    expect(screen.getByRole("alert")).toHaveTextContent(/Connect a Supabase project/);
  });
});

describe("AccountScreen hotkey settings (guard.ui #7)", () => {
  it("rebinds a spell slot hotkey on the next keypress and persists it via useSettingsStore", () => {
    render(<AccountScreen />);
    const picker = screen.getByRole("button", { name: "Rebind spell slot 1 hotkey" });
    const before = useSettingsStore.getState().spellSlotHotkeys[0];
    expect(picker).toHaveTextContent(before);

    fireEvent.click(picker);
    fireEvent.keyDown(window, { code: "KeyP" });

    expect(useSettingsStore.getState().spellSlotHotkeys[0]).toBe("P");
    expect(picker).toHaveTextContent("P");
  });

  it("rebinds an item slot hotkey the same way", () => {
    render(<AccountScreen />);
    const picker = screen.getByRole("button", { name: "Rebind item slot 1 hotkey" });
    fireEvent.click(picker);
    fireEvent.keyDown(window, { code: "Digit5" });
    expect(useSettingsStore.getState().itemSlotHotkeys[0]).toBe("5");
  });
});
