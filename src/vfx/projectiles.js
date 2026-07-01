// Per-spell duotone VFX for the 8 PROJECTILE spells — the 3D expression of
// each spell's bespoke SVG icon (src/spell-icons.js) for fireball, lightning,
// boomerang, homing, fireSpray, bouncer, splitter, meteor. Every buildCore()
// silhouette deliberately echoes its icon (spike cluster, bent cross-blades,
// radiating wedges, ...) using the shared duotone recipe from ./duotone.js:
// a full-opacity flat-shaded emissive PRIMARY + a ~0.45-opacity translucent
// SECONDARY accent shell, with thin faceted streaks for motion/impact.
//
// This is a leaf-ish VFX module: it imports `three`, lowpoly.js's faceted
// builders, and ./duotone.js — nothing from voxel.js/renderer.js — and
// exports PROJECTILE_VFX, a registry slice matching the VFX_REGISTRY entry
// shape (see duotone.js) so it can be merged into VFX_REGISTRY by the caller.
import * as THREE from "three";
import { CFG } from "../config.js";
import { facetedOrb, facetedRock, facetedShard, facetedPuff } from "../lowpoly.js";
import { secondaryColor, brighten, facetedDuo, TrailPool } from "./duotone.js";

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

// A small cluster of faceted shard meshes flung outward from a center point
// and faded over `life` — the shared building block for every icon-echoing
// impact/cast burst below. `count` is always well under CFG.BURST_MAX_PARTICLES
// (this is a bespoke, low-count accent burst, not the generic voxel.js
// buildBurst); geometry/material are per-instance and disposed with the
// effect, matching buildBurst/buildMeteor's disposal convention.
function _shardBurst(x, y, z, color, opts = {}) {
  const count = Math.min(opts.count ?? 6, CFG.BURST_MAX_PARTICLES);
  const speed = opts.speed ?? 5;
  const life = opts.life ?? 0.4;
  const size = opts.size ?? 0.2;
  const lift = opts.lift ?? 0.6;
  const arc = opts.arc ?? Math.PI * 2;
  const arcStart = opts.arcStart ?? 0;
  const tint = opts.secondary ? secondaryColor(color) : color;
  const geo = new THREE.OctahedronGeometry(0.5, 0);
  const g = new THREE.Group();
  const parts = [];
  for (let i = 0; i < count; i++) {
    const mat = new THREE.MeshLambertMaterial({
      color: tint, emissive: color, emissiveIntensity: 0.9, flatShading: true, transparent: true,
    });
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = false;
    m.scale.set(size * 0.5, size, size * 0.5);
    m.position.set(x, y, z);
    const a = arcStart + arc * (count === 1 ? 0 : i / count) + (Math.random() - 0.5) * 0.3;
    const sp = speed * (0.7 + Math.random() * 0.5);
    const v = new THREE.Vector3(Math.cos(a) * sp, lift * sp, Math.sin(a) * sp);
    parts.push({ mesh: m, v });
    g.add(m);
  }
  g.userData.t = 0;
  g.userData.life = life;
  g.userData.done = false;
  g.userData.update = (dt) => {
    g.userData.t += dt;
    const k = g.userData.t / life;
    for (const p of parts) {
      p.mesh.position.addScaledVector(p.v, dt);
      p.v.y -= 10 * dt;
      p.v.multiplyScalar(1 - 1.2 * dt);
      p.mesh.material.opacity = Math.max(0, 1 - k);
      p.mesh.scale.setScalar(Math.max(0.05, size * (1 - k * 0.7)));
    }
    if (k >= 1) g.userData.done = true;
  };
  // Per-instance resources: shared shardGeo across this burst's particles
  // only (not a global cache) and each particle's own material — matches
  // src/voxel.js buildBurst's disposal contract.
  g.userData.dispose = () => {
    geo.dispose();
    for (const p of parts) p.mesh.material.dispose();
  };
  return g;
}

