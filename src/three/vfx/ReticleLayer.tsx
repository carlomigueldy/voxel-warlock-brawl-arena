// P4-137: stub, implemented in #145. Scene.tsx references this layer so the
// R3F scaffold compiles and renders an empty scene before the hold-to-aim
// targeting reticle lands; #145 replaces this file's contents only (no
// other file needs to change to wire the real layer in).
export function ReticleLayer(): null {
  return null;
}
