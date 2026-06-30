// Tests for cast-time / channel state machine (Step 3).
// Run with: node test/cast.test.mjs
import assert from "node:assert";
import { Simulation, PHASE } from "../src/sim.js";
import { CFG, SPELLS } from "../src/config.js";

let passed = 0;
function test(name, fn) {
  try { fn(); console.log("  ok  -", name); passed++; }
  catch (e) { console.error("  FAIL-", name, "\n", e.message); process.exitCode = 1; }
}

function advance(sim, seconds, dt = 1 / CFG.TICK_RATE) {
  for (let t = 0; t < seconds; t += dt) sim.step(dt);
}

// 2-player sim in PLAYING phase with flat arena.
function playingSim() {
  const sim = new Simulation({ seed: 42 });
  sim.addPlayer("a", "A"); sim.addPlayer("b", "B");
  sim.startMatch();
  advance(sim, CFG.ROUND.COUNTDOWN + 0.1);
  sim.arena.setLayout(null);
  for (const p of sim.players.values()) p.groundY = CFG.PLATFORM_TOP;
  // Seed all spells so cast-mechanic tests can use any spell (strict slots are
  // enforced by the slot array, not the spells Set that canCast() checks).
  for (const p of sim.players.values()) p.spells = new Set(Object.keys(SPELLS));
  return sim;
}

// Queue one cast and run one tick.
function cast(sim, id, spell, tx = NaN, tz = NaN) {
  const p = sim.players.get(id);
  sim.setInput(id, { move: [0, 0], aim: p.aim, seq: (p.input.seq || 0) + 1, casts: [{ id: Date.now() + Math.random(), spell, tx, tz }] });
  sim.step(1 / CFG.TICK_RATE);
}

console.log("Cast-time / channel state-machine tests:");

test("10: explode wind-up — no AoE before castTime; AoE fires and clears after", () => {
  const sim = playingSim();
  const a = sim.players.get("a"), b = sim.players.get("b");
  a.x = 0; a.z = 0; a.aim = 0; b.x = 3; b.z = 0;
  const hpBefore = b.hp;

  cast(sim, "a", "explode", 3, 0);
  // activeCast should be set; no damage yet
  assert.ok(a.activeCast, "activeCast should be set after explode cast");
  assert.strictEqual(b.hp, hpBefore, "explode AoE should not fire before castTime");

  // castStart event should have been emitted (still in current tick's events)
  const startEv = sim.events.find(e => e.type === "castStart" && e.spell === "explode");
  assert.ok(startEv, "castStart event not emitted for explode");

  // Collect events across advance to catch castFinish
  let sawFinish = false;
  const dt = 1 / CFG.TICK_RATE;
  for (let t = 0; t < SPELLS.explode.castTime + 0.2; t += dt) {
    sim.step(dt);
    if (sim.events.find(e => e.type === "castFinish" && e.spell === "explode")) sawFinish = true;
  }
  assert.ok(b.hp < hpBefore, "explode AoE should fire after castTime");
  assert.ok(!a.activeCast, "activeCast should clear after explode fires");
  assert.ok(sawFinish, "castFinish event not emitted for explode");
});

test("11: heal channel restores HP each tick and clears after channel duration", () => {
  const sim = playingSim();
  const a = sim.players.get("a");
  a.x = 0; a.z = 0; a.hp = 50; // damaged
  const hp0 = a.hp;

  cast(sim, "a", "heal", NaN, NaN);
  assert.ok(a.activeCast, "activeCast should be set for heal channel");

  const tick = SPELLS.heal.tick || CFG.CAST_TICK_DEFAULT;
  // Advance by one tick interval — hp should rise
  advance(sim, tick + 0.01);
  assert.ok(a.hp > hp0, `heal should restore HP each tick (was ${hp0}, now ${a.hp})`);

  // Advance past full channel
  const hp1 = a.hp;
  advance(sim, SPELLS.heal.channel);
  assert.ok(a.hp >= hp1, "HP should not drop during heal channel");
  assert.ok(!a.activeCast, "activeCast should clear after channel completes");
});

test("12: vacuum channel pulls nearby enemy inward and slows them", () => {
  const sim = playingSim();
  const a = sim.players.get("a"), b = sim.players.get("b");
  a.x = 0; a.z = 0; b.x = 4; b.z = 0; b.vx = 0; b.vz = 0;

  cast(sim, "a", "vacuum", NaN, NaN);
  assert.ok(a.activeCast, "activeCast should be set for vacuum");

  const d0 = Math.hypot(b.x - a.x, b.z - a.z);
  advance(sim, 0.3);
  const d1 = Math.hypot(b.x - a.x, b.z - a.z);
  assert.ok(d1 < d0, `vacuum should pull enemy closer (d0=${d0.toFixed(2)} d1=${d1.toFixed(2)})`);
  assert.ok(b.status.slowMul != null && b.status.slowMul <= 1, "vacuum should apply slow");
});

