// Faceted duotone VFX for AoE / point-target spells: meteor, explode,
// gravity, vacuum, stun, target, push, disable. Each builder below echoes
// its src/spell-icons.js SVG silhouette in 3D:
//   gravity  -> concentric rings collapsing inward + an implosion burst
//   explode  -> a collapsing telegraph ring, then starburst shards + a
//               snapping ring (meteor shares the same starburst+ring recipe
//               for its ground impact)
//   vacuum   -> an inward-drawing ring + inward shard burst while channeling,
//               then a final implosion on release
//   stun     -> two/three converging jagged "zigzag" streaks (src/spell-icons.js
//               `stun` is two lightning-bolt zigzags meeting at a point)
//   target   -> a four-corner crosshair reticle collapsing inward around a
//               brightening diamond core (echoes the reticle + diamond icon)
//   push     -> a directional cone wave of nested arcs (icon: nested arcs +
//               an arrowhead); falls back to a full radial nova of arcs when
//               no facing angle is available
//   disable  -> a binding ring + radiating "slash" ticks (icon: forbiddance
//               ring/slash + radiating lines)
//
// Same recipe as src/vfx/duotone.js: an opaque, flat-shaded/emissive PRIMARY
// layer + a ~0.45-opacity translucent SECONDARY accent layer, tinted from the
// spell's `.color`, with thin faceted streaks standing in for the icons'
// motion/spark lines. No gradients, no smooth shading.
//
// Ground-plane decals (rings, cones, reticles) use unlit MeshBasicMaterial —
// the same convention as renderer.js's _ringPulse/_buildChannelDecal and
// voxel.js's buildMeteor ring: a flat ground plane reads flat/dark under
// directional lighting from most camera angles, so decals stay unlit and
// let opacity/color do the work. Volumetric shard bursts use flat-shaded
// emissive MeshLambertMaterial, matching voxel.js's buildBurst.
//
// Every cast(ctx)/impact(ctx) below adds every visual layer itself via
// `ctx.addEffect(...)` (a telegraph is rarely a single mesh — rings + shard
// bursts + streaks stack together) and always returns null; there is
// nothing left for the caller to add. `ctx` mirrors src/vfx/duotone.js's
// VFX_REGISTRY contract: `{ x, z, y, color, addEffect, ringPulse, burstAt }`.
// A few builders also read optional, spell-specific ctx fields when present
// (`ctx.radius`, `ctx.angle`, `ctx.spread`) and fall back to sensible
// defaults when they are not — the base contract does not guarantee them.
//
// Every effect Group follows the renderer.js transient-effect convention:
// userData.update(dt), userData.done, and userData.dispose() for the
// per-instance (never cache-shared) geometry/materials each builder here
// creates fresh per call. Particle counts are clamped to
// CFG.BURST_MAX_PARTICLES, matching voxel.js's buildBurst cap.
import * as THREE from "three";
import { CFG, SPELLS } from "../config.js";
import { facetedOrb, facetedCrystal, facetedShard, facetedCone, facetedRock } from "../lowpoly.js";
import { facetedDuo, secondaryColor, brighten } from "./duotone.js";

// ---------------------------------------------------------------------------
// Base tints — pulled from config.js SPELLS so this file stays in sync with
// balance/color changes there; hard-coded fallbacks only guard against a
// spell entry being renamed/removed out from under this module.
// ---------------------------------------------------------------------------
const METEOR_COLOR  = SPELLS.meteor?.color  ?? 0xff3a1e;
const EXPLODE_COLOR = SPELLS.explode?.color ?? 0xff6a1e;
const GRAVITY_COLOR = SPELLS.gravity?.color ?? 0x4a2fb0;
const VACUUM_COLOR  = SPELLS.vacuum?.color  ?? 0x6c4cff;
const STUN_COLOR    = SPELLS.stun?.color    ?? 0xffe14c;
const TARGET_COLOR  = SPELLS.target?.color  ?? 0x9c2bff;
const PUSH_COLOR    = SPELLS.push?.color    ?? 0xaef0ff;
const DISABLE_COLOR = SPELLS.disable?.color ?? 0xbbbbbb;

// ---------------------------------------------------------------------------
// Shared ground-decal / burst primitives — every per-spell cast()/impact()
// below composes from these so the duotone recipe and perf caps stay
// consistent across all eight spells rather than each hand-rolling one off.
// ---------------------------------------------------------------------------

