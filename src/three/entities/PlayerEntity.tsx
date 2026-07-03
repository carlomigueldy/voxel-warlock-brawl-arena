// One interpolated player — the R3F sibling of legacy renderer.js's
// per-entry `_ensurePlayerMesh`/update() block (design §3). Owns
// interpolation (§0 CRITICAL: lerp=1-exp(-18dt) on x/z/y, shortest-arc angle
// lerp, rotation.y=-ra+π/2) and computes the `animRef` seam every frame so
// whichever body variant is currently mounted (<WarlockBody> suspended on
// its GLB load, or <VoxelWarlockBody> as the Suspense/ErrorBoundary
// fallback) can read it without PlayerEntity itself needing to know which
// one is live — that's exactly why label/HP-bar/status stay mounted
// unconditionally as siblings, never inside the Suspense boundary.
import { Suspense, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { CFG } from "../../config.js";
import { snapshotRef } from "../../store/snapshotRef";
import type { PlayerMeta } from "../../types";
import { ErrorBoundary } from "../ErrorBoundary";
import { WarlockBody } from "../models/WarlockBody";
import { VoxelWarlockBody } from "./VoxelWarlockBody";
import { NameLabel } from "./NameLabel";
import { HpBar } from "./HpBar";
import { StatusVisuals } from "./StatusVisuals";
import { createDefaultAnimInfo } from "./playerAnim";
import type { Vec2 } from "./entityRegistry";

export interface PlayerEntityProps {
  id: string;
  meta: PlayerMeta | undefined;
}

interface InterpState {
  rx: number;
  rz: number;
  ry: number;
  ra: number;
  seeded: boolean;
}

export function PlayerEntity({ id, meta }: PlayerEntityProps) {
  const grp = useRef<THREE.Group>(null!);
  const interp = useRef<InterpState>({ rx: 0, rz: 0, ry: 0, ra: 0, seeded: false });
  const spd = useRef(0);
  // Stable object identity — entityRegistry's `pos` bus contract (design §2):
  // the owning entity (this component) mutates x/z in place every frame;
  // readers (CameraRig/LightPool/AimBridge/EffectsLayer) just hold a
  // reference. Registration itself happens inside whichever body variant is
  // mounted (design §4), using this same object.
  const posRef = useRef<Vec2>({ x: 0, z: 0 }).current;
  const bodyKindRef = useRef({ usingGLB: false });
  const animRef = useRef(createDefaultAnimInfo(CFG.MOVE_SPEED));

  const color = CFG.COLORS[(meta?.colorIndex ?? 0) % CFG.COLORS.length];

  useFrame((state, rawDt) => {
    const t = snapshotRef.byId.get(id);
    if (!t) return;
    const dt = Math.min(0.05, rawDt);
    const s = interp.current;
    if (!s.seeded) {
      s.rx = t.x;
      s.rz = t.z;
      s.ry = t.y;
      s.ra = t.a;
      s.seeded = true;
    }

    // Entity interp (design §0 CRITICAL): lerp=1-exp(-18dt) on x/z/y.
    const lerp = 1 - Math.exp(-18 * dt);
    const px = s.rx;
    const pz = s.rz;
    s.rx += (t.x - s.rx) * lerp;
    s.rz += (t.z - s.rz) * lerp;
    s.ry += (t.y - s.ry) * lerp;
    // Shortest-arc angle lerp.
    let da = t.a - s.ra;
    while (da > Math.PI) da -= Math.PI * 2;
    while (da < -Math.PI) da += Math.PI * 2;
    s.ra += da * lerp;

    const g = grp.current;
    if (g) {
      g.position.set(s.rx, s.ry, s.rz);
      g.rotation.y = -s.ra + Math.PI / 2;
      g.visible = t.al;
    }

    posRef.x = s.rx;
    posRef.z = s.rz;

    // Speed smoothing (design §0 CRITICAL): players 1-exp(-10dt).
    const inst = Math.hypot(s.rx - px, s.rz - pz) / dt;
    spd.current += (inst - spd.current) * (1 - Math.exp(-10 * dt));

    // Charge tint input (design §0 CRITICAL): c=min(1, target.c/CHARGE_MAX).
    const c = Math.min(1, (t.c || 0) / CFG.CHARGE_MAX);

    const info = animRef.current;
    info.speed = spd.current;
    info.maxSpeed = CFG.MOVE_SPEED;
    info.charge = c;
    info.falling = !!t.f;
    info.dt = dt;
    info.time = state.clock.elapsedTime;
    info.channel = t.ca ? 1 : 0;
    info.alive = t.al !== false;
    info.stunned = (t.st || 0) > 0;
    // Remote players only expose interpolated position, not real velocity,
    // so approximate "being flung" as speed exceeding the normal movement
    // cap (mirrors renderer.js's `Math.max(0, e.spd - CFG.MOVE_SPEED)`).
    info.knockSpeed = Math.max(0, spd.current - CFG.MOVE_SPEED);
  });

  // eslint-disable-next-line react-hooks/exhaustive-deps -- fallback element
  // identity churning every render is harmless (Suspense/ErrorBoundary only
  // read it when they actually need to show it) but memoizing keeps it stable.
  const voxelFallback = useMemo(
    () => <VoxelWarlockBody regId={id} color={color} animRef={animRef} posRef={posRef} bodyKindRef={bodyKindRef} />,
    [id, color, posRef],
  );

  return (
    <group ref={grp}>
      <ErrorBoundary fallback={voxelFallback}>
        <Suspense fallback={voxelFallback}>
          <WarlockBody
            regId={id}
            characterId={meta?.character}
            color={color}
            animRef={animRef}
            posRef={posRef}
            bodyKindRef={bodyKindRef}
          />
        </Suspense>
      </ErrorBoundary>
      <NameLabel name={meta?.name || "warlock"} color={color} bodyKindRef={bodyKindRef} />
      <HpBar id={id} bodyKindRef={bodyKindRef} />
      <StatusVisuals id={id} groupRef={grp} bodyKindRef={bodyKindRef} />
    </group>
  );
}
