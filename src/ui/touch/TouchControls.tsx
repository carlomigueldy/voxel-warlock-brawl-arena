// Port of legacy's `#touch-controls` (index.html L793-795, src/style.css's
// "/* Touch */" block, src/input.ts's `_maybeShowTouch`/`_bindTouch`) — the
// on-screen mobile control layer (design §9 #167 p5-touch, a game overlay
// mounted at UiRoot's `screen==="game"` region). Legacy's `#touch-controls`
// DOM is exactly two controls (`#joystick` + `#fire-btn`) bound straight to
// InputController's public fields/methods (src/input.ts L323-361) — this
// drives the SAME InputController singleton (`getInput()`, design §2 /
// brief: "do NOT invent a new input channel"), just from React pointer
// handlers instead of legacy's own touch listeners on those DOM ids.
//
// Ability selection is NOT rendered here — an earlier revision added a
// standalone quick-select strip, but #178's review measured it fully
// overlapping the HUD's own ability bar on narrow phones (the HUD bar
// already wraps across ~most of the bottom viewport at 390-428px; there's no
// collision-free space left for a second one). The fix wires the HUD's own
// AbilityBar/SpellSlot tappable on touch instead (`getInput().setSelectedSpell`,
// the same call this file's Fire button reads back from — see AbilityBar.tsx's
// own comment) rather than duplicating it here.
//
// "aim" (design §9's third listed surface) needs no separate control here
// either: `setSelectedSpell()` (now called from AbilityBar on touch) already
// drives `renderer.setAimSpell()` (→ aimBridge → snapshotRef.aim.spellId),
// which is what continuously shows the reticle for the armed spell
// (src/input.ts L254-257's own comment: "no hold-to-aim gesture on touch").
// Cast targeting itself uses whatever `mouseX`/`mouseY` currently is
// (screen-center default, matching legacy exactly — a real touch device
// never fires `mousemove`), so this component deliberately does not touch
// cursor/aim position either.
import { useState } from "react";
import { getInput } from "../../services/registry";
import { Joystick } from "./Joystick";
import { detectTouch } from "./detectTouch";
import styles from "./TouchControls.module.css";

export function TouchControls() {
  // Computed once on mount, same as legacy (`_maybeShowTouch` runs once in
  // the UI constructor) — touch capability doesn't change at runtime.
  const [isTouch] = useState(detectTouch);

  if (!isTouch) return null;

  // Legacy's fire-btn casts `this.selectedSpell` on touchstart (input.ts
  // L361) — queueCast() itself no-ops for an unknown/empty id (L310), same
  // guard this relies on rather than duplicating it. Reads getInput() fresh
  // at click time (not cached in local state) so it always reflects
  // whichever spell AbilityBar's touch tap most recently armed.
  function handleFire(): void {
    getInput().queueCast(getInput().selectedSpell);
  }

  function handleMove(x: number, z: number): void {
    getInput().touchMove = [x, z];
  }

  function handleMoveEnd(): void {
    getInput().touchMove = [0, 0];
  }

  return (
    <div className={styles.touchControls} data-testid="touch-controls">
      <Joystick onMove={handleMove} onEnd={handleMoveEnd} />
      <button type="button" className={styles.fireBtn} data-testid="touch-fire" aria-label="Cast selected spell" onClick={handleFire}>
        FIRE
      </button>
    </div>
  );
}