// Low segment count so ring decals read as faceted polygons rather than
// smooth circles — the 3D analogue of the SVG icons' faceted primary shapes.
const _RING_SEGMENTS = 12;

// A duotone ground ring: an opaque faceted PRIMARY band + a wider ~0.45
// translucent SECONDARY band beneath it, both unlit (ground-decal
// convention). `opts.grow` (world units) is how much the ring's radius
// changes over its life — positive expands outward (a shockwave), negative
// contracts toward the center (a "collapsing inward" telegraph).
function _duoRing(x, z, radius, color, opts = {}) {
  const life = opts.life ?? 0.55;
  const thickness = opts.thickness ?? 0.4;
  const grow = opts.grow ?? radius * 1.6;
  const y = opts.y ?? 0.14;
  const baseOpacity = opts.opacity ?? 0.85;
  const secColor = secondaryColor(color);

  const g = new THREE.Group();
  const r0 = Math.max(0.05, radius);
  const primGeo = new THREE.RingGeometry(r0, r0 + thickness, _RING_SEGMENTS);
  const primMat = new THREE.MeshBasicMaterial({
    color, transparent: true, opacity: baseOpacity, side: THREE.DoubleSide, depthWrite: false,
  });
  const primary = new THREE.Mesh(primGeo, primMat);
  primary.rotation.x = -Math.PI / 2;
  primary.position.set(x, y, z);

  const secGeo = new THREE.RingGeometry(Math.max(0.02, r0 * 0.55), r0 + thickness * 2.6, _RING_SEGMENTS);
  const secMat = new THREE.MeshBasicMaterial({
    color: secColor, transparent: true, opacity: baseOpacity * 0.5, side: THREE.DoubleSide, depthWrite: false,
  });
  const secondary = new THREE.Mesh(secGeo, secMat);
  secondary.rotation.x = -Math.PI / 2;
  secondary.position.set(x, y - 0.02, z);

  g.add(secondary, primary);
  g.userData.t = 0;
  g.userData.life = life;
  g.userData.done = false;
  g.userData.update = (dt) => {
    g.userData.t += dt;
    const k = Math.min(1, g.userData.t / life);
    const scale = Math.max(0.01, 1 + k * (grow / r0));
    primary.scale.setScalar(scale);
    secondary.scale.setScalar(scale * 1.05);
    const fade = 1 - k;
    primMat.opacity = baseOpacity * fade;
    secMat.opacity = baseOpacity * 0.5 * fade;
    if (k >= 1) g.userData.done = true;
  };
  g.userData.dispose = () => {
    primGeo.dispose(); primMat.dispose();
    secGeo.dispose(); secMat.dispose();
  };
  return g;
}

