// Battle Menu — port of index.html's #pause-menu (design §9a Wave-2 / issue
// #166). Mounted once at UiRoot's root, gates internally on
// `useUiStore.paused`. Uses the shared `Modal` primitive (z-index 200) so it
// sits above every screen + any legacy DOM bleed-through (design §9a note).
//
// This component is ALSO the single owner of two things that would
// otherwise fight across sibling trees if split up:
//
// 1. The global Escape/Enter hotkeys. Design §2/§9a's frozen contract
//    documents `useUiStore.paused`/`chatOpen` as store fields P5 reads, but
//    the ONLY code that ever WROTE `paused` reactively was
//    `wireLegacyUiToStores.tsx`'s own `keydown` listener — which only runs
//    under `?ui=legacy` (`<LegacyUiBridge>`, App.tsx:151, never mounts under
//    `?ui=react`). So under react mode nothing currently sets `paused`/opens
//    chat at all; Escape/Enter would be dead keys. This effect is the
//    react-mode equivalent, reading only frozen-but-public state
//    (`useSessionStore`, never the off-limits `snapshotRef` — design §2) and
//    writing the same public fields `wireLegacyUiToStores.tsx`'s handler and
//    `teardown()` already write elsewhere in this codebase (`getInput()`
//    .paused, never `.onPtt` — that single-writer callback stays
//    useGameSession.ts's alone, design comment in ChatPanel.tsx).
// 2. Voice & Chat settings + the Conduct disclaimer. Both need to be
//    reachable independently of `paused` (Conduct auto-shows on first game
//    entry; either dialog can be open while pause is closed), but only two
//    UiRoot mount lines are available (design §9a) — so this component
//    renders SocialSettingsModal/ConductModal as extra, non-`paused`-gated
//    children alongside its own pause Modal, and hands ChatPanel nothing
//    (chat's Escape/Enter is entirely local to its own input, see that
//    file).
import { useCallback, useEffect, useState } from "react";
import { CFG, SPELLS, SPELL_ORDER } from "../../config.js";
import { getAudio, getInput } from "../../services/registry";
import { gameSessionRef } from "../../loop/useGameSession";
import { useSessionStore } from "../../store/useSessionStore";
import { useUiStore } from "../../store/useUiStore";
import { useSettingsStore } from "../../store/useSettingsStore";
import { Modal, Button } from "../common";
import { SocialSettingsModal } from "./SocialSettingsModal";
import { ConductModal } from "./ConductModal";
import styles from "./PauseMenu.module.css";

const CONDUCT_KEY = "vwb-social-conduct-v1";

/** Global Escape (toggle pause) / Enter (open chat) — port of
 * wireLegacyUiToStores.tsx's onKeydown (main.js 840-866), react-mode
 * equivalent (see file header point 1). `dialogOpen` covers both this
 * component's own social/conduct dialogs (Modal's own Escape handler
 * doesn't stopPropagation, so without this guard the SAME Escape keypress
 * would also toggle pause underneath the dialog it just closed). */
function useGamePauseChatHotkeys(dialogOpen: boolean): void {
  useEffect(() => {
    function onKeydown(e: KeyboardEvent) {
      const { inGame, phase } = useSessionStore.getState();
      const inMatch = inGame && phase && phase !== "lobby" && phase !== "spellSelection";
      if (e.code === "Escape") {
        if (!inMatch || dialogOpen) return;
        e.preventDefault();
        const next = !useUiStore.getState().paused;
        useUiStore.getState().setPaused(next);
        getInput().paused = next;
        gameSessionRef.current?.sendAfk(next);
        if (!next) getInput().resetActivity();
        return;
      }
      if (e.code === "Enter") {
        if (!inMatch || dialogOpen) return;
        const { paused, chatOpen } = useUiStore.getState();
        if (paused || chatOpen) return;
        e.preventDefault();
        useUiStore.getState().setChatOpen(true);
      }
    }
    addEventListener("keydown", onKeydown);
    return () => removeEventListener("keydown", onKeydown);
  }, [dialogOpen]);
}

function AudioToggle() {
  // AudioEngine's `enabled`/`musicOn` are plain public fields on the
  // page-lifetime singleton (src/audio.ts), not reactive — seeded once on
  // mount and mirrored locally on click, same ownership model as ui.js's own
  // `_sfxOff`/`_musicOff` (a UI-owned toggle, not a store).
  const [sfxOn, setSfxOn] = useState(() => getAudio().enabled);
  const [musicOn, setMusicOn] = useState(() => getAudio().musicOn);

  return (
    <div className={styles.audio}>
      <button
        type="button"
        className={[styles.audioBtn, !sfxOn && styles.audioOff].filter(Boolean).join(" ")}
        onClick={() => {
          const next = !sfxOn;
          getAudio().setEnabled(next);
          setSfxOn(next);
        }}
      >
        SFX: {sfxOn ? "On" : "Off"}
      </button>
      <button
        type="button"
        className={[styles.audioBtn, !musicOn && styles.audioOff].filter(Boolean).join(" ")}
        onClick={() => {
          const next = !musicOn;
          getAudio().setMusic(next);
          setMusicOn(next);
        }}
      >
        Music: {musicOn ? "On" : "Off"}
      </button>
    </div>
  );
}

