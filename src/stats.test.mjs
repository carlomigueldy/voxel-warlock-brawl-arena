// Pure unit tests for kill-attribution logic.
// Run with: node src/stats.test.mjs
import assert from "node:assert";
import { resolveKillCredit } from "./player.js";
import { CFG } from "./config.js";

let passed = 0;
function test(name, fn) {
  try { fn(); console.log("  ok  -", name); passed++; }
  catch (e) { console.error("  FAIL-", name, "\n", e.message); process.exitCode = 1; }
}

console.log("Kill attribution tests:");

test("attacker within window gets kill credit", () => {
  const now = Date.now();
  // Attacked 2 seconds ago — well within the 5-second window.
  const result = resolveKillCredit("attacker1", now - 2_000, now, CFG.KILL_CREDIT_WINDOW);
  assert.strictEqual(result, "attacker1");
});

test("attacker just inside the window boundary gets kill credit", () => {
  const now = Date.now();
  // 100 ms before the window closes.
  const justInside = now - (CFG.KILL_CREDIT_WINDOW * 1_000 - 100);
  const result = resolveKillCredit("a", justInside, now, CFG.KILL_CREDIT_WINDOW);
  assert.strictEqual(result, "a");
});

test("attacker exactly at the window boundary gets no kill credit", () => {
  const now = Date.now();
  // Elapsed time equals exactly the window (>= comparison; not within the window).
  const exactBoundary = now - CFG.KILL_CREDIT_WINDOW * 1_000;
  const result = resolveKillCredit("a", exactBoundary, now, CFG.KILL_CREDIT_WINDOW);
  assert.strictEqual(result, null);
});

test("environmental death outside the window credits no kill", () => {
  const now = Date.now();
  // Attacked more than 5 seconds ago then walked into lava — no credit.
  const staleAttack = now - (CFG.KILL_CREDIT_WINDOW + 2) * 1_000;
  const result = resolveKillCredit("attacker1", staleAttack, now, CFG.KILL_CREDIT_WINDOW);
  assert.strictEqual(result, null,
    "stale attack outside the window should not yield a kill");
});

test("environmental death with no prior attacker credits no kill", () => {
  const now = Date.now();
  // Fell into lava without being hit at all.
  assert.strictEqual(resolveKillCredit(null, 0, now, CFG.KILL_CREDIT_WINDOW), null);
});

test("self/no-attacker death is a death only, not a kill", () => {
  const now = Date.now();
  // No attacker id stored.
  assert.strictEqual(resolveKillCredit(null, now, now, CFG.KILL_CREDIT_WINDOW), null,
    "null attackerId must never yield a kill");
});

test("resolveKillCredit handles zero lastAttackerAt (uninitialised) safely", () => {
  const now = Date.now();
  // lastAttackerAt=0 means no attacker was ever recorded this session.
  const result = resolveKillCredit("ghost", 0, now, CFG.KILL_CREDIT_WINDOW);
  // 0 is far outside the window for any reasonable value of now.
  assert.strictEqual(result, null,
    "a lastAttackerAt of 0 (uninitialised) must not yield a kill credit");
});

console.log(`\n${passed} tests passed.`);
