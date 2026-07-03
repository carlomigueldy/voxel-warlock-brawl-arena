// The drag surface behind TouchControls' movement stick — a Pointer Events
// port of src/input.ts's `_bindTouch()` (L323-359): same normalize-to-[-1,1]
// -then-clamp-to-radius math, just driven by React handlers on our own
// element instead of raw `touchstart`/`touchmove`/`touchend` listeners on
// legacy's `#joystick`/`#joystick-knob` ids. `setPointerCapture` reproduces
// touch events' own semantics (the gesture keeps targeting the element the
// finger went down on, however far it drags) for the pointer-event path.
//
// The clamp radius is read from the element's own rendered half-width
// rather than legacy's hardcoded `50` (input.ts L330) — same normalization,
// just self-consistent with whatever size TouchControls.module.css gives
// `.joystick` at the current viewport instead of coupling this component to
// a specific breakpoint's px value.
import { useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import styles from "./TouchControls.module.css";

export interface JoystickProps {
  /** Normalized [-1,1] per axis, same shape as InputController.touchMove. */
  onMove: (x: number, z: number) => void;
  onEnd: () => void;
}

export function Joystick({ onMove, onEnd }: JoystickProps) {
  const [knob, setKnob] = useState({ x: 0, y: 0 });
  const drag = useRef<{ pointerId: number; originX: number; originY: number; radius: number } | null>(null);

  function handlePointerDown(e: ReactPointerEvent<HTMLDivElement>): void {
    const rect = e.currentTarget.getBoundingClientRect();
    drag.current = {
      pointerId: e.pointerId,
      originX: rect.left + rect.width / 2,
      originY: rect.top + rect.height / 2,
      radius: rect.width / 2,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
    e.preventDefault();
  }

  function handlePointerMove(e: ReactPointerEvent<HTMLDivElement>): void {
    const d = drag.current;
    if (!d || e.pointerId !== d.pointerId) return;
    let dx = e.clientX - d.originX;
    let dy = e.clientY - d.originY;
    const len = Math.hypot(dx, dy);
    if (len > d.radius) {
      dx = (dx / len) * d.radius;
      dy = (dy / len) * d.radius;
    }
    setKnob({ x: dx, y: dy });
    onMove(dx / d.radius, dy / d.radius);
    e.preventDefault();
  }

  function release(e: ReactPointerEvent<HTMLDivElement>): void {
    const d = drag.current;
    if (!d || e.pointerId !== d.pointerId) return;
    drag.current = null;
    setKnob({ x: 0, y: 0 });
    onEnd();
  }

  return (
    <div
      className={styles.joystick}
      data-testid="touch-joystick"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={release}
      onPointerCancel={release}
    >
      <div className={styles.joystickKnob} style={{ transform: `translate(${knob.x}px, ${knob.y}px)` }} />
    </div>
  );
}
