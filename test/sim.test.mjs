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
  const sim = new Simulation();
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
  const sim = new Simulation();
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
  const sim = new Simulation();
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
  const sim = new Simulation();
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
  const sim = new Simulation();
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
    const sim = new Simulation();
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
  function countShots(skill, seconds) {
    const sim = new Simulation();
    sim.setBotRoster(2, skill);
    assert.strictEqual(sim.startMatch(), true);
    advance(sim, CFG.ROUND.COUNTDOWN + 0.05);
    const bot = sim.botPlayers()[0];
    let shots = 0, prev = false;
    const dt = 1 / CFG.TICK_RATE;
    for (let t = 0; t < seconds; t += dt) {
      sim.step(dt);
      if (!bot.alive || sim.phase !== PHASE.PLAYING) break;
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

console.log(`\n${passed} tests passed.`);
