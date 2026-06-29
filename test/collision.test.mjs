// Unit tests for src/arena-query.js
// Run with: node test/collision.test.mjs
//
// Tests the three query functions with hand-crafted layouts so the math can be
// verified independently of mapgen's seeded RNG.
import assert from "node:assert";
import { CFG } from "../src/config.js";
import {
  groundHeightAt,
  blocksMovement,
  obstaclesBlockingRay,
  onRamp,
  MapQuery,
} from "../src/arena-query.js";

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

// ---------------------------------------------------------------------------
// Shared test layout
//
// Plateau A: centre (5, 0), w=2, d=2, height=2.
//   Top footprint: x ∈ [4, 6], z ∈ [-1, 1].
//   Ramp: side=1 (-x face), rampLen=2 (= height), rampWide=0.9.
//     Centre (3, 0), w=2, d=0.9.  Footprint: x ∈ [2, 4], z ∈ [-0.45, 0.45].
//     Head at x=4 (height 2), foot at x=2 (height 0).
//
// Plateau B: centre (0, 8), w=2, d=2, height=1.5.
//   Top footprint: x ∈ [-1, 1], z ∈ [7, 9].
//   Ramp: side=2 (+z face), rampLen=1.5, rampWide=0.9.
//     Centre (0, 9.75), w=0.9, d=1.5.  Footprint: x ∈ [-0.45,0.45], z ∈ [9, 10.5].
//     Head at z=9 (height 1.5), foot at z=10.5 (height 0).
//
// Obstacle: stone at (-4, 0), r=1, height=2.
// ---------------------------------------------------------------------------
const PLAT_A_HEIGHT = 2;
const PLAT_B_HEIGHT = 1.5;
const OBS_HEIGHT    = 2;

const layout = {
  plateaus: [
    {
      x: 5, z: 0, w: 2, d: 2, height: PLAT_A_HEIGHT,
      ramps: [
        { side: 1, x: 3, z: 0, w: 2, d: 0.9 }, // -x face
      ],
    },
    {
      x: 0, z: 8, w: 2, d: 2, height: PLAT_B_HEIGHT,
      ramps: [
        { side: 2, x: 0, z: 9.75, w: 0.9, d: 1.5 }, // +z face
      ],
    },
  ],
  obstacles: [
    { id: 0, type: "stone", x: -4, z: 0, r: 1, height: OBS_HEIGHT, rot: 0 },
  ],
};

// Null layout — all queries return safe defaults.
const nullLayout = null;

// ---------------------------------------------------------------------------
// groundHeightAt
// ---------------------------------------------------------------------------
console.log("\ngroundHeightAt:");

test("null layout returns PLATFORM_TOP", () => {
  assert.strictEqual(groundHeightAt(0, 0, nullLayout), CFG.PLATFORM_TOP);
});

test("base platform (no plateau, no ramp) returns PLATFORM_TOP", () => {
  assert.strictEqual(groundHeightAt(0, 0, layout), CFG.PLATFORM_TOP);
  assert.strictEqual(groundHeightAt(-8, 0, layout), CFG.PLATFORM_TOP);
  assert.strictEqual(groundHeightAt(0, -5, layout), CFG.PLATFORM_TOP);
});

test("point on plateau A top returns PLATFORM_TOP + plateau height", () => {
  const expected = CFG.PLATFORM_TOP + PLAT_A_HEIGHT;
  assert.strictEqual(groundHeightAt(5, 0, layout), expected);
  assert.strictEqual(groundHeightAt(4.1, 0.5, layout), expected);
  assert.strictEqual(groundHeightAt(5.9, -0.9, layout), expected);
});

test("point on plateau B top returns PLATFORM_TOP + plateau B height", () => {
  const expected = CFG.PLATFORM_TOP + PLAT_B_HEIGHT;
  assert.strictEqual(groundHeightAt(0, 8, layout), expected);
});

test("ramp A: foot (x=2, z=0) returns PLATFORM_TOP (ground level)", () => {
  const h = groundHeightAt(2, 0, layout);
  assert.ok(Math.abs(h - CFG.PLATFORM_TOP) < 0.01, `expected ~0, got ${h}`);
});

