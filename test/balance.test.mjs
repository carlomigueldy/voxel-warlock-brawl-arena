// Combat balance regression tests (WS-D): knockback -> ring-out/lava is THE
// kill path; raw spell/mob HP damage floors at CFG.HP_MIN_FLOOR instead of
// killing outright, and low HP amplifies knockback so a near-dead player is
// easier to ring out. See CFG.SPELL_DAMAGE_LETHAL / HP_MIN_FLOOR /
// LOW_HP_KB_AMP_MAX in src/config.js and Player.applyDamage/applyHit in
// src/player.js.
//
// Run with: node test/balance.test.mjs
import assert from "node:assert";
import { Simulation } from "../src/sim.js";
import { CFG } from "../src/config.js";
import { Player, resolveKillCredit } from "../src/player.js";

let passed = 0;
function test(name, fn) {
  try { fn(); console.log("  ok  -", name); passed++; }
  catch (e) { console.error("  FAIL-", name, "\n", e.message); process.exitCode = 1; }
}

function advance(sim, seconds, dt = 1 / CFG.TICK_RATE) {
  for (let t = 0; t < seconds; t += dt) sim.step(dt);
  if (sim.arena && typeof sim.arena.setLayout === "function") {
    sim.arena.setLayout(null);
  }
}

console.log("Combat balance tests:");

// (a) Spell damage from full HP to the floor never kills.
test("repeated massive spell damage floors hp and never kills the player", () => {
  const p = new Player("a", "A", 0);
  assert.strictEqual(p.hp, p.maxHp, "should start at full hp");
  for (let i = 0; i < 20; i++) {
    const landed = p.applyDamage(9999, "attacker");
    assert.strictEqual(landed, true, "applyDamage should always land while alive");
  }
  assert.strictEqual(p.alive, true, "player must remain alive under massive repeated spell damage");
  assert.strictEqual(p.hp, CFG.HP_MIN_FLOOR, "hp should settle at the floor, never 0");
});

test("a single lethal-sized hit clamps to the floor rather than killing", () => {
  const p = new Player("a", "A", 0);
  p.applyDamage(p.maxHp + 500, "attacker");
  assert.strictEqual(p.hp, CFG.HP_MIN_FLOOR, "hp should clamp to the floor");
  assert.strictEqual(p.alive, true, "player should not die from hp damage alone");
});

// (b) applyHit impulse increases monotonically as hp decreases.
test("applyHit knockback impulse increases monotonically as hp decreases", () => {
  const base = CFG.BOLT_BASE_KNOCKBACK;
  function impulseAtHp(hp) {
    const p = new Player("a", "A", 0);
    p.hp = hp;
    p.applyHit(1, 0, base);
    return Math.hypot(p.vx, p.vz);
  }
  const impFull  = impulseAtHp(CFG.PLAYER_HP_MAX);
  const impHalf  = impulseAtHp(CFG.PLAYER_HP_MAX * 0.5);
  const impFloor = impulseAtHp(CFG.HP_MIN_FLOOR);
  assert.ok(impHalf > impFull,
    `half-hp impulse (${impHalf}) should exceed full-hp impulse (${impFull})`);
  assert.ok(impFloor > impHalf,
    `floor-hp impulse (${impFloor}) should exceed half-hp impulse (${impHalf})`);
  // Bounds check against the documented amplifier formula.
  const expectedFloorMul = 1 + CFG.LOW_HP_KB_AMP_MAX * (1 - CFG.HP_MIN_FLOOR / CFG.PLAYER_HP_MAX);
  assert.ok(Math.abs(impFloor / impFull - expectedFloorMul) < 1e-9,
    `floor impulse should equal full impulse * ${expectedFloorMul} (got ratio ${impFloor / impFull})`);
});