test("13: drag channel targets one enemy and repeatedly yanks them toward caster", () => {
  const sim = playingSim();
  const a = sim.players.get("a"), b = sim.players.get("b");
  a.x = 0; a.z = 0; a.aim = 0; b.x = 8; b.z = 0; b.vx = 0; b.vz = 0;

  cast(sim, "a", "drag", NaN, NaN);
  assert.ok(a.activeCast, "activeCast should be set for drag");

  const tick = SPELLS.drag.tick || CFG.CAST_TICK_DEFAULT;
  advance(sim, tick + 0.01);
  // targetId should be locked in
  assert.ok(a.activeCast == null || (a.activeCast && a.activeCast.targetId != null),
    "drag should capture a targetId on first tick");
  // b should have gained velocity toward a (negative vx since b is at +x)
  assert.ok(b.vx < 0, `drag should yank target toward caster (vx=${b.vx})`);
});

test("14: interrupt by stun — heal channel stops on stun", () => {
  const sim = playingSim();
  const a = sim.players.get("a");
  a.x = 0; a.z = 0; a.hp = 50;

  cast(sim, "a", "heal", NaN, NaN);
  assert.ok(a.activeCast, "activeCast should be set");

  // Apply stun externally
  a.status.stunned = 2.0;
  sim.step(1 / CFG.TICK_RATE);

  assert.ok(!a.activeCast, "stun should interrupt the heal channel");
  const ev = sim.events.find(e => e.type === "castInterrupt" && e.id === "a" && e.reason === "disable");
  assert.ok(ev, "castInterrupt(disable) event should be emitted on stun");
});

test("15: interrupt by silence — channel stops on disabled status", () => {
  const sim = playingSim();
  const a = sim.players.get("a");
  a.x = 0; a.z = 0; a.hp = 50;

  cast(sim, "a", "heal", NaN, NaN);
  assert.ok(a.activeCast);

  a.status.disabled = 1.5;
  sim.step(1 / CFG.TICK_RATE);

  assert.ok(!a.activeCast, "silence should interrupt the heal channel");
  const ev = sim.events.find(e => e.type === "castInterrupt" && e.id === "a" && e.reason === "disable");
  assert.ok(ev, "castInterrupt(disable) event missing");
});

test("16: channel cancel on move input", () => {
  const sim = playingSim();
  const a = sim.players.get("a");
  a.x = 0; a.z = 0; a.hp = 50;

  cast(sim, "a", "heal", NaN, NaN);
  assert.ok(a.activeCast, "activeCast should be set");

  // Send move input
  sim.setInput("a", { move: [1, 0], aim: 0, seq: (a.input.seq || 0) + 1 });
  sim.step(1 / CFG.TICK_RATE);

  assert.ok(!a.activeCast, "move input should cancel channel");
  const ev = sim.events.find(e => e.type === "castInterrupt" && e.reason === "move");
  assert.ok(ev, "castInterrupt(move) event missing");
});

test("17: non-interruptible channel ignores stun", () => {
  const sim = playingSim();
  const a = sim.players.get("a");
  a.x = 0; a.z = 0;

  // Give player a custom non-interruptible channel by temporarily patching SPELLS
  // and planting an activeCast directly.
  a.activeCast = { spell: "heal", tx: NaN, tz: NaN, castTime: 0, channel: 2.0,
    interruptible: false, t: 0, channeling: true, tickAcc: 0, anchorX: 0, anchorZ: 0 };

  a.status.stunned = 2.0;
  sim.step(1 / CFG.TICK_RATE);
  assert.ok(a.activeCast, "non-interruptible channel should not be interrupted by stun");
});

test("18: canCast blocks second spell while activeCast is set", () => {
  const sim = playingSim();
  const a = sim.players.get("a"), b = sim.players.get("b");
  a.x = 0; a.z = 0; b.x = 15; b.z = 0;
  a.hp = 50;

  cast(sim, "a", "heal", NaN, NaN);
  assert.ok(a.activeCast, "activeCast should be set");

  // Attempt to fire a second spell
  const hpBefore = b.hp;
  // Queue target spell while channeling
  sim.setInput("a", { move: [0, 0], aim: 0, seq: (a.input.seq || 0) + 1,
    casts: [{ id: Date.now() + Math.random(), spell: "fireball", tx: 5, tz: 0 }] });
  sim.step(1 / CFG.TICK_RATE);
  assert.strictEqual(sim.bolts.length, 0, "second cast should not fire while channeling");
});

test("19: snapshot ca.p rises from 0 to 1 during channel and is absent once finished", () => {
  const sim = playingSim();
  const a = sim.players.get("a");
  a.x = 0; a.z = 0; a.hp = 50;

  cast(sim, "a", "heal", NaN, NaN);
  const snap0 = sim.snapshot().players.find(p => p.id === "a");
  assert.ok(snap0.ca && snap0.ca.p >= 0, "ca.p should be present and >= 0 at start");
  assert.strictEqual(snap0.ca.c, 1, "ca.c should be 1 (channeling)");

  // Advance halfway through channel
  advance(sim, SPELLS.heal.channel * 0.5);
  const snap1 = sim.snapshot().players.find(p => p.id === "a");
  assert.ok(snap1.ca && snap1.ca.p > snap0.ca.p, "ca.p should rise during channel");

  // Advance past full channel
  advance(sim, SPELLS.heal.channel);
  const snap2 = sim.snapshot().players.find(p => p.id === "a");
  assert.ok(!snap2.ca || snap2.ca === 0, "ca should be absent/0 once channel finishes");
});

console.log(`\n${passed} cast state-machine tests passed.`);
