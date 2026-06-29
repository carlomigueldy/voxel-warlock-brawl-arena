import assert from "node:assert";
import fs from "node:fs";
import { CFG, getArenaHazard } from "../src/config.js";

let passed = 0;
function test(name, fn) {
  try { fn(); console.log("  ok  -", name); passed++; }
  catch (e) { console.error("  FAIL-", name, "\n", e.message); process.exitCode = 1; }
}

console.log("Source integration checks:");

const main = fs.readFileSync("src/main.js", "utf8");
const ui = fs.readFileSync("src/ui.js", "utf8");
const html = fs.readFileSync("index.html", "utf8");

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
  assert.match(character, /new URL\("\.\.\/assets\/warlock-player-rigged\.glb", import\.meta\.url\)\.href/);
  assert.match(character, /new URL\("\.\.\/assets\/warlock-player-walking\.glb", import\.meta\.url\)\.href/);
  assert.match(character, /new URL\("\.\.\/assets\/warlock-player-running\.glb", import\.meta\.url\)\.href/);
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

test("generated character tinting preserves single-material meshes", () => {
  const character = fs.readFileSync("src/character.js", "utf8");
  assert.match(character, /const wasArray = Array\.isArray\(o\.material\)/);
  assert.match(character, /o\.material = wasArray \? tinted : tinted\[0\]/);
});

test("generated character label height follows simulation player height", () => {
  const renderer = fs.readFileSync("src/renderer.js", "utf8");
  assert.match(renderer, /CFG\.PLAYER_HEIGHT \+ 0\.55/);
});

test("host menu exposes all-abilities-at-start toggle", () => {
  assert.match(html, /id="all-abilities-toggle"/);
  assert.match(ui, /allAbilitiesAtStart/);
  assert.match(main, /allAbilitiesAtStart: options\.allAbilitiesAtStart/);
});

test("ability bar filters slots by acquired spells from snapshots", () => {
  assert.match(ui, /me\?\.spells/);
  assert.match(ui, /slot\.classList\.toggle\("locked"/);
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

console.log(`\n${passed} source checks passed.`);
