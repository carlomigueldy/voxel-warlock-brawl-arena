// @vitest-environment jsdom
// Scene-graph smoke test for the p4-arena-map layer (#139) — ArenaFloor,
// Hazard, HazardDetails, MapLayout. These components add/remove real
// THREE.Object3D content imperatively (design §4 leaf-builder bridging:
// buildPlatform/buildHazard/buildHazardDetails/buildPlateau/buildRamp/
// PROP_BUILDERS, called by useEffect/useFrame, not JSX), so — unlike
// test/three/scene.smoke.test.tsx's findAllByType helper, which only walks
// the React-managed fiber tree — every assertion here traverses the live
// THREE.Scene graph directly via `.traverse()`/`.instance.children` reads.
//
// Covers design §0/§8 p4-arena-map acceptance: ARENA_RADIUS 18/PLATFORM_TOP
// 0/LAVA_Y -4 constants, all 5 arena worlds, InstancedMesh floor,
// plateau/ramp/obstacle rendering, and shrink-cull (isOnArenaWorld).
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { create, type Renderer } from "@react-three/test-renderer";
import * as THREE from "three";
import { CFG } from "../../src/config";
import { pushSnapshot, resetSnapshotRef } from "../../src/store/snapshotRef";
import { ArenaFloor } from "../../src/three/map/ArenaFloor";
import { Hazard } from "../../src/three/map/Hazard";
import { HazardDetails } from "../../src/three/map/HazardDetails";
import { MapLayout } from "../../src/three/map/MapLayout";
import type { MapLayout as MapLayoutData, Snapshot } from "../../src/types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function makeSnap(overrides: Partial<Snapshot> = {}): Snapshot {
  return {
    t: 1, phase: "playing", round: 1, timer: 0, playTime: 0, arenaR: CFG.ARENA_RADIUS,
    arenaWorld: CFG.DEFAULT_ARENA_WORLD, landSize: "medium", enabledObstacles: {}, winner: null,
    matchWinner: null, players: [], bolts: [], meteors: [], runes: [], items: [],
    mobs: [], spellSlotsEnabled: true, events: [], mapV: 0,
    ...overrides,
  } as Snapshot;
}

function liveMeshes(root: THREE.Object3D): THREE.Mesh[] {
  const out: THREE.Mesh[] = [];
  root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) out.push(o as THREE.Mesh);
  });
  return out;
}

function liveInstancedMeshes(root: THREE.Object3D): THREE.InstancedMesh[] {
  const out: THREE.InstancedMesh[] = [];
  root.traverse((o) => {
    if ((o as THREE.InstancedMesh).isInstancedMesh) out.push(o as THREE.InstancedMesh);
  });
  return out;
}

function materialsOf(meshes: (THREE.Mesh | THREE.InstancedMesh)[]): THREE.Material[] {
  const mats: THREE.Material[] = [];
  for (const m of meshes) {
    const mat = m.material;
    if (Array.isArray(mat)) mats.push(...mat);
    else if (mat) mats.push(mat);
  }
  return mats;
}

