// The arena: a shrinking voxel platform over a lava sea.
// Owns both the logical radius (used by the simulation) and the visuals.
import * as THREE from "three";
import { CFG } from "./config.js";
import { buildPlatform, buildLava, animateLava } from "./voxel.js";

export class Arena {
  constructor(scene) {
    this.scene = scene;
    this.radius = CFG.ARENA_RADIUS;
    this._builtRadius = -1;
    this.platform = null;
    this.lava = buildLava(160, CFG.LAVA_Y);
    scene.add(this.lava);
    this.rebuild();
  }

  setRadius(r) {
    this.radius = Math.max(CFG.ARENA_MIN_RADIUS, r);
    // Only rebuild the (relatively expensive) mesh when it changed meaningfully.
    if (Math.abs(this.radius - this._builtRadius) >= 0.75) this.rebuild();
  }

  rebuild() {
    if (this.platform) {
      this.scene.remove(this.platform);
      this.platform.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) o.material.dispose?.();
      });
    }
    this.platform = buildPlatform(this.radius);
    this.scene.add(this.platform);
    this._builtRadius = this.radius;
  }

  // Is a point (x,z) still on solid ground?
  isOnPlatform(x, z) {
    return x * x + z * z <= this.radius * this.radius;
  }

  update(t) {
    animateLava(this.lava, t);
  }

  reset() {
    this.radius = CFG.ARENA_RADIUS;
    this.rebuild();
  }
}
