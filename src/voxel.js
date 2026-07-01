// Low-poly voxel mesh builders. Everything is built from boxes for the
// blocky aesthetic, merged where possible to keep draw calls down.
import * as THREE from "three";
import { CFG, getArenaWorld, getArenaHazard, isOnArenaWorld } from "./config.js";
import { CastAnimator } from "./animations.js";
import {
  facetedRock, facetedCrystal, facetedOrb, facetedCone, facetedCylinder,
  facetedShard, facetedSlab, facetedAura, facetedPuff, makeMobHealthBar,
} from "./lowpoly.js";
import { VFX_REGISTRY } from "./vfx/duotone.js";
import { MOB_MODEL_ASSETS, mobModelReady, loadMobModelTemplate, buildMobModelInstance } from "./mobModel.js";

function box(w, h, d, color, x = 0, y = 0, z = 0, flat = true) {
  const geo = new THREE.BoxGeometry(w, h, d);
  const mat = new THREE.MeshLambertMaterial({
    color,
    flatShading: flat,
  });
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

function joint(x = 0, y = 0, z = 0) {
  const j = new THREE.Group();
  j.position.set(x, y, z);
  return j;
}

// Shade a color by a factor (for cheap voxel "AO"/variation).
function shade(hex, f) {
  const c = new THREE.Color(hex);
  c.offsetHSL(0, 0, f);
  return c.getHex();
}

// Emissive voxel — same box recipe but a Lambert material with self-illumination,
// for glowing accents (item cores, charge runes, eye/jewel highlights) that still
// take scene light. opts: { x,y,z, emissive, intensity=0.9, flat=true }.
function glowBox(w, h, d, color, opts = {}) {
  const geo = new THREE.BoxGeometry(w, h, d);
  const mat = new THREE.MeshLambertMaterial({
    color,
    emissive:          opts.emissive ?? color,
    emissiveIntensity: opts.intensity ?? 0.9,
    flatShading:       opts.flat !== false,
  });
  const m = new THREE.Mesh(geo, mat);
  m.position.set(opts.x ?? 0, opts.y ?? 0, opts.z ?? 0);
  m.castShadow    = true;
  m.receiveShadow = true;
  return m;
}

// Unlit translucent voxel — for halos / aura shells (matches buildBolt halo look).
function auraBox(w, h, d, color, opts = {}) {
  const geo = new THREE.BoxGeometry(w, h, d);
  const mat = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity:     opts.opacity ?? 0.3,
  });
  const m = new THREE.Mesh(geo, mat);
  m.position.set(opts.x ?? 0, opts.y ?? 0, opts.z ?? 0);
  return m;
}

// Richer color transform than shade(): independent hue/sat/light deltas.
function tint(hex, dh = 0, ds = 0, dl = 0) {
  const c = new THREE.Color(hex);
  c.offsetHSL(dh, ds, dl);
  return c.getHex();
}

// Register a node for cheap secondary motion (bob / sway / spin / pulse). Pushes
// a descriptor into group.userData._sec[]; driven by animateSecondary(). Additive
// and opt-in — a builder calls wobble() and never touches anim code directly.
// cfg: { bobAmp, bobHz, swayAmp, swayHz, spinX, spinY, spinZ,
//        pulseMat, pulseBase, pulseAmp, pulseHz, phase }
function wobble(group, node, cfg) {
  (group.userData._sec ||= []).push({ node, cfg, base: node.position.clone() });
  return node;
}

// Drives every node registered via wobble() on this group. Safe to call on a group
// with no _sec list (no-op). Pure transform/opacity writes, no allocation per frame.
export function animateSecondary(group, t, dt) {
  const sec = group.userData._sec;
  if (!sec || !sec.length) return;
  for (const { node, cfg, base } of sec) {
    const ph = cfg.phase ?? 0;
    if (cfg.bobAmp)  node.position.y = base.y + Math.sin(t * (cfg.bobHz  ?? 2)   * Math.PI * 2 + ph) * cfg.bobAmp;
    if (cfg.swayAmp) node.position.x = base.x + Math.sin(t * (cfg.swayHz ?? 1.5) * Math.PI * 2 + ph) * cfg.swayAmp;
    if (cfg.spinX)   node.rotation.x += cfg.spinX * dt;
    if (cfg.spinY)   node.rotation.y += cfg.spinY * dt;
    if (cfg.spinZ)   node.rotation.z += cfg.spinZ * dt;
    // Guard: MeshBasicMaterial has no emissiveIntensity property (it's silently
    // ignored). Only write it on materials that actually support self-illumination
    // (MeshLambertMaterial, MeshStandardMaterial, MeshPhongMaterial, etc.).
    if (cfg.pulseMat && node.material && 'emissiveIntensity' in node.material) {
      node.material.emissiveIntensity =
        (cfg.pulseBase ?? 0.5) + Math.sin(t * (cfg.pulseHz ?? 2) * Math.PI * 2 + ph) * (cfg.pulseAmp ?? 0.3);
    }
  }
}

// Build a chunky low-poly warlock from stacked voxels.
// Returns a Group whose children we can recolor per player.
export function buildWarlock(color) {
  const g = new THREE.Group();

  const robe = shade(color, -0.05);
  const robeDark = shade(color, -0.18);
  const skin = 0xf0c8a0;

  const spine = joint(0, 0.6, 0);
  g.add(spine);
  spine.add(box(1.1, 0.6, 1.1, robeDark, 0, -0.30, 0));
  spine.add(box(0.9, 0.7, 0.9, robe, 0, 0.35, 0));
  spine.add(box(1.0, 0.3, 0.8, robe, 0, 0.80, 0));

  const neck = joint(0, 1.25, 0);
  spine.add(neck);
  neck.add(box(0.6, 0.6, 0.6, skin, 0, 0, 0));
  const eyeMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const e1 = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 0.06), eyeMat);
  const e2 = e1.clone();
  e1.position.set(-0.15, 0.05, 0.31);
  e2.position.set(0.15, 0.05, 0.31);
  neck.add(e1, e2);

  const hat = joint(0, 0.35, 0);
  neck.add(hat);
  const hat1 = box(0.75, 0.25, 0.75, robeDark, 0, 0.0, 0);
  const hat2 = box(0.5, 0.4, 0.5, robe, 0, 0.3, 0);
  const hat3 = box(0.22, 0.4, 0.22, robeDark, 0, 0.65, 0);
  hat.add(hat1, hat2, hat3);

  const shoulderL = joint(-0.62, 0.75, 0.1);
  const shoulderR = joint(0.62, 0.75, 0.1);
  spine.add(shoulderL, shoulderR);
  shoulderL.add(box(0.25, 0.6, 0.25, robe, 0, -0.3, 0));
  shoulderR.add(box(0.25, 0.6, 0.25, robe, 0, -0.3, 0));

  // Hand anchors at arm tips — pure attach points for future weapon/VFX parenting.
  const handL = joint(0, -0.62, 0); shoulderL.add(handL);
  const handR = joint(0, -0.62, 0); shoulderR.add(handR);
  // Chest emitter anchor — used by the channel/cast wind-up pose hook below.
  const chest = joint(0, 0.45, 0.45); spine.add(chest);
  // Channel glow cube on the chest; hidden until state.channel > 0 activates it.
  // Kept invisible so it never renders on non-channeling warlocks.
  const castGlow = glowBox(0.18, 0.18, 0.18, color, { emissive: color, intensity: 0 });
  castGlow.visible = false;
  chest.add(castGlow);

  const hipL = joint(-0.24, 0.5, 0);
  const hipR = joint(0.24, 0.5, 0);
  g.add(hipL, hipR);
  hipL.add(box(0.26, 0.5, 0.26, robeDark, 0, -0.25, 0));
  hipR.add(box(0.26, 0.5, 0.26, robeDark, 0, -0.25, 0));

  g.userData.colorParts = [hat1, hat2, hat3];
  g.userData.rig = {
    spine, neck, hat,
    armL: shoulderL, armR: shoulderR,
    legL: hipL, legR: hipR,
    handL, handR, chest,                // new: arm-tip + chest emitter anchors
  };
  g.userData.anim    = { phase: 0, cast: 0, fall: 0, channel: 0 };
  g.userData.castGlow = castGlow;       // driven by animateWarlock channel blend
  // Body-cast archetype overlay (attack/slam/dash/buff/channel), shared with the
  // GLB rig via the same CastAnimator state machine.
  g.userData.castAnim = new CastAnimator();
  g.userData.triggerCast = (archetype) => g.userData.castAnim.trigger(archetype);
  g.scale.setScalar(0.9);
  return g;
}

const _lerp = (a, b, t) => a + (b - a) * t;

