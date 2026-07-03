// React port of src/gamepad.js (design §9a #168) — a rAF poll loop over
// navigator.getGamepads() translating D-pad/stick input into synthetic
// keyboard events dispatched at document.activeElement, so every existing
// keyboard handler (nav-feel's arrow nav, Modal's Escape-to-close, the
// in-match pause toggle) Just Works without this hook knowing anything about
// them. Only the toast + the `gamepad-active` focus-ring class are new
// surface area; legacy's `document.createElement("style")` injection for
// that class's CSS lives in Juice.module.css's `:global()` block instead.
import { useEffect, useRef, useState } from "react";
import { useSessionStore } from "../../store/useSessionStore";
import { FX } from "../../hooks/useFx";
import { menuCue } from "../../audio";

const DEADZONE = 0.4;
const REPEAT_MS = 180;
const BTN_A = 0; // confirm
const BTN_B = 1; // back
const BTN_START = 9; // pause / primary
const BTN_DPAD_UP = 12;
const BTN_DPAD_DOWN = 13;
const BTN_DPAD_LEFT = 14;
const BTN_DPAD_RIGHT = 15;
const TOAST_MS = 1800;

function fireKey(key: string, target?: Element | null): KeyboardEvent {
  const t = target ?? document.activeElement ?? document.body;
  const opts: KeyboardEventInit = { key, code: key, bubbles: true, cancelable: true };
  const kd = new KeyboardEvent("keydown", opts);
  t.dispatchEvent(kd);
  // Paired keyup keeps any window-level "is this key held" state from sticking.
  t.dispatchEvent(new KeyboardEvent("keyup", opts));
  return kd;
}

function activate(): void {
  const t = document.activeElement;
  if (!t || t === document.body || t === document.documentElement) return;
  const kd = fireKey("Enter", t);
  // Synthetic KeyboardEvents don't trigger a real click on buttons/links —
  // mirror the browser's native Enter-activates-button behavior explicitly.
  if (!kd.defaultPrevented && t instanceof HTMLElement && t.matches("button, a[href], [role='button'], summary")) {
    t.click();
  }
  menuCue("confirm");
}

function back(): void {
  fireKey("Escape");
  menuCue("back");
}

function readDirection(gp: Gamepad): { x: number; y: number } {
  let x = 0;
  let y = 0;
  const lx = gp.axes[0] ?? 0;
  const ly = gp.axes[1] ?? 0;
  if (lx > DEADZONE) x = 1;
  else if (lx < -DEADZONE) x = -1;
  if (ly > DEADZONE) y = 1;
  else if (ly < -DEADZONE) y = -1;
  if (gp.buttons[BTN_DPAD_UP]?.pressed) y = -1;
  if (gp.buttons[BTN_DPAD_DOWN]?.pressed) y = 1;
  if (gp.buttons[BTN_DPAD_LEFT]?.pressed) x = -1;
  if (gp.buttons[BTN_DPAD_RIGHT]?.pressed) x = 1;
  return { x, y };
}

function moveOnce(x: number, y: number): void {
  // Cardinal-only: pick the dominant axis so diagonals don't double-move.
  if (Math.abs(y) >= Math.abs(x)) {
    if (y < 0) fireKey("ArrowUp");
    else if (y > 0) fireKey("ArrowDown");
  } else {
    if (x < 0) fireKey("ArrowLeft");
    else if (x > 0) fireKey("ArrowRight");
  }
}

function firstPad(): Gamepad | null {
  if (typeof navigator === "undefined" || !navigator.getGamepads) return null;
  for (const p of navigator.getGamepads()) if (p) return p;
  return null;
}

export interface GamepadState {
  /** Non-null while the "Controller connected" toast should render. */
  toast: string | null;
}

export function useGamepad(): GamepadState {
  const inGame = useSessionStore((s) => s.screen === "game");
  const inGameRef = useRef(inGame);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    inGameRef.current = inGame;
  }, [inGame]);

  useEffect(() => {
    if (typeof window === "undefined" || typeof navigator === "undefined" || !navigator.getGamepads) return;

    let rafId: number | null = null;
    let toastTimer: ReturnType<typeof setTimeout> | null = null;
    const prevButtons: Record<number, boolean> = {};
    let lastMove = 0;
    let wasMoving = false;

    function setActive(on: boolean): void {
      document.documentElement.classList.toggle("gamepad-active", on);
    }

    function showToast(msg: string): void {
      // No non-essential visual FX under reduced motion; navigation still works.
      if (FX.reducedMotion) return;
      setToast(msg);
      if (toastTimer) clearTimeout(toastTimer);
      toastTimer = setTimeout(() => setToast(null), TOAST_MS);
    }

    function startButton(): void {
      if (inGameRef.current) fireKey("Escape"); // toggle pause (PauseMenu owns it)
      else activate(); // primary action
    }

    function stopPoll(): void {
      if (rafId !== null) cancelAnimationFrame(rafId);
      rafId = null;
      wasMoving = false;
    }

    function poll(): void {
      const gp = firstPad();
      if (!gp) {
        stopPoll();
        return;
      }
      const now = performance.now();
      const { x, y } = readDirection(gp);
      if (x || y) {
        if (!wasMoving) {
          moveOnce(x, y);
          lastMove = now;
          wasMoving = true;
        } else if (now - lastMove >= REPEAT_MS) {
          moveOnce(x, y);
          lastMove = now;
        }
      } else {
        wasMoving = false;
      }
      for (const idx of [BTN_A, BTN_B, BTN_START]) {
        const pressed = !!gp.buttons[idx]?.pressed;
        if (pressed && !prevButtons[idx]) {
          if (idx === BTN_A) activate();
          else if (idx === BTN_B) back();
          else startButton();
        }
        prevButtons[idx] = pressed;
      }
      rafId = requestAnimationFrame(poll);
    }

    function startPoll(): void {
      if (rafId !== null) return;
      rafId = requestAnimationFrame(poll);
    }

    function onConnect(): void {
      setActive(true);
      showToast("Controller connected");
      startPoll();
    }

    function onDisconnect(): void {
      if (!firstPad()) {
        setActive(false);
        stopPoll();
      }
    }

    window.addEventListener("gamepadconnected", onConnect);
    window.addEventListener("gamepaddisconnected", onDisconnect);
    // Pick up a gamepad that was already connected before this hook mounted.
    if (firstPad()) {
      setActive(true);
      startPoll();
    }

    return () => {
      window.removeEventListener("gamepadconnected", onConnect);
      window.removeEventListener("gamepaddisconnected", onDisconnect);
      stopPoll();
      if (toastTimer) clearTimeout(toastTimer);
      setActive(false);
    };
  }, []);

  return { toast };
}
