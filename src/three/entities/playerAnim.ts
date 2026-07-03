// Canonical per-frame animation input for a warlock body (design §3 "animRef
// seam"). ONE shared interface — not two structurally-similar ones — so
// <PlayerEntity>'s single `animRef` object can be handed unmodified to
// whichever body variant (<WarlockBody>/<VoxelWarlockBody>) is currently
// mounted: React.MutableRefObject<T> is invariant in T (its `current`
// property is read/write), so two merely-structurally-compatible interfaces
// would NOT let the same ref satisfy both bodies' prop types even though the
// object shapes line up. Superset of legacy's two duck-typed `state` shapes
// (voxel.ts's VoxelAnimState, character.ts's CharacterUpdateInfo) — every
// field required (not optional) since PlayerEntity always fills all of them
// every frame before either body reads animRef.current.
export interface PlayerAnimInfo {
  speed: number;
  maxSpeed: number;
  /** already clamped to 0..1 — Math.min(1, target.c / CFG.CHARGE_MAX) */
  charge: number;
  falling: boolean;
  dt: number;
  /** 0 or 1 — truthy target.ca (design §0: renderer.js's `e.target.ca ? 1 : 0`) */
  channel: number;
  alive: boolean;
  stunned: boolean;
  knockSpeed: number;
  time: number;
}

export function createDefaultAnimInfo(maxSpeed: number): PlayerAnimInfo {
  return {
    speed: 0,
    maxSpeed,
    charge: 0,
    falling: false,
    dt: 0,
    channel: 0,
    alive: true,
    stunned: false,
    knockSpeed: 0,
    time: 0,
  };
}
