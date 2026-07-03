import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { clone as cloneSkinned } from "three/addons/utils/SkeletonUtils.js";
import type { GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { CFG } from "./config.js";
import { CastAnimator, locomotionState, ReactionAnimator, type Archetype, type Reaction } from "./animations.js";
import { asset } from "./asset-url.js";

// P4-140: ported from character.js to TypeScript — value-identical
// (annotations only, no behavior change). Legacy renderer.js keeps importing
// "./character.js" unmodified; Vite resolves that specifier to this file
// (same pattern as lowpoly.ts/voxel.ts). A few previously-module-private
// helpers below (EXTRA_CLIP_NAMES, extraClipAssets, makeHeroGlyph) are now
// exported, and one small new pure helper (warlockGlbUrls) is added, purely
// so src/three/models/useWarlockModel.tsx (P4-140, the R3F GLB path) can
// reuse the same asset table instead of duplicating it — none of this
// changes what loadCharacterTemplate/buildCharacterInstance below do.

// Each selectable character is a rigged warlock model rendered with its original
// shading (smoothed normals and baked maps intact). A glowing hero glyph marks
// each instance; there is no body tint — original model colors are preserved.
// The skeletons share the same bone layout, so CastAnimator overlays (animations.js)
// apply uniformly.
const url = (p: string) => asset(p);

export interface CharacterAssetSet {
  base: string;
  walk: string;
  run: string;
}

export const CHARACTER_ASSETS: Record<string, CharacterAssetSet> = {
  ember: {
    base: url("assets/characters/ember-warlock-rigged.glb"),
    walk: url("assets/characters/ember-warlock-walking.glb"),
    run: url("assets/characters/ember-warlock-running.glb"),
  },
  frost: {
    base: url("assets/characters/frost-mage-rigged.glb"),
    walk: url("assets/characters/frost-mage-walking.glb"),
    run: url("assets/characters/frost-mage-running.glb"),
  },
  storm: {
    base: url("assets/characters/storm-shaman-rigged.glb"),
    walk: url("assets/characters/storm-shaman-walking.glb"),
    run: url("assets/characters/storm-shaman-running.glb"),
  },
  moss: {
    base: url("assets/characters/moss-necromancer-rigged.glb"),
    walk: url("assets/characters/moss-necromancer-walking.glb"),
    run: url("assets/characters/moss-necromancer-running.glb"),
  },
};

// Meshy generated 7 additional single-clip GLBs per class (death/hit/stun/
// knockback/victory/taunt/idle2). Meshy re-themed the per-class asset slugs
// when regenerating these (see assets/characters/manifest.json), so the extra
// clips live under the new slug names below rather than the legacy base/walk/
// run slugs above. This is purely additive — base/walk/run loading above is
// untouched.
//
// Exported (P4-140) so useWarlockModel.tsx's warlockGlbUrls() below can build
// the same up-to-10-URL list without re-declaring this table.
export const EXTRA_CLIP_NAMES = ["death", "hit", "stun", "knockback", "victory", "taunt", "idle2"] as const;
export type ExtraClipName = (typeof EXTRA_CLIP_NAMES)[number];

const EXTRA_CLIP_SLUGS: Record<string, string> = {
  ember: "undead-warlock",
  frost: "archmage",
  storm: "orc-shaman",
  moss: "bloodelf-mage",
};

export function extraClipAssets(characterId: string): Partial<Record<ExtraClipName, string>> {
  const slug = EXTRA_CLIP_SLUGS[characterId];
  if (!slug) return {};
  const out: Partial<Record<ExtraClipName, string>> = {};
  for (const name of EXTRA_CLIP_NAMES) {
    out[name] = url(`assets/characters/${slug}-${name}.glb`);
  }
  return out;
}

export const DEFAULT_CHARACTER = "ember";
const TARGET_HEIGHT = CFG.PLAYER_HEIGHT;

// Resolve a character id to its up-to-10 GLB URLs, in a stable order:
// [base, walk, run, ...extra clips that exist for this character]. Used by
// the R3F path (useWarlockModel) to pass a single array to drei's useGLTF
// (suspends, cached per URL) — the legacy Promise.all loader below stays on
// its own separate GLTFLoader instance/cache, untouched.
export function warlockGlbUrls(characterId: string): string[] {
  const id = CHARACTER_ASSETS[characterId] ? characterId : DEFAULT_CHARACTER;
  const assets = CHARACTER_ASSETS[id];
  const extra = extraClipAssets(id);
  const urls = [assets.base, assets.walk, assets.run];
  for (const name of EXTRA_CLIP_NAMES) {
    const u = extra[name];
    if (u) urls.push(u);
  }
  return urls;
}

const _loadPromises = new Map<string, Promise<CharacterTemplate>>(); // characterId -> Promise
const _templates = new Map<string, CharacterTemplate>();    // characterId -> template
let _template: CharacterTemplate | null = null;          // active default template (legacy callers)

/** Loose Object3D shape wide enough to cover both THREE.Mesh and
 * THREE.SkinnedMesh's `is*`/geometry/material fields without fighting the
 * strict generic type params THREE.Mesh<TGeo, TMat> carries — this file only
 * ever duck-types through `.traverse()` callbacks, same as the original JS. */
interface TraversableMesh extends THREE.Object3D {
  isMesh?: boolean;
  isSkinnedMesh?: boolean;
  geometry?: THREE.BufferGeometry;
  material?: THREE.Material | THREE.Material[];
}

function findClip(gltf: GLTF, hint: string): THREE.AnimationClip | null {
  const anims = gltf.animations || [];
  if (!anims.length) return null;
  const lc = hint.toLowerCase();
  return anims.find((c) => (c.name || "").toLowerCase().includes(lc)) || anims[0];
}

export interface CharacterTemplate {
  id: string;
  scene: THREE.Group;
  clips: Partial<Record<"idle" | "walk" | "run" | ExtraClipName, THREE.AnimationClip | null>>;
}

export function loadCharacterTemplate(characterId: string = DEFAULT_CHARACTER): Promise<CharacterTemplate> {
  const id = CHARACTER_ASSETS[characterId] ? characterId : DEFAULT_CHARACTER;
  if (_loadPromises.has(id)) {
    return _loadPromises.get(id)!;
  }
  const assets = CHARACTER_ASSETS[id];
  const loader = new GLTFLoader();
  const load = (u: string): Promise<GLTF> => new Promise((res, rej) => loader.load(u, res as (gltf: GLTF) => void, undefined, rej));

  const extraAssets = extraClipAssets(id);
  const extraNames = Object.keys(extraAssets) as ExtraClipName[];

  const promise = Promise.all([
    load(assets.base),
    load(assets.walk),
    load(assets.run),
    ...extraNames.map((name) => load(extraAssets[name]!)),
  ])
    .then(([base, walk, run, ...extraGltfs]) => {
      const idleClip = findClip(base, "clip0") || (base.animations || [])[0] || null;
      const walkClip = findClip(walk, "walk");
      const runClip = findClip(run, "run");
      const extraClips: Partial<Record<ExtraClipName, THREE.AnimationClip | null>> = {};
      extraNames.forEach((name, i) => {
        extraClips[name] = findClip(extraGltfs[i], name);
      });
      const scene = base.scene;
      scene.updateWorldMatrix(true, true);
      // The rig's armature node carries a tiny (0.01) scale, so measuring the
      // posed scene graph mis-sizes the skinned mesh and yields a ~100x oversize.
      // Measure the skinned mesh geometry's own bounding box, which matches the
      // rendered bind-pose extent regardless of node scale.
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
      const template: CharacterTemplate = {
        id,
        scene,
        clips: { idle: idleClip, walk: walkClip, run: runClip, ...extraClips },
      };
      _templates.set(id, template);
      _template = template;
      return template;
    });

  _loadPromises.set(id, promise);
  return promise;
}

export function characterReady(characterId: string = DEFAULT_CHARACTER): boolean {
  const id = CHARACTER_ASSETS[characterId] ? characterId : DEFAULT_CHARACTER;
  return _templates.has(id);
}

export interface CharacterUpdateInfo {
  dt?: number;
  maxSpeed?: number;
  speed?: number;
  falling?: boolean;
  alive?: boolean;
  stunned?: boolean;
  knockSpeed?: number;
  channel?: number | boolean;
  charge?: number;
  time?: number;
}

export interface CharacterInstanceState {
  root: THREE.Group;
  model: THREE.Object3D;
  mixer: THREE.AnimationMixer;
  actions: Partial<Record<"idle" | "walk" | "run" | ExtraClipName, THREE.AnimationAction | null>>;
  current: THREE.AnimationAction | null | undefined;
  cast: CastAnimator;
  reaction: ReactionAnimator;
  w: { idle: number; walk: number; run: number; death: number; stun: number; knockback: number };
  glyph: THREE.Mesh;
  glyphBaseOpacity: number;
  triggerCast: (archetype: Archetype) => void;
  triggerReaction: (reaction: Reaction) => void;
  dispose: () => void;
  update: (info: CharacterUpdateInfo) => void;
}

export function buildCharacterInstance(color: number, characterId: string = DEFAULT_CHARACTER): THREE.Group | null {
  const id = CHARACTER_ASSETS[characterId] ? characterId : DEFAULT_CHARACTER;
  const template = _templates.get(id) || _template;
  if (!template) return null;

  const root = new THREE.Group();
  const model = cloneSkinned(template.scene);
  root.add(model);

  // Clone materials per instance so the renderer's per-player emissive/charge
  // writes never bleed across players. Original shading is preserved — no tint,
  // no shading override. Player identity is shown by the hero glyph below.
  model.traverse((o3) => {
    const o = o3 as TraversableMesh;
    if ((o.isMesh || o.isSkinnedMesh) && o.material) {
      const wasArray = Array.isArray(o.material);
      const mats: THREE.Material[] = wasArray ? (o.material as THREE.Material[]) : [o.material as THREE.Material];
      const cloned = mats.map((m: THREE.Material) => {
        const c = m.clone();
        c.needsUpdate = true;
        return c;
      });
      o.material = wasArray ? cloned : cloned[0];
    }
  });

  // Warcraft III–style glowing hero glyph at the feet, colored by the player
  // color. Carries multiplayer identity so the model keeps its native colors.
  const glyph = makeHeroGlyph(color);
  root.add(glyph);

  const mixer = new THREE.AnimationMixer(model);
  const actions: CharacterInstanceState["actions"] = {};
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
  // Additive one-shot/looping reaction clips (death/hit/stun/knockback/
  // victory/taunt/idle2). Registered as actions here but left at weight 0 and
  // not auto-played; trigger logic lives in animations.js / player.js.
  for (const name of EXTRA_CLIP_NAMES) {
    const clip = template.clips[name];
    if (clip) actions[name] = make(clip);
  }

  const current = actions.idle || actions.walk || actions.run;
  if (current) current.setEffectiveWeight(1);

  // Capture the model's rest transform so cast overlays are applied relative to
  // it (and so we can ease back to rest when no cast is playing).
  const restPos = model.position.clone();
  const restRot = model.rotation.clone();

  const state: CharacterInstanceState = {
    root,
    model,
    mixer,
    actions,
    current,
    cast: new CastAnimator(),
    reaction: new ReactionAnimator(),
    w: { idle: current === actions.idle ? 1 : 0, walk: 0, run: 0, death: 0, stun: 0, knockback: 0 },
    glyph,
    glyphBaseOpacity: 0.4,
    triggerCast: () => {},
    triggerReaction: () => {},
    dispose: () => {},
    update: () => {},
  };

  // Fire a cast animation archetype (attack/slam/dash/buff/channel). Triggered
  // by the renderer when the simulation reports this warlock cast something.
  state.triggerCast = (archetype) => state.cast.trigger(archetype);

  // Fire a hit-reaction overlay (currently just "hit"). Triggered by the
  // renderer when a "hit" sim event names this player as the victim.
  state.triggerReaction = (reaction) => state.reaction.trigger(reaction);

  // Free the per-instance glyph GPU resources when the player mesh is torn down
  // (renderer.removePlayer calls this). Material.dispose() does NOT free its map.
  state.dispose = () => {
    glyph.geometry.dispose();
    const mat = glyph.material as THREE.MeshBasicMaterial;
    if (mat.map) mat.map.dispose();
    mat.dispose();
  };

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

    // death/stun/knockback fully override the idle/walk/run gait blend above
    // (per locomotionState's priority order); they only play if the matching
    // clip was actually loaded for this character (actions.death etc.).
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

    const blend = 1 - Math.exp(-10 * dt);
    const w = state.w;
    w.idle += (tIdle - w.idle) * blend;
    w.walk += (tWalk - w.walk) * blend;
    w.run += (tRun - w.run) * blend;
    w.death += (tDeath - w.death) * blend;
    w.stun += (tStun - w.stun) * blend;
    w.knockback += (tKnockback - w.knockback) * blend;

    // Hit-reaction is a short overlay rather than a mutually-exclusive state:
    // it plays on top of whatever locomotion/override state is active, so the
    // other weights are scaled down (not zeroed) while it holds.
    state.reaction.update(dt);
    const rw = state.reaction.weight;
    const keep = 1 - rw;

    if (actions.idle) actions.idle.setEffectiveWeight(w.idle * keep);
    if (actions.walk) actions.walk.setEffectiveWeight(w.walk * keep);
    if (actions.run) actions.run.setEffectiveWeight(w.run * keep);
    if (actions.death) actions.death.setEffectiveWeight(w.death * keep);
    if (actions.stun) actions.stun.setEffectiveWeight(w.stun * keep);
    if (actions.knockback) actions.knockback.setEffectiveWeight(w.knockback * keep);
    if (actions.hit) actions.hit.setEffectiveWeight(rw);

    const rate = 1 + (info.charge || 0) * 0.25;
    if (actions.walk) actions.walk.setEffectiveTimeScale(rate);
    if (actions.run) actions.run.setEffectiveTimeScale(rate);

    mixer.update(dt);

    // Layer the cast archetype as a skeleton-agnostic whole-body gesture on top
    // of the locomotion clips. Each archetype reads distinctly without needing a
    // bespoke skinned clip per ability.
    // Hold the "channel" pose while a channel is in progress (info.channel=1).
    if (info.channel && !state.cast.active) state.cast.trigger("channel");
    state.cast.update(dt);
    applyCastOverlay(model, restPos, restRot, state.cast, info);

    // Gentle pulse on the hero glyph; brighten slightly with charge.
    if (state.glyph) {
      const t = info.time || 0;
      const charge = info.charge || 0;
      (state.glyph.material as THREE.MeshBasicMaterial).opacity = state.glyphBaseOpacity + 0.1 * Math.sin(t * 2) + 0.06 * charge;
      state.glyph.scale.setScalar(1 + 0.04 * Math.sin(t * 2.4 + 0.8) + 0.06 * charge);
    }
  };

  root.userData.character = state;
  return root;
}

