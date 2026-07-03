// Shared 3D "duotone" VFX foundation — the in-game expression of the bespoke
// SVG spell icons in src/spell-icons.js. Every icon is a full-opacity
// faceted PRIMARY shape + a ~0.45-opacity translucent SECONDARY accent layer
// + thin motion/spark lines, all tinted from the spell's `.color`. This
// module gives every spell VFX group the same recipe in 3D:
//   - flat-shaded emissive primary mesh (MeshLambertMaterial)
//   - a slightly larger, translucent unlit secondary shell (MeshBasicMaterial)
//   - a pooled, capped faceted-streak trail for projectiles
//   - a registry (VFX_REGISTRY / getVfx) so per-spell VFX modules can plug
//     bespoke cast/impact/core builders in without every caller needing a
//     spell-by-spell switch statement.
//
// This is a leaf-ish module: it imports `three`, lowpoly.ts's faceted
// builders, and config.ts (for SPELLS/CFG) — nothing from voxel.js/renderer.js,
// so it stays reusable from any per-spell VFX group file.
//
// PROJECTILE_VFX/AOE_VFX/BEAM_VFX/UTILITY_VFX are deferred to their own P4
// issues (still .js) — VFX_REGISTRY/VfxEntry below are this file's OWN typed
// contract for getVfx() callers; Object.assign merges the untyped slices in
// at runtime same as before (types aren't cross-checked against them, so the
// deferred siblings staying .js doesn't weaken this file's own typing).
import * as THREE from "three";
import { CFG, SPELLS } from "../config.js";
import { facetedOrb, type LowPolyOpts } from "../lowpoly.js";
import { PROJECTILE_VFX } from "./projectiles.js";
import { AOE_VFX } from "./aoe.js";
import { BEAM_VFX } from "./beams.js";
import { UTILITY_VFX } from "./utility.js";

// ---------------------------------------------------------------------------
// Color helpers — derive the duotone accent tint from a spell's base color.
// ---------------------------------------------------------------------------

// Lighter, slightly desaturated tint of `hex` — the 3D analogue of the SVG
// icon's ~0.45-opacity secondary layer (which reads lighter/washed-out
// against the faceted primary shape even before opacity is applied).
export function secondaryColor(hex: number, opts: { lift?: number; desaturate?: number } = {}): number {
  const hsl = { h: 0, s: 0, l: 0 };
  new THREE.Color(hex).getHSL(hsl);
  const lift = opts.lift ?? 0.22;
  const desaturate = opts.desaturate ?? 0.1;
  const out = new THREE.Color();
  out.setHSL(hsl.h, Math.max(0, hsl.s - desaturate), Math.min(0.92, hsl.l + lift));
  return out.getHex();
}

// Lighten `hex` by `amt` (0..1) in HSL space, hue/saturation preserved. Used
// for highlight facets, spark lines, and hot cores.
export function brighten(hex: number, amt = 0.25): number {
  const hsl = { h: 0, s: 0, l: 0 };
  new THREE.Color(hex).getHSL(hsl);
  const out = new THREE.Color();
  out.setHSL(hsl.h, hsl.s, Math.min(1, hsl.l + amt));
  return out.getHex();
}

/** Option bag facetedDuo draws from — geometry-mode also honors the
 * placement fields (x/y/z/rx/ry/rz/cast); builder-mode forwards `opts`
 * through unchanged to the caller-supplied builder function. */
export interface FacetedDuoOpts extends LowPolyOpts {
  emissiveIntensity?: number;
  secondaryScale?: number;
  secondaryOpacity?: number;
  radius?: number;
}

function _placeMesh<T extends THREE.Object3D>(mesh: T, opts: FacetedDuoOpts = {}): T {
  mesh.position.set(opts.x ?? 0, opts.y ?? 0, opts.z ?? 0);
  mesh.rotation.set(opts.rx ?? 0, opts.ry ?? 0, opts.rz ?? 0);
  return mesh;
}

/** Feature-detected surface facetedDuo reads/writes on a primary mesh's
 * material (Lambert-flat or Basic — never Standard, see design §0). */
type DuotoneMaterial = THREE.Material & Partial<{ color: THREE.Color; emissive: THREE.Color; emissiveIntensity: number }>;

// ---------------------------------------------------------------------------
// facetedDuo — the reusable 3D duotone primitive
// ---------------------------------------------------------------------------

export type FacetedDuoBuilder = (color: number, opts: FacetedDuoOpts) => THREE.Mesh;

