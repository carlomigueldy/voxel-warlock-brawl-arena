// Local port of ui.js's `hex()` (src/ui.js:11) — converts a packed
// 0xRRGGBB CFG.COLORS entry to a CSS hex string. Same precedent as
// src/ui/chat/hexColor.ts / src/ui/lobby/hexColor.ts / src/ui/hud/hudColor.ts:
// a data-formatting helper, not a visual primitive, so each sibling owns its
// own copy rather than sharing one from ui/common.
export function hex(n: number): string {
  return "#" + (n >>> 0).toString(16).padStart(6, "0").slice(-6);
}
