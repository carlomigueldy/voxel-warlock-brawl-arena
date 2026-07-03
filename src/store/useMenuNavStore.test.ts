// Store-slice unit tests for useMenuNavStore (design §3 point 3) — pure
// ephemeral state, no persistence, defaults to "online" like ui.js's own
// `_menuScreen`.
import { describe, it, expect, beforeEach } from "vitest";
import { useMenuNavStore } from "./useMenuNavStore";

beforeEach(() => {
  useMenuNavStore.setState({ screen: "online" });
});

describe("useMenuNavStore", () => {
  it("defaults to the online screen (matches ui.js's own default)", () => {
    expect(useMenuNavStore.getState().screen).toBe("online");
  });

  it("setScreen switches the active sub-screen", () => {
    useMenuNavStore.getState().setScreen("private");
    expect(useMenuNavStore.getState().screen).toBe("private");
    useMenuNavStore.getState().setScreen("tutorial");
    expect(useMenuNavStore.getState().screen).toBe("tutorial");
  });
});
