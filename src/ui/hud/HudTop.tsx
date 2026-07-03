// Port of ui.js's updateHUD round/timer block (design §9 scope:
// "round/phase, timer, alive count") — #hud-top's roundInfo + timer, plus
// aliveCount (a HudView field with no direct legacy DOM element; surfaced
// here as its own pill).
import type { Phase } from "../../types";
import styles from "./Hud.module.css";

const PHASE_LABEL: Partial<Record<Phase, string>> = {
  spellSelection: "Spell Draft",
  countdown: "Get Ready",
  playing: "Brawl!",
  roundEnd: "Round Over",
  matchEnd: "Match Over",
  lobby: "",
};

function fmtTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60)
    .toString()
    .padStart(2, "0");
  return `${m}:${s}`;
}

function timerText(phase: Phase, timer: number): string {
  if (phase === "countdown") return String(timer);
  if (phase === "spellSelection") return `${timer}s`;
  return fmtTime(timer);
}

export interface HudTopProps {
  phase: Phase;
  round: number;
  timer: number;
  aliveCount: number;
}

export function HudTop({ phase, round, timer, aliveCount }: HudTopProps) {
  const urgent = phase === "countdown" && timer <= 3;
  const cls = [styles.top, urgent && styles.timerUrgent].filter(Boolean).join(" ");

  return (
    <div className={cls} data-testid="hud-top">
      <span className={styles.roundInfo}>
        Round {round} — {PHASE_LABEL[phase] || ""}
      </span>
      <span className={styles.timer}>{timerText(phase, timer)}</span>
      <span className={styles.aliveCount}>{aliveCount} alive</span>
    </div>
  );
}
