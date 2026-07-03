// React port of src/screens.js's ScreenDirector (design §9a #168) — the
// legacy version watches #menu/#lobby/#hud for `.hidden` class flips via a
// MutationObserver and layers FX + a menuCue + a "ROUND 1" card on top of
// that instant swap. React already has a single source of truth for the
// active top-level screen (`useSessionStore.screen`), so the React port
// just subscribes to it directly — no DOM observation needed at all.
import { useEffect, useRef, useState } from "react";
import { useSessionStore, type AppScreen } from "../../store/useSessionStore";
import { FX } from "../../hooks/useFx";
import { menuCue } from "../../audio";

// Exported so RoundCard.tsx's CSS animation-duration stays in lockstep with
// the timeout that unmounts it — one number, not two magic constants to drift.
export const ROUND_CARD_MS = 1400;
const ROUND_CARD_LINGER_MS = ROUND_CARD_MS + 240; // matches legacy's cleanup margin
const FLASH_COLOR = "rgba(255,90,60,0.35)";

export interface ScreenTransitionState {
  /** Whether the "ROUND 1" card should render — only on a lobby -> game
   * transition, and only when motion is allowed (design §7). */
  roundCard: boolean;
}

export function useScreenTransition(): ScreenTransitionState {
  const screen = useSessionStore((s) => s.screen);
  const prevRef = useRef<AppScreen | null>(null);
  const [roundCard, setRoundCard] = useState(false);

  useEffect(() => {
    const prev = prevRef.current;
    prevRef.current = screen;
    if (prev === null || prev === screen) return; // first mount, or a no-op transition

    // The audio cue is never gated by reduced motion (design §7: "audio cues
    // kept" — menuCue never silenced).
    menuCue("transition");

    if (FX.reducedMotion) return;

    FX.flash(FLASH_COLOR, 140);
    FX.burst(window.innerWidth / 2, window.innerHeight / 2, "ember", 14);

    if (prev === "lobby" && screen === "game") {
      setRoundCard(true);
      const t = setTimeout(() => setRoundCard(false), ROUND_CARD_LINGER_MS);
      return () => clearTimeout(t);
    }
  }, [screen]);

  return { roundCard };
}