// Attach a pooled TrailPool emitter to a bolt-like core group and drive it
// from the core's own update() so callers of buildCore() get a self-ticking
// trail for free once the core group is parented into the scene and moved
// each frame. Mutates and returns `group`.
function _withTrail(group, color, opts = {}) {
  const emitter = TrailPool.createEmitter(group, color, opts);
  const prevUpdate = group.userData.update;
  group.userData.update = (dt) => {
    if (prevUpdate) prevUpdate(dt);
    emitter.update(dt);
  };
  const prevDispose = group.userData.dispose;
  group.userData.dispose = () => {
    emitter.dispose();
    if (prevDispose) prevDispose();
  };
  // Flush-only hook: releases this emitter's currently-alive shards back to
  // the shared TrailPool WITHOUT running the core's material/geometry
  // dispose() chain above. src/pool.js's releaseBolt() (and
  // src/renderer.js's reset()) call this on every despawn/recycle of a
  // pooled bolt Group — the group itself is reused via acquireBolt(), so it
  // must never be disposed, but its in-flight trail shards are NOT children
  // of the group (they live under the bolt's former scene parent so they
  // can trail behind as it moves) and stop being ticked the moment the bolt
  // leaves this.boltMeshes. Without this flush they freeze in the scene and
  // permanently hold their slot in the capped, shared shard pool.
  const prevFlush = group.userData.flushTrail;
  group.userData.flushTrail = () => {
    emitter.dispose();
    if (prevFlush) prevFlush();
  };
  return group;
}

// ---------------------------------------------------------------------------
// fireball — spiked star / spike-cluster core (icon: 8-point burst star +
// two curved flame wisps).
// ---------------------------------------------------------------------------

function _fireballCore(color) {
  const core = facetedDuo((c, o) => facetedOrb(0.24, c, o), color, { emissiveIntensity: 1.1 });
  const spikeColor = brighten(color, 0.12);
  const spikeMat = new THREE.MeshLambertMaterial({
    color: spikeColor, emissive: spikeColor, emissiveIntensity: 1.0, flatShading: true,
  });
  const spikeCount = 6;
  const spikes = [];
  for (let i = 0; i < spikeCount; i++) {
    const a = (i / spikeCount) * Math.PI * 2;
    const dir = new THREE.Vector3(Math.cos(a), i % 2 === 0 ? 0.35 : -0.35, Math.sin(a)).normalize();
    const spike = facetedShard(0.6, spikeColor, { cast: false });
    spike.material = spikeMat;
    spike.position.copy(dir).multiplyScalar(0.16);
    spike.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    spikes.push(spike);
    core.add(spike);
  }
  const prevDispose = core.userData.dispose;
  core.userData.dispose = () => { spikeMat.dispose(); prevDispose(); };
  core.userData.recolor = (newColor) => {
    const tint = brighten(newColor, 0.12);
    spikeMat.color.setHex(tint);
    spikeMat.emissive.setHex(tint);
    core.userData.primary.material.color.setHex(newColor);
    core.userData.primary.material.emissive.setHex(newColor);
    core.userData.secondary.material.color.setHex(secondaryColor(newColor));
  };
  return _withTrail(core, color);
}

function _fireballImpact(ctx) {
  const burst = _shardBurst(ctx.x, ctx.y ?? 1, ctx.z, ctx.color, { count: 8, speed: 6, life: 0.45, size: 0.22 });
  ctx.addEffect(ctx.ringPulse(ctx.x, ctx.z, 1.6, ctx.color));
  return burst;
}

// ---------------------------------------------------------------------------
// lightning — traveling bolt visual: a jagged zigzag faceted core (icon: bolt
// polygon + two small forked arc sparks near its base).
// ---------------------------------------------------------------------------