test("ramp A: head (x=4, z=0) returns PLATFORM_TOP + plateau height (full)", () => {
  // At x=4 the ramp head meets the plateau top — height should equal plateau height.
  const h = groundHeightAt(4, 0, layout);
  const expected = CFG.PLATFORM_TOP + PLAT_A_HEIGHT;
  assert.ok(Math.abs(h - expected) < 0.01, `expected ~${expected}, got ${h}`);
});

test("ramp A: midpoint (x=3, z=0) returns interpolated half-height", () => {
  // Ramp head at x=4, foot at x=2, width=2.
  // At x=3: t = (4-3)/2 = 0.5, so height = 2 * (1-0.5) = 1.0
  const h = groundHeightAt(3, 0, layout);
  const expected = CFG.PLATFORM_TOP + PLAT_A_HEIGHT * 0.5;
  assert.ok(Math.abs(h - expected) < 0.01, `expected ~${expected}, got ${h}`);
});

test("ramp A: quarter-way (x=2.5, z=0) returns quarter-height", () => {
  // t = (4-2.5)/2 = 0.75 → height = 2 * 0.25 = 0.5
  const h = groundHeightAt(2.5, 0, layout);
  const expected = CFG.PLATFORM_TOP + PLAT_A_HEIGHT * 0.25;
  assert.ok(Math.abs(h - expected) < 0.01, `expected ~${expected}, got ${h}`);
});

test("ramp B (+z face): foot (z=10.5) returns ground, head (z=9) returns full height", () => {
  // Foot at z=10.5 (ramp.z + ramp.d/2 = 9.75 + 0.75)
  const hFoot = groundHeightAt(0, 10.5, layout);
  assert.ok(Math.abs(hFoot - CFG.PLATFORM_TOP) < 0.05, `foot expected ~0, got ${hFoot}`);
  // Head at z=9 (ramp.z - ramp.d/2 = 9.75 - 0.75)
  const hHead = groundHeightAt(0, 9, layout);
  const expected = CFG.PLATFORM_TOP + PLAT_B_HEIGHT;
  assert.ok(Math.abs(hHead - expected) < 0.05, `head expected ~${expected}, got ${hHead}`);
});

test("ramp B: midpoint (z=9.75) returns half-height", () => {
  // Ramp centre z=9.75, head=9, foot=10.5, length=1.5.
  // At z=9.75: t = (9 - 9.75) is negative... wait.
  // side=2 (+z face): head at ramp.z - ramp.d/2 = 9.75 - 0.75 = 9.0
  // t = (z - head) / ramp.d = (9.75 - 9.0) / 1.5 = 0.75/1.5 = 0.5
  // height = 1.5 * (1 - 0.5) = 0.75
  const h = groundHeightAt(0, 9.75, layout);
  const expected = CFG.PLATFORM_TOP + PLAT_B_HEIGHT * 0.5;
  assert.ok(Math.abs(h - expected) < 0.05, `expected ~${expected}, got ${h}`);
});

test("point outside ramp z-extent is not on ramp", () => {
  // z=1 is outside ramp A's z range [-0.45, 0.45] — should get PLATFORM_TOP
  const h = groundHeightAt(3, 1, layout);
  assert.strictEqual(h, CFG.PLATFORM_TOP);
});

// ---------------------------------------------------------------------------
// blocksMovement
// ---------------------------------------------------------------------------
console.log("\nblocksMovement:");

test("null layout never blocks", () => {
  assert.strictEqual(blocksMovement(5, 0, 0, nullLayout), false);
  assert.strictEqual(blocksMovement(-4, 0, 0, nullLayout), false);
});

test("open ground (no feature) does not block", () => {
  assert.strictEqual(blocksMovement(0, 0, 0, layout), false);
  assert.strictEqual(blocksMovement(-8, 3, 0, layout), false);
});

test("inside plateau A box, from ground (fromY=0) — blocks", () => {
  // x=5, z=0 is plateau A centre; player on ground cannot walk through
  assert.strictEqual(blocksMovement(5, 0, 0, layout), true);
});

