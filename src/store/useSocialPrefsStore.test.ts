// @vitest-environment jsdom
// Store-slice unit tests for useSocialPrefsStore (design §3) — defaults and
// persisted shape mirror ui.js's getSocialPrefs()/_setSocialPrefs() exactly
// (same vwb-social-prefs key, same merge-then-write semantics), plus the
// additive videoOn field round-tripping without disturbing the rest.
import { describe, it, expect, beforeEach, vi } from "vitest";
import { CFG } from "../config.js";

const SOCIAL_PREFS_KEY = "vwb-social-prefs";

async function freshStore() {
  vi.resetModules();
  const mod = await import("./useSocialPrefsStore");
  return mod.useSocialPrefsStore;
}

beforeEach(() => {
  localStorage.clear();
});

describe("useSocialPrefsStore", () => {
  it("defaults match ui.js's getSocialPrefs() defaults when no key is persisted yet", async () => {
    const useSocialPrefsStore = await freshStore();
    const s = useSocialPrefsStore.getState();
    expect(s.micEnabled).toBe(false);
    expect(s.masterVolume).toBe(1);
    expect(s.showBubbles).toBe(true);
    expect(s.videoOn).toBe(false);
    expect(s.pttKey).toBe(CFG.SOCIAL.PTT_DEFAULT_KEY);
  });

  it("a fresh store read picks up a previously persisted vwb-social-prefs blob", async () => {
    localStorage.setItem(SOCIAL_PREFS_KEY, JSON.stringify({ micEnabled: true, masterVolume: 0.4, showBubbles: false, pttKey: "KeyV" }));
    const useSocialPrefsStore = await freshStore();
    const s = useSocialPrefsStore.getState();
    expect(s.micEnabled).toBe(true);
    expect(s.masterVolume).toBe(0.4);
    expect(s.showBubbles).toBe(false);
    expect(s.pttKey).toBe("KeyV");
    expect(s.videoOn).toBe(false); // absent in the legacy-written blob -> safe default
  });

  it("each setter merges its patch into the SAME persisted key without disturbing sibling fields", async () => {
    const useSocialPrefsStore = await freshStore();
    useSocialPrefsStore.getState().setMicEnabled(true);
    useSocialPrefsStore.getState().setMasterVolume(0.6);

    const s = useSocialPrefsStore.getState();
    expect(s.micEnabled).toBe(true);
    expect(s.masterVolume).toBe(0.6);
    expect(s.showBubbles).toBe(true); // untouched

    const persisted = JSON.parse(localStorage.getItem(SOCIAL_PREFS_KEY) || "{}");
    expect(persisted).toEqual({
      micEnabled: true,
      masterVolume: 0.6,
      showBubbles: true,
      videoOn: false,
      pttKey: CFG.SOCIAL.PTT_DEFAULT_KEY,
    });
  });

  it("setVideoOn persists the additive field alongside the legacy-shaped fields", async () => {
    const useSocialPrefsStore = await freshStore();
    useSocialPrefsStore.getState().setVideoOn(true);
    expect(useSocialPrefsStore.getState().videoOn).toBe(true);
    const persisted = JSON.parse(localStorage.getItem(SOCIAL_PREFS_KEY) || "{}");
    expect(persisted.videoOn).toBe(true);
  });

  it("setShowBubbles(false) then a later unrelated setter does not resurrect showBubbles to the default", async () => {
    const useSocialPrefsStore = await freshStore();
    useSocialPrefsStore.getState().setShowBubbles(false);
    useSocialPrefsStore.getState().setMicEnabled(true);
    expect(useSocialPrefsStore.getState().showBubbles).toBe(false);
  });
});
