// Unit tests for src/mapgen.js
// Run with: node test/mapgen.test.mjs
import assert from "node:assert";
import { CFG, isOnArenaWorld } from "../src/config.js";
import { generateMap, MAP_CENTER_CLEAR, MAP_SPAWN_RING_CLEAR } from "../src/mapgen.js";

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

console.log("Map generation tests:");

// Shared fixture: circle world at standard arena radius.
const WORLD  = "circle";
const RADIUS = CFG.ARENA_RADIUS; // 18
const SEED   = 42;

const layout = generateMap(WORLD, RADIUS, SEED);

// ---------------------------------------------------------------------------
// Shape of the returned object
// ---------------------------------------------------------------------------

test("generateMap returns an object with seed, worldId, plateaus, and obstacles", () => {
  assert.strictEqual(layout.seed, SEED, "seed must be preserved");
  assert.strictEqual(layout.worldId, WORLD, "worldId must be stored for shrink culling");
  assert.ok(Array.isArray(layout.plateaus),  "plateaus must be an array");
  assert.ok(Array.isArray(layout.obstacles), "obstacles must be an array");
});

test("plateau count is within the configured range (base, optional +1)", () => {
  const maxCount = CFG.MAP.PLATEAU_BASE_COUNT + 1;
  assert.ok(
    layout.plateaus.length >= 0 &&
    layout.plateaus.length <= maxCount,
    `plateau count ${layout.plateaus.length} exceeds ${maxCount}`
  );
});

test("two high grounds, when present, are far apart", () => {
  // Scan many seeds; whenever a layout yields two plateaus they must respect
  // PLATEAU_MIN_SEPARATION so they sit on opposite parts of the map.
  for (let s = 0; s < 200; s++) {
    const lay = generateMap(WORLD, RADIUS, s);
    if (lay.plateaus.length >= 2) {
      const [a, b] = lay.plateaus;
      assert.ok(
        Math.hypot(a.x - b.x, a.z - b.z) >= CFG.MAP.PLATEAU_MIN_SEPARATION - 1e-6,
        `seed ${s}: plateaus too close (${Math.hypot(a.x - b.x, a.z - b.z).toFixed(1)})`
      );
    }
  }
});

test("obstacle array is non-empty (some objects always placed)", () => {
  // We expect at least the tree and stone types to contribute 1+ object each.
  assert.ok(layout.obstacles.length > 0, "expected at least one obstacle");
});

// ---------------------------------------------------------------------------
// Determinism — same seed ⟹ identical layout
// ---------------------------------------------------------------------------

test("generateMap is deterministic: same seed produces identical layout", () => {
  const a = generateMap(WORLD, RADIUS, SEED);
  const b = generateMap(WORLD, RADIUS, SEED);
  assert.deepStrictEqual(a, b, "layouts must be byte-for-byte identical for the same seed");
});

test("generateMap is deterministic across multiple seeds", () => {
  for (const s of [0, 1, 7, 999, 2 ** 31 - 1]) {
    const a = generateMap(WORLD, RADIUS, s);
    const b = generateMap(WORLD, RADIUS, s);
    assert.deepStrictEqual(a, b, `seed ${s}: layout must be deterministic`);
  }
});

test("different seeds produce different layouts (statistical sanity)", () => {
  const a = generateMap(WORLD, RADIUS, 1);
  const b = generateMap(WORLD, RADIUS, 2);
  // It is astronomically unlikely that two independent seeds produce the exact
  // same obstacle/plateau list.
  const differ =
    a.plateaus.length !== b.plateaus.length ||
    a.obstacles.length !== b.obstacles.length ||
    (a.obstacles[0] && b.obstacles[0] && a.obstacles[0].x !== b.obstacles[0].x);
  assert.ok(differ, "different seeds should produce different layouts");
});

// ---------------------------------------------------------------------------
// Geometry spreads across the STARTING disc (not just the centre) and stays
// inside it. Features that fall off the platform as the arena shrinks are made
// inert by the query layer (covered in collision.test.mjs), so the round-start
// invariant is "on the disc at the starting radius", not ARENA_MIN_RADIUS.
// ---------------------------------------------------------------------------

