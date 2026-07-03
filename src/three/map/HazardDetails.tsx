// Declarative port of legacy Arena's ambient hazard-detail props (embers,
// spray, bubbles, dust, arcane shards — design §4/§8 p4-arena-map). Rebuilt
// only when the active world changes, same trigger as <Hazard> (Arena.
// _buildHazard rebuilds `this.lava` and `this.details` together), then
// advanced every frame via animateHazardDetails(group, t, dt) exactly like
// legacy's Arena.update(t, dt) → animateHazardDetails(this.details, t, dt).
// dt is pre-clamped to 0.05 (design §0 dt clamp), same as every other
// useFrame consumer in this tree.
import { useEffect, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { CFG, getArenaHazard } from "../../config.js";
import { snapshotRef } from "../../store/snapshotRef";
import { buildHazardDetails, animateHazardDetails } from "../../voxel.js";
import { disposeGroup } from "./disposeGroup";

export function HazardDetails() {
  const containerRef = useRef<THREE.Group>(null);
  const detailsRef = useRef<THREE.Group | null>(null);
  const builtWorldRef = useRef<string | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const hazard = getArenaHazard(CFG.DEFAULT_ARENA_WORLD);
    const details: THREE.Group = buildHazardDetails(160, CFG.LAVA_Y, hazard);
    container.add(details);
    detailsRef.current = details;
    builtWorldRef.current = CFG.DEFAULT_ARENA_WORLD;
    return () => {
      container.remove(details);
      disposeGroup(details);
      detailsRef.current = null;
      builtWorldRef.current = null;
    };
  }, []);

  useFrame((state, rawDt) => {
    const container = containerRef.current;
    if (!container) return;
    const dt = Math.min(0.05, rawDt);
    const snap = snapshotRef.current;
    const worldId = snap?.arenaWorld ?? CFG.DEFAULT_ARENA_WORLD;

    if (worldId !== builtWorldRef.current) {
      const hazard = getArenaHazard(worldId);
      if (detailsRef.current) {
        container.remove(detailsRef.current);
        disposeGroup(detailsRef.current);
      }
      const details: THREE.Group = buildHazardDetails(160, CFG.LAVA_Y, hazard);
      container.add(details);
      detailsRef.current = details;
      builtWorldRef.current = worldId;
    }

    if (detailsRef.current) animateHazardDetails(detailsRef.current, state.clock.elapsedTime, dt);
  });

  return <group ref={containerRef} />;
}
