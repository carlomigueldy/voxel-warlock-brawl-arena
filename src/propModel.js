import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

// Blender-generated GLB props (scripts/blender/props_gen.py) for dungeon
// dressing/decorations — this is the prop counterpart of mobModel.js's
// MOB_MODEL_ASSETS/loadMobModelTemplate. Unlike mobs, props carry no
// skeleton/animation: a cached template is loaded once per name, then plain
// (non-skinned) THREE.Object3D.clone()s are handed out per placement.
const url = (name) => new URL(`../assets/props/${name}.glb`, import.meta.url).href;

// Every prop name the shared kit + theme variants can reference (see
// scripts/blender/props_gen.py ENTRIES and src/config.js CFG.DECOR).
export const PROP_MODEL_NAMES = [
  "pillar", "broken-pillar", "arch", "torch", "brazier", "banner",
  "rune-stone", "crystal-cluster", "rubble",
  "lava-obsidian-spire", "ocean-coral-pillar", "swamp-root-arch",
  "rocks-monolith", "void-obelisk",
];

let _loadPromises = new Map(); // name -> Promise
let _templates = new Map();    // name -> THREE.Object3D (template scene)

/**
 * Kick off (and cache) loading the GLB template for `name`. Safe to call
 * repeatedly — later calls return the same in-flight/completed promise.
 * Returns null for an unknown name.
 */
export function loadPropModelTemplate(name) {
  if (!PROP_MODEL_NAMES.includes(name)) return null;
  if (_loadPromises.has(name)) return _loadPromises.get(name);

  const loader = new GLTFLoader();
  const promise = new Promise((resolve, reject) => {
    loader.load(url(name), resolve, undefined, reject);
  })
    .then((gltf) => {
      const scene = gltf.scene;
      scene.traverse((o) => {
        if (o.isMesh) {
          o.castShadow = true;
          o.receiveShadow = true;
          // GLTFLoader already sets vertexColors from the "Col" COLOR_0
          // attribute and flatShading from the exporter's per-face normals
          // (see scripts/blender/voxel_lib.py); verify rather than assume so
          // a future exporter change fails loud instead of silently
          // flattening prop color.
          if (o.material) {
            o.material.vertexColors = true;
            o.material.flatShading = true;
          }
        }
      });
      _templates.set(name, scene);
      return scene;
    })
    .catch((err) => {
      // Permanently-failed load: clear so a later call can retry, and let
      // the caller keep using the procedural fallback forever otherwise —
      // this only prevents an unhandled-rejection warning (mirrors
      // mobModel.js's loadMobModelTemplate).
      _loadPromises.delete(name);
      console.error(`[propModel] failed to load GLB template for "${name}":`, err);
      return null;
    });

  _loadPromises.set(name, promise);
  return promise;
}

export function propModelReady(name) {
  return _templates.has(name);
}

/**
 * Clone a ready template into a fresh instance positioned at the local
 * origin (caller sets position/rotation/scale). Returns null if the
 * template isn't loaded yet (caller should fall back to a procedural mesh).
 */
export function clonePropInstance(name) {
  const template = _templates.get(name);
  if (!template) return null;
  const inst = template.clone(true);
  inst.traverse((o) => {
    if (o.isMesh && o.material) {
      // Clone the material per instance so nothing shared between
      // placements could be mutated by one and bleed into another (matches
      // mobModel.js's per-instance material clone rationale).
      const wasArray = Array.isArray(o.material);
      const mats = wasArray ? o.material : [o.material];
      const cloned = mats.map((m) => {
        const c = m.clone();
        c.needsUpdate = true;
        return c;
      });
      o.material = wasArray ? cloned : cloned[0];
    }
  });
  return inst;
}

// Kick off loading every prop template eagerly (called once by the renderer
// on startup) so the first round's decorations have a chance to be GLB-backed
// rather than falling back to procedural placeholders for the whole match.
export function preloadAllPropModels() {
  for (const name of PROP_MODEL_NAMES) loadPropModelTemplate(name);
}