test("all plateau centres lie on the platform at the starting radius", () => {
  for (const pl of layout.plateaus) {
    assert.ok(
      isOnArenaWorld(WORLD, RADIUS, pl.x, pl.z),
      `plateau centre (${pl.x.toFixed(2)}, ${pl.z.toFixed(2)}) is off the disc at radius ${RADIUS}`
    );
  }
});

test("all obstacle centres lie on the platform at the starting radius", () => {
  for (const ob of layout.obstacles) {
    assert.ok(
      isOnArenaWorld(WORLD, RADIUS, ob.x, ob.z),
      `obstacle ${ob.id} (${ob.type}) centre (${ob.x.toFixed(2)}, ${ob.z.toFixed(2)}) is off the disc at radius ${RADIUS}`
    );
  }
});

test("all geometry bounding circles stay within the starting radius", () => {
  for (const pl of layout.plateaus) {
    const halfExt = Math.hypot(pl.w / 2, pl.d / 2);
    const furthest = Math.hypot(pl.x, pl.z) + halfExt;
    assert.ok(
      furthest <= RADIUS + 0.5,
      `plateau bounding circle (${furthest.toFixed(2)}) exceeds starting radius ${RADIUS}`
    );
  }
  for (const ob of layout.obstacles) {
    const furthest = Math.hypot(ob.x, ob.z) + ob.r;
    assert.ok(
      furthest <= RADIUS + 0.5,
      `obstacle ${ob.id} (${ob.type}) bounding circle (${furthest.toFixed(2)}) exceeds starting radius ${RADIUS}`
    );
  }
});

test("geometry is spread across the map, not clustered at the centre", () => {
  // At least one feature should sit beyond ARENA_MIN_RADIUS — proving placement
  // is no longer confined to the central safe zone.
  const all = [...layout.plateaus, ...layout.obstacles];
  const spread = all.some((f) => Math.hypot(f.x, f.z) > CFG.ARENA_MIN_RADIUS);
  assert.ok(spread, "expected some geometry beyond ARENA_MIN_RADIUS (spread across the map)");
});

// ---------------------------------------------------------------------------
// Centre clearance (nothing blocks the centre spawn / flight lane)
// ---------------------------------------------------------------------------

test("no plateau centre is within MAP_CENTER_CLEAR of the arena centre", () => {
  for (const pl of layout.plateaus) {
    const d = Math.hypot(pl.x, pl.z);
    assert.ok(
      d >= MAP_CENTER_CLEAR - 0.01,
      `plateau too close to centre: dist=${d.toFixed(2)}, required >= ${MAP_CENTER_CLEAR}`
    );
  }
});

test("no obstacle centre is within MAP_CENTER_CLEAR of the arena centre", () => {
  for (const ob of layout.obstacles) {
    const d = Math.hypot(ob.x, ob.z);
    assert.ok(
      d >= MAP_CENTER_CLEAR - 0.01,
      `obstacle ${ob.id} (${ob.type}) too close to centre: dist=${d.toFixed(2)}, required >= ${MAP_CENTER_CLEAR}`
    );
  }
});

// ---------------------------------------------------------------------------
// Spawn-ring clearance
// ---------------------------------------------------------------------------

test("no geometry centre falls inside the spawn-ring clearance band", () => {
  const spawnRingR = Math.min(RADIUS - 3, 12);
  for (const pl of layout.plateaus) {
    const d = Math.hypot(pl.x, pl.z);
    assert.ok(
      Math.abs(d - spawnRingR) >= MAP_SPAWN_RING_CLEAR - 0.01,
      `plateau too close to spawn ring at r=${spawnRingR}: dist=${d.toFixed(2)}`
    );
  }
  for (const ob of layout.obstacles) {
    const d = Math.hypot(ob.x, ob.z);
    assert.ok(
      Math.abs(d - spawnRingR) >= MAP_SPAWN_RING_CLEAR - 0.01,
      `obstacle ${ob.id} (${ob.type}) too close to spawn ring at r=${spawnRingR}: dist=${d.toFixed(2)}`
    );
  }
});

// ---------------------------------------------------------------------------
// Plateau and ramp shape validity
// ---------------------------------------------------------------------------