export function animateWarlock(group, state) {
  const rig = group.userData.rig;
  const anim = group.userData.anim;
  if (!rig || !anim) return;

  const dt = Math.min(0.05, Math.max(0.0001, state.dt || 0.016));
  const time = state.time || 0;
  const maxSpeed = state.maxSpeed || 9;
  const gait = Math.min(1, (state.speed || 0) / maxSpeed);
  const moving = gait > 0.06;

  anim.cast    = _lerp(anim.cast,    Math.min(1, state.charge  || 0), 1 - Math.exp(-8  * dt));
  anim.fall    = _lerp(anim.fall,    state.falling ? 1 : 0,          1 - Math.exp(-10 * dt));
  anim.channel = _lerp(anim.channel, Math.min(1, state.channel || 0), 1 - Math.exp(-6  * dt));
  anim.phase  += dt * (moving ? 7 + gait * 6 : 2.0);

  const ph = anim.phase;
  const swing = Math.sin(ph) * (moving ? 0.35 + gait * 0.55 : 0);
  const idle = 1 - Math.min(1, gait * 4);
  const bob = moving
    ? Math.abs(Math.sin(ph)) * (0.06 + gait * 0.06)
    : Math.sin(time * 1.8) * 0.025;
  const lean = moving ? 0.06 + gait * 0.12 : 0;
  const cast = anim.cast;
  const fall = anim.fall;

  let armLx = -swing * 0.9 + Math.sin(time * 1.6) * 0.06 * idle;
  let armRx = swing * 0.9 + Math.sin(time * 1.6 + Math.PI) * 0.06 * idle;
  let legLx = swing;
  let legRx = -swing;

  armLx = _lerp(_lerp(armLx, -1.85, cast), -2.6, fall);
  armRx = _lerp(_lerp(armRx, -1.85, cast), -2.6, fall);
  legLx = _lerp(legLx, 0.5, fall);
  legRx = _lerp(legRx, -0.5, fall);

  rig.armL.rotation.x = armLx;
  rig.armR.rotation.x = armRx;
  rig.armL.rotation.z = _lerp(0, -0.5, fall);
  rig.armR.rotation.z = _lerp(0, 0.5, fall);
  rig.legL.rotation.x = legLx;
  rig.legR.rotation.x = legRx;
  rig.spine.position.y = 0.6 + bob;
  rig.spine.rotation.x = _lerp(lean, 0.9, fall) + cast * 0.15;
  rig.spine.rotation.z = _lerp(0, Math.sin(time * 2.2) * 0.04, idle);
  rig.neck.rotation.x = _lerp(0, -0.25, cast) - lean * 0.5;
  rig.hat.rotation.z = Math.sin(time * 2 + ph * 0.3) * 0.07;
  rig.hat.rotation.x = swing * 0.1;

  // Channel / wind-up pose hook — additive on top of locomotion pose.
  // Gated to ch > 0.001; state.channel defaults to 0 so all existing callers
  // are unaffected until a later step passes a non-zero value.
  const ch = anim.channel;
  if (ch > 0.001) {
    rig.armL.rotation.x += (-1.2 - Math.sin(time * 3) * 0.05) * ch;  // hands raised, braced
    rig.armR.rotation.x += (-1.2 - Math.sin(time * 3) * 0.05) * ch;
    rig.armL.rotation.z += -0.35 * ch;  rig.armR.rotation.z += 0.35 * ch; // cupped inward
    rig.spine.rotation.x += -0.12 * ch;                                    // slight lean-back
    if (rig.chest) rig.chest.position.y = 0.45 + Math.sin(time * 8) * 0.03 * ch; // emitter shiver
  }
  // castGlow is channel-exclusive: hidden when ch ≤ 0.001 so it never renders
  // during normal charging (cast) or on warlocks that have never channeled.
  if (group.userData.castGlow) {
    const cg = group.userData.castGlow;
    if (ch > 0.001) {
      cg.visible = true;
      cg.material.emissiveIntensity = _lerp(0, 1.6, ch);
    } else {
      cg.visible = false;
    }
  }

  // Body-cast archetype overlay on top of the locomotion pose.
  const castAnim = group.userData.castAnim;
  if (castAnim) {
    castAnim.update(dt);
    applyVoxelCastOverlay(rig, castAnim, time);
  }
}

// Per-archetype arm/spine emphasis for the voxel fallback warlock, blended in by
// the CastAnimator weight so casts read distinctly from movement.
function applyVoxelCastOverlay(rig, cast, time) {
  const w = cast.weight;
  if (w <= 0.0001 || !cast.archetype) return;
  switch (cast.archetype) {
    case "attack": // both arms thrust forward
      rig.armL.rotation.x += -2.0 * w;
      rig.armR.rotation.x += -2.0 * w;
      rig.spine.rotation.x += 0.2 * w;
      break;
    case "slam": // arms overhead then down
      rig.armL.rotation.x += (-2.6 + Math.sin(time * 20) * 0.3) * w;
      rig.armR.rotation.x += (-2.6 + Math.sin(time * 20) * 0.3) * w;
      rig.spine.rotation.x += 0.3 * w;
      break;
    case "dash": // crouched lunge, arms back
      rig.armL.rotation.x += 0.9 * w;
      rig.armR.rotation.x += 0.9 * w;
      rig.spine.rotation.x += 0.4 * w;
      break;
    case "buff": // arms-up flourish
      rig.armL.rotation.x += -2.8 * w;
      rig.armR.rotation.x += -2.8 * w;
      rig.armL.rotation.z += -0.6 * w;
      rig.armR.rotation.z += 0.6 * w;
      break;
    case "channel": // braced pull, lean back
      rig.armL.rotation.x += -1.4 * w;
      rig.armR.rotation.x += -1.4 * w;
      rig.spine.rotation.x += -0.25 * w;
      break;
  }
}

// A glowing projectile. `kind` lets each spell get a distinct faceted silhouette
// while reusing the same flat-shaded emissive recipe (polyhedron core + translucent
// faceted halo + light). Cores use different polyhedra per kind so fireball /
// homing / splitter / bouncer / boomerang all read differently at a glance.
// --- Shared bolt geometry/material caches -----------------------------
// Bolt core/halo/blade geometry is identical across every instance of a
// given `kind`; only color varies (and only among a small fixed palette of
// spell colors), so we memoize geometry per-kind and materials per
// `kind|color` and NEVER dispose these — they are cache-owned, not
// instance-owned. This lets src/pool.js reuse whole bolt Groups across
// projectile spawns without rebuilding geometry/materials every shot.
const _boltGeoCache = new Map(); // kind -> { coreGeo, haloGeo, bladeGeo, coreR, haloR, haloOp }
const _boltMatCache = new Map(); // `${kind}|${color}` -> { coreMat, haloMat, bladeMat }

function _boltGeoFor(kind) {
  let entry = _boltGeoCache.get(kind);
  if (entry) return entry;
  let coreR = 0.34, haloR = 0.62, haloOp = 0.25;
  switch (kind) {
    case "boomerang": coreR = 0.40; haloR = 0.80; break;
    case "homing":    coreR = 0.28; haloR = 0.70; haloOp = 0.35; break;
    case "bouncer":   coreR = 0.36; haloR = 0.74; break;
    case "splitter":  coreR = 0.38; haloR = 0.76; break;
  }
  // Distinct faceted polyhedron per kind — all flat-shaded + emissive so they
  // glow yet still show crisp facet shading from scene lights.
  const coreGeo =
    kind === "boomerang" ? new THREE.OctahedronGeometry(coreR, 0) :
    kind === "homing"    ? new THREE.DodecahedronGeometry(coreR, 0) :
    kind === "splitter"  ? new THREE.TetrahedronGeometry(coreR * 1.15, 0) :
                           new THREE.IcosahedronGeometry(coreR, 1);
  const haloGeo = new THREE.IcosahedronGeometry(haloR, 0);
  const bladeGeo = kind === "boomerang" ? new THREE.OctahedronGeometry(0.5, 0) : null;
  entry = { coreGeo, haloGeo, bladeGeo, coreR, haloR, haloOp };
  _boltGeoCache.set(kind, entry);
  return entry;
}

function _boltMatFor(kind, color) {
  const key = `${kind}|${color}`;
  let entry = _boltMatCache.get(key);
  if (entry) return entry;
  const { haloOp } = _boltGeoFor(kind);
  const coreMat = new THREE.MeshLambertMaterial({
    color, emissive: color, emissiveIntensity: 1.4, flatShading: true,
  });
  const haloMat = new THREE.MeshBasicMaterial({
    color, transparent: true, opacity: haloOp,
  });
  const bladeMat = kind === "boomerang"
    ? new THREE.MeshLambertMaterial({ color, emissive: color, emissiveIntensity: 1.2, flatShading: true })
    : null;
  entry = { coreMat, haloMat, bladeMat };
  _boltMatCache.set(key, entry);
  return entry;
}

// Reverse lookup: bolt travel `kind` (src/bolt.js's Bolt.proj — "fireball",
// "boomerang", "homing", "bouncer", "splitter", ...) -> the first
// VFX_REGISTRY spell entry that claims it via its `.proj` field, so
// buildBolt() can route projectile kinds with a bespoke duotone core
// (src/vfx/projectiles.js) through the registry instead of the generic bolt
// geo/mat cache below. Built once at module load: VFX_REGISTRY is fully
// merged by src/vfx/duotone.js before this module's top-level code runs (ES
// module dependency evaluation order), so a plain eager Map is safe here —
// no lazy/on-demand rebuild needed. Kinds with no claiming entry (e.g.
// "disable") simply fall through to the untouched legacy path below.
const _kindVfxEntry = new Map();
for (const entry of Object.values(VFX_REGISTRY)) {
  if (entry.proj && !_kindVfxEntry.has(entry.proj)) _kindVfxEntry.set(entry.proj, entry);
}

export function buildBolt(color, kind = "fireball") {
  // Registry-routed path: the traveling bolt gets its bespoke duotone core
  // (already wired for a pooled TrailPool trail internally when the spell
  // opts into `trail: true` — see src/vfx/projectiles.js's `_withTrail`) —
  // this preserves pool.js's per-kind Group reuse (buildBolt is still only
  // called once per kind until the pool needs another concurrent instance)
  // without touching the shared _boltGeoFor/_boltMatFor caches below.
  const vfxEntry = _kindVfxEntry.get(kind);
  if (vfxEntry && vfxEntry.buildCore) {
    const g = vfxEntry.buildCore(color);
    g.userData.kind = kind; // pool.js buckets released bolts by userData.kind
    return g;
  }

  const g = new THREE.Group();
  const geo = _boltGeoFor(kind);
  const mat = _boltMatFor(kind, color);

  const core = new THREE.Mesh(geo.coreGeo, mat.coreMat);
  core.castShadow = false;
  core.rotation.set(0.6, 0.6, 0);

  const halo = new THREE.Mesh(geo.haloGeo, mat.haloMat);
  halo.castShadow = false;
  halo.receiveShadow = false;
  halo.rotation.set(0.6, 0.6, 0);

  g.add(halo, core);

  let blade = null, blade2 = null;
  if (kind === "boomerang") {
    // Faceted cross-blades so it reads as a spinning boomerang.
    blade = new THREE.Mesh(geo.bladeGeo, mat.bladeMat);
    blade.castShadow = false;
    blade.scale.set(0.25, 1.2, 0.25);
    blade.rotation.z = Math.PI / 2;
    g.add(blade);
    blade2 = new THREE.Mesh(geo.bladeGeo, mat.bladeMat);
    blade2.castShadow = false;
    blade2.scale.set(0.25, 1.2, 0.25);
    blade2.rotation.x = Math.PI / 2;
    g.add(blade2);
  }

  g.userData.kind = kind;
  g.userData.core = core;
  g.userData.halo = halo;
  g.userData.blade = blade;
  g.userData.blade2 = blade2;
  g.userData.recolor = (newColor) => {
    const m = _boltMatFor(g.userData.kind, newColor);
    core.material = m.coreMat;
    halo.material = m.haloMat;
    if (blade) blade.material = m.bladeMat;
    if (blade2) blade2.material = m.bladeMat;
  };
  // No per-instance resources beyond the group itself — geometry/materials
  // are cache-owned and shared, so there is nothing safe to dispose here.
  g.userData.dispose = () => {};
  return g;
}

