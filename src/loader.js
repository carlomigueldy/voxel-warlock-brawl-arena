// Preloads character GLB assets before the menu appears, eliminating asset
// pop-in. Character templates are loaded via character.js (which holds the
// canonical load/cache logic). Non-character assets (projectiles, runes, items,
// mobs, props, terrain) are now built procedurally from Three.js geometry, so
// there is no longer any Meshy-GLB fetch to prime.
// Individual asset failures are tolerated — a missing CDN file never blocks entry.
import { CFG } from "./config.js";
import { loadCharacterTemplate } from "./character.js";

/**
 * Preload all game assets. Calls onProgress(fraction) on each asset
 * completion (fraction in [0,1]). Returns a Promise that resolves when all
 * assets have either loaded or failed.
 * @param {{ onProgress?: (fraction: number) => void }} opts
 */
export async function preloadAssets({ onProgress } = {}) {
  const charIds = CFG.CHARACTERS.map((c) => c.id);
  const total = charIds.length;
  let done = 0;

  const tick = () => {
    done = Math.min(total, done + 1);
    onProgress?.(done / total);
  };

  // Character GLB rigs + animations — reuse the canonical per-character loader.
  const charPromises = charIds.map((id) =>
    loadCharacterTemplate(id).then(tick, () => tick()),
  );

  await Promise.all(charPromises);
  onProgress?.(1); // Guarantee 100% even if rounding left a gap.
}