// (c) Falling below LAVA_Y still kills the player.
test("falling below LAVA_Y still kills the player regardless of the hp floor", () => {
  const sim = new Simulation();
  sim.addPlayer("a", "A"); sim.addPlayer("b", "B");
  sim.startMatch();
  advance(sim, CFG.ROUND.COUNTDOWN + 0.1);
  const b = sim.players.get("b");
  assert.strictEqual(b.hp, b.maxHp, "player should start at full hp");
  b.x = CFG.ARENA_RADIUS - 0.1; b.z = 0; b.vx = 60;
  advance(sim, CFG.HAZARD_DEATH_DELAY + 1.5);
  assert.strictEqual(b.alive, false, "lava must still kill regardless of the hp-damage floor");
  assert.strictEqual(b.falling, true, "death must come from the falling/lava path, not hp damage");
});

// (d) Regression pin: at full HP, applyHit output is identical to the
// pre-change formula (amplifier must be exactly 1.0 at full HP).
test("full-HP applyHit output matches the pre-amplifier formula exactly", () => {
  const p = new Player("a", "A", 0);
  p.charge = 1.3; // nonzero charge exercises the full formula
  const dirX = 0.6, dirZ = 0.8, base = 10;
  const chargeAtHit = p.charge;
  p.applyHit(dirX, dirZ, base);

  let impulse = base + chargeAtHit * CFG.KNOCKBACK_CHARGE_SCALE;
  impulse *= p.mods.takenMul; // 1, no curse/rush/resist active
  const len = Math.hypot(dirX, dirZ) || 1;
  const expectedVx = (dirX / len) * impulse;
  const expectedVz = (dirZ / len) * impulse;

  assert.ok(Math.abs(p.vx - expectedVx) < 1e-9,
    `vx should match the unamplified formula (got ${p.vx}, expected ${expectedVx})`);
  assert.ok(Math.abs(p.vz - expectedVz) < 1e-9,
    `vz should match the unamplified formula (got ${p.vz}, expected ${expectedVz})`);
});

// (e) Kill credit: damage attacker recorded, then a ring-out credits the
// most recent attacker via resolveKillCredit — same or different attacker.
test("applyDamage records the attacker for kill credit", () => {
  const p = new Player("a", "A", 0);
  const before = Date.now();
  p.applyDamage(20, "x");
  assert.strictEqual(p.lastAttackerId, "x", "attacker should be recorded");
  assert.ok(p.lastAttackerAt >= before, "attacker timestamp should be recorded near call time");
});

test("kill credit follows the most recent attacker when a different one lands the ring-out", () => {
  const p = new Player("a", "A", 0);
  p.applyDamage(20, "x");
  // A different attacker's follow-up hit (knockback that sends the victim
  // into the hazard) is the one that should get the kill.
  p.applyDamage(15, "y");
  assert.strictEqual(p.lastAttackerId, "y", "the later attacker should now be recorded");
  const credited = resolveKillCredit(p.lastAttackerId, p.lastAttackerAt, Date.now(), CFG.KILL_CREDIT_WINDOW);
  assert.strictEqual(credited, "y", "resolveKillCredit should credit the most recent attacker");
});

test("kill credit still resolves to the same attacker for a solo ring-out", () => {
  const p = new Player("a", "A", 0);
  p.applyDamage(20, "x");
  const credited = resolveKillCredit(p.lastAttackerId, p.lastAttackerAt, Date.now(), CFG.KILL_CREDIT_WINDOW);
  assert.strictEqual(credited, "x", "resolveKillCredit should credit the sole attacker");
});

test("kill credit expires outside the credit window", () => {
  const p = new Player("a", "A", 0);
  p.recordAttacker("x", Date.now() - (CFG.KILL_CREDIT_WINDOW * 1000 + 500));
  const credited = resolveKillCredit(p.lastAttackerId, p.lastAttackerAt, Date.now(), CFG.KILL_CREDIT_WINDOW);
  assert.strictEqual(credited, null, "an attacker outside the credit window should not be credited");
});

console.log(`${passed} balance test(s) passed.`);
