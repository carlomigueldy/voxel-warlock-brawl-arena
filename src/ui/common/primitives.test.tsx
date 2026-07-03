// @vitest-environment jsdom
// Behavioral coverage for the shared primitive kit (design §4/§7) — enough
// to prove each control is actually interactive/accessible, not just that it
// renders. Full visual review is the frontend-design self-critique in the
// PR description; this file is functional coverage.
import { useState } from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { Button } from "./Button";
import { Panel } from "./Panel";
import { Modal } from "./Modal";
import { SegmentedControl } from "./SegmentedControl";
import { Toggle } from "./Toggle";
import { CharacterCard } from "./CharacterCard";
import { Slider } from "./Slider";
import { Icon } from "./Icon";

afterEach(cleanup);

describe("Button", () => {
  it("renders children and fires onClick", () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Forge</Button>);
    fireEvent.click(screen.getByRole("button", { name: "Forge" }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("disabled buttons do not fire onClick", () => {
    const onClick = vi.fn();
    render(
      <Button onClick={onClick} disabled>
        Forge
      </Button>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Forge" }));
    expect(onClick).not.toHaveBeenCalled();
  });
});

describe("Panel", () => {
  it("renders its children", () => {
    render(<Panel>content</Panel>);
    expect(screen.getByText("content")).toBeInTheDocument();
  });
});

describe("Toggle", () => {
  it("reflects checked state via role=switch/aria-checked and toggles on click", () => {
    const checked = false;
    const onChange = vi.fn();
    const { rerender } = render(<Toggle checked={checked} onChange={onChange} label="Mic" />);
    const el = screen.getByRole("switch", { name: "Mic" });
    expect(el).toHaveAttribute("aria-checked", "false");
    fireEvent.click(el);
    expect(onChange).toHaveBeenCalledWith(true);
    rerender(<Toggle checked={true} onChange={onChange} label="Mic" />);
    expect(screen.getByRole("switch", { name: "Mic" })).toHaveAttribute("aria-checked", "true");
  });
});

describe("SegmentedControl", () => {
  const options = [
    { value: "smart", label: "Smart" },
    { value: "brilliant", label: "Brilliant" },
    { value: "expert", label: "Expert" },
  ];

  it("marks the active option aria-checked and calls onChange on click", () => {
    const onChange = vi.fn();
    render(<SegmentedControl options={options} value="smart" onChange={onChange} ariaLabel="Bot skill" />);
    expect(screen.getByRole("radio", { name: "Smart" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("radio", { name: "Brilliant" })).toHaveAttribute("aria-checked", "false");
    fireEvent.click(screen.getByRole("radio", { name: "Brilliant" }));
    expect(onChange).toHaveBeenCalledWith("brilliant");
  });

  it("ArrowRight moves selection to the next option (roving radiogroup)", () => {
    const onChange = vi.fn();
    render(<SegmentedControl options={options} value="smart" onChange={onChange} ariaLabel="Bot skill" />);
    const group = screen.getByRole("radiogroup", { name: "Bot skill" });
    fireEvent.keyDown(group, { key: "ArrowRight" });
    expect(onChange).toHaveBeenCalledWith("brilliant");
  });

  it("only the active option is a tab stop (roving tabindex)", () => {
    render(<SegmentedControl options={options} value="brilliant" onChange={vi.fn()} ariaLabel="Bot skill" />);
    expect(screen.getByRole("radio", { name: "Smart" })).toHaveAttribute("tabindex", "-1");
    expect(screen.getByRole("radio", { name: "Brilliant" })).toHaveAttribute("tabindex", "0");
  });
});

describe("CharacterCard", () => {
  it("renders name/blurb and reflects active state via role=radio/aria-checked", () => {
    const onSelect = vi.fn();
    render(<CharacterCard name="Ember" blurb="Fire warlock" color="#ff5a3c" active={false} onSelect={onSelect} />);
    expect(screen.getByText("Ember")).toBeInTheDocument();
    expect(screen.getByText("Fire warlock")).toBeInTheDocument();
    const card = screen.getByRole("radio", { name: /Ember/ });
    expect(card).toHaveAttribute("aria-checked", "false");
    fireEvent.click(card);
    expect(onSelect).toHaveBeenCalledTimes(1);
  });
});

describe("Slider", () => {
  it("calls onChange with a numeric value and exposes an accessible name via label", () => {
    const onChange = vi.fn();
    render(<Slider value={0.5} onChange={onChange} label="Master Volume" />);
    const el = screen.getByRole("slider", { name: "Master Volume" });
    fireEvent.change(el, { target: { value: "0.8" } });
    expect(onChange).toHaveBeenCalledWith(0.8);
  });
});

describe("Icon", () => {
  it("renders an aria-hidden svg (decorative — never the sole a11y content)", () => {
    const { container } = render(<Icon name="check" />);
    const svg = container.querySelector("svg");
    expect(svg).not.toBeNull();
    expect(svg).toHaveAttribute("aria-hidden", "true");
  });
});

describe("Modal", () => {
  it("renders nothing when closed", () => {
    render(
      <Modal open={false} onClose={vi.fn()} ariaLabel="Test dialog">
        <p>Body</p>
      </Modal>,
    );
    expect(screen.queryByText("Body")).toBeNull();
  });

  it("renders as a dialog, traps focus inside, and closes on Escape", () => {
    const onClose = vi.fn();
    render(
      <Modal open onClose={onClose} ariaLabel="Test dialog">
        <button type="button">First</button>
        <button type="button">Second</button>
      </Modal>,
    );
    const dialog = screen.getByRole("dialog", { name: "Test dialog" });
    expect(dialog).toBeInTheDocument();

    // Focus starts inside the dialog (the close button, the first focusable).
    expect(dialog.contains(document.activeElement)).toBe(true);

    // Shift+Tab from the first focusable wraps to the last.
    const closeBtn = screen.getByRole("button", { name: "Close" });
    closeBtn.focus();
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Second" }));

    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("restores focus to the previously focused element on close", () => {
    function Harness() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>
            Open
          </button>
          <Modal open={open} onClose={() => setOpen(false)} ariaLabel="Test dialog">
            <p>Body</p>
          </Modal>
        </>
      );
    }
    render(<Harness />);
    const opener = screen.getByRole("button", { name: "Open" });
    opener.focus();
    fireEvent.click(opener);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(document.activeElement).toBe(opener);
  });

  it("closes on a backdrop click but not on a click inside the panel", () => {
    const onClose = vi.fn();
    const { container } = render(
      <Modal open onClose={onClose} ariaLabel="Test dialog">
        <p>Body</p>
      </Modal>,
    );
    fireEvent.mouseDown(screen.getByText("Body"));
    expect(onClose).not.toHaveBeenCalled();

    const backdrop = container.ownerDocument.querySelector(".overlay")!;
    fireEvent.mouseDown(backdrop);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
