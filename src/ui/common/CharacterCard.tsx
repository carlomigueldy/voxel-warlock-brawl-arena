// Character-select card primitive — port of src/style.css's .char-card
// (design §4 partition: shared primitives). A native <button> so focus/
// activation is free; `color` sets the --char-color custom property the
// module keys every accent off (mirrors the legacy DOM's inline style).
//
// role="radio" here requires an ancestor with role="radiogroup" for correct
// ARIA semantics (APG single-select pattern) — this primitive is a single
// card, so the composing sibling (p5-menu's character-select list) must
// wrap its <CharacterCard> siblings in a `role="radiogroup"` container with
// an accessible name (mirrors how SegmentedControl owns its own group).
import type { CSSProperties } from "react";
import { Icon } from "./Icon";
import styles from "./CharacterCard.module.css";

export interface CharacterCardProps {
  name: string;
  blurb?: string;
  /** The character's accent color (any valid CSS color, e.g. "#ff5a3c"). */
  color?: string;
  active: boolean;
  onSelect: () => void;
  className?: string;
}

export function CharacterCard({ name, blurb, color, active, onSelect, className }: CharacterCardProps) {
  const style = color ? ({ "--char-color": color } as CSSProperties) : undefined;
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      style={style}
      className={[styles.card, active && styles.active, className].filter(Boolean).join(" ")}
      onClick={onSelect}
    >
      <span className={styles.swatch} aria-hidden="true" />
      <span className={styles.name}>{name}</span>
      {blurb && <span className={styles.blurb}>{blurb}</span>}
      <span className={styles.check} aria-hidden="true">
        <Icon name="check" size={10} />
      </span>
    </button>
  );
}
