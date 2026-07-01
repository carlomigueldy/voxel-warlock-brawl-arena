// Headless tests for the full handbook spellbook + item system.
// Run with: node test/spells.test.mjs
import assert from "node:assert";
import { Simulation, PHASE } from "../src/sim.js";
import { Bolt } from "../src/bolt.js";
import { CFG, SPELLS, SPELL_ORDER, ITEMS } from "../src/config.js";
import { castSpell } from "../src/spells.js";

let passed = 0;
function test(name, fn) {
  try { fn(); console.log("  ok  -", name); passed++; }
  catch (e) { console.error("  FAIL-", name, "\n", e.message); process.exitCode = 1; }
}

function advance(sim, seconds, dt = 1 / CFG.TICK_RATE) {
  for (let t = 0; t < seconds; t += dt) sim.step(dt);
}

// Build a 2-player sim already in the PLAYING phase with both at the centre.
// The procedural map layout is cleared so existing tests run in a flat, obstacle-
// free arena — Phase 4 cover/LoS tests set their own layouts explicitly.
function playingSim() {
  const sim = new Simulation({ seed: 42 });
  sim.addPlayer("a", "A"); sim.addPlayer("b", "B");
  sim.startMatch();
  advance(sim, CFG.ROUND.COUNTDOWN + 0.1);
  sim.arena.setLayout(null);
  // Reset groundY to flat-ground level so spawnBolt() places bolts at the
  // expected height (CFG.PLATFORM_TOP + 1.1) regardless of whether a player
  // happened to stand on a procedurally-generated plateau during advance().
  for (const p of sim.players.values()) p.groundY = CFG.PLATFORM_TOP;
  // Seed all spells into the Set so spell-mechanic tests can cast any spell
  // (casting checks spells.has(id); slot array is irrelevant to that check).
  for (const p of sim.players.values()) p.spells = new Set(Object.keys(SPELLS));
  return sim;
}