// A flattened zigzag prism echoing the SVG bolt polygon
// (12,2 -> 6,13 -> 10.5,13 -> 8,22 -> 18,9 -> 12.5,9), rebuilt in local space
// and extruded to a thin faceted prism.
function _lightningBoltGeo() {
  const shape = new THREE.Shape();
  shape.moveTo(0, 1.0);
  shape.lineTo(-0.42, -0.05);
  shape.lineTo(-0.10, -0.05);
  shape.lineTo(-0.30, -1.0);
  shape.lineTo(0.55, -0.28);
  shape.lineTo(0.14, -0.28);
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.14, bevelEnabled: false, curveSegments: 1 });
  geo.center();
  return geo;
}

function _lightningCore(color) {
  // Builder-mode facetedDuo: the extrude geometry is freshly built per call
  // (not a shared cache like voxel.js's bolt geo cache), so it must be
  // builder-owned so facetedDuo's dispose() actually frees it.
  const core = facetedDuo((c, o) => {
    const geo = _lightningBoltGeo();
    const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({
      color: c, emissive: c, emissiveIntensity: o.emissiveIntensity ?? 1, flatShading: true,
    }));
    mesh.rotation.x = Math.PI / 7;
    mesh.castShadow = false;
    return mesh;
  }, color, { emissiveIntensity: 1.3, secondaryScale: 1.4 });
  return _withTrail(core, color, { every: 0.02, life: 0.16, size: 0.14 });
}

function _lightningCast(ctx) {
  return _shardBurst(ctx.x, ctx.y ?? 1.4, ctx.z, ctx.color, { count: 5, speed: 4, life: 0.25, size: 0.12, secondary: true });
}

function _lightningImpact(ctx) {
  const burst = _shardBurst(ctx.x, ctx.y ?? 1, ctx.z, ctx.color, { count: 6, speed: 7, life: 0.3, size: 0.16, secondary: true });
  ctx.addEffect(ctx.ringPulse(ctx.x, ctx.z, 1.2, ctx.color));
  return burst;
}

// ---------------------------------------------------------------------------
// boomerang — bent arc / cross-blades (icon: chevron blade + curved return arc).
// ---------------------------------------------------------------------------

function _boomerangCore(color) {
  const core = facetedDuo((c, o) => facetedOrb(0.22, c, o), color, { emissiveIntensity: 1.1 });
  const bladeColor = brighten(color, 0.08);
  const bladeMat = new THREE.MeshLambertMaterial({
    color: bladeColor, emissive: bladeColor, emissiveIntensity: 1.1, flatShading: true,
  });
  const bladeGeo = new THREE.OctahedronGeometry(0.5, 0);
  const blade1 = new THREE.Mesh(bladeGeo, bladeMat);
  blade1.scale.set(0.22, 1.15, 0.22);
  blade1.rotation.z = Math.PI / 2 + Math.PI / 5; // bent cross, not a straight +
  const blade2 = new THREE.Mesh(bladeGeo, bladeMat);
  blade2.scale.set(0.22, 1.15, 0.22);
  blade2.rotation.x = Math.PI / 2 - Math.PI / 5;
  core.add(blade1, blade2);
  const prevDispose = core.userData.dispose;
  core.userData.dispose = () => { bladeGeo.dispose(); bladeMat.dispose(); prevDispose(); };
  core.userData.recolor = (newColor) => {
    const tint = brighten(newColor, 0.08);
    bladeMat.color.setHex(tint);
    bladeMat.emissive.setHex(tint);
    core.userData.primary.material.color.setHex(newColor);
    core.userData.primary.material.emissive.setHex(newColor);
    core.userData.secondary.material.color.setHex(secondaryColor(newColor));
  };
  return _withTrail(core, color);
}

function _boomerangImpact(ctx) {
  const burst = _shardBurst(ctx.x, ctx.y ?? 1, ctx.z, ctx.color, { count: 7, speed: 6, life: 0.4, size: 0.2, arc: Math.PI * 1.4 });
  ctx.addEffect(ctx.ringPulse(ctx.x, ctx.z, 1.4, ctx.color));
  return burst;
}

// ---------------------------------------------------------------------------
// homing — dodecahedron with a tracking reticle accent (icon: dashed path
// arrow + orbiting targeting ring).
// ---------------------------------------------------------------------------

