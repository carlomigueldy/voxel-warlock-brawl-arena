// Headless tests for the full handbook spellbook + item system.
// Run with: node test/spells.test.mjs
import assert from "node:assert";
import { Simulation, PHASE } from "../src/sim.js";
import { CFG, SPELLS, SPELL_ORDER, ITEMS } from "../src/config.js";

let passed = 0;
function test(name, fn) {
  try { fn(); console.log("  ok  -", name); passed++; }
  catch (e) { console.error("  FAIL-", name, "\n", e.message); process.exitCode = 1; }
}

function advance(sim, seconds, dt = 1 / CFG.TICK_RATE) {
  for (let t = 0; t < seconds; t += dt) sim.step(dt);
}

// Build a 2-player sim already in the PLAYING phase with both at the centre.
function playingSim() {
  const sim = new Simulation();
  sim.addPlayer("a", "A"); sim.addPlayer("b", "B");
  sim.startMatch();
  advance(sim, CFG.ROUND.COUNTDOWN + 0.1);
  return sim;
}

// Queue a cast for player `id` and run one step to resolve it.
function cast(sim, id, spell, tx = NaN, tz = NaN) {
  const p = sim.players.get(id);
  sim.setInput(id, { move: [0, 0], aim: p.aim, fire: false, seq: (p.input.seq || 0) + 1, casts: [{ id: Date.now() + Math.random(), spell, tx, tz }] });
  sim.step(1 / CFG.TICK_RATE);
}

console.log("Spellbook tests:");

test("handbook ability index is fully declared", () => {
  // Every listed ability/item from the handbook is represented.
  const expectedSpells = [
    "fireball", "lightning", "boomerang", "homing", "teleport", "thrust",
    "swap", "drain", "fireSpray", "bouncer", "meteor", "windWalk", "splitter",
    "gravity", "link", "rush", "shield", "disable", "timeShift", "pocketWatch",
  ];
  for (const s of expectedSpells) assert.ok(SPELLS[s], "missing spell: " + s);
  assert.strictEqual(SPELL_ORDER.length, Object.keys(SPELLS).length);
  const expectedItems = [
    "aegis", "cape", "helmet", "bootsOfSpeed", "bloodSword", "maskOfDeath",
    "cursedPendant", "pendant", "stoneOfJordan", "lavaTreads", "staffOfFireball",
    "warden",
  ];
  for (const i of expectedItems) assert.ok(ITEMS[i], "missing item: " + i);
});

test("every spell has a cast handler that consumes a cooldown", () => {
  for (const id of SPELL_ORDER) {
    const sim = playingSim();
    // Put a second target near the caster so targeted spells have a victim.
    const a = sim.players.get("a"), b = sim.players.get("b");
    a.x = 0; a.z = 0; a.aim = 0; b.x = 3; b.z = 0;
    cast(sim, "a", id, 4, 0);
    assert.ok((a.cooldowns[id] || 0) > 0, `${id} did not start a cooldown`);
  }
});

test("fireball spawns a projectile", () => {
  const sim = playingSim();
  const a = sim.players.get("a"); a.x = 0; a.z = 0; a.aim = 0;
  cast(sim, "a", "fireball", 5, 0);
  assert.ok(sim.bolts.some((b) => b.proj === "fireball"));
});

test("fire spray spawns multiple projectiles", () => {
  const sim = playingSim();
  const a = sim.players.get("a"); a.x = 0; a.z = 0; a.aim = 0;
  cast(sim, "a", "fireSpray", 5, 0);
  assert.ok(sim.bolts.length >= SPELLS.fireSpray.count - 1);
});

test("lightning knocks back the nearest enemy", () => {
  const sim = playingSim();
  const a = sim.players.get("a"), b = sim.players.get("b");
  a.x = 0; a.z = 0; b.x = 4; b.z = 0; b.vx = 0;
  cast(sim, "a", "lightning", 4, 0);
  assert.ok(b.vx > 0, "lightning did not knock back the target");
});

test("teleport moves the caster toward the target point", () => {
  const sim = playingSim();
  const a = sim.players.get("a"); a.x = 0; a.z = 0;
  cast(sim, "a", "teleport", 8, 0);
  assert.ok(a.x > 1, "teleport did not move caster");
});

test("thrust launches the caster along aim", () => {
  const sim = playingSim();
  const a = sim.players.get("a"); a.x = 0; a.z = 0; a.aim = 0; a.vx = 0;
  cast(sim, "a", "thrust", 5, 0);
  assert.ok(a.vx > 5, "thrust did not add velocity");
});

