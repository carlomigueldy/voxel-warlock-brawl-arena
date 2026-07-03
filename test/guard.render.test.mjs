// Source guards for the rendering layer: renderer.js, renderer-util.js,
// character.js, voxel.js, arena.js, props.js, lowpoly.js, pool.js, preview.js,
// plus behavioral effectPos checks. Split from test/source.test.mjs (#103) by
// which source file each guard reads.
import { test } from "vitest";
import assert from "node:assert";
import fs from "node:fs";
import { CFG } from "../src/config.js";
import { effectPos } from "../src/renderer-util.js";

console.log("Source guards (render) checks:");

const renderer = fs.readFileSync("src/renderer.js", "utf8");
const character = fs.readFileSync("src/character.ts", "utf8");
const voxel = fs.readFileSync("src/voxel.ts", "utf8");
const arena = fs.readFileSync("src/arena.ts", "utf8");
const props = fs.readFileSync("src/props.ts", "utf8");

// legacy text guard — delete in P6
test("generated character asset URLs are built via the asset() helper", () => {
  // Character-aware loader resolves rigged + walk + run GLBs per selectable
  // character through the asset() helper (root-absolute URLs into public/,
  // BASE_URL-prefixed) now that assets are served from public/ under Vite.
  // (legacy source-text guard — folded into the disjoint guards in #103.)
  assert.match(character, /import \{ asset \} from "\.\/asset-url\.js"/);
  // P4-140 TS port adds a `: string` param annotation (strict mode) — tolerate it.
  assert.match(character, /const url = \(p(?:: string)?\) => asset\(p\)/);
  assert.match(character, /assets\/characters\/[\w-]+-rigged\.glb/);
  assert.match(character, /assets\/characters\/[\w-]+-walking\.glb/);
  assert.match(character, /assets\/characters\/[\w-]+-running\.glb/);
});

// legacy text guard — delete in P6
test("character roster exposes four rigged voxel characters", () => {
  assert.match(character, /export const CHARACTER_ASSETS/);
  for (const id of ["ember", "frost", "storm", "moss"]) {
    assert.match(character, new RegExp(`${id}:`), `roster must include ${id}`);
  }
});

// legacy text guard — delete in P6
test("generated character model is scaled to the simulation player height", () => {
  assert.match(character, /import \{ CFG \} from "\.\/config\.js";/);
  assert.match(character, /const TARGET_HEIGHT = CFG\.PLAYER_HEIGHT;/);
});

// legacy text guard — delete in P6
test("generated character size is measured from skinned mesh geometry, not setFromObject", () => {
  // setFromObject mis-measures skinned meshes whose armature node carries a
  // tiny scale (0.01 here), producing a ~100x oversize. Size must come from the
  // skinned mesh geometry's own bounding box instead.
  assert.match(character, /computeBoundingBox\(\)/);
  assert.match(character, /\.boundingBox/);
  assert.doesNotMatch(character, /setFromObject/);
});

// legacy text guard — delete in P6
test("generated character model is bottom aligned after scaling", () => {
  assert.match(character, /scene\.position\.y -= measured\.min\.y \* s/);
});

// legacy text guard — delete in P6
test("generated character clones materials and marks identity with a hero glyph", () => {
  // Materials are cloned per instance (no body tint, original shading preserved);
  // player identity is shown by a glowing hero glyph.
  assert.match(character, /const wasArray = Array\.isArray\(o\.material\)/);
  assert.match(character, /o\.material = wasArray \? cloned : cloned\[0\]/);
  assert.match(character, /makeHeroGlyph/);
});

// legacy text guard — delete in P6
test("generated character label height follows simulation player height", () => {
  assert.match(renderer, /CFG\.PLAYER_HEIGHT \+ 0\.55/);
});

// legacy text guard — delete in P6
test("renderer triggers cast animations from simulation events", () => {
  assert.match(renderer, /archetypeForEvent/);
  // the cast trigger must be applied to the resolved caster's mesh
  assert.match(renderer, /triggerCast|playCast/);
});

