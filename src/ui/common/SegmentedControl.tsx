// Segmented control primitive (land size, bot skill, ...) — port of
// src/style.css's .segmented/.seg-option (design §4 partition: shared
// primitives). A proper APG radiogroup: one tab stop, arrow keys move +
// select.
import { useRef, type KeyboardEvent } from "react";
import styles from "./SegmentedControl.module.css";

export interface SegmentedOption<T extends string = string> {
  value: T;
  label: string;
}

export interface SegmentedControlProps<T extends string = string> {
  options: SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  ariaLabel: string;
  size?: "default" | "sm";
  className?: string;
}

export function SegmentedControl<T extends string = string>({
  options,
  value,
  onChange,
  ariaLabel,
  size = "default",
  className,
}: SegmentedControlProps<T>) {
  const groupRef = useRef<HTMLDivElement>(null);

  function move(delta: number) {
    const idx = options.findIndex((o) => o.value === value);
    const next = options[(idx + delta + options.length) % options.length];
    if (next) onChange(next.value);
  }

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === "ArrowRight" || e.key === "ArrowDown") {
      e.preventDefault();
      move(1);
    } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
      e.preventDefault();
      move(-1);
    } else if (e.key === "Home") {
      e.preventDefault();
      if (options[0]) onChange(options[0].value);
    } else if (e.key === "End") {
      e.preventDefault();
      const last = options[options.length - 1];
      if (last) onChange(last.value);
    }
  }

  return (
    <div
      ref={groupRef}
      role="radiogroup"
      aria-label={ariaLabel}
      className={[styles.segmented, size === "sm" && styles.sm, className].filter(Boolean).join(" ")}
      onKeyDown={onKeyDown}
    >
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={active}
            tabIndex={active ? 0 : -1}
            className={[styles.option, active && styles.optionActive].filter(Boolean).join(" ")}
            onClick={() => onChange(opt.value)}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