// Build a duotone faceted Group: a flat-shaded emissive PRIMARY mesh + a
// translucent, slightly larger SECONDARY accent shell (unlit, ~0.45 opacity)
// sharing the primary's geometry.
//
//   coreGeoOrBuilder — either:
//     - a THREE.BufferGeometry to wrap directly (caller retains ownership;
//       facetedDuo never disposes geometry it did not create itself), or
//     - a builder function `(color, opts) -> THREE.Mesh` — typically a thin
//       wrapper around a lowpoly.ts faceted builder, e.g.
//       `(color, opts) => facetedOrb(0.4, color, opts)`. The returned mesh's
//       geometry is reused for the secondary shell and its material's
//       emissiveIntensity is normalized to `opts.emissiveIntensity`.
//   color   — base spell color (hex number)
//   opts    — { emissiveIntensity=1, secondaryScale=1.35, secondaryOpacity=0.45,
//               x, y, z, rx, ry, rz, cast }  (geometry-mode also honors the
//               placement fields; builder-mode forwards `opts` through)
//
// Returns a THREE.Group with userData.primary / .secondary meshes, plus the
// same recolor()/dispose() contract src/pool.js and src/voxel.js already
// rely on for pooled/cached instances.
export function facetedDuo(coreGeoOrBuilder: THREE.BufferGeometry | FacetedDuoBuilder, color: number, opts: FacetedDuoOpts = {}): THREE.Group {
  const emissiveIntensity = opts.emissiveIntensity ?? 1;
  const secondaryScale = opts.secondaryScale ?? 1.35;
  const secondaryOpacity = opts.secondaryOpacity ?? 0.45;

  const g = new THREE.Group();
  let primary: THREE.Mesh;
  let coreGeo: THREE.BufferGeometry;
  const ownsGeo = typeof coreGeoOrBuilder === "function";

  if (ownsGeo) {
    primary = coreGeoOrBuilder(color, opts);
    coreGeo = primary.geometry;
    const mat = primary.material as DuotoneMaterial;
    if (mat && "emissiveIntensity" in mat) {
      mat.emissiveIntensity = emissiveIntensity;
    }
  } else {
    coreGeo = coreGeoOrBuilder;
    const mat = new THREE.MeshLambertMaterial({
      color, emissive: color, emissiveIntensity, flatShading: true,
    });
    primary = _placeMesh(new THREE.Mesh(coreGeo, mat), opts);
    primary.castShadow = opts.cast ?? false;
    primary.receiveShadow = false;
  }

  const secMat = new THREE.MeshBasicMaterial({
    color: secondaryColor(color),
    transparent: true,
    opacity: secondaryOpacity,
    depthWrite: false,
  });
  const secondary = new THREE.Mesh(coreGeo, secMat);
  secondary.castShadow = false;
  secondary.receiveShadow = false;
  secondary.scale.setScalar(secondaryScale);
  secondary.rotation.copy(primary.rotation);
  secondary.position.copy(primary.position);

  g.add(secondary, primary);
  g.userData.primary = primary;
  g.userData.secondary = secondary;
  g.userData.recolor = (newColor: number) => {
    const mat = primary.material as DuotoneMaterial;
    if (mat?.color) mat.color.setHex(newColor);
    if (mat && "emissive" in mat && mat.emissive) mat.emissive.setHex(newColor);
    secMat.color.setHex(secondaryColor(newColor));
  };
  // Only dispose resources facetedDuo actually created itself: the geometry
  // when a builder produced it (owned by this Group alone, matching
  // lowpoly.ts's per-call-fresh-geometry pattern), and both materials
  // (always instance-owned). Geometry passed in directly by the caller is
  // never disposed here — it may be a cache-owned resource (voxel.js-style)
  // that other instances still reference.
  g.userData.dispose = () => {
    (primary.material as THREE.Material | undefined)?.dispose?.();
    secMat.dispose();
    if (ownsGeo) coreGeo?.dispose?.();
  };
  return g;
}

// ---------------------------------------------------------------------------
// TrailPool — pooled, capped faceted-streak projectile trails
// ---------------------------------------------------------------------------
// Shared shard geometry — every pooled streak shard reuses this single
// OctahedronGeometry. Cache-owned, mirrors voxel.js's _boltGeoCache pattern:
// NEVER dispose it, it is shared for the lifetime of the module.
const _trailShardGeo = new THREE.OctahedronGeometry(0.5, 0);

type ShardMesh = THREE.Mesh<THREE.OctahedronGeometry, THREE.MeshLambertMaterial>;

