// P5 screen-transitions + nav-feel + gamepad + credits juice (design §9a
// #168) — React port of src/legacy/juice.ts's barrel (screens.js +
// nav-feel.js + gamepad.js + credits.js; draft-juice.js is #164's territory,
// onboarding.js is #165's). Mounted once at UiRoot's root as a bare
// decorator, additive alongside the other regions (design §9 integration
// contract) — it renders no screen of its own, only overlays/affordances on
// top of whichever screen is active. src/legacy/juice.ts stays golden
// (untouched) until P6; this is its React-mode equivalent, not a replacement
// of the file itself.
import { useScreenTransition } from "./useScreenTransition";
import { useNavFeel } from "./useNavFeel";
import { useGamepad } from "./useGamepad";
import { RoundCard } from "./RoundCard";
import { Credits } from "./Credits";
import styles from "./Juice.module.css";

export function Juice() {
  const { roundCard } = useScreenTransition();
  const { backVisible, goBack } = useNavFeel();
  const { toast } = useGamepad();

  return (
    <>
      {roundCard && <RoundCard />}
      {backVisible && (
        <button type="button" className={styles.backButton} aria-label="Back to Online play" onClick={goBack}>
          ‹ Back
        </button>
      )}
      <Credits />
      {toast && (
        <div className={styles.gamepadToast} role="status" data-testid="gamepad-toast">
          {toast}
        </div>
      )}
    </>
  );
}
