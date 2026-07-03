// Maps the roster's mob id array to keyed <MobEntity> instances (design §3)
// — only spawn/despawn (a mob id entering/leaving useRosterStore.mobIds)
// re-renders this layer; all per-frame motion/animation lives inside
// MobEntity's own useFrame reading snapshotRef directly.
import { useRosterStore } from "../../store/useRosterStore";
import { MobEntity } from "./MobEntity";

export function MobsLayer() {
  const ids = useRosterStore((s) => s.mobIds);
  return (
    <>
      {ids.map((id) => (
        <MobEntity key={id} id={id} />
      ))}
    </>
  );
}
