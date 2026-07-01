// Unit coverage for the pure social helpers in net.js: chat sanitize + the
// per-sender rate limiter. These are the plan's sim-testable social surface
// (mute-list / voice / UI depend on browser globals and are verified in the
// manual playtest instead).
import assert from "node:assert";
import { sanitizeChat, makeChatRateLimiter } from "../src/net.js";
import { CFG } from "../src/config.js";

let passed = 0;
function test(name, fn) {
  fn();
  console.log(`  ok  - ${name}`);
  passed++;
}

console.log("Social chat tests:");

test("sanitizeChat trims and collapses whitespace", () => {
  assert.strictEqual(sanitizeChat("  hello   world  "), "hello world");
});

test("sanitizeChat strips control characters", () => {
  assert.strictEqual(sanitizeChat("hi\x00\x07there\x7F"), "hithere");
});

test("sanitizeChat caps at CHAT_MAX_LEN", () => {
  const long = "a".repeat(CFG.SOCIAL.CHAT_MAX_LEN + 50);
  assert.strictEqual(sanitizeChat(long).length, CFG.SOCIAL.CHAT_MAX_LEN);
});

test("sanitizeChat returns empty string for nullish / whitespace-only", () => {
  assert.strictEqual(sanitizeChat(null), "");
  assert.strictEqual(sanitizeChat(undefined), "");
  assert.strictEqual(sanitizeChat("   \t \n "), "");
});

test("rate limiter allows up to max then blocks within the window", () => {
  const allow = makeChatRateLimiter({ max: 3, windowMs: 10000 });
  assert.strictEqual(allow("p1"), true);
  assert.strictEqual(allow("p1"), true);
  assert.strictEqual(allow("p1"), true);
  assert.strictEqual(allow("p1"), false, "4th message in window is blocked");
});

test("rate limiter is independent per sender", () => {
  const allow = makeChatRateLimiter({ max: 1, windowMs: 10000 });
  assert.strictEqual(allow("a"), true);
  assert.strictEqual(allow("a"), false);
  assert.strictEqual(allow("b"), true, "a different sender has its own budget");
});

console.log(`\n${passed} social tests passed.`);
