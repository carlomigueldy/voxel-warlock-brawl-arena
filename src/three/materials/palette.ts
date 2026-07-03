// Thin façade over the legacy Lambert-flat/Basic material recipe (design §0
// PALETTE CORRECTION): every R3F material in this tree routes through here
// so nothing ever reaches for MeshStandardMaterial — the legacy lighting rig
// (one directional sun + a hemisphere ambient, no IBL/PBR pipeline) only
// reads correctly against Lambert/Basic; Standard would desaturate/darken
// everything and break parity instantly.
//
// Re-exports src/lowpoly.ts's _lit/_unlit factories under public names, and
// src/vfx/duotone.ts's TrailPool/facetedDuo — the two builders this
// scaffold's palette directly touches (design §2). voxel.ts-owned caches
// (_boltGeoCache/_boltMatCache/_RARITY_COLORS/_RARITY_INTENSITY) are added
// here once p4-projectiles (#142) ports BoltsLayer/BoltEntity — nothing in
// this scaffold PR consumes them yet, so voxel.js stays untouched/deferred.
import { _lit, _unlit, type LowPolyOpts } from "../../lowpoly.js";
import { TrailPool, facetedDuo, type FacetedDuoOpts, type FacetedDuoBuilder } from "../../vfx/duotone.js";

export const lit = _lit;
export const unlit = _unlit;
export type { LowPolyOpts, FacetedDuoOpts, FacetedDuoBuilder };
export { TrailPool, facetedDuo };

// R3F-only decal literals (design §2) — small persistent UI-in-world meshes
// (HP bars, shield rings, stun stars, ...) that have no legacy builder to
// source a color from (those DOM/HUD elements don't exist in-world today).
export const DECAL_COLORS = {
  hpBg: 0x14121f,
  hpFill: 0x2ecc71,
  shield: 0x66ccff,
  stunStar: 0xffff44,
  speakRing: 0x7cff5a,
  skin: 0xf0c8a0,
} as const;