// legacy text guard — delete in P6
test("character GLB instances accept a cast archetype trigger", () => {
  assert.match(character, /CastAnimator/);
  assert.match(character, /triggerCast/);
});

// legacy text guard — delete in P6
test("character rig loads per-character walk and run animation clips", () => {
  assert.match(character, /walk/i);
  assert.match(character, /run/i);
});

// legacy text guard — delete in P6
test("voxel fallback warlock supports cast archetype overlays", () => {
  assert.match(voxel, /castArchetype|triggerCast/);
});

// legacy text guard — delete in P6
test("renderer passes falling and time to GLB character animations", () => {
  const match = renderer.match(/if \(char\) \{\s*char\.update\(\{([\s\S]*?)\}\);\s*\} else/);
  assert.ok(match, "could not find GLB character update block");
  assert.match(match[1], /falling: !!e\.target\.f/);
  assert.match(match[1], /time: t/);
});

// legacy text guard — delete in P6
test("character ids match the loadable GLB roster", () => {
  for (const c of CFG.CHARACTERS) {
    assert.match(character, new RegExp(`${c.id}:`), `character.js must define assets for ${c.id}`);
  }
});

// legacy text guard — delete in P6
test("renderer builds each player's mesh from their selected character", () => {
  assert.match(renderer, /buildCharacterInstance\(color, character\)/);
  assert.match(renderer, /characterReady\(character\)/);
});

// legacy text guard — delete in P6
test("live character preview module exists and spins the model", () => {
  const preview = fs.readFileSync("src/preview.js", "utf8");
  assert.match(preview, /turntable\.rotation\.y \+=/);
  assert.match(preview, /buildCharacterInstance/);
});

// legacy text guard — delete in P6
test("renderer applies arena world from snapshots", () => {
  assert.match(renderer, /snapshot\.arenaWorld/);
  assert.match(renderer, /setWorld/);
});

// legacy text guard — delete in P6
test("voxel hazard builder is theme-driven, not hardcoded lava", () => {
  assert.match(voxel, /export function buildHazard/);
  assert.match(voxel, /export function animateHazard/);
});

// legacy text guard — delete in P6
test("arena rebuilds the hazard when the world changes", () => {
  assert.match(arena, /buildHazard/);
  assert.match(arena, /animateHazard/);
  // setWorld path must refresh the hazard, not just the platform
  assert.match(arena, /_buildHazard|rebuildHazard|this\.hazard\s*=/);
});

// legacy text guard — delete in P6
test("renderer tints ambient glow and fog from the active hazard theme", () => {
  assert.match(renderer, /hazard/i);
});

// legacy text guard — delete in P6
test("voxel exposes a theme-driven hazard detail builder and animator", () => {
  assert.match(voxel, /export function buildHazardDetails/);
  assert.match(voxel, /export function animateHazardDetails/);
});

// legacy text guard — delete in P6
test("arena builds, animates, and disposes hazard detail props", () => {
  assert.match(arena, /buildHazardDetails/);
  assert.match(arena, /animateHazardDetails/);
  // The detail group must be disposed when the hazard is rebuilt (no leaks).
  assert.match(arena, /this\.details/);
});

// legacy text guard — delete in P6
test("projectile clash events trigger dedicated VFX and SFX (renderer half)", () => {
  assert.match(renderer, /case "projectileClash"/);
  assert.match(renderer, /projectileClash/);
});

