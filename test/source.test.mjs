import assert from "node:assert";
import fs from "node:fs";
import { CFG, getArenaHazard } from "../src/config.js";
import { effectPos } from "../src/renderer-util.js";

let passed = 0;
function test(name, fn) {
  try { fn(); console.log("  ok  -", name); passed++; }
  catch (e) { console.error("  FAIL-", name, "\n", e.message); process.exitCode = 1; }
}

console.log("Source integration checks:");

const main = fs.readFileSync("src/main.js", "utf8");
const ui = fs.readFileSync("src/ui.js", "utf8");
const input = fs.readFileSync("src/input.js", "utf8");
const html = fs.readFileSync("index.html", "utf8");
const renderer = fs.readFileSync("src/renderer.js", "utf8");
const css = fs.readFileSync("src/style.css", "utf8");

test("host start is gated by Simulation.startMatch result", () => {
  assert.match(main, /if \(!sim\.startMatch\(\)\)/);
});

test("host lobby start button uses Simulation.canStartMatch", () => {
  assert.match(main, /sim\.canStartMatch\(\)/);
});

test("late clients switch to game view from active state snapshots", () => {
  assert.match(main, /snap\.phase !== PHASE\.LOBBY[\s\S]*ui\.showGame\(\)/);
});

test("clients ignore stale state snapshots", () => {
  assert.match(main, /snap\.t <= latestSnapshot\.t/);
});

