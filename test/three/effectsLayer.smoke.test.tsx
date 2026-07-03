// @vitest-environment jsdom
// Scene-graph smoke test for EffectsLayer (design §5 / issue #147) — mounts
// the REAL layer (not a mock ctx, unlike eventToEffects.test.ts) so
// makeEventFxCtx's wiring to entityRegistry/snapshotRef/getAudio is
// exercised end to end: pushing a snapshot with a "hit" event must produce a
// live transient effect under the fxRoot group and add screen shake, the
// per-frame update/dispose sweep must retire it once its life elapses, and
// the same snapshot.t must never be drained twice (consumeEvents' dedupe).
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { create } from "@react-three/test-renderer";
import * as THREE from "three";
import { CFG } from "../../src/config";
import { snapshotRef, pushSnapshot, resetSnapshotRef } from "../../src/store/snapshotRef";
import { EffectsLayer } from "../../src/three/vfx/EffectsLayer";
import type { Snapshot, GameEvent } from "../../src/types";

// See scene.smoke.test.tsx for why this flag is needed when talking to the
// R3F reconciler directly via @react-three/test-renderer instead of going
// through @testing-library/react's render()/act().
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type TestRenderer = Awaited<ReturnType<typeof create>>;

const CAMERA_PROPS = { fov: 55, near: 0.1, far: 300, position: [0, 28, 24] as [number, number, number] };

function makeSnapshot(events: GameEvent[], t = 1): Snapshot {
  return {
    t, phase: "playing", round: 1, timer: 0, playTime: 0, arenaR: CFG.ARENA_RADIUS,
    arenaWorld: CFG.DEFAULT_ARENA_WORLD, landSize: "medium", enabledObstacles: {},
    winner: null, matchWinner: null, players: [], bolts: [], meteors: [], runes: [], items: [],
    mobs: [], spellSlotsEnabled: true, events, mapV: -1,
  };
}

describe("<EffectsLayer> scene-graph smoke (design §5, issue #147)", () => {
  let renderer: TestRenderer | null = null;

  beforeEach(() => {
    resetSnapshotRef();
  });

  afterEach(async () => {
    await renderer?.unmount();
    renderer = null;
    resetSnapshotRef();
  });

  test("mounts an empty fxRoot group with no events pending", async () => {
    renderer = await create(<EffectsLayer />, { camera: CAMERA_PROPS });
    await renderer.advanceFrames(2, 1 / 30);

    expect(renderer.scene.children).toHaveLength(1);
    const fxRoot = renderer.scene.children[0].instance as THREE.Group;
    expect(fxRoot.children).toHaveLength(0);
  });

  test('a "hit" event spawns a live transient burst under fxRoot and adds screen shake', async () => {
    pushSnapshot(makeSnapshot([{ type: "hit", x: 1, z: 2, victim: "p2", by: "mob1" }], 1));
    renderer = await create(<EffectsLayer />, { camera: CAMERA_PROPS });
    expect(snapshotRef.shake).toBe(0);

    await renderer.advanceFrames(1, 1 / 30);

    const fxRoot = renderer.scene.children[0].instance as THREE.Group;
    expect(fxRoot.children.length).toBeGreaterThan(0);
    // hit: shake = min(0.6, 0 + 0.22) = 0.22 (design §0 cap table).
    expect(snapshotRef.shake).toBeCloseTo(0.22, 5);
  });

  test("the same snapshot.t is never drained twice — advancing more frames on the same snapshot adds no more effects", async () => {
    pushSnapshot(makeSnapshot([{ type: "hit", x: 0, z: 0, victim: "p2", by: "mob1" }], 5));
    renderer = await create(<EffectsLayer />, { camera: CAMERA_PROPS });
    await renderer.advanceFrames(1, 1 / 30);

    const fxRoot = renderer.scene.children[0].instance as THREE.Group;
    const countAfterFirstFrame = fxRoot.children.length;
    expect(countAfterFirstFrame).toBeGreaterThan(0);

    await renderer.advanceFrames(5, 1 / 30);
    // Burst particles are short-lived (buildBurst default life=0.5s), so the
    // count mayShrink as they finish, but it must never grow past the
    // single hit's contribution — re-draining the same events would add a
    // second burst group on top.
    expect(fxRoot.children.length).toBeLessThanOrEqual(countAfterFirstFrame);
  });

  test("a transient effect is removed from fxRoot once its update() flips userData.done", async () => {
    pushSnapshot(makeSnapshot([{ type: "projectileClash", x: 0, z: 0 }], 1));
    renderer = await create(<EffectsLayer />, { camera: CAMERA_PROPS });
    await renderer.advanceFrames(1, 1 / 30);

    const fxRoot = renderer.scene.children[0].instance as THREE.Group;
    expect(fxRoot.children.length).toBeGreaterThan(0);

    // projectileClash's ringPulse has a fixed 0.6s life (src/three/fx/builders.ts) —
    // advance well past it in large steps so it's guaranteed to flip done and
    // get swept, even though burst particles from the same event may outlive it.
    for (let i = 0; i < 30; i++) await renderer.advanceFrames(1, 0.1);

    const stillAlive = fxRoot.children.filter((c) => (c.instance as THREE.Object3D).userData.done === false);
    expect(stillAlive.length).toBe(0);
  });

  test('a "death" event for an id absent from the roster still spawns a transient, falling back to origin {0,0} (#182 F7: makeEventFxCtx posForId/colorForId guard fallbacks)', async () => {
    // No syncRoster()/registry entry for "ghost" — entityPlayerPos("ghost")
    // and snapshotRef.meta.get("ghost") both miss, exercising
    // EffectsLayer.tsx's makeEventFxCtx fallbacks: posForId's
    // `?? { x: 0, z: 0 }` and colorForId's `: 0xffffff` (their unit coverage
    // was dropped when eventToEffects.ts's ctx was split out of a single
    // mock-everything test into this real-ctx smoke suite).
    pushSnapshot(makeSnapshot([{ type: "death", id: "ghost" }], 1));
    renderer = await create(<EffectsLayer />, { camera: CAMERA_PROPS });
    await renderer.advanceFrames(1, 1 / 30);

    const fxRoot = renderer.scene.children[0].instance as THREE.Group;
    expect(fxRoot.children.length).toBeGreaterThan(0);
    // fxRoot's children are added imperatively via ctx.addEffect (fxRoot.add,
    // not JSX) — real THREE.Object3D instances, unlike renderer.scene.children
    // (R3F test-renderer fiber nodes with their own `.instance` wrapper).
    for (const obj of fxRoot.children) {
      expect(obj.position.x).toBeCloseTo(0, 5);
      expect(obj.position.z).toBeCloseTo(0, 5);
    }
  });

  test('a new snapshot with a fresh events array (later t) drains again', async () => {
    pushSnapshot(makeSnapshot([{ type: "hit", x: 0, z: 0, victim: "p2", by: "mob1" }], 1));
    renderer = await create(<EffectsLayer />, { camera: CAMERA_PROPS });
    await renderer.advanceFrames(1, 1 / 30);
    expect(snapshotRef.shake).toBeCloseTo(0.22, 5);

    pushSnapshot(makeSnapshot([{ type: "hit", x: 0, z: 0, victim: "p2", by: "mob1" }], 2));
    await renderer.advanceFrames(1, 1 / 30);
    // Second hit stacks onto the same shake channel, still capped at 0.6.
    expect(snapshotRef.shake).toBeCloseTo(0.44, 5);
  });
});
