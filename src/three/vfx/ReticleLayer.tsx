// The local player's hold-to-aim targeting reticle — R3F port of legacy
// renderer.js's `_updateReticle` (design §5). Reads the same
// `snapshotRef.aim` cache src/input.ts/aimBridge.ts already populate
// (spellId/cursorX/cursorY), builds/positions one src/vfx/reticles.ts
// archetype Group, and — like renderer.js — rebuilds it only when the aimed
// spell changes (rare: a keypress, not a per-frame event); every other
// frame just repositions/recolors the existing instance in place, so
// holding a spell key costs no extra allocation beyond one raycast.
//
// Persistent (design §5 "keyed/persistent ... through declarative
// <PrimitiveFx>"): unlike EffectsLayer's per-event transient groups, only
// ONE reticle is ever alive, so it is parented under a single stable
// <group> ref rather than pooled/reconciled — the R3F sibling of legacy's
// `this.scene.add(this._reticle)`/`remove()` pair, just scoped to this
// component's own subtree instead of the raw THREE.Scene.
import { useEffect, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { SPELLS } from "../../config.js";
import { snapshotRef } from "../../store/snapshotRef";
import { aimBridge } from "../../store/aimBridge";
import { getReticle } from "../../vfx/reticles.js";
import { playerPos } from "../entities/entityRegistry";

// Local mirror of PlayerEntity's shortest-arc angle interpolation (design §0
// CRITICAL: lerp=1-exp(-18dt)) for the LOCAL player only. entityRegistry's
// `pos` bus (design §2) exposes interpolated x/z but not angle — extending
// it is out of this issue's file scope, and legacy's `_updateReticle` reads
// the SAME smoothed `me.ra` the camera/body use, so re-deriving it here
// (rather than the raw, unsmoothed snapshot angle) is the parity-correct
// choice for CONE_SPRAY's `casterAim` facing. Both this ref and
// PlayerEntity's own `interp.ra` consume the identical `snapshotRef.byId`
// angle sequence under the identical R3F frameloop, so they converge to the
// same value every frame.
interface LocalAimAngle {
  ra: number;
  seeded: boolean;
}

export function ReticleLayer() {
  const holderRef = useRef<THREE.Group>(null!);
  const reticleRef = useRef<{ group: THREE.Group | null; spellId: string | null }>({ group: null, spellId: null });
  const localAngle = useRef<LocalAimAngle>({ ra: 0, seeded: false });

  useFrame((_, rawDt) => {
    const dt = Math.min(0.05, rawDt);
    const holder = holderRef.current;
    const rs = reticleRef.current;
    const aim = snapshotRef.aim;
    const spellId = aim.spellId;

    if (!spellId) {
      if (rs.group) rs.group.visible = false;
      return;
    }

    const localId = snapshotRef.localId;
    const casterPos = playerPos(localId);
    const casterSnap = localId ? snapshotRef.byId.get(localId) : undefined;
    if (!casterPos || !casterSnap) {
      if (rs.group) rs.group.visible = false;
      return;
    }

    const entry = getReticle(spellId);
    if (!rs.group || rs.spellId !== spellId) {
      if (rs.group) {
        rs.group.userData.dispose?.();
        holder.remove(rs.group);
      }
      rs.group = entry.build(SPELLS[spellId]?.color as number | undefined);
      rs.spellId = spellId;
      holder.add(rs.group);
    }
    // SELF_BUFF reticles start hidden by design (src/vfx/reticles.ts's
    // buildSelfBuff) since self-casts never enter the aim flow — don't force
    // them visible here, or selecting a self-buff spell would show a faint
    // ring around the player, contradicting that invariant.
    if (entry.archetype !== "SELF_BUFF") rs.group.visible = true;

    // Shortest-arc lerp of the local player's facing, mirroring
    // PlayerEntity's interp.ra formula verbatim (design §0).
    const la = localAngle.current;
    if (!la.seeded) {
      la.ra = casterSnap.a;
      la.seeded = true;
    }
    let da = casterSnap.a - la.ra;
    while (da > Math.PI) da -= Math.PI * 2;
    while (da < -Math.PI) da += Math.PI * 2;
    la.ra += da * (1 - Math.exp(-18 * dt));

    // On-demand ground-plane raycast — reuses AimBridge's own raycast
    // (design §2 AimBridge) via the shared aimBridge singleton rather than
    // duplicating the NDC/plane math, so the reticle's cursor point is
    // always identical to whatever screenToPoint the input layer itself
    // would resolve for the same cursor coordinates.
    const point = aimBridge.screenToPoint?.(aim.cursorX, aim.cursorY) ?? null;

    // Best-effort nearest-enemy lookup for the target-lock/tether
    // archetypes so the reticle previews which foe would actually be
    // affected. Purely visual — no line-of-sight or cone check (those live
    // server-side in src/spells.js's nearestEnemy()/aimedEnemy()) — so this
    // is an approximation, never authoritative over the actual cast.
    let target: { x: number; z: number } | null = null;
    if (entry.archetype === "NEAREST_TARGET_LOCK" || entry.archetype === "TETHER_LOCK") {
      const range = (SPELLS[spellId]?.range as number | undefined) ?? Infinity;
      let bestD = range * range;
      for (const [id, snap] of snapshotRef.byId) {
        if (id === localId || snap.al === false || snap.f) continue;
        const enemyPos = playerPos(id);
        if (!enemyPos) continue;
        const dx = enemyPos.x - casterPos.x, dz = enemyPos.z - casterPos.z;
        const d = dx * dx + dz * dz;
        if (d <= bestD) { bestD = d; target = { x: enemyPos.x, z: enemyPos.z }; }
      }
    }

    // Complete the AimCache contract (snapshotRef.ts's doc comment: "Reticle/
    // targeting cache") so any future on-demand consumer can read the
    // already-resolved point/target instead of re-raycasting.
    aim.point = point;
    aim.target = target;

    rs.group.userData.update?.({
      point,
      casterX: casterPos.x,
      casterZ: casterPos.z,
      casterAim: la.ra,
      range: SPELLS[spellId]?.range as number | undefined,
      radius: SPELLS[spellId]?.radius as number | undefined,
      target,
    });
  });

  useEffect(() => {
    return () => {
      const rs = reticleRef.current;
      if (rs.group) {
        rs.group.userData.dispose?.();
        holderRef.current?.remove(rs.group);
        rs.group = null;
        rs.spellId = null;
      }
    };
  }, []);

  return <group ref={holderRef} />;
}
