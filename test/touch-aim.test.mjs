// Tests for aim-mode-aware touch casting (WS-G).
// Run with: node test/touch-aim.test.mjs
import assert from "node:assert";
import { aimForTouchCast } from "../src/touchAim.js";
import { SPELLS } from "../src/config.js";

let passed = 0;
function test(name, fn) {
  try { fn(); console.log("  ok  -", name); passed++; }
  catch (e) { console.error("  FAIL-", name, "\n", e.message); process.exitCode = 1; }
}

function dist(x1, z1, x2, z2) { return Math.hypot(x2 - x1, z2 - z1); }
function angleOf(px, pz, tx, tz) { return Math.atan2(tz - pz, tx - px); }
function near(a, b, eps = 1e-6) { return Math.abs(a - b) < eps; }

console.log("Touch aim-mode targeting tests:");

// ---- DIRECTIONAL_PROJECTILE (fireball) ----
test("fireball (DIRECTIONAL_PROJECTILE): aims along facing heading, ignores enemies", () => {
  const pose = { x: 0, z: 0, heading: 0 }; // facing +x
  const enemies = [{ id: "b", x: -50, z: -50, al: true }]; // behind — must be ignored
  const { tx, tz } = aimForTouchCast(SPELLS.fireball, pose, enemies, null);
  assert.ok(tx > 0, "should aim in front of the caster (+x)");
  assert.ok(near(tz, 0, 1e-3), `tz should stay ~0 for heading 0 (got ${tz})`);
});

test("boomerang (DIRECTIONAL_PROJECTILE, has range): result point is at spell range along facing", () => {
  const pose = { x: 2, z: 2, heading: Math.PI / 2 }; // facing +z
  const { tx, tz } = aimForTouchCast(SPELLS.boomerang, pose, [], null);
  assert.ok(near(dist(pose.x, pose.z, tx, tz), SPELLS.boomerang.range, 1e-3),
    `distance should equal boomerang.range (${SPELLS.boomerang.range}), got ${dist(pose.x, pose.z, tx, tz)}`);
});

// ---- CONE_SPRAY (fireSpray, push) ----
test("fireSpray (CONE_SPRAY, no explicit range): still a finite direction-only point along heading", () => {
  const pose = { x: 0, z: 0, heading: Math.PI }; // facing -x
  const { tx, tz } = aimForTouchCast(SPELLS.fireSpray, pose, [], null);
  assert.ok(Number.isFinite(tx) && Number.isFinite(tz), "point must be finite");
  assert.ok(tx < 0, "should aim toward -x for heading PI");
});

test("push (CONE_SPRAY, has range 7): distance matches range", () => {
  const pose = { x: 0, z: 0, heading: 0 };
  const { tx, tz } = aimForTouchCast(SPELLS.push, pose, [], null);
  assert.ok(near(dist(0, 0, tx, tz), SPELLS.push.range, 1e-3));
});

// ---- DASH_IMPACT (thrust, no range field) ----
test("thrust (DASH_IMPACT, no range field): falls back to a finite default probe distance", () => {
  const pose = { x: 5, z: 5, heading: 0 };
  const { tx, tz } = aimForTouchCast(SPELLS.thrust, pose, [], null);
  assert.ok(dist(5, 5, tx, tz) > 0, "should produce a nonzero-distance direction point");
  assert.ok(near(tz, 5, 1e-3), "tz unchanged for heading 0");
});

// ---- NEAREST_TARGET_LOCK (lightning, range 18) ----
test("lightning (NEAREST_TARGET_LOCK): locks onto nearest alive enemy within range*1.25", () => {
  const pose = { x: 0, z: 0, heading: 0 };
  const enemies = [
    { id: "far", x: 100, z: 100, al: true },
    { id: "near", x: 5, z: 0, al: true },
  ];
  const { tx, tz } = aimForTouchCast(SPELLS.lightning, pose, enemies, null);
  assert.ok(near(tx, 5) && near(tz, 0), `should target the nearer enemy, got (${tx},${tz})`);
});

test("lightning: dead/falling/spectating enemies are skipped", () => {
  const pose = { x: 0, z: 0, heading: 0 };
  const enemies = [
    { id: "dead", x: 3, z: 0, al: false },
    { id: "falling", x: 4, z: 0, al: true, f: true },
    { id: "spectating", x: 4.5, z: 0, al: true, sp: true },
    { id: "alive", x: 10, z: 0, al: true },
  ];
  const { tx, tz } = aimForTouchCast(SPELLS.lightning, pose, enemies, null);
  assert.ok(near(tx, 10) && near(tz, 0), `should skip dead/falling/spectating and target the alive one, got (${tx},${tz})`);
});

test("lightning: enemy beyond range*1.25 (18*1.25=22.5) falls back to facing direction", () => {
  const pose = { x: 0, z: 0, heading: 0 };
  const enemies = [{ id: "toofar", x: 30, z: 0, al: true }];
  const { tx, tz } = aimForTouchCast(SPELLS.lightning, pose, enemies, null);
  assert.ok(tx < 30, "should NOT lock onto the out-of-range enemy");
  assert.ok(near(dist(0, 0, tx, tz), SPELLS.lightning.range, 1e-3),
    "fallback point should sit at spell range along facing");
});

test("lightning: no enemies at all falls back to facing direction at range", () => {
  const pose = { x: 0, z: 0, heading: Math.PI / 4 };
  const { tx, tz } = aimForTouchCast(SPELLS.lightning, pose, [], null);
  assert.ok(near(dist(0, 0, tx, tz), SPELLS.lightning.range, 1e-3));
});

