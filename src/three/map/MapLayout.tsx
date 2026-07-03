// Declarative port of legacy renderer.js's map-layout lifecycle (design
// §4/§8 p4-arena-map): rebuilds the plateau/ramp/obstacle-prop meshes
// whenever snapshot.mapV increments or mapLayout is explicitly cleared
// (_rebuildMapMeshes), and hides features the shrinking arena has dropped
// over the hazard every frame (_cullMapMeshes). Every feature's footprint
// CENTRE (cx, cz) is tracked alongside its built group — same bookkeeping as
// legacy's `this._mapMeshes` array of `{ g, cx, cz }` entries — so culling
// never needs to recompute geometry, only toggle `.visible`.
import { useEffect, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { CFG, isOnArenaWorld } from "../../config.js";
import { snapshotRef } from "../../store/snapshotRef";
import { buildPlateau, buildRamp } from "../../voxel.js";
import { PROP_BUILDERS } from "../../props.js";
import type { MapLayout as MapLayoutData } from "../../types";
import { disposeGroup } from "./disposeGroup";

interface MapMeshEntry {
  g: THREE.Group;
  cx: number;
  cz: number;
}

export function MapLayout() {
  const containerRef = useRef<THREE.Group>(null);
  const meshesRef = useRef<MapMeshEntry[]>([]);
  const mapVersionRef = useRef(-1);

  // Dispose the current map layout meshes and rebuild them from the new
  // layout — mirrors renderer.js's _rebuildMapMeshes(layout, worldId).
  const rebuild = (layout: MapLayoutData | null, worldId: string): void => {
    const container = containerRef.current;
    if (!container) return;
    for (const e of meshesRef.current) {
      container.remove(e.g);
      disposeGroup(e.g);
    }
    meshesRef.current = [];
    if (!layout) return;

    // Each entry stores its footprint CENTRE (cx,cz) so culling can hide
    // features once the shrinking arena no longer covers them.
    // Plateaus and their ramps cull together by the plateau centre.
    for (const pl of layout.plateaus) {
      const pg: THREE.Group = buildPlateau(pl, worldId);
      container.add(pg);
      meshesRef.current.push({ g: pg, cx: pl.x, cz: pl.z });
      for (const ramp of pl.ramps) {
        const rg: THREE.Group = buildRamp(ramp, pl.height, worldId);
        container.add(rg);
        meshesRef.current.push({ g: rg, cx: pl.x, cz: pl.z });
      }
    }

    // Obstacle props (trees, stones, columns, etc.).
    for (const ob of layout.obstacles) {
      const builder = PROP_BUILDERS[ob.type];
      if (!builder) continue;
      const og = builder(ob);
      og.position.set(ob.x, CFG.PLATFORM_TOP, ob.z);
      og.rotation.y = ob.rot;
      container.add(og);
      meshesRef.current.push({ g: og, cx: ob.x, cz: ob.z });
    }
  };

  useEffect(() => {
    return () => {
      const container = containerRef.current;
      for (const e of meshesRef.current) {
        container?.remove(e.g);
        disposeGroup(e.g);
      }
      meshesRef.current = [];
      mapVersionRef.current = -1;
    };
  }, []);

  useFrame(() => {
    const snap = snapshotRef.current;
    if (!snap) return;
    const worldId = snap.arenaWorld ?? CFG.DEFAULT_ARENA_WORLD;

    // Rebuild whenever the host generates a new layout (each round start).
    // mapV is an incrementing integer; undefined during the lobby (treated
    // as -1 → clear any existing meshes). Also clear when mapLayout is
    // explicitly null (returnToLobby / round reset) even if mapV hasn't
    // changed, so stale plateau/obstacle meshes don't linger in the lobby.
    // Omitted mapLayout (undefined) means "no change this frame".
    const snapMapV = snap.mapV ?? -1;
    const layoutCleared = snap.mapLayout === null && meshesRef.current.length > 0;
    if (snapMapV !== mapVersionRef.current || layoutCleared) {
      mapVersionRef.current = snapMapV;
      rebuild(snap.mapLayout ?? null, worldId);
    }

    // Hide spread-out features the shrinking arena has dropped over the hazard.
    const radius = snap.arenaR ?? CFG.ARENA_RADIUS;
    for (const e of meshesRef.current) {
      e.g.visible = isOnArenaWorld(worldId, radius, e.cx, e.cz);
    }
  });

  return <group ref={containerRef} />;
}
