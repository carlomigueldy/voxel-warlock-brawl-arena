// The "ROUND 1" card — port of src/screens.js's showRoundCard(). Only ever
// mounted by <Juice/> when useScreenTransition() decides a lobby -> game
// transition warrants it (which already gates on !FX.reducedMotion), so this
// component itself needs no reduced-motion branch.
import styles from "./Juice.module.css";

export function RoundCard() {
  return (
    <div className={styles.roundCard} aria-hidden="true" data-testid="juice-round-card">
      <div className={styles.roundCardText}>ROUND 1</div>
    </div>
  );
}
