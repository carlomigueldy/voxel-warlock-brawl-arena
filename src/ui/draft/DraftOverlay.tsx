// The spell/item draft overlay + draft-juice — design §9 #164 p5-draft,
// mounted at UiRoot's `{screen === "game" && <DraftOverlay />}` (design §9a).
// Faithful port of ui.js's showSpellDraft/_buildDraftOverlay/
// _refreshDraftOverlay (Step 6) plus src/draft-juice.js's hover glow,
// lock-in burst/chord, escalating countdown ticks, and all-locked
// celebration — re-homed onto React state instead of DOM MutationObservers
// (design §9: "stop observing the DOM ... read store state directly").
//
// Gating + data: `useDraftStore`'s `active`/`picks`/`ready`/`timer` come
// exclusively from its own throttled `publish()` (wired into onNewSnapshot,
// mirroring useHudStore) — see that store's header for why there is
// deliberately NO client-side optimism here: legacy's own overlay redraws
// straight from the snapshot every frame too, so a non-host client's pick
// only visibly lands once the host's next broadcast round-trips back
// anyway; adding local optimism would just risk a flicker when a slightly
// stale in-flight snapshot briefly clobbers it.
//
// Practice-mode "Change Abilities" loadout editor (ui.js's
// openLoadoutEditor, reusing this same DOM overlay outside the phase-driven
// draft) is intentionally NOT ported here — its only trigger is the pause
// menu's practice panel, which is #166 p5-pause-chat's surface and hasn't
// landed yet. #166 (or a follow-up) wires that trigger against this
// component once it exists; this PR's scope is the phase-driven draft only
// (design §9's itemization: pick grid, timer, ready state, draft-juice).
import { useEffect, useRef, useState } from "react";
import { CFG, SPELLS, SPELL_ORDER, SPELL_TEMPLATES } from "../../config.js";
import { menuCue } from "../../audio.js";
import { gameSessionRef } from "../../loop/useGameSession";
import { useDraftStore } from "../../store/useDraftStore";
import { useFx } from "../../hooks/useFx";
import { Modal, Button } from "../common";
import { DraftTemplates } from "./DraftTemplates";
import { DraftSlots } from "./DraftSlots";
import { DraftSpellCard } from "./DraftSpellCard";
import { schoolForSpell } from "./draftSchools";
import styles from "./DraftOverlay.module.css";

type DraftAction = { action: "toggle"; spell: string } | { action: "template"; template: number } | { action: "ready" } | { action: "clear" };

function dispatch(action: DraftAction): void {
  gameSessionRef.current?.draft(action);
}

// Draft-able spells: SPELL_ORDER minus fireball (the free always-on basic —
// mirrors ui.js's _buildDraftOverlay grid-build loop).
const DRAFTABLE_SPELLS = SPELL_ORDER.filter((id) => id !== "fireball");

const HOVER_CUE_MS = 60; // mirrors draft-juice.js's lastHover throttle

