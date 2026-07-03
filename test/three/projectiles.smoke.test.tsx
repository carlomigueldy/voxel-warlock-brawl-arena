// @vitest-environment jsdom
// Scene-graph smoke test for BoltsLayer/BoltEntity/MeteorsLayer/ItemsLayer
// (#142) — mounts each layer against a fixed snapshot and asserts the parts
// of design §0/§3 this PR owns: entity COUNT tracks the live id set
// (useRosterStore.boltIds/meteorIds/itemIds), no MeshStandardMaterial
// anywhere (design §0 PALETTE CORRECTION), and bolts position DIRECTLY from
// the snapshot every frame (no interpolation — the projectiles parity trap).
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { create, type ReactThreeTestInstance } from "@react-three/test-renderer";
import * as THREE from "three";
import { BoltsLayer } from "../../src/three/entities/BoltsLayer";
import { MeteorsLayer } from "../../src/three/entities/MeteorsLayer";
import { ItemsLayer } from "../../src/three/entities/ItemsLayer";
import { useRosterStore, deriveRoster } from "../../src/store/useRosterStore";
import { pushSnapshot, resetSnapshotRef } from "../../src/store/snapshotRef";
import type { Snapshot } from "../../src/types";

// See scene.smoke.test.tsx's file header for why this is required when
// talking to the R3F reconciler directly via @react-three/test-renderer.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type TestRenderer = Awaited<ReturnType<typeof create>>;

function makeSnap(overrides: Partial<Snapshot> = {}): Snapshot {
  return {
    t: 1, phase: "playing", round: 1, timer: 0, playTime: 0, arenaR: 20,
    arenaWorld: "circle", landSize: "medium", enabledObstacles: {}, winner: null,
    matchWinner: null, players: [], bolts: [], meteors: [], runes: [], items: [],
    mobs: [], spellSlotsEnabled: true, events: [], mapV: 0,
    ...overrides,
  } as Snapshot;
}

// ReactThreeTestInstance's findAll only ever walks Object3D `.children`
// (design of @react-three/test-renderer's virtual-instance wrapper for
// <primitive>-mounted subtrees — see createVirtualInstance) — materials are
// a Mesh *property*, never a scene-graph child, so they're unreachable via
// findAll/findAllByType. Traverse the live THREE.Scene this test-renderer
// wraps directly instead.
function assertNoStandardMaterial(scene: ReactThreeTestInstance): void {
  const root = scene.instance as unknown as THREE.Object3D;
  const materials: THREE.Material[] = [];
  root.traverse((obj) => {
    const mat = (obj as THREE.Mesh).material;
    if (!mat) return;
    materials.push(...(Array.isArray(mat) ? mat : [mat]));
  });
  expect(materials.length).toBeGreaterThan(0);
  for (const m of materials) {
    expect(m).not.toBeInstanceOf(THREE.MeshStandardMaterial);
  }
}

