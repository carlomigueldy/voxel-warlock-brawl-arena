// Status auras — ported from renderer.js's _applyStatusVisuals + the
// stun-halo spin/bob block in update() (design §3). Wind Walk/Shadow Veil
// dim every material with an `.opacity` field on the WHOLE PlayerEntity
// group (label/HP-bar sprites included, exactly like legacy's ungated
// `e.group.traverse`) for remote players only; the shield bubble and stun
// stars stay always-mounted and toggle `.visible` each frame (imperative,
// non-reactive — snapshotRef fields never trigger a React re-render).
import { useFrame } from "@react-three/fiber";
import { useRef, type MutableRefObject } from "react";
import * as THREE from "three";
import { CFG } from "../../config.js";
import { snapshotRef } from "../../store/snapshotRef";
import { DECAL_COLORS } from "../materials/palette";

export interface StatusVisualsProps {
  id: string;
  /** The outer <PlayerEntity> group — WW/invisible dimming traverses this
   * whole subtree (label/HP-bar included), matching legacy's `e.group`. */
  groupRef: MutableRefObject<THREE.Group | null>;
  bodyKindRef: MutableRefObject<{ usingGLB: boolean }>;
}

const GLB_STUN_Y = CFG.PLAYER_HEIGHT + 0.3;
const VOXEL_STUN_Y = 2.6;
const STUN_COUNT = 5;

type OpacityMaterial = THREE.Material & { opacity: number; transparent: boolean };

function setGroupOpacity(root: THREE.Object3D, opacity: number): void {
  root.traverse((o) => {
    const mat = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
    if (!mat) return;
    const mats = Array.isArray(mat) ? mat : [mat];
    for (const m of mats) {
      if (!("opacity" in m)) continue;
      const om = m as OpacityMaterial;
      if (opacity < 1) om.transparent = true;
      om.opacity = opacity;
    }
  });
}

export function StatusVisuals({ id, groupRef, bodyKindRef }: StatusVisualsProps) {
  const shieldRef = useRef<THREE.Mesh>(null!);
  const stunRef = useRef<THREE.Group>(null!);
  const wasWW = useRef(false);
  const wasInvis = useRef(false);

  useFrame((state, rawDt) => {
    const t = snapshotRef.byId.get(id);
    const root = groupRef.current;
    if (!t || !root) return;
    const dt = Math.min(0.05, rawDt);

    // Wind Walk: enemies see them faint; the local player stays visible.
    const isLocal = id === snapshotRef.localId;
    const onWW = !!t.ww && !isLocal;
    if (onWW) {
      setGroupOpacity(root, 0.25);
    } else if (wasWW.current) {
      setGroupOpacity(root, 1);
    }
    wasWW.current = onWW;

    // Shadow Veil (invisible): enemies see the caster nearly hidden; local
    // player stays fully opaque.
    const onInvis = !!t.iv && !isLocal;
    if (onInvis) {
      setGroupOpacity(root, 0.1);
    } else if (wasInvis.current && !onInvis) {
      setGroupOpacity(root, 1);
    }
    wasInvis.current = onInvis;

    if (shieldRef.current) shieldRef.current.visible = !!t.sh;

    const stunned = (t.st || 0) > 0;
    const stun = stunRef.current;
    if (stun) {
      stun.visible = stunned;
      if (stunned) {
        stun.position.y = bodyKindRef.current.usingGLB ? GLB_STUN_Y : VOXEL_STUN_Y;
        const time = state.clock.elapsedTime;
        stun.rotation.y += dt * 5;
        for (let i = 0; i < stun.children.length; i++) {
          stun.children[i].position.y = Math.sin(time * 8 + i * 1.26) * 0.18;
        }
      }
    }
  });

  return (
    <>
      <mesh ref={shieldRef} position={[0, 1.0, 0]} visible={false}>
        <sphereGeometry args={[1.6, 12, 10]} />
        <meshBasicMaterial color={DECAL_COLORS.shield} transparent opacity={0.25} wireframe />
      </mesh>
      <group ref={stunRef} visible={false}>
        {Array.from({ length: STUN_COUNT }, (_, i) => {
          const a = (i / STUN_COUNT) * Math.PI * 2;
          return (
            <mesh key={i} position={[Math.cos(a) * 0.6, 0, Math.sin(a) * 0.6]}>
              <boxGeometry args={[0.2, 0.2, 0.2]} />
              <meshBasicMaterial color={DECAL_COLORS.stunStar} />
            </mesh>
          );
        })}
      </group>
    </>
  );
}
