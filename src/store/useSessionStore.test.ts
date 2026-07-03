// @vitest-environment jsdom
// Store-slice unit tests for useSessionStore — design §8(d): "endSession
// bumping sessionGen." Also covers the value-gating on setPhase/setScreen/
// setInGame that keeps the render-count probe's "0 extra renders on a
// stable phase" claim true.
import { describe, it, expect, beforeEach } from "vitest";
import { useSessionStore } from "./useSessionStore";

describe("useSessionStore", () => {
  beforeEach(() => {
    useSessionStore.setState({
      sessionGen: 0, role: null, screen: "loading", phase: null,
      inGame: false, roomCode: null, isHost: false,
    });
  });

  it("startSession bumps sessionGen and returns the new generation", () => {
    const gen1 = useSessionStore.getState().startSession("host");
    expect(gen1).toBe(1);
    expect(useSessionStore.getState().role).toBe("host");
    expect(useSessionStore.getState().sessionGen).toBe(1);

    const gen2 = useSessionStore.getState().startSession("client");
    expect(gen2).toBe(2);
    expect(useSessionStore.getState().role).toBe("client");
  });

  it("endSession bumps sessionGen, resets to the menu screen, and clears match state", () => {
    useSessionStore.getState().startSession("host");
    useSessionStore.getState().setRoom("ABC123", true);
    useSessionStore.getState().setInGame(true);
    useSessionStore.getState().setPhase("playing");

    const genBefore = useSessionStore.getState().sessionGen;
    useSessionStore.getState().endSession();
    const s = useSessionStore.getState();

    expect(s.sessionGen).toBe(genBefore + 1);
    expect(s.role).toBeNull();
    expect(s.screen).toBe("menu");
    expect(s.phase).toBeNull();
    expect(s.inGame).toBe(false);
    expect(s.roomCode).toBeNull();
    expect(s.isHost).toBe(false);
  });

  it("a stale rAF loop's sessionGen no longer matches after endSession — the whole point of the bump", () => {
    const mySession = useSessionStore.getState().startSession("host");
    useSessionStore.getState().endSession();
    expect(useSessionStore.getState().sessionGen).not.toBe(mySession);
  });

  it("setPhase/setInGame/setScreen are value-gated — same value is a no-op (no set())", () => {
    useSessionStore.getState().setPhase("playing");
    let renders = 0;
    const unsub = useSessionStore.subscribe(() => { renders++; });

    useSessionStore.getState().setPhase("playing"); // unchanged
    useSessionStore.getState().setInGame(false); // unchanged (default is false)
    useSessionStore.getState().setScreen("loading"); // unchanged (default)
    expect(renders).toBe(0);

    useSessionStore.getState().setPhase("countdown"); // changed
    expect(renders).toBe(1);

    unsub();
  });
});
