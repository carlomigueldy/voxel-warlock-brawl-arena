// @vitest-environment jsdom
// RTL smoke coverage for the P5 seam (design §1/§Scope): <UiRoot/> mounts
// under `?ui=react` without crashing, and is inert (renders nothing) under
// `?capture=1` — the same invariant App.tsx's own `!CAPTURE` guard already
// enforces at the mount-point level (see App.tsx:150), tested here directly
// against UiRoot's own internal guard.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

afterEach(() => {
  cleanup();
  vi.doUnmock("../three/parity/determinism");
  vi.resetModules();
});

describe("UiRoot", () => {
  it("mounts under ?ui=react without crashing", async () => {
    vi.doMock("../three/parity/determinism", () => ({ CAPTURE: false }));
    const { UiRoot } = await import("./UiRoot");
    render(<UiRoot />);
    expect(screen.getByTestId("ui-root")).toBeInTheDocument();
  });

  it("hides under ?capture=1 (renders nothing)", async () => {
    vi.doMock("../three/parity/determinism", () => ({ CAPTURE: true }));
    const { UiRoot } = await import("./UiRoot");
    const { container } = render(<UiRoot />);
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByTestId("ui-root")).toBeNull();
  });

  // design §9: screen==="menu" -> <MenuRoot/> (#161 p5-menu's own region).
  // Imports useSessionStore dynamically (after the preceding resetModules)
  // so it resolves to the SAME fresh module instance UiRoot itself reads —
  // a static top-of-file import would be a stale, pre-reset copy.
  it("mounts MenuRoot when useSessionStore.screen is 'menu'", async () => {
    vi.doMock("../three/parity/determinism", () => ({ CAPTURE: false }));
    const { useSessionStore } = await import("../store/useSessionStore");
    useSessionStore.setState({ screen: "menu" });
    const { UiRoot } = await import("./UiRoot");
    render(<UiRoot />);
    expect(screen.getByTestId("menu-root")).toBeInTheDocument();
  });
});