// A duotone faceted shard burst: alternating full-opacity PRIMARY-tinted and
// ~0.55-opacity SECONDARY-tinted octahedron shards, sharing one geometry
// (voxel.js buildBurst's per-burst-shared-geo pattern). `opts.inward`
// reverses the burst into an implosion — shards start at `opts.startRadius`
// and fly toward the center instead of outward (used for vacuum/gravity's
// pull-then-release beats).
function _duoShardBurst(x, z, color, opts = {}) {
  const count = Math.min(opts.count ?? 16, CFG.BURST_MAX_PARTICLES);
  const speed = opts.speed ?? 9;
  const life = opts.life ?? 0.5;
  const y = opts.y ?? 1.0;
  const size = opts.size ?? 0.24;
  const inward = opts.inward ?? false;
  const startRadius = opts.startRadius ?? 3.5;
  const secColor = secondaryColor(color);

  const g = new THREE.Group();
  const shardGeo = new THREE.OctahedronGeometry(0.5, 0);
  const parts = [];
  for (let i = 0; i < count; i++) {
    const primaryTone = i % 2 === 0;
    const tint = primaryTone ? color : secColor;
    const mat = new THREE.MeshLambertMaterial({
      color: tint, emissive: tint, emissiveIntensity: primaryTone ? 1.1 : 0.5,
      flatShading: true, transparent: true, opacity: primaryTone ? 1 : 0.55,
    });
    const m = new THREE.Mesh(shardGeo, mat);
    m.castShadow = false;
    const s = size * (primaryTone ? 1 : 1.3);
    const bs = { x: s * 0.45, y: s, z: s * 0.45 };
    m.scale.set(bs.x, bs.y, bs.z);
    m.userData.baseScale = bs;
    m.userData.baseOpacity = primaryTone ? 1 : 0.55;

    const a = (i / count) * Math.PI * 2 + Math.random() * 0.35;
    const el = (Math.random() - 0.2) * 1.1;
    const sp = speed * (0.6 + Math.random() * 0.5) * (inward ? -1 : 1);
    const r0 = inward ? startRadius : 0;
    m.position.set(Math.cos(a) * r0, 0, Math.sin(a) * r0);
    m.userData.v = new THREE.Vector3(Math.cos(a) * sp, inward ? 0 : el * sp * 0.5 + 2.5, Math.sin(a) * sp);
    g.add(m); parts.push(m);
  }
  g.position.set(x, y, z);
  g.userData.t = 0;
  g.userData.life = life;
  g.userData.done = false;
  g.userData.update = (dt) => {
    g.userData.t += dt;
    const k = g.userData.t / life;
    for (const m of parts) {
      m.position.addScaledVector(m.userData.v, dt);
      if (!inward) m.userData.v.y -= 12 * dt;
      m.userData.v.multiplyScalar(1 - 1.4 * dt);
      m.rotation.x += dt * 6; m.rotation.y += dt * 5;
      const fadeK = Math.min(1, inward ? k * 1.6 : k);
      m.material.opacity = Math.max(0, m.userData.baseOpacity * (1 - fadeK));
      const factor = Math.max(0.1, 1 - k * 0.35);
      const bs = m.userData.baseScale;
      m.scale.set(bs.x * factor, bs.y * factor, bs.z * factor);
    }
    if (k >= 1) g.userData.done = true;
  };
  g.userData.dispose = () => {
    shardGeo.dispose();
    for (const m of parts) m.material.dispose();
  };
  return g;
}

// Two or three jagged "zigzag" streaks converging on a center point — the 3D
// analogue of stun's SVG icon (two lightning-bolt zigzags meeting at the hit
// point). Each streak is a short chain of thin elongated octahedron shards,
// alternating duotone tint, that flash in and fade out.
function _zigzagBurst(x, z, color, opts = {}) {
  const y = opts.y ?? 1.1;
  const life = opts.life ?? 0.45;
  const arms = Math.min(opts.arms ?? 2, 3);
  const segs = opts.segments ?? 3;
  const reach = opts.reach ?? 2.2;
  const secColor = secondaryColor(color);

  const g = new THREE.Group();
  const shardGeo = new THREE.OctahedronGeometry(0.5, 0);
  const parts = [];
  const forward = new THREE.Vector3(0, 0, 1);
  for (let a = 0; a < arms; a++) {
    const baseAngle = (a / arms) * Math.PI * 2 + Math.random() * 0.6;
    let prev = new THREE.Vector3(0, 0, 0);
    for (let s = 0; s < segs; s++) {
      const t = (s + 1) / segs;
      const jitter = (s % 2 === 0 ? 1 : -1) * 0.5;
      const nx = Math.cos(baseAngle) * reach * t + Math.cos(baseAngle + Math.PI / 2) * jitter;
      const nz = Math.sin(baseAngle) * reach * t + Math.sin(baseAngle + Math.PI / 2) * jitter;
      const next = new THREE.Vector3(nx, 0, nz);
      const primaryTone = s % 2 === 0;
      const tint = primaryTone ? color : secColor;
      const mat = new THREE.MeshLambertMaterial({
        color: tint, emissive: tint, emissiveIntensity: primaryTone ? 1.2 : 0.6,
        flatShading: true, transparent: true, opacity: primaryTone ? 1 : 0.55,
      });
      const m = new THREE.Mesh(shardGeo, mat);
      m.castShadow = false;
      m.position.copy(next);
      const dir = next.clone().sub(prev).normalize();
      if (dir.lengthSq() > 0) m.quaternion.setFromUnitVectors(forward, dir);
      m.scale.set(0.12, 0.42, 0.12);
      m.userData.baseOpacity = primaryTone ? 1 : 0.55;
      g.add(m); parts.push(m);
      prev = next;
    }
  }
  g.position.set(x, y, z);
  g.userData.t = 0;
  g.userData.life = life;
  g.userData.done = false;
  g.userData.update = (dt) => {
    g.userData.t += dt;
    const k = g.userData.t / life;
    const flash = k < 0.25 ? k / 0.25 : 1 - (k - 0.25) / 0.75;
    for (const m of parts) m.material.opacity = Math.max(0, m.userData.baseOpacity * flash);
    if (k >= 1) g.userData.done = true;
  };
  g.userData.dispose = () => {
    shardGeo.dispose();
    for (const m of parts) m.material.dispose();
  };
  return g;
}