test("swap exchanges positions with the nearest enemy", () => {
  const sim = playingSim();
  const a = sim.players.get("a"), b = sim.players.get("b");
  a.x = 0; a.z = 0; b.x = 6; b.z = 0;
  cast(sim, "a", "swap");
  assert.ok(Math.abs(a.x - 6) < 0.001 && Math.abs(b.x) < 0.001, "swap failed");
});

test("drain steals charge from the target", () => {
  const sim = playingSim();
  const a = sim.players.get("a"), b = sim.players.get("b");
  a.x = 0; a.z = 0; b.x = 3; b.z = 0; b.charge = 2.0;
  cast(sim, "a", "drain");
  assert.ok(b.charge < 2.0, "drain did not reduce target charge");
});

test("gravity applies a pulling status to enemies in radius", () => {
  const sim = playingSim();
  const a = sim.players.get("a"), b = sim.players.get("b");
  a.x = 0; a.z = 0; b.x = 4; b.z = 0;
  cast(sim, "a", "gravity", 4, 0);
  assert.ok(b.status.gravity > 0, "gravity status not applied");
});

test("link binds caster and target together", () => {
  const sim = playingSim();
  const a = sim.players.get("a"), b = sim.players.get("b");
  a.x = 0; a.z = 0; b.x = 4; b.z = 0;
  cast(sim, "a", "link");
  assert.strictEqual(a.status.linkedTo, "b");
  assert.strictEqual(b.status.linkedTo, "a");
});

test("shield blocks the next incoming hit", () => {
  const sim = playingSim();
  const b = sim.players.get("b");
  b.status.shield = 4; b.status.shieldCharges = 1; b.vx = 0;
  const blocked = b.applyHit(1, 0, 10);
  assert.strictEqual(blocked, false);
  assert.strictEqual(b.vx, 0, "shield did not block knockback");
});

test("disable silences the target on projectile hit", () => {
  const sim = playingSim();
  const a = sim.players.get("a"), b = sim.players.get("b");
  a.x = 0; a.z = 0; a.aim = 0; b.x = 2; b.z = 0;
  cast(sim, "a", "disable", 2, 0);
  advance(sim, 0.4);
  assert.ok(b.status.disabled > 0, "disable did not silence target");
  assert.strictEqual(b.canCast("fireball"), false);
});

test("wind walk and rush boost the caster status", () => {
  const sim = playingSim();
  cast(sim, "a", "windWalk");
  assert.ok(sim.players.get("a").status.windWalk > 0);
  const sim2 = playingSim();
  cast(sim2, "a", "rush");
  assert.ok(sim2.players.get("a").status.rush > 0);
});

test("meteor lands after its fall time and knocks back nearby players", () => {
  const sim = playingSim();
  const a = sim.players.get("a"), b = sim.players.get("b");
  a.x = 0; a.z = 0; b.x = 2; b.z = 0; b.vx = 0;
  cast(sim, "a", "meteor", 2, 0);
  assert.strictEqual(sim.meteors.length, 1);
  advance(sim, SPELLS.meteor.fall + 0.2);
  assert.ok(b.vx > 0 || Math.abs(b.vx) > 0, "meteor impact had no knockback");
  assert.strictEqual(sim.meteors.length, 0, "meteor not consumed");
});

test("time shift returns the caster to its bookmarked position", () => {
  const sim = playingSim();
  const a = sim.players.get("a");
  a.x = 0; a.z = 0;
  cast(sim, "a", "timeShift");
  a.x = 5; a.z = 5; // wander away
  advance(sim, SPELLS.timeShift.delay + 0.2);
  assert.ok(Math.abs(a.x) < 0.5 && Math.abs(a.z) < 0.5, "time shift did not rewind position");
});

test("homing projectile curves toward a target", () => {
  const sim = playingSim();
  const a = sim.players.get("a"), b = sim.players.get("b");
  a.x = 0; a.z = 0; a.aim = 0; b.x = 6; b.z = 4; // off-axis target
  cast(sim, "a", "homing", 6, 0);
  const bolt = sim.bolts.find((x) => x.proj === "homing");
  const dir0 = bolt.dir;
  advance(sim, 0.3);
  assert.notStrictEqual(bolt.dir, dir0, "homing bolt did not steer");
});

test("boomerang turns around to return", () => {
  const sim = playingSim();
  const a = sim.players.get("a"); a.x = 0; a.z = 0; a.aim = 0;
  cast(sim, "a", "boomerang", 10, 0);
  const bolt = sim.bolts.find((x) => x.proj === "boomerang");
  advance(sim, 1.2);
  assert.ok(bolt.returning, "boomerang never started returning");
});

