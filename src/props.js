// Procedural obstacle prop builders for the map layout.
// Each builder returns a THREE.Group centred at the local origin (0, 0, 0).
// The renderer positions and rotates the group using obs.x / obs.z / obs.rot.
//
// All props use BoxGeometry + MeshLambertMaterial with flatShading: true to
// match the voxel aesthetic of voxel.js.  All geometry is procedural — no
// external GLB assets, no asset pipeline required.
//
// The PROP_BUILDERS registry maps obstacle-type strings (as produced by
// mapgen.generateMap) to their builder function:
//   PROP_BUILDERS["tree"](obs) → THREE.Group
import * as THREE from "three";
import { CFG } from "./config.js";

// Local box helper — mirrors the unexported box() in voxel.js so every prop
// follows the exact same BoxGeometry + flatShading recipe.
function box(w, h, d, color, x = 0, y = 0, z = 0) {
  const geo = new THREE.BoxGeometry(w, h, d);
  const mat = new THREE.MeshLambertMaterial({ color, flatShading: true });
  const m   = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow    = true;
  m.receiveShadow = true;
  return m;
}

// ---------------------------------------------------------------------------
// Prop builders
// Each function receives the obstacle descriptor: { r, height, ... }.
// All geometry is relative to the local origin at ground level (y = 0).
// ---------------------------------------------------------------------------

/**
 * Dead tree: chunky trunk with three stacked canopy tiers.
 * Palette: dark-brown trunk, three shades of green for canopy.
 */
function buildTree(obs) {
  const g = new THREE.Group();
  const h = obs.height, r = obs.r;
  const trunkH = h * 0.55;
  // Trunk
  g.add(box(0.28, trunkH, 0.28, 0x4a2e18, 0, trunkH * 0.5, 0));
  // Canopy tier 1 (widest, lowest)
  g.add(box(r * 1.7, h * 0.38, r * 1.7, 0x2d5a1b, 0, trunkH + h * 0.19, 0));
  // Canopy tier 2
  g.add(box(r * 1.2, h * 0.30, r * 1.2, 0x3d7a2b, 0, trunkH + h * 0.42, 0));
  // Canopy tier 3 (narrowest, highest)
  g.add(box(r * 0.7, h * 0.22, r * 0.7, 0x1e3d12, 0, trunkH + h * 0.60, 0));
  return g;
}

/**
 * Stone cluster: a main boulder with two side rocks for natural irregularity.
 * Palette: gray-brown rock tones.
 */
function buildStone(obs) {
  const g = new THREE.Group();
  const h = obs.height, r = obs.r;
  g.add(box(r * 1.5, h * 0.70, r * 1.3, 0x8a7a6a, 0,        h * 0.35,  0));
  g.add(box(r * 0.8, h * 0.50, r * 0.7, 0x6a5a52,  r * 0.6, h * 0.25,  r * 0.3));
  g.add(box(r * 0.6, h * 0.35, r * 0.6, 0x9a8a78, -r * 0.5, h * 0.175, -r * 0.35));
  return g;
}

/**
 * Ruined column: base slab, shaft with a mid-ring band, and a capital.
 * Palette: marble white / shadowed stone.
 */
function buildColumn(obs) {
  const g = new THREE.Group();
  const h = obs.height, r = obs.r;
  g.add(box(r * 1.8, h * 0.12, r * 1.8, 0xa8a090, 0, h * 0.06,  0));  // base slab
  g.add(box(r * 1.1, h * 0.65, r * 1.1, 0xc8c0b0, 0, h * 0.44,  0));  // shaft
  g.add(box(r * 1.0, h * 0.08, r * 1.0, 0xa8a090, 0, h * 0.795, 0));  // mid ring
  g.add(box(r * 1.5, h * 0.15, r * 1.5, 0xd8d0c0, 0, h * 0.93,  0));  // capital
  return g;
}

/**
 * Rubble debris: four offset chunks for a scattered ruin look.
 * Palette: sand/stone rubble tones.
 */
function buildDebris(obs) {
  const g = new THREE.Group();
  const h = obs.height, r = obs.r;
  g.add(box(r * 1.1,  h * 0.55, r * 0.9,  0x8a7860,  0,        h * 0.275, 0));
  g.add(box(r * 0.7,  h * 0.38, r * 0.65, 0x5a4838,  r * 0.5,  h * 0.19,  r * 0.3));
  g.add(box(r * 0.55, h * 0.28, r * 0.7,  0x9a8870, -r * 0.4,  h * 0.14, -r * 0.4));
  g.add(box(r * 0.4,  h * 0.18, r * 0.4,  0x7a6848,  r * 0.3,  h * 0.09, -r * 0.5));
  return g;
}