// A crosshair reticle collapsing inward: four faceted corner-bracket shards
// (secondary tint) drawing in toward a central brightening diamond core
// (primary tint) — echoes target's SVG icon (ring + diamond + four corner
// brackets).
function _reticleCollapse(x, z, color, opts = {}) {
  const y = opts.y ?? 1.2;
  const life = opts.life ?? 0.4;
  const startRadius = opts.startRadius ?? 3.2;
  const secColor = secondaryColor(color);

  const g = new THREE.Group();
  const shardGeo = new THREE.OctahedronGeometry(0.5, 0);
  const corners = [];
  const dirs = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
  for (const [dx, dz] of dirs) {
    const mat = new THREE.MeshLambertMaterial({
      color: secColor, emissive: secColor, emissiveIntensity: 0.6,
      flatShading: true, transparent: true, opacity: 0.7,
    });
    const m = new THREE.Mesh(shardGeo, mat);
    m.castShadow = false;
    m.scale.set(0.16, 0.5, 0.16);
    m.userData.dir = new THREE.Vector3(dx, 0, dz).normalize();
    g.add(m); corners.push(m);
  }
  const coreMat = new THREE.MeshLambertMaterial({
    color, emissive: color, emissiveIntensity: 1.2,
    flatShading: true, transparent: true, opacity: 0,
  });
  const core = new THREE.Mesh(shardGeo, coreMat);
  core.castShadow = false;
  core.scale.set(0.2, 0.34, 0.2);
  g.add(core);

  g.position.set(x, y, z);
  g.userData.t = 0;
  g.userData.life = life;
  g.userData.done = false;
  g.userData.update = (dt) => {
    g.userData.t += dt;
    const k = Math.min(1, g.userData.t / life);
    const r = startRadius * (1 - k);
    for (const m of corners) {
      m.position.copy(m.userData.dir).multiplyScalar(r);
      m.material.opacity = 0.7 * (1 - k * 0.3);
    }
    coreMat.opacity = k;
    core.scale.setScalar(0.2 + k * 0.15);
    if (k >= 1) g.userData.done = true;
  };
  g.userData.dispose = () => {
    shardGeo.dispose();
    coreMat.dispose();
    for (const m of corners) m.material.dispose();
  };
  return g;
}

