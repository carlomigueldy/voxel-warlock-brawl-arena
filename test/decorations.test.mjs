// Unit tests for src/decorations.js (pure placement logic only — the THREE
// assembly half lives in src/decorationsView.js and is intentionally NOT
// imported here; "three" only resolves via index.html's browser import map,
// so a module that imports it can't load under plain `node test/x.test.mjs`,
// same constraint test/source.test.mjs documents for renderer.js/voxel.js
// via readFileSync text-guards instead of live imports).
// Run with: node test/decorations.test.mjs
import assert from "node:assert";
import { CFG, isOnArenaWorld } from "../src/config.js";
import { generateMap } from "../src/mapgen.js";
import { computeDecorationPlacements } from "../src/decorations.js";

let passed = 0;
function test(name, fn) {
  try {
    fn();
    console.log("  ok  -", name);
    passed++;
  } catch (e) {
    console.error("  FAIL-", name, "\n", e.message);
    process.exitCode = 1;
  }
}

console.log("Decoration placement tests:");

const RADIUS = CFG.ARENA_RADIUS; // 18
const WORLDS = CFG.ARENA_WORLDS.map((w) => w.id); // circle, islands, bridge, cross, ring

test("all 5 arena worlds have a DECOR theme with valid prop pools", () => {
  assert.strictEqual(WORLDS.length, 5, "expected exactly 5 arena worlds");
  for (const worldId of WORLDS) {
    const theme = CFG.DECOR.themes[worldId];
    assert.ok(theme, `CFG.DECOR.themes must define an entry for "${worldId}"`);
    assert.ok(Array.isArray(theme.ring) && theme.ring.length > 0, `${worldId}: ring pool must be non-empty`);
    assert.ok(Array.isArray(theme.interior) && theme.interior.length > 0, `${worldId}: interior pool must be non-empty`);
  }
});

test("determinism: same seed + inputs produce byte-identical placements", () => {
  const layout = generateMap("circle", RADIUS, 777);
  const a = computeDecorationPlacements(777, "circle", RADIUS, layout.obstacles);
  const b = computeDecorationPlacements(777, "circle", RADIUS, layout.obstacles);
  assert.deepStrictEqual(a, b, "identical inputs must yield identical placement arrays");
});

test("different seeds produce different placements", () => {
  const layout = generateMap("circle", RADIUS, 1);
  const a = computeDecorationPlacements(1, "circle", RADIUS, layout.obstacles);
  const b = computeDecorationPlacements(2, "circle", RADIUS, layout.obstacles);
  assert.notDeepStrictEqual(a, b, "different seeds should (overwhelmingly likely) differ");
});

test("counts never exceed CFG.DECOR.maxCount", () => {
  for (let s = 0; s < 60; s++) {
    const layout = generateMap("circle", RADIUS, s);
    const placements = computeDecorationPlacements(s, "circle", RADIUS, layout.obstacles);
    assert.ok(
      placements.length <= CFG.DECOR.maxCount,
      `seed ${s}: ${placements.length} placements exceeds maxCount ${CFG.DECOR.maxCount}`
    );
  }
});

test("every ring placement sits outside arenaRadius + 1", () => {
  for (let s = 0; s < 60; s++) {
    const layout = generateMap("circle", RADIUS, s);
    const placements = computeDecorationPlacements(s, "circle", RADIUS, layout.obstacles);
    for (const p of placements.filter((p) => p.ring)) {
      const d = Math.hypot(p.x, p.z);
      assert.ok(d > RADIUS + 1, `seed ${s}: ring placement at d=${d.toFixed(2)} is not outside radius+1`);
    }
  }
});

test("every interior placement respects the obstacle clearance", () => {
  for (let s = 0; s < 60; s++) {
    const layout = generateMap("circle", RADIUS, s);
    const placements = computeDecorationPlacements(s, "circle", RADIUS, layout.obstacles);
    for (const p of placements.filter((p) => !p.ring)) {
      for (const ob of layout.obstacles) {
        const d = Math.hypot(p.x - ob.x, p.z - ob.z);
        assert.ok(
          d >= ob.r + CFG.DECOR.interiorClearance - 1e-9,
          `seed ${s}: interior placement at (${p.x.toFixed(2)},${p.z.toFixed(2)}) is only ${d.toFixed(2)} from obstacle r=${ob.r.toFixed(2)} (needs >= ${(ob.r + CFG.DECOR.interiorClearance).toFixed(2)})`
        );
      }
    }
  }
});

test("every interior placement is still on solid ground (isOnArenaWorld)", () => {
  for (let s = 0; s < 30; s++) {
    const layout = generateMap("cross", RADIUS, s); // "cross" has a non-trivial footprint shape
    const placements = computeDecorationPlacements(s, "cross", RADIUS, layout.obstacles);
    for (const p of placements.filter((p) => !p.ring)) {
      assert.ok(
        isOnArenaWorld("cross", RADIUS, p.x, p.z),
        `seed ${s}: interior placement at (${p.x.toFixed(2)},${p.z.toFixed(2)}) is off the "cross" world footprint`
      );
    }
  }
});

test("every placement's prop name exists in that world's DECOR pools", () => {
  for (const worldId of WORLDS) {
    const theme = CFG.DECOR.themes[worldId];
    const validNames = new Set([...theme.ring, ...theme.interior].map((e) => e.prop));
    const layout = generateMap(worldId, RADIUS, 99);
    const placements = computeDecorationPlacements(99, worldId, RADIUS, layout.obstacles);
    for (const p of placements) {
      assert.ok(validNames.has(p.prop), `${worldId}: placement references unknown prop "${p.prop}"`);
    }
  }
});

test("works for all 5 worldIds without throwing and returns array-shaped output", () => {
  for (const worldId of WORLDS) {
    const layout = generateMap(worldId, RADIUS, 555);
    const placements = computeDecorationPlacements(555, worldId, RADIUS, layout.obstacles);
    assert.ok(Array.isArray(placements), `${worldId}: must return an array`);
    for (const p of placements) {
      assert.strictEqual(typeof p.prop, "string");
      assert.strictEqual(typeof p.x, "number");
      assert.strictEqual(typeof p.z, "number");
      assert.strictEqual(typeof p.rot, "number");
      assert.strictEqual(typeof p.scale, "number");
      assert.strictEqual(typeof p.ring, "boolean");
    }
  }
});

test("gracefully handles an empty obstacles array (all obstacle types disabled)", () => {
  const placements = computeDecorationPlacements(42, "circle", RADIUS, []);
  assert.ok(Array.isArray(placements));
  assert.ok(placements.length > 0, "ring placements alone should still populate the round");
});

console.log(`\n${passed} decoration placement checks passed.`);
