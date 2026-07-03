// Port of ui.js's updateAbilityBar (design §9 scope: "Ability bar: spell
// slots from hud.spellSlots"). Always renders the strict CFG.SPELL_SLOT_COUNT
// layout (guard.ui #6 — rune mode, 6 slots incl. empty).
//
// `silenced` is intentionally omitted: legacy derives it from the raw
// snapshot's per-player stun flag (`me.st`), which the frozen useHudStore
// HudView (design §2) does not surface — extending that store was out of
// scope for this PR (see PR description).
//
// Touch tap-to-select (#167/#178): a standalone touch-only ability strip in
// TouchControls.tsx visually duplicated/overlapped this very bar on narrow
// phones (measured — no collision-free space left once both bars wrap), so
// the fix wires THIS bar's own slots tappable on touch instead of rendering
// a second one. `isTouch` is read once via lazy useState init (mirrors
// src/ui/touch/detectTouch.ts / TouchControls.tsx's own pattern) — a
// one-time capability check, not a subscription, so it never causes a
// re-render and doesn't touch this component's HUD_HZ-throttled contract.
// onSelect calls `getInput().setSelectedSpell` directly — the exact channel
// legacy's own slot click and TouchControls' fire button already use — with
// no new local state, so this component's re-render profile (and Hud.tsx's
// own re-render-count guard test) is unaffected.
import { useState } from "react";
import { CFG, SPELLS } from "../../config.js";
import { spellIconSvg } from "../../spell-icons.js";
import { getInput } from "../../services/registry";
import { detectTouch } from "../touch/detectTouch";
import type { CooldownMap } from "../../types";
import { toHexColor } from "./hudColor";
import { SpellSlot } from "./SpellSlot";
import styles from "./Hud.module.css";

const EMPTY_COLOR = toHexColor(0x444466);

export interface AbilityBarProps {
  spellSlots: (string | null)[];
  cooldowns: CooldownMap;
  hotkeys: string[];
}

export function AbilityBar({ spellSlots, cooldowns, hotkeys }: AbilityBarProps) {
  const [isTouch] = useState(detectTouch);
  const slots = [];
  for (let i = 0; i < CFG.SPELL_SLOT_COUNT; i++) {
    const id = spellSlots[i];
    const def = id ? SPELLS[id] : undefined;
    const empty = !id || !def;
    const remain = empty ? 0 : cooldowns[id!] || 0;
    const total = empty ? 1 : def!.cd || 1;
    const pct = Math.max(0, Math.min(100, (remain / total) * 100));
    const hotkey = hotkeys[i] || CFG.DEFAULT_SPELL_SLOT_HOTKEYS[i];
    const ready = !empty && remain <= 0;

    slots.push(
      <SpellSlot
        key={i}
        ariaLabel={
          empty
            ? `Spell slot ${i + 1}: empty`
            : `${def!.name}${ready ? ", ready" : `, cooldown ${Math.ceil(remain)}s`} (${hotkey})`
        }
        swatchHtml={spellIconSvg(empty ? "" : id!)}
        swatchColor={empty ? EMPTY_COLOR : toHexColor(def!.color)}
        hotkeyLabel={hotkey}
        name={empty ? "Empty" : def!.name}
        cdPct={empty ? 100 : pct}
        cdLabel={!empty && remain > 0 ? String(Math.ceil(remain)) : ""}
        empty={empty}
        ready={ready}
        onSelect={isTouch && !empty ? () => getInput().setSelectedSpell(id!) : undefined}
      />,
    );
  }
  return (
    <div className={styles.abilityBar} data-testid="ability-bar">
      {slots}
    </div>
  );
}
