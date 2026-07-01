// Procedural obstacle prop builders for the map layout.
// Each builder returns a THREE.Group centred at the local origin (0, 0, 0).
// The renderer positions and rotates the group using obs.x / obs.z / obs.rot.
//
// All props are rebuilt procedurally from stylized low-poly faceted Three.js
// geometry (polyhedra / cones / cylinders / shards) with flat shading — no
// external GLB assets, no asset pipeline required. The faceted recipe lives in
// lowpoly.js so props, mobs and projectiles share one consistent aesthetic.
//
// The PROP_BUILDERS registry maps obstacle-type strings (as produced by
// mapgen.generateMap) to their builder function:
//   PROP_BUILDERS["tree"](obs) → THREE.Group
import * as THREE from "three";
import {
  facetedCone, facetedCylinder, facetedRock, facetedShard,
  facetedSlab, facetedCrystal,
} from "./lowpoly.js";

// ---------------------------------------------------------------------------
// Prop builders
// Each function receives the obstacle descriptor: { r, height, ... }.
// All geometry is relative to the local origin at ground level (y = 0).
// ---------------------------------------------------------------------------

/**
 * Dead tree: faceted trunk with three stacked conical canopy tiers.
 * Palette: dark-brown trunk, three shades of green for canopy.
 */
function buildTree(obs) {
  const g = new THREE.Group();
  const h = obs.height, r = obs.r;
  const trunkH = h * 0.55;
  // Faceted hex-prism trunk.
  g.add(facetedCylinder(0.16, 0.20, trunkH, 0x4a2e18, { segments: 6, y: trunkH * 0.5 }));
  // Three faceted conical canopy tiers (low radialSegments → flat facets).
  // Bottom tier sits h*0.02 below the trunk top (not flush) so it always
  // interpenetrates the trunk instead of risking a hairline seam.
  g.add(facetedCone(r * 1.7, h * 0.38, 0x2d5a1b, { segments: 7, y: trunkH + h * 0.17 }));
  g.add(facetedCone(r * 1.2, h * 0.30, 0x3d7a2b, { segments: 7, y: trunkH + h * 0.42 }));
  g.add(facetedCone(r * 0.7, h * 0.22, 0x1e3d12, { segments: 7, y: trunkH + h * 0.60 }));
  return g;
}

/**
 * Stone cluster: a main faceted boulder with two side rocks for natural
 * irregularity. Palette: gray-brown rock tones.
 */
function buildStone(obs) {
  const g = new THREE.Group();
  const h = obs.height, r = obs.r;
  g.add(facetedRock(r * 0.95, 0x8a7a6a, { detail: 1, perturb: 0.14, sx: 1.5, sy: 0.9, sz: 1.3, y: h * 0.35 }));
  g.add(facetedRock(r * 0.55, 0x6a5a52, { detail: 1, perturb: 0.18, sx: 1.3, sy: 0.8, sz: 1.1, x: r * 0.6, y: h * 0.25, z: r * 0.3 }));
  g.add(facetedRock(r * 0.42, 0x9a8a78, { detail: 1, perturb: 0.20, sx: 1.4, sy: 0.7, sz: 1.2, x: -r * 0.5, y: h * 0.175, z: -r * 0.35 }));
  return g;
}

/**
 * Ruined column: faceted base slab, hex-prism shaft with a mid-ring band, and a
 * faceted capital. Palette: marble white / shadowed stone.
 */
function buildColumn(obs) {
  const g = new THREE.Group();
  const h = obs.height, r = obs.r;
  // Each seam below overlaps the one beneath it by h*0.02 (rather than sitting
  // exactly flush) so segment/perturb rounding never opens a visible gap:
  //   shaft bottom  = 0.425h - 0.325h = 0.100h  <  base top  0.06h+0.06h = 0.12h
  //   ring bottom   = 0.77h  - 0.04h  = 0.730h  <  shaft top 0.425h+0.325h = 0.75h
  //   capital bottom= 0.865h - 0.075h = 0.790h  <  ring top  0.77h+0.04h  = 0.81h
  g.add(facetedSlab(r * 1.8, h * 0.12, r * 1.8, 0xa8a090, { widthSegments: 2, depthSegments: 2, y: h * 0.06 }));
  g.add(facetedCylinder(r * 1.1, r * 1.1, h * 0.65, 0xc8c0b0, { segments: 8, y: h * 0.425 }));
  g.add(facetedCylinder(r * 1.05, r * 1.0, h * 0.08, 0xa8a090, { segments: 8, y: h * 0.77 }));
  g.add(facetedSlab(r * 1.5, h * 0.15, r * 1.5, 0xd8d0c0, { widthSegments: 2, depthSegments: 2, y: h * 0.865 }));
  return g;
}

/**
 * Rubble debris: four offset faceted shards for a scattered ruin look.
 * Palette: sand/stone rubble tones.
 */
function buildDebris(obs) {
  const g = new THREE.Group();
  const h = obs.height, r = obs.r;
  g.add(facetedShard(h * 0.55, 0x8a7860, { rx: 0.3, ry: 0.8, rz: 0.2, scale: r * 1.1, x: 0, y: h * 0.275 }));
  g.add(facetedShard(h * 0.38, 0x5a4838, { rx: 0.5, ry: 1.1, rz: 0.3, scale: r * 0.7, x: r * 0.5, y: h * 0.19, z: r * 0.3 }));
  g.add(facetedShard(h * 0.28, 0x9a8870, { rx: 0.2, ry: 0.9, rz: 0.4, scale: r * 0.55, x: -r * 0.4, y: h * 0.14, z: -r * 0.4 }));
  g.add(facetedShard(h * 0.18, 0x7a6848, { rx: 0.6, ry: 1.0, rz: 0.2, scale: r * 0.4, x: r * 0.3, y: h * 0.09, z: -r * 0.5 }));
  return g;
}

