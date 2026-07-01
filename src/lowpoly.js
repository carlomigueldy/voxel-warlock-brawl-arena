// Stylized low-poly faceted geometry helpers.
//
// Every builder returns a THREE.Mesh (or Group) using flat-shaded faceted
// polyhedra — Icosahedron / Dodecahedron / Octahedron / Cone / Cylinder with
// modest segment counts — so shapes read as deliberately faceted rather than
// as plain 6-face boxes, while staying well inside real-time budgets.
//
// Lit surfaces use MeshLambertMaterial({ flatShading: true }) (matches the
// existing voxel.js recipe); unlit halos/clouds use MeshBasicMaterial. All
// meshes set castShadow / receiveShadow unless overridden.
//
// This is a leaf module: it imports only `three` so it can be reused by
// voxel.js, props.js and renderer.js without pulling game config.
import * as THREE from "three";

// ---------------------------------------------------------------------------
// Internal material / mesh factories
// ---------------------------------------------------------------------------

function _lit(color, opts = {}) {
  return new THREE.MeshLambertMaterial({
    color,
    flatShading: true,
    emissive: opts.emissive ?? 0x000000,
    emissiveIntensity: opts.emissiveIntensity ?? 1,
    transparent: opts.transparent ?? false,
    opacity: opts.opacity ?? 1,
  });
}

function _unlit(color, opts = {}) {
  return new THREE.MeshBasicMaterial({
    color,
    transparent: opts.transparent ?? false,
    opacity: opts.opacity ?? 1,
    wireframe: opts.wireframe ?? false,
  });
}

function _place(geo, mat, opts = {}) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(opts.x ?? 0, opts.y ?? 0, opts.z ?? 0);
  m.rotation.set(opts.rx ?? 0, opts.ry ?? 0, opts.rz ?? 0);
  m.castShadow = opts.cast ?? true;
  m.receiveShadow = opts.receive ?? true;
  if (opts.scale) m.scale.setScalar(opts.scale);
  return m;
}

// Apply small per-vertex perturbation to a geometry for organic irregularity
// (rocks / boulders / debris). Visual-only — render meshes are built once per
// entity, so the non-determinism just adds natural variety between instances.
function _perturb(geo, amount = 0.12) {
  const pos = geo.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    // Only displace surface verts away from the origin so radius stays > 0.
    const len = v.length() || 1;
    const n = v.clone().divideScalar(len);
    const d = 1 + (Math.random() - 0.5) * 2 * amount;
    v.addScaledVector(n, (d - 1) * len);
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  return geo;
}

// Non-uniform scale on a mesh for cheap ellipsoidal irregularity (no vertex
// rewrite, so it stays cheap for instancing-friendly single meshes).
function _stretch(m, sx, sy, sz) {
  m.scale.set(sx, sy, sz);
  return m;
}

// ---------------------------------------------------------------------------
// Lit faceted primitive builders
// ---------------------------------------------------------------------------

// Faceted rock / boulder: icosahedron (20→80 faces at detail 1) with optional
// perturbation + non-uniform stretch for an irregular, organic silhouette.
//   radius  – base radius
//   color   – lit lambert color
//   opts    – { detail=0, perturb=0, sx, sy, sz, emissive, emissiveIntensity,
//               x, y, z, rx, ry, rz, cast, receive }
export function facetedRock(radius, color, opts = {}) {
  const detail = opts.detail ?? 0;
  const geo = new THREE.IcosahedronGeometry(radius, detail);
  if (opts.perturb) _perturb(geo, opts.perturb);
  const m = _place(geo, _lit(color, opts), opts);
  if (opts.sx || opts.sy || opts.sz) {
    _stretch(m, opts.sx ?? 1, opts.sy ?? 1, opts.sz ?? 1);
  }
  return m;
}

// Faceted crystal: octahedron (8 faces) — reads as a sharpened double-pyramid.
// Tall by default; stretch to tune. Used for rune cores / item crystals.
export function facetedCrystal(radius, color, opts = {}) {
  const geo = new THREE.OctahedronGeometry(radius, opts.detail ?? 0);
  const m = _place(geo, _lit(color, opts), opts);
  _stretch(m, opts.sx ?? 0.6, opts.sy ?? 1.6, opts.sz ?? 0.6);
  if (opts.spin) m.rotation.y = Math.PI / 4;
  return m;
}

