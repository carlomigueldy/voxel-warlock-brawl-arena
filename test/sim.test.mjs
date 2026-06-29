// Headless smoke + logic tests for the pure simulation (no browser needed).
// Run with: node test/sim.test.mjs
import assert from "node:assert";
import { Simulation, PHASE } from "../src/sim.js";
import { CFG } from "../src/config.js";

let passed = 0;
function test(name, fn) {
  try { fn(); console.log("  ok  -", name); passed++; }
  catch (e) { console.error("  FAIL-", name, "\n", e.message); process.exitCode = 1; }
}

function advance(sim, seconds, dt = 1 / CFG.TICK_RATE) {
  for (let t = 0; t < seconds; t += dt) sim.step(dt);
}

console.log("Simulation tests:");

test("players can be added and assigned distinct colors", () => {
  const sim = new Simulation();
  const a = sim.addPlayer("a", "Alice");
  const b = sim.addPlayer("b", "Bob");
  assert.notStrictEqual(a.colorIndex, b.colorIndex);
  assert.strictEqual(sim.players.size, 2);
});

test("startMatch spawns players on the platform and enters countdown", () => {
  const sim = new Simulation();
  sim.addPlayer("a", "A"); sim.addPlayer("b", "B");
  sim.startMatch();
  assert.strictEqual(sim.phase, PHASE.COUNTDOWN);
  for (const p of sim.players.values()) {
    assert.ok(sim.arena.isOnPlatform(p.x, p.z), "spawned off platform");
    assert.ok(p.alive);
  }
});

test("countdown transitions to playing", () => {
  const sim = new Simulation();
  sim.addPlayer("a", "A"); sim.addPlayer("b", "B");
  sim.startMatch();
  advance(sim, CFG.ROUND.COUNTDOWN + 0.2);
  assert.strictEqual(sim.phase, PHASE.PLAYING);
});

test("firing spawns a bolt that travels", () => {
  const sim = new Simulation();
  sim.addPlayer("a", "A"); sim.addPlayer("b", "B");
  sim.startMatch();
  advance(sim, CFG.ROUND.COUNTDOWN + 0.1);
  const a = sim.players.get("a");
  a.x = 0; a.z = 0; a.aim = 0;
  sim.setInput("a", { move: [0, 0], aim: 0, fire: true, seq: 1 });
  sim.step(1 / CFG.TICK_RATE);
  assert.ok(sim.bolts.length >= 1, "no bolt spawned");
  const bx0 = sim.bolts[0].x;
  sim.setInput("a", { move: [0, 0], aim: 0, fire: false, seq: 2 });
  sim.step(0.1);
  assert.ok(sim.bolts[0].x > bx0, "bolt did not travel");
});

test("a bolt hit applies knockback velocity to the victim", () => {
  const sim = new Simulation();
  sim.addPlayer("a", "A"); sim.addPlayer("b", "B");
  sim.startMatch();
  advance(sim, CFG.ROUND.COUNTDOWN + 0.1);
  const a = sim.players.get("a");
  const b = sim.players.get("b");
  // Place A just left of B, aiming right toward B.
  a.x = -2; a.z = 0; a.aim = 0; a.cooldown = 0;
  b.x = -0.5; b.z = 0; b.vx = 0; b.vz = 0;
  sim.setInput("a", { move: [0, 0], aim: 0, fire: true, seq: 1 });
  sim.step(1 / CFG.TICK_RATE); // spawn bolt
  sim.setInput("a", { move: [0, 0], aim: 0, fire: false, seq: 2 });
  for (let i = 0; i < 5; i++) sim.step(1 / CFG.TICK_RATE);
  assert.ok(b.vx > 0, "victim was not knocked in +x direction (vx=" + b.vx + ")");
});

test("charge increases knockback on subsequent hits (Smash-style)", () => {
  const sim = new Simulation();
  const b = sim.addPlayer("b", "B");
  // direct unit test of player physics
  b.x = 0; b.z = 0; b.vx = 0; b.alive = true;
  b.applyHit(1, 0);
  const firstKb = b.vx;
  b.vx = 0;
  b.applyHit(1, 0);
  const secondKb = b.vx;
  assert.ok(secondKb > firstKb, "knockback did not scale with charge");
});

