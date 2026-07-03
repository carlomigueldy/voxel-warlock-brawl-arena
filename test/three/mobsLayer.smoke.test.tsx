// @vitest-environment jsdom
// Scene-graph smoke test for MobsLayer/MobEntity (design §7 / issue #141).
// Uses "minion" mobs deliberately — minion has no MOB_MODEL_ASSETS entry
// (design/legacy: only the 4 big mobs get rigged GLB bodies), so
// buildMobByType() takes the procedural-fallback branch synchronously with
// no GLTFLoader/network I/O involved, keeping this test deterministic.
// mobModel.test.mjs covers the GLB-loading path (self-heal scale/position,
// clip-name resolution, attack LoopOnce+clampWhenFinished) in isolation.
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { act, create } from "@react-three/test-renderer";
import * as THREE from "three";
import { CFG } from "../../src/config";
import { MobsLayer } from "../../src/three/entities/MobsLayer";
import { useRosterStore } from "../../src/store/useRosterStore";
import { pushSnapshot, resetSnapshotRef } from "../../src/store/snapshotRef";
import type { MobSnap, Snapshot } from "../../src/types";

// See scene.smoke.test.tsx for why this flag is needed when talking to the
// R3F reconciler directly via @react-three/test-renderer instead of going
// through @testing-library/react's render()/act().
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type TestRenderer = Awaited<ReturnType<typeof create>>;

const CAMERA_PROPS = { fov: 55, near: 0.1, far: 300, position: [0, 28, 24] as [number, number, number] };

function makeMob(overrides: Partial<MobSnap> & { id: string }): MobSnap {
  return {
    type: "minion",
    x: 2,
    z: -3,
    y: 0,
    a: 0,
    hp: 100,
    max: 100,
    color: 0x999999,
    f: 0,
    dummy: 0,
    ent: 0,
    ch: null,
    ...overrides,
  };
}

function makeSnapshot(mobs: MobSnap[], t = 1): Snapshot {
  return {
    t,
    phase: "playing",
    round: 1,
    timer: 0,
    playTime: 0,
    arenaR: CFG.ARENA_RADIUS,
    arenaWorld: CFG.DEFAULT_ARENA_WORLD,
    landSize: CFG.DEFAULT_ARENA_LAND_SIZE,
    enabledObstacles: {},
    winner: null,
    matchWinner: null,
    players: [],
    bolts: [],
    meteors: [],
    runes: [],
    items: [],
    mobs,
    spellSlotsEnabled: true,
    events: [],
    mapV: 0,
  };
}

function syncRoster(snap: Snapshot): void {
  pushSnapshot(snap);
  useRosterStore.getState().sync({
    playerIds: [],
    boltIds: [],
    mobIds: snap.mobs.map((m) => m.id),
    meteorIds: [],
    itemIds: [],
    meta: {},
  });
}