test("plateaus have positive width, depth, and height", () => {
  for (const pl of layout.plateaus) {
    assert.ok(pl.w > 0 && pl.d > 0,  `plateau w/d must be positive (got ${pl.w}, ${pl.d})`);
    assert.ok(pl.height > 0,         `plateau height must be positive (got ${pl.height})`);
  }
});

test("plateau dimensions are within the configured ranges", () => {
  const m = CFG.MAP;
  for (const pl of layout.plateaus) {
    assert.ok(pl.w >= m.PLATEAU_W_MIN - 0.01 && pl.w <= m.PLATEAU_W_MAX + 0.01,
      `plateau w=${pl.w.toFixed(2)} out of range [${m.PLATEAU_W_MIN}, ${m.PLATEAU_W_MAX}]`);
    assert.ok(pl.d >= m.PLATEAU_D_MIN - 0.01 && pl.d <= m.PLATEAU_D_MAX + 0.01,
      `plateau d=${pl.d.toFixed(2)} out of range [${m.PLATEAU_D_MIN}, ${m.PLATEAU_D_MAX}]`);
    assert.ok(pl.height >= m.PLATEAU_HEIGHT_MIN - 0.01 && pl.height <= m.PLATEAU_HEIGHT_MAX + 0.01,
      `plateau height=${pl.height.toFixed(2)} out of range [${m.PLATEAU_HEIGHT_MIN}, ${m.PLATEAU_HEIGHT_MAX}]`);
  }
});

test("each plateau has 1–2 ramps", () => {
  for (const pl of layout.plateaus) {
    assert.ok(Array.isArray(pl.ramps), "plateau.ramps must be an array");
    assert.ok(pl.ramps.length >= 1 && pl.ramps.length <= 2,
      `expected 1–2 ramps, got ${pl.ramps.length}`);
  }
});

test("each ramp has a valid side index (0–3) and positive dimensions", () => {
  for (const pl of layout.plateaus) {
    for (const rp of pl.ramps) {
      assert.ok([0, 1, 2, 3].includes(rp.side),
        `ramp side must be 0–3, got ${rp.side}`);
      assert.ok(rp.w > 0 && rp.d > 0,
        `ramp dimensions must be positive (w=${rp.w}, d=${rp.d})`);
      assert.ok(typeof rp.x === "number" && typeof rp.z === "number",
        "ramp must have numeric x and z centre coordinates");
    }
  }
});

// ---------------------------------------------------------------------------
// Obstacle shape validity
// ---------------------------------------------------------------------------

test("obstacles have positive radius and height", () => {
  for (const ob of layout.obstacles) {
    assert.ok(ob.r > 0,      `obstacle ${ob.id} r must be positive (got ${ob.r})`);
    assert.ok(ob.height > 0, `obstacle ${ob.id} height must be positive (got ${ob.height})`);
  }
});

test("each obstacle has a type from the recognised set", () => {
  const VALID_TYPES = new Set(["tree","stone","column","debris","wall","boulder","deadGiant","dragonBones"]);
  for (const ob of layout.obstacles) {
    assert.ok(VALID_TYPES.has(ob.type),
      `obstacle ${ob.id} has unknown type "${ob.type}"`);
  }
});

test("obstacle ids are unique non-negative integers", () => {
  const ids = layout.obstacles.map((o) => o.id);
  const unique = new Set(ids);
  assert.strictEqual(unique.size, ids.length, "obstacle ids must be unique");
  for (const id of ids) {
    assert.ok(typeof id === "number" && id >= 0 && Number.isInteger(id),
      `obstacle id ${id} must be a non-negative integer`);
  }
});

test("obstacles have a numeric rotation field", () => {
  for (const ob of layout.obstacles) {
    assert.ok(typeof ob.rot === "number",
      `obstacle ${ob.id} rot must be a number (got ${typeof ob.rot})`);
  }
});

// ---------------------------------------------------------------------------
// Cross-world smoke test — non-circle worlds must also produce valid layouts
// ---------------------------------------------------------------------------

