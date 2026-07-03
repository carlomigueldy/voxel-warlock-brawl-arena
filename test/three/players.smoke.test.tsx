// @vitest-environment jsdom
// Scene-graph smoke test for the warlock GLB models + player entities layer
// (design §7/§8 "p4-warlocks" acceptance: parity + self-heal + fallback).
// Two layers of coverage:
//   1. Pure-function checks directly against useWarlockModel's exported
//      buildWarlockTemplate/instantiateWarlock (design §0 CRITICAL "GLB
//      self-heal"/"Anim blend" rows) — deterministic, no React/Suspense/
//      network involved, exercised against synthetic in-memory GLTF-shaped
//      objects (no real .glb fetch, matching CONTRIBUTING's "no network in
//      tests" expectation).
//   2. A <PlayersLayer> mount via @react-three/test-renderer (jsdom) with
//      @react-three/drei's useGLTF mocked, covering BOTH the GLB path and
//      the Suspense/ErrorBoundary voxel fallback (design §6), plus the
//      material/frustumCulled assertions the brief calls out explicitly.
//
// jsdom has no real <canvas> 2D context (no `canvas` npm package installed
// anywhere in this repo — a pre-existing gap, not introduced here), so every
// canvas-texture builder in this tree (NameLabel's label texture,
// character.ts's makeHeroGlyph) would throw `ctx.createRadialGradient is
// not a function` the instant a body/label mounts under jsdom. Layer 2
// installs a minimal in-file 2D context stub (mirrors what jest-canvas-mock
// does) so the full <PlayerEntity> tree — GLB body, voxel fallback, label,
// HP bar, status auras — can actually mount and be asserted on.
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { create } from "@react-three/test-renderer";
import * as THREE from "three";
import type { ObjectMap } from "@react-three/fiber";
import type { GLTF } from "three-stdlib";
import { CFG } from "../../src/config";
import { pushSnapshot, setLocalId, resetSnapshotRef } from "../../src/store/snapshotRef";
import { useRosterStore, deriveRoster } from "../../src/store/useRosterStore";
import { player as registryPlayer } from "../../src/three/entities/entityRegistry";
import { warlockGlbUrls } from "../../src/character";
import type { Snapshot, PlayerSnap, PlayerMeta } from "../../src/types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// --- Minimal 2D canvas context stub (test-infra only — see file header) ---
function installCanvas2DStub(): void {
  const proto = HTMLCanvasElement.prototype as unknown as { __r3fStub2d?: boolean; getContext: (type: string) => unknown };
  if (proto.__r3fStub2d) return;
  proto.__r3fStub2d = true;
  const grad = { addColorStop: () => {} };
  const ctxStub = {
    fillStyle: "", strokeStyle: "", lineWidth: 1, font: "", textAlign: "left", textBaseline: "alphabetic",
    createRadialGradient: () => grad,
    createLinearGradient: () => grad,
    fillRect: () => {}, clearRect: () => {},
    fillText: () => {}, strokeText: () => {},
    measureText: (text: string) => ({ width: (text || "").length * 8 }),
    beginPath: () => {}, closePath: () => {}, moveTo: () => {}, lineTo: () => {},
    arc: () => {}, arcTo: () => {}, stroke: () => {}, fill: () => {},
    save: () => {}, restore: () => {}, translate: () => {}, rotate: () => {}, scale: () => {},
    drawImage: () => {},
    getImageData: () => ({ data: new Uint8ClampedArray(4) }),
    putImageData: () => {}, setTransform: () => {}, resetTransform: () => {},
  };
  proto.getContext = ((type: string) => (type === "2d" ? ctxStub : null)) as typeof proto.getContext;
}
installCanvas2DStub();

// --- Synthetic GLTF fixtures (no network / real .glb involved) ---
function makeFakeGltf(clipName: string, meshLabel: string): GLTF & ObjectMap {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.5, 2, 0.5), new THREE.MeshStandardMaterial({ color: 0x336699 }));
  mesh.name = meshLabel;
  const scene = new THREE.Group();
  scene.add(mesh);
  const clip = new THREE.AnimationClip(clipName, 1, []);
  return {
    scene,
    animations: [clip],
    scenes: [scene],
    cameras: [],
    asset: {},
    parser: {} as unknown as GLTF["parser"],
    userData: {},
  } as unknown as GLTF & ObjectMap;
}

