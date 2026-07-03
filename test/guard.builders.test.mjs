// Source guards for the procedural model/asset builders: character.ts,
// voxel.ts, props.ts, lowpoly.ts, pool.ts. Split out of test/guard.render.test.mjs
// (P6 #179) when that file's renderer.js/arena.ts/preview.js/renderer-util.js
// assertions died with the legacy renderer — these builder-only assertions
// still hold against files the React/R3F path actually uses, so they moved
// here instead of being deleted alongside the rest.
import { test } from "vitest";
import assert from "node:assert";
import fs from "node:fs";
import { CFG } from "../src/config.js";

console.log("Source guards (builders) checks:");

const character = fs.readFileSync("src/character.ts", "utf8");
const voxel = fs.readFileSync("src/voxel.ts", "utf8");
const props = fs.readFileSync("src/props.ts", "utf8");

test("generated character asset URLs are built via the asset() helper", () => {
  // Character-aware loader resolves rigged + walk + run GLBs per selectable
  // character through the asset() helper (root-absolute URLs into public/,
  // BASE_URL-prefixed) now that assets are served from public/ under Vite.
  assert.match(character, /import \{ asset \} from "\.\/asset-url\.js"/);
  // P4-140 TS port adds a `: string` param annotation (strict mode) — tolerate it.
  assert.match(character, /const url = \(p(?:: string)?\) => asset\(p\)/);
  assert.match(character, /assets\/characters\/[\w-]+-rigged\.glb/);
  assert.match(character, /assets\/characters\/[\w-]+-walking\.glb/);
  assert.match(character, /assets\/characters\/[\w-]+-running\.glb/);
});

test("character roster exposes four rigged voxel characters", () => {
  assert.match(character, /export const CHARACTER_ASSETS/);
  for (const id of ["ember", "frost", "storm", "moss"]) {
    assert.match(character, new RegExp(`${id}:`), `roster must include ${id}`);
  }
});

test("generated character model is scaled to the simulation player height", () => {
  assert.match(character, /import \{ CFG \} from "\.\/config\.js";/);
  assert.match(character, /const TARGET_HEIGHT = CFG\.PLAYER_HEIGHT;/);
});

test("generated character size is measured from skinned mesh geometry, not setFromObject", () => {
  // setFromObject mis-measures skinned meshes whose armature node carries a
  // tiny scale (0.01 here), producing a ~100x oversize. Size must come from the
  // skinned mesh geometry's own bounding box instead.
  assert.match(character, /computeBoundingBox\(\)/);
  assert.match(character, /\.boundingBox/);
  assert.doesNotMatch(character, /setFromObject/);
});

test("generated character model is bottom aligned after scaling", () => {
  assert.match(character, /scene\.position\.y -= measured\.min\.y \* s/);
});

test("generated character clones materials and marks identity with a hero glyph", () => {
  // Materials are cloned per instance (no body tint, original shading preserved);
  // player identity is shown by a glowing hero glyph.
  assert.match(character, /const wasArray = Array\.isArray\(o\.material\)/);
  assert.match(character, /o\.material = wasArray \? cloned : cloned\[0\]/);
  assert.match(character, /makeHeroGlyph/);
});

test("character GLB instances accept a cast archetype trigger", () => {
  assert.match(character, /CastAnimator/);
  assert.match(character, /triggerCast/);
});

test("character rig loads per-character walk and run animation clips", () => {
  assert.match(character, /walk/i);
  assert.match(character, /run/i);
});

test("character ids match the loadable GLB roster", () => {
  for (const c of CFG.CHARACTERS) {
    assert.match(character, new RegExp(`${c.id}:`), `character.js must define assets for ${c.id}`);
  }
});

test("voxel fallback warlock supports cast archetype overlays", () => {
  assert.match(voxel, /castArchetype|triggerCast/);
});

test("voxel hazard builder is theme-driven, not hardcoded lava", () => {
  assert.match(voxel, /export function buildHazard/);
  assert.match(voxel, /export function animateHazard/);
});

test("voxel exposes a theme-driven hazard detail builder and animator", () => {
  assert.match(voxel, /export function buildHazardDetails/);
  assert.match(voxel, /export function animateHazardDetails/);
});

// pool.ts's procedural bolt builder — extracted from guard.render's old
// "renderer builds bolts and runes via the procedural voxel builders" test,
// which mixed this assertion with two renderer-only ones that died with
// renderer.js.
test("pool.ts exposes the procedural bolt builder acquireBolt() draws from", () => {
  assert.match(fs.readFileSync("src/pool.ts", "utf8"), /buildBolt\(color, kind\)/);
});