// A directional cone wave: nested duotone arcs fanning outward within
// `opts.angle` +/- `opts.spread` (radians), echoing push's nested-arc icon.
// Falls back to a full radial nova (4 evenly spaced arcs) when `opts.angle`
// is omitted, since the base ctx contract does not guarantee a facing
// direction — used as-is by disable's radiating "slash tick" impact.
function _coneWave(x, z, color, opts = {}) {
  const life = opts.life ?? 0.35;
  const y = opts.y ?? 0.9;
  const speed = opts.speed ?? 14;
  const spread = opts.spread ?? 0.9;
  const hasAngle = Number.isFinite(opts.angle);
  const angle = opts.angle ?? 0;
  const secColor = secondaryColor(color);

  const g = new THREE.Group();
  const shardGeo = new THREE.OctahedronGeometry(0.5, 0);
  const parts = [];
  const arcCount = hasAngle ? 3 : 4;
  const perArc = 3;
  for (let arc = 0; arc < arcCount; arc++) {
    const arcT = arcCount > 1 ? arc / (arcCount - 1) : 0.5;
    const baseAngle = hasAngle ? angle : (arc / arcCount) * Math.PI * 2;
    const off = hasAngle ? (arcT - 0.5) * 2 * spread : 0;
    for (let i = 0; i < perArc; i++) {
      const a = baseAngle + off + (Math.random() - 0.5) * 0.12;
      const primaryTone = arc % 2 === 0;
      const tint = primaryTone ? color : secColor;
      const mat = new THREE.MeshLambertMaterial({
        color: tint, emissive: tint, emissiveIntensity: primaryTone ? 1 : 0.5,
        flatShading: true, transparent: true, opacity: primaryTone ? 0.95 : 0.5,
      });
      const m = new THREE.Mesh(shardGeo, mat);
      m.castShadow = false;
      m.scale.set(0.5 + i * 0.15, 0.12, 0.18);
      m.rotation.y = -a;
      const startDist = 0.4 + i * 0.5;
      m.position.set(Math.cos(a) * startDist, 0, Math.sin(a) * startDist);
      m.userData.v = new THREE.Vector3(Math.cos(a), 0, Math.sin(a)).multiplyScalar(speed * (0.7 + i * 0.15));
      m.userData.baseOpacity = primaryTone ? 0.95 : 0.5;
      g.add(m); parts.push(m);
    }
  }
  g.position.set(x, y, z);
  g.userData.t = 0;
  g.userData.life = life;
  g.userData.done = false;
  g.userData.update = (dt) => {
    g.userData.t += dt;
    const k = g.userData.t / life;
    for (const m of parts) {
      m.position.addScaledVector(m.userData.v, dt);
      m.material.opacity = Math.max(0, m.userData.baseOpacity * (1 - k));
    }
    if (k >= 1) g.userData.done = true;
  };
  g.userData.dispose = () => {
    shardGeo.dispose();
    for (const m of parts) m.material.dispose();
  };
  return g;
}

// ---------------------------------------------------------------------------
// buildCore() builders — a small faceted "core" shape per spell, wrapped in
// duotone.js's facetedDuo() for an idle/inventory-preview look. Each is a
// `(color, opts) -> THREE.Mesh` builder in the facetedDuo builder-mode
// contract (its geometry is then owned/disposed by the returned Group).
// ---------------------------------------------------------------------------
const _coreBuilders = {
  meteor:  (c, o = {}) => facetedRock(o.radius ?? 0.42, c, { detail: 0, perturb: 0.2, emissive: c, emissiveIntensity: 0.7, ...o }),
  explode: (c, o = {}) => facetedCrystal(o.radius ?? 0.4, c, { emissive: c, sx: 0.85, sy: 0.85, sz: 0.85, ...o }),
  gravity: (c, o = {}) => facetedOrb(o.radius ?? 0.32, c, o),
  vacuum:  (c, o = {}) => facetedCrystal(o.radius ?? 0.36, c, { emissive: c, spin: true, ...o }),
  stun:    (c, o = {}) => facetedShard(o.length ?? 0.7, c, { emissive: c, ...o }),
  target:  (c, o = {}) => facetedCrystal(o.radius ?? 0.34, c, { emissive: c, sx: 0.7, sy: 1.4, sz: 0.7, ...o }),
  push:    (c, o = {}) => facetedCone(o.radius ?? 0.34, o.height ?? 0.6, c, { emissive: c, segments: 6, ...o }),
  disable: (c, o = {}) => facetedOrb(o.radius ?? 0.34, c, o),
};