// legacy text guard — delete in P6
test("renderer builds projectiles and runes procedurally (no Meshy GLB loading)", () => {
  // Non-character assets are rebuilt procedurally from Three.js geometry — the
  // renderer must not declare or load any Meshy GLB for projectiles or runes.
  assert.doesNotMatch(renderer, /MESHY_ASSETS/);
  assert.doesNotMatch(renderer, /GLTFLoader/);
  assert.doesNotMatch(renderer, /_loadMeshyAsset|_installMeshyAsset|_installMeshyMeteor/);
  assert.doesNotMatch(renderer, /assets\/meshy\//);
});

// legacy text guard — delete in P6
test("renderer builds bolts and runes via the procedural voxel builders", () => {
  assert.match(renderer, /acquireBolt\(b\.c, b\.k \|\| "fireball"\)/);
  assert.match(renderer, /buildRune\(r\.c \|\| 0xffffff\)/);
  assert.match(fs.readFileSync("src/pool.js", "utf8"), /buildBolt\(color, kind\)/);
});

// legacy text guard — delete in P6
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

// legacy text guard — delete in P6
test("voxel exports buildPlateau and buildRamp for map elevation rendering", () => {
  assert.match(voxel, /export function buildPlateau/);
  assert.match(voxel, /export function buildRamp/);
  // Both builders follow buildPlatform's world top/side palette convention.
  assert.match(voxel, /world\.top/);
  assert.match(voxel, /world\.side/);
});

// legacy text guard — delete in P6
test("props.js exports PROP_BUILDERS registry with all eight obstacle types", () => {
  assert.match(props, /export const PROP_BUILDERS/);
  for (const type of ["tree", "stone", "column", "debris", "wall", "boulder", "deadGiant", "dragonBones"]) {
    assert.match(props, new RegExp(type), `PROP_BUILDERS must include ${type}`);
  }
  // Confirm no GLB / Meshy imports — all props are procedural BoxGeometry.
  assert.doesNotMatch(props, /GLTFLoader|\.glb/i);
  assert.doesNotMatch(props, /meshy/i);
});

// legacy text guard — delete in P6
test("props.js builders use the shared lowpoly faceted helpers (flat-shaded)", () => {
  // Props are rebuilt procedurally from stylized low-poly faceted geometry that
  // lives in the shared lowpoly.js module — no inline BoxGeometry/MeshLambertMaterial.
  assert.match(props, /from "\.\/lowpoly\.js"/);
  assert.match(props, /faceted/);
  assert.doesNotMatch(props, /new THREE\.BoxGeometry/);
  assert.doesNotMatch(props, /GLTFLoader|\.glb/i);
  assert.doesNotMatch(props, /meshy/i);
  // The faceted flat-shading recipe itself lives in lowpoly.ts (P4a: ported
  // to TypeScript — src/three/materials/palette.ts re-exports its _lit/_unlit).
  const lowpoly = fs.readFileSync("src/lowpoly.ts", "utf8");
  assert.match(lowpoly, /flatShading: true/);
  assert.match(lowpoly, /MeshLambertMaterial/);
});

// legacy text guard — delete in P6
test("voxel.js rebuilds non-character assets via lowpoly faceted helpers", () => {
  assert.match(voxel, /from "\.\/lowpoly\.js"/);
  assert.match(voxel, /facetedRock|facetedCylinder|facetedCone|facetedShard/);
  // The character fallback (buildWarlock) stays on the box recipe — it is
  // explicitly excluded from the low-poly faceted conversion.
  assert.match(voxel, /export function buildWarlock/);
});

// legacy text guard — delete in P6
test("renderer imports map elevation builders and PROP_BUILDERS from new modules", () => {
  assert.match(renderer, /buildPlateau/);
  assert.match(renderer, /buildRamp/);
  assert.match(renderer, /PROP_BUILDERS/);
  assert.match(renderer, /from "\.\/props\.js"/);
});

// legacy text guard — delete in P6
test("renderer rebuilds map layout meshes when snapshot mapV changes", () => {
  assert.match(renderer, /snapshot\.mapV/);
  assert.match(renderer, /_mapVersion/);
  assert.match(renderer, /_rebuildMapMeshes/);
  // Must dispose old meshes before creating new ones (no GPU leaks).
  assert.match(renderer, /dispose/);
});

// legacy text guard — delete in P6
test("renderer instantiates plateaus, ramps and obstacle props from the layout", () => {
  assert.match(renderer, /buildPlateau\(pl/);
  assert.match(renderer, /buildRamp\(ramp/);
  assert.match(renderer, /PROP_BUILDERS\[ob\.type\]/);
  // Obstacle props are positioned and rotated from the layout data.
  assert.match(renderer, /ob\.rot/);
});

// legacy text guard — delete in P6
test("renderer clears map meshes on reset", () => {
  assert.match(renderer, /_rebuildMapMeshes\(null/);
  assert.match(renderer, /_mapVersion = -1/);
});

// legacy text guard — delete in P6
test("renderer shows stun VFX keyed off the snapshot st field", () => {
  // `st` is the snapshot field for stunned-remaining-seconds (mirrors `hz`).
  assert.match(renderer, /ps\.st/);
  // A visual effect group is attached to / removed from the player mesh.
  assert.match(renderer, /stunEffect/);
  // The halo spins every frame in the update loop.
  assert.match(renderer, /stunEffect\.rotation\.y/);
});

// --- Step 4: lootable items ---

// legacy text guard — delete in P6
test("renderer imports and calls buildItemDrop", () => {
  assert.match(renderer, /buildItemDrop/, "renderer must import/call buildItemDrop");
});

// --- Bug-1 regression: death-freeze root cause ---

// legacy text guard — delete in P6
test("death handler delegates to effectPos(deadMesh) and does not read .position directly", () => {
  // The call site must use effectPos — the helper owns the .group.position access.
  assert.match(renderer, /effectPos\(deadMesh\)/,
    "renderer must call effectPos(deadMesh) in the death handler");
  assert.doesNotMatch(renderer, /deadMesh\.position\./,
    "renderer must not read .position directly off the mesh entry");
});

// legacy text guard — delete in P6
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

// legacy text guard — delete in P6
test("link and pocketwatch handlers also read position through .group", () => {
  assert.doesNotMatch(renderer, /(aMesh|bMesh|pwMesh)\.position\./);
});

function sourceWithoutComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function builderBody(src, name) {
  const start = src.indexOf(`export function ${name}(`);
  assert.ok(start >= 0, `builder ${name} must exist`);
  const open = src.indexOf("{", start);
  let depth = 0, i = open;
  for (; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") { depth--; if (depth === 0) { i++; break; } }
  }
  return sourceWithoutComments(src.slice(open, i));
}

// legacy text guard — delete in P6
test("voxel.js itself stays free of GLTFLoader/GLB literals (mob GLB loading is isolated to mobModel.js)", () => {
  const code = sourceWithoutComments(voxel);
  assert.doesNotMatch(code, /GLTFLoader/);
  assert.doesNotMatch(code, /assets\/meshy\//);
  assert.doesNotMatch(code, /\.glb\b/i);
});

// legacy text guard — delete in P6
test("minion builder stays procedural (no GLB/Meshy asset loading)", () => {
  const b = builderBody(voxel, "buildMinion");
  assert.doesNotMatch(b, /GLTFLoader|\.glb\b/i);
});

// legacy text guard — delete in P6
test("stone giant gains stratified plates, shoulder boulders, knuckles and spine crystals", () => {
  const b = builderBody(voxel, "buildStoneGiant");
  assert.match(b, /accents/, "stone giant must expose an accents group");
  assert.ok((b.match(/facetedSlab/g) || []).length >= 4,
    "stone giant needs layered stratified plates (>=4 slabs)");
  assert.match(b, /shoulder/i, "stone giant needs shoulder boulders");
  assert.match(b, /knuckle/i, "stone giant needs fist knuckles");
  assert.match(b, /facetedCrystal/, "stone giant needs spine/back crystals");
  assert.ok((b.match(/facetedRock/g) || []).length >= 5,
    "stone giant needs more faceted rock detail (head + fists + shoulders)");
});

// legacy text guard — delete in P6
test("storming vortex gains more shards, extra ring and arc crystals", () => {
  const b = builderBody(voxel, "buildStormingVortex");
  assert.match(b, /i < 12/, "inner shard ring must have >=12 shards");
  assert.match(b, /i < 6/, "outer shard ring must have >=6 shards");
  assert.match(b, /arcCrystals|arcs/, "vortex needs an arc-crystal accent group");
  assert.match(b, /facetedCrystal/, "vortex arc crystals use facetedCrystal");
});

// legacy text guard — delete in P6
test("giant dwarf gains helmet horns, pauldrons, beard braids and boots/gauntlets", () => {
  const b = builderBody(voxel, "buildGiantDwarf");
  assert.match(b, /horn/i, "dwarf needs helmet horns");
  assert.match(b, /pauldron/i, "dwarf needs shoulder pauldrons");
  assert.match(b, /braid/i, "dwarf needs beard braids");
  assert.match(b, /gauntlet/i, "dwarf needs gauntlet detail");
  assert.ok((b.match(/facetedCone/g) || []).length >= 3,
    "dwarf needs helmet top + two horns (>=3 cones)");
});

// legacy text guard — delete in P6
test("fire elemental gains layered flame crown, core shell, more motes and tendrils", () => {
  const b = builderBody(voxel, "buildFireElemental");
  assert.match(b, /crown/i, "elemental needs a layered flame crown");
  assert.match(b, /tendril/i, "elemental needs flame tendrils");
  assert.match(b, /i < 8/, "elemental must orbit >=8 motes");
  assert.ok((b.match(/facetedCone/g) || []).length >= 2,
    "flame crown needs a ring of cones plus a central tongue");
});

// legacy text guard — delete in P6
test("minion gains robe panels, a staff/lantern and a better hat/face", () => {
  const b = builderBody(voxel, "buildMinion");
  assert.match(b, /robe|panel/i, "minion needs robe panels");
  assert.match(b, /staff|lantern/i, "minion needs a staff or lantern prop");
  assert.match(b, /facetedOrb|glowBox|emissive/, "minion staff/lantern needs a glow accent");
});

// legacy text guard — delete in P6
test("animateMob drives newly named secondary accent groups without gameplay change", () => {
  const b = builderBody(voxel, "animateMob");
  assert.match(b, /accents|arcCrystals|arcs/,
    "animateMob must animate the new accent/arc groups");
});

// Fidelity: "increase the poly count of each" means the structural limbs on the
// big, count-bounded mobs must be higher-resolution than the default 6-sided
// hex-prism — raising per-primitive tessellation, not only part count. Octagonal
// (>=8-gon) prisms still read as deliberately faceted while shedding the blocky
// "lazy" silhouette on colossal mobs with cinematic entrances.
function countHiResCylinders(body) {
  return (body.match(/facetedCylinder\([^;]*segments:\s*(8|10|12)\b/g) || []).length;
}

// legacy text guard — delete in P6
test("stone giant limbs are higher-resolution prisms (>=8-gon), not 6-sided", () => {
  const b = builderBody(voxel, "buildStoneGiant");
  assert.ok(countHiResCylinders(b) >= 4,
    "stone giant arms + legs must use >=8-segment faceted cylinders");
});

// legacy text guard — delete in P6
test("giant dwarf limbs are higher-resolution prisms (>=8-gon), not 6-sided", () => {
  const b = builderBody(voxel, "buildGiantDwarf");
  assert.ok(countHiResCylinders(b) >= 4,
    "giant dwarf arms + legs must use >=8-segment faceted cylinders");
});

// legacy text guard — delete in P6
test("fire elemental limbs are higher-resolution prisms (>=8-gon), not 6-sided", () => {
  const b = builderBody(voxel, "buildFireElemental");
  assert.ok(countHiResCylinders(b) >= 2,
    "fire elemental tendril arms must use >=8-segment faceted cylinders");
});
