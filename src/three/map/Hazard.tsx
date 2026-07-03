// Declarative port of legacy Arena's hazard-surface lifecycle (design §4/§8
// p4-arena-map): the animated lava/ocean/swamp/rocks/void plane under the
// platform. Rebuilt only when the active world changes (Arena._buildHazard
// is only ever called from the ctor, setWorld, and reset — never from a
// radius-only change), then advanced every frame via animateHazard(mesh, t)
// exactly like legacy's Arena.update(t, dt) → animateHazard(this.lava, t).
// `t` is THREE.Clock elapsed time (design §0: `this.clock.elapsedTime`),
// which R3F's useFrame state.clock already tracks the same way.
import { useEffect, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { CFG, getArenaHazard } from "../../config.js";
import { snapshotRef } from "../../store/snapshotRef";
import { buildHazard, animateHazard } from "../../voxel.js";
import { disposeGroup } from "./disposeGroup";

export function Hazard() {
  const containerRef = useRef<THREE.Group>(null);
  const meshRef = useRef<THREE.Mesh | null>(null);
  const builtWorldRef = useRef<string | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const hazard = getArenaHazard(CFG.DEFAULT_ARENA_WORLD);
    const mesh: THREE.Mesh = buildHazard(160, CFG.LAVA_Y, hazard);
    container.add(mesh);
    meshRef.current = mesh;
    builtWorldRef.current = CFG.DEFAULT_ARENA_WORLD;
    return () => {
      container.remove(mesh);
      disposeGroup(mesh);
      meshRef.current = null;
      builtWorldRef.current = null;
    };
  }, []);

  useFrame((state) => {
    const container = containerRef.current;
    if (!container) return;
    const snap = snapshotRef.current;
    const worldId = snap?.arenaWorld ?? CFG.DEFAULT_ARENA_WORLD;

    if (worldId !== builtWorldRef.current) {
      const hazard = getArenaHazard(worldId);
      if (meshRef.current) {
        container.remove(meshRef.current);
        disposeGroup(meshRef.current);
      }
      const mesh: THREE.Mesh = buildHazard(160, CFG.LAVA_Y, hazard);
      container.add(mesh);
      meshRef.current = mesh;
      builtWorldRef.current = worldId;
    }

    if (meshRef.current) animateHazard(meshRef.current, state.clock.elapsedTime);
  });

  return <group ref={containerRef} />;
}
