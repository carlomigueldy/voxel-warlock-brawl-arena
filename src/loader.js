// Preloads the locally-selected character's GLB assets before the menu
// appears, eliminating asset pop-in for the player's own model. Character
// templates are loaded via character.js (which holds the canonical
// load/cache logic). Non-character assets (projectiles, runes, items, mobs,
// props, terrain) are now built procedurally from Three.js geometry, so
// there is no longer any Meshy-GLB fetch to prime for those.
//
// Asset-diet note (WS-I): this used to block Enter on all 4 characters'
// full clip sets (base/walk/run + 7 reaction clips each — the single biggest
// chunk of first-load bytes). Only the character the player already has
// selected (src/ui.js persists it to localStorage['vwb-character']) is
// preloaded here now; the other 3 are preloaded by src/preview.js for the
// menu turntable carousel (started right after this gate, non-blocking) and
// are otherwise lazy — character.js's `_loadPromises` cache makes every
// loadCharacterTemplate() call idempotent, so there is never a double-fetch
// no matter which module asks for a given character first.
//
// Individual asset failures are tolerated — a missing CDN file never blocks entry.
import { CFG, SPELL_ORDER } from "./config.js";
import { loadCharacterTemplate } from "./character.js";
import { spellIconPath } from "./spell-icons.js";

const CHARACTER_STORAGE_KEY = "vwb-character"; // mirrors src/ui.js's _initialCharacter()/_selectCharacter()

function selectedCharacterId() {
  let saved = null;
  try { saved = localStorage.getItem(CHARACTER_STORAGE_KEY); } catch { saved = null; }
  return CFG.CHARACTERS.some((c) => c.id === saved) ? saved : CFG.DEFAULT_CHARACTER;
}

/**
 * Preload first-frame-essential assets: the locally-selected character's full
 * GLB rig, so the match-start loader gate (src/main.js, before PLAYING) never
 * has to fall back to the procedural voxel warlock for the local player.
 * Calls onProgress(fraction) as it completes (fraction in [0,1]). Returns a
 * Promise that resolves whether the load succeeded or failed (a missing/bad
 * GLB falls back to the procedural model instead of blocking entry).
 * @param {{ onProgress?: (fraction: number) => void }} opts
 */
export async function preloadAssets({ onProgress } = {}) {
  onProgress?.(0);

  const id = selectedCharacterId();
  await loadCharacterTemplate(id).then(
    () => onProgress?.(1),
    () => onProgress?.(1), // load failure — caller falls back to the voxel model
  );

  preloadSpellIcons(); // fire-and-forget — never blocks entry on icon art
}

/**
 * Warm the browser's image cache for every spell's Blender-rendered PNG icon
 * (src/spell-icons.js spellIconHtml) so the ability bar/draft grid never
 * shows a load flicker. Non-blocking and failure-tolerant: a missing/failed
 * PNG just leaves the always-present inline SVG glyph on screen (see
 * spellIconHtml's onerror handling) — nothing here needs to await or retry.
 */
function preloadSpellIcons() {
  for (const id of SPELL_ORDER) {
    const img = new Image();
    img.src = spellIconPath(id);
  }
}