function _homingCore(color) {
  const core = facetedDuo((c, o) => {
    const geo = new THREE.DodecahedronGeometry(0.26, 0);
    return new THREE.Mesh(geo, new THREE.MeshLambertMaterial({
      color: c, emissive: c, emissiveIntensity: o.emissiveIntensity ?? 1, flatShading: true,
    }));
  }, color, { emissiveIntensity: 1.15, secondaryScale: 1.3 });
  // Tracking-reticle ring accent, thin and unlit — echoes the icon's small
  // orbiting circle/crosshair.
  const ringGeo = new THREE.TorusGeometry(0.42, 0.03, 4, 10);
  const ringMat = new THREE.MeshBasicMaterial({ color: secondaryColor(color), transparent: true, opacity: 0.55 });
  const ring = new THREE.Mesh(ringGeo, ringMat);
  ring.rotation.x = Math.PI / 2.4;
  core.add(ring);
  const prevDispose = core.userData.dispose;
  core.userData.dispose = () => { ringGeo.dispose(); ringMat.dispose(); prevDispose(); };
  core.userData.recolor = (newColor) => {
    ringMat.color.setHex(secondaryColor(newColor));
    core.userData.primary.material.color.setHex(newColor);
    core.userData.primary.material.emissive.setHex(newColor);
    core.userData.secondary.material.color.setHex(secondaryColor(newColor));
  };
  const withTrail = _withTrail(core, color, { every: 0.04, life: 0.24, size: 0.14 });
  const prevUpdate = withTrail.userData.update;
  withTrail.userData.update = (dt) => {
    ring.rotation.z += dt * 6;
    prevUpdate(dt);
  };
  return withTrail;
}

function _homingImpact(ctx) {
  const burst = _shardBurst(ctx.x, ctx.y ?? 1, ctx.z, ctx.color, { count: 6, speed: 5, life: 0.5, size: 0.18, secondary: true });
  ctx.addEffect(ctx.ringPulse(ctx.x, ctx.z, 1.5, ctx.color));
  return burst;
}

// ---------------------------------------------------------------------------
// fireSpray — clustered spikes (icon: three overlapping flame-tongue wedges
// fanned around a shared base).
// ---------------------------------------------------------------------------

function _firesprayCore(color) {
  const core = facetedDuo((c, o) => facetedOrb(0.16, c, o), color, { emissiveIntensity: 1.05 });
  const tongueColor = brighten(color, 0.1);
  const tongueMat = new THREE.MeshLambertMaterial({
    color: tongueColor, emissive: tongueColor, emissiveIntensity: 1.0, flatShading: true,
  });
  for (const rot of [-0.55, 0, 0.55]) {
    const tongue = facetedShard(0.5, tongueColor, { rz: rot, y: 0.1, cast: false });
    tongue.material = tongueMat;
    core.add(tongue);
  }
  const prevDispose = core.userData.dispose;
  core.userData.dispose = () => { tongueMat.dispose(); prevDispose(); };
  core.userData.recolor = (newColor) => {
    const tint = brighten(newColor, 0.1);
    tongueMat.color.setHex(tint);
    tongueMat.emissive.setHex(tint);
    core.userData.primary.material.color.setHex(newColor);
    core.userData.primary.material.emissive.setHex(newColor);
    core.userData.secondary.material.color.setHex(secondaryColor(newColor));
  };
  return _withTrail(core, color, { every: 0.05, life: 0.18, size: 0.12 });
}

function _firesprayCast(ctx) {
  return _shardBurst(ctx.x, ctx.y ?? 1.2, ctx.z, ctx.color, { count: 5, speed: 5, life: 0.3, size: 0.16, arc: Math.PI * 0.9 });
}

function _firesprayImpact(ctx) {
  return _shardBurst(ctx.x, ctx.y ?? 1, ctx.z, ctx.color, { count: 5, speed: 5, life: 0.35, size: 0.16 });
}

