// The scene's fixed light rig (design §0 _initLights, minus the hazard glow
// — that one is Environment-owned since it's re-themed per map, not a
// bolt-tracking light). Two static lights (hemisphere ambient + shadow-
// casting directional sun) plus CFG.LIGHT_POOL_SIZE shared dynamic
// PointLights reused across whichever bolts are nearest the local player —
// a fixed light budget instead of one PointLight per live bolt.
import { useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { CFG } from "../config.js";
import { snapshotRef } from "../store/snapshotRef";
import { playerPos } from "./entities/entityRegistry";

export function LightPool() {
  const camera = useThree((state) => state.camera);
  const poolRefs = useRef<(THREE.PointLight | null)[]>([]);
  const origin = useMemo(() => new THREE.Vector3(), []);

  useFrame(() => {
    const snap = snapshotRef.current;
    const bolts = snap ? [...snap.bolts] : [];

    // Sort by distance to the local player's INTERPOLATED position (design
    // §2 parity trap — entityRegistry, never the raw snapshot); falls back
    // to the camera when no player entity has mounted yet, same as legacy's
    // `localE ? localE.group.position : this.camera.position`. Bolts
    // themselves are read straight off the snapshot (design §3: no interp).
    const me = playerPos(snapshotRef.localId);
    if (me) origin.set(me.x, 0, me.z);
    else origin.copy(camera.position);

    bolts.sort((a, b) => {
      const da = (a.x - origin.x) ** 2 + (a.z - origin.z) ** 2;
      const db = (b.x - origin.x) ** 2 + (b.z - origin.z) ** 2;
      return da - db;
    });

    const pool = poolRefs.current;
    for (let i = 0; i < pool.length; i++) {
      const light = pool[i];
      if (!light) continue;
      const bolt = bolts[i];
      if (bolt) {
        light.position.set(bolt.x, bolt.y ?? CFG.PLATFORM_TOP + 1.1, bolt.z);
        light.color.setHex(bolt.c);
        light.intensity = 1.2;
      } else {
        light.intensity = 0;
      }
    }
  });

  return (
    <>
      <hemisphereLight args={[0x8a7bff, 0x2a1a3a, 0.7]} />
      <directionalLight
        color={0xfff0e0}
        intensity={1.1}
        position={[20, 40, 20]}
        castShadow
        shadow-mapSize={[1024, 1024]}
        shadow-camera-left={-40}
        shadow-camera-right={40}
        shadow-camera-top={40}
        shadow-camera-bottom={-40}
        shadow-camera-far={120}
      />
      {Array.from({ length: CFG.LIGHT_POOL_SIZE }, (_, i) => (
        <pointLight
          key={i}
          ref={(el) => {
            poolRefs.current[i] = el;
          }}
          args={[0xffffff, 0, 6]}
        />
      ))}
    </>
  );
}