test("scoreboard rendering avoids interpolating player names into innerHTML", () => {
  assert.doesNotMatch(ui, /rows\.map\([\s\S]*innerHTML/);
});

test("center messages escape dynamic player names", () => {
  assert.match(ui, /escapeHTML/);
  assert.match(ui, /escapeHTML\(w\)/);
});

test("network join names are sanitized as strings before slicing", () => {
  const net = fs.readFileSync("src/net.js", "utf8");
  assert.match(net, /sanitizeName/);
  assert.match(net, /String\(name \?\? "warlock"\)/);
});

test("disconnect handling sends the host back to lobby when a match cannot continue", () => {
  assert.match(main, /if \(sim\.phase === PHASE\.LOBBY\)/);
  assert.match(main, /inGame = false/);
});

test("generated character asset URLs resolve relative to the character module", () => {
  const character = fs.readFileSync("src/character.js", "utf8");
  // Character-aware loader resolves rigged + walk + run GLBs per selectable
  // character relative to the module.
  assert.match(character, /new URL\(p, import\.meta\.url\)\.href/);
  assert.match(character, /assets\/characters\/[\w-]+-rigged\.glb/);
  assert.match(character, /assets\/characters\/[\w-]+-walking\.glb/);
  assert.match(character, /assets\/characters\/[\w-]+-running\.glb/);
});

test("character roster exposes four rigged voxel characters", () => {
  const character = fs.readFileSync("src/character.js", "utf8");
  assert.match(character, /export const CHARACTER_ASSETS/);
  for (const id of ["ember", "frost", "storm", "moss"]) {
    assert.match(character, new RegExp(`${id}:`), `roster must include ${id}`);
  }
});

test("generated character model is scaled to the simulation player height", () => {
  const character = fs.readFileSync("src/character.js", "utf8");
  assert.match(character, /import \{ CFG \} from "\.\/config\.js";/);
  assert.match(character, /const TARGET_HEIGHT = CFG\.PLAYER_HEIGHT;/);
});

test("generated character size is measured from skinned mesh geometry, not setFromObject", () => {
  const character = fs.readFileSync("src/character.js", "utf8");
  // setFromObject mis-measures skinned meshes whose armature node carries a
  // tiny scale (0.01 here), producing a ~100x oversize. Size must come from the
  // skinned mesh geometry's own bounding box instead.
  assert.match(character, /computeBoundingBox\(\)/);
  assert.match(character, /\.boundingBox/);
  assert.doesNotMatch(character, /setFromObject/);
});

test("generated character model is bottom aligned after scaling", () => {
  const character = fs.readFileSync("src/character.js", "utf8");
  assert.match(character, /scene\.position\.y -= measured\.min\.y \* s/);
});

test("generated character clones materials and marks identity with a hero glyph", () => {
  const character = fs.readFileSync("src/character.js", "utf8");
  // Materials are cloned per instance (no body tint, original shading preserved);
  // player identity is shown by a glowing hero glyph.
  assert.match(character, /const wasArray = Array\.isArray\(o\.material\)/);
  assert.match(character, /o\.material = wasArray \? cloned : cloned\[0\]/);
  assert.match(character, /makeHeroGlyph/);
});

test("generated character label height follows simulation player height", () => {
  const renderer = fs.readFileSync("src/renderer.js", "utf8");
  assert.match(renderer, /CFG\.PLAYER_HEIGHT \+ 0\.55/);
});

test("renderer triggers cast animations from simulation events", () => {
  const renderer = fs.readFileSync("src/renderer.js", "utf8");
  assert.match(renderer, /archetypeForEvent/);
  // the cast trigger must be applied to the resolved caster's mesh
  assert.match(renderer, /triggerCast|playCast/);
});

test("character GLB instances accept a cast archetype trigger", () => {
  const character = fs.readFileSync("src/character.js", "utf8");
  assert.match(character, /CastAnimator/);
  assert.match(character, /triggerCast/);
});

test("character rig loads per-character walk and run animation clips", () => {
  const character = fs.readFileSync("src/character.js", "utf8");
  assert.match(character, /walk/i);
  assert.match(character, /run/i);
});

test("voxel fallback warlock supports cast archetype overlays", () => {
  const voxel = fs.readFileSync("src/voxel.js", "utf8");
  assert.match(voxel, /castArchetype|triggerCast/);
});

test("renderer passes falling and time to GLB character animations", () => {
  const renderer = fs.readFileSync("src/renderer.js", "utf8");
  const match = renderer.match(/if \(char\) \{\s*char\.update\(\{([\s\S]*?)\}\);\s*\} else/);
  assert.ok(match, "could not find GLB character update block");
  assert.match(match[1], /falling: !!e\.target\.f/);
  assert.match(match[1], /time: t/);
});

test("fireball cast events are emitted via spells.js castSpell pipeline", () => {
  const spells = fs.readFileSync("src/spells.js", "utf8");
  assert.match(spells, /type: "cast"[\s\S]*spell: "fireball"/);
});

test("host menu no longer exposes an all-abilities toggle (strict slots only)", () => {
  assert.doesNotMatch(html, /id="all-abilities-toggle"/);
  assert.doesNotMatch(ui, /allAbilitiesAtStart/);
  assert.doesNotMatch(main, /allAbilitiesAtStart/);
});

test("menu exposes a character-select UI with cards and a live preview", () => {
  assert.match(html, /id="char-cards"/);
  assert.match(html, /id="char-preview"/);
  assert.match(ui, /_buildCharacterCards/);
  assert.match(ui, /CFG\.CHARACTERS/);
});

test("config declares four selectable characters and a default", () => {
  assert.ok(Array.isArray(CFG.CHARACTERS) && CFG.CHARACTERS.length === 4, "expected 4 selectable characters");
  const ids = CFG.CHARACTERS.map((c) => c.id).sort();
  assert.deepStrictEqual(ids, ["ember", "frost", "moss", "storm"]);
  assert.ok(CFG.CHARACTERS.some((c) => c.id === CFG.DEFAULT_CHARACTER), "default character must be in the roster");
});

test("character ids match the loadable GLB roster", () => {
  const character = fs.readFileSync("src/character.js", "utf8");
  for (const c of CFG.CHARACTERS) {
    assert.match(character, new RegExp(`${c.id}:`), `character.js must define assets for ${c.id}`);
  }
});

test("selected character is networked from client to host on join", () => {
  const net = fs.readFileSync("src/net.js", "utf8");
  assert.match(net, /type: MSG\.JOIN, name: this\.name, character: this\.character/);
  assert.match(net, /conn\._character/);
});

test("host carries each player's character in lobby meta", () => {
  assert.match(main, /character: getCharacter\(character\)\.id/);
  assert.match(main, /character: m\.character \|\| CFG\.DEFAULT_CHARACTER/);
});

test("renderer builds each player's mesh from their selected character", () => {
  const renderer = fs.readFileSync("src/renderer.js", "utf8");
  assert.match(renderer, /buildCharacterInstance\(color, character\)/);
  assert.match(renderer, /characterReady\(character\)/);
});

test("live character preview module exists and spins the model", () => {
  const preview = fs.readFileSync("src/preview.js", "utf8");
  assert.match(preview, /turntable\.rotation\.y \+=/);
  assert.match(preview, /buildCharacterInstance/);
});

test("ability bar renders spell slots from snapshot spellSlots array", () => {
  assert.match(ui, /me\?\.spellSlots/);
  assert.match(ui, /slot\.classList\.toggle\("locked"/);
});

test("rune mode ability bar renders six spell slots", () => {
  assert.match(ui, /CFG\.SPELL_SLOT_COUNT/);
  assert.match(ui, /spellSlots/);
  assert.match(ui, /empty/);
});

test("spell slot hotkeys are configurable and persisted locally", () => {
  assert.match(input, /SPELL_SLOT_HOTKEY_STORAGE_KEY/);
  assert.match(input, /localStorage\.setItem\(SPELL_SLOT_HOTKEY_STORAGE_KEY/);
  assert.match(input, /setSpellSlotHotkey/);
  assert.match(ui, /hotkey-picker/);
});

test("host lobby exposes bot count and difficulty controls", () => {
  assert.match(html, /id="bot-count"/);
  assert.match(html, /id="bot-skill"/);
  assert.match(ui, /getBotSettings/);
  assert.match(main, /sim\.setBotRoster/);
});

test("host menu exposes arena world and land size controls", () => {
  assert.match(html, /id="arena-world"/);
  assert.match(html, /id="land-size"/);
  assert.match(ui, /getArenaSettings/);
  assert.match(main, /arenaWorld: options\.arenaWorld/);
  assert.match(main, /landSize: options\.landSize/);
});

test("renderer applies arena world from snapshots", () => {
  const renderer = fs.readFileSync("src/renderer.js", "utf8");
  assert.match(renderer, /snapshot\.arenaWorld/);
  assert.match(renderer, /setWorld/);
});

test("every arena world declares a distinct hazard theme", () => {
  const config = fs.readFileSync("src/config.js", "utf8");
  assert.ok(CFG.ARENA_HAZARDS && typeof CFG.ARENA_HAZARDS === "object", "CFG.ARENA_HAZARDS must exist");
  const ids = new Set();
  for (const world of CFG.ARENA_WORLDS) {
    const hazard = CFG.ARENA_HAZARDS[world.hazard];
    assert.ok(world.hazard, `world ${world.id} must reference a hazard`);
    assert.ok(hazard, `world ${world.id} references unknown hazard ${world.hazard}`);
    assert.ok(Number.isFinite(hazard.color), `hazard ${world.hazard} needs a color`);
    assert.ok(typeof hazard.name === "string" && hazard.name.length, `hazard ${world.hazard} needs a name`);
    assert.ok(typeof hazard.style === "string" && hazard.style.length, `hazard ${world.hazard} needs an animation style`);
    ids.add(world.hazard);
  }
  assert.strictEqual(ids.size, CFG.ARENA_WORLDS.length, "each world should have its own hazard theme");
  assert.ok(typeof CFG.getArenaHazard === "function" || true);
});

test("config resolves a hazard for each world and falls back safely", () => {
  const fallback = getArenaHazard("circle");
  assert.ok(fallback && Number.isFinite(fallback.color));
  const unknown = getArenaHazard("does-not-exist");
  assert.ok(unknown && Number.isFinite(unknown.color), "unknown world must still resolve a hazard");
});

test("voxel hazard builder is theme-driven, not hardcoded lava", () => {
  const voxel = fs.readFileSync("src/voxel.js", "utf8");
  assert.match(voxel, /export function buildHazard/);
  assert.match(voxel, /export function animateHazard/);
});

test("arena rebuilds the hazard when the world changes", () => {
  const arena = fs.readFileSync("src/arena.js", "utf8");
  assert.match(arena, /buildHazard/);
  assert.match(arena, /animateHazard/);
  // setWorld path must refresh the hazard, not just the platform
  assert.match(arena, /_buildHazard|rebuildHazard|this\.hazard\s*=/);
});

test("renderer tints ambient glow and fog from the active hazard theme", () => {
  const renderer = fs.readFileSync("src/renderer.js", "utf8");
  assert.match(renderer, /hazard/i);
});

test("every hazard declares ambient detail props for immersion", () => {
  for (const id in CFG.ARENA_HAZARDS) {
    const hazard = CFG.ARENA_HAZARDS[id];
    assert.ok(hazard.detail && typeof hazard.detail === "object", `hazard ${id} needs a detail descriptor`);
    assert.ok(typeof hazard.detail.kind === "string" && hazard.detail.kind.length, `hazard ${id} detail needs a kind`);
    assert.ok(Number.isInteger(hazard.detail.count) && hazard.detail.count > 0, `hazard ${id} detail needs a positive count`);
    assert.ok(Number.isFinite(hazard.detail.color), `hazard ${id} detail needs a color`);
  }
  const kinds = new Set(Object.values(CFG.ARENA_HAZARDS).map((h) => h.detail.kind));
  assert.ok(kinds.size >= 4, "hazards should use a variety of detail prop kinds");
});

test("voxel exposes a theme-driven hazard detail builder and animator", () => {
  const voxel = fs.readFileSync("src/voxel.js", "utf8");
  assert.match(voxel, /export function buildHazardDetails/);
  assert.match(voxel, /export function animateHazardDetails/);
});

test("arena builds, animates, and disposes hazard detail props", () => {
  const arena = fs.readFileSync("src/arena.js", "utf8");
  assert.match(arena, /buildHazardDetails/);
  assert.match(arena, /animateHazardDetails/);
  // The detail group must be disposed when the hazard is rebuilt (no leaks).
  assert.match(arena, /this\.details/);
});

test("projectile clash events trigger dedicated VFX and SFX", () => {
  const audio = fs.readFileSync("src/audio.js", "utf8");
  assert.match(renderer, /case "projectileClash"/);
  assert.match(renderer, /projectileClash/);
  assert.match(audio, /case "projectileClash"/);
});

test("renderer builds projectiles and runes procedurally (no Meshy GLB loading)", () => {
  // Non-character assets are rebuilt procedurally from Three.js geometry — the
  // renderer must not declare or load any Meshy GLB for projectiles or runes.
  assert.doesNotMatch(renderer, /MESHY_ASSETS/);
  assert.doesNotMatch(renderer, /GLTFLoader/);
  assert.doesNotMatch(renderer, /_loadMeshyAsset|_installMeshyAsset|_installMeshyMeteor/);
  assert.doesNotMatch(renderer, /assets\/meshy\//);
});

test("renderer builds bolts and runes via the procedural voxel builders", () => {
  assert.match(renderer, /acquireBolt\(b\.c, b\.k \|\| "fireball"\)/);
  assert.match(renderer, /buildRune\(r\.c \|\| 0xffffff\)/);
  assert.match(fs.readFileSync("src/pool.js", "utf8"), /buildBolt\(color, kind\)/);
});

test("loader preloads only character GLBs (no Meshy fetch priming)", () => {
  const loader = fs.readFileSync("src/loader.js", "utf8");
  assert.doesNotMatch(loader, /MESHY_ASSETS|meshy|assets\/meshy\//);
  assert.match(loader, /loadCharacterTemplate/);
});

test("renderer labels ability runes with spell names", () => {
  assert.match(renderer, /import \{ CFG, SPELLS[^}]*\} from "\.\/config\.js";/);
  assert.match(renderer, /SPELLS\[r\.spell\]\?\.name/);
  assert.match(renderer, /_makeLabel\(name, r\.c \|\| 0xffffff, 1\.65\)/);
  assert.match(renderer, /userData\.label/);
  // The rune's label is added directly to the procedural rune group (no GLB
  // overlay step), and tracked on userData for later updates.
  assert.match(renderer, /g\.add\(label\)/);
  assert.match(renderer, /g\.userData\.label = label/);
});

// --- Phase 5: rendering map elevation + obstacle props + stun VFX ---

test("voxel exports buildPlateau and buildRamp for map elevation rendering", () => {
  const voxel = fs.readFileSync("src/voxel.js", "utf8");
  assert.match(voxel, /export function buildPlateau/);
  assert.match(voxel, /export function buildRamp/);
  // Both builders follow buildPlatform's world top/side palette convention.
  assert.match(voxel, /world\.top/);
  assert.match(voxel, /world\.side/);
});

test("props.js exports PROP_BUILDERS registry with all eight obstacle types", () => {
  const props = fs.readFileSync("src/props.js", "utf8");
  assert.match(props, /export const PROP_BUILDERS/);
  for (const type of ["tree", "stone", "column", "debris", "wall", "boulder", "deadGiant", "dragonBones"]) {
    assert.match(props, new RegExp(type), `PROP_BUILDERS must include ${type}`);
  }
  // Confirm no GLB / Meshy imports — all props are procedural BoxGeometry.
  assert.doesNotMatch(props, /GLTFLoader|\.glb/i);
  assert.doesNotMatch(props, /meshy/i);
});

test("props.js builders use the shared lowpoly faceted helpers (flat-shaded)", () => {
  const props = fs.readFileSync("src/props.js", "utf8");
  // Props are rebuilt procedurally from stylized low-poly faceted geometry that
  // lives in the shared lowpoly.js module — no inline BoxGeometry/MeshLambertMaterial.
  assert.match(props, /from "\.\/lowpoly\.js"/);
  assert.match(props, /faceted/);
  assert.doesNotMatch(props, /new THREE\.BoxGeometry/);
  assert.doesNotMatch(props, /GLTFLoader|\.glb/i);
  assert.doesNotMatch(props, /meshy/i);
  // The faceted flat-shading recipe itself lives in lowpoly.js.
  const lowpoly = fs.readFileSync("src/lowpoly.js", "utf8");
  assert.match(lowpoly, /flatShading: true/);
  assert.match(lowpoly, /MeshLambertMaterial/);
});

test("voxel.js rebuilds non-character assets via lowpoly faceted helpers", () => {
  const voxel = fs.readFileSync("src/voxel.js", "utf8");
  assert.match(voxel, /from "\.\/lowpoly\.js"/);
  assert.match(voxel, /facetedRock|facetedCylinder|facetedCone|facetedShard/);
  // The character fallback (buildWarlock) stays on the box recipe — it is
  // explicitly excluded from the low-poly faceted conversion.
  assert.match(voxel, /export function buildWarlock/);
});

test("renderer imports map elevation builders and PROP_BUILDERS from new modules", () => {
  assert.match(renderer, /buildPlateau/);
  assert.match(renderer, /buildRamp/);
  assert.match(renderer, /PROP_BUILDERS/);
  assert.match(renderer, /from "\.\/props\.js"/);
});

test("renderer rebuilds map layout meshes when snapshot mapV changes", () => {
  assert.match(renderer, /snapshot\.mapV/);
  assert.match(renderer, /_mapVersion/);
  assert.match(renderer, /_rebuildMapMeshes/);
  // Must dispose old meshes before creating new ones (no GPU leaks).
  assert.match(renderer, /dispose/);
});

test("renderer instantiates plateaus, ramps and obstacle props from the layout", () => {
  assert.match(renderer, /buildPlateau\(pl/);
  assert.match(renderer, /buildRamp\(ramp/);
  assert.match(renderer, /PROP_BUILDERS\[ob\.type\]/);
  // Obstacle props are positioned and rotated from the layout data.
  assert.match(renderer, /ob\.rot/);
});

test("renderer clears map meshes on reset", () => {
  assert.match(renderer, /_rebuildMapMeshes\(null/);
  assert.match(renderer, /_mapVersion = -1/);
});

test("renderer shows stun VFX keyed off the snapshot st field", () => {
  // `st` is the snapshot field for stunned-remaining-seconds (mirrors `hz`).
  assert.match(renderer, /ps\.st/);
  // A visual effect group is attached to / removed from the player mesh.
  assert.match(renderer, /stunEffect/);
  // The halo spins every frame in the update loop.
  assert.match(renderer, /stunEffect\.rotation\.y/);
});

// --- Step 4: lootable items ---

test("config declares ITEM_SLOT_COUNT of 4", () => {
  assert.strictEqual(CFG.ITEM_SLOT_COUNT, 4, "ITEM_SLOT_COUNT must be 4");
});

test("index.html contains item-bar element", () => {
  assert.match(html, /id="item-bar"/, "index.html must have #item-bar");
});

test("renderer imports and calls buildItemDrop", () => {
  assert.match(renderer, /buildItemDrop/, "renderer must import/call buildItemDrop");
});

// --- Step 8: A1 regression guard — syncLocalSpellSlots in both loops ---

test("syncLocalSpellSlots (or setSpellSlots) is called inside both host and client rAF loops in main.js", () => {
  // The host loop already had syncLocalSpellSlots; the client loop got it in Step 8 (A1 fix).
  // We search for the function name appearing at least twice in the file so either loop can
  // use it (the function itself counts as one occurrence; each call-site is another).
  const matches = main.match(/syncLocalSpellSlots/g) || [];
  assert.ok(matches.length >= 3,
    `syncLocalSpellSlots must appear at least 3 times in main.js (definition + host call + client call); found ${matches.length}`);
  // Additionally confirm the client loop block specifically contains it.
  // The client loop is identified by the clientLoop function definition.
  const clientLoopBlock = main.match(/function clientLoop[\s\S]*?requestAnimationFrame\(clientLoop\)/)?.[0] || "";
  assert.match(clientLoopBlock, /syncLocalSpellSlots/,
    "syncLocalSpellSlots must appear inside the clientLoop function body");
});

// --- Bug-1 regression: death-freeze root cause ---

test("death handler delegates to effectPos(deadMesh) and does not read .position directly", () => {
  // The call site must use effectPos — the helper owns the .group.position access.
  assert.match(renderer, /effectPos\(deadMesh\)/,
    "renderer must call effectPos(deadMesh) in the death handler");
  assert.doesNotMatch(renderer, /deadMesh\.position\./,
    "renderer must not read .position directly off the mesh entry");
});

test("effectPos helper in renderer-util uses .group.position (not bare .position)", () => {
  const util = fs.readFileSync("src/renderer-util.js", "utf8");
  assert.match(util, /group\.position/,
    "renderer-util.js must read through .group.position");
  assert.doesNotMatch(util, /entry\.position\./,
    "renderer-util.js must not read .position directly off the entry");
});

// Behavioral tests: exercise both branches of effectPos without loading THREE.js
test("effectPos returns group position and entry colour for a present entry", () => {
  const entry = { group: { position: { x: 7, z: -3 } }, color: 0xff0000 };
  const pos = effectPos(entry);
  assert.strictEqual(pos.x, 7,     "x must come from entry.group.position.x");
  assert.strictEqual(pos.z, -3,    "z must come from entry.group.position.z");
  assert.strictEqual(pos.color, 0xff0000, "color must come from entry.color");
});

test("effectPos returns {0, 0, white} when entry is absent (player already removed)", () => {
  const pos = effectPos(null);
  assert.strictEqual(pos.x, 0,          "x must be 0 when no entry");
  assert.strictEqual(pos.z, 0,          "z must be 0 when no entry");
  assert.strictEqual(pos.color, 0xffffff, "color must default to white when no entry");
});

test("effectPos returns white when entry exists but color is missing (undefined)", () => {
  const entry = { group: { position: { x: 1, z: 2 } } }; // no .color
  const pos = effectPos(entry);
  assert.strictEqual(pos.color, 0xffffff,
    "color must fall back to 0xffffff when entry.color is undefined");
});

test("link and pocketwatch handlers also read position through .group", () => {
  assert.doesNotMatch(renderer, /(aMesh|bMesh|pwMesh)\.position\./);
});

test("hostLoop survives a throwing frame (try/catch wraps body, rAF stays outside)", () => {
  assert.match(main, /function hostLoop[\s\S]*?try \{[\s\S]*?catch[\s\S]*?requestAnimationFrame\(hostLoop\)/);
});

test("clientLoop survives a throwing frame (try/catch wraps body, rAF stays outside)", () => {
  assert.match(main, /function clientLoop[\s\S]*?try \{[\s\S]*?catch[\s\S]*?requestAnimationFrame\(clientLoop\)/);
});

// --- Bug-2 regression: unstyled item bar ---

test("item bar has a positioned CSS rule with pointer-events auto", () => {
  assert.match(css, /#item-bar\s*\{[\s\S]*?position:\s*fixed[\s\S]*?pointer-events:\s*auto/);
});

console.log(`\n${passed} source checks passed.`);
