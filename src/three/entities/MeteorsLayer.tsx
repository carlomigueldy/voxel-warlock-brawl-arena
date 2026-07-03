// Maps live meteor ids (useRosterStore.meteorIds — spawn/despawn only,
// design §3) to one keyed telegraphed-falling-rock entity — the R3F port of
// legacy renderer.js's apply()+update() pair for `this.meteorMeshes`.
//
// buildMeteor(x, z, fall, radius, color) bakes the meteor's spawn x/z and
// total fall duration into the returned Group at construction time (a
// meteor only ever falls straight down at its launch point — there is no
// live x/z to re-read), matching legacy's `if (!g) { g = buildMeteor(...); }`
// build-if-absent call site: the Group is built ONCE from the spawn
// snapshot's values, not repositioned every frame like bolts/items.
import { useEffect, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import { useRosterStore } from "../../store/useRosterStore";
import { snapshotRef } from "../../store/snapshotRef";
import { buildMeteor } from "../../voxel.js";

// Legacy renderer.js's apply() hardcodes this color for every meteor
// regardless of source spell — MeteorSnap carries no color field.
const METEOR_COLOR = 0xff3a1e;

function MeteorEntity({ id }: { id: number }) {
  const group = useMemo(() => {
    const mt = snapshotRef.current?.meteors.find((m) => m.id === id);
    return buildMeteor(mt?.x ?? 0, mt?.z ?? 0, mt?.fall ?? 1, mt?.r ?? 4, METEOR_COLOR);
  }, [id]);

  useEffect(() => {
    return () => group.userData.dispose?.();
  }, [group]);

  useFrame(() => {
    const mt = snapshotRef.current?.meteors.find((m) => m.id === id);
    if (!mt) return;
    // dt hardcoded to 0 — legacy's apply() sync pass calls
    // `g.userData.update(0, mt.t)` every frame (design §0: reproduce
    // byte-for-byte), so the fall/ring/light animation is driven purely by
    // mt.t (the snapshot's remaining-fall-time field) rather than real
    // elapsed render time; buildMeteor's update(dt, tLeft) derives its
    // progress fraction from tLeft alone.
    group.userData.update(0, mt.t);
  });

  return <primitive object={group} />;
}

export function MeteorsLayer() {
  const meteorIds = useRosterStore((s) => s.meteorIds);
  return (
    <>
      {meteorIds.map((id) => (
        <MeteorEntity key={id} id={id} />
      ))}
    </>
  );
}
