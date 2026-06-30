// Headless smoke + logic tests for the pure simulation (no browser needed).
// Run with: node test/sim.test.mjs
import assert from "node:assert";
import { Simulation, PHASE } from "../src/sim.js";
import { Bolt } from "../src/bolt.js";
import { CFG } from "../src/config.js";
import { dodgeVector } from "../src/bot.js";

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

test("simulation exposes five selectable arena worlds", () => {
  assert.deepStrictEqual(CFG.ARENA_WORLDS.map((world) => world.id), ["circle", "islands", "bridge", "cross", "ring"]);
});

test("host arena world option changes playable land shape", () => {
  const sim = new Simulation({ arenaWorld: "bridge" });
  assert.strictEqual(sim.arena.world.id, "bridge");
  assert.strictEqual(sim.arena.isOnPlatform(0, 0), true);
  assert.strictEqual(sim.arena.isOnPlatform(10, 10), false);
  assert.strictEqual(sim.snapshot().arenaWorld, "bridge");
});

test("host land size option sets starting arena radius and spawn ring", () => {
  const sim = new Simulation({ landSize: "large" });
  sim.addPlayer("a", "A"); sim.addPlayer("b", "B");
  sim.startMatch();
  assert.strictEqual(sim.arena.radius, CFG.ARENA_LAND_SIZES.large.radius);
  for (const p of sim.players.values()) {
    const d = Math.hypot(p.x, p.z);
    assert.ok(d > CFG.ARENA_RADIUS, "large land size should spawn players farther out");
    assert.ok(sim.arena.isOnPlatform(p.x, p.z), "spawned off large platform");
  }
});

test("invalid arena world and land size options fall back to defaults", () => {
  const sim = new Simulation({ arenaWorld: "bad", landSize: "huge" });
  assert.strictEqual(sim.arena.world.id, CFG.DEFAULT_ARENA_WORLD);
  assert.strictEqual(sim.landSize.id, CFG.DEFAULT_ARENA_LAND_SIZE);
});