test("inside plateau A box, fromY near plateau top — does NOT block", () => {
  // Player is already on the plateau top (fromY ≈ 2.0), so no wall
  assert.strictEqual(blocksMovement(5, 0, PLAT_A_HEIGHT - 0.1, layout), false);
});

test("inside plateau A box, fromY well above plateau top — does NOT block", () => {
  assert.strictEqual(blocksMovement(5, 0, PLAT_A_HEIGHT + 1, layout), false);
});

test("ramp footprint (x=3, z=0), fromY=0 — does NOT block (ramp is accessible)", () => {
  // Ramp A footprint: x ∈ [2,4], z ∈ [-0.45,0.45]
  assert.strictEqual(blocksMovement(3, 0, 0, layout), false);
});

test("inside obstacle circle, fromY=0 — blocks", () => {
  // Obstacle at (-4, 0, r=1). Point (-4, 0) is inside.
  assert.strictEqual(blocksMovement(-4, 0, 0, layout), true);
});

test("inside obstacle circle, fromY above obstacle height — does NOT block", () => {
  // fromY = 2.5 > obstacle.height (2.0) by more than BLOCK_THRESHOLD (0.3)?
  // Actually BLOCK_THRESHOLD=0.3: ob.height <= fromY + BLOCK_THRESHOLD
  // 2.0 <= 2.5 + 0.3 = 2.8  → true → skip obstacle → not blocked
  assert.strictEqual(blocksMovement(-4, 0, OBS_HEIGHT + 0.5, layout), false);
});

test("just outside obstacle circle does NOT block", () => {
  // Distance from (-4+1.1, 0) to (-4, 0) = 1.1 > r=1 → no block
  assert.strictEqual(blocksMovement(-2.9, 0, 0, layout), false);
});

test("inside plateau B box, from ground — blocks", () => {
  assert.strictEqual(blocksMovement(0, 8, 0, layout), true);
});

test("ramp B footprint, fromY=0 — does NOT block", () => {
  assert.strictEqual(blocksMovement(0, 9.75, 0, layout), false);
});

// ---------------------------------------------------------------------------
// obstaclesBlockingRay
// ---------------------------------------------------------------------------
console.log("\nobstaclesBlockingRay:");

test("null layout never blocks a ray", () => {
  assert.strictEqual(obstaclesBlockingRay(0, 0, 1, 10, 0, 1, nullLayout), false);
});

test("ray through open space does not block", () => {
  // Goes from (0,0,1) to (0,2,1) — pure z movement, no obstacles near x=0,y=1
  assert.strictEqual(obstaclesBlockingRay(0, 0, 1, 0, 2, 1, layout), false);
});

test("ray at y=1 blocked by plateau A wall (x hits [4,6])", () => {
  // Horizontal ray from (0,0,1) to (10,0,1): passes through x=[4,6] at y=1.
  // Plateau top = 2. 1 < 2 → blocked.
  assert.strictEqual(obstaclesBlockingRay(0, 0, 1, 10, 0, 1, layout), true);
});

test("ray at y=3 clears plateau A top (plateau top = 2)", () => {
  // y=3 > plateau.height=2 → the ray passes over the plateau, not through its wall
  assert.strictEqual(obstaclesBlockingRay(0, 0, 3, 10, 0, 3, layout), false);
});

test("ray through obstacle at y=1 (below obstacle.height=2) — blocks", () => {
  // Ray from (-6,0,1) to (-2,0,1): passes through circle at (-4,0,r=1).
  // Entry t=0.25, y=1 < 2 → blocked.
  assert.strictEqual(obstaclesBlockingRay(-6, 0, 1, -2, 0, 1, layout), true);
});

test("ray through obstacle at y=2.5 (above obstacle.height=2) — does NOT block", () => {
  // Same XZ path but ray height 2.5 > obstacle.height 2
  assert.strictEqual(obstaclesBlockingRay(-6, 0, 2.5, -2, 0, 2.5, layout), false);
});

test("ray that misses obstacle by going around it does not block", () => {
  // Ray from (-6, 2, 1) to (-2, 2, 1): z=2 is more than r=1 away from obstacle (z=0)
  assert.strictEqual(obstaclesBlockingRay(-6, 2, 1, -2, 2, 1, layout), false);
});

