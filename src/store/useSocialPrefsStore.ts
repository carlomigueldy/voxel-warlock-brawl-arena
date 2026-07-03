// Reactive home for social/voice prefs `useGameSession` reads via
// `ui.getSocialPrefs()` under `?ui=legacy` (design §3 — the P5a store
// extension additive to P3a). Under `?ui=react`, getUiInputs()
// (src/loop/getUiInputs.ts) reads THIS store instead.
//
// Single-writer over the SAME `vwb-social-prefs` localStorage key legacy
// `ui.js`'s `getSocialPrefs()`/`_setSocialPrefs()` already own — design §0's
// "4 keys NOT yet on a store" list calls this one out by name ("social
// volume/video"). No dual-writer hazard: `?ui=legacy` and `?ui=react` are
// mutually exclusive per session (one flag value), so exactly one of this
// store or ui.js ever writes the key in a given session — same invariant
// useSettingsStore's header documents for its 7 keys. Deliberately NO
// Zustand persist middleware, for the same reason: this store reimplements
// the read/merge/write step directly against the key rather than adding a
// second, competing serialization on top of an existing single-writer key.
//
// `videoOn` has no legacy DOM equivalent (voice-only in ui=legacy) — it's an
// additive field for a future video-call affordance a P5 sibling may wire
// up. It round-trips through the SAME persisted JSON so a reload doesn't
// lose it, but its absence in an existing `vwb-social-prefs` blob (written
// before this field existed) safely defaults to `false`.
import { create } from "zustand";
import { CFG } from "../config.js";

const SOCIAL_PREFS_KEY = "vwb-social-prefs";

export interface SocialPrefsState {
  micEnabled: boolean;
  masterVolume: number;
  showBubbles: boolean;
  videoOn: boolean;
  pttKey: string;

  setMicEnabled(v: boolean): void;
  setMasterVolume(v: number): void;
  setShowBubbles(v: boolean): void;
  setVideoOn(v: boolean): void;
}

interface PersistedSocialPrefs {
  micEnabled?: boolean;
  masterVolume?: number;
  showBubbles?: boolean;
  videoOn?: boolean;
  pttKey?: string;
}

function readPersisted(): PersistedSocialPrefs {
  try {
    return JSON.parse(localStorage.getItem(SOCIAL_PREFS_KEY) || "{}");
  } catch {
    return {};
  }
}

// Mirrors ui.js's getSocialPrefs() defaults exactly (pttKey stays
// read-only here — src/input.ts's InputController owns rebinding it via
// useSettingsStore.setPttKey, this store only round-trips the current value
// through the same JSON blob so a react-mode write never clobbers it).
function withDefaults(saved: PersistedSocialPrefs): Required<PersistedSocialPrefs> {
  return {
    micEnabled: !!saved.micEnabled,
    masterVolume: typeof saved.masterVolume === "number" ? saved.masterVolume : 1,
    showBubbles: saved.showBubbles !== false,
    videoOn: !!saved.videoOn,
    pttKey: saved.pttKey || CFG.SOCIAL.PTT_DEFAULT_KEY,
  };
}

function persist(patch: Partial<PersistedSocialPrefs>): Required<PersistedSocialPrefs> {
  const next = { ...withDefaults(readPersisted()), ...patch };
  try {
    localStorage.setItem(SOCIAL_PREFS_KEY, JSON.stringify(next));
  } catch {
    // Ignore storage errors (private browsing, quota, ...) — matches every
    // other single-writer helper in this codebase.
  }
  return next;
}

export const useSocialPrefsStore = create<SocialPrefsState>()((set) => ({
  ...withDefaults(readPersisted()),

  setMicEnabled(micEnabled) {
    set(persist({ micEnabled }));
  },
  setMasterVolume(masterVolume) {
    set(persist({ masterVolume }));
  },
  setShowBubbles(showBubbles) {
    set(persist({ showBubbles }));
  },
  setVideoOn(videoOn) {
    set(persist({ videoOn }));
  },
}));
