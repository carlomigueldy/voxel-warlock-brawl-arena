// SPELLS[id].color / ITEMS[id].color are packed 0xRRGGBB numbers (three.js
// convention, shared with the R3F layer) — this is the one conversion point
// the HUD needs to hand them to CSS as `#rrggbb` (mirrors ui.js's inline
// `"#" + color.toString(16).padStart(6, "0")` calls for swatch/glow tinting).
export function toHexColor(color: number): string {
  return "#" + (color >>> 0).toString(16).padStart(6, "0").slice(-6);
}
