// Always-mounted chat surface (design §9a Wave-2 / issue #166) — port of
// index.html's #chat-panel (message log + input) + #ptt-indicator. Mounted
// once at UiRoot's root, gates internally on `screen==="game"` (no legacy
// equivalent to a menu/lobby chat) and `useUiStore.chatOpen` (input row
// only). Self-positions fixed like Hud/MenuRoot (design §9a note) rather
// than relying on a UiRoot wrapper.
//
// Legacy-DOM bleed-through note: unlike the menu case UiRoot's
// useHideLegacyMenuDom already patches, chat is a REAL bleed-through risk —
// `useGameSession.ts`'s applyChat() still dual-writes to the legacy
// `ui.addChatLine()` DOM sink every match (see useChatStore.ts's header),
// and that legacy `#chat-panel` lives inside `#hud`, which
// `ui.showGame()`'s own dual-write unhides regardless of UI_MODE. This
// panel's z-index 150 (ChatPanel.module.css) sits above that legacy layer
// (z-index 6) the same way design §9a says the Wave-2 Modal overlays do —
// intentional, not a coincidence, and per that same note this file does NOT
// re-patch the legacy DOM itself (that consolidation is owner-tracked).
//
// Message list renders name/text as plain JSX text children — React escapes
// them, the same XSS invariant guard.ui #1 enforces on the legacy DOM
// (design §8) — never dangerouslySetInnerHTML.
import { useEffect, useRef, useState } from "react";
import { CFG } from "../../config.js";
import { getInput } from "../../services/registry";
import { gameSessionRef } from "../../loop/useGameSession";
import { useSessionStore } from "../../store/useSessionStore";
import { useUiStore } from "../../store/useUiStore";
import { useChatStore } from "../../store/useChatStore";
import { hex } from "./hexColor";
import styles from "./ChatPanel.module.css";

// Mirrors ui.js's _bindChat() TYPING_IDLE_MS (src/ui.js:2333) — how long to
// wait after the last keystroke before telling peers typing stopped.
const TYPING_IDLE_MS = 1500;

/** Polls the page-lifetime InputController's `ptt` field (design §2:
 * `input.onPtt` is a single-writer callback already claimed by
 * useGameSession.ts's "wire once" effect — reassigning it here would
 * silently break voice transmission, so this reads the plain public field
 * instead of claiming the callback). A 100ms poll is plenty for a visual
 * MIC indicator; the currently-listening peers get the real transmit signal
 * from the (unpolled) onPtt callback already. */
function usePttActive(): boolean {
  const [active, setActive] = useState(false);
  useEffect(() => {
    const id = setInterval(() => {
      const on = getInput().ptt;
      setActive((prev) => (prev === on ? prev : on));
    }, 100);
    return () => clearInterval(id);
  }, []);
  return active;
}

export function ChatPanel() {
  const screen = useSessionStore((s) => s.screen);
  const chatOpen = useUiStore((s) => s.chatOpen);
  const messages = useChatStore((s) => s.messages);
  const pttActive = usePttActive();
  const inputRef = useRef<HTMLInputElement>(null);
  const typingTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [now, setNow] = useState(() => Date.now());

  // Per-line fade (mirrors ui.js's addChatLine `setTimeout(..., dim)`,
  // CHAT_LINE_FADE_MS after the line was added) — a 1s tick is plenty for a
  // cosmetic dim and only runs while there's something to fade.
  useEffect(() => {
    if (messages.length === 0) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [messages.length]);

  // Keep the page-lifetime InputController + peers in sync with chatOpen
  // regardless of who flipped the store flag (this panel's own toggle, or
  // PauseMenu's global Enter-opens-chat listener) — mirrors
  // wireLegacyUiToStores.tsx's `ui.on("chatOpen", ...)` handler.
  useEffect(() => {
    getInput().chatting = chatOpen;
    if (chatOpen) {
      inputRef.current?.focus();
    } else {
      clearTimeout(typingTimerRef.current);
      gameSessionRef.current?.sendTyping(false);
      getInput().resetActivity();
    }
  }, [chatOpen]);

  useEffect(() => () => clearTimeout(typingTimerRef.current), []);

  if (screen !== "game") return null;

  function onInputChange() {
    gameSessionRef.current?.sendTyping(true);
    clearTimeout(typingTimerRef.current);
    typingTimerRef.current = setTimeout(() => gameSessionRef.current?.sendTyping(false), TYPING_IDLE_MS);
  }

  function onInputKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      // Swallow so this doesn't also reach a global handler that might
      // reopen chat on the same keystroke (mirrors ui.js's _bindChat).
      e.stopPropagation();
      e.preventDefault();
      const text = e.currentTarget.value.trim();
      if (text) gameSessionRef.current?.sendChat(text);
      e.currentTarget.value = "";
      useUiStore.getState().setChatOpen(false);
    } else if (e.key === "Escape") {
      // Swallow so PauseMenu's global Escape handler doesn't also open pause.
      e.stopPropagation();
      e.preventDefault();
      useUiStore.getState().setChatOpen(false);
    }
  }

  return (
    <div className={styles.panel} data-testid="chat-panel">
      <div className={styles.log} role="log" aria-live="polite" aria-relevant="additions">
        {messages.map((m) => {
          const dim = now - m.t > CFG.SOCIAL.CHAT_LINE_FADE_MS;
          const color = hex(m.color);
          return (
            <div
              key={m.id}
              className={[styles.line, m.isSelf && styles.self, dim && styles.dim].filter(Boolean).join(" ")}
            >
              <span className={styles.name} style={{ color }}>
                {m.name}
              </span>
              <span className={styles.text}>{m.text}</span>
            </div>
          );
        })}
      </div>

      {chatOpen ? (
        <div className={styles.inputWrap}>
          <input
            ref={inputRef}
            className={styles.input}
            type="text"
            maxLength={CFG.SOCIAL.CHAT_MAX_LEN}
            autoComplete="off"
            aria-label="Chat message"
            placeholder="Say something…"
            onChange={onInputChange}
            onKeyDown={onInputKeyDown}
          />
        </div>
      ) : (
        <button
          type="button"
          className={styles.toggleBtn}
          aria-label="Open chat"
          onClick={() => useUiStore.getState().setChatOpen(true)}
        >
          💬
        </button>
      )}

      {pttActive && (
        <div className={styles.pttIndicator} aria-hidden="true">
          MIC
        </div>
      )}
    </div>
  );
}
