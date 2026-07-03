// mobModel.ts unit tests (#141) — GLTFLoader is network I/O, so
// GLTFLoader.prototype.load is spied to synchronously resolve synthetic GLTF
// objects (same technique any GLB-fixture-free unit test needs); everything
// downstream (self-heal scaling, clip-name resolution, the manual weight-lerp
// clip state machine, attack LoopOnce+clampWhenFinished exclusivity) is the
// REAL mobModel.ts code under test, unmocked.
import { test, vi } from "vitest";
import assert from "node:assert";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { CFG } from "../src/config.js";
import {
  MOB_MODEL_ASSETS,
  loadMobModelTemplate,
  mobModelReady,
  buildMobModelInstance,
} from "../src/mobModel.js";

console.log("mobModel tests:");

test("MOB_MODEL_ASSETS declares all 5 GLB clip slots (base/idle/walk/run/attack) for the 4 big mobs (design §0)", () => {
  for (const type of ["stoneGiant", "stormingVortex", "giantDwarf", "fireElemental"]) {
    const assets = MOB_MODEL_ASSETS[type];
    assert.ok(assets, `${type} must have MOB_MODEL_ASSETS`);
    for (const slot of ["base", "idle", "walk", "run", "attack"]) {
      assert.match(assets[slot], /assets\/mobs\//, `${type}.${slot} must be a mobs asset URL`);
    }
    assert.ok(typeof assets.healthBar.color === "number");
    assert.ok(typeof assets.healthBar.yPos === "number");
  }
});

function makeGltfScene(height) {
  // Centered box (bbox spans [-height/2, height/2]) so the self-heal
  // position offset (`position.y -= min.y * s`) is actually exercised —
  // a mesh that already sits on y=0 would make that line a no-op.
  const geometry = new THREE.BoxGeometry(1, height, 1);
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
  const scene = new THREE.Group();
  scene.add(mesh);
  return scene;
}

function makeClip(name) {
  return new THREE.AnimationClip(name, 1, []);
}

function mockGltf({ scene, animations = [] } = {}) {
  return { scene: scene ?? makeGltfScene(1), animations, scenes: [], cameras: [], asset: {}, parser: {}, userData: {} };
}

test("loadMobModelTemplate resolves named clips and self-heals geometry-bbox scale/position to CFG.MOB_TYPES[type].height (design §0 GLB self-heal)", async () => {
  const type = "giantDwarf";
  assert.strictEqual(mobModelReady(type), false, "must not be ready before any load");

  const targetHeight = CFG.MOB_TYPES[type].height;
  const rawHeight = 3; // deliberately != targetHeight so scaling is provably exercised
  const baseGltf = mockGltf({ scene: makeGltfScene(rawHeight), animations: [makeClip("clip0")] });
  const idleGltf = mockGltf({ animations: [makeClip("Combat_Idle")] });
  const walkGltf = mockGltf({ animations: [makeClip("Armature|Root"), makeClip("Walk_Cycle")] });
  const runGltf = mockGltf({ animations: [makeClip("Run_Cycle")] });
  const attackGltf = mockGltf({ animations: [makeClip("Attack_01")] });
  const queue = [baseGltf, idleGltf, walkGltf, runGltf, attackGltf];

  const spy = vi.spyOn(GLTFLoader.prototype, "load").mockImplementation((_url, onLoad) => {
    onLoad(queue.shift());
  });

  try {
    const template = await loadMobModelTemplate(type);
    assert.ok(template, "template must resolve");
    assert.strictEqual(mobModelReady(type), true);
    assert.strictEqual(spy.mock.calls.length, 5, "must load exactly the 5 declared GLBs (base/idle/walk/run/attack)");

    assert.strictEqual(template.clips.idle.name, "Combat_Idle");
    assert.strictEqual(template.clips.walk.name, "Walk_Cycle");
    assert.strictEqual(template.clips.run.name, "Run_Cycle");
    assert.strictEqual(template.clips.attack.name, "Attack_01");

    // Self-heal: uniform scale from the SKINNED-MESH-GEOMETRY bbox (not
    // setFromObject) to the configured target height, position bottom-aligned.
    const expectedScale = targetHeight / rawHeight;
    assert.ok(Math.abs(template.scene.scale.y - expectedScale) < 1e-9, "scene must be scaled to CFG.MOB_TYPES height");
    const expectedY = -(-rawHeight / 2) * expectedScale; // min.y of a centered box == -rawHeight/2
    assert.ok(Math.abs(template.scene.position.y - expectedY) < 1e-9, "scene must be bottom-aligned after scaling");

    // Idempotent cache: a second call must NOT re-invoke GLTFLoader.
    await loadMobModelTemplate(type);
    assert.strictEqual(spy.mock.calls.length, 5, "loadMobModelTemplate must cache — no re-fetch on a second call");
  } finally {
    spy.mockRestore();
  }
});

test("buildMobModelInstance wires idle/walk/run + an exclusive LoopOnce/clampWhenFinished attack action, and triggerAttack zeroes locomotion weights (design §0)", async () => {
  const type = "fireElemental";
  const baseGltf = mockGltf({ scene: makeGltfScene(2), animations: [makeClip("clip0")] });
  const idleGltf = mockGltf({ animations: [makeClip("Idle")] });
  const walkGltf = mockGltf({ animations: [makeClip("Walk")] });
  const runGltf = mockGltf({ animations: [makeClip("Run")] });
  const attackGltf = mockGltf({ animations: [makeClip("Attack")] });
  const queue = [baseGltf, idleGltf, walkGltf, runGltf, attackGltf];

  const spy = vi.spyOn(GLTFLoader.prototype, "load").mockImplementation((_url, onLoad) => {
    onLoad(queue.shift());
  });

  try {
    await loadMobModelTemplate(type);
    const group = buildMobModelInstance(type, 0x123456);
    assert.ok(group, "buildMobModelInstance must return a group once the template is ready");

    const state = group.userData.mobModel;
    assert.ok(state, "root.userData.mobModel must carry the instance state");
    assert.ok(state.actions.idle && state.actions.walk && state.actions.run && state.actions.attack);
    assert.strictEqual(state.actions.idle.getEffectiveWeight(), 1, "idle starts as the active locomotion action");
    assert.strictEqual(state.actions.attack.loop, THREE.LoopOnce);
    assert.strictEqual(state.actions.attack.clampWhenFinished, true);

    assert.ok(group.userData.healthBar, "instance must carry a foreground HP bar mesh");

    state.triggerAttack();
    assert.strictEqual(state.attacking, true);
    assert.strictEqual(state.actions.idle.getEffectiveWeight(), 0, "triggerAttack must zero idle weight immediately");
    assert.strictEqual(state.actions.walk.getEffectiveWeight(), 0);
    assert.strictEqual(state.actions.run.getEffectiveWeight(), 0);
    assert.strictEqual(state.actions.attack.getEffectiveWeight(), 1);

    // No locomotion re-blend while attacking (design §0 "exclusive").
    state.update({ dt: 0.05, speed: 9, maxSpeed: 5 });
    assert.strictEqual(state.actions.idle.getEffectiveWeight(), 0);
    assert.strictEqual(state.attacking, true);

    // Clip duration is 1s (test fixture) — after it elapses, clampWhenFinished
    // ends the exclusive window and locomotion blending resumes.
    for (let i = 0; i < 25; i++) state.update({ dt: 0.05, speed: 0, maxSpeed: 5 });
    assert.strictEqual(state.attacking, false);
    assert.strictEqual(state.actions.attack.getEffectiveWeight(), 0);
  } finally {
    spy.mockRestore();
  }
});

test("buildMobModelInstance's userData.dispose is materials-only — a sibling instance's shared skinned geometry survives it (#182 F8)", async () => {
  const type = "stoneGiant";
  const baseGltf = mockGltf({ scene: makeGltfScene(2), animations: [makeClip("clip0")] });
  const idleGltf = mockGltf({ animations: [makeClip("Idle")] });
  const walkGltf = mockGltf({ animations: [makeClip("Walk")] });
  const runGltf = mockGltf({ animations: [makeClip("Run")] });
  const attackGltf = mockGltf({ animations: [makeClip("Attack")] });
  const queue = [baseGltf, idleGltf, walkGltf, runGltf, attackGltf];

  const spy = vi.spyOn(GLTFLoader.prototype, "load").mockImplementation((_url, onLoad) => {
    onLoad(queue.shift());
  });

  function findMesh(root) {
    let mesh = null;
    root.traverse((o) => { if (o.isMesh) mesh = o; });
    return mesh;
  }

  try {
    await loadMobModelTemplate(type);
    // Two sibling instances of the same type — SkeletonUtils.clone() shares
    // BufferGeometry across both (and the cached template), only materials
    // are cloned per-instance (buildMobModelInstance's own traverse above).
    const g1 = buildMobModelInstance(type, 0x111111);
    const g2 = buildMobModelInstance(type, 0x222222);

    const mesh1 = findMesh(g1.userData.mobModel.model);
    const mesh2 = findMesh(g2.userData.mobModel.model);
    assert.ok(mesh1 && mesh2, "both instances must have a mesh");
    assert.strictEqual(mesh1.geometry, mesh2.geometry, "SkeletonUtils.clone must share the SAME BufferGeometry across sibling instances");
    assert.notStrictEqual(mesh1.material, mesh2.material, "materials must be cloned per-instance");

    const geoDisposed = vi.fn();
    const matDisposed = vi.fn();
    const hbGeoDisposed = vi.fn();
    mesh1.geometry.addEventListener("dispose", geoDisposed);
    mesh1.material.addEventListener("dispose", matDisposed);
    g1.userData.healthBar.geometry.addEventListener("dispose", hbGeoDisposed);

    assert.strictEqual(typeof g1.userData.dispose, "function", "buildMobModelInstance must attach its own materials-only userData.dispose");
    g1.userData.dispose();

    assert.strictEqual(geoDisposed.mock.calls.length, 0, "disposing one GLB instance must NEVER dispose the shared skinned geometry (sibling + template still use it)");
    assert.strictEqual(matDisposed.mock.calls.length, 1, "the disposed instance's own cloned material must be freed");
    assert.strictEqual(hbGeoDisposed.mock.calls.length, 1, "the disposed instance's own (never-shared) health-bar geometry must be freed");
    assert.strictEqual(mesh2.geometry.attributes.position, mesh1.geometry.attributes.position, "the surviving sibling's shared geometry is untouched");
  } finally {
    spy.mockRestore();
  }
});
