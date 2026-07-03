// Step 1 — name entry. Port of onboarding.js step 0 / index.html's
// onboarding-step[data-step="0"]. Draft state lives in the parent
// (Onboarding.tsx) and is only committed to useSettingsStore on finish, so
// closing early (Escape/Skip) never persists a half-typed name — matches
// legacy's "read the input's .value at completion time" contract.
import { useEffect, useRef } from "react";
import styles from "../Onboarding.module.css";

export interface NameStepProps {
  name: string;
  onChange: (name: string) => void;
  onSubmit: () => void;
}

// `ob-name-input` (not legacy's `onboarding-name-input`): index.html's
// static legacy `#onboarding` markup stays in the DOM under `?shell=react`
// (only its JS controller, src/onboarding.js, is skipped — see index.html's
// bootstrap script), so reusing the legacy id would collide with it and
// break `<label for>` association (mirrors MenuRoot's own `menu-name-input`
// vs legacy's `name-input`).
export function NameStep({ name, onChange, onSubmit }: NameStepProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  // Matches legacy _render()'s focusTarget for step 0 — the name field is
  // the first thing a first-run player should be able to type into.
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  return (
    <section className={styles.step} aria-label="Name your warlock">
      <h3 className={styles.stepTitle}>Name your warlock</h3>
      <p className={styles.stepDesc}>This is how the arena will know you.</p>
      <div className={styles.field}>
        <label className={styles.fieldLabel} htmlFor="ob-name-input">
          Warlock name
        </label>
        <div className={styles.runeField}>
          <input
            id="ob-name-input"
            ref={inputRef}
            maxLength={14}
            placeholder="Name your warlock"
            autoComplete="off"
            spellCheck={false}
            value={name}
            onChange={(e) => onChange(e.currentTarget.value.slice(0, 14))}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                onSubmit();
              }
            }}
          />
          <span className={styles.runeFieldLine} />
        </div>
      </div>
    </section>
  );
}
