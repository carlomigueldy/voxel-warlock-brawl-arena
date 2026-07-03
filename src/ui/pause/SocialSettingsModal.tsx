// Voice & Chat settings — port of index.html's #social-settings (mic/PTT/
// volume/bubbles/mute-list/conduct — design §9a Wave-2 / issue #166).
// Opened from PauseMenu's "Voice & Chat" button; PauseMenu owns `open`/
// `onClose` + the "Re-read the Code" -> ConductModal bridge (see
// PauseMenu.tsx's header).
//
// PTT key is sourced from `useSettingsStore` (the frozen `vwb-ptt-key`
// single writer), NOT `useSocialPrefsStore` — design §7b nit 3: the p5a
// adapter's `socialPrefs.pttKey` field is inert/mis-sourced, and siblings
// must read/write the authoritative key directly.
import { useState } from "react";
import { CFG } from "../../config.js";
import * as social from "../../social.js";
import { isValidPttKey } from "../../input.js";
import { gameSessionRef } from "../../loop/useGameSession";
import { useSocialPrefsStore } from "../../store/useSocialPrefsStore";
import { useSettingsStore } from "../../store/useSettingsStore";
import { useRosterStore } from "../../store/useRosterStore";
import { useSocialRosterStore } from "../../store/useSocialRosterStore";
import { Modal, Button, Toggle, Slider } from "../common";
import { hex } from "./hexColor";
import styles from "./Social.module.css";

/** Human-readable label for a KeyboardEvent.code — port of ui.js's
 * `_pttKeyLabel` (src/ui.js:2632). */
function pttKeyLabel(code: string): string {
  if (!code) return "`";
  if (code === "Backquote") return "`";
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit[0-9]$/.test(code)) return code.slice(5);
  return code;
}

function PttKeyPicker() {
  const pttKey = useSettingsStore((s) => s.pttKey);
  const setPttKey = useSettingsStore((s) => s.setPttKey);
  const [listening, setListening] = useState(false);

  function startListening() {
    setListening(true);
    const onKeydown = (e: KeyboardEvent) => {
      e.preventDefault();
      window.removeEventListener("keydown", onKeydown, true);
      setListening(false);
      // Reject reserved codes (Escape/Enter/Tab/Space/...) that chat, pause,
      // and dialogs rely on — binding PTT to one of those would silently
      // break the other feature (mirrors ui.js's rebind guard).
      if (isValidPttKey(e.code)) setPttKey(e.code);
    };
    window.addEventListener("keydown", onKeydown, { capture: true, once: true });
  }

  return (
    <Button variant="ghost" className={styles.pttBtn} onClick={startListening} aria-label="Rebind push-to-talk key">
      {listening ? "…" : pttKeyLabel(pttKey)}
    </Button>
  );
}

/** Mute-list roster — port of ui.js's `_buildRosterRow`/`updateRoster`
 * status glyphs (rs-speak/rs-type/rs-afk/rs-muted), scoped to THIS settings
 * dialog rather than the always-visible HUD roster (Scoreboard.tsx's own
 * header hands this off explicitly: "that's pause-chat/roster territory").
 * `social.ts`'s mute list isn't itself reactive (plain localStorage helpers,
 * design's precedent for single-writer non-store keys) — `muteTick` forces a
 * recompute of `social.isMuted()` after this component's own toggle/clear
 * actions; no other writer of `vwb-mute-list` exists to race with. */
