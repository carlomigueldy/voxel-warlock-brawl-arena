// Rune toggle primitive — port of src/style.css's .rune-toggle (design §4
// partition: shared primitives). A native-semantics switch: role="switch" +
// aria-checked, ON/OFF state text kept for the same "obvious state" reason
// the legacy DOM had it (not just a color change).
import styles from "./Toggle.module.css";

export interface ToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** Visible label rendered next to the switch; also used as the accessible
   * name unless `ariaLabel` is given (e.g. when the label lives elsewhere). */
  label?: string;
  ariaLabel?: string;
  disabled?: boolean;
  className?: string;
}

export function Toggle({ checked, onChange, label, ariaLabel, disabled, className }: ToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel ?? label}
      disabled={disabled}
      className={[styles.toggle, checked && styles.on, className].filter(Boolean).join(" ")}
      onClick={() => onChange(!checked)}
    >
      <span className={styles.track}>
        <span className={styles.knob} />
      </span>
      <span className={styles.state} aria-hidden="true">{checked ? "ON" : "OFF"}</span>
      {label && <span className={styles.label}>{label}</span>}
    </button>
  );
}