// ---------------------------------------------------------------------------
// AOE_VFX — the src/vfx/duotone.js VFX_REGISTRY-shaped slice for this file's
// eight AoE/point-target spells. Merge into VFX_REGISTRY (e.g.
// `Object.assign(VFX_REGISTRY, AOE_VFX)`) alongside sibling per-spell VFX
// modules to complete the registry.
// ---------------------------------------------------------------------------
export const AOE_VFX = {
  meteor: {
    color: METEOR_COLOR,
    buildCore: (c = METEOR_COLOR) => facetedDuo(_coreBuilders.meteor, c, { secondaryScale: 1.35, secondaryOpacity: 0.4 }),
    cast(ctx) {
      // Brief ignition flare at the caster as the meteor is summoned. The
      // falling-rock + timed ring telegraph itself stays voxel.js's
      // buildMeteor (already synced to the server's fall duration); this
      // only adds the duotone "spark" flourish at the moment of cast.
      ctx.addEffect(_duoShardBurst(ctx.x, ctx.z, ctx.color, {
        count: 8, speed: 3, life: 0.3, y: ctx.y ?? 1.0, size: 0.16,
      }));
      return null;
    },
    impact(ctx) {
      // Starburst shards + a snapping duo ring on landing, echoing the
      // icon's radiating spark lines.
      ctx.addEffect(_duoShardBurst(ctx.x, ctx.z, ctx.color, {
        count: 18, speed: 13, life: 0.7, y: ctx.y ?? 1.0, size: 0.3,
      }));
      ctx.addEffect(_duoRing(ctx.x, ctx.z, 0.6, ctx.color, { grow: 6.5, life: 0.55, thickness: 0.5 }));
      ctx.addEffect(_duoRing(ctx.x, ctx.z, 0.3, brighten(ctx.color, 0.2), { grow: 4.5, life: 0.4, thickness: 0.3, y: 0.16 }));
      // A quick bright flash accent using the shared ctx.ringPulse helper.
      ctx.addEffect(ctx.ringPulse(ctx.x, ctx.z, 1.4, 0xffffff));
      return null;
    },
  },

  explode: {
    color: EXPLODE_COLOR,
    buildCore: (c = EXPLODE_COLOR) => facetedDuo(_coreBuilders.explode, c, {}),
    cast(ctx) {
      // Windup telegraph: a duo ring collapsing inward at the detonation
      // point over the spell's castTime, echoing the icon's tight radial
      // starburst gathering energy before it erupts.
      ctx.addEffect(_duoRing(ctx.x, ctx.z, 2.6, ctx.color, {
        grow: -2.3, life: SPELLS.explode?.castTime ?? 0.45, thickness: 0.25, opacity: 0.6,
      }));
      return null;
    },
    impact(ctx) {
      ctx.addEffect(_duoShardBurst(ctx.x, ctx.z, ctx.color, {
        count: 18, speed: 12, life: 0.65, y: ctx.y ?? 1.0, size: 0.28,
      }));
      ctx.addEffect(_duoRing(ctx.x, ctx.z, 0.5, ctx.color, { grow: 6, life: 0.5, thickness: 0.45 }));
      ctx.addEffect(ctx.ringPulse(ctx.x, ctx.z, 1.2, 0xffffff));
      return null;
    },
  },

  gravity: {
    color: GRAVITY_COLOR,
    buildCore: (c = GRAVITY_COLOR) => facetedDuo(_coreBuilders.gravity, c, { emissiveIntensity: 1.1 }),
    cast(ctx) {
      // Three concentric duo rings collapsing inward — echoes the icon's
      // nested-orbit rings + inward-pointing orbit ticks.
      const radii = [3.4, 2.3, 1.3];
      for (let i = 0; i < radii.length; i++) {
        ctx.addEffect(_duoRing(ctx.x, ctx.z, radii[i], ctx.color, {
          grow: -radii[i] * 0.85, life: 0.5 + i * 0.08, thickness: 0.22, opacity: 0.55,
        }));
      }
      return null;
    },
    impact(ctx) {
      // The well's sustained pull already gets its own ringPulse from the
      // caller each tick; this adds the duotone implosion flourish for when
      // the well collapses/releases its victims.
      ctx.addEffect(_duoShardBurst(ctx.x, ctx.z, ctx.color, {
        count: 14, speed: 8, life: 0.4, y: ctx.y ?? 1.0, size: 0.2, inward: true, startRadius: ctx.radius ?? 4,
      }));
      ctx.addEffect(_duoRing(ctx.x, ctx.z, ctx.radius ?? 3.5, ctx.color, { grow: -(ctx.radius ?? 3.5) * 0.9, life: 0.4, thickness: 0.3 }));
      return null;
    },
  },

  vacuum: {
    color: VACUUM_COLOR,
    buildCore: (c = VACUUM_COLOR) => facetedDuo(_coreBuilders.vacuum, c, {}),
    cast(ctx) {
      // Swirling duo ring + inward shard burst as the channel begins,
      // echoing the icon's three swirling arms drawing motes inward.
      const r = ctx.radius ?? 4;
      ctx.addEffect(_duoRing(ctx.x, ctx.z, r, ctx.color, { grow: -r * 0.9, life: 0.6, thickness: 0.3, opacity: 0.5 }));
      ctx.addEffect(_duoShardBurst(ctx.x, ctx.z, ctx.color, {
        count: 12, speed: 6, life: 0.55, y: ctx.y ?? 1.0, size: 0.18, inward: true, startRadius: r,
      }));
      return null;
    },
    impact(ctx) {
      // Final implosion burst when the channel ends / grinds its last tick.
      ctx.addEffect(_duoShardBurst(ctx.x, ctx.z, ctx.color, {
        count: 16, speed: 10, life: 0.4, y: ctx.y ?? 1.0, size: 0.24,
      }));
      ctx.addEffect(_duoRing(ctx.x, ctx.z, 0.4, ctx.color, { grow: 3.5, life: 0.35, thickness: 0.3 }));
      return null;
    },
  },

  stun: {
    color: STUN_COLOR,
    buildCore: (c = STUN_COLOR) => facetedDuo(_coreBuilders.stun, c, { secondaryScale: 1.5 }),
    cast(ctx) {
      ctx.addEffect(_zigzagBurst(ctx.x, ctx.z, ctx.color, { y: ctx.y ?? 1.1, life: 0.3, arms: 2, reach: 1.4 }));
      return null;
    },
    impact(ctx) {
      ctx.addEffect(_zigzagBurst(ctx.x, ctx.z, ctx.color, { y: ctx.y ?? 1.1, life: 0.45, arms: 3, reach: 2.4 }));
      ctx.addEffect(_duoRing(ctx.x, ctx.z, 0.3, ctx.color, { grow: 1.8, life: 0.35, thickness: 0.2 }));
      return null;
    },
  },

  target: {
    color: TARGET_COLOR,
    buildCore: (c = TARGET_COLOR) => facetedDuo(_coreBuilders.target, c, {}),
    cast(ctx) {
      // Crosshair reticle collapsing inward around a brightening diamond
      // core — the explicit "target" echo requested for this spell.
      ctx.addEffect(_reticleCollapse(ctx.x, ctx.z, ctx.color, { y: ctx.y ?? 1.2, life: 0.35, startRadius: 3 }));
      return null;
    },
    impact(ctx) {
      ctx.addEffect(_duoShardBurst(ctx.x, ctx.z, ctx.color, {
        count: 16, speed: 8, life: 0.45, y: ctx.y ?? 1.0, size: 0.22,
      }));
      ctx.addEffect(_duoRing(ctx.x, ctx.z, 0.4, ctx.color, { grow: 2.5, life: 0.35, thickness: 0.25 }));
      return null;
    },
  },

  push: {
    color: PUSH_COLOR,
    buildCore: (c = PUSH_COLOR) => facetedDuo(_coreBuilders.push, c, {}),
    cast(ctx) {
      // Directional cone wave — reads `ctx.angle`/`ctx.spread` if the caller
      // supplies the caster's facing; otherwise falls back to a radial nova.
      ctx.addEffect(_coneWave(ctx.x, ctx.z, ctx.color, {
        y: ctx.y ?? 0.9, life: 0.3, angle: ctx.angle, spread: ctx.spread ?? 0.7,
      }));
      return null;
    },
    impact(ctx) {
      ctx.addEffect(_coneWave(ctx.x, ctx.z, ctx.color, {
        y: ctx.y ?? 0.9, life: 0.4, angle: ctx.angle, spread: ctx.spread ?? 0.8, speed: 16,
      }));
      return null;
    },
  },

  disable: {
    color: DISABLE_COLOR,
    buildCore: (c = DISABLE_COLOR) => facetedDuo(_coreBuilders.disable, c, {}),
    cast(ctx) {
      ctx.addEffect(_duoRing(ctx.x, ctx.z, 1.6, ctx.color, { grow: -1.3, life: 0.35, thickness: 0.2, opacity: 0.55 }));
      return null;
    },
    impact(ctx) {
      // Radiating "slash tick" shards (an angle-less _coneWave reads as a
      // radial nova) + a snapping ring, echoing the icon's slash + radiating
      // forbiddance ticks.
      ctx.addEffect(_coneWave(ctx.x, ctx.z, ctx.color, { y: ctx.y ?? 1.0, life: 0.35, speed: 10 }));
      ctx.addEffect(_duoRing(ctx.x, ctx.z, 0.5, ctx.color, { grow: 2.2, life: 0.35, thickness: 0.25 }));
      return null;
    },
  },
};
