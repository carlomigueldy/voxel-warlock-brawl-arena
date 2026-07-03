// P4-137: stub, implemented in #139. Scene.tsx references this layer so the
// R3F scaffold compiles and renders an empty scene before the arena
// floor/hazard rendering lands; #139 replaces this file's contents only (no
// other file needs to change to wire the real layer in).
export function ArenaFloor(): null {
  return null;
}