export function buildRune(color) {
  const g = new THREE.Group();
  // Faceted glowing base pad (flat-shaded slab, translucent).
  const base = facetedSlab(0.9, 0.25, 0.9, color, {
    widthSegments: 2, depthSegments: 2, transparent: true, opacity: 0.45, y: 0.12,
  });
  // Faceted floating crystal core (tall octahedron, emissive).
  const core = facetedCrystal(0.34, color, { emissive: color, emissiveIntensity: 1.4, y: 0.55 });
  core.rotation.set(0.4, 0.4, 0);
  const light = new THREE.PointLight(color, 1.2, 5);
  light.position.y = 1.0;
  g.add(base, core, light);
  g.userData.core = core;
  return g;
}

// A short-lived particle burst (used for hits, casts, impacts). Returns a group
// with a per-frame `update(dt)` and a `done` flag the renderer polls. Particles
// are faceted shards (octahedra) so impacts scatter sharp flat-shaded fragments.
export function buildBurst(color, opts = {}) {
  const count = Math.min(opts.count || 14, CFG.BURST_MAX_PARTICLES);
  const speed = opts.speed || 6;
  const size = opts.size || 0.22;
  const life = opts.life || 0.5;
  const g = new THREE.Group();
  const parts = [];
  // All shards in a single burst share one octahedron geometry (only scale
  // and material opacity vary per-particle), cutting per-burst geometry
  // allocations from `count` down to 1.
  const shardGeo = new THREE.OctahedronGeometry(0.5, 0);
  for (let i = 0; i < count; i++) {
    const mat = new THREE.MeshLambertMaterial({
      color, emissive: color, emissiveIntensity: 0.8, flatShading: true, transparent: true,
    });
    const m = new THREE.Mesh(shardGeo, mat);
    m.castShadow = false;
    m.scale.set(0.25, size, 0.25);
    const a = Math.random() * Math.PI * 2;
    const el = (Math.random() - 0.3) * 1.4;
    const sp = speed * (0.5 + Math.random());
    m.userData.v = new THREE.Vector3(Math.cos(a) * sp, el * sp * 0.6 + 2, Math.sin(a) * sp);
    g.add(m); parts.push(m);
  }
  g.userData.t = 0;
  g.userData.life = life;
  g.userData.done = false;
  g.userData.update = (dt) => {
    g.userData.t += dt;
    const k = g.userData.t / life;
    for (const m of parts) {
      m.position.addScaledVector(m.userData.v, dt);
      m.userData.v.y -= 14 * dt;
      m.userData.v.multiplyScalar(1 - 1.5 * dt);
      if (m.material) m.material.opacity = Math.max(0, 1 - k);
      m.scale.setScalar(Math.max(0.05, 1 - k));
    }
    if (k >= 1) g.userData.done = true;
  };
  // Per-instance resources: the shared shardGeo (owned by this burst only,
  // not a global cache) and each particle's own material.
  g.userData.dispose = () => {
    shardGeo.dispose();
    for (const m of parts) m.material?.dispose();
  };
  return g;
}

// A lightning bolt rendered as a jagged emissive tube between two points.
export function buildLightning(x1, z1, x2, z2, color) {
  const g = new THREE.Group();
  const y = 1.2;
  const start = new THREE.Vector3(x1, y, z1);
  const end = new THREE.Vector3(x2, y, z2);
  const segs = 8;
  const points = [];
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    const p = start.clone().lerp(end, t);
    if (i > 0 && i < segs) {
      p.x += (Math.random() - 0.5) * 1.2;
      p.z += (Math.random() - 0.5) * 1.2;
      p.y += (Math.random() - 0.5) * 0.8;
    }
    points.push(p);
  }
  const geo = new THREE.BufferGeometry().setFromPoints(points);
  const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 1 }));
  g.add(line);
  const light = new THREE.PointLight(color, 2, 12);
  light.position.copy(start.clone().lerp(end, 0.5));
  g.add(light);
  g.userData.t = 0; g.userData.life = 0.3; g.userData.done = false;
  g.userData.update = (dt) => {
    g.userData.t += dt;
    const k = g.userData.t / g.userData.life;
    line.material.opacity = Math.max(0, 1 - k);
    light.intensity = Math.max(0, 2 * (1 - k));
    if (k >= 1) g.userData.done = true;
  };
  return g;
}

// A telegraphed meteor: a falling faceted rock plus a ground ring marker.
export function buildMeteor(x, z, fall, radius, color) {
  const g = new THREE.Group();
  const rock = facetedRock(0.9, 0x552211, {
    detail: 1, perturb: 0.18, sx: 1.6, sy: 1.6, sz: 1.6,
    emissive: 0xff3a1e, emissiveIntensity: 0.6,
  });
  rock.position.set(x, 30, z);
  g.add(rock);
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(radius - 0.3, radius, 32),
    new THREE.MeshBasicMaterial({ color: 0xff3a1e, transparent: true, opacity: 0.4, side: THREE.DoubleSide })
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.set(x, 0.1, z);
  g.add(ring);
  const light = new THREE.PointLight(0xff3a1e, 1.5, 14);
  light.position.set(x, 8, z);
  g.add(light);
  g.userData = { x, z, fall, total: fall, rock, ring, light, done: false };
  g.userData.update = (dt, tLeft) => {
    const k = 1 - tLeft / g.userData.total; // 0..1 as it falls
    rock.position.y = 30 * (1 - k);
    rock.rotation.x += dt * 4; rock.rotation.z += dt * 3;
    ring.material.opacity = 0.3 + 0.4 * k;
    ring.scale.setScalar(1 + 0.1 * Math.sin(k * 20));
    light.position.y = rock.position.y;
  };
  // Per-instance geometry/materials (meteor rock/ring are built fresh per
  // meteor, unlike the shared bolt caches) — safe to dispose on cleanup.
  g.userData.dispose = () => {
    g.traverse((obj) => {
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) {
        if (Array.isArray(obj.material)) obj.material.forEach((m) => m.dispose());
        else obj.material.dispose();
      }
    });
  };
  return g;
}

// Dark storm clouds that hover over a location during the Storming Vortex
// "storm" cinematic entrance. Returns a transient effect group with the standard
// update(dt) / done convention consumed by the renderer's effects list.
export function buildStormClouds(x, z) {
  const g = new THREE.Group();
  const life = 3.0;
  const cloudY = 7;
  const cloudColor  = 0x3a4a88;
  const accentColor = 0x7adfff;

  // Cluster of faceted puff shapes at varying offsets for depth.
  const offsets = [
    [0,    0,    0   ],
    [-1.4, 0.3,  0.6 ],
    [ 1.2, -0.2, -0.7],
    [ 0.5, 0.5,  1.4 ],
    [-0.8, 0.1,  -1.2],
  ];
  for (let i = 0; i < offsets.length; i++) {
    const [ox, oy, oz] = offsets[i];
    const r = 0.7 + (i % 3) * 0.22;
    const cloud = facetedPuff(r, i % 2 === 0 ? cloudColor : 0x4a5aaa, {
      opacity: 0.80, detail: 0,
      x: x + ox, y: cloudY + oy, z: z + oz,
      sx: 1.4 + (i % 3) * 0.2, sy: 0.7, sz: 1.1,
    });
    g.add(cloud);
  }

  // Electric glow beneath the cloud mass.
  const glow = new THREE.PointLight(accentColor, 2.0, 14);
  glow.position.set(x, cloudY - 1, z);
  g.add(glow);

  g.userData.t    = 0;
  g.userData.life = life;
  g.userData.done = false;
  g.userData.update = (dt) => {
    g.userData.t += dt;
    const k       = g.userData.t / life;
    const opacity = Math.max(0, (1 - k) * 0.80);
    for (const child of g.children) {
      if (child.material) child.material.opacity = opacity;
    }
    glow.intensity = Math.max(0, 2.0 * (1 - k * 1.5));
    if (k >= 1) g.userData.done = true;
  };
  return g;
}

// Build the voxel platform mesh for a given radius using merged boxes.
// We rebuild it when the radius changes (shrinking arena).
export function buildPlatform(radius, worldId = CFG.DEFAULT_ARENA_WORLD) {
  const g = new THREE.Group();
  const step = 2; // voxel block size for the floor
  const world = getArenaWorld(worldId);

  // Use instancing for performance.
  const cells = [];
  for (let x = -radius; x <= radius; x += step) {
    for (let z = -radius; z <= radius; z += step) {
      if (isOnArenaWorld(world.id, radius, x, z)) cells.push([x, z]);
    }
  }

  const topGeo = new THREE.BoxGeometry(step, 1, step);
  const sideGeo = new THREE.BoxGeometry(step, 3, step);
  const topMat = new THREE.MeshLambertMaterial({ color: world.top, flatShading: true });
  const sideMat = new THREE.MeshLambertMaterial({ color: world.side, flatShading: true });

  const topMesh = new THREE.InstancedMesh(topGeo, topMat, cells.length);
  const sideMesh = new THREE.InstancedMesh(sideGeo, sideMat, cells.length);
  topMesh.receiveShadow = true;
  sideMesh.receiveShadow = true;
  const dummy = new THREE.Object3D();

  cells.forEach(([x, z], i) => {
    // tiny deterministic height variation for texture
    const jitter = ((Math.abs(x * 13 + z * 7)) % 3) * 0.06;
    dummy.position.set(x, -0.5 + jitter, z);
    dummy.updateMatrix();
    topMesh.setMatrixAt(i, dummy.matrix);

    dummy.position.set(x, -2.5, z);
    dummy.updateMatrix();
    sideMesh.setMatrixAt(i, dummy.matrix);
  });
  topMesh.instanceMatrix.needsUpdate = true;
  sideMesh.instanceMatrix.needsUpdate = true;

  g.add(sideMesh, topMesh);
  g.userData.radius = radius;
  g.userData.world = world.id;
  return g;
}