// Procedural WC3-style hero glyph: a flat additive disc at the feet with a soft
// radial gradient and two faint rune rings, tinted to the player color. Built
// per instance so it can be disposed with the player mesh.
//
// Exported (P4-140) so useWarlockModel.tsx's R3F instantiation path can reuse
// the exact same glyph recipe instead of re-authoring the canvas-gradient
// drawing code a second time.
export function makeHeroGlyph(color: number): THREE.Mesh {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 256;
  const ctx = canvas.getContext("2d")!;
  const cx = 128, cy = 128;
  const grad = ctx.createRadialGradient(cx, cy, 8, cx, cy, 128);
  grad.addColorStop(0, "rgba(255,255,255,0.95)");
  grad.addColorStop(0.35, "rgba(255,255,255,0.45)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 256, 256);
  ctx.strokeStyle = "rgba(255,255,255,0.5)";
  ctx.lineWidth = 4;
  ctx.beginPath(); ctx.arc(cx, cy, 96, 0, Math.PI * 2); ctx.stroke();
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(cx, cy, 70, 0, Math.PI * 2); ctx.stroke();

  const tex = new THREE.CanvasTexture(canvas);
  const mat = new THREE.MeshBasicMaterial({
    map: tex,
    color: new THREE.Color(color),
    transparent: true,
    opacity: 0.4,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
  });
  const geo = new THREE.CircleGeometry(TARGET_HEIGHT * 0.55, 48);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = 0.02;
  mesh.renderOrder = -1;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.frustumCulled = false;
  return mesh;
}

// Distinct whole-body poses per cast archetype, blended in by the CastAnimator
// weight. Applied to the model root so it works on any Meshy skeleton.
function applyCastOverlay(
  model: THREE.Object3D,
  restPos: THREE.Vector3,
  restRot: THREE.Euler,
  cast: CastAnimator,
  info: CharacterUpdateInfo,
): void {
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