/**
 * Broken wall section: a long faceted slab with two crumbled notches at the
 * top. Oriented along x by default; obs.rot is applied externally by the
 * renderer. Palette: stone masonry with a darker mortar shadow.
 */
function buildWall(obs) {
  const g = new THREE.Group();
  const h = obs.height, r = obs.r;
  // Main slab with width/height segments so the face reads as faceted masonry.
  g.add(facetedSlab(r * 3.5, h, 0.5, 0x9a8878, { widthSegments: 6, heightSegments: 3, y: h * 0.5 }));
  // Crumbled notches above the parapet, nudged h*0.02 below flush so they bite
  // into the parapet top rather than resting exactly on it.
  g.add(facetedSlab(r * 0.6, h * 0.30, 0.6, 0x7a6858, { y: h + h * 0.13, x: -r * 1.0 }));
  g.add(facetedSlab(r * 0.5, h * 0.38, 0.6, 0x6a5848, { y: h + h * 0.17, x: r * 0.8 }));
  return g;
}

/**
 * Boulder: a chunky angular faceted rock with a rounded cap and a protruding
 * shard. Palette: dark granite / shadow tones.
 */
function buildBoulder(obs) {
  const g = new THREE.Group();
  const h = obs.height, r = obs.r;
  g.add(facetedRock(r * 0.9, 0x7a6a60, { detail: 1, perturb: 0.16, sx: 1.8, sy: 1.0, sz: 1.6, y: h * 0.5 }));
  g.add(facetedRock(r * 0.65, 0x8a7a6e, { detail: 1, perturb: 0.14, sx: 1.3, sy: 0.5, sz: 1.4, y: h * 0.85 }));
  g.add(facetedShard(h * 0.4, 0x5a4a44, { rx: 0.3, ry: 0.4, rz: 1.2, x: r * 0.5, y: h * 0.2, z: r * 0.4 }));
  return g;
}

/**
 * Fallen dead giant: a massive humanoid corpse lying face-down along +x.
 * Components: torso, head, two arms, two legs — faceted slabs/rocks.
 * Palette: rotted flesh / shadow.
 */
function buildDeadGiant(obs) {
  const g = new THREE.Group();
  const h = obs.height, r = obs.r;
  // Torso (elongated along x)
  g.add(facetedSlab(r * 3.5, h * 0.80, r * 1.2, 0x8a7062, { widthSegments: 4, heightSegments: 2, depthSegments: 2, y: h * 0.40 }));
  // Head
  g.add(facetedRock(r * 0.6, 0xc8a88a, { detail: 1, perturb: 0.12, sx: 1.2, sy: 0.9, sz: 1.0, x: r * 2.0, y: h * 0.45 }));
  // Arms — z offset keeps the inner edge (z ± 0.55r half-depth) tucked inside
  // the torso's z ± 0.6r half-depth instead of past it, so shoulders overlap.
  g.add(facetedSlab(r * 2.0, h * 0.38, r * 0.55, 0x8a7062, { x: r * 0.5, y: h * 0.19, z: r * 0.8 }));
  g.add(facetedSlab(r * 2.0, h * 0.38, r * 0.55, 0x8a7062, { x: -r * 0.4, y: h * 0.19, z: -r * 0.8 }));
  // Legs
  g.add(facetedSlab(r * 0.7, h * 0.38, r * 2.5, 0x6a5040, { x: -r * 1.5, y: h * 0.19, z: r * 0.4 }));
  g.add(facetedSlab(r * 0.7, h * 0.38, r * 2.5, 0x6a5040, { x: -r * 1.5, y: h * 0.19, z: -r * 0.4 }));
  return g;
}

/**
 * Dragon skeleton: a faceted spine, four rib pairs (shards), and a horned
 * skull. Palette: old ivory / bone white.
 */
function buildDragonBones(obs) {
  const g = new THREE.Group();
  const h = obs.height, r = obs.r;
  // Spine running along +x
  g.add(facetedCylinder(r * 0.35, r * 0.35, r * 4.0, 0xd4c8a8, { segments: 6, rz: Math.PI / 2, y: h * 0.15 }));
  // Four pairs of ribs (symmetrical about z = 0)
  const ribH = h * 0.65;
  const ribOffsX = [-r * 1.1, -r * 0.35, r * 0.45, r * 1.2];
  for (const ox of ribOffsX) {
    g.add(facetedShard(ribH, 0xb0a488, { rx: 0.2, ry: 0.5, rz: 1.0, x: ox, y: ribH * 0.5, z: r * 0.65 }));
    g.add(facetedShard(ribH, 0xb0a488, { rx: 0.2, ry: 0.5, rz: 1.0, x: ox, y: ribH * 0.5, z: -r * 0.65 }));
  }
  // Skull + jaw
  g.add(facetedRock(r * 0.7, 0xe4d8b8, { detail: 1, perturb: 0.10, sx: 1.4, sy: 0.7, sz: 1.0, x: r * 2.2, y: h * 0.35 }));
  g.add(facetedSlab(r * 0.8, h * 0.18, r * 1.2, 0xd4c8a8, { x: r * 2.2, y: h * 0.09 }));
  return g;
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

/**
 * Maps every obstacle type string (from mapgen) to its builder function.
 * Renderer calls: `PROP_BUILDERS[ob.type](ob)` then positions/rotates the group.
 */
export const PROP_BUILDERS = {
  tree:        buildTree,
  stone:       buildStone,
  column:      buildColumn,
  debris:      buildDebris,
  wall:        buildWall,
  boulder:     buildBoulder,
  deadGiant:   buildDeadGiant,
  dragonBones: buildDragonBones,
};
