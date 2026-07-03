// Maps useRosterStore's id array -> keyed <PlayerEntity> (design §3). Only
// spawn/despawn (a player joining/leaving) re-renders this component — every
// per-frame motion/animation update happens inside <PlayerEntity>'s own
// useFrame, reading snapshotRef directly, never subscribing to a store.
import { useRosterStore } from "../../store/useRosterStore";
import { PlayerEntity } from "./PlayerEntity";

export function PlayersLayer() {
  const ids = useRosterStore((s) => s.playerIds);
  const meta = useRosterStore((s) => s.meta);
  return (
    <>
      {ids.map((id) => (
        <PlayerEntity key={id} id={id} meta={meta[id]} />
      ))}
    </>
  );
}
