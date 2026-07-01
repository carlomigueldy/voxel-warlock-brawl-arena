// Per-spell targeting reticles — the visual layer behind hold-to-aim /
// release-to-cast (src/input.js) for the human player. Every spell in
// src/config.js's SPELLS carries an `aim` field naming one of the eight
// archetypes below (RETICLE_ARCHETYPES); getReticle(spellId) resolves a
// spell to its archetype + build(color) factory, with a generic faceted-ring
// fallback for any spell missing (or with an unrecognized) `aim` — mirroring
// src/vfx/duotone.js's getVfx() fallback contract.
//
// Same duotone recipe as duotone.js/aoe.js: a flat-shaded emissive PRIMARY
// layer + a ~0.5-opacity translucent SECONDARY layer, tinted via
// secondaryColor() from the spell's `.color`. Ground-plane shapes
// (rings, wedges) are unlit MeshBasicMaterial with rotation.x = -Math.PI/2,
// the same convention as renderer.js's _ringPulse/_buildChannelDecal and
// aoe.js's _duoRing. Corner-bracket shapes reuse the _reticleCollapse concept
// from aoe.js (four faceted corner shards around a bright core), just static
// instead of collapsing.
//
// Perf discipline: only one reticle is ever alive at a time (the local
// player's current aim target), so — unlike TrailPool/bolt pooling, which
// bounds many *concurrent* instances — the concern here is avoiding
// geometry churn every time the aimed spell changes (which can happen
// rapidly under last-press-wins switching). Every archetype therefore builds
// its meshes from UNIT-sized geometry shared at module scope (never
// disposed, mirroring voxel.js's _boltGeoCache / duotone.js's
// _trailShardGeo) and expresses per-spell sizing (radius/range) purely via
// THREE.Mesh.scale rather than baking dimensions into fresh geometry. The
// lone exception is CONE_SPRAY's angular wedge (angle can't be expressed via
// uniform scale) — cached per rounded half-angle in a small, bounded Map,
// exactly like _boltGeoCache keys by bolt `kind`.
//
// Each archetype builder returns a THREE.Group exposing:
//   userData.recolor(color)                              — retint in place
//   userData.dispose()                                    — free owned materials
//   userData.update({ point, casterX, casterZ, casterAim,
//                      range, radius, target })            — reposition/clamp
// `point` is the raycast cursor ground point ({x,z}|null); `target` is an
// optional {x,z} for archetypes that lock onto the nearest enemy. Every
// field is optional — builders fall back sensibly when absent, matching the
// VFX_REGISTRY ctx contract's "the base contract does not guarantee them".
import * as THREE from "three";
import { CFG, SPELLS } from "../config.js";
import { secondaryColor } from "./duotone.js";

const _RING_SEGMENTS = 16;

// ---------------------------------------------------------------------------
// Shared, cache-owned UNIT geometry — built once at module scope, NEVER
// disposed (matches voxel.js's _boltGeoCache / duotone.js's _trailShardGeo
// discipline). Per-instance sizing is done via mesh.scale, not fresh geometry.
// ---------------------------------------------------------------------------
const _shardGeo = new THREE.OctahedronGeometry(0.5, 0); // corner brackets, markers, accents
const _arrowGeo = new THREE.ConeGeometry(0.32, 1.05, 3);
_arrowGeo.rotateX(Math.PI / 2); // bake apex to point along local +Z (forward), matches player-facing convention
const _ringGeo = new THREE.RingGeometry(0.82, 1, _RING_SEGMENTS);     // unit primary ring (radius 1)
const _ringSecGeo = new THREE.RingGeometry(0.5, 1.32, _RING_SEGMENTS); // unit secondary ring
const _beamGeo = new THREE.BoxGeometry(1, 1, 1); // tether connector, scaled to (thickness, thickness, length)

// Cone-spray wedge geometry can't be expressed via uniform scale (the angle
// is baked into the vertices), so it is cached per rounded half-angle in a
// small, bounded Map — the same "build once, key by a small discrete
// parameter, never dispose" discipline as _boltGeoCache (keyed by bolt kind).
const _wedgeGeoCache = new Map();
function _wedgeGeo(halfAngle) {
  const key = Math.round(Math.max(0.05, halfAngle) * 1000);
  let entry = _wedgeGeoCache.get(key);
  if (!entry) {
    const ha = key / 1000;
    entry = {
      prim: new THREE.RingGeometry(0.3, 1, _RING_SEGMENTS, 1, -ha, ha * 2),
      sec: new THREE.RingGeometry(0.16, 1.2, _RING_SEGMENTS, 1, -ha, ha * 2),
    };
    _wedgeGeoCache.set(key, entry);
  }
  return entry;
}

