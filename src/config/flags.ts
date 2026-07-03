// Renderer/UI seam flags, read once at module load. P3a hardcodes both
// defaults to "legacy" — R3F (P4) and the React UI (P5) don't exist yet, so
// the only wired combination this PR ships is renderer=legacy&ui=legacy via
// LegacyRendererBridge/LegacyUiBridge. P4/P5 land their own component and
// flip the corresponding default; the two flags flip independently in one
// build (e.g. renderer=r3f&ui=legacy is a valid mid-migration state).
const params = new URLSearchParams(location.search);

export type RendererMode = "legacy" | "r3f";
export type UiMode = "legacy" | "react";

export const RENDERER: RendererMode = (params.get("renderer") as RendererMode) ?? "legacy";
export const UI_MODE: UiMode = (params.get("ui") as UiMode) ?? "legacy";
