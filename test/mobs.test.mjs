// Headless tests for the mob system (src/mob.js + mob integration in src/sim.js).
// Run with: node --test test/mobs.test.mjs
// Follows the patterns of test/sim.test.mjs and test/collision.test.mjs.
import assert from "node:assert";
import { Simulation, PHASE } from "../src/sim.js";
import { Bolt } from "../src/bolt.js";
import { CFG, SPELL_ORDER } from "../src/config.js";
import { spawnMob, makeMobPrng } from "../src/mob.js";

let passed = 0;
function test(name, fn) {
  try { fn(); console.log("  ok  -", name); passed++; }
  catch (e) { console.error("  FAIL-", name, "\n", e.message); process.exitCode = 1; }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

// Bootstrap a sim in PLAYING state with two non-bot players.
// NOTE: startMatch() overwrites _matchSeed with Math.random(), so override it
// and reseed _mobRand AFTER startMatch() if you need determinism.
function playingSim(opts = {}) {
  const sim = new Simulation({ mobsEnabled: opts.mobsEnabled !== false });
  sim.addPlayer("p1", "Alice");
  sim.addPlayer("p2", "Bob");
  sim.startMatch();
  const dt = 1 / CFG.TICK_RATE;
  for (let t = 0; t < CFG.ROUND.COUNTDOWN + 0.1; t += dt) sim.step(dt);
  assert.strictEqual(sim.phase, PHASE.PLAYING);
  return sim;
}

// Force-inject a mob directly (bypasses spawn timer / cap) and clear invuln.
function injectMob(sim, type, x, z, parentId = null) {
  const id = "mob:" + sim._mobId++;
  const mob = spawnMob(id, type, x, z, parentId);
  mob.spawnInvuln = 0;
  sim.mobs.push(mob);
  return mob;
}

// Inject a bolt from (fx,fz) toward (tx,tz) owned by player p1, positioned
// right at the mob for instant collision detection.
function injectBoltAt(sim, mx, mz) {
  const dir = Math.atan2(mz - (mz + 5), mx - (mx + 5)); // any dir is fine
  const b = new Bolt("p1", mx, mz, dir, 0xffffff);
  b.x = mx; b.z = mz; // position on mob
  sim.bolts.push(b);
  return b;
}

// Step sim for `seconds` at 30 Hz.
function advance(sim, seconds) {
  const dt = 1 / CFG.TICK_RATE;
  for (let t = 0; t < seconds; t += dt) sim.step(dt);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

console.log("Mob tests:");

// ── 1. Spawn cap ─────────────────────────────────────────────────────────────
test("big-mob spawn cap never exceeds MOB_MAX_ALIVE via stepMobs", () => {
  const sim = playingSim();
  // Clear auto-spawned mobs and fill to cap.
  sim.mobs = [];
  for (let i = 0; i < CFG.MOB_MAX_ALIVE; i++) {
    injectMob(sim, "stoneGiant", i * 4, 0);
  }
  assert.strictEqual(sim.mobs.filter(m => m.alive && m.type !== "minion").length, CFG.MOB_MAX_ALIVE);

  // Drain spawn timer so stepMobs would try to spawn.
  sim.mobSpawnTimer = -1;
  const countBefore = sim.mobs.filter(m => m.alive && m.type !== "minion").length;
  sim.stepMobs(1 / CFG.TICK_RATE);
  const countAfter = sim.mobs.filter(m => m.alive && m.type !== "minion").length;
  assert.strictEqual(countAfter, countBefore, "stepMobs must not spawn when at cap");
  assert.ok(countAfter <= CFG.MOB_MAX_ALIVE, `bigCount ${countAfter} exceeds cap ${CFG.MOB_MAX_ALIVE}`);
});

// ── 2. Determinism ────────────────────────────────────────────────────────────
test("two sims with the same mob PRNG seed produce identical mob spawn sequences", () => {
  // Freeze player positions each tick so: (a) tooClose checks see the same
  // player positions regardless of mob attacks, and (b) players can't die,
  // keeping alivePlayers() stable. This isolates the PRNG sequence from layout
  // and knock-around variance between differently-seeded map layouts.
  function collectSpawns(seed) {
    const sim = new Simulation({ mobsEnabled: true });
    sim.addPlayer("p1", "Alice");
    sim.addPlayer("p2", "Bob");
    sim.startMatch();
    // Pin _matchSeed so both sims generate identical maps — critical because
    // _mobSpawnPos retries differ per map, consuming different PRNG call counts.
    // Then re-run beginRound() so the map is regenerated with the deterministic
    // seed. Finally override _mobRand again (beginRound resets it).
    sim._matchSeed = seed;
    sim.beginRound();
    sim._mobRand = makeMobPrng(seed);
    sim.mobSpawnTimer = 0; // fire first spawn immediately

    const p1 = sim.players.get("p1");
    const p2 = sim.players.get("p2");
    const dt = 1 / CFG.TICK_RATE;
    const spawns = [];
    for (let t = 0; t < CFG.ROUND.COUNTDOWN + 20; t += dt) {
      // Pin player positions so tooClose / alivePlayers behave identically
      // regardless of mob attacks or knock-back from the variable map layout.
      p1.x = 0; p1.z = 6; p1.alive = true; p1.falling = false; p1.vx = 0; p1.vz = 0;
      p2.x = 0; p2.z = -6; p2.alive = true; p2.falling = false; p2.vx = 0; p2.vz = 0;
      sim.step(dt);
      for (const ev of sim.events) {
        if (ev.type === "mobSpawn") spawns.push({ type: ev.mobType, x: ev.x, z: ev.z });
      }
    }
    return spawns;
  }

  const seed = 0xc0ffee42;
  const a = collectSpawns(seed);
  const b = collectSpawns(seed);

  assert.ok(a.length > 0, "no mobs spawned in 20 s — increase duration or lower spawn timer");
  assert.strictEqual(a.length, b.length, `spawn counts differ: ${a.length} vs ${b.length}`);
  for (let i = 0; i < a.length; i++) {
    assert.strictEqual(a[i].type, b[i].type, `type mismatch at spawn ${i}`);
    assert.strictEqual(a[i].x, b[i].x, `x mismatch at spawn ${i}`);
    assert.strictEqual(a[i].z, b[i].z, `z mismatch at spawn ${i}`);
  }
});

// ── 3. Kill by hits → rune drop ───────────────────────────────────────────────
test("killing a mob by hits drops exactly one rune at its XZ; spell is not fireball", () => {
  const sim = playingSim();
  sim.mobs = []; // clear auto-spawned
  const mob = injectMob(sim, "stoneGiant", 3, 0);
  const spawnX = mob.x, spawnZ = mob.z;
  const maxHits = mob.hitsRemaining;

  for (let i = 0; i < maxHits; i++) {
    injectBoltAt(sim, mob.x, mob.z);
    sim.resolveMobHits();
    // Clear dead bolts between iterations so they don't accumulate.
    sim.bolts = sim.bolts.filter(b => !b.dead);
  }

  assert.strictEqual(mob.alive, false, "mob should be dead after maxHits hits");
  const dropped = sim.runes.filter(r => r._fromMob);
  assert.strictEqual(dropped.length, 1, "exactly one rune should drop");
  assert.strictEqual(+dropped[0].x.toFixed(3), +spawnX.toFixed(3), "rune x matches mob x");
  assert.strictEqual(+dropped[0].z.toFixed(3), +spawnZ.toFixed(3), "rune z matches mob z");
  assert.notStrictEqual(dropped[0].spell, "fireball", "rune spell must not be fireball");
  assert.ok(SPELL_ORDER.includes(dropped[0].spell), "rune spell must be in SPELL_ORDER");
});

// ── 4. Hit-count: N-1 hits leave alive, Nth kills ────────────────────────────
test("N-1 hits leave mob alive; Nth hit kills it", () => {
  const sim = playingSim();
  sim.mobs = [];
  const mob = injectMob(sim, "fireElemental", 2, 0);
  const maxHits = mob.hitsRemaining;

  for (let i = 0; i < maxHits - 1; i++) {
    injectBoltAt(sim, mob.x, mob.z);
    sim.resolveMobHits();
    sim.bolts = sim.bolts.filter(b => !b.dead);
    assert.strictEqual(mob.alive, true, `mob should survive hit ${i + 1}/${maxHits}`);
    assert.strictEqual(mob.hitsRemaining, maxHits - (i + 1));
  }

  injectBoltAt(sim, mob.x, mob.z);
  sim.resolveMobHits();
  assert.strictEqual(mob.alive, false, "Nth hit should kill the mob");
  assert.strictEqual(mob.hitsRemaining, 0);
});

// ── 5. Ring-out → cause=lava + rune drop ─────────────────────────────────────
test("mob at LAVA_Y while falling dies with cause=lava and drops a rune", () => {
  const sim = playingSim();
  sim.mobs = [];
  const mob = injectMob(sim, "giantDwarf", 3, 0);
  mob.falling = true;
  mob.y = CFG.LAVA_Y - 0.1;

  const runesBefore = sim.runes.length;
  sim.events = [];
  sim.stepMobs(1 / CFG.TICK_RATE);

  const deathEv = sim.events.find(e => e.type === "mobDeath" && e.id === mob.id);
  assert.ok(deathEv, "mobDeath event must be emitted");
  assert.strictEqual(deathEv.cause, "lava", "cause must be lava");
  assert.strictEqual(mob.alive, false, "mob must be dead");
  assert.ok(sim.runes.length > runesBefore, "a rune must drop on lava death");
});

// ── 6. Melee knocks player — no hp field ─────────────────────────────────────
test("melee hit applies knockback velocity to player; player has no hp field", () => {
  const sim = playingSim();
  const p = sim.players.get("p1");
  // Place player offset from origin so direction vector is non-zero.
  p.x = 4; p.z = 0;
  p.vx = 0; p.vz = 0;
  p.alive = true; p.falling = false;

  // Simulate what stepMobs does for a melee action.
  const mobX = 2, mobZ = 0;
  const dx = p.x - mobX, dz = p.z - mobZ; // dx=2, dz=0
  const hitApplied = p.applyHit(dx, dz, CFG.MOB_TYPES.stoneGiant.meleeKb);

  assert.ok(hitApplied, "applyHit must return true (not shielded)");
  assert.ok(p.vx > 0, `player should have +x knockback after melee hit (vx=${p.vx})`);
  assert.strictEqual(p.hp, undefined, "player must not have an hp field (smash-style game)");
});

// ── 7. Signature ability can ring out an edge player ─────────────────────────
test("groundSlam ability queues a meteor that flings a nearby player", () => {
  const sim = playingSim();
  sim.mobs = [];
  const mob = injectMob(sim, "stoneGiant", 0, 0);
  const p = sim.players.get("p1");
  // Place player right on top of the mob (inside ability radius).
  p.x = 1; p.z = 0;
  p.vx = 0; p.vz = 0;
  p.alive = true; p.falling = false;

  sim.events = [];
  sim._fireMobAbility(mob, p);

  // groundSlam should have queued a meteor.
  assert.ok(sim.meteors.some(m => m.ownerId === mob.id), "groundSlam must queue a meteor");
  const abilityEv = sim.events.find(e => e.type === "mobAbility" && e.mobType === "stoneGiant");
  assert.ok(abilityEv, "mobAbility event must be emitted");

  // Advance past detonation (1 s).
  advance(sim, 1.5);

  // Player should have received knockback (velocity changed or already ringing out).
  const speed = Math.hypot(p.vx, p.vz);
  assert.ok(speed > 0 || !p.alive || p.falling,
    "player should be flung by groundSlam detonation");
});

// ── 8. Minion cap ≤ 2 per parent; childCount decrements on death ─────────────
test("minion cap: ≤ MOB_MAX_CHILDREN per parent; childCount decrements when minion dies", () => {
  const sim = playingSim();
  sim.mobs = [];
  const parent = injectMob(sim, "stoneGiant", 0, 0);

  // Inject exactly MOB_MAX_CHILDREN minions.
  for (let i = 0; i < CFG.MOB_MAX_CHILDREN; i++) {
    const minionId = "mob:" + sim._mobId++;
    const minion = spawnMob(minionId, "minion", i * 2, 2, parent.id);
    parent.childCount++;
    sim.mobs.push(minion);
  }

  assert.strictEqual(parent.childCount, CFG.MOB_MAX_CHILDREN, "childCount should equal cap");

  // Kill one minion — childCount should decrement.
  const minion = sim.mobs.find(m => m.parentId === parent.id);
  assert.ok(minion, "at least one minion should exist");
  sim.killMob(minion, "hits");
  assert.strictEqual(parent.childCount, CFG.MOB_MAX_CHILDREN - 1,
    "childCount should decrement when a minion dies");
});

// ── 9. Neutrality: targetId = nearest player; mob bolts skip mob hits ─────────
test("mob targets nearest player; mob-owned bolts do not damage mobs", () => {
  const sim = playingSim();
  sim.mobs = [];
  const p1 = sim.players.get("p1");
  const p2 = sim.players.get("p2");
  p1.x = 3; p1.z = 0;
  p2.x = 10; p2.z = 0;
  p1.alive = p2.alive = true; p1.falling = p2.falling = false;

  const mob = injectMob(sim, "stormingVortex", 0, 0);

  // Run brain think once to assign targetId.
  const playerArr = [...sim.players.values()];
  mob._brain.think(mob, playerArr, 1 / CFG.TICK_RATE);
  assert.strictEqual(mob.targetId, "p1", "nearest player should be targetId");

  // Inject a mob-owned bolt positioned right on the mob.
  const mobBolt = new Bolt(mob.id, mob.x, mob.z, 0, 0xffffff);
  mobBolt.x = mob.x; mobBolt.z = mob.z;
  sim.bolts.push(mobBolt);

  const hitsBefore = mob.hitsRemaining;
  sim.resolveMobHits();
  assert.strictEqual(mob.hitsRemaining, hitsBefore, "mob-owned bolt must not damage any mob");
});

// ── 10. Toggle off → zero mobs, zero mobSpawn events ─────────────────────────
test("mobsEnabled=false produces zero mobs and zero mobSpawn events", () => {
  const sim = new Simulation({ mobsEnabled: false });
  sim.addPlayer("p1", "Alice");
  sim.addPlayer("p2", "Bob");
  sim.startMatch();

  const dt = 1 / CFG.TICK_RATE;
  let spawnEvents = 0;
  for (let t = 0; t < 30; t += dt) {
    sim.step(dt);
    spawnEvents += sim.events.filter(e => e.type === "mobSpawn").length;
    if (sim.phase !== PHASE.PLAYING && sim.phase !== PHASE.COUNTDOWN) break;
  }

  assert.strictEqual(sim.mobs.length, 0, "mobs array must stay empty when disabled");
  assert.strictEqual(spawnEvents, 0, "no mobSpawn events should fire when disabled");
});

// ── 11. Snapshot round-trip ───────────────────────────────────────────────────
test("snapshot mobs array survives JSON.parse(JSON.stringify(...))", () => {
  const sim = playingSim();
  sim.mobs = []; // clear any auto-spawned mobs for a clean count
  injectMob(sim, "stoneGiant", 2, 1);
  injectMob(sim, "fireElemental", -3, 2);

  const snap = sim.snapshot();
  assert.ok(Array.isArray(snap.mobs), "snapshot.mobs must be an array");
  assert.strictEqual(snap.mobs.length, 2, `expected 2 mobs in snapshot, got ${snap.mobs.length}`);

  const round = JSON.parse(JSON.stringify(snap));
  assert.strictEqual(round.mobs.length, 2, "round-tripped mobs length must match");

  const m = round.mobs[0];
  // Verify all required fields from plan §8.
  for (const field of ["id", "type", "x", "z", "y", "a", "hp", "max", "color", "f"]) {
    assert.ok(field in m, `snapshot mob missing field: ${field}`);
  }
  assert.ok(typeof m.x === "number" && Number.isFinite(m.x), "x must be a finite number");
  assert.ok(typeof m.hp === "number", "hp must be a number");
  assert.ok(typeof m.color === "number", "color must be a number");
});

console.log(`\n${passed} tests passed.`);
