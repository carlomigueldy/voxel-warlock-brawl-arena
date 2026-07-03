// The in-game HUD (design §9: mounted at UiRoot's `screen==="game"` region;
// #163 p5-hud). Subscribes ONLY to `useHudStore.hud` — the throttled
// (HUD_HZ=10) derived view — never to `snapshotRef` (that would re-render
// React at the 30Hz sim tick rate; see the store's own comment and
// Hud.test.tsx's re-render-count assertion).
import { useHudStore } from "../../store/useHudStore";
import { useSettingsStore } from "../../store/useSettingsStore";
import { HudTop } from "./HudTop";
import { Vitals } from "./Vitals";
import { AbilityBar } from "./AbilityBar";
import { ItemBar } from "./ItemBar";
import { Scoreboard } from "./Scoreboard";
import { CenterMessage } from "./CenterMessage";
import styles from "./Hud.module.css";

export function Hud() {
  const hud = useHudStore((s) => s.hud);
  const spellSlotHotkeys = useSettingsStore((s) => s.spellSlotHotkeys);
  const itemSlotHotkeys = useSettingsStore((s) => s.itemSlotHotkeys);

  // No snapshot published yet (e.g. the very first frame of a match) — the
  // legacy DOM would just show its last-painted state; React has nothing to
  // paint at all until the first publish() lands.
  if (!hud) return null;

  return (
    <div className={styles.hud} data-testid="hud">
      <HudTop phase={hud.phase} round={hud.round} timer={hud.timer} aliveCount={hud.aliveCount} />
      <Scoreboard rows={hud.scoreboard} />
      <Vitals hp={hud.hp} mhp={hud.mhp} charge={hud.charge} cast={hud.cast} />
      <AbilityBar spellSlots={hud.spellSlots} cooldowns={hud.cooldowns} hotkeys={spellSlotHotkeys} />
      <ItemBar items={hud.items} cooldowns={hud.cooldowns} hotkeys={itemSlotHotkeys} />
      <CenterMessage phase={hud.phase} timer={hud.timer} />
    </div>
  );
}
