// @vitest-environment jsdom
// RTL coverage for the Credits route port of src/credits.js (design §9a
// #168) — a self-contained trigger + Modal (design §4's shared focus-trap
// primitive) rather than a menu-spine entry, since #161 p5-menu owns the
// spine itself.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useSessionStore } from "../../store/useSessionStore";
import { FX } from "../../hooks/useFx";
import { menuCue } from "../../audio";
import { Credits } from "./Credits";

vi.mock("../../audio", () => ({ menuCue: vi.fn() }));

beforeEach(() => {
  useSessionStore.setState({ screen: "menu" });
  FX.reducedMotion = false;
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

describe("Credits", () => {
  it("renders nothing when the app screen isn't 'menu'", () => {
    useSessionStore.setState({ screen: "lobby" });
    const { container } = render(<Credits />);
    expect(container).toBeEmptyDOMElement();
  });

  it("opens the credits dialog on trigger click and cues 'confirm'", () => {
    render(<Credits />);
    fireEvent.click(screen.getByRole("button", { name: "Open credits" }));
    expect(menuCue).toHaveBeenCalledWith("confirm");
    expect(screen.getByRole("dialog", { name: "Credits" })).toBeInTheDocument();
    expect(screen.getByText("carlomigueldy.dev")).toBeInTheDocument();
  });

  it("closes on Escape and cues 'back'", () => {
    render(<Credits />);
    fireEvent.click(screen.getByRole("button", { name: "Open credits" }));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(menuCue).toHaveBeenCalledWith("back");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("the scroll viewport is not keyboard-focusable when motion is allowed", () => {
    render(<Credits />);
    fireEvent.click(screen.getByRole("button", { name: "Open credits" }));
    expect(screen.getByTestId("credits-wrap")).not.toHaveAttribute("tabindex");
  });

  it("makes the scroll viewport keyboard-focusable under reduced motion (auto-scroll disabled)", () => {
    FX.reducedMotion = true;
    render(<Credits />);
    fireEvent.click(screen.getByRole("button", { name: "Open credits" }));
    expect(screen.getByTestId("credits-wrap")).toHaveAttribute("tabindex", "0");
  });
});
