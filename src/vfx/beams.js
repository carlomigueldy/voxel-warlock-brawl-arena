// Duotone VFX for beam / tether / chain spells — the 3D expression of each
// spell's bespoke SVG icon (src/spell-icons.js) for drain (spiral siphon),
// pull ("Hook"), drag ("Tow"), link, plus the jagged chain-arc segments the
// "lightning" spell fires between hop targets. This upgrades the old
// single-Line `buildLightning(x1, z1, x2, z2, color)` (src/voxel.js) look to
// a duotone tube/arc: a bright emissive faceted PRIMARY jagged core + a
// fainter ~0.45-opacity faceted SECONDARY jitter arc, plus a pooled,
// capped point-light glow — same recipe as ./duotone.js's facetedDuo, just
// applied to a two-endpoint beam instead of a single-origin shape.
//
// NOTE on "lightning": the *traveling bolt* visual (buildCore/cast/impact
// for the initial shot) already lives in src/vfx/projectiles.js's
// PROJECTILE_VFX.lightning entry. This module only supplies the jagged
// *chain-arc* look reused for every hop (renderer.js's
// `case "lightning": for (const s of ev.segs) buildLightning(...)`) via
// buildLightningBeam()/buildChainBeam() — exported standalone, deliberately
// NOT registered under the "lightning" key, so merging this module's
// registry slice into VFX_REGISTRY can never clobber projectiles.js's entry.
//
// This is a leaf-ish VFX module: it imports `three`, lowpoly.js's faceted
// builders, and ./duotone.js — nothing from voxel.js/renderer.js — and
// exports BEAM_VFX, a registry slice matching the VFX_REGISTRY entry shape
// (see duotone.js) for drain/pull/drag/link so it can be merged into
// VFX_REGISTRY by the caller.
import * as THREE from "three";
import { CFG } from "../config.js";
import { facetedOrb, facetedShard, facetedAura } from "../lowpoly.js";
import { secondaryColor, brighten, facetedDuo, TrailPool } from "./duotone.js";

// ---------------------------------------------------------------------------
// Pooled point-light glow — mirrors duotone.js's TrailPool shard pool: a
// small, fixed-size pool of PointLights reused across every active beam
// effect (chain arcs, drain siphons, hook pulls, tethers) instead of one
// `new THREE.PointLight` per beam. Sized via CFG.BEAM_LIGHT_POOL_SIZE (see
// config.js's Performance section) — kept as a separate, ADDITIVE pool to
// the projectile bolt pool (CFG.LIGHT_POOL_SIZE) since beams glow at their
// midpoint rather than following a single moving bolt; the combined,
// documented worst-case dynamic-light budget is LIGHT_POOL_SIZE +
// BEAM_LIGHT_POOL_SIZE.
const BEAM_LIGHT_POOL_SIZE = CFG.BEAM_LIGHT_POOL_SIZE;
const _lightPool = [];
function _ensureLightPool() {
  if (_lightPool.length) return;
  for (let i = 0; i < BEAM_LIGHT_POOL_SIZE; i++) {
    const l = new THREE.PointLight(0xffffff, 0, 10);
    l.visible = false;
    l.userData.free = true;
    _lightPool.push(l);
  }
}
// Acquire a free pooled light, or null if every slot is in use — callers
// must degrade gracefully (render the beam without a glow light) rather
// than allocate a new one; this is the hard perf cap.
function _acquireLight() {
  _ensureLightPool();
  for (const l of _lightPool) {
    if (l.userData.free) { l.userData.free = false; return l; }
  }
  return null;
}
function _releaseLight(l) {
  if (!l) return;
  l.userData.free = true;
  l.visible = false;
  l.intensity = 0;
  if (l.parent) l.parent.remove(l);
}

// ---------------------------------------------------------------------------
// Jagged path + faceted tube helpers
// ---------------------------------------------------------------------------

