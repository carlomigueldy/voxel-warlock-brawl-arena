// First-run onboarding overlay — self-contained module (no ui.js/main.js
// imports either direction). Gates on localStorage['vwb-onboarded-v1'];
// shows once the loading screen is dismissed, walks the player through
// Name -> Character -> Goal -> Hotkeys, then writes the same localStorage
// keys the menu already reads and syncs the live menu UI to match.
import { CFG, SPELLS, SPELL_ORDER } from "./config.js";
import { FX } from "./fx.js";
import { menuCue } from "./audio.js";
import { keyToCode, normalizeSpellSlotHotkeys, SPELL_SLOT_HOTKEY_STORAGE_KEY } from "./input.js";

const ONBOARDED_KEY = "vwb-onboarded-v1";
const NAME_KEY = "vwb-name";
const CHARACTER_KEY = "vwb-character";
const RESERVED_CODES = new Set(["Escape", "Enter", "Tab", "Space", "NumpadEnter"]);
const HOTKEY_SPELL_IDS = SPELL_ORDER.slice(0, CFG.SPELL_SLOT_COUNT);
const STEP_COUNT = 4;

const $ = (id) => document.getElementById(id);

function loadHotkeys() {
  try {
    return normalizeSpellSlotHotkeys(JSON.parse(localStorage.getItem(SPELL_SLOT_HOTKEY_STORAGE_KEY) || "[]"));
  } catch {
    return normalizeSpellSlotHotkeys([]);
  }
}

function codeToKey(code) {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit[0-9]$/.test(code)) return code.slice(5);
  return null;
}

class Onboarding {
  constructor() {
    this.el = {
      root: $("onboarding"),
      rail: document.querySelectorAll("#onboarding .onboarding-rail-step"),
      steps: document.querySelectorAll("#onboarding .onboarding-step"),
      nameInput: $("onboarding-name-input"),
      charCards: $("onboarding-char-cards"),
      hotkeysWrap: $("onboarding-hotkeys"),
      hotkeysFeedback: $("onboarding-hotkeys-feedback"),
      hotkeysReset: $("onboarding-hotkeys-reset"),
      back: $("onboarding-back"),
      next: $("onboarding-next"),
      skip: $("onboarding-skip"),
    };
    if (!this.el.root) return;
    this.step = 0;
    this.character = CFG.CHARACTERS.some((c) => c.id === localStorage.getItem(CHARACTER_KEY))
      ? localStorage.getItem(CHARACTER_KEY)
      : CFG.DEFAULT_CHARACTER;
    this.hotkeys = loadHotkeys();
    this.capturingIndex = -1;
    this._captureHandler = null;
    this._bindStatic();
    this._buildCharCards();
    this._buildHotkeySlots();
  }

  // ---- static wiring ----

  _bindStatic() {
    this.el.nameInput?.addEventListener("input", () => {
      // No live persistence needed — read at completion time.
    });
    this.el.back.addEventListener("click", () => this.goBack());
    this.el.next.addEventListener("click", () => this.goNext());
    this.el.skip.addEventListener("click", () => this.finish({ skipped: true }));
    this.el.hotkeysReset.addEventListener("click", () => this._resetHotkeys());
    this.el.root.addEventListener("keydown", (e) => this._onKeydown(e));
  }

  _onKeydown(e) {
    if (this.capturingIndex >= 0) return; // let the capture listener handle it
    if (e.key === "Escape") {
      e.preventDefault();
      this.finish({ skipped: true });
      return;
    }
    const inTextField = e.target && e.target.tagName === "INPUT";
    if (e.key === "Enter" && !e.target.closest(".onboarding-hotkey-chip")) {
      e.preventDefault();
      this.goNext();
      return;
    }
    if (inTextField) return;
    if (e.key === "ArrowRight") { e.preventDefault(); this.goNext(); }
    else if (e.key === "ArrowLeft") { e.preventDefault(); this.goBack(); }
  }