// Build the animated hazard surface that surrounds and underlies the platform.
// `hazard` is an entry from CFG.ARENA_HAZARDS; its `style`/color/amp drive both
// the look and the per-frame motion in animateHazard so each map reads as its
// own environment (lava sea, ocean, toxic swamp, sharp rocks, arcane abyss).
export function buildHazard(size, y, hazard) {
  const theme = hazard || getArenaHazard(CFG.DEFAULT_ARENA_WORLD);
  const segs = theme.jagged ? 40 : 24;
  const geo = new THREE.PlaneGeometry(size, size, segs, segs);
  geo.rotateX(-Math.PI / 2);

  // Sharp rocks read as opaque flat-shaded stone; liquids glow without lighting.
  const mat = theme.jagged
    ? new THREE.MeshLambertMaterial({ color: theme.color, flatShading: true })
    : new THREE.MeshBasicMaterial({ color: theme.color });

  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.y = y;
  mesh.userData.base = geo.attributes.position.array.slice();
  mesh.userData.hazard = theme;

  // Pre-bake jagged spikes once; animateHazard leaves these static (just a tiny
  // shimmer) so the rocks feel solid rather than fluid.
  if (theme.jagged) {
    const pos = geo.attributes.position;
    const base = mesh.userData.base;
    for (let i = 0; i < pos.count; i++) {
      const x = base[i * 3];
      const z = base[i * 3 + 2];
      const spike = (Math.abs(Math.sin(x * 1.7) * Math.cos(z * 1.3)) ** 2) * 3.2;
      base[i * 3 + 1] = pos.array[i * 3 + 1] + spike;
      pos.array[i * 3 + 1] = base[i * 3 + 1];
    }
    pos.needsUpdate = true;
    geo.computeVertexNormals();
  }
  return mesh;
}

// Per-frame motion. The style decides the wave shape: lava churns, ocean rolls
// in clean swells, swamp oozes slowly, rocks barely shimmer, the void pulses.
export function animateHazard(mesh, t) {
  if (!mesh) return;
  const theme = mesh.userData.hazard || {};
  const style = theme.style || "lava";
  const amp = theme.amp ?? 0.4;
  const speed = theme.speed ?? 1.5;
  const pos = mesh.geometry.attributes.position;
  const base = mesh.userData.base;
  const tt = t * speed;
  for (let i = 0; i < pos.count; i++) {
    const x = base[i * 3];
    const z = base[i * 3 + 2];
    const baseY = base[i * 3 + 1];
    let h = 0;
    switch (style) {
      case "ocean":
        // Long directional swells layered with a cross-chop.
        h = Math.sin(x * 0.18 + tt) * amp + Math.sin((x + z) * 0.12 + tt * 0.7) * amp * 0.6;
        break;
      case "swamp":
        // Slow, sparse bubbling — mostly still with occasional rises.
        h = Math.sin(x * 0.5 + tt) * Math.cos(z * 0.5 + tt * 0.8) * amp;
        break;
      case "rocks":
        // Static jagged field, only a faint heat-haze shimmer.
        h = Math.sin(x * 2.0 + tt * 2) * amp;
        break;
      case "void":
        // Concentric arcane pulse radiating from the center.
        h = Math.sin(Math.hypot(x, z) * 0.4 - tt * 1.6) * amp;
        break;
      case "lava":
      default:
        h = Math.sin(x * 0.3 + tt) * amp + Math.cos(z * 0.4 + tt * 0.66) * amp;
        break;
    }
    pos.array[i * 3 + 1] = baseY + h;
  }
  pos.needsUpdate = true;
}

// Ambient detail props that float above the hazard surface (embers, spray,
// bubbles, dust, arcane shards). Returns a Group of instanced-ish small meshes,
// each carrying its own per-particle state. animateHazardDetails advances them
// and recycles any that rise past their ceiling, so the field loops forever.
export function buildHazardDetails(size, y, hazard) {
  const theme = hazard || getArenaHazard(CFG.DEFAULT_ARENA_WORLD);
  const detail = theme.detail;
  const g = new THREE.Group();
  if (!detail) return g;

  const half = size * 0.5;
  const kind = detail.kind;
  const color = detail.color ?? theme.color;
  const baseSize = detail.size ?? 0.25;
  const rise = detail.rise ?? 4;
  const ceiling = (detail.ceiling ?? 9);

  // Shards (void) are opaque flat-shaded crystals; everything else is a soft
  // additive-looking translucent mote.
  const makeMesh = () => {
    if (kind === "shards") {
      return new THREE.Mesh(
        new THREE.OctahedronGeometry(baseSize),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85 })
      );
    }
    return new THREE.Mesh(
      new THREE.IcosahedronGeometry(baseSize, 0),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.8 })
    );
  };

  for (let i = 0; i < detail.count; i++) {
    const m = makeMesh();
    const px = (Math.random() * 2 - 1) * half * 0.55;
    const pz = (Math.random() * 2 - 1) * half * 0.55;
    const startY = y + Math.random() * ceiling;
    m.position.set(px, startY, pz);
    m.userData.p = {
      x: px, z: pz,
      baseY: y,
      ceiling,
      vy: rise * (0.5 + Math.random()),
      drift: (Math.random() * 2 - 1) * 0.6,
      phase: Math.random() * Math.PI * 2,
      spin: (Math.random() * 2 - 1) * 2,
      size: baseSize,
    };
    g.add(m);
  }
  g.userData.detail = detail;
  return g;
}

// Per-frame motion for the ambient detail props. Each particle rises, drifts,
// fades near its ceiling, then recycles to the surface — an endless loop.
export function animateHazardDetails(group, t, dt) {
  if (!group || !group.children.length) return;
  const detail = group.userData.detail || {};
  const kind = detail.kind;
  const step = Number.isFinite(dt) ? dt : 0.016;
  for (const m of group.children) {
    const p = m.userData.p;
    if (!p) continue;
    p.vy += 0; // constant rise (kept simple/cheap)
    m.position.y += p.vy * step;

    // Lateral motion: sway for light motes, gentle bob for bubbles/dust.
    const sway = Math.sin(t * 1.5 + p.phase) * p.drift;
    m.position.x = p.x + sway;
    m.position.z = p.z + Math.cos(t * 1.2 + p.phase) * p.drift * 0.6;

    const climbed = m.position.y - p.baseY;
    const k = Math.min(1, climbed / p.ceiling);
    if (m.material) m.material.opacity = Math.max(0, (1 - k) * 0.85);

    if (kind === "shards") {
      m.rotation.x += p.spin * step;
      m.rotation.y += p.spin * step * 0.7;
    } else if (kind === "embers") {
      // Embers shrink as they cool.
      m.scale.setScalar(Math.max(0.15, 1 - k));
    }

    // Recycle once it reaches the ceiling.
    if (climbed >= p.ceiling) {
      m.position.y = p.baseY;
      m.scale.setScalar(1);
      if (m.material) m.material.opacity = 0.85;
    }
  }
}

// --- Map layout geometry builders -----------------------------------------
// These are called by the renderer once per round when the host broadcasts a
// new mapLayout.  They share the world top/side palette and flatShading style
// of buildPlatform so the elevation layer feels like a seamless extension of
// the existing arena tiles.

/**
 * Build the elevated body + top cap for one plateau footprint.
 * Meshes are positioned in world-space so the Group can be added directly
 * to the scene without an extra transform.
 *
 * @param {{ x:number, z:number, w:number, d:number, height:number }} pl
 * @param {string} worldId
 * @returns {THREE.Group}
 */
export function buildPlateau(pl, worldId = CFG.DEFAULT_ARENA_WORLD) {
  const g     = new THREE.Group();
  const world = getArenaWorld(worldId);

  // Body: spans from PLATFORM_TOP to the plateau surface; uses world.side color
  // to match the vertical edges of buildPlatform tiles. Segmented so each face
  // breaks into flat facets that catch the low-poly aesthetic.
  const body = facetedSlab(pl.w, pl.height, pl.d, world.side, {
    widthSegments: 3, heightSegments: 2, depthSegments: 3,
    x: pl.x, y: CFG.PLATFORM_TOP + pl.height * 0.5, z: pl.z,
  });
  g.add(body);

  // Top cap: a thin slab proud of the surface so it reads as the walkable top
  // (mirrors the single-step top tiles in buildPlatform).
  const capH = 0.35;
  const top  = facetedSlab(pl.w, capH, pl.d, world.top, {
    widthSegments: 3, depthSegments: 3,
    x: pl.x, y: CFG.PLATFORM_TOP + pl.height + capH * 0.5, z: pl.z,
  });
  g.add(top);

  return g;
}

/**
 * Build the stacked-step ramp that connects ground level to a plateau face.
 * Uses one box per step so the geometry reads as voxel blocks (same aesthetic
 * as buildPlatform's grid tiles).  Positions are in world-space.
 *
 * Side conventions (from mapgen.js):
 *   0 = +x face: ramp extends in +x; head (high) at ramp.x − ramp.w/2.
 *   1 = −x face: ramp extends in −x; head (high) at ramp.x + ramp.w/2.
 *   2 = +z face: ramp extends in +z; head (high) at ramp.z − ramp.d/2.
 *   3 = −z face: ramp extends in −z; head (high) at ramp.z + ramp.d/2.
 *
 * @param {{ side:number, x:number, z:number, w:number, d:number }} ramp
 * @param {number} plateauHeight  – height of the parent plateau above PLATFORM_TOP
 * @param {string} worldId
 * @returns {THREE.Group}
 */
