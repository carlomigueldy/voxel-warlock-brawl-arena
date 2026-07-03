// Player name tag — ported from renderer.js's _makeLabel (design §3). A
// THREE.Sprite auto-billboards (always faces the camera) with no manual
// quaternion copy needed, exactly like legacy — only the HP bar/social
// overlays (Mesh/Group-based, not Sprite) need the explicit
// `quaternion.copy(camera.quaternion)` legacy's update() loop does for them.
import { useEffect, useMemo, useRef, type MutableRefObject } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { CFG } from "../../config.js";

export interface NameLabelProps {
  name: string;
  color: number;
  /** GLB vs voxel body Y offset differs (design §3) — read every frame so the
   * label repositions the instant the body suspends/resolves/falls back. */
  bodyKindRef: MutableRefObject<{ usingGLB: boolean }>;
}

const GLB_LABEL_Y = CFG.PLAYER_HEIGHT + 0.55;
const VOXEL_LABEL_Y = 3.4;

function makeLabelTexture(name: string, color: number): THREE.CanvasTexture {
  const cv = document.createElement("canvas");
  cv.width = 256;
  cv.height = 64;
  const ctx = cv.getContext("2d")!;
  ctx.font = "bold 36px Trebuchet MS, sans-serif";
  ctx.textAlign = "center";
  ctx.fillStyle = "#000";
  ctx.lineWidth = 6;
  ctx.strokeStyle = "rgba(0,0,0,0.8)";
  ctx.strokeText(name, 128, 44);
  ctx.fillStyle = "#" + new THREE.Color(color).getHexString();
  ctx.fillText(name, 128, 44);
  return new THREE.CanvasTexture(cv);
}

export function NameLabel({ name, color, bodyKindRef }: NameLabelProps) {
  const spriteRef = useRef<THREE.Sprite>(null!);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- texture is a pure
  // function of (name, color); canvas draw is cheap and this only reruns when
  // either input actually changes (name edits, color re-roll).
  const texture = useMemo(() => makeLabelTexture(name, color), [name, color]);

  useEffect(() => () => texture.dispose(), [texture]);

  useFrame(() => {
    if (spriteRef.current) {
      spriteRef.current.position.y = bodyKindRef.current.usingGLB ? GLB_LABEL_Y : VOXEL_LABEL_Y;
    }
  });

  return (
    <sprite ref={spriteRef} scale={[3, 0.75, 1]}>
      <spriteMaterial map={texture} transparent />
    </sprite>
  );
}