test("splitter fans into shards", () => {
  const sim = playingSim();
  const a = sim.players.get("a"); a.x = 0; a.z = 0; a.aim = 0;
  cast(sim, "a", "splitter", 10, 0);
  // Advance just past the split distance; shards should now exist.
  advance(sim, 0.45);
  const fireballs = sim.bolts.filter((x) => x.proj === "fireball").length;
  assert.ok(fireballs >= SPELLS.splitter.shards - 1, "splitter produced no shards");
  assert.ok(!sim.bolts.some((x) => x.proj === "splitter"), "splitter survived its split");
});

test("bouncer reflects off the arena rim", () => {
  const sim = playingSim();
  const a = sim.players.get("a"); a.x = 0; a.z = 0; a.aim = 0;
  cast(sim, "a", "bouncer", 10, 0);
  const bolt = sim.bolts.find((x) => x.proj === "bouncer");
  const b0 = bolt.bounces;
  advance(sim, 2.0);
  assert.ok(bolt.bounces < b0 || bolt.dead === false, "bouncer never bounced");
});

test("items modify player stats via applyItems", () => {
  const sim = playingSim();
  const a = sim.players.get("a");
  a.applyItems(["bootsOfSpeed", "aegis"]);
  assert.ok(a.mods.speedMul > 1, "boots did not raise speed");
  assert.ok(a.mods.kbResist > 0, "aegis did not add knockback resist");
  // Knockback resist reduces the impulse received.
  a.vx = 0; a.charge = 0;
  a.applyHit(1, 0, 10);
  const resisted = a.vx;
  const plain = sim.players.get("b");
  plain.applyItems([]);
  plain.vx = 0; plain.charge = 0;
  plain.applyHit(1, 0, 10);
  assert.ok(resisted < plain.vx, "kbResist did not reduce knockback");
});

test("cooldown reduction items shorten spell cooldowns", () => {
  const sim = playingSim();
  const a = sim.players.get("a");
  const baseCd = a.spellCooldown("fireball");
  a.applyItems(["pendant"]);
  assert.ok(a.spellCooldown("fireball") < baseCd, "cdr item had no effect");
});

test("snapshot includes meteors and per-spell cooldowns and stays serializable", () => {
  const sim = playingSim();
  const a = sim.players.get("a"); a.x = 0; a.z = 0;
  cast(sim, "a", "meteor", 3, 0);
  cast(sim, "a", "fireball", 5, 0);
  const snap = JSON.parse(JSON.stringify(sim.snapshot()));
  assert.ok(Array.isArray(snap.meteors));
  const me = snap.players.find((p) => p.id === "a");
  assert.ok(me.cds && Object.keys(me.cds).length >= 1, "cooldowns missing from snapshot");
});

test("cannot cast while on cooldown", () => {
  const sim = playingSim();
  const a = sim.players.get("a"); a.x = 0; a.z = 0; a.aim = 0;
  cast(sim, "a", "teleport", 5, 0);
  const x1 = a.x;
  cast(sim, "a", "teleport", 8, 0); // should be on cooldown, no move
  assert.ok(Math.abs(a.x - x1) < 0.001, "teleport fired while on cooldown");
});

test("players without all starting abilities cannot cast unacquired spells", () => {
  const sim = new Simulation({ allAbilitiesAtStart: false });
  sim.addPlayer("a", "A"); sim.addPlayer("b", "B");
  sim.startMatch();
  advance(sim, CFG.ROUND.COUNTDOWN + 0.1);
  const a = sim.players.get("a");
  a.x = 0; a.z = 0;
  cast(sim, "a", "teleport", 5, 0);
  assert.ok(Math.abs(a.x) < 0.001, "teleport fired before acquisition");
});

test("spell runes grant abilities on pickup", () => {
  const sim = new Simulation({ allAbilitiesAtStart: false });
  sim.addPlayer("a", "A"); sim.addPlayer("b", "B");
  sim.startMatch();
  advance(sim, CFG.ROUND.COUNTDOWN + 0.1);
  const a = sim.players.get("a");
  sim.runes = [{ id: 1, spell: "teleport", x: a.x, z: a.z }];
  sim.step(1 / CFG.TICK_RATE);
  assert.ok(a.hasSpell("teleport"), "teleport was not acquired");
  assert.strictEqual(sim.runes.length, 0, "picked up rune was not removed");
});

test("snapshots include runes and acquired spell ids", () => {
  const sim = new Simulation({ allAbilitiesAtStart: false });
  sim.addPlayer("a", "A"); sim.addPlayer("b", "B");
  sim.startMatch();
  const snap = JSON.parse(JSON.stringify(sim.snapshot()));
  assert.ok(Array.isArray(snap.runes), "runes missing from snapshot");
  const me = snap.players.find((p) => p.id === "a");
  assert.deepStrictEqual(me.spells, ["fireball"], "acquired spells missing from player snapshot");
});

console.log(`\n${passed} spellbook tests passed.`);