  _buildCharCards() {
    const host = this.el.charCards;
    if (!host) return;
    host.replaceChildren();
    for (const ch of CFG.CHARACTERS) {
      const card = document.createElement("button");
      card.type = "button";
      card.className = "char-card";
      card.dataset.character = ch.id;
      card.setAttribute("role", "radio");
      card.style.setProperty("--char-color", "#" + ch.color.toString(16).padStart(6, "0"));
      const swatch = document.createElement("span");
      swatch.className = "char-card-swatch";
      const nameEl = document.createElement("span");
      nameEl.className = "char-card-name";
      nameEl.textContent = ch.name;
      const blurbEl = document.createElement("span");
      blurbEl.className = "char-card-blurb";
      blurbEl.textContent = ch.blurb;
      const check = document.createElement("span");
      check.className = "char-card-check";
      check.setAttribute("aria-hidden", "true");
      check.textContent = "✓";
      card.append(swatch, nameEl, blurbEl, check);
      card.addEventListener("click", () => this._selectCharacter(ch.id));
      host.appendChild(card);
    }
    this._highlightCharacter();
  }

  _selectCharacter(id) {
    this.character = id;
    this._highlightCharacter();
    window.__vwbPreview?.select(id);
    menuCue("hover");
  }

  _highlightCharacter() {
    if (!this.el.charCards) return;
    for (const card of this.el.charCards.children) {
      const on = card.dataset.character === this.character;
      card.classList.toggle("is-active", on);
      card.setAttribute("aria-checked", String(on));
    }
  }

  _buildHotkeySlots() {
    const host = this.el.hotkeysWrap;
    if (!host) return;
    host.replaceChildren();
    HOTKEY_SPELL_IDS.forEach((spellId, i) => {
      const spell = SPELLS[spellId];
      const row = document.createElement("div");
      row.className = "onboarding-hotkey-slot";
      const label = document.createElement("span");
      label.className = "onboarding-hotkey-name";
      label.textContent = spell ? spell.name : `Slot ${i + 1}`;
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "onboarding-hotkey-chip";
      chip.dataset.index = String(i);
      chip.setAttribute("aria-label", `Rebind ${spell ? spell.name : "slot " + (i + 1)} hotkey`);
      chip.textContent = this.hotkeys[i];
      chip.addEventListener("click", () => this._beginCapture(i));
      row.append(label, chip);
      host.appendChild(row);
    });
  }

  _chipFor(index) {
    return this.el.hotkeysWrap?.querySelector(`.onboarding-hotkey-chip[data-index="${index}"]`) || null;
  }

  _feedback(msg) {
    if (this.el.hotkeysFeedback) this.el.hotkeysFeedback.textContent = msg || "";
  }

  _beginCapture(index) {
    this._cancelCapture();
    this.capturingIndex = index;
    const chip = this._chipFor(index);
    if (chip) { chip.classList.add("is-capturing"); chip.textContent = "…"; }
    this._feedback("Press a key…");
    this._captureHandler = (e) => {
      e.preventDefault();
      e.stopPropagation();
      this._handleCaptureKey(index, e);
    };
    document.addEventListener("keydown", this._captureHandler, true);
  }

  _cancelCapture() {
    if (this.capturingIndex < 0) return;
    const chip = this._chipFor(this.capturingIndex);
    if (chip) { chip.classList.remove("is-capturing"); chip.textContent = this.hotkeys[this.capturingIndex]; }
    if (this._captureHandler) document.removeEventListener("keydown", this._captureHandler, true);
    this._captureHandler = null;
    this.capturingIndex = -1;
  }

  _handleCaptureKey(index, e) {
    if (RESERVED_CODES.has(e.code)) {
      this._feedback("That key is reserved — pick another.");
      this._cancelCapture();
      return;
    }
    const key = codeToKey(e.code);
    if (!key || !keyToCode(key)) {
      this._feedback("Use a letter or number key.");
      this._cancelCapture();
      return;
    }
    if (this.hotkeys.some((k, i) => i !== index && k === key)) {
      this._feedback(`${key} is already bound to another spell.`);
      this._cancelCapture();
      return;
    }
    this.hotkeys[index] = key;
    this._persistHotkeys();
    this._cancelCapture();
    this._feedback("");
    menuCue("confirm");
  }

  _resetHotkeys() {
    this._cancelCapture();
    this.hotkeys = normalizeSpellSlotHotkeys([]);
    this._persistHotkeys();
    this._buildHotkeySlots();
    this._feedback("Reset to defaults.");
    menuCue("back");
  }

