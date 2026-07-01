// Local input collection (keyboard/mouse + touch). Produces an input object
// that gets sent to the host (or applied directly if we are the host).
import { CFG, SPELLS, SPELL_ORDER, ITEMS } from "./config.js";

export const SPELL_SLOT_HOTKEY_STORAGE_KEY = "vwb-spell-slot-hotkeys";
export const PTT_KEY_STORAGE_KEY = "vwb-ptt-key";

export function keyToCode(key) {
  const k = String(key || "").trim().toUpperCase();
  if (/^[0-9]$/.test(k)) return "Digit" + k;
  if (/^[A-Z]$/.test(k)) return "Key" + k;
  return null;
}

export function normalizeSpellSlotHotkeys(value) {
  const source = Array.isArray(value) ? value : [];
  return CFG.DEFAULT_SPELL_SLOT_HOTKEYS.map((fallback, i) => {
    const key = String(source[i] || fallback).trim().toUpperCase();
    return keyToCode(key) ? key : fallback;
  });
}

function loadSpellSlotHotkeys() {
  try {
    return normalizeSpellSlotHotkeys(JSON.parse(localStorage.getItem(SPELL_SLOT_HOTKEY_STORAGE_KEY) || "[]"));
  } catch {
    return normalizeSpellSlotHotkeys([]);
  }
}

// Push-to-talk key is stored as a raw KeyboardEvent.code (e.g. "Backquote"),
// not a single letter like the spell hotkeys, since the default binding is a
// non-spell key. A valid code is a non-empty alphanumeric identifier that
// isn't one of the reserved codes chat/menus/dialogs rely on (binding PTT to
// Escape/Enter/Tab/Space would silently break those), and isn't already a
// spell's cast key (binding PTT over e.g. KeyQ would silently make that
// spell uncastable, since the PTT branch in keydown returns before the cast
// logic runs).
const RESERVED_PTT_CODES = new Set(["Escape", "Enter", "Tab", "Space", "NumpadEnter"]);
const SPELL_HOTKEY_CODES = new Set(Object.keys(buildKeyMap()));
function isValidKeyCode(code) {
  return typeof code === "string" && /^[A-Za-z][A-Za-z0-9]*$/.test(code)
    && !RESERVED_PTT_CODES.has(code) && !SPELL_HOTKEY_CODES.has(code);
}

// Exported so the rebind-capture UI (ui.js) can reject reserved codes (and
// give feedback) before ever persisting/displaying them, instead of only
// failing silently deeper in setPttKey().
export function isValidPttKey(code) {
  return isValidKeyCode(code);
}

export function loadPttKey() {
  try {
    const stored = localStorage.getItem(PTT_KEY_STORAGE_KEY);
    return isValidKeyCode(stored) ? stored : CFG.SOCIAL.PTT_DEFAULT_KEY;
  } catch {
    return CFG.SOCIAL.PTT_DEFAULT_KEY;
  }
}

export function setPttKey(code) {
  if (!isValidKeyCode(code)) return false;
  try {
    localStorage.setItem(PTT_KEY_STORAGE_KEY, code);
  } catch {
    return false;
  }
  return true;
}

// Map keyboard codes to spell ids from the spellbook definition.
function buildKeyMap() {
  const map = {};
  for (const id of SPELL_ORDER) {
    const s = SPELLS[id];
    if (!s) continue;
    const code = keyToCode(s.key);
    if (code) map[code] = id;
  }
  return map;
}

export class InputController {
  constructor(renderer) {
    this.renderer = renderer;
    this.keys = {};
    this.mouseX = window.innerWidth / 2;
    this.mouseY = window.innerHeight / 2;
    this.seq = 0;
    this.castId = 0;
    this.pendingCasts = [];     // queued {id, spell, tx, tz} awaiting send
    this._castWindow = [];      // resend buffer: [{c, ttl}]
    this.keyMap = buildKeyMap();
    this.spellSlotHotkeys = loadSpellSlotHotkeys();
    this.spellSlots = Array(CFG.SPELL_SLOT_COUNT).fill(null);
    // Item slot bindings — active-item granted spells, keyed by item hotkey (7–0).
    this.itemSlotHotkeys = CFG.DEFAULT_ITEM_SLOT_HOTKEYS.slice();
    this.itemSlots = Array(CFG.ITEM_SLOT_COUNT).fill(null);
    this.touchMove = [0, 0];
    this.onCast = null;          // optional callback (e.g. resume audio)
    this.selectedSpell = "fireball"; // touch ability selection
    this.paused = false;         // when true (pause menu open) input is neutralized

    // ---- Social: chat gate, push-to-talk, auto-AFK idle detection ----
    this.chatting = false;        // chat box open -> gameplay keys + movement neutralized (mirrors this.paused)
    this.ptt = false;             // push-to-talk held
    this.onPtt = null;            // (on:bool)=>{} set by main.js
    this.onAfkChange = null;      // (idle:bool)=>{} set by main.js
    this._afkIdle = false;
    this._lastActivityAt = performance.now();
    this.pttKey = loadPttKey();   // localStorage vwb-ptt-key, default CFG.SOCIAL.PTT_DEFAULT_KEY

    this._bind();
  }