test("a player knocked past the edge falls and dies", () => {
  const sim = new Simulation();
  sim.addPlayer("a", "A"); sim.addPlayer("b", "B");
  sim.startMatch();
  advance(sim, CFG.ROUND.COUNTDOWN + 0.1);
  const b = sim.players.get("b");
  b.x = CFG.ARENA_RADIUS - 0.1; b.z = 0;
  b.vx = 60; // huge shove off the edge
  advance(sim, 3);
  assert.strictEqual(b.alive, false, "player off the edge should be dead");
});

test("round ends with a winner when only one survives", () => {
  const sim = new Simulation();
  sim.addPlayer("a", "A"); sim.addPlayer("b", "B");
  sim.startMatch();
  advance(sim, CFG.ROUND.COUNTDOWN + 0.1);
  const b = sim.players.get("b");
  b.alive = false; // simulate B already dead
  sim.step(1 / CFG.TICK_RATE);
  assert.strictEqual(sim.phase, PHASE.ROUND_END);
  assert.strictEqual(sim.lastWinnerId, "a");
  assert.strictEqual(sim.players.get("a").score, 1);
});

test("arena shrinks after the configured delay", () => {
  const sim = new Simulation();
  sim.addPlayer("a", "A"); sim.addPlayer("b", "B");
  sim.startMatch();
  advance(sim, CFG.ROUND.COUNTDOWN + 0.1);
  const r0 = sim.arena.radius;
  advance(sim, CFG.ROUND.SHRINK_START_DELAY + 2);
  assert.ok(sim.arena.radius < r0, "arena did not shrink");
});

test("snapshot is JSON-serializable and contains players + bolts", () => {
  const sim = new Simulation();
  sim.addPlayer("a", "A"); sim.addPlayer("b", "B");
  sim.startMatch();
  const snap = sim.snapshot();
  const round = JSON.parse(JSON.stringify(snap));
  assert.ok(Array.isArray(round.players));
  assert.ok(Array.isArray(round.bolts));
  assert.strictEqual(round.players.length, 2);
});

test("match cannot start with fewer than two players", () => {
  const sim = new Simulation();
  sim.addPlayer("a", "A");
  assert.strictEqual(sim.canStartMatch(), false);
  assert.strictEqual(sim.startMatch(), false);
  assert.strictEqual(sim.phase, PHASE.LOBBY);
});

test("disconnecting during a two-player round returns the survivor to lobby", () => {
  const sim = new Simulation();
  sim.addPlayer("a", "A"); sim.addPlayer("b", "B");
  assert.strictEqual(sim.startMatch(), true);
  advance(sim, CFG.ROUND.COUNTDOWN + 0.1);
  sim.removePlayer("b");
  assert.strictEqual(sim.phase, PHASE.LOBBY);
  assert.strictEqual(sim.lastWinnerId, null);
  assert.strictEqual(sim.players.get("a").score, 0);
  assert.strictEqual(sim.canStartMatch(), false);
});

test("late players joining an active round are spectators until next round", () => {
  const sim = new Simulation();
  sim.addPlayer("a", "A"); sim.addPlayer("b", "B");
  assert.strictEqual(sim.startMatch(), true);
  advance(sim, CFG.ROUND.COUNTDOWN + 0.1);
  const c = sim.addPlayer("c", "C");
  assert.strictEqual(c.alive, false);
  assert.strictEqual(c.spectating, true);
});

test("malformed input is sanitized before the host simulation uses it", () => {
  const sim = new Simulation();
  sim.addPlayer("a", "A"); sim.addPlayer("b", "B");
  assert.strictEqual(sim.startMatch(), true);
  advance(sim, CFG.ROUND.COUNTDOWN + 0.1);
  assert.doesNotThrow(() => sim.setInput("a", { move: "bad", aim: Infinity, fire: true, seq: 1 }));
  assert.deepStrictEqual(sim.players.get("a").input.move, [0, 0]);
  assert.strictEqual(sim.players.get("a").input.aim, 0);
  assert.doesNotThrow(() => sim.step(1 / CFG.TICK_RATE));
});

console.log(`\n${passed} tests passed.`);
