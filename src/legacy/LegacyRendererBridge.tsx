// renderer=legacy: mounts GameRenderer (src/renderer.js, still Three.js
// imperative — P4 replaces this with a declarative R3F scene) against the
// static #game-canvas element. Owns its OWN render rAF, separate from the
// authoritative sim loop (useHostLoop/useClientLoop) — a render throw here
// must never be able to skip a host.broadcast (design §5.2 / §7 invariant 5).
import { useEffect } from "react";
import { getRenderer, getAudio } from "../services/registry";
import { aimBridge } from "../store/aimBridge";
import { snapshotRef } from "../store/snapshotRef";

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

    let raf = 0;
    let lastLocalId = snapshotRef.localId;
    const render = () => {
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
