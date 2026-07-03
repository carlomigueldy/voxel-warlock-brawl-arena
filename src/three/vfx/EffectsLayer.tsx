// P4-137: stub, implemented in #147. Scene.tsx references this layer so the
// R3F scaffold compiles and renders an empty scene before the VFX event
// pipeline (eventToEffects.ts + the ~40 GameEvent handlers) lands; #147
// replaces this file's contents only (no other file needs to change to wire
// the real layer in).
export function EffectsLayer(): null {
  return null;
}