test("generateMap works for all arena worlds without throwing", () => {
  for (const world of CFG.ARENA_WORLDS) {
    let layout;
    assert.doesNotThrow(
      () => { layout = generateMap(world.id, RADIUS, SEED); },
      `generateMap threw for world "${world.id}"`
    );
    assert.ok(layout && Array.isArray(layout.plateaus),
      `layout for world "${world.id}" must have plateaus array`);
    assert.ok(layout && Array.isArray(layout.obstacles),
      `layout for world "${world.id}" must have obstacles array`);
  }
});

// ---------------------------------------------------------------------------
// CFG-level sanity checks for new tunables
// ---------------------------------------------------------------------------

test("CFG.FALL_STUN_DURATION is positive", () => {
  assert.ok(typeof CFG.FALL_STUN_DURATION === "number" && CFG.FALL_STUN_DURATION > 0,
    `FALL_STUN_DURATION=${CFG.FALL_STUN_DURATION} must be positive`);
});

test("CFG.FALL_STUN_MIN_HEIGHT is positive", () => {
  assert.ok(typeof CFG.FALL_STUN_MIN_HEIGHT === "number" && CFG.FALL_STUN_MIN_HEIGHT > 0,
    `FALL_STUN_MIN_HEIGHT=${CFG.FALL_STUN_MIN_HEIGHT} must be positive`);
});

test("CFG.ROUND.SHRINK_RATE was retuned below the old 0.45 value", () => {
  assert.ok(CFG.ROUND.SHRINK_RATE < 0.45,
    `SHRINK_RATE=${CFG.ROUND.SHRINK_RATE} must be below the old 0.45 for pacing`);
});

test("CFG.ROUND.SHRINK_START_DELAY was raised above the old 6 s value", () => {
  assert.ok(CFG.ROUND.SHRINK_START_DELAY > 6,
    `SHRINK_START_DELAY=${CFG.ROUND.SHRINK_START_DELAY} must be above old 6 s for pacing`);
});

test("CFG.MAP contains all required tunable keys", () => {
  const required = [
    "PLACEMENT_RADIUS_FRAC",
    "PLATEAU_BASE_COUNT","PLATEAU_SECOND_CHANCE","PLATEAU_MIN_SEPARATION",
    "PLATEAU_HEIGHT_MIN","PLATEAU_HEIGHT_MAX",
    "PLATEAU_W_MIN","PLATEAU_W_MAX",
    "PLATEAU_D_MIN","PLATEAU_D_MAX",
    "PLATEAU_CLEARANCE","OBS_MIN_GAP",
    "OBS_TREE_MIN","OBS_TREE_MAX",
    "OBS_STONE_MIN","OBS_STONE_MAX",
    "OBS_COLUMN_MIN","OBS_COLUMN_MAX",
    "OBS_DEBRIS_MIN","OBS_DEBRIS_MAX",
    "OBS_WALL_MIN","OBS_WALL_MAX",
    "OBS_BOULDER_MIN","OBS_BOULDER_MAX",
    "OBS_DEADGIANT_MIN","OBS_DEADGIANT_MAX",
    "OBS_DRAGONBONES_MIN","OBS_DRAGONBONES_MAX",
  ];
  for (const k of required) {
    assert.ok(Object.prototype.hasOwnProperty.call(CFG.MAP, k),
      `CFG.MAP.${k} is missing`);
    assert.ok(typeof CFG.MAP[k] === "number", `CFG.MAP.${k} must be a number`);
  }
});

// ---------------------------------------------------------------------------
// CFG.OBSTACLE_TYPES and CFG.DEFAULT_OBSTACLE_TOGGLES registry sanity
// ---------------------------------------------------------------------------

test("CFG.OBSTACLE_TYPES is an ordered array of 8 entries with id and label", () => {
  assert.ok(Array.isArray(CFG.OBSTACLE_TYPES), "OBSTACLE_TYPES must be an array");
  assert.strictEqual(CFG.OBSTACLE_TYPES.length, 8, "expected exactly 8 obstacle type entries");
  const expected = ["tree", "stone", "column", "deadGiant", "dragonBones", "debris", "wall", "boulder"];
  for (let i = 0; i < expected.length; i++) {
    assert.strictEqual(CFG.OBSTACLE_TYPES[i].id, expected[i],
      `OBSTACLE_TYPES[${i}].id should be "${expected[i]}", got "${CFG.OBSTACLE_TYPES[i].id}"`);
    assert.ok(typeof CFG.OBSTACLE_TYPES[i].label === "string" && CFG.OBSTACLE_TYPES[i].label.length > 0,
      `OBSTACLE_TYPES[${i}].label must be a non-empty string`);
  }
});

