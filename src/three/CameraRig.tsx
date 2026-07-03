// useFrame port of legacy renderer.js's _updateCamera (design §0 — the
// exact follow/shake formulas are load-bearing, reproduce byte-for-byte).
// EffectsLayer (future issue, #147) ADDS shake impulses to snapshotRef.shake;
// this rig only ever DECAYS it, same split of responsibility as legacy's
// this._shake field (renderer.js owns both add and decay today; the R3F
// split just moves the "add" half to wherever an event fires the impulse).
import { useMemo } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { snapshotRef } from "../store/snapshotRef";
import { playerPos } from "./entities/entityRegistry";

export function CameraRig(): null {
  const camera = useThree((state) => state.camera);
  // Smoothed camera target — legacy's this._camTarget, seeded at (0,0,0).
  const camTarget = useMemo(() => new THREE.Vector3(0, 0, 0), []);
  const focus = useMemo(() => new THREE.Vector3(), []);
  const desired = useMemo(() => new THREE.Vector3(), []);

  useFrame((_, rawDt) => {
    const dt = Math.min(0.05, rawDt);
    const localId = snapshotRef.localId;
    // `me` — the raw snapshot player (only its `.al` alive flag is read
    // here); `p` — the local player's INTERPOLATED position via
    // entityRegistry (design §2 parity trap: legacy follows the smoothed
    // mesh position, never the raw wire x/z). Falls back to the arena
    // center when no local player is alive/mounted (matches the empty-scene
    // acceptance bar for this PR — no player entity exists yet).
    const me = localId ? snapshotRef.byId.get(localId) : undefined;
    const p = playerPos(localId);

    if (p && me?.al) focus.set(p.x, 0, p.z);
    else focus.set(0, 0, 0);
    camTarget.lerp(focus, 1 - Math.exp(-4 * dt));

    // Decaying screen shake for impacts — snapshotRef.shake is the shared
    // non-reactive field EffectsLayer (future) adds impulses to.
    let sx = 0;
    let sy = 0;
    if (snapshotRef.shake > 0) {
      sx = (Math.random() - 0.5) * snapshotRef.shake * 2;
      sy = (Math.random() - 0.5) * snapshotRef.shake * 2;
      snapshotRef.shake = Math.max(0, snapshotRef.shake - dt * 1.8);
    }

    desired.set(camTarget.x + sx, 26 + sy, camTarget.z + 22);
    camera.position.lerp(desired, 1 - Math.exp(-4 * dt));
    camera.lookAt(camTarget.x, 0, camTarget.z);
  });

  return null;
}