/**
 * Broken wall section: a long flat slab with two crumbled notches at the top.
 * Oriented along x by default; obs.rot is applied externally by the renderer.
 * Palette: stone masonry with a darker mortar shadow.
 */
function buildWall(obs) {
  const g = new THREE.Group();
  const h = obs.height, r = obs.r;
  // Main slab
  g.add(box(r * 3.5, h, 0.5, 0x9a8878, 0, h * 0.5, 0));
  // Crumbled notches above the parapet
  g.add(box(r * 0.6, h * 0.30, 0.6, 0x7a6858, -r * 1.0, h + h * 0.15, 0));
  g.add(box(r * 0.5, h * 0.38, 0.6, 0x6a5848,  r * 0.8, h + h * 0.19, 0));
  return g;
}

/**
 * Boulder: a chunky angular rock with a rounded top cap and a protruding shard.
 * Palette: dark granite / shadow tones.
 */
function buildBoulder(obs) {
  const g = new THREE.Group();
  const h = obs.height, r = obs.r;
  g.add(box(r * 1.8, h,       r * 1.6, 0x7a6a60, 0,       h * 0.5,  0));
  g.add(box(r * 1.3, h * 0.5, r * 1.4, 0x8a7a6e, 0,       h * 0.85, 0));  // top rounding
  g.add(box(r * 0.8, h * 0.4, r * 0.7, 0x5a4a44, r * 0.5, h * 0.2,  r * 0.4));  // shard
  return g;
}

/**
 * Fallen dead giant: a massive humanoid corpse lying face-down along +x.
 * Components: torso, head, two arms, two legs.
 * Palette: rotted flesh / shadow.
 */
function buildDeadGiant(obs) {
  const g = new THREE.Group();
  const h = obs.height, r = obs.r;
  // Torso (elongated along x)
  g.add(box(r * 3.5,  h * 0.80, r * 1.2,  0x8a7062,  0,        h * 0.40,  0));
  // Head
  g.add(box(r * 1.2,  h * 0.90, r * 1.0,  0xc8a88a,  r * 2.0,  h * 0.45,  0));
  // Arms
  g.add(box(r * 2.0,  h * 0.38, r * 0.55, 0x8a7062,  r * 0.5,  h * 0.19,  r * 1.1));
  g.add(box(r * 2.0,  h * 0.38, r * 0.55, 0x8a7062, -r * 0.4,  h * 0.19, -r * 1.1));
  // Legs
  g.add(box(r * 0.7,  h * 0.38, r * 2.5,  0x6a5040, -r * 1.5,  h * 0.19,  r * 0.4));
  g.add(box(r * 0.7,  h * 0.38, r * 2.5,  0x6a5040, -r * 1.5,  h * 0.19, -r * 0.4));
  return g;
}

/**
 * Dragon skeleton: a massive spine, four rib pairs, and a horned skull.
 * Palette: old ivory / bone white.
 */
function buildDragonBones(obs) {
  const g = new THREE.Group();
  const h = obs.height, r = obs.r;
  // Spine running along +x
  g.add(box(r * 4.0, h * 0.30, r * 0.7, 0xd4c8a8, 0, h * 0.15, 0));
  // Four pairs of ribs (symmetrical about z = 0)
  const ribH = h * 0.65, ribW = r * 0.18, ribD = r * 0.85;
  const ribOffsX = [-r * 1.1, -r * 0.35, r * 0.45, r * 1.2];
  for (const ox of ribOffsX) {
    g.add(box(ribW, ribH, ribD, 0xb0a488, ox, ribH * 0.5,  r * 0.65));
    g.add(box(ribW, ribH, ribD, 0xb0a488, ox, ribH * 0.5, -r * 0.65));
  }
  // Skull + jaw
  g.add(box(r * 1.4, h * 0.70, r * 1.0, 0xe4d8b8, r * 2.2, h * 0.35, 0));
  g.add(box(r * 0.8, h * 0.18, r * 1.2, 0xd4c8a8, r * 2.2, h * 0.09, 0));
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
