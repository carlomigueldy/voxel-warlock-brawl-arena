// Range-input primitive (master volume, ...) — port of src/style.css's
// .social-range (design §4 partition: shared primitives). A thin wrapper
// over the native <input type="range">, which already gives keyboard
// support (arrow keys) and :focus-visible for free.
import styles from "./Slider.module.css";

export interface SliderProps {
  value: number;
  min?: number;
  max?: number;
  step?: number;
  onChange: (value: number) => void;
  label?: string;
  ariaLabel?: string;
  disabled?: boolean;
  className?: string;
}

export function Slider({ value, min = 0, max = 1, step = 0.01, onChange, label, ariaLabel, disabled, className }: SliderProps) {
  const input = (
    <input
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      disabled={disabled}
      aria-label={ariaLabel ?? label}
      className={[styles.slider, className].filter(Boolean).join(" ")}
      onChange={(e) => onChange(Number(e.currentTarget.value))}
    />
  );
  if (!label) return input;
  return (
    <div className={styles.row}>
      <span className={styles.label}>{label}</span>
      {input}
    </div>
  );
}