// ---------------------------------------------------------------------------
// bouncer — round faceted core with a jagged zigzag streak accent (icon:
// polyline ricochet path + corner brackets).
// ---------------------------------------------------------------------------

function _bouncerCore(color) {
  const core = facetedDuo((c, o) => facetedOrb(0.3, c, o), color, { emissiveIntensity: 1.1, secondaryScale: 1.4 });
  // Thin zigzag streak (ricochet-path accent) riding the surface, unlit.
  const pts = [
    new THREE.Vector3(-0.4, -0.32, 0),
    new THREE.Vector3(-0.08, 0.34, 0),
    new THREE.Vector3(0.24, -0.32, 0),
    new THREE.Vector3(0.5, 0.14, 0),
  ];
  const lineGeo = new THREE.BufferGeometry().setFromPoints(pts);
  const lineMat = new THREE.LineBasicMaterial({ color: brighten(color, 0.2), transparent: true, opacity: 0.7 });
  const line = new THREE.Line(lineGeo, lineMat);
  core.add(line);
  const prevDispose = core.userData.dispose;
  core.userData.dispose = () => { lineGeo.dispose(); lineMat.dispose(); prevDispose(); };
  core.userData.recolor = (newColor) => {
    lineMat.color.setHex(brighten(newColor, 0.2));
    core.userData.primary.material.color.setHex(newColor);
    core.userData.primary.material.emissive.setHex(newColor);
    core.userData.secondary.material.color.setHex(secondaryColor(newColor));
  };
  return _withTrail(core, color);
}

function _bouncerImpact(ctx) {
  const burst = _shardBurst(ctx.x, ctx.y ?? 1, ctx.z, ctx.color, { count: 6, speed: 8, life: 0.35, size: 0.18, secondary: true });
  ctx.addEffect(ctx.ringPulse(ctx.x, ctx.z, 1.3, ctx.color));
  return burst;
}

// ---------------------------------------------------------------------------
// splitter — radiating tetra wedges around a small core (icon: 5 wedges fanned
// evenly around a small center dot — matches directly).
// ---------------------------------------------------------------------------

const SPLITTER_SHARDS = 5;

function _splitterCore(color) {
  const core = facetedDuo((c, o) => facetedOrb(0.14, c, o), color, { emissiveIntensity: 1.1 });
  const wedgeColor = brighten(color, 0.1);
  const wedgeGeo = new THREE.TetrahedronGeometry(0.24, 0);
  const wedgeMat = new THREE.MeshLambertMaterial({
    color: wedgeColor, emissive: wedgeColor, emissiveIntensity: 1.0, flatShading: true,
  });
  for (let i = 0; i < SPLITTER_SHARDS; i++) {
    const a = (i / SPLITTER_SHARDS) * Math.PI * 2;
    const w = new THREE.Mesh(wedgeGeo, wedgeMat);
    w.position.set(Math.cos(a) * 0.3, Math.sin(a) * 0.3 * 0.6, Math.sin(a) * 0.3);
    w.rotation.set(0, -a, Math.PI / 2);
    core.add(w);
  }
  const prevDispose = core.userData.dispose;
  core.userData.dispose = () => { wedgeGeo.dispose(); wedgeMat.dispose(); prevDispose(); };
  core.userData.recolor = (newColor) => {
    const tint = brighten(newColor, 0.1);
    wedgeMat.color.setHex(tint);
    wedgeMat.emissive.setHex(tint);
    core.userData.primary.material.color.setHex(newColor);
    core.userData.primary.material.emissive.setHex(newColor);
    core.userData.secondary.material.color.setHex(secondaryColor(newColor));
  };
  return _withTrail(core, color);
}

