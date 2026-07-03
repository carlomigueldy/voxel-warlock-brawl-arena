// Persisted settings — a thin reactive mirror over the EXISTING canonical
// single-writer helpers (region.ts / input.ts), NOT a new source of truth.
// Deliberately NO Zustand persist middleware: persistence already exists
// (each key below has one writer, unchanged from before P3a) — a persist
// envelope here would just be a second, competing serialization of the same
// localStorage keys. See design §7 invariant (4) / §10 risk 3.
//
// Frozen key/format list (design §3.5) — 8 exact legacy keys:
//   vwb-onboarded-v1  raw "1"                    (onboarding.js)
//   vwb-name          raw string                 (ui.js)
//   vwb-character     raw string                 (ui.js)
//   vwb-region        raw string                 (region.ts)
//   vwb-spell-slot-hotkeys  JSON string[]         (input.ts)
//   vwb-item-slot-hotkeys   JSON string[]         (input.ts / config.ts key)
//   vwb-ptt-key        raw KeyboardEvent.code     (input.ts)
//   vwb-mute-list      JSON {peers,users}         (social.ts)
// The 8th key (vwb-mute-list) is owned end-to-end by src/social.ts
// (toggleMute/setMuted/clearMuteList, already covered by test/social.test.mjs)
// and routed directly from wireLegacyUiToStores — it is intentionally NOT a
// field on this store; the frozen SettingsState interface below (design
// §3.5) only carries the 7 keys that have a corresponding reactive setting.
//
// Region note: region.ts's own read path (getRegion()) is async (checks a
// localStorage override, then falls back to a Supabase geo edge function),
// so it cannot supply this store's synchronous initial value. Rather than
// add a new sync export to region.ts (P3a's only additive P2 edit is
// input.ts's InputRenderer export — see brief), this store reads the same
// localStorage override region.ts itself checks first, directly.
//
// Spell/item hotkey note (deviation from design §3.5's literal "via
// InputController" wording): this store reimplements the normalize+write
// step against the SAME exported pure helpers/storage-key constants
// input.ts's own InputController.setSpellSlotHotkey/setItemSlotHotkey use,
// rather than calling those instance methods on the registry's live
// InputController. Reason: importing the registry here would pull in
// renderer.js/ui.js/preview.js (Three.js, DOM-heavy construction) just to
// persist a string array, working against "store modules stay lightweight
// and unit-testable in isolation." wireLegacyUiToStores.tsx — which already
// depends on the registry for other reasons — is the single place that also
// mirrors a successful setter's result into the live InputController's
// `spellSlotHotkeys`/`itemSlotHotkeys` fields, so runtime cast dispatch and
// persisted state can never observe different values.
import { create } from "zustand";
import { CFG } from "../config.js";
import { setRegion as persistRegion } from "../region.js";
import {
  loadPttKey,
  setPttKey as persistPttKey,
  normalizeSpellSlotHotkeys,
  normalizeItemSlotHotkeys,
  SPELL_SLOT_HOTKEY_STORAGE_KEY,
} from "../input.js";
import { ITEM_SLOT_HOTKEY_STORAGE_KEY } from "../config.js";

const NAME_KEY = "vwb-name";
const CHARACTER_KEY = "vwb-character";
const ONBOARDED_KEY = "vwb-onboarded-v1";
const REGION_KEY = "vwb-region"; // mirrors region.ts's own STORAGE_KEY (not exported there)

function readRaw(key: string): string {
  try {
    return localStorage.getItem(key) || "";
  } catch {
    return "";
  }
}

function writeRaw(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Ignore storage errors (private browsing, quota, ...) — matches every
    // other single-writer helper in this codebase (region.ts, social.ts, ...).
  }
}

function loadSpellSlotHotkeys(): string[] {
  try {
    return normalizeSpellSlotHotkeys(JSON.parse(localStorage.getItem(SPELL_SLOT_HOTKEY_STORAGE_KEY) || "[]"));
  } catch {
    return normalizeSpellSlotHotkeys([]);
  }
}

function loadItemSlotHotkeys(): string[] {
  try {
    return normalizeItemSlotHotkeys(JSON.parse(localStorage.getItem(ITEM_SLOT_HOTKEY_STORAGE_KEY) || "[]"));
  } catch {
    return normalizeItemSlotHotkeys([]);
  }
}

export interface SettingsState {
  name: string;
  character: string;
  region: string;
  onboarded: boolean;
  spellSlotHotkeys: string[];
  itemSlotHotkeys: string[];
  pttKey: string;

  setName(v: string): void;
  setCharacter(v: string): void;
  setRegion(v: string): void;
  setOnboarded(v: boolean): void;
  setPttKey(code: string): boolean;
  setSpellSlotHotkey(i: number, key: string): void;
  setItemSlotHotkey(i: number, key: string): void;
}

export const useSettingsStore = create<SettingsState>()((set, get) => ({
  name: readRaw(NAME_KEY),
  character: readRaw(CHARACTER_KEY) || CFG.DEFAULT_CHARACTER,
  region: readRaw(REGION_KEY),
  onboarded: readRaw(ONBOARDED_KEY) === "1",
  spellSlotHotkeys: loadSpellSlotHotkeys(),
  itemSlotHotkeys: loadItemSlotHotkeys(),
  pttKey: loadPttKey(),

  setName(name) {
    writeRaw(NAME_KEY, name);
    set({ name });
  },
  setCharacter(character) {
    writeRaw(CHARACTER_KEY, character);
    set({ character });
  },
  setRegion(region) {
    persistRegion(region);
    set({ region });
  },
  setOnboarded(onboarded) {
    writeRaw(ONBOARDED_KEY, onboarded ? "1" : "");
    set({ onboarded });
  },
  setPttKey(code) {
    if (!persistPttKey(code)) return false;
    set({ pttKey: code });
    return true;
  },
  setSpellSlotHotkey(index, key) {
    const normalized = normalizeSpellSlotHotkeys(
      Object.assign([...get().spellSlotHotkeys], { [index]: key }),
    );
    writeRaw(SPELL_SLOT_HOTKEY_STORAGE_KEY, JSON.stringify(normalized));
    set({ spellSlotHotkeys: normalized });
  },
  setItemSlotHotkey(index, key) {
    const normalized = normalizeItemSlotHotkeys(
      Object.assign([...get().itemSlotHotkeys], { [index]: key }),
    );
    writeRaw(ITEM_SLOT_HOTKEY_STORAGE_KEY, JSON.stringify(normalized));
    set({ itemSlotHotkeys: normalized });
  },
}));
