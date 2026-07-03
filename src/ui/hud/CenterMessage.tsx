// Port of ui.js's showCenter/hideCenter (design §9 acceptance: "center match
// message uses the same escaping discipline as legacy escapeHTML(w)").
//
// Deviation from full legacy parity: the countdown ("3… GO!") is rendered
// faithfully — phase/timer are on the frozen HudView. Round/match END
// messages are NOT named ("Round Over"/"Match Over" instead of "<Name> wins
// the round!") because the winner id (snap.winner/snap.matchWinner) is not a
// HudView field (design §2: useHudStore is frozen P3a, read-only for this
// PR — see PR description). No dynamic/untrusted string is ever interpolated
// here, so React's default JSX-text escaping trivially satisfies the
// escaping-discipline acceptance criterion; naming the winner is a tracked
// follow-up (a small additive HudView field), not attempted in this PR.
import type { Phase } from "../../types";
import styles from "./Hud.module.css";

export interface CenterMessageProps {
  phase: Phase;
  timer: number;
}

export function CenterMessage({ phase, timer }: CenterMessageProps) {
  let big: string | null = null;
  let small: string | null = null;

  if (phase === "countdown") {
    big = timer > 0 ? String(timer) : "GO!";
  } else if (phase === "roundEnd") {
    big = "Round Over";
    small = "Next round starting…";
  } else if (phase === "matchEnd") {
    big = "Match Over";
    small = "Refresh to play again";
  }

  if (!big) return null;

  return (
    <div className={styles.centerMsg} data-testid="center-msg">
      {big}
      {small && <small className={styles.centerMsgSmall}>{small}</small>}
    </div>
  );
}