test("every selectable arena world spawns players on playable land", () => {
  for (const world of CFG.ARENA_WORLDS) {
    const sim = new Simulation({ arenaWorld: world.id, landSize: "medium" });
    for (let i = 0; i < CFG.MAX_PLAYERS; i++) sim.addPlayer(`p${i}`, `P${i}`);
    sim.startMatch();
    for (const p of sim.players.values()) {
      assert.ok(sim.arena.isOnPlatform(p.x, p.z), `${world.id} spawned ${p.id} off platform at ${p.x},${p.z}`);
    }
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
  const sim = new Simulation({ seed: 42 });
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

test("held-fire auto-attacks emit a cast event for animation", () => {
  const sim = new Simulation();
  sim.addPlayer("a", "A"); sim.addPlayer("b", "B");
  sim.startMatch();
  advance(sim, CFG.ROUND.COUNTDOWN + 0.1);
  const a = sim.players.get("a");
  a.x = 0; a.z = 0; a.aim = 0; a.cooldown = 0;
  sim.setInput("a", { move: [0, 0], aim: 0, fire: true, seq: 1 });
  sim.step(1 / CFG.TICK_RATE);
  assert.ok(sim.events.some((ev) => ev.type === "cast" && ev.spell === "fireball" && ev.id === "a"), "held fire should emit fireball cast event");
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

test("opposing projectiles cancel each other without damaging players", () => {
  const sim = new Simulation({ seed: 42 });
  sim.addPlayer("a", "A"); sim.addPlayer("b", "B");
  sim.startMatch();
  advance(sim, CFG.ROUND.COUNTDOWN + 0.1);
  const a = sim.players.get("a");
  const b = sim.players.get("b");
  a.x = -4; a.z = 0; a.aim = 0; a.cooldown = 0;
  b.x = 4; b.z = 0; b.aim = Math.PI; b.cooldown = 0;
  a.vx = 0; a.vz = 0; b.vx = 0; b.vz = 0;
  sim.setInput("a", { move: [0, 0], aim: 0, fire: true, seq: 1 });
  sim.setInput("b", { move: [0, 0], aim: Math.PI, fire: true, seq: 1 });
  sim.step(1 / CFG.TICK_RATE);
  sim.setInput("a", { move: [0, 0], aim: 0, fire: false, seq: 2 });
  sim.setInput("b", { move: [0, 0], aim: Math.PI, fire: false, seq: 2 });
  let sawClash = false;
  for (let t = 0; t < 0.35; t += 1 / CFG.TICK_RATE) {
    sim.step(1 / CFG.TICK_RATE);
    sawClash ||= sim.events.some((ev) => ev.type === "projectileClash");
  }
  assert.strictEqual(sim.bolts.length, 0, "colliding projectiles should be destroyed");
  assert.strictEqual(a.vx, 0, "caster A should not receive knockback");
  assert.strictEqual(b.vx, 0, "caster B should not receive knockback");
  assert.ok(sawClash, "missing projectile clash event");
});

test("fast opposing projectiles clash even when they cross within a single tick", () => {
  const sim = new Simulation();
  sim.addPlayer("a", "A"); sim.addPlayer("b", "B");
  sim.startMatch();
  advance(sim, CFG.ROUND.COUNTDOWN + 0.1);
  const a = sim.players.get("a");
  const b = sim.players.get("b");
  // Park casters far apart and out of the projectiles' path so they can't be hit.
  a.x = 0; a.z = 12; a.vx = 0; a.vz = 0;
  b.x = 0; b.z = -12; b.vx = 0; b.vz = 0;
  // Two near-head-on bolts on crossing paths with a 0.62 lateral offset. Their
  // geometric closest approach (0.62) is well inside the clash diameter (0.9),
  // but at full BOLT_SPEED they swap sides between ticks, so a point-overlap
  // check sampled only at tick boundaries never sees them within range.
  sim.bolts.push(new Bolt("a", -4, 0, 0, 0xffffff));
  sim.bolts.push(new Bolt("b", 4, 0.62, Math.PI, 0xffffff));
  let sawClash = false;
  for (let t = 0; t < 0.2; t += 1 / CFG.TICK_RATE) {
    sim.step(1 / CFG.TICK_RATE);
    sawClash ||= sim.events.some((ev) => ev.type === "projectileClash");
  }
  assert.ok(sawClash, "fast crossing projectiles tunneled without clashing");
  assert.strictEqual(sim.bolts.length, 0, "tunneled projectiles were not destroyed");
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

test("hazard death delay stays within the recovery target window", () => {
  assert.ok(CFG.HAZARD_DEATH_DELAY >= 3);
  assert.ok(CFG.HAZARD_DEATH_DELAY <= 5);
});

test("a player knocked into the hazard zone gets a short recovery window before dying", () => {
  const sim = new Simulation();
  sim.addPlayer("a", "A"); sim.addPlayer("b", "B");
  sim.startMatch();
  advance(sim, CFG.ROUND.COUNTDOWN + 0.1);
  const b = sim.players.get("b");
  b.x = CFG.ARENA_RADIUS - 0.1; b.z = 0;
  b.vx = 60; // huge shove off the edge
  advance(sim, 1);
  assert.strictEqual(b.alive, true, "player should survive briefly in the hazard zone");
  assert.strictEqual(b.falling, false, "player should remain controllable during the recovery window");
  advance(sim, CFG.HAZARD_DEATH_DELAY + 0.2);
  assert.strictEqual(b.alive, false, "player should die after the hazard death delay expires");
});

test("a player in the hazard zone can recover by moving back onto the platform", () => {
  const sim = new Simulation();
  sim.addPlayer("a", "A"); sim.addPlayer("b", "B");
  sim.startMatch();
  advance(sim, CFG.ROUND.COUNTDOWN + 0.1);
  const b = sim.players.get("b");
  b.x = CFG.ARENA_RADIUS + 0.2; b.z = 0;
  b.vx = 0; b.vz = 0;
  sim.setInput("b", { move: [-1, 0], aim: Math.PI, fire: false, seq: 1 });
  advance(sim, 0.5);
  assert.strictEqual(b.alive, true);
  assert.strictEqual(b.falling, false);
  assert.ok(sim.arena.isOnPlatform(b.x, b.z), "player should be back on the platform");
  advance(sim, CFG.HAZARD_DEATH_DELAY + 0.2);
  assert.strictEqual(b.alive, true, "recovered player should not keep burning after returning");
});

test("hazard zone exposes a local countdown before the fall", () => {
  const sim = new Simulation();
  sim.addPlayer("a", "A"); sim.addPlayer("b", "B");
  sim.startMatch();
  advance(sim, CFG.ROUND.COUNTDOWN + 0.1);
  const b = sim.players.get("b");
  b.x = CFG.ARENA_RADIUS + 0.2; b.z = 0;
  b.vx = 0; b.vz = 0;
  sim.step(1 / CFG.TICK_RATE);
  const snap = sim.snapshot().players.find((p) => p.id === "b");
  assert.ok(snap.hz > 0, "hazard countdown should be visible in snapshots");
  assert.ok(snap.hz <= CFG.HAZARD_DEATH_DELAY);
});

test("swap can recover a player from the hazard zone", () => {
  const sim = new Simulation();
  sim.addPlayer("a", "A"); sim.addPlayer("b", "B");
  sim.startMatch();
  advance(sim, CFG.ROUND.COUNTDOWN + 0.1);
  const a = sim.players.get("a");
  const b = sim.players.get("b");
  a.x = 1; a.z = 0;
  b.x = CFG.ARENA_RADIUS + 0.2; b.z = 0;
  b.vx = 0; b.vz = 0;
  sim.setInput("b", { move: [0, 0], aim: Math.PI, fire: false, seq: 1, casts: [{ id: 1, spell: "swap", tx: 0, tz: 0 }] });
  sim.step(1 / CFG.TICK_RATE);
  assert.ok(sim.arena.isOnPlatform(b.x, b.z), "swap should move the hazard-zone player back to the platform");
  assert.strictEqual(b.alive, true);
});

test("projectiles can hit players recovering in the hazard zone", () => {
  const sim = new Simulation({ seed: 42 });
  sim.addPlayer("a", "A"); sim.addPlayer("b", "B");
  sim.startMatch();
  advance(sim, CFG.ROUND.COUNTDOWN + 0.1);
  const a = sim.players.get("a");
  const b = sim.players.get("b");
  a.x = CFG.ARENA_RADIUS - 2; a.z = 0; a.aim = 0; a.cooldown = 0;
  b.x = CFG.ARENA_RADIUS + 0.7; b.z = 0; b.vx = 0; b.vz = 0;
  sim.setInput("a", { move: [0, 0], aim: 0, fire: true, seq: 1 });
  sim.step(1 / CFG.TICK_RATE);
  let hit = sim.events.some((ev) => ev.type === "hit" && ev.victim === "b");
  sim.setInput("a", { move: [0, 0], aim: 0, fire: false, seq: 2 });
  for (let i = 0; i < 8; i++) {
    sim.step(1 / CFG.TICK_RATE);
    hit ||= sim.events.some((ev) => ev.type === "hit" && ev.victim === "b");
  }
  assert.ok(b.vx > 0, "hazard-zone victim should be hit and pushed farther out");
  assert.ok(hit, "hit event should be emitted for hazard-zone victim");
});

test("players recovering in the hazard zone can fire back at players on land", () => {
  const sim = new Simulation({ seed: 42 });
  sim.addPlayer("a", "A"); sim.addPlayer("b", "B");
  sim.startMatch();
  advance(sim, CFG.ROUND.COUNTDOWN + 0.1);
  const a = sim.players.get("a");
  const b = sim.players.get("b");
  a.x = CFG.ARENA_RADIUS + 0.7; a.z = 0; a.aim = Math.PI; a.cooldown = 0;
  b.x = CFG.ARENA_RADIUS - 2; b.z = 0; b.vx = 0; b.vz = 0;
  sim.setInput("a", { move: [0, 0], aim: Math.PI, fire: true, seq: 1 });
  sim.step(1 / CFG.TICK_RATE);
  sim.setInput("a", { move: [0, 0], aim: Math.PI, fire: false, seq: 2 });
  advance(sim, 0.2);
  assert.ok(b.vx < 0, "land player should be hit by a hazard-zone caster firing back");
});

test("hazard zone movement is slowed but still allows spell recovery", () => {
  const sim = new Simulation({ seed: 42 });
  sim.addPlayer("a", "A"); sim.addPlayer("b", "B");
  sim.startMatch();
  advance(sim, CFG.ROUND.COUNTDOWN + 0.1);
  const b = sim.players.get("b");
  b.x = 0; b.z = 0;
  sim.setInput("b", { move: [1, 0], aim: 0, fire: false, seq: 1 });
  advance(sim, 0.25);
  const normalDistance = b.x;
  b.x = CFG.ARENA_RADIUS + 0.2; b.z = 0;
  b.vx = 0; b.vz = 0;
  sim.setInput("b", { move: [1, 0], aim: 0, fire: false, seq: 2 });
  advance(sim, 0.25);
  const hazardDistance = b.x - (CFG.ARENA_RADIUS + 0.2);
  assert.ok(hazardDistance > 0, "player should still have movement control in the hazard zone");
  assert.ok(hazardDistance < normalDistance * 0.5, "hazard zone movement should be meaningfully slowed");
  sim.setInput("b", { move: [0, 0], aim: 0, fire: false, seq: 3, casts: [{ id: 1, spell: "teleport", tx: 0, tz: 0 }] });
  sim.step(1 / CFG.TICK_RATE);
  assert.ok(sim.arena.isOnPlatform(b.x, b.z), "teleport should allow hazard-zone recovery");
  assert.strictEqual(b.alive, true);
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

test("host can configure brilliant bots up to open player slots", () => {
  const sim = new Simulation();
  sim.addPlayer("host", "Host");
  sim.addPlayer("guest", "Guest");
  const bots = sim.setBotRoster(5, "brilliant");
  assert.strictEqual(bots.length, CFG.MAX_PLAYERS - 2);
  assert.strictEqual(sim.players.size, CFG.MAX_PLAYERS);
  assert.ok(bots.every((p) => p.isBot));
  assert.ok(bots.every((p) => p.botSkill === "brilliant"));
  assert.ok(bots.every((p) => /^Brilliant Bot/.test(p.name)));
});

test("smart expert bots produce combat input against each other", () => {
  const sim = new Simulation({ seed: 42 });
  sim.setBotRoster(2, "expert");
  assert.strictEqual(sim.startMatch(), true);
  advance(sim, CFG.ROUND.COUNTDOWN + 0.1);
  sim.step(1 / CFG.TICK_RATE);
  const bots = [...sim.players.values()].filter((p) => p.isBot);
  assert.strictEqual(bots.length, 2);
  assert.ok(bots.every((p) => p.input.seq > 0));
  assert.ok(sim.bolts.length > 0 || sim.meteors.length > 0, "bot combat input should produce attacks");
});

test("expert bots use handbook abilities against targets", () => {
  const sim = new Simulation({ seed: 42 });
  sim.setBotRoster(2, "expert");
  assert.strictEqual(sim.startMatch(), true);
  advance(sim, CFG.ROUND.COUNTDOWN + 0.1);
  let casts = 0;
  const dt = 1 / CFG.TICK_RATE;
  for (let t = 0; t < 0.4; t += dt) {
    sim.step(dt);
    casts += sim.events.filter((e) => e.type === "meteorCast" || e.type === "lightning" || e.type === "cast").length;
  }
  assert.ok(casts > 0 || sim.meteors.length > 0, "expert bots should cast abilities");
});

test("every bot tier casts handbook abilities (no dead range checks)", () => {
  function countAbilityCasts(skill, seconds) {
    const sim = new Simulation({ seed: 42 });
    sim.setBotRoster(2, skill);
    assert.strictEqual(sim.startMatch(), true);
    advance(sim, CFG.ROUND.COUNTDOWN + 0.05);
    let casts = 0;
    const dt = 1 / CFG.TICK_RATE;
    for (let t = 0; t < seconds; t += dt) {
      sim.step(dt);
      const abilityTypes = ["cast", "lightning", "meteorCast", "gravity", "thrust", "shield", "swap", "drain", "link", "teleport"];
      casts += sim.events.filter((e) => abilityTypes.includes(e.type)).length;
      if (sim.phase !== PHASE.PLAYING) break;
    }
    return casts;
  }
  for (const skill of ["smart", "brilliant", "expert"]) {
    assert.ok(countAbilityCasts(skill, 8) > 0, `${skill} bots should cast at least one ability`);
  }
});

test("bot difficulty tiers fire at distinct cadences (expert > brilliant > smart)", () => {
  // Pin both bots at a fixed close distance before every tick so knockback
  // cannot push them outside their fireRange — this isolates the fireEvery
  // cadence constant (the actual invariant) from positioning noise caused by
  // balance tuning (KB values, friction, spell ranges, etc.).
  function countShots(skill, seconds) {
    const sim = new Simulation({ seed: 42 });
    sim.setBotRoster(2, skill);
    assert.strictEqual(sim.startMatch(), true);
    advance(sim, CFG.ROUND.COUNTDOWN + 0.05);
    const bots = sim.botPlayers();
    const bot = bots[0];
    let shots = 0, prev = false;
    const dt = 1 / CFG.TICK_RATE;
    for (let t = 0; t < seconds; t += dt) {
      // Reset positions and velocities so neither bot escapes fireRange or dies.
      for (const p of sim.players.values()) { p.vx = 0; p.vz = 0; p.alive = true; p.falling = false; p._hazardTime = 0; }
      if (bots[0]) { bots[0].x = 0; bots[0].z = 0; }
      if (bots[1]) { bots[1].x = 8; bots[1].z = 0; } // 8u: inside every tier's fireRange
      sim.step(dt);
      if (sim.phase !== PHASE.PLAYING) break;
      const f = bot.input.fire;
      if (f && !prev) shots++;
      prev = f;
    }
    return shots;
  }
  const smart = countShots("smart", 3);
  const brilliant = countShots("brilliant", 3);
  const expert = countShots("expert", 3);
  assert.ok(expert > brilliant, `expert(${expert}) should out-shoot brilliant(${brilliant})`);
  assert.ok(brilliant > smart, `brilliant(${brilliant}) should out-shoot smart(${smart})`);
});

// ── New behaviour tests (bot.js archetypes) ─────────────────────────────────

test("bot archetype loadouts are applied as item modifiers", () => {
  // Expert: aegis (kbResist=0.18) + pendant (cdr=0.12)
  const sim = new Simulation();
  sim.setBotRoster(2, "expert");
  const [expertBot] = sim.botPlayers();
  assert.ok(expertBot.mods.kbResist > 0, "expert bot should have kbResist from aegis loadout");
  assert.ok(expertBot.mods.cdr > 0, "expert bot should have CDR from pendant loadout");
  // Smart: bloodSword (lifesteal) + bootsOfSpeed (speedMul > 1)
  const sim2 = new Simulation();
  sim2.setBotRoster(2, "smart");
  const [smartBot] = sim2.botPlayers();
  assert.ok(smartBot.mods.lifesteal > 0, "smart bot should have lifesteal from bloodSword loadout");
  assert.ok(smartBot.mods.speedMul > 1, "smart bot should have speed bonus from bootsOfSpeed loadout");
});

test("bot uses escape spell when pushed near the arena edge", () => {
  const sim = new Simulation({ seed: 42 });
  sim.setBotRoster(2, "expert");
  sim.startMatch();
  advance(sim, CFG.ROUND.COUNTDOWN + 0.05);
  const [bot] = sim.botPlayers();
  // Place bot inside the 4-unit edge-danger zone
  bot.x = sim.arena.radius - 1.5;
  bot.z = 0; bot.vx = 0; bot.vz = 0;
  // Make ability available immediately
  bot._nextBotAbilityAt = 0;
  bot.cooldowns = {};
  let escaped = false;
  for (let i = 0; i < 5; i++) {
    sim.step(1 / CFG.TICK_RATE);
    if (sim.events.some((e) => (e.type === "thrust" || e.type === "teleport") && e.id === bot.id)) {
      escaped = true; break;
    }
  }
  assert.ok(escaped, "expert bot near the arena edge should immediately use an escape spell");
});

test("expert bot leads aim ahead of a moving target", () => {
  // With leadFactor=0.9, an expert bot watching a target move perpendicularly
  // should aim ahead of the direct bearing by ~0.3 radians.
  const sim = new Simulation({ seed: 42 });
  sim.setBotRoster(1, "expert");
  sim.addPlayer("human", "Human");
  sim.startMatch();
  advance(sim, CFG.ROUND.COUNTDOWN + 0.1);
  const bot = sim.botPlayers()[0];
  const human = sim.players.get("human");
  // Fix starting positions: bot at centre, human 8 units in +x moving in +z
  bot.x = 0; bot.z = 0; bot.vx = 0; bot.vz = 0;
  human.x = 8; human.z = 0; human.vx = 0; human.vz = 0;
  sim.setInput("human", { move: [0, 1], aim: 0, fire: false, seq: 20 });
  // 5 ticks for EMA velocity estimator to converge toward MOVE_SPEED
  for (let i = 0; i < 5; i++) sim.step(1 / CFG.TICK_RATE);
  // Direct bearing at current positions
  const directAim = Math.atan2(human.z - bot.z, human.x - bot.x);
  // With tvz ≈ MOVE_SPEED and leadFactor=0.9 the predicted intercept sits
  // ~2-3 units above the current human position → aim clearly above directAim.
  assert.ok(
    bot.input.aim > directAim,
    `expert bot should lead a moving target (aim=${bot.input.aim.toFixed(3)}, direct=${directAim.toFixed(3)})`
  );
});

test("expert bot lands hits on a moving target via lead-aim", () => {
  const sim = new Simulation({ seed: 42 });
  sim.setBotRoster(1, "expert");
  sim.addPlayer("human", "Human");
  sim.startMatch();
  advance(sim, CFG.ROUND.COUNTDOWN + 0.1);
  const bot = sim.botPlayers()[0];
  const human = sim.players.get("human");
  // Bot at centre; human at (8, 0) moving steadily in +z (perpendicular to bot)
  bot.x = 0; bot.z = 0; bot.vx = 0; bot.vz = 0;
  human.x = 8; human.z = 0; human.vx = 0; human.vz = 0;
  sim.setInput("human", { move: [0, 1], aim: 0, fire: false, seq: 20 });
  let hits = 0;
  const dt = 1 / CFG.TICK_RATE;
  for (let t = 0; t < 2; t += dt) {
    sim.step(dt);
    hits += sim.events.filter((e) => e.type === "hit" && e.victim === "human").length;
    if (!bot.alive || !human.alive || sim.phase !== PHASE.PLAYING) break;
  }
  assert.ok(hits > 0, `expert bot should land hits on a perpendicularly-moving target (got ${hits})`);
});

test("bot selects KO spell when target has high charge near the arena edge", () => {
  // Discriminating test: the KO-burst branch gives meteor a score of 2.5*0.9=2.25,
  // beating the general-zoning top choice (lightning: 1.0*0.95=0.95).  Without
  // the KO branch, lightning would win, not meteor.  The test therefore asserts
  // specifically "meteorCast" so deleting the KO-burst block would cause failure.
  function runScenario(charge) {
    const sim = new Simulation({ seed: 42 });
    sim.setBotRoster(2, "expert");
    sim.startMatch();
    advance(sim, CFG.ROUND.COUNTDOWN + 0.05);
    const [bot, target] = sim.botPlayers();
    // Target near edge (2.5 units from rim)
    target.x = sim.arena.radius - 2.5; target.z = 0; target.charge = charge;
    // Bot within meteor range (~8.5 units from target)
    bot.x = sim.arena.radius - 11; bot.z = 0; bot.vx = 0; bot.vz = 0;
    bot._nextBotAbilityAt = 0; bot.cooldowns = {};
    const spellsFired = [];
    for (let i = 0; i < 10; i++) {
      sim.step(1 / CFG.TICK_RATE);
      for (const e of sim.events) {
        if (e.id === bot.id && (e.type === "meteorCast" || e.type === "lightning" || e.type === "gravity")) {
          spellsFired.push(e.type);
        }
      }
      if (spellsFired.length) break;
    }
    return spellsFired[0] ?? null;
  }

  // KO scenario: target has high charge near edge → meteor should win (score 2.25)
  const koSpell = runScenario(2.0);
  assert.strictEqual(koSpell, "meteorCast",
    `expert bot should pick meteor in KO-burst scenario (got ${koSpell}) — ` +
    "the KO-burst multiplier (2.5×) must lift meteor above the general-zoning winner (lightning 0.95)");

  // Non-KO scenario: same geometry but charge=0 → lightning wins general zoning (score 0.95 > meteor 0.81)
  const normalSpell = runScenario(0);
  assert.notStrictEqual(normalSpell, "meteorCast",
    "with no KO conditions expert bot should NOT default to meteor (got meteorCast — " +
    "KO-burst branch must have fired despite charge=0 or target not near edge)");
});

test("dodgeVector returns evasion vector for incoming bolt and null when dodge is disabled", () => {
  // Direct unit-test of dodgeVector so the assertion is not confounded by the
  // always-on perpendicular strafe (which makes any sim-level move-vector > 0
  // regardless of whether dodging fires).
  //
  // Bolt at (0, 4) heading straight at the bot at (0, 0) with full speed (-z).
  // reactionSec = 0.175 s → nextBZ = 4 - 26*0.175 = -0.55; closestApproach ≈ 0.03
  // which is well below hitThreshold (0.6+0.45+0.4 = 1.45), so the threat registers.
  const bot = { id: "bot", x: 0, z: 0 };
  const expertProfile = { dodgeChance: 1.0, dodgeRange: 14, reactionMs: 175 };
  const alwaysDodge = () => 0; // rand() returns 0, never > dodgeChance (1.0)

  const incomingBolt = { dead: false, ownerId: "enemy", x: 0, z: 4, vx: 0, vz: -CFG.BOLT_SPEED };
  const mockSim = { bolts: [incomingBolt], meteors: [] };

  const vec = dodgeVector(mockSim, bot, expertProfile, alwaysDodge);
  assert.ok(vec !== null,
    "dodgeVector must return a non-null vector when a bolt is on a collision course");
  assert.ok(Math.abs(vec.x) + Math.abs(vec.z) > 0.5,
    `dodge vector should be meaningfully non-zero (got {x:${vec.x}, z:${vec.z}})`);

  // With dodgeChance=0 the function returns null at the early guard — dodge is disabled.
  const noProfile = { dodgeChance: 0, dodgeRange: 14, reactionMs: 175 };
  const vec2 = dodgeVector(mockSim, bot, noProfile, alwaysDodge);
  assert.strictEqual(vec2, null,
    "dodgeVector must return null when dodgeChance is 0 (dodge disabled)");

  // The stochastic gate also blocks when rand() > dodgeChance.
  const neverPassGate = () => 1.0; // rand() always returns 1.0 > dodgeChance (1.0) → false
  // Actually rand() > chance: 1.0 > 1.0 is false, use a value > 1 which is not possible.
  // Use dodgeChance=0.5 and rand=()=>0.9 so 0.9 > 0.5 → gate blocks.
  const halfProfile = { dodgeChance: 0.5, dodgeRange: 14, reactionMs: 175 };
  const blockedByGate = dodgeVector(mockSim, bot, halfProfile, () => 0.9);
  assert.strictEqual(blockedByGate, null,
    "dodgeVector must return null when the stochastic gate blocks (rand() > dodgeChance)");
});

console.log(`\n${passed} tests passed.`);