// Straight-segment jagged path between two ground points at height `y`,
// with the interior points perturbed for a lightning-crack silhouette
// (endpoints are left exact so the beam always lands on its targets).
function _jaggedPoints(x1, z1, x2, z2, y, segs, jitterXZ, jitterY) {
  const start = new THREE.Vector3(x1, y, z1);
  const end = new THREE.Vector3(x2, y, z2);
  const pts = [];
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    const p = start.clone().lerp(end, t);
    if (i > 0 && i < segs) {
      p.x += (Math.random() - 0.5) * jitterXZ;
      p.z += (Math.random() - 0.5) * jitterXZ;
      p.y += (Math.random() - 0.5) * jitterY;
    }
    pts.push(p);
  }
  return pts;
}

// A faceted (low radialSegments) tube mesh following straight jagged
// segments — unlike TubeGeometry over a CatmullRomCurve3, chaining
// THREE.LineCurve3 keeps every bend sharp/angular instead of smoothing it
// out, preserving the "crack" silhouette from the old Line-based bolt while
// reading as a solid low-poly faceted volume instead of a 1px line.
function _tubeMesh(pts, radius, color, opts = {}) {
  const curve = new THREE.CurvePath();
  for (let i = 0; i < pts.length - 1; i++) curve.add(new THREE.LineCurve3(pts[i], pts[i + 1]));
  const tubularSegments = Math.max(pts.length - 1, 1) * 2;
  const geo = new THREE.TubeGeometry(curve, tubularSegments, radius, 3, false);
  const mat = opts.unlit
    ? new THREE.MeshBasicMaterial({
        color, transparent: true, opacity: opts.opacity ?? 0.45, depthWrite: false,
      })
    : new THREE.MeshLambertMaterial({
        color, emissive: opts.emissive ?? color, emissiveIntensity: opts.emissiveIntensity ?? 1.1,
        flatShading: true, transparent: true, opacity: opts.opacity ?? 1,
      });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  return mesh;
}

// Append `add`'s update/dispose behavior after `g`'s existing ones —
// composition helper so per-spell accents (drain's spiral, pull/drag's hook
// arrow, link's steady pulse) can layer onto the shared beam core without
// each rewriting the base fade/light lifecycle.
function _extend(g, { update, dispose }) {
  const baseUpdate = g.userData.update;
  const baseDispose = g.userData.dispose;
  if (update) g.userData.update = (dt) => { baseUpdate(dt); update(dt); };
  if (dispose) g.userData.dispose = () => { baseDispose(); dispose(); };
}

// ---------------------------------------------------------------------------
// Shared beam core — duotone jagged tube + jitter arc + pooled light
// ---------------------------------------------------------------------------

