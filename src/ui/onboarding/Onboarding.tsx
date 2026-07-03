// First-run onboarding modal (design §9/§9a UiRoot contract — root-mounted,
// gated internally on useSettingsStore.onboarded) — React port of
// src/onboarding.js's AAA 4-step flow (Name -> Character -> Goal ->
// Hotkeys), landed as legacy DOM in PR #54. Also fixes issue #91: Escape
// during hotkey capture cancels just the capture (not the whole flow), and
// the hotkey-capture step is skipped entirely on touch devices (no
// physical keyboard to bind).
//
// Deviations from the legacy DOM port (documented, not parity gaps):
// - No DOM-sync hack: legacy's finish() reached into the (separate) menu
//   DOM to mirror the chosen name/character because ui.js's menu held its
//   own state. Under `ui=react`, MenuRoot's name field / CharactersScreen
//   already read the SAME useSettingsStore reactively, so writing through
//   the store's setters is the only sync this needs.
// - The live 3D turntable reparent (onboarding.js's _syncCharStage) is
//   renderer territory this UI-only PR doesn't reimplement — see
//   CharacterStep.tsx for the character-step adaptation.
// - The `.ember-field` particle flourish is populated by ui.js's ember
//   generator (menu/juice territory, not onboarding's), so it isn't ported
//   here — Modal's shared `.overlay` backdrop still supplies the ambient
//   gradient + grid-drift chrome.
// - Legacy's global "Enter/ArrowLeft/ArrowRight anywhere advances/rewinds
//   the step" keyboard nav isn't ported — Next/Back/Skip buttons plus
//   Modal's Escape/focus-trap cover the design floor's keyboard
//   requirements without risking a conflict with hotkey capture's own key
//   handling.
import { useCallback, useEffect, useRef, useState } from "react";
import { CFG } from "../../config.js";
import { useSettingsStore } from "../../store/useSettingsStore";
import { Modal, Button } from "../common";
import { NameStep } from "./steps/NameStep";
import { CharacterStep } from "./steps/CharacterStep";
import { GoalStep } from "./steps/GoalStep";
import { HotkeysStep } from "./steps/HotkeysStep";
import { isTouchDevice } from "./isTouchDevice";
import styles from "./Onboarding.module.css";

type StepId = "name" | "character" | "goal" | "hotkeys";

const STEP_LABELS: Record<StepId, string> = { name: "Name", character: "Character", goal: "Goal", hotkeys: "Hotkeys" };

export function Onboarding() {
  const onboarded = useSettingsStore((s) => s.onboarded);
  const setOnboarded = useSettingsStore((s) => s.setOnboarded);
  const setName = useSettingsStore((s) => s.setName);
  const setCharacter = useSettingsStore((s) => s.setCharacter);
  const storedName = useSettingsStore((s) => s.name);
  const storedCharacter = useSettingsStore((s) => s.character);

  const [isTouch] = useState(isTouchDevice);
  const [step, setStep] = useState(0);
  const [name, setLocalName] = useState(storedName);
  const [character, setLocalCharacter] = useState(
    CFG.CHARACTERS.some((c) => c.id === storedCharacter) ? storedCharacter : CFG.DEFAULT_CHARACTER,
  );
  const [capturingIndex, setCapturingIndex] = useState(-1);
  const capturingIndexRef = useRef(-1);
  useEffect(() => {
    capturingIndexRef.current = capturingIndex;
  }, [capturingIndex]);

  // Modal's focus-trap effect depends on `[open, onClose]` (it re-records
  // "what was focused before" + refocuses it on cleanup, every time
  // `onClose` changes identity) — `finish`/`handleModalClose` MUST stay
  // referentially stable across renders, or every keystroke in the name
  // field would re-run that effect and its cleanup would yank focus back
  // off of, say, a hotkey chip mid-capture, spuriously cancelling it. Draft
  // name/character are read through a ref (updated after render, not read
  // directly) so these callbacks never need `name`/`character` in their
  // dependency arrays.
  const draftRef = useRef({ name, character });
  useEffect(() => {
    draftRef.current = { name, character };
  }, [name, character]);

  // issue #91: the hotkeys step needs a physical keyboard to bind anything
  // — drop it entirely on touch devices rather than showing an unusable
  // capture UI with nothing to press.
  const steps: StepId[] = isTouch ? ["name", "character", "goal"] : ["name", "character", "goal", "hotkeys"];
  const stepId = steps[step];

  const finish = useCallback(() => {
    setName(draftRef.current.name.trim().slice(0, 14));
    setCharacter(draftRef.current.character);
    setOnboarded(true);
  }, [setName, setCharacter, setOnboarded]);

  function goNext() {
    if (step >= steps.length - 1) {
      finish();
      return;
    }
    setStep((s) => s + 1);
  }

  function goBack() {
    setStep((s) => Math.max(0, s - 1));
  }

  // issue #91: Escape during hotkey capture must cancel the capture, not
  // the whole flow. Modal's own document-level Escape handler fires before
  // any listener a step could add, so the only reliable place to
  // special-case "Escape while capturing" is the onClose callback Modal
  // itself invokes.
  const handleModalClose = useCallback(() => {
    if (capturingIndexRef.current >= 0) {
      setCapturingIndex(-1);
      return;
    }
    finish();
  }, [finish]);

  if (onboarded) return null;

  return (
    <Modal
      open
      onClose={handleModalClose}
      ariaLabel="Prepare for the Arena"
      closeOnBackdrop={false}
      showCloseButton={false}
      className={styles.panel}
    >
      <header className={styles.header}>
        <span className={styles.eyebrow}>Welcome, Warlock</span>
        <h2 className={styles.title}>Prepare for the Arena</h2>
        <ol className={styles.rail} role="list">
          {steps.map((id, i) => (
            <li
              key={id}
              className={[styles.railStep, i === step && styles.railStepActive, i < step && styles.railStepDone]
                .filter(Boolean)
                .join(" ")}
              aria-current={i === step ? "step" : undefined}
            >
              <span className={styles.railDot} aria-hidden="true" />
              <span className={styles.railLabel}>{STEP_LABELS[id]}</span>
            </li>
          ))}
        </ol>
      </header>

      <div className={styles.body}>
        {stepId === "name" && <NameStep name={name} onChange={setLocalName} onSubmit={goNext} />}
        {stepId === "character" && <CharacterStep character={character} onChange={setLocalCharacter} />}
        {stepId === "goal" && <GoalStep />}
        {stepId === "hotkeys" && (
          <HotkeysStep
            capturingIndex={capturingIndex}
            onBeginCapture={setCapturingIndex}
            onCancelCapture={() => setCapturingIndex(-1)}
          />
        )}
      </div>

      <footer className={styles.footer}>
        <Button variant="ghost" className={styles.skip} onClick={finish}>
          Skip
        </Button>
        <div className={styles.footerNav}>
          <Button variant="ghost" onClick={goBack} disabled={step === 0}>
            Back
          </Button>
          <Button variant="forge" onClick={goNext}>
            {step === steps.length - 1 ? "Enter the Arena" : "Next"}
          </Button>
        </div>
      </footer>
    </Modal>
  );
}
