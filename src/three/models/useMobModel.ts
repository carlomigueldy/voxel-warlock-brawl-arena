// The mob counterpart of design §6's useWarlockModel — the declarative seam
// between MobEntity/MobBody and mobModel.ts's own (unchanged, legacy-shared)
// GLTFLoader/template-cache machinery.
//
// Unlike useWarlockModel (drei's useGLTF + a NEW getOrBuildWarlockTemplate),
// mobModel.ts already owns a complete, idempotent, module-singleton GLB
// pipeline (loadMobModelTemplate/mobModelReady/buildMobModelInstance) that
// renderer.js/voxel.js's buildMobByType() dispatches through today — value-
// identical ported to TS by this same issue (#141). Reusing that dispatcher
// directly (rather than re-implementing loading against drei's useGLTF) is
// the one true GLB-or-procedural-fallback source of truth for mobs, keeps
// the legacy and R3F renderers sharing one cache, and reproduces legacy's
// "start procedural, upgrade to GLB once the template lands" behavior
// (_upgradeMobsToGLB) as a React re-render instead of an imperative group
// swap: `ready` flips synchronously once, and the `useMemo` below rebuilds
// exactly once in response.
import { useEffect, useMemo, useState } from "react";
import * as THREE from "three";
import { MOB_MODEL_ASSETS, loadMobModelTemplate, mobModelReady } from "../../mobModel.js";
import { buildMobByType } from "../../voxel.js";

export interface UseMobModelResult {
  /** Built once per (type, color, glbReady) — buildMobByType() itself
   * decides GLB vs procedural fallback (design §6 fallback dispatch). */
  group: THREE.Group;
  /** True once this instance is the Meshy GLB body, false while still the
   * voxel procedural fallback (mirrors legacy's `e.usingGLB`). */
  usingGLB: boolean;
}

// Traverse and dispose every geometry/material this group owns — mirrors
// Bridge.tsx's PrimitiveFx disposal (private to that module; this hook needs
// its own copy since MobBody doesn't go through <PrimitiveFx>, see MobBody.tsx
// header comment for why).
function disposeGroup(root: THREE.Object3D): void {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    mesh.geometry?.dispose?.();
    const mat = mesh.material;
    if (mat) (Array.isArray(mat) ? mat : [mat]).forEach((m) => m.dispose?.());
  });
}

export function useMobModel(type: string, color: number): UseMobModelResult {
  const [glbReady, setGlbReady] = useState<boolean>(() => mobModelReady(type));

  useEffect(() => {
    setGlbReady(mobModelReady(type));
    if (mobModelReady(type)) return;
    if (!MOB_MODEL_ASSETS[type]) return; // no rigged body for this type (e.g. minion) — stays procedural forever
    let cancelled = false;
    loadMobModelTemplate(type)
      ?.then(() => {
        if (!cancelled && mobModelReady(type)) setGlbReady(true);
      })
      .catch(() => {
        // loadMobModelTemplate already logs + clears its own promise cache on
        // failure (mobModel.ts) — nothing further to do here; stays on the
        // procedural fallback forever, matching legacy's console.warn path.
      });
    return () => {
      cancelled = true;
    };
  }, [type]);

  // glbReady is an intentional rebuild trigger (design §6 "upgrade to GLB"
  // swap) even though buildMobByType() doesn't read it directly — it's what
  // flips once loadMobModelTemplate() resolves and mobModelReady(type)
  // starts returning true.
  const group = useMemo(() => buildMobByType(type, color) as THREE.Group, [type, color, glbReady]);

  useEffect(() => {
    return () => {
      (group.userData.dispose as (() => void) | undefined)?.();
      disposeGroup(group);
    };
  }, [group]);

  return { group, usingGLB: !!group.userData.mobModel };
}
