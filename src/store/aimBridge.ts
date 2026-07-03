// The aim seam: lets ONE InputController (built once, see
// src/services/registry.ts getInput()) work under either renderer flag by
// talking to this bridge instead of GameRenderer/R3F directly.
//
// renderer=legacy: LegacyRendererBridge calls `aimBridge.attach(gameRenderer)`.
// renderer=r3f (P4): <AimBridge> raycasts the R3F camera and attaches itself.
// Aim always resolves ON DEMAND against whichever target is currently
// attached — never cached per-frame — so cast targeting is identical
// regardless of which renderer is live (design §2.4 / §10 risk 6).
import type { InputRenderer } from "../input";
import { snapshotRef } from "./snapshotRef";

let target: InputRenderer | null = null;

export const aimBridge: InputRenderer & { attach(t: InputRenderer | null): void } = {
  attach(t) {
    target = t;
  },
  screenToAim: (x, y) => target?.screenToAim(x, y) ?? 0,
  screenToPoint: (x, y) => target?.screenToPoint?.(x, y) ?? null,
  setAimSpell: (id) => {
    snapshotRef.aim.spellId = id;
    target?.setAimSpell?.(id);
  },
  setCursor: (x, y) => {
    snapshotRef.aim.cursorX = x;
    snapshotRef.aim.cursorY = y;
    target?.setCursor?.(x, y);
  },
};
