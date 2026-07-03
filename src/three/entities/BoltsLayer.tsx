// Maps the live bolt id set (useRosterStore.boltIds — spawn/despawn only,
// design §3) to one keyed <BoltEntity> per traveling projectile. Motion,
// spin, and pooled-trail ticking all live in <BoltEntity>'s own useFrame;
// this layer only ever re-renders when a bolt spawns or despawns, mirroring
// <PlayersLayer>'s pattern for the entity kinds that DO interpolate.
import { useRosterStore } from "../../store/useRosterStore";
import { BoltEntity } from "./BoltEntity";

export function BoltsLayer() {
  const boltIds = useRosterStore((s) => s.boltIds);
  return (
    <>
      {boltIds.map((id) => (
        <BoltEntity key={id} id={id} />
      ))}
    </>
  );
}
