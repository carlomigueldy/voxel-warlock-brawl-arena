// Shared slot chrome for the ability bar AND item bar — port of src/style.css's
// .ability-slot (design §4 partition map: HUD ability/item bars ->
// hud/*.module.css). Legacy reuses one DOM/CSS shape for both bars; this
// component is that shared shape's React equivalent.
//
// Presentational only, by design: legacy's slot click (`selectSpell` ->
// input.setSelectedSpell) binds the touch fire-button and its hotkey-picker
// rebinds a key — both are input/InputController concerns owned by other P5
// siblings (touch controls / settings), not this HUD surface (design §9 scope:
// "subscribes useHudStore.hud" — display only). No click handler here means
// no fake `role="button"`/tabIndex either — an aria-label carries the state.
import type { CSSProperties } from "react";
import styles from "./SpellSlot.module.css";

export interface SpellSlotProps {
  ariaLabel: string;
  /** Trusted, static SVG markup keyed by a known spell/item id (spellIconSvg/
   * itemIconSvg output) — never player-supplied text. Same trust boundary
   * ui.js's own `swatch.innerHTML = spellIconSvg(...)` relies on. */
  swatchHtml: string;
  swatchColor: string;
  hotkeyLabel: string;
  hotkeyMuted?: boolean;
  name: string;
  cdPct: number;
  cdLabel: string;
  empty: boolean;
  ready: boolean;
  silenced?: boolean;
  variant?: "active" | "passive";
}

export function SpellSlot({
  ariaLabel,
  swatchHtml,
  swatchColor,
  hotkeyLabel,
  hotkeyMuted,
  name,
  cdPct,
  cdLabel,
  empty,
  ready,
  silenced,
  variant,
}: SpellSlotProps) {
  const cls = [
    styles.slot,
    empty && styles.empty,
    empty && styles.locked,
    ready && styles.ready,
    silenced && styles.silenced,
    variant === "active" && styles.itemActive,
    variant === "passive" && styles.itemPassive,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      className={cls}
      aria-label={ariaLabel}
      // data-* mirrors the CSS state classes above as RTL-stable test hooks
      // (guard.ui #5/#6 handoff — asserting a hashed CSS-module class name
      // would be brittle; these booleans are the React-side "locked"/"ready"
      // equivalents guard.ui's legacy classList.toggle() checks assert on).
      data-empty={empty}
      data-locked={empty}
      data-ready={ready}
      style={{ "--ready-glow": swatchColor } as CSSProperties}
    >
      <span
        className={styles.swatch}
        style={{ color: swatchColor }}
        aria-hidden="true"
        dangerouslySetInnerHTML={{ __html: swatchHtml }}
      />
      <span className={[styles.key, hotkeyMuted && styles.keyMuted].filter(Boolean).join(" ")} aria-hidden="true">
        {hotkeyLabel}
      </span>
      <span className={styles.name} aria-hidden="true">
        {name}
      </span>
      <div className={styles.cd} style={{ "--cd-pct": cdPct } as CSSProperties} aria-hidden="true" />
      <span className={styles.cdNum} aria-hidden="true">
        {cdLabel}
      </span>
    </div>
  );
}
