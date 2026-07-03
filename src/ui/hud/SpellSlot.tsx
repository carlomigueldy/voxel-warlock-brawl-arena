// Shared slot chrome for the ability bar AND item bar — port of src/style.css's
// .ability-slot (design §4 partition map: HUD ability/item bars ->
// hud/*.module.css). Legacy reuses one DOM/CSS shape for both bars; this
// component is that shared shape's React equivalent.
//
// Mostly presentational by design: the hotkey-picker rebind is a settings
// concern this component doesn't own. Legacy's slot click (`selectSpell` ->
// input.setSelectedSpell) DOES belong here now — #167/#178 found that a
// separate touch-only ability-select strip visually duplicates/overlaps this
// bar on narrow phones (there's no collision-free space left once the HUD's
// own ability+item bars wrap), so AbilityBar wires this bar's own slots
// tappable on touch instead (additive `onSelect`, only ever passed by
// AbilityBar, only on a touch device, only for a non-empty slot — see its
// own comment). No `onSelect` means the exact same inert `<div>` this
// component always rendered; no fake `role="button"`/tabIndex on that path
// either, an aria-label still carries the state.
import type { CSSProperties, ReactNode } from "react";
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
  /** Touch tap-to-select (design #167/#178) — AbilityBar passes this only on
   * a touch device and only for a non-empty slot. No selection-highlight
   * here on purpose (the 3D aim reticle already shows the armed spell; a
   * reactive "is this the selected slot" prop would mean subscribing this
   * bar to selection state that changes outside the throttled HudView,
   * exactly the per-frame re-render risk Hud.tsx's own guard test exists to
   * catch). */
  onSelect?: () => void;
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
  onSelect,
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

  // data-* mirrors the CSS state classes above as RTL-stable test hooks
  // (guard.ui #5/#6 handoff — asserting a hashed CSS-module class name
  // would be brittle; these booleans are the React-side "locked"/"ready"
  // equivalents guard.ui's legacy classList.toggle() checks assert on).
  const attrs = {
    className: cls,
    "aria-label": ariaLabel,
    "data-empty": empty,
    "data-locked": empty,
    "data-ready": ready,
    style: { "--ready-glow": swatchColor } as CSSProperties,
  };

  const content: ReactNode = (
    <>
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
    </>
  );

  if (onSelect) {
    return (
      <button type="button" {...attrs} onClick={onSelect}>
        {content}
      </button>
    );
  }
  return <div {...attrs}>{content}</div>;
}
