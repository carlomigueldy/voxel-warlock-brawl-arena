// The GLB warlock body — mounted inside <PlayerEntity>'s <Suspense>/
// <ErrorBoundary> (design §3/§6). Suspends on first mount (useGLTF loading
// every clip GLB for `characterId`); once resolved, renders the healed,
// per-instance-cloned model and drives it every frame from the animRef seam
// PlayerEntity fills in its own useFrame — decoupling the interpolation/
// label/HP-bar/aura tree (always mounted) from this potentially-suspended
// leaf.
import { useEffect, type MutableRefObject } from "react";
import { useFrame } from "@react-three/fiber";
import { useWarlockModel } from "./useWarlockModel";
import { registerPlayer, unregisterPlayer, type Vec2 } from "../entities/entityRegistry";
import type { PlayerAnimInfo } from "../entities/playerAnim";
import { applyChargeTint } from "../materials/chargeTint";

export interface WarlockBodyProps {
  regId: string;
  characterId: string | undefined;
  color: number;
  animRef: MutableRefObject<PlayerAnimInfo>;
  posRef: Vec2;
  bodyKindRef: MutableRefObject<{ usingGLB: boolean }>;
}

export function WarlockBody({ regId, characterId, color, animRef, posRef, bodyKindRef }: WarlockBodyProps) {
  const instance = useWarlockModel(characterId, color);

  useEffect(() => {
    bodyKindRef.current.usingGLB = true;
    registerPlayer(regId, {
      triggerCast: instance.triggerCast,
      triggerReaction: instance.triggerReaction,
      pos: posRef,
    });
    return () => unregisterPlayer(regId);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- posRef/bodyKindRef are
    // stable mutable-object refs owned by <PlayerEntity> for this entity's lifetime.
  }, [regId, instance]);

  useFrame(() => {
    instance.update(animRef.current);
    applyChargeTint(instance.model, animRef.current.charge);
  });

  return <primitive object={instance.root} />;
}
