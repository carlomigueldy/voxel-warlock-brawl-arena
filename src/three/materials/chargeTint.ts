// Charge tint (design §0 CRITICAL, byte-for-byte): renderer.js's update()
// loop traverses every player mesh each frame and, for any material carrying
// an `.emissive` color, sets it via `emissive.setRGB(c*0.6, c*0.1, 0)` where
// `c = Math.min(1, target.c / CFG.CHARGE_MAX)` — hotter charge reads as a
// warmer/whiter glow on every emissive-capable surface (item cores, eyes,
// GLB accent materials, ...).
//
// Legacy runs this traversal on the whole player group (label/HP-bar
// materials included, but those never carry `.emissive` so it's a no-op for
// them); the R3F port moves it inside each body variant's own useFrame
// instead (design §3: "Charge tint inside body (owns cloned materials)") —
// functionally identical since only body meshes ever have emissive
// materials, and keeps VoxelWarlockBody/WarlockBody from reaching outside
// their own subtree.
import * as THREE from "three";

type TintableMaterial = THREE.Material & { emissive?: THREE.Color };

export function applyChargeTint(root: THREE.Object3D, charge: number): void {
  const c = Math.min(1, Math.max(0, charge || 0));
  root.traverse((o) => {
    const mat = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
    if (!mat) return;
    const mats = Array.isArray(mat) ? mat : [mat];
    for (const m of mats) {
      const tintable = m as TintableMaterial;
      if (tintable.emissive) tintable.emissive.setRGB(c * 0.6, c * 0.1, 0);
    }
  });
}