// ---- TETHER_LOCK (drain, range 14) ----
test("drain (TETHER_LOCK): locks onto nearest alive enemy within range*1.25", () => {
  const pose = { x: 0, z: 0, heading: 0 };
  const enemies = [{ id: "a", x: 6, z: 8, al: true }]; // dist=10 < 14*1.25
  const { tx, tz } = aimForTouchCast(SPELLS.drain, pose, enemies, null);
  assert.ok(near(tx, 6) && near(tz, 8));
});

test("drain: no valid target falls back to facing at range", () => {
  const pose = { x: 0, z: 0, heading: 0 };
  const { tx, tz } = aimForTouchCast(SPELLS.drain, pose, [], null);
  assert.ok(near(dist(0, 0, tx, tz), SPELLS.drain.range, 1e-3));
});

// ---- GROUND_AOE_AT_POINT (meteor, range 18, radius 7) ----
test("meteor (GROUND_AOE_AT_POINT): aims at nearest alive enemy when in range", () => {
  const pose = { x: 0, z: 0, heading: 0 };
  const enemies = [{ id: "a", x: 5, z: 0, al: true }];
  const { tx, tz } = aimForTouchCast(SPELLS.meteor, pose, enemies, null);
  assert.ok(near(tx, 5) && near(tz, 0));
});

test("meteor: nearest enemy beyond spell range is clamped to range, not ignored", () => {
  const pose = { x: 0, z: 0, heading: 0 };
  const enemies = [{ id: "a", x: 40, z: 0, al: true }]; // 40 > range 18
  const { tx, tz } = aimForTouchCast(SPELLS.meteor, pose, enemies, null);
  assert.ok(near(dist(0, 0, tx, tz), SPELLS.meteor.range, 1e-3),
    `clamped point should sit exactly at range (${SPELLS.meteor.range}), got dist=${dist(0, 0, tx, tz)}`);
  assert.ok(near(tz, 0, 1e-3), "direction toward the far enemy should be preserved (still along +x)");
});

test("meteor: no enemies falls back to facing * 0.7 * range", () => {
  const pose = { x: 0, z: 0, heading: 0 };
  const { tx, tz } = aimForTouchCast(SPELLS.meteor, pose, [], null);
  assert.ok(near(dist(0, 0, tx, tz), SPELLS.meteor.range * 0.7, 1e-3));
});

// ---- BLINK_MOVE_TO_POINT (teleport, range 20) ----
test("teleport (BLINK_MOVE_TO_POINT): aims along facing * range when not near the arena edge", () => {
  const pose = { x: 0, z: 0, heading: 0 };
  const arena = { radius: 18 };
  const { tx, tz } = aimForTouchCast(SPELLS.teleport, pose, [], arena);
  assert.ok(near(dist(0, 0, tx, tz), SPELLS.teleport.range, 1e-3));
  assert.ok(tx > 0);
});

test("teleport: near arena edge (>0.8*radius from center) recovers toward the center instead", () => {
  const arena = { radius: 18 };
  // Player standing at (16, 0): dist from center = 16 > 0.8*18 = 14.4 -> recovery branch.
  const pose = { x: 16, z: 0, heading: 0 }; // facing further outward (+x), would be a bad blink
  const { tx, tz } = aimForTouchCast(SPELLS.teleport, pose, [], arena);
  assert.ok(tx < 16, "recovery should aim back toward the center (-x), not further out (+x)");
});

test("teleport: edge-recovery point never exceeds spell range from the caster", () => {
  const arena = { radius: 18 };
  const pose = { x: 17, z: 0, heading: 0 };
  const { tx, tz } = aimForTouchCast(SPELLS.teleport, pose, [], arena);
  assert.ok(dist(17, 0, tx, tz) <= SPELLS.teleport.range + 1e-6);
});

test("teleport: with no arena info, never crashes and still returns a facing-based point", () => {
  const pose = { x: 16, z: 0, heading: 0 };
  const { tx, tz } = aimForTouchCast(SPELLS.teleport, pose, [], null);
  assert.ok(Number.isFinite(tx) && Number.isFinite(tz));
});

// ---- SELF_BUFF / SELF_AOE ----
test("shield (SELF_BUFF): casts at the caster's own position", () => {
  const pose = { x: 3, z: -4, heading: 1.2 };
  const { tx, tz } = aimForTouchCast(SPELLS.shield, pose, [{ id: "a", x: 99, z: 99, al: true }], null);
  assert.ok(near(tx, 3) && near(tz, -4));
});

test("vacuum (SELF_AOE): casts at the caster's own position", () => {
  const pose = { x: -7, z: 2, heading: 0.3 };
  const { tx, tz } = aimForTouchCast(SPELLS.vacuum, pose, [], null);
  assert.ok(near(tx, -7) && near(tz, 2));
});

// ---- Sanity: no randomness, deterministic for identical inputs ----
test("aimForTouchCast is deterministic (no Math.random) — same inputs, same outputs", () => {
  const pose = { x: 1, z: 1, heading: 0.5 };
  const enemies = [{ id: "a", x: 4, z: 4, al: true }];
  const a = aimForTouchCast(SPELLS.gravity, pose, enemies, { radius: 18 });
  const b = aimForTouchCast(SPELLS.gravity, pose, enemies, { radius: 18 });
  assert.deepStrictEqual(a, b);
});

console.log(`\n${passed} touch-aim tests passed.`);