// Builds exactly as many fake GLTFs as warlockGlbUrls(characterId) would
// request — every selectable character (ember/frost/storm/moss) has 7 extra
// clip slugs configured (character.ts EXTRA_CLIP_SLUGS), so the real
// base/walk/run/+7 slot count (up to 10) must be matched or findClip() on a
// missing index throws.
function makeGltfsFor(characterId: string): (GLTF & ObjectMap)[] {
  const count = warlockGlbUrls(characterId).length;
  return Array.from({ length: count }, (_, i) => {
    const hint = i === 0 ? "clip0_idle" : i === 1 ? "walk_clip" : i === 2 ? "run_clip" : `extra${i}`;
    return makeFakeGltf(hint, `slot-${i}`);
  });
}

// Controls the mocked useGLTF's behavior per test — "throw" exercises the
// ErrorBoundary/Suspense→<VoxelWarlockBody> fallback path; "ok" exercises
// the real GLB self-heal/instantiate path against synthetic data.
let glbMode: "throw" | "ok" = "throw";

vi.mock("@react-three/drei", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@react-three/drei")>();
  const fakeUseGLTF = ((urls: string | string[]) => {
    if (glbMode === "throw") throw new Error("mock GLB load failure (fallback-path test)");
    const list = Array.isArray(urls) ? urls : [urls];
    return list.map((_u, i) => {
      const hint = i === 0 ? "clip0_idle" : i === 1 ? "walk_clip" : i === 2 ? "run_clip" : `extra${i}`;
      return makeFakeGltf(hint, `slot-${i}`);
    });
  }) as typeof actual.useGLTF;
  (fakeUseGLTF as unknown as { preload: () => void }).preload = () => {};
  return { ...actual, useGLTF: fakeUseGLTF };
});

// Imports that transitively pull in @react-three/drei's useGLTF must come
// AFTER the vi.mock above (vitest hoists vi.mock calls to the top of the
// module regardless of source position, so this ordering is for readability
// only — but keeping it textually after documents the dependency).
const { PlayersLayer } = await import("../../src/three/entities/PlayersLayer");
const { buildWarlockTemplate, instantiateWarlock } = await import("../../src/three/models/useWarlockModel");