  _bind() {
    addEventListener("keydown", (e) => {
      this.keys[e.code] = true;
      // Push-to-talk is checked first and never fires while the chat box is
      // open (typing "`" etc. must not transmit voice).
      if (e.code === this.pttKey && !e.repeat && !this.chatting) {
        this.ptt = true;
        this.onPtt?.(true);
        this._activity();
        return;
      }
      // While the pause menu or chat box is open, swallow gameplay keys (no casts).
      if (this.paused || this.chatting) return;
      this._activity();
      if (e.code === "Space" && !e.repeat) this.queueCast(this.selectedSpell);
      // Ability hotkeys queue a cast at the current aim/target point.
      const spell = this.spellForCode(e.code);
      if (spell && !e.repeat) this.queueCast(spell);
    });
    addEventListener("keyup", (e) => {
      this.keys[e.code] = false;
      if (e.code === this.pttKey && this.ptt) {
        this.ptt = false;
        this.onPtt?.(false);
      }
    });
    addEventListener("mousemove", (e) => {
      this.mouseX = e.clientX;
      this.mouseY = e.clientY;
      this._activity();
    });
    addEventListener("mousedown", (e) => {
      if (this.paused || this.chatting) return;  // ignore clicks while paused/chatting
      this._activity();
      // LMB and RMB both cast the selected spell; LMB is the primary trigger.
      if (e.button === 0) this.queueCast(this.selectedSpell);
      if (e.button === 2) this.queueCast(this.selectedSpell);
    });
    addEventListener("contextmenu", (e) => e.preventDefault());

    this._bindTouch();
  }

  // Records real player activity; clears auto-AFK idle state and notifies main.js.
  _activity() {
    this._lastActivityAt = performance.now();
    if (this._afkIdle) {
      this._afkIdle = false;
      this.onAfkChange?.(false);
    }
  }

  // Public alias for main.js: call right after unpausing/closing chat so a
  // stale _lastActivityAt (frozen while paused/chatting, since sample() and
  // the keydown/mousedown gates never touch it) doesn't immediately re-trip
  // auto-AFK before the player does anything new.
  resetActivity() { this._activity(); }

  setSelectedSpell(id) { if (SPELLS[id]) this.selectedSpell = id; }

  setSpellSlots(slots = []) {
    this.spellSlots = Array.from({ length: CFG.SPELL_SLOT_COUNT }, (_, i) => slots[i] || null);
  }

  // Map equipped active-item keys → their granted spells for hotkey dispatch.
  // Passive items produce null so their slot is a no-op on keypress.
  setItemSlots(itemKeys = []) {
    this.itemSlots = Array.from({ length: CFG.ITEM_SLOT_COUNT }, (_, i) => itemKeys[i] || null);
  }

  setSpellSlotHotkey(index, key) {
    if (index < 0 || index >= CFG.SPELL_SLOT_COUNT) return false;
    const normalized = normalizeSpellSlotHotkeys(Object.assign([...this.spellSlotHotkeys], { [index]: key }));
    this.spellSlotHotkeys = normalized;
    localStorage.setItem(SPELL_SLOT_HOTKEY_STORAGE_KEY, JSON.stringify(normalized));
    return true;
  }

  spellForCode(code) {
    // Item slot hotkeys take priority only when an active item actually occupies
    // the slot. If the slot is empty or the item is passive, fall through to the
    // spell-slot lookup so direct spell hotkeys (e.g. Digit8 → meteor) still work.
    const itemSlot = this.itemSlotHotkeys.findIndex((key) => keyToCode(key) === code);
    if (itemSlot >= 0) {
      const itemKey = this.itemSlots[itemSlot];
      if (itemKey) {
        const it = ITEMS[itemKey];
        if (it?.kind === "active" && it.grantsSpell) return it.grantsSpell;
      }
      // Slot empty or passive item — do NOT return null; fall through below.
    }
    const slot = this.spellSlotHotkeys.findIndex((key) => keyToCode(key) === code);
    if (slot >= 0) return this.spellSlots[slot] || null;
    return this.keyMap[code];
  }