test("voxel exports buildPlateau and buildRamp for map elevation rendering", () => {
  assert.match(voxel, /export function buildPlateau/);
  assert.match(voxel, /export function buildRamp/);
  // Both builders follow buildPlatform's world top/side palette convention.
  assert.match(voxel, /world\.top/);
  assert.match(voxel, /world\.side/);
});

test("props.js exports PROP_BUILDERS registry with all eight obstacle types", () => {
  assert.match(props, /export const PROP_BUILDERS/);
  for (const type of ["tree", "stone", "column", "debris", "wall", "boulder", "deadGiant", "dragonBones"]) {
    assert.match(props, new RegExp(type), `PROP_BUILDERS must include ${type}`);
  }
  // Confirm no GLB / Meshy imports — all props are procedural BoxGeometry.
  assert.doesNotMatch(props, /GLTFLoader|\.glb/i);
  assert.doesNotMatch(props, /meshy/i);
});

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

test("voxel.js rebuilds non-character assets via lowpoly faceted helpers", () => {
  assert.match(voxel, /from "\.\/lowpoly\.js"/);
  assert.match(voxel, /facetedRock|facetedCylinder|facetedCone|facetedShard/);
  // The character fallback (buildWarlock) stays on the box recipe — it is
  // explicitly excluded from the low-poly faceted conversion.
  assert.match(voxel, /export function buildWarlock/);
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

test("voxel.js itself stays free of GLTFLoader/GLB literals (mob GLB loading is isolated to mobModel.js)", () => {
  const code = sourceWithoutComments(voxel);
  assert.doesNotMatch(code, /GLTFLoader/);
  assert.doesNotMatch(code, /assets\/meshy\//);
  assert.doesNotMatch(code, /\.glb\b/i);
});

test("minion builder stays procedural (no GLB/Meshy asset loading)", () => {
  const b = builderBody(voxel, "buildMinion");
  assert.doesNotMatch(b, /GLTFLoader|\.glb\b/i);
});

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

test("storming vortex gains more shards, extra ring and arc crystals", () => {
  const b = builderBody(voxel, "buildStormingVortex");
  assert.match(b, /i < 12/, "inner shard ring must have >=12 shards");
  assert.match(b, /i < 6/, "outer shard ring must have >=6 shards");
  assert.match(b, /arcCrystals|arcs/, "vortex needs an arc-crystal accent group");
  assert.match(b, /facetedCrystal/, "vortex arc crystals use facetedCrystal");
});

test("giant dwarf gains helmet horns, pauldrons, beard braids and boots/gauntlets", () => {
  const b = builderBody(voxel, "buildGiantDwarf");
  assert.match(b, /horn/i, "dwarf needs helmet horns");
  assert.match(b, /pauldron/i, "dwarf needs shoulder pauldrons");
  assert.match(b, /braid/i, "dwarf needs beard braids");
  assert.match(b, /gauntlet/i, "dwarf needs gauntlet detail");
  assert.ok((b.match(/facetedCone/g) || []).length >= 3,
    "dwarf needs helmet top + two horns (>=3 cones)");
});

test("fire elemental gains layered flame crown, core shell, more motes and tendrils", () => {
  const b = builderBody(voxel, "buildFireElemental");
  assert.match(b, /crown/i, "elemental needs a layered flame crown");
  assert.match(b, /tendril/i, "elemental needs flame tendrils");
  assert.match(b, /i < 8/, "elemental must orbit >=8 motes");
  assert.ok((b.match(/facetedCone/g) || []).length >= 2,
    "flame crown needs a ring of cones plus a central tongue");
});

test("minion gains robe panels, a staff/lantern and a better hat/face", () => {
  const b = builderBody(voxel, "buildMinion");
  assert.match(b, /robe|panel/i, "minion needs robe panels");
  assert.match(b, /staff|lantern/i, "minion needs a staff or lantern prop");
  assert.match(b, /facetedOrb|glowBox|emissive/, "minion staff/lantern needs a glow accent");
});

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

test("stone giant limbs are higher-resolution prisms (>=8-gon), not 6-sided", () => {
  const b = builderBody(voxel, "buildStoneGiant");
  assert.ok(countHiResCylinders(b) >= 4,
    "stone giant arms + legs must use >=8-segment faceted cylinders");
});

test("giant dwarf limbs are higher-resolution prisms (>=8-gon), not 6-sided", () => {
  const b = builderBody(voxel, "buildGiantDwarf");
  assert.ok(countHiResCylinders(b) >= 4,
    "giant dwarf arms + legs must use >=8-segment faceted cylinders");
});

test("fire elemental limbs are higher-resolution prisms (>=8-gon), not 6-sided", () => {
  const b = builderBody(voxel, "buildFireElemental");
  assert.ok(countHiResCylinders(b) >= 2,
    "fire elemental tendril arms must use >=8-segment faceted cylinders");
});
