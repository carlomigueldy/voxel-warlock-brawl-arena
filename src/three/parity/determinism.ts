// Capture-mode determinism (design p4-design.md §7 / issue #138) — every
// patch here is a no-op unless CAPTURE is true, so normal (non-capture)
// gameplay is completely unaffected. Call `installDeterminism()` as the
// FIRST statement in main.tsx, before <App/> ever renders: every patch below
// must be live before any scene-building code (GameRenderer ctor, R3F
// <Canvas>, voxel builders) makes its first Math.random()/Clock.getDelta()/
// getContext() call.
import * as THREE from "three";
import { makePrng } from "../../rng";

const params = new URLSearchParams(location.search);

export const CAPTURE: boolean = params.get("capture") === "1";
export const CAPTURE_SEED: number = Number(params.get("seed")) || 1;
export const CAPTURE_FIXTURE: string | null = params.get("fixture");
/** Fixed per-frame dt — CFG.TICK_RATE's period. Shared by the legacy Clock
 * patch below and the R3F capture driver's advance() timestamp step
 * (test/parity/replayDriver.ts) so both renderers see identical framing. */
export const CAPTURE_FIXED_DT = 1 / 30;

// DOM chrome that would otherwise overlay the canvas. Most of these already
// carry the `hidden` class in index.html; #loader and #menu don't (they're
// the first thing a real page load shows) — capture mode skips the whole
// loader→gesture→auth/region→menu flow entirely (App.tsx's CAPTURE guard on
// useAppBootstrap), so nothing ever un-hides them again. Hiding the full set
// defensively costs nothing (adding `hidden` to an already-hidden element is
// a no-op) and survives future markup changes.
const CHROME_IDS = [
  "loader", "menu", "onboarding", "lobby", "spell-draft",
  "hud", "pause-menu", "conduct-modal", "social-settings", "touch-controls",
];

function hideChrome(): void {
  for (const id of CHROME_IDS) {
    document.getElementById(id)?.classList.add("hidden");
  }
}

// getContext() patch — a known trap the scaffold review hit: renderer.js's
// WebGLRenderer is constructed as `new THREE.WebGLRenderer({canvas,
// antialias:true})` — no preserveDrawingBuffer — and renderer.js is GOLDEN
// (never edited, per CLAUDE.md / the P4 design). Three.js forwards those ctor
// options straight into `canvas.getContext('webgl2', {...})`, so the only way
// to force preserveDrawingBuffer on without touching renderer.js is to
// intercept the context request itself. Without this, canvas.screenshot()
// reads whatever the browser left in the (cleared-on-composite) default
// framebuffer — a blank PNG. R3F's own <Canvas gl={{preserveDrawingBuffer}}>
// prop (GameCanvas.tsx, capture branch) covers the r3f path directly and
// doesn't need this patch, but it's harmless there too (same attrs merge).
function patchGetContext(): void {
  const original = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (
    this: HTMLCanvasElement,
    type: string,
    ...rest: unknown[]
  ) {
    if (type === "webgl2" || type === "webgl" || type === "experimental-webgl") {
      const attrs = { ...(rest[0] as Record<string, unknown> | undefined), preserveDrawingBuffer: true };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- forwarding a variadic overloaded DOM method
      return (original as any).call(this, type, attrs);
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (original as any).call(this, type, ...rest);
  } as typeof original;
}

// THREE.Clock.prototype.getDelta patch — replaces the real-wall-clock read
// with a fixed, self-advancing step. Two renderers depend on this ONE patch:
//  - LEGACY: renderer.js's update() calls `this.clock.getDelta()` directly
//    (renderer.js is GOLDEN — this is the only way to fix its dt without
//    editing it).
//  - R3F: <Canvas frameloop="never"> makes R3F's own update() call
//    `state.clock.getDelta()` too, BEFORE overwriting the result with a
//    timestamp-diff computed from the harness-driven `advance(t)` call (see
//    replayDriver.ts). The real getDelta() has a side effect
//    (`this.elapsedTime += realWallClockDiff`) that would otherwise leak
//    real-time jitter into R3F's elapsedTime a moment before advance()'s own
//    override overwrites it — patching getDelta() to a deterministic,
//    real-clock-free step removes that leak too.
function patchClock(): void {
  THREE.Clock.prototype.getDelta = function (this: THREE.Clock) {
    this.elapsedTime += CAPTURE_FIXED_DT;
    return CAPTURE_FIXED_DT;
  };
}

let installed = false;

export function installDeterminism(): void {
  if (!CAPTURE || installed) return;
  installed = true;
  Math.random = makePrng(CAPTURE_SEED);
  patchClock();
  patchGetContext();
  hideChrome();
}
