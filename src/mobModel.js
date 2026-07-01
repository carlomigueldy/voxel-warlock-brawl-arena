import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { clone as cloneSkinned } from "three/addons/utils/SkeletonUtils.js";
import { CFG } from "./config.js";
import { makeMobHealthBar } from "./lowpoly.js";

// Meshy-generated GLB bodies for the 4 "big mob" enemy types. This is the mob
// counterpart of character.js's CHARACTER_ASSETS/loadCharacterTemplate — the
// only module that owns GLTFLoader/AnimationMixer for mobs (renderer.js and
// voxel.js stay procedural-only per docs/superpowers/specs/
// 2026-07-01-low-poly-asset-enhancements-design.md; only these 4 mobs, not
// minion, get real rigged bodies).
const url = (p) => new URL(p, import.meta.url).href;
export const MOB_MODEL_ASSETS = {
  stoneGiant: {
    base:   url("../assets/mobs/stone-giant-rigged.glb"),
    idle:   url("../assets/mobs/stone-giant-idle.glb"),
    walk:   url("../assets/mobs/stone-giant-walking.glb"),
    run:    url("../assets/mobs/stone-giant-running.glb"),
    attack: url("../assets/mobs/stone-giant-attack.glb"),
    healthBar: { color: 0xff3a1e, yPos: 5.2 },
  },
  stormingVortex: {
    base:   url("../assets/mobs/storming-vortex-rigged.glb"),
    idle:   url("../assets/mobs/storming-vortex-idle.glb"),
    walk:   url("../assets/mobs/storming-vortex-walking.glb"),
    run:    url("../assets/mobs/storming-vortex-running.glb"),
    attack: url("../assets/mobs/storming-vortex-attack.glb"),
    healthBar: { color: 0x7adfff, yPos: 2.5 },
  },
  giantDwarf: {
    base:   url("../assets/mobs/giant-dwarf-rigged.glb"),
    idle:   url("../assets/mobs/giant-dwarf-idle.glb"),
    walk:   url("../assets/mobs/giant-dwarf-walking.glb"),
    run:    url("../assets/mobs/giant-dwarf-running.glb"),
    attack: url("../assets/mobs/giant-dwarf-attack.glb"),
    healthBar: { color: 0xffd23c, yPos: 3.8 },
  },
  fireElemental: {
    base:   url("../assets/mobs/fire-elemental-rigged.glb"),
    idle:   url("../assets/mobs/fire-elemental-idle.glb"),
    walk:   url("../assets/mobs/fire-elemental-walking.glb"),
    run:    url("../assets/mobs/fire-elemental-running.glb"),
    attack: url("../assets/mobs/fire-elemental-attack.glb"),
    healthBar: { color: 0xff5a1e, yPos: 4.0 },
  },
};

let _loadPromises = new Map(); // mobType -> Promise
let _templates = new Map();    // mobType -> template

function findClip(gltf, hint) {
  const anims = gltf.animations || [];
  if (!anims.length) return null;
  const lc = hint.toLowerCase();
  return anims.find((c) => (c.name || "").toLowerCase().includes(lc)) || anims[0];
}

export function loadMobModelTemplate(type) {
  const assets = MOB_MODEL_ASSETS[type];
  if (!assets) return null;
  if (_loadPromises.has(type)) return _loadPromises.get(type);

  const loader = new GLTFLoader();
  const load = (u) => new Promise((res, rej) => loader.load(u, res, undefined, rej));

  const promise = Promise.all([load(assets.base), load(assets.idle), load(assets.walk), load(assets.run), load(assets.attack)])
    .then(([base, idle, walk, run, attack]) => {
      // Meshy's auto-rig only ships walk/run; the base "rigged" GLB's clip0 is a
      // 0.3s static bind pose (a visible T-pose). Use the dedicated bespoke idle
      // clip (combat stance / breathing) generated via meshy_animate instead.
      const idleClip = (idle.animations || [])[0] || findClip(base, "clip0") || (base.animations || [])[0] || null;
      const walkClip = findClip(walk, "walk");
      const runClip = findClip(run, "run");
      const attackClip = (attack.animations || [])[0] || null;
      const scene = base.scene;
      scene.updateWorldMatrix(true, true);
      // Measure the skinned mesh geometry's own bounding box (not
      // setFromObject, which mis-measures armature-scaled posed scenes —
      // same gotcha documented in character.js).
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
      const targetHeight = (CFG.MOB_TYPES[type] && CFG.MOB_TYPES[type].height) || 2.5;
      const s = targetHeight / h;
      scene.scale.multiplyScalar(s);
      scene.position.y -= measured.min.y * s;
      scene.traverse((o) => {
        if (o.isMesh || o.isSkinnedMesh) {
          o.castShadow = true;
          o.receiveShadow = true;
          o.frustumCulled = false;
        }
      });
      const template = { id: type, scene, clips: { idle: idleClip, walk: walkClip, run: runClip, attack: attackClip } };
      _templates.set(type, template);
      return template;
    })
    .catch((err) => {
      // Permanently-failed load (bad/missing GLB): clear so a later call can
      // retry, and let the caller keep using the procedural fallback forever
      // otherwise — this only prevents an unhandled-rejection warning.
      _loadPromises.delete(type);
      console.error(`[mobModel] failed to load GLB template for "${type}":`, err);
      return null;
    });

  _loadPromises.set(type, promise);
  return promise;
}

