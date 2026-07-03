// Touch-capability check — same expression ui.js:1414 already uses to gate
// touch-only affordances. Kept local to onboarding/ (not yet promoted to a
// shared util) so this PR's scope stays additive.
//
// Extracted to its own module (rather than inlined in Onboarding.tsx)
// specifically so tests can mock it directly: jsdom's `window` satisfies
// `"ontouchstart" in window` unconditionally, regardless of what a test
// sets `navigator.maxTouchPoints` to, so there is no DOM-level way to
// simulate a non-touch environment under jsdom — Onboarding.test.tsx
// `vi.mock`s this module instead.
export function isTouchDevice(): boolean {
  return typeof window !== "undefined" && ("ontouchstart" in window || navigator.maxTouchPoints > 0);
}