  _persistHotkeys() {
    const normalized = normalizeSpellSlotHotkeys(this.hotkeys);
    this.hotkeys = normalized;
    try { localStorage.setItem(SPELL_SLOT_HOTKEY_STORAGE_KEY, JSON.stringify(normalized)); } catch {}
    HOTKEY_SPELL_IDS.forEach((_, i) => {
      const chip = this._chipFor(i);
      if (chip) chip.textContent = normalized[i];
    });
  }

  // ---- step machine ----

  open() {
    this.step = 0;
    this._cancelCapture();
    if (this.el.nameInput) this.el.nameInput.value = localStorage.getItem(NAME_KEY) || "";
    this.el.root.classList.remove("hidden");
    window.__vwbPreview?.start?.();
    window.__vwbPreview?.select(this.character);
    this._render();
  }

  goNext() {
    if (this.step >= STEP_COUNT - 1) { this.finish({ skipped: false }); return; }
    this.step++;
    menuCue("hover");
    this._render();
  }

  goBack() {
    if (this.step <= 0) return;
    this.step--;
    menuCue("back");
    this._render();
  }

  _render() {
    this.el.rail.forEach((li) => {
      const s = Number(li.dataset.step);
      li.classList.toggle("is-active", s === this.step);
      li.classList.toggle("is-done", s < this.step);
      if (s === this.step) li.setAttribute("aria-current", "step");
      else li.removeAttribute("aria-current");
    });
    this.el.steps.forEach((sec) => {
      const s = Number(sec.dataset.step);
      const on = s === this.step;
      sec.classList.toggle("is-active", on);
      sec.setAttribute("aria-hidden", on ? "false" : "true");
    });
    this.el.back.disabled = this.step === 0;
    const label = this.el.next.querySelector(".btn-label");
    if (label) label.textContent = this.step === STEP_COUNT - 1 ? "Enter the Arena" : "Next";
    const focusTarget = this.step === 0
      ? this.el.nameInput
      : this.step === 1
        ? this.el.charCards?.querySelector(".char-card.is-active") || this.el.charCards?.firstElementChild
        : this.el.next;
    focusTarget?.focus?.();
  }

  finish({ skipped }) {
    this._cancelCapture();
    const name = (this.el.nameInput?.value || "").trim().slice(0, 14);
    try {
      localStorage.setItem(NAME_KEY, name);
      localStorage.setItem(CHARACTER_KEY, this.character);
      localStorage.setItem(ONBOARDED_KEY, "1");
    } catch {}

    // Sync the live menu: setting the input directly covers _name() reads at
    // play time; clicking the matching menu char-card routes through UI's own
    // _selectCharacter so its in-memory state + preview + localStorage agree.
    const menuNameInput = $("name-input");
    if (menuNameInput) menuNameInput.value = name;
    const menuCard = document.querySelector(`#char-cards .char-card[data-character="${this.character}"]`);
    menuCard?.click();
    window.__vwbPreview?.select(this.character);

    menuCue(skipped ? "back" : "confirm");
    if (!FX.reducedMotion) {
      FX.flash("rgba(108,76,255,0.35)", 200);
    }
    const hide = () => this.el.root.classList.add("hidden");
    if (FX.reducedMotion) hide();
    else setTimeout(hide, 220);
  }
}

let instance = null;

function boot() {
  instance = new Onboarding();
  if (!instance.el.root) return;

  const alreadyOnboarded = (() => {
    try { return localStorage.getItem(ONBOARDED_KEY) === "1"; } catch { return true; }
  })();

  const loader = $("loader");
  const openWhenReady = () => instance.open();

  if (alreadyOnboarded) {
    // Nothing to do — overlay stays hidden until a manual replay.
  } else if (!loader || loader.classList.contains("hidden")) {
    openWhenReady();
  } else {
    const obs = new MutationObserver(() => {
      if (loader.classList.contains("hidden")) {
        obs.disconnect();
        openWhenReady();
      }
    });
    obs.observe(loader, { attributes: true, attributeFilter: ["class"] });
  }

  window.Onboarding = { open: () => instance.open() };
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot, { once: true });
} else {
  boot();
}