// Pre-allocated pool of shard Mesh instances, sized by CFG.TRAIL_POOL_SIZE so
// the total GPU/JS cost of every trail streak in flight — across every
// active projectile at once — stays bounded no matter how many bolts are
// on screen. Materials are cache-owned per pool slot (created once, reused
// via recolor, never disposed) — the same non-disposal contract as
// voxel.js's _boltMatCache.
const _shardPool: ShardMesh[] = [];
function _ensurePool(): void {
  if (_shardPool.length) return;
  for (let i = 0; i < CFG.TRAIL_POOL_SIZE; i++) {
    const mat = new THREE.MeshLambertMaterial({
      color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 1.1, flatShading: true,
      transparent: true, opacity: 0,
    });
    const m: ShardMesh = new THREE.Mesh(_trailShardGeo, mat);
    m.castShadow = false;
    m.receiveShadow = false;
    m.visible = false;
    m.userData.free = true;
    _shardPool.push(m);
  }
}

// Acquire a free pooled shard mesh, or null if every slot is currently in
// use (callers should skip the spawn rather than allocate — this is the
// hard perf cap). Never builds new geometry/materials beyond the pre-sized
// pool.
function _acquireShard(): ShardMesh | null {
  _ensurePool();
  for (const m of _shardPool) {
    if (m.userData.free) { m.userData.free = false; return m; }
  }
  return null;
}

// Return a shard mesh to the pool: hides it, detaches it from its current
// parent, and never disposes its cache-owned geometry/material.
function _releaseShard(m: ShardMesh | null): void {
  if (!m) return;
  m.userData.free = true;
  m.visible = false;
  if (m.parent) m.parent.remove(m);
}

export interface TrailEmitter {
  update(dt: number): void;
  dispose(): void;
}

// Bind a pooled, capped faceted-streak trail emitter to a projectile group.
// Call `emitter.update(dt)` every frame while the bolt is alive (from the
// same loop that advances the bolt's position/parent) — it periodically
// samples the bolt's current world position and spawns a short-lived,
// flat-shaded emissive faceted shard there that shrinks and fades over its
// life. Concurrently-alive shards are capped per-emitter at
// CFG.TRAIL_MAX_SEGMENTS (oldest recycled to make room for the newest), and
// the shard meshes themselves are drawn from the shared CFG.TRAIL_POOL_SIZE
// pool above, so no single trail — nor all trails combined — can allocate
// unbounded geometry/materials.
//
//   boltGroup — the THREE.Object3D being trailed; shards spawn at its current
//               world position and are added as siblings under its parent
//               (so they stay put as the bolt continues on).
//   color     — base spell color; shards are tinted with secondaryColor(color)
//               and glow with the base color as their emissive.
//   opts      — { every=0.035 (spawn cadence, s), life=0.22 (fade duration, s),
//                 size=0.16, maxSegments=CFG.TRAIL_MAX_SEGMENTS }
//
// Returns { update(dt), dispose() }. Call dispose() when the bolt itself is
// released (e.g. back to src/pool.js) so its shards return to the shared
// pool immediately instead of waiting out their fade.
function createTrailEmitter(boltGroup: THREE.Object3D, color: number, opts: { every?: number; life?: number; size?: number; maxSegments?: number } = {}): TrailEmitter {
  const everySec = opts.every ?? 0.035;
  const life = opts.life ?? 0.22;
  const size = opts.size ?? 0.16;
  const maxSegs = Math.max(1, Math.min(opts.maxSegments ?? CFG.TRAIL_MAX_SEGMENTS, CFG.TRAIL_MAX_SEGMENTS));
  const tint = secondaryColor(color);
  const alive: { mesh: ShardMesh; t: number }[] = [];
  const worldPos = new THREE.Vector3();
  let sinceSpawn = 0;

  function _spawn(parent: THREE.Object3D): void {
    let mesh = _acquireShard();
    if (!mesh) {
      // Global pool exhausted — recycle this emitter's own oldest shard so
      // the trail degrades gracefully instead of dropping silently.
      const oldest = alive.shift();
      if (!oldest) return;
      mesh = oldest.mesh;
    } else if (alive.length >= maxSegs) {
      // Per-emitter cap reached even though the global pool had room —
      // release our own oldest to keep this trail's segment count bounded.
      const oldest = alive.shift();
      if (oldest) _releaseShard(oldest.mesh);
    }
    boltGroup.getWorldPosition(worldPos);
    mesh.position.copy(worldPos);
    mesh.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, 0);
    mesh.scale.set(size * 0.6, size, size * 0.6);
    mesh.material.color.setHex(tint);
    mesh.material.emissive.setHex(color);
    mesh.material.opacity = 0.55;
    mesh.visible = true;
    if (parent && mesh.parent !== parent) parent.add(mesh);
    alive.push({ mesh, t: 0 });
  }

  return {
    update(dt: number) {
      const parent = boltGroup.parent;
      sinceSpawn += dt;
      if (parent && sinceSpawn >= everySec) {
        sinceSpawn = 0;
        _spawn(parent);
      }
      for (let i = alive.length - 1; i >= 0; i--) {
        const a = alive[i];
        a.t += dt;
        const k = a.t / life;
        if (k >= 1) {
          _releaseShard(a.mesh);
          alive.splice(i, 1);
          continue;
        }
        a.mesh.material.opacity = 0.55 * (1 - k);
        const s = size * (1 - k * 0.6);
        a.mesh.scale.set(s * 0.6, s, s * 0.6);
      }
    },
    // Release every shard this emitter currently owns back to the shared
    // pool immediately (does not touch other emitters' shards).
    dispose() {
      for (const a of alive) _releaseShard(a.mesh);
      alive.length = 0;
    },
  };
}