export function mobModelReady(type) {
  return _templates.has(type);
}

export function buildMobModelInstance(type, color) {
  const template = _templates.get(type);
  if (!template) return null;
  const assets = MOB_MODEL_ASSETS[type];

  const root = new THREE.Group();
  const model = cloneSkinned(template.scene);
  root.add(model);

  // Clone materials per instance so per-instance status VFX (opacity toggles
  // for WW/invis, etc.) never bleed across mob instances sharing a template.
  model.traverse((o) => {
    if ((o.isMesh || o.isSkinnedMesh) && o.material) {
      const wasArray = Array.isArray(o.material);
      const mats = wasArray ? o.material : [o.material];
      const cloned = mats.map((m) => {
        const c = m.clone();
        c.needsUpdate = true;
        return c;
      });
      o.material = wasArray ? cloned : cloned[0];
    }
  });

  const mixer = new THREE.AnimationMixer(model);
  const actions = {};
  const make = (clip, opts) => {
    if (!clip) return null;
    const a = mixer.clipAction(clip);
    a.enabled = true;
    a.setEffectiveWeight(0);
    if (opts && opts.oneShot) {
      a.setLoop(THREE.LoopOnce);
      a.clampWhenFinished = true;
    }
    a.play();
    return a;
  };
  actions.idle = make(template.clips.idle);
  actions.walk = make(template.clips.walk);
  actions.run = make(template.clips.run);
  actions.attack = make(template.clips.attack, { oneShot: true });

  const current = actions.idle || actions.walk || actions.run;
  if (current) current.setEffectiveWeight(1);

  const hbColor = (assets.healthBar && assets.healthBar.color) || color;
  const hbY = (assets.healthBar && assets.healthBar.yPos) || 3.5;
  const hb = makeMobHealthBar(hbColor, hbY);
  root.add(hb.group);
  root.userData.healthBar = hb.bar;

  const state = {
    root,
    model,
    mixer,
    actions,
    current,
    w: { idle: current === actions.idle ? 1 : 0, walk: 0, run: 0 },
    attacking: false,
    attackT: 0,
  };

  state.triggerAttack = () => {
    if (!actions.attack) return;
    state.attacking = true;
    state.attackT = 0;
    // Zero locomotion weights immediately — update()'s blend loop is skipped
    // while attacking, so leftover idle/walk/run weight would otherwise keep
    // contributing to the mixer (weights sum, they don't replace) and corrupt
    // the attack pose whenever a mob attacks mid-stride.
    state.w.idle = 0;
    state.w.walk = 0;
    state.w.run = 0;
    if (actions.idle) actions.idle.setEffectiveWeight(0);
    if (actions.walk) actions.walk.setEffectiveWeight(0);
    if (actions.run) actions.run.setEffectiveWeight(0);
    actions.attack.stop();
    actions.attack.reset();
    actions.attack.setEffectiveWeight(1);
    actions.attack.play();
  };

  state.update = (info) => {
    const dt = Math.min(0.05, Math.max(0.0001, info.dt || 0.016));

    if (state.attacking && actions.attack) {
      state.attackT += dt;
      const dur = actions.attack.getClip().duration || 0.6;
      if (state.attackT >= dur || !actions.attack.isRunning()) {
        state.attacking = false;
        actions.attack.setEffectiveWeight(0);
      }
    }

    if (!state.attacking) {
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
    }

    mixer.update(dt);
  };

  root.userData.mobModel = state;
  return root;
}
