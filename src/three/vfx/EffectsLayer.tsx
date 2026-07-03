// Drains one snapshot tick's `events` (design §5) and renders every VFX/SFX/
// shake/animation-trigger they imply — the R3F sibling of legacy
// renderer.js's `update()` calling `this._processEvents(events)` each new
// snapshot, plus its own per-frame `for (effect of this.effects) update/
// dispose` loop. All switch-case dispatch itself lives in the pure
// eventToEffects.ts (near-verbatim port of `_processEvents`); this file's
// only job is wiring the concrete EventFxCtx (makeEventFxCtx, closing over
// entityRegistry/snapshotRef/getAudio the way legacy closed over `this`) and
// running the imperative fxRoot <group> the ~40 event handlers add into.
import { useEffect, useMemo, useRef, type MutableRefObject } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { CFG } from "../../config.js";
import { archetypeForEvent, reactionForEvent } from "../../animations.js";
import { snapshotRef, consumeEvents } from "../../store/snapshotRef";
import { getAudio } from "../../services/registry";
import {
  player as registryPlayer,
  mob as registryMob,
  playerPos as entityPlayerPos,
  nearestMob,
} from "../entities/entityRegistry";
import { burstAt, ringPulse, vfxCtx, type EffectAdder } from "../fx/builders";
import { applyEvents, type EventFxCtx } from "./eventToEffects";

// One ctx per EffectsLayer instance, built once and reused every frame —
// `fxRootRef`/`effects` are stable identities (refs), so `addEffect`'s
// closure always sees the live fxRoot even though it's read lazily (the
// group isn't attached until after the first commit).
function makeEventFxCtx(fxRootRef: MutableRefObject<THREE.Group | null>, effects: THREE.Object3D[]): EventFxCtx {
  const addEffect: EffectAdder = (effect) => {
    if (!effect) return;
    const fxRoot = fxRootRef.current;
    if (!fxRoot) return;
    fxRoot.add(effect);
    effects.push(effect);
  };

  return {
    addEffect,
    burstAt,
    ringPulse,
    vfxCtx: (x, z, extra) => vfxCtx(addEffect, x, z, extra),
    playSfx: (name, pan) => getAudio().play(name, pan),
    // Port of `_panFor`: same Math.max(CFG.ARENA_MIN_RADIUS, ...) floor
    // ArenaFloor already applies when syncing Arena.radius from arenaR.
    panFor: (x) => {
      const arenaR = Math.max(CFG.ARENA_MIN_RADIUS, snapshotRef.current?.arenaR ?? CFG.ARENA_RADIUS);
      return Math.max(-1, Math.min(1, x / arenaR));
    },
    // Port of the inline `this._shake = Math.min(cap, this._shake + add)` —
    // CameraRig owns the decay half (design §0/§2 split).
    addShake: (add, cap) => {
      snapshotRef.shake = Math.min(cap, snapshotRef.shake + add);
    },
    triggerCast: (ev) => {
      const resolved = archetypeForEvent(ev);
      if (!resolved) return;
      registryPlayer(resolved.id)?.triggerCast(resolved.archetype);
    },
    triggerReaction: (ev) => {
      const resolved = reactionForEvent(ev);
      if (!resolved) return;
      registryPlayer(resolved.id)?.triggerReaction(resolved.reaction);
    },
    triggerMobAttack: (mobId) => {
      registryMob(mobId)?.triggerAttack();
    },
    triggerMobAttackNear: (mobType, x, z) => {
      const id = nearestMob(mobType, x, z);
      if (id) registryMob(id)?.triggerAttack();
    },
    posForId: (id, x, z) => {
      if (x !== undefined && z !== undefined) return { x, z };
      return entityPlayerPos(id) ?? { x: 0, z: 0 };
    },
    playerPos: (id) => entityPlayerPos(id),
    // Port of `effectPos(...).color`: the player's own body colour (design
    // §3's `COLORS[colorIndex % length]`), or white when the id has no
    // known meta (mirrors legacy's "mesh already gone" fallback).
    colorForId: (id) => {
      const meta = snapshotRef.meta.get(id);
      return meta ? CFG.COLORS[(meta.colorIndex ?? 0) % CFG.COLORS.length] : 0xffffff;
    },
  };
}

export function EffectsLayer() {
  const fxRootRef = useRef<THREE.Group>(null);
  const effectsRef = useRef<THREE.Object3D[]>([]);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- fxRootRef/effectsRef
  // are stable ref objects; the ctx built from them never needs to change.
  const ctx = useMemo(() => makeEventFxCtx(fxRootRef, effectsRef.current), []);

  useFrame((_, rawDt) => {
    const dt = Math.min(0.05, rawDt);
    applyEvents(consumeEvents(), ctx);

    const effects = effectsRef.current;
    for (const g of effects) (g.userData.update as ((dt: number) => void) | undefined)?.(dt);

    // Filter done -> dispose + remove (legacy's equivalent `this.effects =
    // this.effects.filter(...)` sweep, run in place to avoid a per-frame
    // array allocation).
    for (let i = effects.length - 1; i >= 0; i--) {
      const g = effects[i];
      if (g.userData.done) {
        (g.userData.dispose as (() => void) | undefined)?.();
        fxRootRef.current?.remove(g);
        effects.splice(i, 1);
      }
    }
  });

  // Dispose any still-live transient VFX on unmount — legacy never tears
  // down mid-session (renderer.js has no destroy path), but an R3F
  // match/HMR unmount can happen with effects still in flight, and leaving
  // their GPU resources behind would leak across that boundary.
  useEffect(() => {
    const effects = effectsRef.current;
    return () => {
      for (const g of effects) (g.userData.dispose as (() => void) | undefined)?.();
      effects.length = 0;
    };
  }, []);

  return <group ref={fxRootRef} />;
}
