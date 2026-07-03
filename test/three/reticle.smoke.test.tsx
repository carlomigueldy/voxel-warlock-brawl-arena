// @vitest-environment jsdom
// Scene-graph smoke test for ReticleLayer (design §5 / issue #145). Fakes
// the local player's entityRegistry registration directly (registerPlayer)
// rather than mounting the whole <PlayersLayer>/GLB stack — ReticleLayer
// only reads playerPos()/snapshotRef.byId for the caster, so a bare
// registration is enough to exercise it deterministically with no
// canvas/GLTF stubbing required.
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { create } from "@react-three/test-renderer";
import * as THREE from "three";
import { CFG } from "../../src/config";
import { snapshotRef, pushSnapshot, setLocalId, resetSnapshotRef } from "../../src/store/snapshotRef";
import { registerPlayer, unregisterPlayer } from "../../src/three/entities/entityRegistry";
import { ReticleLayer } from "../../src/three/vfx/ReticleLayer";
import type { Snapshot, PlayerSnap } from "../../src/types";

// See test/three/scene.smoke.test.tsx for why this flag is needed when
// talking to the R3F reconciler directly via @react-three/test-renderer
// instead of going through @testing-library/react's render()/act().
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const CAMERA_PROPS = { fov: 55, near: 0.1, far: 300, position: [0, 28, 24] as [number, number, number] };
const LOCAL_ID = "local";

type TestRenderer = Awaited<ReturnType<typeof create>>;

function makePlayerSnap(id: string, overrides: Partial<PlayerSnap> = {}): PlayerSnap {
  return {
    id, x: 0, z: 0, y: 0, a: 0, c: 0, hp: 100, mhp: 100, al: true, sp: false, f: false,
    hz: 0, st: 0, s: 0, k: 0, d: 0, ww: 0, ru: 0, sh: 0, di: 0, gr: 0, lk: null, sl: 0, bu: 0,
    cu: 0, iv: 0, hs: 0, ty: 0, afk: 0, spk: 0, ca: 0, cds: {}, spells: [], spellSlots: [],
    items: [], draftPick: [], draftReady: false,
    ...overrides,
  };
}

function makeSnapshot(players: PlayerSnap[], t = 1): Snapshot {
  return {
    t, phase: "playing", round: 1, timer: 0, playTime: 0, arenaR: CFG.ARENA_RADIUS,
    arenaWorld: CFG.DEFAULT_ARENA_WORLD, landSize: "medium", enabledObstacles: {},
    winner: null, matchWinner: null, players, bolts: [], meteors: [], runes: [], items: [],
    mobs: [], spellSlotsEnabled: true, events: [], mapV: -1,
  };
}

describe("<ReticleLayer> scene-graph smoke (design §5, issue #145)", () => {
  let renderer: TestRenderer | null = null;

  beforeEach(() => {
    resetSnapshotRef();
    registerPlayer(LOCAL_ID, { triggerCast: () => {}, triggerReaction: () => {}, pos: { x: 0, z: 0 } });
    setLocalId(LOCAL_ID);
    pushSnapshot(makeSnapshot([makePlayerSnap(LOCAL_ID)]));
  });

  afterEach(async () => {
    await renderer?.unmount();
    renderer = null;
    unregisterPlayer(LOCAL_ID);
    resetSnapshotRef();
  });

  test("mounts a holder group and builds nothing while no spell is aimed", async () => {
    renderer = await create(<ReticleLayer />, { camera: CAMERA_PROPS });
    await renderer.advanceFrames(2, 1 / 30);

    expect(renderer.scene.children).toHaveLength(1);
    const holder = renderer.scene.children[0].instance as THREE.Group;
    expect(holder.children).toHaveLength(0);
  });

  test("builds and shows a reticle for the active aim spell (DIRECTIONAL_PROJECTILE)", async () => {
    snapshotRef.aim.spellId = "fireball";
    renderer = await create(<ReticleLayer />, { camera: CAMERA_PROPS });
    await renderer.advanceFrames(2, 1 / 30);

    const holder = renderer.scene.children[0].instance as THREE.Group;
    expect(holder.children).toHaveLength(1);
    expect(holder.children[0].visible).toBe(true);
  });

  test("rebuilds ONLY on spell change — same instance persists across frames of the same spell", async () => {
    snapshotRef.aim.spellId = "fireball";
    renderer = await create(<ReticleLayer />, { camera: CAMERA_PROPS });
    await renderer.advanceFrames(1, 1 / 30);
    const holder = renderer.scene.children[0].instance as THREE.Group;
    const first = holder.children[0];
    await renderer.advanceFrames(3, 1 / 30);
    expect(holder.children[0]).toBe(first);

    // meteor -> GROUND_AOE_AT_POINT, a different archetype from fireball's
    // DIRECTIONAL_PROJECTILE, so this must trigger a rebuild (dispose old +
    // build/add new), never an accumulation of stale instances.
    snapshotRef.aim.spellId = "meteor";
    await renderer.advanceFrames(1, 1 / 30);
    expect(holder.children).toHaveLength(1);
    expect(holder.children[0]).not.toBe(first);
  });

  test("SELF_BUFF archetype (windWalk) builds but stays hidden", async () => {
    snapshotRef.aim.spellId = "windWalk";
    renderer = await create(<ReticleLayer />, { camera: CAMERA_PROPS });
    await renderer.advanceFrames(2, 1 / 30);

    const holder = renderer.scene.children[0].instance as THREE.Group;
    expect(holder.children).toHaveLength(1);
    expect(holder.children[0].visible).toBe(false);
  });

  test("clearing the aim (spellId=null) hides the existing reticle without disposing it", async () => {
    snapshotRef.aim.spellId = "fireball";
    renderer = await create(<ReticleLayer />, { camera: CAMERA_PROPS });
    await renderer.advanceFrames(1, 1 / 30);
    const holder = renderer.scene.children[0].instance as THREE.Group;
    expect(holder.children[0].visible).toBe(true);

    snapshotRef.aim.spellId = null;
    await renderer.advanceFrames(1, 1 / 30);
    expect(holder.children).toHaveLength(1); // still parked, not removed
    expect(holder.children[0].visible).toBe(false);
  });
});
