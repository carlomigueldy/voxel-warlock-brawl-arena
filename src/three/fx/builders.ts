// Pure leaf builders shared by eventToEffects.ts (design §5) — near-verbatim
// ports of legacy renderer.js's `_burstAt`/`_ringPulse`/`_vfxCtx` methods.
// `burstAt`/`ringPulse` need no renderer state (they only build + position a
// transient THREE.Group/Mesh and hand it back — legacy never called
// `this._addEffect` from inside them either, the caller always does that
// separately). `vfxCtx` is the one exception: legacy's `_vfxCtx` closes over
// `this._addEffect`, so the ported version takes the same binding as an
// explicit parameter instead of a `this` reference — EffectsLayer's
// makeEventFxCtx (the only real caller) passes its own effects-array
// `addEffect`, exactly mirroring `this._addEffect.bind(this)` there.
import * as THREE from "three";
import { buildBurst } from "../../voxel.js";
import type { VfxCtx } from "../../vfx/duotone.js";

/** Options accepted by buildBurst (voxel.ts keeps its own opts interface
 * unexported — this borrows its shape rather than duplicating the fields). */
export type BurstOpts = Parameters<typeof buildBurst>[1];

export type EffectAdder = (effect: THREE.Object3D | null | undefined) => void;

/** Port of legacy renderer.js's `_burstAt`: build a colour burst and place it. */
export function burstAt(x: number, z: number, color: number, opts: BurstOpts = {}, y = 1.0): THREE.Group {
  const g = buildBurst(color, opts);
  g.position.set(x, y, z);
  return g;
}

/** Port of legacy renderer.js's `_ringPulse`: an expanding, fading ground ring. */
export function ringPulse(x: number, z: number, radius: number, color: number): THREE.Mesh {
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.2, 0.5, 32),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.7, side: THREE.DoubleSide }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.set(x, 0.15, z);
  ring.userData.t = 0;
  ring.userData.life = 0.6;
  ring.userData.done = false;
  ring.userData.update = (dt: number) => {
    ring.userData.t += dt;
    const k = ring.userData.t / ring.userData.life;
    ring.scale.setScalar(1 + k * radius * 2);
    (ring.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 0.7 * (1 - k));
    if (k >= 1) ring.userData.done = true;
  };
  return ring;
}

/** Port of legacy renderer.js's `_vfxCtx`: the ctx object src/vfx/*.ts's
 * VFX_REGISTRY cast(ctx)/impact(ctx) builders expect — `{ x, z, addEffect,
 * ringPulse, burstAt, ...extra }`. `ringPulse`/`burstAt` reuse this module's
 * own pure builders directly (legacy: `this._ringPulse.bind(this)`/
 * `this._burstAt.bind(this)`, same object's own methods); `addEffect` is
 * the one binding that must reach the caller's actual effects sink, so it's
 * injected rather than assumed. */
export function vfxCtx(addEffect: EffectAdder, x: number, z: number, extra: Record<string, unknown> = {}): VfxCtx {
  // `color` is always supplied via `extra` at every real call site (every
  // eventToEffects.ts case passes `{ color: vfx.color, ... }`) but isn't
  // statically provable from a loosely-typed `extra` bag — same trust
  // contract legacy's untyped `_vfxCtx(x, z, extra)` had.
  return {
    x,
    z,
    addEffect,
    ringPulse,
    burstAt,
    ...extra,
  } as unknown as VfxCtx;
}