// Clamp a world point (px,pz) to at most `range` units from (cx,cz). Mirrors
// the clamp idiom used throughout src/spells.js (meteor/teleport/gravity/...):
// dx,dz,d=hypot; rescale onto the range circle when d exceeds it.
function _clampToRange(cx, cz, px, pz, range) {
  if (!Number.isFinite(range) || range <= 0) return { x: px, z: pz };
  const dx = px - cx, dz = pz - cz;
  const d = Math.hypot(dx, dz);
  if (d <= range || d < 1e-6) return { x: px, z: pz };
  const k = range / d;
  return { x: cx + dx * k, z: cz + dz * k };
}

// ---------------------------------------------------------------------------
// Shared build helpers
// ---------------------------------------------------------------------------

// A duotone ground-plane shape (primary opaque + secondary translucent,
// both unlit) from a shared pair of unit geometries, scaled to `opts.scale`.
// `opts.scale` maps 1:1 to world radius since the unit geometries have
// radius 1. Returns { primary, secondary, recolor, dispose } — callers wrap
// these into a Group and forward recolor/dispose.
function _buildDuoGroundShape(primGeo, secGeo, color, opts = {}) {
  const scale = opts.scale ?? 1;
  const opacity = opts.opacity ?? 0.7;
  const y = opts.y ?? 0.05;

  const primMat = new THREE.MeshBasicMaterial({
    color, transparent: true, opacity, side: THREE.DoubleSide, depthWrite: false,
  });
  const primary = new THREE.Mesh(primGeo, primMat);
  primary.rotation.x = -Math.PI / 2;
  primary.scale.set(scale, scale, 1);
  primary.position.y = y;

  const secMat = new THREE.MeshBasicMaterial({
    color: secondaryColor(color), transparent: true, opacity: opacity * 0.5, side: THREE.DoubleSide, depthWrite: false,
  });
  const secondary = new THREE.Mesh(secGeo, secMat);
  secondary.rotation.x = -Math.PI / 2;
  secondary.scale.set(scale, scale, 1);
  secondary.position.y = y - 0.02;

  return {
    primary, secondary,
    recolor: (c) => { primMat.color.setHex(c); secMat.color.setHex(secondaryColor(c)); },
    dispose: () => { primMat.dispose(); secMat.dispose(); },
  };
}

