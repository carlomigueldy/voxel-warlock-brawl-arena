// Store-slice unit tests for useChatStore (design §9 p5-pause-chat) — the
// additive store half of applyChat()/teardown()'s existing legacy-DOM dual
// write (see useChatStore.ts's header + useGameSession.ts's applyChat/teardown).
import { describe, it, expect, beforeEach } from "vitest";
import { useChatStore } from "./useChatStore";
import { CFG } from "../config.js";

beforeEach(() => {
  useChatStore.getState().clear();
});

describe("useChatStore", () => {
  it("starts empty", () => {
    expect(useChatStore.getState().messages).toEqual([]);
  });

  it("addMessage appends with a stable monotonic id", () => {
    useChatStore.getState().addMessage({ name: "Ada", text: "hi", color: 0xff5a3c, isSelf: false });
    useChatStore.getState().addMessage({ name: "Bea", text: "yo", color: 0x4cc9ff, isSelf: true });
    const { messages } = useChatStore.getState();
    expect(messages).toHaveLength(2);
    expect(messages[0]).toMatchObject({ name: "Ada", text: "hi", isSelf: false });
    expect(messages[1]).toMatchObject({ name: "Bea", text: "yo", isSelf: true });
    expect(messages[1].id).not.toBe(messages[0].id);
  });

  it("caps the log at CFG.SOCIAL.CHAT_LOG_MAX, dropping the oldest line first", () => {
    for (let i = 0; i < CFG.SOCIAL.CHAT_LOG_MAX + 3; i++) {
      useChatStore.getState().addMessage({ name: "P", text: `msg ${i}`, color: 0xffffff, isSelf: false });
    }
    const { messages } = useChatStore.getState();
    expect(messages).toHaveLength(CFG.SOCIAL.CHAT_LOG_MAX);
    expect(messages[0].text).toBe(`msg 3`); // the first 3 were evicted
    expect(messages.at(-1)!.text).toBe(`msg ${CFG.SOCIAL.CHAT_LOG_MAX + 2}`);
  });

  it("clear() wipes the log", () => {
    useChatStore.getState().addMessage({ name: "Ada", text: "hi", color: 0xff5a3c, isSelf: false });
    useChatStore.getState().clear();
    expect(useChatStore.getState().messages).toEqual([]);
  });
});
