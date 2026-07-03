// One-click loadout template quick-picks — port of ui.js's
// `_buildDraftOverlay`'s `.draft-tpl-btn` row (design §9 #164 p5-draft).
import { SPELL_TEMPLATES } from "../../config.js";
import styles from "./DraftOverlay.module.css";

export interface DraftTemplatesProps {
  disabled: boolean;
  onPick: (index: number) => void;
}

export function DraftTemplates({ disabled, onPick }: DraftTemplatesProps) {
  return (
    <div className={styles.templates}>
      {SPELL_TEMPLATES.map((tpl, i) => (
        <button
          key={tpl.id}
          type="button"
          className={styles.tplBtn}
          aria-label={`${tpl.name} template — ${tpl.desc}`}
          disabled={disabled}
          onClick={() => onPick(i)}
        >
          <span className={styles.tplName}>{tpl.name}</span>
          <span className={styles.tplDesc}>{tpl.desc}</span>
        </button>
      ))}
    </div>
  );
}
