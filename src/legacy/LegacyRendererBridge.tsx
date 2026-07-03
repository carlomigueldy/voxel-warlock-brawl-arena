// renderer=legacy: mounts GameRenderer (src/renderer.js, still Three.js
// imperative — P4 replaces this with a declarative R3F scene) against the
// static #game-canvas element. Owns its OWN render rAF, separate from the
// authoritative sim loop (useHostLoop/useClientLoop) — a render throw here
// must never be able to skip a host.broadcast (design §5.2 / §7 invariant 5).
import { useEffect } from "react";
import { getRenderer, getAudio } from "../services/registry";
import { aimBridge } from "../store/aimBridge";
import { snapshotRef } from "../store/snapshotRef";
import { CAPTURE } from "../three/parity/determinism";
import { registerCaptureStep, unregisterCaptureStep } from "../three/parity/captureStep";

export function LegacyRendererBridge(): null {
  useEffect(() => {
    const canvas = document.getElementById("game-canvas") as HTMLCanvasElement | null;
    if (!canvas) {
      console.error("[LegacyRendererBridge] #game-canvas not found");
      return;
    }
    const renderer = getRenderer(canvas);
    renderer.setAudio(getAudio());
    aimBridge.attach(renderer);
    renderer.setLocalId(snapshotRef.localId);

    let lastLocalId = snapshotRef.localId;
    const step = () => {
      // Re-sync localId when it changes (assigned asynchronously by
      // useGameSession's Host onReady / Client onWelcome) — cheap reference
      // check, not a store subscription, so this stays a plain rAF read.
      if (snapshotRef.localId !== lastLocalId) {
        lastLocalId = snapshotRef.localId;
        renderer.setLocalId(lastLocalId);
      }
      const snap = snapshotRef.current; // non-reactive read — never a store subscription
      if (snap) {
        try {
          renderer.apply(snap, snapshotRef.meta);
          renderer.update();
        } catch (err) {
          console.error("[legacyRender]", err);
        }
      }
    };

    // ?capture=1 (design §7 / issue #138): the parity harness drives frames
    // one-per-pushed-snapshot via test/parity/replayDriver.ts, so this loop
    // must NOT free-run — see captureStep.ts for why. Register the exact
    // per-frame body instead and let the harness call it explicitly.
    if (CAPTURE) {
      registerCaptureStep("legacy", step);
      return () => {
        unregisterCaptureStep("legacy");
        aimBridge.attach(null);
      };
    }

    let raf = 0;
    const render = () => {
      step();
      raf = requestAnimationFrame(render);
    };
    raf = requestAnimationFrame(render);

    return () => {
      cancelAnimationFrame(raf);
      aimBridge.attach(null);
    };
  }, []);

  return null;
}
