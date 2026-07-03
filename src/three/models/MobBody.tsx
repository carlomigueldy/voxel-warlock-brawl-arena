// Bridges useMobModel's built THREE.Group into the scene and ticks it every
// frame (design §6). Not a <PrimitiveFx> (Bridge.tsx) because the group's
// IDENTITY changes exactly once, mid-lifetime, when useMobModel's GLB upgrade
// lands (design §6 "start procedural, swap to GLB when ready") — PrimitiveFx
// intentionally builds via `useMemo(build, [])` (never rebuilds without an
// external `key` remount) and doesn't report its built group back to a
// caller, neither of which fits this component's needs; MobEntity also reads
// this component's current body group imperatively (bodyGroupRef) to route
// entityRegistry's triggerAttack call, another thing PrimitiveFx doesn't
// expose.
import { useEffect } from "react";
import type { MutableRefObject } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { useMobModel } from "./useMobModel";
import { animateMob } from "../../voxel.js";
import type { MobModelState } from "../../mobModel.js";

/** Per-frame animation/HP inputs MobEntity computes and MobBody consumes —
 * decouples MobEntity's interpolation/entrance math from this component's
 * GLB-mixer-or-procedural-rig tick (mirrors design §3's PlayerEntity/body
 * animRef seam). `entrance` true means "locked in spawn pose" (design §0
 * mob entrance: NO anim during entrance) — neither the GLB mixer nor the
 * procedural rig advance while it holds. */
export interface MobAnimInfo {
  speed: number;
  maxSpeed: number;
  falling: boolean;
  entrance: boolean;
  /** hp/max, pre-clamped to >=0.001 (mirrors legacy's
   * `Math.max(0.001, mob.hp / mob.max)` guard against a zero-width bar). */
  hpFrac: number;
}

export interface MobBodyProps {
  type: string;
  color: number;
  animRef: MutableRefObject<MobAnimInfo>;
  /** MobEntity's handle onto whichever body group is currently mounted — set
   * here so entityRegistry's triggerAttack (registered by MobEntity) can
   * reach group.userData.mobModel.triggerAttack() without this component
   * needing to know about entityRegistry itself. */
  bodyGroupRef?: MutableRefObject<THREE.Group | null>;
}

export function MobBody({ type, color, animRef, bodyGroupRef }: MobBodyProps) {
  const { group } = useMobModel(type, color);

  useEffect(() => {
    if (bodyGroupRef) bodyGroupRef.current = group;
    return () => {
      if (bodyGroupRef && bodyGroupRef.current === group) bodyGroupRef.current = null;
    };
  }, [group, bodyGroupRef]);

  useFrame((state, rawDt) => {
    const dt = Math.min(0.05, rawDt);
    const info = animRef.current;

    // HP bar scale — legacy sets `hb.scale.x = hp/max` on every snapshot
    // sync (renderer.js); doing it every render frame here is equivalent
    // (hp is only ever mutated by snapshot arrival, so intermediate frames
    // recompute the same value) and keeps this component's tick self-
    // contained rather than needing a second per-snapshot effect.
    const hb = group.userData.healthBar as THREE.Mesh | undefined;
    if (hb) hb.scale.x = info.hpFrac;

    // Entrance: mob is locked in its spawn pose — no animateMob/mobModel
    // update at all (design §0), matching legacy's update() which skips
    // this whole block during the entrance window.
    if (info.entrance) return;

    const mobModel = group.userData.mobModel as MobModelState | undefined;
    if (mobModel) {
      mobModel.update({ dt, speed: info.speed, maxSpeed: info.maxSpeed, falling: info.falling });
    } else {
      animateMob(group, {
        type,
        speed: info.speed,
        maxSpeed: info.maxSpeed,
        falling: info.falling,
        dt,
        time: state.clock.elapsedTime,
      });
    }
  });

  return <primitive object={group} />;
}