// Splits into five piercing shards on impact — the impact burst deliberately
// mirrors that gameplay fact by flinging exactly SPLITTER_SHARDS wedges
// outward on an even radial fan.
function _splitterImpact(ctx) {
  const burst = _shardBurst(ctx.x, ctx.y ?? 1, ctx.z, ctx.color, {
    count: SPLITTER_SHARDS, speed: 9, life: 0.5, size: 0.2, arc: Math.PI * 2,
  });
  ctx.addEffect(ctx.ringPulse(ctx.x, ctx.z, 1.8, ctx.color));
  return burst;
}

// ---------------------------------------------------------------------------
// meteor — falling rock (icon: faceted gem-like rock with a comet trail and
// a small ground-impact star).
// ---------------------------------------------------------------------------

function _meteorCore(color) {
  const rockColor = 0x552211;
  const core = facetedDuo((c, o) => facetedRock(0.5, rockColor, {
    detail: 1, perturb: 0.16, sx: 1.4, sy: 1.4, sz: 1.4,
    emissive: c, emissiveIntensity: o.emissiveIntensity ?? 0.7,
  }), color, { emissiveIntensity: 0.7, secondaryScale: 1.5, secondaryOpacity: 0.4 });
  // Trailing ember puff — thin faceted cloud accent riding behind the rock,
  // echoing the icon's comet-tail streak.
  const ember = facetedPuff(0.3, brighten(color, 0.15), { opacity: 0.35, y: -0.2, z: -0.35 });
  core.add(ember);
  const prevDispose = core.userData.dispose;
  core.userData.dispose = () => {
    ember.geometry.dispose(); ember.material.dispose(); prevDispose();
  };
  core.userData.recolor = (newColor) => {
    ember.material.color.setHex(brighten(newColor, 0.15));
    core.userData.primary.material.emissive.setHex(newColor);
    core.userData.secondary.material.color.setHex(secondaryColor(newColor));
  };
  return core; // falls vertically — no horizontal TrailPool streak trail
}

function _meteorCast(ctx) {
  // Small upward ember flare at the caller's feet (windup telegraph accent).
  return _shardBurst(ctx.x, ctx.y ?? 0.4, ctx.z, ctx.color, { count: 4, speed: 3, life: 0.35, size: 0.14, lift: 1.4 });
}

function _meteorImpact(ctx) {
  const burst = _shardBurst(ctx.x, ctx.y ?? 0.5, ctx.z, ctx.color, { count: 9, speed: 9, life: 0.7, size: 0.28, lift: 0.8 });
  ctx.addEffect(ctx.ringPulse(ctx.x, ctx.z, 2.6, ctx.color));
  return burst;
}

// ---------------------------------------------------------------------------
// Registry slice
// ---------------------------------------------------------------------------

export const PROJECTILE_VFX = {
  fireball: {
    color: 0xff5a1e, proj: "fireball", trail: true,
    buildCore: _fireballCore, cast: () => null, impact: _fireballImpact,
  },
  lightning: {
    color: 0x9fe6ff, proj: null, trail: true,
    buildCore: _lightningCore, cast: _lightningCast, impact: _lightningImpact,
  },
  boomerang: {
    color: 0xffe14c, proj: "boomerang", trail: true,
    buildCore: _boomerangCore, cast: () => null, impact: _boomerangImpact,
  },
  homing: {
    color: 0xc04cff, proj: "homing", trail: true,
    buildCore: _homingCore, cast: () => null, impact: _homingImpact,
  },
  fireSpray: {
    color: 0xff7a2e, proj: "fireball", trail: true,
    buildCore: _firesprayCore, cast: _firesprayCast, impact: _firesprayImpact,
  },
  bouncer: {
    color: 0x4cff9c, proj: "bouncer", trail: true,
    buildCore: _bouncerCore, cast: () => null, impact: _bouncerImpact,
  },
  splitter: {
    color: 0xff4ca8, proj: "splitter", trail: true,
    buildCore: _splitterCore, cast: () => null, impact: _splitterImpact,
  },
  meteor: {
    color: 0xff3a1e, proj: null, trail: false,
    buildCore: _meteorCore, cast: _meteorCast, impact: _meteorImpact,
  },
};
