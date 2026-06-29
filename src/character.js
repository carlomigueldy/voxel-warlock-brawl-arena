import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { clone as cloneSkinned } from "three/addons/utils/SkeletonUtils.js";
import { CFG } from "./config.js";
import { CastAnimator } from "./animations.js";

// Each selectable character is a Meshy-rigged voxel warlock with its own
// skinned walk/run clips. The skeletons share the same bone layout, so the
// CastAnimator overlays (animations.js) apply uniformly across all of them.
const url = (p) => new URL(p, import.meta.url).href;
export const CHARACTER_ASSETS = {
  ember: {
    base: url("../assets/characters/ember-warlock-rigged.glb"),
    walk: url("../assets/characters/ember-warlock-walking.glb"),
    run: url("../assets/characters/ember-warlock-running.glb"),
  },
  frost: {
    base: url("../assets/characters/frost-mage-rigged.glb"),
    walk: url("../assets/characters/frost-mage-walking.glb"),
    run: url("../assets/characters/frost-mage-running.glb"),
  },
  storm: {
    base: url("../assets/characters/storm-shaman-rigged.glb"),
    walk: url("../assets/characters/storm-shaman-walking.glb"),
    run: url("../assets/characters/storm-shaman-running.glb"),
  },
  moss: {
    base: url("../assets/characters/moss-necromancer-rigged.glb"),
    walk: url("../assets/characters/moss-necromancer-walking.glb"),
    run: url("../assets/characters/moss-necromancer-running.glb"),
  },
};
export const DEFAULT_CHARACTER = "ember";
const TARGET_HEIGHT = CFG.PLAYER_HEIGHT;

let _loadPromises = new Map(); // characterId -> Promise
let _templates = new Map();    // characterId -> template
let _loadPromise = null;       // active default load (legacy callers)
let _template = null;          // active default template (legacy callers)

function findClip(gltf, hint) {
  const anims = gltf.animations || [];
  if (!anims.length) return null;
  const lc = hint.toLowerCase();
  return anims.find((c) => (c.name || "").toLowerCase().includes(lc)) || anims[0];
}

export function loadCharacterTemplate(characterId = DEFAULT_CHARACTER) {
  const id = CHARACTER_ASSETS[characterId] ? characterId : DEFAULT_CHARACTER;
  if (_loadPromises.has(id)) {
    const p = _loadPromises.get(id);
    _loadPromise = p;
    return p;
  }
  const assets = CHARACTER_ASSETS[id];
  const loader = new GLTFLoader();
  const load = (url) => new Promise((res, rej) => loader.load(url, res, undefined, rej));

  const promise = Promise.all([load(assets.base), load(assets.walk), load(assets.run)])
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
      const template = { id, scene, clips: { idle: idleClip, walk: walkClip, run: runClip } };
      _templates.set(id, template);
      _template = template;
      return template;
    });

  _loadPromises.set(id, promise);
  _loadPromise = promise;
  return promise;
}

export function characterReady(characterId = DEFAULT_CHARACTER) {
  const id = CHARACTER_ASSETS[characterId] ? characterId : DEFAULT_CHARACTER;
  return _templates.has(id);
}

export function buildCharacterInstance(color, characterId = DEFAULT_CHARACTER) {
  const id = CHARACTER_ASSETS[characterId] ? characterId : DEFAULT_CHARACTER;
  const template = _templates.get(id) || _template;
  if (!template) return null;

  const root = new THREE.Group();
  const model = cloneSkinned(template.scene);
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
  actions.idle = make(template.clips.idle);
  actions.walk = make(template.clips.walk);
  actions.run = make(template.clips.run);

  const current = actions.idle || actions.walk || actions.run;
  if (current) current.setEffectiveWeight(1);

  // Capture the model's rest transform so cast overlays are applied relative to
  // it (and so we can ease back to rest when no cast is playing).
  const restPos = model.position.clone();
  const restRot = model.rotation.clone();

  const state = {
    root,
    model,
    mixer,
    actions,
    current,
    cast: new CastAnimator(),
    w: { idle: current === actions.idle ? 1 : 0, walk: 0, run: 0 },
  };

  // Fire a cast animation archetype (attack/slam/dash/buff/channel). Triggered
  // by the renderer when the simulation reports this warlock cast something.
  state.triggerCast = (archetype) => state.cast.trigger(archetype);

  state.update = (info) => {
    const dt = Math.min(0.05, Math.max(0.0001, info.dt || 0.016));
    const maxSpeed = info.maxSpeed || 9;
    const gait = Math.min(1, (info.speed || 0) / maxSpeed);
    let tIdle = 0, tWalk = 0, tRun = 0;

    if (info.falling) {
      tIdle = 1;
    } else if (gait < 0.08) {
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

    // Layer the cast archetype as a skeleton-agnostic whole-body gesture on top
    // of the locomotion clips. Each archetype reads distinctly without needing a
    // bespoke skinned clip per ability.
    state.cast.update(dt);
    applyCastOverlay(model, restPos, restRot, state.cast, info);
  };

  root.userData.character = state;
  return root;
}

// Distinct whole-body poses per cast archetype, blended in by the CastAnimator
// weight. Applied to the model root so it works on any Meshy skeleton.
function applyCastOverlay(model, restPos, restRot, cast, info) {
  const t = (info && info.time) || 0;
  let pitch = 0, lift = 0, lean = 0, twist = 0;
  const wgt = cast.weight;

  if (wgt > 0.0001 && cast.archetype) {
    switch (cast.archetype) {
      case "attack": // sharp forward jab toward the aim
        pitch = -0.55; lift = 0.05; lean = 0.12;
        break;
      case "slam": // raise then crash down (sinusoidal over the gesture)
        pitch = 0.5 - Math.sin(t * 20) * 0.15; lift = 0.18;
        break;
      case "dash": // crouched lunge
        pitch = 0.35; lift = -0.12; lean = 0.3;
        break;
      case "buff": // arms-up flourish, slight upward pop
        pitch = -0.7; lift = 0.16; twist = Math.sin(t * 16) * 0.1;
        break;
      case "channel": // braced, leaning back while pulling a foe
        pitch = 0.28; lean = -0.18; twist = Math.sin(t * 10) * 0.16;
        break;
    }
  }

  model.rotation.x = restRot.x + pitch * wgt;
  model.rotation.z = restRot.z + lean * wgt;
  model.rotation.y = restRot.y + twist * wgt;
  model.position.y = restPos.y + lift * wgt;
}
