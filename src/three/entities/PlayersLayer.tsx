// P4-137: stub, implemented in #140. Scene.tsx references this layer so the
// R3F scaffold compiles and renders an empty scene before warlock GLB
// models/player entities land; #140 replaces this file's contents only (no
// other file needs to change to wire the real layer in).
export function PlayersLayer(): null {
  return null;
}
