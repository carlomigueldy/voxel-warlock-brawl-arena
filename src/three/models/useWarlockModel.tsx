// GLB warlock model loading + the manual multi-clip animation state machine
// (design §6, §0 CRITICAL row "Anim blend"/"GLB self-heal"). This is a fresh
// R3F-native re-implementation, not a wrapper around character.ts's
// buildCharacterInstance/loadCharacterTemplate (those stay the untouched,
// value-identical port that legacy renderer.js still drives under
// `?renderer=legacy`) — the two hard requirements below only hold for a
// from-scratch implementation:
//   - GLTFLoader/SkeletonUtils must come from three-stdlib so the loader
//     instance (and its URL cache) is the SAME one drei's useGLTF shares
//     across every consumer/canvas (design §1) — character.ts's legacy path
//     intentionally keeps its own separate three/addons GLTFLoader.
//   - useGLTF integrates with React Suspense (design §6: "gltfs=useGLTF(urls)
//     [suspends; cached per URL, shared across canvases]"), which a
//     Promise.all-based loader cannot do.
// The self-heal math, clip-name resolution, weight-lerp blend, and cast/
// reaction overlay below are copied VERBATIM from character.ts's
// loadCharacterTemplate/buildCharacterInstance (same formulas, same
// constants) — see design §0's "GLB self-heal"/"Anim blend" rows.
import { useEffect, useMemo } from "react";
import { useGLTF } from "@react-three/drei";
import type { ObjectMap } from "@react-three/fiber";
import * as THREE from "three";
import { SkeletonUtils, type GLTF } from "three-stdlib";
import { CFG } from "../../config.js";
import { CastAnimator, ReactionAnimator, locomotionState, type Archetype, type Reaction } from "../../animations";
import {
  CHARACTER_ASSETS,
  DEFAULT_CHARACTER,
  EXTRA_CLIP_NAMES,
  extraClipAssets,
  warlockGlbUrls,
  makeHeroGlyph,
  type ExtraClipName,
} from "../../character";
import type { PlayerAnimInfo } from "../entities/playerAnim";

const TARGET_HEIGHT = CFG.PLAYER_HEIGHT;

/** Loose Object3D shape covering THREE.Mesh/SkinnedMesh's isMesh/
 * isSkinnedMesh/geometry/material fields without fighting THREE.Mesh's
 * strict generics — mirrors character.ts's TraversableMesh (duplicated, not
 * imported, so this module stays independent of the legacy loader's
 * internals per the file header). */
interface TraversableMesh extends THREE.Object3D {
  isMesh?: boolean;
  isSkinnedMesh?: boolean;
  geometry?: THREE.BufferGeometry;
  material?: THREE.Material | THREE.Material[];
}

type ClipName = "idle" | "walk" | "run" | ExtraClipName;
type ClipSlot = "base" | "walk" | "run" | ExtraClipName;

// Mirrors character.ts's warlockGlbUrls() iteration order exactly (base,
// walk, run, then whichever EXTRA_CLIP_NAMES exist for this character) so
// gltfs[i] always corresponds to slots[i].
function warlockGlbSlots(characterId: string): ClipSlot[] {
  const id = CHARACTER_ASSETS[characterId] ? characterId : DEFAULT_CHARACTER;
  const extra = extraClipAssets(id);
  const slots: ClipSlot[] = ["base", "walk", "run"];
  for (const name of EXTRA_CLIP_NAMES) if (extra[name]) slots.push(name);
  return slots;
}

function findClip(gltf: GLTF, hint: string): THREE.AnimationClip | null {
  const anims = gltf.animations || [];
  if (!anims.length) return null;
  const lc = hint.toLowerCase();
  return anims.find((c) => (c.name || "").toLowerCase().includes(lc)) || anims[0];
}

export interface WarlockTemplate {
  id: string;
  scene: THREE.Group;
  clips: Partial<Record<ClipName, THREE.AnimationClip | null>>;
}

