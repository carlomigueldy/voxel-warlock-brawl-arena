// React shell entry — loaded ONLY behind ?shell=react (see index.html's
// bootstrap script); the default (no query param) path still loads
// src/main.js untouched. No <StrictMode>: a double-invoke would construct
// two Peers / two rAF loops / two AudioContexts through the singletons in
// src/services/registry.ts (design §10 risk 2).
import { createRoot } from "react-dom/client";
import App from "./App";
import { resetServices } from "./services/registry";
import { CAPTURE, installDeterminism } from "./three/parity/determinism";

// ?capture=1 (design §7 / issue #138): every Math.random()/Clock.getDelta()/
// getContext() patch must be live before ANY scene-building code runs.
// App.tsx's own renderer effects only run after root.render() commits below,
// so installing here — before that call — keeps the ordering invariant
// textually obvious and immune to future reordering inside App.tsx.
installDeterminism();

const container = document.getElementById("root")!;
const root = createRoot(container);
root.render(<App />);

// ?capture=1: wire the page-level window.__parity API the parity harness
// (scripts/parity.mjs via Playwright) drives. Dynamic import so the parity
// driver — and the sim/replay modules it pulls in — never ships in the
// default (non-capture) bundle; resolving asynchronously is fine because it
// only needs to run after React's initial commit (LegacyRendererBridge
// registers its capture step / R3F's <Canvas> registers its root during that
// same commit), never before.
if (CAPTURE) {
  void import("../test/parity/replayDriver").then((m) => m.installParityHarness());
}

// HMR safety net (design §10 risk 5). main.tsx has no component exports, so
// Vite's default behavior for editing it is already a full page reload; this
// dispose hook is defense-in-depth for the case a future edit changes that.
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    root.unmount();
    resetServices();
  });
}
