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
// Ability quick-select (tap an equipped spell to arm it for the Fire
// button) is this PR's own addition — legacy's `#touch-controls` itself has
// no such strip; touch players there rely on the shared `#ability-bar`'s
// onclick (ui.js `_buildSpellSlot`, works for any input method) to change
// `selectedSpell`. The React ability bar (src/ui/hud/SpellSlot.tsx) ships
// display-only by design, explicitly deferring "legacy's slot click ...
// binds the touch fire-button" to this sibling (see SpellSlot.tsx's own
// comment + #173's merged PR notes). Rather than reach into hud/* (another,
// already-merged sibling's owned files) this renders its own compact,
// self-contained strip of the same equipped `spellSlots` — ≥44px targets,
// same `getInput().setSelectedSpell()` call the legacy slot click makes.
//
// "aim" (design §9's third listed surface) needs no separate control here:
// `setSelectedSpell()` already drives `renderer.setAimSpell()` (→ aimBridge
// → snapshotRef.aim.spellId), which is what continuously shows the reticle
// for the armed spell (src/input.ts L254-257's own comment: "no hold-to-aim
// gesture on touch"). Cast targeting itself uses whatever `mouseX`/`mouseY`
// currently is (screen-center default, matching legacy exactly — a real
// touch device never fires `mousemove`), so this component deliberately
// does not touch cursor/aim position either.
import { useState } from "react";
import { getInput } from "../../services/registry";
import { useHudStore } from "../../store/useHudStore";
import { SPELLS } from "../../config.js";
import { spellIconSvg } from "../../spell-icons.js";
import { Joystick } from "./Joystick";
import { detectTouch } from "./detectTouch";
import styles from "./TouchControls.module.css";

export function TouchControls() {
  // Computed once on mount, same as legacy (`_maybeShowTouch` runs once in
  // the UI constructor) — touch capability doesn't change at runtime.
  const [isTouch] = useState(detectTouch);
  const hud = useHudStore((s) => s.hud);
  const [selected, setSelected] = useState(() => getInput().selectedSpell);

  if (!isTouch) return null;

  const equipped = (hud?.spellSlots ?? []).filter((id): id is string => Boolean(id && SPELLS[id]));

  function handleSelect(id: string): void {
    getInput().setSelectedSpell(id);
    setSelected(id);
  }

  // Legacy's fire-btn casts `this.selectedSpell` on touchstart (input.ts
  // L361) — queueCast() itself no-ops for an unknown/empty id (L310), same
  // guard this relies on rather than duplicating it.
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
      {equipped.length > 0 && (
        <div className={styles.abilityStrip} data-testid="touch-ability-strip">
          {equipped.map((id) => (
            <button
              key={id}
              type="button"
              className={[styles.abilityBtn, id === selected && styles.abilityBtnActive].filter(Boolean).join(" ")}
              aria-label={`Select ${SPELLS[id].name}`}
              aria-pressed={id === selected}
              onClick={() => handleSelect(id)}
            >
              <span aria-hidden="true" className={styles.abilityIcon} dangerouslySetInnerHTML={{ __html: spellIconSvg(id) }} />
            </button>
          ))}
        </div>
      )}
      <Joystick onMove={handleMove} onEnd={handleMoveEnd} />
      <button
        type="button"
        className={styles.fireBtn}
        data-testid="touch-fire"
        aria-label={`Cast ${SPELLS[selected]?.name ?? selected}`}
        onClick={handleFire}
      >
        FIRE
      </button>
    </div>
  );
}
