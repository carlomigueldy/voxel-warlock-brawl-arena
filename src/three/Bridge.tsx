// PrimitiveFx — the declarative <-> imperative seam every leaf-builder port
// (voxel.js/props.js/arena.js and friends, all deferred past this scaffold)
// bridges through: build a THREE.Group ONCE with the existing procedural
// builder, mount it via <primitive>, and tick it imperatively every frame —
// exactly the legacy renderer.js update loop, just driven by useFrame
// instead of a manual rAF (design §4).
import { useEffect, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

export interface PrimitiveFxProps {
  /** Builds the group once per mount (identity change remounts). */
  build: () => THREE.Group;
  /** Advances the group's own animation state; dt is pre-clamped to 0.05
   * (design §0 dt clamp) so a tab-switch stall can't blow up a builder's
   * internal spring/decay math. */
  tick?: (group: THREE.Group, dt: number) => void;
}

// Traverse and dispose every geometry/material this group owns. Mirrors the
// inline dispose loop renderer.js's _rebuildMapMeshes already runs before
// rebuilding — pulled out here since every PrimitiveFx instance needs it on
// unmount, not just map-layout rebuilds.
function disposeGroup(root: THREE.Object3D): void {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    mesh.geometry?.dispose?.();
    const mat = mesh.material;
    if (mat) (Array.isArray(mat) ? mat : [mat]).forEach((m) => m.dispose?.());
  });
}

export function PrimitiveFx({ build, tick }: PrimitiveFxProps) {
  // build is a factory called exactly once per mount (identity change remounts
  // via key), matching legacy's build-once-then-tick-imperatively contract.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const group = useMemo(build, []);

  useFrame((_, rawDt) => tick?.(group, Math.min(0.05, rawDt)));

  useEffect(() => {
    return () => {
      group.userData.dispose?.();
      disposeGroup(group);
    };
  }, [group]);

  return <primitive object={group} />;
}
