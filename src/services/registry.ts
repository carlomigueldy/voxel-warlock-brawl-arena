// Lazy, HMR-safe singleton registry for the page-lifetime imperative engines
// (AudioEngine, InputController) — P6 deletes GameRenderer/UI/CharacterPreview
// along with the legacy renderer.js/ui.js/preview.js they wrapped; only the
// now-deleted legacy bridges ever called getRenderer()/getUI()/getPreview().
//
// This exists to prevent (design §10 risk 2/5): React 19 has no StrictMode
// double-invoke in this app (see main.tsx), so that particular hazard doesn't
// apply here — but component remounts (Fast Refresh) must still get back the
// SAME AudioContext rather than silently spawning a second one alongside the
// first.
//
// Keyed off `globalThis` (not a module-level `let`) so an HMR swap of THIS
// module doesn't lose the reference to already-constructed engines —
// main.tsx's `import.meta.hot?.dispose()` is the only intended way these
// ever get torn down before a full page reload.
import { AudioEngine } from "../audio.js";
import { InputController } from "../input.js";
import { aimBridge } from "../store/aimBridge";

interface ServiceRegistry {
  audio: AudioEngine | null;
  input: InputController | null;
}

const g = globalThis as typeof globalThis & { __vwbServices?: ServiceRegistry };
const services: ServiceRegistry = g.__vwbServices ?? (g.__vwbServices = { audio: null, input: null });

export function getAudio(): AudioEngine {
  if (!services.audio) services.audio = new AudioEngine();
  return services.audio;
}

// Built ONCE with aimBridge as its renderer (design §2.4) — the R3F scene
// reads aim state through the same bridge, so InputController never talks to
// the renderer directly.
export function getInput(): InputController {
  if (!services.input) services.input = new InputController(aimBridge);
  return services.input;
}

// HMR-only teardown hook (main.tsx `import.meta.hot?.dispose`) — never
// called during normal session start/end (host/client/voice are per-match
// and torn down by useGameSession; these engines are page-lifetime).
export function resetServices(): void {
  services.audio = null;
  services.input = null;
}
