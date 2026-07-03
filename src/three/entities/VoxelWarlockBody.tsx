// The procedural voxel-box warlock fallback — mounted as the <Suspense>/
// <ErrorBoundary> fallback for <WarlockBody> (design §3/§4), matching
// legacy's `usingGLB=false` path (buildWarlock/animateWarlock straight off
// src/voxel.ts, no GLB involved). Also the ONLY body rendered whenever
// <WarlockBody>'s GLB load throws.
import { useEffect, useMemo, type MutableRefObject } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { buildWarlock, animateWarlock } from "../../voxel";
import { registerPlayer, unregisterPlayer, type Vec2 } from "./entityRegistry";
import type { PlayerAnimInfo } from "./playerAnim";
import { applyChargeTint } from "../materials/chargeTint";

export interface VoxelWarlockBodyProps {
  regId: string;
  color: number;
  animRef: MutableRefObject<PlayerAnimInfo>;
  posRef: Vec2;
  bodyKindRef: MutableRefObject<{ usingGLB: boolean }>;
}

export function VoxelWarlockBody({ regId, color, animRef, posRef, bodyKindRef }: VoxelWarlockBodyProps) {
  // build-once-then-tick-imperatively contract (design §4 PrimitiveFx), keyed
  // on color like every other leaf-builder bridge in this tree.
  const group = useMemo(() => buildWarlock(color), [color]);

  useEffect(() => {
    bodyKindRef.current.usingGLB = false;
    registerPlayer(regId, {
      // Voxel fallback has no hit-reaction overlay — legacy's _triggerReaction
      // is GLB-only (`char.triggerReaction`, character.js); the voxel path
      // never had a group.userData.triggerReaction fallback either.
      triggerReaction: () => {},
      triggerCast: (archetype) => group.userData.triggerCast?.(archetype),
      pos: posRef,
    });
    return () => {
      unregisterPlayer(regId);
      group.traverse((o) => {
        const mesh = o as THREE.Mesh;
        mesh.geometry?.dispose?.();
        const mat = mesh.material;
        if (mat) (Array.isArray(mat) ? mat : [mat]).forEach((m) => m.dispose?.());
      });
    };
    // posRef/bodyKindRef are stable mutable-object refs owned by <PlayerEntity>
    // for this entity's lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [regId, group]);

  useFrame(() => {
    animateWarlock(group, animRef.current);
    applyChargeTint(group, animRef.current.charge);
  });

  return <primitive object={group} />;
}