export function buildRamp(ramp, plateauHeight, worldId = CFG.DEFAULT_ARENA_WORLD) {
  const g     = new THREE.Group();
  const world = getArenaWorld(worldId);

  const isX    = ramp.side <= 1;         // slope direction: x-axis or z-axis
  const rampLen = isX ? ramp.w : ramp.d; // length along the slope
  const rampWid = isX ? ramp.d : ramp.w; // perpendicular width

  // One step per world-unit; min 2 so even a short ramp reads as stairs.
  const N       = Math.max(2, Math.ceil(rampLen));
  const stepLen = rampLen / N;
  const stepH   = plateauHeight / N;

  const topMat  = new THREE.MeshLambertMaterial({ color: world.top,  flatShading: true });
  const sideMat = new THREE.MeshLambertMaterial({ color: world.side, flatShading: true });

  for (let i = 0; i < N; i++) {
    // Each step grows taller toward the head (plateau edge).
    const h   = (i + 1) * stepH;
    // The topmost step uses world.top to blend into the plateau top cap.
    const mat = (i === N - 1) ? topMat : sideMat;
    const bw  = isX ? stepLen : rampWid;
    const bd  = isX ? rampWid : stepLen;

    const mesh = new THREE.Mesh(new THREE.BoxGeometry(bw, h, bd, 2, 1, 2), mat);

    // Advance from the foot (low end) toward the head (plateau edge).
    let px, pz;
    if (ramp.side === 0) {        // foot at +x, head at −x
      px = ramp.x + ramp.w * 0.5 - (i + 0.5) * stepLen;
      pz = ramp.z;
    } else if (ramp.side === 1) { // foot at −x, head at +x
      px = ramp.x - ramp.w * 0.5 + (i + 0.5) * stepLen;
      pz = ramp.z;
    } else if (ramp.side === 2) { // foot at +z, head at −z
      px = ramp.x;
      pz = ramp.z + ramp.d * 0.5 - (i + 0.5) * stepLen;
    } else {                      // side 3: foot at −z, head at +z
      px = ramp.x;
      pz = ramp.z - ramp.d * 0.5 + (i + 0.5) * stepLen;
    }

    mesh.position.set(px, CFG.PLATFORM_TOP + h * 0.5, pz);
    mesh.castShadow    = true;
    mesh.receiveShadow = true;
    g.add(mesh);
  }

  return g;
}

// ── Item-drop / pickup mesh builders ─────────────────────────────────────────
// buildItemDrop(kind, color, opts) — builds a floating pickup group.
// kind ∈ "orb" | "tome" | "blade" | "boots" | "crown" | "rune"
// opts: { rarity="common"|"rare"|"epic"|"legendary", glow=true, scale=1,
//         floatAmp, floatHz, spinHz }
//
// Each private shape builder returns { group, core } where core is the innermost
// glow mesh that bobs independently (matches buildRune's userData.core contract).

function _buildOrb(color) {
  const g    = new THREE.Group();
  const core = facetedOrb(0.4, color, { emissive: color, emissiveIntensity: 1.2, y: 0.55 });
  const halo = facetedAura(0.72, color, { opacity: 0.28, y: 0.55 });
  halo.rotation.set(0.4, 0.4, 0);
  g.add(halo, core);
  return { group: g, core };
}

function _buildTome(color) {
  const g = new THREE.Group();
  const coverColor = tint(color, 0, -0.1, -0.2);
  g.add(facetedSlab(0.7, 0.5, 0.18, coverColor, { widthSegments: 2, y: 0.25 }));        // book body
  const sp = facetedCylinder(0.06, 0.06, 0.55, color, { segments: 4, emissive: color, emissiveIntensity: 0.8, x: -0.36, y: 0.27 });
  g.add(sp);                                                                               // spine
  g.add(facetedSlab(0.56, 0.44, 0.12, shade(0xfff8e8, 0), { y: 0.27, z: 0.05 }));        // page edges
  // Floating crystal above the book — the bob target.
  const core = facetedCrystal(0.16, color, { emissive: color, emissiveIntensity: 1.4, y: 0.55 });
  g.add(core);
  return { group: g, core };
}

function _buildBlade(color) {
  const g = new THREE.Group();
  // Faceted blade — elongated octahedron shard with a diamond cross-section.
  g.add(facetedShard(1.1, shade(color, 0.1), { y: 0.55 }));
  g.add(facetedSlab(0.55, 0.12, 0.14, shade(color, -0.15), { y: 0.07 }));                // crossguard
  const core = facetedOrb(0.13, color, { emissive: color, emissiveIntensity: 1.1, detail: 0, y: -0.05 });
  g.add(core);                                                                            // pommel (core)
  return { group: g, core };
}

function _buildBoots(color) {
  const g      = new THREE.Group();
  const lColor = shade(color, -0.1);
  // Left and right boots (foot + shaft faceted slabs each).
  g.add(facetedSlab(0.28, 0.42, 0.32, lColor, { x: -0.2, y: 0.21 }));
  g.add(facetedSlab(0.28, 0.18, 0.52, lColor, { x: -0.2, y: 0.02, z: 0.08 }));
  g.add(facetedSlab(0.28, 0.42, 0.32, lColor, { x:  0.2, y: 0.21 }));
  g.add(facetedSlab(0.28, 0.18, 0.52, lColor, { x:  0.2, y: 0.02, z: 0.08 }));
  const core = facetedOrb(0.12, color, { emissive: color, emissiveIntensity: 1.0, detail: 0, y: 0.55 });
  g.add(core);                                                                            // central accent
  return { group: g, core };
}

function _buildCrown(color) {
  const g = new THREE.Group();
  // Faceted ring base (wide octagonal prism).
  g.add(facetedCylinder(0.45, 0.45, 0.22, shade(color, -0.12), { segments: 8, y: 0.11 }));
  const spikeH = [0.52, 0.42, 0.52, 0.42, 0.52];
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    g.add(facetedCone(0.1, spikeH[i], shade(color, 0.05), {
      segments: 4, x: Math.cos(a) * 0.33, y: 0.22 + spikeH[i] * 0.5, z: Math.sin(a) * 0.33,
    }));
  }
  // Three decorative jewels at evenly-spaced positions around the band.
  const jewelsA = [0, (2 / 5) * Math.PI * 2, (4 / 5) * Math.PI * 2];
  for (let i = 0; i < 3; i++) {
    const a  = jewelsA[i];
    const jc = i === 0 ? color : tint(color, (i * 0.15) % 0.4, 0.1, 0.05);
    g.add(facetedOrb(0.1, jc, {
      emissive: jc, emissiveIntensity: 1.3, detail: 0,
      x: Math.cos(a) * 0.32, y: 0.28, z: Math.sin(a) * 0.32,
    }));
  }
  const core = facetedOrb(0.14, color, { emissive: color, emissiveIntensity: 1.5, y: 0.55 });
  g.add(core);
  return { group: g, core };
}

// Re-uses the faceted rune recipe so buildItemDrop("rune") is visually identical
// to the standalone buildRune() — a clear migration path for the renderer rune loop.
function _buildRuneShape(color) {
  const g    = new THREE.Group();
  const base = facetedSlab(0.9, 0.25, 0.9, color, { widthSegments: 2, depthSegments: 2, transparent: true, opacity: 0.45, y: 0.12 });
  const core = facetedCrystal(0.34, color, { emissive: color, emissiveIntensity: 1.4, y: 0.55 });
  core.rotation.set(0.5, 0.5, 0);
  g.add(base, core);
  return { group: g, core };
}

const ITEM_SHAPES = {
  orb:   _buildOrb,
  tome:  _buildTome,
  blade: _buildBlade,
  boots: _buildBoots,
  crown: _buildCrown,
  rune:  _buildRuneShape,
};

// Rarity → ring accent color and glow intensity.
const _RARITY_COLORS = {
  common:    0x888888,
  rare:      0x4499ff,
  epic:      0xbb44ff,
  legendary: 0xffcc22,
  unfair:    0xff2277,  // beyond-legendary: hot magenta for meteorScroll, chronoLocket
};
const _RARITY_INTENSITY = { common: 0.4, rare: 1.0, epic: 1.4, legendary: 2.0, unfair: 2.8 };

// Flat ring + optional PointLight halo placed at ground level; pulsed by animatePickup.
// Only epic/legendary drops get a real PointLight to keep the per-frame light budget
// bounded (WebGL forward rendering recompiles materials per active light count).
// Common and rare drops rely on the emissive core and ring for visual glow.
function _rarityHalo(color, rarity = "common") {
  const g  = new THREE.Group();
  const rc = _RARITY_COLORS[rarity] ?? _RARITY_COLORS.common;
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.38, 0.52, 24),
    new THREE.MeshBasicMaterial({
      color: rc, transparent: true,
      opacity: rarity === "common" ? 0.25 : 0.55,
      side: THREE.DoubleSide,
    })
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.06;
  g.add(ring);
  // Only high-rarity drops get a real PointLight; others keep their emissive core.
  let light = null;
  if (rarity === "epic" || rarity === "legendary" || rarity === "unfair") {
    light = new THREE.PointLight(rc, _RARITY_INTENSITY[rarity] ?? 0.6, 4);
    light.position.y = 0.8;
    g.add(light);
  }
  g.userData.pulse = { ring, light, rarity };
  return g;
}

// Float bob + slow spin + glow pulse. Reads group.userData.pickup. Idempotent,
// allocation-free. Drives userData.core bob (same 0.55 + sin contract the renderer
// currently hand-codes for runes) so it can replace that inline code later.
//
// Time handling: accumulates p.t internally each call so update(dt) (single-arg,
// matching the renderer's effects-loop convention) works correctly. The optional
// second argument `t` is an absolute-time override; when omitted or NaN (as when
// called from g.userData.update(dt)), the internal accumulator is used instead.
export function animatePickup(group, t, dt) {
  const p = group.userData.pickup;
  if (!p) return;
  // Accumulate internal clock; fall back to it when absolute t is not provided.
  p.t = (p.t ?? 0) + dt;
  const time = (t !== undefined && !isNaN(t)) ? t : p.t;
  group.rotation.y += dt * Math.PI * 2 * ((p.spinHz ?? 1.4) / 6);
  if (group.userData.core) {
    group.userData.core.position.y =
      (p.baseY ?? 0.55) + Math.sin(time * (p.floatHz ?? 1.6) * 2) * (p.floatAmp ?? 0.12);
  }
  // Pulse rarity halo ring + light on any child that carries userData.pulse.
  for (const child of group.children) {
    const ph = child.userData.pulse;
    if (!ph) continue;
    const base = _RARITY_INTENSITY[ph.rarity] ?? 0.6;
    if (ph.light) ph.light.intensity = base * (0.75 + Math.sin(time * 3.5) * 0.25);
    if (ph.ring && ph.ring.material) {
      ph.ring.material.opacity =
        (ph.rarity === "common" ? 0.2 : 0.45) + Math.sin(time * 3.5) * 0.12;
    }
  }
  animateSecondary(group, time, dt);
}

