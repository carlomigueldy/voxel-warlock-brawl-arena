// Preloads GLB assets before the menu appears, eliminating asset pop-in.
// Character templates are loaded via character.js (which holds the canonical
// load/cache logic). Meshy GLBs are fetch()-primed into the browser cache so
// the renderer's GLTFLoader sees instant cache hits on first render.
// Individual asset failures are tolerated — a missing CDN file never blocks entry.
import { CFG } from "./config.js";
import { loadCharacterTemplate } from "./character.js";
import { MESHY_ASSETS } from "./renderer.js";

const flatMeshyPaths = [
  MESHY_ASSETS.rune,
  ...Object.values(MESHY_ASSETS.projectiles),
];

/**
 * Preload all game assets. Calls onProgress(fraction) on each asset
 * completion (fraction in [0,1]). Returns a Promise that resolves when all
 * assets have either loaded or failed.
 * @param {{ onProgress?: (fraction: number) => void }} opts
 */
export async function preloadAssets({ onProgress } = {}) {
  const charIds = CFG.CHARACTERS.map((c) => c.id);
  const total = charIds.length + flatMeshyPaths.length;
  let done = 0;

  const tick = () => {
    done = Math.min(total, done + 1);
    onProgress?.(done / total);
  };

  // Character GLB rigs + animations — reuse the canonical per-character loader.
  const charPromises = charIds.map((id) =>
    loadCharacterTemplate(id).then(tick, () => tick()),
  );

  // Meshy projectile + rune GLBs — fetch() to prime the browser HTTP cache so
  // the renderer's GLTFLoader sees instant cache hits later. Failures are fine.
  const meshyPromises = flatMeshyPaths.map((path) =>
    fetch(path).then(tick, () => tick()),
  );

  await Promise.all([...charPromises, ...meshyPromises]);
  onProgress?.(1); // Guarantee 100% even if rounding left a gap.
}