// Faceted orb: icosahedron at detail 1 (80 faces) — a faceted sphere that still
// reads as round. Emissive by default so it glows as a projectile core / item.
export function facetedOrb(radius, color, opts = {}) {
  const geo = new THREE.IcosahedronGeometry(radius, opts.detail ?? 1);
  return _place(geo, _lit(color, { emissive: color, emissiveIntensity: 0.9, ...opts }), opts);
}

// Faceted cone: low radialSegments (default 6) so each side is a flat facet.
// Tree canopies, wizard hats, stalagmites, meteor tail.
export function facetedCone(radius, height, color, opts = {}) {
  const seg = opts.segments ?? 6;
  const geo = new THREE.ConeGeometry(radius, height, seg, 1, opts.openEnded ?? false);
  return _place(geo, _lit(color, opts), opts);
}

// Faceted cylinder: low radialSegments (default 6) for a hex/prismatic facet
// look. Trunks, columns, limbs, shafts.
export function facetedCylinder(rTop, rBottom, height, color, opts = {}) {
  const seg = opts.segments ?? 6;
  const geo = new THREE.CylinderGeometry(rTop, rBottom, height, seg, opts.heightSegments ?? 1, opts.openEnded ?? false);
  return _place(geo, _lit(color, opts), opts);
}

// Faceted shard: a small elongated octahedron — burst particles, debris, vortex
// blades. Cheap (8 faces) and reads sharp.
export function facetedShard(length, color, opts = {}) {
  const geo = new THREE.OctahedronGeometry(0.5, 0);
  const m = _place(geo, _lit(color, opts), opts);
  _stretch(m, opts.sx ?? 0.25, opts.sy ?? length, opts.sz ?? 0.25);
  return m;
}

// Faceted slab: a box with optional per-axis segments so each face breaks into
// flat facets (segments > 1). For walls / plateau tops / rigid masonry.
export function facetedSlab(w, h, d, color, opts = {}) {
  const ws = opts.widthSegments ?? 1;
  const hs = opts.heightSegments ?? 1;
  const ds = opts.depthSegments ?? 1;
  const geo = new THREE.BoxGeometry(w, h, d, ws, hs, ds);
  return _place(geo, _lit(color, opts), opts);
}

// Faceted torus knot / ring accents (rarely used; for charged item halos).
export function facetedTorus(radius, tube, color, opts = {}) {
  const geo = new THREE.TorusGeometry(radius, tube, opts.radialSegments ?? 6, opts.tubularSegments ?? 12);
  return _place(geo, _lit(color, opts), opts);
}

// ---------------------------------------------------------------------------
// Unlit (translucent) builders — halos, auras, clouds
// ---------------------------------------------------------------------------

// Faceted aura shell: icosahedron, unlit, translucent. Wraps glowing cores so
// they read as a soft faceted halo (projectiles, runes, shields).
export function facetedAura(radius, color, opts = {}) {
  const geo = new THREE.IcosahedronGeometry(radius, opts.detail ?? 0);
  return _place(
    geo,
    _unlit(color, { transparent: true, opacity: opts.opacity ?? 0.25, wireframe: opts.wireframe ?? false }),
    opts,
  );
}

// Faceted cloud puff: icosahedron, unlit, translucent, non-shadowing. For
// storm clouds / smoke where lighting would muddy the silhouette.
export function facetedPuff(radius, color, opts = {}) {
  const geo = new THREE.IcosahedronGeometry(radius, opts.detail ?? 0);
  const m = _place(geo, _unlit(color, { transparent: true, opacity: opts.opacity ?? 0.8 }), opts);
  m.castShadow = false;
  m.receiveShadow = false;
  if (opts.sx || opts.sy || opts.sz) _stretch(m, opts.sx ?? 1, opts.sy ?? 1, opts.sz ?? 1);
  return m;
}

// Foreground mob health bar: dark background bar + colored fill bar. Renderer
// sets `bar.scale.x = hp/max` every frame. Shared by voxel.js's procedural mob
// builders and mobModel.js's GLB-backed mob instances.
export function makeMobHealthBar(color, yPos = 3.5) {
  const g = new THREE.Group();
  g.position.y = yPos;
  const bg = new THREE.Mesh(
    new THREE.BoxGeometry(2.0, 0.18, 0.1),
    new THREE.MeshBasicMaterial({ color: 0x111111 })
  );
  const bar = new THREE.Mesh(
    new THREE.BoxGeometry(2.0, 0.18, 0.14),
    new THREE.MeshBasicMaterial({ color })
  );
  g.add(bg, bar);
  return { group: g, bar };
}