// Idempotent module-level cache — every WarlockBody instance for the same
// characterId shares one healed template (design §6: "idempotent
// module-level"); self-heal below runs exactly once per characterId no
// matter how many players are using that character.
const _templates = new Map<string, WarlockTemplate>();

export function buildWarlockTemplate(characterId: string, gltfs: (GLTF & ObjectMap)[]): WarlockTemplate {
  const id = CHARACTER_ASSETS[characterId] ? characterId : DEFAULT_CHARACTER;
  const slots = warlockGlbSlots(id);
  const base = gltfs[slots.indexOf("base")];
  const walk = gltfs[slots.indexOf("walk")];
  const run = gltfs[slots.indexOf("run")];

  const idleClip = findClip(base, "clip0") || (base.animations || [])[0] || null;
  const walkClip = findClip(walk, "walk");
  const runClip = findClip(run, "run");
  const clips: WarlockTemplate["clips"] = { idle: idleClip, walk: walkClip, run: runClip };
  slots.forEach((slot, i) => {
    if (slot === "base" || slot === "walk" || slot === "run") return;
    clips[slot] = findClip(gltfs[i], slot);
  });

  // The cached GLTF's .scene is mutated in place (scale/position baked once
  // on the shared template, before any per-instance clone) — same object
  // drei's useGLTF cache holds, so every future consumer of this URL sees
  // the healed scene too. This mirrors character.ts's loadCharacterTemplate,
  // which also mutates its own loader's `base.scene` directly.
  const scene = base.scene;
  scene.updateWorldMatrix(true, true);

  // Self-heal VERBATIM (design §0 CRITICAL / §6): GEOMETRY-bbox union — NOT
  // Box3.setFromObject, which is wrong ~100x on the rig's 0.01-scale
  // armature node. Measure the skinned mesh geometry's own bounding box
  // instead (matches the rendered bind-pose extent regardless of node scale).
  const measured = new THREE.Box3();
  scene.traverse((o) => {
    const mesh = o as TraversableMesh;
    if ((mesh.isSkinnedMesh || mesh.isMesh) && mesh.geometry) {
      mesh.geometry.computeBoundingBox();
      if (mesh.geometry.boundingBox) measured.union(mesh.geometry.boundingBox);
    }
  });
  const size = new THREE.Vector3();
  measured.getSize(size);
  const h = size.y || 1;
  const s = TARGET_HEIGHT / h;
  scene.scale.multiplyScalar(s);
  scene.position.y -= measured.min.y * s;
  scene.traverse((o) => {
    const mesh = o as TraversableMesh;
    if (mesh.isMesh || mesh.isSkinnedMesh) {
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;
    }
  });

  return { id, scene, clips };
}

function getOrBuildWarlockTemplate(characterId: string, gltfs: (GLTF & ObjectMap)[]): WarlockTemplate {
  const id = CHARACTER_ASSETS[characterId] ? characterId : DEFAULT_CHARACTER;
  let template = _templates.get(id);
  if (!template) {
    template = buildWarlockTemplate(id, gltfs);
    _templates.set(id, template);
  }
  return template;
}

/** Per-frame animation input — filled by <PlayerEntity>'s useFrame (the
 * "animRef seam", design §3) and read by whichever body variant is mounted.
 * Re-exported here under the name this module's callers expect; see
 * playerAnim.ts's file header for why PlayerEntity/WarlockBody/
 * VoxelWarlockBody must all reference the SAME interface (not merely
 * structurally-compatible ones). */
export type WarlockAnimInfo = PlayerAnimInfo;

export interface WarlockInstance {
  root: THREE.Group;
  model: THREE.Object3D;
  mixer: THREE.AnimationMixer;
  actions: Partial<Record<ClipName, THREE.AnimationAction | null>>;
  update: (info: WarlockAnimInfo) => void;
  triggerCast: (archetype: Archetype) => void;
  triggerReaction: (reaction: Reaction) => void;
  dispose: () => void;
}

