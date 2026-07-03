// The R3F scene mount point (design §2) — the only renderer since P6 deletes
// the legacy renderer.js / LegacyRendererBridge this used to run alongside.
//
// No <StrictMode> anywhere in this tree (see main.tsx) — a double-invoke
// would double-construct the WebGLRenderer/scene singletons R3F's <Canvas>
// owns internally.
import { Canvas } from "@react-three/fiber";
import { Scene } from "./Scene";
import { CAPTURE } from "./parity/determinism";
import "./GameCanvas.css";

export function GameCanvas() {
  return (
    <Canvas
      className="r3f-canvas"
      // ?capture=1 (design §7): preserveDrawingBuffer so canvas.screenshot()
      // reads the drawn frame instead of a cleared buffer; frameloop="never"
      // + dpr=1 hand frame-by-frame control to test/parity/replayDriver.ts
      // (advance(t) with a fixed synthetic dt) instead of the real rAF/DPR.
      gl={{ antialias: true, preserveDrawingBuffer: CAPTURE }}
      dpr={CAPTURE ? 1 : [1, 2]}
      shadows="soft"
      camera={{ fov: 55, near: 0.1, far: 300, position: [0, 28, 24] }}
      frameloop={CAPTURE ? "never" : "always"}
    >
      <Scene />
    </Canvas>
  );
}