function PlayerRosterMute() {
  const playerIds = useRosterStore((s) => s.playerIds);
  const meta = useRosterStore((s) => s.meta);
  const presence = useSocialRosterStore((s) => s.presence);
  const [muteTick, setMuteTick] = useState(0);

  function toggleMute(id: string) {
    gameSessionRef.current?.toggleMute(id);
    setMuteTick((t) => t + 1);
  }

  function clearAll() {
    social.clearMuteList();
    gameSessionRef.current?.clearMutes(playerIds);
    setMuteTick((t) => t + 1);
  }

  return (
    <div className={styles.field}>
      <span className={styles.fieldLabel}>Mute list</span>
      {playerIds.length === 0 ? (
        <p className={styles.emptyRoster}>No other warlocks in this match yet.</p>
      ) : (
        <div className={styles.roster} data-mute-tick={muteTick}>
          {playerIds.map((id) => {
            const m = meta[id];
            const p = presence[id];
            const muted = social.isMuted(id, m?.userId ?? null);
            const name = m?.name || "warlock";
            return (
              <div key={id} className={styles.rosterRow}>
                <span className={styles.chip} style={{ background: hex(CFG.COLORS[(m?.colorIndex ?? 0) % CFG.COLORS.length]) }} />
                <span className={styles.name}>{name}</span>
                <span className={styles.status}>
                  <span
                    className={[styles.glyph, styles.speak, !!p?.speaking && !muted && styles.glyphActive].filter(Boolean).join(" ")}
                    title="Speaking"
                    aria-label="Speaking"
                  >
                    🎤
                  </span>
                  <span
                    className={[styles.glyph, styles.typing, !!p?.typing && !muted && styles.glyphActive].filter(Boolean).join(" ")}
                    title="Typing"
                    aria-label="Typing"
                  >
                    ···
                  </span>
                  <span className={[styles.glyph, styles.afk, !!p?.afk && styles.glyphActive].filter(Boolean).join(" ")} title="AFK" aria-label="AFK">
                    💤
                  </span>
                  <span className={[styles.glyph, styles.muted, muted && styles.glyphActive].filter(Boolean).join(" ")} title="Muted" aria-label="Muted">
                    🔇
                  </span>
                </span>
                <button
                  type="button"
                  className={[styles.muteBtn, muted && styles.muteBtnActive].filter(Boolean).join(" ")}
                  aria-pressed={muted}
                  aria-label={`${muted ? "Unmute" : "Mute"} ${name}`}
                  onClick={() => toggleMute(id)}
                >
                  {muted ? "🔇" : "🔊"}
                </button>
              </div>
            );
          })}
        </div>
      )}
      <Button variant="ghost" onClick={clearAll}>
        Clear Mute List
      </Button>
    </div>
  );
}

export interface SocialSettingsModalProps {
  open: boolean;
  onClose: () => void;
  onReadConduct: () => void;
}

export function SocialSettingsModal({ open, onClose, onReadConduct }: SocialSettingsModalProps) {
  const micEnabled = useSocialPrefsStore((s) => s.micEnabled);
  const setMicEnabled = useSocialPrefsStore((s) => s.setMicEnabled);
  const masterVolume = useSocialPrefsStore((s) => s.masterVolume);
  const setMasterVolume = useSocialPrefsStore((s) => s.setMasterVolume);
  const showBubbles = useSocialPrefsStore((s) => s.showBubbles);
  const setShowBubbles = useSocialPrefsStore((s) => s.setShowBubbles);

  return (
    <Modal open={open} onClose={onClose} ariaLabel="Voice & Chat" className={styles.dialog}>
      <h2 className={styles.title}>Voice &amp; Chat</h2>
      <div className={styles.body}>
        <div className={[styles.field, styles.fieldInline].join(" ")}>
          <div className={styles.fieldCopy}>
            <span className={styles.fieldLabel} id="social-mic-label">
              Voice chat (push-to-talk)
            </span>
            <span className={styles.fieldHint}>Requests microphone access; hold the PTT key to speak.</span>
          </div>
          <Toggle
            checked={micEnabled}
            ariaLabel="Voice chat (push-to-talk)"
            onChange={(next) => {
              setMicEnabled(next);
              gameSessionRef.current?.socialPrefs({ micEnabled: next });
            }}
          />
        </div>

        <div className={[styles.field, styles.fieldInline].join(" ")}>
          <div className={styles.fieldCopy}>
            <span className={styles.fieldLabel}>Push-to-talk key</span>
          </div>
          <PttKeyPicker />
        </div>

        <Slider
          label="Voice volume"
          min={0}
          max={100}
          step={5}
          value={Math.round(masterVolume * 100)}
          onChange={(v) => {
            const next = v / 100;
            setMasterVolume(next);
            gameSessionRef.current?.socialPrefs({ masterVolume: next });
          }}
        />

        <div className={[styles.field, styles.fieldInline].join(" ")}>
          <div className={styles.fieldCopy}>
            <span className={styles.fieldLabel} id="social-bubble-label">
              Show chat bubbles
            </span>
          </div>
          <Toggle checked={showBubbles} ariaLabel="Show chat bubbles" onChange={setShowBubbles} />
        </div>

        <PlayerRosterMute />

        <div className={styles.actions}>
          <Button variant="ghost" onClick={onReadConduct}>
            Re-read the Code
          </Button>
        </div>
      </div>
      <Button variant="ghost" onClick={onClose}>
        Done
      </Button>
    </Modal>
  );
}
