// Mount point for `?renderer=r3f` (design §2) — the R3F sibling of
// LegacyRendererBridge. Hides the static #game-canvas element on mount
// (restores it on unmount) so the legacy canvas and this R3F canvas never
// stack simultaneously; the RENDERER flag (config/flags.ts) is exclusive, so
// in practice only one of the two ever mounts, but this guards against a Fast
// Refresh remount racing a not-yet-unmounted legacy bridge.
//
// No <StrictMode> anywhere in this tree (see main.tsx) — a double-invoke
// would double-construct the WebGLRenderer/scene singletons R3F's <Canvas>
// owns internally.
import { useEffect } from "react";
import { Canvas } from "@react-three/fiber";
import { Scene } from "./Scene";

export function GameCanvas() {
  useEffect(() => {
    const el = document.getElementById("game-canvas");
    if (!el) return;
    const prevDisplay = el.style.display;
    el.style.display = "none";
    return () => {
      el.style.display = prevDisplay;
    };
  }, []);

  return (
    <Canvas
      className="r3f-canvas"
      gl={{ antialias: true }}
      dpr={[1, 2]}
      shadows="soft"
      camera={{ fov: 55, near: 0.1, far: 300, position: [0, 28, 24] }}
      frameloop="always"
    >
      <Scene />
    </Canvas>
  );
}
