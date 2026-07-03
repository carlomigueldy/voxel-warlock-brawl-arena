// The declarative scene root, mounted inside <GameCanvas>'s <Canvas>
// (design §2). Composition order mirrors legacy renderer.js's construction
// order (lights/environment first, then world geometry, then entities, then
// transient VFX/reticle on top) — order doesn't affect correctness in R3F
// (draw order is depth-sorted, not scene-graph order) but keeps this file
// readable as "back to front."
//
// Every *Layer/ArenaFloor/MapLayout/EffectsLayer/ReticleLayer import below is
// currently a null-returning STUB (P4a, #137) — each is REPLACED in place by
// its own owning P4 issue (#139–#147, see the file header comment in each
// stub) without this file needing another edit, so those issues can land in
// parallel without contending on Scene.tsx.
import { CameraRig } from "./CameraRig";
import { LightPool } from "./LightPool";
import { Environment } from "./Environment";
import { AimBridge } from "./AimBridge";
import { ArenaFloor } from "./map/ArenaFloor";
import { MapLayout } from "./map/MapLayout";
import { PlayersLayer } from "./entities/PlayersLayer";
import { MobsLayer } from "./entities/MobsLayer";
import { BoltsLayer } from "./entities/BoltsLayer";
import { MeteorsLayer } from "./entities/MeteorsLayer";
import { ItemsLayer } from "./entities/ItemsLayer";
import { EffectsLayer } from "./vfx/EffectsLayer";
import { ReticleLayer } from "./vfx/ReticleLayer";

export function Scene() {
  return (
    <>
      <Environment />
      <LightPool />
      <CameraRig />
      <AimBridge />
      <ArenaFloor />
      <MapLayout />
      <PlayersLayer />
      <MobsLayer />
      <BoltsLayer />
      <MeteorsLayer />
      <ItemsLayer />
      <EffectsLayer />
      <ReticleLayer />
    </>
  );
}
