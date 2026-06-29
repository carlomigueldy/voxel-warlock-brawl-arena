// The arena: a shrinking voxel platform over a lava sea.
// Owns both the logical radius (used by the simulation) and the visuals.
import * as THREE from "three";
import { CFG, getArenaWorld, isOnArenaWorld } from "./config.js";
import { buildPlatform, buildLava, animateLava } from "./voxel.js";

export class Arena {
  constructor(scene) {
    this.scene = scene;
    this.world = getArenaWorld(CFG.DEFAULT_ARENA_WORLD);
    this.radius = CFG.ARENA_RADIUS;
    this._builtRadius = -1;
    this._builtWorld = null;
    this.platform = null;
    this.lava = buildLava(160, CFG.LAVA_Y);
    scene.add(this.lava);
    this.rebuild();
  }

  setWorld(worldId) {
    const world = getArenaWorld(worldId);
    if (world.id === this.world.id) return;
    this.world = world;
    this.rebuild();
  }

  setRadius(r) {
    this.radius = Math.max(CFG.ARENA_MIN_RADIUS, r);
    // Only rebuild the (relatively expensive) mesh when it changed meaningfully.
    if (Math.abs(this.radius - this._builtRadius) >= 0.75 || this.world.id !== this._builtWorld) this.rebuild();
  }

  rebuild() {
    if (this.platform) {
      this.scene.remove(this.platform);
      this.platform.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) o.material.dispose?.();
      });
    }
    this.platform = buildPlatform(this.radius, this.world.id);
    this.scene.add(this.platform);
    this._builtRadius = this.radius;
    this._builtWorld = this.world.id;
  }

  // Is a point (x,z) still on solid ground?
  isOnPlatform(x, z) {
    return isOnArenaWorld(this.world.id, this.radius, x, z);
  }

  update(t) {
    animateLava(this.lava, t);
  }

  reset(radius = CFG.ARENA_RADIUS, worldId = CFG.DEFAULT_ARENA_WORLD) {
    this.world = getArenaWorld(worldId);
    this.radius = radius;
    this.rebuild();
  }
}