describe("BoltsLayer/MeteorsLayer/ItemsLayer scene-graph smoke (#142)", () => {
  let renderer: TestRenderer | null = null;

  beforeEach(() => {
    useRosterStore.getState().reset();
    resetSnapshotRef();
  });

  afterEach(async () => {
    await renderer?.unmount();
    renderer = null;
    useRosterStore.getState().reset();
    resetSnapshotRef();
  });

  test("BoltsLayer mounts one entity per live bolt id, all 8 kinds, Lambert/Basic only", async () => {
    const kinds = ["fireball", "lightning", "boomerang", "homing", "fireSpray", "bouncer", "splitter", "meteor"];
    const snap = makeSnap({
      bolts: kinds.map((k, i) => ({
        id: i + 1, o: "p1", x: i, z: -i, y: 1.1, c: 0xffffff, k,
      })),
    });
    pushSnapshot(snap);
    useRosterStore.getState().sync(deriveRoster(snap, new Map()));
    expect(useRosterStore.getState().boltIds).toHaveLength(kinds.length);

    renderer = await create(<BoltsLayer />);
    await renderer.advanceFrames(1, 1 / 60);

    // One top-level Group per bolt (BoltEntity's <primitive object={group}/>).
    expect(renderer.scene.children).toHaveLength(kinds.length);
    assertNoStandardMaterial(renderer.scene);
  });

  test("BoltsLayer positions bolts DIRECT from the snapshot every frame — no interpolation", async () => {
    const snap = makeSnap({
      bolts: [{ id: 1, o: "p1", x: 5, z: -3, y: 1.1, c: 0xff5a1e, k: "fireball" }],
    });
    pushSnapshot(snap);
    useRosterStore.getState().sync(deriveRoster(snap, new Map()));

    renderer = await create(<BoltsLayer />);
    // A single frame is enough: an eased/interpolated entity would still sit
    // near its seed (0,0,0) after one frame, but a direct-assignment entity
    // snaps to the wire position immediately.
    await renderer.advanceFrames(1, 1 / 60);

    const [bolt] = renderer.scene.children;
    const pos = (bolt.instance as THREE.Object3D).position;
    expect(pos.x).toBe(5);
    expect(pos.z).toBe(-3);
    expect(pos.y).toBe(1.1);
  });

  test("BoltsLayer defaults y to PLATFORM_TOP+1.1 when the snapshot omits it", async () => {
    const snap = makeSnap({
      bolts: [{ id: 1, o: "p1", x: 0, z: 0, y: undefined as unknown as number, c: 0xffffff, k: "fireball" }],
    });
    pushSnapshot(snap);
    useRosterStore.getState().sync(deriveRoster(snap, new Map()));

    renderer = await create(<BoltsLayer />);
    await renderer.advanceFrames(1, 1 / 60);

    const [bolt] = renderer.scene.children;
    expect((bolt.instance as THREE.Object3D).position.y).toBe(1.1);
  });

  test("MeteorsLayer mounts one entity per live meteor id", async () => {
    const snap = makeSnap({
      meteors: [
        { id: 10, x: 2, z: 2, t: 1.5, fall: 3, r: 4 },
        { id: 11, x: -6, z: 1, t: 0.4, fall: 3, r: 4 },
      ],
    });
    pushSnapshot(snap);
    useRosterStore.getState().sync(deriveRoster(snap, new Map()));

    renderer = await create(<MeteorsLayer />);
    await renderer.advanceFrames(1, 1 / 60);

    expect(renderer.scene.children).toHaveLength(2);
    assertNoStandardMaterial(renderer.scene);
  });

  test("ItemsLayer mounts one entity per live item id", async () => {
    const snap = makeSnap({
      items: [
        { id: 20, itemKey: "k1", kind: "buff", shape: "orb", c: 0xffffff, rarity: "common", name: "Test Orb", x: 1, z: 1 },
        { id: 21, itemKey: "k2", kind: "buff", shape: "crown", c: 0xffcc22, rarity: "legendary", name: "Test Crown", x: 4, z: -2 },
      ],
    });
    pushSnapshot(snap);
    useRosterStore.getState().sync(deriveRoster(snap, new Map()));

    renderer = await create(<ItemsLayer />);
    await renderer.advanceFrames(1, 1 / 60);

    expect(renderer.scene.children).toHaveLength(2);
    assertNoStandardMaterial(renderer.scene);
  });

  test("entities unmount (pool release / dispose) when their id drops out of the roster", async () => {
    const snap = makeSnap({
      bolts: [{ id: 1, o: "p1", x: 0, z: 0, y: 1.1, c: 0xffffff, k: "fireball" }],
    });
    pushSnapshot(snap);
    useRosterStore.getState().sync(deriveRoster(snap, new Map()));

    renderer = await create(<BoltsLayer />);
    await renderer.advanceFrames(1, 1 / 60);
    expect(renderer.scene.children).toHaveLength(1);

    const nextSnap = makeSnap({ t: 2, bolts: [] });
    pushSnapshot(nextSnap);
    useRosterStore.getState().sync(deriveRoster(nextSnap, new Map()));
    await renderer.update(<BoltsLayer />);

    expect(renderer.scene.children).toHaveLength(0);
  });
});
