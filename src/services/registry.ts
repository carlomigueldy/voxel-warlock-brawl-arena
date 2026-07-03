// Lazy, HMR-safe singleton registry for the legacy imperative engines
// (GameRenderer, UI, AudioEngine, InputController, CharacterPreview).
//
// Two things this exists to prevent (design §10 risk 2/5):
//  - React 19 has no StrictMode double-invoke in this app (see main.tsx), so
//    that particular hazard doesn't apply here — but component remounts
//    (route/flag changes, Fast Refresh) must still get back the SAME
//    Peer/AudioContext/Three.js scene rather than silently spawning a
//    second one alongside the first.
//  - Keyed off `globalThis` (not a module-level `let`) so an HMR swap of
//    THIS module doesn't lose the reference to already-constructed engines —
//    main.tsx's `import.meta.hot?.dispose()` is the only intended way these
//    ever get torn down before a full page reload.
import { GameRenderer } from "../renderer.js";
import { UI } from "../ui.js";
import { AudioEngine } from "../audio.js";
import { InputController } from "../input.js";
import { CharacterPreview } from "../preview.js";
import { aimBridge } from "../store/aimBridge";

interface ServiceRegistry {
  renderer: GameRenderer | null;
  ui: UI | null;
  audio: AudioEngine | null;
  input: InputController | null;
  preview: CharacterPreview | null;
}

const g = globalThis as typeof globalThis & { __vwbServices?: ServiceRegistry };
const services: ServiceRegistry =
  g.__vwbServices ??
  (g.__vwbServices = { renderer: null, ui: null, audio: null, input: null, preview: null });

export function getRenderer(canvas?: HTMLCanvasElement): GameRenderer {
  if (!services.renderer) {
    if (!canvas) throw new Error("getRenderer(): no renderer yet — a canvas is required on first call");
    services.renderer = new GameRenderer(canvas);
  }
  return services.renderer;
}

export function getUI(): UI {
  if (!services.ui) services.ui = new UI();
  return services.ui;
}

export function getAudio(): AudioEngine {
  if (!services.audio) services.audio = new AudioEngine();
  return services.audio;
}

// Built ONCE with aimBridge as its renderer (design §2.4) — one
// InputController works under either renderer flag because it never talks
// to GameRenderer/R3F directly, only to the bridge.
export function getInput(): InputController {
  if (!services.input) services.input = new InputController(aimBridge);
  return services.input;
}

export function getPreview(canvas?: HTMLCanvasElement): CharacterPreview {
  if (!services.preview) {
    if (!canvas) throw new Error("getPreview(): no preview yet — a canvas is required on first call");
    services.preview = new CharacterPreview(canvas);
  }
  return services.preview;
}

// HMR-only teardown hook (main.tsx `import.meta.hot?.dispose`) — never
// called during normal session start/end (host/client/voice are per-match
// and torn down by useGameSession; these engines are page-lifetime).
export function resetServices(): void {
  services.renderer = null;
  services.ui = null;
  services.audio = null;
  services.input = null;
  services.preview = null;
}
