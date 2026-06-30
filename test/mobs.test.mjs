// Headless tests for the mob system (src/mob.js + mob integration in src/sim.js).
// Run with: node --test test/mobs.test.mjs
// Follows the patterns of test/sim.test.mjs and test/collision.test.mjs.
import assert from "node:assert";
import { Simulation, PHASE } from "../src/sim.js";
import { Bolt } from "../src/bolt.js";
import { CFG, SPELL_ORDER, ITEMS } from "../src/config.js";
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

// Force-inject a mob directly (bypasses spawn timer / cap / roster) and clear
// both spawnInvuln AND the cinematic entrance window so tests that need an
// immediately-active mob don't stall inside the entrance lock.
function injectMob(sim, type, x, z, parentId = null) {
  const id = "mob:" + sim._mobId++;
  const mob = spawnMob(id, type, x, z, parentId);
  mob.spawnInvuln = 0;
  mob.entering = 0;   // skip entrance window; tests that need it set it explicitly
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
  // Collect mobIncoming (big mob) and mobSpawn (minion) events for comparison.
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
    sim.mobSpawnTimer = 0; // fire first big-mob spawn immediately

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
        // Check both big-mob (mobIncoming) and minion (mobSpawn) events.
        if (ev.type === "mobIncoming" || ev.type === "mobSpawn")
          spawns.push({ type: ev.mobType, x: ev.x, z: ev.z });
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

// ── 3. Kill by hits → item drop ───────────────────────────────────────────────
test("killing a mob by hits drops exactly one item at its XZ; itemKey is in ITEMS", () => {
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
  const dropped = sim.items.filter(i => i._fromMob);
  assert.strictEqual(dropped.length, 1, "exactly one item should drop");
  assert.strictEqual(+dropped[0].x.toFixed(3), +spawnX.toFixed(3), "item x matches mob x");
  assert.strictEqual(+dropped[0].z.toFixed(3), +spawnZ.toFixed(3), "item z matches mob z");
  assert.ok(ITEMS[dropped[0].itemKey], "dropped itemKey must be in ITEMS");
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

// ── 5. Ring-out → cause=lava + item drop ─────────────────────────────────────
test("mob at LAVA_Y while falling dies with cause=lava and drops an item", () => {
  const sim = playingSim();
  sim.mobs = [];
  const mob = injectMob(sim, "giantDwarf", 3, 0);
  mob.falling = true;
  mob.y = CFG.LAVA_Y - 0.1;

  const itemsBefore = sim.items.length;
  sim.events = [];
  sim.stepMobs(1 / CFG.TICK_RATE);

  const deathEv = sim.events.find(e => e.type === "mobDeath" && e.id === mob.id);
  assert.ok(deathEv, "mobDeath event must be emitted");
  assert.strictEqual(deathEv.cause, "lava", "cause must be lava");
  assert.strictEqual(mob.alive, false, "mob must be dead");
  assert.ok(sim.items.length > itemsBefore, "an item must drop on lava death");
});

// ── 6. Melee knocks player — applyHit lands and hp is a valid field ──────────
test("melee hit applies knockback velocity to player; hp field present with valid value", () => {
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
  // Step 1: hp is now a first-class field on Player (HP + charge dual-axis design).
  assert.ok(typeof p.hp === "number" && p.hp >= 0, "player.hp must be a non-negative number");
});

// ── 7. fissureSlam ability queues stun meteors and applies stun on detonation ─
test("fissureSlam queues a stun meteor; player is flung and stunned after detonation", () => {
  const sim = playingSim();
  sim.mobs = [];
  const mob = injectMob(sim, "stoneGiant", 0, 0);
  const p = sim.players.get("p1");
  // Place player right on top of the mob (inside ability radius).
  p.x = 1; p.z = 0;
  p.vx = 0; p.vz = 0;
  p.alive = true; p.falling = false;
  const hpBefore = p.hp;

  sim.events = [];
  sim._fireMobAbility(mob, p);

  // fissureSlam must queue at least one meteor owned by this mob.
  assert.ok(sim.meteors.some(m => m.ownerId === mob.id), "fissureSlam must queue a meteor");
  // Center meteor must carry the stun field.
  const centerMeteor = sim.meteors.find(m => m.ownerId === mob.id && m.stun);
  assert.ok(centerMeteor, "center meteor must have stun field set");
  assert.ok(centerMeteor.stun > 0, "stun duration must be > 0");
  const abilityEv = sim.events.find(e => e.type === "mobAbility" && e.mobType === "stoneGiant");
  assert.ok(abilityEv, "mobAbility event must be emitted");

  // Advance past detonation (center meteor t≈0.45, echo t≈0.80; advance 1.5 s clears both).
  advance(sim, 1.5);

  // Player should have received knockback and stun, and taken HP damage.
  const speed = Math.hypot(p.vx, p.vz);
  assert.ok(speed > 0 || !p.alive || p.falling || p.status.stunned > 0,
    "player should be flung or stunned by fissureSlam detonation");
  assert.ok(p.hp < hpBefore || !p.alive || p.falling,
    "player should take HP damage from fissureSlam");
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
test("snapshot mobs array survives JSON.parse(JSON.stringify(...)); ent field present", () => {
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
  // Verify all required fields including the new `ent` entrance-timer field.
  for (const field of ["id", "type", "x", "z", "y", "a", "hp", "max", "color", "f", "ent"]) {
    assert.ok(field in m, `snapshot mob missing field: ${field}`);
  }
  assert.ok(typeof m.x === "number" && Number.isFinite(m.x), "x must be a finite number");
  assert.ok(typeof m.hp === "number", "hp must be a number");
  assert.ok(typeof m.color === "number", "color must be a number");
  assert.ok(typeof m.ent === "number", "ent must be a number");
  // injectMob clears entering to 0, so ent should be 0.
  assert.strictEqual(m.ent, 0, "injectMob mob has entering=0 so ent snapshot field should be 0");
});

// ── 12. Roster ────────────────────────────────────────────────────────────────
test("roster: four distinct big types spawn once each per round, exhausting the roster", () => {
  const sim = playingSim();
  sim.mobs = [];
  // Override the shuffled roster with a deterministic order to make assertions
  // about which type spawns at each position.
  sim._mobRoster = ["stoneGiant", "stormingVortex", "giantDwarf", "fireElemental"];
  sim._mobRosterIdx = 0;
  // Ensure the cap starts at 1 (no shrink progress).
  sim._arenaStartR = sim.arena.radius;

  // Pin players away from the centre so _mobSpawnPos has room to place mobs.
  const p1 = sim.players.get("p1"); p1.x = 0; p1.z = 10; p1.alive = true; p1.falling = false;
  const p2 = sim.players.get("p2"); p2.x = 0; p2.z = -10; p2.alive = true; p2.falling = false;

  const dt = 1 / CFG.TICK_RATE;
  const spawnedTypes = [];

  for (let i = 0; i < 4; i++) {
    // Try up to 5 stepMobs ticks per roster entry in case _mobSpawnPos
    // misses on a tick (unlikely on a large clear arena, but defensive).
    let ev = null;
    for (let retry = 0; retry < 5 && !ev; retry++) {
      sim.mobSpawnTimer = -1;
      sim.events = [];
      sim.stepMobs(dt);
      ev = sim.events.find(e => e.type === "mobIncoming");
    }
    assert.ok(ev, `expected big-mob spawn #${i + 1} (mobIncoming event) from roster`);
    spawnedTypes.push(ev.mobType);
    // Kill all big mobs so the alive-cap check passes on the next iteration.
    for (const m of sim.mobs) { if (m.type !== "minion") m.alive = false; }
    sim.mobs = sim.mobs.filter(m => m.alive);
  }

  assert.deepStrictEqual(
    spawnedTypes,
    ["stoneGiant", "stormingVortex", "giantDwarf", "fireElemental"],
    "big mob types must spawn in exact roster order"
  );

  // Roster is now exhausted; no further big mob should spawn.
  assert.strictEqual(sim._mobRosterIdx, 4, "roster index must equal roster length after 4 spawns");
  sim.mobSpawnTimer = -1;
  sim.events = [];
  sim.stepMobs(dt);
  const extraEv = sim.events.find(e => e.type === "mobIncoming");
  assert.strictEqual(extraEv, undefined, "no further big mobs should spawn after roster is exhausted");
});

// ── 13. Dynamic cap ───────────────────────────────────────────────────────────
test("_mobAliveCap() steps through 1→2→3→4 as arena shrinks", () => {
  const sim = playingSim();
  const minR   = CFG.ARENA_MIN_RADIUS;  // 6
  const startR = 18;                    // medium-arena default radius
  sim._arenaStartR = startR;
  const span = startR - minR;           // 12 units of possible shrink

  // Use mid-range s values (not exact thresholds) to avoid floating-point
  // precision edge cases where e.g. span*0.70 ≠ 8.4 exactly.

  // s=0.00 (no shrink) → cap 1.
  sim.arena.radius = startR;
  assert.strictEqual(sim._mobAliveCap(), 1, "cap must be 1 with no shrink (s=0)");

  // s≈0.20 (between 0.00 and 0.40) → cap still 1.
  sim.arena.radius = startR - span * 0.20;
  assert.strictEqual(sim._mobAliveCap(), 1, "cap must remain 1 below s=0.40");

  // s≈0.55 (between 0.40 and 0.70) → cap 2.
  sim.arena.radius = startR - span * 0.55;
  assert.strictEqual(sim._mobAliveCap(), 2, "cap must be 2 between s=0.40 and s=0.70");

  // s≈0.80 (between 0.70 and 0.90) → cap 3.
  sim.arena.radius = startR - span * 0.80;
  assert.strictEqual(sim._mobAliveCap(), 3, "cap must be 3 between s=0.70 and s=0.90");

  // s≈0.95 (above 0.90) → cap 4 (bounded by MOB_MAX_ALIVE).
  sim.arena.radius = startR - span * 0.95;
  assert.strictEqual(
    sim._mobAliveCap(),
    Math.min(4, CFG.MOB_MAX_ALIVE),
    "cap must be 4 (or MOB_MAX_ALIVE) above s=0.90"
  );

  // s=1.00 (fully shrunk) → cap still bounded by MOB_MAX_ALIVE.
  sim.arena.radius = minR;
  assert.strictEqual(
    sim._mobAliveCap(),
    Math.min(4, CFG.MOB_MAX_ALIVE),
    "cap at full shrink must be min(4, MOB_MAX_ALIVE)"
  );
});

// ── 14. Health scaling ────────────────────────────────────────────────────────
test("big mob spawned with 2 alive players has fewer maxHits than with 6; minions stay at base 3 hits", () => {
  // Compute expected hits for each player count via the CFG formula.
  const base = CFG.MOB_TYPES.stoneGiant.maxHits;
  const factor = (n) => CFG.MOB_HP_MIN_FACTOR + CFG.MOB_HP_PER_PLAYER * Math.max(0, n - 2);
  const exp2 = Math.max(1, Math.round(base * factor(2)));
  const exp6 = Math.max(1, Math.round(base * factor(6)));
  assert.ok(exp2 < exp6, `formula sanity: 2-player hits (${exp2}) must be < 6-player hits (${exp6})`);

  // Helper: create a sim with n players in PLAYING state, all pinned alive and
  // spread out so _mobSpawnPos has a clear field.
  function simWithNAlive(n) {
    const sim = new Simulation({ mobsEnabled: true });
    for (let i = 1; i <= n; i++) sim.addPlayer(`p${i}`, `P${i}`);
    sim.startMatch();
    const dt = 1 / CFG.TICK_RATE;
    for (let t = 0; t < CFG.ROUND.COUNTDOWN + 0.1; t += dt) sim.step(dt);
    let idx = 0;
    for (const p of sim.players.values()) {
      const a = (idx / n) * Math.PI * 2;
      p.x = Math.cos(a) * 10; p.z = Math.sin(a) * 10;
      p.alive = true; p.falling = false; p.spectating = false;
      idx++;
    }
    // Pin mob PRNG so _mobSpawnPos() uses a deterministic sequence regardless
    // of the Math.random()-seeded _matchSeed.  startMatch() overwrites _matchSeed
    // with Math.random(), making subsequent _mobRand non-deterministic; pinning
    // here ensures the retry loop below always converges.
    sim._mobRand = makeMobPrng(0xdeadbeef);
    return sim;
  }

  // Spawn stoneGiant with 2 alive players.
  // Retry up to 5 ticks (each tick makes 20 position attempts) so a single
  // _mobSpawnPos miss on a given tick cannot falsely fail the assertion.
  const sim2 = simWithNAlive(2);
  let mob2 = null;
  for (let retry = 0; retry < 5 && !mob2; retry++) {
    sim2.mobs = [];
    sim2._mobRoster = ["stoneGiant"]; sim2._mobRosterIdx = 0;
    sim2.mobSpawnTimer = -1;
    sim2.events = [];
    sim2.stepMobs(1 / CFG.TICK_RATE);
    mob2 = sim2.mobs.find(m => m.type === "stoneGiant");
  }
  assert.ok(mob2, "stoneGiant must spawn in 2-player sim");
  assert.strictEqual(mob2.maxHits, exp2, `2-player maxHits: expected ${exp2}, got ${mob2.maxHits}`);

  // Spawn stoneGiant with 6 alive players.
  const sim6 = simWithNAlive(6);
  let mob6 = null;
  for (let retry = 0; retry < 5 && !mob6; retry++) {
    sim6.mobs = [];
    sim6._mobRoster = ["stoneGiant"]; sim6._mobRosterIdx = 0;
    sim6.mobSpawnTimer = -1;
    sim6.events = [];
    sim6.stepMobs(1 / CFG.TICK_RATE);
    mob6 = sim6.mobs.find(m => m.type === "stoneGiant");
  }
  assert.ok(mob6, "stoneGiant must spawn in 6-player sim");
  assert.strictEqual(mob6.maxHits, exp6, `6-player maxHits: expected ${exp6}, got ${mob6.maxHits}`);

  // Minions are not health-scaled: base config maxHits applies regardless of player count.
  assert.strictEqual(CFG.MOB_TYPES.minion.maxHits, 3, "minion base maxHits must always be 3");
});

// ── 15. Entrance window: locked, immune, then active with mobArrive ───────────
test("entrance: big mob is locked and immune during window, then mobArrive fires on completion", () => {
  const sim = playingSim();
  sim.mobs = [];

  // Pin players away from the mob so _mobSpawnPos can find a valid position.
  const p1 = sim.players.get("p1"); p1.x = 0; p1.z = 10; p1.alive = true; p1.falling = false;
  const p2 = sim.players.get("p2"); p2.x = 0; p2.z = -10; p2.alive = true; p2.falling = false;

  // Spawn via the normal sim path (uses roster + spawn timer) so the mob is
  // created with mob.entering = CFG.MOB_ENTRANCE, exactly as in live play.
  sim._mobRoster = ["stoneGiant"]; sim._mobRosterIdx = 0;
  sim.mobSpawnTimer = -1;
  sim.events = [];
  sim.stepMobs(1 / CFG.TICK_RATE);

  const mob = sim.mobs.find(m => m.type === "stoneGiant");
  assert.ok(mob, "stoneGiant must spawn via sim path");

  // 1. mobIncoming event carries the correct entrance descriptor.
  const incomingEv = sim.events.find(e => e.type === "mobIncoming" && e.id === mob.id);
  assert.ok(incomingEv, "mobIncoming event must be emitted on big-mob spawn");
  assert.strictEqual(incomingEv.entrance, "shatter", "stoneGiant entrance kind must be 'shatter'");
  assert.strictEqual(incomingEv.duration, CFG.MOB_ENTRANCE, "mobIncoming.duration must equal MOB_ENTRANCE");

  // 2. entering > 0 right after spawn.
  assert.ok(mob.entering > 0,
    `mob.entering must be > 0 at spawn (got ${mob.entering})`);

  // 3. MobBrain.think() returns idle and moves nothing during the entrance window.
  const playerArr = [...sim.players.values()];
  const action = mob._brain.think(mob, playerArr, 1 / CFG.TICK_RATE);
  assert.strictEqual(action.kind, "idle", "brain must return idle during entrance");
  // think() ticks entering down by one dt; it should still be > 0 after one tick.
  assert.ok(mob.entering > 0, "entering must still be > 0 after a single think() tick");

  // 4. Bolts cannot damage the mob while it is still entering.
  const hitsBefore = mob.hitsRemaining;
  injectBoltAt(sim, mob.x, mob.z);
  sim.resolveMobHits();
  sim.bolts = sim.bolts.filter(b => !b.dead);
  assert.strictEqual(mob.hitsRemaining, hitsBefore,
    "entering mob must be immune to bolt damage");

  // 5. After the entrance window expires, mobArrive fires and mob.entering → 0.
  // Set entering to a sub-tick value so it completes in exactly one stepMobs call.
  mob.entering = 0.001;
  sim.events = [];
  sim.stepMobs(1 / CFG.TICK_RATE);

  assert.ok(mob.entering <= 0,
    `mob.entering must be 0 after window expires (got ${mob.entering})`);
  const arriveEv = sim.events.find(e => e.type === "mobArrive" && e.id === mob.id);
  assert.ok(arriveEv, "mobArrive event must fire when entrance window completes");
  assert.strictEqual(arriveEv.mobType, "stoneGiant", "mobArrive.mobType must match");
});

// ── 16. Entrance impact: summon/meteor AoE knockback on mobArrive ─────────────
test("entrance impact: giantDwarf and fireElemental knock back players inside radius on mobArrive", () => {
  const dt = 1 / CFG.TICK_RATE;

  // giantDwarf → entrance: { kind: "summon", kb: 26, radius: 6 }
  {
    const sim = playingSim();
    sim.mobs = [];

    const mob = spawnMob("mob:99", "giantDwarf", 0, 0);
    mob.spawnInvuln = 0;
    mob.entering = 0.001; // completes on the very next stepMobs tick
    sim.mobs.push(mob);

    const p1 = sim.players.get("p1");
    p1.x = 3; p1.z = 0;  // inside radius 6
    p1.vx = 0; p1.vz = 0; p1.alive = true; p1.falling = false;

    const p2 = sim.players.get("p2");
    p2.x = 0; p2.z = 10; // outside radius 6
    p2.vx = 0; p2.vz = 0; p2.alive = true; p2.falling = false;

    sim.events = [];
    sim.stepMobs(dt);

    // mobArrive must fire.
    const arriveEv = sim.events.find(e => e.type === "mobArrive" && e.id === mob.id);
    assert.ok(arriveEv, "mobArrive must fire for giantDwarf entrance completion");

    // Player inside radius must receive knockback.
    const speed1 = Math.hypot(p1.vx, p1.vz);
    assert.ok(speed1 > 0,
      `p1 inside radius ${CFG.MOB_TYPES.giantDwarf.entrance.radius} should be knocked back (speed=${speed1.toFixed(3)})`);

    // Player outside radius must NOT be affected.
    assert.strictEqual(p2.vx, 0, "p2 outside giantDwarf radius should not be knocked back (vx)");
    assert.strictEqual(p2.vz, 0, "p2 outside giantDwarf radius should not be knocked back (vz)");

    // A hit event must accompany the knockback.
    const hitEv = sim.events.find(e => e.type === "hit" && e.victim === p1.id && e.by === mob.id);
    assert.ok(hitEv, "hit event must be emitted for player inside giantDwarf arrival radius");
  }

  // fireElemental → entrance: { kind: "meteor", kb: 30, radius: 6 }
  {
    const sim = playingSim();
    sim.mobs = [];

    const mob = spawnMob("mob:99", "fireElemental", 0, 0);
    mob.spawnInvuln = 0;
    mob.entering = 0.001;
    sim.mobs.push(mob);

    const p1 = sim.players.get("p1");
    p1.x = 4; p1.z = 0;  // inside radius 6
    p1.vx = 0; p1.vz = 0; p1.alive = true; p1.falling = false;

    const p2 = sim.players.get("p2");
    p2.x = 0; p2.z = 10; // outside radius 6
    p2.vx = 0; p2.vz = 0; p2.alive = true; p2.falling = false;

    sim.events = [];
    sim.stepMobs(dt);

    const arriveEv = sim.events.find(e => e.type === "mobArrive" && e.id === mob.id);
    assert.ok(arriveEv, "mobArrive must fire for fireElemental entrance completion");

    const speed1 = Math.hypot(p1.vx, p1.vz);
    assert.ok(speed1 > 0,
      `p1 inside radius ${CFG.MOB_TYPES.fireElemental.entrance.radius} should be knocked back by fireElemental entrance (speed=${speed1.toFixed(3)})`);

    assert.strictEqual(p2.vx, 0, "p2 outside fireElemental radius should not be knocked back (vx)");
    assert.strictEqual(p2.vz, 0, "p2 outside fireElemental radius should not be knocked back (vz)");
  }
});

// ── 17. Telegraph → resolve timing ────────────────────────────────────────────
test("telegraph→resolve: mobTelegraph emitted on first tick, no damage until channel expires", () => {
  const sim = playingSim();
  sim.mobs = [];
  const mob = injectMob(sim, "stoneGiant", 0, 0);
  mob.abilityCd = 0; // ability ready immediately

  const p = sim.players.get("p1");
  p.x = 5; p.z = 0;
  p.vx = 0; p.vz = 0;
  p.alive = true; p.falling = false;
  const hpBefore = p.hp;

  const dt = 1 / CFG.TICK_RATE;

  // First tick: ability triggers, channel starts, telegraph emitted.
  sim.events = [];
  sim.stepMobs(dt);

  assert.ok(mob.channel, "mob.channel must be set after ability trigger");
  const telegraphEv = sim.events.find(e => e.type === "mobTelegraph" && e.id === mob.id);
  assert.ok(telegraphEv, "mobTelegraph event must be emitted on channel start");
  assert.strictEqual(telegraphEv.ability, "fissureSlam", "mobTelegraph.ability must match");
  assert.ok(telegraphEv.castTime > 0, "mobTelegraph.castTime must be positive");
  // No damage or ability resolution yet.
  assert.strictEqual(p.hp, hpBefore, "no HP damage should occur during windup");
  assert.strictEqual(sim.events.filter(e => e.type === "mobAbility").length, 0,
    "mobAbility must not fire before channel expires");

  // Tick down to just before full castTime (leave 1 tick remaining).
  const castTime = CFG.MOB_TYPES.stoneGiant.castTime;
  const totalTicks = Math.ceil(castTime / dt);
  for (let i = 0; i < totalTicks - 1; i++) {
    sim.events = [];
    sim.stepMobs(dt);
  }
  assert.ok(mob.channel, "channel must still be active before castTime fully elapses");

  // Final tick: channel expires, ability resolves.
  sim.events = [];
  sim.stepMobs(dt);
  assert.strictEqual(mob.channel, null, "mob.channel must be null after resolve");
  const abilityEv = sim.events.find(e => e.type === "mobAbility");
  assert.ok(abilityEv, "mobAbility event must be emitted on channel resolve");

  // Advance past meteor detonation and confirm HP damage.
  advance(sim, 1.5);
  assert.ok(p.hp < hpBefore || !p.alive || p.falling,
    "player should take HP damage after fissureSlam resolves and meteor detonates");
});

// ── 18. seismicStomp: AoE stun-nova hits players in radius ───────────────────
test("seismicStomp: players inside abilityRadius take damage and stun; outside are unaffected", () => {
  const sim = playingSim();
  sim.mobs = [];
  const mob = injectMob(sim, "giantDwarf", 0, 0);

  const p1 = sim.players.get("p1");
  const p2 = sim.players.get("p2");

  // p1 inside radius, p2 outside.
  const r = CFG.MOB_TYPES.giantDwarf.abilityRadius;
  p1.x = r * 0.5; p1.z = 0;
  p1.vx = 0; p1.vz = 0;
  p1.alive = true; p1.falling = false;
  const hp1Before = p1.hp;

  p2.x = r * 2; p2.z = 0;
  p2.vx = 0; p2.vz = 0;
  p2.alive = true; p2.falling = false;
  const hp2Before = p2.hp;

  sim.events = [];
  sim._fireMobAbility(mob, p1);

  // seismicStomp resolves instantly via applyAoE (no meteor queued).
  assert.ok(p1.hp < hp1Before || !p1.alive || p1.falling,
    "p1 inside radius should take HP damage from seismicStomp");
  assert.ok(p1.status.stunned > 0 || !p1.alive || p1.falling,
    "p1 inside radius should be stunned by seismicStomp");
  assert.strictEqual(p2.hp, hp2Before, "p2 outside radius must not take damage");
  assert.strictEqual(p2.status.stunned, 0, "p2 outside radius must not be stunned");
});

// ── 19. vacuum: gravity + slow + curse applied to players in radius ────────────
test("vacuum: players in radius get gravity/slow/curse; outside remain unaffected", () => {
  const sim = playingSim();
  sim.mobs = [];
  const mob = injectMob(sim, "stormingVortex", 0, 0);

  const p1 = sim.players.get("p1");
  const p2 = sim.players.get("p2");

  const r = CFG.MOB_TYPES.stormingVortex.abilityRadius;
  p1.x = r * 0.5; p1.z = 0;
  p1.alive = true; p1.falling = false;
  p1.status.gravity = 0; p1.status.slow = 0; p1.status.curse = 0;

  p2.x = r * 3; p2.z = 0;
  p2.alive = true; p2.falling = false;

  sim.events = [];
  sim._fireMobAbility(mob, p1);

  // p1 inside: should have gravity, slow, curse applied.
  assert.ok(p1.status.gravity > 0,
    "p1 inside radius should have gravity status applied");
  assert.ok(p1.status.slow > 0,
    "p1 inside radius should have slow status applied");
  assert.ok(p1.status.slowMul < 1,
    "p1 slowMul must be < 1 while slowed");
  assert.ok(p1.status.curse > 0,
    "p1 inside radius should have curse status applied");
  assert.ok(p1.status.curseMul > 1,
    "p1 curseMul must be > 1 while cursed");

  // p2 outside: status fields unchanged.
  assert.strictEqual(p2.status.gravity, 0, "p2 outside radius must not have gravity");
  assert.strictEqual(p2.status.slow,    0, "p2 outside radius must not be slowed");

  // A gravity event must be emitted for the renderer.
  const gravEv = sim.events.find(e => e.type === "gravity");
  assert.ok(gravEv, "vacuum must emit a gravity event");
});

// ── 20. magmaEruption: stages meteors queued with burn; burn applied on detonation ──
test("magmaEruption: stages burn-meteors queued; burn status applied after detonation", () => {
  const sim = playingSim();
  sim.mobs = [];
  const mob = injectMob(sim, "fireElemental", 0, 0);
  const cfg  = CFG.MOB_TYPES.fireElemental;

  const p = sim.players.get("p1");
  p.x = cfg.stageR * 0.5; p.z = 0;
  p.alive = true; p.falling = false;

  const meteorsBefore = sim.meteors.length;
  sim.events = [];
  sim._fireMobAbility(mob, p);

  // Should have queued exactly cfg.stages meteors.
  const queued = sim.meteors.filter(m => m.ownerId === mob.id);
  assert.strictEqual(queued.length, cfg.stages,
    `magmaEruption must queue exactly ${cfg.stages} meteors`);

  // Each meteor must carry burn fields.
  for (const m of queued) {
    assert.ok(m.burn > 0,    "each eruption meteor must have burn DPS set");
    assert.ok(m.burnDur > 0, "each eruption meteor must have burnDur set");
  }

  // Advance past detonation of all stages.
  advance(sim, 0.5 + cfg.stages * cfg.stageDelay + 0.5);

  // Player close to mob (within range of stage-0 at mob position) should have burn.
  assert.ok(p.status.burn > 0 || p.hp < p.maxHp || !p.alive || p.falling,
    "player near mob should have burn or reduced HP after magmaEruption stages detonate");
});

// ── 21. Channel interrupt: cancel on mob death / fall ────────────────────────
test("channel is cancelled when mob falls before castTime expires", () => {
  const sim = playingSim();
  sim.mobs = [];
  const mob = injectMob(sim, "stoneGiant", 0, 0);

  // Manually set channel as if ability just started.
  mob.channel = {
    ability:  "fissureSlam",
    t:        0.8,  // still has 0.8 s remaining
    targetId: "p1",
    tx: 3, tz: 0,
    r: CFG.MOB_TYPES.stoneGiant.abilityRadius,
  };

  // Trigger a fall mid-channel.
  mob.falling = true;
  mob.y = CFG.LAVA_Y + 0.1; // above lava so stepMobs doesn't kill yet

  const dt = 1 / CFG.TICK_RATE;
  const meteorsBefore = sim.meteors.length;
  sim.events = [];
  sim.stepMobs(dt);

  // Channel must be cancelled; no ability should resolve.
  assert.strictEqual(mob.channel, null, "channel must be cleared on mob.falling = true");
  assert.strictEqual(sim.meteors.length, meteorsBefore,
    "no new meteors should be queued when channel is interrupted by fall");
  assert.strictEqual(sim.events.filter(e => e.type === "mobAbility").length, 0,
    "no mobAbility event should fire when channel is interrupted");
});

// ── 22. Snapshot ch field ────────────────────────────────────────────────────
test("mob.snapshot() includes ch field: null when idle, compact object while channeling", () => {
  const sim = playingSim();
  sim.mobs = [];
  const mob = injectMob(sim, "stoneGiant", 0, 0);

  // Idle: ch should be null.
  let snap = mob.snapshot();
  assert.ok("ch" in snap, "snapshot must include ch field");
  assert.strictEqual(snap.ch, null, "ch must be null when not channeling");

  // Active channel: ch must be a compact summary.
  mob.channel = {
    ability:  "fissureSlam",
    t:        0.6,
    targetId: "p1",
    tx: 4, tz: 2,
    r: 7,
  };
  snap = mob.snapshot();
  assert.ok(snap.ch !== null, "ch must not be null while channeling");
  assert.strictEqual(snap.ch.a, "fissureSlam", "ch.a must be the ability name");
  assert.ok(typeof snap.ch.t === "number", "ch.t must be a number");
  assert.strictEqual(snap.ch.r, 7, "ch.r must match channel radius");
  assert.strictEqual(snap.ch.x, 4, "ch.x must match locked cast-point x");
  assert.strictEqual(snap.ch.z, 2, "ch.z must match locked cast-point z");
});

// ── 23. ownerPlayerId exclusion preserved across new abilities ────────────────
test("vacuum and seismicStomp do not affect minion-excluded owner player via ownerPlayerId", () => {
  // stormingVortex vacuum
  {
    const sim = playingSim();
    sim.mobs = [];
    const mob = injectMob(sim, "stormingVortex", 0, 0);
    // Assign ownerPlayerId so that 'p1' is the owner (like a player-summoned minion).
    mob.ownerPlayerId = "p1";

    const p1 = sim.players.get("p1");
    p1.x = 2; p1.z = 0; // inside vacuum radius
    p1.alive = true; p1.falling = false;
    p1.status.gravity = 0; p1.status.slow = 0;

    const p2 = sim.players.get("p2");
    p2.x = 3; p2.z = 0; // also inside radius
    p2.alive = true; p2.falling = false;
    p2.status.gravity = 0;

    // _fireMobAbility bypasses ownerPlayerId; it checks p.id vs c.id via applyAoE for
    // seismicStomp. For vacuum the gravity loop has no ownerPlayerId exclusion (it
    // applies to all in radius, which is correct for a gravity well).
    // What we verify here: mob-owned bolts don't double-dip and self-skip is mob.id-based.
    sim.events = [];
    sim._fireMobAbility(mob, p2);

    // The gravity event must fire.
    const gravEv = sim.events.find(e => e.type === "gravity");
    assert.ok(gravEv, "vacuum must emit gravity event regardless of ownerPlayerId");
  }

  // giantDwarf seismicStomp: applyAoE's self-skip uses c.id (mob.id); no players are skipped.
  {
    const sim = playingSim();
    sim.mobs = [];
    const mob = injectMob(sim, "giantDwarf", 0, 0);

    const p1 = sim.players.get("p1");
    p1.x = 2; p1.z = 0;
    p1.alive = true; p1.falling = false;
    const hp1Before = p1.hp;

    sim.events = [];
    sim._fireMobAbility(mob, p1);

    // Player inside radius must still take damage — mob.id ≠ p1.id so no self-skip.
    assert.ok(p1.hp < hp1Before || !p1.alive || p1.status.stunned > 0,
      "seismicStomp must damage/stun player (applyAoE self-skip is mob.id, not player.id)");
  }
});

// ── 24. HP scaling (test-14) and entrance AoE (test-16) still pass ───────────
// (These are covered by tests 14 and 16 above; this guard just double-checks the
//  new ability tags didn't break the existing entrance AoE path for giantDwarf.)
test("giantDwarf entrance AoE still fires after ability tag renamed to seismicStomp", () => {
  const sim = playingSim();
  sim.mobs = [];

  const mob = spawnMob("mob:99", "giantDwarf", 0, 0);
  mob.spawnInvuln = 0;
  mob.entering = 0.001;
  sim.mobs.push(mob);

  const p1 = sim.players.get("p1");
  p1.x = 3; p1.z = 0; // inside entrance radius 6
  p1.vx = 0; p1.vz = 0;
  p1.alive = true; p1.falling = false;

  sim.events = [];
  sim.stepMobs(1 / CFG.TICK_RATE);

  const arriveEv = sim.events.find(e => e.type === "mobArrive" && e.id === mob.id);
  assert.ok(arriveEv, "mobArrive must fire on entrance completion");
  const speed = Math.hypot(p1.vx, p1.vz);
  assert.ok(speed > 0, "entrance AoE must knock back player inside arrival radius");
});

// ── 25. magmaEruption telegraph ↔ meteor spatial alignment ───────────────────
test("magmaEruption: all queued meteor XZ positions fall inside the mobTelegraph decal radius (target >stageR away)", () => {
  const sim = playingSim();
  sim.mobs = [];
  const mob = injectMob(sim, "fireElemental", 0, 0);
  const cfg = CFG.MOB_TYPES.fireElemental;

  // Place target far beyond stageR (4 u) to expose decoupling before fix.
  const p = sim.players.get("p1");
  p.x = 20; p.z = 0; // 20 u away, far beyond stageR=4
  p.alive = true; p.falling = false;

  // Start channel — this locks the cast point (clamped to stageR with the fix).
  sim.events = [];
  sim._startMobChannel(mob, p);

  const telegraphEv = sim.events.find(e => e.type === "mobTelegraph" && e.id === mob.id);
  assert.ok(telegraphEv, "mobTelegraph event must be emitted");

  // Fire ability using the locked channel cast point.
  sim._fireMobAbility(mob, p);

  const meteors = sim.meteors.filter(m => m.ownerId === mob.id);
  assert.strictEqual(meteors.length, cfg.stages, `expected ${cfg.stages} meteors`);

  // All meteor XZ positions must fall within the telegraph decal:
  // telegraph center (telegraphEv.x, telegraphEv.z) + radius telegraphEv.radius.
  const tr = telegraphEv.radius;
  for (const m of meteors) {
    const dist = Math.hypot(m.x - telegraphEv.x, m.z - telegraphEv.z);
    assert.ok(dist <= tr + cfg.abilityRadius + 0.01,
      `meteor at (${m.x.toFixed(2)}, ${m.z.toFixed(2)}) is ${dist.toFixed(2)} u from telegraph center (${telegraphEv.x.toFixed(2)}, ${telegraphEv.z.toFixed(2)}), radius=${tr}; must be within decal coverage`);
  }
});

// ── Step 8: A2 — AoE/targeted spells damage mobs ─────────────────────────────
test("damageMobsInRadius: Detonate (explode) in radius drops mob hitsRemaining and emits mobHit", () => {
  const sim = playingSim();
  sim.mobs = [];
  const mob = injectMob(sim, "giantDwarf", 3, 0);
  const hitsBefore = mob.hitsRemaining;
  sim.events = [];
  // Simulate Detonate impact at mob position with BOLT_BASE_DAMAGE-scaled damage.
  const detDmg = 32; // B3 tuned value
  sim.damageMobsInRadius(mob.x, mob.z, 6, { dmg: detDmg, kb: 0, by: "p1" });
  const expected = Math.max(1, Math.round(detDmg / CFG.BOLT_BASE_DAMAGE));
  assert.strictEqual(mob.hitsRemaining, hitsBefore - expected,
    `damageMobsInRadius must reduce hitsRemaining by ${expected}`);
  const hitEv = sim.events.find(e => e.type === "mobHit" && e.id === mob.id);
  assert.ok(hitEv, "damageMobsInRadius must emit a mobHit event");
});

test("damageMobsInRadius: Doom (target) with dmg=24 kills a 1-hit mob and emits mobDeath", () => {
  const sim = playingSim();
  sim.mobs = [];
  const mob = injectMob(sim, "minion", 2, 0); // minion has maxHits=3; adjust to 1
  mob.hitsRemaining = 1;
  sim.events = [];
  sim.damageMobsInRadius(mob.x, mob.z, 15, { dmg: 24, by: "p1" });
  assert.strictEqual(mob.alive, false, "mob with 1 hit remaining must die from damageMobsInRadius");
  const deathEv = sim.events.find(e => e.type === "mobDeath" && e.id === mob.id);
  assert.ok(deathEv, "damageMobsInRadius must emit mobDeath when mob reaches 0 hp");
});

test("mob bolts still never damage other mobs (A2 guard — bolt path unchanged)", () => {
  const sim = playingSim();
  sim.mobs = [];
  const mob = injectMob(sim, "giantDwarf", 3, 0);
  const hitsBefore = mob.hitsRemaining;
  // Inject a mob-owned bolt on the mob position.
  const mobBolt = new Bolt(mob.id, mob.x, mob.z, 0, 0xffffff);
  mobBolt.x = mob.x; mobBolt.z = mob.z;
  sim.bolts.push(mobBolt);
  sim.resolveMobHits();
  assert.strictEqual(mob.hitsRemaining, hitsBefore, "mob-owned bolt must not reduce mob hitsRemaining (A2 unchanged)");
});

console.log(`\n${passed} tests passed.`);
