// Reactive home for the in-match chat log — design §9's p5-pause-chat scope
// ("message list ... XSS-safe"). NOT in the design §2 frozen-store list
// because no P3a/p5a store carries chat history: `useGameSession.ts`'s
// `applyChat()` (design's central per-message fan-out, mirroring
// `onNewSnapshot`'s "P3a store + legacy-DOM dual-write" pattern used
// throughout that file for menuStatus/lobbyStatus/queue/paused/chatOpen)
// previously wrote ONLY to the legacy `ui.addChatLine()` DOM sink — there
// was no store half of that dual-write for chat content, so `?ui=react` had
// no source of truth to render from. This store is the additive store half
// (same shape of edit as p5a's `getUiInputs()` seam / useLobbyConfigStore /
// useSocialPrefsStore): `applyChat()`/`teardown()` gain ONE additive line
// each publishing into THIS store, alongside their existing (unchanged)
// `ui.addChatLine()`/`ui.clearChatLog()` calls — see those call sites for
// the exact diff.
//
// Ephemeral, NOT persisted (matches legacy: the DOM chat log is wiped on
// every leaveMatch/reset, never survives a reload).
import { create } from "zustand";
import { CFG } from "../config.js";

export interface ChatMessage {
  /** Monotonic id (not the network timestamp) — stable React key even if two
   * messages share the same `t`. */
  id: number;
  name: string;
  text: string;
  /** Packed 0xRRGGBB CFG.COLORS entry (three.js convention, same as
   * useHudStore/useRosterStore hand React) — ChatPanel converts to a CSS hex
   * string at render time, mirroring hudColor.ts/hexColor.ts's precedent of
   * each P5 sibling owning its own tiny `toHexColor` rather than sharing one
   * from ui/common (a data-formatting helper, not a visual primitive). */
  color: number;
  isSelf: boolean;
  /** Wall-clock ms when this line was ADDED locally (Date.now() at
   * addMessage() time, not the network relay's send timestamp) — ChatPanel's
   * per-line fade timer (mirrors ui.js's addChatLine `setTimeout(...,
   * CHAT_LINE_FADE_MS)` scheduled at DOM-append time) is relative to this. */
  t: number;
}

export interface ChatState {
  messages: ChatMessage[];
  addMessage(msg: Omit<ChatMessage, "id" | "t">): void;
  clear(): void;
}

let _nextId = 1;

export const useChatStore = create<ChatState>()((set, get) => ({
  messages: [],

  addMessage(msg) {
    // Mirrors ui.js's addChatLine auto-cap at CFG.SOCIAL.CHAT_LOG_MAX (8) —
    // drop the oldest line once the log exceeds it.
    const next = [...get().messages, { ...msg, id: _nextId++, t: Date.now() }];
    while (next.length > CFG.SOCIAL.CHAT_LOG_MAX) next.shift();
    set({ messages: next });
  },
  clear() {
    set({ messages: [] });
  },
}));
