// @vitest-environment jsdom
// Unit coverage for the useNavFeel port of src/nav-feel.js (design §9a
// #168): reads/writes useMenuNavStore directly instead of observing DOM
// mutations — no MutationObserver anywhere. The Host below stands in for
// MenuRoot's spine landmark (`nav[aria-label="Main menu"]` + `aria-current`),
// the only DOM contract this hook depends on.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useSessionStore } from "../../store/useSessionStore";
import { useMenuNavStore, type MenuScreen } from "../../store/useMenuNavStore";
import { menuCue } from "../../audio";
import { useNavFeel } from "./useNavFeel";

vi.mock("../../audio", () => ({ menuCue: vi.fn() }));

const ORDER: MenuScreen[] = ["online", "private", "characters", "leaderboards", "account", "tutorial"];

function Host() {
  const active = useMenuNavStore((s) => s.screen);
  const { backVisible, goBack } = useNavFeel();
  return (
    <div>
      <span data-testid="back-visible">{String(backVisible)}</span>
      <button data-testid="back-button" onClick={goBack}>
        back
      </button>
      <nav aria-label="Main menu">
        {ORDER.map((s) => (
          <button key={s} aria-current={active === s}>
            {s}
          </button>
        ))}
      </nav>
    </div>
  );
}

beforeEach(() => {
  useSessionStore.setState({ screen: "menu" });
  useMenuNavStore.setState({ screen: "online" });
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
  document.querySelectorAll('[role="dialog"]').forEach((n) => n.remove());
});

describe("useNavFeel", () => {
  it("backVisible is false on the default (online) sub-screen", () => {
    render(<Host />);
    expect(screen.getByTestId("back-visible").textContent).toBe("false");
  });

  it("backVisible is true off the default sub-screen while in the menu", () => {
    useMenuNavStore.setState({ screen: "private" });
    render(<Host />);
    expect(screen.getByTestId("back-visible").textContent).toBe("true");
  });

  it("backVisible stays false outside the menu screen, even off the default sub-screen", () => {
    useSessionStore.setState({ screen: "lobby" });
    useMenuNavStore.setState({ screen: "private" });
    render(<Host />);
    expect(screen.getByTestId("back-visible").textContent).toBe("false");
  });

  it("goBack() resets to online and cues 'back'; is a no-op already on online", () => {
    render(<Host />);
    fireEvent.click(screen.getByTestId("back-button"));
    expect(menuCue).not.toHaveBeenCalled();

    act(() => {
      useMenuNavStore.getState().setScreen("characters");
    });
    fireEvent.click(screen.getByTestId("back-button"));
    expect(useMenuNavStore.getState().screen).toBe("online");
    expect(menuCue).toHaveBeenCalledWith("back");
  });

  it("ArrowDown/ArrowRight cycle to the next spine screen and cue hover, only with focus inside the spine", () => {
    render(<Host />);
    screen.getByRole("button", { name: "online" }).focus();
    fireEvent.keyDown(document, { key: "ArrowDown" });
    expect(useMenuNavStore.getState().screen).toBe("private");
    expect(menuCue).toHaveBeenCalledWith("hover");
  });

  it("ArrowUp/ArrowLeft wrap around to the last spine screen", () => {
    render(<Host />);
    screen.getByRole("button", { name: "online" }).focus();
    fireEvent.keyDown(document, { key: "ArrowUp" });
    expect(useMenuNavStore.getState().screen).toBe("tutorial");
  });

  it("Home/End jump to the first/last spine screen", () => {
    render(<Host />);
    screen.getByRole("button", { name: "online" }).focus();
    fireEvent.keyDown(document, { key: "End" });
    expect(useMenuNavStore.getState().screen).toBe("tutorial");
    fireEvent.keyDown(document, { key: "Home" });
    expect(useMenuNavStore.getState().screen).toBe("online");
  });

  it("arrow keys do nothing when focus is outside the spine nav", () => {
    render(<Host />);
    document.body.focus();
    fireEvent.keyDown(document, { key: "ArrowDown" });
    expect(useMenuNavStore.getState().screen).toBe("online");
  });

  it("Escape off the default sub-screen goes back to online and cues 'back'", () => {
    useMenuNavStore.setState({ screen: "characters" });
    render(<Host />);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(useMenuNavStore.getState().screen).toBe("online");
    expect(menuCue).toHaveBeenCalledWith("back");
  });

  it("Escape is a no-op while an open Modal dialog owns it", () => {
    useMenuNavStore.setState({ screen: "characters" });
    render(<Host />);
    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    document.body.appendChild(dialog);

    fireEvent.keyDown(document, { key: "Escape" });
    expect(useMenuNavStore.getState().screen).toBe("characters");
  });

  it("keyboard nav has no effect outside the menu screen", () => {
    useSessionStore.setState({ screen: "lobby" });
    useMenuNavStore.setState({ screen: "characters" });
    render(<Host />);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(useMenuNavStore.getState().screen).toBe("characters");
  });
});
