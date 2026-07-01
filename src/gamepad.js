// Gamepad navigation for menus (+ Start→pause hook in-match). Self-contained
// rAF poll loop. Translates controller input into synthetic keyboard events
// (arrows / Enter / Escape) so every existing handler — the spine nav, tutorial
// tabs, and the main.js pause toggle — Just Works without editing any other
// file. Events are dispatched on document.activeElement so element-level
// listeners (e.g. .tut-tab keydown) catch them and they still bubble to
// document/window for global handlers. A paired keyup prevents the keystroke
// state in input.js from sticking when a match starts.
import { FX } from "./fx.js";
import { menuCue } from "./audio.js";

const DEADZONE = 0.4;
const REPEAT_MS = 180;
const BTN_A = 0;        // confirm
const BTN_B = 1;        // back
const BTN_START = 9;    // pause / primary
const BTN_DPAD_UP = 12, BTN_DPAD_DOWN = 13, BTN_DPAD_LEFT = 14, BTN_DPAD_RIGHT = 15;

const STYLE_TEXT = `
html.gamepad-active :focus-visible{
  outline:3px solid var(--ember,#ff5a3c);
  outline-offset:3px;
}
.gamepad-toast{
  position:fixed; left:50%; bottom:7%;
  transform:translate(-50%,0);
  background:var(--panel,#1c1430); color:var(--ember,#ff5a3c);
  border:1px solid rgba(255,90,60,.5); border-radius:8px;
  padding:8px 14px; font-size:13px; font-weight:600;
  opacity:0; transition:opacity .2s ease; pointer-events:none; z-index:9999;
  box-shadow:0 4px 18px rgba(0,0,0,.5);
}
.gamepad-toast.is-visible{ opacity:1; }
@media (prefers-reduced-motion:reduce){
  .gamepad-toast{ transition:none; }
}
`;

let initialized = false;
let rafId = null;
let prevButtons = Object.create(null);
let lastMove = 0;
let wasMoving = false;
let toastTimer = null;

function injectStyle() {
  if (document.getElementById("gamepad-style")) return;
  const s = document.createElement("style");
  s.id = "gamepad-style";
  s.textContent = STYLE_TEXT;
  document.head.appendChild(s);
}

function setActive(on) {
  document.documentElement.classList.toggle("gamepad-active", on);
}

function toast(msg) {
  // No non-essential visual FX under reduced motion; navigation still works.
  if (FX.reducedMotion) return;
  let el = document.querySelector(".gamepad-toast");
  if (!el) {
    el = document.createElement("div");
    el.className = "gamepad-toast";
    el.setAttribute("role", "status");
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.classList.add("is-visible");
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.classList.remove("is-visible"); }, 1800);
}

function fireKey(key, code, target) {
  const t = target || document.activeElement || document.body;
  const opts = { key, code, bubbles: true, cancelable: true };
  const kd = new KeyboardEvent("keydown", opts);
  t.dispatchEvent(kd);
  // Paired keyup keeps window-level keystroke state (input.js) from sticking.
  t.dispatchEvent(new KeyboardEvent("keyup", opts));
  return kd;
}

function activate() {
  const t = document.activeElement;
  if (!t || t === document.body || t === document.documentElement) return;
  const kd = fireKey("Enter", "Enter", t);
  // Mirror native Enter activation for focusable controls; honour preventDefault.
  if (!kd.defaultPrevented && typeof t.matches === "function" &&
      t.matches("button, a[href], [role='button'], summary")) {
    t.click();
  }
  menuCue("confirm");
}

function back() {
  fireKey("Escape", "Escape");
  menuCue("back");
}

function inMatch() {
  const hud = document.getElementById("hud");
  return !!hud && !hud.classList.contains("hidden");
}

function startButton() {
  if (inMatch()) fireKey("Escape", "Escape");  // toggle pause (main.js owns it)
  else activate();                              // primary action
}

function readDirection(gp) {
  let x = 0, y = 0;
  const lx = gp.axes[0] || 0;
  const ly = gp.axes[1] || 0;
  if (lx > DEADZONE) x = 1; else if (lx < -DEADZONE) x = -1;
  if (ly > DEADZONE) y = 1; else if (ly < -DEADZONE) y = -1;
  if (gp.buttons[BTN_DPAD_UP]?.pressed) y = -1;
  if (gp.buttons[BTN_DPAD_DOWN]?.pressed) y = 1;
  if (gp.buttons[BTN_DPAD_LEFT]?.pressed) x = -1;
  if (gp.buttons[BTN_DPAD_RIGHT]?.pressed) x = 1;
  return { x, y };
}

function moveOnce(x, y) {
  // Cardinal-only: pick the dominant axis so diagonals don't double-move.
  if (Math.abs(y) >= Math.abs(x)) {
    if (y < 0) fireKey("ArrowUp", "ArrowUp");
    else if (y > 0) fireKey("ArrowDown", "ArrowDown");
  } else {
    if (x < 0) fireKey("ArrowLeft", "ArrowLeft");
    else if (x > 0) fireKey("ArrowRight", "ArrowRight");
  }
}

function firstPad() {
  if (!navigator.getGamepads) return null;
  for (const p of navigator.getGamepads()) if (p) return p;
  return null;
}

function poll() {
  const gp = firstPad();
  if (!gp) { stopPoll(); return; }
  const now = performance.now();
  const { x, y } = readDirection(gp);
  if (x || y) {
    if (!wasMoving) { moveOnce(x, y); lastMove = now; wasMoving = true; }
    else if (now - lastMove >= REPEAT_MS) { moveOnce(x, y); lastMove = now; }
  } else {
    wasMoving = false;
  }
  for (const idx of [BTN_A, BTN_B, BTN_START]) {
    const pressed = !!gp.buttons[idx] && gp.buttons[idx].pressed;
    if (pressed && !prevButtons[idx]) {
      if (idx === BTN_A) activate();
      else if (idx === BTN_B) back();
      else startButton();
    }
    prevButtons[idx] = pressed;
  }
  rafId = requestAnimationFrame(poll);
}

function startPoll() {
  if (rafId !== null) return;
  rafId = requestAnimationFrame(poll);
}

function stopPoll() {
  if (rafId !== null) cancelAnimationFrame(rafId);
  rafId = null;
  prevButtons = Object.create(null);
  wasMoving = false;
}

function onConnect() {
  setActive(true);
  toast("Controller connected");
  startPoll();
}

function onDisconnect() {
  if (!firstPad()) { setActive(false); stopPoll(); }
}

export function initGamepad() {
  if (initialized) return;
  initialized = true;
  if (typeof window === "undefined" || !navigator) return;
  injectStyle();
  window.addEventListener("gamepadconnected", onConnect);
  window.addEventListener("gamepaddisconnected", onDisconnect);
  // Pick up a gamepad that was already connected before the listener was wired.
  if (firstPad()) { setActive(true); startPoll(); }
}

if (typeof window !== "undefined") initGamepad();
