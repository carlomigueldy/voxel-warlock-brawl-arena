// @vitest-environment jsdom
// Scene-graph smoke test for the R3F scaffold (design §7) — mounts <Scene/>
// with @react-three/test-renderer and asserts the parts of design §0 (THE
// PARITY CONTRACT) this PR is responsible for: the light topology, the
// Lambert-flat/Basic material rule, and the camera settings. Full entity-
// count/material-instance assertions land with the entity issues (#139-#147)
// that replace the null stub Layers this test also exercises.
import { useEffect } from "react";
import { afterEach, describe, expect, test } from "vitest";
import { create, type ReactThreeTestInstance } from "@react-three/test-renderer";
import { useThree } from "@react-three/fiber";
import * as THREE from "three";
import { CFG } from "../../src/config";
import { Scene } from "../../src/three/Scene";

// @react-three/test-renderer's create()/advanceFrames() wrap every commit in
// React's act() — without this flag React warns "not configured to support
// act(...)" and (worse) the reconciler's initial commit can be observed
// before effects/refs have flushed, so queries below would race an empty
// tree. Other .test.tsx files in this repo get this for free by going
// through @testing-library/react's render()/act(); this file talks to the
// R3F reconciler directly, so it sets the same flag itself.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type TestRenderer = Awaited<ReturnType<typeof create>>;

const CAMERA_PROPS = { fov: 55, near: 0.1, far: 300, position: [0, 28, 24] as [number, number, number] };

// The default camera created from Canvas/create()'s `camera` option isn't a
// declarative child of <Scene/>, so it never shows up via
// renderer.scene.findByType — @react-three/test-renderer doesn't expose the
// root camera on its public Renderer either. Capture it the same way
// CameraRig itself reads it (useThree) via a sibling probe component.
function CameraProbe({ onCamera }: { onCamera: (camera: THREE.Camera) => void }) {
  const camera = useThree((state) => state.camera);
  useEffect(() => onCamera(camera), [camera, onCamera]);
  return null;
}

describe("R3F Scene scaffold (P4a)", () => {
  let renderer: TestRenderer | null = null;

  afterEach(async () => {
    await renderer?.unmount();
    renderer = null;
  });

  test("mounts the scaffold + every stub Layer without throwing", async () => {
    renderer = await create(<Scene />, { camera: CAMERA_PROPS });
    expect(renderer.scene).toBeTruthy();
  });

  test("light topology matches design §0/§7: 1 hemisphere + 1 directional + LIGHT_POOL_SIZE bolt lights + 1 hazard-glow point light", async () => {
    renderer = await create(<Scene />, { camera: CAMERA_PROPS });

    // ReactThreeTestInstance.type reads the underlying THREE object's own
    // `.type` field (every Object3D subclass sets `this.type = "ClassName"`
    // in its ctor) — PascalCase, NOT the lowercase JSX tag name.
    const hemi = renderer.scene.findAllByType("HemisphereLight");
    const dir = renderer.scene.findAllByType("DirectionalLight");
    const point = renderer.scene.findAllByType("PointLight");
    expect(hemi).toHaveLength(1);
    expect(dir).toHaveLength(1);
    // LightPool's CFG.LIGHT_POOL_SIZE shared bolt-tracking lights + Environment's
    // 1 hazard-glow light. The beam pool (+3, CFG.BEAM_LIGHT_POOL_SIZE) is
    // allocated on demand by the (deferred) beam VFX, not part of the
    // always-present scene graph — see design §0 CFG note.
    expect(point).toHaveLength(CFG.LIGHT_POOL_SIZE + 1);

    const hemiLight = hemi[0].instance as THREE.HemisphereLight;
    expect(hemiLight.color.getHex()).toBe(0x8a7bff);
    expect(hemiLight.groundColor.getHex()).toBe(0x2a1a3a);
    expect(hemiLight.intensity).toBeCloseTo(0.7);

    const sun = dir[0].instance as THREE.DirectionalLight;
    expect(sun.color.getHex()).toBe(0xfff0e0);
    expect(sun.intensity).toBeCloseTo(1.1);
    expect(sun.position.toArray()).toEqual([20, 40, 20]);
    expect(sun.castShadow).toBe(true);
    expect(sun.shadow.mapSize.toArray()).toEqual([1024, 1024]);
    expect(sun.shadow.camera.left).toBe(-40);
    expect(sun.shadow.camera.right).toBe(40);
    expect(sun.shadow.camera.top).toBe(40);
    expect(sun.shadow.camera.bottom).toBe(-40);
    expect(sun.shadow.camera.far).toBe(120);

    // The hazard-glow point light (Environment) — the other 4 are LightPool's
    // bolt pool, all constructed with args=[0xffffff, 0, 6] (dark until a
    // bolt is assigned).
    const glow = point.find((p) => (p.instance as THREE.PointLight).color.getHex() === 0xff3a1e);
    expect(glow).toBeTruthy();
    const glowLight = glow!.instance as THREE.PointLight;
    expect(glowLight.intensity).toBeCloseTo(0.8);
    expect(glowLight.distance).toBe(60);
    expect(glowLight.position.toArray()).toEqual([0, -6, 0]);
  });

  test("no MeshStandardMaterial anywhere in the tree — palette enforces Lambert-flat/Basic (design §0 PALETTE CORRECTION)", async () => {
    renderer = await create(<Scene />, { camera: CAMERA_PROPS });
    const materials: ReactThreeTestInstance[] = renderer.scene.findAll((node) => node.instance instanceof THREE.Material);
    for (const m of materials) {
      expect(m.instance).not.toBeInstanceOf(THREE.MeshStandardMaterial);
    }
  });

  test("camera settings match design §0: fov 55, near 0.1, far 300", async () => {
    let captured: THREE.PerspectiveCamera | null = null;
    renderer = await create(
      <>
        <Scene />
        <CameraProbe onCamera={(c) => { captured = c as THREE.PerspectiveCamera; }} />
      </>,
      { camera: CAMERA_PROPS },
    );
    expect(captured).toBeTruthy();
    expect(captured!.fov).toBe(55);
    expect(captured!.near).toBe(0.1);
    expect(captured!.far).toBe(300);
  });

  test("fog/background match design §0 ctor defaults: background=0x0d0b1a, Fog(0x0d0b1a,40,90)", async () => {
    renderer = await create(<Scene />, { camera: CAMERA_PROPS });
    // renderer.scene wraps the actual THREE.Scene instance R3F/test-renderer
    // constructed — Environment sets background/fog imperatively via
    // useEffect (not JSX <fog>/<color attach>), so this reads the live
    // THREE.Scene object rather than a declarative props tree.
    const scene = renderer.scene.instance as unknown as THREE.Scene;
    expect(scene.background).toBeInstanceOf(THREE.Color);
    expect((scene.background as THREE.Color).getHex()).toBe(0x0d0b1a);
    expect(scene.fog).toBeInstanceOf(THREE.Fog);
    const fog = scene.fog as THREE.Fog;
    expect(fog.color.getHex()).toBe(0x0d0b1a);
    expect(fog.near).toBe(40);
    expect(fog.far).toBe(90);
  });

  test("every stub Layer mounts and renders nothing (empty scene until #139-#147 land)", async () => {
    renderer = await create(<Scene />, { camera: CAMERA_PROPS });
    // No geometry/meshes yet — every entity/map/vfx Layer is a null stub.
    expect(renderer.scene.findAllByType("Mesh")).toHaveLength(0);
  });
});
