// Shared GPU-resource teardown for the arena/map leaf builders (ArenaFloor,
// Hazard, HazardDetails, MapLayout) — every one of them swaps a freshly
// `voxel.js`/`props.ts`-built Object3D into a persistent container `<group>`
// on rebuild (radius/world/mapV change) and must dispose the outgoing one
// first, exactly like legacy renderer.js's inline dispose loops in
// Arena._buildHazard/rebuild and _rebuildMapMeshes. Mirrors src/three/Bridge.tsx's
// private disposeGroup (that one is PrimitiveFx-scoped; this module is the
// map-layer equivalent so ArenaFloor/Hazard/HazardDetails/MapLayout don't
// each reimplement the same traversal).
import * as THREE from "three";

export function disposeGroup(root: THREE.Object3D): void {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    mesh.geometry?.dispose?.();
    const mat = mesh.material;
    if (mat) (Array.isArray(mat) ? mat : [mat]).forEach((m) => m.dispose?.());
  });
}
