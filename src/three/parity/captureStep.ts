// Capture-mode per-frame step registry (design §7 / issue #138) — lets the
// LEGACY render path (LegacyRendererBridge, editable per brief #138 even
// though renderer.js itself stays golden) register the exact per-frame body
// its own rAF loop would otherwise run, so test/parity/replayDriver.ts
// (running inside the SAME page under ?capture=1) can call it once per
// pushed snapshot instead of letting it free-run at whatever the real
// refresh rate happens to be. A free-running rAF would render a
// nondeterministic NUMBER of frames — and therefore a nondeterministic
// number of Math.random() draws inside build/VFX code — between two
// otherwise-identical captures, which would break the whole determinism
// gate.
//
// R3F needs no equivalent entry here: its <Canvas frameloop="never"> step is
// driven directly by importing `advance` from "@react-three/fiber" (a
// module-level function, not a per-instance closure) — see replayDriver.ts.
export type CaptureStepFn = () => void;

const steppers = new Map<string, CaptureStepFn>();

export function registerCaptureStep(key: string, fn: CaptureStepFn): void {
  steppers.set(key, fn);
}

export function unregisterCaptureStep(key: string): void {
  steppers.delete(key);
}

export function runCaptureStep(key: string): void {
  steppers.get(key)?.();
}
