// P4-137: stub, implemented in #142. Scene.tsx references this layer so the
// R3F scaffold compiles and renders an empty scene before pooled projectile
// rendering lands; #142 replaces this file's contents only (no other file
// needs to change to wire the real layer in).
export function MeteorsLayer(): null {
  return null;
}