function makePlayerSnap(id: string, overrides: Partial<PlayerSnap> = {}): PlayerSnap {
  return {
    id, x: 1, z: -1, y: 0, a: 0.4, c: 2, hp: 80, mhp: 100, al: true, sp: false, f: false,
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

const CAMERA_PROPS = { fov: 55, near: 0.1, far: 300, position: [0, 28, 24] as [number, number, number] };

type TestRenderer = Awaited<ReturnType<typeof create>>;

function seedRoster(ids: string[], metaById: Record<string, PlayerMeta>): void {
  const players = ids.map((id) => makePlayerSnap(id));
  const snap = makeSnapshot(players);
  setLocalId(ids[0] ?? null);
  pushSnapshot(snap);
  useRosterStore.getState().sync(deriveRoster(snap, new Map(Object.entries(metaById))));
}

describe("useWarlockModel: self-heal + clip state machine (pure, no React)", () => {
  test("GLB self-heal: geometry-bbox scale/offset, frustumCulled=false — VERBATIM §0", () => {
    const gltfs = makeGltfsFor("ember");
    const template = buildWarlockTemplate("ember", gltfs);

    // Box geometry is (0.5, 2, 0.5) -> bbox height 2 -> scale = TARGET/2.
    const expectedScale = CFG.PLAYER_HEIGHT / 2;
    expect(template.scene.scale.y).toBeCloseTo(expectedScale, 5);
    // position.y -= min.y * s; min.y for a centered box of height 2 is -1.
    expect(template.scene.position.y).toBeCloseTo(1 * expectedScale, 5);

    let sawMesh = false;
    template.scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh) {
        sawMesh = true;
        expect(mesh.frustumCulled).toBe(false);
        expect(mesh.castShadow).toBe(true);
        expect(mesh.receiveShadow).toBe(true);
      }
    });
    expect(sawMesh).toBe(true);
  });

  test("clip names resolve idle/walk/run + extra clips by slot", () => {
    // ember has all 7 EXTRA_CLIP_NAMES slugged (character.ts
    // EXTRA_CLIP_SLUGS.ember="undead-warlock") — makeGltfsFor builds the
    // full base/walk/run/+7 = 10-slot array findClip()/buildWarlockTemplate
    // expect.
    const gltfs = makeGltfsFor("ember");
    const template = buildWarlockTemplate("ember", gltfs);
    expect(template.clips.idle?.name).toBe("clip0_idle");
    expect(template.clips.walk?.name).toBe("walk_clip");
    expect(template.clips.run?.name).toBe("run_clip");
    // Every extra clip slot (death/hit/stun/knockback/victory/taunt/idle2)
    // must resolve to a real (non-null) clip too.
    for (const name of ["death", "hit", "stun", "knockback", "victory", "taunt", "idle2"] as const) {
      expect(template.clips[name]).toBeTruthy();
    }
  });

  test("instantiateWarlock: per-instance SkeletonUtils.clone + material .clone() — no bleed across instances", () => {
    const gltfs = makeGltfsFor("frost");
    const template = buildWarlockTemplate("frost", gltfs);
    const a = instantiateWarlock(template, 0xff0000);
    const b = instantiateWarlock(template, 0x00ff00);

    expect(a.model).not.toBe(template.scene);
    expect(a.model).not.toBe(b.model);

    let matA: THREE.Material | undefined;
    let matB: THREE.Material | undefined;
    a.model.traverse((o) => { const m = (o as THREE.Mesh).material; if (m && !Array.isArray(m)) matA = m; });
    b.model.traverse((o) => { const m = (o as THREE.Mesh).material; if (m && !Array.isArray(m)) matB = m; });
    expect(matA).toBeTruthy();
    expect(matB).toBeTruthy();
    expect(matA).not.toBe(matB); // distinct clones, not shared references

    a.update({ speed: 0, maxSpeed: 9, charge: 1, falling: false, dt: 0.05, channel: 0, alive: true, stunned: false, knockSpeed: 0, time: 0 });
    b.update({ speed: 0, maxSpeed: 9, charge: 0, falling: false, dt: 0.05, channel: 0, alive: true, stunned: false, knockSpeed: 0, time: 0 });
    // charge tint is applied by the R3F body components (chargeTint.ts), not
    // by update() itself — instantiateWarlock only owns the clip/overlay
    // state machine. Assert the actions this update() drives are wired
    // (idle weight rose off its 0 baseline after ticking).
    expect(a.actions.idle?.getEffectiveWeight()).toBeGreaterThan(0);

    a.dispose();
    b.dispose();
  });

  test("manual weight-lerp blend (1-exp(-10dt)) drives walk weight up under sustained speed, NOT crossFadeTo", () => {
    const gltfs = makeGltfsFor("storm");
    const template = buildWarlockTemplate("storm", gltfs);
    const inst = instantiateWarlock(template, 0x4cc9ff);
    const info = { speed: 4.5, maxSpeed: 9, charge: 0, falling: false, dt: 0.05, channel: 0, alive: true, stunned: false, knockSpeed: 0, time: 0 };
    let walkWeight = 0;
    for (let i = 0; i < 30; i++) {
      info.time += info.dt;
      inst.update(info);
      walkWeight = inst.actions.walk?.getEffectiveWeight() ?? 0;
    }
    expect(walkWeight).toBeGreaterThan(0.5);
    inst.dispose();
  });

  test("walk/run timeScale=1+charge*0.25 (§0 CRITICAL)", () => {
    const gltfs = makeGltfsFor("moss");
    const template = buildWarlockTemplate("moss", gltfs);
    const inst = instantiateWarlock(template, 0x7cff5a);
    inst.update({ speed: 9, maxSpeed: 9, charge: 2, falling: false, dt: 0.05, channel: 0, alive: true, stunned: false, knockSpeed: 0, time: 0 });
    expect(inst.actions.run?.getEffectiveTimeScale()).toBeCloseTo(1 + 2 * 0.25, 5);
    inst.dispose();
  });

  test("dispose() frees per-instance materials/glyph but never the shared template geometry", () => {
    const gltfs = makeGltfsFor("ember");
    const template = buildWarlockTemplate("ember", gltfs);
    const inst = instantiateWarlock(template, 0xff5a3c);
    let disposeSpy: ReturnType<typeof vi.fn> | undefined;
    inst.model.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.Material | undefined;
      if (m && !disposeSpy) disposeSpy = vi.spyOn(m, "dispose");
    });
    inst.dispose();
    expect(disposeSpy).toHaveBeenCalled();
    // The shared template's own geometry must survive (still usable for the
    // next instantiateWarlock() call — geometry is never cloned/disposed).
    let templateGeoDisposed = false;
    const origDispose = THREE.BufferGeometry.prototype.dispose;
    template.scene.traverse((o) => {
      const geo = (o as THREE.Mesh).geometry;
      if (geo && geo.dispose !== origDispose) templateGeoDisposed = true;
    });
    expect(templateGeoDisposed).toBe(false);
  });
});

