// @vitest-environment jsdom
// RTL coverage for ConductModal (design §9a Wave-2 / issue #166) — a thin
// controlled dialog; PauseMenu.test.tsx already covers the auto-show/dismiss
// persistence wiring end-to-end, this file covers the component in
// isolation (focus-trap comes from the shared Modal primitive, not retested
// here).
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { ConductModal } from "./ConductModal";

afterEach(cleanup);

describe("ConductModal", () => {
  it("renders nothing while closed", () => {
    const { container } = render(<ConductModal open={false} onDismiss={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders the Code and an Enter the Arena CTA while open", () => {
    render(<ConductModal open onDismiss={() => {}} />);
    expect(screen.getByRole("dialog", { name: "The Warlock's Code" })).toBeInTheDocument();
    expect(screen.getByText(/mute anyone, anytime/)).toBeInTheDocument();
  });

  it("Enter the Arena calls onDismiss", () => {
    const onDismiss = vi.fn();
    render(<ConductModal open onDismiss={onDismiss} />);
    fireEvent.click(screen.getByRole("button", { name: "Enter the Arena" }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("has no separate close (X) button — Enter the Arena is the only dismissal CTA besides Escape", () => {
    render(<ConductModal open onDismiss={() => {}} />);
    expect(screen.queryByRole("button", { name: "Close" })).toBeNull();
  });
});