  // Queue a spell cast aimed at the current cursor's ground point.
  queueCast(spell) {
    if (!SPELLS[spell]) return;
    const pt = this.renderer.screenToPoint
      ? this.renderer.screenToPoint(this.mouseX, this.mouseY)
      : null;
    this.pendingCasts.push({
      id: ++this.castId,
      spell,
      tx: pt ? pt.x : NaN,
      tz: pt ? pt.z : NaN,
    });
    if (this.onCast) this.onCast(spell);
  }

  _bindTouch() {
    const joystick = document.getElementById("joystick");
    const knob = document.getElementById("joystick-knob");
    const fireBtn = document.getElementById("fire-btn");
    if (!joystick) return;

    let active = false, originX = 0, originY = 0;
    const radius = 50;

    const start = (e) => {
      active = true;
      const t = e.touches ? e.touches[0] : e;
      const rect = joystick.getBoundingClientRect();
      originX = rect.left + rect.width / 2;
      originY = rect.top + rect.height / 2;
      e.preventDefault();
    };
    const move = (e) => {
      if (!active) return;
      const t = e.touches ? e.touches[0] : e;
      let dx = t.clientX - originX;
      let dy = t.clientY - originY;
      const len = Math.hypot(dx, dy);
      if (len > radius) { dx = (dx / len) * radius; dy = (dy / len) * radius; }
      knob.style.transform = `translate(${dx}px, ${dy}px)`;
      this.touchMove = [dx / radius, dy / radius];
      e.preventDefault();
    };
    const end = (e) => {
      active = false;
      knob.style.transform = "translate(0,0)";
      this.touchMove = [0, 0];
    };

    joystick.addEventListener("touchstart", start, { passive: false });
    joystick.addEventListener("touchmove", move, { passive: false });
    joystick.addEventListener("touchend", end);

    fireBtn.addEventListener("touchstart", (e) => { this.queueCast(this.selectedSpell); e.preventDefault(); }, { passive: false });
  }

  // Build the current input snapshot to send/apply.
  sample() {
    const aimNow = this.renderer.screenToAim(this.mouseX, this.mouseY);
    // Paused or chatting: emit a neutral input so the warlock idles and no
    // queued cast fires, but keep the stream alive (seq still advances).
    if (this.paused || this.chatting) {
      this._castWindow = [];
      this.pendingCasts = [];
      return { move: [0, 0], aim: aimNow, seq: ++this.seq, casts: [] };
    }

    // Auto-AFK: flip to idle after CFG.SOCIAL.AFK_IDLE_MS with no real input.
    // _activity() (fired by keydown/mousemove/mousedown) clears it again.
    if (!this._afkIdle && performance.now() - this._lastActivityAt > CFG.SOCIAL.AFK_IDLE_MS) {
      this._afkIdle = true;
      this.onAfkChange?.(true);
    }

    let mx = 0, mz = 0;
    if (this.keys["KeyW"] || this.keys["ArrowUp"]) mz -= 1;
    if (this.keys["KeyS"] || this.keys["ArrowDown"]) mz += 1;
    if (this.keys["KeyA"] || this.keys["ArrowLeft"]) mx -= 1;
    if (this.keys["KeyD"] || this.keys["ArrowRight"]) mx += 1;

    // Touch joystick overrides if active.
    if (this.touchMove[0] !== 0 || this.touchMove[1] !== 0) {
      mx = this.touchMove[0];
      mz = this.touchMove[1];
    }

    const aim = this.renderer.screenToAim(this.mouseX, this.mouseY);

    // Move new casts into a short resend window. Input is sent unreliably, so we
    // include each cast in a few consecutive packets; the host dedupes by id.
    if (this.pendingCasts.length) {
      for (const c of this.pendingCasts) this._castWindow.push({ c, ttl: 4 });
      this.pendingCasts = [];
    }
    const casts = this._castWindow.map((e) => e.c);
    this._castWindow = this._castWindow.filter((e) => --e.ttl > 0);

    return { move: [mx, mz], aim, seq: ++this.seq, casts };
  }
}