// Distinct whole-body poses per cast archetype, blended in by the
// CastAnimator weight — copied verbatim from character.ts's
// applyCastOverlay (same constants), applied to the cloned instance's model
// root so it works on any Meshy skeleton.
function applyCastOverlay(
  model: THREE.Object3D,
  restPos: THREE.Vector3,
  restRot: THREE.Euler,
  cast: CastAnimator,
  time: number,
): void {
  let pitch = 0, lift = 0, lean = 0, twist = 0;
  const wgt = cast.weight;

  if (wgt > 0.0001 && cast.archetype) {
    switch (cast.archetype) {
      case "attack":
        pitch = -0.55; lift = 0.05; lean = 0.12;
        break;
      case "slam":
        pitch = 0.5 - Math.sin(time * 20) * 0.15; lift = 0.18;
        break;
      case "dash":
        pitch = 0.35; lift = -0.12; lean = 0.3;
        break;
      case "buff":
        pitch = -0.7; lift = 0.16; twist = Math.sin(time * 16) * 0.1;
        break;
      case "channel":
        pitch = 0.28; lean = -0.18; twist = Math.sin(time * 10) * 0.16;
        break;
    }
  }

  model.rotation.x = restRot.x + pitch * wgt;
  model.rotation.z = restRot.z + lean * wgt;
  model.rotation.y = restRot.y + twist * wgt;
  model.position.y = restPos.y + lift * wgt;
}

