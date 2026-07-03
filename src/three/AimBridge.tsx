// R3F half of the aim seam (design §2/§10 risk 7): raycasts the live R3F
// camera against the ground plane and attaches itself to the shared
// aimBridge singleton so the ONE InputController (src/services/registry.ts
// getInput()) keeps working unmodified under `?renderer=r3f`, exactly like
// LegacyRendererBridge attaching the imperative GameRenderer under
// `?renderer=legacy`. Resolves on demand — never caches a per-frame result.
import { useEffect, useMemo } from "react";
import { useThree } from "@react-three/fiber";
import * as THREE from "three";
import { aimBridge } from "../store/aimBridge";
import { snapshotRef } from "../store/snapshotRef";
import { playerPos } from "./entities/entityRegistry";

export function AimBridge(): null {
  const camera = useThree((state) => state.camera);
  // Scratch instances reused across every raycast — this component has
  // exactly one live instance (the main game Canvas; CharacterPreviewCanvas,
  // P5, is a separate <Canvas> with no aim seam), so instance-scoped scratch
  // state is safe and avoids per-call allocation.
  const raycaster = useMemo(() => new THREE.Raycaster(), []);
  const plane = useMemo(() => new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), []);
  const ndc = useMemo(() => new THREE.Vector2(), []);
  const hit = useMemo(() => new THREE.Vector3(), []);

  useEffect(() => {
    // Ground-plane (y=0) raycast from a screen point — mirrors legacy
    // renderer.js's screenToPoint (NDC built from window.innerWidth/Height,
    // not canvas size, to match the input layer's existing coordinate space).
    function toWorld(x: number, y: number): { x: number; z: number } | null {
      ndc.set((x / window.innerWidth) * 2 - 1, -(y / window.innerHeight) * 2 + 1);
      raycaster.setFromCamera(ndc, camera);
      return raycaster.ray.intersectPlane(plane, hit) ? { x: hit.x, z: hit.z } : null;
    }

    aimBridge.attach({
      screenToPoint: (x, y) => toWorld(x, y),
      // Angle from the LOCAL PLAYER'S INTERPOLATED position (entityRegistry,
      // design §0/§2 parity trap — never the raw snapshot x/z) to the ground
      // hit. Falls back to the last resolved angle when no player entity has
      // mounted yet or the ray misses the plane, rather than snapping to 0.
      screenToAim: (x, y) => {
        const me = playerPos(snapshotRef.localId);
        const point = me ? toWorld(x, y) : null;
        if (!me || !point) return snapshotRef.aim.angle;
        const angle = Math.atan2(point.z - me.z, point.x - me.x);
        snapshotRef.aim.angle = angle;
        return angle;
      },
    });

    return () => aimBridge.attach(null);
  }, [camera, raycaster, plane, ndc, hit]);

  return null;
}