// kind ∈ "orb" | "tome" | "blade" | "boots" | "crown" | "rune"
// opts: { rarity="common"|"rare"|"epic"|"legendary", glow=true, scale=1,
//         floatAmp, floatHz, spinHz }
// Returns a self-animating Group; tick via g.userData.update(dt, t) or
// call animatePickup(g, t, dt) directly from the game loop.
export function buildItemDrop(kind = "orb", color = 0xffffff, opts = {}) {
  const g      = new THREE.Group();
  const shapeFn = ITEM_SHAPES[kind] || ITEM_SHAPES.orb;
  const body   = shapeFn(color, opts);
  g.add(body.group);

  if (opts.glow !== false) g.add(_rarityHalo(color, opts.rarity));

  // Note: the rune standalone builder (buildRune) adds its own PointLight, but
  // buildItemDrop("rune") already gets one from _rarityHalo for epic/legendary
  // rarity, and common/rare rely on the emissive core. No extra light needed here.

  g.userData.kind   = kind;
  g.userData.rarity = opts.rarity || "common";
  g.userData.core   = body.core;   // mirrors buildRune's userData.core contract
  g.userData.pickup = {
    floatAmp: opts.floatAmp ?? 0.12,
    floatHz:  opts.floatHz  ?? 1.6,
    spinHz:   opts.spinHz   ?? 1.4,
    baseY:    0.55,
    t:        0,   // internal time accumulator — driven by animatePickup
  };
  // Single-arg update(dt) matches the renderer effects-loop convention
  // (buildBurst/buildLightning use the same pattern). animatePickup accumulates
  // time internally so no absolute-t argument is needed.
  g.userData.update = (dt2) => animatePickup(g, undefined, dt2);

  // Expose dispose() so the renderer can clean up BufferGeometry/Material/Lights
  // when culling drops, rather than leaking them on churn.
  g.userData.dispose = () => {
    g.traverse((obj) => {
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) {
        if (Array.isArray(obj.material)) obj.material.forEach((m) => m.dispose());
        else obj.material.dispose();
      }
    });
  };

  if (opts.scale && opts.scale !== 1) g.scale.setScalar(opts.scale);
  return g;
}

// ── Mob mesh builders ────────────────────────────────────────────────────────
// Each builder returns a THREE.Group following the buildWarlock recipe:
//   userData.rig        — named joints for animateMob
//   userData.anim       — { phase, attack, flicker } accumulators
//   userData.healthBar  — foreground bar Mesh; renderer sets scale.x = hp/max
//
// Heights:  Stone Giant ≈ 5.8 wu (2.6× warlock);  vortex/dwarf/elemental ≈ 3–4 wu;
//           minion ≈ 0.7× warlock (group scale 0.7, warlock-proportion geometry).

const _makeHealthBar = makeMobHealthBar;

// Stone Giant — grey stone colossus, oversized fists, glowing red eye slits.
// Faceted polyhedron head/fists + hex-prism limbs for a hewn-stone silhouette.
export function buildStoneGiant(color = 0x888888) {
  const g = new THREE.Group();
  const stone = color;
  const dark  = shade(stone, -0.15);
  const light = shade(stone, 0.08);

  const torso = joint(0, 2.0, 0);
  g.add(torso);
  torso.add(facetedSlab(2.4, 1.6, 1.8, stone, { widthSegments: 3, heightSegments: 2, depthSegments: 2 }));
  torso.add(facetedSlab(2.6, 0.34, 2.0, dark, { y: -0.85 }));
  torso.add(facetedSlab(2.3, 0.26, 1.9, light, { widthSegments: 3, y: 0.55, z: 0.06 }));
  torso.add(facetedSlab(2.15, 0.24, 1.82, dark,  { widthSegments: 3, y: 0.10, z: 0.08 }));
  torso.add(facetedSlab(2.0, 0.22, 1.72, light, { widthSegments: 3, y: -0.35, z: 0.06 }));

  const head = joint(0, 1.2, 0);
  torso.add(head);
  head.add(facetedRock(0.8, light, { detail: 1, perturb: 0.1, sx: 1.0, sy: 0.75, sz: 0.88, y: 0.2 }));
  head.add(facetedRock(0.55, dark, { detail: 1, perturb: 0.14, sx: 1.5, sy: 0.32, sz: 0.7, y: 0.5, z: 0.42 }));
  const glowMat = new THREE.MeshBasicMaterial({ color: 0xff4400 });
  const eL = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.14, 0.08), glowMat);
  const eR = eL.clone();
  eL.position.set(-0.3, 0.35, 0.72);
  eR.position.set( 0.3, 0.35, 0.72);
  head.add(eL, eR);

  const shoulderL = facetedRock(0.85, light, { detail: 1, perturb: 0.16, sx: 1.15, sy: 0.9, sz: 1.1, x: -1.55, y: 1.15, z: 0.1 });
  const shoulderR = facetedRock(0.85, light, { detail: 1, perturb: 0.16, sx: 1.15, sy: 0.9, sz: 1.1, x:  1.55, y: 1.15, z: 0.1 });
  torso.add(shoulderL, shoulderR);

  const accents = new THREE.Group();
  g.add(accents);
  const spineCrystalYs = [0.2, 0.9, 1.6, 2.3];
  for (let i = 0; i < spineCrystalYs.length; i++) {
    const cr = facetedCrystal(0.16 + i * 0.02, 0xff5522, {
      emissive: 0xff3300, emissiveIntensity: 0.9, sx: 0.55, sy: 1.3, sz: 0.55,
      y: spineCrystalYs[i], z: -1.0,
    });
    cr.rotation.x = -0.35;
    accents.add(cr);
  }

  const armL = joint(-1.7, 0.3, 0.1);
  const armR = joint( 1.7, 0.3, 0.1);
  torso.add(armL, armR);
  armL.add(facetedCylinder(0.4, 0.4, 1.8, stone, { segments: 8, y: -0.9 }));
  const fistL = facetedRock(0.65, dark, { detail: 1, perturb: 0.14, sx: 1.0, sy: 0.92, sz: 1.0, y: -2.3 });
  armL.add(fistL);
  armR.add(facetedCylinder(0.4, 0.4, 1.8, stone, { segments: 8, y: -0.9 }));
  const fistR = facetedRock(0.65, dark, { detail: 1, perturb: 0.14, sx: 1.0, sy: 0.92, sz: 1.0, y: -2.3 });
  armR.add(fistR);
  const knuckleX = [-0.28, 0, 0.28];
  for (const kx of knuckleX) {
    const knuckleL = facetedRock(0.16, light, { detail: 0, perturb: 0.2, x: kx, y: -2.3, z: 0.5 });
    const knuckleR = facetedRock(0.16, light, { detail: 0, perturb: 0.2, x: kx, y: -2.3, z: 0.5 });
    armL.add(knuckleL);
    armR.add(knuckleR);
  }

  // Legs
  const legL = joint(-0.65, 0, 0);
  const legR = joint( 0.65, 0, 0);
  g.add(legL, legR);
  legL.add(facetedCylinder(0.45, 0.45, 1.8, stone, { segments: 8, y: -0.9 }));
  legR.add(facetedCylinder(0.45, 0.45, 1.8, stone, { segments: 8, y: -0.9 }));

  const hb = _makeHealthBar(0xff3a1e, 5.2);
  g.add(hb.group);
  g.userData.rig = { spine: torso, neck: head, armL, armR, legL, legR, accents, spineBaseY: 2.0 };
  g.userData.anim = { phase: 0, attack: 0 };
  g.userData.healthBar = hb.bar;
  return g;
}

// Storming Vortex — translucent spinning shard ring with glowing core.
// Faceted octahedron shards + a hex-prism crystal core.
export function buildStormingVortex(color = 0x7adfff) {
  const g = new THREE.Group();
  const c1 = color;
  const c2 = shade(color, 0.2);

  const c3 = shade(color, -0.15);

  const spin = new THREE.Group();
  g.add(spin);
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const shard = facetedShard(1.4, i % 2 === 0 ? c1 : c2, {
      emissive: i % 2 === 0 ? c1 : c2, emissiveIntensity: 0.9,
      transparent: true, opacity: 0.75, cast: false,
    });
    shard.position.set(Math.cos(a) * 0.9, 0.2 + (i % 3 - 1) * 0.22, Math.sin(a) * 0.9);
    shard.rotation.y = a;
    shard.rotation.x = 0.28;
    spin.add(shard);
  }

  // Core body (hex-prism crystal)
  const core = joint(0, 0.8, 0);
  g.add(core);
  core.add(facetedCylinder(0.4, 0.4, 1.6, c1, { segments: 6, emissive: c1, emissiveIntensity: 0.7 }));
  core.add(facetedCrystal(0.3, c1, { emissive: c1, emissiveIntensity: 1.1, sx: 0.7, sy: 1.4, sz: 0.7, y: 0.95 }));
  const eyeM = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const eye = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 0.08), eyeM);
  eye.position.set(0, 0.35, 0.42);
  core.add(eye);

  const midRing = new THREE.Group();
  g.add(midRing);
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    const shard = facetedShard(0.5, c3, {
      emissive: c3, emissiveIntensity: 0.8, transparent: true, opacity: 0.6, cast: false,
    });
    shard.position.set(Math.cos(a) * 1.15, 0.8, Math.sin(a) * 1.15);
    shard.rotation.z = Math.PI / 2;
    shard.rotation.y = a;
    midRing.add(shard);
  }

  const outerSpin = new THREE.Group();
  g.add(outerSpin);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const shard = facetedShard(0.8, c2, {
      emissive: c2, emissiveIntensity: 0.7,
      transparent: true, opacity: 0.5, cast: false,
    });
    shard.position.set(Math.cos(a) * 1.5, 0.4, Math.sin(a) * 1.5);
    outerSpin.add(shard);
  }

  const arcCrystals = new THREE.Group();
  g.add(arcCrystals);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const cr = facetedCrystal(0.2, 0xffffff, {
      emissive: c1, emissiveIntensity: 1.2, sx: 0.5, sy: 1.5, sz: 0.5,
      x: Math.cos(a) * 0.7, y: 1.6, z: Math.sin(a) * 0.7,
    });
    cr.rotation.z = Math.cos(a) * 0.5;
    cr.rotation.x = Math.sin(a) * 0.5;
    arcCrystals.add(cr);
  }

  const glow = new THREE.PointLight(c1, 1.5, 8);
  glow.position.set(0, 1.2, 0);
  g.add(glow);

  const hb = _makeHealthBar(0x7adfff, 2.5);
  g.add(hb.group);
  g.userData.rig = { spine: core, spin, outerSpin, midRing, arcCrystals, spineBaseY: 0.8 };
  g.userData.anim = { phase: 0, attack: 0 };
  g.userData.healthBar = hb.bar;
  g.scale.setScalar(1.35);
  return g;
}