test("CFG.DEFAULT_OBSTACLE_TOGGLES maps every OBSTACLE_TYPES id to true", () => {
  assert.ok(typeof CFG.DEFAULT_OBSTACLE_TOGGLES === "object" && CFG.DEFAULT_OBSTACLE_TOGGLES !== null,
    "DEFAULT_OBSTACLE_TOGGLES must be an object");
  for (const { id } of CFG.OBSTACLE_TYPES) {
    assert.strictEqual(CFG.DEFAULT_OBSTACLE_TOGGLES[id], true,
      `DEFAULT_OBSTACLE_TOGGLES["${id}"] must be true`);
  }
  // No extra keys beyond the 8 registered ids
  assert.strictEqual(Object.keys(CFG.DEFAULT_OBSTACLE_TOGGLES).length, CFG.OBSTACLE_TYPES.length,
    "DEFAULT_OBSTACLE_TOGGLES must not have extra keys beyond the 8 registered obstacle types");
});

// ---------------------------------------------------------------------------
// Toggle feature: disabling an obstacle type removes it from the output
// ---------------------------------------------------------------------------

test("disabling 'tree' yields zero tree obstacles and non-zero other obstacles", () => {
  const lay = generateMap(WORLD, RADIUS, SEED, { tree: false });
  const trees = lay.obstacles.filter((o) => o.type === "tree");
  assert.strictEqual(trees.length, 0, "no tree obstacles expected when tree is disabled");
  const others = lay.obstacles.filter((o) => o.type !== "tree");
  assert.ok(others.length > 0, "at least one non-tree obstacle must remain when only trees are disabled");
});

test("disabling 'stone' yields zero stone obstacles and non-zero other obstacles", () => {
  const lay = generateMap(WORLD, RADIUS, SEED, { stone: false });
  const stones = lay.obstacles.filter((o) => o.type === "stone");
  assert.strictEqual(stones.length, 0, "no stone obstacles expected when stone is disabled");
  const others = lay.obstacles.filter((o) => o.type !== "stone");
  assert.ok(others.length > 0, "at least one non-stone obstacle must remain when only stones are disabled");
});

test("disabling multiple types removes all of them, leaves the rest", () => {
  const lay = generateMap(WORLD, RADIUS, SEED, { tree: false, column: false, debris: false });
  const disabled = lay.obstacles.filter((o) => ["tree", "column", "debris"].includes(o.type));
  assert.strictEqual(disabled.length, 0, "disabled types must not appear in the output");
  const enabled = lay.obstacles.filter((o) => !["tree", "column", "debris"].includes(o.type));
  assert.ok(enabled.length > 0, "enabled types must still produce obstacles");
});

test("same seed + same toggle set is deterministic (disabling a type shifts later types' RNG stream)", () => {
  // Skipping a disabled type before its RNG draws means subsequent types see a
  // different stream — enabled types DO change position relative to a fully-enabled
  // run.  The contract only guarantees intra-run determinism: identical seed +
  // identical toggle set always produces an identical layout.  That is all
  // multiplayer needs (clients render the host-broadcast mapLayout).
  const a = generateMap(WORLD, RADIUS, SEED, { stone: false });
  const b = generateMap(WORLD, RADIUS, SEED, { stone: false });
  assert.deepStrictEqual(a, b, "same seed + same toggles must produce an identical layout on every call");

  // Verify the cross-type shift is real: a run with stone disabled must differ
  // from a fully-enabled run (for this seed, other types land in new positions).
  const full = generateMap(WORLD, RADIUS, SEED);
  const fullNonStone = full.obstacles.filter((o) => o.type !== "stone");
  const toggledNonStone = a.obstacles.filter((o) => o.type !== "stone");
  // We cannot guarantee they differ for every possible seed, but for SEED they do.
  // If this assertion ever fails, choose a different SEED constant at the top of
  // this file — it does NOT indicate a code regression.
  assert.notDeepStrictEqual(
    toggledNonStone,
    fullNonStone,
    "disabling stone shifts later types' positions — cross-type positions are NOT preserved (expected)"
  );
});

