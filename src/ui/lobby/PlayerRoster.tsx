// The "Warlocks" rail: live player list + (host-only) bot count/skill
// controls — port of ui.js's renderPlayerList (src/ui.js:1921-1947) and
// _buildBotControls (src/ui.js:239-284) / index.html L572-595.
//
// Player list source: useRosterStore.meta/playerIds (design §2 — populated
// every host-loop tick via onNewSnapshot -> deriveRoster, including during
// PHASE.LOBBY, since useHostLoop/useClientLoop run unconditionally). Legacy
// additionally threads an explicit `hostId` into renderPlayerList (the
// host's own peer id, known synchronously from Host.onReady/MSG.LOBBY).
// useRosterStore doesn't carry that id, but `this.players` (sim.ts) is a
// Map and the host is ALWAYS sim.addPlayer()'d first — before any joiner —
// so map/array insertion order is preserved end-to-end through
// snapshot()/deriveRoster(); playerIds[0] is reliably the host for as long
// as the host itself never leaves (leaving ends the match anyway).
import { useEffect, useRef, useState } from "react";
import { CFG } from "../../config.js";
import { gameSessionRef } from "../../loop/useGameSession";
import { useLobbyConfigStore } from "../../store/useLobbyConfigStore";
import { useRosterStore } from "../../store/useRosterStore";
import { SegmentedControl, type SegmentedOption } from "../common";
import { hex } from "./hexColor";
import styles from "./PlayerRoster.module.css";

const BOT_SKILL_LABELS: Record<string, string> = { smart: "Smart", brilliant: "Brilliant", expert: "Expert" };
const BOT_SKILL_OPTIONS: SegmentedOption[] = CFG.BOT_SKILLS.map((skill) => ({
  value: skill,
  label: BOT_SKILL_LABELS[skill] || skill,
}));

export interface PlayerRosterProps {
  isHost: boolean;
}

export function PlayerRoster({ isHost }: PlayerRosterProps) {
  const playerIds = useRosterStore((s) => s.playerIds);
  const meta = useRosterStore((s) => s.meta);
  const botCount = useLobbyConfigStore((s) => s.botCount);
  const botSkill = useLobbyConfigStore((s) => s.botSkill);
  const hostId = playerIds[0] ?? null;

  return (
    <section className={styles.rail} aria-label="Warlocks">
      <p className={styles.railTitle}>Warlocks</p>
      <ul className={styles.list}>
        {playerIds.map((id) => {
          const m = meta[id];
          if (!m) return null;
          return (
            <li key={id} className={styles.row}>
              <span className={styles.swatch} style={{ background: hex(CFG.COLORS[m.colorIndex % CFG.COLORS.length]) }} />
              <span className={styles.name}>{m.name}</span>
              {m.isBot ? (
                <span className={styles.badge}>BOT</span>
              ) : id === hostId ? (
                <span className={styles.badge}>HOST</span>
              ) : null}
            </li>
          );
        })}
      </ul>
      {isHost && (
        <div className={styles.botControls}>
          <div className={styles.botField}>
            <span className={styles.fieldLabel}>Bot count</span>
            <BotCountStepper
              count={botCount}
              onChange={(n) => {
                useLobbyConfigStore.getState().setBotCount(n);
                gameSessionRef.current?.bots();
              }}
            />
          </div>
          <div className={styles.botField}>
            <span className={styles.fieldLabel}>Bot skill</span>
            <SegmentedControl
              size="sm"
              ariaLabel="Bot skill"
              options={BOT_SKILL_OPTIONS}
              value={botSkill}
              onChange={(skill) => {
                useLobbyConfigStore.getState().setBotSkill(skill);
                gameSessionRef.current?.bots();
              }}
            />
          </div>
        </div>
      )}
    </section>
  );
}

// Port of ui.js's _buildBotControls() stepper half — the numeric +/- control
// bound to #bot-count, including the "bump" pulse on every value change
// (style.css's .stepper-value.bump, replayed here by toggling the class on
// the next frame rather than the DOM force-reflow trick the legacy code used).
function BotCountStepper({ count, onChange }: { count: number; onChange: (count: number) => void }) {
  const [bump, setBump] = useState(false);
  const prevCount = useRef(count);

  useEffect(() => {
    if (prevCount.current === count) return;
    prevCount.current = count;
    setBump(false);
    const raf = requestAnimationFrame(() => setBump(true));
    return () => cancelAnimationFrame(raf);
  }, [count]);

  const max = CFG.MAX_PLAYERS - 1;
  return (
    <div className={styles.stepper}>
      <button
        type="button"
        className={styles.stepperBtn}
        disabled={count <= 0}
        aria-label="Fewer bots"
        onClick={() => onChange(count - 1)}
      >
        −
      </button>
      <span
        className={[styles.stepperValue, bump && styles.bump].filter(Boolean).join(" ")}
        onAnimationEnd={() => setBump(false)}
      >
        {count}
      </span>
      <button
        type="button"
        className={styles.stepperBtn}
        disabled={count >= max}
        aria-label="More bots"
        onClick={() => onChange(count + 1)}
      >
        +
      </button>
    </div>
  );
}
