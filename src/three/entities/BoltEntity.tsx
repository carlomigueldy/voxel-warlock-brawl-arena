// Declarative <-> pooled-imperative seam for a single traveling projectile
// bolt (design §3/§0 — the parity-critical part: bolts are the one entity
// kind that is NOT interpolated). Mirrors legacy renderer.js's per-frame
// `apply()`+`update()` pair for `this.boltMeshes`:
//   apply(): acquireBolt-if-absent, position DIRECT from the snapshot (no
//     lerp — a bolt's wire x/z/y IS its render position every frame).
//   update(): spin (rot.y+=dt*6, rot.x+=dt*4) + tick any registry-routed
//     core's own userData.update(dt) (TrailPool emitter, homing's spinning
//     reticle ring, ...).
// <BoltsLayer> keys one <BoltEntity> per live bolt id (useRosterStore.boltIds
// — spawn/despawn only), so acquireBolt/releaseBolt run exactly once each,
// in this component's mount/useEffect-cleanup — NEVER on re-render (design
// §3 pooling contract / §10 risk 2).
import { useEffect, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import { CFG } from "../../config.js";
import { snapshotRef } from "../../store/snapshotRef";
import { acquireBolt, releaseBolt } from "../../pool.js";

export interface BoltEntityProps {
  id: number;
}

export function BoltEntity({ id }: BoltEntityProps) {
  // Snapshot the bolt's color/kind at spawn (mount) time only — this is
  // legacy apply()'s `if (!m) { m = acquireBolt(b.c, b.k || "fireball"); }`
  // build-if-absent call site, fired exactly once per bolt id's lifetime.
  // A bolt's kind/color never change over its life, so reading them once
  // here (rather than every frame) is value-identical to legacy.
  const group = useMemo(() => {
    const bolt = snapshotRef.current?.bolts.find((b) => b.id === id);
    return acquireBolt(bolt?.c ?? 0xffffff, bolt?.k || "fireball");
  }, [id]);

  useEffect(() => {
    return () => releaseBolt(group);
  }, [group]);

  useFrame((_, rawDt) => {
    const dt = Math.min(0.05, rawDt);
    const bolt = snapshotRef.current?.bolts.find((b) => b.id === id);
    // Guards the one-frame race between the roster store (React state,
    // reconciled asynchronously) and snapshotRef (read live every rAF) —
    // BoltsLayer unmounts this entity as soon as `id` drops out of
    // boltIds; until then, keep the group at its last known pose rather
    // than snapping to the origin.
    if (!bolt) return;
    // NOT interpolated — position DIRECT from the current snapshot every
    // frame (design §0/§3 parity trap: no lerp, unlike players/mobs).
    group.position.set(bolt.x, bolt.y ?? CFG.PLATFORM_TOP + 1.1, bolt.z);
    group.rotation.y += dt * 6;
    group.rotation.x += dt * 4;
    group.userData.update?.(dt);
  });

  return <primitive object={group} />;
}