// Build the shared duotone beam Group between two ground points. Returns a
// transient effect (userData.t/life/done/update(dt)/dispose()) matching
// src/renderer.js's effects-array contract (see buildLightning in
// src/voxel.js, which this replaces spell-by-spell).
//
//   opts — { y=1.2, life=0.3, segs=8, jitter=1.1, jitterY=0.7, radius=0.09,
//            secRadius=radius*1.9, secJitter=jitter*1.7, secondaryOpacity=0.45,
//            emissiveIntensity=1.1, holdK=0 (fraction of life held at full
//            brightness before fading — 0 = classic instant-full-then-fade,
//            near 1 = "steady" tether that only fades right at the end),
//            crackle=true (per-frame flicker for a buzzing/arcing feel; set
//            false for calmer beams like link/drag), lightIntensity=2.4,
//            lightDist=12 }
function _buildBeamCore(x1, z1, x2, z2, color, opts = {}) {
  const y = opts.y ?? 1.2;
  const life = opts.life ?? 0.3;
  const segs = opts.segs ?? 8;
  const jitter = opts.jitter ?? 1.1;
  const jitterY = opts.jitterY ?? 0.7;
  const radius = opts.radius ?? 0.09;
  const secRadius = opts.secRadius ?? radius * 1.9;
  const secJitter = opts.secJitter ?? jitter * 1.7;
  const secondaryOpacity = opts.secondaryOpacity ?? 0.45;
  const emissiveIntensity = opts.emissiveIntensity ?? 1.1;
  const holdK = Math.min(Math.max(opts.holdK ?? 0, 0), 0.98);
  const crackle = opts.crackle ?? true;
  const lightIntensity = opts.lightIntensity ?? 2.4;
  const lightDist = opts.lightDist ?? 12;

  const g = new THREE.Group();

  // PRIMARY — bright emissive faceted jagged core (full opacity).
  const primaryPts = _jaggedPoints(x1, z1, x2, z2, y, segs, jitter, jitterY);
  const primary = _tubeMesh(primaryPts, radius, color, { emissiveIntensity });
  g.add(primary);

  // SECONDARY — fainter, more chaotic jitter arc (~0.45 opacity, translucent,
  // secondaryColor-tinted) — the beam analogue of facetedDuo's accent shell.
  const secondaryPts = _jaggedPoints(x1, z1, x2, z2, y, segs, secJitter, jitterY * 1.3);
  const secondary = _tubeMesh(secondaryPts, secRadius, secondaryColor(color), {
    unlit: true, opacity: secondaryOpacity,
  });
  g.add(secondary);

  // Pooled glow light at the beam midpoint (skipped gracefully if the pool
  // is fully in use — never allocates beyond BEAM_LIGHT_POOL_SIZE).
  const light = _acquireLight();
  if (light) {
    light.visible = true;
    light.color.setHex(brighten(color, 0.15));
    light.intensity = lightIntensity;
    light.distance = lightDist;
    light.position.set((x1 + x2) / 2, y + 0.3, (z1 + z2) / 2);
    g.add(light);
  }

  g.userData.primary = primary;
  g.userData.secondary = secondary;
  g.userData.light = light;
  g.userData.t = 0;
  g.userData.life = life;
  g.userData.done = false;
  g.userData.update = (dt) => {
    g.userData.t += dt;
    const k = g.userData.t / life;
    let alpha;
    if (k >= 1) { alpha = 0; g.userData.done = true; } else if (k < holdK) {
      alpha = 1;
    } else {
      alpha = Math.max(0, 1 - (k - holdK) / (1 - holdK));
    }
    const flicker = crackle ? 0.85 + Math.random() * 0.15 : 1;
    primary.material.opacity = alpha * flicker;
    primary.material.emissiveIntensity = emissiveIntensity * alpha * flicker;
    secondary.material.opacity = secondaryOpacity * alpha;
    if (light) light.intensity = lightIntensity * alpha * flicker;
  };
  // Primary/secondary tube geometry + materials are fresh per beam instance
  // (never cache-owned like voxel.js's bolt geo/mat caches) — safe and
  // required to dispose here. The pooled light is released, not disposed.
  g.userData.dispose = () => {
    primary.geometry.dispose();
    primary.material.dispose();
    secondary.geometry.dispose();
    secondary.material.dispose();
    _releaseLight(light);
  };
  return g;
}

// ---------------------------------------------------------------------------
// Per-spell accents — echo each icon's bespoke motif on top of the shared core
// ---------------------------------------------------------------------------

