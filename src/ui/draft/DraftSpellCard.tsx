// A single pickable spell in the draft grid — port of ui.js's
// `_buildDraftOverlay`'s `.draft-spell-card` (design §9 #164 p5-draft).
// The school-glow hover/focus ring (draft-juice's per-card `--dj-glow`) is
// set inline at render time instead of resolved from a mouseover/focusin
// DOM listener — see draftSchools.ts's header.
import type { CSSProperties } from "react";
import { spellIconSvg } from "../../spell-icons.js";
import { toHexColor } from "../hud/hudColor";
import { schoolForSpell } from "./draftSchools";
import styles from "./DraftOverlay.module.css";

export interface DraftSpellCardProps {
  id: string;
  name: string;
  desc: string;
  cd: number;
  color: number;
  selected: boolean;
  atCap: boolean;
  disabled: boolean;
  onToggle: (id: string) => void;
  onHover: () => void;
}

export function DraftSpellCard({ id, name, desc, cd, color, selected, atCap, disabled, onToggle, onHover }: DraftSpellCardProps) {
  const school = schoolForSpell(id);
  const cls = [styles.spellCard, selected && styles.isSelected, !selected && atCap && styles.atCap].filter(Boolean).join(" ");

  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      aria-label={`${name} — ${desc}`}
      className={cls}
      // Only `ready` HTML-disables (matches ui.js's `card.disabled = isReady`
      // exactly) — an at-cap, unselected card stays focusable/clickable, just
      // CSS-dimmed; sim.ts's toggleDraftSpell silently no-ops the over-cap
      // toggle. HTML-disabling it too would drop it from Modal's focus-trap
      // tab order, a behavior legacy's own overlay doesn't have.
      disabled={disabled}
      style={{ "--dj-glow": `var(--${school.id})` } as CSSProperties}
      onClick={() => onToggle(id)}
      onMouseEnter={onHover}
      onFocus={onHover}
    >
      <span className={styles.swatch} style={{ color: toHexColor(color) }} aria-hidden="true" dangerouslySetInnerHTML={{ __html: spellIconSvg(id) }} />
      <span className={styles.cardName}>{name}</span>
      <span className={styles.cardCd} aria-hidden="true">
        {cd}s
      </span>
      <span className={styles.cardDesc}>{desc}</span>
    </button>
  );
}