// Giant Dwarf — short/wide armoured figure, heavy stomp posture.
// Faceted armour slabs + hex-prism limbs + a cone helmet.
export function buildGiantDwarf(color = 0xc47a2e) {
  const g = new THREE.Group();
  const body  = shade(color, -0.05);
  const armor = shade(color, -0.2);
  const skin  = 0xf0c0a0;

  // Wide stocky torso
  const torso = joint(0, 1.1, 0);
  g.add(torso);
  torso.add(facetedSlab(2.2, 1.2, 1.6, body,  { widthSegments: 3, heightSegments: 2, depthSegments: 2 }));
  torso.add(facetedSlab(2.4, 0.3, 1.8, armor, { y: -0.6 }));  // belt plate
  torso.add(facetedSlab(2.4, 0.3, 1.8, armor, { y:  0.55 })); // chest plate

  const beardColor = 0x884422;
  const beardDark  = shade(beardColor, -0.08);

  // Broad head + beard
  const neck = joint(0, 0.9, 0);
  torso.add(neck);
  neck.add(facetedRock(0.55, skin, { detail: 1, perturb: 0.06, sx: 1.09, sy: 0.91, sz: 0.91, y: 0.1 }));
  neck.add(facetedSlab(1.0, 0.5, 0.5, beardColor, { y: -0.38 }));
  const braidX = [-0.28, 0, 0.28];
  for (const bx of braidX) {
    const braid = facetedCone(0.11, 0.55, bx === 0 ? beardColor : beardDark, {
      segments: 5, x: bx, y: -0.78, z: 0.18,
    });
    braid.rotation.x = Math.PI;
    neck.add(braid);
    neck.add(facetedOrb(0.07, 0x554433, { emissive: 0x000000, emissiveIntensity: 0, detail: 0, x: bx, y: -1.05, z: 0.18 }));
  }
  neck.add(facetedSlab(1.3, 0.32, 1.1, armor, { y: 0.62 }));                   // helmet brim
  neck.add(facetedCone(0.32, 0.42, armor, { segments: 6, y: 0.86 }));          // helmet top
  const hornL = facetedCone(0.13, 0.6, 0xf0e4c8, { segments: 5, x: -0.6, y: 0.9, z: 0.0 });
  const hornR = facetedCone(0.13, 0.6, 0xf0e4c8, { segments: 5, x:  0.6, y: 0.9, z: 0.0 });
  hornL.rotation.z =  0.7;
  hornR.rotation.z = -0.7;
  neck.add(hornL, hornR);
  const em2 = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const dL = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.13, 0.08), em2);
  const dR = dL.clone();
  dL.position.set(-0.22, 0.18, 0.52);
  dR.position.set( 0.22, 0.18, 0.52);
  neck.add(dL, dR);

  const accents = new THREE.Group();
  torso.add(accents);
  const pauldronL = facetedRock(0.6, armor, { detail: 0, perturb: 0.05, sx: 1.3, sy: 0.75, sz: 1.15, x: -1.25, y: 0.72, z: 0.05 });
  const pauldronR = facetedRock(0.6, armor, { detail: 0, perturb: 0.05, sx: 1.3, sy: 0.75, sz: 1.15, x:  1.25, y: 0.72, z: 0.05 });
  accents.add(pauldronL, pauldronR);
  accents.add(facetedSlab(0.7, 0.12, 0.7, shade(armor, -0.12), { x: -1.25, y: 0.98 }));
  accents.add(facetedSlab(0.7, 0.12, 0.7, shade(armor, -0.12), { x:  1.25, y: 0.98 }));

  // Short stubby arms + gauntlets
  const armL = joint(-1.35, 0.25, 0.1);
  const armR = joint( 1.35, 0.25, 0.1);
  torso.add(armL, armR);
  armL.add(facetedCylinder(0.33, 0.33, 1.2, body,  { segments: 8, y: -0.6 }));
  const gauntletL = facetedRock(0.44, armor, { detail: 0, perturb: 0.08, sx: 1.0, sy: 1.0, sz: 1.0, y: -1.4 });
  armL.add(gauntletL);
  armL.add(facetedSlab(0.7, 0.3, 0.7, shade(armor, -0.12), { y: -1.15 }));
  armR.add(facetedCylinder(0.33, 0.33, 1.2, body,  { segments: 8, y: -0.6 }));
  const gauntletR = facetedRock(0.44, armor, { detail: 0, perturb: 0.08, sx: 1.0, sy: 1.0, sz: 1.0, y: -1.4 });
  armR.add(gauntletR);
  armR.add(facetedSlab(0.7, 0.3, 0.7, shade(armor, -0.12), { y: -1.15 }));

  // Short wide legs
  const legL = joint(-0.58, 0, 0);
  const legR = joint( 0.58, 0, 0);
  g.add(legL, legR);
  legL.add(facetedCylinder(0.39, 0.39, 0.9, body,  { segments: 8, y: -0.45 }));
  legL.add(facetedSlab(0.9, 0.38, 1.0, armor, { y: -0.98, z: 0.08 }));        // boot
  legL.add(facetedSlab(0.95, 0.16, 0.5, shade(armor, -0.12), { y: -1.1, z: 0.32 }));
  legR.add(facetedCylinder(0.39, 0.39, 0.9, body,  { segments: 8, y: -0.45 }));
  legR.add(facetedSlab(0.9, 0.38, 1.0, armor, { y: -0.98, z: 0.08 }));
  legR.add(facetedSlab(0.95, 0.16, 0.5, shade(armor, -0.12), { y: -1.1, z: 0.32 }));

  const hb = _makeHealthBar(0xffd23c, 3.8);
  g.add(hb.group);
  g.userData.rig = { spine: torso, neck, armL, armR, legL, legR, accents, spineBaseY: 1.1 };
  g.userData.anim = { phase: 0, attack: 0 };
  g.userData.healthBar = hb.bar;
  g.scale.setScalar(1.1);
  return g;
}

// Fire Elemental — emissive faceted flame-forms with orbiting flame motes,
// per-frame flicker. Bodies are perturbed icosahedra so the silhouette reads as
// hewn flame rather than a plain box.
export function buildFireElemental(color = 0xff5a1e) {
  const g = new THREE.Group();
  const hot  = color;
  const core = 0xffcc44;

  const torso = joint(0, 1.2, 0);
  g.add(torso);
  torso.add(facetedRock(0.7, hot, {
    detail: 1, perturb: 0.16, sx: 1.0, sy: 1.43, sz: 0.86,
    emissive: 0xff3300, emissiveIntensity: 0.8,
  }));
  const coreShell = facetedRock(0.4, core, {
    detail: 1, perturb: 0.1, sx: 0.875, sy: 1.5, sz: 0.875,
    emissive: 0xffcc00, emissiveIntensity: 1.4, y: 0.1,
  });
  torso.add(coreShell);
  torso.add(facetedOrb(0.22, 0xffee88, { emissive: 0xffdd44, emissiveIntensity: 1.8, detail: 0, y: 0.1 }));

  const head = joint(0, 1.2, 0);
  torso.add(head);
  head.add(facetedRock(0.55, hot, {
    detail: 1, perturb: 0.12, sx: 1.0, sy: 0.91, sz: 0.91,
    emissive: 0xff5500, emissiveIntensity: 1.0,
  }));
  const crown = new THREE.Group();
  head.add(crown);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const cone = facetedCone(0.12, 0.55, i % 2 === 0 ? core : hot, {
      segments: 4, x: Math.cos(a) * 0.42, y: 0.55, z: Math.sin(a) * 0.42,
      emissive: i % 2 === 0 ? 0xffcc00 : 0xff4400, emissiveIntensity: 1.2, cast: false,
    });
    cone.rotation.z = -Math.cos(a) * 0.4;
    cone.rotation.x =  Math.sin(a) * 0.4;
    crown.add(cone);
  }
  crown.add(facetedCone(0.16, 0.7, 0xffdd55, { segments: 4, y: 0.7, emissive: 0xffcc00, emissiveIntensity: 1.4, cast: false }));
  const em3 = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const fL = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.16, 0.08), em3);
  const fR = fL.clone();
  fL.position.set(-0.22, 0.06, 0.52);
  fR.position.set( 0.22, 0.06, 0.52);
  head.add(fL, fR);

  const armL = joint(-0.85, 0.5, 0.1);
  const armR = joint( 0.85, 0.5, 0.1);
  torso.add(armL, armR);
  armL.add(facetedCylinder(0.25, 0.25, 1.5, hot, { segments: 8, y: -0.75, emissive: 0xff3300, emissiveIntensity: 0.7 }));
  const tendrilL = facetedShard(0.7, 0xffcc44, { y: -1.6, emissive: 0xffaa22, emissiveIntensity: 1.1, cast: false });
  armL.add(tendrilL);
  armR.add(facetedCylinder(0.25, 0.25, 1.5, hot, { segments: 8, y: -0.75, emissive: 0xff3300, emissiveIntensity: 0.7 }));
  const tendrilR = facetedShard(0.7, 0xffcc44, { y: -1.6, emissive: 0xffaa22, emissiveIntensity: 1.1, cast: false });
  armR.add(tendrilR);

  const motes = new THREE.Group();
  g.add(motes);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const mc = i % 2 === 0 ? 0xffcc44 : hot;
    const mote = facetedShard(0.36, mc, {
      emissive: mc, emissiveIntensity: 0.8, transparent: true, opacity: 0.85, cast: false,
    });
    mote.position.set(Math.cos(a) * 0.85, 1.0, Math.sin(a) * 0.85);
    mote.userData.baseA = a;
    motes.add(mote);
  }

  const glow = new THREE.PointLight(hot, 2.0, 10);
  glow.position.set(0, 1.5, 0);
  g.add(glow);

  const hb = _makeHealthBar(0xff5a1e, 4.0);
  g.add(hb.group);
  g.userData.rig = { spine: torso, neck: head, armL, armR, motes, crown, glow, spineBaseY: 1.2 };
  g.userData.anim = { phase: 0, attack: 0, flicker: 0 };
  g.userData.healthBar = hb.bar;
  g.scale.setScalar(1.1);
  return g;
}

