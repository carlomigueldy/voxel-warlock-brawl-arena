// Object pool for projectile bolt Groups.
//
// buildBolt() already shares its geometry/materials via module-level caches
// keyed by `kind` / `kind|color`, so the only remaining per-spawn cost is the
// THREE.Group + its Mesh wrappers. This pool reuses whole bolt Groups across
// spawns (keyed by `kind`) instead of constructing/discarding them every
// shot, which also avoids scene-graph churn from frequent add/remove.
//
// Contract (see CLAUDE.md task interface):
//   acquireBolt(color, kind) -> THREE.Group   (reuses a pooled group of that
//     kind, or builds one via buildBolt; recolors shared materials; resets
//     position/rotation/visible=true)
//   releaseBolt(group)                          (hides + returns the group to
//     its kind pool; NEVER disposes shared geometry/materials)
import { buildBolt } from "./voxel.js";

// kind -> Group[] of currently-free (released) bolt groups.
const _free = new Map();

function _poolFor(kind) {
  let arr = _free.get(kind);
  if (!arr) {
    arr = [];
    _free.set(kind, arr);
  }
  return arr;
}

// Acquire a bolt Group of the given kind, recolored to `color`. Reuses a
// pooled (previously released) group when available; otherwise builds a new
// one via buildBolt(). Resets position/rotation and makes it visible.
export function acquireBolt(color, kind = "fireball") {
  const pool = _poolFor(kind);
  let g = pool.pop();
  if (!g) {
    g = buildBolt(color, kind);
  } else if (g.userData.recolor) {
    g.userData.recolor(color);
  }
  g.position.set(0, 0, 0);
  g.rotation.set(0, 0, 0);
  g.visible = true;
  return g;
}

// Release a bolt Group back to its kind's pool. Flushes any live TrailPool
// trail shards (src/vfx/projectiles.js's _withTrail attaches
// userData.flushTrail on registry-routed cores; a no-op for legacy bolts
// with no trail), hides the group, detaches it from its current parent (if
// any), and never disposes shared geometry/materials (those are cache-owned
// by voxel.js and reused by future acquireBolt calls). The flush must run
// BEFORE the group is removed from this.boltMeshes/the scene: once removed
// its userData.update(dt) stops being ticked, so any shards left alive would
// otherwise freeze in place and permanently hold their slot in the shared,
// capped TrailPool.
export function releaseBolt(group) {
  if (!group) return;
  group.userData.flushTrail?.();
  group.visible = false;
  if (group.parent) group.parent.remove(group);
  const kind = group.userData.kind || "fireball";
  _poolFor(kind).push(group);
}
