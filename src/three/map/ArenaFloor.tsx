// Declarative port of legacy Arena's platform lifecycle (design §4/§8
// p4-arena-map): the InstancedMesh top+side voxel floor, rebuilt only when
// the radius/world change meaningfully — mirrors Arena.setRadius's
// `Math.abs(radius - builtRadius) >= 0.75 || world !== builtWorld` gate so
// the (relatively expensive) InstancedMesh isn't rebuilt every frame while
// the arena shrinks smoothly. Built once on mount at the ctor defaults
// (CFG.ARENA_RADIUS/DEFAULT_ARENA_WORLD) exactly like `new Arena(scene)`
// builds before any snapshot exists, then re-synced against
// snapshotRef.current every frame — no React re-render, matching
// Environment.tsx's hazard-theme dedupe pattern.
import { useEffect, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { CFG } from "../../config.js";
import { snapshotRef } from "../../store/snapshotRef";
import { buildPlatform } from "../../voxel.js";
import { disposeGroup } from "./disposeGroup";

export function ArenaFloor() {
  const containerRef = useRef<THREE.Group>(null);
  const platformRef = useRef<THREE.Group | null>(null);
  const builtRadiusRef = useRef(-1);
  const builtWorldRef = useRef<string | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const platform: THREE.Group = buildPlatform(CFG.ARENA_RADIUS, CFG.DEFAULT_ARENA_WORLD);
    container.add(platform);
    platformRef.current = platform;
    builtRadiusRef.current = CFG.ARENA_RADIUS;
    builtWorldRef.current = CFG.DEFAULT_ARENA_WORLD;
    return () => {
      container.remove(platform);
      disposeGroup(platform);
      platformRef.current = null;
      builtRadiusRef.current = -1;
      builtWorldRef.current = null;
    };
  }, []);

  useFrame(() => {
    const container = containerRef.current;
    if (!container) return;
    const snap = snapshotRef.current;
    // Arena.setRadius clamps to ARENA_MIN_RADIUS; the ctor default (no
    // snapshot yet) skips the clamp since CFG.ARENA_RADIUS already exceeds it.
    const radius = Math.max(CFG.ARENA_MIN_RADIUS, snap?.arenaR ?? CFG.ARENA_RADIUS);
    const worldId = snap?.arenaWorld ?? CFG.DEFAULT_ARENA_WORLD;
    if (Math.abs(radius - builtRadiusRef.current) < 0.75 && worldId === builtWorldRef.current) return;

    if (platformRef.current) {
      container.remove(platformRef.current);
      disposeGroup(platformRef.current);
    }
    const platform: THREE.Group = buildPlatform(radius, worldId);
    container.add(platform);
    platformRef.current = platform;
    builtRadiusRef.current = radius;
    builtWorldRef.current = worldId;
  });

  return <group ref={containerRef} />;
}
