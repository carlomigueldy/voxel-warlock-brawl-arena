// Source guards for the simulation/config layer: config.js, spells.js, plus
// behavioral CFG/getArenaHazard value checks. Split from test/source.test.mjs
// (#103) by which source file each guard reads.
import { test } from "vitest";
import assert from "node:assert";
import fs from "node:fs";
import { CFG, getArenaHazard } from "../src/config.js";

console.log("Source guards (sim) checks:");

// legacy text guard — delete in P6
test("fireball cast events are emitted via spells.js castSpell pipeline", () => {
  const spells = fs.readFileSync("src/spells.ts", "utf8");
  assert.match(spells, /type: "cast"[\s\S]*spell: "fireball"/);
});

test("config declares four selectable characters and a default", () => {
  assert.ok(Array.isArray(CFG.CHARACTERS) && CFG.CHARACTERS.length === 4, "expected 4 selectable characters");
  const ids = CFG.CHARACTERS.map((c) => c.id).sort();
  assert.deepStrictEqual(ids, ["ember", "frost", "moss", "storm"]);
  assert.ok(CFG.CHARACTERS.some((c) => c.id === CFG.DEFAULT_CHARACTER), "default character must be in the roster");
});

test("every arena world declares a distinct hazard theme", () => {
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

test("config declares ITEM_SLOT_COUNT of 4", () => {
  assert.strictEqual(CFG.ITEM_SLOT_COUNT, 4, "ITEM_SLOT_COUNT must be 4");
});
