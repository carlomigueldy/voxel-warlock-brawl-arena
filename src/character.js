import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { clone as cloneSkinned } from "three/addons/utils/SkeletonUtils.js";
import { CFG } from "./config.js";

const ASSET = {
  base: new URL("../assets/warlock-player-rigged.glb", import.meta.url).href,
  walk: new URL("../assets/warlock-player-walking.glb", import.meta.url).href,
  run: new URL("../assets/warlock-player-running.glb", import.meta.url).href,
};
const TARGET_HEIGHT = CFG.PLAYER_HEIGHT;

let _loadPromise = null;
let _template = null;

function findClip(gltf, hint) {
  const anims = gltf.animations || [];
  if (!anims.length) return null;
  const lc = hint.toLowerCase();
  return anims.find((c) => (c.name || "").toLowerCase().includes(lc)) || anims[0];
}

export function loadCharacterTemplate() {
  if (_loadPromise) return _loadPromise;
  const loader = new GLTFLoader();
  const load = (url) => new Promise((res, rej) => loader.load(url, res, undefined, rej));

  _loadPromise = Promise.all([load(ASSET.base), load(ASSET.walk), load(ASSET.run)])
    .then(([base, walk, run]) => {
      const idleClip = findClip(base, "clip0") || (base.animations || [])[0] || null;
      const walkClip = findClip(walk, "walk");
      const runClip = findClip(run, "run");
      const scene = base.scene;
      scene.updateWorldMatrix(true, true);
      // The rig's armature node carries a tiny (0.01) scale, so measuring the
      // posed scene graph mis-sizes the skinned mesh and yields a ~100x oversize.
      // Measure the skinned mesh geometry's own bounding box, which matches the
      // rendered bind-pose extent regardless of node scale.
      const measured = new THREE.Box3();
      scene.traverse((o) => {
        if ((o.isSkinnedMesh || o.isMesh) && o.geometry) {
          o.geometry.computeBoundingBox();
          if (o.geometry.boundingBox) measured.union(o.geometry.boundingBox);
        }
      });
      const size = new THREE.Vector3();
      measured.getSize(size);
      const h = size.y || 1;
      const s = TARGET_HEIGHT / h;
      scene.scale.multiplyScalar(s);
      scene.position.y -= measured.min.y * s;
      scene.traverse((o) => {
        if (o.isMesh || o.isSkinnedMesh) {
          o.castShadow = true;
          o.receiveShadow = true;
          o.frustumCulled = false;
        }
      });
      _template = { scene, clips: { idle: idleClip, walk: walkClip, run: runClip } };
      return _template;
    });

  return _loadPromise;
}

export function characterReady() {
  return !!_template;
}

export function buildCharacterInstance(color) {
  if (!_template) return null;

  const root = new THREE.Group();
  const model = cloneSkinned(_template.scene);
  root.add(model);

  const tint = new THREE.Color(color);
  model.traverse((o) => {
    if ((o.isMesh || o.isSkinnedMesh) && o.material) {
      const wasArray = Array.isArray(o.material);
      const mats = wasArray ? o.material : [o.material];
      const tinted = mats.map((m) => {
        const c = m.clone();
        if (c.color) c.color.lerp(tint, 0.45);
        return c;
      });
      o.material = wasArray ? tinted : tinted[0];
    }
  });

  const mixer = new THREE.AnimationMixer(model);
  const actions = {};
  const make = (clip) => {
    if (!clip) return null;
    const a = mixer.clipAction(clip);
    a.enabled = true;
    a.setEffectiveWeight(0);
    a.play();
    return a;
  };
  actions.idle = make(_template.clips.idle);
  actions.walk = make(_template.clips.walk);
  actions.run = make(_template.clips.run);

  const current = actions.idle || actions.walk || actions.run;
  if (current) current.setEffectiveWeight(1);

  const state = {
    root,
    model,
    mixer,
    actions,
    current,
    w: { idle: current === actions.idle ? 1 : 0, walk: 0, run: 0 },
  };

  state.update = (info) => {
    const dt = Math.min(0.05, Math.max(0.0001, info.dt || 0.016));
    const maxSpeed = info.maxSpeed || 9;
    const gait = Math.min(1, (info.speed || 0) / maxSpeed);
    let tIdle = 0, tWalk = 0, tRun = 0;

    if (gait < 0.08) {
      tIdle = 1;
    } else if (gait < 0.6) {
      const k = (gait - 0.08) / (0.6 - 0.08);
      tIdle = Math.max(0, 1 - k * 1.4);
      tWalk = 1 - tIdle;
    } else {
      const k = Math.min(1, (gait - 0.6) / 0.4);
      tWalk = 1 - k;
      tRun = k;
    }

    const blend = 1 - Math.exp(-10 * dt);
    const w = state.w;
    w.idle += (tIdle - w.idle) * blend;
    w.walk += (tWalk - w.walk) * blend;
    w.run += (tRun - w.run) * blend;

    if (actions.idle) actions.idle.setEffectiveWeight(w.idle);
    if (actions.walk) actions.walk.setEffectiveWeight(w.walk);
    if (actions.run) actions.run.setEffectiveWeight(w.run);

    const rate = 1 + (info.charge || 0) * 0.25;
    if (actions.walk) actions.walk.setEffectiveTimeScale(rate);
    if (actions.run) actions.run.setEffectiveTimeScale(rate);

    mixer.update(dt);
  };

  root.userData.character = state;
  return root;
}
