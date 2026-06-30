// Pure geometry helpers extracted from GameRenderer so the Node test harness
// can import them without loading THREE.js.

/**
 * Extract the burst origin and colour from a playerMeshes entry.
 * Returns {x, z, color} using the group's world position (not the raw mesh),
 * and falls back to {0, 0, 0xffffff} when the entry is absent (player already
 * removed from the map before the event is processed).
 *
 * @param {object|null|undefined} entry  A playerMeshes value: {group, color, …}
 * @returns {{ x: number, z: number, color: number }}
 */
export function effectPos(entry) {
  return {
    x:     entry ? entry.group.position.x : 0,
    z:     entry ? entry.group.position.z : 0,
    color: entry?.color ?? 0xffffff,
  };
}