/** Keybind reference — port of ui.js's `_buildControlsPanel` (src/ui.js:1881). */
function ControlsPanel() {
  const spellSlotHotkeys = useSettingsStore((s) => s.spellSlotHotkeys);
  const slotKeys = spellSlotHotkeys.length ? spellSlotHotkeys : CFG.DEFAULT_SPELL_SLOT_HOTKEYS;
  const rows: [string, string][] = [
    ["Move", "W A S D / Arrow keys"],
    ["Aim", "Mouse"],
    ["Cast spell", "Ability hotkeys (below)"],
    ...slotKeys.map((key, i): [string, string] => [`Ability slot ${i + 1}`, String(key).toUpperCase()]),
    ...SPELL_ORDER.filter((id) => SPELLS[id]?.key).map((id): [string, string] => [SPELLS[id].name, String(SPELLS[id].key).toUpperCase()]),
  ];
  return (
    <div className={styles.controls}>
      {rows.map(([label, key]) => (
        <div className={styles.controlRow} key={label}>
          <span>{label}</span>
          <kbd>{key}</kbd>
        </div>
      ))}
    </div>
  );
}

export function PauseMenu() {
  const screen = useSessionStore((s) => s.screen);
  const paused = useUiStore((s) => s.paused);
  const [helpOpen, setHelpOpen] = useState(false);
  const [socialOpen, setSocialOpen] = useState(false);
  const [conductOpen, setConductOpen] = useState(false);

  useGamePauseChatHotkeys(socialOpen || conductOpen);

  // Auto-show the conduct disclaimer once per version on first game entry —
  // port of ui.js's `maybeShowConduct()`, called (as a legacy-DOM-only
  // dual-write, design §3 point 2) from useGameSession.ts right when `screen`
  // flips to "game". Reading that SAME transition here needs no frozen-file
  // edit (screen is already a frozen-but-reactive field).
  useEffect(() => {
    if (screen === "game") {
      try {
        if (!localStorage.getItem(CONDUCT_KEY)) setConductOpen(true);
      } catch {
        // Ignore storage errors (private browsing, quota) — matches every
        // other single-writer helper in this codebase; conduct just won't
        // auto-suppress on repeat visits in that case.
      }
    }
  }, [screen]);

  // Defensive reset: any path back to the menu (Leave Match, disconnect,
  // opponent-left, ...) should close pause/chat, mirroring teardown()'s
  // ui.hidePause()/ui.closeChat() legacy-DOM half without adding more
  // additive edits to that frozen function (useGameSession.ts already gets
  // two, for chat history — see useChatStore.ts's header).
  useEffect(() => {
    if (screen !== "game") {
      if (useUiStore.getState().paused) useUiStore.getState().setPaused(false);
      if (useUiStore.getState().chatOpen) useUiStore.getState().setChatOpen(false);
      setHelpOpen(false);
      setSocialOpen(false);
    }
  }, [screen]);

  // Every handler below that ends up as a `Modal`'s `onClose` MUST be a
  // stable reference (useCallback, no closures over changing values —
  // Zustand's getState()/setters are already stable). Modal's focus-trap
  // effect deps on `[open, onClose]`; a fresh function identity every render
  // re-runs that effect on EVERY render (not just open/close), and its
  // cleanup steals focus back via `previouslyFocusedRef.current?.focus?.()`
  // — a sibling PR (#165 onboarding) hit this as a failing test, not by
  // inspection, so it's easy to miss. `setHelpOpen`/`setSocialOpen`/
  // `setConductOpen` themselves are already stable (useState setters); only
  // the wrapping arrow needs memoizing.
  const closePause = useCallback(() => {
    useUiStore.getState().setPaused(false);
  }, []);
  const closeSocial = useCallback(() => setSocialOpen(false), []);
  const openSocial = useCallback(() => setSocialOpen(true), []);
  const openConduct = useCallback(() => setConductOpen(true), []);
  const dismissConduct = useCallback(() => {
    try {
      localStorage.setItem(CONDUCT_KEY, "1");
    } catch {
      // Ignore storage errors — matches every other single-writer helper in
      // this codebase; conduct will just re-show next visit.
    }
    setConductOpen(false);
  }, []);
  const handleResume = useCallback(() => {
    gameSessionRef.current?.resume();
    closePause();
  }, [closePause]);
  const handleLeave = useCallback(() => {
    closePause();
    useUiStore.getState().setChatOpen(false);
    void gameSessionRef.current?.leaveMatch();
  }, [closePause]);

  if (screen !== "game") return null;

  return (
    <>
      <Modal open={paused} onClose={closePause} ariaLabel="Battle Menu" className={styles.dialog}>
        <h2 className={styles.title}>Battle Menu</h2>
        <div className={styles.actions}>
          <Button variant="forge" onClick={handleResume}>
            Resume Game
          </Button>
          <AudioToggle />
          <Button variant="ghost" aria-expanded={helpOpen} onClick={() => setHelpOpen((v) => !v)}>
            How to Play
          </Button>
          {helpOpen && <ControlsPanel />}
          <Button variant="ghost" onClick={openSocial}>
            Voice &amp; Chat
          </Button>
          <Button variant="ghost" className={styles.leave} onClick={handleLeave}>
            Leave Match
          </Button>
        </div>
      </Modal>

      <SocialSettingsModal open={socialOpen} onClose={closeSocial} onReadConduct={openConduct} />
      <ConductModal open={conductOpen} onDismiss={dismissConduct} />
    </>
  );
}
