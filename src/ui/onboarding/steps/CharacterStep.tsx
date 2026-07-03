// Step 2 — character select. Adapts (not a 1:1 port of) onboarding.js's
// "hero-select" chevron carousel + reparented 3D turntable canvas: that
// mechanism is deeply coupled to the live preview canvas (renderer
// territory this UI-only PR doesn't reimplement — MenuRoot's
// CharactersScreen already made the same "documented placeholder" call).
// Reusing the shared CharacterCard grid instead means onboarding's
// character step and the menu's Characters screen share one selection UX
// and primitive rather than two competing implementations.
import { CFG } from "../../../config.js";
import { CharacterCard } from "../../common";
import styles from "../Onboarding.module.css";

const hex = (n: number) => "#" + (n >>> 0).toString(16).padStart(6, "0").slice(-6);

export interface CharacterStepProps {
  character: string;
  onChange: (id: string) => void;
}

export function CharacterStep({ character, onChange }: CharacterStepProps) {
  return (
    <section className={styles.step} aria-label="Choose your warlock">
      <h3 className={styles.stepTitle}>Choose your warlock</h3>
      <p className={styles.stepDesc}>
        Pick the look you&rsquo;ll bring into the arena — every warlock casts the same spellbook.
      </p>
      <div className={styles.charCards} role="radiogroup" aria-label="Choose your warlock">
        {CFG.CHARACTERS.map((ch) => (
          <CharacterCard
            key={ch.id}
            name={ch.name}
            blurb={ch.blurb}
            color={hex(ch.color)}
            active={ch.id === character}
            onSelect={() => onChange(ch.id)}
          />
        ))}
      </div>
    </section>
  );
}