// Minion — tiny warlock silhouette tinted to parent colour, 0.7× warlock.
// Faceted slabs + hex-prism limbs + a cone hat.
export function buildMinion(color = 0x999999) {
  const g = new THREE.Group();
  const c     = color;
  const cDark = shade(c, -0.2);
  const skin  = 0xf0c8a0;

  const cLight = shade(c, 0.1);

  const spine = joint(0, 0.6, 0);
  g.add(spine);
  spine.add(facetedSlab(1.1, 0.6, 1.1, cDark, { y: -0.30 }));
  spine.add(facetedSlab(0.9, 0.7, 0.9, c,     { y:  0.35 }));
  const robePanelL = facetedSlab(0.5, 0.85, 0.14, cLight, { x: -0.24, y: 0.05, z: 0.52 });
  const robePanelR = facetedSlab(0.5, 0.85, 0.14, cLight, { x:  0.24, y: 0.05, z: 0.52 });
  const robeCollar = facetedSlab(0.95, 0.14, 0.95, cLight, { y: 0.66 });
  spine.add(robePanelL, robePanelR, robeCollar);

  const neck = joint(0, 1.25, 0);
  spine.add(neck);
  neck.add(facetedRock(0.3, skin, { detail: 1, perturb: 0.05, sx: 1.0, sy: 1.0, sz: 1.0 }));
  const em4 = new THREE.MeshBasicMaterial({ color: 0xffff88 });
  const me1 = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.1, 0.06), em4);
  const me2 = me1.clone();
  me1.position.set(-0.15, 0.04, 0.3);
  me2.position.set( 0.15, 0.04, 0.3);
  neck.add(me1, me2);
  neck.add(facetedRock(0.09, skin, { detail: 0, perturb: 0.1, y: -0.05, z: 0.32 }));

  const hat = joint(0, 0.35, 0);
  neck.add(hat);
  hat.add(facetedCylinder(0.5, 0.62, 0.16, cDark, { segments: 8, y: 0.02 }));
  hat.add(facetedCone(0.34, 0.65, c, { segments: 6, y: 0.5 }));
  hat.add(facetedCone(0.12, 0.28, cDark, { segments: 5, y: 0.92 }));
  hat.add(facetedSlab(0.66, 0.1, 0.66, cLight, { y: 0.12 }));

  const armL = joint(-0.62, 0.75, 0.1);
  const armR = joint( 0.62, 0.75, 0.1);
  spine.add(armL, armR);
  armL.add(facetedCylinder(0.13, 0.13, 0.6, c, { segments: 6, y: -0.3 }));
  armR.add(facetedCylinder(0.13, 0.13, 0.6, c, { segments: 6, y: -0.3 }));

  const accents = new THREE.Group();
  armR.add(accents);
  const staff = facetedCylinder(0.05, 0.05, 1.4, 0x6a4a2a, { segments: 5, x: 0.08, y: -0.55 });
  const lantern = facetedOrb(0.16, 0xffdd66, { emissive: 0xffcc33, emissiveIntensity: 1.6, detail: 0, x: 0.08, y: 0.18 });
  const lanternCap = facetedCone(0.14, 0.2, cDark, { segments: 5, x: 0.08, y: 0.38 });
  accents.add(staff, lantern, lanternCap);

  const legL = joint(-0.24, 0.5, 0);
  const legR = joint( 0.24, 0.5, 0);
  g.add(legL, legR);
  legL.add(facetedCylinder(0.13, 0.13, 0.5, cDark, { segments: 6, y: -0.25 }));
  legR.add(facetedCylinder(0.13, 0.13, 0.5, cDark, { segments: 6, y: -0.25 }));

  const hb = _makeHealthBar(0xcccccc, 2.2);
  g.add(hb.group);
  g.userData.rig = { spine, neck, hat, armL, armR, legL, legR, accents, spineBaseY: 0.6 };
  g.userData.anim = { phase: 0, attack: 0 };
  g.userData.healthBar = hb.bar;
  g.scale.setScalar(0.7);
  return g;
}

// Shared mob animator — cloned from animateWarlock but handles:
//   stormingVortex  — spin rings, no arms/legs
//   fireElemental   — flicker glow + orbit motes
//   humanoid types  — idle bob + walk swing (stoneGiant, giantDwarf, minion)
// state: { type, speed, maxSpeed, dt, time, falling }
export function animateMob(group, state) {
  const rig  = group.userData.rig;
  const anim = group.userData.anim;
  if (!rig || !anim) return;

  const dt       = Math.min(0.05, Math.max(0.0001, state.dt  || 0.016));
  const time     = state.time     || 0;
  const maxSpeed = state.maxSpeed || 5.0;
  const gait     = Math.min(1, (state.speed || 0) / maxSpeed);
  const moving   = gait > 0.06;
  const type     = state.type || "minion";

  anim.phase += dt * (moving ? 5 + gait * 4 : 1.5);
  const ph    = anim.phase;
  const swing = Math.sin(ph) * (moving ? 0.28 + gait * 0.32 : 0);
  const bob   = moving
    ? Math.abs(Math.sin(ph)) * 0.07
    : Math.sin(time * 1.4) * 0.02;
  const baseY = rig.spineBaseY ?? 1.0;

  if (type === "stormingVortex") {
    if (rig.spin)      rig.spin.rotation.y      += dt * 3.8;
    if (rig.outerSpin) rig.outerSpin.rotation.y -= dt * 2.4;
    if (rig.midRing)   rig.midRing.rotation.y   += dt * 5.0;
    if (rig.arcCrystals) {
      rig.arcCrystals.rotation.y -= dt * 1.6;
      rig.arcCrystals.position.y  = Math.sin(time * 3.0) * 0.12;
    }
    if (rig.spine) {
      rig.spine.position.y  = baseY + Math.sin(time * 2.2) * 0.14;
      rig.spine.rotation.y += dt * 0.8;
    }
    return;
  }

  if (type === "fireElemental") {
    anim.flicker  = (anim.flicker ?? 0) + dt * 11;
    if (rig.glow) {
      rig.glow.intensity = 1.7 + Math.sin(anim.flicker) * 0.5
                               + Math.sin(anim.flicker * 1.9) * 0.3;
    }
    if (rig.crown) {
      rig.crown.rotation.y += dt * 1.2;
      rig.crown.scale.y = 1 + Math.sin(anim.flicker * 1.3) * 0.12;
    }
    if (rig.motes) {
      const children = rig.motes.children;
      for (let i = 0; i < children.length; i++) {
        const m  = children[i];
        const ba = m.userData.baseA ?? 0;
        const a  = ba + time * 2.6;
        const r  = 0.85 + Math.sin(time * 2.8 + ba) * 0.2;
        m.position.set(
          Math.cos(a) * r,
          1.0 + Math.sin(time * 2 + ba) * 0.35,
          Math.sin(a) * r
        );
        if (m.material) m.material.opacity = 0.65 + Math.sin(time * 4 + ba) * 0.22;
      }
    }
    if (rig.spine) rig.spine.position.y = baseY + bob;
    if (rig.armL)  rig.armL.rotation.x  = -swing * 0.7;
    if (rig.armR)  rig.armR.rotation.x  =  swing * 0.7;
    return;
  }

  // Generic humanoid: stoneGiant / giantDwarf / minion
  if (rig.legL) rig.legL.rotation.x  =  swing;
  if (rig.legR) rig.legR.rotation.x  = -swing;
  if (rig.armL) rig.armL.rotation.x  = -swing * 0.85;
  if (rig.armR) rig.armR.rotation.x  =  swing * 0.85;
  if (rig.spine) {
    rig.spine.position.y = baseY + bob;
    rig.spine.rotation.x = moving ? 0.06 : 0;
  }
  if (rig.neck) rig.neck.rotation.x = 0;
  if (rig.hat)  rig.hat.rotation.z  = Math.sin(time * 2 + ph * 0.3) * 0.07;
  if (rig.accents) {
    rig.accents.rotation.z = Math.sin(time * 1.6 + ph * 0.2) * 0.04;
    rig.accents.position.y = Math.sin(time * 2.0) * 0.02;
  }
}

// Dispatcher used by the renderer to build the right mesh for a given type.
// All mob builders (buildStoneGiant/buildStormingVortex/etc.) build fully
// per-instance geometry/materials, so buildMobByType attaches a generic
// dispose() (mirroring buildItemDrop's) so the renderer can release GPU
// resources on despawn/prune instead of leaking them on churn.
export function buildMobByType(type, color) {
  let g;
  if (MOB_MODEL_ASSETS[type]) {
    if (!mobModelReady(type)) loadMobModelTemplate(type);
    if (mobModelReady(type)) g = buildMobModelInstance(type, color);
  }
  if (!g) {
    switch (type) {
      case "stoneGiant":     g = buildStoneGiant(color); break;
      case "stormingVortex": g = buildStormingVortex(color); break;
      case "giantDwarf":     g = buildGiantDwarf(color); break;
      case "fireElemental":  g = buildFireElemental(color); break;
      case "minion":         g = buildMinion(color); break;
      default:               g = buildMinion(color); break;
    }
  }
  if (!g.userData.dispose) {
    g.userData.dispose = () => {
      g.traverse((obj) => {
        if (obj.geometry) obj.geometry.dispose();
        if (obj.material) {
          if (Array.isArray(obj.material)) obj.material.forEach((m) => m.dispose());
          else obj.material.dispose();
        }
      });
    };
  }
  return g;
}

// Back-compat aliases (older callers / any external refs).
export function buildLava(size, y) {
  return buildHazard(size, y, getArenaHazard(CFG.DEFAULT_ARENA_WORLD));
}
export function animateLava(mesh, t) {
  return animateHazard(mesh, t);
}
