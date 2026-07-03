// Fog + background + hazard under-glow — the "which planet am I on" layer
// (design §0). Owns the same THREE.Fog/background/PointLight legacy
// renderer.js's ctor + _applyHazardTheme own, re-themed on the active
// hazard's id changing (dedup by id, exactly like _applyHazardTheme's
// `this._hazardId === hazard.id` early return).
import { useEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { getArenaHazard } from "../config.js";
import { snapshotRef } from "../store/snapshotRef";

export function Environment() {
  const { scene } = useThree((state) => ({ scene: state.scene }));
  const glowRef = useRef<THREE.PointLight>(null);
  const hazardIdRef = useRef<string | null>(null);

  // Ctor defaults (design §0): background=0x0d0b1a, Fog(0x0d0b1a,40,90) —
  // re-themed below once a snapshot with an arenaWorld arrives.
  useEffect(() => {
    scene.background = new THREE.Color(0x0d0b1a);
    scene.fog = new THREE.Fog(0x0d0b1a, 40, 90);
    return () => {
      scene.fog = null;
      scene.background = null;
    };
  }, [scene]);

  useFrame(() => {
    // Mirrors legacy apply(snapshot){ if(!snapshot) return; ... } — no
    // hazard theme is applied until a real snapshot exists (menu screen
    // stays on the ctor defaults above, same as legacy).
    const snap = snapshotRef.current;
    if (!snap) return;
    const hazard = getArenaHazard(snap.arenaWorld);
    if (!hazard || hazardIdRef.current === hazard.id) return;
    hazardIdRef.current = hazard.id;

    if (glowRef.current) glowRef.current.color.setHex(hazard.glow ?? hazard.color);
    const fogHex = hazard.fog ?? 0x0d0b1a;
    scene.background = new THREE.Color(fogHex);
    if (scene.fog && "color" in scene.fog) (scene.fog as THREE.Fog).color.setHex(fogHex);
  });

  // Hazard glow from below — color is re-themed per map above.
  return <pointLight ref={glowRef} args={[0xff3a1e, 0.8, 60]} position={[0, -6, 0]} />;
}
