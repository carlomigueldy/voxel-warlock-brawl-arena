// Port of ui.js's updateItemBar (design §9 scope: "Item bar from hud.items").
// Always renders the strict CFG.ITEM_SLOT_COUNT layout (guard.ui #10 —
// #item-bar element present; #12 — positioned + pointer-events:auto, see
// Hud.module.css .itemBar).
//
// Cooldown overlays and the "PSV" muted-key badge only apply to active
// (spell-granting) items — passive stat items have no cooldown/key, matching
// ui.js's isActive branch. The pickup toast (transient "+Item" popup on a
// newly-filled slot) is intentionally not ported — it needs the *previous*
// tick's items to diff against, which the throttled HudView doesn't retain
// across publishes, and was not called out in this PR's scope.
import { CFG, ITEMS, SPELLS } from "../../config.js";
import { itemIconSvg } from "../../spell-icons.js";
import type { CooldownMap } from "../../types";
import { toHexColor } from "./hudColor";
import { SpellSlot } from "./SpellSlot";
import styles from "./Hud.module.css";

const EMPTY_COLOR = toHexColor(0x444444);

export interface ItemBarProps {
  items: string[];
  cooldowns: CooldownMap;
  hotkeys: string[];
}

export function ItemBar({ items, cooldowns, hotkeys }: ItemBarProps) {
  const equipped = items.slice(0, CFG.ITEM_SLOT_COUNT);
  const slots = [];
  for (let i = 0; i < CFG.ITEM_SLOT_COUNT; i++) {
    const key = equipped[i];
    const it = key ? ITEMS[key] : undefined;
    const empty = !it;
    const isActive = !empty && it!.kind === "active";
    const remain = isActive && it!.grantsSpell ? cooldowns[it!.grantsSpell] || 0 : 0;
    const total = isActive && it!.grantsSpell ? SPELLS[it!.grantsSpell]?.cd || 1 : 1;
    const pct = Math.max(0, Math.min(100, (remain / total) * 100));
    const hotkey = hotkeys[i] || CFG.DEFAULT_ITEM_SLOT_HOTKEYS[i];
    const ready = !empty && isActive && remain <= 0;

    slots.push(
      <SpellSlot
        key={i}
        ariaLabel={
          empty
            ? `Item slot ${i + 1}: empty`
            : isActive
              ? `${it!.name}${ready ? ", ready" : `, cooldown ${Math.ceil(remain)}s`} (${hotkey})`
              : `${it!.name}, passive`
        }
        swatchHtml={itemIconSvg(empty ? "" : it!.shape)}
        swatchColor={empty ? EMPTY_COLOR : toHexColor(it!.color)}
        hotkeyLabel={empty ? "" : isActive ? hotkey : "PSV"}
        hotkeyMuted={!empty && !isActive}
        name={empty ? "Empty" : it!.name}
        cdPct={isActive ? pct : 0}
        cdLabel={isActive && remain > 0 ? String(Math.ceil(remain)) : ""}
        empty={empty}
        ready={ready}
        variant={empty ? undefined : isActive ? "active" : "passive"}
      />,
    );
  }
  return (
    <div className={styles.itemBar} data-testid="item-bar">
      {slots}
    </div>
  );
}