describe("p4-arena-map scene-graph smoke (#139)", () => {
  let renderer: Renderer | null = null;

  beforeEach(() => {
    resetSnapshotRef();
  });

  afterEach(async () => {
    await renderer?.unmount();
    renderer = null;
    resetSnapshotRef();
  });

  test("ArenaFloor builds an InstancedMesh top+side platform at CFG.ARENA_RADIUS/DEFAULT_ARENA_WORLD before any snapshot arrives", async () => {
    renderer = await create(<ArenaFloor />);
    const scene = renderer.scene.instance as unknown as THREE.Scene;
    const inst = liveInstancedMeshes(scene);
    // buildPlatform emits exactly 2 InstancedMesh (top cap + side wall).
    expect(inst).toHaveLength(2);
    for (const m of inst) {
      expect(m.material).toBeInstanceOf(THREE.MeshLambertMaterial);
      expect((m.material as THREE.MeshLambertMaterial).flatShading).toBe(true);
      expect(m.material).not.toBeInstanceOf(THREE.MeshStandardMaterial);
    }
    // The built platform group carries buildPlatform's own bookkeeping
    // (voxel.js: g.userData.radius/world) — confirms the ctor-default build
    // ran with CFG.ARENA_RADIUS/DEFAULT_ARENA_WORLD, not some other value.
    let built: THREE.Object3D | null = null;
    scene.traverse((o) => { if (o.userData?.radius !== undefined) built = o; });
    expect(built).toBeTruthy();
    expect((built as unknown as THREE.Object3D).userData.radius).toBe(CFG.ARENA_RADIUS);
    expect((built as unknown as THREE.Object3D).userData.world).toBe(CFG.DEFAULT_ARENA_WORLD);
  });

  test("ArenaFloor rebuilds with fewer instances when the snapshot arena radius shrinks past the 0.75 threshold (shrink parity)", async () => {
    renderer = await create(<ArenaFloor />);
    const scene = renderer.scene.instance as unknown as THREE.Scene;
    const before = liveInstancedMeshes(scene)[0].count;

    pushSnapshot(makeSnap({ t: 2, arenaR: CFG.ARENA_RADIUS - 6 }));
    await renderer.advanceFrames(1, 0.016);

    const afterInst = liveInstancedMeshes(scene);
    expect(afterInst).toHaveLength(2); // still exactly one top+side pair
    expect(afterInst[0].count).toBeLessThan(before);
    let built: THREE.Object3D | null = null;
    scene.traverse((o) => { if (o.userData?.radius !== undefined) built = o; });
    expect((built as unknown as THREE.Object3D).userData.radius).toBe(CFG.ARENA_RADIUS - 6);
  });

  test("ArenaFloor renders all 5 arena worlds with their own top/side palette", async () => {
    for (const world of CFG.ARENA_WORLDS) {
      renderer = await create(<ArenaFloor />);
      const scene = renderer.scene.instance as unknown as THREE.Scene;
      pushSnapshot(makeSnap({ t: 3, arenaWorld: world.id }));
      await renderer.advanceFrames(1, 0.016);

      const inst = liveInstancedMeshes(scene);
      expect(inst).toHaveLength(2);
      const colors = inst.map((m) => (m.material as THREE.MeshLambertMaterial).color.getHex()).sort();
      expect(colors).toEqual([world.top, world.side].sort());

      await renderer.unmount();
      renderer = null;
      resetSnapshotRef();
    }
  });

  test("Hazard builds the themed hazard surface (Basic for liquid styles, Lambert-flat for jagged rocks) and rebuilds on world change", async () => {
    renderer = await create(<Hazard />);
    const scene = renderer.scene.instance as unknown as THREE.Scene;
    // Default world "circle" -> lava hazard, not jagged -> MeshBasicMaterial.
    let meshes = liveMeshes(scene);
    expect(meshes).toHaveLength(1);
    expect(meshes[0].position.y).toBe(CFG.LAVA_Y);
    expect(meshes[0].material).toBeInstanceOf(THREE.MeshBasicMaterial);

    // "cross" world -> rocks hazard, jagged: true -> MeshLambertMaterial flat.
    pushSnapshot(makeSnap({ t: 2, arenaWorld: "cross" }));
    await renderer.advanceFrames(1, 0.016);
    meshes = liveMeshes(scene);
    expect(meshes).toHaveLength(1); // old mesh disposed+removed, not stacked
    expect(meshes[0].material).toBeInstanceOf(THREE.MeshLambertMaterial);
    expect((meshes[0].material as THREE.MeshLambertMaterial).flatShading).toBe(true);
    for (const mat of materialsOf(meshes)) expect(mat).not.toBeInstanceOf(THREE.MeshStandardMaterial);
  });

  test("HazardDetails builds the per-hazard ambient prop count and rebuilds it on world change", async () => {
    renderer = await create(<HazardDetails />);
    const scene = renderer.scene.instance as unknown as THREE.Scene;
    // Default world "circle" -> lava hazard -> detail.count === 70 embers.
    expect(liveMeshes(scene)).toHaveLength(CFG.ARENA_HAZARDS.lava.detail.count);

    pushSnapshot(makeSnap({ t: 2, arenaWorld: "cross" })); // rocks -> 40 dust motes
    await renderer.advanceFrames(1, 0.016);
    expect(liveMeshes(scene)).toHaveLength(CFG.ARENA_HAZARDS.rocks.detail.count);
    for (const mat of materialsOf(liveMeshes(scene))) expect(mat).not.toBeInstanceOf(THREE.MeshStandardMaterial);
  });

  test("MapLayout builds plateau+ramp+obstacle meshes from snapshot.mapLayout and culls them as the arena shrinks past their footprint", async () => {
    const layout: MapLayoutData = {
      seed: 7,
      worldId: "circle",
      plateaus: [{
        x: 0, z: 0, w: 6, d: 6, height: 3,
        ramps: [{ side: 0, x: 3.5, z: 0, w: 3, d: 4 }],
      }],
      obstacles: [{ id: 1, type: "tree", x: 15, z: 0, r: 1, height: 3, rot: 0 }],
    };

    renderer = await create(<MapLayout />);
    const scene = renderer.scene.instance as unknown as THREE.Scene;

    // No layout yet -> nothing built.
    expect(scene.children.reduce((n, g) => n + g.children.length, 0)).toBe(0);

    pushSnapshot(makeSnap({ t: 2, mapV: 1, mapLayout: layout }));
    await renderer.advanceFrames(1, 0.016);

    // 1 plateau group + 1 ramp group + 1 obstacle group.
    const built = scene.children.flatMap((g) => g.children);
    expect(built).toHaveLength(3);
    for (const mat of materialsOf(liveMeshes(scene))) expect(mat).not.toBeInstanceOf(THREE.MeshStandardMaterial);

    // Shrink the arena below the obstacle's footprint (circle world: d<=r) —
    // the plateau/ramp at the origin stay covered, only the far obstacle culls.
    pushSnapshot(makeSnap({ t: 3, mapV: 1, mapLayout: layout, arenaR: 10 }));
    await renderer.advanceFrames(1, 0.016);
    const stillBuilt = scene.children.flatMap((g) => g.children);
    expect(stillBuilt).toHaveLength(3); // culling hides, never disposes/rebuilds
    // MapLayout.tsx positions obstacle groups explicitly (og.position.set) —
    // plateau/ramp groups don't (buildPlateau/buildRamp offset their child
    // meshes' own positions, matching legacy renderer.js exactly), so the
    // obstacle group is the one identifiable by its own transform.
    const obstacleGroup = stillBuilt.find((g) => Math.abs(g.position.x - 15) < 1e-6);
    expect(obstacleGroup?.visible).toBe(false);
    // Everything else (the plateau + its ramp, both centred at the origin,
    // still well inside the shrunk radius-10 platform) stays visible.
    const others = stillBuilt.filter((g) => g !== obstacleGroup);
    expect(others).toHaveLength(2);
    for (const g of others) expect(g.visible).toBe(true);

    // mapLayout explicitly cleared (round reset) -> disposed, nothing left.
    pushSnapshot(makeSnap({ t: 4, mapV: 1, mapLayout: null, arenaR: 10 }));
    await renderer.advanceFrames(1, 0.016);
    expect(scene.children.flatMap((g) => g.children)).toHaveLength(0);
  });
});
