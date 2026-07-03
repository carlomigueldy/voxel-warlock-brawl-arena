// Billboarded HP bar — ported from renderer.js's _makeHpBar + the per-frame
// fill scale/color/billboard block in update() (design §0/§3). Mesh/Group-
// based (not a Sprite), so it needs the explicit
// `quaternion.copy(camera.quaternion)` legacy applies every frame.
import { useFrame, useThree } from "@react-three/fiber";
import { useRef, type MutableRefObject } from "react";
import * as THREE from "three";
import { CFG } from "../../config.js";
import { snapshotRef } from "../../store/snapshotRef";
import { DECAL_COLORS } from "../materials/palette";

export interface HpBarProps {
  id: string;
  bodyKindRef: MutableRefObject<{ usingGLB: boolean }>;
}

const GLB_LABEL_Y = CFG.PLAYER_HEIGHT + 0.55;
const VOXEL_LABEL_Y = 3.4;
const BAR_W = 1.4;
const BAR_H = 0.16;

export function HpBar({ id, bodyKindRef }: HpBarProps) {
  const camera = useThree((s) => s.camera);
  const groupRef = useRef<THREE.Group>(null!);
  const fillRef = useRef<THREE.Mesh>(null!);

  useFrame(() => {
    const grp = groupRef.current;
    if (!grp) return;
    // labelY - 0.35, mirroring _ensurePlayerMesh's `this._makeHpBar(labelY - 0.35)`.
    grp.position.y = (bodyKindRef.current.usingGLB ? GLB_LABEL_Y : VOXEL_LABEL_Y) - 0.35;
    grp.quaternion.copy(camera.quaternion);

    const t = snapshotRef.byId.get(id);
    const fill = fillRef.current;
    if (!t || !fill) return;
    const frac = t.mhp ? Math.max(0, Math.min(1, (t.hp ?? t.mhp) / t.mhp)) : 1;
    fill.scale.x = frac;
    fill.position.x = -(BAR_W * (1 - frac)) / 2; // anchor-left shrink
    const mat = fill.material as THREE.MeshBasicMaterial;
    mat.color.setRGB(frac > 0.5 ? (1 - frac) * 2 : 1, frac > 0.5 ? 1 : frac * 2, 0.18);
  });

  return (
    <group ref={groupRef} renderOrder={999}>
      <mesh>
        <planeGeometry args={[BAR_W, BAR_H]} />
        <meshBasicMaterial color={DECAL_COLORS.hpBg} transparent opacity={0.8} depthTest={false} />
      </mesh>
      <mesh ref={fillRef} position={[0, 0, 0.001]}>
        <planeGeometry args={[BAR_W, BAR_H * 0.7]} />
        <meshBasicMaterial color={DECAL_COLORS.hpFill} depthTest={false} />
      </mesh>
    </group>
  );
}