export const TrailPool = {
  acquire: _acquireShard,
  release: _releaseShard,
  createEmitter: createTrailEmitter,
};

// ---------------------------------------------------------------------------
// VFX_REGISTRY / getVfx — per-spell VFX lookup with a generic fallback
// ---------------------------------------------------------------------------

/** ctx passed to cast()/impact(): mirrors renderer.js's _addEffect/_ringPulse/
 * _burstAt so registry entries can be written without importing renderer.js
 * directly. Left loosely typed ([key: string]: unknown) since the deferred
 * per-spell VFX group files (still .js) each read a slightly different
 * subset. */
export type VfxCtx = { x: number; z: number; y?: number; color: number; [key: string]: unknown };

// Populated by per-spell VFX group files (added spell-by-spell in follow-up
// work), keyed by spellId.
export interface VfxEntry {
  color: number;
  /** optional bolt `kind` (voxel.js buildBolt) */
  proj?: string;
  /** faceted duotone core (idle/inventory look) */
  buildCore: (color?: number) => THREE.Group;
  /** one-shot cast VFX (renderer effect contract) */
  cast: (ctx: VfxCtx) => THREE.Object3D | null;
  /** one-shot impact/hit VFX */
  impact: (ctx: VfxCtx) => THREE.Object3D | null;
  /** whether projectiles of this spell get a TrailPool trail */
  trail?: boolean;
}

export const VFX_REGISTRY: Record<string, VfxEntry> = {};

// Merge every per-spell VFX group slice in. Two spellIds are intentionally
// claimed by more than one slice, so merge order picks a deliberate winner
// for each (Object.assign: later slices overwrite earlier ones on the same
// key) rather than leaving it to import order accidents:
//   - "meteor":  PROJECTILE_VFX.meteor covers the falling-bolt look (unused
//     by buildBolt routing since meteor.proj is null — it travels via
//     voxel.js's dedicated buildMeteor, not a Bolt); AOE_VFX.meteor covers
//     the actual meteorCast/meteorImpact ground-telegraph + impact-burst
//     events renderer.js dispatches, so AOE_VFX must win here.
//   - "drain":   UTILITY_VFX.drain is a single-point charge-steal sparkle;
//     BEAM_VFX.drain is the full caster<->target siphon beam matching the
//     actual "drain" event's two-endpoint shape (and is the documented
//     drop-in upgrade for the old buildLightning(x1,z1,x2,z2,...) call), so
//     BEAM_VFX must win here.
// PROJECTILE_VFX and UTILITY_VFX are listed first (no shared keys with each
// other) so the two collisions above are resolved purely by AOE_VFX/BEAM_VFX
// coming later, not by their own relative order.
Object.assign(VFX_REGISTRY, PROJECTILE_VFX, UTILITY_VFX, AOE_VFX, BEAM_VFX);

// Generic faceted core builder used by the getVfx() fallback for any spell
// that has no bespoke registry entry yet.
function _genericCoreBuilder(color: number, opts: FacetedDuoOpts = {}): THREE.Mesh {
  return facetedOrb(opts.radius ?? 0.4, color, opts);
}

// Look up a spell's VFX registry entry, or synthesize a safe generic fallback
// so every caller always gets a usable entry (color + a duotone core + inert
// cast/impact no-ops) even before that spell has bespoke VFX authored.
export function getVfx(spellId: string): VfxEntry {
  const entry = VFX_REGISTRY[spellId];
  if (entry) return entry;
  const color = (SPELLS[spellId]?.color as number | undefined) ?? 0x8888ff;
  return {
    color,
    buildCore: (c = color) => facetedDuo(_genericCoreBuilder, c, {}),
    cast: () => null,
    impact: () => null,
  };
}