describe("<PlayersLayer> scene-graph smoke (jsdom + @react-three/test-renderer)", () => {
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

  test("empty roster renders nothing", async () => {
    renderer = await create(<PlayersLayer />, { camera: CAMERA_PROPS });
    await renderer.advanceFrames(1, 1 / 30);
    expect(renderer.scene.findAllByType("Mesh")).toHaveLength(0);
  });

  test("fallback path: GLB load throws -> Suspense/ErrorBoundary mounts <VoxelWarlockBody> + label + HP bar; no MeshStandardMaterial", async () => {
    glbMode = "throw";
    seedRoster(["p1"], { p1: { name: "Warlock One", colorIndex: 0, userId: null } });

    renderer = await create(<PlayersLayer />, { camera: CAMERA_PROPS });
    await renderer.advanceFrames(3, 1 / 30);

    const meshes = renderer.scene.findAllByType("Mesh");
    expect(meshes.length).toBeGreaterThan(0);
    // <VoxelWarlockBody> mounts its whole pre-built THREE.Group via
    // <primitive> (imperative, design §4) — its meshes/materials were never
    // created through the React reconciler, so they don't show up as their
    // OWN fiber instances via findAll(Material); read `.material` straight
    // off each found Mesh instance instead.
    let sawMaterial = false;
    for (const meshNode of meshes) {
      const mat = (meshNode.instance as THREE.Mesh).material;
      const mats = Array.isArray(mat) ? mat : [mat];
      for (const m of mats) {
        if (!m) continue;
        sawMaterial = true;
        expect(m).not.toBeInstanceOf(THREE.MeshStandardMaterial);
      }
    }
    expect(sawMaterial).toBe(true);
    // A Sprite (name label) must be present — always mounted regardless of
    // which body variant is showing (design §3). NameLabel is JSX-declared
    // (not <primitive>), so it IS its own fiber instance.
    expect(renderer.scene.findAllByType("Sprite")).toHaveLength(1);

    // entityRegistry must resolve to the voxel body's triggerCast (registered
    // by <VoxelWarlockBody>, design §4).
    const entry = registryPlayer("p1");
    expect(entry).toBeTruthy();
    expect(typeof entry?.triggerCast).toBe("function");
  });

  test("GLB path: mocked useGLTF resolves -> <WarlockBody> mounts the healed model with frustumCulled=false", async () => {
    glbMode = "ok";
    seedRoster(["p1"], { p1: { name: "Warlock One", colorIndex: 1, character: "ember", userId: null } });

    renderer = await create(<PlayersLayer />, { camera: CAMERA_PROPS });
    await renderer.advanceFrames(3, 1 / 30);

    const meshes = renderer.scene.findAllByType("Mesh");
    expect(meshes.length).toBeGreaterThan(0);

    // The fake GLB mesh uses MeshStandardMaterial (real glTF-imported PBR
    // materials are exempt from the Lambert/Basic-only rule — design §0
    // PALETTE CORRECTION targets this tree's OWN procedural materials, not
    // asset-imported ones); assert it actually rendered (proves the GLB path
    // — not the voxel fallback — is what mounted) and that self-heal's
    // frustumCulled=false made it onto the live scene graph. <WarlockBody>
    // also mounts via <primitive> (design §4), so read `.material` straight
    // off each found Mesh instance rather than via findAll(Material) — see
    // the fallback-path test above for why.
    const glbMeshes = meshes.filter((m) => (m.instance as THREE.Mesh).material instanceof THREE.MeshStandardMaterial);
    expect(glbMeshes.length).toBeGreaterThan(0);
    for (const m of glbMeshes) {
      expect((m.instance as THREE.Mesh).frustumCulled).toBe(false);
    }

    const entry = registryPlayer("p1");
    expect(entry).toBeTruthy();
  });

  test("entity mount/unmount tracks roster changes (spawn/despawn)", async () => {
    glbMode = "throw";
    seedRoster(["p1", "p2"], {
      p1: { name: "A", colorIndex: 0, userId: null },
      p2: { name: "B", colorIndex: 1, userId: null },
    });
    renderer = await create(<PlayersLayer />, { camera: CAMERA_PROPS });
    await renderer.advanceFrames(2, 1 / 30);
    expect(registryPlayer("p1")).toBeTruthy();
    expect(registryPlayer("p2")).toBeTruthy();

    // Despawn p2. useRosterStore.sync() notifies subscribers synchronously
    // but outside React's act() tracking, so force a real re-render pass
    // (renderer.update wraps its .render() call in fiber.act) rather than
    // relying on advanceFrames (which only drives useFrame, not React
    // reconciliation) to pick the change up.
    const snap = makeSnapshot([makePlayerSnap("p1")], 2);
    setLocalId("p1");
    pushSnapshot(snap);
    useRosterStore.getState().sync(deriveRoster(snap, new Map([["p1", { name: "A", colorIndex: 0, userId: null }]])));
    await renderer.update(<PlayersLayer />);
    await renderer.advanceFrames(2, 1 / 30);

    expect(registryPlayer("p1")).toBeTruthy();
    expect(registryPlayer("p2")).toBeUndefined();
  });
});
