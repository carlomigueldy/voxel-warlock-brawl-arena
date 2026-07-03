// Mirrors src/ui.js's `_maybeShowTouch()` verbatim (L1413-1416) — the same
// touch-capability check, so the React surface (TouchControls.tsx) shows
// under exactly the same conditions the legacy one does. Split into its own
// module (rather than inlined in TouchControls.tsx) purely so tests can
// `vi.doMock` it — jsdom always defines `window.ontouchstart` (unlike a real
// non-touch browser), so the "non-touch" branch isn't reachable by mutating
// the real jsdom globals alone.
export function detectTouch(): boolean {
  return typeof window !== "undefined" && ("ontouchstart" in window || navigator.maxTouchPoints > 0);
}