test("ray from above plateau descending through its wall is blocked", () => {
  // Start (5, 0, 3) — above plateau A. End (5, 0, -1) — below.
  // This is a vertical ray (x0=x1=5, z0=0=z1) but different y.
  // Plateau A XZ: x ∈ [4,6], z ∈ [-1,1]. Point (5,0) is inside. tEnter=0.
  // yEnter = 3, yExit = -1. yLo=-1, yHi=3. plateauTop=2. yLo < 2 AND yHi > -0.1 → blocked.
  assert.strictEqual(obstaclesBlockingRay(5, 0, 3, 5, 0, -1, layout), true);
});

test("ray that starts and ends outside plateau A in XZ, z offset clears it", () => {
  // z=2 is outside plateau A's z range [-1,1] so the XZ segment never enters
  assert.strictEqual(obstaclesBlockingRay(0, 2, 1, 10, 2, 1, layout), false);
});

test("diagonal descending ray blocked by plateau A wall", () => {
  // From (2, 0, 0) at height 3 to (7, 0, 0) at height 0.
  // Entry into plateau A (x=4..6) at t = (4-2)/(7-2) = 0.4. y = 3 + (0-3)*0.4 = 1.8.
  // 1.8 < plateauTop=2 and 1.8 > BASE_Y-0.1=-0.1 → blocked.
  assert.strictEqual(obstaclesBlockingRay(2, 0, 3, 7, 0, 0, layout), true);
});

// ---------------------------------------------------------------------------
// onRamp
// ---------------------------------------------------------------------------
console.log("\nonRamp:");

test("null layout returns false", () => {
  assert.strictEqual(onRamp(3, 0, null), false);
  assert.strictEqual(onRamp(5, 0, null), false);
});

test("point on open ground (no ramp) returns false", () => {
  assert.strictEqual(onRamp(0, 0, layout), false);
  assert.strictEqual(onRamp(-8, 3, layout), false);
});

test("point inside ramp A footprint (x=3, z=0) returns true", () => {
  // Ramp A: x ∈ [2, 4], z ∈ [-0.45, 0.45]
  assert.strictEqual(onRamp(3, 0, layout), true);
});

test("point at ramp A foot (x=2, z=0) returns true", () => {
  assert.strictEqual(onRamp(2, 0, layout), true);
});

test("point at ramp A head (x=4, z=0) returns true", () => {
  assert.strictEqual(onRamp(4, 0, layout), true);
});

test("point outside ramp A z-extent is NOT on ramp", () => {
  // z=1 is outside ramp A z range [-0.45, 0.45]
  assert.strictEqual(onRamp(3, 1, layout), false);
});

test("point on plateau A top (but outside ramp footprint) is NOT on ramp", () => {
  // (5, 0) is on plateau top, not in any ramp footprint
  assert.strictEqual(onRamp(5, 0, layout), false);
});

test("point inside ramp B footprint returns true", () => {
  // Ramp B: x ∈ [-0.45,0.45], z ∈ [9, 10.5]
  assert.strictEqual(onRamp(0, 9.75, layout), true);
  assert.strictEqual(onRamp(0, 10.5, layout), true);
  assert.strictEqual(onRamp(0, 9, layout), true);
});

test("layout with no ramps: onRamp always false", () => {
  const noRampLayout = {
    plateaus: [{ x: 5, z: 0, w: 2, d: 2, height: 2, ramps: [] }],
    obstacles: [],
  };
  assert.strictEqual(onRamp(5, 0, noRampLayout), false);
  assert.strictEqual(onRamp(3, 0, noRampLayout), false);
});

test("MapQuery.onRamp delegates correctly", () => {
  const q = new MapQuery(layout);
  assert.strictEqual(q.onRamp(3, 0), true);  // inside ramp A
  assert.strictEqual(q.onRamp(5, 0), false); // plateau top, not ramp
  assert.strictEqual(q.onRamp(0, 0), false); // open ground
});

