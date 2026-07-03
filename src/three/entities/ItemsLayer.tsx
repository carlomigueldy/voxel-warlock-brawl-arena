// Maps live item-drop ids (useRosterStore.itemIds — spawn/despawn only,
// design §3) to one keyed pickup entity — the R3F port of legacy
// renderer.js's apply()+update() pair for `this.itemMeshes`.
//
// Unlike meteors (position baked at spawn), an item drop's Group is built
// ONCE (shape/color/rarity/label — build-if-absent, matching legacy's
// `if (!g) { g = buildItemDrop(...); }`) but repositioned from the LIVE
// snapshot every frame, same as bolts (design §3: no interpolation) — items
// don't currently move once dropped, so this is a no-op position write most
// frames, exactly mirroring legacy's unconditional `g.position.set(it.x,
// 0.25, it.z)` inside its per-frame sync pass. The bob/spin/rarity-pulse
// animation itself runs on REAL per-frame dt via buildItemDrop's own
// userData.update (animatePickup) — legacy's separate update() pass.
import { useEffect, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { useRosterStore } from "../../store/useRosterStore";
import { snapshotRef } from "../../store/snapshotRef";
import { buildItemDrop } from "../../voxel.js";

// Canvas-sprite name label — legacy renderer.js's `_makeLabel(name, color, y)`
// (renderer.js is golden/untouched, so this is a local, scoped copy rather
// than a shared export; NameLabel.tsx, the shared player-label component, is
// p4-warlocks/#144-owned and doesn't exist yet). Byte-identical recipe.
function makeItemLabel(name: string, color: number, y = 3.4): THREE.Sprite {
  const cv = document.createElement("canvas");
  cv.width = 256;
  cv.height = 64;
  // null in test environments without the optional `canvas` npm package
  // (jsdom's HTMLCanvasElement.getContext stubs to null rather than
  // throwing) — real browsers always return a context here, so this only
  // guards scene-graph smoke tests from crashing, never changes on-screen
  // output.
  const ctx = cv.getContext("2d");
  if (ctx) {
    ctx.font = "bold 36px Trebuchet MS, sans-serif";
    ctx.textAlign = "center";
    ctx.fillStyle = "#000";
    ctx.lineWidth = 6;
    ctx.strokeStyle = "rgba(0,0,0,0.8)";
    ctx.strokeText(name, 128, 44);
    ctx.fillStyle = "#" + new THREE.Color(color).getHexString();
    ctx.fillText(name, 128, 44);
  }
  const tex = new THREE.CanvasTexture(cv);
  const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true }));
  spr.scale.set(3, 0.75, 1);
  spr.position.y = y;
  return spr;
}

function ItemEntity({ id }: { id: number }) {
  const group = useMemo(() => {
    const it = snapshotRef.current?.items.find((i) => i.id === id);
    const g = buildItemDrop(it?.shape || "orb", it?.c || 0xffffff, { rarity: it?.rarity });
    const label = makeItemLabel(it?.name || "Item", it?.c || 0xffffff, 1.65);
    g.add(label);
    g.userData.label = label;
    return g;
  }, [id]);

  useEffect(() => {
    return () => group.userData.dispose?.();
  }, [group]);

  useFrame((_, rawDt) => {
    const dt = Math.min(0.05, rawDt);
    const it = snapshotRef.current?.items.find((i) => i.id === id);
    if (!it) return;
    // NOT interpolated — position DIRECT from the current snapshot every
    // frame (design §0/§3: same no-lerp contract as bolts).
    group.position.set(it.x, 0.25, it.z);
    group.userData.update?.(dt);
  });

  return <primitive object={group} />;
}

export function ItemsLayer() {
  const itemIds = useRosterStore((s) => s.itemIds);
  return (
    <>
      {itemIds.map((id) => (
        <ItemEntity key={id} id={id} />
      ))}
    </>
  );
}