export function DraftOverlay() {
  const active = useDraftStore((s) => s.active);
  const picks = useDraftStore((s) => s.picks);
  const ready = useDraftStore((s) => s.ready);
  const timer = useDraftStore((s) => s.timer);
  const fx = useFx();

  const pipRefs = useRef<(HTMLDivElement | null)[]>([]);
  const prevPicksRef = useRef<string[]>([]);
  const wasAllFilledRef = useRef(false);
  const lastCountSecRef = useRef(-1);
  const lastHoverRef = useRef(0);
  const celebrateTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [celebrating, setCelebrating] = useState(false);

  // Lifecycle reset when the overlay closes (mirrors draft-juice.js's
  // onOverlayVisibility) — the next draft phase starts every juice tracker
  // fresh rather than carrying state from a previous match/round.
  useEffect(() => {
    if (!active) {
      prevPicksRef.current = [];
      wasAllFilledRef.current = false;
      lastCountSecRef.current = -1;
      clearTimeout(celebrateTimeoutRef.current);
      setCelebrating(false);
    }
  }, [active]);

  // Never leave a celebrate timeout running past unmount (e.g. leaving the
  // game screen mid-celebration).
  useEffect(() => () => clearTimeout(celebrateTimeoutRef.current), []);

  // Legacy-DOM duplicate-accessible-content stopgap (#176 review finding —
  // see docs/MEMORY.md). onNewSnapshot.ts's legacy-UI fan-out is UNGATED by
  // UI_MODE (unlike #menu/#lobby/#hud, which are hidden-by-default or only
  // shown via UI_MODE-gated calls) — under `?ui=react` it still calls
  // ui.js's showSpellDraft() every tick during spellSelection, which
  // un-hides AND builds the real legacy `#spell-draft` overlay with the
  // SAME role="option"+aria-label spell cards this component mirrors. A
  // role+label locator (or a screen-reader rotor/virtual-cursor, not just
  // Tab — z-index only guards pointer clicks, not the accessibility tree)
  // would otherwise resolve TWO elements. Precedented by UiRoot's
  // useHideLegacyMenuDom ("a targeted DOM fixup for a known frozen call
  // site, not a MutationObserver") — neutralize the legacy node from the
  // a11y tree for exactly as long as this overlay is open, restoring it on
  // close/unmount so `?ui=legacy` (which never mounts this component) and
  // the legacy node's own lifecycle stay untouched otherwise.
  useEffect(() => {
    const legacy = document.getElementById("spell-draft");
    if (!legacy) return;
    if (active) {
      legacy.inert = true;
      legacy.setAttribute("aria-hidden", "true");
    }
    return () => {
      legacy.inert = false;
      legacy.removeAttribute("aria-hidden");
    };
  }, [active]);

  // Lock-in burst + chord for every newly-filled slot (draft-juice.js's
  // onPipMutation, keyed off the store's picks array instead of a
  // MutationObserver on .draft-slot-pip class changes).
  useEffect(() => {
    if (!active) return;
    const prev = prevPicksRef.current;
    picks.forEach((id, i) => {
      if (prev.includes(id)) return; // already had this pick before
      const pip = pipRefs.current[i];
      if (pip) {
        const school = schoolForSpell(id);
        const r = pip.getBoundingClientRect();
        fx.burst(r.left + r.width / 2, r.top + r.height / 2, school.burst, 10);
        // Pip scale-pulse (draft-juice.js's fireLockIn) — imperative class
        // toggle on the ref, same re-trigger trick as legacy: force a
        // reflow so the animation restarts even if `pipLock` is somehow
        // still applied, then clean up once it finishes.
        pip.classList.remove(styles.pipLock);
        void pip.offsetWidth;
        pip.classList.add(styles.pipLock);
        pip.addEventListener("animationend", () => pip.classList.remove(styles.pipLock), { once: true });
      }
      menuCue("lockin");
    });
    prevPicksRef.current = picks;

    const allFilled = picks.length > 0 && picks.length >= CFG.SPELL_SLOT_COUNT;
    if (allFilled && !wasAllFilledRef.current) {
      fx.flash("rgba(108,76,255,0.5)");
      menuCue("confirm");
      setTimeout(() => menuCue("lockin"), 130);
      clearTimeout(celebrateTimeoutRef.current);
      setCelebrating(true);
      // Matches the djAllLocked keyframe's 0.7s duration (DraftOverlay.module.css).
      celebrateTimeoutRef.current = setTimeout(() => setCelebrating(false), 700);
    }
    wasAllFilledRef.current = allFilled;
  }, [active, picks, fx]);

  // Escalating countdown ticks for the final 5 seconds (draft-juice.js's
  // onTimerMutation, driven by the same throttled `timer` the header shows).
  useEffect(() => {
    if (!active) return;
    if (timer === lastCountSecRef.current) return;
    lastCountSecRef.current = timer;
    if (timer > 0 && timer <= 5) menuCue("countdown");
  }, [active, timer]);

  function handleToggle(id: string) {
    dispatch({ action: "toggle", spell: id });
  }
  function handleTemplate(i: number) {
    dispatch({ action: "template", template: i });
  }
  function handleReady() {
    dispatch({ action: "ready" });
  }
  function handleClear() {
    dispatch({ action: "clear" });
  }
  function handleCardHover() {
    const now = performance.now();
    if (now - lastHoverRef.current <= HOVER_CUE_MS) return;
    lastHoverRef.current = now;
    menuCue("hover");
  }

  const urgent = timer <= 8;
  const atCap = picks.length >= CFG.SPELL_SLOT_COUNT;

  return (
    <Modal
      open={active}
      onClose={handleClear}
      ariaLabel="Spell Draft"
      showCloseButton={false}
      closeOnBackdrop={false}
      className={[styles.panel, celebrating && styles.allLocked].filter(Boolean).join(" ")}
    >
      <>
        <header className={styles.header}>
          <div className={styles.headerLeft}>
            <span className={styles.eyebrow}>Pre-Match</span>
            <h2 className={styles.title}>Spell Draft</h2>
          </div>
          <div className={styles.timerWrap} aria-live="polite" aria-label="Time remaining">
            <span className={styles.timerLabel}>Time</span>
            <div className={[styles.timer, urgent && styles.timerUrgent].filter(Boolean).join(" ")}>{timer}</div>
          </div>
        </header>

        <p className={styles.hint}>
          Pick up to {CFG.SPELL_SLOT_COUNT} spells. Fireball is always free. Click <strong>Ready</strong> when done.
        </p>

        <DraftTemplates disabled={ready} onPick={handleTemplate} />

        <div className={styles.body}>
          <DraftSlots picks={picks} registerPip={(i) => (el) => { pipRefs.current[i] = el; }} />
          <div className={styles.grid} role="listbox" aria-label="Available spells" aria-multiselectable="true">
            {DRAFTABLE_SPELLS.map((id) => {
              const def = SPELLS[id];
              if (!def) return null;
              const selected = picks.includes(id);
              return (
                <DraftSpellCard
                  key={id}
                  id={id}
                  name={def.name}
                  desc={def.desc}
                  cd={def.cd}
                  color={def.color ?? 0x6c4cff}
                  selected={selected}
                  atCap={atCap}
                  disabled={ready}
                  onToggle={handleToggle}
                  onHover={handleCardHover}
                />
              );
            })}
          </div>
        </div>

        <footer className={styles.footer}>
          <Button
            variant="forge"
            className={[styles.readyBtn, ready && styles.isReady].filter(Boolean).join(" ")}
            disabled={ready}
            onClick={handleReady}
          >
            {ready ? "Locked In" : "Ready"}
          </Button>
        </footer>
      </>
    </Modal>
  );
}

// Re-exported for RTL coverage of the template count without re-deriving it.
export const DRAFT_TEMPLATE_COUNT = SPELL_TEMPLATES.length;