// drain — spiral vortex sparkle: a handful of pooled shard motes (drawn from
// duotone.js's shared TrailPool budget, not a new allocation) helix along
// the beam from the drained target (x1,z1) toward the caster (x2,z2),
// echoing the icon's inward spiral siphon line.
function _attachDrainSpiral(g, x1, z1, x2, z2, color, y, life) {
  const dx = x2 - x1, dz = z2 - z1;
  const dist = Math.hypot(dx, dz) || 1;
  const dirX = dx / dist, dirZ = dz / dist;
  const perpX = -dirZ, perpZ = dirX;
  const tint = secondaryColor(color);
  const glow = brighten(color, 0.25);
  const count = 5;
  const motes = [];
  for (let i = 0; i < count; i++) {
    const m = TrailPool.acquire();
    if (!m) break; // shared pool exhausted — spiral just runs with fewer motes
    m.material.color.setHex(tint);
    m.material.emissive.setHex(glow);
    m.visible = true;
    motes.push({ mesh: m, phase: (i / count) * Math.PI * 2, t: i / count });
  }
  const radius = 0.35;
  _extend(g, {
    update: (dt) => {
      const parent = g.parent;
      const k = Math.min(g.userData.t / life, 1);
      for (const s of motes) {
        s.t = (s.t + dt / 0.6) % 1; // loops: a steady stream of motes flowing along the beam
        const ang = s.phase + s.t * Math.PI * 6;
        const r = radius * (1 - s.t * 0.4);
        const cx = x1 + dirX * dist * s.t;
        const cz = z1 + dirZ * dist * s.t;
        s.mesh.position.set(cx + perpX * Math.cos(ang) * r, y + Math.sin(ang) * r * 0.6, cz + perpZ * Math.cos(ang) * r);
        s.mesh.scale.setScalar(0.16 * (1 - s.t * 0.3));
        s.mesh.material.opacity = 0.7 * (1 - k);
        if (parent && s.mesh.parent !== parent) parent.add(s.mesh);
      }
    },
    dispose: () => { for (const s of motes) TrailPool.release(s.mesh); },
  });
}

// pull/drag — hook arrow: a small faceted shard flies from the caster
// (x1,z1) out to the snagged target (x2,z2) over the beam's first ~40% of
// life, echoing the icon's hook + directional arrow accent, then fades with
// the beam.
function _attachHookArrow(g, x1, z1, x2, z2, color, y, life) {
  const dx = x2 - x1, dz = z2 - z1;
  const yaw = Math.atan2(dx, dz);
  const hookColor = brighten(color, 0.3);
  const hook = facetedShard(0.55, hookColor, {
    emissive: hookColor, emissiveIntensity: 1.2, transparent: true,
    sx: 0.28, sy: 0.55, sz: 0.28, cast: false, receive: false,
  });
  // Lay the elongated shard flat and point its long axis along the beam.
  hook.rotation.set(Math.PI / 2, 0, -yaw);
  hook.position.set(x1, y, z1);
  g.add(hook);
  const flightK = 0.4;
  _extend(g, {
    update: () => {
      const k = Math.min(g.userData.t / life, 1);
      const ft = Math.min(k / flightK, 1);
      hook.position.set(x1 + dx * ft, y, z1 + dz * ft);
      hook.material.opacity = k < flightK ? 1 : Math.max(0, 1 - (k - flightK) / (1 - flightK));
    },
    dispose: () => { hook.geometry.dispose(); hook.material.dispose(); },
  });
}

// link — steady tether: a gentle sinusoidal brightness pulse instead of
// crackle/flicker, echoing the icon's calm twin-node-and-line motif rather
// than a jagged bolt zap.
function _attachSteadyPulse(g) {
  _extend(g, {
    update: () => {
      const pulse = 0.9 + 0.1 * Math.sin(g.userData.t * 5);
      g.userData.primary.material.emissiveIntensity *= pulse;
    },
  });
}

// ---------------------------------------------------------------------------
// Exported beam builders — drop-in replacements for voxel.js's
// buildLightning(x1, z1, x2, z2, color), one per beam/tether/chain spell.
// ---------------------------------------------------------------------------

// Chain-arc segment (the "lightning" spell's per-hop visual — renderer.js's
// `case "lightning": for (const s of ev.segs) buildLightning(...)`) and the
// generic chain-hop look shared by any future chaining spell.
export function buildLightningBeam(x1, z1, x2, z2, color = 0x9fe6ff) {
  return _buildBeamCore(x1, z1, x2, z2, color, {
    life: 0.3, segs: 8, jitter: 1.2, jitterY: 0.8, radius: 0.1,
    lightIntensity: 2.6, lightDist: 13, crackle: true,
  });
}
// Alias — chain hops (multi-target lightning chains) reuse the exact same
// jagged-tube look; kept as a distinct export so call sites can name intent.
export const buildChainBeam = buildLightningBeam;

