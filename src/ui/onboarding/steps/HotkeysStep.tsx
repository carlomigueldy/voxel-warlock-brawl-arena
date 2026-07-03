// Step 4 — spell-slot hotkey capture. Port of onboarding.js's
// _buildHotkeySlots/_beginCapture/_handleCaptureKey/_resetHotkeys, adapted
// from a global `document`-level keydown listener to a per-chip
// onKeyDown: the capturing chip is focused on click (defensively —
// `.focus()` is called explicitly since not every browser focuses buttons
// on click by default), so keydowns land on it directly with no listener
// registration/teardown choreography needed.
//
// Fixes issue #91's "hotkey-capture step is skipped entirely when isTouch
// is true": Onboarding.tsx drops "hotkeys" from its step list on touch
// devices, so this component never mounts there.
//
// Fixes issue #91's Escape requirement: Escape during capture must cancel
// the capture, not the whole flow. This component intentionally does NOT
// treat Escape as a "reserved key" the way Enter/Tab/Space are — Modal's
// own document-level Escape handler (registered before any capture starts)
// always runs first regardless of what this chip's onKeyDown does, so
// Onboarding.tsx's onClose is the single place that owns Escape-while-
// capturing (see its handleModalClose). This handler ignoring Escape
// avoids the two paths fighting over the same keystroke.
import { useState, type KeyboardEvent } from "react";
import { CFG, SPELLS, SPELL_ORDER } from "../../../config.js";
import { keyToCode } from "../../../input.js";
import { menuCue } from "../../../audio.js";
import { useSettingsStore } from "../../../store/useSettingsStore";
import { Button } from "../../common";
import styles from "../Onboarding.module.css";

const HOTKEY_SPELL_IDS = SPELL_ORDER.slice(0, CFG.SPELL_SLOT_COUNT);

// Enter/Tab/Space/NumpadEnter mirror legacy's RESERVED_CODES — Escape is
// deliberately excluded (see file header).
const RESERVED_CODES = new Set(["Enter", "Tab", "Space", "NumpadEnter"]);

function codeToKey(code: string): string | null {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit[0-9]$/.test(code)) return code.slice(5);
  return null;
}

export interface HotkeysStepProps {
  capturingIndex: number;
  onBeginCapture: (index: number) => void;
  onCancelCapture: () => void;
}

export function HotkeysStep({ capturingIndex, onBeginCapture, onCancelCapture }: HotkeysStepProps) {
  const hotkeys = useSettingsStore((s) => s.spellSlotHotkeys);
  const setSpellSlotHotkey = useSettingsStore((s) => s.setSpellSlotHotkey);
  const [feedback, setFeedback] = useState("");

  function reset() {
    onCancelCapture();
    CFG.DEFAULT_SPELL_SLOT_HOTKEYS.forEach((key, i) => setSpellSlotHotkey(i, key));
    setFeedback("Reset to defaults.");
    menuCue("back");
  }

  function handleChipKeyDown(e: KeyboardEvent<HTMLButtonElement>, index: number) {
    if (e.key === "Escape") return; // Onboarding.tsx's Modal onClose owns this — see file header.
    e.preventDefault();
    const code = e.nativeEvent.code;
    if (RESERVED_CODES.has(code)) {
      setFeedback("That key is reserved — pick another.");
      onCancelCapture();
      return;
    }
    const key = codeToKey(code);
    if (!key || !keyToCode(key)) {
      setFeedback("Use a letter or number key.");
      onCancelCapture();
      return;
    }
    if (hotkeys.some((k, i) => i !== index && k === key)) {
      setFeedback(`${key} is already bound to another spell.`);
      onCancelCapture();
      return;
    }
    setSpellSlotHotkey(index, key);
    onCancelCapture();
    setFeedback("");
    menuCue("confirm");
  }

  return (
    <section className={styles.step} aria-label="Set your hotkeys">
      <h3 className={styles.stepTitle}>Set your hotkeys</h3>
      <p className={styles.stepDesc}>Click a slot, then press a key to bind it.</p>
      <div className={styles.hotkeys}>
        {HOTKEY_SPELL_IDS.map((spellId, i) => {
          const spell = SPELLS[spellId];
          const label = spell ? spell.name : `Slot ${i + 1}`;
          const capturing = capturingIndex === i;
          return (
            <div key={spellId} className={styles.hotkeySlot}>
              <span className={styles.hotkeyName}>{label}</span>
              <button
                type="button"
                className={[styles.hotkeyChip, capturing && styles.hotkeyChipCapturing].filter(Boolean).join(" ")}
                aria-label={`Rebind ${label} hotkey`}
                onClick={(e) => {
                  e.currentTarget.focus();
                  setFeedback("Press a key…");
                  onBeginCapture(i);
                }}
                onKeyDown={capturing ? (e) => handleChipKeyDown(e, i) : undefined}
                onBlur={() => {
                  if (capturing) {
                    onCancelCapture();
                    setFeedback("");
                  }
                }}
              >
                {capturing ? "…" : hotkeys[i]}
              </button>
            </div>
          );
        })}
      </div>
      <Button variant="ghost" className={styles.hotkeysReset} onClick={reset}>
        Reset to defaults
      </Button>
      <p className={styles.hotkeysFeedback} aria-live="polite">
        {feedback}
      </p>
    </section>
  );
}