describe("MobsLayer/MobEntity scene-graph smoke (P4 mobs, #141)", () => {
  let renderer: TestRenderer | null = null;

  beforeEach(() => {
    resetSnapshotRef();
    useRosterStore.getState().reset();
  });

  afterEach(async () => {
    await renderer?.unmount();
    renderer = null;
    resetSnapshotRef();
    useRosterStore.getState().reset();
  });

  test("mounts one top-level group per roster mob id (structural spawn)", async () => {
    syncRoster(makeSnapshot([makeMob({ id: "m1" }), makeMob({ id: "m2", type: "minion" })]));
    renderer = await create(<MobsLayer />, { camera: CAMERA_PROPS });
    await renderer.advanceFrames(2, 1 / 30);

    expect(renderer.scene.children).toHaveLength(2);
    for (const child of renderer.scene.children) {
      expect(child.type).toBe("Group");
    }
  });

  test("unmounts a mob's group when it leaves the roster (structural despawn)", async () => {
    syncRoster(makeSnapshot([makeMob({ id: "m1" }), makeMob({ id: "m2" })]));
    renderer = await create(<MobsLayer />, { camera: CAMERA_PROPS });
    await renderer.advanceFrames(1, 1 / 30);
    expect(renderer.scene.children).toHaveLength(2);

    act(() => syncRoster(makeSnapshot([makeMob({ id: "m1" })], 2)));
    await renderer.update(<MobsLayer />);
    await renderer.advanceFrames(1, 1 / 30);
    expect(renderer.scene.children).toHaveLength(1);
  });

  test("procedural fallback body never uses MeshStandardMaterial (design §0 PALETTE CORRECTION)", async () => {
    syncRoster(makeSnapshot([makeMob({ id: "m1" }), makeMob({ id: "m2" })]));
    renderer = await create(<MobsLayer />, { camera: CAMERA_PROPS });
    await renderer.advanceFrames(3, 1 / 30);

    // The mob body is a plain THREE.Group built by voxel.js's procedural
    // builders and mounted imperatively via <primitive> (design §4) — its
    // meshes/materials were never declared as JSX children, so the R3F
    // reconciler's fiber tree (what findAll/findByType walk) never tracks
    // them as their own nodes. Walk the real Object3D subtree instead and
    // read each Mesh's `.material` directly.
    const meshes: THREE.Mesh[] = [];
    for (const child of renderer.scene.children) {
      (child.instance as THREE.Object3D).traverse((o) => {
        if (o instanceof THREE.Mesh) meshes.push(o);
      });
    }
    expect(meshes.length).toBeGreaterThan(0);
    for (const mesh of meshes) {
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const mat of mats) {
        expect(mat).not.toBeInstanceOf(THREE.MeshStandardMaterial);
      }
    }
  });

  test("interpolates toward the snapshot position and applies the entrance rise/scale with no locomotion during it (design §0 mob entrance)", async () => {
    syncRoster(makeSnapshot([makeMob({ id: "m1", x: 5, z: 5, y: 0, ent: CFG.MOB_ENTRANCE })]));
    renderer = await create(<MobsLayer />, { camera: CAMERA_PROPS });
    await renderer.advanceFrames(1, 1 / 30);

    const entering = renderer.scene.children[0].instance as THREE.Group;
    // Entrance just started (ent == MOB_ENTRANCE => progress ~= 0): mob is
    // still deep below the floor and scaled to the progress floor.
    expect(entering.position.y).toBeLessThan(-2.5);
    expect(entering.scale.x).toBeCloseTo(0.05, 2);

    // Entrance window closes (ent == 0): full scale, no vertical offset, and
    // the group has visibly moved toward the target x/z.
    syncRoster(makeSnapshot([makeMob({ id: "m1", x: 5, z: 5, y: 0, ent: 0 })], 2));
    await renderer.advanceFrames(30, 1 / 30);
    const settled = renderer.scene.children[0].instance as THREE.Group;
    expect(settled.scale.x).toBeCloseTo(1, 5);
    expect(settled.position.x).toBeGreaterThan(0);
    expect(settled.position.z).toBeGreaterThan(0);
  });

  test("mob body group carries a health bar whose scale.x tracks hp/max", async () => {
    syncRoster(makeSnapshot([makeMob({ id: "m1", hp: 30, max: 100 })]));
    renderer = await create(<MobsLayer />, { camera: CAMERA_PROPS });
    // @react-three/test-renderer's advanceFrames(frames, delta) runs each
    // subscriber `frames` times consecutively rather than interleaving all
    // subscribers per simulated frame — so a single multi-frame call can't
    // observe a value MobEntity's useFrame writes and MobBody's useFrame
    // reads within the "same" frame. Two separate single-frame advances
    // guarantee every subscriber has run at least once by the time the
    // second call starts, matching real rAF frame-major ordering.
    await renderer.advanceFrames(1, 1 / 30);
    await renderer.advanceFrames(1, 1 / 30);

    const entityGroup = renderer.scene.children[0].instance as THREE.Group;
    // The health bar mesh lives on the mob body group's userData
    // (mobModel.ts / voxel.js convention), one level below MobEntity's own
    // wrapping <group> — walk the subtree to find it rather than assuming a
    // fixed nesting depth.
    let bar: THREE.Mesh | null = null;
    entityGroup.traverse((o) => {
      if (o.userData && (o.userData as { healthBar?: THREE.Mesh }).healthBar) {
        bar = (o.userData as { healthBar: THREE.Mesh }).healthBar;
      }
    });
    expect(bar).toBeTruthy();
    expect((bar as unknown as THREE.Mesh).scale.x).toBeCloseTo(0.3, 5);
  });

  test("registers a triggerAttack callback for every mounted mob (entityRegistry wiring)", async () => {
    const { mob: registryMob } = await import("../../src/three/entities/entityRegistry");
    syncRoster(makeSnapshot([makeMob({ id: "reg-mob-1" })]));
    renderer = await create(<MobsLayer />, { camera: CAMERA_PROPS });
    await renderer.advanceFrames(1, 1 / 30);

    const entry = registryMob("reg-mob-1");
    expect(entry).toBeTruthy();
    expect(typeof entry?.triggerAttack).toBe("function");
    expect(() => entry?.triggerAttack()).not.toThrow();
  });
});
