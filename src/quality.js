// Render-quality tier resolver + live-apply hub (WS-I).
//
// Resolves a "low"|"med"|"high" tier from (in priority order): the `?quality=`
// URL param, then `localStorage['vwba.quality']` (written by the settings
// overlay — see src/ui.js's segmented control + src/main.js's persistence),
// then device auto-detection. "auto" (explicit or absent at either layer)
// falls through to auto-detect; "med" is never chosen automatically, only by
// explicit user selection — auto-detect is a binary low/high call so casual
// players get a sensible default without a "medium" no-man's-land.
//
// window.__applyQualityTier(tier) is the live-apply contract the settings
// overlay calls on change (src/main.js persists to localStorage, then forwards
// here). GameRenderer registers a handler via registerQualityHandler() so
// this module can push pixel-ratio/shadow changes into the active renderer
// without importing renderer.js (renderer.js already imports this module for
// its initial preset — importing back would cycle).
//
// Browser-only APIs (window/navigator/localStorage) are guarded throughout so
// this module stays importable under Node (tests, `node -e`).

export const QUALITY_PRESETS = {
  low:  { pixelRatioCap: 1,   shadows: false, particleScale: 0.5,  bloom: false },
  med:  { pixelRatioCap: 1.5, shadows: true,  particleScale: 0.75, bloom: false },
  high: { pixelRatioCap: 2,   shadows: true,  particleScale: 1.0,  bloom: true  },
};

const VALID_TIERS = new Set(["low", "med", "high"]);

function hasWindow() { return typeof window !== "undefined"; }
function hasNavigator() { return typeof navigator !== "undefined"; }

// Auto-detect: a coarse pointer (touch), a mobile UA hint, a low-memory
// device, or a small viewport all bias toward "low"; everything else is
// "high". Wrapped in try/catch throughout since matchMedia/userAgentData/
// deviceMemory are inconsistently supported across browsers.
function autoDetectTier() {
  if (!hasWindow()) return "high";
  let coarse = false;
  try { coarse = window.matchMedia?.("(pointer: coarse)").matches ?? false; } catch { coarse = false; }
  let mobileUA = false;
  try { mobileUA = hasNavigator() && navigator.userAgentData?.mobile === true; } catch { mobileUA = false; }
  let lowMemory = false;
  try {
    lowMemory = hasNavigator() && typeof navigator.deviceMemory === "number" && navigator.deviceMemory <= 4;
  } catch { lowMemory = false; }
  const smallViewport = (window.innerWidth || 0) < 820 || (window.innerHeight || 0) < 480;
  return (coarse || mobileUA || lowMemory || smallViewport) ? "low" : "high";
}

function readUrlParam() {
  if (!hasWindow()) return null;
  try {
    const v = new URLSearchParams(window.location.search).get("quality");
    if (!v) return null;
    return v === "auto" || VALID_TIERS.has(v) ? v : null;
  } catch { return null; }
}

function readStored() {
  if (!hasWindow()) return null;
  try {
    const v = window.localStorage?.getItem("vwba.quality");
    if (!v) return null;
    return v === "auto" || VALID_TIERS.has(v) ? v : null;
  } catch { return null; }
}

// Resolve the effective tier: ?quality= > localStorage['vwba.quality'] >
// auto-detect. Either layer may explicitly say "auto" (or be absent) to fall
// through to the next.
export function resolveTier() {
  const urlV = readUrlParam();
  if (urlV && urlV !== "auto") return urlV;

  const storedV = readStored();
  if (storedV && storedV !== "auto") return storedV;

  return autoDetectTier();
}

let _cachedTier = null;
// Cached resolution of resolveTier() — computed once per page load so every
// caller (renderer, vfx use sites) agrees on the same tier until an explicit
// live change via window.__applyQualityTier.
export function getQualityTier() {
  if (!_cachedTier) _cachedTier = resolveTier();
  return _cachedTier;
}

let _rendererHook = null;
// GameRenderer calls this once in its constructor with a callback that
// applies a preset (pixel ratio, shadow toggle) to the live renderer/scene.
export function registerQualityHandler(fn) { _rendererHook = fn; }

// Render-only particle-count multiplier for VFX use sites (burst shard
// counts, trail pool size, hazard ambient-detail counts). Never read by
// simulation code — sim.js's numbers stay tier-independent so determinism
// across clients is unaffected.
let _particleScale = QUALITY_PRESETS[getQualityTier()].particleScale;
export function getParticleScale() { return _particleScale; }

if (hasWindow()) {
  window.__applyQualityTier = (tier) => {
    const resolved = VALID_TIERS.has(tier) ? tier : autoDetectTier();
    const preset = QUALITY_PRESETS[resolved];
    _cachedTier = resolved;
    _particleScale = preset.particleScale;
    _rendererHook?.(preset);
  };
}
