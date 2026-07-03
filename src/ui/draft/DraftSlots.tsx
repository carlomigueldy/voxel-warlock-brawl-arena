// The 6 vertical pick-slot pips — port of ui.js's `_buildDraftOverlay`'s
// `.draft-slot-pip` column + `_refreshDraftOverlay`'s per-pip fill/label
// (design §9 #164 p5-draft, guard.ui #6 rune-mode 6-slot handoff).
// `registerPip` hands DraftOverlay a ref per pip so its draft-juice lock-in
// burst can compute `centerOf(pip)` the same way draft-juice.js did.
import type { CSSProperties } from "react";
import { CFG, SPELLS } from "../../config.js";
import { toHexColor } from "../hud/hudColor";
import styles from "./DraftOverlay.module.css";

export interface DraftSlotsProps {
  picks: string[];
  registerPip: (index: number) => (el: HTMLDivElement | null) => void;
}

export function DraftSlots({ picks, registerPip }: DraftSlotsProps) {
  const pips = [];
  for (let i = 0; i < CFG.SPELL_SLOT_COUNT; i++) {
    const id = picks[i];
    const def = id ? SPELLS[id] : undefined;
    const filled = !!def;
    pips.push(
      <div
        key={i}
        ref={registerPip(i)}
        className={[styles.slotPip, filled && styles.slotFilled].filter(Boolean).join(" ")}
        style={filled ? ({ "--swatch": toHexColor(def!.color) } as CSSProperties) : undefined}
        aria-hidden="true"
      >
        {def?.name ?? ""}
      </div>,
    );
  }
  return (
    <div className={styles.slots} data-testid="draft-slots">
      {pips}
    </div>
  );
}
