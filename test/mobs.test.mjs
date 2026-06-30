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

console.log(`\n${passed} tests passed.`);
