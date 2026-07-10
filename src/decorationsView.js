// THREE-consuming assembly half of the decorations system (WS-C). Kept
// separate from src/decorations.js (which owns the pure, node-testable
// computeDecorationPlacements()) purely so decorations.js stays importable
// under plain `node test/decorations.test.mjs` — "three" only resolves via
// index.html's browser import map, so any module that imports it can't be
// loaded by a bare Node script (see src/decorations.js's header comment).
import * as THREE from "three";
import { CFG } from "./config.js";
import { clonePropInstance, propModelReady, loadPropModelTemplate } from "./propModel.js";
import { facetedRock, facetedCrystal } from "./lowpoly.js";

// Props whose silhouette reads better as a faceted crystal placeholder than
// a rock while their GLB is still loading.
const CRYSTAL_LIKE = new Set(["crystal-cluster", "rune-stone", "void-obelisk", "lava-obsidian-spire"]);

function proceduralFallback(prop) {
  if (CRYSTAL_LIKE.has(prop)) {
    return facetedCrystal(0.5, 0x9c7bff, { sy: 1.5, y: 0.6 });
  }
  return facetedRock(0.55, 0x8a7a6a, { detail: 1, perturb: 0.15, y: 0.4 });
}

/**
 * Build a THREE.Group of decoration instances from computeDecorationPlacements()'s
 * output, adding it to `scene` immediately. Each placement gets a GLB-backed
 * propModel clone when its template has finished loading, else a simple
 * procedural placeholder (upgraded to the GLB look next round once loaded —
 * decorations rebuild every round anyway, so there's no need to hot-swap a
 * placeholder already on screen).
 *
 * @returns {{ group: THREE.Group, dispose: () => void }}
 */
export function buildDecorations(scene, placements) {
  const group = new THREE.Group();
  group.name = "decorations";

  for (const p of placements) {
    if (!propModelReady(p.prop)) loadPropModelTemplate(p.prop);

    const holder = new THREE.Group();
    const child = propModelReady(p.prop) ? clonePropInstance(p.prop) : proceduralFallback(p.prop);
    holder.add(child);

    const y = p.ring ? CFG.DECOR.ringSinkY : CFG.PLATFORM_TOP;
    holder.position.set(p.x, y, p.z);
    holder.rotation.y = p.rot;
    holder.scale.setScalar(p.scale);
    // Consumed by renderer.js's _cullMapMeshes: ring dressing sits outside
    // the play radius by design and is never culled (like the hazard's
    // ambient detail props); interior accents cull exactly like obstacles.
    holder.userData.ring = p.ring;
    holder.userData.cx = p.x;
    holder.userData.cz = p.z;

    group.add(holder);
  }

  scene.add(group);

  function dispose() {
    scene.remove(group);
    group.traverse((o) => {
      if (o.geometry) o.geometry.dispose?.();
      if (o.material) {
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        mats.forEach((m) => m.dispose?.());
      }
    });
  }

  return { group, dispose };
}