// ---------------------------------------------------------------------------
// Back-compat: all-enabled matches the no-arg default
// ---------------------------------------------------------------------------

test("all-enabled (DEFAULT_OBSTACLE_TOGGLES) produces the same layout as no enabledObstacles arg", () => {
  const withDefaults = generateMap(WORLD, RADIUS, SEED, CFG.DEFAULT_OBSTACLE_TOGGLES);
  const withNoArg    = generateMap(WORLD, RADIUS, SEED);
  assert.deepStrictEqual(withDefaults, withNoArg,
    "passing DEFAULT_OBSTACLE_TOGGLES must be byte-for-byte identical to omitting the 4th arg");
});

test("all-enabled back-compat holds across several seeds", () => {
  for (const s of [0, 7, 100, 999]) {
    const withDefaults = generateMap(WORLD, RADIUS, s, CFG.DEFAULT_OBSTACLE_TOGGLES);
    const withNoArg    = generateMap(WORLD, RADIUS, s);
    assert.deepStrictEqual(withDefaults, withNoArg,
      `seed ${s}: DEFAULT_OBSTACLE_TOGGLES must match omitted 4th arg`);
  }
});

// ---------------------------------------------------------------------------
// Toggle determinism: same seed + same toggle set => identical output
// ---------------------------------------------------------------------------

test("toggle determinism: same seed and {tree:false} always produce identical layouts", () => {
  const a = generateMap(WORLD, RADIUS, SEED, { tree: false });
  const b = generateMap(WORLD, RADIUS, SEED, { tree: false });
  assert.deepStrictEqual(a, b, "same seed and same toggles must produce identical layouts");
});

test("toggle determinism holds for multiple toggle combinations and seeds", () => {
  const cases = [
    { toggles: { tree: false, stone: false }, seeds: [1, 42, 999] },
    { toggles: { wall: false, boulder: false, debris: false }, seeds: [0, 7] },
    { toggles: { deadGiant: false, dragonBones: false }, seeds: [13, 77] },
  ];
  for (const { toggles, seeds } of cases) {
    for (const s of seeds) {
      const a = generateMap(WORLD, RADIUS, s, toggles);
      const b = generateMap(WORLD, RADIUS, s, toggles);
      assert.deepStrictEqual(a, b,
        `seed ${s} with toggles ${JSON.stringify(toggles)}: layout must be deterministic`);
    }
  }
});

// ---------------------------------------------------------------------------
// Empty / undefined enabledObstacles => full set may spawn (no regression)
// ---------------------------------------------------------------------------

test("empty object enabledObstacles ({}) allows all 8 types to spawn (no regression)", () => {
  // With an empty toggles object, no type has enabledObstacles[type] === false,
  // so every OBS_SPEC is processed normally — the layout must equal the no-arg run.
  const withEmpty = generateMap(WORLD, RADIUS, SEED, {});
  const withNoArg = generateMap(WORLD, RADIUS, SEED);
  assert.deepStrictEqual(withEmpty, withNoArg,
    "passing {} as enabledObstacles must be identical to omitting the 4th arg");
});

test("undefined enabledObstacles (omitted) allows all types to spawn (no regression)", () => {
  // generateMap defaults to {} when the 4th arg is omitted; this verifies the
  // call without any explicit toggle argument still produces a full obstacle set.
  const lay = generateMap(WORLD, RADIUS, SEED);
  const types = new Set(lay.obstacles.map((o) => o.type));
  // Trees and stones always have min count >= 1, so they must appear.
  assert.ok(types.has("tree"),  "tree obstacles must spawn when enabledObstacles is omitted");
  assert.ok(types.has("stone"), "stone obstacles must spawn when enabledObstacles is omitted");
});

test("passing undefined explicitly behaves the same as omitting the 4th arg", () => {
  const a = generateMap(WORLD, RADIUS, SEED, undefined);
  const b = generateMap(WORLD, RADIUS, SEED);
  assert.deepStrictEqual(a, b,
    "generateMap(w,r,s,undefined) must equal generateMap(w,r,s)");
});

console.log(`\n${passed} map-gen checks passed.`);
