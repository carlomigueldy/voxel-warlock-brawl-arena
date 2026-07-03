// Port of ui.js's updateAbilityBar (design §9 scope: "Ability bar: spell
// slots from hud.spellSlots"). Always renders the strict CFG.SPELL_SLOT_COUNT
// layout (guard.ui #6 — rune mode, 6 slots incl. empty).
//
// `silenced` is intentionally omitted: legacy derives it from the raw
// snapshot's per-player stun flag (`me.st`), which the frozen useHudStore
// HudView (design §2) does not surface — extending that store was out of
// scope for this PR (see PR description).
import { CFG, SPELLS } from "../../config.js";
import { spellIconSvg } from "../../spell-icons.js";
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
      />,
    );
  }
  return (
    <div className={styles.abilityBar} data-testid="ability-bar">
      {slots}
    </div>
  );
}