// Four faceted corner-bracket shards around a bright core — the static
// (non-collapsing) 3D echo of aoe.js's _reticleCollapse, reused here as a
// persistent "this is the locked target" marker for NEAREST_TARGET_LOCK and
// TETHER_LOCK.
function _buildBracket(color, opts = {}) {
  const size = opts.size ?? 0.8;
  const y = opts.y ?? 1.1;
  const g = new THREE.Group();
  const corners = [];
  const secColor = secondaryColor(color);
  for (const [dx, dz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    const mat = new THREE.MeshLambertMaterial({
      color: secColor, emissive: secColor, emissiveIntensity: 0.7, flatShading: true,
      transparent: true, opacity: 0.85,
    });
    const m = new THREE.Mesh(_shardGeo, mat);
    m.castShadow = false;
    m.scale.set(0.14, 0.42, 0.14);
    m.position.set(dx * size, y, dz * size);
    g.add(m);
    corners.push(m);
  }
  const coreMat = new THREE.MeshLambertMaterial({
    color, emissive: color, emissiveIntensity: 1.1, flatShading: true,
  });
  const core = new THREE.Mesh(_shardGeo, coreMat);
  core.castShadow = false;
  core.scale.set(0.16, 0.3, 0.16);
  core.position.y = y;
  g.add(core);

  g.userData.recolor = (c) => {
    const sc = secondaryColor(c);
    for (const m of corners) { m.material.color.setHex(sc); m.material.emissive.setHex(sc); }
    coreMat.color.setHex(c); coreMat.emissive.setHex(c);
  };
  g.userData.dispose = () => {
    for (const m of corners) m.material.dispose();
    coreMat.dispose();
  };
  return g;
}

// ---------------------------------------------------------------------------
// Archetype builders — (color, params) -> THREE.Group
// ---------------------------------------------------------------------------

// DIRECTIONAL_PROJECTILE — a faceted arrow hovering just in front of the
// caster, pointing toward the cursor. No range clamp: skillshots travel
// until they hit something or expire.
function buildDirectional(color) {
  const mat = new THREE.MeshLambertMaterial({ color, emissive: color, emissiveIntensity: 1, flatShading: true });
  const primary = new THREE.Mesh(_arrowGeo, mat);
  primary.castShadow = false;
  const secMat = new THREE.MeshBasicMaterial({ color: secondaryColor(color), transparent: true, opacity: 0.4, depthWrite: false });
  const secondary = new THREE.Mesh(_arrowGeo, secMat);
  secondary.scale.setScalar(1.3);

  const g = new THREE.Group();
  g.add(secondary, primary);
  g.userData.recolor = (c) => {
    mat.color.setHex(c); mat.emissive.setHex(c);
    secMat.color.setHex(secondaryColor(c));
  };
  g.userData.dispose = () => { mat.dispose(); secMat.dispose(); };
  g.userData.update = (state = {}) => {
    const cx = state.casterX ?? 0, cz = state.casterZ ?? 0;
    const px = state.point?.x ?? cx + 1, pz = state.point?.z ?? cz;
    const angle = Math.atan2(pz - cz, px - cx);
    g.position.set(cx + Math.cos(angle) * 2.0, 0.9, cz + Math.sin(angle) * 2.0);
    g.rotation.y = -angle + Math.PI / 2;
  };
  return g;
}

// CONE_SPRAY — a forward wedge sized to the spell's cast range and half-angle
// (fireSpray's `spread`, push's `cone`), oriented on the caster's facing
// (matches how push/fireSpray actually resolve their hit-cone in spells.js).
function buildConeSpray(color, params = {}) {
  const halfAngle = params.cone ?? params.spread ?? 0.6;
  const range = Math.max(1, params.range ?? 12);
  const { prim, sec } = _wedgeGeo(halfAngle);
  const shape = _buildDuoGroundShape(prim, sec, color, { opacity: 0.5, scale: range });
  const g = new THREE.Group();
  g.add(shape.secondary, shape.primary);
  g.userData.recolor = shape.recolor;
  g.userData.dispose = shape.dispose;
  g.userData.update = (state = {}) => {
    const cx = state.casterX ?? 0, cz = state.casterZ ?? 0;
    const px = state.point?.x, pz = state.point?.z;
    const angle = Number.isFinite(state.casterAim)
      ? state.casterAim
      : Math.atan2((pz ?? cz) - cz, (px ?? cx + 1) - cx);
    g.position.set(cx, 0, cz);
    g.rotation.y = -angle;
  };
  return g;
}

// GROUND_AOE_AT_POINT — blast-radius ring at the cursor, clamped to the
// spell's cast range from the caster; a faint boundary ring around the
// caster previews that clamp radius.
function buildGroundAoe(color, params = {}) {
  const radius = Math.max(0.5, params.radius ?? 4);
  const range = params.range;
  const shape = _buildDuoGroundShape(_ringGeo, _ringSecGeo, color, { opacity: 0.65, scale: radius });
  const g = new THREE.Group();
  g.add(shape.secondary, shape.primary);

  let rangeRing = null, rangeMat = null;
  if (Number.isFinite(range) && range > 0) {
    rangeMat = new THREE.MeshBasicMaterial({
      color: secondaryColor(color), transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false,
    });
    rangeRing = new THREE.Mesh(_ringGeo, rangeMat);
    rangeRing.rotation.x = -Math.PI / 2;
    rangeRing.scale.set(range, range, 1);
    rangeRing.position.y = 0.03;
    g.add(rangeRing);
  }

  g.userData.recolor = (c) => { shape.recolor(c); if (rangeMat) rangeMat.color.setHex(secondaryColor(c)); };
  g.userData.dispose = () => { shape.dispose(); if (rangeMat) rangeMat.dispose(); };
  g.userData.update = (state = {}) => {
    const cx = state.casterX ?? 0, cz = state.casterZ ?? 0;
    const px = state.point?.x ?? cx, pz = state.point?.z ?? cz;
    const clamped = _clampToRange(cx, cz, px, pz, range);
    g.position.set(clamped.x, 0, clamped.z);
    // rangeRing is a child of g (which now sits at the clamped point), so
    // offset it back to the caster in local space.
    if (rangeRing) rangeRing.position.set(cx - clamped.x, 0.03, cz - clamped.z);
  };
  return g;
}

// BLINK_MOVE_TO_POINT — a small hovering marker + landing ring at the
// (range-clamped) cursor point.
function buildBlink(color, params = {}) {
  const range = params.range ?? 10;
  const markerMat = new THREE.MeshLambertMaterial({ color, emissive: color, emissiveIntensity: 1.1, flatShading: true });
  const marker = new THREE.Mesh(_shardGeo, markerMat);
  marker.castShadow = false;
  marker.scale.set(0.22, 0.5, 0.22);
  marker.position.y = 1.0;
  const shape = _buildDuoGroundShape(_ringGeo, _ringSecGeo, color, { opacity: 0.6, scale: 0.9 });

  const g = new THREE.Group();
  g.add(shape.secondary, shape.primary, marker);
  g.userData.recolor = (c) => { markerMat.color.setHex(c); markerMat.emissive.setHex(c); shape.recolor(c); };
  g.userData.dispose = () => { markerMat.dispose(); shape.dispose(); };
  g.userData.update = (state = {}) => {
    const cx = state.casterX ?? 0, cz = state.casterZ ?? 0;
    const px = state.point?.x ?? cx, pz = state.point?.z ?? cz;
    const clamped = _clampToRange(cx, cz, px, pz, range);
    g.position.set(clamped.x, 0, clamped.z);
  };
  return g;
}

// NEAREST_TARGET_LOCK — a corner bracket on the nearest valid enemy in range
// (renderer-supplied `target`), falling back to the range-clamped cursor
// point when no target is currently in range.
function buildTargetLock(color, params = {}) {
  const range = params.range ?? 14;
  const g = _buildBracket(color, { size: 0.7 });
  g.userData.update = (state = {}) => {
    const cx = state.casterX ?? 0, cz = state.casterZ ?? 0;
    let pos;
    if (state.target) pos = { x: state.target.x, z: state.target.z };
    else pos = _clampToRange(cx, cz, state.point?.x ?? cx, state.point?.z ?? cz, range);
    g.position.set(pos.x, 0, pos.z);
  };
  return g;
}

// TETHER_LOCK — corner bracket on the locked target/point plus a persistent
// connecting beam back to the caster, echoing drain/link/pull/drag's
// caster<->target shape.
function buildTether(color, params = {}) {
  const range = params.range ?? 14;
  const bracket = _buildBracket(color, { size: 0.55 });
  const beamMat = new THREE.MeshBasicMaterial({ color: secondaryColor(color), transparent: true, opacity: 0.5, depthWrite: false });
  const beam = new THREE.Mesh(_beamGeo, beamMat);
  beam.castShadow = false;

  const g = new THREE.Group();
  g.add(beam, bracket);
  g.userData.recolor = (c) => { bracket.userData.recolor(c); beamMat.color.setHex(secondaryColor(c)); };
  g.userData.dispose = () => { bracket.userData.dispose(); beamMat.dispose(); };
  g.userData.update = (state = {}) => {
    const cx = state.casterX ?? 0, cz = state.casterZ ?? 0;
    let pos;
    if (state.target) pos = { x: state.target.x, z: state.target.z };
    else pos = _clampToRange(cx, cz, state.point?.x ?? cx, state.point?.z ?? cz, range);
    bracket.position.set(pos.x, 0, pos.z);
    const dx = pos.x - cx, dz = pos.z - cz;
    const dist = Math.max(0.01, Math.hypot(dx, dz));
    const angle = Math.atan2(dz, dx);
    beam.position.set((cx + pos.x) / 2, 1.0, (cz + pos.z) / 2);
    beam.rotation.y = -angle + Math.PI / 2;
    beam.scale.set(0.06, 0.06, dist);
  };
  return g;
}

// SELF_AOE — a radius ring centered on (and following) the caster. Not
// currently reachable via the hold-to-aim flow (vacuum is instant-cast like
// every SELF_* spell — see isSelfAim()) but kept correct/usable for any
// future self-centered channel spell.
function buildSelfAoe(color, params = {}) {
  const radius = Math.max(0.5, params.radius ?? 5);
  const shape = _buildDuoGroundShape(_ringGeo, _ringSecGeo, color, { opacity: 0.5, scale: radius });
  const g = new THREE.Group();
  g.add(shape.secondary, shape.primary);
  g.userData.recolor = shape.recolor;
  g.userData.dispose = shape.dispose;
  g.userData.update = (state = {}) => { g.position.set(state.casterX ?? 0, 0, state.casterZ ?? 0); };
  return g;
}

// SELF_BUFF — instant self-casts never enter the aim flow (isSelfAim() below
// routes them straight to queueCast on keydown), so this reticle is built
// only defensively and starts hidden.
function buildSelfBuff(color) {
  const shape = _buildDuoGroundShape(_ringGeo, _ringSecGeo, color, { opacity: 0.3, scale: 1.1 });
  const g = new THREE.Group();
  g.add(shape.secondary, shape.primary);
  g.visible = false;
  g.userData.recolor = shape.recolor;
  g.userData.dispose = shape.dispose;
  g.userData.update = (state = {}) => { g.position.set(state.casterX ?? 0, 0, state.casterZ ?? 0); };
  return g;
}

// DASH_IMPACT — thrust's composite reticle: the DIRECTIONAL_PROJECTILE arrow
// plus a small impact ring at the estimated dash-landing point.
function buildDashImpact(color, params = {}) {
  const arrow = buildDirectional(color);
  const landDist = Math.max(2, (params.shockRadius ?? 3) * 1.4 + 1.5);
  const shape = _buildDuoGroundShape(_ringGeo, _ringSecGeo, color, { opacity: 0.5, scale: params.shockRadius ?? 3 });

  const g = new THREE.Group();
  g.add(arrow, shape.secondary, shape.primary);
  g.userData.recolor = (c) => { arrow.userData.recolor(c); shape.recolor(c); };
  g.userData.dispose = () => { arrow.userData.dispose(); shape.dispose(); };
  g.userData.update = (state = {}) => {
    arrow.userData.update(state);
    const cx = state.casterX ?? 0, cz = state.casterZ ?? 0;
    const px = state.point?.x ?? cx + 1, pz = state.point?.z ?? cz;
    const angle = Math.atan2(pz - cz, px - cx);
    shape.primary.position.set(cx + Math.cos(angle) * landDist, shape.primary.position.y, cz + Math.sin(angle) * landDist);
    shape.secondary.position.set(cx + Math.cos(angle) * landDist, shape.secondary.position.y, cz + Math.sin(angle) * landDist);
  };
  return g;
}

// Generic fallback — a faceted duo ring following (and range-clamped to) the
// cursor, for any spell missing (or with an unrecognized) `aim`. Mirrors
// duotone.js's getVfx() generic-fallback contract.
function buildGenericReticle(color) {
  const shape = _buildDuoGroundShape(_ringGeo, _ringSecGeo, color, { opacity: 0.5, scale: 1.2 });
  const g = new THREE.Group();
  g.add(shape.secondary, shape.primary);
  g.userData.recolor = shape.recolor;
  g.userData.dispose = shape.dispose;
  g.userData.update = (state = {}) => {
    const cx = state.casterX ?? 0, cz = state.casterZ ?? 0;
    const clamped = _clampToRange(cx, cz, state.point?.x ?? cx, state.point?.z ?? cz, state.range);
    g.position.set(clamped.x, 0, clamped.z);
  };
  return g;
}

export const RETICLE_ARCHETYPES = {
  DIRECTIONAL_PROJECTILE: (color) => buildDirectional(color),
  CONE_SPRAY: (color, params) => buildConeSpray(color, params),
  GROUND_AOE_AT_POINT: (color, params) => buildGroundAoe(color, params),
  BLINK_MOVE_TO_POINT: (color, params) => buildBlink(color, params),
  NEAREST_TARGET_LOCK: (color, params) => buildTargetLock(color, params),
  TETHER_LOCK: (color, params) => buildTether(color, params),
  SELF_AOE: (color, params) => buildSelfAoe(color, params),
  SELF_BUFF: (color) => buildSelfBuff(color),
  DASH_IMPACT: (color, params) => buildDashImpact(color, params),
};

// Resolve a spell id to its reticle archetype + a build(color) factory.
// Falls back to a generic faceted ring for any spell with a missing or
// unrecognized `aim` (matches src/vfx/duotone.js's getVfx() fallback
// contract so callers never need a null check).
export function getReticle(spellId) {
  const spell = SPELLS[spellId];
  const archetype = spell?.aim;
  const builder = archetype && RETICLE_ARCHETYPES[archetype];
  return {
    archetype: builder ? archetype : "GENERIC",
    params: spell || {},
    build: (color = spell?.color ?? 0x8888ff) =>
      builder ? builder(color, spell || {}) : buildGenericReticle(color),
  };
}

// SELF_BUFF/SELF_AOE spells cast instantly on keydown (no hold-to-aim) —
// src/input.js checks this before deciding whether to start an aim hold or
// queue the cast immediately.
export function isSelfAim(spellId) {
  const a = SPELLS[spellId]?.aim;
  return a === "SELF_BUFF" || a === "SELF_AOE";
}