test("MapQuery.onRamp with null layout returns false", () => {
  const q = new MapQuery(null);
  assert.strictEqual(q.onRamp(3, 0), false);
  q.setLayout(layout);
  assert.strictEqual(q.onRamp(3, 0), true);
  q.setLayout(null);
  assert.strictEqual(q.onRamp(3, 0), false);
});

// ---------------------------------------------------------------------------
// MapQuery class
// ---------------------------------------------------------------------------
console.log("\nMapQuery class:");

test("MapQuery with null layout returns safe defaults", () => {
  const q = new MapQuery(null);
  assert.strictEqual(q.groundHeightAt(5, 0), CFG.PLATFORM_TOP);
  assert.strictEqual(q.blocksMovement(5, 0, 0), false);
  assert.strictEqual(q.obstaclesBlockingRay(0, 0, 1, 10, 0, 1), false);
});

test("MapQuery setLayout activates queries", () => {
  const q = new MapQuery(null);
  assert.strictEqual(q.groundHeightAt(5, 0), CFG.PLATFORM_TOP);
  q.setLayout(layout);
  assert.strictEqual(q.groundHeightAt(5, 0), CFG.PLATFORM_TOP + PLAT_A_HEIGHT);
  assert.strictEqual(q.blocksMovement(5, 0, 0), true);
  assert.strictEqual(q.obstaclesBlockingRay(0, 0, 1, 10, 0, 1), true);
});

test("MapQuery setLayout(null) clears back to safe defaults", () => {
  const q = new MapQuery(layout);
  q.setLayout(null);
  assert.strictEqual(q.groundHeightAt(5, 0), CFG.PLATFORM_TOP);
  assert.strictEqual(q.blocksMovement(5, 0, 0), false);
});

test("MapQuery constructed with layout immediately usable", () => {
  const q = new MapQuery(layout);
  assert.strictEqual(q.groundHeightAt(5, 0), CFG.PLATFORM_TOP + PLAT_A_HEIGHT);
  assert.strictEqual(q.blocksMovement(-4, 0, 0), true);
});

// ---------------------------------------------------------------------------
// Integration: round-trip with a layout produced by generateMap
// ---------------------------------------------------------------------------
console.log("\nintegration with generateMap layout:");

import { generateMap } from "../src/mapgen.js";

test("groundHeightAt is always >= PLATFORM_TOP for any layout point", () => {
  const gen = generateMap("circle", CFG.ARENA_RADIUS, 12345);
  // Sample a grid of points
  for (let x = -5; x <= 5; x += 1) {
    for (let z = -5; z <= 5; z += 1) {
      const h = groundHeightAt(x, z, gen);
      assert.ok(h >= CFG.PLATFORM_TOP, `height ${h} at (${x},${z}) below PLATFORM_TOP`);
    }
  }
});

test("blocksMovement never triggers from plateau height (player already on top)", () => {
  const gen = generateMap("circle", CFG.ARENA_RADIUS, 99);
  for (const pl of gen.plateaus) {
    // At plateau centre, from plateau height → should NOT block
    assert.strictEqual(
      blocksMovement(pl.x, pl.z, pl.height, gen), false,
      `plateau at (${pl.x.toFixed(1)},${pl.z.toFixed(1)}) height=${pl.height.toFixed(2)} blocks from top`
    );
  }
});

test("obstaclesBlockingRay with real layout: plateau ray test is consistent with groundHeightAt", () => {
  const gen = generateMap("circle", CFG.ARENA_RADIUS, 77);
  // For each plateau, a ray just above its top should NOT be blocked.
  for (const pl of gen.plateaus) {
    const overTop = CFG.PLATFORM_TOP + pl.height + 0.5; // above plateau
    // Ray from one side of the plateau to the other, well above
    const blocked = obstaclesBlockingRay(
      pl.x - pl.w, pl.z, overTop,
      pl.x + pl.w, pl.z, overTop,
      gen
    );
    assert.strictEqual(blocked, false,
      `ray above plateau at (${pl.x.toFixed(1)},${pl.z.toFixed(1)}) should not be blocked`
    );
  }
});

// ---------------------------------------------------------------------------
console.log(`\n${passed} collision/query checks passed.`);