// Queue a cast for player `id` and run one step to resolve it.
function cast(sim, id, spell, tx = NaN, tz = NaN) {
  const p = sim.players.get(id);
  sim.setInput(id, { move: [0, 0], aim: p.aim, seq: (p.input.seq || 0) + 1, casts: [{ id: Date.now() + Math.random(), spell, tx, tz }] });
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
  // Exactly 10 lootable items (Step 4 roster).
  const expectedItems = [
    "vitalityCore", "berserkerBlade", "swiftBoots", "wardingHelm",
    "arcaneSigil", "blastTome", "phoenixCharm",
    "blinkStone", "meteorScroll", "chronoLocket",
  ];
  assert.strictEqual(Object.keys(ITEMS).length, 10, "ITEMS must have exactly 10 entries");
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

test("disable projectile snapshots expose their visual kind", () => {
  const sim = playingSim();
  const a = sim.players.get("a");
  a.x = 0; a.z = 0; a.aim = 0;
  cast(sim, "a", "disable", 5, 0);
  assert.strictEqual(sim.snapshot().bolts[0].k, "disable");
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
  a.applyItems(["swiftBoots", "wardingHelm"]);
  assert.ok(a.mods.speedMul > 1, "swiftBoots did not raise speed");
  assert.ok(a.mods.kbResist > 0, "wardingHelm did not add knockback resist");
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

test("Step 4 items: vitalityCore raises maxHp, berserkerBlade raises dmgMul, blastTome raises aoeMul, phoenixCharm adds regen", () => {
  const sim = playingSim();
  const a = sim.players.get("a");
  a.hp = a.maxHp; // ensure hp is at base before applying
  a.applyItems(["vitalityCore"]);
  assert.strictEqual(a.maxHp, CFG.PLAYER_HP_MAX + ITEMS.vitalityCore.value, "vitalityCore should add its configured max hp bonus");
  a.applyItems(["berserkerBlade"]);
  assert.ok(a.mods.dmgMul > 1, "berserkerBlade did not raise dmgMul");
  a.applyItems(["blastTome"]);
  assert.ok(a.mods.aoeMul > 1, "blastTome did not raise aoeMul");
  a.applyItems(["phoenixCharm"]);
  assert.strictEqual(a.mods.regen, 3, "phoenixCharm should set regen to 3");
  // Compose swiftBoots + wardingHelm together
  a.applyItems(["swiftBoots", "wardingHelm"]);
  assert.ok(a.mods.speedMul > 1, "composed swiftBoots did not raise speed");
  assert.ok(a.mods.kbResist > 0, "composed wardingHelm did not add kbResist");
});

test("cooldown reduction items shorten spell cooldowns", () => {
  const sim = playingSim();
  const a = sim.players.get("a");
  const baseCd = a.spellCooldown("fireball");
  a.applyItems(["arcaneSigil"]);
  assert.ok(a.spellCooldown("fireball") < baseCd, "arcaneSigil cdr item had no effect");
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

test("strict slots: default loadout fills exactly six spell slots", () => {
  const sim = new Simulation({ seed: 42, mobsEnabled: false });
  sim.addPlayer("a", "A"); sim.addPlayer("b", "B");
  sim.startMatch();
  advance(sim, CFG.ROUND.COUNTDOWN + 0.1);
  const a = sim.players.get("a");
  assert.strictEqual(CFG.SPELL_SLOT_COUNT, 6);
  assert.strictEqual(a.spellSlots.length, 6);
  assert.ok(a.spellSlots.every((s) => s && SPELLS[s]), "all six slots filled with valid spells");
  assert.strictEqual(new Set(a.spellSlots).size, 6, "no duplicate spells");
  assert.strictEqual(a.spellSlots[0], "fireball", "fireball retained as permanent weapon");
});

test("strict slots: acquireSpell refuses a seventh distinct spell", () => {
  const sim = new Simulation({ seed: 1, mobsEnabled: false });
  const a = sim.addPlayer("a", "A");
  a.setLoadout(["fireball", "lightning", "teleport", "shield", "drain", "heal"]);
  assert.strictEqual(a.acquireSpell("gravity"), false, "must not exceed six slots");
  assert.ok(!a.hasSpell("gravity"));
});

test("strict slots: the all-abilities path is gone", () => {
  const a = new Simulation({ seed: 1 }).addPlayer("a", "A");
  assert.strictEqual(typeof a.setAllSpells, "undefined", "setAllSpells removed");
  // legacy option is ignored — player still gets the strict six, not all spells
  const sim = new Simulation({ seed: 1, allAbilitiesAtStart: true, mobsEnabled: false });
  sim.addPlayer("z", "Z");
  assert.ok(sim.players.get("z").spells.size <= CFG.SPELL_SLOT_COUNT);
});

test("casting a spell does not consume it (permanent for the round)", () => {
  const sim = playingSim();
  const a = sim.players.get("a"); a.x = 0; a.z = 0;
  cast(sim, "a", "teleport", 5, 0);
  assert.ok(a.hasSpell("teleport"), "spells are no longer single-use");
});

test("snapshot: spellSlotsEnabled always true and runes serialize empty", () => {
  const sim = new Simulation({ seed: 42, mobsEnabled: false });
  sim.addPlayer("a", "A"); sim.startMatch();
  const snap = JSON.parse(JSON.stringify(sim.snapshot()));
  assert.strictEqual(snap.spellSlotsEnabled, true);
  assert.ok(Array.isArray(snap.runes) && snap.runes.length === 0);
});

test("meteor effRadius increases with caster charge", () => {
  // At zero charge the effective radius equals the base radius.
  const sim0 = playingSim();
  const a0 = sim0.players.get("a");
  a0.x = 0; a0.z = 0; a0.charge = 0;
  cast(sim0, "a", "meteor", 5, 0);
  const baseR = sim0.meteors[0].effRadius;
  assert.ok(Math.abs(baseR - SPELLS.meteor.radius) < 0.001, "effRadius at zero charge should equal base radius");

  // At non-zero charge the effective radius must be strictly larger.
  const sim1 = playingSim();
  const a1 = sim1.players.get("a");
  a1.x = 0; a1.z = 0; a1.charge = 2.0;
  cast(sim1, "a", "meteor", 5, 0);
  const chargedR = sim1.meteors[0].effRadius;
  // Expected: radius * (1 + min(charge, CHARGE_MAX) * 0.08) = 7 * (1 + 2.0 * 0.08) = 7 * 1.16 = 8.12
  const expected = SPELLS.meteor.radius * (1 + Math.min(2.0, CFG.CHARGE_MAX) * 0.08);
  assert.ok(Math.abs(chargedR - expected) < 0.001, `effRadius mismatch: got ${chargedR}, expected ${expected}`);
  assert.ok(chargedR > baseR, "charged meteor effRadius should exceed base radius");
});

test("gravity status expiry applies an outward impulse to a player still inside the field", () => {
  const sim = playingSim();
  const a = sim.players.get("a"), b = sim.players.get("b");
  // Cast the gravity field centred at origin, b is inside the radius (8 u).
  a.x = 0; a.z = 0; b.x = 3; b.z = 0; b.vx = 0; b.vz = 0;
  cast(sim, "a", "gravity", 0, 0);
  assert.ok(b.status.gravity > 0, "gravity status not applied");
  // Manually wind the status down to just one tick so it expires on the very
  // next step — this keeps b close to its starting position (still inside the
  // radius) and avoids the full-duration pull dragging b past the field centre.
  b.status.gravity = 0.01;
  const vxBefore = b.vx;
  sim.step(1 / CFG.TICK_RATE);
  // The outward impulse from applyHit should push b away from the field centre
  // (positive vx, since b is on the +x side).
  assert.ok(b.vx > vxBefore, "gravity expiry did not apply an outward impulse");
  // The collapse should surface a feedback "hit" event (spark + SFX) credited
  // to the field's caster, so the client payoff matches the authoritative fling.
  const burst = sim.events.find((e) => e.type === "hit" && e.victim === "b" && e.by === "a");
  assert.ok(burst, "gravity collapse did not emit a feedback hit event");
});

test("drain pull is larger against a high-charge target than a zero-charge target", () => {
  // Zero-charge target.
  const sim0 = playingSim();
  const a0 = sim0.players.get("a"), b0 = sim0.players.get("b");
  a0.x = 0; a0.z = 0; b0.x = 3; b0.z = 0; b0.vx = 0; b0.vz = 0; b0.charge = 0;
  cast(sim0, "a", "drain");
  const pullZero = Math.abs(b0.vx);

  // High-charge target.
  const sim1 = playingSim();
  const a1 = sim1.players.get("a"), b1 = sim1.players.get("b");
  a1.x = 0; a1.z = 0; b1.x = 3; b1.z = 0; b1.vx = 0; b1.vz = 0; b1.charge = 3.0;
  cast(sim1, "a", "drain");
  const pullHigh = Math.abs(b1.vx);

  assert.ok(pullHigh > pullZero, `drain pull on high-charge (${pullHigh}) should exceed low-charge (${pullZero})`);
});

function stepBolt(bolt, playerArr, arena, seconds) {
  const dt = 1 / CFG.TICK_RATE;
  for (let t = 0; t < seconds; t += dt) {
    bolt.step(dt, playerArr, arena, { movementOnly: true });
    if (bolt.dead) break;
    bolt.step(0, playerArr, arena);
    if (bolt.dead) break;
  }
}

test("cover: obstacle blocks bolt before it reaches the target behind it", () => {
  const sim = playingSim();
  const a = sim.players.get("a"), b = sim.players.get("b");
  b.x = 6; b.z = 0; b.vx = 0;
  // Stone obstacle directly between origin and the target.
  sim.arena.setLayout({
    plateaus: [],
    obstacles: [{ id: 1, type: "stone", x: 3, z: 0, r: 1.0, height: 2.0, rot: 0 }],
  });
  // Ground-level bolt aimed at the target (y = PLATFORM_TOP + 1.1 = 1.1 < 2.0).
  const bolt = new Bolt("a", 1.2, 0, 0, 0xffffff, { groundY: CFG.PLATFORM_TOP });
  stepBolt(bolt, [a, b], sim.arena, 1.0);
  assert.strictEqual(b.vx, 0, "bolt passed through cover and hit the shielded target");
  assert.ok(bolt.dead, "bolt was not killed by the obstacle");
  sim.arena.setLayout(null);
});

test("cover: a fireball cast honors obstacle cover", () => {
  const sim = playingSim();
  const a = sim.players.get("a"), b = sim.players.get("b");
  a.x = 0; a.z = 0; a.aim = 0; b.x = 6; b.z = 0; b.vx = 0;
  a.groundY = CFG.PLATFORM_TOP; b.groundY = CFG.PLATFORM_TOP;
  sim.arena.setLayout({
    plateaus: [],
    obstacles: [{ id: 1, type: "wall", x: 3, z: 0, r: 0.4, height: 2.5, rot: 0 }],
  });
  cast(sim, "a", "fireball", 6, 0);
  // The bolt was dispatched by the cast; inspect the most recent bolt.
  // For cover test we re-run the remaining flight via stepBolt.
  // Cast already stepped one tick; check the bolt is present and cover-enabled.
  const bolt = sim.bolts[sim.bolts.length - 1];
  if (bolt) {
    assert.ok(bolt.coverEnabled, "cast bolt must have cover checking enabled");
    stepBolt(bolt, [a, b], sim.arena, 1.0);
    assert.strictEqual(b.vx, 0, "fireball cast passed through cover and hit the target");
    assert.ok(bolt.dead, "fireball cast was not stopped by the wall");
  } else {
    // Bolt was already killed by cover in the first step tick — cover is working.
    assert.strictEqual(b.vx, 0, "fireball cast should not hit behind wall");
  }
  sim.arena.setLayout(null);
});

test("cover: a blocked bolt reports blocked:true so the sim can emit impact VFX", () => {
  const sim = playingSim();
  const a = sim.players.get("a"), b = sim.players.get("b");
  sim.arena.setLayout({
    plateaus: [],
    obstacles: [{ id: 1, type: "wall", x: 3, z: 0, r: 0.6, height: 2.5, rot: 0 }],
  });
  const bolt = new Bolt("a", 1.2, 0, 0, 0xff5a1e, { groundY: CFG.PLATFORM_TOP });
  let blocked = false;
  const dt = 1 / CFG.TICK_RATE;
  for (let t = 0; t < 1 && !bolt.dead; t += dt) {
    const r = bolt.step(dt, [a, b], sim.arena, { movementOnly: true });
    if (r && r.blocked) { blocked = true; break; }
  }
  assert.ok(blocked, "bolt blocked by cover must return blocked:true");
  sim.arena.setLayout(null);
});

test("cover: a THIN obstacle still blocks a fast bolt (no tunneling)", () => {
  const sim = playingSim();
  const a = sim.players.get("a"), b = sim.players.get("b");
  b.x = 6; b.z = 0; b.vx = 0;
  // A thin column (r = 0.3 → diameter 0.6) is smaller than the per-tick step
  // (~0.87u at bolt speed). A point-at-new-position test would step over it;
  // the swept-segment test must still catch it.
  sim.arena.setLayout({
    plateaus: [],
    obstacles: [{ id: 1, type: "column", x: 3, z: 0, r: 0.3, height: 2.5, rot: 0 }],
  });
  const bolt = new Bolt("a", 1.2, 0, 0, 0xffffff, { groundY: CFG.PLATFORM_TOP });
  stepBolt(bolt, [a, b], sim.arena, 1.0);
  assert.strictEqual(b.vx, 0, "fast bolt tunneled through a thin obstacle and hit the target");
  assert.ok(bolt.dead, "bolt was not stopped by the thin obstacle");
  sim.arena.setLayout(null);
});

test("height gate: bolt from ground does not hit a player standing on a tall plateau", () => {
  const sim = playingSim();
  const a = sim.players.get("a"), b = sim.players.get("b");
  b.x = 3; b.z = 0; b.vx = 0;
  // Place target above the FALL_STUN_MIN_HEIGHT threshold so clearly elevated.
  b.groundY = CFG.FALL_STUN_MIN_HEIGHT + 0.5; // 2.0
  // Empty layout: no terrain to cover-block; only the height gate matters.
  sim.arena.setLayout({ plateaus: [], obstacles: [] });
  // Bolt at ground level (y = 1.1), target body starts at 2.0 - 0.1 = 1.9 → miss.
  const bolt = new Bolt("a", 1.2, 0, 0, 0xffffff, { groundY: CFG.PLATFORM_TOP });
  stepBolt(bolt, [a, b], sim.arena, 0.5);
  assert.strictEqual(b.vx, 0, "ground bolt hit a player on a tall plateau (height gate missed)");
  sim.arena.setLayout(null);
});

test("height gate: bolt from a plateau hits a co-elevation target", () => {
  const sim = playingSim();
  const a = sim.players.get("a"), b = sim.players.get("b");
  const plateau = 2.0;
  b.x = 3; b.z = 0; b.vx = 0; b.groundY = plateau;
  // Empty layout: no obstructions, height gate should allow the hit.
  sim.arena.setLayout({ plateaus: [], obstacles: [] });
  // Bolt from the same plateau height (y = 2.0 + 1.1 = 3.1), within body [1.9, 3.9].
  const bolt = new Bolt("a", 1.2, 0, 0, 0xffffff, { groundY: plateau });
  stepBolt(bolt, [a, b], sim.arena, 0.5);
  assert.ok(b.vx !== 0, "plateau bolt did not hit a co-elevation target");
  sim.arena.setLayout(null);
});

test("height gate (asymmetric): bolt from plateau HITS ground-level target (down-shot)", () => {
  // BLOCKER fix verification: shooting DOWN from elevation must connect.
  // Old symmetric gate rejected this because bolt.y > tGroundY + PLAYER_HEIGHT + 0.1.
  const sim = playingSim();
  const a = sim.players.get("a"), b = sim.players.get("b");
  const plateauH = 2.0;
  b.x = 3; b.z = 0; b.vx = 0; b.groundY = CFG.PLATFORM_TOP; // target on ground
  sim.arena.setLayout({ plateaus: [], obstacles: [] });
  // Bolt spawned from plateau height: y = plateauH + 1.1 = 3.1
  const bolt = new Bolt("a", 1.2, 0, 0, 0xffffff, { groundY: plateauH });
  stepBolt(bolt, [a, b], sim.arena, 0.5);
  assert.ok(b.vx !== 0, "down-shot from plateau must hit a ground-level target");
  sim.arena.setLayout(null);
});

test("height gate (asymmetric): bolt from ground MISSES target on tall plateau (hard up-shot)", () => {
  const sim = playingSim();
  const a = sim.players.get("a"), b = sim.players.get("b");
  b.x = 3; b.z = 0; b.vx = 0;
  b.groundY = 2.0; // clearly above FALL_STUN_MIN_HEIGHT (1.5) — tall plateau
  sim.arena.setLayout({ plateaus: [], obstacles: [] });
  const bolt = new Bolt("a", 1.2, 0, 0, 0xffffff, { groundY: CFG.PLATFORM_TOP });
  stepBolt(bolt, [a, b], sim.arena, 0.5);
  assert.strictEqual(b.vx, 0, "ground bolt must not hit a player standing on a tall plateau (hard up-shot)");
  sim.arena.setLayout(null);
});

test("height gate (asymmetric): same-level ground hit registers", () => {
  const sim = playingSim();
  const a = sim.players.get("a"), b = sim.players.get("b");
  b.x = 3; b.z = 0; b.vx = 0; b.groundY = CFG.PLATFORM_TOP;
  sim.arena.setLayout({ plateaus: [], obstacles: [] });
  const bolt = new Bolt("a", 1.2, 0, 0, 0xffffff, { groundY: CFG.PLATFORM_TOP });
  stepBolt(bolt, [a, b], sim.arena, 0.5);
  assert.ok(b.vx !== 0, "same-level bolt must hit a co-elevation target");
  sim.arena.setLayout(null);
});

test("height gate (asymmetric): both-on-plateau shot hits", () => {
  const sim = playingSim();
  const a = sim.players.get("a"), b = sim.players.get("b");
  const plateauH = 2.0;
  b.x = 3; b.z = 0; b.vx = 0; b.groundY = plateauH;
  sim.arena.setLayout({ plateaus: [], obstacles: [] });
  const bolt = new Bolt("a", 1.2, 0, 0, 0xffffff, { groundY: plateauH });
  stepBolt(bolt, [a, b], sim.arena, 0.5);
  assert.ok(b.vx !== 0, "plateau-to-plateau bolt must hit co-elevation target");
  sim.arena.setLayout(null);
});

test("lightning LoS: obstacle between caster and target blocks the spell", () => {
  const sim = playingSim();
  const a = sim.players.get("a"), b = sim.players.get("b");
  a.x = 0; a.z = 0; a.aim = 0;
  b.x = 6; b.z = 0; b.vx = 0;
  // Tall stone obstacle directly between them at (3, 0).
  sim.arena.setLayout({
    plateaus: [],
    obstacles: [{ id: 1, type: "stone", x: 3, z: 0, r: 1.0, height: 2.0, rot: 0 }],
  });
  cast(sim, "a", "lightning", 6, 0);
  assert.strictEqual(b.vx, 0, "lightning hit through obstacle cover");
  sim.arena.setLayout(null);
});

test("lightning LoS: still hits the target when no layout is set", () => {
  const sim = playingSim();
  const a = sim.players.get("a"), b = sim.players.get("b");
  a.x = 0; a.z = 0; b.x = 4; b.z = 0; b.vx = 0;
  // No setLayout call — arena query returns false (no obstacles).
  cast(sim, "a", "lightning", 4, 0);
  assert.ok(b.vx > 0, "lightning failed to hit when no obstacle is present");
});

test("meteor AoE is unaffected by cover obstacles (rains from above)", () => {
  const sim = playingSim();
  const a = sim.players.get("a"), b = sim.players.get("b");
  a.x = 0; a.z = 0; b.x = 2; b.z = 0;
  sim.arena.setLayout({
    plateaus: [],
    obstacles: [{ id: 1, type: "stone", x: 1, z: 0, r: 0.8, height: 2.0, rot: 0 }],
  });
  cast(sim, "a", "meteor", 2, 0);
  // Advance just past fall time so the AoE resolves but friction hasn't zeroed vx.
  advance(sim, SPELLS.meteor.fall + 0.05);
  assert.ok(Math.abs(b.vx) > 0 || Math.abs(b.vz) > 0,
    "meteor was cover-blocked when it should rain down unimpeded");
  sim.arena.setLayout(null);
});

// ── Step 2: status effect mechanics ──────────────────────────────────────────

test("fireball bolt applies burn DoT on hit", () => {
  const sim = playingSim();
  const a = sim.players.get("a"), b = sim.players.get("b");
  a.x = 0; a.z = 0; a.aim = 0; a.groundY = CFG.PLATFORM_TOP;
  b.x = 1.5; b.z = 0; b.vx = 0; b.groundY = CFG.PLATFORM_TOP;
  castSpell(sim, a, { spell: "fireball", tx: 5, tz: 0 });
  advance(sim, 0.1);
  assert.ok(b.status.burn > 0, `fireball hit should apply burn status (burn=${b.status.burn})`);
  assert.ok(b.status.burnDps > 0, "burn should have a positive DPS value");
});

test("burn DoT deals damage over time", () => {
  const sim = playingSim();
  const a = sim.players.get("a"), b = sim.players.get("b");
  b.status.burn = 2; b.status.burnDps = 10; b.status.burnBy = "a";
  const hpBefore = b.hp;
  advance(sim, 0.5);
  assert.ok(b.hp < hpBefore, `burn DoT should reduce HP (before:${hpBefore} after:${b.hp})`);
});

test("burn DoT emits dotTick events", () => {
  const sim = playingSim();
  const b = sim.players.get("b");
  b.status.burn = 2; b.status.burnDps = 10; b.status.burnBy = "a";
  b.status.burnTickAcc = 0;
  let sawTick = false;
  for (let i = 0; i < 20; i++) {
    sim.step(1 / CFG.TICK_RATE);
    sawTick ||= sim.events.some((ev) => ev.type === "dotTick");
  }
  assert.ok(sawTick, "burn DoT should emit dotTick events every 0.25s");
});

test("lightning applies slow status to hit targets", () => {
  const sim = playingSim();
  const a = sim.players.get("a"), b = sim.players.get("b");
  a.x = 0; a.z = 0;
  b.x = 6; b.z = 0;
  castSpell(sim, a, { spell: "lightning", tx: 6, tz: 0 });
  assert.ok(b.status.slow > 0, `lightning should apply slow (slow=${b.status.slow})`);
  assert.ok(b.status.slowMul < 1, `slow multiplier should reduce speed (slowMul=${b.status.slowMul})`);
});

test("slow status reduces player movement speed", () => {
  const sim = playingSim();
  const b = sim.players.get("b");
  b.x = 0; b.z = 0;
  // Measure speed without slow.
  sim.setInput("b", { move: [1, 0], aim: 0, seq: 1 });
  const x0 = b.x;
  sim.step(0.1);
  const dx_normal = b.x - x0;
  // Reset and apply slow.
  b.x = 0; b.vx = 0; b.vz = 0;
  b.status.slow = 2; b.status.slowMul = 0.5;
  sim.setInput("b", { move: [1, 0], aim: 0, seq: 2 });
  const x1 = b.x;
  sim.step(0.1);
  const dx_slowed = b.x - x1;
  assert.ok(dx_slowed < dx_normal, `slow should reduce movement (normal:${dx_normal} slowed:${dx_slowed})`);
});

test("homing bolt applies curse on hit", () => {
  const sim = playingSim();
  const a = sim.players.get("a"), b = sim.players.get("b");
  a.x = 0; a.z = 0; a.aim = 0; a.groundY = CFG.PLATFORM_TOP;
  b.x = 3; b.z = 0; b.vx = 0; b.groundY = CFG.PLATFORM_TOP;
  castSpell(sim, a, { spell: "homing", tx: 3, tz: 0 });
  advance(sim, 0.5);
  assert.ok(b.status.curse > 0, `homing bolt should apply curse (curse=${b.status.curse})`);
});

test("curse amplifies incoming damage", () => {
  const sim = playingSim();
  const b = sim.players.get("b");
  const hpBefore = b.hp;
  b.applyDamage(10, "a");
  const normalDamage = hpBefore - b.hp;
  // Reset and apply curse.
  b.hp = b.maxHp;
  b.status.curse = 3; b.status.curseMul = 1.25;
  b.applyDamage(10, "a");
  const cursedDamage = b.maxHp - b.hp;
  assert.ok(cursedDamage > normalDamage, `curse should amplify damage (normal:${normalDamage} cursed:${cursedDamage})`);
});

test("meteor deals more damage than fireball (rebalance)", () => {
  assert.ok(SPELLS.meteor.dmg > SPELLS.fireball.dmg,
    `meteor dmg(${SPELLS.meteor.dmg}) should exceed fireball dmg(${SPELLS.fireball.dmg})`);
});

test("thrust shockwave now deals chip damage", () => {
  const sim = playingSim();
  const a = sim.players.get("a"), b = sim.players.get("b");
  a.x = 0; a.z = 0; a.aim = 0;
  b.x = 2; b.z = 0; b.vx = 0;
  const hpBefore = b.hp;
  castSpell(sim, a, { spell: "thrust", tx: 5, tz: 0 });
  sim.step(1 / CFG.TICK_RATE);
  assert.ok(b.hp < hpBefore, `thrust shockwave should deal chip damage (hp: ${hpBefore} -> ${b.hp})`);
});

// ── Step 3: New DOTA-inspired roster handler tests ───────────────────────────

test("projectile spawns an arcane bolt toward the target", () => {
  const sim = playingSim();
  const a = sim.players.get("a"), b = sim.players.get("b");
  a.x = 0; a.z = 0; a.aim = 0; b.x = 4; b.z = 0; b.groundY = CFG.PLATFORM_TOP;
  const hpBefore = b.hp;
  cast(sim, "a", "projectile", 5, 0);
  advance(sim, 0.3);
  assert.ok(b.hp < hpBefore, "arcane bolt did not damage target");
});

test("target damages and curses nearest enemy", () => {
  const sim = playingSim();
  const a = sim.players.get("a"), b = sim.players.get("b");
  a.x = 0; a.z = 0; b.x = 5; b.z = 0;
  const hpBefore = b.hp;
  cast(sim, "a", "target", NaN, NaN);
  assert.ok(b.hp < hpBefore, "target did not deal damage");
  assert.ok(b.status.curse > 0, "target did not apply curse");
  assert.strictEqual(b.status.curseMul, SPELLS.target.curse, "wrong curse multiplier");
});

test("stun sets victim stunned and deals damage; victim cannot cast", () => {
  const sim = playingSim();
  const a = sim.players.get("a"), b = sim.players.get("b");
  a.x = 0; a.z = 0; b.x = 5; b.z = 0;
  const hpBefore = b.hp;
  cast(sim, "a", "stun", NaN, NaN);
  assert.ok(b.status.stunned >= SPELLS.stun.stunDur - 0.1, `stun not applied (stunned=${b.status.stunned})`);
  assert.ok(b.hp < hpBefore, "stun did not deal damage");
  assert.strictEqual(b.canCast("fireball"), false, "stunned victim should not be able to cast");
});

test("push knocks foe in forward cone but not one behind caster", () => {
  const sim = playingSim();
  const a = sim.players.get("a"), b = sim.players.get("b");
  a.x = 0; a.z = 0; a.aim = 0; // aiming +x
  b.x = 4; b.z = 0; b.vx = 0; b.vz = 0;
  cast(sim, "a", "push", NaN, NaN);
  assert.ok(b.vx > 0, "push did not knock back target in cone");

  // Foe behind caster (opposite direction, outside cone)
  const sim2 = playingSim();
  const a2 = sim2.players.get("a"), b2 = sim2.players.get("b");
  a2.x = 0; a2.z = 0; a2.aim = 0;
  b2.x = -4; b2.z = 0; b2.vx = 0; b2.vz = 0;
  cast(sim2, "a", "push", NaN, NaN);
  assert.strictEqual(b2.vx, 0, "push hit a foe outside the forward cone");
});

test("pull yanks aimed target toward caster and deals damage", () => {
  const sim = playingSim();
  const a = sim.players.get("a"), b = sim.players.get("b");
  a.x = 0; a.z = 0; a.aim = 0; b.x = 8; b.z = 0; b.vx = 0;
  const hpBefore = b.hp;
  cast(sim, "a", "pull", 8, 0);
  assert.ok(b.vx < 0, "pull did not add velocity toward caster");
  assert.ok(b.hp < hpBefore, "pull did not deal damage");
});

test("blink moves caster at most range units toward aim", () => {
  const sim = playingSim();
  const a = sim.players.get("a"), b = sim.players.get("b");
  a.x = 0; a.z = 0; a.aim = 0; b.x = 15; b.z = 0;
  cast(sim, "a", "blink", 20, 0);
  assert.ok(a.x > 0, "blink did not move caster");
  assert.ok(a.x <= SPELLS.blink.range + 0.01, "blink exceeded max range");
  assert.ok(!a.activeCast, "blink should clear activeCast immediately");
});

test("invisible sets status.invisible > 0 and snapshot iv === 1", () => {
  const sim = playingSim();
  const a = sim.players.get("a"), b = sim.players.get("b");
  b.x = 15; b.z = 0; // keep b away
  cast(sim, "a", "invisible", NaN, NaN);
  assert.ok(a.status.invisible > 0, "invisible status not set");
  const snap = sim.snapshot().players.find(p => p.id === "a");
  assert.strictEqual(snap.iv, 1, "snapshot iv should be 1 while invisible");
  // Decays to 0 after duration
  advance(sim, SPELLS.invisible.duration + 0.1);
  assert.strictEqual(a.status.invisible, 0, "invisible did not expire");
});

test("speed sets haste status and increases movement speed", () => {
  const sim = playingSim();
  const a = sim.players.get("a");
  // Baseline speed
  sim.setInput("a", { move: [1, 0], aim: 0, seq: 1 });
  const x0 = a.x;
  sim.step(0.1);
  const dxNormal = a.x - x0;

  // Apply haste
  a.x = 0; a.vx = 0; a.vz = 0; a.cooldowns = {};
  cast(sim, "a", "speed", NaN, NaN);
  assert.ok(a.status.haste > 0, "haste not applied");
  sim.setInput("a", { move: [1, 0], aim: 0, seq: 2 });
  const x1 = a.x;
  sim.step(0.1);
  const dxHaste = a.x - x1;
  assert.ok(dxHaste > dxNormal, `haste should increase speed (normal:${dxNormal} haste:${dxHaste})`);

  // snapshot hs flag
  const snap = sim.snapshot().players.find(p => p.id === "a");
  assert.strictEqual(snap.hs, 1, "snapshot hs should be 1 while hasted");
});

test("summon adds a minion mob with ttl set", () => {
  const sim = new Simulation({ seed: 42, mobsEnabled: true });
  sim.addPlayer("a", "A"); sim.addPlayer("b", "B");
  sim.startMatch();
  advance(sim, CFG.ROUND.COUNTDOWN + 0.1);
  sim.arena.setLayout(null);
  for (const p of sim.players.values()) p.groundY = CFG.PLATFORM_TOP;
  const a = sim.players.get("a");
  a.x = 0; a.z = 0; a.aim = 0;
  // summon is not in DEFAULT_SPELL_LOADOUT; grant it directly so canCast passes.
  a.spells.add("summon"); a.cooldowns["summon"] = 0;
  cast(sim, "a", "summon", NaN, NaN);
  const minion = sim.mobs.find(m => m.summoned);
  assert.ok(minion, "summon did not create a minion");
  assert.ok(minion.ttl != null && minion.ttl > 0, "summoned minion should have ttl");
  // Despawn after ttl
  advance(sim, SPELLS.summon.summonTtl + 0.1);
  assert.strictEqual(sim.mobs.filter(m => m.summoned && m.alive).length, 0, "summoned minion did not despawn");
});

console.log(`\n${passed} spellbook tests passed.`);
