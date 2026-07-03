// Port of ui.js's updateRoster (design §9 scope: "Scoreboard from
// hud.scoreboard (id/name/k/d/s/alive)"). Names render as JSX text children
// — React escapes them, never innerHTML-interpolated — the same XSS
// invariant guard.ui #1 enforces on the legacy DOM (design §8).
//
// Mute/typing/speaking/AFK indicators are not rendered: those key off
// `social.ts`/`meta` state HudView doesn't carry (it only has
// id/name/k/d/s/alive) — that's pause-chat/roster territory, not this HUD.
import styles from "./Hud.module.css";

export interface ScoreboardRow {
  id: string;
  name: string;
  k: number;
  d: number;
  s: number;
  alive: boolean;
}

export interface ScoreboardProps {
  rows: ScoreboardRow[];
}

export function Scoreboard({ rows }: ScoreboardProps) {
  // Ranked by score, matching ui.js's updateRoster sort.
  const sorted = [...rows].sort((a, b) => b.s - a.s);

  return (
    <div className={styles.scoreboard} data-testid="scoreboard">
      <span className={styles.scoreboardTitle}>Warlocks</span>
      {sorted.map((p) => (
        <div key={p.id} className={[styles.row, !p.alive && styles.dead].filter(Boolean).join(" ")}>
          <span>{p.name}</span>
          <span>
            {p.k}/{p.d}
          </span>
          <span className={styles.pscore}>{p.s}</span>
        </div>
      ))}
    </div>
  );
}
