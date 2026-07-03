// Small shared helper — port of ui.js's local `hex()` (src/ui.js:11), used
// wherever a CFG color int (e.g. CFG.COLORS, ARENA_WORLDS top/side, hazard
// color/glow) needs to become a CSS custom-property value. Kept local to
// src/ui/lobby (not src/ui/common) since it's a data-formatting helper, not
// a visual primitive — p5-menu's arena/character color needs, if any, can
// import it directly or grow their own; duplication here is cheap and keeps
// this sibling's edit surface inside its owned directory.
export function hex(n: number): string {
  return "#" + (n >>> 0).toString(16).padStart(6, "0").slice(-6);
}