export function instantiateWarlock(template: WarlockTemplate, color: number): WarlockInstance {
  const root = new THREE.Group();
  // SkeletonUtils.clone per instance (design §0/§6 CRITICAL — NOT drei
  // <Clone>) so every player gets an independent skeleton/pose.
  const model = SkeletonUtils.clone(template.scene);
  root.add(model);

  // Per-instance material .clone() (design §0/§6 CRITICAL) — charge tint and
  // any future per-player status tint must never bleed across instances that
  // share the same template.
  model.traverse((o3) => {
    const o = o3 as TraversableMesh;
    if ((o.isMesh || o.isSkinnedMesh) && o.material) {
      const wasArray = Array.isArray(o.material);
      const mats: THREE.Material[] = wasArray ? (o.material as THREE.Material[]) : [o.material as THREE.Material];
      const cloned = mats.map((m) => {
        const c = m.clone();
        c.needsUpdate = true;
        return c;
      });
      o.material = wasArray ? cloned : cloned[0];
    }
  });

  const glyph = makeHeroGlyph(color);
  root.add(glyph);

  const mixer = new THREE.AnimationMixer(model);
  const actions: WarlockInstance["actions"] = {};
  const make = (clip: THREE.AnimationClip | null | undefined): THREE.AnimationAction | null => {
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
  for (const name of EXTRA_CLIP_NAMES) {
    const clip = template.clips[name];
    if (clip) actions[name] = make(clip);
  }

  const current = actions.idle || actions.walk || actions.run;
  if (current) current.setEffectiveWeight(1);

  const restPos = model.position.clone();
  const restRot = model.rotation.clone();

  const cast = new CastAnimator();
  const reaction = new ReactionAnimator();
  const w = { idle: current === actions.idle ? 1 : 0, walk: 0, run: 0, death: 0, stun: 0, knockback: 0 };
  const glyphBaseOpacity = 0.4;

  function update(info: WarlockAnimInfo): void {
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

    // Snapshot→state priority order (design §6): death > fall > stun >
    // knockback > run/walk/idle — matches character.ts's locomotionState use.
    const loco = locomotionState({
      speed: info.speed || 0,
      maxSpeed,
      falling: !!info.falling,
      alive: info.alive !== false,
      stunned: !!info.stunned,
      knockSpeed: info.knockSpeed || 0,
    });
    const tDeath = loco === "death" && actions.death ? 1 : 0;
    const tStun = loco === "stun" && actions.stun ? 1 : 0;
    const tKnockback = loco === "knockback" && actions.knockback ? 1 : 0;
    if (tDeath || tStun || tKnockback) { tIdle = 0; tWalk = 0; tRun = 0; }

    // Manual weight-lerp blend (design §0 CRITICAL — NOT crossFadeTo).
    const blend = 1 - Math.exp(-10 * dt);
    w.idle += (tIdle - w.idle) * blend;
    w.walk += (tWalk - w.walk) * blend;
    w.run += (tRun - w.run) * blend;
    w.death += (tDeath - w.death) * blend;
    w.stun += (tStun - w.stun) * blend;
    w.knockback += (tKnockback - w.knockback) * blend;

    reaction.update(dt);
    const rw = reaction.weight;
    const keep = 1 - rw;

    if (actions.idle) actions.idle.setEffectiveWeight(w.idle * keep);
    if (actions.walk) actions.walk.setEffectiveWeight(w.walk * keep);
    if (actions.run) actions.run.setEffectiveWeight(w.run * keep);
    if (actions.death) actions.death.setEffectiveWeight(w.death * keep);
    if (actions.stun) actions.stun.setEffectiveWeight(w.stun * keep);
    if (actions.knockback) actions.knockback.setEffectiveWeight(w.knockback * keep);
    if (actions.hit) actions.hit.setEffectiveWeight(rw);

    // walk/run timeScale=1+charge*0.25 (design §0 CRITICAL).
    const rate = 1 + (info.charge || 0) * 0.25;
    if (actions.walk) actions.walk.setEffectiveTimeScale(rate);
    if (actions.run) actions.run.setEffectiveTimeScale(rate);

    mixer.update(dt);

    if (info.channel && !cast.active) cast.trigger("channel");
    cast.update(dt);
    applyCastOverlay(model, restPos, restRot, cast, info.time || 0);

    if (glyph) {
      const t = info.time || 0;
      const charge = info.charge || 0;
      (glyph.material as THREE.MeshBasicMaterial).opacity = glyphBaseOpacity + 0.1 * Math.sin(t * 2) + 0.06 * charge;
      glyph.scale.setScalar(1 + 0.04 * Math.sin(t * 2.4 + 0.8) + 0.06 * charge);
    }
  }

  function dispose(): void {
    mixer.stopAllAction();
    glyph.geometry.dispose();
    const gm = glyph.material as THREE.MeshBasicMaterial;
    gm.map?.dispose();
    gm.dispose();
    // Per-instance cloned materials only — geometry is SHARED with the
    // template (SkeletonUtils.clone reuses BufferGeometry references across
    // every clone), so it must never be disposed here (mirrors legacy
    // renderer.js's `_disposeGroup(e.group, e.usingGLB=true)` materialsOnly
    // path for GLB players).
    model.traverse((o3) => {
      const o = o3 as TraversableMesh;
      if (o.material) {
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        mats.forEach((m) => m.dispose());
      }
    });
  }

  return {
    root,
    model,
    mixer,
    actions,
    update,
    triggerCast: (archetype) => cast.trigger(archetype),
    triggerReaction: (r) => reaction.trigger(r),
    dispose,
  };
}

export function useWarlockModel(characterId: string | undefined, color: number): WarlockInstance {
  const id = CHARACTER_ASSETS[characterId ?? ""] ? (characterId as string) : DEFAULT_CHARACTER;
  const urls = useMemo(() => warlockGlbUrls(id), [id]);
  // Suspends until every URL resolves; drei/R3F's useLoader cache keys by
  // (loader, url) so this is shared across every WarlockBody instance/canvas
  // requesting the same character (design §6).
  const gltfs = useGLTF(urls) as (GLTF & ObjectMap)[];
  const template = useMemo(() => getOrBuildWarlockTemplate(id, gltfs), [id, gltfs]);
  const instance = useMemo(() => instantiateWarlock(template, color), [template, color]);

  useEffect(() => () => instance.dispose(), [instance]);

  return instance;
}

// Preload every selectable character's GLB set — keeps the first player who
// picks a less-common character from paying the full load latency on first
// mount (drei's useGLTF.preload populates the same shared cache useGLTF
// reads from, so this is purely a warm-up, not a second load path).
export function preloadWarlockModels(): void {
  for (const id of Object.keys(CHARACTER_ASSETS)) {
    useGLTF.preload(warlockGlbUrls(id));
  }
}