// drain — Drain: pulls a foe close and siphons their charge (icon: inward
// spiral line + a spark node at each end).
export function buildDrainBeam(x1, z1, x2, z2, color = 0xaa2f6b) {
  const y = 1.1, life = 0.5;
  const g = _buildBeamCore(x1, z1, x2, z2, color, {
    y, life, segs: 6, jitter: 0.5, jitterY: 0.35, radius: 0.07, secRadius: 0.15,
    lightIntensity: 1.8, lightDist: 10, crackle: false, holdK: 0.15,
  });
  _attachDrainSpiral(g, x1, z1, x2, z2, color, y, life);
  return g;
}

// pull — Hook: yanks one distant foe toward the caster (icon: line + hook +
// directional arrow).
export function buildPullBeam(x1, z1, x2, z2, color = 0x8fffc4) {
  const y = 1.2, life = 0.35;
  const g = _buildBeamCore(x1, z1, x2, z2, color, {
    y, life, segs: 5, jitter: 0.3, jitterY: 0.2, radius: 0.08, secRadius: 0.17,
    lightIntensity: 2.0, lightDist: 11, crackle: false, holdK: 0.1,
  });
  _attachHookArrow(g, x1, z1, x2, z2, color, y, life);
  return g;
}

// drag — Tow: channel that continuously drags a foe in (icon: diagonal hook
// line with three trailing chevrons).
export function buildDragBeam(x1, z1, x2, z2, color = 0x4cff9c) {
  const y = 1.15, life = 0.3;
  const g = _buildBeamCore(x1, z1, x2, z2, color, {
    y, life, segs: 5, jitter: 0.25, jitterY: 0.18, radius: 0.07, secRadius: 0.15,
    lightIntensity: 1.6, lightDist: 9, crackle: false, holdK: 0.2,
  });
  _attachHookArrow(g, x1, z1, x2, z2, color, y, life);
  return g;
}

// link — Link: tethers a foe and mirrors their knockback (icon: two nodes
// joined by a steady line with small rungs). `opts.life` defaults to
// SPELLS.link.duration (4s) but callers may override to match the actual
// tether's remaining time; `opts.y` overrides beam height.
export function buildLinkBeam(x1, z1, x2, z2, color = 0x2fd9c4, opts = {}) {
  const y = opts.y ?? 1.15;
  const life = opts.life ?? 4.0;
  const g = _buildBeamCore(x1, z1, x2, z2, color, {
    y, life, segs: 6, jitter: 0.15, jitterY: 0.1, radius: 0.06, secRadius: 0.14,
    secondaryOpacity: 0.4, lightIntensity: 1.4, lightDist: 8, crackle: false, holdK: 0.9,
  });
  _attachSteadyPulse(g);
  return g;
}

// ---------------------------------------------------------------------------
// Idle/inventory duotone cores — echo each icon's silhouette, standalone
// ---------------------------------------------------------------------------

function _drainCore(color = 0xaa2f6b) {
  const core = facetedDuo((c, o) => facetedOrb(0.26, c, o), color, { emissiveIntensity: 1.1 });
  // Extra swirl accent shell (reuses lowpoly.js's facetedAura, per the task's
  // "reuse faceted builders" guidance) — a loose translucent halo around the
  // siphon core, echoing the icon's outer spiral loop.
  const swirl = facetedAura(0.42, secondaryColor(color), { opacity: 0.22, detail: 0, cast: false, receive: false });
  swirl.rotation.x = Math.PI / 5;
  core.add(swirl);
  const baseDispose = core.userData.dispose;
  core.userData.dispose = () => { baseDispose(); swirl.geometry.dispose(); swirl.material.dispose(); };
  return core;
}

function _hookCore(color) {
  return facetedDuo((c, o) => facetedShard(0.9, c, { ...o, sx: 0.3, sy: 0.9, sz: 0.3 }), color, {
    emissiveIntensity: 1.1,
  });
}

function _linkCore(color = 0x2fd9c4) {
  const g = new THREE.Group();
  const a = facetedDuo((c, o) => facetedOrb(0.22, c, o), color, { x: -0.5 });
  const b = facetedDuo((c, o) => facetedOrb(0.22, c, o), color, { x: 0.5 });
  g.add(a, b);
  const tubeGeo = new THREE.CylinderGeometry(0.05, 0.05, 1.0, 6);
  tubeGeo.rotateZ(Math.PI / 2);
  const tubeMat = new THREE.MeshLambertMaterial({
    color: secondaryColor(color), emissive: color, emissiveIntensity: 0.6,
    flatShading: true, transparent: true, opacity: 0.7,
  });
  const tube = new THREE.Mesh(tubeGeo, tubeMat);
  tube.castShadow = false;
  g.add(tube);
  g.userData.recolor = (newColor) => {
    a.userData.recolor(newColor);
    b.userData.recolor(newColor);
    tubeMat.color.setHex(secondaryColor(newColor));
    tubeMat.emissive.setHex(newColor);
  };
  g.userData.dispose = () => {
    a.userData.dispose();
    b.userData.dispose();
    tubeGeo.dispose();
    tubeMat.dispose();
  };
  return g;
}

// ---------------------------------------------------------------------------
// BEAM_VFX registry slice — drain/pull/drag/link only (see the "lightning"
// note at the top of this file for why chain arcs are exported standalone
// instead of registry-keyed under "lightning").
//
// ctx passed to cast()/impact() extends duotone.js's documented shape
// ({ x, z, y, color, addEffect, ringPulse, burstAt }) with the beam's target
// endpoint: ctx.x/ctx.z is the source (caster) point, ctx.x2/ctx.z2 is the
// target point the beam reaches toward (falls back to ctx.x/ctx.z, i.e. a
// zero-length beam, if the caller has no target yet).
// ---------------------------------------------------------------------------

export const BEAM_VFX = {
  drain: {
    color: 0xaa2f6b,
    buildCore: _drainCore,
    cast: (ctx) => buildDrainBeam(ctx.x, ctx.z, ctx.x2 ?? ctx.x, ctx.z2 ?? ctx.z, ctx.color ?? 0xaa2f6b),
    impact: (ctx) => (ctx.burstAt ? ctx.burstAt(ctx.x2 ?? ctx.x, ctx.z2 ?? ctx.z, ctx.color ?? 0xaa2f6b, { count: 10, speed: 5, life: 0.4 }) : null),
    trail: false,
  },
  pull: {
    color: 0x8fffc4,
    buildCore: _hookCore,
    cast: (ctx) => buildPullBeam(ctx.x, ctx.z, ctx.x2 ?? ctx.x, ctx.z2 ?? ctx.z, ctx.color ?? 0x8fffc4),
    impact: (ctx) => (ctx.burstAt ? ctx.burstAt(ctx.x2 ?? ctx.x, ctx.z2 ?? ctx.z, ctx.color ?? 0x8fffc4, { count: 12, speed: 7, life: 0.35 }) : null),
    trail: false,
  },
  drag: {
    color: 0x4cff9c,
    buildCore: _hookCore,
    cast: (ctx) => buildDragBeam(ctx.x, ctx.z, ctx.x2 ?? ctx.x, ctx.z2 ?? ctx.z, ctx.color ?? 0x4cff9c),
    impact: (ctx) => (ctx.burstAt ? ctx.burstAt(ctx.x2 ?? ctx.x, ctx.z2 ?? ctx.z, ctx.color ?? 0x4cff9c, { count: 6, speed: 4, life: 0.3 }) : null),
    trail: false,
  },
  link: {
    color: 0x2fd9c4,
    buildCore: _linkCore,
    cast: (ctx) => buildLinkBeam(ctx.x, ctx.z, ctx.x2 ?? ctx.x, ctx.z2 ?? ctx.z, ctx.color ?? 0x2fd9c4, { life: ctx.duration }),
    impact: () => null, // link is a continuous tether, not a one-shot hit
    trail: false,
  },
};
